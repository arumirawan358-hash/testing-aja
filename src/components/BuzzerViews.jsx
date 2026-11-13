import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, BadgeCheck, Check, CheckCircle2, Clock3, Copy, Crown, DoorOpen, Flame, Hash, Link2, LoaderCircle, LockKeyhole, LogOut, RotateCcw, Send, Share2, SkipForward, Sparkles, Target, Trophy, UserRound, UsersRound, WandSparkles, X, XCircle, Zap } from 'lucide-react'
import AnswerHint from './AnswerHint.jsx'
import Brand from './Brand.jsx'
import SoundToggle from './SoundToggle.jsx'
import MenuButtons from './MenuButtons.jsx'
import { Avatar, RankBadge } from './ProfileCard.jsx'
import { usePreferences } from './PreferencesContext.jsx'
import { useSound } from './SoundContext.jsx'
import { toViewProfile } from '../lib/ranks.js'
import { addFriend, loadFriends } from '../lib/friends.js'
import { autoFillValue } from '../lib/buzzerQuestions.js'
import { ANSWER_METHODS, BUZZER_CATEGORIES, WRONG_PENALTIES, categoryLabel } from '../data/buzzerCategories.js'
import { MAX_PLAYERS } from '../lib/partySession.js'
import { copyText, makeShareLink } from './GameViews.jsx'

function BuzzerHeader({ state, session }) {
  return (
    <header className="game-header">
      <div className="container game-header-inner">
        <Brand onClick={() => { if (window.confirm('Yakin ingin keluar dari ruang ini?')) session.quit() }} />
        <div className="game-header-right">
          {state.code && <span className="header-room"><span /> RUANG {state.code}</span>}
          <SoundToggle /><MenuButtons />
          <button className="exit-button" aria-label="Keluar dari permainan" onClick={() => session.quit()}><DoorOpen size={17} /> <span>Keluar</span></button>
        </div>
      </div>
    </header>
  )
}

function Notice({ state }) {
  if (!state.error) return null
  return <div className="game-notice" role="alert"><span>{state.roomClosed ? '⛔' : '📶'}</span> {state.error}</div>
}

function PartyPlayerCard({ player, self, onAddFriend, friendAdded, rank }) {
  return (
    <div className={`party-player ${player.connected ? '' : 'offline'} ${self ? 'self' : ''}`}>
      <Avatar avatarId={player.avatar} name={player.name} frame={player.frame} className="player-avatar" />
      <div className="party-player-info">
        <strong>{player.name} {self && <small>(kamu)</small>}</strong>
        <small>
          {player.isHost && <span className="mini-pill">HOST</span>}
          {player.connected ? <span className="online-dot" /> : <span className="offline-dot" />}
          {player.connected ? 'Online' : 'Putus'}
          {rank && <RankBadge rank={rank} compact />}
        </small>
      </div>
      {!self && onAddFriend && (
        <button type="button" className="friend-add-button" onClick={onAddFriend} disabled={friendAdded} aria-label={`Tambah teman ${player.name}`}>{friendAdded ? '✓ Teman' : '+ Teman'}</button>
      )}
    </div>
  )
}

export function BuzzerLobby({ state, session }) {
  const { play } = useSound()
  const { profile } = usePreferences()
  const [copied, setCopied] = useState('')
  const [addedNames, setAddedNames] = useState(() => new Set())
  const isHost = state.role === 'host'
  const settings = state.settings || {}
  const shareLink = useMemo(() => (state.code ? makeShareLink(state.code) : ''), [state.code])
  const friends = isHost ? loadFriends().filter((f) => f.name.toLocaleLowerCase('id-ID') !== (state.selfName || '').toLocaleLowerCase('id-ID')).slice(0, 6) : []
  const preparing = state.status === 'preparing'
  const progress = state.preparation ? Math.round((100 * state.preparation.done) / Math.max(1, state.preparation.total)) : 0
  const viewers = useMemo(() => state.players.map((player) => ({ player, view: player.token === state.selfToken ? toViewProfile(profile) : player.profile })), [state.players, state.selfToken, profile])

  async function copy(value, kind) {
    try { await copyText(value); setCopied(kind); setTimeout(() => setCopied(''), 2200) } catch { setCopied('failed'); setTimeout(() => setCopied(''), 3000) }
  }
  async function invite(friend) {
    const link = makeShareLink(state.code)
    try {
      if (navigator.share) { await navigator.share({ title: `Main KuisKita bareng ${friend.name}!`, text: `${friend.name}, yuk main mode Siapa Cepat Dia Menjawab! Kode ruang: ${state.code}`, url: link }); return }
    } catch (error) { if (error?.name === 'AbortError') return }
    copy(link, `invite-${friend.name}`)
  }
  function setSetting(partial) {
    if (!isHost) return
    play('click')
    session.updateSettings(partial)
  }

  return (
    <div className="game-page lobby-page">
      <BuzzerHeader state={state} session={session} />
      <main className="game-container">
        <div className="lobby-heading">
          <div>
            <span className="eyebrow section-eyebrow"><span>✦</span> MODE SIAPA CEPAT DIA MENJAWAB</span>
            <h1>Ruang adu cepat!</h1>
            <p>Kumpulkan sampai <strong>5 pemain</strong>, atur kategorinya, lalu buktikan siapa yang paling cepat menjawab.</p>
          </div>
          <div className="room-code-card surface">
            <span className="small-label">KODE RUANG</span>
            <strong className="room-code">{state.code}</strong>
            <div className="room-code-actions">
              <button type="button" className="button button-dark" onClick={() => copy(state.code, 'code')} aria-label="Salin kode ruang"><Copy size={15} /> {copied === 'code' ? 'Tersalin!' : 'Salin'}</button>
              <button type="button" className="button button-dark" onClick={() => copy(shareLink, 'link')} aria-label="Salin tautan undangan"><Link2 size={15} /> {copied === 'link' ? 'Tersalin!' : 'Tautan'}</button>
            </div>
          </div>
        </div>
        <Notice state={state} />
        <div className="party-lobby-grid">
          <section className="surface party-players-panel">
            <div className="panel-title-row"><h2><UsersRound size={19} /> Pemain di ruang</h2><span className="mini-pill">{state.players.length} / {MAX_PLAYERS}</span></div>
            <div className="party-players-grid" data-testid="party-player-list">
              {viewers.map(({ player, view }) => (
                <PartyPlayerCard
                  key={player.token} player={player} self={player.token === state.selfToken}
                  rank={view?.rank}
                  onAddFriend={player.token !== state.selfToken && player.profile ? () => { addFriend(player.profile); setAddedNames((current) => new Set(current).add(player.name)); play('join') } : null}
                  friendAdded={addedNames.has(player.name)}
                />
              ))}
              {Array.from({ length: Math.max(0, MAX_PLAYERS - state.players.length) }).map((_, index) => (
                <div className="party-player waiting" key={`empty-${index}`}><span className="party-empty-avatar">?</span><div className="party-player-info"><strong>Menunggu pemain...</strong><small>Bagikan kode ruangmu</small></div></div>
              ))}
            </div>
            {friends.length > 0 && (
              <div className="friend-invite-box">
                <span className="small-label">UNDANG TEMAN</span>
                <div className="friend-invite-list">
                  {friends.map((friend) => (
                    <div className="friend-invite-chip" key={friend.name}>
                      <Avatar avatarId={friend.avatar} name={friend.name} frame={friend.frame} className="friend-chip-avatar" />
                      <strong>{friend.name}</strong>
                      <button type="button" className="friend-invite-button" onClick={() => invite(friend)} aria-label={`Undang ${friend.name}`}>{copied === `invite-${friend.name}` ? 'Tersalin!' : 'Undang'}</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
          <section className="surface party-settings-panel">
            <div className="panel-title-row"><h2><Target size={19} /> Pengaturan permainan</h2>{!isHost && <span className="mini-pill">Dikontrol host</span>}</div>
            <label className="field"><span>Kategori pertanyaan</span>
              <select value={settings.category} disabled={!isHost} onChange={(event) => setSetting({ category: event.target.value })} aria-label="Kategori pertanyaan">
                {BUZZER_CATEGORIES.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
              </select>
            </label>
            {settings.category === 'Lainnya (AI)' && isHost && (
              <label className="field"><span>Nama kategori <i>*</i></span><input value={settings.customCategory || ''} maxLength={60} placeholder="Contoh: Pengetahuan Sepak Bola" onChange={(event) => setSetting({ customCategory: event.target.value })} aria-label="Nama kategori custom" /></label>
            )}
            <div className="field"><span>Metode menjawab</span>
              <div className="method-options" role="radiogroup" aria-label="Metode menjawab">
                {ANSWER_METHODS.map((method) => (
                  <button type="button" key={method.id} role="radio" aria-checked={settings.method === method.id} disabled={!isHost} className={`method-option ${settings.method === method.id ? 'selected' : ''}`} onClick={() => setSetting({ method: method.id })}>
                    <strong>{method.label}</strong><small>{method.detail}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="form-row">
              <label className="field"><span>Jumlah soal</span>
                <div className="number-input"><input type="number" min="1" max="50" value={settings.count} disabled={!isHost} onChange={(event) => setSetting({ count: event.target.value })} aria-label="Jumlah soal" /><span>soal</span></div>
              </label>
              <label className="field"><span>Jawaban salah</span>
                <select value={settings.wrongPenalty} disabled={!isHost} onChange={(event) => setSetting({ wrongPenalty: Number(event.target.value) })} aria-label="Aturan penalti salah">
                  {WRONG_PENALTIES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </label>
            </div>
            <div className="field"><span>Sumber soal</span>
              <div className="source-options" role="radiogroup" aria-label="Sumber soal buzzer">
                <button type="button" role="radio" aria-checked={settings.source === 'bank'} disabled={!isHost} className={`source-option ${settings.source === 'bank' ? 'selected' : ''}`} onClick={() => setSetting({ source: 'bank' })}>
                  <span className="source-icon bank-icon"><Hash size={17} /></span><span><strong>Bank soal</strong><small>Langsung main</small></span><span className="radio-dot" />
                </button>
                <button type="button" role="radio" aria-checked={settings.source === 'groq'} disabled={!isHost} className={`source-option ${settings.source === 'groq' ? 'selected' : ''}`} onClick={() => setSetting({ source: 'groq' })}>
                  <span className="source-icon ai-icon"><Sparkles size={17} /></span><span><strong>Groq AI</strong><small>Soal baru dari AI</small></span><span className="radio-dot" />
                </button>
              </div>
            </div>
            {settings.source === 'groq' && isHost && (
              <label className="field"><span>Instruksi untuk AI <em>(opsional)</em></span>
                <textarea className="instruction-input" rows={2} maxLength={500} value={settings.topic || ''} placeholder="Contoh: soal tentang piala dunia, atau gaya ceria untuk anak SD" onChange={(event) => setSetting({ topic: event.target.value })} />
              </label>
            )}
            <div className="method-summary">
              <Sparkles size={15} /> {categoryLabel(settings.category)} · {ANSWER_METHODS.find((m) => m.id === settings.method)?.label} · {settings.count} soal · {WRONG_PENALTIES.find((p) => p.id === Number(settings.wrongPenalty))?.label}
            </div>
            {isHost ? (
              preparing ? (
                <div className="preparing-box"><div><LoaderCircle className="spin" size={20} /> <strong>Menyiapkan soal...</strong></div><div className="wide-progress"><span style={{ width: `${progress}%` }} /></div><small>{state.preparation?.done || 0} dari {state.preparation?.total || 0} soal siap.</small></div>
              ) : (
                <button className="button button-primary lobby-start" disabled={state.players.filter((p) => p.connected).length < 2} onClick={() => { play('next'); session.startGame() }}>
                  Mulai permainan <ArrowRight size={18} />
                </button>
              )
            ) : (
              <div className="guest-wait"><span className="pulse-dot" /> {preparing ? 'Host menyiapkan soal...' : 'Menunggu pembuat ruang memulai permainan...'}</div>
            )}
            <p className="under-button"><LockKeyhole size={13} /> Minimal 2 pemain. Semua pemain menerima soal yang sama secara bersamaan.</p>
          </section>
        </div>
      </main>
    </div>
  )
}

// --- Arena ------------------------------------------------------------------

function Leaderboard({ state, highlight }) {
  const rows = useMemo(() => [...state.players].sort((a, b) => b.points - a.points || b.correct - a.correct || a.name.localeCompare(b.name)), [state.players])
  return (
    <section className="surface leaderboard" aria-label="Papan peringkat">
      <div className="panel-title-row"><h2><Trophy size={18} /> Papan peringkat</h2><span className="small-label">LIVE</span></div>
      <ol className="leaderboard-list">
        {rows.map((player, index) => (
          <li key={player.token} className={`leaderboard-row ${player.token === highlight ? 'me' : ''} ${player.connected ? '' : 'offline'}`}>
            <span className={`leaderboard-rank rank-${index + 1}`}>{index + 1}</span>
            <span className="leaderboard-name"><strong>{player.name}</strong><small>{player.correct} benar · {player.wrong} salah</small></span>
            <span className="leaderboard-points">{player.points}<small>poin</small></span>
          </li>
        ))}
      </ol>
    </section>
  )
}

function RevealPanel({ state }) {
  return (
    <section className="surface reveal-panel" aria-label="Jawaban pemain">
      <div className="panel-title-row"><h2><UsersRound size={17} /> Jawaban masuk</h2></div>
      {state.reveal.length === 0 && <p className="reveal-empty">Belum ada yang menjawab. Jawaban yang belum dikirim tidak terlihat pemain lain.</p>}
      <ul className="reveal-list">
        {state.reveal.map((entry) => (
          <li key={`${entry.token}-${entry.at}`} className={`reveal-item ${entry.correct ? 'correct' : 'wrong'}`}>
            <span className="reveal-badge">{entry.correct ? <Check size={13} /> : <X size={13} />}</span>
            <span className="reveal-who"><strong>{entry.name}</strong><small>{entry.valueText}</small></span>
            <span className="reveal-meta">
              <small><Clock3 size={11} /> {(Math.max(0, entry.timeMs) / 1000).toFixed(1)} dtk</small>
              {entry.gain > 0 && <small className="gain-chip">+{entry.gain}</small>}
              {entry.gain < 0 && <small className="gain-chip negative">{entry.gain}</small>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function useBuzzerSounds(state, myToken) {
  const { play } = useSound()
  const previous = useRef({ questionId: '', buzzCount: 0, myRevealCount: 0, myRank: null, turnToken: '' })
  useEffect(() => {
    const last = previous.current
    const questionId = state.question ? `${state.question.id}-${state.question.index}` : ''
    const buzzCount = state.buzzOrder.length
    const rows = [...state.players].sort((a, b) => b.points - a.points || b.correct - a.correct)
    const myRank = rows.findIndex((player) => player.token === myToken)
    const myRevealCount = state.reveal.filter((entry) => entry.token === myToken).length
    if (questionId && questionId !== last.questionId) play('newquestion')
    if (buzzCount > last.buzzCount) play('buzzer')
    if (state.turn?.token === myToken && last.turnToken !== myToken) play('winbuzz')
    if (myRevealCount > last.myRevealCount) {
      const mine = state.reveal.find((entry) => entry.token === myToken)
      if (mine) {
        play(mine.correct ? 'correct' : 'wrong')
        if (mine.gain > 0) setTimeout(() => play('points'), 260)
      }
    }
    if (last.myRank !== null && myRank >= 0 && myRank < last.myRank) play('rank')
    previous.current = { questionId, buzzCount, myRevealCount, myRank, turnToken: state.turn?.token || '' }
  }, [state, myToken, play])
}

export function BuzzerGame({ state, session }) {
  const { play } = useSound()
  const { profile, hintEnabled } = usePreferences()
  const [selected, setSelected] = useState(null) // indeks pilihan MC
  const [typed, setTyped] = useState('')
  const question = state.question
  const myToken = state.selfToken
  useBuzzerSounds(state, myToken)

  const myTurn = state.turn?.token === myToken
  const myEntry = state.reveal.find((entry) => entry.token === myToken)
  const buzzed = state.buzzOrder.some((entry) => entry.token === myToken)
  const myBuzzIndex = state.buzzOrder.findIndex((entry) => entry.token === myToken)
  const phaseOpen = state.phase === 'buzzing' || state.phase === 'answering'
  const canBuzz = phaseOpen && !buzzed && !myEntry
  const isHost = state.role === 'host'
  const category = categoryLabel(state.settings?.category)
  const methodLabel = question?.kind === 'typing' ? 'Ketikan Manual' : 'Pilihan Ganda'

  useEffect(() => { setSelected(null); setTyped('') }, [question?.id, question?.index])

  function submit() {
    if (!myTurn || myEntry) return
    const value = question.kind === 'typing' ? typed : selected
    if (question.kind === 'typing' ? !typed.trim() : selected === null) return
    play('click')
    session.submitAnswer(value)
  }

  function fillAuto() {
    if (!hintEnabled || !myTurn) return
    play('answer')
    const value = autoFillValue(question)
    if (question.kind === 'typing') setTyped(String(value))
    else setSelected(value)
  }

  return (
    <div className="game-page buzzer-page">
      <BuzzerHeader state={state} session={session} />
      <main className="game-container buzzer-container">
        <div className="buzzer-topline">
          <div className="buzzer-status">
            <span className="eyebrow section-eyebrow"><span>✦</span> SIAPA CEPAT DIA MENJAWAB</span>
            <h1>Soal {question.index + 1} <small>/ {question.total}</small></h1>
            <p>{category} · {methodLabel}</p>
          </div>
          {isHost && state.phase !== 'revealed' && (
            <button type="button" className="button button-dark skip-question" onClick={() => { play('click'); session.skipQuestion() }}><SkipForward size={15} /> Lewati soal</button>
          )}
        </div>
        <Notice state={state} />
        <div className="buzzer-grid">
          <div className="buzzer-main">
            <section className="surface question-card buzzer-question" key={`${question.id}-${question.index}`}>
              <div className="question-topline"><span className="question-count"><span>SOAL {question.index + 1}</span> <small>/ {question.total}</small> <AnswerHint question={{ ...question, answer: question.answerIndex }} enabled={hintEnabled && question.kind === 'mc'} /></span><span className="mini-pill">{methodLabel}</span></div>
              <h2>{question.prompt}</h2>
              {question.kind === 'mc' ? (
                <div className="answer-options" role="radiogroup" aria-label="Pilihan jawaban">
                  {question.options.map((option, index) => (
                    <button type="button" key={option} role="radio" aria-checked={selected === index} disabled={!myTurn || Boolean(myEntry)} className={`answer-option ${selected === index ? 'selected' : ''}`} onClick={() => { play('answer'); setSelected(index) }}>
                      <span className="answer-letter">{'ABCD'[index]}</span><span className="answer-text">{option}</span><span className="answer-circle">{selected === index && <Check size={14} />}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <label className="field typing-field"><span>Ketik jawabanmu</span>
                  <input value={typed} disabled={!myTurn || Boolean(myEntry)} placeholder="Tulis jawaban di sini..." maxLength={120} aria-label="Kolom jawaban ketikan" onChange={(event) => setTyped(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submit() }} />
                </label>
              )}
              {myTurn && !myEntry && (
                <div className="answer-actions">
                  {hintEnabled && (
                    <button type="button" className="button cheat-fill" onClick={fillAuto} aria-label="Isi Jawaban Otomatis"><WandSparkles size={17} /> Isi Jawaban Otomatis</button>
                  )}
                  {!hintEnabled && <span className="cheat-off-note"><LockKeyhole size={13} /> Cheat OFF — isi jawaban manual</span>}
                  <button type="button" className="button button-primary submit-answer" disabled={question.kind === 'typing' ? !typed.trim() : selected === null} onClick={submit}><Send size={17} /> Kirim jawaban</button>
                </div>
              )}
              {myEntry && (
                <div className={`answer-verdict ${myEntry.correct ? 'correct' : 'wrong'}`}>
                  {myEntry.correct ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
                  <strong>{myEntry.correct ? `Benar! +${myEntry.gain} poin` : `Salah${myEntry.gain < 0 ? ` ${myEntry.gain} poin` : ''}`}</strong>
                  <small>{myEntry.valueText}</small>
                </div>
              )}
            </section>
            <section className="surface buzzer-zone" aria-label="Tombol buzzer">
              {myTurn && !myEntry ? (
                <div className="turn-banner hot"><Flame size={22} /><div><strong>Giliranmu menjawab!</strong><small>Pilih jawaban lalu tekan Kirim.</small></div></div>
              ) : canBuzz ? (
                <button type="button" className="buzzer-button" onClick={(event) => {
                  play('buzzer')
                  event.currentTarget.classList.add('pressed')
                  setTimeout(() => event.currentTarget?.classList?.remove('pressed'), 380)
                  session.buzz()
                }} aria-label="Tombol buzzer merah">
                  <span className="buzzer-glow" aria-hidden="true" />
                  <Zap size={30} fill="currentColor" /> BUZZER!
                  <small>Tekan untuk mengambil giliran</small>
                </button>
              ) : buzzed && !myEntry ? (
                <div className="turn-banner"><span className="pulse-dot" /><div><strong>Kamu buzz urutan ke-{myBuzzIndex + 1}</strong><small>{state.turn ? `Menunggu ${state.turn.name} selesai...` : 'Menunggu giliran...'}</small></div></div>
              ) : state.phase === 'revealed' ? (
                <div className="turn-banner"><Check size={20} /><div><strong>Jawaban diumumkan!</strong><small>Bersiap untuk soal berikutnya...</small></div></div>
              ) : (
                <div className="turn-banner"><span className="pulse-dot" /><div><strong>{state.turn ? `${state.turn.name} sedang menjawab` : 'Siap...'}</strong><small>Soal yang sama untuk semua pemain.</small></div></div>
              )}
              {state.turn && !myTurn && !myEntry && (
                <p className="waiting-note"><UserRound size={13} /> {state.turn.name} mendapat kesempatan menjawab lebih dulu.</p>
              )}
            </section>
            <RevealPanel state={state} />
          </div>
          <aside className="buzzer-side">
            <Leaderboard state={state} highlight={myToken} />
            <section className="surface how-buzzer">
              <div className="panel-title-row"><h2><Sparkles size={16} /> Aturan cepat</h2></div>
              <ul>
                <li><strong>Buzzer dulu, jawab dulu.</strong> Tekan tombol merah secepat mungkin.</li>
                <li><strong>Salah?</strong> Giliran diteruskan ke buzzer berikutnya.</li>
                <li><strong>Benar = poin</strong> + bonus kecepatan sampai +5.</li>
                <li><strong>Jawaban semua orang</strong> terlihat setelah dikirim.</li>
              </ul>
            </section>
          </aside>
        </div>
      </main>
    </div>
  )
}

// --- Hasil ------------------------------------------------------------------

export function BuzzerResults({ state, session }) {
  const { play } = useSound()
  const { profile, recordResult, saveGameHistory, hintEnabled } = usePreferences()
  const result = state.result
  const recorded = useRef('')
  const isHost = state.role === 'host'
  const standings = result?.standings || []
  const me = standings.find((player) => player.token === state.selfToken)
  const champion = standings[0]
  const requested = state.rematchVotes.includes(state.selfToken)

  useEffect(() => { play('finish'); setTimeout(() => play('rank'), 500) }, [play])
  useEffect(() => {
    if (!result || recorded.current === result.gameId) return
    recorded.current = result.gameId
    const score = Math.min(100, me?.points || 0)
    const tied = standings.length > 1 && standings[0].points === standings[1].points && me?.rank === 1
    const outcome = me ? (tied ? 'draw' : me.rank === 1 ? 'win' : 'loss') : 'solo'
    recordResult(result.gameId, score, { correct: me?.correct || 0, total: (me?.correct || 0) + (me?.wrong || 0), result: outcome })
    saveGameHistory({
      at: Date.now(),
      mode: 'buzzer',
      roomCode: state.code,
      category: result.settings?.category,
      method: result.settings?.method,
      gameId: result.gameId,
      standings: standings.map((player) => ({ name: player.name, points: player.points, correct: player.correct, wrong: player.wrong, rank: player.rank })),
    })
  }, [result, me, standings, recordResult, saveGameHistory, state.code])

  return (
    <div className="game-page results-page buzzer-results-page">
      <BuzzerHeader state={state} session={session} />
      <main className="game-container results-container">
        <div className="result-heading">
          <div className="trophy-icon"><Trophy size={29} fill="currentColor" /></div>
          <span className="eyebrow section-eyebrow"><span>✦</span> PERMAINAN SELESAI</span>
          <h1>{champion ? `${champion.name} juaranya!` : 'Hebat!'}</h1>
          <p>Terima kasih sudah bermain. Ini dia hasil akhir adu cepat kalian.</p>
        </div>
        <Notice state={state} />
        <section className="surface podium-card" aria-label="Peringkat akhir">
          <div className="panel-title-row"><h2><Trophy size={18} /> Peringkat akhir</h2><span className="small-label">{standings.length} PEMAIN</span></div>
          <table className="standings-table">
            <thead><tr><th>Peringkat</th><th>Pemain</th><th>Poin</th><th>Benar</th><th>Salah</th></tr></thead>
            <tbody>
              {standings.map((player) => (
                <tr key={player.token} className={player.token === state.selfToken ? 'me' : ''}>
                  <td><span className={`leaderboard-rank rank-${player.rank}`}>{player.rank === 1 ? <Crown size={15} /> : player.rank}</span></td>
                  <td><span className="standings-player"><Avatar avatarId={player.avatar} name={player.name} frame={player.frame} className="friend-chip-avatar" /><strong>{player.name}</strong>{player.token === state.selfToken && <small>(kamu)</small>}</span></td>
                  <td><strong>{player.points}</strong></td>
                  <td>{player.correct}</td>
                  <td>{player.wrong}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="surface history-card" aria-label="Riwayat jawaban">
          <div className="panel-title-row"><h2><Clock3 size={18} /> Riwayat jawaban tiap soal</h2></div>
          {(result?.history || []).map((item) => (
            <details className="history-item" key={item.index} open={item.index === 0}>
              <summary><strong>Soal {item.index + 1}.</strong> {item.prompt}</summary>
              <p className="history-answer">Jawaban benar: <strong>{item.answer?.answerText || (item.answer?.options || [])[item.answer?.answerIndex] || '—'}</strong></p>
              {item.answer?.explanation && <p className="history-explain">{item.answer.explanation}</p>}
              <ul className="reveal-list">
                {item.entries.length === 0 && <li className="reveal-empty">Tidak ada yang menjawab soal ini.</li>}
                {item.entries.map((entry) => (
                  <li key={`${item.index}-${entry.token}`} className={`reveal-item ${entry.correct ? 'correct' : 'wrong'}`}>
                    <span className="reveal-badge">{entry.correct ? <Check size={13} /> : <X size={13} />}</span>
                    <span className="reveal-who"><strong>{entry.name}</strong><small>{entry.valueText}</small></span>
                    <span className="reveal-meta"><small><Clock3 size={11} /> {(entry.timeMs / 1000).toFixed(1)} dtk</small></span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </section>
        <div className="results-actions">
          {isHost ? (
            <button className="button button-primary" data-sound="next" onClick={() => { play('next'); session.playAgain() }}><RotateCcw size={17} /> Main lagi — soal baru</button>
          ) : (
            <button className="button button-primary" disabled={requested} onClick={() => { play('next'); session.playAgain() }}>
              <RotateCcw size={17} /> {requested ? 'Menunggu pembuat ruang...' : 'Minta main lagi'}
            </button>
          )}
          {state.rematchVotes.length > 0 && isHost && <p className="under-button">{state.rematchVotes.length} pemain meminta main lagi.</p>}
          <button className="button button-dark" onClick={() => session.quit()}><LogOut size={17} /> Kembali ke beranda</button>
        </div>
      </main>
    </div>
  )
}
