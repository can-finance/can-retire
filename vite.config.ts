import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react()],
  server: {
    // Respect an externally assigned port (e.g. preview tooling); default 5173
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    // Windows bind mounts don't forward file-change events into Docker;
    // poll instead so HMR works (set in docker-compose.yml)
    watch: process.env.VITE_USE_POLLING ? { usePolling: true, interval: 300 } : undefined,
  },
  build: {
    rollupOptions: {
      // Multi-page build: the SPA plus a standalone, crawlable CPP calculator page
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        'cpp-calculator': fileURLToPath(new URL('./cpp-calculator/index.html', import.meta.url)),
        'how-it-works': fileURLToPath(new URL('./how-it-works/index.html', import.meta.url)),
      },
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'recharts'],
        },
      },
    },
  },
})
