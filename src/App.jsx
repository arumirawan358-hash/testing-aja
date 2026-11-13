import { useEffect, useRef, useState } from 'react'
import Landing from './components/Landing.jsx'
import { Lobby, Quiz, Results, Waiting } from './components/GameViews.jsx'
import { SoundProvider, useSound } from './components/SoundContext.jsx'
import { PreferencesProvider, usePreferences } from './components/PreferencesContext.jsx'
import { GameSession } from './lib/gameSession.js'

function GameApp() {
  const [session] = useState(() => new GameSession())
  const [state, setState] = useState(session.getState)
  const previous = useRef({ screen: state.screen, connected: state.connected })
  const { play } = useSound()
  const { recordResult, profile, setRoomCode } = usePreferences()
  useEffect(() => {
    const unsubscribe = session.subscribe(setState)
    return () => { unsubscribe(); session.destroy() }
  }, [session])
  // Kode ruang dibagikan ke panel Teman untuk undangan sekali klik.
  useEffect(() => { setRoomCode(state.role === 'host' && state.screen === 'lobby' ? state.code : '') }, [state.role, state.screen, state.code, setRoomCode])
  // Profil dikirim langsung ke pemain lain setiap berubah (misal setelah menang).
  useEffect(() => { session.setSelfProfile(profile) }, [session, profile])
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }) }, [state.screen])
  useEffect(() => {
    if (previous.current.screen !== 'results' && state.screen === 'results') play('finish')
    else if (state.role === 'host' && !previous.current.connected && state.connected) play('join')
    previous.current = { screen: state.screen, connected: state.connected }
  }, [state.screen, state.connected, state.role, play])
  useEffect(() => {
    if (state.screen !== 'results' || !state.result) return
    const mine = state.role === 'guest' ? state.result.guest : state.result.host
    if (!mine) return
    let result = 'solo'
    if (state.result.host && state.result.guest) {
      const otherScore = state.role === 'guest' ? state.result.host.score : state.result.guest.score
      result = mine.score > otherScore ? 'win' : mine.score < otherScore ? 'loss' : 'draw'
    }
    recordResult(state.gameId, mine.score, { correct: mine.correct, total: mine.total, result })
  }, [state.screen, state.role, state.result, state.gameId, recordResult])

  if (state.screen === 'lobby') return <Lobby state={state} session={session} />
  if (state.screen === 'quiz') return <Quiz state={state} session={session} />
  if (state.screen === 'waiting') return <Waiting state={state} session={session} />
  if (state.screen === 'results') return <Results state={state} session={session} />
  return <Landing session={session} />
}

export default function App() {
  return <SoundProvider><PreferencesProvider><GameApp /></PreferencesProvider></SoundProvider>
}
