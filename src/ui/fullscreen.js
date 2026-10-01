// Full screen and Zen mode.
//
//  - Fullscreen API with feature detection (and the webkit-prefixed variant). Where a page cannot go full screen
//    (iPhone Safari), the button explains "Add to Home Screen" (see public/manifest.webmanifest) and falls
//    back to hiding the interface (Zen), so the tank still gets the whole screen.
//  - Shift+F toggles full screen (F11 itself is the browser's and cannot be intercepted); Escape leaves Zen.
//  - Zen hides all interface except a small exit button in the top right corner.
import { signal } from '@preact/signals';
import { toast } from './store.js';
import './zen.css';

export const DISPLAY = signal({ fs: false, zen: false });

const root = () => document.documentElement;
export const fullscreenSupported = () => !!(root().requestFullscreen || root().webkitRequestFullscreen);
export const fullscreenElement = () => document.fullscreenElement ?? document.webkitFullscreenElement ?? null;
export const isStandalone = () => window.matchMedia?.('(display-mode: fullscreen), (display-mode: standalone)').matches || window.navigator.standalone === true;

function sync() {
  const next = { fs: !!fullscreenElement() || isStandalone(), zen: document.body.classList.contains('zen') };
  const cur = DISPLAY.value;
  if (cur.fs !== next.fs || cur.zen !== next.zen) DISPLAY.value = next;
  // The canvas follows the viewport; make sure the renderer resizes after the browser finished animating.
  window.dispatchEvent(new Event('resize'));
}

export async function toggleFullscreen() {
  try {
    if (fullscreenElement()) {
      await (document.exitFullscreen ?? document.webkitExitFullscreen).call(document);
    } else if (fullscreenSupported()) {
      await (root().requestFullscreen ?? root().webkitRequestFullscreen).call(root(), { navigationUI: 'hide' });
      try { await screen.orientation?.lock?.('landscape').catch(() => {}); } catch { /* not allowed */ }
    } else {
      // No Fullscreen API (iPhone Safari): hide the interface and explain how to get a true full screen.
      setZen(true);
      toast('Full screen is not available in this browser. Use Share, then "Add to Home Screen", to open the game full screen.', 'good');
    }
  } catch (e) {
    toast('The browser refused full screen. Try the button again.', 'bad');
  }
  sync();
}

export function setZen(on) {
  document.body.classList.toggle('zen', !!on);
  sync();
}
export const toggleZen = () => setZen(!document.body.classList.contains('zen'));

function init() {
  if (window.__fsInit) return;
  window.__fsInit = true;
  const btn = document.createElement('button');
  btn.className = 'zen-exit'; btn.type = 'button'; btn.title = 'Show the interface (Esc)'; btn.setAttribute('aria-label', 'Leave Zen mode');
  btn.textContent = '×';
  btn.addEventListener('click', () => setZen(false));
  document.body.appendChild(btn);
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
  window.visualViewport?.addEventListener('resize', () => window.dispatchEvent(new Event('resize')));
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'Escape' && document.body.classList.contains('zen')) { setZen(false); e.stopPropagation(); return; }
    if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'F' || e.code === 'KeyF')) {
      e.preventDefault(); e.stopPropagation();
      toggleFullscreen();
    } else if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'Z' || e.code === 'KeyZ')) {
      e.preventDefault(); e.stopPropagation();
      toggleZen();
    }
  }, true);
  sync();
}
if (typeof document !== 'undefined') { if (document.body) init(); else addEventListener('DOMContentLoaded', init); }
