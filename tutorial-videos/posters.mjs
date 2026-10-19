// Render a poster image for each tutorial video: one frame from the MP4 as the
// background, a dark gradient, and the tutorial's title on top.
//
// Reads titles and video paths from src/components/pages/tutorials-data.ts and
// the MP4s from public/tutorials/, writes public/tutorials/posters/<name>.jpg.
// Needs the whole repo mounted (see "Posters" in README.md).
//
// Usage: node tutorial-videos/posters.mjs [name ...]     all videos, or just these
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(REPO, 'src/components/pages/tutorials-data.ts');
const PUBLIC = path.join(REPO, 'public');
const OUT = path.join(PUBLIC, 'tutorials/posters');

// Seconds into the video to take the frame from, when the default (45% of the
// duration) lands on a poor moment: a caption fade, a scroll, a drawer opening.
const FRAME_AT = {
    // 'create-a-plan': 21.5,
};
const DEFAULT_FRACTION = 0.45;

const W = 1280;
const H = 720;

// Pull { title, videoSrc } out of each entry of the TUTORIALS array. Each entry
// starts with `id:`, so the array is split there and each chunk read on its own
// (entries with no videoSrc are dropped). Quotes may be ' or ".
function readTutorials() {
    const src = readFileSync(DATA, 'utf8');
    const body = src.slice(src.indexOf('export const TUTORIALS'));
    const str = (chunk, key) => {
        const m = chunk.match(new RegExp(`\\b${key}:\\s*(['"])((?:\\\\.|(?!\\1).)*)\\1`));
        return m ? m[2].replace(/\\(.)/g, '$1') : undefined;
    };
    return body
        .split(/\bid:\s*/)
        .slice(1)
        .map((chunk) => ({ title: str(chunk, 'title'), videoSrc: str(chunk, 'videoSrc') }))
        .filter((t) => t.title && t.videoSrc);
}

function probeDuration(file) {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
    return Number(String(out).trim());
}

function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function posterHtml(title, frameDataUrl) {
    return `<!doctype html>
<html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@600;800&display=block" rel="stylesheet">
<style>
  * { margin: 0; box-sizing: border-box; }
  html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: #0f172a; }
  body { position: relative; font-family: Inter, 'Liberation Sans', sans-serif; }
  .bg { position: absolute; inset: 0; background: url(${frameDataUrl}) center / cover no-repeat; }
  /* Two layers: a darkening wash from the left, and a stronger one from the
     bottom, so the bottom-left corner is near-black and the UI shows top-right. */
  .shade {
    position: absolute; inset: 0;
    background:
      linear-gradient(to top, rgba(2, 6, 23, 0.95) 0%, rgba(2, 6, 23, 0.75) 40%, rgba(2, 6, 23, 0.15) 75%, rgba(2, 6, 23, 0) 100%),
      linear-gradient(to right, rgba(2, 6, 23, 0.7) 0%, rgba(2, 6, 23, 0.25) 55%, rgba(2, 6, 23, 0) 100%);
  }
  .text { position: absolute; left: 80px; right: 120px; bottom: 76px; }
  .label {
    display: flex; align-items: center; gap: 14px;
    color: #bae6fd; font-weight: 600; font-size: 28px; letter-spacing: 0.01em;
    margin-bottom: 22px;
  }
  .label::before { content: ''; width: 48px; height: 6px; border-radius: 3px; background: #0ea5e9; }
  h1 {
    color: #fff; font-weight: 800; font-size: 96px; line-height: 1.02; letter-spacing: -0.025em;
    text-shadow: 0 2px 24px rgba(0, 0, 0, 0.45);
  }
</style></head>
<body>
  <div class="bg"></div>
  <div class="shade"></div>
  <div class="text">
    <div class="label">CRAPtool tutorial</div>
    <h1>${escapeHtml(title)}</h1>
  </div>
</body></html>`;
}

const only = process.argv.slice(2);
const tutorials = readTutorials()
    .filter((t) => t.videoSrc.startsWith('/tutorials/'))
    .map((t) => ({ ...t, name: path.basename(t.videoSrc, path.extname(t.videoSrc)) }))
    .filter((t) => only.length === 0 || only.includes(t.name));
if (tutorials.length === 0) {
    console.error('No matching tutorials with a /tutorials/ videoSrc in', DATA);
    process.exit(1);
}

mkdirSync(OUT, { recursive: true });
const tmp = path.join(OUT, '.frame.png');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
let failed = 0;
try {
    for (const t of tutorials) {
        const mp4 = path.join(PUBLIC, t.videoSrc);
        if (!existsSync(mp4)) {
            console.error(`missing ${mp4}, skipped`);
            failed++;
            continue;
        }
        const at = FRAME_AT[t.name] ?? probeDuration(mp4) * DEFAULT_FRACTION;
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', at.toFixed(2), '-i', mp4, '-frames:v', '1', tmp]);
        const frame = `data:image/png;base64,${readFileSync(tmp).toString('base64')}`;
        await page.setContent(posterHtml(t.title, frame), { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        const file = path.join(OUT, `${t.name}.jpg`);
        await page.screenshot({ path: file, type: 'jpeg', quality: 82 });
        console.log(`${file}  (frame at ${at.toFixed(1)}s)`);
    }
} finally {
    rmSync(tmp, { force: true });
    await browser.close();
}
process.exit(failed ? 1 : 0);
