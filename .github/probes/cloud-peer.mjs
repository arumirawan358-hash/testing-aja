import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname
  if (!pathname.startsWith('/testing-aja/')) { response.writeHead(404).end(); return }
  const relative = pathname.slice('/testing-aja/'.length) || 'index.html'
  try {
    const file = await readFile(join(process.cwd(), 'dist', relative))
    response.writeHead(200, { 'content-type': mime[extname(relative)] || 'application/octet-stream' }).end(file)
  } catch { response.writeHead(404).end() }
})
let browser, host, guest
let stage = 'server'
const networkFailures = []
const errors = []
try {
  await new Promise((resolve) => server.listen(4173, '127.0.0.1', resolve))
  stage = 'launch browser'
  browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] })
  const hostContext = await browser.newContext(), guestContext = await browser.newContext()
  let hostCalls = 0, guestCalls = 0, question = 0
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
  host = await hostContext.newPage(); guest = await guestContext.newPage()
  for (const page of [host, guest]) {
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('requestfailed', (request) => { if (request.url().includes('peerjs.com')) networkFailures.push(`request: ${request.failure()?.errorText}`) })
    page.on('websocket', (socket) => {
      if (!socket.url().includes('peerjs.com')) return
      socket.on('socketerror', (error) => networkFailures.push(`websocket: ${error}`))
      socket.on('close', () => networkFailures.push('websocket closed'))
    })
  }
  stage = 'open pages'
  await Promise.all([host.goto('http://127.0.0.1:4173/testing-aja/'), guest.goto('http://127.0.0.1:4173/testing-aja/')])
  await host.getByLabel('Nama panggilan pembuat ruang').fill('Bintang')
  await host.getByRole('spinbutton').fill('50')
  await host.getByPlaceholder('Masukkan API key Groq').fill('mock-key-not-a-credential')
  stage = 'host creates room'
  await host.getByRole('button', { name: 'Buat ruang' }).click()
  await host.locator('.room-code').waitFor()
  stage = 'host signaling'
  await host.waitForFunction(() => { const button = document.querySelector('.room-code-actions button'); return button && !button.disabled }, null, { timeout: 45000 })
  const code = (await host.locator('.room-code').getAttribute('aria-label')).match(/[A-Z0-9]{6}$/)[0]
  await guest.getByLabel('Nama panggilan untuk bergabung').fill('Mentari')
  await guest.getByLabel('Kode ruang').fill(code)
  stage = 'guest joins'
  await guest.getByRole('button', { name: 'Gabung ruang' }).click()
  await host.waitForFunction(() => { const button = document.querySelector('.lobby-start'); return button && !button.disabled }, null, { timeout: 45000 })
  stage = 'generate and transfer'
  await host.getByRole('button', { name: 'Mulai permainan' }).click()
  await Promise.all([host.locator('.question-card').waitFor({ timeout: 60000 }), guest.locator('.question-card').waitFor({ timeout: 60000 })])
  assert.equal(hostCalls, 14)
  assert.equal(guestCalls, 0)
  assert.equal(question, 50)
  assert.equal(await host.locator('.question-card h2').innerText(), await guest.locator('.question-card h2').innerText())
  assert.deepEqual(await host.locator('.answer-text').allTextContents(), await guest.locator('.answer-text').allTextContents())
  assert.deepEqual(errors, [])
  console.log('PeerJS Cloud signaling + WebRTC + 50-question 413 fallback: PASS (Groq mocked)')
} catch (error) {
  const messages = async (page) => page ? page.locator('[role="alert"]').allTextContents().catch(() => []) : []
  const detail = JSON.stringify({ stage, error: String(error.message).split('\n')[0], hostAlerts: await messages(host), guestAlerts: await messages(guest), networkFailures, errors })
  console.log(`::error title=Cloud peer diagnostic::${detail.replaceAll('%', '%25').replaceAll('\n', '%0A').replaceAll('\r', '%0D')}`)
  throw error
} finally {
  await browser?.close()
  server.close()
}
