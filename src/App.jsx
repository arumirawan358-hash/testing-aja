import { useEffect, useState } from 'react'
import Landing from './components/Landing.jsx'
import { Lobby, Quiz, Results, Waiting } from './components/GameViews.jsx'
import { GameSession } from './lib/gameSession.js'

export default function App() {
  const [session] = useState(() => new GameSession())
  const [state, setState] = useState(session.getState)
  useEffect(() => {
    const unsubscribe = session.subscribe(setState)
    return () => { unsubscribe(); session.destroy() }
  }, [session])
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }) }, [state.screen])

  if (state.screen === 'lobby') return <Lobby state={state} session={session} />
  if (state.screen === 'quiz') return <Quiz state={state} session={session} />
  if (state.screen === 'waiting') return <Waiting state={state} session={session} />
  if (state.screen === 'results') return <Results state={state} session={session} />
  return <Landing session={session} />
}
