import { describe, expect, it, vi } from 'vitest'
import { CUSTOM_SUBJECT, DEFAULT_CONFIG, LEVELS } from '../src/data/subjects.js'
import { generateGroqQuestions, GROQ_MODEL, questionFingerprint } from '../src/lib/groq.js'
import { isValidQuestion } from '../src/lib/questions.js'

const fakeKey = 'private-key-for-test-only'
const config = { ...DEFAULT_CONFIG, source: 'groq' }
const makeQuestion = (n) => ({ prompt: `Pertanyaan unik nomor ${n}?`, options: ['Pilihan benar', 'Pilihan B', 'Pilihan C', 'Pilihan D'], answer: 0, explanation: 'Pilihan pertama adalah benar.' })
const reply = (questions, status = 200, headers = {}) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ questions }) } }] }), { status, headers })

function mockGroq() {
  let counter = 0
  return vi.fn(async (_url, request) => {
    const body = JSON.parse(request.body)
    const amount = Number(body.messages[1].content.match(/Buat tepat (\d+) soal/)[1])
    return reply(Array.from({ length: amount }, () => makeQuestion(++counter)))
  })
}

describe('Groq langsung dari browser', () => {
  it('uses the supplied key only in the authorization header and asks for the chosen settings', async () => {
    const fetchImpl = mockGroq()
    const chosen = { ...config, level: 'SMA', grade: 12, subject: CUSTOM_SUBJECT, customSubject: 'Seni Budaya', topic: 'Musik tradisional', count: 1 }
    const questions = await generateGroqQuestions(chosen, `  ${fakeKey}  `, { fetchImpl, random: () => 0.9 })
    expect(questions).toHaveLength(1)
    const [url, request] = fetchImpl.mock.calls[0]
    const body = JSON.parse(request.body)
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions')
    expect(url).not.toContain(fakeKey)
    expect(request.body).not.toContain(fakeKey)
    expect(request.headers.Authorization).toBe(`Bearer ${fakeKey}`)
    expect(request.credentials).toBe('omit')
    expect(request.referrerPolicy).toBe('no-referrer')
    expect(body.model).toBe(GROQ_MODEL)
    expect(body.response_format.json_schema.strict).toBe(true)
    expect(body.response_format.json_schema.schema.additionalProperties).toBe(false)
    expect(body.messages[1].content).toContain('jenjang SMA, kelas 12')
    expect(body.messages[1].content).toContain('Seni Budaya')
    expect(body.messages[1].content).toContain('Musik tradisional')
    expect(isValidQuestion(questions[0])).toBe(true)
    expect(questions[0].options[questions[0].answer]).toBe('Pilihan benar')
  })

  it('includes the selected level, grade, subject and topic for every school grade', async () => {
    const fetchImpl = mockGroq()
    for (const level of LEVELS) for (const grade of level.grades) {
      const subject = level.subjects.at(-1)
      await generateGroqQuestions({ ...config, level: level.id, grade, subject, topic: 'Topik uji', count: 1 }, fakeKey, { fetchImpl })
      const prompt = JSON.parse(fetchImpl.mock.calls.at(-1)[1].body).messages[1].content
      expect(prompt).toContain(`jenjang ${level.id}, kelas ${grade}`)
      expect(prompt).toContain(subject)
      expect(prompt).toContain('Topik uji')
    }
  })

  it('requests 1–500 questions in batches, validates them, and reports progress', async () => {
    const fetchImpl = mockGroq()
    const progress = []
    let n = 0
    const random = () => ((n++ * 41) % 997) / 997
    const questions = await generateGroqQuestions({ ...config, count: 500 }, fakeKey, { fetchImpl, random, onProgress: (done, total) => progress.push([done, total]) })
    expect(questions).toHaveLength(500)
    expect(questions.every(isValidQuestion)).toBe(true)
    expect(new Set(questions.map((item) => questionFingerprint(item.prompt))).size).toBe(500)
    expect(fetchImpl).toHaveBeenCalledTimes(34)
    expect(progress[0]).toEqual([0, 500])
    expect(progress.at(-1)).toEqual([500, 500])
    const bodies = fetchImpl.mock.calls.map(([, request]) => JSON.parse(request.body))
    expect(new Set(bodies.map((body) => body.seed)).size).toBeGreaterThan(1)
    expect(bodies.at(-1).messages[1].content).toContain('Buat tepat 5 soal')
    expect(bodies[1].messages[1].content).toContain('Jangan ulangi')
    expect(questions.every((item) => item.options[item.answer] === 'Pilihan benar')).toBe(true)
  })

  it('avoids recent questions across replay and replaces duplicates within the same quiz', async () => {
    const old = makeQuestion(1)
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(reply([old, { ...old, prompt: 'PERTANYAAN unik nomor 1!' }, makeQuestion(2)]))
      .mockResolvedValueOnce(reply([makeQuestion(2), makeQuestion(3)]))
    const questions = await generateGroqQuestions({ ...config, count: 2 }, fakeKey, { fetchImpl, avoidPrompts: [old.prompt] })
    expect(questions.map((item) => item.prompt)).toEqual([makeQuestion(2).prompt, makeQuestion(3).prompt])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).messages[1].content).toContain(old.prompt)
  })

  it('rejects a missing key, invalid settings, and malformed responses without leaking the key', async () => {
    const fetchImpl = vi.fn()
    await expect(generateGroqQuestions(config, '', { fetchImpl })).rejects.toThrow('API key Groq')
    await expect(generateGroqQuestions({ ...config, count: 501 }, fakeKey, { fetchImpl })).rejects.toThrow('1 dan 500')
    await expect(generateGroqQuestions({ ...config, source: 'bank' }, fakeKey, { fetchImpl })).rejects.toThrow('Sumber soal')
    expect(fetchImpl).not.toHaveBeenCalled()
    const malformed = vi.fn().mockResolvedValue(new Response('{"choices":[]}'))
    await expect(generateGroqQuestions({ ...config, count: 1 }, fakeKey, { fetchImpl: malformed })).rejects.toThrow('belum dapat dibaca')
    const networkError = vi.fn().mockRejectedValue(new Error(`network details with ${fakeKey}`))
    const error = await generateGroqQuestions({ ...config, count: 1 }, fakeKey, { fetchImpl: networkError }).catch((failure) => failure)
    expect(error.message).toContain('Tidak dapat menghubungi Groq')
    expect(error.message).not.toContain(fakeKey)
  })

  it('automatically reduces a batch when Groq returns truncated JSON', async () => {
    const normal = mockGroq()
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"questions":[' } }] })))
      .mockImplementation(normal)
    const questions = await generateGroqQuestions({ ...config, count: 15 }, fakeKey, { fetchImpl })
    expect(questions).toHaveLength(15)
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).messages[1].content).toContain('Buat tepat 15 soal')
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).messages[1].content).toContain('Buat tepat 7 soal')
  })

  it('handles denied keys and rate limits without exposing provider error details', async () => {
    const denied = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: `private details ${fakeKey}` }), { status: 401 }))
    const error = await generateGroqQuestions({ ...config, count: 1 }, fakeKey, { fetchImpl: denied }).catch((failure) => failure)
    expect(error.message).toContain('ditolak')
    expect(error.message).not.toContain(fakeKey)
    const limited = vi.fn().mockResolvedValue(new Response('{}', { status: 429, headers: { 'retry-after': '0.001' } }))
    await expect(generateGroqQuestions({ ...config, count: 1 }, fakeKey, { fetchImpl: limited })).rejects.toThrow('Kuota')
    expect(limited).toHaveBeenCalledTimes(3)
  })

  it('retries transient rate limits, then continues', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'retry-after': '0.001' } }))
      .mockResolvedValueOnce(reply([makeQuestion(1)]))
    const questions = await generateGroqQuestions({ ...config, count: 1 }, fakeKey, { fetchImpl })
    expect(questions).toHaveLength(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('waits for the token window when a browser hides the Retry-After header', async () => {
    vi.useFakeTimers()
    try {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(new Response('{}', { status: 429 }))
        .mockResolvedValueOnce(reply([makeQuestion(1)]))
      const pending = generateGroqQuestions({ ...config, count: 1 }, fakeKey, { fetchImpl })
      await vi.advanceTimersByTimeAsync(14999)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      await expect(pending).resolves.toHaveLength(1)
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
  })

  it('refuses to silently fill a quiz with duplicate or invalid questions', async () => {
    const fetchImpl = vi.fn(async () => reply([null, { ...makeQuestion(1), options: ['same', 'same', 'same', 'same'] }, makeQuestion(1)]))
    await expect(generateGroqQuestions({ ...config, count: 2 }, fakeKey, { fetchImpl })).rejects.toThrow('soal baru dan berbeda')
  })

  it('can abort a pending request and a retry delay', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn((_url, request) => new Promise((_resolve, reject) => {
      request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    const pending = generateGroqQuestions({ ...config, count: 1 }, fakeKey, { fetchImpl, signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    const delayedController = new AbortController()
    const delayed = generateGroqQuestions({ ...config, count: 1 }, fakeKey, { fetchImpl: vi.fn().mockResolvedValue(new Response('{}', { status: 429, headers: { 'retry-after': '60' } })), signal: delayedController.signal })
    await Promise.resolve()
    delayedController.abort()
    await expect(delayed).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('times out a stalled Groq request', async () => {
    vi.useFakeTimers()
    try {
      const fetchImpl = vi.fn((_url, request) => new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      }))
      const pending = generateGroqQuestions({ ...config, count: 1 }, fakeKey, { fetchImpl })
      const assertion = expect(pending).rejects.toThrow('terlalu lama')
      await vi.advanceTimersByTimeAsync(90000)
      await assertion
    } finally { vi.useRealTimers() }
  })
})
