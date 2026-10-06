// Keeps the world running while the tab is hidden. A browser draws no frames for a hidden tab, and the game's clock is its frame loop, so
// the animals stood still until you came back (and a long run did not run while you looked at something else). While the page is hidden
// a timer in a worker (a worker's timer is not slowed the way the page's own is) calls this, which steps the world the way a frame does,
// in small pieces, for the real time that has passed: the animals, the world clock, and the lab's own hooks (dots, radar, trail). Nothing is
// drawn. When the tab is shown again the frame loop takes over from where this left off. A phone's browser suspends a hidden page
// altogether: nothing can run there until it is shown.

import { MINUTES_PER_SECOND } from '../sim/tank.js';
import { L } from './state.js';

const PIECE = 1 / 30;      // s of animal time per step (what a frame gives at 30 fps)
const MAX = 10;            // s of catching up in one go: a tab that was frozen for an hour does not run an hour at once

export function createBackground(game) {
  let worker = null, url = null, last = 0, lastFrame = performance.now();
  // A real frame ran just now: the page is not really hidden (or the browser still draws it): the frame loop has the clock.
  const frame = game.frame.bind(game);
  game.frame = (dt) => { lastFrame = performance.now(); return frame(dt); };

  function tick() {
    const W = game.world;
    const now = performance.now();
    let el = Math.min(MAX, (now - last) / 1000);
    last = now;
    if (!W || !L.ready.value || now - lastFrame < 250) return;
    const speed = game.rate;
    if (!(speed > 0)) return;
    while (el > 1e-6) {
      const dt = Math.min(PIECE, el);
      el -= dt;
      W.sim.step(dt * speed * MINUTES_PER_SECOND);
      W.animals.move(dt * Math.min(speed, 4));
      for (const f of game.frameHooks) f(dt);
    }
    L.hiddenRun.value += 1;
  }

  function start() {
    if (worker || !L.background.value) return;
    last = performance.now();
    try {
      url = URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),100)'], { type: 'text/javascript' }));
      worker = new Worker(url);
      worker.onmessage = tick;
    } catch { worker = null; }          // (no worker, a strict page policy: the world waits for the tab as before)
  }
  function stop() {
    if (!worker) return;
    worker.terminate(); worker = null;
    if (url) { URL.revokeObjectURL(url); url = null; }
  }
  const onVisibility = () => { if (document.hidden) start(); else stop(); };
  document.addEventListener('visibilitychange', onVisibility);
  if (document.hidden) start();
  return { start, stop, running: () => !!worker, tick };
}
