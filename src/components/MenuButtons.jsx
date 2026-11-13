import { Settings2, UserRound, UsersRound } from 'lucide-react'
import { usePreferences } from './PreferencesContext.jsx'

export default function MenuButtons() {
  const { openPanel } = usePreferences()
  return <div className="menu-buttons">
    <button type="button" className="menu-button" onClick={() => openPanel('friends')} aria-label="Teman" aria-haspopup="dialog" title="Teman"><UsersRound size={18} /><span>Teman</span></button>
    <button type="button" className="menu-button" onClick={() => openPanel('profile')} aria-label="Profil" aria-haspopup="dialog" title="Profil"><UserRound size={18} /><span>Profil</span></button>
    <button type="button" className="menu-button" onClick={() => openPanel('settings')} aria-label="Pengaturan" aria-haspopup="dialog" title="Pengaturan"><Settings2 size={18} /><span>Pengaturan</span></button>
  </div>
}
