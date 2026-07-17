import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const srcRoot = path.join(repoRoot, 'src');

/** Pull the shade numbers defined inside the `brand: { ... }` block of tailwind.config.js. */
function extractBrandShades(configText: string): Set<number> {
    const brandBlockMatch = configText.match(/brand:\s*\{([^}]*)\}/s);
    if (!brandBlockMatch) {
        throw new Error('Could not locate a `brand: { ... }` color block in tailwind.config.js');
    }
    const shades = new Set<number>();
    const shadeRe = /(\d+):\s*'#/g;
    let m: RegExpExecArray | null;
    while ((m = shadeRe.exec(brandBlockMatch[1])) !== null) {
        shades.add(Number(m[1]));
    }
    return shades;
}

/** Recursively list .ts/.tsx source files under `dir`, excluding test files. */
function listSourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
            out.push(...listSourceFiles(full));
        } else if (/\.(ts|tsx)$/.test(entry) && !entry.includes('.test.')) {
            out.push(full);
        }
    }
    return out;
}

// Matches Tailwind utility classes like `bg-brand-400`, `hover:border-brand-500`,
// `border-l-brand-400`, etc. -- must stay in sync with the property list this
// test cares about (color-bearing utilities that take a `brand-NNN` value).
const BRAND_CLASS_RE =
    /(?:^|[\s"'`:])(?:bg|text|border|border-l|border-t|border-r|border-b|ring|from|to|via|fill|stroke)-brand-(\d+)/g;

// Fences the "invisible progress dots" class of bug: a component references a
// bg-brand-NNN shade that doesn't exist in tailwind.config.js, so Tailwind
// emits no CSS for it and the element renders invisible/unstyled.
describe('tailwind brand palette completeness', () => {
    const configText = readFileSync(path.join(repoRoot, 'tailwind.config.js'), 'utf-8');
    const definedShades = extractBrandShades(configText);

    it('sanity check: the brand block extraction actually found shades', () => {
        expect(definedShades.size).toBeGreaterThan(0);
    });

    it('every brand-NNN utility class used under src/ is defined in tailwind.config.js', () => {
        const files = listSourceFiles(srcRoot);
        const undefinedUses: string[] = [];

        for (const file of files) {
            const text = readFileSync(file, 'utf-8');
            const reportedInFile = new Set<number>();
            BRAND_CLASS_RE.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = BRAND_CLASS_RE.exec(text)) !== null) {
                const shade = Number(m[1]);
                if (!definedShades.has(shade) && !reportedInFile.has(shade)) {
                    reportedInFile.add(shade);
                    undefinedUses.push(`${path.relative(repoRoot, file)}: brand-${shade}`);
                }
            }
        }

        expect(undefinedUses, `Undefined brand shades referenced:\n${undefinedUses.join('\n')}`).toEqual([]);
    });
});
