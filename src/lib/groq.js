import { CUSTOM_SUBJECT, validateConfig } from '../data/subjects.js'
import { isValidQuestion } from './questions.js'

const BATCH_SIZE = 15

// Only a backend URL is public; the actual GROQ_API_KEY is never sent to the browser.
export function groqEndpoint() {
  const base = (import.meta.env.VITE_GROQ_API_URL || '').trim().replace(/\/+$/, '')
  if (!base) return import.meta.env.DEV ? '/api/groq/questions' : ''
  if (base.startsWith('/') && !base.startsWith('//')) return `${base}/api/groq/questions`
  try {
    const url = new URL(base)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return ''
    return `${url.toString().replace(/\/+$/, '')}/api/groq/questions`
  } catch { return '' }
}

export function isGroqConfigured() {
  return Boolean(groqEndpoint())
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Dibatalkan', 'AbortError')); return }
    const timeout = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
    const abort = () => { clearTimeout(timeout); reject(new DOMException('Dibatalkan', 'AbortError')) }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

async function fetchBatch(endpoint, config, amount, recent, batchNumber, signal, fetchImpl) {
  let response
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config, amount, recent, batchNumber }),
        signal,
      })
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      throw new Error('Server Groq tidak dapat dihubungi. Periksa koneksi atau hubungi pengelola situs.')
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 2 && ![502, 503].includes(response.status)) {
      const retrySeconds = Number(response.headers?.get?.('retry-after'))
      await wait(retrySeconds > 0 ? Math.min(retrySeconds, 60) * 1000 : 1500 * (attempt + 1), signal)
      continue
    }
    break
  }
  if (!response.ok) {
    let message = ''
    try { message = (await response.json())?.error || '' } catch { /* use generic message */ }
    if (response.status === 429) throw new Error(message || 'Batas penggunaan Groq tercapai. Coba lagi nanti.')
    if (response.status === 503) throw new Error(message || 'Groq belum dikonfigurasi di server.')
    if (response.status === 502) throw new Error(message || 'Groq belum bisa membuat soal. Coba lagi.')
    throw new Error('Server Groq belum bisa menyiapkan soal. Coba lagi nanti.')
  }
  let payload
  try { payload = await response.json() } catch { throw new Error('Jawaban dari server AI tidak dapat dibaca.') }
  if (!Array.isArray(payload.questions)) throw new Error('Jawaban dari server AI belum lengkap.')
  return payload.questions
}

export async function generateGroqQuestions(config, { onProgress = () => {}, signal, fetchImpl = globalThis.fetch, endpoint = groqEndpoint() } = {}) {
  const error = validateConfig(config)
  if (error) throw new Error(error)
  if (config.source !== 'groq') throw new Error('Sumber soal Groq tidak valid.')
  if (!endpoint) throw new Error('Server Groq belum ditautkan. Hubungi pengelola situs.')
  if (typeof fetchImpl !== 'function') throw new Error('Browser ini tidak mendukung permintaan ke server AI.')
  const total = Number(config.count)
  // Send only quiz settings; never forward extra fields that may contain credentials.
  const quizConfig = {
    level: config.level,
    grade: Number(config.grade),
    subject: config.subject,
    customSubject: config.subject === CUSTOM_SUBJECT ? config.customSubject : '',
    topic: config.topic || '',
    count: total,
    source: 'groq',
  }
  const questions = []
  const seen = new Set()
  let batch = 0
  let stagnant = 0
  onProgress(0, total)
  while (questions.length < total) {
    if (signal?.aborted) throw new DOMException('Dibatalkan', 'AbortError')
    const amount = Math.min(BATCH_SIZE, total - questions.length)
    const recent = questions.slice(-25).map((question) => question.prompt.slice(0, 240))
    const items = await fetchBatch(endpoint, quizConfig, amount, recent, ++batch, signal, fetchImpl)
    const before = questions.length
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const question = {
        prompt: typeof item.prompt === 'string' ? item.prompt.trim() : '',
        options: Array.isArray(item.options) ? item.options.map((option) => typeof option === 'string' ? option.trim() : '') : [],
        answer: item.answer,
        explanation: typeof item.explanation === 'string' ? item.explanation.trim() : '',
      }
      const fingerprint = question.prompt.toLocaleLowerCase('id-ID').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
      if (!isValidQuestion(question) || seen.has(fingerprint)) continue
      seen.add(fingerprint)
      questions.push({ ...question, id: `q-${questions.length + 1}` })
      if (questions.length === total) break
    }
    onProgress(questions.length, total)
    stagnant = questions.length === before ? stagnant + 1 : 0
    if (stagnant >= 3 || batch > Math.ceil(total / BATCH_SIZE) * 3 + 3) throw new Error('Groq belum menghasilkan cukup soal berbeda. Coba jumlah lebih sedikit.')
  }
  return questions
}
