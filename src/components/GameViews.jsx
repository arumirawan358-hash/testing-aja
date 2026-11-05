import { useEffect, useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { AlertCircle, ArrowLeft, ArrowRight, BadgeCheck, BookOpen, Check, CheckCircle2, Clock3, Copy, DoorOpen, GraduationCap, Hash, Link2, LoaderCircle, LockKeyhole, RotateCcw, Share2, Sparkles, Target, Trophy, UserRound, UsersRound, WandSparkles, X, XCircle, Zap } from 'lucide-react'
import Brand from './Brand.jsx'
import { subjectName } from '../data/subjects.js'

function GameHeader({ state, session }) {
  function leave() {
    if (state.screen === 'results' || state.role === 'solo' || window.confirm('Yakin ingin keluar? Permainan yang sedang berlangsung akan ditutup.')) session.quit()
  }
  return (
    <header className="game-header"><div className="container game-header-inner"><Brand onClick={leave} /><div className="game-header-right">{state.code && <span className="header-room"><span /> RUANG {state.code}</span>}<button className="exit-button" onClick={leave}><DoorOpen size={17} /> <span>Keluar</span></button></div></div></header>
  )
}

function Notice({ state, session }) {
  if (!state.error) return null
  const canReconnect = state.role === 'guest' && !state.connected && !['error', 'connecting'].includes(state.status)
  return <div className="notice" role="alert"><AlertCircle size={19} /><span>{state.error}</span>{canReconnect && <button onClick={() => session.reconnect()}><RotateCcw size={14} /> Hubungkan lagi</button>}</div>
}

function makeShareLink(code) {
  const url = new URL(window.location.href)
  url.search = ''
  url.searchParams.set('room', code)
  url.hash = 'gabung'
  return url.toString()
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  const input = document.createElement('textarea')
  input.value = text
  input.setAttribute('readonly', '')
  input.style.cssText = 'position:fixed;left:-9999px;top:0'
  document.body.appendChild(input)
  input.select()
  const ok = document.execCommand('copy')
  input.remove()
  if (!ok) throw new Error('copy failed')
}

function PlayerCard({ name, label, color, waiting = false }) {
  return <div className={`lobby-player ${waiting ? 'player-empty' : ''}`}><div className={`player-avatar ${color}`}>{waiting ? <UserRound size={23} /> : (name?.charAt(0).toUpperCase() || '?')}</div><div className="player-details"><span>{label}</span><strong>{waiting ? 'Menunggu teman...' : name}</strong><small>{waiting ? 'Bagikan kode ruangmu' : <><span className="online-dot" /> Siap bermain</>}</small></div>{!waiting && <BadgeCheck className="player-check" size={20} />}</div>
}

function SettingsSummary({ config }) {
  if (!config) return null
  return <div className="settings-summary"><div><GraduationCap size={17} /><span>Jenjang <strong>{config.level} · Kelas {config.grade}</strong></span></div><div><BookOpen size={17} /><span>Pelajaran <strong>{subjectName(config)}</strong></span></div><div><LayersIcon /><span>Jumlah <strong>{config.count} soal</strong></span></div><div><Sparkles size={17} /><span>Sumber <strong>{config.source === 'ai' ? 'Gemini AI' : 'Bank soal'}</strong></span></div></div>
}
function LayersIcon() { return <span className="layers-symbol">◫</span> }

export function Lobby({ state, session }) {
  const [copied, setCopied] = useState('')
  const code = state.code
  const shareLink = useMemo(() => code ? makeShareLink(code) : '', [code])
  const isHost = state.role === 'host'
  const isSolo = state.role === 'solo'
  const isPreparing = state.status === 'preparing' || state.status === 'ready'
  const isConnecting = state.status === 'connecting'
  const hostName = isHost ? state.selfName : state.opponentName
  const guestName = isHost ? state.opponentName : state.selfName
  const shareEnabled = isHost && !['connecting', 'error'].includes(state.status)
  const progress = state.preparation ? Math.round(100 * state.preparation.done / Math.max(1, state.preparation.total)) : 0

  async function copy(value, kind) {
    try { await copyText(value); setCopied(kind); setTimeout(() => setCopied(''), 2200) } catch { setCopied('failed'); setTimeout(() => setCopied(''), 3000) }
  }
  async function share() {
    if (navigator.share) {
      try { await navigator.share({ title: 'Main KuisKita bareng!', text: `Yuk, belajar bareng di KuisKita! Kode ruang: ${code}`, url: shareLink }); return } catch (error) { if (error?.name === 'AbortError') return }
    }
    copy(shareLink, 'link')
  }
  return (
    <div className="game-page lobby-page"><GameHeader state={state} session={session} />
      <main className="game-container lobby-container">
        <div className="game-intro"><span className="eyebrow section-eyebrow"><span>✦</span> {isSolo ? 'LATIHAN SENDIRI' : 'RUANG BELAJAR'}</span><h1>{isSolo ? 'Sebentar, ya!' : isHost ? 'Ruangmu sudah siap!' : isConnecting ? 'Menghubungkan ke ruang...' : 'Yuk, belajar bareng!'}</h1><p>{isSolo ? 'Petualangan belajarmu sedang disiapkan.' : isHost ? 'Bagikan kode ini ke temanmu untuk mulai bermain.' : 'Kamu dan temanmu akan mengerjakan soal yang sama.'}</p></div>
        <Notice state={state} session={session} />
        {isSolo ? (
          <div className="surface solo-loading"><div className="loading-art"><Sparkles size={32} /></div>{state.status === 'error' ? <><h2>Soal belum berhasil disiapkan</h2><p>Periksa pengaturan atau pilih bank soal, lalu coba lagi.</p><button className="button button-primary" onClick={() => session.quit()}>Kembali ke pengaturan <ArrowRight size={18} /></button></> : <><LoaderCircle className="spin" size={27} /><h2>Sedang menyiapkan soal...</h2><p>Mohon tunggu sebentar, jangan tutup halaman ini.</p><div className="wide-progress"><span style={{ width: `${progress}%` }} /></div><small>{state.preparation?.done || 0} dari {state.config?.count} soal siap</small></>}</div>
        ) : (
          <div className="lobby-grid">
            <section className="surface room-code-card">
              <div className="lobby-card-heading"><div><span className="small-label">KODE RUANG</span><h2>Undang temanmu <span>✦</span></h2><p>Masukkan kode ini di halaman gabung ruang.</p></div><span className="heading-icon purple"><KeyIcon /></span></div>
              <div className="room-code" aria-label={`Kode ruang ${code}`}>{code.split('').map((letter, index) => <span key={`${letter}-${index}`}>{letter}</span>)}</div>
              <div className="room-code-actions"><button className="button button-soft" disabled={!shareEnabled && isHost} onClick={() => copy(code, 'code')}>{copied === 'code' ? <Check size={17} /> : <Copy size={17} />} {copied === 'code' ? 'Kode disalin!' : 'Salin kode'}</button><button className="button button-outline" disabled={!shareEnabled && isHost} onClick={share}><Share2 size={17} /> {copied === 'link' ? 'Tautan disalin!' : 'Bagikan tautan'}</button></div>
              {copied === 'failed' && <p className="copy-error">Tidak bisa menyalin otomatis. Kamu tetap bisa menyalin kode di atas.</p>}
              <div className="qr-area"><div className="qr-box"><QRCodeSVG value={shareLink} size={70} bgColor="#ffffff" fgColor="#302654" level="M" /></div><div><strong>Atau pindai untuk gabung</strong><p>Temanmu bisa membuka tautan dan memasukkan nama.</p></div></div>
              <div className="private-note"><LockKeyhole size={15} /> Bagikan kode hanya kepada temanmu. Ruang aktif selama halaman host tetap terbuka.</div>
            </section>
            <section className="surface lobby-players-card"><div className="lobby-card-heading"><div><span className="small-label">PEMAIN DI RUANGAN</span><h2>Tim pintar <span>✳</span></h2><p>Maksimal 2 pemain dalam satu ruang.</p></div><span className="player-count">{state.connected ? '2' : '1'} / 2</span></div>
              <div className="lobby-player-list"><PlayerCard name={hostName} label="PEMBUAT RUANG" color="lavender" waiting={!hostName} /><PlayerCard name={guestName} label={isHost ? 'TEMANMU' : 'KAMU'} color="peach" waiting={!guestName || (isHost && !state.connected)} /></div>
              <SettingsSummary config={state.config} />
              {isPreparing ? <div className="preparing-box"><div><LoaderCircle className="spin" size={20} /><strong>{state.status === 'ready' ? 'Hampir siap...' : 'Menyiapkan soal...'}</strong></div><div className="wide-progress"><span style={{ width: `${state.status === 'ready' ? 100 : progress}%` }} /></div><small>{state.status === 'ready' ? 'Menunggu kedua pemain siap.' : `${state.preparation?.done || 0} dari ${state.config?.count || 0} soal siap. Jangan tutup halaman ini.`}</small></div> : isHost ? <><button className="button button-primary lobby-start" disabled={!state.connected || isConnecting || state.status === 'error'} onClick={() => session.startGame()}>Mulai permainan <ArrowRight size={18} /></button><p className="under-button">{state.connected ? 'Semua siap! Petualangan dimulai saat kamu menekan tombol.' : 'Tombol akan aktif setelah temanmu bergabung.'}</p></> : <div className="guest-wait"><span className="pulse-dot" /> {isConnecting ? 'Menghubungkan ke ruang...' : state.connected ? 'Menunggu host memulai permainan...' : 'Menunggu koneksi...'}</div>}
              {state.role === 'guest' && !state.connected && !isConnecting && state.status !== 'error' && <button className="button button-soft reconnect-button" onClick={() => session.reconnect()}><RotateCcw size={16} /> Hubungkan lagi</button>}
            </section>
          </div>
        )}
        <button className="back-home" onClick={() => session.quit()}><ArrowLeft size={16} /> Kembali ke beranda</button>
      </main>
    </div>
  )
}
function KeyIcon() { return <Hash size={22} /> }

function Timer({ startedAt }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const seconds = Math.max(0, Math.floor((now - (startedAt || now)) / 1000))
  return <span className="timer"><Clock3 size={15} /> {String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</span>
}

function ProgressPlayer({ name, count, total, color, self }) {
  return <div className="progress-player"><div className="progress-label"><div><span className={`tiny-avatar ${color}`}>{name?.charAt(0).toUpperCase() || '?'}</span><strong>{name || 'Teman'}</strong>{self && <small>(kamu)</small>}</div><b>{count}<span>/{total}</span></b></div><div className="player-progress"><span className={color} style={{ width: `${100 * count / Math.max(1, total)}%` }} /></div></div>
}

export function Quiz({ state, session }) {
  const [selected, setSelected] = useState(null)
  const index = state.answers.length
  const question = state.questions[index]
  useEffect(() => setSelected(null), [index, state.gameId])
  if (!question) return null
  const total = state.questions.length
  const disconnected = state.role !== 'solo' && !state.connected
  return <div className="game-page quiz-page"><GameHeader state={state} session={session} /><main className="game-container quiz-container">
    <div className="quiz-heading"><div><span className="eyebrow section-eyebrow"><span>✦</span> AYO, KAMU PASTI BISA!</span><h1>Satu soal lebih dekat ke hebat.</h1><p>Tarik napas, baca soalnya, dan jawab semampumu.</p></div><div className="quiz-illustration">✳<span>✦</span></div></div>
    <Notice state={state} session={session} />
    <div className="quiz-progress surface"><ProgressPlayer name={state.selfName} count={index} total={total} color="purple" self />{state.role !== 'solo' && <ProgressPlayer name={state.opponentName} count={state.opponentProgress} total={total} color="orange" />}</div>
    <section className="surface question-card"><div className="question-topline"><span className="question-count"><span>SOAL {index + 1}</span> <small>/ {total}</small></span><Timer startedAt={state.startedAt} /></div><div className="question-subject"><BookOpen size={14} /> {subjectName(state.config)} <span>•</span> Kelas {state.config.grade}</div><h2>{question.prompt}</h2><div className="answer-options" role="radiogroup" aria-label={`Pilihan jawaban soal ${index + 1}`}>{question.options.map((option, optionIndex) => <button type="button" role="radio" aria-checked={selected === optionIndex} className={`answer-option ${selected === optionIndex ? 'selected' : ''}`} key={optionIndex} onClick={() => setSelected(optionIndex)}><span className="answer-letter">{'ABCD'[optionIndex]}</span><span className="answer-text">{option}</span><span className="answer-circle">{selected === optionIndex && <Check size={14} />}</span></button>)}</div><div className="question-actions"><button className="skip-button" disabled={disconnected} onClick={() => session.submitAnswer(null)}>Lewati soal</button><button className="button button-primary next-button" disabled={selected === null || disconnected} onClick={() => session.submitAnswer(selected)}>{index === total - 1 ? 'Selesaikan kuis' : 'Soal selanjutnya'} <ArrowRight size={18} /></button></div><p className="answer-note"><LockKeyhole size={14} /> Jawaban dan pembahasan akan terlihat setelah permainan selesai.</p></section>
    <div className="encouragement"><Sparkles size={16} /> Setiap jawaban adalah langkah untuk belajar. Semangat!</div>
  </main></div>
}

export function Waiting({ state, session }) {
  return <div className="game-page"><GameHeader state={state} session={session} /><main className="game-container waiting-container"><Notice state={state} session={session} /><div className="surface waiting-card"><div className="celebration-icon"><CheckCircle2 size={36} /></div><span className="eyebrow section-eyebrow"><span>✦</span> KERJA BAGUS!</span><h1>Kamu sudah selesai!</h1><p>Sekarang kita tunggu <strong>{state.opponentName || 'temanmu'}</strong> menyelesaikan kuis. Hasil kalian akan muncul otomatis.</p><div className="waiting-progress"><ProgressPlayer name={state.opponentName} count={state.opponentProgress} total={state.questions.length} color="orange" /></div>{state.connected ? <div className="guest-wait"><span className="pulse-dot" /> Menunggu teman menyelesaikan kuis...</div> : state.role === 'guest' && <button className="button button-soft" onClick={() => session.reconnect()}><RotateCcw size={16} /> Hubungkan lagi</button>}</div></main></div>
}

function formatTime(ms) {
  const seconds = Math.max(0, Math.floor((ms || 0) / 1000))
  const minutes = Math.floor(seconds / 60)
  return minutes ? `${minutes} m ${seconds % 60} d` : `${seconds} detik`
}

function ScoreCard({ player, self, winner }) {
  return <div className={`score-card ${self ? 'score-self' : ''}`}><div className="score-player"><span className={`player-avatar ${self ? 'lavender' : 'peach'}`}>{player.name.charAt(0).toUpperCase()}</span><span><strong>{player.name} {self && <small>(kamu)</small>}</strong><small>{winner ? '✦ Nilai tertinggi' : 'Pemain hebat'}</small></span></div><div className="score-number">{player.score}<small>/100</small></div><div className="score-stats"><span><CheckCircle2 size={15} /> {player.correct} benar</span><span><XCircle size={15} /> {player.wrong} salah</span><span><Clock3 size={15} /> {formatTime(player.elapsedMs)}</span></div>{player.skipped > 0 && <p className="skipped-count">{player.skipped} soal dilewati</p>}</div>
}

export function Results({ state, session }) {
  const [visible, setVisible] = useState(5)
  const result = state.result
  if (!result) return null
  const self = state.role === 'guest' ? result.guest : result.host
  const other = state.role === 'guest' ? result.host : result.guest
  const tie = other && self.score === other.score
  const winner = other && !tie ? (self.score > other.score ? self.name : other.name) : null
  return <div className="game-page results-page"><GameHeader state={state} session={session} /><main className="game-container results-container"><div className="result-heading"><div className="trophy-icon"><Trophy size={29} fill="currentColor" /></div><span className="eyebrow section-eyebrow"><span>✦</span> PERMAINAN SELESAI</span><h1>Hebat, kamu berhasil!</h1><p>{other ? tie ? 'Seri! Kalian sama-sama luar biasa.' : `${winner} mendapat nilai tertinggi. Kalian berdua keren!` : 'Setiap soal yang dikerjakan adalah langkah maju.'}</p></div>
    <div className={`score-grid ${!other ? 'single' : ''}`}><ScoreCard player={self} self winner={other && self.score > other.score} />{other && <ScoreCard player={other} winner={other.score > self.score} />}</div>
    <div className="result-tip"><Sparkles size={19} /><span><strong>Belajar nggak berhenti di sini.</strong> Yuk, lihat pembahasannya untuk tahu apa yang sudah kamu kuasai.</span></div>
    <section className="surface review-card"><div className="review-header"><div><span className="small-label">BELAJAR DARI JAWABANMU</span><h2>Pembahasan soal</h2><p>Nilai = jumlah benar ÷ jumlah soal × 100, dibulatkan.</p></div><span className="review-total">{state.questions.length} SOAL</span></div><div className="review-list">{state.questions.slice(0, visible).map((question, index) => {
      const answer = state.answers[index]
      const correct = answer === question.answer
      const skipped = answer === null || answer === undefined
      return <article className="review-item" key={question.id || index}><div className="review-item-heading"><span>SOAL {index + 1}</span><span className={`review-status ${correct ? 'correct' : 'incorrect'}`}>{correct ? <Check size={14} /> : <X size={14} />}{correct ? 'Benar' : skipped ? 'Dilewati' : 'Belum tepat'}</span></div><h3>{question.prompt}</h3><p>Jawabanmu: <strong className={correct ? 'correct-text' : 'incorrect-text'}>{skipped ? 'Dilewati' : question.options[answer]}</strong></p>{!correct && <p>Jawaban benar: <strong className="correct-text">{question.options[question.answer]}</strong></p>}<div className="explanation"><BookOpen size={16} /><span>{question.explanation}</span></div></article>
    })}</div>{visible < state.questions.length && <button className="button button-outline load-more" onClick={() => setVisible((current) => Math.min(state.questions.length, current + 10))}>Muat lebih banyak ({Math.min(visible, state.questions.length)}/{state.questions.length}) <ArrowRight size={16} /></button>}
    {state.config.source === 'ai' && <p className="ai-disclaimer">Soal dan pembahasan dibuat oleh AI dan bisa keliru. Periksa kembali dengan guru atau sumber tepercaya.</p>}</section>
    <button className="button button-primary play-again" onClick={() => session.quit()}><RotateCcw size={17} /> Main lagi</button>
  </main></div>
}
