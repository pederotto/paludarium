// The loading veil: the opaque #loading screen (index.html), shown from boot and on every tank start or switch until the
// scene is whole: animal models loaded, shaders built (engine/compiler.js idle) and 30 frames in a row drawn in under 50 ms. The tank keeps
// building behind it at full speed (the canvas is only covered, never paused), so the player never sees objects pop in
// or the first stalled frames. Meanwhile it shows keeper's advice from the game's own content, one at a time, and an
// honest progress line from the real stages. Holds nest: veil.hold() returns its release.
import { render } from 'preact';
import { signal } from '@preact/signals';
import { CONCEPTS } from '../content/concepts.js';

// Keeper's advice: the care sheets as the game models them (docs/CARESHEET.md) and the tutorial's reasons
// (content/tutorial.js), then the Field Guide's "Did you know" facts (content/concepts.js).
const KEEPER = [
  'Bumblebee toads drown in water deeper than about 2.5 cm: give them shallows and an easy way out.',
  'Shrimp and crabs build a new shell at every molt from the minerals in the water: too soft and the molt fails.',
  'Never seal a pump in: stand it in a slotted tube with foam around it, so it can be lifted out later.',
  'Keep the water line just under the false bottom\'s mesh. Water over the mesh waterlogs the soil and rots the roots.',
  'Celestial pearl danios want gentle flow, soft to neutral water and a group of six or more.',
  'Starry night reed frogs climb the plants by day and come down to the water at dusk.',
  'Wood, roots and cork leach tannins that soften the water and lower its pH.',
  'Springtails and isopods are the cleaning crew: they eat mould and waste. A tank without them slowly goes sour.',
  'Odd numbers of stones in different sizes look natural.',
  'Moss grows where the air is damp and the light is soft.',
  'Water makes a closed tank breathe: it evaporates, condenses on the glass and rains back down.',
  'Nature is slow: a new tank needs weeks before its plants and bacteria keep it in balance.',
];
const TIPS = [
  ...KEEPER,
  ...Object.values(CONCEPTS).flatMap((c) => c.sections.filter((s) => s.fact && s.fact.length <= 180).map((s) => s.fact)),
];

const tip = signal(0), line = signal('');
const SMOOTH = 30, SMOOTH_MS = 50, TIP_MS = 7000;

function Veil() {
  return (
    <div class="veil-card">
      <div class="veil-title">Paludarium</div>
      <div class="veil-bar"><i /></div>
      <div class="veil-tip" key={tip.value}>
        <div class="veil-kicker">Keeper's tip</div>
        <div>{TIPS[tip.value % TIPS.length]}</div>
      </div>
      <div class="veil-line">{line.value}</div>
    </div>
  );
}

const gaps = [];
let el = null, game = null, holds = 0, stage = '', loop = 0, timer = 0, b0 = 0, ok = 0, last = 0, since = 0, gone = null;

// Draws the veil into the #loading element; the game is attached once it exists.
export function install(node) {
  el = node;
  tip.value = (Math.random() * TIPS.length) | 0;
  el.textContent = '';   // the page's own "Filling the tank…", shown until this script runs
  render(<Veil />, el);
}
export function attach(g) { game = g; }

// Covers the screen now (no fade in: the next frame must not show the old or the new tank half-built).
export function hold(text) {
  holds++;
  if (text) stage = text;
  if (el && el.classList.contains('gone')) {
    tip.value++;   // a fresh tip each time it comes back
    el.style.transition = 'none';
    el.classList.remove('gone');
    void el.offsetWidth;
    el.style.transition = '';
  }
  start();
  let done = false;
  return () => { if (done) return; done = true; holds = Math.max(0, holds - 1); if (!holds) { ok = 0; since = performance.now(); } };
}
export function setStage(text) { stage = text; }
// Resolves when the veil has lifted.
export function lifted() { return el?.classList.contains('gone') ? Promise.resolve() : new Promise((r) => { gone = r; }); }

function start() {
  if (loop) return;
  const c = game?.gfx?.compiler;
  b0 = c?.built ?? 0; ok = 0; gaps.length = 0; last = performance.now(); since = last;
  if (c) c.budget = Math.max(c.budget, 40);   // as game.settle(): build faster while nobody watches
  clearInterval(timer);
  timer = setInterval(() => { tip.value++; }, TIP_MS);
  loop = requestAnimationFrame(frame);
}

function frame() {
  const now = performance.now(), c = game?.gfx?.compiler;
  const gap = now - last;
  last = now;
  let text = stage;
  if (c && c.budget < 40) c.budget = 40;   // game.settle() puts it back to 8 when it resolves
  if (c && !holds) {
    // Ready once every object has its shaders and 30 frames in a row come without a stall: under 50 ms, or on a device
    // slower than that in steady play, under twice its median frame. A few late pipelines still linking after 15 s do
    // not hold it (see ShaderCompiler.settled), and after 45 s it lifts whatever happens.
    gaps.push(gap); if (gaps.length > SMOOTH) gaps.shift();
    const med = [...gaps].sort((a, b) => a - b)[gaps.length >> 1];
    // Animal models still on their way hold it too: each arrives as a new body with new shaders (Animals.loadModel).
    const late = now - since > 15000 && c.lastDeferred === 0 && c.pending <= 4;
    const models = game?.world?.animals?.modelsLoading ?? 0;
    ok = (c.idle || late) && !models && gap < Math.max(SMOOTH_MS, 2 * med) ? ok + 1 : 0;
    const built = c.built - b0, todo = c.pending + c.lastDeferred;
    text = models ? `Loading animals: ${models} to go` : todo ? `Building shaders: ${built} of ${built + todo}` : `Settling the tank: ${Math.round(100 * ok / SMOOTH)}%`;
    if (ok >= SMOOTH || now - since > 45000) { el.dataset.lift = `${ok >= SMOOTH ? 'ready' : 'cap'} ${Math.round(now - since)}`; lift(c); return; }
  } else if (c && (c.pending || c.lastDeferred)) text = `${stage} · shaders ${c.built - b0} built`;
  if (line.value !== text) line.value = text;
  loop = requestAnimationFrame(frame);
}

function lift(c) {
  loop = 0;
  clearInterval(timer);
  c.budget = 8;
  el.classList.add('gone');
  gone?.(); gone = null;
}
