import { useEffect, useRef, useState } from 'react'
import Landing from './components/Landing.jsx'
import { Lobby, Quiz, Results, Waiting } from './components/GameViews.jsx'
import { BuzzerGame, BuzzerLobby, BuzzerResults } from './components/BuzzerViews.jsx'
import WelcomeGate from './components/WelcomeGate.jsx'
import { SoundProvider, useSound } from './components/SoundContext.jsx'
import { PreferencesProvider, usePreferences } from './components/PreferencesContext.jsx'
import { GameSession } from './lib/gameSession.js'
import { PartySession } from './lib/partySession.js'

function GameApp() {
  const [duel] = useState(() => new GameSession())
  const [party] = useState(() => new PartySession())
  const [duelState, setDuelState] = useState(duel.getState)
  const [partyState, setPartyState] = useState(party.getState)
  const previous = useRef({ screen: duelState.screen, connected: duelState.connected })
  const { play } = useSound()
  const { recordResult, profile, setRoomCode } = usePreferences()
  useEffect(() => {
    const offDuel = duel.subscribe(setDuelState)
    const offParty = party.subscribe(setPartyState)
    return () => { offDuel(); offParty(); duel.destroy(); party.destroy() }
  }, [duel, party])
  // Kode ruang dibagikan ke panel Teman untuk undangan sekali klik.
  useEffect(() => {
    const activeCode = partyState.screen === 'lobby' && partyState.role === 'host'
      ? partyState.code
      : duelState.role === 'host' && duelState.screen === 'lobby' ? duelState.code : ''
    setRoomCode(activeCode)
  }, [partyState.screen, partyState.role, partyState.code, duelState.role, duelState.screen, duelState.code, setRoomCode])
  // Profil dikirim langsung ke pemain lain setiap berubah (misal setelah menang).
  useEffect(() => { duel.setSelfProfile(profile); party.setSelfProfile(profile) }, [duel, party, profile])
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }) }, [duelState.screen, partyState.screen])
  useEffect(() => {
    if (previous.current.screen !== 'results' && duelState.screen === 'results') play('finish')
    else if (duelState.role === 'host' && !previous.current.connected && duelState.connected) play('join')
    previous.current = { screen: duelState.screen, connected: duelState.connected }
  }, [duelState.screen, duelState.connected, duelState.role, play])
  useEffect(() => {
    if (duelState.screen !== 'results' || !duelState.result) return
    const mine = duelState.role === 'guest' ? duelState.result.guest : duelState.result.host
    if (!mine) return
    let result = 'solo'
    if (duelState.result.host && duelState.result.guest) {
      const otherScore = duelState.role === 'guest' ? duelState.result.host.score : duelState.result.guest.score
      result = mine.score > otherScore ? 'win' : mine.score < otherScore ? 'loss' : 'draw'
    }
    recordResult(duelState.gameId, mine.score, { correct: mine.correct, total: mine.total, result })
  }, [duelState.screen, duelState.role, duelState.result, duelState.gameId, recordResult])

  // Nama diisi sekali saat pertama masuk; setelah itu otomatis dipakai.
  if (!profile.name) return <WelcomeGate />

  // Mode Siapa Cepat Dia Menjawab (2–5 pemain).
  if (partyState.screen === 'lobby') return <BuzzerLobby state={partyState} session={party} />
  if (partyState.screen === 'game') return <BuzzerGame state={partyState} session={party} />
  if (partyState.screen === 'results') return <BuzzerResults state={partyState} session={party} />

  // Mode Kuis Klasik (1 lawan 1) — alur lama tetap utuh.
  if (duelState.screen === 'lobby') return <Lobby state={duelState} session={duel} />
  if (duelState.screen === 'quiz') return <Quiz state={duelState} session={duel} />
  if (duelState.screen === 'waiting') return <Waiting state={duelState} session={duel} />
  if (duelState.screen === 'results') return <Results state={duelState} session={duel} />
  return <Landing session={duel} party={party} />
}

export default function App() {
  return <SoundProvider><PreferencesProvider><GameApp /></PreferencesProvider></SoundProvider>
}
