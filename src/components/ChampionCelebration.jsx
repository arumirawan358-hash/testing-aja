import { assetUrl } from '../data/avatars.js'
import { RankBadge } from './ProfileCard.jsx'

// Konfeti deterministik supaya tampilan konsisten saat diuji.
const PIECES = Array.from({ length: 32 }, (_, i) => ({
  left: (i * 37 + 11) % 100,
  delay: ((i * 7) % 13) / 4,
  duration: 3.2 + ((i * 3) % 9) / 4,
  hue: (i * 47) % 360,
  size: 7 + ((i * 5) % 8),
  round: i % 3 === 0,
}))

// Animasi juara saat ada pemenang: konfeti, piala, dan lencana rank berkilau.
export default function ChampionCelebration({ winnerName, rank, selfWon = false }) {
  return <div className={`champion-celebration ${selfWon ? 'champion-self' : ''}`} role="status" aria-label={`Juara ${winnerName}`}>
    <div className="confetti" aria-hidden="true">
      {PIECES.map((piece, index) => <span
        key={index}
        className={piece.round ? 'confetti-dot' : ''}
        style={{ left: `${piece.left}%`, animationDelay: `${piece.delay}s`, animationDuration: `${piece.duration}s`, background: `hsl(${piece.hue} 90% 62%)`, width: `${piece.size}px`, height: `${piece.round ? piece.size : piece.size * 1.7}px` }}
      />)}
    </div>
    <div className="champion-banner">
      <img className="champion-art" src={assetUrl('champion.png')} alt="Piala juara berkilau dengan konfeti" />
      <div className="champion-copy">
        <span className="champion-kicker">✦ JUARA RONDE INI ✦</span>
        <h2 className="champion-title">{winnerName}</h2>
        <p>{selfWon ? 'Hore! Kamu yang paling tinggi nilainya. Kerja bagus!' : 'Selamat kepada pemenang! Kalian berdua hebat.'}</p>
        <RankBadge rank={rank} />
      </div>
    </div>
  </div>
}
