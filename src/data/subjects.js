import { QUESTION_BANK } from './questionBank.js'

export const LEVELS = [
  {
    id: 'SD',
    label: 'SD / Sederajat',
    grades: [1, 2, 3, 4, 5, 6],
    subjects: ['Matematika', 'Bahasa Indonesia', 'IPAS', 'Pendidikan Pancasila', 'Bahasa Inggris'],
  },
  {
    id: 'SMP',
    label: 'SMP / Sederajat',
    grades: [7, 8, 9],
    subjects: ['Matematika', 'Bahasa Indonesia', 'IPA', 'IPS', 'Bahasa Inggris', 'Pendidikan Pancasila', 'Informatika'],
  },
  {
    id: 'SMA',
    label: 'SMA / Sederajat',
    grades: [10, 11, 12],
    subjects: ['Matematika', 'Bahasa Indonesia', 'Bahasa Inggris', 'Biologi', 'Fisika', 'Kimia', 'Ekonomi', 'Geografi', 'Sejarah', 'Sosiologi', 'Pendidikan Pancasila', 'Informatika'],
  },
  {
    id: 'PT',
    label: 'Perguruan Tinggi',
    grades: [1, 2, 3, 4, 5, 6, 7, 8],
    gradeLabels: ['D3', 'D4', 'S1', 'S2', 'S3', 'Profesi', 'Spesialis', 'Doktor'],
    subjects: ['Umum', 'Matematika', 'Bahasa Indonesia', 'Bahasa Inggris', 'Ekonomi', 'Manajemen', 'Hukum', 'Kedokteran', 'Teknik', 'Informatika', 'Psikologi'],
  },
  {
    id: 'UMUM',
    label: 'Umum & Persiapan Tes',
    grades: [1, 2, 3, 4, 5, 6],
    gradeLabels: ['CPNS / SKD', 'UTBK', 'Kedinasan', 'TNI / Polri', 'Profesi', 'Umum'],
    subjects: ['Umum', 'Penalaran', 'TWK', 'TIU', 'TKP', 'Bahasa Indonesia', 'Bahasa Inggris', 'Matematika'],
  },
]

export const CUSTOM_SUBJECT = 'Lainnya (AI)'

// Cakupan bank soal lokal: matematika dibuat prosedural, lainnya dari bank statis.
export function bankCoversSubject(subject) {
  return subject === 'Matematika' || Boolean(QUESTION_BANK[subject])
}

export const DEFAULT_CONFIG = {
  level: 'SD',
  grade: 4,
  subject: 'Matematika',
  customSubject: '',
  topic: '',
  count: 10,
  source: 'groq',
}

export function subjectName(config) {
  return config?.subject === CUSTOM_SUBJECT ? String(config.customSubject || '').trim() : config?.subject || ''
}

export function getLevel(id) {
  return LEVELS.find((level) => level.id === id)
}

// Label kelas/jenjang untuk tampilan: "Kelas 4", "S1", "CPNS / SKD", dst.
export function gradeLabel(config) {
  const level = getLevel(config?.level)
  const grade = Number(config?.grade)
  if (!level) return `Kelas ${grade}`
  const index = level.grades.indexOf(grade)
  if (level.gradeLabels && index >= 0) return level.gradeLabels[index]
  return `Kelas ${grade}`
}

export function gradeFieldLabel(config) {
  return ['PT', 'UMUM'].includes(config?.level) ? 'Jenjang' : 'Kelas'
}

// Tingkat kesulitan soal: jenjang baru dipetakan ke bank kesulitan yang setara.
export function effectiveGrade(config) {
  const level = getLevel(config?.level)
  const grade = Number(config?.grade)
  if (!level) return grade
  if (level.id === 'PT') return 12
  if (level.id === 'UMUM') return 9
  return grade
}

export function validateConfig(config) {
  const level = getLevel(config?.level)
  if (!level || !level.grades.includes(Number(config.grade))) return 'Pilih jenjang dan kelas yang sesuai.'
  if (!['bank', 'groq'].includes(config.source)) return 'Pilih sumber soal.'
  if (config.subject === CUSTOM_SUBJECT && config.source === 'groq') {
    const custom = typeof config.customSubject === 'string' ? config.customSubject.trim() : ''
    if (custom.length < 2 || custom.length > 60) return 'Masukkan nama mata pelajaran (2–60 karakter).'
  } else if (config.subject === '' || config.subject == null) {
    // Mata pelajaran boleh kosong untuk soal AI bebas instruksi, tetapi instruksinya wajib ada.
    if (config.source !== 'groq') return 'Pilih mata pelajaran untuk bank soal, atau gunakan Groq AI.'
    if (!String(config.topic || '').trim()) return 'Tulis instruksi untuk AI, misalnya "Buatkan soal SKD 2025".'
  } else if (!level.subjects.includes(config.subject)) return 'Pilih mata pelajaran yang tersedia.'
  if (config.source === 'bank' && !bankCoversSubject(config.subject)) return 'Bank soal untuk mata pelajaran ini belum tersedia. Pilih sumber soal AI.'
  if (config.topic != null && (typeof config.topic !== 'string' || config.topic.length > 500)) return 'Instruksi AI maksimal 500 karakter.'
  if (!Number.isInteger(Number(config.count)) || Number(config.count) < 1 || Number(config.count) > 500) return 'Jumlah soal harus antara 1 dan 500.'
  return ''
}

export function validateName(name) {
  const clean = String(name || '').trim().replace(/\s+/g, ' ')
  if (clean.length < 2 || clean.length > 24) return 'Nama panggilan harus terdiri dari 2–24 karakter.'
  return ''
}

export function cleanName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 24)
}
