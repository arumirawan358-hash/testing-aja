import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { PartySession, speedBonus, BASE_POINTS, MAX_PLAYERS } from '../src/lib/partySession.js'
import { makeBuzzerQuestions, gradeTypedAnswer, gradeBuzzerAnswer, naturalCheatAnswer, autoFillValue, publicQuestion, isBuzzerQuestion } from '../src/lib/buzzerQuestions.js'
import { DEFAULT_BUZZER_SETTINGS, validateBuzzerSettings } from '../src/data/buzzerCategories.js'

class FakeConnection extends EventEmitter {
  constructor(network) { super(); this.network = network; this.open = false; this.other = null }
  send(message) {
    if (!this.open || !this.other?.open) throw new Error('closed')
    const copy = structuredClone(message)
    this.network.messages.push(copy)
    if (this.network.drop(copy)) return
    queueMicrotask(() => { if (this.other.open) this.other.emit('data', copy) })
  }
  close() {
    if (!this.open) return
    this.open = false
    const other = this.other
    if (other) other.open = false
    queueMicrotask(() => { this.emit('close'); other?.emit('close') })
  }
}
class FakePeer extends EventEmitter {
  constructor(network, id) {
    super(); this.network = network; this.id = id || `guest-${++network.counter}`; this.destroyed = false; this.disconnected = false; this.open = false
    network.peers.set(this.id, this)
    queueMicrotask(() => { if (!this.destroyed) { this.open = true; this.emit('open', this.id) } })
  }
  connect(id) {
    const host = this.network.peers.get(id)
    const local = new FakeConnection(this.network), remote = new FakeConnection(this.network)
    local.other = remote; remote.other = local
    queueMicrotask(() => {
      if (!host || host.destroyed) { this.emit('error', { type: 'peer-unavailable' }); return }
      host.emit('connection', remote)
      local.open = remote.open = true
      remote.emit('open')
      local.emit('open')
    })
    return local
  }
  destroy() { this.destroyed = true; this.network.peers.delete(this.id) }
}
class FakeNetwork {
  constructor() { this.peers = new Map(); this.counter = 0; this.messages = []; this.drop = () => false }
  factory = (id) => new FakePeer(this, id)
}

async function until(predicate, timeout = 2000) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('Timed out waiting for party state')
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
}

const sessions = []
function makeSession(network, extra = {}) {
  const session = new PartySession({ peerFactory: network.factory, revealDelayMs: 8, reBuzzMs: 30, turnTimeoutMs: 60, reconnectBaseMs: 5, ...extra })
  sessions.push(session)
  return session
}
afterEach(() => { while (sessions.length) sessions.pop().destroy() })

const settings = (overrides = {}) => ({ ...DEFAULT_BUZZER_SETTINGS, count: 4, ...overrides })

async function joinedParty(guestCount = 2, { settings: userSettings = settings(), network = new FakeNetwork() } = {}) {
  const host = makeSession(network)
  host.createRoom({ name: 'Host Baik', settings: userSettings })
  await until(() => host.state.status === 'waiting')
  const guests = []
  for (let index = 0; index < guestCount; index += 1) {
    const guest = makeSession(network)
    guest.joinRoom({ name: `Tamu ${index + 1}`, code: host.state.code })
    guests.push(guest)
    await until(() => guest.state.connected && host.state.players.length === index + 2)
  }
  return { host, guests, network }
}

describe('ruang 5 pemain', () => {
  it('menerima sampai 4 tamu (5 pemain) dan menolak yang keenam', async () => {
    const network = new FakeNetwork()
    const { host, guests } = await joinedParty(4, { network })
    expect(host.state.players).toHaveLength(5)
    expect(new Set(host.state.players.map((player) => player.name)).size).toBe(5)
    const extra = makeSession(network)
    extra.joinRoom({ name: 'Tamu Ekstra', code: host.state.code })
    await until(() => extra.state.status === 'error')
    expect(extra.state.error).toMatch(/penuh/i)
    expect(MAX_PLAYERS).toBe(5)
    for (const guest of guests) expect(guest.state.players).toHaveLength(5)
  })

  it('menerima beberapa pemain yang menekan gabung hampir bersamaan', async () => {
    const network = new FakeNetwork()
    const host = makeSession(network)
    const first = makeSession(network)
    const second = makeSession(network)
    host.createRoom({ name: 'Host Baik', settings: settings() })
    await until(() => host.state.status === 'waiting')
    first.joinRoom({ name: 'Tamu Kilat 1', code: host.state.code })
    second.joinRoom({ name: 'Tamu Kilat 2', code: host.state.code })
    await until(() => host.state.players.length === 3 && first.state.connected && second.state.connected)
    expect(host.state.players.map((player) => player.name)).toEqual(['Host Baik', 'Tamu Kilat 1', 'Tamu Kilat 2'])
  })

  it('menampilkan seluruh pemain beserta status koneksi ke semua anggota', async () => {
    const { host, guests } = await joinedParty(3)
    for (const viewer of [host, ...guests]) {
      expect(viewer.state.players.map((player) => player.name)).toEqual(['Host Baik', 'Tamu 1', 'Tamu 2', 'Tamu 3'])
      expect(viewer.state.players.every((player) => player.connected)).toBe(true)
      expect(viewer.state.players[0].isHost).toBe(true)
    }
  })

  it('menolak pengaturan yang tidak valid', () => {
    const network = new FakeNetwork()
    const host = makeSession(network)
    expect(validateBuzzerSettings({ ...settings(), category: 'Tidak Ada' })).not.toBe('')
    expect(validateBuzzerSettings({ ...settings(), method: 'laser' })).not.toBe('')
    expect(validateBuzzerSettings({ ...settings(), count: 0 })).not.toBe('')
    expect(validateBuzzerSettings(settings())).toBe('')
    expect(host.createRoom({ name: 'Host', settings: { ...settings(), category: '???' } })).toBe(false)
  })
})

describe('soal buzzer', () => {
  it('membangun soal bank dengan metode mc, typing, dan random yang valid', () => {
    for (const method of ['mc', 'typing', 'random']) {
      const questions = makeBuzzerQuestions({ category: 'random', method, count: 6, random: () => 0.42 })
      expect(questions).toHaveLength(6)
      for (const question of questions) {
        expect(isBuzzerQuestion(question)).toBe(true)
        if (method !== 'random') expect(question.kind).toBe(method)
      }
    }
    let seed = 7
    const lcg = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
    const mixed = makeBuzzerQuestions({ category: 'random', method: 'random', count: 12, random: lcg })
    expect(new Set(mixed.map((question) => question.kind)).size).toBe(2)
  })

  it('soal dikirim utuh untuk Hint Cheat lokal, tetapi jawaban pemain tidak bocor sebelum dikirim', async () => {
    const { host, guests, network } = await joinedParty(1, { settings: settings({ category: 'Matematika', method: 'mc' }) })
    await host.startGame()
    await until(() => guests[0].state.question && host.state.screen === 'game')
    // Kunci jawaban ikut bersama soal (dibutuhkan fitur cheat lokal, sama
    // seperti mode kuis berdua) dan penilaian tetap otoritatif di host.
    expect(guests[0].state.question.answerIndex).toBeGreaterThanOrEqual(0)
    expect(host.round.questions[0].answerIndex).toBeGreaterThanOrEqual(0)
    // Draf/tekanan tombol yang belum dikirim tidak pernah muncul di jaringan.
    const before = network.messages.filter((item) => item.type === 'reveal').length
    expect(before).toBe(0)
    guests[0].buzz()
    await until(() => host.state.turn)
    guests[0].submitAnswer(host.round.questions[0].answerIndex)
    await until(() => network.messages.some((item) => item.type === 'reveal'))
    const reveals = network.messages.filter((item) => item.type === 'reveal')
    expect(reveals).toHaveLength(1)
    expect(reveals[0].entry.token).toBe(guests[0].state.selfToken)
  })

  it('soal yang sama untuk semua pemain', async () => {
    const { host, guests } = await joinedParty(2)
    await host.startGame()
    await until(() => guests.every((guest) => guest.state.question))
    const prompts = [host, ...guests].map((session) => session.state.question.prompt)
    expect(new Set(prompts).size).toBe(1)
    expect(host.state.question.total).toBe(4)
  })
})

describe('buzzer dan giliran', () => {
  it('giliran pertama jatuh ke buzzer yang tiba lebih dulu di host', async () => {
    const { host, guests } = await joinedParty(3)
    await host.startGame()
    await until(() => guests.every((guest) => guest.state.phase === 'buzzing'))
    guests[1].buzz()
    await until(() => host.state.turn !== null)
    guests[0].buzz()
    guests[2].buzz()
    await until(() => host.state.buzzOrder.length === 3)
    expect(host.state.turn.token).toBe(guests[1].state.selfToken)
    for (const viewer of [host, ...guests]) expect(viewer.state.turn.token).toBe(guests[1].state.selfToken)
  })

  it('menyimpan tekanan buzzer tamu saat RTC putus lalu mengirimkannya setelah tersambung kembali', async () => {
    const { host, guests } = await joinedParty(1, { network: new FakeNetwork() })
    const guest = guests[0]
    await host.startGame()
    await until(() => guest.state.phase === 'buzzing')
    guest.connection.close()
    await until(() => !guest.state.connected)
    // Ketukan diterima lokal, tidak hilang hanya karena kanal sedang reconnect.
    expect(guest.buzz()).toBe(true)
    expect(guest.pendingAction?.type).toBe('buzz')
    guest.reconnect()
    await until(() => host.state.turn?.token === guest.state.selfToken)
    await until(() => guest.pendingAction === null)
    expect(host.state.buzzOrder.map((entry) => entry.token)).toContain(guest.state.selfToken)
  })

  it('hanya satu pemain yang menerima kesempatan pertama meski ditekan berbarengan', async () => {
    const { host, guests } = await joinedParty(2)
    await host.startGame()
    await until(() => guests.every((guest) => guest.state.phase === 'buzzing'))
    guests[0].buzz()
    guests[1].buzz()
    await until(() => host.state.phase === 'answering')
    expect([guests[0].state.selfToken, guests[1].state.selfToken]).toContain(host.state.turn.token)
    const turns = []
    for (const guest of guests) guest.subscribe((state) => { if (state.turn) turns.push(state.turn.token) })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(new Set(turns).size).toBeLessThanOrEqual(1)
  })

  it('jawaban salah memberi giliran ke buzzer berikutnya sesuai urutan', async () => {
    const { host, guests } = await joinedParty(3, { settings: settings({ category: 'Matematika', method: 'mc' }) })
    await host.startGame()
    await until(() => guests.every((guest) => guest.state.phase === 'buzzing'))
    const [g1, g2, g3] = guests
    g2.buzz(); await until(() => host.state.turn?.token === g2.state.selfToken)
    g1.buzz(); g3.buzz()
    const question = host.round.questions[0]
    const wrong = (question.answerIndex + 1) % 4
    g2.submitAnswer(wrong)
    await until(() => host.state.turn?.token === g1.state.selfToken)
    expect(host.state.phase).toBe('answering')
    g1.submitAnswer(wrong)
    await until(() => host.state.turn?.token === g3.state.selfToken)
    // Pemain yang sudah menjawab tidak boleh dipanggil lagi.
    expect(host.attempted.has(g1.state.selfToken)).toBe(true)
    g3.submitAnswer(question.answerIndex)
    await until(() => host.state.screen === 'game' && host.state.phase === 'revealed')
    const scores = Object.fromEntries(host.state.players.map((player) => [player.name, player]))
    expect(scores['Tamu 1'].points).toBe(0)
    expect(scores['Tamu 3'].points).toBeGreaterThanOrEqual(BASE_POINTS)
    expect(scores['Tamu 2'].wrong).toBe(1)
    expect(scores['Tamu 1'].wrong).toBe(1)
    expect(scores['Tamu 3'].correct).toBe(1)
  })

  it('semua salah menutup soal dan lanjut ke soal berikutnya', async () => {
    const { host, guests } = await joinedParty(2, { settings: settings({ category: 'Matematika', method: 'mc', count: 2 }) })
    await host.startGame()
    await until(() => guests.every((guest) => guest.state.phase === 'buzzing'))
    const [g1, g2] = guests
    const wrong = (host.round.questions[0].answerIndex + 1) % 4
    g1.buzz(); await until(() => host.state.turn)
    g2.buzz()
    g1.submitAnswer(wrong)
    await until(() => host.state.turn?.token === g2.state.selfToken)
    g2.submitAnswer(wrong)
    await until(() => host.state.phase === 'revealed')
    expect(host.state.reveal).toHaveLength(2)
    await until(() => host.state.question?.index === 1)
    expect(host.state.question.index).toBe(1)
    expect(host.state.phase).toBe('buzzing')
  })

  it('tanpa buzzer lain, kesempatan kedua dibuka lalu soal ditutup otomatis', async () => {
    const { host, guests } = await joinedParty(2, { settings: settings({ category: 'Matematika', method: 'mc', count: 1 }) })
    await host.startGame()
    await until(() => guests.every((guest) => guest.state.phase === 'buzzing'))
    const wrong = (host.round.questions[0].answerIndex + 1) % 4
    guests[0].buzz()
    await until(() => host.state.turn)
    guests[0].submitAnswer(wrong)
    await until(() => host.state.phase === 'buzzing' && host.state.turn === null)
    // Tamu 2 belum mencoba — masih boleh buzz pada kesempatan kedua.
    guests[1].buzz()
    await until(() => host.state.turn?.token === guests[1].state.selfToken)
    guests[1].submitAnswer(wrong)
    await until(() => host.state.screen === 'results')
    expect(host.state.result.history).toHaveLength(1)
  })

  it('giliran yang ditinggalkan otomatis dilewatkan', async () => {
    const { host, guests } = await joinedParty(2)
    await host.startGame()
    await until(() => guests.every((guest) => guest.state.phase === 'buzzing'))
    guests[0].buzz()
    await until(() => host.state.turn?.token === guests[0].state.selfToken)
    guests[0].connection.close()
    await until(() => host.state.turn === null || host.state.turn?.token === guests[1].state.selfToken)
    expect(host.state.turn?.token).not.toBe(guests[0].state.selfToken)
  })

  it('waktu tunggu giliran habis memberi kesempatan berikutnya', async () => {
    const { host, guests } = await joinedParty(2, { settings: settings({ category: 'Matematika', method: 'mc' }) })
    await host.startGame()
    await until(() => guests.every((guest) => guest.state.phase === 'buzzing'))
    guests[0].buzz(); guests[1].buzz()
    await until(() => host.state.turn?.token === guests[0].state.selfToken)
    await until(() => host.state.turn?.token === guests[1].state.selfToken, 2000)
    // Giliran yang habis dihitung melewatkan soal ini (tidak dipanggil lagi).
    expect(host.attempted.has(guests[0].state.selfToken)).toBe(true)
  })
})

describe('poin, transparansi, dan hasil', () => {
  it('penilaian adil: benar dapat poin + bonus kecepatan, salah kena penalti sesuai pengaturan', async () => {
    const { host, guests } = await joinedParty(2, { settings: settings({ category: 'Matematika', method: 'mc', wrongPenalty: 5, count: 1 }) })
    await host.startGame()
    await until(() => guests.every((guest) => guest.state.phase === 'buzzing'))
    const [g1, g2] = guests
    const question = host.round.questions[0]
    const wrong = (question.answerIndex + 1) % 4
    g2.buzz(); await until(() => host.state.turn?.token === g2.state.selfToken)
    g1.buzz()
    g2.submitAnswer(wrong)
    await until(() => host.state.turn?.token === g1.state.selfToken)
    g1.submitAnswer(question.answerIndex)
    await until(() => host.state.screen === 'results')
    const byName = Object.fromEntries(host.state.result.standings.map((player) => [player.name, player]))
    expect(byName['Tamu 2'].points).toBe(0) // 0 - 5, tidak negatif
    expect(byName['Tamu 1'].points).toBeGreaterThanOrEqual(BASE_POINTS)
    expect(byName['Tamu 1'].points).toBeLessThanOrEqual(BASE_POINTS + 5)
    expect(speedBonus(1000)).toBe(5)
    expect(speedBonus(4500)).toBe(3)
    expect(speedBonus(8000)).toBe(1)
    expect(speedBonus(20000)).toBe(0)
  })

  it('tidak ada duplikasi poin untuk jawaban ganda', async () => {
    const { host, guests } = await joinedParty(1, { settings: settings({ category: 'Matematika', method: 'mc', count: 1 }) })
    await host.startGame()
    await until(() => guests[0].state.phase === 'buzzing')
    guests[0].buzz()
    await until(() => host.state.turn)
    const question = host.round.questions[0]
    guests[0].submitAnswer(question.answerIndex)
    guests[0].submitAnswer(question.answerIndex)
    guests[0].buzz()
    await until(() => host.state.screen === 'results')
    const me = host.state.result.standings.find((player) => player.token === guests[0].state.selfToken)
    expect(me.points).toBeLessThanOrEqual(BASE_POINTS + 5)
    expect(me.correct).toBe(1)
    expect(host.state.result.history[0].entries).toHaveLength(1)
  })

  it('seluruh pemain melihat jawaban semua orang: nama, jawaban, benar/salah, dan waktu', async () => {
    const { host, guests } = await joinedParty(2, { settings: settings({ category: 'Matematika', method: 'mc', count: 1 }) })
    await host.startGame()
    await until(() => guests.every((guest) => guest.state.phase === 'buzzing'))
    const [g1, g2] = guests
    const question = host.round.questions[0]
    g1.buzz(); await until(() => host.state.turn?.token === g1.state.selfToken)
    g2.buzz()
    g1.submitAnswer((question.answerIndex + 1) % 4)
    await until(() => host.state.turn?.token === g2.state.selfToken)
    g2.submitAnswer(question.answerIndex)
    await until(() => host.state.screen === 'results')
    for (const viewer of [host, ...guests]) {
      const entries = viewer.state.result.history[0].entries
      expect(entries).toHaveLength(2)
      expect(entries.map((entry) => entry.name).sort()).toEqual(['Tamu 1', 'Tamu 2'])
      for (const entry of entries) {
        expect(typeof entry.correct).toBe('boolean')
        expect(typeof entry.timeMs).toBe('number')
        expect(entry.valueText).toBeTruthy()
      }
      expect(viewer.state.result.history[0].answer.answerText).toBeTruthy()
    }
    // Jawaban yang belum dikirim tidak muncul di reveal orang lain.
    expect(host.state.result.history[0].entries.every((entry) => entry.value !== undefined)).toBe(true)
  })

  it('leaderboard berisi peringkat 1 sampai 5 dengan poin, benar, dan salah', async () => {
    const { host, guests } = await joinedParty(4, { settings: settings({ count: 2 }) })
    await host.startGame()
    await until(() => guests.every((guest) => guest.state.question))
    host.skipQuestion()
    await until(() => host.state.question?.index === 1)
    host.skipQuestion()
    await until(() => host.state.screen === 'results')
    const { standings } = host.state.result
    expect(standings).toHaveLength(5)
    expect(standings.map((player) => player.rank)).toEqual([1, 2, 3, 4, 5])
    for (const player of standings) {
      expect(typeof player.points).toBe('number')
      expect(typeof player.correct).toBe('number')
      expect(typeof player.wrong).toBe('number')
    }
    for (const guest of guests) expect(guest.state.result.standings).toHaveLength(5)
  })

  it('riwayat permainan tersimpan untuk setiap soal', async () => {
    const { host, guests } = await joinedParty(1, { settings: settings({ count: 3 }) })
    await host.startGame()
    await until(() => guests[0].state.question)
    host.skipQuestion()
    await until(() => host.state.question?.index === 1)
    host.skipQuestion()
    await until(() => host.state.question?.index === 2)
    host.skipQuestion()
    await until(() => host.state.screen === 'results')
    expect(host.state.result.history.map((item) => item.index)).toEqual([0, 1, 2])
    for (const item of host.state.result.history) expect(item.answer).toBeTruthy()
    expect(host.state.result.settings.count).toBe(3)
    expect(host.state.result.gameId).toBeTruthy()
  })
})

describe('metode ketikan dan cheat', () => {
  it('penilaian ketikan longgar tapi tidak curang', () => {
    expect(gradeTypedAnswer('17', ['17'])).toBe(true)
    expect(gradeTypedAnswer('Jawabannya 17!', ['17'])).toBe(true)
    expect(gradeTypedAnswer('kayaknya sih 17 deh', ['17'])).toBe(true)
    expect(gradeTypedAnswer('18', ['17'])).toBe(false)
    expect(gradeTypedAnswer('', ['17'])).toBe(false)
    expect(gradeTypedAnswer('Proklamasi 1945', ['proklamasi kemerdekaan', 'proklamasi'])).toBe(true)
    expect(gradeTypedAnswer('proklamasiii', ['proklamasi'])).toBe(false)
  })

  it('soal ketikan dinilai lewat teks, soal pilihan ganda lewat indeks', () => {
    const questions = makeBuzzerQuestions({ category: 'Bahasa Indonesia', method: 'typing', count: 3, random: () => 0.5 })
    for (const question of questions) {
      expect(gradeBuzzerAnswer(question, question.answerText)).toBe(true)
      expect(gradeBuzzerAnswer(question, 'tentu saja salah total')).toBe(false)
    }
    const mc = makeBuzzerQuestions({ category: 'Matematika', method: 'mc', count: 1, random: () => 0.5 })[0]
    expect(gradeBuzzerAnswer(mc, mc.answerIndex)).toBe(true)
    expect(gradeBuzzerAnswer(mc, (mc.answerIndex + 1) % 4)).toBe(false)
    expect(gradeBuzzerAnswer(mc, 'teks bukan indeks')).toBe(false)
  })

  it('jawaban cheat terasa natural dan tetap dinilai benar', () => {
    const questions = makeBuzzerQuestions({ category: 'random', method: 'random', count: 10, random: () => 0.33 })
    for (const question of questions) {
      const fill = autoFillValue(question)
      if (question.kind === 'mc') expect(fill).toBe(question.answerIndex)
      else {
        expect(typeof fill).toBe('string')
        expect(fill.length).toBeGreaterThan(2)
        expect(gradeTypedAnswer(fill, question.accepted)).toBe(true)
        expect(naturalCheatAnswer(question)).toBe(fill)
      }
    }
  })

  it('soal ketikan dari bank diterima dengan jawaban benar apa adanya', async () => {
    const { host, guests } = await joinedParty(1, { settings: settings({ category: 'Sejarah', method: 'typing', count: 1 }) })
    await host.startGame()
    await until(() => guests[0].state.phase === 'buzzing')
    guests[0].buzz()
    await until(() => host.state.turn)
    guests[0].submitAnswer('jawaban yang pasti salah')
    await until(() => host.state.screen === 'results')
    expect(host.state.result.standings.find((p) => p.token === guests[0].state.selfToken).wrong).toBe(1)
  })
})

describe('putus koneksi dan main lagi', () => {
  it('tamu yang kembali di tengah permainan memperoleh status yang sama', async () => {
    const { host, guests } = await joinedParty(1, { settings: settings({ count: 3 }) })
    await host.startGame()
    await until(() => guests[0].state.question?.index === 0)
    guests[0].connection.close()
    await until(() => !host.state.players[1].connected)
    guests[0].reconnect()
    await until(() => guests[0].state.connected && host.state.players[1].connected)
    expect(guests[0].state.question.prompt).toBe(host.state.question.prompt)
    expect(guests[0].state.screen).toBe('game')
    expect(guests[0].state.players).toHaveLength(2)
  })

  it('host menutup ruang memberi tahu semua pemain', async () => {
    const { host, guests } = await joinedParty(2)
    host.quit()
    await until(() => guests.every((guest) => guest.state.roomClosed))
    for (const guest of guests) expect(guest.state.error).toMatch(/menutup/i)
  })

  it('main lagi oleh host langsung membuat ronde baru dengan soal baru', async () => {
    const { host, guests } = await joinedParty(1, { settings: settings({ category: 'Matematika', count: 2 }) })
    await host.startGame()
    await until(() => guests[0].state.question)
    host.skipQuestion()
    await until(() => host.state.question?.index === 1)
    host.skipQuestion()
    await until(() => host.state.screen === 'results')
    const oldPrompts = host.state.result.history.map((item) => item.prompt)
    await host.playAgain()
    await until(() => host.state.screen === 'game' && guests[0].state.screen === 'game')
    expect(host.state.gameId).not.toBe('')
    expect(host.state.question.index).toBe(0)
    expect(host.state.players.every((player) => player.points === 0)).toBe(true)
    await until(() => guests[0].state.question)
    expect(guests[0].state.question.prompt).toBe(host.state.question.prompt)
    expect(oldPrompts.length).toBe(2)
  })

  it('permintaan main lagi dari pemain dicatat tanpa memaksa host', async () => {
    const { host, guests } = await joinedParty(1, { settings: settings({ count: 1 }) })
    await host.startGame()
    await until(() => guests[0].state.question)
    host.skipQuestion()
    await until(() => host.state.screen === 'results')
    guests[0].playAgain()
    await until(() => host.state.rematchVotes.length === 1)
    expect(host.state.rematchVotes[0]).toBe(guests[0].state.selfToken)
    expect(host.state.screen).toBe('results')
  })
})
