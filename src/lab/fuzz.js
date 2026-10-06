// Random scenarios, one after another: each is built from a seed (sim/labrandom.js), run for a few real seconds at 4x with every animal
// on its random drive, and what the bug radar found is kept against the seed. A row can be loaded again to watch it; the seed alone
// rebuilds the same situation (the animals' own small choices are not seeded, so a run is alike, not identical).

import { SPECIES } from '../sim/animals.js';
import { TANK } from '../sim/tank.js';
import { randomScenario } from '../sim/labrandom.js';
import { DRIVABLE } from './driver.js';
import { applyScenario } from './scenario.js';
import { L } from './state.js';

// The species a random scenario draws from, by where they can be released: land, the pool, or the bank between.
export function speciesPool() {
  const land = [], water = [], shore = [];
  for (const [id, sp] of Object.entries(SPECIES)) {
    if (!DRIVABLE.has(sp.kind) || sp.young) continue;
    if (sp.kind === 'swim' || sp.kind === 'axolotl') water.push(id);
    else if (sp.kind === 'newt' && id !== 'firesal') shore.push(id);
    else if (sp.kind === 'frog' || sp.kind === 'toad' || sp.kind === 'newt' || sp.kind === 'gecko' || sp.kind === 'skink' || sp.kind === 'crab') land.push(id);
  }
  return { land, water, shore };
}

export function createFuzz(lab) {
  let stop = false;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Build and run one seed for `seconds` real seconds; returns its row.
  async function one(seed, seconds, { keep = false } = {}) {
    const spec = randomScenario(seed, { pool: speciesPool(), tank: { w: TANK.w, d: TANK.d } });
    const made = await applyScenario(lab, spec);
    lab.radar.clear();
    lab.pause(false); lab.rate(spec.rate ?? 4);
    const t0 = performance.now();
    while (performance.now() - t0 < seconds * 1000 && !stop) await sleep(250);
    const rows = lab.radar.rows(), kinds = {};
    let bad = 0, warn = 0;
    for (const r of rows) { kinds[r.kind] = (kinds[r.kind] ?? 0) + r.n; if (r.sev === 'bad') bad++; else warn++; }
    const species = [...new Set(spec.animals.map((a) => SPECIES[a.sp]?.name ?? a.sp))];
    const row = { seed, animals: made.length, species, obstacles: spec.obstacles.length, ground: spec.ground, depth: spec.depth, bad, warn, kinds, first: rows.slice(0, 3).map((r) => `${r.name} #${r.id} ${r.kind}: ${r.msg}`) };
    if (keep) row.spec = spec;
    return row;
  }

  return {
    one,
    // `n` seeds from `seed0`, `seconds` each. Results appear in L.fuzz as they come.
    async run({ n = L.fuzzN.value, seconds = L.fuzzSeconds.value, seed0 = L.rndSeed.value } = {}) {
      if (L.fuzz.value?.running) return;
      stop = false;
      L.fuzz.value = { n, seed0, seconds, done: 0, running: true, rows: [] };
      for (let i = 0; i < n && !stop; i++) {
        const row = await one(seed0 + i, seconds);
        L.fuzz.value = { ...L.fuzz.value, done: i + 1, rows: [...L.fuzz.value.rows, row] };
      }
      L.fuzz.value = { ...L.fuzz.value, running: false };
      lab.pause(true);
    },
    stop() { stop = true; },
    // One seed, to watch: built and left running.
    async watch(seed) {
      stop = true; await sleep(300); stop = false;
      L.fuzz.value = L.fuzz.value ? { ...L.fuzz.value, running: false } : L.fuzz.value;
      const spec = randomScenario(seed, { pool: speciesPool(), tank: { w: TANK.w, d: TANK.d } });
      await applyScenario(lab, spec);
      lab.radar.clear(); lab.pause(false); lab.rate(spec.rate ?? 4);
      L.rndSeed.value = seed;
      return spec;
    },
    text() {
      const f = L.fuzz.value;
      if (!f) return '';
      const lines = [`random scenarios: seeds ${f.seed0} to ${f.seed0 + f.rows.length - 1}, ${f.seconds} s each at 4x`];
      for (const r of f.rows) lines.push(`seed ${r.seed}: ${r.animals} animals (${r.species.join(', ')}), ${r.obstacles} obstacles, ${r.ground}${r.depth ? ' + ' + r.depth + ' cm water' : ''} -> ${r.bad} bad, ${r.warn} to look at ${JSON.stringify(r.kinds)}`);
      return lines.join('\n');
    },
  };
}
