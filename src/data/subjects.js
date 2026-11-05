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
]

export const DEFAULT_CONFIG = {
  level: 'SD',
  grade: 4,
  subject: 'Matematika',
  count: 10,
  source: 'bank',
}

export function getLevel(id) {
  return LEVELS.find((level) => level.id === id)
}

export function validateConfig(config) {
  const level = getLevel(config?.level)
  if (!level || !level.grades.includes(Number(config.grade))) return 'Pilih jenjang dan kelas yang sesuai.'
  if (!level.subjects.includes(config.subject)) return 'Pilih mata pelajaran yang tersedia.'
  if (!Number.isInteger(Number(config.count)) || Number(config.count) < 1 || Number(config.count) > 500) return 'Jumlah soal harus antara 1 dan 500.'
  if (!['bank', 'ai'].includes(config.source)) return 'Pilih sumber soal.'
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
