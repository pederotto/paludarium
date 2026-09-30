// Entry point: boots the engine, mounts the interface, and starts the game shell.
import '@fontsource-variable/inter';
import '@fontsource-variable/fraunces';
import './ui/theme.css';
import { render } from 'preact';
import { App } from './ui/App.jsx';
import { S, closeModal, toast } from './ui/store.js';
import { ctx } from './app/ctx.js';
import { Game } from './app/game.js';
import { ToolController } from './tools/controller.js';
import { snapshot } from './app/snapshot.js';
import { Meta } from './app/saves.js';
import { Director } from './app/director.js';
import { bindLayout } from './ui/layout.js';
import { effect } from '@preact/signals';
import { Ambience } from './engine/audio.js';

const q = new URLSearchParams(location.search);
window.__errs = [];
for (const k of ['error', 'warn']) { const o = console[k]; console[k] = (...a) => { window.__errs.push(k + ': ' + a.map(String).join(' ').slice(0, 400)); o.apply(console, a); }; }
window.addEventListener('error', (e) => window.__errs.push('uncaught: ' + e.message));

const loading = document.getElementById('loading');
const game = new Game(document.getElementById('view'), q);
window.game = game;
ctx.game = game;
try {
  await game.boot();
} catch (e) {
  loading.innerHTML = `<div style="max-width:520px;padding:20px">Couldn't start: ${e?.message ?? e}.<br><br>Paludarium needs a browser with WebGPU or WebGL 2 (recent Chrome, Edge, Safari or Firefox).</div>`;
  throw e;
}
S.backend.value = game.gfx.backend;
S.quality.value = game.gfx.quality;
ctx.meta = Meta.get();
const mq = matchMedia('(max-width: 860px), (max-aspect-ratio: 1/1)');
S.compact.value = mq.matches;
S.right.value = !mq.matches;
mq.addEventListener('change', (e) => { S.compact.value = e.matches; S.right.value = !e.matches; });

// The title screen shows the starter tank slowly turning behind the menu.
await game.loadTank('standard', { layout: 'starter' });
ctx.tools = new ToolController(game);
const director = ctx.director = window.__director = new Director(game);
game.rig.startOrbit(0.04);
game.rig.view('hero', false);

async function busy(text, fn) {
  S.busy.value = { text };
  await new Promise((r) => setTimeout(r, 30));
  try { await fn(); } catch (e) { console.error(e); toast('Could not start: ' + (e?.message ?? e), 'bad'); } finally { S.busy.value = null; }
}

ctx.start = {
  career: () => busy('Setting up your studio…', async () => { await director.startCareer(); director.enterPlay(); }),
  sandbox: (kind) => busy('Filling the tank…', async () => { await director.startSandbox(kind); director.enterPlay(); }),
  preset: (id, seed, tier) => busy('Growing a terrarium…', async () => { await director.startSandbox('preset', tier, { id, seed }); director.enterPlay(); }),
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
});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.modal.value) closeModal(); });
window.addEventListener('beforeunload', () => { director.save?.().catch(() => {}); });

effect(() => { game.lens?.set(S.lens.value); });
effect(() => { game.setPhoto(S.photo.value); });
render(<App />, document.getElementById('ui'));
bindLayout(game);
game.start();
loading.classList.add('gone');
