import { CUSTOM_SUBJECT } from './subjects.js'
import { QUESTION_BANK } from './questionBank.js'

// Kategori untuk mode "Siapa Cepat Dia Menjawab".
// Bank soal lokal menutupi semua kategori (Pengetahuan Umum & Random = campuran).
export const MIXED_CATEGORY = 'random'
export const UMUM_CATEGORY = 'Pengetahuan Umum'

export const BUZZER_CATEGORIES = [
  { id: MIXED_CATEGORY, label: 'Random (campuran semua)', mixed: true },
  { id: 'Matematika', label: 'Matematika' },
  { id: 'Bahasa Indonesia', label: 'Bahasa Indonesia' },
  { id: 'Bahasa Inggris', label: 'Bahasa Inggris' },
  { id: 'IPA', label: 'IPA' },
  { id: 'IPS', label: 'IPS' },
  { id: 'Sejarah', label: 'Sejarah' },
  { id: 'Geografi', label: 'Geografi' },
  { id: UMUM_CATEGORY, label: 'Pengetahuan Umum', mixed: true },
  // Mata pelajaran lainnya.
  { id: 'Biologi', label: 'Biologi' },
  { id: 'Fisika', label: 'Fisika' },
  { id: 'Kimia', label: 'Kimia' },
  { id: 'Ekonomi', label: 'Ekonomi' },
  { id: 'Sosiologi', label: 'Sosiologi' },
  { id: 'Informatika', label: 'Informatika' },
  { id: 'Pendidikan Pancasila', label: 'Pendidikan Pancasila' },
  { id: 'IPAS', label: 'IPAS' },
  { id: CUSTOM_SUBJECT, label: 'Lainnya (AI)' },
]

export const ANSWER_METHODS = [
  { id: 'mc', label: 'Pilihan Ganda', detail: 'Pilih A, B, C, atau D' },
  { id: 'typing', label: 'Ketikan Manual', detail: 'Ketik jawabanmu sendiri' },
  { id: 'random', label: 'Random', detail: 'Campuran pilihan ganda & ketikan' },
]

export const WRONG_PENALTIES = [
  { id: 0, label: 'Tanpa penalti', detail: 'Jawaban salah tidak mengurangi poin' },
  { id: 5, label: 'Salah −5 poin', detail: 'Jawaban salah mengurangi 5 poin' },
]

export function isBuzzerCategory(id) {
  return BUZZER_CATEGORIES.some((category) => category.id === id)
}

export function categoryLabel(id) {
  return BUZZER_CATEGORIES.find((category) => category.id === id)?.label || id
}

export function isMixedCategory(id) {
  return Boolean(BUZZER_CATEGORIES.find((category) => category.id === id)?.mixed)
}

// Subjek bank yang dipakai untuk sebuah kategori; campuran memakai seluruh bank.
export function bankSubjectsFor(id) {
  if (isMixedCategory(id)) return Object.keys(QUESTION_BANK).concat('Matematika')
  return [id]
}

export function bankCoversCategory(id) {
  if (isMixedCategory(id)) return true
  return id === 'Matematika' || Boolean(QUESTION_BANK[id])
}

export function validateBuzzerSettings(settings) {
  const s = settings || {}
  if (!isBuzzerCategory(s.category)) return 'Pilih kategori pertanyaan.'
  if (!['mc', 'typing', 'random'].includes(s.method)) return 'Pilih metode menjawab.'
  if (s.source !== 'bank' && s.source !== 'groq') return 'Pilih sumber soal.'
  if (s.source === 'bank' && !bankCoversCategory(s.category) && s.category !== CUSTOM_SUBJECT) return 'Kategori ini belum ada di bank soal. Pilih Groq AI.'
  if (s.source === 'bank' && s.category === CUSTOM_SUBJECT) return 'Kategori bebas hanya tersedia di Groq AI.'
  if (s.category === CUSTOM_SUBJECT && s.source === 'groq' && String(s.customCategory || '').trim().length < 2) return 'Masukkan nama kategori (2–60 karakter).'
  const count = Number(s.count)
  if (!Number.isInteger(count) || count < 1 || count > 50) return 'Jumlah soal harus antara 1 dan 50.'
  if (![0, 5].includes(Number(s.wrongPenalty))) return 'Pilih aturan penalti jawaban salah.'
  if (s.topic != null && (typeof s.topic !== 'string' || s.topic.length > 500)) return 'Instruksi AI maksimal 500 karakter.'
  return ''
}

export const DEFAULT_BUZZER_SETTINGS = {
  category: MIXED_CATEGORY,
  customCategory: '',
  method: 'mc',
  count: 8,
  wrongPenalty: 0,
  source: 'bank',
  topic: '',
}
