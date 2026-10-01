// Measures how much of the screen the interface covers and tells the camera,
// so the tank stays centred (and framed) in the free area as panels open.

import { effect } from '@preact/signals';
import { S } from './store.js';

export function bindLayout(game) {
  let raf = 0;
  const measure = () => {
    raf = 0;
    const W = innerWidth, H = innerHeight;
    const q = (sel) => { const el = document.querySelector(sel); const b = el?.getBoundingClientRect(); return b && b.width > 0 ? b : null; };
    let l = 0, r = 0, t = 0, b = 0;
    if (S.screen.value !== 'play' || S.photo.value) { game.rig.setInset(0, 0, 0, 0, W, H); return; }
    if (S.kids.value) {
      const top = q('.kids-top'), bot = q('.kids-bottom');
      t = (top?.bottom ?? 90) + 6;
      b = bot ? Math.max(70, H - bot.top + 6) : 90;
      game.rig.setInset(0, 0, t, b, W, H);
      return;
    }
    if (S.compact.value) {
      // Phones: the pill and chip on top, the dock at the very bottom, the tool rail down the left edge, the options sheet above the dock.
      const top = q('.pill'), rail = q('.rail'), opts = q('.opts'), dock = q('.dock2');
      t = (top?.bottom ?? 50) + 4;
      b = dock ? H - dock.top + 6 : 70;
      if (opts) b = Math.max(b, H - opts.top + 4);
      if (rail) l = rail.right + 4;
    } else {
      // Wide screens: the tool rail and options on the left, the status drawer (when open) on the right.
      const rail = q('.rail'), opts = q('.opts'), drawer = q('.sdrawer');
      l = (opts ?? rail)?.right ?? 0;
      r = drawer ? W - drawer.left : 0;
      t = 58; b = 66;
    }
    game.rig.setInset(l, r, t, b, W, H);
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => setTimeout(measure, 30)); };
  effect(() => { S.left.value; S.right.value; S.tool.value; S.compact.value; S.screen.value; S.photo.value; S.modal.value; S.kids.value; schedule(); });
  addEventListener('resize', schedule);
  game.events.on('tank', schedule);
  return schedule;
}
