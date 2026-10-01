// Applies the mode rules (modes.js) to the running game: world.realism for the simulation's guarded reads,
// the erosion/slump multipliers, random events, the Explorer's auto-managed water and its gentle warnings,
// and the CSS class that makes touch targets bigger. The mode is saved with the game (director.js).

import { effect } from '@preact/signals';
import { S, toast, modeId, saveModeChoice } from '../ui/store.js';
import { ctx } from './ctx.js';
import { rules, realismFor, normalizeMode, plainWhy, ADULT_MODES } from './modes.js';

let game = null;

export function applyMode() {
  const g = game, W = g?.world;
  const id = modeId(), R = rules(id);
  const root = document.documentElement;
  for (const m of ['kids', 'explorer', 'naturalist']) root.classList.toggle('mode-' + m, m === id);
  ctx.tools?.setButtons?.();
  if (!W) return;
  W.realism = realismFor(id);
  const E = W.water?.erosion;
  if (E) { E.scale = R.sim.erosion ?? 1; E.slump = R.sim.slump ?? 1; }
  const ev = ctx.director?.events;
  if (ev && id !== 'kids') { ev.enabled = R.sim.events; ev.rate = R.sim.eventRate; }
  if (R.sim.autoWater) autoWater(true);
}

// Explorer: the float valve, the pump and the valves are kept in a sensible state.
function autoWater(first = false) {
  const W = game?.world, H = W?.water?.hydro;
  if (!H) return;
  if (first && !H.topUp) { H.topUp = true; H.targetTotal = Math.max(H.targetTotal, H.total()); }
  if (!H.topUp) { H.topUp = true; H.targetTotal = Math.max(H.targetTotal, H.total()); }
  H.pump.on = true;
  if (!(H.pump.rate >= 60 && H.pump.rate <= 300)) H.pump.rate = 160;
  for (const o of H.outlets) if (!(o.valve > 0.3)) o.valve = 1;
}

// Switch the adult mode of this tank (Title, Settings, a loaded save).
export function setMode(id, { quiet = false } = {}) {
  id = normalizeMode(id);
  if (!ADULT_MODES.includes(id)) return;
  S.mode.value = id;
  saveModeChoice(id);
  applyMode();
  if (!quiet) toast(`${rules(id).name} mode: ${rules(id).blurb}`, 'info', 4500);
}

const warned = new Map();
let clock = 0, wClock = 0;

function tick(dt) {
  if (S.screen.value !== 'play' || !game?.world || S.kids.value) return;
  clock += dt;
  if (clock < 2) return;
  clock = 0;
  const R = rules(modeId());
  if (R.sim.autoWater) autoWater();
  if (R.coach !== 'plain') return;
  // Warnings first: tell an Explorer in plain words before a pet gets into real trouble.
  wClock += 2;
  if (wClock < 15 || S.coach.value) return;
  const live = S.live.value;
  if (!live) return;
  const now = performance.now();
  for (const c of live.census) {
    if (c.hp > 0.7 || !c.why) continue;
    if (now - (warned.get(c.id) ?? -1e9) < 150000) continue;
    warned.set(c.id, now);
    wClock = 0;
    toast(`Your ${c.name.toLowerCase()} ${c.hp < 0.4 ? 'need help now' : 'look a bit unwell'}. ${plainWhy(c.why)}`, c.hp < 0.4 ? 'bad' : 'info', 7000);
    break;
  }
}

export function install(g) {
  game = g;
  effect(() => { modeId(); applyMode(); });
  g.events.on('tank', () => { warned.clear(); applyMode(); });
  g.tickHooks.push(tick);
}
