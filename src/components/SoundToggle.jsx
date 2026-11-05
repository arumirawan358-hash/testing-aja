import { Volume2, VolumeX } from 'lucide-react'
import { useSound } from './SoundContext.jsx'

export default function SoundToggle() {
  const { enabled, toggle } = useSound()
  const label = enabled ? 'Matikan efek suara' : 'Aktifkan efek suara'
  return <button type="button" className="sound-toggle" data-sound="none" onClick={toggle} aria-label={label} aria-pressed={enabled} title={label}>
    {enabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
    <span>{enabled ? 'Suara aktif' : 'Suara mati'}</span>
  </button>
}
