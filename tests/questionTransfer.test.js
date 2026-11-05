import { describe, expect, it } from 'vitest'
import { CHUNK_BYTES, decodeQuestions, encodeQuestions, isValidChunkText, isValidTransferSize, MAX_CHUNK_TEXT, MAX_TRANSFER_BYTES } from '../src/lib/questionTransfer.js'

const makeQuestions = (count) => Array.from({ length: count }, (_, index) => ({
  id: `q-${index}`,
  prompt: `Pertanyaan ${index} ${'字🧩'.repeat(400)}?`,
  options: ['Satu', 'Dua', 'Tiga', 'Empat'],
  answer: index % 4,
  explanation: `Penjelasan ${'é'.repeat(800)}.`,
}))

describe('transfer soal berbatas byte', () => {
  it('round-trips 500 questions, including multi-byte characters spanning chunks', () => {
    const questions = makeQuestions(500)
    const payload = encodeQuestions(questions)
    expect(payload.chunks.length).toBeGreaterThan(30)
    expect(isValidTransferSize(payload.bytes, payload.chunks.length)).toBe(true)
    expect(payload.chunks.every((chunk) => isValidChunkText(chunk) && chunk.length <= MAX_CHUNK_TEXT)).toBe(true)
    for (const [index, data] of payload.chunks.entries()) {
      const message = { type: 'question-data', gameId: 'game', transferId: 'transfer', index, data }
      expect(new TextEncoder().encode(JSON.stringify(message)).length).toBeLessThan(16300)
    }
    expect(decodeQuestions(payload.chunks, payload.bytes, payload.checksum)).toEqual(questions)
  })

  it('detects missing, altered, reordered or oversized chunks and invalid sizes', () => {
    const payload = encodeQuestions(makeQuestions(8))
    expect(payload.chunks.length).toBeGreaterThan(1)
    const altered = [...payload.chunks]
    altered[0] = (altered[0][0] === 'A' ? 'B' : 'A') + altered[0].slice(1)
    expect(() => decodeQuestions(altered, payload.bytes, payload.checksum)).toThrow()
    expect(() => decodeQuestions(payload.chunks.slice(1), payload.bytes, payload.checksum)).toThrow()
    const reordered = [...payload.chunks]
    ;[reordered[0], reordered[1]] = [reordered[1], reordered[0]]
    expect(() => decodeQuestions(reordered, payload.bytes, payload.checksum)).toThrow()
    expect(isValidChunkText('A'.repeat(MAX_CHUNK_TEXT + 4))).toBe(false)
    expect(isValidChunkText('not base64!')).toBe(false)
    expect(isValidTransferSize(MAX_TRANSFER_BYTES + 1, 1)).toBe(false)
    expect(isValidTransferSize(CHUNK_BYTES, 2)).toBe(false)
  })
})
