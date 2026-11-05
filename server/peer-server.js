// Signaling is local to Vite's reverse proxy; browsers only contact the same origin.
// GitHub Pages uses PeerJS Cloud instead (see VITE_SIGNALING_MODE).
import { PeerServer } from 'peer'

const server = PeerServer({
  port: 9001,
  host: '127.0.0.1',
  path: '/peerjs',
  proxied: true,
  allow_discovery: false,
})

server.on('error', (error) => {
  console.error('Server penghubung tidak dapat dijalankan:', error.message)
  process.exitCode = 1
})

console.log('Server penghubung lokal siap di port 9001.')
