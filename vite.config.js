import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const peerProxy = {
  '/peerjs': {
    target: 'http://127.0.0.1:9001',
    changeOrigin: true,
    ws: true,
  },
}

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || '/',
  server: { host: '0.0.0.0', port: 5173, allowedHosts: true, proxy: peerProxy },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true, proxy: peerProxy },
  test: { environment: 'node', include: ['tests/**/*.test.js'] },
})
