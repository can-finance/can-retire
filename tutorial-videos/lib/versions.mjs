// Which app version each video (and each scene) was recorded against.
//
// versions.json (committed) is read-modify-written after every take: single-take
// videos get one record at top level, scene videos get `scenes.<id>` records plus
// `joined` (time of the last join). See README, "Which app version each video shows".

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const VERSIONS_FILE = path.resolve(HERE, '..', 'versions.json');

/** Local-time ISO timestamp with offset, e.g. 2026-10-14T10:32:00-04:00 (offset of the container's TZ). */
export function nowIso(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    const off = -d.getTimezoneOffset();
    const sign = off < 0 ? '-' : '+';
    const a = Math.abs(off);
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${p(Math.floor(a / 60))}:${p(a % 60)}`;
}

/**
 * Read the app version from the footer ("Version x.y.z"). Polls briefly since
 * the footer only exists once the app has rendered. Null (with a warning) if
 * not found: never fails a recording.
 * @param {import('playwright').Page} page
 */
export async function readAppVersion(page) {
    try {
        await page.waitForFunction(() => /Version\s+\d/.test(document.body.textContent || ''), null, { timeout: 5000 });
        const v = await page.evaluate(() => {
            const m = (document.body.textContent || '').match(/Version\s+(\d[^\s·]*)/);
            return m ? m[1] : null;
        });
        if (v) return v;
    } catch { /* fall through to the warning */ }
    console.warn('warning: could not read the app version from the page footer; recording appVersion as null');
    return null;
}

/**
 * The version record for a take that just happened. The commit comes from env
 * (the container can't see the host's git): use record.ps1 to pass it.
 * @param {string|null} appVersion
 */
export function versionRecord(appVersion) {
    const commit = process.env.TUT_APP_COMMIT || null;
    const d = process.env.TUT_APP_DIRTY;
    if (!commit) {
        console.warn('warning: TUT_APP_COMMIT is not set, so appCommit is recorded as null. Run via tutorial-videos/record.ps1 to pass the main checkout\'s commit.');
    }
    return {
        appVersion,
        appCommit: commit,
        dirty: d == null || d === '' ? null : d === '1',
        recordedAt: nowIso(),
    };
}

export function readVersions() {
    if (!existsSync(VERSIONS_FILE)) return {};
    return JSON.parse(readFileSync(VERSIONS_FILE, 'utf8'));
}

function write(all) {
    writeFileSync(VERSIONS_FILE, JSON.stringify(all, null, 2) + '\n');
}

/** Stable key order for a scene video's entry: joined, scenes, then anything else. */
function ordered({ joined, scenes, ...rest }) {
    return { ...(joined ? { joined } : {}), scenes: scenes || {}, ...rest };
}

/** Record a single-take video's version. */
export function saveTake(name, rec) {
    const all = readVersions();
    all[name] = rec;
    write(all);
}

/** Record one scene's version, leaving the other scenes and `joined` alone. */
export function saveScene(name, id, rec) {
    const all = readVersions();
    const entry = all[name] || {};
    all[name] = ordered({ ...entry, scenes: { ...(entry.scenes || {}), [id]: rec } });
    write(all);
}

/** Stamp the time of the last join. */
export function saveJoined(name) {
    const all = readVersions();
    all[name] = ordered({ ...(all[name] || {}), joined: nowIso() });
    write(all);
}
