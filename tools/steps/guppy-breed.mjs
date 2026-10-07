// Guppy reproduction in the real sim (sim/sim.js + sim/livebearer.js), seeded: a generated Aripo stream tank, two pairs with known
// genes, run with the sim's own step for N game days. Reports conceptions, broods (size, father), fry sexes, the strains of the fry
// against the exact odds (sim/genetics.js outcomes), stored-sperm broods after the father is removed, maturity, and the room cap.
//   node tools/steps/guppy-breed.mjs --url=http://localhost:5173/ [--days=60] [--seed=3]
// Feeding is not the subject here: every fish is kept fed (hunger 0.2) each game hour.
import { chromium } from 'playwright';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://localhost:5173/'), days = +arg('days', 60), seed = +arg('seed', 3);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 960, height: 600 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  await page.goto(url, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.game, null, { timeout: 300000 });
  await page.waitForTimeout(2000);
  const r = await page.evaluate(async ({ days, seed }) => {
    const game = window.game; game.frozen = true;
    const gen = await import('/src/sim/generator.js');
    const G = await import('/src/sim/genetics.js');
    const w = await game.loadTank('standard', { layout: 'empty' });
    gen.generateTerrarium(w, { preset: 'aripo', seed: 3, tier: 'standard' });
    let s = seed >>> 0; const real = Math.random;
    Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const A = w.animals;
    for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a);
    // a spot in the water
    const water = [];
    for (let k = 0; k < 400 && water.length < 6; k++) { const x = (Math.random() - 0.5) * 50, z = (Math.random() - 0.5) * 20; const sfc = w.water.surfaceAt(x, z); const y = w.terrain.heightAt(x, z); if (sfc - y > 4) water.push({ x, y: (sfc + y) / 2, z }); }
    const P = (p) => game.camera.position.clone().set(p.x, p.y, p.z);      // (a Vector3 without importing three into the page)
    const gfor = (m, female, set = {}) => { const g = G.genotypeForMorph('guppy', m, Math.random, { female }); for (const [i, v] of Object.entries(set)) g[+i] = v; return g; };
    // pair 1: a Moscow red double-sword father (Moscow and swords on his Y) x a blue mosaic round-tail mother (mosaic on her X):
    // every son Moscow with swords, no daughter; sons mosaic only through the mother
    const m1 = A.add('guppy', P(water[0]), { genes: gfor('moscow_red_doublesword', false), age: 30 * 1440, hunger: 0.2 });
    const f1 = A.add('guppy', P(water[1]), { genes: gfor('blue_mosaic_round', true, { 5: 'Mm' }), age: 30 * 1440, hunger: 0.2 });
    // pair 2: two albino carriers (Aa x Aa): about a quarter albino, in both sexes
    const m2 = A.add('guppy', P(water[2]), { genes: gfor('red', false, { 2: 'Aa' }), age: 30 * 1440, hunger: 0.2 });
    const f2 = A.add('guppy', P(water[3]), { genes: gfor('red', true, { 2: 'Aa' }), age: 30 * 1440, hunger: 0.2 });
    m1.mate = f1.id; f1.mate = m1.id; m2.mate = f2.id; f2.mate = m2.id;
    const want1 = G.outcomes('guppy', m1.genes, f1.genes), want2 = G.outcomes('guppy', m2.genes, f2.genes);
    const log = [], broods = [];
    const born0 = new Set(A.by.guppy.map((a) => a.id));
    let removedM1 = false, stored = 0, cap = w.sim.roomOf('guppy').cap, maxPop = 0;
    const origLog = w.log.bind(w);
    w.log = (msg, k) => { if (/gave birth|coloured up/.test(msg)) log.push({ day: +(w.env.minute / 1440).toFixed(2), msg }); return origLog(msg, k); };
    for (let h = 0; h < days * 24; h++) {
      for (const a of A.by.guppy) { a.hunger = 0.2; a.health = 1; }
      const before = new Set(A.by.guppy.map((a) => a.id));
      w.sim.step(60);
      const fresh = A.by.guppy.filter((a) => !before.has(a.id));
      if (fresh.length) broods.push({ day: +(w.env.minute / 1440).toFixed(2), n: fresh.length, parents: [...new Set(fresh.map((a) => (a.parents ?? []).join('x')))] });
      if (!removedM1 && broods.some((b) => b.parents.includes(`${f1.id}x${m1.id}`))) { A.remove(m1, 'probe'); removedM1 = true; f1.mate = null; }
      maxPop = Math.max(maxPop, A.by.guppy.length);
    }
    const fry = A.by.guppy.filter((a) => !born0.has(a.id));
    const byPair = (pa, pb) => fry.filter((a) => a.parents && a.parents[0] === pa && a.parents[1] === pb);
    const tally = (list) => { const o = {}; for (const a of list) o[a.morph] = (o[a.morph] ?? 0) + 1; return o; };
    const sexes = (list) => ({ sons: list.filter((a) => a.female === false).length, daughters: list.filter((a) => a.female).length });
    const ytrait = (list) => ({ sonsMoscowSword: list.filter((a) => a.female === false && /moscow/.test(a.morph) && /sword|lyre/.test(a.morph)).length, daughtersMoscow: list.filter((a) => a.female && /moscow|sword/.test(a.morph)).length, sonsMosaic: list.filter((a) => a.female === false && /mosaic/.test(a.morph)).length });
    const albinos = (list) => list.filter((a) => /albino/.test(a.morph)).length;
    const k1 = byPair(f1.id, m1.id), k2 = byPair(f2.id, m2.id);
    const after = broods.filter((b) => removedM1 && b.parents.includes(`${f1.id}x${m1.id}`));
    stored = after.length - 1;
    Math.random = real;
    return {
      days, cap, maxPop, now: A.by.guppy.length, broods, log: log.slice(0, 12),
      pair1: { n: k1.length, ...sexes(k1), ...ytrait(k1), got: tally(k1), want: Object.fromEntries(Object.entries(want1).filter(([, p]) => p > 0.02)) },
      pair2: { n: k2.length, ...sexes(k2), albino: albinos(k2), wantAlbino: +Object.entries(want2).filter(([m]) => /albino/.test(m)).reduce((s, [, p]) => s + p, 0).toFixed(3) },
      fertileMales: A.by.guppy.filter((a) => a.female === false).length,
      broodsFromStoredSperm: Math.max(0, stored), f1st: f1.st ?? null,
      adultsAmongFry: fry.filter((a) => a.age >= 8 * 1440).length, juvLooks: fry.filter((a) => a.look?.startsWith('juv')).length,
      matureMalesColoured: fry.filter((a) => a.age >= 8 * 1440 && a.female === false && !a.look.startsWith('juv')).length,
      fryOther: fry.length - k1.length - k2.length,
    };
  }, { days, seed });
  console.log(JSON.stringify(r, null, 1));
  if (errors.length) console.log('page errors:', errors.slice(0, 3));
} finally { await browser.close(); }
