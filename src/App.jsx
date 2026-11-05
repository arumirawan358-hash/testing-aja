import { useEffect, useRef, useState } from 'react'
import Landing from './components/Landing.jsx'
import { Lobby, Quiz, Results, Waiting } from './components/GameViews.jsx'
import { SoundProvider, useSound } from './components/SoundContext.jsx'
import { GameSession } from './lib/gameSession.js'

function GameApp() {
  const [session] = useState(() => new GameSession())
  const [state, setState] = useState(session.getState)
  const previous = useRef({ screen: state.screen, connected: state.connected })
  const { play } = useSound()
  useEffect(() => {
    const unsubscribe = session.subscribe(setState)
    return () => { unsubscribe(); session.destroy() }
  }, [session])
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }) }, [state.screen])
  useEffect(() => {
    if (previous.current.screen !== 'results' && state.screen === 'results') play('finish')
    else if (state.role === 'host' && !previous.current.connected && state.connected) play('join')
    previous.current = { screen: state.screen, connected: state.connected }
  }, [state.screen, state.connected, state.role, play])

  if (state.screen === 'lobby') return <Lobby state={state} session={session} />
  if (state.screen === 'quiz') return <Quiz state={state} session={session} />
  if (state.screen === 'waiting') return <Waiting state={state} session={session} />
  if (state.screen === 'results') return <Results state={state} session={session} />
  return <Landing session={session} />
}

export default function App() {
  return <SoundProvider><GameApp /></SoundProvider>
}
