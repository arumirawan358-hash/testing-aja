import { describe, expect, it } from 'vitest'
import { HINT_STORAGE_KEY, PROFILE_STORAGE_KEY, emptyProfile, loadHintEnabled, loadProfile, recordCompletedGame, sanitizeProfile, saveHintEnabled, saveProfile } from '../src/lib/preferences.js'

function memoryStorage() {
  const data = new Map()
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), data }
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
