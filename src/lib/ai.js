import { isValidQuestion } from './questions.js'
import { subjectName, validateConfig } from '../data/subjects.js'

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
const BATCH_SIZE = 25

const responseSchema = {
  type: 'OBJECT',
  properties: {
    questions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          prompt: { type: 'STRING' },
          options: { type: 'ARRAY', items: { type: 'STRING' }, minItems: 4, maxItems: 4 },
          answer: { type: 'INTEGER' },
          explanation: { type: 'STRING' },
        },
        required: ['prompt', 'options', 'answer', 'explanation'],
      },
    },
  },
  required: ['questions'],
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Dibatalkan', 'AbortError')); return }
    const timeout = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
    const abort = () => { clearTimeout(timeout); reject(new DOMException('Dibatalkan', 'AbortError')) }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

function friendlyHttpError(status) {
  if (status === 400) return 'Permintaan ke Gemini tidak valid. Coba jumlah soal lebih sedikit atau periksa kunci API.'
  if (status === 401 || status === 403) return 'Kunci Gemini ditolak atau belum memiliki akses. Periksa kunci dan pengaturan Google AI Studio.'
  if (status === 429) return 'Kuota atau batas kecepatan Gemini tercapai. Tunggu sebentar atau coba jumlah soal lebih sedikit.'
  if (status === 404) return 'Model Gemini tidak tersedia untuk kunci ini. Periksa akses model di Google AI Studio.'
  return 'Gemini sedang tidak dapat membuat soal. Periksa koneksi lalu coba lagi.'
}

async function requestBatch(config, apiKey, amount, recent, batchNumber, signal, fetchImpl) {
  const prompt = `Kamu adalah guru Indonesia yang teliti. Buat tepat ${amount} soal pilihan ganda berbeda untuk ${config.level} kelas ${config.grade}, mata pelajaran ${subjectName(config)}.${config.topic?.trim() ? ` Fokuskan soal pada topik: ${config.topic.trim()}.` : ''} Gunakan bahasa Indonesia yang jelas dan tingkat kesulitan yang sesuai kelas. Untuk Bahasa Inggris, boleh gunakan kalimat bahasa Inggris sebagai bahan soal. Setiap soal wajib memiliki tepat empat pilihan jawaban berbeda, hanya satu jawaban yang benar, indeks jawaban benar 0 sampai 3, dan penjelasan singkat yang faktual. Variasikan konsep, konteks, dan posisi jawaban. Jangan sertakan soal yang sama atau hampir sama. Ini bagian ${batchNumber}; buat topik yang bervariasi.${recent.length ? ` Hindari mengulang soal berikut: ${JSON.stringify(recent)}` : ''} Kembalikan JSON sesuai skema.`
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.85, maxOutputTokens: 16384, responseMimeType: 'application/json', responseSchema, thinkingConfig: { thinkingBudget: 0 } },
  })

  let response
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body,
        signal,
      })
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      throw new Error('Tidak dapat menghubungi Gemini. Periksa koneksi internet atau coba lagi.')
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await wait(1200 * (attempt + 1), signal)
      continue
    }
    break
  }
  if (!response.ok) throw new Error(friendlyHttpError(response.status))
  let payload
  try {
    payload = await response.json()
    const text = payload.candidates?.[0]?.content?.parts?.filter((part) => part.text && !part.thought).map((part) => part.text).join('')
    if (!text) throw new Error('empty')
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
    if (!Array.isArray(parsed.questions)) throw new Error('missing')
    return parsed.questions
  } catch {
    throw new Error('Jawaban Gemini tidak dapat dibaca. Coba buat soal lagi.')
  }
}

export async function generateAiQuestions(config, apiKey, { onProgress = () => {}, signal, fetchImpl = globalThis.fetch } = {}) {
  const validation = validateConfig(config)
  if (validation) throw new Error(validation)
  if (!apiKey?.trim()) throw new Error('Masukkan Gemini API key untuk membuat soal AI.')
  if (typeof fetchImpl !== 'function') throw new Error('Browser ini tidak mendukung permintaan ke Gemini.')
  const total = Number(config.count)
  const questions = []
  const seen = new Set()
  let batch = 0
  let stagnantBatches = 0
  onProgress(0, total)
  while (questions.length < total) {
    if (signal?.aborted) throw new DOMException('Dibatalkan', 'AbortError')
    const amount = Math.min(BATCH_SIZE, total - questions.length)
    const recent = questions.slice(-25).map((item) => item.prompt)
    const batchQuestions = await requestBatch(config, apiKey.trim(), amount, recent, ++batch, signal, fetchImpl)
    const before = questions.length
    for (const item of batchQuestions) {
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
    stagnantBatches = questions.length === before ? stagnantBatches + 1 : 0
    if (stagnantBatches >= 3 || batch > Math.ceil(total / BATCH_SIZE) * 3 + 3) {
      throw new Error('Gemini belum menghasilkan cukup soal yang berbeda. Coba lagi dengan jumlah soal lebih sedikit.')
    }
  }
  return questions
}
