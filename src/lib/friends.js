// Daftar teman tersimpan lokal di browser ini. Tidak ada server pertemanan:
// undangan berupa tautan ruang yang bisa dibagikan dengan sekali klik.
import { getRank } from './ranks.js'
import { DEFAULT_FRAME, isFrameId } from '../data/frames.js'
import { DEFAULT_AVATAR, isAvatarId } from '../data/avatars.js'

export const FRIENDS_STORAGE_KEY = 'kuiskita:friends'
const MAX_FRIENDS = 50

function browserStorage() {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

export function sanitizeFriend(value) {
  if (!value || typeof value !== 'object') return null
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 24) : ''
  if (!name) return null
  const int = (v, max) => (Number.isInteger(v) && v >= 0 && v <= max ? v : 0)
  return {
    name,
    avatar: isAvatarId(value.avatar) ? value.avatar : DEFAULT_AVATAR,
    frame: isFrameId(value.frame) ? value.frame : DEFAULT_FRAME,
    smartPoints: int(value.smartPoints, 99999999),
    wins: int(value.wins, 9999999),
    draws: int(value.draws, 9999999),
    losses: int(value.losses, 9999999),
    gamesPlayed: int(value.gamesPlayed, 9999999),
    winRate: int(value.winRate, 100),
    lastPlayedAt: typeof value.lastPlayedAt === 'number' ? value.lastPlayedAt : 0,
  }
}

export function loadFriends(storage = browserStorage()) {
  try {
    const raw = JSON.parse(storage?.getItem(FRIENDS_STORAGE_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw.map(sanitizeFriend).filter(Boolean).slice(0, MAX_FRIENDS)
  } catch { return [] }
}

export function saveFriends(friends, storage = browserStorage()) {
  try { storage?.setItem(FRIENDS_STORAGE_KEY, JSON.stringify((friends || []).map(sanitizeFriend).filter(Boolean).slice(0, MAX_FRIENDS))) } catch { /* friends remain usable for this tab */ }
}

// Tambah/ perbarui teman dari ringkasan profil pemain lain.
export function addFriend(profile, storage = browserStorage()) {
  const friend = sanitizeFriend({ ...profile, lastPlayedAt: Date.now() })
  if (!friend) return loadFriends(storage)
  const friends = loadFriends(storage)
  const key = friend.name.toLocaleLowerCase('id-ID')
  const next = friends.filter((item) => item.name.toLocaleLowerCase('id-ID') !== key)
  next.unshift(friend)
  const result = next.slice(0, MAX_FRIENDS)
  saveFriends(result, storage)
  return result
}

export function removeFriend(name, storage = browserStorage()) {
  const key = String(name || '').toLocaleLowerCase('id-ID')
  const result = loadFriends(storage).filter((item) => item.name.toLocaleLowerCase('id-ID') !== key)
  saveFriends(result, storage)
  return result
}

export function friendRank(friend) {
  return getRank(friend?.smartPoints)
}

// Tautan undangan: kode ruang sudah terisi, teman tinggal memasukkan nama.
export function inviteLink(code, baseUrl) {
  const url = new URL(baseUrl || (typeof window === 'undefined' ? 'http://localhost/' : window.location.href))
  url.search = ''
  url.searchParams.set('room', String(code || '').toUpperCase())
  url.hash = 'gabung'
  return url.toString()
}
