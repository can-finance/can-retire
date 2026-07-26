import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Matches vite.config.ts — see the note there on why this is an import.
import pkg from './package.json'

// Dedicated SSR build for build-time prerendering of the standalone MPA pages
// (/how-it-works/, /rrsp-withdrawal-strategy/, and /cpp-calculator/). The first
// two emit both prerendered HTML and FAQ JSON-LD; cpp-calculator is JSON-LD-only
// (its entry exports no `render`, since the page reads window.localStorage and
// can't be server-rendered — see src/prerender/cpp-calculator-ssr.tsx). Kept separate from
// vite.config.ts so it doesn't inherit the multi-page client `rollupOptions.input`
// or the `manualChunks` vendor split (neither applies to these SSR entries, and
// manualChunks conflicts with SSR's inlined output).
//
// `build.ssr: true` enables SSR mode while `rollupOptions.input` supplies MULTIPLE
// entries (a plain `build.ssr: '<path>'` string only allows one). `entryFileNames`
// pins each output to `<name>-ssr.mjs` so scripts/prerender.mjs can import them by
// deterministic path — preserving the existing how-it-works-ssr.mjs filename
// contract while adding rrsp-withdrawal-strategy-ssr.mjs. Output is discarded after
// prerender; dist-ssr is gitignored.
export default defineConfig({
  // Same define as the client build so AppLayout's `__APP_VERSION__` footer
  // resolves during SSR instead of throwing a ReferenceError.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react()],
  build: {
    ssr: true,
    outDir: 'dist-ssr',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'how-it-works': fileURLToPath(new URL('./src/prerender/how-it-works-ssr.tsx', import.meta.url)),
        'rrsp-withdrawal-strategy': fileURLToPath(new URL('./src/prerender/rrsp-withdrawal-strategy-ssr.tsx', import.meta.url)),
        'cpp-calculator': fileURLToPath(new URL('./src/prerender/cpp-calculator-ssr.tsx', import.meta.url)),
      },
      output: {
        // Deterministic filenames so the prerender script can import each directly:
        // e.g. how-it-works -> how-it-works-ssr.mjs.
        entryFileNames: '[name]-ssr.mjs',
      },
    },
  },
})
