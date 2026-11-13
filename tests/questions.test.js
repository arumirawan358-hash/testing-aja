import { describe, expect, it } from 'vitest'
import { bankCoversSubject, CUSTOM_SUBJECT, DEFAULT_CONFIG, LEVELS, subjectName, validateConfig } from '../src/data/subjects.js'
import { isValidQuestion, makePracticeQuestions, scoreAnswers } from '../src/lib/questions.js'

describe('bank soal dan penilaian', () => {
  it('supports every listed grade and subject', () => {
    for (const level of LEVELS) for (const grade of level.grades) for (const subject of level.subjects) {
      if (subject === CUSTOM_SUBJECT) continue
      const config = { level: level.id, grade, subject, count: 30, source: 'bank' }
      const inSchoolBank = bankCoversSubject(subject)
      if (inSchoolBank) {
        expect(validateConfig(config), `${level.id} ${grade} ${subject}`).toBe('')
        const questions = makePracticeQuestions(config)
        expect(questions, `${level.id} ${grade} ${subject}`).toHaveLength(30)
        expect(questions.every(isValidQuestion), `${level.id} ${grade} ${subject}`).toBe(true)
      } else {
        // Mata pelajaran di luar cakupan bank harus lewat AI.
        expect(validateConfig(config), `${level.id} ${grade} ${subject}`).not.toBe('')
        expect(validateConfig({ ...config, source: 'groq', topic: 'Topik uji' }), `${level.id} ${grade} ${subject}`).toBe('')
      }
    }
  })

  it('generates 500 different valid math questions for each grade', () => {
    for (const level of LEVELS) for (const grade of level.grades) {
      const questions = makePracticeQuestions({ level: level.id, grade, subject: 'Matematika', count: 500, source: 'bank' })
      expect(questions.every(isValidQuestion)).toBe(true)
      expect(new Set(questions.map((question) => question.prompt)).size).toBe(500)
    }
  })

  it('accepts 1 and 500 questions but rejects invalid counts', () => {
    expect(validateConfig({ ...DEFAULT_CONFIG, count: 1 })).toBe('')
    expect(validateConfig({ ...DEFAULT_CONFIG, count: 500 })).toBe('')
    for (const count of [0, 501, 1.5, '', -1]) expect(validateConfig({ ...DEFAULT_CONFIG, count })).not.toBe('')
    expect(() => makePracticeQuestions({ ...DEFAULT_CONFIG, count: 501 })).toThrow()
  })

  it('allows an additional subject and topic only with AI mode', () => {
    const config = { ...DEFAULT_CONFIG, source: 'groq', subject: CUSTOM_SUBJECT, customSubject: 'Seni Budaya', topic: 'Musik tradisional' }
    expect(validateConfig(config)).toBe('')
    expect(subjectName(config)).toBe('Seni Budaya')
    // Mata pelajaran boleh dikosongkan untuk AI, tetapi instruksi topik wajib ada.
    const freeTopic = { ...DEFAULT_CONFIG, source: 'groq', subject: '', customSubject: '', topic: 'Buatkan soal SKD 2025' }
    expect(validateConfig(freeTopic)).toBe('')
    expect(subjectName(freeTopic)).toBe('')
    expect(validateConfig({ ...freeTopic, topic: '' })).not.toBe('')
    expect(validateConfig({ ...config, source: 'bank' })).not.toBe('')
    expect(validateConfig({ ...config, topic: 'x'.repeat(501) })).not.toBe('')
  })

  it('separates correct, wrong and skipped answers and rounds the score', () => {
    const questions = [{ answer: 0 }, { answer: 2 }, { answer: 3 }]
    expect(scoreAnswers(questions, [0, 1, null])).toEqual({ correct: 1, wrong: 1, skipped: 1, total: 3, score: 33 })
    expect(scoreAnswers(questions, [0, 2, 3]).score).toBe(100)
  })
})
