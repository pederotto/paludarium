// Entry of the test lab page (lab.html). The game's title, career, saves and tutorial are not loaded: the lab has no director and
// writes nothing to the player's save. Opened as .../lab.html, or as .../?lab (index.html sends it here).
import { render } from 'preact';
import { Game } from '../app/game.js';
import { start } from './index.js';
import { Lab } from './Lab.jsx';
import './lab.css';

const q = new URLSearchParams(location.search);
window.__errs = [];
for (const k of ['error', 'warn']) { const o = console[k]; console[k] = (...a) => { window.__errs.push(k + ': ' + a.map(String).join(' ').slice(0, 400)); o.apply(console, a); }; }
window.addEventListener('error', (e) => window.__errs.push('uncaught: ' + e.message));

const loading = document.getElementById('loading');
const game = new Game(document.getElementById('view'), q);
window.game = game;
try {
  await game.boot();
  await start(game, q);
} catch (e) {
  loading.innerHTML = `<div style="max-width:520px;padding:20px">The test lab could not start: ${e?.message ?? e}.</div>`;
  throw e;
}
render(<Lab game={game} />, document.getElementById('ui'));
loading.classList.add('gone');
