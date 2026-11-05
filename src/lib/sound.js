// Short, quiet synthesized effects; no audio files or external requests are needed.
const PATTERNS = {
  click: [[520, 0, 0.055, 'sine', 0.025]],
  answer: [[660, 0, 0.08, 'sine', 0.03], [880, 0.045, 0.08, 'sine', 0.022]],
  next: [[523, 0, 0.075, 'sine', 0.025], [698, 0.075, 0.11, 'sine', 0.025]],
  join: [[523, 0, 0.12, 'sine', 0.024], [659, 0.10, 0.12, 'sine', 0.024], [784, 0.20, 0.18, 'sine', 0.024]],
  finish: [[523, 0, 0.15, 'sine', 0.024], [659, 0.12, 0.15, 'sine', 0.024], [784, 0.24, 0.15, 'sine', 0.024], [1047, 0.36, 0.26, 'sine', 0.022]],
}

function browserAudioContext() {
  if (typeof window === 'undefined') return null
  const AudioContext = window.AudioContext || window.webkitAudioContext
  return AudioContext ? new AudioContext() : null
}

export function createSoundPlayer(createContext = browserAudioContext) {
  let context = null
  return {
    play(name = 'click') {
      try {
        if (!context || context.state === 'closed') context = createContext()
        if (!context) return false
        if (context.state === 'suspended') context.resume()?.catch?.(() => {})
        const start = context.currentTime + 0.01
        for (const [frequency, delay, duration, type, volume] of (PATTERNS[name] || PATTERNS.click)) {
          const oscillator = context.createOscillator()
          const gain = context.createGain()
          const when = start + delay
          oscillator.type = type
          oscillator.frequency.setValueAtTime(frequency, when)
          gain.gain.setValueAtTime(0.0001, when)
          gain.gain.exponentialRampToValueAtTime(volume, when + 0.01)
          gain.gain.exponentialRampToValueAtTime(0.0001, when + duration)
          oscillator.connect(gain)
          gain.connect(context.destination)
          oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
          oscillator.start(when)
          oscillator.stop(when + duration + 0.01)
        }
        return true
      } catch {
        // Audio is optional, e.g. on browsers that block or lack Web Audio.
        return false
      }
    },
    destroy() {
      try { context?.close()?.catch?.(() => {}) } catch { /* already closed */ }
      context = null
    },
  }
}
