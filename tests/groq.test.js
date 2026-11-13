import { describe, expect, it, vi } from 'vitest'
import { CUSTOM_SUBJECT, DEFAULT_CONFIG, gradeLabel, LEVELS } from '../src/data/subjects.js'
import { generateBuzzerQuestions, generateGroqQuestions, GROQ_MODEL, GROQ_SCHEMA_STRICT, hasUnexpectedEnglish, promptsAreTooSimilar, questionFingerprint, requiresIndonesian } from '../src/lib/groq.js'
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
    // GPT-OSS only accepts Groq's best-effort schema mode; local validation
    // below protects the question shape and avoids a provider-side 400.
    expect(body.response_format.json_schema.strict).toBe(GROQ_SCHEMA_STRICT)
    expect(body.response_format.json_schema.strict).toBe(false)
    expect(body.response_format.json_schema.schema.additionalProperties).toBe(false)
    expect(body.messages[1].content).toContain('jenjang SMA / Sederajat, kelas 12')
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
      expect(prompt).toContain(`jenjang ${level.label}`)
      const expectedGrade = gradeLabel({ level: level.id, grade })
      expect(prompt).toContain(expectedGrade.startsWith('Kelas') ? expectedGrade.toLowerCase() : expectedGrade)
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
    expect(fetchImpl).toHaveBeenCalledTimes(63)
    expect(progress[0]).toEqual([0, 500])
    expect(progress.at(-1)).toEqual([500, 500])
    const bodies = fetchImpl.mock.calls.map(([, request]) => JSON.parse(request.body))
    expect(new Set(bodies.map((body) => body.seed)).size).toBeGreaterThan(1)
    expect(bodies.at(-1).messages[1].content).toContain('Buat tepat 4 soal')
    expect(bodies.every((body) => body.max_completion_tokens <= 3200)).toBe(true)
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

  it('replaces duplicate/paraphrased and unwanted English AI questions with Indonesian questions', async () => {
    const english = {
      prompt: 'What is the capital city of Indonesia?',
      options: ['Jakarta', 'Bandung', 'Surabaya', 'Medan'], answer: 0,
      explanation: 'The correct answer is Jakarta.',
    }
    const capital = {
      prompt: 'Apa ibu kota Indonesia?',
      options: ['Jakarta', 'Bandung', 'Surabaya', 'Medan'], answer: 0,
      explanation: 'Ibu kota Indonesia adalah Jakarta.',
    }
    const paraphrase = {
      prompt: 'Sebutkan ibu kota Indonesia.',
      options: ['Jakarta', 'Bandung', 'Surabaya', 'Medan'], answer: 0,
      explanation: 'Ibu kota Indonesia adalah Jakarta.',
    }
    const anthem = {
      prompt: 'Siapa pencipta lagu Indonesia Raya?',
      options: ['W.R. Supratman', 'Ki Hajar Dewantara', 'Ismail Marzuki', 'Ibu Sud'], answer: 0,
      explanation: 'Indonesia Raya diciptakan oleh W.R. Supratman.',
    }
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(reply([english, capital]))
      .mockResolvedValueOnce(reply([paraphrase, anthem]))
    const questions = await generateGroqQuestions({ ...config, count: 2 }, fakeKey, { fetchImpl })
    expect(questions.map((question) => question.prompt)).toEqual([capital.prompt, anthem.prompt])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).messages[1].content).toContain('WAJIB tulis')
    expect(hasUnexpectedEnglish(english)).toBe(true)
    expect(promptsAreTooSimilar(capital.prompt, paraphrase.prompt)).toBe(true)
    expect(requiresIndonesian({ subject: 'Matematika' })).toBe(true)
    expect(requiresIndonesian({ subject: 'Bahasa Inggris' })).toBe(false)
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
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).messages[1].content).toContain('Buat tepat 8 soal')
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).messages[1].content).toContain('Buat tepat 4 soal')
  })

  it.each([50, 100, 500])('splits oversized requests automatically for %i questions', async (count) => {
    let next = 0
    const fetchImpl = vi.fn(async (_url, request) => {
      const body = JSON.parse(request.body)
      const amount = Number(body.messages[1].content.match(/Buat tepat (\d+) soal/)[1])
      if (amount > 4) return new Response('{"error":{"message":"Request too large"}}', { status: 413 })
      return reply(Array.from({ length: amount }, () => makeQuestion(++next)))
    })
    const questions = await generateGroqQuestions({ ...config, count }, fakeKey, { fetchImpl })
    expect(questions).toHaveLength(count)
    expect(questions.every(isValidQuestion)).toBe(true)
    expect(new Set(questions.map((q) => q.prompt)).size).toBe(count)
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).max_completion_tokens).toBe(3200)
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).max_completion_tokens).toBe(2100)
  })

  it('shrinks an oversized one-question prompt and token budget without exposing provider details', async () => {
    const fetchImpl = vi.fn(async (_url, request) => {
      const body = JSON.parse(request.body)
      if (body.messages[1].content.includes('Jangan ulangi')) return new Response(JSON.stringify({ error: { message: `maximum context length ${fakeKey}` } }), { status: 400 })
      if (body.max_completion_tokens > 700) return new Response('{}', { status: 413 })
      return reply([makeQuestion(9)])
    })
    const questions = await generateGroqQuestions({ ...config, count: 1 }, fakeKey, { fetchImpl, avoidPrompts: ['Pertanyaan sebelumnya'] })
    expect(questions).toHaveLength(1)
    const bodies = fetchImpl.mock.calls.map(([, request]) => JSON.parse(request.body))
    expect(bodies[0].messages[1].content).toContain('Jangan ulangi')
    expect(bodies.at(-1).messages[1].content).not.toContain('Jangan ulangi')
    expect(bodies.at(-1).max_completion_tokens).toBeLessThanOrEqual(700)
    const alwaysTooLarge = vi.fn().mockResolvedValue(new Response(`{\"error\":\"${fakeKey}\"}`, { status: 413 }))
    const error = await generateGroqQuestions({ ...config, count: 1 }, fakeKey, { fetchImpl: alwaysTooLarge }).catch((failure) => failure)
    expect(error.message).toContain('Batas token')
    expect(error.message).not.toContain(fakeKey)
  })

  it('can resume valid completed batches after a failure without requesting them again', async () => {
    let checkpoint = []
    const failed = vi.fn().mockResolvedValueOnce(reply(Array.from({ length: 8 }, (_, index) => makeQuestion(index + 1))))
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
    await expect(generateGroqQuestions({ ...config, count: 10 }, fakeKey, { fetchImpl: failed, onCheckpoint: (items) => { checkpoint = items } })).rejects.toThrow('ditolak')
    expect(checkpoint).toHaveLength(8)
    const resumed = vi.fn().mockResolvedValue(reply([makeQuestion(9), makeQuestion(10)]))
    const progress = []
    const result = await generateGroqQuestions({ ...config, count: 10 }, fakeKey, { fetchImpl: resumed, initialQuestions: checkpoint, onProgress: (done) => progress.push(done) })
    expect(result).toHaveLength(10)
    expect(resumed).toHaveBeenCalledTimes(1)
    expect(JSON.parse(resumed.mock.calls[0][1].body).messages[1].content).toContain('Buat tepat 2 soal')
    expect(progress[0]).toBe(8)
  })

  it('handles denied keys and rate limits without exposing provider error details', async () => {
    const denied = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: `private details ${fakeKey}` }), { status: 401 }))
    const error = await generateGroqQuestions({ ...config, count: 1 }, fakeKey, { fetchImpl: denied }).catch((failure) => failure)
    expect(error.message).toContain('ditolak')
    expect(error.message).not.toContain(fakeKey)
    const limited = vi.fn().mockResolvedValue(new Response('{}', { status: 429, headers: { 'retry-after': '0.001' } }))
    await expect(generateGroqQuestions({ ...config, count: 1 }, fakeKey, { fetchImpl: limited })).rejects.toThrow('kuota')
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

describe('Groq untuk mode Siapa Cepat Dia Menjawab', () => {
  it('membuat soal sesuai kategori/metode, menyertakan jawaban natural, dan key hanya di header', async () => {
    const raw = {
      questions: [
        { prompt: 'Siapa presiden pertama Indonesia?', kind: 'mc', options: ['Soekarno', 'Soehatto', 'Hatta', 'Yudhoyono'], answerIndex: 0, answerText: 'Soekarno', accepted: [], naturalAnswer: 'Soekarno', explanation: 'Presiden pertama.' },
        { prompt: 'Berapa 9 x 9?', kind: 'typing', options: ['', '', '', ''], answerIndex: 0, answerText: '81', accepted: ['81', 'delapan puluh satu'], naturalAnswer: 'kalau nggak salah sih 81', explanation: '9 x 9 = 81.' },
      ],
    }
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ choices: [{ message: { content: JSON.stringify(raw) } }] }) }))
    const questions = await generateBuzzerQuestions({ category: 'Pengetahuan Umum', method: 'random', count: 2 }, `  ${fakeKey}  `, { fetchImpl, random: () => 0.5 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, request] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions')
    expect(request.headers.Authorization).toBe(`Bearer ${fakeKey}`)
    expect(request.body).not.toContain(fakeKey)
    expect(request.body).toContain('Pengetahuan Umum')
    expect(request.body).toContain('campurkan soal pilihan ganda')
    expect(questions).toHaveLength(2)
    expect(questions[0].kind).toBe('mc')
    expect(questions[1].naturalAnswer).toContain('81')
    expect(questions[1].accepted).toContain('81')
  })

  it('menyaring soal buzzer berbahasa Inggris dan parafrase yang sama lalu meminta pengganti', async () => {
    const english = { prompt: 'What is three plus four?', kind: 'mc', options: ['7', '6', '8', '9'], answerIndex: 0, answerText: '7', accepted: [], naturalAnswer: '7', explanation: 'The answer is seven.' }
    const capital = { prompt: 'Apa ibu kota Indonesia?', kind: 'mc', options: ['Jakarta', 'Bandung', 'Surabaya', 'Medan'], answerIndex: 0, answerText: 'Jakarta', accepted: [], naturalAnswer: 'Jakarta', explanation: 'Ibu kota Indonesia adalah Jakarta.' }
    const paraphrase = { ...capital, prompt: 'Sebutkan ibu kota Indonesia.' }
    const anthem = { prompt: 'Siapa pencipta lagu Indonesia Raya?', kind: 'mc', options: ['W.R. Supratman', 'Ki Hajar Dewantara', 'Ismail Marzuki', 'Ibu Sud'], answerIndex: 0, answerText: 'W.R. Supratman', accepted: [], naturalAnswer: 'W.R. Supratman', explanation: 'Indonesia Raya diciptakan oleh W.R. Supratman.' }
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(reply([english, capital]))
      .mockResolvedValueOnce(reply([paraphrase, anthem]))
    const questions = await generateBuzzerQuestions({ category: 'Pengetahuan Umum', method: 'mc', count: 2 }, fakeKey, { fetchImpl })
    expect(questions.map((question) => question.prompt)).toEqual([capital.prompt, anthem.prompt])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const firstBody = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(firstBody.response_format.json_schema.strict).toBe(false)
    expect(firstBody.messages[1].content).toContain('WAJIB tulis')
  })

  it('menolak key kosong dan respons rusak tanpa membocorkan key', async () => {
    await expect(generateBuzzerQuestions({ category: 'IPA', method: 'mc', count: 2 }, '', { fetchImpl: vi.fn() })).rejects.toThrow(/API key/)
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ choices: [{ message: { content: 'bukan json' } }] }) }))
    const failure = await generateBuzzerQuestions({ category: 'IPA', method: 'mc', count: 1 }, fakeKey, { fetchImpl }).then(() => null, (error) => error)
    expect(failure.message).toMatch(/belum dapat dibaca/)
    expect(failure.message).not.toContain(fakeKey)
  })
})
