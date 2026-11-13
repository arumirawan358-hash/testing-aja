import { getLevel, gradeLabel, subjectName, validateConfig } from '../data/subjects.js'
import { isValidQuestion, shuffle } from './questions.js'

export const GROQ_MODEL = 'openai/gpt-oss-120b'
// GPT-OSS 120B supports JSON Schema in Groq's best-effort mode only.  Asking
// for strict mode produces a 400 before the model gets to generate a question.
// We validate every returned question locally instead.
export const GROQ_SCHEMA_STRICT = false
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
// A smaller request stays well below common per-request token limits even for large quizzes.
const BATCH_SIZE = 8
const REQUEST_TIMEOUT_MS = 90000
const MAX_RECENT_IN_PROMPT = 12
const MIN_COMPLETION_TOKENS = 512

// Structured output keeps the JSON shape predictable; each question is still validated locally.
const quizSchema = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          answer: { type: 'integer' },
          explanation: { type: 'string' },
        },
        required: ['prompt', 'options', 'answer', 'explanation'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
}

export function questionFingerprint(prompt) {
  return String(prompt || '').toLocaleLowerCase('id-ID').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

// Kata tanya/penghubung tidak menentukan inti sebuah soal. Mengabaikannya
// membuat "Apa ibu kota Indonesia?" dan "Sebutkan ibu kota Indonesia"
// terdeteksi sebagai pengulangan, tanpa menganggap dua soal matematika dengan
// angka berbeda sebagai soal yang sama.
const DUPLICATE_FILLERS = new Set([
  'apa', 'apakah', 'berapakah', 'berapa', 'manakah', 'siapa', 'sebutkan', 'jelaskan', 'pilih',
  'yang', 'adalah', 'dari', 'di', 'ke', 'dengan', 'untuk', 'pada', 'dan', 'atau', 'dalam',
  'the', 'a', 'an', 'what', 'which', 'who', 'where', 'when', 'why', 'how', 'is', 'are', 'of', 'to', 'in', 'for', 'with', 'from', 'choose', 'correct', 'answer', 'question',
])
const ENGLISH_WORDS = new Set([
  'what', 'which', 'who', 'where', 'when', 'why', 'how', 'the', 'and', 'or', 'is', 'are', 'was', 'were', 'be', 'do', 'does', 'did', 'has', 'have', 'of', 'to', 'in', 'on', 'for', 'with', 'from', 'by', 'at', 'as', 'if', 'not', 'this', 'that', 'these', 'those', 'choose', 'select', 'following', 'correct', 'answer', 'question', 'calculate', 'solve', 'find', 'read', 'sentence', 'word', 'number', 'value', 'equation', 'equals', 'plus', 'minus', 'largest', 'smallest', 'capital', 'city', 'country', 'planet', 'first', 'second', 'third', 'true', 'false', 'because', 'between', 'after', 'before',
])
const INDONESIAN_WORDS = new Set([
  'apa', 'apakah', 'berapakah', 'berapa', 'manakah', 'siapa', 'yang', 'adalah', 'dari', 'untuk', 'dengan', 'pada', 'dalam', 'dan', 'atau', 'berikut', 'jawaban', 'pertanyaan', 'pilihan', 'hitung', 'tentukan', 'jelaskan', 'setelah', 'sebelum', 'karena', 'antara',
])

function semanticTokens(prompt) {
  return questionFingerprint(prompt).split(' ').filter((word) => word && !DUPLICATE_FILLERS.has(word))
}

// Cek kemiripan semantik ringan untuk parafrase yang nyaris sama. Ini sengaja
// konservatif agar variasi soal matematika (angka berbeda) tetap lolos.
export function promptsAreTooSimilar(first, second) {
  if (questionFingerprint(first) === questionFingerprint(second)) return true
  const left = new Set(semanticTokens(first))
  const right = new Set(semanticTokens(second))
  if (left.size < 2 || right.size < 2) return false
  let shared = 0
  for (const word of left) if (right.has(word)) shared += 1
  return shared >= 2 && shared / Math.min(left.size, right.size) >= 0.9
}

function hasDuplicatePrompt(prompt, earlierPrompts) {
  return earlierPrompts.some((earlier) => promptsAreTooSimilar(prompt, earlier))
}

// English is valid only when the chosen subject/category or the explicit topic
// asks for it. For every other lesson we reject a clearly English prompt and
// ask Groq for a replacement batch rather than showing it to the player.
export function requiresIndonesian({ subject = '', category = '', topic = '' } = {}) {
  return !/\b(?:bahasa\s+inggris|english)\b/i.test(`${subject} ${category} ${topic}`)
}

export function hasUnexpectedEnglish(question, mustUseIndonesian = true) {
  if (!mustUseIndonesian) return false
  const text = questionFingerprint(`${question?.prompt || ''} ${question?.explanation || ''}`)
  const words = text.split(' ').filter(Boolean)
  const english = words.filter((word) => ENGLISH_WORDS.has(word)).length
  const indonesian = words.filter((word) => INDONESIAN_WORDS.has(word)).length
  // One borrowed word is common in science/technology. A question dominated by
  // several English cue words is the unwanted English output we need to retry.
  return english >= 2 && english > indonesian
}

function languageInstruction(mustUseIndonesian) {
  if (mustUseIndonesian) return 'WAJIB tulis pertanyaan, semua pilihan, dan penjelasan dalam bahasa Indonesia yang jelas. Jangan membuat soal berbahasa Inggris.'
  return 'Gunakan bahasa Indonesia untuk instruksi pertanyaan dan penjelasan. Bila materinya Bahasa Inggris, hanya kata, kalimat, atau bacaan yang sedang diuji boleh berbahasa Inggris.'
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Dibatalkan', 'AbortError')); return }
    const timeout = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
    const abort = () => { clearTimeout(timeout); reject(new DOMException('Dibatalkan', 'AbortError')) }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

function makePrompt(config, amount, recent, batchNumber) {
  const topic = config.topic?.trim()
  const subject = subjectName(config)
  const level = getLevel(config.level)
  const levelText = `jenjang ${level?.label || config.level}, ${gradeLabel(config).startsWith('Kelas') ? gradeLabel(config).toLowerCase() : gradeLabel(config)}`
  const subjectText = subject ? `mata pelajaran ${JSON.stringify(subject)}` : 'mata pelajaran bebas sesuai permintaan'
  const instruction = topic
    ? ` Ikuti permintaan pembuat soal berikut secara seksama: ${JSON.stringify(topic)}. Permintaan boleh menyebutkan jenis ujian, contoh soal, tahun, atau gaya tertentu (misalnya "soal SKD 2025", "gaya UTBK", "seperti ujian sekolah"); buatlah soal dengan format, materi, gaya bahasa, dan tingkat kesulitan yang sesuai dengan contoh yang dimaksud, seperti soal-soal sejenis yang umum ditemukan.`
    : ' Pilih materi yang relevan dengan jenjang dan mata pelajaran tersebut.'
  const avoid = recent.length ? ` Jangan ulangi atau parafrase soal berikut: ${JSON.stringify(recent.map((text) => text.slice(0, 120)))}.` : ''
  const mustUseIndonesian = requiresIndonesian({ subject, topic })
  return `Buat tepat ${amount} soal pilihan ganda berbeda untuk ${levelText}, ${subjectText}.${instruction} ${languageInstruction(mustUseIndonesian)} Setiap soal memiliki tepat empat pilihan yang berbeda, tepat satu jawaban benar dengan indeks answer 0 sampai 3, dan penjelasan singkat yang faktual. Periksa kembali jawaban dan penjelasannya. Variasikan konsep, contoh, konteks, dan posisi jawaban, tetapi jangan keluar dari materi yang dipilih. Ini bagian ${batchNumber} dari paket soal baru.${avoid} Kembalikan hanya JSON sesuai skema.`
}

class UnreadableGroqResponse extends Error {
  constructor() { super('Jawaban Groq belum dapat dibaca. Coba buat soal lagi atau gunakan topik yang lebih sederhana.') }
}

class GroqRequestTooLarge extends Error {
  constructor() { super('Batas token Groq terlalu kecil untuk permintaan ini. Periksa batas akun atau coba lagi nanti.') }
}

function friendlyHttpError(status) {
  if (status === 400) return 'Permintaan Groq tidak dapat diproses. Periksa akses model atau coba lagi.'
  if (status === 401 || status === 403) return 'API key Groq ditolak atau tidak memiliki akses. Periksa kembali kuncinya di Groq Console.'
  if (status === 404) return 'Model Groq belum tersedia untuk akun ini. Periksa akses model di Groq Console.'
  if (status === 429) return 'Batas kecepatan atau kuota Groq tercapai. Tunggu atau periksa kuota akun, lalu coba lagi.'
  return 'Groq sedang tidak dapat membuat soal. Periksa koneksi lalu coba lagi.'
}

async function isRequestTooLarge(response) {
  if (response.status === 413) return true
  if (response.status !== 400) return false
  try {
    // Inspect provider text only to classify the error; never display or log it.
    const detail = (await response.json())?.error
    const text = [detail?.message, detail?.code, detail?.type].filter((part) => typeof part === 'string').join(' ')
    return /request.{0,30}too large|context.{0,30}(length|window|limit)|token.{0,40}(limit|maximum|too (many|large))|reduce.{0,40}(length|tokens)/i.test(text)
  } catch { return false }
}

async function requestBatch(config, apiKey, amount, recent, batchNumber, signal, fetchImpl, random, maxTokens) {
  const body = JSON.stringify({
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: 'Kamu adalah guru Indonesia yang teliti. Buat soal pendidikan yang aman, faktual, sesuai kelas dan mata pelajaran, serta ikuti skema JSON.' },
      { role: 'user', content: makePrompt(config, amount, recent, batchNumber) },
    ],
    // Moderate sampling follows the Indonesian/anti-repeat instructions more consistently.
    temperature: 0.55,
    seed: Math.floor(random() * 2147483647),
    // Groq counts both prompt and requested output toward the request limit.
    max_completion_tokens: maxTokens,
    reasoning_effort: 'medium',
    response_format: { type: 'json_schema', json_schema: { name: 'quiz_questions', strict: GROQ_SCHEMA_STRICT, schema: quizSchema } },
  })

  let response
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (signal?.aborted) throw new DOMException('Dibatalkan', 'AbortError')
    const request = new AbortController()
    const abort = () => request.abort()
    signal?.addEventListener('abort', abort, { once: true })
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; request.abort() }, REQUEST_TIMEOUT_MS)
    try {
      // The user-supplied key goes only to Groq over HTTPS, never into a URL or quiz data.
      response = await fetchImpl(GROQ_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body,
        signal: request.signal,
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      })
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Dibatalkan', 'AbortError')
      if (timedOut) throw new Error('Groq merespons terlalu lama. Periksa koneksi dan coba lagi.')
      throw new Error('Tidak dapat menghubungi Groq. Periksa koneksi internet dan coba lagi.')
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      const retrySeconds = Number(response.headers?.get?.('retry-after'))
      // Browsers may hide Retry-After across origins. Allow a full token window
      // before giving up on 429, while transient server errors retry sooner.
      const fallback = response.status === 429 ? (attempt === 0 ? 15000 : 45000) : 1500 * (attempt + 1)
      await wait(retrySeconds > 0 ? Math.min(retrySeconds, 60) * 1000 : fallback, signal)
      continue
    }
    break
  }
  if (!response.ok) {
    if (await isRequestTooLarge(response)) throw new GroqRequestTooLarge()
    throw new Error(friendlyHttpError(response.status))
  }
  try {
    const payload = await response.json()
    const text = payload?.choices?.[0]?.message?.content
    if (typeof text !== 'string' || text.length > 200000) throw new Error('invalid response')
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
    if (!Array.isArray(parsed.questions)) throw new Error('missing questions')
    return parsed.questions
  } catch {
    throw new UnreadableGroqResponse()
  }
}

/** The key stays in the host's browser memory and is sent only to Groq. */
export async function generateGroqQuestions(config, apiKey, { onProgress = () => {}, onCheckpoint = () => {}, initialQuestions = [], signal, fetchImpl = globalThis.fetch, avoidPrompts = [], random = Math.random } = {}) {
  const validation = validateConfig(config)
  if (validation) throw new Error(validation)
  if (config.source !== 'groq') throw new Error('Sumber soal Groq tidak valid.')
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('Masukkan API key Groq untuk membuat soal AI.')
  if (typeof fetchImpl !== 'function') throw new Error('Browser ini tidak mendukung permintaan ke Groq.')
  const cleanKey = apiKey.trim()
  const total = Number(config.count)
  const previous = Array.isArray(avoidPrompts) ? avoidPrompts.filter((prompt) => typeof prompt === 'string' && prompt.trim()) : []
  const mustUseIndonesian = requiresIndonesian({ subject: subjectName(config), topic: config.topic })
  const seen = new Set(previous.map(questionFingerprint))
  const knownPrompts = [...previous]
  const questions = []
  // Checkpoints live in the host tab only; a retry need not pay to recreate valid batches.
  if (Array.isArray(initialQuestions)) for (const question of initialQuestions) {
    const fingerprint = questionFingerprint(question?.prompt)
    if (!isValidQuestion(question) || seen.has(fingerprint) || hasDuplicatePrompt(question.prompt, knownPrompts) || hasUnexpectedEnglish(question, mustUseIndonesian) || questions.length >= total) continue
    seen.add(fingerprint)
    knownPrompts.push(question.prompt)
    questions.push(question)
  }
  let batch = 0
  let batchSize = BATCH_SIZE
  let recentLimit = MAX_RECENT_IN_PROMPT
  let tokenCeiling = 1000 + BATCH_SIZE * 275
  let stagnant = 0
  onProgress(questions.length, total)
  while (questions.length < total) {
    if (signal?.aborted) throw new DOMException('Dibatalkan', 'AbortError')
    if (batch >= total * 4 + 8) throw new Error('Groq belum menghasilkan cukup soal baru dan berbeda. Coba jumlah lebih sedikit atau topik yang lebih luas.')
    const amount = Math.min(batchSize, total - questions.length)
    const recent = recentLimit ? [...previous.slice(-recentLimit), ...questions.slice(-recentLimit).map((question) => question.prompt)].slice(-recentLimit) : []
    const maxTokens = Math.min(tokenCeiling, 1000 + amount * 275)
    let items
    try {
      items = await requestBatch(config, cleanKey, amount, recent, ++batch, signal, fetchImpl, random, maxTokens)
    } catch (error) {
      // 413 means waiting cannot help: reduce the batch, prompt and output budget in turn.
      // An incomplete JSON response may also become readable in a smaller batch.
      if ((error instanceof GroqRequestTooLarge || error instanceof UnreadableGroqResponse) && amount > 1) {
        batchSize = Math.max(1, Math.floor(amount / 2))
        continue
      }
      if (error instanceof GroqRequestTooLarge && recent.length) {
        recentLimit = Math.floor(Math.min(recentLimit, recent.length) / 2)
        continue
      }
      if (error instanceof GroqRequestTooLarge && maxTokens > MIN_COMPLETION_TOKENS) {
        tokenCeiling = Math.max(MIN_COMPLETION_TOKENS, Math.floor(maxTokens * 0.7))
        continue
      }
      throw error
    }
    const before = questions.length
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const question = {
        prompt: typeof item.prompt === 'string' ? item.prompt.trim() : '',
        options: Array.isArray(item.options) ? item.options.map((option) => typeof option === 'string' ? option.trim() : '') : [],
        answer: item.answer,
        explanation: typeof item.explanation === 'string' ? item.explanation.trim() : '',
      }
      const fingerprint = questionFingerprint(question.prompt)
      if (!isValidQuestion(question) || seen.has(fingerprint) || hasDuplicatePrompt(question.prompt, knownPrompts) || hasUnexpectedEnglish(question, mustUseIndonesian)) continue
      seen.add(fingerprint)
      knownPrompts.push(question.prompt)
      const correct = question.options[question.answer]
      const options = shuffle(question.options, random)
      questions.push({ ...question, options, answer: options.indexOf(correct), id: `q-${questions.length + 1}` })
      if (questions.length === total) break
    }
    if (questions.length !== before) onCheckpoint(questions.slice())
    onProgress(questions.length, total)
    stagnant = questions.length === before ? stagnant + 1 : 0
    if (stagnant >= 3) throw new Error('Groq belum menghasilkan cukup soal baru dan berbeda. Coba jumlah lebih sedikit atau topik yang lebih luas.')
  }
  return questions
}

// --- Mode "Siapa Cepat Dia Menjawab" ---------------------------------------

const buzzerSchema = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          kind: { type: 'string', enum: ['mc', 'typing'] },
          options: { type: 'array', items: { type: 'string' } },
          answerIndex: { type: 'integer' },
          answerText: { type: 'string' },
          accepted: { type: 'array', items: { type: 'string' } },
          naturalAnswer: { type: 'string' },
          explanation: { type: 'string' },
        },
        required: ['prompt', 'kind', 'options', 'answerIndex', 'answerText', 'accepted', 'naturalAnswer', 'explanation'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
}

function makeBuzzerPrompt({ category, method, amount, topic }, batchNumber, recent = []) {
  const kindText = method === 'typing'
    ? 'semua soal berupa pertanyaan jawaban ketikan singkat (kind "typing")'
    : method === 'random'
      ? 'campurkan soal pilihan ganda (kind "mc") dan jawaban ketikan (kind "typing") secara acak'
      : 'semua soal berupa pilihan ganda A/B/C/D (kind "mc")'
  const methodFields = method === 'typing'
    ? 'Untuk setiap soal isi: kind "typing", options empat string kosong, answerIndex 0, answerText jawaban benar yang singkat, accepted 1 sampai 5 variasi jawaban benar yang wajar, naturalAnswer satu kalimat jawaban yang terasa diketik manusia (natural, tidak robotik, tetap memuat jawaban benar), dan explanation singkat.'
    : method === 'random'
      ? 'Untuk soal "mc": isi options tepat empat pilihan berbeda dan answerIndex 0-3. Untuk soal "typing": options empat string kosong, answerIndex 0, answerText jawaban benar singkat, accepted 1-5 variasi, naturalAnswer kalimat jawaban yang terasa diketik manusia. Selalu isi answerText dengan teks jawaban benar.'
      : 'Untuk setiap soal isi: kind "mc", options tepat empat pilihan berbeda, answerIndex 0-3, answerText sama dengan teks pilihan yang benar, accepted array kosong, naturalAnswer sama dengan teks jawaban benar.'
  const instruction = topic?.trim()
    ? ` Ikuti juga permintaan pembuat soal berikut: ${JSON.stringify(topic.trim())}.`
    : ''
  const avoid = recent.length ? ` Jangan ulangi atau parafrase soal berikut: ${JSON.stringify(recent.map((text) => text.slice(0, 120)))}.` : ''
  const mustUseIndonesian = requiresIndonesian({ category, topic })
  return `Buat tepat ${amount} pertanyaan kuis adu cepat untuk kategori ${JSON.stringify(category)} dengan tingkat kesulitan bervariasi (mudah, sedang, sulit). ${languageInstruction(mustUseIndonesian)} ${kindText}.${methodFields}${instruction} Setiap soal harus berbeda secara konsep maupun redaksi, faktual, dan memiliki explanation singkat. Ini bagian ${batchNumber} dari paket soal.${avoid} Kembalikan hanya JSON sesuai skema.`
}

function normalizeBuzzerAiQuestion(raw, index) {
  if (!raw || typeof raw !== 'object') return null
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : ''
  const explanation = typeof raw.explanation === 'string' ? raw.explanation.trim() : ''
  if (!prompt || !explanation) return null
  if (raw.kind === 'mc') {
    const options = Array.isArray(raw.options) ? raw.options.map((option) => String(option ?? '').trim()) : []
    const answerIndex = Number(raw.answerIndex)
    if (options.length !== 4 || options.some((option) => !option) || new Set(options.map((option) => option.toLocaleLowerCase('id-ID'))).size !== 4) return null
    if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3) return null
    return { id: `bz-ai-${index + 1}`, kind: 'mc', prompt, options, answerIndex, accepted: [], answerText: options[answerIndex], naturalAnswer: typeof raw.naturalAnswer === 'string' && raw.naturalAnswer.trim() ? raw.naturalAnswer.trim() : options[answerIndex], explanation }
  }
  if (raw.kind === 'typing') {
    const answerText = typeof raw.answerText === 'string' ? raw.answerText.trim() : ''
    const accepted = Array.isArray(raw.accepted) ? raw.accepted.map((item) => String(item ?? '').trim()).filter(Boolean) : []
    if (!answerText) return null
    const list = [...new Set([answerText, ...accepted])].slice(0, 5)
    return { id: `bz-ai-${index + 1}`, kind: 'typing', prompt, options: [], answerIndex: 0, answerText, accepted: list, naturalAnswer: typeof raw.naturalAnswer === 'string' && raw.naturalAnswer.trim() ? raw.naturalAnswer.trim() : answerText, explanation }
  }
  return null
}

async function requestBuzzerBatch(settings, key, amount, recent, batchNumber, signal, fetchImpl, random, maxTokens) {
  const body = JSON.stringify({
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: 'Kamu adalah pembawa acara kuis Indonesia yang seru dan teliti. Buat pertanyaan faktual, aman untuk semua umur, berbeda satu sama lain, dan ikuti skema JSON.' },
      { role: 'user', content: makeBuzzerPrompt({ ...settings, amount }, batchNumber, recent) },
    ],
    // Temperatur moderat membuat keluaran lebih patuh dan mengurangi pengulangan.
    temperature: 0.55,
    seed: Math.floor(random() * 2147483647),
    max_completion_tokens: maxTokens,
    reasoning_effort: 'medium',
    response_format: { type: 'json_schema', json_schema: { name: 'buzzer_questions', strict: GROQ_SCHEMA_STRICT, schema: buzzerSchema } },
  })
  let response
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (signal?.aborted) throw new DOMException('Dibatalkan', 'AbortError')
    const request = new AbortController()
    const abort = () => request.abort()
    signal?.addEventListener('abort', abort, { once: true })
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; request.abort() }, REQUEST_TIMEOUT_MS)
    try {
      response = await fetchImpl(GROQ_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body,
        signal: request.signal,
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      })
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Dibatalkan', 'AbortError')
      if (timedOut) throw new Error('Groq merespons terlalu lama. Periksa koneksi dan coba lagi.')
      throw new Error('Tidak dapat menghubungi Groq. Periksa koneksi internet dan coba lagi.')
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      const retrySeconds = Number(response.headers?.get?.('retry-after'))
      const fallback = response.status === 429 ? (attempt === 0 ? 15000 : 45000) : 1500 * (attempt + 1)
      await wait(retrySeconds > 0 ? Math.min(retrySeconds, 60) * 1000 : fallback, signal)
      continue
    }
    break
  }
  if (!response.ok) {
    if (await isRequestTooLarge(response)) throw new GroqRequestTooLarge()
    throw new Error(friendlyHttpError(response.status))
  }
  try {
    const payload = await response.json()
    const text = payload?.choices?.[0]?.message?.content
    if (typeof text !== 'string' || text.length > 200000) throw new Error('invalid')
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
    if (!Array.isArray(parsed.questions)) throw new Error('missing')
    return parsed.questions
  } catch {
    throw new UnreadableGroqResponse()
  }
}

export async function generateBuzzerQuestions(settings, apiKey, { signal, fetchImpl = globalThis.fetch, random = Math.random, onProgress = () => {}, avoidPrompts = [] } = {}) {
  const key = String(apiKey || '').trim()
  if (!key) throw new Error('Masukkan API key Groq terlebih dahulu, ya.')
  if (typeof fetchImpl !== 'function') throw new Error('Browser ini tidak mendukung permintaan ke Groq.')
  const amount = Math.max(1, Math.min(50, Number(settings.count) || 1))
  const previous = Array.isArray(avoidPrompts) ? avoidPrompts.filter((prompt) => typeof prompt === 'string' && prompt.trim()) : []
  const mustUseIndonesian = requiresIndonesian({ category: settings.category, topic: settings.topic })
  const questions = []
  const seen = new Set(previous.map(questionFingerprint))
  const knownPrompts = [...previous]
  let batchSize = BATCH_SIZE
  let recentLimit = MAX_RECENT_IN_PROMPT
  let tokenCeiling = 1000 + BATCH_SIZE * 230
  let batchNumber = 0
  let stagnant = 0
  onProgress({ done: 0, total: amount })
  while (questions.length < amount) {
    if (signal?.aborted) throw new DOMException('Dibatalkan', 'AbortError')
    if (batchNumber >= amount * 4 + 8) throw new Error('Groq belum menghasilkan cukup soal baru dan berbeda. Coba jumlah lebih sedikit atau topik yang lebih luas.')
    const batch = Math.min(batchSize, amount - questions.length)
    const recent = recentLimit ? [...previous.slice(-recentLimit), ...questions.slice(-recentLimit).map((question) => question.prompt)].slice(-recentLimit) : []
    const maxTokens = Math.min(tokenCeiling, 1000 + batch * 230)
    let rawList
    try {
      rawList = await requestBuzzerBatch(settings, key, batch, recent, ++batchNumber, signal, fetchImpl, random, maxTokens)
    } catch (error) {
      // Smaller payloads recover from context/output limits and malformed JSON.
      if ((error instanceof GroqRequestTooLarge || error instanceof UnreadableGroqResponse) && batch > 1) {
        batchSize = Math.max(1, Math.floor(batch / 2))
        continue
      }
      if (error instanceof GroqRequestTooLarge && recent.length) {
        recentLimit = Math.floor(Math.min(recentLimit, recent.length) / 2)
        continue
      }
      if (error instanceof GroqRequestTooLarge && maxTokens > MIN_COMPLETION_TOKENS) {
        tokenCeiling = Math.max(MIN_COMPLETION_TOKENS, Math.floor(maxTokens * 0.7))
        continue
      }
      throw error
    }
    const before = questions.length
    for (const raw of rawList) {
      const question = normalizeBuzzerAiQuestion(raw, questions.length)
      if (!question || seen.has(questionFingerprint(question.prompt)) || hasDuplicatePrompt(question.prompt, knownPrompts) || hasUnexpectedEnglish(question, mustUseIndonesian)) continue
      seen.add(questionFingerprint(question.prompt))
      knownPrompts.push(question.prompt)
      questions.push({ ...question, id: `bz-ai-${questions.length + 1}` })
      if (questions.length === amount) break
    }
    onProgress({ done: questions.length, total: amount })
    stagnant = questions.length === before ? stagnant + 1 : 0
    if (stagnant >= 3) throw new Error('Groq belum menghasilkan cukup soal baru dan berbeda. Coba jumlah lebih sedikit atau topik yang lebih luas.')
  }
  return questions
}
