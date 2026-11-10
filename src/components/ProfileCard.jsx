import { useEffect, useRef } from 'react'
import { Crown, Gamepad2, Percent, Sparkles, Target, Trophy, UserRound, X, Zap } from 'lucide-react'
import { avatarSrc } from '../data/avatars.js'

// Avatar pemain: gambar AI bila dipilih, huruf awal bila belum ada gambar.
export function Avatar({ avatarId, name, className = '' }) {
  const initial = Array.from((name || '').trim())[0]?.toLocaleUpperCase('id-ID')
  return <span className={`profile-avatar ${className}`}>
    {avatarId
      ? <img src={avatarSrc(avatarId)} alt="" />
      : <span className="profile-avatar-fallback">{initial || <UserRound size={20} />}</span>}
  </span>
}

// Lencana rank dengan efek "bling" bertingkat sesuai kelas rank.
export function RankBadge({ rank, compact = false }) {
  if (!rank) return null
  const bling = Math.max(0, Math.min(6, Number(rank.bling) || 0))
  return <span className={`rank-badge rank-bling-${bling} ${compact ? 'rank-compact' : ''}`}>
    {bling >= 2 && <span className="rank-sparkle s1" aria-hidden="true">✦</span>}
    {bling >= 4 && <span className="rank-sparkle s2" aria-hidden="true">✦</span>}
    {bling >= 5 && <span className="rank-sparkle s3" aria-hidden="true">✦</span>}
    {bling >= 6 && <span className="rank-sparkle s4" aria-hidden="true">✦</span>}
    <Crown size={compact ? 11 : 13} aria-hidden="true" />
    {rank.name}
  </span>
}

function StatTile({ icon: Icon, value, label }) {
  return <div className="profile-stat"><Icon size={16} /><strong>{value}</strong><span>{label}</span></div>
}

// Kartu profil lengkap: avatar, rank + bling, winrate, dan kepintaran.
export function ProfileCard({ profile, self = false }) {
  if (!profile) return null
  const rank = profile.rank
  return <div className="profile-card">
    <div className="profile-card-hero">
      <Avatar avatarId={profile.avatar} name={profile.name} className="profile-avatar-large" />
      <div className="profile-card-id">
        <h3>{profile.name || 'Teman belajar'} {self && <small>(kamu)</small>}</h3>
        <RankBadge rank={rank} />
        {rank && rank.nextName && <div className="rank-progress"><span style={{ width: `${rank.progress}%` }} /><small>{rank.nextPoints - profile.smartPoints} poin lagi ke {rank.nextName}</small></div>}
        {rank && !rank.nextName && <div className="rank-progress"><span style={{ width: '100%' }} /><small>Rank tertinggi! ✦</small></div>}
      </div>
    </div>
    <div className="profile-stats-grid">
      <StatTile icon={Zap} value={profile.smartPoints} label="Poin Kepintaran" />
      <StatTile icon={Trophy} value={`${profile.winRate}%`} label="Winrate" />
      <StatTile icon={Target} value={profile.accuracy === null ? '—' : `${profile.accuracy}%`} label="Kepintaran" />
      <StatTile icon={Gamepad2} value={`${profile.wins} / ${profile.gamesPlayed}`} label="Menang / Main" />
    </div>
  </div>
}

// Profil lawan dilihat lewat koneksi langsung; tutup dengan tombol atau Escape.
export function PlayerProfileModal({ profile, onClose }) {
  const dialog = useRef(null)
  useEffect(() => {
    dialog.current?.focus()
    function keydown(event) { if (event.key === 'Escape') { event.preventDefault(); onClose() } }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [onClose])
  if (!profile) return null
  return <div className="panel-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="preferences-dialog profile-dialog" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Profil ${profile.name}`}>
      <header className="panel-header">
        <span className="panel-title-icon"><Sparkles size={20} /></span>
        <div><span className="panel-header-label">PROFIL PEMAIN</span><h2>Kenalan, yuk!</h2></div>
        <button type="button" className="panel-icon-button panel-close" onClick={onClose} aria-label="Tutup profil"><X size={19} /></button>
      </header>
      <div className="panel-content"><ProfileCard profile={profile} /><p className="panel-footnote"><Percent size={14} /> Winrate dan kepintaran dihitung dari permainan di perangkat masing-masing pemain.</p></div>
    </section>
  </div>
}
