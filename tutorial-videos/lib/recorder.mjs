// Record one tutorial: fresh browser context with video, overlay injected,
// title card over the page load, the tutorial's steps, an end card, then
// ffmpeg to a trimmed H.264 MP4 in out/.

import { chromium } from 'playwright';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addOverlay } from './overlay.mjs';
import { seedStorage } from './fixture.mjs';
import { Tutor } from './tutor.mjs';
import { readAppVersion, saveJoined, saveScene, saveTake, versionRecord } from './versions.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OUT_DIR = path.resolve(HERE, '..', 'out');
// The recorder runs inside the dev-server container's network namespace.
export const BASE_URL = process.env.TUT_BASE_URL || 'http://localhost:5173';
export const SIZE = { width: 1280, height: 720 };
// Final-encode knobs (env), for trials: TUT_FPS (default 24), TUT_CRF (default
// 23; lower is better quality and bigger), TUT_SUFFIX appended to output names.
// No resolution knob: Playwright records at the viewport's CSS size and never
// upscales, so a bigger recordVideo size only pads the 720p picture.
const FPS = String(Number(process.env.TUT_FPS) || 24);
const CRF = String(Number(process.env.TUT_CRF) || 23);
const SUFFIX = process.env.TUT_SUFFIX || '';

/**
 * @param {object} o
 * @param {string} o.name              output basename (out/<name>.mp4)
 * @param {string} o.url               path or absolute URL to open
 * @param {{title:string, subtitle?:string}} o.title   opening card
 * @param {{title:string, subtitle?:string, url?:string}} [o.end]   closing card
 * @param {number} [o.titleMs]         how long the title card holds once the app is ready
 * @param {(t: Tutor, page: import('playwright').Page) => Promise<void>} o.ready  resolves when the app is usable
 * @param {(t: Tutor, page: import('playwright').Page) => Promise<void>} o.run    the tutorial steps
 * @param {object} [o.contextOptions]  extra newContext options
 */
export async function record(o) {
    const rawDir = path.join(OUT_DIR, 'raw', o.name);
    rmSync(rawDir, { recursive: true, force: true });
    mkdirSync(rawDir, { recursive: true });

    const browser = await chromium.launch();
    const context = await browser.newContext({
        viewport: SIZE,
        deviceScaleFactor: 1,
        recordVideo: { dir: rawDir, size: SIZE },
        locale: 'en-CA',
        timezoneId: 'America/Toronto',
        ...o.contextOptions,
    });
    const start = { x: SIZE.width * 0.62, y: SIZE.height * 0.55 };
    await addOverlay(context, { titleCard: o.title, start });

    const t0 = Date.now(); // video clock starts with the page
    const page = await context.newPage();
    const tutor = new Tutor(page, start);
    let trimSec = 0;
    let ok = false;
    let appVersion = null;
    try {
        await page.goto(new URL(o.url, BASE_URL).href, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__tut && window.__tut.cardVisible());
        trimSec = Math.max(0, (Date.now() - t0) / 1000 - 0.05);
        tutor.videoStart = t0 + trimSec * 1000;
        await o.ready(tutor, page);
        appVersion = await readAppVersion(page);
        await page.mouse.move(start.x, start.y); // park the cursor before it's revealed
        await tutor.pause(o.titleMs ?? 2000);
        await tutor.hideCard();
        await o.run(tutor, page);
        if (o.end) await tutor.card(o.end.title, o.end.subtitle, 3000, { url: o.end.url });
        ok = true;
    } finally {
        if (!ok) await page.screenshot({ path: path.join(OUT_DIR, `${o.name}-failure.png`) }).catch(() => {});
        const video = page.video();
        await context.close();
        await browser.close();
        if (ok && video) {
            const webm = await video.path();
            const mp4 = path.join(OUT_DIR, `${o.name}${SUFFIX}.mp4`);
            toMp4(webm, mp4, trimSec);
            saveTake(o.name, versionRecord(appVersion));
            const s = statSync(mp4);
            console.log(`wrote ${mp4}  ${(s.size / 1e6).toFixed(2)} MB  ${probeDuration(mp4).toFixed(1)} s  (trimmed ${trimSec.toFixed(2)} s)`);
        }
    }
}

// ---------------------------------------------------------------------------
// Scene mode: a tutorial recorded as separate clips, joined with crossfades.
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Record a tutorial as scenes. Each scene is its own take from a fresh context
 * (seeded localStorage), cached as out/raw/<name>/scenes/<id>.mp4, then all
 * clips are joined with short crossfades into out/<name>.mp4. A built-in
 * `title` scene opens and an `end` scene closes.
 *
 * Every scene starts where the previous one ended (scroll position and cursor,
 * read from the previous scene's cached <id>.json), so joins line up. Scenes
 * should therefore end in a clean state (no drawer or tooltip open).
 *
 * CLI (process.argv):
 *   --scene a,b        re-record only these scenes, then re-join from cache
 *   --concat           re-join cached clips without recording anything
 *   (none)             record every scene
 *
 * @param {object} o
 * @param {string} o.name
 * @param {string} o.url
 * @param {Record<string,string>} [o.storage]   localStorage to seed (see fixture.mjs)
 * @param {{title:string, subtitle?:string}} o.title
 * @param {{title:string, subtitle?:string, url?:string}} o.end
 * @param {number} [o.titleMs]   title card hold
 * @param {number} [o.fadeSec]   crossfade length at each join
 * @param {{x:number,y:number}} [o.start]  cursor position for the first scene
 * @param {(t: Tutor, page: import('playwright').Page) => Promise<void>} o.ready
 * @param {{id:string, run:(t: Tutor, page: import('playwright').Page) => Promise<void>, tailMs?:number}[]} o.scenes
 * @param {object} [o.contextOptions]
 */
export async function recordScenes(o) {
    const fade = o.fadeSec ?? 0.5;
    const scenes = [
        {
            id: 'title',
            fresh: true,
            async before(t) { await t.card(o.title.title, o.title.subtitle, 0, { instant: true }); },
            async run(t) { await t.pause(o.titleMs ?? 2200); await t.hideCard(); await t.pause(300); },
        },
        ...o.scenes,
        {
            id: 'end',
            // The join's crossfade is the fade into the card.
            async before(t) { await t.card(o.end.title, o.end.subtitle, 0, { instant: true, url: o.end.url }); },
            async run(t) { await t.pause(3200); },
            tailMs: 0,
        },
    ];
    const ids = scenes.map((s) => s.id);
    const dir = path.join(OUT_DIR, 'raw', o.name, 'scenes');
    mkdirSync(dir, { recursive: true });

    const args = process.argv.slice(2);
    const sceneArg = args.includes('--scene') ? args[args.indexOf('--scene') + 1] : null;
    const concatOnly = args.includes('--concat');
    let wanted = concatOnly ? [] : sceneArg ? sceneArg.split(',') : ids;
    const unknown = wanted.filter((id) => !ids.includes(id));
    if (unknown.length) throw new Error(`Unknown scene(s): ${unknown.join(', ')}. Scenes: ${ids.join(', ')}`);

    if (wanted.length) {
        const browser = await chromium.launch();
        try {
            for (const scene of scenes) {
                if (!wanted.includes(scene.id)) continue;
                const i = ids.indexOf(scene.id);
                const prevJson = i > 0 ? path.join(dir, `${ids[i - 1]}.json`) : null;
                const startState = !scene.fresh && prevJson && existsSync(prevJson)
                    ? JSON.parse(readFileSync(prevJson, 'utf8')).end
                    : null;
                await recordScene(browser, o, scene, dir, startState);
            }
        } finally {
            await browser.close();
        }
    }

    const missing = ids.filter((id) => !existsSync(path.join(dir, `${id}.mp4`)));
    if (missing.length) throw new Error(`No cached clip for: ${missing.join(', ')}. Record them first (--scene ${missing.join(',')}).`);
    const clips = ids.map((id) => path.join(dir, `${id}.mp4`));
    const mp4 = path.join(OUT_DIR, `${o.name}${SUFFIX}.mp4`);
    const starts = concatClips(clips, mp4, fade);
    saveJoined(o.name);
    const s = statSync(mp4);
    console.log(`wrote ${mp4}  ${(s.size / 1e6).toFixed(2)} MB  ${probeDuration(mp4).toFixed(1)} s`);
    ids.forEach((id, k) => console.log(`  ${starts[k].toFixed(2)}s  scene ${id}`));
}

async function recordScene(browser, o, scene, dir, startState) {
    const rawDir = path.join(dir, `${scene.id}-raw`);
    rmSync(rawDir, { recursive: true, force: true });
    mkdirSync(rawDir, { recursive: true });
    console.log(`--- scene ${scene.id}${startState ? ` (from scrollY ${startState.scrollY})` : ''}`);

    const context = await browser.newContext({
        viewport: SIZE,
        deviceScaleFactor: 1,
        recordVideo: { dir: rawDir, size: SIZE },
        locale: 'en-CA',
        timezoneId: 'America/Toronto',
        ...o.contextOptions,
    });
    if (o.storage) await seedStorage(context, o.storage);
    const start = startState?.cursor ?? o.start ?? { x: SIZE.width * 0.62, y: SIZE.height * 0.55 };
    await addOverlay(context, { blank: true, start });

    const t0 = Date.now();
    const page = await context.newPage();
    const tutor = new Tutor(page, start);
    let wallTrim = 0;
    let ok = false;
    let appVersion = null;
    try {
        await page.goto(new URL(o.url, BASE_URL).href, { waitUntil: 'domcontentloaded' });
        await o.ready(tutor, page);
        appVersion = await readAppVersion(page); // under the black cover, before the scene's own actions
        if (startState?.scrollY) {
            // The sticky summary bar changes the layout once the page scrolls, so
            // the first jump can land a few px off: settle, then jump again.
            for (let k = 0; k < 3; k++) {
                await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), startState.scrollY);
                await sleep(350);
                if (await page.evaluate((y) => Math.abs(window.scrollY - y) < 1, startState.scrollY)) break;
            }
        }
        if (scene.before) await scene.before(tutor, page);
        await page.mouse.move(start.x, start.y);
        await sleep(500); // let hover states and scroll-driven layout settle while still covered
        await page.evaluate(() => window.__tut.unblank());
        wallTrim = (Date.now() - t0) / 1000;
        tutor.videoStart = Date.now();
        // Hold still first: the join's crossfade blends this with the previous
        // scene's last frame, which only lines up while nothing has moved yet.
        await sleep(scene.leadMs ?? 600);
        await scene.run(tutor, page);
        await sleep(scene.tailMs ?? 700); // the next join's crossfade eats into this
        const end = {
            cursor: { x: tutor.x, y: tutor.y },
            scrollY: await page.evaluate(() => Math.round(window.scrollY)),
        };
        writeFileSync(path.join(dir, `${scene.id}.json`), JSON.stringify({ end }, null, 2) + '\n');
        ok = true;
    } finally {
        if (!ok) await page.screenshot({ path: path.join(OUT_DIR, `${o.name}-${scene.id}-failure.png`) }).catch(() => {});
        const video = page.video();
        await context.close();
        if (ok && video) {
            const webm = await video.path();
            const black = blackEnd(webm, wallTrim);
            const trim = black ?? Math.max(0, wallTrim - 0.05);
            const clip = path.join(dir, `${scene.id}.mp4`);
            encodeClip(webm, clip, trim);
            saveScene(o.name, scene.id, versionRecord(appVersion));
            console.log(`scene ${scene.id}: ${probeDuration(clip).toFixed(1)} s (trimmed ${trim.toFixed(2)} s at ${black == null ? 'wall clock' : `end of black cover; wall clock said ${wallTrim.toFixed(2)}`})`);
            rmSync(rawDir, { recursive: true, force: true });
        }
    }
}

/**
 * End of the black cover in a scene's raw video, or null. The video opens on
 * a white about:blank and may carry other short dark runs, so take the black
 * run that ends nearest the wall-clock moment the cover was lifted.
 */
function blackEnd(webm, wallSec) {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-i', webm, '-vf', 'blackdetect=d=0.1:pic_th=0.98:pix_th=0.06', '-an', '-f', 'null', '-'], { encoding: 'utf8' });
    const runs = [...(r.stderr || '').matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => Number(m[2]));
    const near = runs.filter((end) => end < wallSec + 3).sort((a, b) => Math.abs(a - wallSec) - Math.abs(b - wallSec));
    return near.length ? near[0] + 0.02 : null; // + past the last covered frame
}

/** Trimmed, near-lossless intermediate clip (re-encoded once more when joined). */
function encodeClip(webm, mp4, trimSec) {
    const tmp = `${mp4}.tmp.mp4`;
    execFileSync('ffmpeg', [
        '-y', '-loglevel', 'error', '-i', webm, '-ss', trimSec.toFixed(3),
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '14', '-pix_fmt', 'yuv420p', '-r', FPS, '-an', tmp,
    ], { stdio: 'inherit' });
    renameSync(tmp, mp4);
}

/** Join clips with `fade`-second crossfades. Returns each clip's start time in the output. */
function concatClips(clips, mp4, fade) {
    const durs = clips.map(probeDuration);
    const inputs = clips.flatMap((c) => ['-i', c]);
    const starts = [0];
    // Normalise every clip to the output rate and a common timebase first:
    // xfade refuses mismatched inputs, and cached clips may predate a change
    // to the frame rate.
    let filter = clips.map((_, k) => `[${k}:v]fps=${FPS},settb=AVTB,setpts=PTS-STARTPTS[n${k}];`).join('');
    let last = '[n0]';
    let offset = 0;
    for (let k = 1; k < clips.length; k++) {
        offset += durs[k - 1] - fade;
        starts.push(offset);
        const out = k === clips.length - 1 ? '[v]' : `[x${k}]`;
        filter += `${last}[n${k}]xfade=transition=fade:duration=${fade}:offset=${offset.toFixed(3)}${out};`;
        last = out;
    }
    const tmp = `${mp4}.tmp.mp4`;
    execFileSync('ffmpeg', [
        '-y', '-loglevel', 'error', ...inputs,
        ...(clips.length > 1 ? ['-filter_complex', filter.replace(/;$/, ''), '-map', '[v]'] : []),
        '-c:v', 'libx264', '-preset', 'slow', '-crf', CRF,
        '-pix_fmt', 'yuv420p', '-r', FPS, '-movflags', '+faststart', '-an', tmp,
    ], { stdio: 'inherit' });
    renameSync(tmp, mp4);
    return starts;
}

export function toMp4(webm, mp4, trimSec = 0) {
    const tmp = `${mp4}.tmp.mp4`;
    execFileSync('ffmpeg', [
        '-y', '-loglevel', 'error',
        '-i', webm,
        '-ss', trimSec.toFixed(3),            // after -i: frame-accurate trim of the blank load
        '-c:v', 'libx264', '-preset', 'slow', '-crf', CRF,
        '-pix_fmt', 'yuv420p', '-r', FPS,
        '-movflags', '+faststart', '-an',
        tmp,
    ], { stdio: 'inherit' });
    renameSync(tmp, mp4);
}

export function probeDuration(file) {
    const out = execFileSync('ffprobe', [
        '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file,
    ]).toString();
    return Number(out.trim());
}
