import { Settings2, UserRound } from 'lucide-react'
import { usePreferences } from './PreferencesContext.jsx'

export default function MenuButtons() {
  const { openPanel } = usePreferences()
  return <div className="menu-buttons">
    <button type="button" className="menu-button" onClick={() => openPanel('profile')} aria-label="Profil" aria-haspopup="dialog" title="Profil"><UserRound size={18} /><span>Profil</span></button>
    <button type="button" className="menu-button" onClick={() => openPanel('settings')} aria-label="Pengaturan" aria-haspopup="dialog" title="Pengaturan"><Settings2 size={18} /><span>Pengaturan</span></button>
  </div>
}
