import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const server = spawn('npm', ['run', 'preview'], { env: { ...process.env, VITE_BASE_PATH: '/testing-aja/' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
let logs = ''
let browser
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Preview did not start: ${logs}`)), 30000)
    const output = (data) => {
      logs += String(data)
      if (logs.includes('Local:')) { clearTimeout(timer); resolve() }
    }
    server.stdout.on('data', output)
    server.stderr.on('data', output)
    server.on('exit', (code) => { clearTimeout(timer); reject(new Error(`Preview exited ${code}: ${logs}`)) })
  })
  browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] })
  const hostContext = await browser.newContext(), guestContext = await browser.newContext()
  let hostCalls = 0, guestCalls = 0, question = 0
  const errors = []
  for (const [side, context] of [['host', hostContext], ['guest', guestContext]]) {
    await context.route('https://api.groq.com/**', async (route) => {
      const request = route.request()
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type', 'content-type': 'application/json' }
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      if (side === 'host') hostCalls += 1
      else guestCalls += 1
      const body = JSON.parse(request.postData())
      const amount = Number(body.messages[1].content.match(/Buat tepat (\d+) soal/)[1])
      if (amount > 4) return route.fulfill({ status: 413, headers, body: '{}' })
      const questions = Array.from({ length: amount }, () => {
        const n = ++question
        return { prompt: `Soal cloud ${n}. ${'Materi belajar bersama. '.repeat(45)}`, options: [`Benar ${n}`, `Salah A ${n}`, `Salah B ${n}`, `Salah C ${n}`], answer: 0, explanation: `Penjelasan soal ${n}.` }
      })
      return route.fulfill({ status: 200, headers, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ questions }) } }] }) })
    })
  }
  const host = await hostContext.newPage(), guest = await guestContext.newPage()
  for (const page of [host, guest]) page.on('pageerror', (error) => errors.push(error.message))
  await Promise.all([host.goto('http://127.0.0.1:4173/testing-aja/'), guest.goto('http://127.0.0.1:4173/testing-aja/')])
  await host.getByLabel('Nama panggilan pembuat ruang').fill('Bintang')
  await host.getByRole('spinbutton').fill('50')
  await host.getByPlaceholder('Masukkan API key Groq').fill('mock-key-not-a-credential')
  await host.getByRole('button', { name: 'Buat ruang' }).click()
  await host.locator('.room-code').waitFor()
  const code = (await host.locator('.room-code').getAttribute('aria-label')).match(/[A-Z0-9]{6}$/)[0]
  await guest.getByLabel('Nama panggilan untuk bergabung').fill('Mentari')
  await guest.getByLabel('Kode ruang').fill(code)
  await guest.getByRole('button', { name: 'Gabung ruang' }).click()
  await host.waitForFunction(() => !document.querySelector('.lobby-start')?.disabled, null, { timeout: 45000 })
  await host.getByRole('button', { name: 'Mulai permainan' }).click()
  await Promise.all([host.locator('.question-card').waitFor({ timeout: 60000 }), guest.locator('.question-card').waitFor({ timeout: 60000 })])
  assert.equal(hostCalls, 14)
  assert.equal(guestCalls, 0)
  assert.equal(question, 50)
  assert.equal(await host.locator('.question-card h2').innerText(), await guest.locator('.question-card h2').innerText())
  assert.deepEqual(await host.locator('.answer-text').allTextContents(), await guest.locator('.answer-text').allTextContents())
  assert.deepEqual(errors, [])
  console.log('PeerJS Cloud signaling + WebRTC + 50-question 413 fallback: PASS (Groq mocked)')
} finally {
  await browser?.close()
  try { process.kill(-server.pid, 'SIGTERM') } catch { /* process already exited */ }
}
