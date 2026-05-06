import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// Read the package version once at config time so we can inject it as
// a build-time constant. Avoids a stale hardcoded `APP_VERSION` in
// App.tsx drifting from package.json / tauri.conf.json (the bug a
// Winget moderator caught on PR microsoft/winget-pkgs#368471 where
// the v0.2.4 build was still showing 0.1.0 in the UI).
const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { version: string }

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
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
