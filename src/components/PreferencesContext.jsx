import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { cleanName, validateName } from '../data/subjects.js'
import { isAvatarId } from '../data/avatars.js'
import { isFrameId } from '../data/frames.js'
import { GAME_HISTORY_KEY, HINT_STORAGE_KEY, PROFILE_STORAGE_KEY, loadGameHistory, loadHintEnabled, loadProfile, recordCompletedGame, sanitizeProfile, saveGameHistory as persistGameHistory, saveHintEnabled, saveProfile } from '../lib/preferences.js'
import PreferencesPanel from './PreferencesPanel.jsx'

const PreferencesContext = createContext(null)

export function PreferencesProvider({ children }) {
  const [profile, setProfile] = useState(loadProfile)
  const [hintEnabled, setHintEnabled] = useState(loadHintEnabled)
  const [panel, setPanel] = useState(null)
  const [roomCode, setRoomCode] = useState('')
  const [gameHistory, setGameHistory] = useState(loadGameHistory)
  useEffect(() => { saveProfile(profile) }, [profile])
  useEffect(() => { saveHintEnabled(hintEnabled) }, [hintEnabled])
  useEffect(() => {
    const sync = (event) => {
      if (event.key === HINT_STORAGE_KEY) setHintEnabled(event.newValue === 'on')
      if (event.key === PROFILE_STORAGE_KEY) {
        try { setProfile(sanitizeProfile(JSON.parse(event.newValue || 'null'))) } catch { setProfile(sanitizeProfile(null)) }
      }
      if (event.key === GAME_HISTORY_KEY) setGameHistory(loadGameHistory())
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])

  const saveName = useCallback((name) => {
    const error = validateName(name)
    if (error) return error
    setProfile((current) => ({ ...current, name: cleanName(name) }))
    return ''
  }, [])
  const saveAvatar = useCallback((avatar) => {
    if (!isAvatarId(avatar)) return 'Avatar tidak dikenal.'
    setProfile((current) => ({ ...current, avatar }))
    return ''
  }, [])
  const saveFrame = useCallback((frame) => {
    if (!isFrameId(frame)) return 'Bingkai tidak dikenal.'
    setProfile((current) => ({ ...current, frame }))
    return ''
  }, [])
  const recordResult = useCallback((gameId, score, outcome) => {
    setProfile((current) => recordCompletedGame(current, gameId, score, outcome))
  }, [])
  const saveGameHistory = useCallback((entry) => {
    setGameHistory(persistGameHistory(entry))
  }, [])
  const openPanel = useCallback((name) => {
    if (['profile', 'settings', 'about', 'friends'].includes(name)) setPanel(name)
  }, [])
  const closePanel = useCallback(() => setPanel(null), [])
  const value = useMemo(() => ({ profile, hintEnabled, setHintEnabled, saveName, saveAvatar, saveFrame, recordResult, saveGameHistory, gameHistory, openPanel, closePanel, roomCode, setRoomCode }), [profile, hintEnabled, saveName, saveAvatar, saveFrame, recordResult, saveGameHistory, gameHistory, openPanel, closePanel, roomCode])

  return <PreferencesContext.Provider value={value}>
    {children}
    <PreferencesPanel panel={panel} {...value} />
  </PreferencesContext.Provider>
}

export function usePreferences() {
  return useContext(PreferencesContext)
}
