// Pilihan avatar lucu untuk profil pemain. Gambar dibuat dengan AI
// dan disimpan di folder public.
export const AVATARS = [
  { id: 'bintang', file: 'avatar-bintang.png', label: 'Bintang' },
  { id: 'kupu', file: 'avatar-kupu.png', label: 'Kupu-kupu' },
  { id: 'kodok', file: 'avatar-kodok.png', label: 'Kodok' },
  { id: 'astronaut', file: 'avatar-astronaut.png', label: 'Astronot' },
  { id: 'robot', file: 'avatar-robot.png', label: 'Robot' },
  { id: 'kucing', file: 'avatar-kucing.png', label: 'Kucing' },
]

export const DEFAULT_AVATAR = 'bintang'

export function isAvatarId(id) {
  return AVATARS.some((avatar) => avatar.id === id)
}

export function assetUrl(file) {
  return `${import.meta.env.BASE_URL}${file}`
}

export function avatarSrc(id) {
  const avatar = AVATARS.find((item) => item.id === id) || AVATARS.find((item) => item.id === DEFAULT_AVATAR)
  return assetUrl(avatar.file)
}
