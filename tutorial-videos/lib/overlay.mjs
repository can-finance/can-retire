// In-page overlay layer for tutorial videos: fake cursor, click ripple, target
// highlight, caption pill, and full-screen title/end cards. Injected with
// context.addInitScript, so it survives navigations and never touches src/.
//
// Everything lives under one fixed, pointer-events:none root at max z-index,
// so it sits above the app's own overlays (the onboarding dialog is z-[200]).

/** Runs inside the page. Must be self-contained (it is serialised). */
function installOverlay(opts) {
    if (window.__tut) return;
    const accent = opts.accent || '#0284c7';

    const css = `
#tut-root, #tut-root * { box-sizing: border-box; }
#tut-root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
#tut-cursor { position: fixed; left: 0; top: 0; width: 28px; height: 28px; will-change: transform;
  transform: translate(var(--x, -100px), var(--y, -100px)); }
#tut-cursor svg { width: 28px; height: 28px; transform-origin: 3px 2px; transition: transform 110ms ease-out;
  filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
#tut-cursor.press svg { transform: scale(.8); }
.tut-ripple { position: fixed; width: 60px; height: 60px; margin: -30px 0 0 -30px; border-radius: 50%;
  border: 3px solid ${accent}; background: ${accent}33; animation: tut-ripple 650ms ease-out forwards; }
@keyframes tut-ripple { from { transform: scale(.15); opacity: .95; } to { transform: scale(1.25); opacity: 0; } }
.tut-hl { position: fixed; border-radius: 12px; box-shadow: 0 0 0 3px ${accent}cc, 0 0 18px 4px ${accent}55;
  opacity: 0; transition: opacity 220ms ease; }
.tut-hl.on { opacity: 1; }
#tut-caption { position: fixed; left: 50%; bottom: 34px; transform: translate(-50%, 8px); max-width: calc(100vw - 60px);
  white-space: nowrap; padding: 12px 28px; border-radius: 999px; background: rgba(15,23,42,.84); color: #fff; font-size: 22px;
  font-weight: 500; line-height: 1.35; text-align: center; letter-spacing: .01em; opacity: 0;
  box-shadow: 0 10px 30px rgba(0,0,0,.25); transition: opacity 350ms ease, transform 350ms ease; }
#tut-caption.on { opacity: 1; transform: translate(-50%, 0); }
#tut-caption.top { bottom: auto; top: 128px; }
#tut-caption.left { left: 352px; max-width: 680px; white-space: normal; }
#tut-caption.right { left: 436px; right: 10px; width: fit-content; max-width: none; margin: 0 auto; transform: translateY(8px); }
#tut-caption.right.on { transform: translateY(0); }
#tut-blank { position: fixed; inset: 0; background: #000; }
#tut-card { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 14px; color: #fff; text-align: center; opacity: 0;
  background: radial-gradient(ellipse at 30% 20%, #0369a1 0%, #0c4a6e 55%, #082f49 100%);
  transition: opacity 500ms ease; }
#tut-card.on { opacity: 1; }
#tut-card .t { font-size: 52px; font-weight: 800; letter-spacing: -.02em; }
#tut-card .s { font-size: 24px; font-weight: 500; opacity: .85; }
#tut-card .u { margin-top: 18px; font-size: 22px; font-weight: 600; letter-spacing: .02em; color: #7dd3fc; }
#tut-card .u:empty { display: none; }
`;

    const cursorSvg = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
<path d="M3 2 L3 19.5 L7.6 15.4 L10.6 22 L13.6 20.7 L10.7 14.2 L17 14.2 Z"
 fill="#fff" stroke="#0f172a" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

    const state = { root: null, cursor: null, caption: null, card: null };

    function mount() {
        if (state.root) return;
        const style = document.createElement('style');
        style.textContent = css;
        document.documentElement.appendChild(style);
        const root = document.createElement('div');
        root.id = 'tut-root';
        root.innerHTML = `<div id="tut-cursor">${cursorSvg}</div><div id="tut-caption"></div>
<div id="tut-card"><div class="t"></div><div class="s"></div><div class="u"></div></div>${opts.blank ? '<div id="tut-blank"></div>' : ''}`;
        document.documentElement.appendChild(root);
        state.root = root;
        state.cursor = root.querySelector('#tut-cursor');
        state.caption = root.querySelector('#tut-caption');
        state.card = root.querySelector('#tut-card');
        const p = opts.start || { x: -100, y: -100 };
        setPos(p.x, p.y);
        // Title card only on the first document of the session, not after a navigation.
        let firstDoc = true;
        try {
            firstDoc = !sessionStorage.getItem('tut-title-shown');
            sessionStorage.setItem('tut-title-shown', '1');
        } catch { /* storage blocked: show it anyway */ }
        if (opts.titleCard && firstDoc) showCard(opts.titleCard.title, opts.titleCard.subtitle, true);
    }

    function setPos(x, y) {
        state.cursor.style.setProperty('--x', `${x}px`);
        state.cursor.style.setProperty('--y', `${y}px`);
    }

    function showCard(title, subtitle, instant, url) {
        mount();
        state.card.querySelector('.t').textContent = title || '';
        state.card.querySelector('.s').textContent = subtitle || '';
        state.card.querySelector('.u').textContent = url || '';
        if (instant) {
            state.card.style.transition = 'none';
            state.card.classList.add('on');
            void state.card.offsetWidth;
            state.card.style.transition = '';
        } else {
            state.card.classList.add('on');
        }
    }

    window.addEventListener('mousemove', (e) => { if (state.cursor) setPos(e.clientX, e.clientY); },
        { capture: true, passive: true });

    window.__tut = {
        mount,
        press(down) { mount(); state.cursor.classList.toggle('press', down); },
        ripple(x, y) {
            mount();
            const r = document.createElement('div');
            r.className = 'tut-ripple';
            r.style.left = `${x}px`;
            r.style.top = `${y}px`;
            state.root.insertBefore(r, state.cursor);
            setTimeout(() => r.remove(), 700);
        },
        highlight(rect, ms = 750, pad = 5) {
            mount();
            const h = document.createElement('div');
            h.className = 'tut-hl';
            Object.assign(h.style, {
                left: `${rect.x - pad}px`, top: `${rect.y - pad}px`,
                width: `${rect.width + pad * 2}px`, height: `${rect.height + pad * 2}px`,
            });
            state.root.insertBefore(h, state.cursor);
            requestAnimationFrame(() => h.classList.add('on'));
            // Tie the frame to the element under it: when a click closes a
            // dialog or swaps the view, drop the frame at once rather than
            // leave it outlining whatever loads in the button's place.
            const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            const start = target && target.getBoundingClientRect();
            const gone = () => {
                if (!target || !target.isConnected) return true;
                const r = target.getBoundingClientRect();
                return r.width === 0 || Math.abs(r.x - start.x) > 2 || Math.abs(r.y - start.y) > 2;
            };
            const t0 = performance.now();
            const watch = () => {
                if (!h.isConnected) return;
                if (gone()) { h.remove(); return; }
                if (performance.now() - t0 < ms) requestAnimationFrame(watch);
            };
            requestAnimationFrame(watch);
            setTimeout(() => h.classList.remove('on'), ms);
            setTimeout(() => h.remove(), ms + 300);
        },
        // `pos`: 'bottom' (default), 'top' (over the dashboard's sticky summary
        // bar), 'left' (centred over the left half, beside a right-hand drawer), or
        // 'right' (bottom, centred on the dashboard's chart column, clear of the inputs).
        caption(text, pos) {
            mount();
            if (!text) { state.caption.classList.remove('on'); return; }
            state.caption.textContent = text;
            state.caption.classList.toggle('top', pos === 'top');
            state.caption.classList.toggle('left', pos === 'left');
            // 'right' is positioned without the -50% centring transform, so
            // switching into or out of it would slide the pill across the
            // screen: apply that switch with transitions off.
            const c = state.caption;
            if (c.classList.contains('right') !== (pos === 'right')) {
                c.style.transition = 'none';
                c.classList.toggle('right', pos === 'right');
                void c.offsetWidth;
                c.style.transition = '';
            }
            c.classList.add('on');
        },
        card(title, subtitle, url, instant) { showCard(title, subtitle, !!instant, url); },
        // Scene mode: lift the black cover that hides the page load.
        unblank() { mount(); const b = state.root.querySelector('#tut-blank'); if (b) b.remove(); },
        hideCard() { mount(); state.card.classList.remove('on'); },
        cardVisible() { return !!state.card && state.card.classList.contains('on'); },
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount, { once: true });
    } else {
        mount();
    }
}

/**
 * Register the overlay on a browser context. `titleCard` is shown from the very
 * first paint of the first document, hiding the blank page load. `blank: true`
 * (scene mode) instead covers the page in solid black until `__tut.unblank()`;
 * the recorder finds where the black ends and trims the clip there.
 */
export async function addOverlay(context, opts = {}) {
    await context.addInitScript(installOverlay, opts);
}
