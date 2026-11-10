import { describe, expect, it } from 'vitest'
import { HINT_STORAGE_KEY, PROFILE_STORAGE_KEY, emptyProfile, loadHintEnabled, loadProfile, profileSummary, recordCompletedGame, sanitizeProfile, saveHintEnabled, saveProfile } from '../src/lib/preferences.js'

function memoryStorage() {
  const data = new Map()
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: (key) => data.delete(key), data }
}

describe('profil dan pengaturan lokal', () => {
  it('keeps hints off by default and persists only the selected preference', () => {
    const storage = memoryStorage()
    expect(loadHintEnabled(storage)).toBe(false)
    saveHintEnabled(true, storage)
    expect(storage.getItem(HINT_STORAGE_KEY)).toBe('on')
    expect(loadHintEnabled(storage)).toBe(true)
    saveHintEnabled(false, storage)
    expect(loadHintEnabled(storage)).toBe(false)
    storage.setItem(HINT_STORAGE_KEY, 'unexpected')
    expect(loadHintEnabled(storage)).toBe(false)
  })

  it('migrates an existing preference without changing its setting', () => {
    const storage = memoryStorage()
    storage.setItem('kuiskita:hint', 'on')
    expect(loadHintEnabled(storage)).toBe(true)
    saveHintEnabled(true, storage)
    expect(storage.getItem('kuiskita:hint')).toBe(null)
    expect(storage.getItem(HINT_STORAGE_KEY)).toBe('on')
    saveHintEnabled(false, storage)
    expect(loadHintEnabled(storage)).toBe(false)
  })

  it('loads and saves an editable local profile while discarding unrelated fields', () => {
    const storage = memoryStorage()
    expect(loadProfile(storage)).toEqual(emptyProfile())
    saveProfile({ ...emptyProfile(), name: '  Bintang   Ceria  ', apiKey: 'never-save-this' }, storage)
    expect(loadProfile(storage).name).toBe('Bintang Ceria')
    expect(storage.getItem(PROFILE_STORAGE_KEY)).not.toContain('never-save-this')
    expect(sanitizeProfile({ name: 'x', gamesPlayed: -2, bestScore: 999, recentGameIds: [null] })).toEqual(emptyProfile())
  })

  it('records each finished game once, including zero scores, and tracks the best score', () => {
    let profile = { ...emptyProfile(), name: 'Mentari' }
    profile = recordCompletedGame(profile, 'round-one', 0)
    expect(profile).toMatchObject({ name: 'Mentari', gamesPlayed: 1, bestScore: 0 })
    profile = recordCompletedGame(profile, 'round-one', 100)
    expect(profile).toMatchObject({ gamesPlayed: 1, bestScore: 0 })
    profile = recordCompletedGame(profile, 'round-two', 80)
    profile = recordCompletedGame(profile, 'round-three', 40)
    expect(profile).toMatchObject({ gamesPlayed: 3, bestScore: 80 })
    expect(recordCompletedGame(profile, '', 90)).toEqual(profile)
    expect(recordCompletedGame(profile, 'invalid', 101)).toEqual(profile)
  })

  it('bounds stored game IDs to avoid unbounded growth', () => {
    let profile = emptyProfile()
    for (let index = 0; index < 110; index += 1) profile = recordCompletedGame(profile, `round-${index}`, 50)
    expect(profile.gamesPlayed).toBe(110)
    expect(profile.recentGameIds).toHaveLength(100)
    expect(profile.recentGameIds[0]).toBe('round-10')
  })

  it('works without writable storage or with corrupted JSON', () => {
    const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    expect(loadProfile(broken)).toEqual(emptyProfile())
    expect(loadHintEnabled(broken)).toBe(false)
    expect(() => saveProfile(emptyProfile(), broken)).not.toThrow()
    expect(() => saveHintEnabled(true, broken)).not.toThrow()
    const storage = memoryStorage()
    storage.setItem(PROFILE_STORAGE_KEY, '{invalid')
    expect(loadProfile(storage)).toEqual(emptyProfile())
  })
})

describe('statistik profil lengkap', () => {
  it('records wins, draws, losses, smart points, and accuracy once per game', () => {
    let profile = { ...emptyProfile(), name: 'Mentari', avatar: 'kucing' }
    profile = recordCompletedGame(profile, 'duel-1', 80, { correct: 4, total: 5, result: 'win' })
    expect(profile).toMatchObject({ wins: 1, draws: 0, losses: 0, smartPoints: 40 + 30, correctAnswers: 4, totalAnswered: 5 })
    // Idempotent: the same game must not change stats again.
    profile = recordCompletedGame(profile, 'duel-1', 80, { correct: 9, total: 9, result: 'loss' })
    expect(profile).toMatchObject({ wins: 1, losses: 0, smartPoints: 70 })
    profile = recordCompletedGame(profile, 'duel-2', 50, { correct: 2, total: 5, result: 'loss' })
    profile = recordCompletedGame(profile, 'duel-3', 50, { correct: 2, total: 5, result: 'draw' })
    expect(profile).toMatchObject({ wins: 1, draws: 1, losses: 1 })
    expect(profile.smartPoints).toBe(70 + 25 + 35)
    expect(profileSummary(profile)).toMatchObject({ winRate: 33, accuracy: 53 })
  })

  it('keeps legacy outcomes working and validates avatars', () => {
    let profile = recordCompletedGame({ ...emptyProfile(), name: 'Bintang' }, 'old-game', 60)
    expect(profile).toMatchObject({ gamesPlayed: 1, wins: 0, draws: 0, losses: 0, smartPoints: 0 })
    const saved = sanitizeProfile({ ...profile, avatar: 'kupu', apiKey: 'rahasia' })
    expect(saved.avatar).toBe('kupu')
    expect(sanitizeProfile({ ...profile, avatar: 'tidak-ada' }).avatar).toBe('bintang')
    expect(JSON.stringify(saved)).not.toContain('rahasia')
    expect(profileSummary(emptyProfile())).toMatchObject({ winRate: 0, accuracy: null })
  })
})
