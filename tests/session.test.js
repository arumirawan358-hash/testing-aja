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
    // Match PeerJS's JSON serialization limit, which emits an error rather than throwing.
    if (new TextEncoder().encode(JSON.stringify(copy)).length >= this.network.maxMessageBytes) {
      this.emit('error', { type: 'message-too-big' })
      return
    }
    if (this.network.drop(copy)) return
    const delivered = this.network.mutate(copy)
    queueMicrotask(() => { if (this.other.open) this.other.emit('data', delivered) })
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
    if (this.disconnected) return undefined
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
  reconnect() { this.disconnected = false; this.open = false; queueMicrotask(() => { if (!this.destroyed) { this.open = true; this.emit('open', this.id) } }) }
  destroy() { this.destroyed = true; this.network.peers.delete(this.id) }
}
class FakeNetwork {
  constructor() { this.peers = new Map(); this.counter = 0; this.messages = []; this.maxMessageBytes = 16300; this.drop = () => false; this.mutate = (message) => message }
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

async function joinedGame(count = 3, options = {}) {
  const network = options.network || new FakeNetwork()
  const host = session(network, options.hostOptions), guest = session(network, options.guestOptions)
  const config = { ...DEFAULT_CONFIG, source: 'bank', count }
  host.createRoom({ name: 'Bintang', config })
  await until(() => host.state.status === 'waiting')
  guest.joinRoom({ name: 'Mentari', code: host.state.code })
  await until(() => host.state.connected && guest.state.connected)
  return { network, host, guest, config }
}

async function joinedGroqGame(count = 2, options = {}) {
  const network = options.network || new FakeNetwork()
  let round = 0
  const groqFactory = options.groqFactory || vi.fn(async (config, _key, { onProgress }) => {
    onProgress(config.count, config.count)
    return questionsFor(++round, config.count)
  })
  const host = session(network, { ...options.sessionOptions, groqFactory }), guest = session(network)
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

  it('sends 500 long Unicode questions as small messages, even if one question exceeds the PeerJS limit', async () => {
    const longQuestions = questionsFor(1, 500).map((question) => ({
      ...question,
      prompt: `${question.prompt} ${'字'.repeat(1800)}`,
      options: ['A', 'B', 'C', 'D'].map((option) => `${option}${'字'.repeat(799)}`),
      explanation: '解'.repeat(2600),
    }))
    const groqFactory = vi.fn(async () => longQuestions)
    const { host, guest, network, key } = await joinedGroqGame(500, { groqFactory })
    expect(new TextEncoder().encode(JSON.stringify(longQuestions[0])).length).toBeGreaterThan(16300)
    await host.startGame()
    await until(() => host.state.screen === 'quiz' && guest.state.screen === 'quiz', 12000)
    expect(groqFactory).toHaveBeenCalledTimes(1)
    expect(guest.state.questions).toEqual(longQuestions)
    expect(guest.state.questions).toEqual(host.state.questions)
    const data = network.messages.filter((message) => message.type === 'question-data')
    expect(data.length).toBeGreaterThan(30)
    expect(data.every((message) => new TextEncoder().encode(JSON.stringify(message)).length < 16300)).toBe(true)
    expect(JSON.stringify(network.messages)).not.toContain(key)
  }, 15000)

  it('retries a missing or corrupted chunk automatically without generating again', async () => {
    for (const mode of ['drop', 'corrupt']) {
      const network = new FakeNetwork()
      let changed = false
      if (mode === 'drop') network.drop = (message) => {
        if (!changed && message.type === 'question-data') { changed = true; return true }
        return false
      }
      else network.mutate = (message) => {
        if (!changed && message.type === 'question-data') {
          changed = true
          return { ...message, data: (message.data[0] === 'A' ? 'B' : 'A') + message.data.slice(1) }
        }
        return message
      }
      const { host, guest, groqFactory } = await joinedGroqGame(50, { network })
      await host.startGame()
      await until(() => host.state.screen === 'quiz' && guest.state.screen === 'quiz')
      expect(changed).toBe(true)
      expect(groqFactory).toHaveBeenCalledTimes(1)
      expect(network.messages.filter((message) => message.type === 'game-init')).toHaveLength(2)
      expect(guest.state.questions).toEqual(host.state.questions)
    }
  })

  it('waits for confirmation and retries an idle transfer without starting either player early', async () => {
    const network = new FakeNetwork()
    let discard = true
    network.drop = (message) => message.type === 'game-loaded' && discard
    const { host, guest, groqFactory } = await joinedGroqGame(50, { network, sessionOptions: { transferIdleMs: 30 } })
    await host.startGame()
    await until(() => network.messages.some((message) => message.type === 'game-loaded'))
    expect(host.state.screen).toBe('lobby')
    expect(guest.state.screen).toBe('lobby')
    discard = false
    await until(() => host.state.screen === 'quiz' && guest.state.screen === 'quiz')
    expect(network.messages.filter((message) => message.type === 'game-init').length).toBeGreaterThanOrEqual(2)
    expect(groqFactory).toHaveBeenCalledTimes(1)
    expect(guest.state.questions).toEqual(host.state.questions)
  })

  it('recovers when the first ready confirmation is lost', async () => {
    const network = new FakeNetwork()
    let dropped = false
    network.drop = (message) => {
      if (!dropped && message.type === 'ready') { dropped = true; return true }
      return false
    }
    const { host, guest, groqFactory } = await joinedGroqGame(50, { network, sessionOptions: { transferIdleMs: 30 } })
    await host.startGame()
    await until(() => host.state.screen === 'quiz' && guest.state.screen === 'quiz')
    expect(dropped).toBe(true)
    expect(network.messages.filter((message) => message.type === 'game-init').length).toBeGreaterThanOrEqual(2)
    expect(groqFactory).toHaveBeenCalledTimes(1)
    expect(guest.state.questions).toEqual(host.state.questions)
  })

  it('keeps generated questions for a manual retry after repeated transfer failures', async () => {
    const network = new FakeNetwork()
    let drops = 3
    network.drop = (message) => {
      if (message.type === 'question-data' && message.index === 0 && drops > 0) { drops -= 1; return true }
      return false
    }
    const { host, guest, groqFactory } = await joinedGroqGame(50, { network })
    await host.startGame()
    await until(() => host.state.status === 'joined' && host.state.error.includes('Kirim soal lagi'))
    expect(host.state.questions).toHaveLength(50)
    expect(groqFactory).toHaveBeenCalledTimes(1)
    await host.startGame()
    await until(() => host.state.screen === 'quiz' && guest.state.screen === 'quiz')
    expect(groqFactory).toHaveBeenCalledTimes(1)
    expect(guest.state.questions).toEqual(host.state.questions)
  })

  it('waits for a full data-channel buffer to drain before sending chunks', async () => {
    const { host, guest, network } = await joinedGroqGame(50)
    host.connection.dataChannel = { bufferedAmount: 300000 }
    await host.startGame()
    await new Promise((resolve) => setTimeout(resolve, 35))
    expect(network.messages.some((message) => message.type === 'question-data')).toBe(false)
    host.connection.dataChannel.bufferedAmount = 0
    await until(() => host.state.screen === 'quiz' && guest.state.screen === 'quiz')
    expect(guest.state.questions).toEqual(host.state.questions)
  })

  it('resends the prepared round after a disconnect during transfer', async () => {
    const { host, guest, groqFactory } = await joinedGroqGame(50)
    const connection = host.connection
    const send = connection.send.bind(connection)
    let disconnected = false
    connection.send = (message) => {
      send(message)
      if (!disconnected && message.type === 'question-data') { disconnected = true; connection.close() }
    }
    await host.startGame()
    await until(() => !host.state.connected && !guest.state.connected)
    expect(host.state.questions).toHaveLength(50)
    expect(host.state.status).toBe('waiting')
    guest.reconnect()
    await until(() => host.state.screen === 'quiz' && guest.state.screen === 'quiz')
    expect(groqFactory).toHaveBeenCalledTimes(1)
    expect(guest.state.questions).toEqual(host.state.questions)
  })

  it('continues preparing while the guest is disconnected and starts automatically when they return', async () => {
    let complete
    let preparationSignal
    const groqFactory = vi.fn((config, _key, { onProgress, signal }) => {
      preparationSignal = signal
      onProgress(1, config.count)
      return new Promise((resolve) => { complete = resolve })
    })
    const { network, host, guest, key } = await joinedGroqGame(50, { groqFactory })
    const preparing = host.startGame()
    guest.connection.close()
    await until(() => !host.state.connected && !guest.state.connected)
    expect(preparationSignal.aborted).toBe(false)
    expect(host.state.status).toBe('preparing')
    complete(questionsFor(1, 50))
    await preparing
    expect(host.state.status).toBe('waiting')
    expect(host.state.questions).toHaveLength(50)
    // A reloaded guest has a new token, which is allowed before the game starts.
    const returning = session(network)
    returning.joinRoom({ name: 'Mentari', code: host.state.code })
    await until(() => host.state.screen === 'quiz' && returning.state.screen === 'quiz')
    expect(groqFactory).toHaveBeenCalledTimes(1)
    expect(returning.state.questions).toEqual(host.state.questions)
    expect(JSON.stringify(network.messages)).not.toContain(key)
  })

  it('lets the same guest reconnect while Groq is still preparing', async () => {
    let complete
    const groqFactory = vi.fn((config, _key, { onProgress }) => {
      onProgress(2, config.count)
      return new Promise((resolve) => { complete = resolve })
    })
    const { host, guest } = await joinedGroqGame(5, { groqFactory })
    const preparing = host.startGame()
    guest.connection.close()
    await until(() => !host.state.connected && !guest.state.connected)
    guest.reconnect()
    await until(() => host.state.connected && guest.state.connected && guest.state.status === 'preparing')
    expect(guest.state.preparation.done).toBe(2)
    complete(questionsFor(1, 5))
    await preparing
    await until(() => host.state.screen === 'quiz' && guest.state.screen === 'quiz')
    expect(groqFactory).toHaveBeenCalledTimes(1)
    expect(guest.state.questions).toEqual(host.state.questions)
  })

  it('resumes completed Groq batches after an error instead of discarding them', async () => {
    const quiz = questionsFor(1, 10)
    const groqFactory = vi.fn(async (_config, _key, { onCheckpoint, initialQuestions }) => {
      if (!initialQuestions.length) {
        onCheckpoint(quiz.slice(0, 8))
        throw new Error('Batas penggunaan Groq tercapai.')
      }
      expect(initialQuestions).toEqual(quiz.slice(0, 8))
      return [...initialQuestions, ...quiz.slice(8)]
    })
    const { host, guest } = await joinedGroqGame(10, { groqFactory })
    await host.startGame()
    expect(host.state.error).toContain('tersimpan sementara')
    await host.startGame()
    await until(() => host.state.screen === 'quiz' && guest.state.screen === 'quiz')
    expect(groqFactory).toHaveBeenCalledTimes(2)
    expect(guest.state.questions).toEqual(quiz)
  })

  it('asks an outdated guest to reload before using the new transfer protocol', async () => {
    const network = new FakeNetwork()
    network.mutate = (message) => message.type === 'join' ? { ...message, protocol: undefined } : message
    const host = session(network), guest = session(network)
    host.createRoom({ name: 'Bintang', config: { ...DEFAULT_CONFIG, source: 'bank', count: 1 } })
    await until(() => host.state.status === 'waiting')
    guest.joinRoom({ name: 'Mentari', code: host.state.code })
    await until(() => guest.state.status === 'error')
    expect(guest.state.error).toContain('memuat ulang')
    expect(host.state.connected).toBe(false)
  })

  it('still accepts the earlier question format from an already-open host', async () => {
    const { host, guest } = await joinedGame(2)
    const questions = questionsFor(1, 2)
    host.patch({ questions, gameId: 'legacy-round-id' })
    host.send({ type: 'game-init', gameId: 'legacy-round-id', total: 2 })
    host.send({ type: 'question-chunk', gameId: 'legacy-round-id', index: 0, questions })
    host.send({ type: 'game-loaded', gameId: 'legacy-round-id' })
    await until(() => host.state.screen === 'quiz' && guest.state.screen === 'quiz')
    expect(guest.state.questions).toEqual(questions)
  })

  it('rejects a third player without disturbing the first two', async () => {
    const { network, host, guest } = await joinedGame()
    const third = session(network)
    third.joinRoom({ name: 'Orang Ketiga', code: host.state.code })
    await until(() => third.state.status === 'error')
    expect(third.state.error).toContain('penuh')
    expect(host.state.connected && guest.state.connected).toBe(true)
  })

  it('lets both players answer during a disconnect and synchronizes progress after reconnecting', async () => {
    const { host, guest } = await joinedGame(4)
    await host.startGame()
    await until(() => host.state.screen === 'quiz' && guest.state.screen === 'quiz')
    guest.connection.close()
    await until(() => !host.state.connected && !guest.state.connected)
    guest.submitAnswer(guest.state.questions[0].answer)
    guest.submitAnswer(guest.state.questions[1].answer)
    host.submitAnswer(host.state.questions[0].answer)
    expect(guest.state.answers).toHaveLength(2)
    expect(host.state.answers).toHaveLength(1)
    expect(guest.state.error).toMatch(/tersimpan|lanjut/i)
    expect(guest.state.error).toMatch(/jangan tutup|muat ulang/i)
    expect(host.state.error).toMatch(/jangan tutup|muat ulang/i)
    guest.reconnect()
    await until(() => host.state.connected && guest.state.connected && host.state.opponentProgress === 2 && guest.state.opponentProgress === 1)
    finish(host); finish(guest)
    await until(() => guest.state.screen === 'results')
    expect(host.state.result.host.score).toBe(100)
    expect(guest.state.result.guest.score).toBe(100)
  })

  it('delivers both results when both players finish while disconnected', async () => {
    const { host, guest } = await joinedGame(3)
    await host.startGame()
    await until(() => host.state.screen === 'quiz' && guest.state.screen === 'quiz')
    guest.connection.close()
    await until(() => !host.state.connected && !guest.state.connected)
    for (let i = 0; i < 3; i += 1) {
      host.submitAnswer(host.state.questions[i].answer)
      guest.submitAnswer(guest.state.questions[i].answer)
    }
    expect(host.state.screen).toBe('waiting')
    expect(guest.state.screen).toBe('waiting')
    expect(host.state.answers).toHaveLength(3)
    expect(guest.state.answers).toHaveLength(3)
    guest.reconnect()
    await until(() => host.state.screen === 'results' && guest.state.screen === 'results')
    expect(guest.state.result).toEqual(host.state.result)
    expect(host.state.result.host.score).toBe(100)
    expect(host.state.result.guest.score).toBe(100)
  })

  it('delivers saved results if the guest finished before the connection failed', async () => {
    const { host, guest } = await joinedGame(3)
    await host.startGame()
    await until(() => guest.state.screen === 'quiz')
    finish(guest)
    await until(() => host.guestFinished !== null)
    guest.connection.close()
    await until(() => !host.state.connected && !guest.state.connected)
    finish(host)
    expect(host.state.screen).toBe('results')
    expect(guest.state.screen).toBe('waiting')
    guest.reconnect()
    await until(() => guest.state.screen === 'results')
    expect(guest.state.result).toEqual(host.state.result)
    expect(guest.state.result.host.score).toBe(100)
    expect(guest.state.result.guest.score).toBe(100)
  })

  it('automatically reconnects a previously joined guest in the lobby', async () => {
    const { host, guest } = await joinedGame(3, { guestOptions: { reconnectBaseMs: 20 } })
    guest.connection.close()
    await until(() => !host.state.connected && !guest.state.connected)
    await until(() => host.state.connected && guest.state.connected)
    expect(guest.state.screen).toBe('lobby')
    expect(guest.state.status).toBe('joined')
    await host.startGame()
    await until(() => guest.state.screen === 'quiz')
    expect(guest.state.questions).toEqual(host.state.questions)
  })

  it('does not replace a working data connection when signaling opens again', async () => {
    const { host, guest, network } = await joinedGame(3)
    await host.startGame()
    await until(() => host.state.screen === 'quiz' && guest.state.screen === 'quiz')
    const connection = guest.connection
    const joins = network.messages.filter((message) => message.type === 'join').length
    host.peer.emit('open')
    guest.peer.emit('open')
    await new Promise((resolve) => setTimeout(resolve, 15))
    expect(guest.connection).toBe(connection)
    expect(host.state.status).toBe('playing')
    expect(host.state.connected && guest.state.connected).toBe(true)
    expect(network.messages.filter((message) => message.type === 'join')).toHaveLength(joins)
  })

  it('ignores a duplicate tap made for the previous question', async () => {
    const { host, guest } = await joinedGame(3)
    await host.startGame()
    await until(() => host.state.screen === 'quiz' && guest.state.screen === 'quiz')
    const question = { gameId: guest.state.gameId, index: 0 }
    guest.submitAnswer(0, question)
    guest.submitAnswer(0, question)
    expect(guest.state.answers).toHaveLength(1)
    guest.submitAnswer(1, { gameId: guest.state.gameId, index: 1 })
    expect(guest.state.answers).toEqual([0, 1])
  })

  it('automatically retries a temporary outage and resynchronizes locally saved answers', async () => {
    const { network, host, guest } = await joinedGame(3, { guestOptions: { reconnectBaseMs: 20 } })
    await host.startGame()
    await until(() => host.state.screen === 'quiz' && guest.state.screen === 'quiz')
    const hostPeer = host.peer
    network.peers.delete(hostPeer.id)
    guest.connection.close()
    await until(() => !host.state.connected && !guest.state.connected)
    guest.submitAnswer(guest.state.questions[0].answer)
    host.submitAnswer(host.state.questions[0].answer)
    await until(() => guest.reconnectAttempts >= 2)
    expect(guest.state.answers).toHaveLength(1)
    network.peers.set(hostPeer.id, hostPeer)
    await until(() => host.state.connected && guest.state.connected && host.state.opponentProgress === 1 && guest.state.opponentProgress === 1)
    finish(host); finish(guest)
    await until(() => guest.state.screen === 'results')
    expect(guest.state.result).toEqual(host.state.result)
    expect(guest.state.result.guest.score).toBe(100)
  })

  it('waits for signaling to reopen before trying to reconnect the data channel', async () => {
    const { host, guest } = await joinedGame(3)
    await host.startGame()
    await until(() => guest.state.screen === 'quiz')
    guest.connection.close()
    await until(() => !host.state.connected && !guest.state.connected)
    const peer = guest.peer
    peer.disconnected = true
    peer.open = false
    const connect = vi.spyOn(peer, 'connect')
    vi.spyOn(peer, 'reconnect').mockImplementation(() => { peer.disconnected = false })
    guest.reconnect()
    expect(connect).not.toHaveBeenCalled()
    expect(guest.state.status).toBe('connecting')
    peer.open = true
    peer.emit('open', peer.id)
    await until(() => host.state.connected && guest.state.connected)
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('recovers if signaling never reopens by replacing the guest peer', async () => {
    const { host, guest } = await joinedGame(3, { guestOptions: { reconnectBaseMs: 15, connectTimeoutMs: 35 } })
    await host.startGame()
    await until(() => guest.state.screen === 'quiz')
    guest.submitAnswer(guest.state.questions[0].answer)
    guest.connection.close()
    await until(() => !host.state.connected && !guest.state.connected)
    const stuckPeer = guest.peer
    stuckPeer.disconnected = true
    stuckPeer.open = false
    vi.spyOn(stuckPeer, 'reconnect').mockImplementation(() => { stuckPeer.disconnected = false })
    guest.reconnect()
    await until(() => guest.peer !== stuckPeer && host.state.connected && guest.state.connected)
    expect(stuckPeer.destroyed).toBe(true)
    expect(guest.state.answers).toHaveLength(1)
  })

  it('restores signaling without replacing an active game connection', async () => {
    const options = { reconnectBaseMs: 15 }
    const { host, guest, network } = await joinedGame(3, { hostOptions: options, guestOptions: options })
    await host.startGame()
    await until(() => guest.state.screen === 'quiz')
    const guestConnection = guest.connection
    const joins = network.messages.filter((message) => message.type === 'join').length
    for (const peer of [host.peer, guest.peer]) {
      peer.open = false
      peer.disconnected = true
      peer.emit('disconnected')
    }
    await until(() => host.peer.open && guest.peer.open)
    expect(guest.connection).toBe(guestConnection)
    expect(host.state.status).toBe('playing')
    expect(network.messages.filter((message) => message.type === 'join')).toHaveLength(joins)
    finish(host); finish(guest)
    await until(() => guest.state.screen === 'results')
    expect(guest.state.result).toEqual(host.state.result)
  })

  it('keeps the host playing if signaling fails while the guest is away', async () => {
    const { host, guest } = await joinedGame(3)
    await host.startGame()
    await until(() => guest.state.screen === 'quiz')
    guest.connection.close()
    await until(() => !host.state.connected && !guest.state.connected)
    host.peer.emit('error', { type: 'network' })
    expect(host.state.status).toBe('playing')
    expect(host.state.error).toContain('tetap bisa menjawab')
    host.submitAnswer(0)
    expect(host.state.answers).toHaveLength(1)
    guest.reconnect()
    await until(() => host.state.connected && guest.state.connected)
    finish(host); finish(guest)
    await until(() => guest.state.screen === 'results')
    expect(guest.state.result).toEqual(host.state.result)
  })

  it('handles PeerJS returning no connection if signaling becomes unavailable', async () => {
    const { host, guest } = await joinedGame(3)
    await host.startGame()
    await until(() => guest.state.screen === 'quiz')
    guest.connection.close()
    await until(() => !host.state.connected && !guest.state.connected)
    guest.peer.disconnected = true
    expect(() => guest.connectToHost()).not.toThrow()
    expect(guest.state.status).toBe('disconnected')
    expect(guest.state.answers).toHaveLength(0)
  })

  it('recreates a destroyed guest peer without losing the player token or answers', async () => {
    const { host, guest } = await joinedGame(3)
    await host.startGame()
    await until(() => guest.state.screen === 'quiz')
    guest.submitAnswer(guest.state.questions[0].answer)
    const oldPeer = guest.peer
    const token = guest.selfToken
    guest.connection.close()
    oldPeer.destroy()
    await until(() => !host.state.connected && !guest.state.connected)
    guest.reconnect()
    await until(() => host.state.connected && guest.state.connected)
    expect(guest.peer).not.toBe(oldPeer)
    expect(guest.selfToken).toBe(token)
    expect(guest.state.answers).toHaveLength(1)
    finish(host); finish(guest)
    await until(() => guest.state.screen === 'results')
    expect(guest.state.result.guest.score).toBe(100)
  })

  it('retries a lost completion or result message when the host finished first', async () => {
    for (const lostType of ['finished', 'results']) {
      const network = new FakeNetwork()
      let dropped = false
      network.drop = (message) => {
        if (!dropped && message.type === lostType) { dropped = true; return true }
        return false
      }
      const { host, guest } = await joinedGame(3, { network, guestOptions: { finishedRetryMs: 20 } })
      await host.startGame()
      await until(() => guest.state.screen === 'quiz')
      finish(host)
      expect(host.state.screen).toBe('waiting')
      finish(guest)
      await until(() => host.state.screen === 'results' && guest.state.screen === 'results')
      expect(dropped).toBe(true)
      expect(network.messages.filter((message) => message.type === 'finished').length).toBeGreaterThanOrEqual(2)
      expect(guest.state.result).toEqual(host.state.result)
    }
  })

  it('stops reconnecting when a player intentionally closes the room', async () => {
    const { network, host, guest } = await joinedGame(3, { guestOptions: { reconnectBaseMs: 15 } })
    await host.startGame()
    await until(() => guest.state.screen === 'quiz')
    const joins = network.messages.filter((message) => message.type === 'join').length
    guest.handleMessage({ type: 'room-closed' })
    guest.connection.close()
    await until(() => !host.state.connected)
    guest.reconnect()
    guest.submitAnswer(0)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(guest.state.roomClosed).toBe(true)
    expect(guest.state.error).toContain('meninggalkan')
    expect(guest.state.answers).toEqual([0])
    expect(network.messages.filter((message) => message.type === 'join')).toHaveLength(joins)
  })

  it('cancels automatic reconnection when leaving the game', async () => {
    const { network, host, guest } = await joinedGame(3, { guestOptions: { reconnectBaseMs: 30 } })
    await host.startGame()
    await until(() => guest.state.screen === 'quiz')
    guest.connection.close()
    await until(() => !guest.state.connected)
    const joins = network.messages.filter((message) => message.type === 'join').length
    guest.quit()
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(guest.state.screen).toBe('home')
    expect(network.messages.filter((message) => message.type === 'join')).toHaveLength(joins)
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
    await until(() => !host.state.connected && !guest.state.connected)
    // A send that closes synchronously is not treated as a successful rematch.
    expect(host.state.screen).toBe('results')
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
