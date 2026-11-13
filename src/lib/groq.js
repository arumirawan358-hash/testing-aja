import { getLevel, gradeLabel, subjectName, validateConfig } from '../data/subjects.js'
import { isValidQuestion, shuffle } from './questions.js'

export const GROQ_MODEL = 'openai/gpt-oss-120b'
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
// A smaller request stays well below common per-request token limits even for large quizzes.
const BATCH_SIZE = 8
const REQUEST_TIMEOUT_MS = 90000
const MAX_RECENT_IN_PROMPT = 6
const MIN_COMPLETION_TOKENS = 512

// Strict structured output constrains the JSON shape; each question is still validated locally.
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
  return `Buat tepat ${amount} soal pilihan ganda berbeda untuk ${levelText}, ${subjectText}.${instruction} Gunakan bahasa Indonesia yang jelas dan sesuai usia. Untuk pelajaran Bahasa Inggris, bahan soal boleh berbahasa Inggris. Setiap soal memiliki tepat empat pilihan yang berbeda, tepat satu jawaban benar dengan indeks answer 0 sampai 3, dan penjelasan singkat yang faktual. Periksa kembali jawaban dan penjelasannya. Variasikan konsep, contoh, konteks, dan posisi jawaban, tetapi jangan keluar dari materi yang dipilih. Ini bagian ${batchNumber} dari paket soal baru.${avoid} Kembalikan hanya JSON sesuai skema.`
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
    temperature: 0.8,
    seed: Math.floor(random() * 2147483647),
    // Groq counts both prompt and requested output toward the request limit.
    max_completion_tokens: maxTokens,
    reasoning_effort: 'medium',
    response_format: { type: 'json_schema', json_schema: { name: 'quiz_questions', strict: true, schema: quizSchema } },
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
  const seen = new Set(previous.map(questionFingerprint))
  const questions = []
  // Checkpoints live in the host tab only; a retry need not pay to recreate valid batches.
  if (Array.isArray(initialQuestions)) for (const question of initialQuestions) {
    const fingerprint = questionFingerprint(question?.prompt)
    if (!isValidQuestion(question) || seen.has(fingerprint) || questions.length >= total) continue
    seen.add(fingerprint)
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
      if (!isValidQuestion(question) || seen.has(fingerprint)) continue
      seen.add(fingerprint)
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

function makeBuzzerPrompt({ category, method, amount, topic }, batchNumber) {
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
  return `Buat tepat ${amount} pertanyaan kuis adu cepat untuk kategori ${JSON.stringify(category)} dengan tingkat kesulitan bervariasi (mudah, sedang, sulit) dan bahasa Indonesia yang jelas (soal Bahasa Inggris boleh berbahasa Inggris). ${kindText}.${methodFields}${instruction} Setiap soal berbeda, faktual, dan memiliki explanation singkat. Ini bagian ${batchNumber} dari paket soal. Kembalikan hanya JSON sesuai skema.`
}

function normalizeBuzzerAiQuestion(raw, index) {
  if (!raw || typeof raw !== 'object') return null
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : ''
  const explanation = typeof raw.explanation === 'string' ? raw.explanation.trim() : ''
  if (!prompt) return null
  if (raw.kind === 'mc') {
    const options = Array.isArray(raw.options) ? raw.options.map((option) => String(option ?? '').trim()) : []
    const answerIndex = Number(raw.answerIndex)
    if (options.length !== 4 || options.some((option) => !option)) return null
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

export async function generateBuzzerQuestions(settings, apiKey, { signal, fetchImpl = globalThis.fetch, random = Math.random, onProgress = () => {} } = {}) {
  const key = String(apiKey || '').trim()
  if (!key) throw new Error('Masukkan API key Groq terlebih dahulu, ya.')
  const amount = Math.max(1, Math.min(50, Number(settings.count) || 1))
  const questions = []
  while (questions.length < amount) {
    const batch = Math.min(8, amount - questions.length)
    onProgress({ done: questions.length, total: amount })
    const body = JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: 'Kamu adalah pembawa acara kuis Indonesia yang seru dan teliti. Buat pertanyaan faktual yang aman untuk semua umur dan ikuti skema JSON.' },
        { role: 'user', content: makeBuzzerPrompt({ ...settings, amount: batch }, questions.length / 8 + 1) },
      ],
      temperature: 0.9,
      seed: Math.floor(random() * 2147483647),
      max_completion_tokens: Math.max(MIN_COMPLETION_TOKENS, batch * 140),
      reasoning_effort: 'medium',
      response_format: { type: 'json_schema', json_schema: { name: 'buzzer_questions', strict: true, schema: buzzerSchema } },
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
    let rawList
    try {
      const payload = await response.json()
      const text = payload?.choices?.[0]?.message?.content
      if (typeof text !== 'string' || text.length > 200000) throw new Error('invalid')
      const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
      if (!Array.isArray(parsed.questions)) throw new Error('missing')
      rawList = parsed.questions
    } catch {
      throw new UnreadableGroqResponse()
    }
    const normalized = rawList.map((raw, index) => normalizeBuzzerAiQuestion(raw, questions.length + index)).filter(Boolean)
    if (normalized.length === 0) throw new UnreadableGroqResponse()
    questions.push(...normalized.slice(0, batch))
  }
  onProgress({ done: amount, total: amount })
  return questions.slice(0, amount)
}
