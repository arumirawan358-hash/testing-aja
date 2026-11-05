import { isValidQuestion } from '../src/lib/questions.js'

// Run on GitHub Actions or another machine that can reach the deployed backend.
// GROQ_API_URL is public; this script never needs or reads a Groq API key.
const base = (process.env.GROQ_API_URL || '').trim().replace(/\/+$/, '')
const origin = 'https://arumirawan358-hash.github.io'
let url
try {
  url = new URL(base)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error()
} catch {
  console.error('Isi repository variable GROQ_API_URL dengan URL HTTPS backend terlebih dahulu.')
  process.exit(1)
}

try {
  const response = await fetch(`${base}/api/groq/questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      config: { level: 'SD', grade: 4, subject: 'Matematika', customSubject: '', topic: 'penjumlahan', count: 1, source: 'groq' },
      amount: 1,
      recent: [],
      batchNumber: 1,
    }),
    signal: AbortSignal.timeout(120000),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Server mengembalikan status ${response.status}: ${payload.error || 'tidak ada rincian'}`)
  if (response.headers.get('access-control-allow-origin') !== origin) throw new Error('Origin GitHub Pages belum diizinkan oleh server.')
  if (!Array.isArray(payload.questions) || payload.questions.length !== 1 || !isValidQuestion(payload.questions[0])) throw new Error('Respons Groq tidak berisi satu soal yang valid.')
  console.log('Berhasil: server menghasilkan satu soal Groq dengan format valid.')
  console.log(`Contoh pertanyaan: ${payload.questions[0].prompt.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 250)}`)
} catch (error) {
  console.error(`Uji Groq gagal: ${error.message}`)
  process.exitCode = 1
}
