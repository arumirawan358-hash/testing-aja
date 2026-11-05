import { useEffect, useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUpRight, BadgeCheck, BookOpen, Check, ChevronRight, CircleHelp, Copy, GraduationCap, Hash, Heart, KeyRound, Layers3, LockKeyhole, Play, Plus, ShieldCheck, Sparkles, UsersRound, WandSparkles, Zap } from 'lucide-react'
import Brand from './Brand.jsx'
import { CUSTOM_SUBJECT, DEFAULT_CONFIG, LEVELS, getLevel, validateConfig, validateName } from '../data/subjects.js'
import SoundToggle from './SoundToggle.jsx'
import MenuButtons from './MenuButtons.jsx'
import { usePreferences } from './PreferencesContext.jsx'

const features = [
  { icon: Layers3, title: '1–500 soal', subtitle: 'Pilih sesuai maumu', color: 'violet' },
  { icon: GraduationCap, title: 'SD sampai SMA', subtitle: 'Untuk setiap jenjang', color: 'peach' },
  { icon: UsersRound, title: 'Main berdua', subtitle: 'Dekat walau berjauhan', color: 'mint' },
  { icon: WandSparkles, title: 'Soal dengan AI', subtitle: 'Belajar lebih variatif', color: 'yellow' },
]

function FeatureStrip() {
  return (
    <div className="feature-strip" id="keunggulan">
      {features.map(({ icon: Icon, title, subtitle, color }) => (
        <div className="feature" key={title}>
          <span className={`feature-icon ${color}`}><Icon size={21} strokeWidth={1.9} /></span>
          <span><strong>{title}</strong><small>{subtitle}</small></span>
        </div>
      ))}
    </div>
  )
}

function SetupForm({ session }) {
  const { profile, saveName } = usePreferences()
  const [name, setName] = useState(profile.name)
  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [error, setError] = useState('')
  const currentLevel = getLevel(config.level)
  useEffect(() => { setName(profile.name) }, [profile.name])

  function updateLevel(levelId) {
    const level = getLevel(levelId)
    setConfig({ ...config, level: levelId, grade: level.grades[0], subject: level.subjects[0] })
  }
  function start(solo = false) {
    const message = validateName(name) || validateConfig(config) || (config.source === 'groq' && !apiKey.trim() ? 'Masukkan API key Groq terlebih dahulu, ya.' : '')
    if (message) { setError(message); return }
    setError('')
    saveName(name)
    const data = { name, config: { ...config, count: Number(config.count), grade: Number(config.grade) }, apiKey: config.source === 'groq' ? apiKey : '' }
    if (solo) session.startSolo(data)
    else session.createRoom(data)
  }

  return (
    <form className="surface setup-card" onSubmit={(event) => { event.preventDefault(); start(false) }} noValidate>
      <div className="card-heading">
        <div className="heading-icon purple"><Plus size={22} strokeWidth={2.4} /></div>
        <div><div className="title-line"><h3>Buat ruang baru</h3><span className="mini-pill">JADI HOST</span></div><p>Atur kuisnya, lalu ajak temanmu bermain.</p></div>
      </div>
      <div className="form-body">
        <label className="field">
          <span>Nama panggilan <i>*</i></span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Siapa namamu?" maxLength={24} autoComplete="nickname" aria-label="Nama panggilan pembuat ruang" />
        </label>
        <div className="form-row">
          <label className="field"><span>Jenjang <i>*</i></span>
            <select value={config.level} onChange={(event) => updateLevel(event.target.value)}>
              {LEVELS.map((level) => <option value={level.id} key={level.id}>{level.label}</option>)}
            </select>
          </label>
          <label className="field"><span>Kelas <i>*</i></span>
            <select value={config.grade} onChange={(event) => setConfig({ ...config, grade: Number(event.target.value) })}>
              {currentLevel.grades.map((grade) => <option key={grade} value={grade}>Kelas {grade}</option>)}
            </select>
          </label>
        </div>
        <div className="form-row">
          <label className="field"><span>Mata pelajaran <i>*</i></span>
            <select value={config.subject} onChange={(event) => setConfig({ ...config, subject: event.target.value })}>
              {currentLevel.subjects.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
              {config.source !== 'bank' && <option value={CUSTOM_SUBJECT}>Lainnya (khusus AI)</option>}
            </select>
          </label>
          <label className="field"><span>Jumlah soal <i>*</i></span>
            <div className="number-input"><input type="number" min="1" max="500" step="1" value={config.count} onChange={(event) => setConfig({ ...config, count: event.target.value })} aria-describedby="count-help" /><span>soal</span></div>
          </label>
        </div>
        {config.source !== 'bank' && config.subject === CUSTOM_SUBJECT && <label className="field"><span>Nama mata pelajaran <i>*</i></span><input value={config.customSubject} onChange={(event) => setConfig({ ...config, customSubject: event.target.value })} placeholder="Contoh: Seni Budaya atau PJOK" maxLength={60} /></label>}
        <div className="quick-counts" id="count-help"><span>Pilihan cepat</span>{[10, 20, 50, 100, 500].map((count) => <button type="button" key={count} className={Number(config.count) === count ? 'active' : ''} onClick={() => setConfig({ ...config, count })}>{count}</button>)}<small>maks. 500</small></div>
        <div className="source-section">
          <div className="field-title">Sumber soal <span>Pilih sesuai kebutuhanmu</span></div>
          <div className="source-options" role="radiogroup" aria-label="Sumber soal">
            <button type="button" role="radio" aria-checked={config.source === 'bank'} className={`source-option ${config.source === 'bank' ? 'selected' : ''}`} onClick={() => setConfig({ ...config, source: 'bank', subject: config.subject === CUSTOM_SUBJECT ? currentLevel.subjects[0] : config.subject })}>
              <span className="source-icon bank-icon"><BookOpen size={18} /></span><span><strong>Bank soal</strong><small>Langsung main</small></span><span className="radio-dot" />
            </button>
            <button type="button" role="radio" aria-checked={config.source === 'groq'} className={`source-option ${config.source === 'groq' ? 'selected' : ''}`} onClick={() => setConfig({ ...config, source: 'groq' })}>
              <span className="source-icon ai-icon"><Sparkles size={18} /></span><span><strong>Groq AI</strong><small>Soal baru dari AI</small></span><span className="radio-dot" />
            </button>
          </div>
          {config.source === 'bank' ? (
            <p className="source-note"><CircleHelp size={14} /> Bank soal bisa berulang untuk jumlah besar. Pilih AI untuk variasi lebih banyak.</p>
          ) : (
            <div className="ai-key-area">
              <label className="field"><span>Topik khusus <em>(opsional)</em></span><input value={config.topic} onChange={(event) => setConfig({ ...config, topic: event.target.value })} placeholder="Contoh: pecahan atau tata surya" maxLength={100} /></label>
              <label className="field"><span>API key Groq <i>*</i></span><div className="key-input"><input type={showKey ? 'text' : 'password'} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Masukkan API key Groq" maxLength={512} autoComplete="off" spellCheck="false" /><button type="button" onClick={() => setShowKey(!showKey)} aria-label={showKey ? 'Sembunyikan API key Groq' : 'Tampilkan API key Groq'}>{showKey ? 'Sembunyikan' : 'Lihat'}</button></div></label>
              <p className="source-note"><LockKeyhole size={14} /> Main sendiri: masukkan kuncimu. Main berdua: cukup pembuat ruang yang mengisi; teman tidak perlu. Kunci hanya sementara di browser dan dikirim langsung ke Groq, bukan ke teman atau GitHub. Kuota atau biaya Groq dapat berlaku.</p>
              <a className="text-link" href="https://console.groq.com/keys" target="_blank" rel="noreferrer">Dapatkan API key di Groq Console <ArrowUpRight size={14} /></a>
              {Number(config.count) > 100 && <p className="source-note warm"><CircleHelp size={14} /> Soal dalam jumlah besar dibuat bertahap dan bisa memerlukan waktu serta kuota lebih banyak.</p>}
            </div>
          )}
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="button button-primary create-button" type="submit"><span><Plus size={18} /> Buat ruang</span><ArrowRight size={18} /></button>
        <button type="button" className="solo-link" onClick={() => start(true)}>Ingin sendiri dulu? <strong>Latihan sendiri <ArrowRight size={14} /></strong></button>
      </div>
    </form>
  )
}

function JoinForm({ session }) {
  const { profile, saveName } = usePreferences()
  const urlCode = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('room') || ''
  const [name, setName] = useState(profile.name)
  const [code, setCode] = useState(urlCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))
  const [error, setError] = useState('')
  useEffect(() => { setName(profile.name) }, [profile.name])

  useEffect(() => {
    if (urlCode) setTimeout(() => document.getElementById('gabung')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)
  }, [urlCode])

  function join(event) {
    event.preventDefault()
    const message = validateName(name) || (!/^[A-Z0-9]{6}$/.test(code) ? 'Kode ruang harus terdiri dari 6 karakter.' : '')
    if (message) { setError(message); return }
    setError('')
    saveName(name)
    session.joinRoom({ name, code })
  }
  return (
    <form className="surface join-card" id="gabung" onSubmit={join} noValidate>
      <div className="join-card-top"><span className="heading-icon yellow"><KeyRound size={21} /></span><span className="corner-sparkle"><Sparkles size={18} /></span></div>
      <h3>Punya kode ruang?</h3>
      <p>Masukkan kode dari temanmu dan mulai belajar bareng!</p>
      <label className="field"><span>Nama panggilan <i>*</i></span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nama panggilanmu" maxLength={24} autoComplete="nickname" aria-label="Nama panggilan untuk bergabung" /></label>
      <label className="field join-code-label"><span>Kode ruang <i>*</i></span><div className="code-input"><Hash size={17} /><input value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} placeholder="MASUKKAN KODE" maxLength={6} autoComplete="off" aria-label="Kode ruang" /></div></label>
      {error && <div className="form-error" role="alert">{error}</div>}
      <button type="submit" className="button button-dark join-button"><span>Gabung ruang</span><ArrowRight size={18} /></button>
      <div className="join-footnote"><ShieldCheck size={15} /> Kode ruang terdiri dari 6 karakter</div>
    </form>
  )
}

function HowToPlay() {
  const steps = [
    ['01', 'Buat atau gabung ruang', 'Atur kuis dan bagikan kode ke temanmu.'],
    ['02', 'Jawab soal bersama', 'Kerjakan soal yang sama dari mana saja.'],
    ['03', 'Lihat hasilnya', 'Cek nilai dan pembahasan di akhir.'],
  ]
  return (
    <div className="surface how-card" id="cara-main">
      <div className="how-heading"><div><span className="eyebrow tiny">GAMPANG BANGET!</span><h3>Cara mainnya</h3></div><span className="how-star">✳</span></div>
      <div className="steps">{steps.map(([number, title, description]) => <div className="step" key={number}><span className="step-number">{number}</span><div><strong>{title}</strong><p>{description}</p></div></div>)}</div>
      <div className="how-bottom"><Sparkles size={15} /> Siap jadi tim paling pintar?</div>
    </div>
  )
}

export default function Landing({ session }) {
  return (
    <div className="landing" id="beranda">
      <header className="site-header">
        <div className="container header-inner">
          <Brand onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} />
          <nav className="desktop-nav" aria-label="Navigasi utama"><a className="active" href="#beranda">Beranda</a><a href="#cara-main">Cara bermain</a><a href="#keunggulan">Keunggulan</a></nav>
          <div className="header-actions"><SoundToggle /><MenuButtons /><a href="#mulai" className="header-cta">Yuk, mulai! <ArrowUpRight size={16} /></a></div>
        </div>
      </header>
      <main>
        <section className="hero container">
          <div className="hero-copy">
            <div className="eyebrow hero-eyebrow"><Sparkles size={15} fill="currentColor" /> BELAJAR BARENG, MAKIN SENANG <span>✦</span></div>
            <h1>Belajar makin<br /><span>seru bareng!</span></h1>
            <p className="hero-description">Ubah belajar jadi petualangan seru. Buat kuis, ajak teman, dan tumbuh lebih pintar bersama!</p>
            <div className="hero-actions"><a className="button button-primary hero-primary" href="#mulai">Mulai bermain <ArrowRight size={19} /></a><a className="hero-secondary" href="#gabung"><span className="play-circle"><Play size={12} fill="currentColor" /></span> Punya kode ruang?</a></div>
            <div className="hero-social"><div className="mini-avatars" aria-hidden="true"><span>A</span><span>K</span><span>S</span></div><div><strong>Lebih seru kalau bersama!</strong><small>Teman belajar untuk rasa ingin tahumu <span>✦</span></small></div></div>
          </div>
          <div className="hero-visual">
            <div className="hero-art-frame"><img src={`${import.meta.env.BASE_URL}study-buddies.png`} alt="Dua teman belajar bersama dengan laptop dan buku" /></div>
            <div className="floating-label floating-top"><span className="floating-icon mint"><UsersRound size={17} /></span><span><strong>Belajar bareng</strong><small>di mana saja!</small></span><span className="float-sparkle">✦</span></div>
            <div className="floating-label floating-bottom"><span className="floating-icon yellow"><Zap size={18} fill="currentColor" /></span><span><strong>Siap jadi pintar?</strong><small>Yuk, coba kuisnya!</small></span></div>
            <span className="hero-deco deco-one">✳</span><span className="hero-deco deco-two">✦</span>
          </div>
        </section>
        <div className="container"><FeatureStrip /></div>
        <section className="play-section" id="mulai">
          <div className="container">
            <div className="section-heading"><div><span className="eyebrow section-eyebrow"><span>✦</span> PETUALANGAN DIMULAI DI SINI</span><h2>Siap main sambil belajar?</h2><p>Bikin ruang sendiri atau langsung gabung ke ruang temanmu.</p></div><div className="section-doodle" aria-hidden="true"><span>belajar itu seru!</span><ArrowDown size={25} /></div></div>
            <div className="play-grid"><SetupForm session={session} /><div className="play-side"><JoinForm session={session} /><HowToPlay /></div></div>
          </div>
        </section>
        <section className="closing-section container"><div className="closing-content"><div><span className="eyebrow">SEDIKIT DEMI SEDIKIT, JADI HEBAT</span><h2>Belajar lebih asyik<br />kalau ada teman. <span>✳</span></h2><p>Nggak perlu sempurna, yang penting terus mencoba.</p></div><a href="#mulai" className="button button-light">Ayo mulai <ArrowRight size={18} /></a></div></section>
      </main>
      <footer className="footer"><div className="container footer-inner"><div><Brand onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} /><p>Teman kecil untuk mimpi yang besar. ✨</p></div><div className="footer-right"><span>Dibuat untuk belajar bersama <Heart size={14} fill="currentColor" /></span><small>© {new Date().getFullYear()} KuisKita</small></div></div></footer>
    </div>
  )
}
