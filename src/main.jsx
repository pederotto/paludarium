// Entry point: boots the engine, mounts the interface, and starts the game shell.
import '@fontsource-variable/inter';
import '@fontsource-variable/fraunces';
import './ui/theme.css';
import { render } from 'preact';
import { App } from './ui/App.jsx';
import { S, closeModal } from './ui/store.js';
import { ctx } from './app/ctx.js';
import { Game } from './app/game.js';
import { ToolController } from './tools/controller.js';
import { snapshot } from './app/snapshot.js';
import { Saves, Meta } from './app/saves.js';
import { bindLayout } from './ui/layout.js';

const dev = new URLSearchParams(location.search);
window.__errs = [];
for (const k of ['error', 'warn']) { const o = console[k]; console[k] = (...a) => { window.__errs.push(k + ': ' + a.map(String).join(' ').slice(0, 400)); o.apply(console, a); }; }
window.addEventListener('error', (e) => window.__errs.push('uncaught: ' + e.message));

const loading = document.getElementById('loading');
const game = new Game(document.getElementById('view'), dev);
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
game.rig.startOrbit(0.04);
game.rig.view('hero', false);

ctx.start = {
  async sandbox(kind) {
    if (kind === 'empty') await game.loadTank('standard', { layout: 'empty' });
    game.world.equipment.all = true;
    enter();
  },
  async career() { ctx.start.sandbox('empty'); },
  async continue() { ctx.start.sandbox('starter'); },
};
function enter() {
  S.screen.value = 'play';
  game.rig.stopOrbit();
  game.rig.view('front', true);
  ctx.tools.setTool('view');
  game.setSpeed(1);
}

game.tickHooks.push(() => {
  S.live.value = snapshot(game);
  S.fps.value = game.gfx.stats.fps;
});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.modal.value) closeModal(); });

render(<App />, document.getElementById('ui'));
bindLayout(game);
game.start();
loading.classList.add('gone');
void Saves;
