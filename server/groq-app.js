import express from 'express'
import rateLimit from 'express-rate-limit'
import { subjectName, validateConfig } from '../src/data/subjects.js'
import { isValidQuestion } from '../src/lib/questions.js'

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
export const GROQ_MODEL = 'openai/gpt-oss-120b'
const MAX_BATCH = 15
const MAX_RECENT = 25
const MAX_RECENT_LENGTH = 240

// Even with structured output, validate each question before sending it to players.
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

function cleanQuestion(question) {
  if (!question || typeof question !== 'object') return null
  const value = {
    prompt: typeof question.prompt === 'string' ? question.prompt.trim() : '',
    options: Array.isArray(question.options) ? question.options.map((option) => typeof option === 'string' ? option.trim() : '') : [],
    answer: question.answer,
    explanation: typeof question.explanation === 'string' ? question.explanation.trim() : '',
  }
  return isValidQuestion(value) ? value : null
}

function parseRequest(body) {
  if (!body || typeof body !== 'object' || !body.config || typeof body.config !== 'object') return null
  const config = {
    level: body.config.level,
    grade: Number(body.config.grade),
    subject: body.config.subject,
    customSubject: body.config.customSubject || '',
    topic: body.config.topic || '',
    count: Number(body.config.count),
    source: 'groq',
  }
  const amount = Number(body.amount)
  const batchNumber = Number(body.batchNumber)
  const recent = body.recent ?? []
  if (validateConfig(config) || !Number.isInteger(amount) || amount < 1 || amount > MAX_BATCH || amount > config.count || !Number.isInteger(batchNumber) || batchNumber < 1 || batchNumber > 200) return null
  if (!Array.isArray(recent) || recent.length > MAX_RECENT || recent.some((text) => typeof text !== 'string' || text.length > MAX_RECENT_LENGTH)) return null
  if ([subjectName(config), config.topic].some((value) => /[\u0000-\u001f\u007f]/.test(value))) return null
  return { config, amount, recent, batchNumber }
}

function promptFor({ config, amount, recent, batchNumber }) {
  const topic = config.topic?.trim() ? ` Fokuskan pada topik: ${config.topic.trim()}.` : ''
  const avoid = recent.length ? ` Hindari mengulang pertanyaan ini: ${JSON.stringify(recent)}.` : ''
  return `Buat tepat ${amount} soal pilihan ganda yang berbeda untuk ${config.level} kelas ${config.grade}, mata pelajaran ${subjectName(config)}.${topic} Gunakan bahasa Indonesia yang jelas dan sesuai usia. Untuk pelajaran Bahasa Inggris, kalimat bahasa Inggris boleh digunakan. Setiap soal harus memiliki tepat empat pilihan berbeda, tepat satu jawaban benar dengan indeks answer 0 sampai 3, serta penjelasan yang singkat dan faktual. Variasikan konsep, contoh, dan posisi jawaban. Ini bagian ${batchNumber}.${avoid} Kembalikan JSON sesuai skema.`
}

/** The key stays in this server process and is never returned to the browser. */
export function createGroqApp({
  apiKey = process.env.GROQ_API_KEY || '',
  model = process.env.GROQ_MODEL || GROQ_MODEL,
  allowedOrigins = process.env.ALLOWED_ORIGINS || 'https://arumirawan358-hash.github.io',
  production = process.env.NODE_ENV === 'production',
  trustProxy = process.env.TRUST_PROXY === '1',
  fetchImpl = globalThis.fetch,
  rateLimitMax = 80,
  maxConcurrent = 3,
} = {}) {
  const app = express()
  const origins = new Set(allowedOrigins.split(',').map((origin) => origin.trim()).filter(Boolean))
  let activeRequests = 0
  app.disable('x-powered-by')
  if (trustProxy) app.set('trust proxy', 1)

  app.use((req, res, next) => {
    const origin = req.headers.origin
    const localOrigin = !production && origin && (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || /^https:\/\/\d+-[a-z0-9-]+\.e2b\.app$/.test(origin))
    if (origin && !origins.has(origin) && !localOrigin) return res.status(403).json({ error: 'Asal permintaan tidak diizinkan.' })
    if (production && !origin && req.method !== 'GET') return res.status(403).json({ error: 'Asal permintaan diperlukan.' })
    if (origin) {
      res.set('Access-Control-Allow-Origin', origin)
      res.set('Access-Control-Expose-Headers', 'Retry-After')
      res.vary('Origin')
    }
    res.set('Cache-Control', 'no-store')
    res.set('X-Content-Type-Options', 'nosniff')
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.set('Access-Control-Allow-Headers', 'Content-Type')
      res.set('Access-Control-Max-Age', '600')
      return res.sendStatus(204)
    }
    return next()
  })

  app.get('/health', (_req, res) => res.json({ ok: true }))
  app.use('/api/groq', rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Terlalu banyak permintaan. Tunggu beberapa menit dan coba lagi.' },
  }))
  app.use(express.json({ limit: '32kb', strict: true }))

  app.post('/api/groq/questions', async (req, res) => {
    const request = parseRequest(req.body)
    if (!request) return res.status(400).json({ error: 'Pengaturan soal tidak valid.' })
    if (!apiKey.trim()) return res.status(503).json({ error: 'Groq belum dikonfigurasi di server. Hubungi pengelola situs.' })
    if (activeRequests >= maxConcurrent) {
      res.set('Retry-After', '10')
      return res.status(429).json({ error: 'Server AI sedang sibuk. Coba lagi sebentar lagi.' })
    }

    activeRequests += 1
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 90000)
    const abortIfClosed = () => { if (!res.writableEnded) controller.abort() }
    res.once('close', abortIfClosed)
    try {
      const upstream = await fetchImpl(GROQ_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'Kamu adalah guru Indonesia yang teliti. Buat soal pendidikan yang aman, faktual, dan sesuai kelas. Ikuti skema JSON dan jangan sertakan data rahasia.' },
            { role: 'user', content: promptFor(request) },
          ],
          temperature: 0.7,
          // Keep the per-request cap below typical free-plan token-per-minute limits.
          max_completion_tokens: Math.min(6000, 1200 + request.amount * 300),
          reasoning_effort: 'medium',
          response_format: { type: 'json_schema', json_schema: { name: 'quiz_questions', strict: true, schema: quizSchema } },
        }),
        signal: controller.signal,
      })
      if (!upstream.ok) {
        if (upstream.status === 429) {
          const retry = Math.min(60, Math.max(1, Number(upstream.headers?.get?.('retry-after')) || 15))
          res.set('Retry-After', String(retry))
          return res.status(429).json({ error: 'Batas penggunaan Groq tercapai. Tunggu sebentar lalu coba lagi.' })
        }
        if (upstream.status === 401 || upstream.status === 403) return res.status(502).json({ error: 'Kunci Groq di server ditolak. Hubungi pengelola situs.' })
        if (upstream.status === 404) return res.status(502).json({ error: 'Model Groq belum tersedia untuk server ini.' })
        return res.status(502).json({ error: 'Groq sedang tidak dapat menyiapkan soal. Coba lagi.' })
      }
      const data = await upstream.json()
      const text = data?.choices?.[0]?.message?.content
      if (typeof text !== 'string' || text.length > 200000) throw new Error('invalid response')
      const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
      if (!Array.isArray(parsed.questions)) throw new Error('invalid response')
      const questions = parsed.questions.slice(0, request.amount).map(cleanQuestion).filter(Boolean)
      if (!questions.length) throw new Error('invalid response')
      return res.json({ questions })
    } catch {
      if (!res.headersSent && !res.destroyed) return res.status(502).json({ error: 'Server tidak dapat menghubungi Groq atau jawaban AI belum valid. Coba lagi.' })
      return undefined
    } finally {
      activeRequests -= 1
      clearTimeout(timeout)
      res.removeListener('close', abortIfClosed)
    }
  })

  app.use((error, _req, res, _next) => {
    if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'Permintaan terlalu besar.' })
    if (error instanceof SyntaxError) return res.status(400).json({ error: 'Permintaan tidak valid.' })
    return res.status(500).json({ error: 'Server sedang bermasalah.' })
  })
  return app
}
