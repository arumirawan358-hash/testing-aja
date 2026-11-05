import { subjectName, validateConfig } from '../data/subjects.js'
import { isValidQuestion, shuffle } from './questions.js'

export const GROQ_MODEL = 'openai/gpt-oss-120b'
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
const BATCH_SIZE = 15
const REQUEST_TIMEOUT_MS = 90000
const MAX_RECENT_IN_PROMPT = 12

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
  const avoid = recent.length ? ` Jangan ulangi atau parafrase soal berikut: ${JSON.stringify(recent.map((text) => text.slice(0, 200)))}.` : ''
  return `Buat tepat ${amount} soal pilihan ganda berbeda untuk jenjang ${config.level}, kelas ${config.grade}, mata pelajaran ${JSON.stringify(subjectName(config))}.${topic ? ` Semua soal harus sesuai dengan topik ${JSON.stringify(topic)}.` : ' Pilih materi yang relevan dengan mata pelajaran dan kelas tersebut.'} Gunakan bahasa Indonesia yang jelas dan sesuai usia. Untuk pelajaran Bahasa Inggris, bahan soal boleh berbahasa Inggris. Setiap soal memiliki tepat empat pilihan yang berbeda, tepat satu jawaban benar dengan indeks answer 0 sampai 3, dan penjelasan singkat yang faktual. Periksa kembali jawaban dan penjelasannya. Variasikan konsep, contoh, konteks, dan posisi jawaban, tetapi jangan keluar dari materi yang dipilih. Ini bagian ${batchNumber} dari paket soal baru.${avoid} Kembalikan hanya JSON sesuai skema.`
}

class UnreadableGroqResponse extends Error {
  constructor() { super('Jawaban Groq belum dapat dibaca. Coba buat soal lagi atau kurangi jumlahnya.') }
}

function friendlyHttpError(status) {
  if (status === 400 || status === 413) return 'Permintaan Groq tidak valid atau terlalu besar. Coba jumlah soal lebih sedikit.'
  if (status === 401 || status === 403) return 'API key Groq ditolak atau tidak memiliki akses. Periksa kembali kuncinya di Groq Console.'
  if (status === 404) return 'Model Groq belum tersedia untuk akun ini. Periksa akses model di Groq Console.'
  if (status === 429) return 'Kuota atau batas penggunaan Groq tercapai. Tunggu sebentar atau kurangi jumlah soal.'
  return 'Groq sedang tidak dapat membuat soal. Periksa koneksi lalu coba lagi.'
}

async function requestBatch(config, apiKey, amount, recent, batchNumber, signal, fetchImpl, random) {
  const body = JSON.stringify({
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: 'Kamu adalah guru Indonesia yang teliti. Buat soal pendidikan yang aman, faktual, sesuai kelas dan mata pelajaran, serta ikuti skema JSON.' },
      { role: 'user', content: makePrompt(config, amount, recent, batchNumber) },
    ],
    temperature: 0.8,
    seed: Math.floor(random() * 2147483647),
    // Leave headroom for the prompt on typical free-plan token-per-minute limits.
    max_completion_tokens: Math.min(6000, 1200 + amount * 300),
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
  if (!response.ok) throw new Error(friendlyHttpError(response.status))
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
export async function generateGroqQuestions(config, apiKey, { onProgress = () => {}, signal, fetchImpl = globalThis.fetch, avoidPrompts = [], random = Math.random } = {}) {
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
  let batch = 0
  let batchSize = BATCH_SIZE
  let stagnant = 0
  onProgress(0, total)
  while (questions.length < total) {
    if (signal?.aborted) throw new DOMException('Dibatalkan', 'AbortError')
    if (batch >= total * 4 + 8) throw new Error('Groq belum menghasilkan cukup soal baru dan berbeda. Coba jumlah lebih sedikit atau topik yang lebih luas.')
    const amount = Math.min(batchSize, total - questions.length)
    const recent = [...previous.slice(-MAX_RECENT_IN_PROMPT), ...questions.slice(-MAX_RECENT_IN_PROMPT).map((question) => question.prompt)].slice(-MAX_RECENT_IN_PROMPT)
    let items
    try {
      items = await requestBatch(config, cleanKey, amount, recent, ++batch, signal, fetchImpl, random)
    } catch (error) {
      // A truncated model response may fit when requested in smaller batches.
      if (error instanceof UnreadableGroqResponse && amount > 1) { batchSize = Math.max(1, Math.floor(amount / 2)); continue }
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
    onProgress(questions.length, total)
    stagnant = questions.length === before ? stagnant + 1 : 0
    if (stagnant >= 3) throw new Error('Groq belum menghasilkan cukup soal baru dan berbeda. Coba jumlah lebih sedikit atau topik yang lebih luas.')
  }
  return questions
}
