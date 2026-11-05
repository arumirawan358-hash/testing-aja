import { CUSTOM_SUBJECT, cleanName, subjectName, validateConfig, validateName } from '../data/subjects.js'
import { generateGroqQuestions } from './groq.js'
import { areAnswersValid, isValidQuestion, makePracticeQuestions, scoreAnswers } from './questions.js'
import { createPeer, makeRoomCode, makeToken, roomPeerId } from './peer.js'
import { decodeQuestions, encodeQuestions, isValidChunkText, isValidTransferSize, TRANSFER_PROTOCOL } from './questionTransfer.js'

const TRANSFER_IDLE_MS = 45000
const MAX_TRANSFER_ATTEMPTS = 3
const MAX_BUFFERED_BYTES = 256 * 1024

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
  rematchRequested: false,
  opponentRematchRequested: false,
})

// Only quiz settings may be sent to a guest; never forward arbitrary config fields.
function publicConfig(config) {
  return {
    level: config.level,
    grade: Number(config.grade),
    subject: config.subject,
    customSubject: config.subject === CUSTOM_SUBJECT ? config.customSubject.trim() : '',
    topic: config.source === 'groq' && typeof config.topic === 'string' ? config.topic.trim() : '',
    count: Number(config.count),
    source: config.source,
  }
}

function historyKey(config) {
  return JSON.stringify([config.level, Number(config.grade), subjectName(config).toLocaleLowerCase('id-ID'), (config.topic || '').trim().toLocaleLowerCase('id-ID')])
}

function resetRound(status = 'joined') {
  return { screen: 'lobby', status, error: '', questions: [], answers: [], opponentProgress: 0, preparation: null, startedAt: null, result: null, gameId: '', rematchRequested: false, opponentRematchRequested: false }
}

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
  constructor({ peerFactory = createPeer, practiceFactory = makePracticeQuestions, groqFactory = generateGroqQuestions, clock = () => Date.now(), transferIdleMs = TRANSFER_IDLE_MS, maxTransferAttempts = MAX_TRANSFER_ATTEMPTS } = {}) {
    this.peerFactory = peerFactory
    this.practiceFactory = practiceFactory
    this.groqFactory = groqFactory
    // Recent question text is kept only in this tab to avoid repeats on rematches.
    this.questionHistory = new Map()
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
    this.outgoing = null
    this.activeTransfer = null
    this.transferIdleMs = transferIdleMs
    this.maxTransferAttempts = maxTransferAttempts
    this.partialQuestions = []
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

  cancelTransfer() {
    this.activeTransfer = null
    clearTimeout(this.readyTimer)
    this.readyTimer = null
  }

  cleanup() {
    this.clearTimers()
    this.cancelTransfer()
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
    this.outgoing = null
    this.partialQuestions = []
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
    this.questionHistory.clear()
    this.listeners.clear()
  }

  checkSetup(name, config, apiKey) {
    return validateName(name) || validateConfig(config) || (config.source === 'groq' && (typeof apiKey !== 'string' || !apiKey.trim()) ? 'Masukkan API key Groq untuk membuat soal AI.' : '')
  }

  createRoom({ name, config, apiKey = '' }) {
    const error = this.checkSetup(name, config, apiKey)
    if (error) { this.patch({ error }); return false }
    this.cleanup()
    this.aiKey = config.source === 'groq' ? apiKey.trim() : ''
    this.patch({ ...initialState(), screen: 'lobby', role: 'host', status: 'connecting', code: makeRoomCode(), selfName: cleanName(name), config: publicConfig(config) })
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
      this.send({ type: 'join', name: this.state.selfName, token: this.selfToken, protocol: TRANSFER_PROTOCOL })
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
    // Before the quiz starts, a friend may reload/rejoin even if preparation is underway.
    const gameInProgress = ['quiz', 'waiting', 'results'].includes(this.state.screen)
    const oldVersion = message.protocol !== TRANSFER_PROTOCOL
    if (invalid || oldVersion || (gameInProgress && this.guestToken && token !== this.guestToken)) {
      const reason = invalid ? 'Data pemain tidak valid.' : oldVersion ? 'Versi KuisKita berbeda. Minta kedua pemain memuat ulang halaman, lalu gabung lagi.' : 'Permainan sudah dimulai dan ruang penuh.'
      try { connection.send({ type: 'rejected', reason }) } catch { /* no-op */ }
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
      rematchRequested: this.state.rematchRequested,
    })
    if (this.state.screen === 'results' && this.state.result) this.send({ type: 'results', gameId: this.state.gameId, result: this.state.result })
    else if (this.state.gameId && this.state.questions.length && ['lobby', 'quiz', 'waiting'].includes(this.state.screen)) this.sendQuestions()
    else if (this.state.status === 'preparing') this.send({ type: 'preparing', done: this.state.preparation?.done || 0 })
  }

  connectionClosed(connection) {
    if (connection === this.pending) { this.pending = null; return }
    if (connection !== this.connection) return
    this.connection = null
    clearTimeout(this.connectTimer)
    this.cancelTransfer()
    this.incoming = null
    try { connection.close() } catch { /* already closed */ }
    // Preserve a rejection / invalid-code error when an unaccepted connection closes.
    if (this.state.status === 'error' && !this.state.connected) return
    const inLobby = this.state.screen === 'lobby'
    const generating = this.state.role === 'host' && inLobby && this.state.status === 'preparing' && this.abortController && !this.abortController.signal.aborted
    const prepared = this.state.role === 'host' && inLobby && Boolean(this.state.gameId && this.state.questions.length)
    if (this.state.role === 'host' && inLobby) {
      this.guestToken = ''
      this.guestFinished = null
      if (generating) {
        // Do not cancel paid AI work just because the other player disconnected.
        this.patch({ connected: false, opponentName: '', error: 'Teman terputus. Soal tetap disiapkan; minta teman bergabung lagi.' })
      } else if (prepared) {
        this.patch({ connected: false, opponentName: '', status: 'waiting', preparation: null, error: 'Teman terputus. Soal sudah siap dan akan dikirim saat teman kembali.' })
      } else {
        this.patch({ connected: false, opponentName: '', status: 'waiting', preparation: null, error: 'Teman terputus. Bagikan kode lagi untuk mengundangnya kembali.' })
      }
    } else {
      this.patch({ connected: false, status: inLobby ? 'disconnected' : this.state.status, preparation: inLobby ? null : this.state.preparation, error: this.state.role === 'guest' ? 'Koneksi terputus. Hubungkan kembali untuk melanjutkan.' : 'Teman terputus. Minta teman menghubungkan kembali sebelum melanjutkan.' })
    }
  }

  send(message) {
    const connection = this.connection
    if (!connection?.open) return false
    try {
      connection.send(message)
      // PeerJS can emit a synchronous error instead of throwing from send().
      return this.connection === connection && connection.open
    } catch { return false }
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
      const returnToLobby = this.state.screen === 'results' && message.phase === 'lobby' && !message.gameId
      this.patch({
        ...(returnToLobby ? resetRound() : {}),
        connected: true, opponentName: cleanName(message.name), config: publicConfig(message.config),
        opponentProgress: Number.isInteger(message.opponentProgress) ? message.opponentProgress : 0,
        opponentRematchRequested: !returnToLobby && message.phase === 'results' && message.gameId === this.state.gameId && message.rematchRequested === true,
        status: message.status === 'preparing' ? 'preparing' : this.state.screen === 'results' && !returnToLobby ? 'finished' : 'joined', error: '',
      })
      if (this.state.screen === 'waiting' && this.state.answers.length === this.state.config.count) this.sendFinished()
      if (this.state.screen === 'results' && this.state.rematchRequested) this.send({ type: 'rematch-request', gameId: this.state.gameId })
      return
    }
    if (message.type === 'rematch-request' && role !== 'solo' && this.state.screen === 'results' && message.gameId === this.state.gameId) {
      this.patch({ opponentRematchRequested: true })
      if (role === 'host' && this.state.rematchRequested) this.beginRematch()
      return
    }
    if (message.type === 'rematch' && role === 'guest' && this.state.screen === 'results' && message.gameId === this.state.gameId) {
      this.incoming = null
      this.patch(resetRound())
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
      if (!Number.isInteger(total) || total < 1 || total > 500 || total !== this.state.config?.count || typeof message.gameId !== 'string' || !message.gameId.length || message.gameId.length > 100) return
      // A reconnect or lost ready message does not require another transfer if
      // this browser already verified the exact round.
      if (this.state.gameId === message.gameId && this.state.questions.length === total) {
        this.send({ type: 'ready', gameId: message.gameId, transferId: message.transferId })
        return
      }
      if (message.protocol === TRANSFER_PROTOCOL) {
        if (typeof message.transferId !== 'string' || !message.transferId.length || message.transferId.length > 100 || !isValidTransferSize(message.bytes, message.chunks) || typeof message.checksum !== 'string' || !/^[0-9a-f]{8}$/.test(message.checksum)) return
        this.incoming = { protocol: TRANSFER_PROTOCOL, gameId: message.gameId, transferId: message.transferId, total, bytes: message.bytes, checksum: message.checksum, chunks: new Array(message.chunks), received: 0 }
        this.patch({ status: 'receiving', preparation: { phase: 'transfer', done: 0, total: message.chunks }, error: '' })
      } else if (message.protocol === undefined) {
        // A newly loaded guest can still understand the previous host version.
        this.incoming = { protocol: 1, gameId: message.gameId, total, chunks: new Map() }
      }
      return
    }
    if (message.type === 'question-data' && role === 'guest' && this.incoming?.protocol === TRANSFER_PROTOCOL && message.gameId === this.incoming.gameId && message.transferId === this.incoming.transferId) {
      const incoming = this.incoming
      if (!Number.isInteger(message.index) || message.index < 0 || message.index >= incoming.chunks.length || !isValidChunkText(message.data)) return
      if (incoming.chunks[message.index] === undefined) {
        incoming.chunks[message.index] = message.data
        incoming.received += 1
      }
      const interval = Math.max(1, Math.min(8, Math.ceil(incoming.chunks.length / 20)))
      if (incoming.received === incoming.chunks.length || incoming.received % interval === 0) {
        this.patch({ status: 'receiving', preparation: { phase: 'transfer', done: incoming.received, total: incoming.chunks.length } })
        this.send({ type: 'transfer-progress', gameId: incoming.gameId, transferId: incoming.transferId, received: incoming.received })
      }
      return
    }
    if (message.type === 'question-chunk' && role === 'guest' && this.incoming?.protocol === 1 && message.gameId === this.incoming.gameId) {
      if (!Number.isInteger(message.index) || message.index < 0 || message.index > 500 || !Array.isArray(message.questions) || message.questions.length > 25 || !message.questions.every(isValidQuestion)) return
      this.incoming.chunks.set(message.index, message.questions)
      return
    }
    if (message.type === 'game-loaded' && role === 'guest' && this.incoming && message.gameId === this.incoming.gameId) {
      const incoming = this.incoming
      if (incoming.protocol === TRANSFER_PROTOCOL && message.transferId !== incoming.transferId) return
      let questions
      try {
        if (incoming.protocol === TRANSFER_PROTOCOL) {
          if (incoming.received !== incoming.chunks.length) throw new Error('Incomplete transfer')
          questions = decodeQuestions(incoming.chunks, incoming.bytes, incoming.checksum)
        } else {
          const chunks = [...incoming.chunks.entries()].sort((a, b) => a[0] - b[0])
          if (chunks.some(([index], position) => index !== position)) throw new Error('Incomplete transfer')
          questions = chunks.flatMap(([, items]) => items)
        }
        if (!Array.isArray(questions) || questions.length !== incoming.total || !questions.every(isValidQuestion)) throw new Error('Invalid questions')
      } catch {
        this.incoming = null
        this.patch(incoming.protocol === TRANSFER_PROTOCOL
          ? { status: 'receiving', error: 'Soal belum lengkap, mencoba mengirim ulang...' }
          : { status: 'joined', preparation: null, error: 'Soal belum lengkap. Minta kedua pemain memuat ulang halaman lalu coba lagi.' })
        this.send({ type: 'load-failed', gameId: incoming.gameId, transferId: incoming.transferId })
        return
      }
      const sameGame = this.state.gameId === incoming.gameId
      this.patch({ questions, gameId: incoming.gameId, answers: sameGame ? this.state.answers : [], status: 'ready', preparation: null, error: '' })
      this.incoming = null
      this.send({ type: 'ready', gameId: incoming.gameId, transferId: incoming.transferId })
      return
    }
    if (message.type === 'transfer-progress' && role === 'host' && this.activeTransfer && message.gameId === this.activeTransfer.gameId && message.transferId === this.activeTransfer.transferId) {
      const transfer = this.activeTransfer
      if (Number.isInteger(message.received) && message.received >= 0 && message.received <= transfer.payload.chunks.length) {
        if (this.state.screen === 'lobby') this.patch({ preparation: { phase: 'transfer', done: message.received, total: transfer.payload.chunks.length } })
        this.armTransferTimeout(transfer)
      }
      return
    }
    if (message.type === 'load-failed' && role === 'host' && this.activeTransfer && message.gameId === this.activeTransfer.gameId && (!message.transferId || message.transferId === this.activeTransfer.transferId)) {
      this.retryTransfer(this.activeTransfer)
      return
    }
    if (message.type === 'transfer-failed' && role === 'guest' && this.state.screen === 'lobby') {
      this.incoming = null
      this.patch({ status: 'joined', preparation: null, error: 'Soal belum terkirim. Minta pembuat ruang mengirim ulang atau kedua pemain memuat ulang halaman.' })
      return
    }
    if (message.type === 'ready' && role === 'host' && message.gameId === this.state.gameId && this.state.questions.length) {
      this.cancelTransfer()
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
      this.incoming = null
      this.patch({ screen: finished ? 'waiting' : 'quiz', status: 'playing', preparation: null, startedAt: this.state.startedAt || this.clock(), opponentProgress: Number(message.opponentProgress) || 0, error: '' })
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
    this.aiKey = config.source === 'groq' ? apiKey.trim() : ''
    this.patch({ ...initialState(), screen: 'lobby', role: 'solo', status: 'preparing', connected: true, selfName: cleanName(name), config: publicConfig(config), preparation: { done: 0, total: Number(config.count) } })
    await this.prepareQuestions()
    return true
  }

  async playAgain() {
    if (this.state.screen !== 'results') return
    const { role, gameId, connected, config } = this.state
    if (role === 'solo') {
      this.patch({ ...resetRound('preparing'), preparation: { done: 0, total: config.count } })
      await this.prepareQuestions()
      return
    }
    if (!connected) { this.patch({ error: 'Teman belum terhubung. Hubungkan kembali sebelum bermain lagi.' }); return }
    if (role === 'host' && this.state.opponentRematchRequested) { this.beginRematch(); return }
    if (!this.send({ type: 'rematch-request', gameId })) { this.patch({ error: 'Permintaan belum terkirim. Periksa koneksi lalu coba lagi.' }); return }
    if (this.state.screen === 'results' && this.state.gameId === gameId) this.patch({ rematchRequested: true, error: '' })
  }

  beginRematch() {
    if (this.state.role !== 'host' || this.state.screen !== 'results' || !this.state.connected) return
    if (!this.send({ type: 'rematch', gameId: this.state.gameId })) { this.patch({ error: 'Teman belum terhubung. Coba lagi.' }); return }
    this.guestFinished = null
    this.cancelTransfer()
    this.outgoing = null
    this.partialQuestions = []
    this.patch(resetRound())
  }

  async startGame() {
    if (this.state.role !== 'host' || this.state.screen !== 'lobby' || !this.state.connected || ['preparing', 'sending', 'ready'].includes(this.state.status)) return
    // Resending a prepared round never invokes Groq again.
    if (this.state.gameId && this.state.questions.length === this.state.config.count) {
      this.sendQuestions()
      return
    }
    this.guestFinished = null
    const done = this.partialQuestions.length
    this.patch({ status: 'preparing', error: '', preparation: { done, total: this.state.config.count }, questions: [], answers: [], opponentProgress: 0, result: null, gameId: '' })
    this.send({ type: 'preparing', done })
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
      const key = config.source === 'groq' ? historyKey(config) : ''
      const previous = key ? (this.questionHistory.get(key) || []) : []
      const questions = config.source === 'groq'
        ? await this.groqFactory(config, this.aiKey, {
          onProgress: progress,
          onCheckpoint: (items) => { if (role === 'host' && this.abortController === controller && Array.isArray(items)) this.partialQuestions = items },
          initialQuestions: role === 'host' ? this.partialQuestions : [],
          signal: controller.signal,
          avoidPrompts: previous,
        })
        : this.practiceFactory(config)
      if (this.abortController !== controller || controller.signal.aborted) return
      if (!Array.isArray(questions) || questions.length !== config.count || !questions.every(isValidQuestion)) throw new Error('Soal yang dibuat belum lengkap. Silakan coba lagi.')
      if (key) {
        if (!this.questionHistory.has(key) && this.questionHistory.size >= 10) this.questionHistory.delete(this.questionHistory.keys().next().value)
        this.questionHistory.delete(key)
        this.questionHistory.set(key, [...previous, ...questions.map((question) => question.prompt)].slice(-1000))
      }
      const gameId = makeToken()
      this.partialQuestions = []
      this.outgoing = null
      this.patch({ questions, answers: [], gameId, opponentProgress: 0, preparation: null })
      if (role === 'solo') {
        this.patch({ screen: 'quiz', status: 'playing', startedAt: this.clock() })
      } else if (this.state.connected) {
        this.sendQuestions()
      } else {
        this.patch({ status: 'waiting', error: 'Teman terputus. Soal sudah siap dan akan dikirim saat teman kembali.' })
      }
    } catch (error) {
      if (controller.signal.aborted || this.abortController !== controller) return
      const saved = role === 'host' && this.partialQuestions.length ? ' Soal yang sudah dibuat tersimpan sementara; mulai lagi untuk melanjutkan.' : ''
      this.patch({ status: role === 'solo' ? 'error' : this.state.connected ? 'joined' : 'waiting', preparation: null, error: (error?.message || 'Soal belum berhasil disiapkan. Silakan coba lagi.') + saved })
      if (role === 'host') this.send({ type: 'preparation-failed' })
    } finally {
      if (this.abortController === controller) this.abortController = null
    }
  }

  armTransferTimeout(transfer) {
    if (this.activeTransfer !== transfer) return
    clearTimeout(this.readyTimer)
    // Only an idle transfer times out; actual progress extends the deadline.
    this.readyTimer = setTimeout(() => this.retryTransfer(transfer), this.transferIdleMs)
  }

  retryTransfer(transfer) {
    if (this.activeTransfer !== transfer) return
    if (!transfer.connection.open || this.connection !== transfer.connection) {
      this.connectionClosed(transfer.connection)
      return
    }
    if (transfer.attempt + 1 < this.maxTransferAttempts) {
      this.sendQuestions(transfer.attempt + 1)
      return
    }
    this.cancelTransfer()
    if (this.state.screen === 'lobby') {
      this.patch({ status: 'joined', preparation: null, error: 'Soal sudah dibuat, tetapi belum terkirim. Tekan Kirim soal lagi; jika masih gagal, kedua pemain perlu memuat ulang halaman.' })
    } else {
      this.patch({ error: 'Soal belum tersinkron. Minta teman menghubungkan kembali.' })
    }
    this.send({ type: 'transfer-failed', gameId: transfer.gameId })
  }

  async sendQuestions(attempt = 0) {
    const { questions, gameId } = this.state
    const connection = this.connection
    if (!connection?.open || !gameId || !questions.length) return
    this.cancelTransfer()
    let payload
    try {
      if (this.outgoing?.gameId !== gameId) this.outgoing = { gameId, payload: encodeQuestions(questions) }
      payload = this.outgoing.payload
    } catch (error) {
      this.patch({ status: 'joined', preparation: null, error: error?.message || 'Paket soal belum dapat dikirim.' })
      this.send({ type: 'transfer-failed', gameId })
      return
    }
    const transfer = { gameId, connection, attempt, payload, transferId: makeToken() }
    this.activeTransfer = transfer
    if (this.state.screen === 'lobby') this.patch({ status: 'sending', preparation: { phase: 'transfer', done: 0, total: payload.chunks.length }, error: '' })
    const active = () => this.activeTransfer === transfer && this.connection === connection && connection.open && this.state.gameId === gameId
    const send = (message) => active() && this.send(message) && active()
    if (!send({ type: 'game-init', protocol: TRANSFER_PROTOCOL, gameId, transferId: transfer.transferId, total: questions.length, bytes: payload.bytes, chunks: payload.chunks.length, checksum: payload.checksum })) {
      if (active()) this.retryTransfer(transfer)
      return
    }
    this.armTransferTimeout(transfer)
    for (let index = 0; index < payload.chunks.length; index += 1) {
      // Avoid flooding the RTCDataChannel (or PeerJS's own queue) on slow links.
      while (active() && ((connection.dataChannel?.bufferedAmount || 0) > MAX_BUFFERED_BYTES || (connection.bufferSize || 0) > 0)) {
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      if (!active()) return
      if (!send({ type: 'question-data', gameId, transferId: transfer.transferId, index, data: payload.chunks[index] })) {
        if (active()) this.retryTransfer(transfer)
        return
      }
      // Yield periodically so incoming progress, disconnects and the UI are processed.
      if (index % 16 === 15) await new Promise((resolve) => setTimeout(resolve, 0))
    }
    if (!active()) return
    if (!send({ type: 'game-loaded', gameId, transferId: transfer.transferId }) && active()) this.retryTransfer(transfer)
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
