import { afterEach, describe, expect, it, vi } from 'vitest'
import { once } from 'node:events'
import { createGroqApp, GROQ_MODEL } from '../server/groq-app.js'
import { CUSTOM_SUBJECT, DEFAULT_CONFIG } from '../src/data/subjects.js'
import { generateGroqQuestions } from '../src/lib/groq.js'

const allowedOrigin = 'https://example.github.io'
const fakeServerKey = 'test-only-secret-not-a-real-key'
const config = { ...DEFAULT_CONFIG, source: 'groq', count: 2 }
const requestBody = { config, amount: 2, recent: [], batchNumber: 1 }
const question = (n) => ({ prompt: `Pertanyaan ${n}?`, options: ['A', 'B', 'C', 'D'], answer: 0, explanation: 'A benar.' })
const completion = (questions) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ questions }) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
const servers = []

async function startApp(options = {}) {
  const app = createGroqApp({ apiKey: fakeServerKey, allowedOrigins: allowedOrigin, production: true, ...options })
  const server = app.listen(0, '127.0.0.1')
  servers.push(server)
  await once(server, 'listening')
  return `http://127.0.0.1:${server.address().port}`
}
function post(base, body = requestBody, origin = allowedOrigin) {
  return fetch(`${base}/api/groq/questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify(body),
  })
}
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

describe('server Groq', () => {
  it('sends a structured request to the selected model while keeping its key on the server', async () => {
    const fetchImpl = vi.fn(async () => completion([{ ...question(1), internal: fakeServerKey }, question(2)]))
    const base = await startApp({ fetchImpl })
    const customConfig = { ...config, subject: CUSTOM_SUBJECT, customSubject: 'Seni Budaya', topic: 'Musik tradisional' }
    const response = await post(base, { ...requestBody, config: customConfig, model: 'some-other-model' })
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe(allowedOrigin)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(result.questions).toEqual([question(1), question(2)])
    expect(JSON.stringify(result)).not.toContain(fakeServerKey)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions')
    expect(options.headers.Authorization).toBe(`Bearer ${fakeServerKey}`)
    const sent = JSON.parse(options.body)
    expect(sent.model).toBe(GROQ_MODEL)
    expect(sent.response_format.type).toBe('json_schema')
    expect(sent.response_format.json_schema.strict).toBe(true)
    expect(sent.messages.at(-1).content).toContain('Seni Budaya')
    expect(sent.messages.at(-1).content).toContain('Musik tradisional')
    expect(sent.max_completion_tokens).toBeLessThan(8000)
    expect(JSON.stringify(sent)).not.toContain(fakeServerKey)
  })

  it('limits CORS to the configured origin, including preflight requests', async () => {
    const base = await startApp({ fetchImpl: vi.fn() })
    const preflight = await fetch(`${base}/api/groq/questions`, { method: 'OPTIONS', headers: { Origin: allowedOrigin, 'Access-Control-Request-Method': 'POST' } })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe(allowedOrigin)
    expect(preflight.headers.get('access-control-expose-headers')).toContain('Retry-After')
    expect((await post(base, requestBody, 'https://untrusted.example')).status).toBe(403)
    expect((await post(base, requestBody, '')).status).toBe(403)
  })

  it('validates request parameters, JSON and body size before contacting Groq', async () => {
    const fetchImpl = vi.fn()
    const base = await startApp({ fetchImpl })
    expect((await post(base, { ...requestBody, amount: 16 })).status).toBe(400)
    expect((await post(base, { ...requestBody, config: { ...config, topic: 'x'.repeat(101) } })).status).toBe(400)
    expect((await post(base, { ...requestBody, config: { ...config, topic: 'a\nb' } })).status).toBe(400)
    expect((await post(base, { ...requestBody, recent: Array(26).fill('old') })).status).toBe(400)
    expect((await fetch(`${base}/api/groq/questions`, { method: 'POST', headers: { Origin: allowedOrigin, 'Content-Type': 'application/json' }, body: '{' })).status).toBe(400)
    expect((await fetch(`${base}/api/groq/questions`, { method: 'POST', headers: { Origin: allowedOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x'.repeat(40000) }) })).status).toBe(413)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reports missing configuration and upstream errors without revealing the key', async () => {
    const fetchImpl = vi.fn()
    const missing = await startApp({ apiKey: '', fetchImpl })
    const missingResponse = await post(missing)
    expect(missingResponse.status).toBe(503)
    expect(fetchImpl).not.toHaveBeenCalled()

    for (const status of [401, 403, 404, 500, 429]) {
      const responseFetch = vi.fn(async () => new Response(fakeServerKey, { status, headers: { 'Retry-After': '5' } }))
      const base = await startApp({ fetchImpl: responseFetch })
      const response = await post(base)
      expect(response.status).toBe(status === 429 ? 429 : 502)
      if (status === 429) expect(response.headers.get('retry-after')).toBe('5')
      expect(await response.text()).not.toContain(fakeServerKey)
    }
    const broken = await startApp({ fetchImpl: vi.fn(async () => new Response('not json', { status: 200 })) })
    expect((await post(broken)).status).toBe(502)
  })

  it('filters invalid model output rather than passing it to the game', async () => {
    const fetchImpl = vi.fn(async () => completion([question(1), { ...question(2), options: ['A', 'A', 'B', 'C'] }]))
    const base = await startApp({ fetchImpl })
    const response = await post(base)
    expect(response.status).toBe(200)
    expect((await response.json()).questions).toEqual([question(1)])
  })

  it('limits concurrent upstream requests and recovers when one finishes', async () => {
    let release
    let started
    const upstreamStarted = new Promise((resolve) => { started = resolve })
    const fetchImpl = vi.fn(async () => {
      started()
      await new Promise((resolve) => { release = resolve })
      return completion([question(1), question(2)])
    })
    const base = await startApp({ fetchImpl, maxConcurrent: 1 })
    const first = post(base)
    await upstreamStarted
    try {
      const busy = await post(base)
      expect(busy.status).toBe(429)
      expect(busy.headers.get('retry-after')).toBe('10')
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    } finally {
      release()
    }
    expect((await first).status).toBe(200)
  })

  it('rate limits requests per IP', async () => {
    const base = await startApp({ rateLimitMax: 2 })
    expect((await post(base, {})).status).toBe(400)
    expect((await post(base, {})).status).toBe(400)
    expect((await post(base, {})).status).toBe(429)
  })
})

describe('klien Groq', () => {
  it('works end-to-end with the HTTP backend and a simulated Groq upstream', async () => {
    let next = 0
    const upstream = vi.fn(async (_url, options) => {
      const prompt = JSON.parse(options.body).messages.at(-1).content
      const amount = Number(prompt.match(/Buat tepat (\d+) soal/)[1])
      return completion(Array.from({ length: amount }, () => question(++next)))
    })
    const base = await startApp({ fetchImpl: upstream })
    const browserFetch = vi.fn((url, options) => fetch(`${base}${url}`, { ...options, headers: { ...options.headers, Origin: allowedOrigin } }))
    const questions = await generateGroqQuestions({ ...config, count: 31 }, { endpoint: '/api/groq/questions', fetchImpl: browserFetch })
    expect(questions).toHaveLength(31)
    expect(upstream).toHaveBeenCalledTimes(3)
    expect(browserFetch).toHaveBeenCalledTimes(3)
    expect(JSON.stringify(browserFetch.mock.calls)).not.toContain(fakeServerKey)
  })

  it('generates 500 unique questions in batches without sending a key', async () => {
    let next = 0
    const fetchImpl = vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body)
      return new Response(JSON.stringify({ questions: Array.from({ length: body.amount }, () => question(++next)) }), { status: 200 })
    })
    const progress = []
    const questions = await generateGroqQuestions({ ...config, count: 500, apiKey: fakeServerKey }, { endpoint: '/api/groq/questions', fetchImpl, onProgress: (done, total) => progress.push([done, total]) })
    expect(questions).toHaveLength(500)
    expect(new Set(questions.map((q) => q.prompt)).size).toBe(500)
    expect(fetchImpl).toHaveBeenCalledTimes(34)
    expect(progress[0]).toEqual([0, 500])
    expect(progress.at(-1)).toEqual([500, 500])
    expect(JSON.parse(fetchImpl.mock.calls.at(-1)[1].body).recent).toHaveLength(25)
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain(fakeServerKey)
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json' })
  })

  it('ignores duplicate and malformed items and fetches replacements', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ questions: [question(1), null, question(1)] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ questions: [question(2)] }), { status: 200 }))
    const questions = await generateGroqQuestions(config, { endpoint: '/api/groq/questions', fetchImpl })
    expect(questions.map((q) => q.prompt)).toEqual(['Pertanyaan 1?', 'Pertanyaan 2?'])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('reports when the server is missing, the key is rejected, or responses remain invalid', async () => {
    await expect(generateGroqQuestions(config, { endpoint: '' })).rejects.toThrow('belum ditautkan')
    const rejected = vi.fn(async () => new Response(JSON.stringify({ error: 'Kunci Groq di server ditolak.' }), { status: 502 }))
    await expect(generateGroqQuestions(config, { endpoint: '/api/groq/questions', fetchImpl: rejected })).rejects.toThrow('ditolak')
    expect(rejected).toHaveBeenCalledTimes(1)
    const invalid = vi.fn(async () => new Response(JSON.stringify({ questions: [null] }), { status: 200 }))
    await expect(generateGroqQuestions(config, { endpoint: '/api/groq/questions', fetchImpl: invalid })).rejects.toThrow('belum menghasilkan cukup')
    expect(invalid).toHaveBeenCalledTimes(3)
  })

  it('retries an upstream rate limit and respects cancellation while waiting', async () => {
    vi.useFakeTimers()
    const limited = () => new Response(JSON.stringify({ error: 'Terlalu banyak permintaan.' }), { status: 429, headers: { 'Retry-After': '1' } })
    const fetchImpl = vi.fn().mockResolvedValueOnce(limited()).mockResolvedValueOnce(new Response(JSON.stringify({ questions: [question(1)] }), { status: 200 }))
    const pending = generateGroqQuestions({ ...config, count: 1 }, { endpoint: '/api/groq/questions', fetchImpl })
    await vi.advanceTimersByTimeAsync(1000)
    expect(await pending).toHaveLength(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    const controller = new AbortController()
    const aborting = generateGroqQuestions(config, { endpoint: '/api/groq/questions', fetchImpl: vi.fn(async () => limited()), signal: controller.signal })
    const rejection = expect(aborting).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await rejection
  })
})
