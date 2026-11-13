// 10 bingkai avatar dengan efek animasi; tampil di profil dan terlihat lawan main.
export const FRAMES = [
  { id: 'bintang', label: 'Bintang' },
  { id: 'emas', label: 'Emas' },
  { id: 'api', label: 'Api' },
  { id: 'es', label: 'Es' },
  { id: 'pelangi', label: 'Pelangi' },
  { id: 'galaksi', label: 'Galaksi' },
  { id: 'neon', label: 'Neon' },
  { id: 'sakura', label: 'Sakura' },
  { id: 'petir', label: 'Petir' },
  { id: 'konfeti', label: 'Konfeti' },
]

export const DEFAULT_FRAME = 'bintang'

export function isFrameId(id) {
  return FRAMES.some((frame) => frame.id === id)
}
