import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 1420,
    strictPort: true,
    hmr: {
      overlay: true,
    },
    watch: {
      usePolling: true, // Helpful for WSL2 file system
      interval: 1000,
    },
  },
})

