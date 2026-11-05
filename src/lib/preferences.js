import { cleanName, validateName } from '../data/subjects.js'

export const PROFILE_STORAGE_KEY = 'kuiskita:profile'
export const HINT_STORAGE_KEY = 'kuiskita:about'
const LEGACY_HINT_STORAGE_KEY = 'kuiskita:hint'
const MAX_RECENT_GAMES = 100
const MAX_GAMES = 1000000

export function emptyProfile() {
  return { name: '', gamesPlayed: 0, bestScore: null, recentGameIds: [] }
}

function browserStorage() {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

export function sanitizeProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyProfile()
  const name = typeof value.name === 'string' && !validateName(value.name) ? cleanName(value.name) : ''
  const gamesPlayed = Number.isInteger(value.gamesPlayed) && value.gamesPlayed >= 0 && value.gamesPlayed <= MAX_GAMES ? value.gamesPlayed : 0
  const bestScore = gamesPlayed > 0 && Number.isInteger(value.bestScore) && value.bestScore >= 0 && value.bestScore <= 100 ? value.bestScore : null
  const ids = Array.isArray(value.recentGameIds) ? value.recentGameIds.filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 100) : []
  return { name, gamesPlayed, bestScore, recentGameIds: [...new Set(ids)].slice(-MAX_RECENT_GAMES) }
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

export function recordCompletedGame(profile, gameId, score) {
  if (typeof gameId !== 'string' || gameId.length === 0 || gameId.length > 100 || !Number.isInteger(score) || score < 0 || score > 100) return profile
  const current = sanitizeProfile(profile)
  if (current.recentGameIds.includes(gameId)) return profile
  return {
    ...current,
    gamesPlayed: Math.min(MAX_GAMES, current.gamesPlayed + 1),
    bestScore: current.bestScore === null ? score : Math.max(current.bestScore, score),
    recentGameIds: [...current.recentGameIds, gameId].slice(-MAX_RECENT_GAMES),
  }
}
