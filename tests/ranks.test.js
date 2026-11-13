import { describe, expect, it } from 'vitest'
import { RANKS, accuracyOf, getRank, pointsForGame, sanitizeWireProfile, toViewProfile, winRateOf } from '../src/lib/ranks.js'

describe('rank kepintaran', () => {
  it('menempatkan poin pada kelas rank yang tepat dengan bling bertingkat', () => {
    expect(getRank(0)).toMatchObject({ tier: 0, name: 'Tunas Bintang', bling: 0 })
    expect(getRank(99)).toMatchObject({ tier: 0 })
    expect(getRank(100)).toMatchObject({ tier: 1, name: 'Bintang Muda', bling: 1 })
    expect(getRank(300)).toMatchObject({ tier: 2, name: 'Bintang Terang', bling: 2 })
    expect(getRank(700)).toMatchObject({ tier: 3, name: 'Bintang Cemerlang', bling: 3 })
    expect(getRank(1500)).toMatchObject({ tier: 4, name: 'Bintang Gemilang', bling: 4 })
    expect(getRank(2500)).toMatchObject({ tier: 5, name: 'Bintang Agung', bling: 5 })
    expect(getRank(4000)).toMatchObject({ tier: 6, name: 'Galaksi Cendekia', bling: 6 })
    expect(getRank(999999)).toMatchObject({ tier: 6 })
    // Bling naik mengikuti tier dan setiap rank punya nama unik.
    expect(RANKS.map((rank) => rank.bling)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(new Set(RANKS.map((rank) => rank.name)).size).toBe(RANKS.length)
  })

  it('memberi progres menuju rank berikutnya', () => {
    const rank = getRank(200)
    expect(rank.nextName).toBe('Bintang Terang')
    expect(rank.nextPoints).toBe(300)
    expect(rank.progress).toBe(50)
    expect(getRank(99999999).nextName).toBe(null)
    expect(getRank(99999999).progress).toBe(100)
  })

  it('menghitung poin dari jawaban benar, hasil, dan bonus sempurna', () => {
    expect(pointsForGame({ correct: 0, total: 0, result: 'solo' })).toBe(0)
    expect(pointsForGame({ correct: 3, total: 5, result: 'solo' })).toBe(30)
    expect(pointsForGame({ correct: 5, total: 5, result: 'win' })).toBe(50 + 30 + 20)
    expect(pointsForGame({ correct: 2, total: 5, result: 'draw' })).toBe(20 + 15)
    expect(pointsForGame({ correct: 1, total: 5, result: 'loss' })).toBe(10 + 5)
    expect(pointsForGame()).toBe(0)
  })

  it('menghitung winrate dan kepintaran dengan batas aman', () => {
    expect(winRateOf(3, 1, 0)).toBe(75)
    expect(winRateOf(0, 0, 0)).toBe(0)
    expect(winRateOf('x', -4, null)).toBe(0)
    expect(accuracyOf(7, 10)).toBe(70)
    expect(accuracyOf(0, 0)).toBe(null)
    expect(accuracyOf(-3, 'y')).toBe(null)
  })

  it('membuat profil ringkas yang aman dikirim dan menyaring data lawan yang jahat', () => {
    const view = toViewProfile({ name: 'Bintang', avatar: 'kucing', smartPoints: 750, wins: 2, draws: 1, losses: 1, gamesPlayed: 4, correctAnswers: 20, totalAnswered: 30 })
    expect(view).toMatchObject({ name: 'Bintang', avatar: 'kucing', smartPoints: 750, winRate: 50, accuracy: 67 })
    expect(view.rank).toMatchObject({ tier: 3, name: 'Bintang Cemerlang', bling: 3 })

    const wire = sanitizeWireProfile({ ...view, name: '  Teman  ', rank: { name: 'PALSU', bling: 99, tier: 99 } })
    expect(wire.rank).toMatchObject({ tier: 3, name: 'Bintang Cemerlang', bling: 3 })
    expect(sanitizeWireProfile({ name: 'Jahat', smartPoints: '99999999999', wins: -50, accuracy: 250 })).toMatchObject({ smartPoints: 99999999, wins: 0, accuracy: 100 })
    expect(sanitizeWireProfile({ smartPoints: 500 })).toBe(null)
    expect(sanitizeWireProfile('bukan objek')).toBe(null)
    expect(sanitizeWireProfile(null)).toBe(null)
    expect(sanitizeWireProfile({ name: 'X'.repeat(999) }).name).toHaveLength(24)
  })
})

describe('akurasi profil lawan', () => {
  it('null tetap "belum ada" saat profil melintasi kabel', () => {
    const view = toViewProfile({ name: 'Bintang', smartPoints: 0 })
    expect(view.accuracy).toBeNull()
    const wire = sanitizeWireProfile({ ...view })
    expect(wire.accuracy).toBeNull()
    expect(sanitizeWireProfile({ name: 'Bintang', accuracy: null }).accuracy).toBeNull()
    expect(sanitizeWireProfile({ name: 'Bintang', accuracy: 42 }).accuracy).toBe(42)
    expect(sanitizeWireProfile({ name: 'Bintang', totalAnswered: 4, correctAnswers: 2 }).accuracy).toBe(50)
  })
})
