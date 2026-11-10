// Rank kepintaran: kelas rank dibuat khusus untuk KuisKita dengan
// efek "bling" bertingkat yang terlihat di profil setiap pemain.

export const RANKS = [
  { tier: 0, name: 'Tunas Bintang', minPoints: 0, bling: 0 },
  { tier: 1, name: 'Bintang Muda', minPoints: 100, bling: 1 },
  { tier: 2, name: 'Bintang Terang', minPoints: 300, bling: 2 },
  { tier: 3, name: 'Bintang Cemerlang', minPoints: 700, bling: 3 },
  { tier: 4, name: 'Bintang Gemilang', minPoints: 1500, bling: 4 },
  { tier: 5, name: 'Bintang Agung', minPoints: 2500, bling: 5 },
  { tier: 6, name: 'Galaksi Cendekia', minPoints: 4000, bling: 6 },
]

export const MAX_SMART_POINTS = 99999999
const MAX_COUNT = 9999999

const clampInt = (value, min, max, fallback = min) => {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

export function getRank(points) {
  const safe = clampInt(points, 0, MAX_SMART_POINTS)
  let current = RANKS[0]
  for (const rank of RANKS) if (safe >= rank.minPoints) current = rank
  const next = RANKS.find((rank) => rank.minPoints > safe) || null
  return {
    ...current,
    nextPoints: next ? next.minPoints : null,
    nextName: next ? next.name : null,
    progress: next ? Math.round((100 * (safe - current.minPoints)) / (next.minPoints - current.minPoints)) : 100,
  }
}

// Poin: 10 per jawaban benar, bonus menang/seri/kalah, dan bonus 20 bila sempurna.
export function pointsForGame({ correct = 0, total = 0, result = 'solo' } = {}) {
  const right = clampInt(correct, 0, MAX_COUNT)
  const all = clampInt(total, 0, MAX_COUNT)
  const bonus = result === 'win' ? 30 : result === 'draw' ? 15 : result === 'loss' ? 5 : 0
  const perfect = all > 0 && right === all ? 20 : 0
  return right * 10 + bonus + perfect
}

export function winRateOf(wins = 0, draws = 0, losses = 0) {
  const w = clampInt(wins, 0, MAX_COUNT)
  const d = clampInt(draws, 0, MAX_COUNT)
  const l = clampInt(losses, 0, MAX_COUNT)
  const played = w + d + l
  return played ? Math.round((100 * w) / played) : 0
}

export function accuracyOf(correctAnswers = 0, totalAnswered = 0) {
  const c = clampInt(correctAnswers, 0, MAX_COUNT)
  const t = clampInt(totalAnswered, 0, MAX_COUNT)
  return t ? Math.round((100 * c) / t) : null
}

// Bentuk ringkas yang aman dikirim ke pemain lain lewat koneksi langsung.
export function toViewProfile(profile) {
  const safe = profile && typeof profile === 'object' ? profile : {}
  const smartPoints = clampInt(safe.smartPoints, 0, MAX_SMART_POINTS)
  const wins = clampInt(safe.wins, 0, MAX_COUNT)
  const draws = clampInt(safe.draws, 0, MAX_COUNT)
  const losses = clampInt(safe.losses, 0, MAX_COUNT)
  return {
    name: typeof safe.name === 'string' ? safe.name.slice(0, 24) : '',
    avatar: typeof safe.avatar === 'string' ? safe.avatar.slice(0, 24) : '',
    smartPoints,
    wins,
    draws,
    losses,
    gamesPlayed: clampInt(safe.gamesPlayed, 0, MAX_COUNT),
    winRate: winRateOf(wins, draws, losses),
    accuracy: accuracyOf(safe.correctAnswers, safe.totalAnswered),
    rank: getRank(smartPoints),
  }
}

// Profil lawan wajib disaring: hanya angka dan teks pendek yang diterima.
// Rank selalu dihitung ulang dari poin, tidak dipercaya dari lawan.
export function sanitizeWireProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const name = typeof value.name === 'string' ? value.name.slice(0, 24).trim() : ''
  if (!name) return null
  const view = toViewProfile({
    name,
    avatar: typeof value.avatar === 'string' ? value.avatar : '',
    smartPoints: value.smartPoints,
    wins: value.wins,
    draws: value.draws,
    losses: value.losses,
    gamesPlayed: value.gamesPlayed,
    correctAnswers: value.correctAnswers,
    totalAnswered: value.totalAnswered,
  })
  view.accuracy = Number.isFinite(Number(value.accuracy)) ? clampInt(value.accuracy, 0, 100, null) : view.accuracy
  return view
}
