import { BookOpen, Sparkles } from 'lucide-react'

export default function Brand({ onClick, light = false }) {
  return (
    <button type="button" className={`brand ${light ? 'brand-light' : ''}`} onClick={onClick} aria-label="KuisKita, ke beranda">
      <span className="brand-mark"><BookOpen size={20} strokeWidth={2.2} /><Sparkles className="brand-sparkle" size={11} fill="currentColor" /></span>
      <span>Kuis<span className="brand-accent">Kita</span><span className="brand-dot">.</span></span>
    </button>
  )
}
