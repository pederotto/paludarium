// Entry point: boots the engine, mounts the interface, and starts the game shell.
import '@fontsource-variable/inter';
import '@fontsource-variable/fraunces';
import './ui/theme.css';
import { render } from 'preact';
import { App } from './ui/App.jsx';
import { S, closeModal, toast, drawerPref } from './ui/store.js';
import { ctx } from './app/ctx.js';
import { mark } from './util/trace.js';
import { Game } from './app/game.js';
import { ToolController } from './editor/controller.js';
import { snapshot } from './app/snapshot.js';
import { Meta } from './app/saves.js';
import { Director } from './app/director.js';
import { bindLayout } from './ui/layout.js';
import { effect } from '@preact/signals';
import { Ambience } from './engine/audio.js';
import { tickTimelapse } from './app/timelapse.js';
import * as Kids from './app/kids.js';
import * as Modes from './app/modes-runtime.js';

const q = new URLSearchParams(location.search);
mark('main');
// The metrics recorder (src/diag) is its own chunk, fetched only when the address has ?metrics; the preview server may have
// injected it already (tools/metrics-collector.mjs), in which case it is running.
if (q.has('metrics') && !window.__metrics) import('./diag/index.js').then((m) => m.start({ params: q })).catch(() => {});
window.__errs = [];
for (const k of ['error', 'warn']) { const o = console[k]; console[k] = (...a) => { window.__errs.push(k + ': ' + a.map(String).join(' ').slice(0, 400)); o.apply(console, a); }; }
window.addEventListener('error', (e) => window.__errs.push('uncaught: ' + e.message));

const loading = document.getElementById('loading');
const game = new Game(document.getElementById('view'), q);
window.game = game;
ctx.game = game;
try {
  mark('boot-start');
  await game.boot();
  mark('boot-end');
} catch (e) {
  loading.innerHTML = `<div style="max-width:520px;padding:20px">Couldn't start: ${e?.message ?? e}.<br><br>Paludarium needs a browser with WebGPU or WebGL 2 (recent Chrome, Edge, Safari or Firefox).</div>`;
  throw e;
}
S.backend.value = game.gfx.backend;
S.quality.value = game.gfx.quality;
S.gfxAuto.value = game.gfx.auto; S.fpsCap.value = game.gfx.maxFps;
game.gfx.onChange = (c) => { S.quality.value = c.quality; S.fpsCap.value = c.cap; };
ctx.meta = Meta.get();
const mq = matchMedia('(max-width: 860px), (max-aspect-ratio: 1/1)');
S.compact.value = mq.matches;
S.right.value = !mq.matches && drawerPref();
mq.addEventListener('change', (e) => { S.compact.value = e.matches; S.right.value = !e.matches && drawerPref(); });

// The title screen shows the starter tank slowly turning behind the menu.
mark('showcase-start');
await game.loadTank('standard', { layout: 'starter', showcase: true });
mark('showcase-end');
ctx.tools = window.__tools = new ToolController(game);
const director = ctx.director = window.__director = new Director(game);
game.rig.startOrbit(0.04);
game.rig.view('hero', false);

async function busy(text, fn) {
  mark('start');
  S.busy.value = { text };
  await new Promise((r) => setTimeout(r, 30));
  try { await fn(); await game.settle(); } catch (e) { console.error(e); toast('Could not start: ' + (e?.message ?? e), 'bad'); } finally { S.busy.value = null; mark('started'); }
}

ctx.start = {
  career: () => busy('Setting up your studio…', async () => { await director.startCareer(); director.enterPlay(); }),
  sandbox: (kind) => busy('Filling the tank…', async () => { await director.startSandbox(kind); director.enterPlay(); }),
  preset: (id, seed, tier) => busy('Growing a terrarium…', async () => { await director.startSandbox('preset', tier, { id, seed }); director.enterPlay(); }),
  kids: (id, seed, tier) => busy('Building your world…', async () => {
    await director.startSandbox('preset', tier, { id, seed });
    director.enterPlay();
    Kids.enter();
    S.screen.value = 'play';
  }),
  kidsContinue: () => busy('Loading…', async () => {
    if (await Kids.loadSaved()) { director.enterPlay(); Kids.enter(); } else toast('No saved world yet.', 'bad');
  }),
  continue: () => busy('Loading…', async () => { if (await director.load()) director.enterPlay(); else toast('No saved game found.', 'bad'); }),
};

// Ambient sound: starts on the first click or key press (browsers require one), then follows the tank.
const audio = ctx.audio = window.__audio = new Ambience();
const wake = () => { audio.start(); window.removeEventListener('pointerdown', wake); window.removeEventListener('keydown', wake); };
window.addEventListener('pointerdown', wake); window.addEventListener('keydown', wake);
setInterval(() => { if (S.screen.value === 'play') audio.update(S.live.value, 0.5); }, 500);

game.tickHooks.push(() => {
  S.live.value = snapshot(game);
  S.fps.value = game.gfx.stats.fps;
  tickTimelapse();
});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.modal.value) closeModal(); });
window.addEventListener('beforeunload', () => { director.save?.().catch(() => {}); });

effect(() => { game.lens?.set(S.lens.value); });
effect(() => { game.setPhoto(S.photo.value); });
render(<App />, document.getElementById('ui'));
ctx.relayout = bindLayout(game);
Kids.install(game);
Modes.install(game);
window.__S = S; window.__ctx = ctx; window.__setMode = Modes.setMode;   // debug handles for tools/steps and tools/journey.mjs
mark('ui');
game.start();
await game.settle();
loading.classList.add('gone');
mark('veil');
