// Time-lapse: the tank runs fast while the camera drifts around it, then a
// short report says what changed. It uses the game's own loop at a boosted
// rate (game.lapse), so everything you see is the real simulation.

import { S, toast } from '../ui/store.js';
import { ctx } from './ctx.js';

const RATE = 600;          // game minutes per real second: a day in 2.4 s

function snap(W) {
  const E = W.env;
  const by = W.animals.by;
  return {
    plants: W.plants.list.length,
    moss: W.mossFraction(),
    animals: Object.values(by).reduce((s, a) => s + a.length, 0),
    births: W.stats.births, deaths: W.stats.deaths,
    algae: E.algae ?? 0, nitrate: E.nitrate ?? 0,
  };
}

export function startTimelapse(days) {
  const g = ctx.game, W = g?.world;
  if (!W || S.timelapse.value) return;
  S.lens.value = 'off';
  g.rig.stopOrbit();
  // A wide screen gets a slow drift around the tank; a portrait phone keeps the front view, which fits it.
  g.rig.view(S.compact.value ? 'front' : 'hero', true);
  if (!S.compact.value) setTimeout(() => g.rig.startOrbit(0.09), 900);
  g.lapse = RATE;
  S.timelapse.value = { days, from: W.env.minute, day: 0, before: snap(W), done: null };
}

// Called from the 4 Hz tick hook.
export function tickTimelapse() {
  const t = S.timelapse.value, g = ctx.game;
  if (!t || t.done || !g?.world) return;
  const W = g.world, day = (W.env.minute - t.from) / 1440;
  if (day >= t.days) return finishTimelapse();
  S.timelapse.value = { ...t, day };
}

export function finishTimelapse() {
  const t = S.timelapse.value, g = ctx.game;
  if (!t || t.done || !g?.world) return;
  g.lapse = 0;
  g.rig.stopOrbit();
  const W = g.world, a = t.before, b = snap(W);
  const lines = [];
  const d = (n, one, many) => n > 0 && lines.push(`${n} ${n === 1 ? one : many}`);
  d(b.plants - a.plants, 'more plant', 'more plants');
  d(a.plants - b.plants, 'plant lost', 'plants lost');
  const mm = Math.round((b.moss - a.moss) * 100);
  if (mm) lines.push(`moss cover ${mm > 0 ? 'up' : 'down'} ${Math.abs(mm)} points, now ${Math.round(b.moss * 100)}%`);
  d(b.births - a.births, 'birth', 'births');
  d(b.deaths - a.deaths, 'death', 'deaths');
  if (b.algae - a.algae > 0.15) lines.push('more algae on the glass and rocks');
  if (!lines.length) lines.push('a stable tank: hardly anything changed');
  const days = Math.max(1, Math.round((W.env.minute - t.from) / 1440));
  ctx.career?.stat?.('timelapses');
  S.timelapse.value = { ...t, day: t.days, done: { days, lines } };
  g.rig.view('front', true);
}

export function endTimelapse() {
  const g = ctx.game;
  if (g) { g.lapse = 0; g.rig.stopOrbit(); }
  S.timelapse.value = null;
}
