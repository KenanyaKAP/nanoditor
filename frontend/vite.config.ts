import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, Vite serves on :7779 (reachable from the phone over Tailscale) and
// proxies /api to the Go server on :7778.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 7779,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:7778', xfwd: false },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
  },
} as any)
