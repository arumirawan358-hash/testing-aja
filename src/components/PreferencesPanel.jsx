import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, BookOpen, Check, ChevronRight, CircleHelp, GraduationCap, Lightbulb, LockKeyhole, Settings2, Sparkles, Trophy, UserRound, UsersRound, Volume2, X } from 'lucide-react'
import { useSound } from './SoundContext.jsx'

function Switch({ label, checked, onChange, silent = false }) {
  return <button type="button" className="preference-switch" role="switch" aria-label={label} aria-checked={checked} onClick={onChange} data-sound={silent ? 'none' : undefined}>
    <span className="switch-track" aria-hidden="true"><span /></span><span>{checked ? 'Aktif' : 'Mati'}</span>
  </button>
}

function ProfileView({ profile, saveName }) {
  const [name, setName] = useState(profile.name)
  const [feedback, setFeedback] = useState(null)
  const initial = Array.from(profile.name.trim())[0]?.toLocaleUpperCase('id-ID')
  function save(event) {
    event.preventDefault()
    const error = saveName(name)
    setFeedback(error ? { error: true, text: error } : { error: false, text: 'Profil berhasil disimpan di browser ini.' })
  }
  return <div className="panel-content">
    <div className="profile-hero"><div className="profile-avatar">{initial || <UserRound size={30} />}</div><div><span className="panel-kicker">PROFIL BELAJAR</span><h3>{profile.name || 'Teman belajar'}</h3><p>Profil sederhana, tanpa perlu membuat akun.</p></div></div>
    <form className="profile-form" onSubmit={save} noValidate>
      <label className="field"><span>Nama panggilan</span><input value={name} onChange={(event) => { setName(event.target.value); setFeedback(null) }} maxLength={24} autoComplete="nickname" placeholder="Masukkan nama panggilanmu" /></label>
      <p className="panel-help">Nama ini otomatis terisi saat membuat atau bergabung ke permainan berikutnya.</p>
      {feedback && <p className={`profile-feedback ${feedback.error ? 'error' : ''}`} role={feedback.error ? 'alert' : 'status'}>{!feedback.error && <Check size={15} />}{feedback.text}</p>}
      <button type="submit" className="button button-primary profile-save">Simpan profil</button>
    </form>
    <div className="profile-stats" aria-label="Statistik di browser ini"><div><BookOpen size={18} /><strong>{profile.gamesPlayed}</strong><span>Kuis selesai</span></div><div><Trophy size={18} /><strong>{profile.bestScore === null ? '—' : profile.bestScore}</strong><span>Nilai terbaik</span></div></div>
    <p className="panel-footnote"><LockKeyhole size={14} /> Profil dan statistik tersimpan di browser ini, bukan akun online. Statistik berlaku untuk perangkat ini meskipun nama diubah.</p>
  </div>
}

function SettingsView({ hintEnabled, setHintEnabled, openPanel }) {
  const sound = useSound()
  return <div className="panel-content">
    <p className="panel-description">Atur pengalaman belajar sesuai keinginanmu.</p>
    <div className="settings-list">
      <div className="preference-row"><span className="preference-icon purple"><Volume2 size={20} /></span><div className="preference-text"><strong>Efek suara</strong><span>Suara saat bermain dan menekan tombol.</span></div><Switch label="Efek suara" checked={sound.enabled} onChange={sound.toggle} silent /></div>
      <button type="button" className="preference-row about-link" onClick={() => openPanel('about')}><span className="preference-icon mint"><CircleHelp size={20} /></span><span className="preference-text"><strong>Tentang web</strong><span>Kenali KuisKita dan cara bermainnya.</span></span><ChevronRight size={20} /></button>
    </div>
    <section className="hint-setting" aria-labelledby="hint-setting-title">
      <div className="hint-setting-top"><span className="preference-icon yellow"><Lightbulb size={21} /></span><div className="preference-text"><strong id="hint-setting-title">Hint jawaban</strong><span>Tampilkan jawaban pada setiap soal.</span></div><Switch label="Hint jawaban" checked={hintEnabled} onChange={() => setHintEnabled((current) => !current)} /></div>
      <p>Hint hanya muncul jika diaktifkan dan berlaku di browser ini, termasuk saat main berdua. Nilai tetap dihitung; sepakati penggunaannya dengan teman agar adil.</p>
    </section>
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

export default function PreferencesPanel({ panel, profile, hintEnabled, setHintEnabled, saveName, openPanel, closePanel }) {
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
  const title = panel === 'profile' ? 'Profilku' : panel === 'about' ? 'Tentang KuisKita' : 'Pengaturan'
  return <div className="panel-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closePanel() }}>
    <section className="preferences-dialog" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="preferences-title">
      <header className="panel-header">
        {panel === 'about' ? <button className="panel-icon-button" type="button" onClick={() => openPanel('settings')} aria-label="Kembali ke pengaturan"><ArrowLeft size={19} /></button> : <span className="panel-title-icon">{panel === 'profile' ? <UserRound size={20} /> : <Settings2 size={20} />}</span>}
        <div><span className="panel-header-label">KUISKITA</span><h2 id="preferences-title">{title}</h2></div>
        <button type="button" className="panel-icon-button panel-close" onClick={closePanel} aria-label="Tutup"><X size={19} /></button>
      </header>
      {panel === 'profile' ? <ProfileView profile={profile} saveName={saveName} /> : panel === 'about' ? <AboutView openPanel={openPanel} /> : <SettingsView hintEnabled={hintEnabled} setHintEnabled={setHintEnabled} openPanel={openPanel} />}
    </section>
  </div>
}
