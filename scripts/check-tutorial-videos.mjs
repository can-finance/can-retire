// Deploy-time check that every tutorial video the /tutorials/ page points at is
// present in the built site.
//
// Reads src/components/pages/tutorials-data.ts as text, pulls out every
// `videoSrc: '...'` and `posterSrc: '...'`, and checks each file exists under the
// directory given as the first argument (default `dist`). Exits non-zero with the
// list of missing files, so a release that lacks a video fails the deploy rather
// than shipping a broken player.
//
// Usage: node scripts/check-tutorial-videos.mjs [dir]

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dataUrl = new URL('../src/components/pages/tutorials-data.ts', import.meta.url);
const root = resolve(process.argv[2] ?? 'dist');

const source = readFileSync(dataUrl, 'utf8');

// Matches single- or double-quoted values on a `videoSrc:` / `posterSrc:` line.
const FIELD = /\b(videoSrc|posterSrc)\s*:\s*(['"])(.+?)\2/g;
const entries = [...source.matchAll(FIELD)].map((m) => ({ field: m[1], src: m[3] }));

// A regex that quietly stops matching would otherwise let every deploy pass.
if (!entries.some((e) => e.field === 'videoSrc')) {
    console.error('No videoSrc entries found in tutorials-data.ts; the check script or the data format has changed.');
    process.exit(1);
}

const missing = entries.filter(({ src }) => !existsSync(join(root, src)));

if (missing.length > 0) {
    console.error(`Missing tutorial files under ${root}:`);
    for (const { field, src } of missing) {
        console.error(`  ${src} (${field})`);
    }
    process.exit(1);
}

console.log(`All ${entries.length} tutorial files present under ${root}.`);
