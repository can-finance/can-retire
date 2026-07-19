import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

// Dedicated SSR build for build-time prerendering of /how-it-works/.
// Kept separate from vite.config.ts so it doesn't inherit the multi-page
// `rollupOptions.input` or the `manualChunks` vendor split (neither applies to a
// single SSR entry, and manualChunks conflicts with SSR's inlined output).
// Emits a single ESM bundle at dist-ssr/how-it-works-ssr.mjs that
// scripts/prerender.mjs imports. Output is discarded after prerender; dist-ssr
// is gitignored.
export default defineConfig({
  // Same define as the client build so AppLayout's `__APP_VERSION__` footer
  // resolves during SSR instead of throwing a ReferenceError.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react()],
  build: {
    ssr: fileURLToPath(new URL('./src/prerender/how-it-works-ssr.tsx', import.meta.url)),
    outDir: 'dist-ssr',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Deterministic filename so the prerender script can import it directly.
        entryFileNames: 'how-it-works-ssr.mjs',
      },
    },
  },
})
