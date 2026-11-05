import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { cleanName, validateName } from '../data/subjects.js'
import { HINT_STORAGE_KEY, PROFILE_STORAGE_KEY, loadHintEnabled, loadProfile, recordCompletedGame, sanitizeProfile, saveHintEnabled, saveProfile } from '../lib/preferences.js'
import PreferencesPanel from './PreferencesPanel.jsx'

const PreferencesContext = createContext(null)

export function PreferencesProvider({ children }) {
  const [profile, setProfile] = useState(loadProfile)
  const [hintEnabled, setHintEnabled] = useState(loadHintEnabled)
  const [panel, setPanel] = useState(null)
  useEffect(() => { saveProfile(profile) }, [profile])
  useEffect(() => { saveHintEnabled(hintEnabled) }, [hintEnabled])
  useEffect(() => {
    const sync = (event) => {
      if (event.key === HINT_STORAGE_KEY) setHintEnabled(event.newValue === 'on')
      if (event.key === PROFILE_STORAGE_KEY) {
        try { setProfile(sanitizeProfile(JSON.parse(event.newValue || 'null'))) } catch { setProfile(sanitizeProfile(null)) }
      }
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
  const recordResult = useCallback((gameId, score) => {
    setProfile((current) => recordCompletedGame(current, gameId, score))
  }, [])
  const openPanel = useCallback((name) => {
    if (['profile', 'settings', 'about'].includes(name)) setPanel(name)
  }, [])
  const closePanel = useCallback(() => setPanel(null), [])
  const value = useMemo(() => ({ profile, hintEnabled, setHintEnabled, saveName, recordResult, openPanel, closePanel }), [profile, hintEnabled, saveName, recordResult, openPanel, closePanel])

  return <PreferencesContext.Provider value={value}>
    {children}
    <PreferencesPanel panel={panel} {...value} />
  </PreferencesContext.Provider>
}

export function usePreferences() {
  return useContext(PreferencesContext)
}
