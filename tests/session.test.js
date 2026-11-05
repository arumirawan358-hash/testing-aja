import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GameSession } from '../src/lib/gameSession.js'
import { DEFAULT_CONFIG } from '../src/data/subjects.js'

class FakeConnection extends EventEmitter {
  constructor(network) { super(); this.network = network; this.open = false; this.other = null }
  send(message) {
    if (!this.open || !this.other?.open) throw new Error('closed')
    const copy = structuredClone(message)
    this.network.messages.push(copy)
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
    super(); this.network = network; this.id = id || `guest-${++network.counter}`; this.destroyed = false; this.disconnected = false
    network.peers.set(this.id, this)
    queueMicrotask(() => { if (!this.destroyed) this.emit('open', this.id) })
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
  reconnect() { this.disconnected = false }
  destroy() { this.destroyed = true; this.network.peers.delete(this.id) }
}
class FakeNetwork {
  constructor() { this.peers = new Map(); this.counter = 0; this.messages = [] }
  factory = (id) => new FakePeer(this, id)
}
async function until(predicate, timeout = 2000) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('Timed out waiting for game state')
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
}
const sessions = []
function session(network, extra = {}) { const s = new GameSession({ peerFactory: network.factory, ...extra }); sessions.push(s); return s }
afterEach(() => { while (sessions.length) sessions.pop().destroy() })
const questionsFor = (round, count) => Array.from({ length: count }, (_, i) => ({ id: `q-${i}`, prompt: `Soal ronde ${round} nomor ${i}`, options: ['A', 'B', 'C', 'D'], answer: 0, explanation: 'A benar.' }))
const finish = (game) => { while (game.state.screen === 'quiz') game.submitAnswer(game.state.questions[game.state.answers.length].answer) }

async function joinedGame(count = 3) {
  const network = new FakeNetwork()
  const host = session(network), guest = session(network)
  const config = { ...DEFAULT_CONFIG, source: 'bank', count }
  host.createRoom({ name: 'Bintang', config })
  await until(() => host.state.status === 'waiting')
  guest.joinRoom({ name: 'Mentari', code: host.state.code })
  await until(() => host.state.connected && guest.state.connected)
  return { network, host, guest, config }
}

async function joinedGroqGame(count = 2) {
  const network = new FakeNetwork()
  let round = 0
  const groqFactory = vi.fn(async (config, _key, { onProgress }) => {
    onProgress(config.count, config.count)
    return questionsFor(++round, config.count)
  })
  const host = session(network, { groqFactory }), guest = session(network)
  const key = 'private-test-key-123'
  const config = { ...DEFAULT_CONFIG, source: 'groq', count, topic: 'Pecahan', apiKey: key, arbitrarySecret: key }
  host.createRoom({ name: 'Bintang', config, apiKey: key })
  await until(() => host.state.status === 'waiting')
  guest.joinRoom({ name: 'Mentari', code: host.state.code })
  await until(() => host.state.connected && guest.state.connected)
  return { network, host, guest, key, groqFactory }
}

describe('ruang dua pemain', () => {
  it('sends the same questions, synchronizes progress, and scores both players', async () => {
    const { host, guest } = await joinedGame(41)
    await host.startGame()
    await until(() => host.state.screen === 'quiz' && guest.state.screen === 'quiz')
    expect(guest.state.questions).toEqual(host.state.questions)
    for (const question of host.state.questions) host.submitAnswer(question.answer)
    for (const question of guest.state.questions) guest.submitAnswer((question.answer + 1) % 4)
    await until(() => guest.state.screen === 'results')
    expect(host.state.result.host.score).toBe(100)
    expect(guest.state.result.guest.score).toBe(0)
    expect(guest.state.result).toEqual(host.state.result)
  })

  it('rejects a third player without disturbing the first two', async () => {
    const { network, host, guest } = await joinedGame()
    const third = session(network)
    third.joinRoom({ name: 'Orang Ketiga', code: host.state.code })
    await until(() => third.state.status === 'error')
    expect(third.state.error).toContain('penuh')
    expect(host.state.connected && guest.state.connected).toBe(true)
  })

  it('can reconnect the guest during a game without losing answers', async () => {
    const { host, guest } = await joinedGame(3)
    await host.startGame()
    await until(() => host.state.screen === 'quiz' && guest.state.screen === 'quiz')
    guest.submitAnswer(guest.state.questions[0].answer)
    guest.connection.close()
    await until(() => !host.state.connected && !guest.state.connected)
    guest.reconnect()
    await until(() => host.state.connected && guest.state.connected && guest.state.status === 'playing')
    expect(guest.state.answers).toHaveLength(1)
    finish(host); finish(guest)
    await until(() => guest.state.screen === 'results')
    expect(guest.state.result.guest.score).toBe(100)
  })

  it('requires a Groq key for a solo player or host, never for the guest', async () => {
    const network = new FakeNetwork()
    const solo = session(network), host = session(network)
    expect(await solo.startSolo({ name: 'Bintang', config: DEFAULT_CONFIG })).toBe(false)
    expect(solo.state.error).toContain('API key Groq')
    expect(host.createRoom({ name: 'Bintang', config: DEFAULT_CONFIG })).toBe(false)
    expect(host.state.error).toContain('API key Groq')
    const game = await joinedGroqGame()
    expect(game.guest.state.connected).toBe(true)
    expect(game.guest.aiKey).toBe('')
  })

  it('prepares Groq questions once on the host and never sends the key or arbitrary fields to the guest', async () => {
    const { network, host, guest, key, groqFactory } = await joinedGroqGame()
    await host.startGame()
    await until(() => guest.state.screen === 'quiz')
    expect(groqFactory).toHaveBeenCalledTimes(1)
    expect(groqFactory.mock.calls[0][1]).toBe(key)
    expect(groqFactory.mock.calls[0][0]).toMatchObject({ source: 'groq', topic: 'Pecahan', count: 2 })
    expect(guest.state.questions).toEqual(host.state.questions)
    expect(JSON.stringify(network.messages)).not.toContain(key)
    expect(JSON.stringify(host.state)).not.toContain(key)
    expect(JSON.stringify(guest.state)).not.toContain(key)
    expect(guest.state.config).not.toHaveProperty('apiKey')
    expect(guest.state.config).not.toHaveProperty('arbitrarySecret')
    finish(host); finish(guest)
    await until(() => guest.state.screen === 'results')
    expect(guest.state.result.host.score).toBe(100)
    expect(guest.state.result.guest.score).toBe(100)
    host.quit()
    expect(host.aiKey).toBe('')
  })

  it('waits for both players to agree on a rematch and avoids the previous round', async () => {
    const { host, guest, key, groqFactory } = await joinedGroqGame()
    await host.startGame()
    await until(() => host.state.screen === 'quiz' && guest.state.screen === 'quiz')
    const oldPrompts = host.state.questions.map((item) => item.prompt)
    finish(host); finish(guest)
    await until(() => host.state.screen === 'results' && guest.state.screen === 'results')
    await host.playAgain()
    await until(() => guest.state.opponentRematchRequested)
    expect(host.state.screen).toBe('results')
    expect(guest.state.screen).toBe('results') // The guest can finish reading the review first.
    await guest.playAgain()
    await until(() => host.state.screen === 'lobby' && guest.state.screen === 'lobby')
    expect(host.state.connected && guest.state.connected).toBe(true)
    expect(host.aiKey).toBe(key)
    await host.startGame()
    await until(() => guest.state.screen === 'quiz')
    expect(groqFactory.mock.calls[1][2].avoidPrompts).toEqual(oldPrompts)
    expect(host.state.questions.map((item) => item.prompt)).not.toEqual(oldPrompts)
    expect(guest.state.questions).toEqual(host.state.questions)
  })

  it('also supports a guest-first rematch request', async () => {
    const { host, guest } = await joinedGame(1)
    await host.startGame()
    await until(() => guest.state.screen === 'quiz')
    finish(host); finish(guest)
    await until(() => guest.state.screen === 'results')
    await guest.playAgain()
    await until(() => host.state.opponentRematchRequested)
    expect(guest.state.rematchRequested).toBe(true)
    await host.playAgain()
    await until(() => host.state.screen === 'lobby' && guest.state.screen === 'lobby')
    expect(host.state.rematchRequested).toBe(false)
    expect(guest.state.rematchRequested).toBe(false)
  })

  it('rejoins the lobby if the rematch signal was lost during a disconnect', async () => {
    const { host, guest } = await joinedGame(1)
    await host.startGame()
    await until(() => guest.state.screen === 'quiz')
    finish(host); finish(guest)
    await until(() => guest.state.screen === 'results')
    await host.playAgain()
    await until(() => guest.state.opponentRematchRequested)
    const connection = host.connection
    const send = connection.send.bind(connection)
    connection.send = (message) => {
      if (message.type === 'rematch') { connection.close(); return }
      send(message)
    }
    await guest.playAgain()
    await until(() => host.state.screen === 'lobby' && !guest.state.connected)
    expect(guest.state.screen).toBe('results')
    guest.reconnect()
    await until(() => host.state.connected && guest.state.connected && guest.state.screen === 'lobby')
    expect(guest.state.questions).toHaveLength(0)
    expect(guest.state.rematchRequested).toBe(false)
  })

  it('preserves rematch readiness when a guest reconnects on the results screen', async () => {
    const { host, guest } = await joinedGame(1)
    await host.startGame()
    await until(() => guest.state.screen === 'quiz')
    finish(host); finish(guest)
    await until(() => guest.state.screen === 'results')
    await host.playAgain()
    await until(() => guest.state.opponentRematchRequested)
    guest.connection.close()
    await until(() => !host.state.connected && !guest.state.connected)
    guest.reconnect()
    await until(() => host.state.connected && guest.state.connected && guest.state.opponentRematchRequested)
    await guest.playAgain()
    await until(() => host.state.screen === 'lobby' && guest.state.screen === 'lobby')
  })
})

describe('solo dan riwayat variasi', () => {
  it('replays with the same settings and key, and keeps recent prompts only in memory', async () => {
    const network = new FakeNetwork()
    let round = 0
    const groqFactory = vi.fn(async (config) => questionsFor(++round, config.count))
    const solo = session(network, { groqFactory })
    const key = 'solo-private-test-key'
    const config = { ...DEFAULT_CONFIG, source: 'groq', count: 1, topic: 'Pecahan' }
    await solo.startSolo({ name: 'Bintang', config, apiKey: key })
    const oldPrompt = solo.state.questions[0].prompt
    finish(solo)
    expect(solo.state.result.host.score).toBe(100)
    await solo.playAgain()
    expect(solo.state.screen).toBe('quiz')
    expect(solo.state.questions[0].prompt).not.toBe(oldPrompt)
    expect(groqFactory.mock.calls[1][0]).toMatchObject({ level: 'SD', grade: 4, topic: 'Pecahan', count: 1 })
    expect(groqFactory.mock.calls[1][1]).toBe(key)
    expect(groqFactory.mock.calls[1][2].avoidPrompts).toEqual([oldPrompt])
    expect(JSON.stringify(solo.state)).not.toContain(key)
    solo.quit()
    expect(solo.aiKey).toBe('')
    await solo.startSolo({ name: 'Bintang', config: { ...config, topic: 'Luas' }, apiKey: key })
    expect(groqFactory.mock.calls[2][2].avoidPrompts).toEqual([])
    solo.destroy()
    expect(solo.questionHistory.size).toBe(0)
    expect(solo.aiKey).toBe('')
  })

  it('does not advertise an AI-only topic when switching to the practice bank', async () => {
    const solo = session(new FakeNetwork())
    await solo.startSolo({ name: 'Bintang', config: { ...DEFAULT_CONFIG, source: 'bank', count: 1, topic: 'Topik AI lama' } })
    expect(solo.state.config.topic).toBe('')
    expect(solo.state.screen).toBe('quiz')
  })

  it('aborts preparation and clears the key if the player leaves', async () => {
    const network = new FakeNetwork()
    const groqFactory = (_config, _key, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
    const solo = session(network, { groqFactory })
    const preparation = solo.startSolo({ name: 'Bintang', config: { ...DEFAULT_CONFIG, count: 1 }, apiKey: 'test-key' })
    expect(solo.state.status).toBe('preparing')
    solo.quit()
    await preparation
    expect(solo.state.screen).toBe('home')
    expect(solo.aiKey).toBe('')
  })
})
