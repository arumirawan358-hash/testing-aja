import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG } from '../src/data/subjects.js'
import { generateAiQuestions } from '../src/lib/ai.js'

function mockGemini() {
  let number = 0
  return vi.fn(async (_url, request) => {
    const body = JSON.parse(request.body)
    const amount = Number(body.contents[0].parts[0].text.match(/Buat tepat (\d+) soal/)[1])
    const questions = Array.from({ length: amount }, () => {
      number += 1
      return { prompt: `Pertanyaan unik nomor ${number}?`, options: ['Benar', 'Salah A', 'Salah B', 'Salah C'], answer: 0, explanation: 'Ini adalah pembahasan.' }
    })
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ questions }) }] } }] }) }
  })
}

describe('soal Gemini', () => {
  it('generates up to 500 questions in batches and reports progress', async () => {
    const fetchImpl = mockGemini()
    const progress = []
    const config = { ...DEFAULT_CONFIG, count: 500, source: 'ai' }
    const questions = await generateAiQuestions(config, 'test-key', { fetchImpl, onProgress: (done, total) => progress.push([done, total]) })
    expect(questions).toHaveLength(500)
    expect(new Set(questions.map((question) => question.prompt)).size).toBe(500)
    expect(fetchImpl).toHaveBeenCalledTimes(20)
    expect(fetchImpl.mock.calls[0][1].headers['x-goog-api-key']).toBe('test-key')
    expect(fetchImpl.mock.calls[0][0]).not.toContain('test-key')
    expect(progress[0]).toEqual([0, 500])
    expect(progress.at(-1)).toEqual([500, 500])
  })

  it('reports missing or rejected keys without leaking them', async () => {
    await expect(generateAiQuestions({ ...DEFAULT_CONFIG, source: 'ai' }, '')).rejects.toThrow('API key')
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403 }))
    await expect(generateAiQuestions({ ...DEFAULT_CONFIG, count: 1, source: 'ai' }, 'sensitive-key', { fetchImpl })).rejects.toThrow('ditolak')
  })

  it('does not accept malformed questions as valid', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ questions: [{ prompt: 'A?', options: ['A', 'A', 'B', 'C'], answer: 0, explanation: 'A' }] }) }] } }] }) }))
    await expect(generateAiQuestions({ ...DEFAULT_CONFIG, count: 1, source: 'ai' }, 'key', { fetchImpl })).rejects.toThrow('belum menghasilkan cukup')
  })
})
