// `#start=<lz>[&name=<encodeURIComponent(name)>]` share-link hash handling.
// LZString.compressToEncodedURIComponent output never contains '&', so the
// first '&' reliably separates the payload from the optional name.

export const DEFAULT_SHARED_PLAN_NAME = 'Shared plan';
const MAX_SHARED_NAME_LENGTH = 60;
const START_PREFIX = '#start=';

export interface ParsedStartHash {
    compressed: string;
    name: string;
}

// Untrusted input: decode defensively, collapse whitespace, cap length.
function cleanSharedName(raw: string): string {
    let decoded: string;
    try {
        decoded = decodeURIComponent(raw);
    } catch {
        return DEFAULT_SHARED_PLAN_NAME;
    }
    const name = decoded.replace(/\s+/g, ' ').trim().slice(0, MAX_SHARED_NAME_LENGTH).trim();
    return name || DEFAULT_SHARED_PLAN_NAME;
}

// Returns null when the hash is not a `#start=` link.
export function parseStartHash(hash: string): ParsedStartHash | null {
    if (!hash.startsWith(START_PREFIX)) return null;
    const rest = hash.slice(START_PREFIX.length);
    const amp = rest.indexOf('&');
    if (amp === -1) return { compressed: rest, name: DEFAULT_SHARED_PLAN_NAME };
    const compressed = rest.slice(0, amp);
    const m = /(?:^|&)name=([^&]*)/.exec(rest.slice(amp + 1));
    return { compressed, name: m ? cleanSharedName(m[1]) : DEFAULT_SHARED_PLAN_NAME };
}

export function buildStartHash(compressed: string, name?: string): string {
    return name ? `${START_PREFIX}${compressed}&name=${encodeURIComponent(name)}` : `${START_PREFIX}${compressed}`;
}
