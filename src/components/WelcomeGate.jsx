import { useEffect, useState } from 'react'
import { ArrowRight, Sparkles, UserRound } from 'lucide-react'
import { AVATARS, avatarSrc, DEFAULT_AVATAR } from '../data/avatars.js'
import { cleanName, validateName } from '../data/subjects.js'
import { usePreferences } from './PreferencesContext.jsx'

// Pintu masuk pertama kali: nama diisi SEKALI saat mendaftar, lalu otomatis
// dipakai di semua permainan tanpa perlu mengetik ulang.
export default function WelcomeGate() {
  const { profile, saveName, saveAvatar } = usePreferences()
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState(profile.avatar || DEFAULT_AVATAR)
  const [error, setError] = useState('')

  function start(event) {
    event.preventDefault()
    const message = validateName(name)
    if (message) { setError(message); return }
    setError('')
    saveAvatar(avatar)
    saveName(cleanName(name))
  }

  return (
    <div className="welcome-gate" role="dialog" aria-modal="true" aria-label="Selamat datang di KuisKita">
      <form className="welcome-card surface" onSubmit={start} noValidate>
        <span className="heading-icon purple"><Sparkles size={22} /></span>
        <h2>Halo! Kenalan dulu, yuk</h2>
        <p className="welcome-copy">Isi namamu <strong>sekali saja</strong>. Nanti otomatis dipakai setiap kali bermain — tidak perlu mengetik ulang.</p>
        <label className="field">
          <span>Nama panggilan <i>*</i></span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Siapa namamu?" maxLength={24} autoComplete="nickname" aria-label="Nama panggilan pertama kali" autoFocus />
        </label>
        <div className="welcome-avatars" role="radiogroup" aria-label="Pilih avatar">
          {AVATARS.map((item) => (
            <button type="button" key={item.id} role="radio" aria-checked={avatar === item.id} aria-label={`Avatar ${item.label || item.id}`} className={`welcome-avatar ${avatar === item.id ? 'selected' : ''}`} onClick={() => setAvatar(item.id)}>
              <img src={avatarSrc(item.id)} alt="" />
            </button>
          ))}
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button type="submit" className="button button-primary welcome-start"><UserRound size={18} /> Mulai petualangan <ArrowRight size={18} /></button>
      </form>
    </div>
  )
}

// Hook kecil: apakah pemain belum pernah mendaftar?
export function useNeedsRegistration(profile) {
  const [needed, setNeeded] = useState(() => !profile?.name)
  useEffect(() => { setNeeded(!profile?.name) }, [profile?.name])
  return needed
}
