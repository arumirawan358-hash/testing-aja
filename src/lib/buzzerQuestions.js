import { CUSTOM_SUBJECT } from '../data/subjects.js'
import { QUESTION_BANK } from '../data/questionBank.js'
import { bankSubjectsFor, isMixedCategory } from '../data/buzzerCategories.js'
import { makeMathQuestion, shuffle } from './questions.js'

// --- Normalisasi & penilaian jawaban ketikan -------------------------------

export function normalizeTyped(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[.,!?;:"'`()\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Jawaban ketikan dinilai longgar tapi tetap adil: cocok persis ATAU memuat
// jawaban benar sebagai kata utuh (mis. "kayaknya sih 17 deh" untuk "17").
export function gradeTypedAnswer(value, accepted) {
  const given = normalizeTyped(value)
  if (!given) return false
  return (accepted || []).some((option) => {
    const target = normalizeTyped(option)
    if (!target) return false
    if (given === target) return true
    if (target.length >= 2 && new RegExp(`(^|\\s)${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(given)) return true
    if (given.length >= 6 && target.includes(given)) return true
    return false
  })
}

export function gradeBuzzerAnswer(question, value) {
  if (!question) return false
  if (question.kind === 'mc') return Number.isInteger(value) && value === question.answerIndex
  return gradeTypedAnswer(value, question.accepted)
}

// --- Jawaban alami untuk tombol "Isi Jawaban Otomatis" ----------------------

const NATURAL_VARIANTS = [
  (answer) => answer,
  (answer) => `jawabannya ${answer}`,
  (answer) => `kalau nggak salah, ${answer}`,
  (answer) => `${answer} deh menurutku`,
  (answer) => `aku pilih ${answer}`,
  (answer) => `kayaknya ${answer}`,
]

function stableIndex(seedText, modulo) {
  let hash = 0
  for (let i = 0; i < seedText.length; i += 1) hash = (hash * 31 + seedText.charCodeAt(i)) >>> 0
  return hash % modulo
}

// Teks yang diisi tombol cheat: harus terasa seperti diketik manusia dan tetap
// bisa dinilai benar (varian membungkus jawaban dengan kalimat natural).
export function naturalCheatAnswer(question) {
  if (!question) return ''
  const core = question.kind === 'mc' ? question.options?.[question.answerIndex] : question.answerText
  if (!core) return ''
  if (question.naturalAnswer) return question.naturalAnswer
  return NATURAL_VARIANTS[stableIndex(question.prompt || core, NATURAL_VARIANTS.length)](core)
}

// Nilai yang dimasukkan ke kolom oleh tombol cheat (belum dikirim).
export function autoFillValue(question) {
  if (!question) return null
  return question.kind === 'mc' ? question.answerIndex : naturalCheatAnswer(question)
}

// --- Pembentukan soal ------------------------------------------------------

function toBuzzerQuestion(entry, kind, random) {
  const base = { prompt: entry.prompt, explanation: entry.explanation }
  if (kind === 'mc') {
    const options = shuffle([entry.correct, ...entry.wrong], random)
    return { ...base, kind: 'mc', options, answerIndex: options.indexOf(entry.correct), accepted: [], answerText: entry.correct }
  }
  return { ...base, kind: 'typing', options: [], answerIndex: 0, answerText: entry.correct, accepted: [entry.correct] }
}

function pickEntries(subjects, count, random) {
  const pool = []
  for (const subject of subjects) {
    if (subject === 'Matematika') {
      // Matematika dibuat prosedural seperti bank kuis (bukan entri statis).
      for (let kind = 0; kind < 4; kind += 1) {
        for (const grade of [2, 5, 8, 11]) {
          const item = makeMathQuestion(grade, kind, random)
          pool.push({ prompt: item.prompt, correct: item.options[item.answer], wrong: item.options.filter((_, index) => index !== item.answer), explanation: item.explanation, min: grade, max: grade })
        }
      }
      continue
    }
    for (const item of QUESTION_BANK[subject] || []) pool.push(item)
  }
  if (pool.length === 0) throw new Error('Bank soal untuk kategori ini belum tersedia.')
  const picked = []
  const seen = new Set()
  let attempts = 0
  while (picked.length < count && attempts < count * 60) {
    attempts += 1
    const entry = pool[Math.floor(random() * pool.length) % pool.length]
    const key = `${entry.prompt}`
    if (seen.has(key)) continue
    seen.add(key)
    picked.push(entry)
  }
  // Untuk jumlah melebihi variasi bank, ulang boleh terjadi (sama seperti bank kuis).
  while (picked.length < count) picked.push(pool[Math.floor(random() * pool.length) % pool.length])
  return picked
}

// Bangun paket soal buzzer dari bank soal lokal. Tingkat kesulitan bervariasi
// karena entri bank punya rentang kelas berbeda dan diambil acak merata.
export function makeBuzzerQuestions({ category, method, count, random = Math.random }) {
  const total = Math.max(1, Math.min(50, Number(count) || 1))
  const subjects = bankSubjectsFor(category === CUSTOM_SUBJECT ? 'random' : category)
  const entries = pickEntries(subjects, total, random)
  return entries.map((entry, index) => {
    const kind = method === 'random' ? (random() < 0.5 ? 'mc' : 'typing') : method
    return { ...toBuzzerQuestion(entry, kind, random), id: `bz-${index + 1}` }
  })
}

export function isBuzzerQuestion(question) {
  if (!question || typeof question !== 'object') return false
  if (typeof question.prompt !== 'string' || !question.prompt.trim()) return false
  if (question.kind === 'mc') {
    return Array.isArray(question.options) && question.options.length === 4
      && question.options.every((option) => typeof option === 'string' && option)
      && Number.isInteger(question.answerIndex) && question.answerIndex >= 0 && question.answerIndex <= 3
  }
  if (question.kind === 'typing') {
    return typeof question.answerText === 'string' && question.answerText.trim().length > 0
      && Array.isArray(question.accepted) && question.accepted.length > 0
  }
  return false
}

// Soal dikirim utuh ke semua pemain — kunci dipakai fitur Hint Cheat lokal
// (seperti mode kuis berdua). Yang TIDAK pernah dikirim: jawaban pemain yang
// belum ditekan kirim (privasi dijaga sisi perangkat).
export function wireQuestion(question, index, total) {
  return {
    ...question,
    options: [...(question.options || [])],
    accepted: [...(question.accepted || [])],
    index,
    total,
  }
}

export function revealAnswer(question) {
  return {
    kind: question.kind,
    answerIndex: question.kind === 'mc' ? question.answerIndex : null,
    answerText: question.answerText,
    options: question.kind === 'mc' ? [...question.options] : [],
    explanation: question.explanation || '',
  }
}
