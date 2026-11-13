import { useEffect, useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { AlertCircle, ArrowLeft, ArrowRight, BadgeCheck, BookOpen, Check, CheckCircle2, Clock3, Copy, DoorOpen, GraduationCap, Hash, Link2, LoaderCircle, LockKeyhole, RotateCcw, Share2, Sparkles, Target, Trophy, UserRound, UsersRound, WandSparkles, X, XCircle, Zap } from 'lucide-react'
import AnswerHint from './AnswerHint.jsx'
import Brand from './Brand.jsx'
import SoundToggle from './SoundToggle.jsx'
import MenuButtons from './MenuButtons.jsx'
import ChampionCelebration from './ChampionCelebration.jsx'
import { Avatar, PlayerProfileModal, RankBadge } from './ProfileCard.jsx'
import { usePreferences } from './PreferencesContext.jsx'
import { toViewProfile } from '../lib/ranks.js'
import { addFriend, loadFriends } from '../lib/friends.js'
import { gradeFieldLabel, gradeLabel, subjectName } from '../data/subjects.js'

function GameHeader({ state, session }) {
  function leave() {
    if (state.screen === 'results' || state.role === 'solo' || window.confirm('Yakin ingin keluar? Permainan yang sedang berlangsung akan ditutup.')) session.quit()
  }
  return (
    <header className="game-header"><div className="container game-header-inner"><Brand onClick={leave} /><div className="game-header-right">{state.code && <span className="header-room"><span /> RUANG {state.code}</span>}<SoundToggle /><MenuButtons /><button className="exit-button" aria-label="Keluar dari permainan" onClick={leave}><DoorOpen size={17} /> <span>Keluar</span></button></div></div></header>
  )
}

function Notice({ state, session }) {
  if (!state.error) return null
  const canReconnect = state.role === 'guest' && !state.connected && !['error', 'connecting'].includes(state.status)
  return <div className="notice" role="alert"><AlertCircle size={19} /><span>{state.error}</span>{canReconnect && <button onClick={() => session.reconnect()}><RotateCcw size={14} /> Hubungkan lagi</button>}</div>
}

export function makeShareLink(code) {
  const url = new URL(window.location.href)
  url.search = ''
  url.searchParams.set('room', code)
  url.hash = 'gabung'
  return url.toString()
}

export async function copyText(text) {
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

function PlayerCard({ name, label, color, waiting = false, profile, onOpenProfile, onAddFriend, friendAdded }) {
  return <div className={`lobby-player ${waiting ? 'player-empty' : ''}`}><Avatar avatarId={profile?.avatar} name={name} frame={profile?.frame} className={`player-avatar ${color}`} /><div className="player-details"><span>{label}</span><strong>{waiting ? 'Menunggu teman...' : name}</strong><small>{waiting ? 'Bagikan kode ruangmu' : <><span className="online-dot" /> {profile ? <RankBadge rank={profile.rank} compact /> : 'Siap bermain'}</>}</small></div>{!waiting && <div className="player-card-actions">{onAddFriend && <button type="button" className="friend-add-button" onClick={onAddFriend} disabled={friendAdded} aria-label={`Tambah teman ${name}`}>{friendAdded ? '✓ Teman' : '+ Teman'}</button>}{profile && onOpenProfile ? <button type="button" className="player-profile-link" onClick={onOpenProfile} aria-label={`Lihat profil ${name}`}>Profil</button> : <BadgeCheck className="player-check" size={20} />}</div>}</div>
}

function SettingsSummary({ config }) {
  if (!config) return null
  return <div className="settings-summary"><div><GraduationCap size={17} /><span>Jenjang <strong>{config.level} · {gradeLabel(config)}</strong></span></div><div><BookOpen size={17} /><span>Pelajaran <strong>{subjectName(config) || 'Bebas (instruksi AI)'}</strong></span></div>{config.topic && <div><Target size={17} /><span>Instruksi AI <strong>{config.topic}</strong></span></div>}<div><LayersIcon /><span>Jumlah <strong>{config.count} soal</strong></span></div><div><Sparkles size={17} /><span>Sumber <strong>{config.source === 'groq' ? 'Groq AI' : 'Bank soal'}</strong></span></div></div>
}
function LayersIcon() { return <span className="layers-symbol">◫</span> }

export function Lobby({ state, session }) {
  const [copied, setCopied] = useState('')
  const [viewing, setViewing] = useState(null)
  const [addedNames, setAddedNames] = useState(() => new Set())
  const { profile } = usePreferences()
  const selfProfile = toViewProfile(profile)
  const code = state.code
  const shareLink = useMemo(() => code ? makeShareLink(code) : '', [code])
  const isHost = state.role === 'host'
  const isSolo = state.role === 'solo'
  const isPreparing = ['preparing', 'sending', 'receiving', 'ready'].includes(state.status)
  const isConnecting = state.status === 'connecting'
  const transferring = state.preparation?.phase === 'transfer'
  const preparedRound = Boolean(state.gameId && state.questions.length)
  const preparationTitle = state.status === 'ready' ? 'Hampir siap...' : transferring ? (isHost ? 'Mengirim soal...' : 'Menerima soal...') : 'Menyiapkan soal...'
  const preparationDetail = state.status === 'ready' ? 'Menunggu kedua pemain siap.' : transferring ? `${state.preparation?.done || 0} dari ${state.preparation?.total || 0} bagian diterima. Permainan dimulai otomatis.` : `${state.preparation?.done || 0} dari ${state.config?.count || 0} soal siap. Permintaan AI dibuat bertahap; jangan tutup halaman.`
  const hostName = isHost ? state.selfName : state.opponentName
  const guestName = isHost ? state.opponentName : state.selfName
  const hostProfile = isHost ? selfProfile : state.opponentProfile
  const guestProfile = isHost ? state.opponentProfile : selfProfile
  const friends = isHost && state.connected ? loadFriends().filter((f) => f.name.toLocaleLowerCase('id-ID') !== (state.selfName || '').toLocaleLowerCase('id-ID')).slice(0, 6) : []
  function addOpponent() {
    if (!state.opponentProfile) return
    addFriend(state.opponentProfile)
    setAddedNames((current) => new Set(current).add(state.opponentProfile.name))
  }
  async function invite(friend) {
    const link = makeShareLink(code)
    try {
      if (navigator.share) { await navigator.share({ title: `Main KuisKita bareng ${friend.name}!`, text: `${friend.name}, yuk main KuisKita bareng! Kode ruang: ${code}`, url: link }); return }
    } catch (error) { if (error?.name === 'AbortError') return }
    copy(link, `invite-${friend.name}`)
  }
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
          <div className="surface solo-loading"><div className="loading-art"><Sparkles size={32} /></div>{state.status === 'error' ? <><h2>Soal belum berhasil disiapkan</h2><p>Periksa pengaturan atau pilih bank soal, lalu coba lagi.</p><button className="button button-primary" onClick={() => session.quit()}>Kembali ke pengaturan <ArrowRight size={18} /></button></> : <><LoaderCircle className="spin" size={27} /><h2>Sedang menyiapkan soal...</h2><p>Mohon tunggu, jangan tutup halaman ini. Soal AI dibuat bertahap dan mungkin perlu waktu saat kuota sedang sibuk.</p><div className="wide-progress"><span style={{ width: `${progress}%` }} /></div><small>{state.preparation?.done || 0} dari {state.config?.count} soal siap</small></>}</div>
        ) : (
          <div className="lobby-grid">
            <section className="surface room-code-card">
              <div className="lobby-card-heading"><div><span className="small-label">KODE RUANG</span><h2>Undang temanmu <span>✦</span></h2><p>Masukkan kode ini di halaman gabung ruang.</p></div><span className="heading-icon purple"><KeyIcon /></span></div>
              <div className="room-code" aria-label={`Kode ruang ${code}`}>{code.split('').map((letter, index) => <span key={`${letter}-${index}`}>{letter}</span>)}</div>
              <div className="room-code-actions"><button className="button button-soft" disabled={!shareEnabled && isHost} onClick={() => copy(code, 'code')}>{copied === 'code' ? <Check size={17} /> : <Copy size={17} />} {copied === 'code' ? 'Kode disalin!' : 'Salin kode'}</button><button className="button button-outline" disabled={!shareEnabled && isHost} onClick={share}><Share2 size={17} /> {copied === 'link' ? 'Tautan disalin!' : 'Bagikan tautan'}</button></div>
              {copied === 'failed' && <p className="copy-error">Tidak bisa menyalin otomatis. Kamu tetap bisa menyalin kode di atas.</p>}
              <div className="qr-area"><div className="qr-box"><QRCodeSVG value={shareLink} size={70} bgColor="#ffffff" fgColor="#302654" level="M" /></div><div><strong>Atau pindai untuk gabung</strong><p>Temanmu bisa membuka tautan dan memasukkan nama.</p></div></div>
              {friends.length > 0 && <div className="friend-invite-box"><span className="small-label">UNDANG TEMAN</span><div className="friend-invite-list">{friends.map((friend) => <div className="friend-invite-chip" key={friend.name}><Avatar avatarId={friend.avatar} name={friend.name} frame={friend.frame} className="friend-chip-avatar" /><strong>{friend.name}</strong><button type="button" className="friend-invite-button" onClick={() => invite(friend)} aria-label={`Undang ${friend.name}`}>{copied === `invite-${friend.name}` ? 'Tersalin!' : 'Undang'}</button></div>)}</div></div>}
              <div className="private-note"><LockKeyhole size={15} /> Bagikan kode hanya kepada temanmu. Ruang aktif selama halaman host tetap terbuka.</div>
            </section>
            <section className="surface lobby-players-card"><div className="lobby-card-heading"><div><span className="small-label">PEMAIN DI RUANGAN</span><h2>Tim pintar <span>✳</span></h2><p>Maksimal 2 pemain dalam satu ruang.</p></div><span className="player-count">{state.connected ? '2' : '1'} / 2</span></div>
              <div className="lobby-player-list"><PlayerCard name={hostName} label="PEMBUAT RUANG" color="lavender" waiting={!hostName} profile={hostProfile} onOpenProfile={hostProfile ? () => setViewing(hostProfile) : null} onAddFriend={!isHost && state.opponentProfile ? addOpponent : null} friendAdded={addedNames.has(state.opponentProfile?.name)} /><PlayerCard name={guestName} label={isHost ? 'TEMANMU' : 'KAMU'} color="peach" waiting={!guestName || (isHost && !state.connected)} profile={guestProfile} onOpenProfile={guestProfile ? () => setViewing(guestProfile) : null} onAddFriend={isHost && state.opponentProfile ? addOpponent : null} friendAdded={addedNames.has(state.opponentProfile?.name)} /></div>
              <SettingsSummary config={state.config} />
              {isPreparing ? <div className="preparing-box"><div><LoaderCircle className="spin" size={20} /><strong>{preparationTitle}</strong></div><div className="wide-progress"><span style={{ width: `${state.status === 'ready' ? 100 : progress}%` }} /></div><small>{preparationDetail}</small></div> : isHost ? <><button className="button button-primary lobby-start" disabled={!state.connected || isConnecting || state.status === 'error'} onClick={() => session.startGame()}>{preparedRound ? 'Kirim soal lagi' : 'Mulai permainan'} <ArrowRight size={18} /></button><p className="under-button">{state.connected ? (preparedRound ? 'Soal yang sudah dibuat akan digunakan kembali.' : 'Semua siap! Petualangan dimulai saat kamu menekan tombol.') : 'Tombol akan aktif setelah temanmu bergabung.'}</p></> : <div className="guest-wait"><span className="pulse-dot" /> {isConnecting ? 'Menghubungkan ke ruang...' : state.connected ? 'Menunggu host memulai permainan...' : 'Menunggu koneksi...'}</div>}
              {state.role === 'guest' && !state.connected && !isConnecting && state.status !== 'error' && <button className="button button-soft reconnect-button" onClick={() => session.reconnect()}><RotateCcw size={16} /> Hubungkan lagi</button>}
            </section>
          </div>
        )}
        <button className="back-home" onClick={() => session.quit()}><ArrowLeft size={16} /> Kembali ke beranda</button>
        <PlayerProfileModal profile={viewing} onClose={() => setViewing(null)} />
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
  const { hintEnabled } = usePreferences()
  const [selection, setSelection] = useState(null)
  const total = state.questions.length
  const index = Math.min(Math.max(state.cursor || 0, 0), Math.max(total - 1, 0))
  const question = state.questions[index]
  const saved = state.answers[index]
  const selected = selection?.gameId === state.gameId && selection?.index === index ? selection.answer : null
  const display = selected !== null ? selected : (typeof saved === 'number' ? saved : null)
  if (!question) return null
  const currentQuestion = { gameId: state.gameId, index }
  const answered = state.answers.filter((answer) => answer !== undefined).length
  const canFinish = state.answers.every((answer) => answer !== undefined)
  function jump(nextIndex) {
    setSelection(null)
    session.navigate(nextIndex)
  }
  function save() {
    if (display === null) return
    setSelection(null)
    session.submitAnswer(display, currentQuestion)
  }
  return <div className="game-page quiz-page"><GameHeader state={state} session={session} /><main className="game-container quiz-container">
    <div className="quiz-heading"><div><span className="eyebrow section-eyebrow"><span>✦</span> AYO, KAMU PASTI BISA!</span><h1>Satu soal lebih dekat ke hebat.</h1><p>Pilih soal mana pun yang mau dikerjakan lebih dulu; soal yang dilewati bisa kamu kembali kapan saja.</p></div><div className="quiz-illustration">✳<span>✦</span></div></div>
    <Notice state={state} session={session} />
    <div className="quiz-progress surface"><ProgressPlayer name={state.selfName} count={answered} total={total} color="purple" self />{state.role !== 'solo' && <ProgressPlayer name={state.opponentName} count={state.opponentProgress} total={total} color="orange" />}</div>
    <section className="surface question-nav" aria-label="Pilih soal"><div className="question-nav-head"><span className="small-label">PILIH SOAL</span><small>{answered} / {total} terjawab · ✕ dilewati bisa dikembali</small></div><div className="question-nav-grid">{state.questions.map((_, i) => {
      const slot = state.answers[i]
      const stateName = i === index ? 'current' : slot === undefined ? 'unanswered' : slot === null ? 'skipped' : 'answered'
      return <button type="button" key={i} className={`nav-dot ${stateName}`} onClick={() => jump(i)} aria-label={`Soal ${i + 1}${slot === undefined ? ' belum dikerjakan' : slot === null ? ' dilewati' : ' sudah dijawab'}`} aria-current={i === index}>{i + 1}</button>
    })}</div></section>
    <section className="surface question-card"><div className="question-topline"><span className="question-count"><span>SOAL {index + 1}</span> <small>/ {total}</small> <AnswerHint question={question} enabled={hintEnabled} /></span><Timer startedAt={state.startedAt} /></div><div className="question-subject"><BookOpen size={14} /> {subjectName(state.config) || 'Bebas (instruksi AI)'} <span>•</span> {gradeLabel(state.config)}</div><h2>{question.prompt}</h2><div className="answer-options" role="radiogroup" aria-label={`Pilihan jawaban soal ${index + 1}`}>{question.options.map((option, optionIndex) => <button type="button" role="radio" data-sound="answer" aria-checked={display === optionIndex} className={`answer-option ${display === optionIndex ? 'selected' : ''}`} key={optionIndex} onClick={() => setSelection({ ...currentQuestion, answer: optionIndex })}><span className="answer-letter">{'ABCD'[optionIndex]}</span><span className="answer-text">{option}</span><span className="answer-circle">{display === optionIndex && <Check size={14} />}</span></button>)}</div><div className="question-actions"><button type="button" className="skip-button" onClick={() => { setSelection(null); session.skipQuestion() }}>Lewati soal</button><button type="button" className="nav-arrow" onClick={() => jump(index - 1)} disabled={index === 0} aria-label="Soal sebelumnya">◀</button><button type="button" className="nav-arrow" onClick={() => jump(index + 1)} disabled={index === total - 1} aria-label="Soal berikutnya">▶</button><button type="button" className="button button-primary next-button" data-sound="next" disabled={display === null} onClick={save}>{display === null ? 'Pilih jawaban' : 'Simpan jawaban'} <ArrowRight size={18} /></button></div>{canFinish && <button type="button" className="button button-dark finish-button" data-sound="next" onClick={() => session.submitRound()}>Selesaikan kuis <Check size={18} /></button>}<p className="answer-note"><LockKeyhole size={14} /> Pembahasan tersedia setelah permainan selesai.</p></section>
    <div className="encouragement"><Sparkles size={16} /> Setiap jawaban adalah langkah untuk belajar. Semangat!</div>
  </main></div>
}

export function Waiting({ state, session }) {
  return <div className="game-page"><GameHeader state={state} session={session} /><main className="game-container waiting-container"><Notice state={state} session={session} /><div className="surface waiting-card"><div className="celebration-icon"><CheckCircle2 size={36} /></div><span className="eyebrow section-eyebrow"><span>✦</span> KERJA BAGUS!</span><h1>Kamu sudah selesai!</h1><p>{state.roomClosed ? 'Temanmu sudah meninggalkan ruang, jadi hasil bersama tidak dapat ditampilkan.' : state.connected ? <>Sekarang kita tunggu <strong>{state.opponentName || 'temanmu'}</strong> menyelesaikan kuis. Hasil kalian akan muncul otomatis.</> : 'Jawaban tersimpan sementara di tab ini. Hasil bersama akan muncul setelah koneksi kembali dan kedua pemain selesai. Jangan tutup atau muat ulang halaman.'}</p><div className="waiting-progress"><ProgressPlayer name={state.opponentName} count={state.opponentProgress} total={state.questions.length} color="orange" /></div>{!state.roomClosed && <div className="guest-wait"><span className="pulse-dot" /> {state.connected ? 'Menunggu teman menyelesaikan kuis...' : 'Menunggu koneksi kembali...'}</div>}</div></main></div>
}

function formatTime(ms) {
  const seconds = Math.max(0, Math.floor((ms || 0) / 1000))
  const minutes = Math.floor(seconds / 60)
  return minutes ? `${minutes} m ${seconds % 60} d` : `${seconds} detik`
}

function ScoreCard({ player, self, winner, profile, onOpenProfile, onAddFriend, friendAdded }) {
  return <div className={`score-card ${self ? 'score-self' : ''} ${winner ? 'score-winner' : ''}`}><div className="score-player"><Avatar avatarId={profile?.avatar} name={player.name} frame={profile?.frame} className={`player-avatar ${self ? 'lavender' : 'peach'}`} /><span><strong>{player.name} {self && <small>(kamu)</small>}</strong><small>{winner ? '✦ Nilai tertinggi' : 'Pemain hebat'}</small>{profile && <RankBadge rank={profile.rank} compact />}</span><div className="player-card-actions">{onAddFriend && <button type="button" className="friend-add-button" onClick={onAddFriend} disabled={friendAdded} aria-label={`Tambah teman ${player.name}`}>{friendAdded ? '✓ Teman' : '+ Teman'}</button>}{profile && onOpenProfile && <button type="button" className="player-profile-link" onClick={onOpenProfile} aria-label={`Lihat profil ${player.name}`}>Profil</button>}</div></div><div className="score-number">{player.score}<small>/100</small></div><div className="score-stats"><span><CheckCircle2 size={15} /> {player.correct} benar</span><span><XCircle size={15} /> {player.wrong} salah</span><span><Clock3 size={15} /> {formatTime(player.elapsedMs)}</span></div>{player.skipped > 0 && <p className="skipped-count">{player.skipped} soal dilewati</p>}</div>
}

export function Results({ state, session }) {
  const [visible, setVisible] = useState(5)
  const [viewing, setViewing] = useState(null)
  const [friendAdded, setFriendAdded] = useState(false)
  const { profile } = usePreferences()
  const selfProfile = toViewProfile(profile)
  const result = state.result
  if (!result) return null
  const self = state.role === 'guest' ? result.guest : result.host
  const other = state.role === 'guest' ? result.host : result.guest
  const tie = other && self.score === other.score
  const winner = other && !tie ? (self.score > other.score ? self.name : other.name) : null
  const winnerProfile = winner && winner === self.name ? selfProfile : winner ? state.opponentProfile : null
  return <div className="game-page results-page"><GameHeader state={state} session={session} /><main className="game-container results-container"><div className="result-heading"><div className="trophy-icon"><Trophy size={29} fill="currentColor" /></div><span className="eyebrow section-eyebrow"><span>✦</span> PERMAINAN SELESAI</span><h1>Hebat, kamu berhasil!</h1><p>{other ? tie ? 'Seri! Kalian sama-sama luar biasa.' : `${winner} mendapat nilai tertinggi. Kalian berdua keren!` : 'Setiap soal yang dikerjakan adalah langkah maju.'}</p></div>
    <Notice state={state} session={session} />
    {winner && <ChampionCelebration winnerName={winner} rank={winnerProfile?.rank} selfWon={winner === self.name} />}
    <div className={`score-grid ${!other ? 'single' : ''}`}><ScoreCard player={self} self winner={other && self.score > other.score} profile={selfProfile} onOpenProfile={() => setViewing(selfProfile)} />{other && <ScoreCard player={other} winner={other.score > self.score} profile={state.opponentProfile} onOpenProfile={state.opponentProfile ? () => setViewing(state.opponentProfile) : null} onAddFriend={state.opponentProfile ? () => { addFriend(state.opponentProfile); setFriendAdded(true) } : null} friendAdded={friendAdded} />}</div>
    <div className="result-tip"><Sparkles size={19} /><span><strong>Belajar nggak berhenti di sini.</strong> Yuk, lihat pembahasannya untuk tahu apa yang sudah kamu kuasai.</span></div>
    <section className="surface review-card"><div className="review-header"><div><span className="small-label">BELAJAR DARI JAWABANMU</span><h2>Pembahasan soal</h2><p>Nilai = jumlah benar ÷ jumlah soal × 100, dibulatkan.</p></div><span className="review-total">{state.questions.length} SOAL</span></div><div className="review-list">{state.questions.slice(0, visible).map((question, index) => {
      const answer = state.answers[index]
      const correct = answer === question.answer
      const skipped = answer === null || answer === undefined
      return <article className="review-item" key={question.id || index}><div className="review-item-heading"><span>SOAL {index + 1}</span><span className={`review-status ${correct ? 'correct' : 'incorrect'}`}>{correct ? <Check size={14} /> : <X size={14} />}{correct ? 'Benar' : skipped ? 'Dilewati' : 'Belum tepat'}</span></div><h3>{question.prompt}</h3><p>Jawabanmu: <strong className={correct ? 'correct-text' : 'incorrect-text'}>{skipped ? 'Dilewati' : question.options[answer]}</strong></p>{!correct && <p>Jawaban benar: <strong className="correct-text">{question.options[question.answer]}</strong></p>}<div className="explanation"><BookOpen size={16} /><span>{question.explanation}</span></div></article>
    })}</div>{visible < state.questions.length && <button className="button button-outline load-more" onClick={() => setVisible((current) => Math.min(state.questions.length, current + 10))}>Muat lebih banyak ({Math.min(visible, state.questions.length)}/{state.questions.length}) <ArrowRight size={16} /></button>}
    {state.config.source !== 'bank' && <p className="ai-disclaimer">Soal dan pembahasan dibuat oleh AI dan bisa keliru. Periksa kembali dengan guru atau sumber tepercaya.</p>}</section>
    <div className="replay-area">
      {state.role !== 'solo' && <p className="replay-note">{state.opponentRematchRequested ? `${state.opponentName} siap main lagi!` : 'Kalau kalian berdua siap, kembali ke ruang untuk bermain lagi.'}</p>}
      <div className="replay-actions">
        <button className="button button-primary" data-sound="next" disabled={state.role !== 'solo' && (!state.connected || state.rematchRequested)} onClick={() => session.playAgain()}><RotateCcw size={17} /> {state.rematchRequested ? 'Menunggu teman...' : 'Main lagi'}</button>
        <button className="button button-outline" onClick={() => session.quit()}>{state.role === 'solo' ? 'Ubah pengaturan' : 'Keluar ke beranda'}</button>
      </div>
      <PlayerProfileModal profile={viewing} onClose={() => setViewing(null)} />
      {state.config.source === 'groq' && <p className="replay-hint">Soal baru diupayakan berbeda. AI masih bisa mengulang atau membuat kesalahan.</p>}
    </div>
  </main></div>
}
