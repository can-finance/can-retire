// Extract check frames from a recorded tutorial into out/frames/.
// Usage: node frames.mjs <name> [count]          evenly spaced frames (default 12)
//        node frames.mjs <name> 3.2,7.5,12       frames at these seconds
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { OUT_DIR, probeDuration } from './lib/recorder.mjs';

const name = process.argv[2] || 'create-a-plan';
const arg = process.argv[3] || '12';
const mp4 = path.join(OUT_DIR, `${name}.mp4`);
const dir = path.join(OUT_DIR, 'frames');
mkdirSync(dir, { recursive: true });

let times;
if (arg.includes(',') || arg.includes('.')) {
    times = arg.split(',').map(Number);
} else {
    const count = Number(arg);
    const dur = probeDuration(mp4);
    times = Array.from({ length: count }, (_, i) => (dur * (i + 0.5)) / count);
    for (const f of readdirSync(dir)) if (f.startsWith(`${name}-`)) rmSync(path.join(dir, f));
}

times.forEach((at, i) => {
    const file = path.join(dir, `${name}-${String(i + 1).padStart(2, '0')}-${at.toFixed(1)}s.png`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', at.toFixed(2), '-i', mp4, '-frames:v', '1', file]);
    console.log(file);
});
