import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Resolve paths relative to this test file (not process.cwd()) so the test
// works the same whether vitest runs from the repo root (Docker) or elsewhere.
const here = path.dirname(fileURLToPath(import.meta.url));

const appLayoutPath = path.join(here, '../layout/AppLayout.tsx');
const introPath = path.join(here, 'OnboardingIntro.tsx');
const closingPath = path.join(here, 'OnboardingClosing.tsx');

const appLayoutSrc = readFileSync(appLayoutPath, 'utf-8');
const introSrc = readFileSync(introPath, 'utf-8');
const closingSrc = readFileSync(closingPath, 'utf-8');

// Guards the "Guided Setup" button label against copy drift: AppLayout owns
// the one literal string (EDIT_PLAN_LABEL); OnboardingIntro/OnboardingClosing
// must reference that constant rather than re-hardcoding their own copy of it.
describe('EDIT_PLAN_LABEL copy contract', () => {
    it('AppLayout defines the constant and uses it in the button', () => {
        expect(appLayoutSrc).toContain('export const EDIT_PLAN_LABEL');
        expect(appLayoutSrc).toContain('{EDIT_PLAN_LABEL}');
    });

    it('OnboardingIntro references the constant', () => {
        expect(introSrc).toContain('EDIT_PLAN_LABEL');
    });

    it('OnboardingClosing references the constant', () => {
        expect(closingSrc).toContain('EDIT_PLAN_LABEL');
    });

    it('the literal label string appears only in AppLayout.tsx (its definition)', () => {
        expect(appLayoutSrc).toContain("'Guided Setup'");
        expect(introSrc).not.toContain('Guided Setup');
        expect(closingSrc).not.toContain('Guided Setup');
    });
});
