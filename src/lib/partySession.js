import { makeRoomCode, makeToken, roomPeerId, createPeer } from './peer.js'
import { sanitizeWireProfile } from './ranks.js'
import { cleanName, validateName } from '../data/subjects.js'
import { validateBuzzerSettings } from '../data/buzzerCategories.js'
import { makeBuzzerQuestions, gradeBuzzerAnswer, wireQuestion, revealAnswer } from './buzzerQuestions.js'
import { generateBuzzerQuestions } from './groq.js'

// Mode "Siapa Cepat Dia Menjawab": ruang bintang (host otoritas pusat) untuk
// 2-5 pemain. Semua keputusan kecepatan (buzzer), penilaian, dan poin dihitung
// di sisi host memakai jam host ("waktu server"), bukan animasi perangkat.
export const PARTY_PROTOCOL = 1
export const MAX_PLAYERS = 5
export const MAX_GUESTS = MAX_PLAYERS - 1
export const BASE_POINTS = 10

export function speedBonus(elapsedMs) {
  const ms = Number(elapsedMs) || 0
  if (ms <= 3000) return 5
  if (ms <= 6000) return 3
  if (ms <= 10000) return 1
  return 0
}

const safeError = (error) => {
  const message = error instanceof Error ? error.message : String(error || 'Terjadi kesalahan.')
  return message.slice(0, 180)
}

const initialState = () => ({
  screen: 'landing',
  role: 'guest',
  code: '',
  status: 'idle',
  gameId: '',
  selfToken: '',
  selfName: '',
  players: [],
  settings: null,
  question: null,
  questionShownAt: null,
  phase: 'idle',
  turn: null,
  buzzOrder: [],
  reveal: [],
  history: [],
  result: null,
  preparation: null,
  rematchVotes: [],
  connected: false,
  roomClosed: false,
  error: '',
})

function viewPlayer(player) {
  return {
    token: player.token,
    name: player.name,
    avatar: player.avatar,
    frame: player.frame,
    profile: player.profile,
    isHost: Boolean(player.isHost),
    connected: Boolean(player.connected),
    points: player.points,
    correct: player.correct,
    wrong: player.wrong,
    lastGain: player.lastGain,
  }
}

export class PartySession {
  constructor({ peerFactory = createPeer, clock = () => Date.now(), revealDelayMs = 2600, reBuzzMs = 10000, turnTimeoutMs = 30000, joinTimeoutMs = 15000, connectTimeoutMs = 20000, reconnectBaseMs = 700 } = {}) {
    this.peerFactory = peerFactory
    this.clock = clock
    this.revealDelayMs = revealDelayMs
    this.reBuzzMs = reBuzzMs
    this.turnTimeoutMs = turnTimeoutMs
    this.joinTimeoutMs = joinTimeoutMs
    this.connectTimeoutMs = connectTimeoutMs
    this.reconnectBaseMs = reconnectBaseMs
    this.state = initialState()
    this.listeners = new Set()
    this.selfToken = ''
    this.selfProfile = null
    this.peer = null
    this.connection = null
    this.pending = null
    this.guestConnections = new Map() // token -> connection (host)
    this.round = null // { questions, index } — kunci jawaban hanya di host
    this.attempted = new Set()
    this.buzzOrder = []
    this.history = []
    this.guestToken = null
    this.connectTimer = null
    this.revealTimer = null
    this.reBuzzTimer = null
    this.turnTimer = null
    this.reconnectTimer = null
    this.reconnectAttempts = 0
  }

  patch(next) {
    this.state = { ...this.state, ...next }
    this.listeners.forEach((listener) => listener(this.state))
  }

  getState = () => this.state

  subscribe = (listener) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }

  setSelfProfile(profile) {
    const wire = sanitizeWireProfile(profile)
    if (!wire) return
    this.selfProfile = wire
    if (this.state.role === 'guest' && this.state.connected) this.send({ type: 'profile', profile: wire })
    if (this.state.role === 'host') {
      const players = this.state.players.map((player) => (player.token === this.selfToken ? { ...player, ...viewPlayer({ ...player, profile: wire, name: wire.name || player.name, avatar: wire.avatar, frame: wire.frame }) } : player))
      this.patch({ players })
      this.broadcast({ type: 'players', players })
    }
  }

  clearGameTimers() {
    clearTimeout(this.revealTimer); this.revealTimer = null
    clearTimeout(this.reBuzzTimer); this.reBuzzTimer = null
    clearTimeout(this.turnTimer); this.turnTimer = null
  }

  clearTimers() {
    this.clearGameTimers()
    clearTimeout(this.connectTimer); this.connectTimer = null
    clearTimeout(this.reconnectTimer); this.reconnectTimer = null
  }

  destroy() {
    this.clearTimers()
    for (const connection of this.guestConnections.values()) { try { connection.close() } catch { /* already closed */ } }
    this.guestConnections.clear()
    try { this.connection?.close() } catch { /* already closed */ }
    this.connection = null
    try { this.peer?.destroy() } catch { /* already destroyed */ }
    this.peer = null
    this.listeners.clear()
  }

  // --- Transport ----------------------------------------------------------

  send(message) {
    const connection = this.connection
    if (!connection || !connection.open) return false
    try { connection.send({ ...message, from: this.selfToken }) } catch { return false }
    return this.connection === connection && connection.open
  }

  broadcast(message, exceptToken = null) {
    for (const [token, connection] of this.guestConnections) {
      if (token === exceptToken) continue
      try { connection.send({ ...message, from: this.selfToken }) } catch { /* connection handled on close */ }
    }
  }

  // --- Ruang ---------------------------------------------------------------

  createRoom({ name, settings, apiKey = '' }) {
    const error = validateName(name) || validateBuzzerSettings(settings)
    if (error) { this.patch({ error }); return false }
    this.cleanup()
    this.selfToken = makeToken()
    // Kode ruang mode buzzer selalu diawali "S" agar tombol gabung langsung
    // tahu harus memakai sesi yang benar.
    const code = ('S' + makeRoomCode()).slice(0, 6)
    this.patch({
      ...initialState(),
      screen: 'lobby', role: 'host', status: 'connecting', code,
      selfToken: this.selfToken, selfName: cleanName(name),
      settings: { ...settings, count: Number(settings.count), wrongPenalty: Number(settings.wrongPenalty) },
      players: [this.selfPlayer(cleanName(name))],
      connected: true,
    })
    this.apiKey = apiKey
    this.openHostPeer()
    return true
  }

  selfPlayer(name) {
    return viewPlayer({
      token: this.selfToken, name, avatar: this.selfProfile?.avatar, frame: this.selfProfile?.frame,
      profile: this.selfProfile, isHost: true, connected: true, points: 0, correct: 0, wrong: 0, lastGain: 0,
    })
  }

  cleanup() {
    this.clearTimers()
    for (const connection of this.guestConnections.values()) { try { connection.close() } catch { /* noop */ } }
    this.guestConnections.clear()
    try { this.connection?.close() } catch { /* noop */ }
    this.connection = null
    this.pending = null
    try { this.peer?.destroy() } catch { /* noop */ }
    this.peer = null
    this.round = null
  }

  openHostPeer() {
    let peer
    try { peer = this.peerFactory(roomPeerId(this.state.code)) } catch { this.patch({ status: 'error', error: 'Browser tidak dapat membuat koneksi. Coba browser terbaru.' }); return }
    this.peer = peer
    this.connectTimer = setTimeout(() => {
      if (this.peer === peer && this.state.status === 'connecting') this.patch({ status: 'error', error: 'Server penghubung tidak merespons. Periksa internet lalu coba lagi.' })
    }, this.connectTimeoutMs)
    peer.on('open', () => {
      if (this.peer !== peer) return
      clearTimeout(this.connectTimer)
      if (this.state.screen === 'lobby' && ['connecting', 'error'].includes(this.state.status)) this.patch({ status: 'waiting', error: '' })
    })
    peer.on('connection', (connection) => { if (this.peer === peer) this.acceptCandidate(connection) })
    peer.on('error', (error) => {
      if (this.peer !== peer || this.state.connected) return
      this.patch({ status: 'error', error: safeError(error) })
    })
  }

  joinRoom({ name, code }) {
    const normalizedCode = String(code || '').trim().toUpperCase()
    const error = validateName(name) || (!/^[A-Z0-9]{6}$/.test(normalizedCode) ? 'Masukkan kode ruang yang terdiri dari 6 karakter.' : '')
    if (error) { this.patch({ error }); return false }
    this.cleanup()
    if (!this.selfToken) this.selfToken = makeToken()
    this.patch({ ...initialState(), screen: 'lobby', role: 'guest', status: 'connecting', code: normalizedCode, selfToken: this.selfToken, selfName: cleanName(name), players: [] })
    return this.openGuestPeer()
  }

  openGuestPeer() {
    let peer
    try { peer = this.peerFactory() } catch { this.connectionFailed('Browser tidak dapat membuat koneksi.'); return false }
    this.peer = peer
    clearTimeout(this.connectTimer)
    this.connectTimer = setTimeout(() => {
      if (this.peer === peer && !this.state.connected) this.connectionFailed('Koneksi terlalu lama. Periksa kode ruang dan internet, lalu coba lagi.')
    }, this.connectTimeoutMs)
    peer.on('open', () => {
      if (this.peer !== peer) return
      if (!this.state.connected && !this.connection && !this.state.roomClosed) this.connectToHost()
    })
    peer.on('error', (peerError) => {
      if (this.peer === peer && !this.state.connected) this.connectionFailed(safeError(peerError))
    })
    return true
  }

  connectToHost() {
    const peer = this.peer
    if (!peer || peer.destroyed) { this.connectionFailed('Koneksi sudah ditutup.'); return }
    this.patch({ status: 'connecting' })
    let connection
    try { connection = peer.connect(roomPeerId(this.state.code), { reliable: true, serialization: 'json' }) } catch { this.connectionFailed('Tidak dapat terhubung ke ruang. Coba lagi.'); return }
    if (!connection) { this.connectionFailed('Server penghubung belum siap.'); return }
    this.connection = connection
    connection.on('open', () => {
      if (this.connection !== connection) return
      this.send({
        type: 'join', token: this.selfToken, name: this.state.selfName, profile: this.selfProfile,
        protocol: PARTY_PROTOCOL, returning: Boolean(this.state.gameId),
      })
    })
    connection.on('data', (message) => {
      if (this.connection !== connection) return
      if (!message || typeof message !== 'object' || typeof message.type !== 'string') return
      this.handleMessage(message)
    })
    connection.on('close', () => this.connectionClosed(connection))
    connection.on('error', () => this.connectionClosed(connection))
  }

  connectionClosed(connection) {
    if (this.connection !== connection) return
    this.connection = null
    if (this.state.roomClosed) return
    const inGame = this.state.screen === 'game' || this.state.screen === 'results'
    this.patch({ connected: false, status: inGame ? 'disconnected' : 'connecting', error: inGame ? 'Koneksi terputus. Menyambungkan kembali; jangan tutup halaman.' : 'Koneksi terputus. Menyambungkan kembali...' })
    this.scheduleReconnect()
  }

  scheduleReconnect() {
    if (this.state.roomClosed || this.state.connected || this.reconnectTimer) return
    const delay = Math.min(this.reconnectBaseMs * 2 ** Math.min(this.reconnectAttempts, 5), 20000)
    this.reconnectAttempts += 1
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.reconnect() }, delay)
  }

  reconnect() {
    if (this.state.role !== 'guest' || this.state.connected || this.state.roomClosed) return
    if (!this.peer || this.peer.destroyed) { this.openGuestPeer(); return }
    this.connectToHost()
  }

  connectionFailed(message) {
    clearTimeout(this.connectTimer); this.connectTimer = null
    try { this.connection?.close() } catch { /* noop */ }
    this.connection = null
    if (this.state.roomClosed) return
    const retry = this.state.screen !== 'landing'
    this.patch({ connected: false, status: retry ? 'disconnected' : 'error', error: message + (retry ? ' Mencoba menghubungkan kembali.' : '') })
    if (retry) this.scheduleReconnect()
  }

  // --- Sisi host: terima koneksi ------------------------------------------

  acceptCandidate(connection) {
    const reject = (reason) => {
      const send = () => {
        try { connection.send({ type: 'rejected', reason }) } catch { /* peer left */ }
        setTimeout(() => { try { connection.close() } catch { /* noop */ } }, 100)
      }
      if (connection.open) send()
      else connection.on('open', send)
    }
    if (this.guestConnections.size >= MAX_GUESTS) { reject('Ruang sudah penuh. Maksimal 5 pemain.'); return }
    connection.on('data', (message) => {
      if (connection !== this.pending && ![...this.guestConnections.values()].includes(connection)) return
      if (!message || typeof message !== 'object' || typeof message.type !== 'string') return
      if (connection === this.pending && message.type === 'join') this.acceptJoin(connection, message)
      else this.handleMessage(message, connection)
    })
    connection.on('close', () => this.guestClosed(connection))
    connection.on('error', () => this.guestClosed(connection))
    this.pending = connection
    setTimeout(() => {
      if (this.pending === connection) {
        this.pending = null
        try { connection.close() } catch { /* noop */ }
      }
    }, this.joinTimeoutMs)
  }

  acceptJoin(connection, message) {
    const token = typeof message.token === 'string' ? message.token.slice(0, 100) : ''
    const name = cleanName(message.name)
    const invalid = validateName(name) || token.length < 6
    const oldVersion = message.protocol !== PARTY_PROTOCOL
    const returning = this.state.players.some((player) => player.token === token && !player.isHost)
    if (invalid || oldVersion) {
      try { connection.send({ type: 'rejected', reason: invalid ? 'Data pemain tidak valid.' : 'Versi KuisKita berbeda. Muat ulang halaman lalu gabung lagi.' }) } catch { /* noop */ }
      this.pending = null
      setTimeout(() => { try { connection.close() } catch { /* noop */ } }, 100)
      return
    }
    if (!returning && this.state.players.filter((player) => !player.isHost).length >= MAX_GUESTS) {
      try { connection.send({ type: 'rejected', reason: 'Ruang sudah penuh. Maksimal 5 pemain.' }) } catch { /* noop */ }
      this.pending = null
      setTimeout(() => { try { connection.close() } catch { /* noop */ } }, 100)
      return
    }
    this.pending = null
    this.guestConnections.set(token, connection)
    const wire = sanitizeWireProfile(message.profile)
    const players = [...this.state.players]
    const existingIndex = players.findIndex((player) => player.token === token)
    const base = existingIndex >= 0 ? players[existingIndex] : {
      token, name, avatar: wire?.avatar, frame: wire?.frame, profile: wire, isHost: false, connected: true, points: 0, correct: 0, wrong: 0, lastGain: 0,
    }
    const merged = viewPlayer({ ...base, name: wire?.name || name, avatar: wire?.avatar || base.avatar, frame: wire?.frame || base.frame, profile: wire || base.profile, connected: true })
    if (existingIndex >= 0) players[existingIndex] = merged
    else players.push(merged)
    this.patch({ players })
    this.broadcast({ type: 'players', players })
    try {
      connection.send({
        ...this.snapshot(),
        type: 'welcome',
        youAre: token,
      })
    } catch { /* handled by close */ }
    if (returning && this.state.screen === 'game') {
      // Tidak ada aksi tambahan; snapshot sudah memuat soal & status saat ini.
    }
  }

  guestClosed(connection) {
    if (this.pending === connection) { this.pending = null; return }
    for (const [token, stored] of this.guestConnections) {
      if (stored !== connection) continue
      this.guestConnections.delete(token)
      const players = this.state.players.map((player) => (player.token === token ? { ...player, connected: false } : player))
      this.patch({ players })
      this.broadcast({ type: 'players', players })
      // Giliran yang sedang berjalan dilewatkan bila pemiliknya pergi.
      if (this.state.screen === 'game' && this.state.turn?.token === token) this.passTurn()
      break
    }
  }

  snapshot() {
    const { players, settings, screen, phase, question, questionShownAt, turn, buzzOrder, reveal, history, result, preparation, gameId, code } = this.state
    return {
      type: 'welcome', mode: 'buzzer', protocol: PARTY_PROTOCOL,
      code, gameId, players, settings, screen, phase, question, questionShownAt,
      turn, buzzOrder, reveal, history, result, preparation,
    }
  }

  // --- Permainan -----------------------------------------------------------

  async startGame() {
    if (this.state.role !== 'host' || this.state.status === 'preparing') return false
    const settings = this.state.settings
    const error = validateBuzzerSettings(settings)
    if (error) { this.patch({ error }); return false }
    const connectedCount = this.state.players.filter((player) => player.connected).length
    if (connectedCount < 2) { this.patch({ error: 'Minimal 2 pemain untuk memulai.' }); return false }
    this.clearGameTimers()
    this.patch({ status: 'preparing', preparation: { done: 0, total: Number(settings.count) }, error: '' })
    this.broadcast({ type: 'preparing', done: 0, total: Number(settings.count) })
    let questions
    try {
      questions = settings.source === 'groq'
        ? await generateBuzzerQuestions(settings, this.apiKey, { onProgress: ({ done, total }) => { this.patch({ preparation: { done, total } }); this.broadcast({ type: 'preparing', done, total }) } })
        : makeBuzzerQuestions({ category: settings.category, method: settings.method, count: settings.count, random: () => Math.random() })
    } catch (err) {
      this.patch({ status: 'waiting', preparation: null, error: safeError(err) })
      this.broadcast({ type: 'preparation-failed', error: safeError(err) })
      return false
    }
    this.round = { questions, index: 0 }
    this.history = []
    this.attempted = new Set()
    this.buzzOrder = []
    const players = this.state.players.map((player) => ({ ...player, points: 0, correct: 0, wrong: 0, lastGain: 0 }))
    const first = questions[0]
    const shownAt = this.clock()
    this.patch({
      screen: 'game', status: 'playing', gameId: makeToken(), players,
      question: wireQuestion(first, 0, questions.length), questionShownAt: shownAt,
      phase: 'buzzing', turn: null, buzzOrder: [], reveal: [], history: [], result: null,
      preparation: null, rematchVotes: [],
    })
    this.broadcast({ type: 'question', question: wireQuestion(first, 0, questions.length), shownAt })
    this.broadcast({ type: 'players', players })
    return true
  }

  // Pengaturan ruang (hanya pembuat ruang, sebelum permainan dimulai).
  updateSettings(partial) {
    if (this.state.role !== 'host' || this.state.screen !== 'lobby' || this.state.status === 'preparing') return false
    const settings = { ...this.state.settings, ...partial }
    const next = { ...settings, count: Number(settings.count) || this.state.settings.count, wrongPenalty: Number(settings.wrongPenalty) }
    this.patch({ settings: next, error: '' })
    this.broadcast({ type: 'settings', settings: next })
    return true
  }

  eligibleTokens() {
    return this.state.players.filter((player) => player.connected && !this.attempted.has(player.token)).map((player) => player.token)
  }

  buzz() {
    const { screen, role, selfToken } = this.state
    if (screen !== 'game') return false
    if (role === 'guest') return this.send({ type: 'buzz', sentAt: this.clock() })
    return this.handleBuzz(selfToken)
  }

  handleBuzz(token) {
    // Boleh mengantre selama soal belum dijawab semua: pemain lain tetap bisa
    // menekan buzzer untuk giliran berikutnya bila pemegang giliran salah.
    if (this.state.screen !== 'game' || !['buzzing', 'answering'].includes(this.state.phase)) return false
    if (this.attempted.has(token)) return false
    if (this.buzzOrder.some((entry) => entry.token === token)) return false
    const player = this.state.players.find((item) => item.token === token)
    if (!player || !player.connected) return false
    const at = this.clock()
    this.buzzOrder.push({ token, name: player.name, at })
    this.patch({ buzzOrder: [...this.buzzOrder] })
    this.broadcast({ type: 'buzzed', token, name: player.name, at, order: this.buzzOrder.map((entry) => entry.token) })
    if (!this.state.turn) {
      clearTimeout(this.reBuzzTimer); this.reBuzzTimer = null
      this.grantTurn(token, at)
    }
    return true
  }

  grantTurn(token, at) {
    const player = this.state.players.find((item) => item.token === token)
    if (!player) return
    this.patch({ phase: 'answering', turn: { token, name: player.name, at } })
    this.broadcast({ type: 'turn', token, name: player.name, at, questionIndex: this.round?.index ?? 0 })
    clearTimeout(this.turnTimer)
    this.turnTimer = setTimeout(() => this.passTurn(token), this.turnTimeoutMs)
  }

  passTurn(expectedToken = null) {
    clearTimeout(this.turnTimer); this.turnTimer = null
    if (this.state.screen !== 'game') return
    if (expectedToken && this.state.turn?.token !== expectedToken) return
    if (expectedToken) {
      // Pemegang giliran melewatkan gilirannya (waktu habis / keluar):
      // jangan dipanggil lagi untuk soal yang sama.
      this.attempted.add(expectedToken)
    }
    const next = this.buzzOrder.find((entry) => !this.attempted.has(entry.token) && this.state.players.find((p) => p.token === entry.token)?.connected)
    if (next) { this.grantTurn(next.token, next.at); return }
    if (this.eligibleTokens().length > 0) {
      this.patch({ phase: 'buzzing', turn: null })
      this.broadcast({ type: 'turn', token: null })
      clearTimeout(this.reBuzzTimer)
      this.reBuzzTimer = setTimeout(() => this.closeQuestion(), this.reBuzzMs)
      return
    }
    this.closeQuestion()
  }

  submitAnswer(value) {
    const { screen, role, selfToken } = this.state
    if (screen !== 'game') return false
    if (role === 'guest') return this.send({ type: 'answer', value, sentAt: this.clock() })
    return this.handleAnswer(selfToken, value)
  }

  handleAnswer(token, value) {
    if (this.state.screen !== 'game' || this.state.phase !== 'answering' || this.state.turn?.token !== token) return false
    if (this.attempted.has(token)) return false
    const question = this.round?.questions?.[this.round.index]
    if (!question) return false
    const player = this.state.players.find((item) => item.token === token)
    if (!player) return false
    clearTimeout(this.turnTimer); this.turnTimer = null
    const correct = gradeBuzzerAnswer(question, value)
    const timeMs = Math.max(0, this.clock() - (this.state.questionShownAt || this.clock()))
    this.attempted.add(token)
    const gain = correct ? BASE_POINTS + speedBonus(timeMs) : -(this.state.settings?.wrongPenalty || 0)
    const players = this.state.players.map((item) => {
      if (item.token !== token) return item
      return {
        ...item,
        points: Math.max(0, item.points + gain),
        correct: item.correct + (correct ? 1 : 0),
        wrong: item.wrong + (correct ? 0 : 1),
        lastGain: gain,
      }
    })
    const valueText = question.kind === 'mc'
      ? (Number.isInteger(value) && question.options[value] ? `Pilihan ${'ABCD'[value]}. ${question.options[value]}` : String(value))
      : String(value)
    const entry = { token, name: player.name, value, valueText, correct, timeMs, gain, at: this.clock() }
    this.history = [...this.history]
    this.patch({ players, reveal: [...this.state.reveal, entry], turn: null })
    this.broadcast({ type: 'reveal', entry, players })
    if (correct) { this.closeQuestion(); return true }
    this.passTurn()
    return true
  }

  closeQuestion() {
    this.clearGameTimers()
    if (this.state.screen !== 'game') return
    const question = this.round?.questions?.[this.round.index]
    if (!question) return
    const answer = revealAnswer(question)
    this.history.push({
      index: this.round.index,
      prompt: question.prompt,
      kind: question.kind,
      entries: [...this.state.reveal],
      answer,
    })
    this.patch({ phase: 'revealed', turn: null })
    this.broadcast({ type: 'question-end', index: this.round.index, answer })
    this.revealTimer = setTimeout(() => this.nextQuestion(), this.revealDelayMs)
  }

  nextQuestion() {
    this.clearGameTimers()
    if (!this.round || this.state.screen !== 'game') return
    this.round.index += 1
    const total = this.round.questions.length
    if (this.round.index >= total) { this.finishGame(); return }
    this.attempted = new Set()
    this.buzzOrder = []
    const question = this.round.questions[this.round.index]
    const shownAt = this.clock()
    this.patch({
      question: wireQuestion(question, this.round.index, total), questionShownAt: shownAt,
      phase: 'buzzing', turn: null, buzzOrder: [], reveal: [],
    })
    this.broadcast({ type: 'question', question: wireQuestion(question, this.round.index, total), shownAt })
  }

  skipQuestion() {
    if (this.state.role !== 'host' || this.state.screen !== 'game') return false
    this.closeQuestion()
    return true
  }

  finishGame() {
    this.clearGameTimers()
    const standings = [...this.state.players]
      .sort((a, b) => b.points - a.points || b.correct - a.correct || a.name.localeCompare(b.name))
      .map((player, index) => ({ rank: index + 1, ...viewPlayer(player) }))
    const result = {
      standings,
      history: [...this.history],
      settings: this.state.settings,
      gameId: this.state.gameId,
      finishedAt: this.clock(),
    }
    this.patch({ screen: 'results', status: 'finished', phase: 'idle', question: null, turn: null, result })
    this.broadcast({ type: 'result', result })
  }

  // "Main lagi": pembuat ruang langsung membuat soal baru; pemain lain meminta.
  playAgain() {
    if (this.state.screen !== 'results') return false
    if (this.state.role === 'host') return this.startGame()
    return this.send({ type: 'rematch-request', sentAt: this.clock() })
  }

  quit() {
    if (this.state.role === 'guest') this.send({ type: 'leave' })
    else this.broadcast({ type: 'room-closed' })
    // Tunggu pesan terkirim sebelum koneksi ditutup.
    setTimeout(() => {
      this.cleanup()
      this.patch({ ...initialState(), selfToken: this.selfToken, selfName: this.state.selfName })
    }, 60)
  }

  // --- Pesan ---------------------------------------------------------------

  handleMessage(message, connection = null) {
    const role = this.state.role
    if (role === 'host') return this.handleHostMessage(message, connection)
    return this.handleGuestMessage(message)
  }

  handleHostMessage(message, connection) {
    const token = typeof message.from === 'string' ? message.from : ''
    if (message.type === 'profile') {
      const wire = sanitizeWireProfile(message.profile)
      if (!wire) return
      const players = this.state.players.map((player) => (player.token === token ? viewPlayer({ ...player, profile: wire, name: wire.name || player.name, avatar: wire.avatar, frame: wire.frame }) : player))
      this.patch({ players })
      this.broadcast({ type: 'players', players })
      return
    }
    if (message.type === 'buzz') { this.handleBuzz(token); return }
    if (message.type === 'answer') {
      // Hanya nilai jawaban yang boleh lewat; teks mentah tidak diumumkan
      // sebelum dinilai oleh host.
      this.handleAnswer(token, message.value)
      return
    }
    if (message.type === 'leave') {
      this.guestClosed(connection || this.guestConnections.get(token))
      return
    }
    if (message.type === 'rematch-request') {
      const votes = [...new Set([...this.state.rematchVotes, token])]
      this.patch({ rematchVotes: votes })
      this.broadcast({ type: 'rematch-votes', votes })
    }
  }

  handleGuestMessage(message) {
    if (message.type === 'rejected') {
      clearTimeout(this.connectTimer)
      this.patch({ status: 'error', connected: false, error: String(message.reason || 'Tidak dapat bergabung ke ruang.').slice(0, 180) })
      return
    }
    if (message.type === 'welcome') {
      if (message.mode !== 'buzzer') {
        this.patch({ status: 'error', connected: false, error: 'Kode ini untuk mode Kuis Klasik. Gunakan menu kuis biasa untuk kode tanpa awalan S.' })
        return
      }
      clearTimeout(this.connectTimer)
      this.reconnectAttempts = 0
      this.patch({
        connected: true,
        status: message.preparation ? 'preparing' : 'joined',
        code: message.code || this.state.code,
        gameId: message.gameId || '',
        players: Array.isArray(message.players) ? message.players : [],
        settings: message.settings || this.state.settings,
        screen: message.screen === 'landing' ? 'lobby' : message.screen || 'lobby',
        phase: message.phase || 'idle',
        question: message.question || null,
        questionShownAt: message.questionShownAt ?? null,
        turn: message.turn || null,
        buzzOrder: Array.isArray(message.buzzOrder) ? message.buzzOrder : [],
        reveal: Array.isArray(message.reveal) ? message.reveal : [],
        history: Array.isArray(message.history) ? message.history : [],
        result: message.result || null,
        preparation: message.preparation || null,
        error: '',
      })
      return
    }
    if (message.type === 'players') { this.patch({ players: message.players || [] }); return }
    if (message.type === 'settings') { this.patch({ settings: message.settings || this.state.settings }); return }
    if (message.type === 'preparing') { this.patch({ status: 'preparing', preparation: { done: message.done, total: message.total } }); return }
    if (message.type === 'preparation-failed') { this.patch({ status: 'waiting', preparation: null, error: message.error || 'Soal belum berhasil disiapkan.' }); return }
    if (message.type === 'question') {
      this.patch({ screen: 'game', status: 'playing', question: message.question, questionShownAt: message.shownAt, phase: 'buzzing', turn: null, buzzOrder: [], reveal: [], preparation: null, error: '' })
      return
    }
    if (message.type === 'buzzed') {
      const order = Array.isArray(message.order) ? message.order : []
      const players = this.state.players
      const buzzOrder = order.map((t) => {
        const existing = this.state.buzzOrder.find((entry) => entry.token === t)
        return existing || { token: t, name: players.find((p) => p.token === t)?.name || t, at: message.at }
      })
      this.patch({ buzzOrder })
      return
    }
    if (message.type === 'turn') {
      if (!message.token) { this.patch({ phase: 'buzzing', turn: null }); return }
      this.patch({ phase: 'answering', turn: { token: message.token, name: message.name, at: message.at } })
      return
    }
    if (message.type === 'reveal') {
      const reveal = [...this.state.reveal.filter((entry) => entry.token !== message.entry?.token), message.entry].filter(Boolean)
      this.patch({ reveal, players: message.players || this.state.players })
      return
    }
    if (message.type === 'question-end') {
      const history = [...this.state.history]
      const index = message.index
      const existing = history.findIndex((item) => item.index === index)
      const item = { index, prompt: this.state.question?.prompt || '', kind: this.state.question?.kind || 'mc', entries: [...this.state.reveal], answer: message.answer }
      if (existing >= 0) history[existing] = item
      else history.push(item)
      this.patch({ phase: 'revealed', turn: null, history })
      return
    }
    if (message.type === 'result') {
      this.clearGameTimers()
      this.patch({ screen: 'results', status: 'finished', phase: 'idle', question: null, turn: null, result: message.result || null })
      return
    }
    if (message.type === 'rematch-votes') { this.patch({ rematchVotes: message.votes || [] }); return }
    if (message.type === 'room-closed') {
      this.clearTimers()
      this.patch({ connected: false, roomClosed: true, status: 'error', error: 'Pembuat ruang menutup permainan. Kembali ke beranda untuk bermain lagi.' })
    }
  }
}
