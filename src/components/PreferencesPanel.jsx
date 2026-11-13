import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, BookOpen, Check, ChevronRight, CircleHelp, GraduationCap, LockKeyhole, Settings2, Sparkles, Trophy, UserRound, UsersRound, Volume2, X } from 'lucide-react'
import { useSound } from './SoundContext.jsx'
import { Avatar, ProfileCard, RankBadge } from './ProfileCard.jsx'
import { AVATARS, avatarSrc } from '../data/avatars.js'
import { FRAMES } from '../data/frames.js'
import { addFriend, friendRank, inviteLink, loadFriends, removeFriend } from '../lib/friends.js'
import { toViewProfile } from '../lib/ranks.js'

function Switch({ label, checked, onChange, silent = false }) {
  return <button type="button" className="preference-switch" role="switch" aria-label={label} aria-checked={checked} onClick={onChange} data-sound={silent ? 'none' : undefined}>
    <span className="switch-track" aria-hidden="true"><span /></span><span>{checked ? 'Aktif' : 'Mati'}</span>
  </button>
}

function ProfileView({ profile, saveName, saveAvatar, saveFrame }) {
  const [name, setName] = useState(profile.name)
  const [feedback, setFeedback] = useState(null)
  function save(event) {
    event.preventDefault()
    const error = saveName(name)
    setFeedback(error ? { error: true, text: error } : { error: false, text: 'Profil berhasil disimpan di browser ini.' })
  }
  return <div className="panel-content">
    <div className="profile-hero"><Avatar avatarId={profile.avatar} name={profile.name} frame={profile.frame} className="profile-avatar-large" /><div><span className="panel-kicker">PROFIL BELAJAR</span><h3>{profile.name || 'Teman belajar'}</h3><p>Profil sederhana, tanpa perlu membuat akun.</p></div></div>
    <div className="avatar-picker" role="radiogroup" aria-label="Pilih avatar">
      <span className="field-title">Pilih avatar</span>
      <div className="avatar-options">{AVATARS.map((avatar) => <button type="button" key={avatar.id} role="radio" aria-checked={profile.avatar === avatar.id} aria-label={`Avatar ${avatar.label}`} className={`avatar-option ${profile.avatar === avatar.id ? 'selected' : ''}`} onClick={() => { saveAvatar(avatar.id); setFeedback({ error: false, text: 'Avatar dipilih!' }) }}><img src={avatarSrc(avatar.id)} alt={avatar.label} /></button>)}</div>
    </div>
    <div className="avatar-picker" role="radiogroup" aria-label="Pilih bingkai avatar">
      <span className="field-title">Pilih bingkai avatar</span>
      <div className="frame-options">{FRAMES.map((frame) => <button type="button" key={frame.id} role="radio" aria-checked={profile.frame === frame.id} aria-label={`Bingkai ${frame.label}`} className={`frame-option frame-${frame.id} ${profile.frame === frame.id ? 'selected' : ''}`} onClick={() => { saveFrame(frame.id); setFeedback({ error: false, text: `Bingkai ${frame.label} dipilih!` }) }}><span className="frame-swatch" aria-hidden="true" /><small>{frame.label}</small></button>)}</div>
    </div>
    <form className="profile-form" onSubmit={save} noValidate>
      <label className="field"><span>Nama panggilan</span><input value={name} onChange={(event) => { setName(event.target.value); setFeedback(null) }} maxLength={24} autoComplete="nickname" placeholder="Masukkan nama panggilanmu" /></label>
      <p className="panel-help">Nama ini otomatis terisi saat membuat atau bergabung ke permainan berikutnya.</p>
      {feedback && <p className={`profile-feedback ${feedback.error ? 'error' : ''}`} role={feedback.error ? 'alert' : 'status'}>{!feedback.error && <Check size={15} />}{feedback.text}</p>}
      <button type="submit" className="button button-primary profile-save">Simpan profil</button>
    </form>
    <ProfileCard profile={toViewProfile(profile)} self />
    <div className="profile-stats" aria-label="Statistik di browser ini"><div><BookOpen size={18} /><strong>{profile.gamesPlayed}</strong><span>Kuis selesai</span></div><div><Trophy size={18} /><strong>{profile.bestScore === null ? '—' : profile.bestScore}</strong><span>Nilai terbaik</span></div></div>
    <p className="panel-footnote"><LockKeyhole size={14} /> Profil dan statistik tersimpan di browser ini, bukan akun online. Teman bermain hanya melihat ringkasan yang dikirim langsung saat kalian terhubung.</p>
  </div>
}

function FriendsView({ roomCode }) {
  const [friends, setFriends] = useState(loadFriends)
  const [note, setNote] = useState('')
  async function invite(friend) {
    const link = inviteLink(roomCode)
    const text = `${friend.name}, yuk main KuisKita bareng! Kode ruang: ${roomCode}`
    try {
      if (navigator.share) { await navigator.share({ title: 'Main KuisKita bareng!', text, url: link }); return }
    } catch (error) { if (error?.name === 'AbortError') return }
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(link)
      else throw new Error('copy failed')
      setNote(`Tautan undangan untuk ${friend.name} sudah disalin. Kirim ke temanmu!`)
    } catch { setNote('Tidak bisa menyalin otomatis. Salin kode ruang di halaman ruang.') }
    setTimeout(() => setNote(''), 3000)
  }
  function remove(name) { setFriends(removeFriend(name)); setNote(`${name} dihapus dari daftar teman.`); setTimeout(() => setNote(''), 2500) }
  return <div className="panel-content">
    <p className="panel-description">Teman yang pernah bermain bareng tersimpan di browser ini. Saat kamu membuat ruang, undang mereka dengan sekali klik — tidak perlu kirim kode lagi.</p>
    {note && <p className="profile-feedback" role="status"><Check size={15} />{note}</p>}
    {friends.length === 0
      ? <div className="friends-empty"><UsersRound size={26} /><strong>Belum ada teman</strong><span>Setelah bermain bareng, tekan tombol <b>+ Teman</b> di kartu pemain untuk menambahkan mereka.</span></div>
      : <div className="friends-list">{friends.map((friend) => {
        const rank = friendRank(friend)
        return <div className="friend-row" key={friend.name}>
          <Avatar avatarId={friend.avatar} name={friend.name} frame={friend.frame} className="friend-row-avatar" />
          <div className="friend-row-id"><strong>{friend.name}</strong><RankBadge rank={rank} compact /><small>Winrate {friend.winRate}% · {friend.smartPoints} poin</small></div>
          <div className="friend-row-actions">
            <button type="button" className="friend-invite-button" disabled={!roomCode} onClick={() => invite(friend)} aria-label={`Undang ${friend.name}`}>Undang</button>
            <button type="button" className="friend-remove-button" onClick={() => remove(friend.name)} aria-label={`Hapus teman ${friend.name}`}>Hapus</button>
          </div>
        </div>
      })}</div>}
    {friends.length > 0 && !roomCode && <p className="panel-footnote"><CircleHelp size={14} /> Tombol <b>Undang</b> aktif saat kamu berada di ruang yang kamu buat.</p>}
    <p className="panel-footnote"><LockKeyhole size={14} /> Daftar teman tersimpan lokal di browser ini, bukan akun online.</p>
  </div>
}

function SettingsView({ hintEnabled, setHintEnabled, openPanel }) {
  const sound = useSound()
  return <div className="panel-content">
    <p className="panel-description">Atur pengalaman belajar sesuai keinginanmu.</p>
    <div className="settings-list">
      <div className="preference-row"><span className="preference-icon purple"><Volume2 size={20} /></span><div className="preference-text"><strong>Efek suara</strong><span>Suara saat bermain dan menekan tombol.</span></div><Switch label="Efek suara" checked={sound.enabled} onChange={sound.toggle} silent /></div>
      <div className="preference-row about-preference">
        <button type="button" className="about-info-link" onClick={() => openPanel('about')} aria-label="Buka tentang web"><span className="preference-icon mint"><CircleHelp size={20} /></span><span className="preference-text"><strong>Tentang web</strong><span>Kenali KuisKita dan cara bermainnya.</span></span><ChevronRight size={20} aria-hidden="true" /></button>
        <Switch label="Tentang web" checked={hintEnabled} onChange={() => setHintEnabled((current) => !current)} />
      </div>
    </div>
  </div>
}

function AboutView({ openPanel }) {
  return <div className="panel-content about-content">
    <div className="about-hero"><span><Sparkles size={22} /></span><div><span className="panel-kicker">KENALAN DULU, YUK!</span><h3>Belajar jadi lebih seru.</h3></div></div>
    <p>KuisKita adalah tempat belajar sambil bermain untuk siswa SD sampai SMA. Pilih jenjang, kelas, pelajaran, topik, dan jumlah soal yang ingin dikerjakan.</p>
    <div className="about-feature"><GraduationCap size={18} /><span><strong>1–500 soal</strong> dari bank soal atau Groq AI sesuai pilihanmu.</span></div>
    <div className="about-feature"><UsersRound size={18} /><span><strong>Belajar bersama</strong> dengan kode ruang, atau latihan sendiri.</span></div>
    <div className="about-feature"><Trophy size={18} /><span><strong>Hasil dan pembahasan</strong> muncul setelah permainan selesai.</span></div>
    <p>Untuk Groq AI, pemain solo atau pembuat ruang memasukkan API key sendiri; teman yang bergabung tidak memerlukannya. Kuota Groq dapat berlaku, dan soal AI bisa keliru.</p>
    <button type="button" className="button button-outline about-back" onClick={() => openPanel('settings')}><ArrowLeft size={16} /> Kembali ke pengaturan</button>
  </div>
}

export default function PreferencesPanel({ panel, profile, hintEnabled, setHintEnabled, saveName, saveAvatar, saveFrame, openPanel, closePanel, roomCode }) {
  const dialog = useRef(null)
  const isOpen = Boolean(panel)
  useEffect(() => {
    if (!isOpen) return
    const previousFocus = document.activeElement
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function keydown(event) {
      if (event.key === 'Escape') { event.preventDefault(); closePanel(); return }
      if (event.key !== 'Tab' || !dialog.current) return
      const focusable = [...dialog.current.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((item) => item.getClientRects().length)
      if (!focusable.length) { event.preventDefault(); dialog.current.focus(); return }
      const first = focusable[0], last = focusable.at(-1)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      document.body.style.overflow = originalOverflow
      if (previousFocus && document.contains(previousFocus)) previousFocus.focus()
    }
  }, [isOpen, closePanel])
  useEffect(() => { if (panel) dialog.current?.focus() }, [panel])
  if (!panel) return null
  const title = panel === 'profile' ? 'Profilku' : panel === 'about' ? 'Tentang KuisKita' : panel === 'friends' ? 'Daftar Teman' : 'Pengaturan'
  return <div className="panel-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closePanel() }}>
    <section className="preferences-dialog" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="preferences-title">
      <header className="panel-header">
        {panel === 'about' ? <button className="panel-icon-button" type="button" onClick={() => openPanel('settings')} aria-label="Kembali ke pengaturan"><ArrowLeft size={19} /></button> : <span className="panel-title-icon">{panel === 'profile' ? <UserRound size={20} /> : panel === 'friends' ? <UsersRound size={20} /> : <Settings2 size={20} />}</span>}
        <div><span className="panel-header-label">KUISKITA</span><h2 id="preferences-title">{title}</h2></div>
        <button type="button" className="panel-icon-button panel-close" onClick={closePanel} aria-label="Tutup"><X size={19} /></button>
      </header>
      {panel === 'profile' ? <ProfileView profile={profile} saveName={saveName} saveAvatar={saveAvatar} saveFrame={saveFrame} /> : panel === 'about' ? <AboutView openPanel={openPanel} /> : panel === 'friends' ? <FriendsView roomCode={roomCode} /> : <SettingsView hintEnabled={hintEnabled} setHintEnabled={setHintEnabled} openPanel={openPanel} />}
    </section>
  </div>
}
