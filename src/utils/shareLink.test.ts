import { describe, it, expect } from 'vitest';
import { parseStartHash, buildStartHash, DEFAULT_SHARED_PLAN_NAME } from './shareLink';

describe('parseStartHash', () => {
    it('returns null for non-start hashes', () => {
        expect(parseStartHash('')).toBeNull();
        expect(parseStartHash('#other=1')).toBeNull();
    });

    it('legacy link without a name falls back to the default', () => {
        expect(parseStartHash('#start=abc123')).toEqual({ compressed: 'abc123', name: DEFAULT_SHARED_PLAN_NAME });
    });

    it('reads the name and keeps the payload intact', () => {
        const hash = buildStartHash('N4Ig-+$abc', 'Retire at 58');
        expect(parseStartHash(hash)).toEqual({ compressed: 'N4Ig-+$abc', name: 'Retire at 58' });
    });

    it('round-trips special characters', () => {
        expect(parseStartHash(buildStartHash('x', 'A & B = 100%'))?.name).toBe('A & B = 100%');
    });

    it('malformed percent-encoding falls back', () => {
        expect(parseStartHash('#start=abc&name=%E0%A4%A')?.name).toBe(DEFAULT_SHARED_PLAN_NAME);
    });

    it('trims and collapses whitespace', () => {
        expect(parseStartHash('#start=abc&name=%20%20Retire%20%20%20at%0A58%20')?.name).toBe('Retire at 58');
    });

    it('caps overlong names', () => {
        const name = parseStartHash(`#start=abc&name=${'a'.repeat(500)}`)!.name;
        expect(name).toHaveLength(60);
    });

    it('empty or blank name falls back', () => {
        expect(parseStartHash('#start=abc&name=')?.name).toBe(DEFAULT_SHARED_PLAN_NAME);
        expect(parseStartHash('#start=abc&name=%20%20')?.name).toBe(DEFAULT_SHARED_PLAN_NAME);
    });

    it('ignores unrelated params', () => {
        expect(parseStartHash('#start=abc&foo=1')).toEqual({ compressed: 'abc', name: DEFAULT_SHARED_PLAN_NAME });
    });
});
