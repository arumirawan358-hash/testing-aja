import { Peer } from 'peerjs'

// These are public community relay credentials, not private application secrets.
// Self-hosters can replace them at build time with their own TURN service.
function iceServers() {
  const servers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] }]
  const urls = import.meta.env.VITE_TURN_URLS?.split(',').map((url) => url.trim()).filter(Boolean)
  if (urls?.length) {
    servers.push({ urls, username: import.meta.env.VITE_TURN_USERNAME || '', credential: import.meta.env.VITE_TURN_CREDENTIAL || '' })
  } else {
    servers.push({
      urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443?transport=tcp'],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    })
  }
  return servers
}

export function createPeer(id) {
  const mode = import.meta.env.VITE_SIGNALING_MODE || 'local'
  const options = { config: { iceServers: iceServers() }, debug: 0 }
  if (mode === 'local') {
    const secure = window.location.protocol === 'https:'
    Object.assign(options, {
      host: window.location.hostname,
      port: window.location.port ? Number(window.location.port) : secure ? 443 : 80,
      path: '/peerjs',
      secure,
    })
  } else if (import.meta.env.VITE_PEER_HOST) {
    Object.assign(options, {
      host: import.meta.env.VITE_PEER_HOST,
      port: Number(import.meta.env.VITE_PEER_PORT || 443),
      path: import.meta.env.VITE_PEER_PATH || '/',
      secure: import.meta.env.VITE_PEER_SECURE !== 'false',
    })
  }
  return id ? new Peer(id, options) : new Peer(options)
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function makeRoomCode() {
  const values = new Uint8Array(6)
  globalThis.crypto.getRandomValues(values)
  return Array.from(values, (value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join('')
}

export function makeToken() {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID()
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

export const roomPeerId = (code) => `kuiskita-room-${code}`
