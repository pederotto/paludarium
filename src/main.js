// Interim entry (legacy UI on the new engine) while the new interface is built.
window.__errs = [];
for (const k of ['error', 'warn']) { const o = console[k]; console[k] = (...a) => { window.__errs.push(k + ': ' + a.map(String).join(' ').slice(0, 400)); o.apply(console, a); }; }
window.addEventListener('error', (e) => window.__errs.push('uncaught: ' + e.message));
import { Game } from './app/game.js';
import { UI } from './ui/legacy-ui.js';

const params = new URLSearchParams(location.search);
const game = new Game(document.getElementById('view'), params);
window.game = game;
await game.boot();
document.getElementById('backend').textContent = game.gfx.backend + ' · ' + game.gfx.quality;
await game.loadTank('standard', { layout: 'starter' });
const ui = new UI({ world: game.world, camera: game.camera, renderer: game.renderer, controls: game.controls, scene: game.scene });
window.paludariumUI = ui;
game.frameHooks.push((dt) => ui.frame(dt));
game.tickHooks.push(() => { game.speed = ui.speed; ui.refresh(); document.getElementById('fps').textContent = game.gfx.stats.fps + ' fps'; });
game.start();
document.getElementById('loading').classList.add('gone');
