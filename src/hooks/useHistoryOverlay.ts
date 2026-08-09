import { useCallback, useEffect, useReducer, useRef } from 'react';

/**
 * Makes a full-screen "view" that is really just React state behave like a
 * place the browser's Back button can leave.
 *
 * The dashboard's Compare / Optimizer / Year Audit views render over (or
 * instead of) the dashboard without navigating, so Back used to leave the site
 * entirely and discard where the user was. This hook borrows one history entry
 * per open overlay:
 *
 *   - opening pushes an entry (same URL — `pushState` is called WITHOUT a url
 *     argument, so the current path, search and hash are preserved verbatim);
 *   - a real Back pops it and closes the overlay, landing back on the dashboard;
 *   - closing by an in-app control instead consumes the entry we pushed
 *     (`history.go(-1)`), so the stack never accumulates dead entries that make
 *     the first Back press look inert.
 *
 * `close` is a request rather than a command: a caller may respond by raising a
 * confirmation and staying open (the onboarding wizard's "Discard your setup?").
 * Back has already spent the entry by then, so the hook borrows a fresh one on
 * the next render whenever it finds itself open with no entry of its own.
 *
 * Multiple overlays open at once form a LIFO stack: Back closes the topmost
 * only. The stack and the pushed-entry count are MODULE state, not per-hook
 * state, because the browser history is a single shared resource — two hook
 * instances each keeping their own idea of "how deep am I" would fight.
 */

// Marker written into the state of every entry this module pushes. Nothing
// reads it at runtime; it exists so a history entry we own is identifiable in
// devtools and in tests.
const OVERLAY_STATE_KEY = '__overlay';

interface OverlayEntry {
    name: string;
    /** Closes the overlay. Also marks the hook instance's entry as already consumed. */
    close: () => void;
}

// Overlays currently open, oldest first — the stack Back walks down.
const stack: OverlayEntry[] = [];

// How many history entries we have actually pushed and not yet unwound. This is
// the ONLY thing reconciled against `stack.length`; the entries themselves are
// interchangeable (they all carry the same URL), so only the depth matters.
let pushed = 0;

// Traversals we requested ourselves and whose `popstate` has not arrived yet. A
// programmatic `history.go(-1)` fires `popstate` exactly like a Back press, so
// without this counter the resulting event would close a second overlay (or,
// for a single overlay, immediately re-run the whole close path).
let pendingTraversals = 0;

let syncScheduled = false;
let listening = false;

// Listen only while we have something at stake: an open overlay, an entry of
// ours still sitting in the history, or a traversal we're waiting on. When all
// three are zero the listener comes off — that is the "clean up on unmount"
// half of the contract, since a component unmounting while open unwinds its
// entry first (see the effect cleanup below).
function syncListener() {
    const needed = stack.length > 0 || pushed > 0 || pendingTraversals > 0;
    if (needed === listening) return;
    listening = needed;
    if (needed) window.addEventListener('popstate', onPopState);
    else window.removeEventListener('popstate', onPopState);
}

function onPopState() {
    if (pendingTraversals > 0) {
        // Our own `history.go(-1)` landing. The overlay is already closed and
        // `pushed` was already decremented when we issued it — do NOT close
        // anything here, or an in-app close would cascade down the stack.
        pendingTraversals--;
        scheduleSync();
        return;
    }
    // A genuine Back press. The browser has already dropped the entry, so
    // account for it here rather than unwinding it again in the effect cleanup.
    if (pushed > 0) pushed--;
    const top = stack.pop();
    syncListener();
    // `close()` nulls the owning hook's entry ref before flipping React state,
    // so the cleanup that follows sees "already consumed" and stays put.
    //
    // Note that close() is a REQUEST, not a guarantee: the onboarding wizard
    // answers it by raising a "Discard your setup?" confirmation and staying
    // open. The entry is spent either way, so the hook re-borrows one on the
    // render that follows — see the re-arm effect below.
    top?.close();
}

// All history mutation is deferred to a microtask and expressed as "make the
// pushed depth equal the number of open overlays". Doing it that way rather
// than push-on-open / back-on-close makes the transient states React puts us
// through harmless:
//
//   - StrictMode double-invokes mount effects (mount → unmount → mount). As
//     discrete operations that would be push, back, push — with the queued back
//     landing AFTER the second push and leaving the overlay open on top of a
//     history stack that no longer has an entry for it. Reconciled, the three
//     effect runs net out to a single push.
//   - Closing one overlay and opening another in the same commit needs no
//     history operation at all: the depth is unchanged.
function scheduleSync() {
    if (syncScheduled) return;
    syncScheduled = true;
    queueMicrotask(runSync);
}

function runSync() {
    syncScheduled = false;
    // A traversal we asked for is still in flight, so the current history
    // position is not yet what we think it is. `history.go` resolves its delta
    // when the traversal task runs, so pushing now would be undone by it.
    // onPopState re-schedules us once the traversal lands.
    if (pendingTraversals > 0) return;

    try {
        while (pushed < stack.length) {
            window.history.pushState({ [OVERLAY_STATE_KEY]: stack[pushed].name }, '');
            pushed++;
        }
        if (pushed > stack.length) {
            const n = pushed - stack.length;
            pushed = stack.length;
            pendingTraversals += n;
            syncListener();
            window.history.go(-n);
        }
    } catch (error) {
        console.error('useHistoryOverlay: history update failed', error);
    }
    syncListener();
}

/**
 * @param isOpen  whether the overlay is currently displayed.
 * @param close   closes it. Called on Back; may be a fresh closure each render.
 * @param name    short identifier, recorded on the pushed history entry.
 */
export function useHistoryOverlay(isOpen: boolean, close: () => void, name: string) {
    // Callers pass inline arrow functions, so `close` has a new identity every
    // render. Mirror it into a ref (synced by its own effect, declared first so
    // it runs before the effect below on every commit) instead of listing it as
    // a dependency, which would tear the overlay's history entry down and
    // rebuild it on each keystroke behind it.
    const closeRef = useRef(close);
    useEffect(() => {
        closeRef.current = close;
    });

    // Our entry while it is live; null once Back has consumed it.
    const entryRef = useRef<OverlayEntry | null>(null);

    // Dispatched when Back spends our entry. Nothing reads the count — it
    // exists only to force a render, so the re-arm effect below gets a chance
    // to notice that the overlay refused to close. A refused close otherwise
    // need not re-render at all (the wizard's `setConfirmDiscard(true)` is a
    // no-op when the confirmation is already up), and the overlay would then
    // be left sitting on a history stack with no entry of its own.
    const [, noteEntryConsumed] = useReducer((n: number) => n + 1, 0);

    const borrowEntry = useCallback(() => {
        const entry: OverlayEntry = {
            name,
            close: () => {
                entryRef.current = null;
                closeRef.current();
                noteEntryConsumed();
            },
        };
        entryRef.current = entry;
        stack.push(entry);
        scheduleSync();
    }, [name]);

    useEffect(() => {
        if (!isOpen) return;
        borrowEntry();

        return () => {
            const mine = entryRef.current;
            entryRef.current = null;
            // Null means Back already popped us; the history entry is gone and
            // there is nothing to unwind. Otherwise this is an in-app close (or
            // an unmount while open) and the entry has to be handed back.
            if (mine) {
                const i = stack.lastIndexOf(mine);
                if (i !== -1) stack.splice(i, 1);
            }
            scheduleSync();
        };
    }, [isOpen, borrowEntry]);

    // Re-arm. Runs after EVERY render (deliberately no dependency array) and is
    // a no-op in all but one situation: Back consumed our entry, but the caller
    // declined to close — it raised a confirmation instead. Without this the
    // overlay would still be on screen with nothing left to catch the next Back
    // press, and that press would leave the site. Declared AFTER the effect
    // above so a fresh mount is always armed by that one first, leaving this a
    // no-op there.
    useEffect(() => {
        if (isOpen && !entryRef.current) borrowEntry();
    });
}
