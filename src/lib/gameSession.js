import { cleanName, validateConfig, validateName } from '../data/subjects.js'
import { generateAiQuestions } from './ai.js'
import { areAnswersValid, isValidQuestion, makePracticeQuestions, scoreAnswers } from './questions.js'
import { createPeer, makeRoomCode, makeToken, roomPeerId } from './peer.js'

const initialState = () => ({
  screen: 'home',
  role: null,
  status: 'idle',
  error: '',
  code: '',
  selfName: '',
  opponentName: '',
  config: null,
  connected: false,
  questions: [],
  answers: [],
  opponentProgress: 0,
  preparation: null,
  startedAt: null,
  result: null,
  gameId: '',
})

const safeError = (error) => {
  switch (error?.type) {
    case 'peer-unavailable': return 'Ruang tidak ditemukan. Periksa kode dan pastikan pembuat ruang masih membuka halaman.'
    case 'browser-incompatible': return 'Browser ini belum mendukung permainan jarak jauh. Coba gunakan Chrome, Edge, atau Firefox terbaru.'
    case 'network':
    case 'socket-error':
    case 'server-error':
    case 'socket-closed': return 'Tidak dapat terhubung ke server penghubung. Periksa internet dan coba lagi.'
    default: return 'Koneksi ke ruang bermasalah. Periksa internet dan coba lagi.'
  }
}

export class GameSession {
  constructor({ peerFactory = createPeer, practiceFactory = makePracticeQuestions, aiFactory = generateAiQuestions, clock = () => Date.now() } = {}) {
    this.peerFactory = peerFactory
    this.practiceFactory = practiceFactory
    this.aiFactory = aiFactory
    this.clock = clock
    this.state = initialState()
    this.listeners = new Set()
    this.peer = null
    this.connection = null
    this.pending = null
    this.abortController = null
    this.connectTimer = null
    this.readyTimer = null
    this.aiKey = ''
    this.selfToken = ''
    this.guestToken = ''
    this.guestFinished = null
    this.elapsedMs = 0
    this.incoming = null
    this.hostAttempts = 0
  }

  getState = () => this.state
  subscribe = (listener) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  patch(update) {
    this.state = { ...this.state, ...update }
    this.listeners.forEach((listener) => listener(this.state))
  }

  clearTimers() {
    clearTimeout(this.connectTimer)
    clearTimeout(this.readyTimer)
    this.connectTimer = null
    this.readyTimer = null
  }

  cleanup() {
    this.clearTimers()
    this.abortController?.abort()
    this.abortController = null
    const connection = this.connection
    const pending = this.pending
    const peer = this.peer
    this.connection = null
    this.pending = null
    this.peer = null
    try { connection?.close() } catch { /* already closed */ }
    try { if (pending !== connection) pending?.close() } catch { /* already closed */ }
    try { peer?.destroy() } catch { /* already destroyed */ }
    this.aiKey = ''
    this.selfToken = ''
    this.guestToken = ''
    this.guestFinished = null
    this.incoming = null
    this.elapsedMs = 0
    this.hostAttempts = 0
  }

  quit() {
    this.send({ type: 'room-closed' })
    this.cleanup()
    this.patch(initialState())
  }

  destroy() {
    this.cleanup()
    this.listeners.clear()
  }

  checkSetup(name, config, apiKey) {
    return validateName(name) || validateConfig(config) || (config.source === 'ai' && !apiKey?.trim() ? 'Masukkan Gemini API key untuk membuat soal AI.' : '')
  }

  createRoom({ name, config, apiKey = '' }) {
    const error = this.checkSetup(name, config, apiKey)
    if (error) { this.patch({ error }); return false }
    this.cleanup()
    this.aiKey = apiKey.trim()
    this.patch({ ...initialState(), screen: 'lobby', role: 'host', status: 'connecting', code: makeRoomCode(), selfName: cleanName(name), config: { ...config, grade: Number(config.grade), count: Number(config.count) } })
    this.openHostPeer()
    return true
  }

  openHostPeer() {
    this.hostAttempts += 1
    let peer
    try { peer = this.peerFactory(roomPeerId(this.state.code)) } catch { this.patch({ status: 'error', error: 'Browser tidak dapat membuat koneksi. Coba browser terbaru.' }); return }
    this.peer = peer
    this.connectTimer = setTimeout(() => {
      if (this.peer === peer && this.state.status === 'connecting') this.patch({ status: 'error', error: 'Server penghubung tidak merespons. Periksa internet lalu coba lagi.' })
    }, 20000)
    peer.on('open', () => {
      if (this.peer !== peer) return
      clearTimeout(this.connectTimer)
      this.patch({ status: 'waiting', error: '' })
    })
    peer.on('connection', (connection) => {
      if (this.peer === peer) this.acceptCandidate(connection)
    })
    peer.on('disconnected', () => {
      if (this.peer === peer && !peer.destroyed) { try { peer.reconnect() } catch { /* show connection state if needed */ } }
    })
    peer.on('error', (error) => {
      if (this.peer !== peer) return
      if (error.type === 'unavailable-id' && this.hostAttempts < 5) {
        this.peer = null
        try { peer.destroy() } catch { /* no-op */ }
        this.patch({ code: makeRoomCode(), status: 'connecting' })
        this.openHostPeer()
        return
      }
      if (!this.state.connected) { clearTimeout(this.connectTimer); this.patch({ status: 'error', error: safeError(error) }) }
    })
  }

  joinRoom({ name, code }) {
    const normalizedCode = String(code || '').trim().toUpperCase()
    const error = validateName(name) || (!/^[A-Z0-9]{6}$/.test(normalizedCode) ? 'Masukkan kode ruang yang terdiri dari 6 karakter.' : '')
    if (error) { this.patch({ error }); return false }
    this.cleanup()
    this.selfToken = makeToken()
    this.patch({ ...initialState(), screen: 'lobby', role: 'guest', status: 'connecting', code: normalizedCode, selfName: cleanName(name) })
    let peer
    try { peer = this.peerFactory() } catch { this.patch({ status: 'error', error: 'Browser tidak dapat membuat koneksi. Coba browser terbaru.' }); return false }
    this.peer = peer
    this.connectTimer = setTimeout(() => {
      if (this.peer === peer && !this.state.connected) this.patch({ status: 'error', error: 'Koneksi terlalu lama. Periksa kode ruang dan internet, lalu coba lagi.' })
    }, 20000)
    peer.on('open', () => { if (this.peer === peer) this.connectToHost() })
    peer.on('disconnected', () => { if (this.peer === peer && !peer.destroyed) { try { peer.reconnect() } catch { /* no-op */ } } })
    peer.on('error', (peerError) => {
      if (this.peer !== peer) return
      if (!this.state.connected) { clearTimeout(this.connectTimer); this.patch({ status: 'error', error: safeError(peerError) }) }
    })
    return true
  }

  connectToHost() {
    if (!this.peer || this.peer.destroyed) { this.patch({ status: 'error', error: 'Koneksi sudah ditutup. Kembali dan gabung lagi.' }); return }
    this.patch({ status: 'connecting', error: '' })
    let connection
    try { connection = this.peer.connect(roomPeerId(this.state.code), { reliable: true, serialization: 'json' }) } catch { this.patch({ status: 'error', error: 'Tidak dapat terhubung ke ruang. Coba lagi.' }); return }
    this.connection = connection
    this.wireConnection(connection, 'guest')
    clearTimeout(this.connectTimer)
    this.connectTimer = setTimeout(() => {
      if (this.connection === connection && !this.state.connected) this.patch({ status: 'error', error: 'Koneksi terlalu lama. Pastikan kode benar dan pembuat ruang masih online.' })
    }, 20000)
    connection.on('open', () => {
      if (this.connection !== connection) return
      this.send({ type: 'join', name: this.state.selfName, token: this.selfToken })
    })
  }

  reconnect() {
    if (this.state.role !== 'guest' || this.state.connected) return
    try { this.connection?.close() } catch { /* no-op */ }
    this.connection = null
    if (this.peer?.disconnected && !this.peer.destroyed) {
      try { this.peer.reconnect() } catch { /* connect attempt below will explain failure */ }
    }
    this.connectToHost()
  }

  acceptCandidate(connection) {
    if (this.connection || this.pending) {
      const reject = () => {
        try { connection.send({ type: 'rejected', reason: 'Ruang sudah penuh. Setiap ruang hanya untuk dua pemain.' }) } catch { /* peer left */ }
        setTimeout(() => { try { connection.close() } catch { /* no-op */ } }, 150)
      }
      if (connection.open) reject()
      else connection.on('open', reject)
      return
    }
    this.pending = connection
    this.wireConnection(connection, 'host')
    setTimeout(() => {
      if (this.pending === connection) {
        this.pending = null
        try { connection.close() } catch { /* no-op */ }
      }
    }, 15000)
  }

  wireConnection(connection, side) {
    connection.on('data', (message) => {
      if (connection !== this.connection && connection !== this.pending) return
      if (!message || typeof message !== 'object' || typeof message.type !== 'string') return
      if (side === 'host' && connection === this.pending) {
        if (message.type === 'join') this.acceptJoin(connection, message)
        return
      }
      this.handleMessage(message)
    })
    connection.on('close', () => this.connectionClosed(connection))
    connection.on('error', () => this.connectionClosed(connection))
  }

  acceptJoin(connection, message) {
    const token = typeof message.token === 'string' ? message.token : ''
    const name = cleanName(message.name)
    const invalid = validateName(name) || token.length < 10 || token.length > 100
    const gameInProgress = ['quiz', 'waiting', 'results'].includes(this.state.screen) || this.state.status === 'preparing'
    if (invalid || (gameInProgress && this.guestToken && token !== this.guestToken)) {
      try { connection.send({ type: 'rejected', reason: invalid ? 'Data pemain tidak valid.' : 'Permainan sudah dimulai dan ruang penuh.' }) } catch { /* no-op */ }
      this.pending = null
      setTimeout(() => { try { connection.close() } catch { /* no-op */ } }, 150)
      return
    }
    this.pending = null
    this.connection = connection
    this.guestToken = token
    this.patch({ connected: true, opponentName: name, status: this.state.screen === 'lobby' && this.state.status !== 'preparing' ? 'joined' : this.state.status, error: '' })
    this.send({
      type: 'welcome',
      name: this.state.selfName,
      config: this.state.config,
      phase: this.state.screen,
      status: this.state.status,
      opponentProgress: this.state.answers.length,
      gameId: this.state.gameId,
    })
    if (this.state.screen === 'results' && this.state.result) this.send({ type: 'results', gameId: this.state.gameId, result: this.state.result })
    else if (this.state.questions.length && ['quiz', 'waiting'].includes(this.state.screen)) this.sendQuestions()
  }

  connectionClosed(connection) {
    if (connection === this.pending) { this.pending = null; return }
    if (connection !== this.connection) return
    this.connection = null
    clearTimeout(this.connectTimer)
    clearTimeout(this.readyTimer)
    // Preserve the useful rejection / invalid-code error when an unaccepted
    // connection closes immediately after sending it.
    if (this.state.status === 'error' && !this.state.connected) return
    const wasPreparing = this.state.status === 'preparing'
    if (wasPreparing) this.abortController?.abort()
    const inLobby = this.state.screen === 'lobby'
    if (this.state.role === 'host' && inLobby) {
      this.guestToken = ''
      this.guestFinished = null
      this.patch({ connected: false, opponentName: '', status: 'waiting', preparation: null, error: 'Teman terputus. Bagikan kode lagi untuk mengundangnya kembali.' })
    } else {
      this.patch({ connected: false, status: inLobby ? 'disconnected' : this.state.status, preparation: wasPreparing ? null : this.state.preparation, error: this.state.role === 'guest' ? 'Koneksi terputus. Hubungkan kembali untuk melanjutkan.' : 'Teman terputus. Minta teman menghubungkan kembali sebelum melanjutkan.' })
    }
  }

  send(message) {
    if (!this.connection?.open) return false
    try { this.connection.send(message); return true } catch { return false }
  }

  handleMessage(message) {
    const role = this.state.role
    if (message.type === 'rejected' && role === 'guest') {
      clearTimeout(this.connectTimer)
      this.patch({ status: 'error', connected: false, error: typeof message.reason === 'string' ? message.reason.slice(0, 180) : 'Tidak dapat bergabung ke ruang.' })
      return
    }
    if (message.type === 'room-closed') {
      this.patch({ connected: false, status: 'error', error: 'Pemain lain meninggalkan ruang. Kembali ke beranda untuk bermain lagi.' })
      return
    }
    if (message.type === 'welcome' && role === 'guest') {
      if (validateConfig(message.config) || validateName(message.name)) { this.patch({ status: 'error', error: 'Data ruang tidak valid.' }); return }
      clearTimeout(this.connectTimer)
      this.patch({ connected: true, opponentName: cleanName(message.name), config: message.config, opponentProgress: Number.isInteger(message.opponentProgress) ? message.opponentProgress : 0, status: message.status === 'preparing' ? 'preparing' : 'joined', error: '' })
      if (this.state.screen === 'waiting' && this.state.answers.length === this.state.config.count) this.sendFinished()
      return
    }
    if (message.type === 'preparing' && role === 'guest') {
      const total = this.state.config?.count || 0
      const done = Math.max(0, Math.min(total, Number(message.done) || 0))
      this.patch({ status: 'preparing', preparation: { done, total }, error: '' })
      return
    }
    if (message.type === 'preparation-failed' && role === 'guest') {
      this.patch({ status: 'joined', preparation: null, error: 'Soal belum berhasil disiapkan. Pembuat ruang dapat mencoba lagi.' })
      return
    }
    if (message.type === 'game-init' && role === 'guest') {
      if (this.state.screen === 'results') return
      const total = Number(message.total)
      if (!Number.isInteger(total) || total < 1 || total > 500 || total !== this.state.config?.count || typeof message.gameId !== 'string') return
      this.incoming = { gameId: message.gameId, total, chunks: new Map() }
      return
    }
    if (message.type === 'question-chunk' && role === 'guest' && this.incoming && message.gameId === this.incoming.gameId) {
      if (!Number.isInteger(message.index) || message.index < 0 || message.index > 30 || !Array.isArray(message.questions) || message.questions.length > 25 || !message.questions.every(isValidQuestion)) return
      this.incoming.chunks.set(message.index, message.questions)
      return
    }
    if (message.type === 'game-loaded' && role === 'guest' && this.incoming && message.gameId === this.incoming.gameId) {
      const chunks = [...this.incoming.chunks.entries()].sort((a, b) => a[0] - b[0])
      const questions = chunks.flatMap(([, items]) => items)
      if (questions.length !== this.incoming.total || chunks.some(([index], position) => index !== position)) {
        this.patch({ error: 'Soal belum diterima lengkap. Minta pembuat ruang mencoba lagi.', status: 'joined' })
        this.send({ type: 'load-failed', gameId: this.incoming.gameId })
        this.incoming = null
        return
      }
      const sameGame = this.state.gameId === this.incoming.gameId
      this.patch({ questions, gameId: this.incoming.gameId, answers: sameGame ? this.state.answers : [], status: 'ready', preparation: null, error: '' })
      this.incoming = null
      this.send({ type: 'ready', gameId: this.state.gameId })
      return
    }
    if (message.type === 'load-failed' && role === 'host' && message.gameId === this.state.gameId) {
      clearTimeout(this.readyTimer)
      this.patch({ status: 'joined', preparation: null, error: 'Soal belum diterima teman dengan lengkap. Silakan mulai lagi.' })
      return
    }
    if (message.type === 'ready' && role === 'host' && message.gameId === this.state.gameId && this.state.questions.length) {
      clearTimeout(this.readyTimer)
      if (this.state.screen === 'results') {
        this.send({ type: 'results', gameId: this.state.gameId, result: this.state.result })
        return
      }
      if (this.state.screen === 'lobby') {
        this.patch({ screen: 'quiz', status: 'playing', startedAt: this.clock(), preparation: null, error: '' })
      }
      this.send({ type: 'go', gameId: this.state.gameId, opponentProgress: this.state.answers.length })
      return
    }
    if (message.type === 'go' && role === 'guest' && this.state.screen !== 'results' && message.gameId === this.state.gameId && this.state.questions.length) {
      const finished = this.state.answers.length === this.state.questions.length
      this.patch({ screen: finished ? 'waiting' : 'quiz', status: 'playing', startedAt: this.state.startedAt || this.clock(), opponentProgress: Number(message.opponentProgress) || 0, error: '' })
      if (finished) this.sendFinished()
      return
    }
    if (message.type === 'progress' && message.gameId === this.state.gameId) {
      const progress = Number(message.count)
      if (Number.isInteger(progress) && progress >= 0 && progress <= this.state.questions.length) this.patch({ opponentProgress: progress })
      return
    }
    if (message.type === 'finished' && role === 'host' && message.gameId === this.state.gameId) {
      if (!areAnswersValid(message.answers, this.state.questions.length) || message.answers.length !== this.state.questions.length) return
      this.guestFinished = { answers: message.answers, elapsedMs: Math.max(0, Math.min(Number(message.elapsedMs) || 0, 7 * 24 * 60 * 60 * 1000)) }
      this.patch({ opponentProgress: this.state.questions.length })
      this.maybeFinish()
      return
    }
    if (message.type === 'results' && role === 'guest' && message.gameId === this.state.gameId && message.result?.host && message.result?.guest) {
      this.patch({ screen: 'results', status: 'finished', result: message.result, error: '' })
    }
  }

  async startSolo({ name, config, apiKey = '' }) {
    const error = this.checkSetup(name, config, apiKey)
    if (error) { this.patch({ error }); return false }
    this.cleanup()
    this.aiKey = apiKey.trim()
    this.patch({ ...initialState(), screen: 'lobby', role: 'solo', status: 'preparing', connected: true, selfName: cleanName(name), config: { ...config, grade: Number(config.grade), count: Number(config.count) }, preparation: { done: 0, total: Number(config.count) } })
    await this.prepareQuestions()
    return true
  }

  async startGame() {
    if (this.state.role !== 'host' || this.state.screen !== 'lobby' || !this.state.connected || this.state.status === 'preparing') return
    this.guestFinished = null
    this.patch({ status: 'preparing', error: '', preparation: { done: 0, total: this.state.config.count }, questions: [], answers: [], opponentProgress: 0, result: null, gameId: '' })
    this.send({ type: 'preparing', done: 0 })
    await this.prepareQuestions()
  }

  async prepareQuestions() {
    const controller = new AbortController()
    this.abortController = controller
    const { config, role } = this.state
    const progress = (done, total) => {
      if (this.abortController !== controller) return
      this.patch({ preparation: { done, total } })
      if (role === 'host') this.send({ type: 'preparing', done })
    }
    try {
      const questions = config.source === 'ai'
        ? await this.aiFactory(config, this.aiKey, { onProgress: progress, signal: controller.signal })
        : this.practiceFactory(config)
      if (this.abortController !== controller || controller.signal.aborted) return
      if (!Array.isArray(questions) || questions.length !== config.count || !questions.every(isValidQuestion)) throw new Error('Soal yang dibuat belum lengkap. Silakan coba lagi.')
      const gameId = makeToken()
      this.patch({ questions, answers: [], gameId, opponentProgress: 0, preparation: null })
      if (role === 'solo') {
        this.patch({ screen: 'quiz', status: 'playing', startedAt: this.clock() })
      } else if (this.state.connected) {
        this.sendQuestions()
        this.readyTimer = setTimeout(() => {
          if (this.state.screen === 'lobby' && this.state.gameId === gameId) this.patch({ status: 'joined', error: 'Teman belum menerima soal. Periksa koneksi lalu coba lagi.' })
        }, 30000)
      } else {
        this.patch({ status: 'waiting', error: 'Teman terputus. Undang kembali sebelum memulai.' })
      }
    } catch (error) {
      if (controller.signal.aborted || this.abortController !== controller) return
      this.patch({ status: role === 'solo' ? 'error' : 'joined', preparation: null, error: error?.message || 'Soal belum berhasil disiapkan. Silakan coba lagi.' })
      if (role === 'host') this.send({ type: 'preparation-failed' })
    } finally {
      if (this.abortController === controller) this.abortController = null
    }
  }

  sendQuestions() {
    const { questions, gameId } = this.state
    if (!this.send({ type: 'game-init', gameId, total: questions.length })) return
    for (let index = 0; index * 20 < questions.length; index += 1) {
      this.send({ type: 'question-chunk', gameId, index, questions: questions.slice(index * 20, index * 20 + 20) })
    }
    this.send({ type: 'game-loaded', gameId })
  }

  submitAnswer(answer) {
    const { screen, role, connected, questions, answers } = this.state
    if (screen !== 'quiz' || (role !== 'solo' && !connected) || answers.length >= questions.length) return
    if (answer !== null && (!Number.isInteger(answer) || answer < 0 || answer > 3)) return
    const next = [...answers, answer]
    this.patch({ answers: next, error: '' })
    if (role !== 'solo') this.send({ type: 'progress', gameId: this.state.gameId, count: next.length })
    if (next.length !== questions.length) return
    this.elapsedMs = Math.max(0, this.clock() - this.state.startedAt)
    if (role === 'solo') {
      this.patch({ screen: 'results', status: 'finished', result: { host: { name: this.state.selfName, ...scoreAnswers(questions, next), elapsedMs: this.elapsedMs }, guest: null } })
    } else {
      this.patch({ screen: 'waiting' })
      if (role === 'guest') this.sendFinished()
      else this.maybeFinish()
    }
  }

  sendFinished() {
    this.send({ type: 'finished', gameId: this.state.gameId, answers: this.state.answers, elapsedMs: this.elapsedMs })
  }

  maybeFinish() {
    const { questions, answers, selfName, opponentName, gameId } = this.state
    if (this.state.role !== 'host' || !this.guestFinished || answers.length !== questions.length || !questions.length) return
    const result = {
      host: { name: selfName, ...scoreAnswers(questions, answers), elapsedMs: this.elapsedMs },
      guest: { name: opponentName, ...scoreAnswers(questions, this.guestFinished.answers), elapsedMs: this.guestFinished.elapsedMs },
    }
    this.patch({ screen: 'results', status: 'finished', result })
    this.send({ type: 'results', gameId, result })
  }
}
