import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createSoundPlayer } from '../lib/sound.js'

const SoundContext = createContext(null)
const PREFERENCE = 'kuiskita:sound'

function initialEnabled() {
  try { return window.localStorage.getItem(PREFERENCE) !== 'off' } catch { return true }
}

export function SoundProvider({ children }) {
  const [player] = useState(createSoundPlayer)
  const [enabled, setEnabled] = useState(initialEnabled)
  const enabledRef = useRef(enabled)
  const play = useCallback((name) => { if (enabledRef.current) player.play(name) }, [player])
  const toggle = useCallback(() => {
    const next = !enabledRef.current
    enabledRef.current = next
    setEnabled(next)
    try { window.localStorage.setItem(PREFERENCE, next ? 'on' : 'off') } catch { /* private browsing */ }
    if (next) player.play('answer')
  }, [player])

  useEffect(() => {
    const click = (event) => {
      const element = event.target?.closest?.('button, a')
      if (!element || element.disabled || element.getAttribute('aria-disabled') === 'true') return
      const sound = element.dataset.sound
      if (sound !== 'none') play(sound || 'click')
    }
    // Capture keeps audio creation inside a user gesture even if the button changes screens.
    document.addEventListener('click', click, true)
    return () => { document.removeEventListener('click', click, true); player.destroy() }
  }, [play, player])

  return <SoundContext.Provider value={{ enabled, toggle, play }}>{children}</SoundContext.Provider>
}

export function useSound() {
  return useContext(SoundContext)
}
