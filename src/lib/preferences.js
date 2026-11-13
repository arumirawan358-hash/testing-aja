import { cleanName, validateName } from '../data/subjects.js'
import { DEFAULT_AVATAR, isAvatarId } from '../data/avatars.js'
import { DEFAULT_FRAME, isFrameId } from '../data/frames.js'
import { accuracyOf, pointsForGame, winRateOf } from './ranks.js'

export const PROFILE_STORAGE_KEY = 'kuiskita:profile'
export const HINT_STORAGE_KEY = 'kuiskita:about'
const LEGACY_HINT_STORAGE_KEY = 'kuiskita:hint'
const MAX_RECENT_GAMES = 100
const MAX_GAMES = 1000000
const MAX_POINTS = 99999999

export function emptyProfile() {
  return {
    name: '',
    avatar: DEFAULT_AVATAR,
    frame: DEFAULT_FRAME,
    gamesPlayed: 0,
    bestScore: null,
    recentGameIds: [],
    wins: 0,
    draws: 0,
    losses: 0,
    smartPoints: 0,
    correctAnswers: 0,
    totalAnswered: 0,
  }
}

function browserStorage() {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

const boundedInt = (value, max) => (Number.isInteger(value) && value >= 0 && value <= max ? value : 0)

export function sanitizeProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyProfile()
  const name = typeof value.name === 'string' && !validateName(value.name) ? cleanName(value.name) : ''
  const gamesPlayed = Number.isInteger(value.gamesPlayed) && value.gamesPlayed >= 0 && value.gamesPlayed <= MAX_GAMES ? value.gamesPlayed : 0
  const bestScore = gamesPlayed > 0 && Number.isInteger(value.bestScore) && value.bestScore >= 0 && value.bestScore <= 100 ? value.bestScore : null
  const ids = Array.isArray(value.recentGameIds) ? value.recentGameIds.filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 100) : []
  return {
    name,
    avatar: isAvatarId(value.avatar) ? value.avatar : DEFAULT_AVATAR,
    frame: isFrameId(value.frame) ? value.frame : DEFAULT_FRAME,
    gamesPlayed,
    bestScore,
    recentGameIds: [...new Set(ids)].slice(-MAX_RECENT_GAMES),
    wins: boundedInt(value.wins, MAX_GAMES),
    draws: boundedInt(value.draws, MAX_GAMES),
    losses: boundedInt(value.losses, MAX_GAMES),
    smartPoints: boundedInt(value.smartPoints, MAX_POINTS),
    correctAnswers: boundedInt(value.correctAnswers, 9999999),
    totalAnswered: boundedInt(value.totalAnswered, 9999999),
  }
}

export function loadProfile(storage = browserStorage()) {
  try { return sanitizeProfile(JSON.parse(storage?.getItem(PROFILE_STORAGE_KEY) || 'null')) } catch { return emptyProfile() }
}

export function saveProfile(profile, storage = browserStorage()) {
  try { storage?.setItem(PROFILE_STORAGE_KEY, JSON.stringify(sanitizeProfile(profile))) } catch { /* profile remains usable for this tab */ }
}

export function loadHintEnabled(storage = browserStorage()) {
  try {
    const saved = storage?.getItem(HINT_STORAGE_KEY)
    return (saved ?? storage?.getItem(LEGACY_HINT_STORAGE_KEY)) === 'on'
  } catch { return false }
}

export function saveHintEnabled(enabled, storage = browserStorage()) {
  try {
    storage?.setItem(HINT_STORAGE_KEY, enabled ? 'on' : 'off')
    storage?.removeItem?.(LEGACY_HINT_STORAGE_KEY)
  } catch { /* preference remains usable for this tab */ }
}

// outcome.opsional: { correct, total, result: 'win' | 'draw' | 'loss' | 'solo' }.
// Setiap game hanya dihitung sekali lewat recentGameIds.
export function recordCompletedGame(profile, gameId, score, outcome = {}) {
  if (typeof gameId !== 'string' || gameId.length === 0 || gameId.length > 100 || !Number.isInteger(score) || score < 0 || score > 100) return profile
  const current = sanitizeProfile(profile)
  if (current.recentGameIds.includes(gameId)) return profile
  const result = ['win', 'draw', 'loss', 'solo'].includes(outcome.result) ? outcome.result : 'solo'
  const correct = boundedInt(outcome.correct, 500)
  const total = boundedInt(outcome.total, 500)
  return {
    ...current,
    gamesPlayed: Math.min(MAX_GAMES, current.gamesPlayed + 1),
    bestScore: current.bestScore === null ? score : Math.max(current.bestScore, score),
    recentGameIds: [...current.recentGameIds, gameId].slice(-MAX_RECENT_GAMES),
    wins: current.wins + (result === 'win' ? 1 : 0),
    draws: current.draws + (result === 'draw' ? 1 : 0),
    losses: current.losses + (result === 'loss' ? 1 : 0),
    smartPoints: Math.min(MAX_POINTS, current.smartPoints + pointsForGame({ correct, total, result })),
    correctAnswers: current.correctAnswers + correct,
    totalAnswered: current.totalAnswered + total,
  }
}

export function profileSummary(profile) {
  const current = sanitizeProfile(profile)
  return {
    ...current,
    winRate: winRateOf(current.wins, current.draws, current.losses),
    accuracy: accuracyOf(current.correctAnswers, current.totalAnswered),
  }
}

// --- Riwayat permainan per ruang -------------------------------------------

export const GAME_HISTORY_KEY = 'kuiskita:history'
const MAX_GAME_HISTORY = 20

function sanitizeHistoryEntry(entry) {
  if (!entry || typeof entry !== 'object') return null
  const standings = Array.isArray(entry.standings)
    ? entry.standings.slice(0, 8).map((player) => ({
      name: typeof player?.name === 'string' ? player.name.slice(0, 24) : '',
      points: Number.isInteger(player?.points) ? player.points : 0,
      correct: Number.isInteger(player?.correct) ? player.correct : 0,
      wrong: Number.isInteger(player?.wrong) ? player.wrong : 0,
      rank: Number.isInteger(player?.rank) ? player.rank : 0,
    })).filter((player) => player.name)
    : []
  return {
    at: Number.isFinite(entry.at) ? entry.at : 0,
    mode: entry.mode === 'buzzer' ? 'buzzer' : 'duel',
    roomCode: typeof entry.roomCode === 'string' ? entry.roomCode.slice(0, 6) : '',
    category: typeof entry.category === 'string' ? entry.category.slice(0, 40) : '',
    method: typeof entry.method === 'string' ? entry.method.slice(0, 12) : '',
    gameId: typeof entry.gameId === 'string' ? entry.gameId.slice(0, 100) : '',
    standings,
  }
}

export function loadGameHistory(storage = browserStorage()) {
  try {
    const raw = JSON.parse(storage?.getItem(GAME_HISTORY_KEY) || '[]')
    return (Array.isArray(raw) ? raw : []).map(sanitizeHistoryEntry).filter(Boolean)
  } catch { return [] }
}

export function saveGameHistory(entry, storage = browserStorage()) {
  try {
    const clean = sanitizeHistoryEntry(entry)
    if (!clean) return loadGameHistory(storage)
    const next = [...loadGameHistory(storage), clean].slice(-MAX_GAME_HISTORY)
    storage?.setItem(GAME_HISTORY_KEY, JSON.stringify(next))
    return next
  } catch { return loadGameHistory(storage) }
}
