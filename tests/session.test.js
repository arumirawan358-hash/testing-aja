import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
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

async function joinedGame(count = 3) {
  const network = new FakeNetwork()
  const host = session(network), guest = session(network)
  const config = { ...DEFAULT_CONFIG, count }
  host.createRoom({ name: 'Bintang', config })
  await until(() => host.state.status === 'waiting')
  guest.joinRoom({ name: 'Mentari', code: host.state.code })
  await until(() => host.state.connected && guest.state.connected)
  return { network, host, guest, config }
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
    for (const question of host.state.questions) host.submitAnswer(question.answer)
    while (guest.state.screen === 'quiz') guest.submitAnswer(guest.state.questions[guest.state.answers.length].answer)
    await until(() => guest.state.screen === 'results')
    expect(guest.state.result.guest.score).toBe(100)
  })

  it('prepares the same Groq questions for host and guest without requiring a player key', async () => {
    const network = new FakeNetwork()
    const groqFactory = async (config, { onProgress }) => {
      onProgress(config.count, config.count)
      return Array.from({ length: config.count }, (_, i) => ({ id: `q-${i}`, prompt: `Soal Groq ${i}`, options: ['A', 'B', 'C', 'D'], answer: 0, explanation: 'A benar.' }))
    }
    const host = session(network, { groqFactory }), guest = session(network)
    const config = { ...DEFAULT_CONFIG, source: 'groq', count: 2 }
    host.createRoom({ name: 'Bintang', config })
    await until(() => host.state.status === 'waiting')
    guest.joinRoom({ name: 'Mentari', code: host.state.code })
    await until(() => host.state.connected && guest.state.connected)
    await host.startGame()
    await until(() => guest.state.screen === 'quiz')
    expect(guest.state.questions).toEqual(host.state.questions)
    expect(host.state.questions[0].prompt).toContain('Groq')
    for (const item of host.state.questions) host.submitAnswer(item.answer)
    for (const item of guest.state.questions) guest.submitAnswer(item.answer)
    await until(() => guest.state.screen === 'results')
    expect(guest.state.result.host.score).toBe(100)
    expect(guest.state.result.guest.score).toBe(100)
  })

  it('plays a solo Groq quiz and calculates results', async () => {
    const network = new FakeNetwork()
    const groqFactory = async () => [{ id: 'q-1', prompt: 'Soal Groq?', options: ['A', 'B', 'C', 'D'], answer: 1, explanation: 'B benar.' }]
    const solo = session(network, { groqFactory })
    await solo.startSolo({ name: 'Bintang', config: { ...DEFAULT_CONFIG, source: 'groq', count: 1 } })
    expect(solo.state.screen).toBe('quiz')
    solo.submitAnswer(1)
    expect(solo.state.screen).toBe('results')
    expect(solo.state.result.host.score).toBe(100)
  })

  it('keeps the AI key out of the messages sent to another player', async () => {
    const network = new FakeNetwork()
    const key = 'private-example-api-key'
    const host = session(network, { aiFactory: async (config) => Array.from({ length: config.count }, (_, i) => ({ id: `q-${i}`, prompt: `Soal ${i}`, options: ['A', 'B', 'C', 'D'], answer: 0, explanation: 'A benar.' })) })
    const guest = session(network)
    host.createRoom({ name: 'Bintang', config: { ...DEFAULT_CONFIG, source: 'ai', count: 2 }, apiKey: key })
    await until(() => host.state.status === 'waiting')
    guest.joinRoom({ name: 'Mentari', code: host.state.code })
    await until(() => host.state.connected && guest.state.connected)
    await host.startGame()
    await until(() => guest.state.screen === 'quiz')
    expect(JSON.stringify(network.messages)).not.toContain(key)
    expect(JSON.stringify(host.state)).not.toContain(key)
  })
})
