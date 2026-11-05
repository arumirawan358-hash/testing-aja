import 'dotenv/config'
import { createGroqApp } from './groq-app.js'

const port = Number(process.env.GROQ_PORT || process.env.PORT || 9002)
const host = process.env.HOST || '0.0.0.0'
const app = createGroqApp()
const server = app.listen(port, host, () => {
  console.log(`Server AI KuisKita siap di port ${port}.`)
  if (!process.env.GROQ_API_KEY) console.log('GROQ_API_KEY belum disetel; mode bank soal dan Gemini tetap dapat digunakan.')
})

server.on('error', (error) => {
  console.error('Server AI tidak dapat dijalankan:', error.code || 'kesalahan server')
  process.exitCode = 1
})
process.on('SIGTERM', () => server.close())
