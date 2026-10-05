// sim/filterflow.js: a filter's pump against its head (lift, media clog, hose), the water's speed in each hose, the stages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { filterFlow, hoseSpeed, hoseLoss, stageClogs, pumpHose, HOSES, CABINET_DROP, filterPumpCurve, LIFT_MARGIN, SPOUT } from '../src/sim/filterflow.js';
import { FILTERS, filterEff, PUMPS, PUMP_LADDER } from '../src/content/equipment.js';
import { pumpCurve } from '../src/sim/hydro.js';
import { TANK } from '../src/sim/tank.js';
import { TANKS, TANK_ORDER } from '../src/content/tanks.js';
import { readFileSync } from 'node:fs';

// B5e: a hang-on-back's pump lifts 40 cm at most, so it only runs with the water near the rim: its reference pool is 6 cm under it.
const lvl = (k) => (FILTERS[k].mount === 'rim' ? TANK.h - 6 : 12);
const run = (kind, clog = 0, level = lvl(kind), o = {}) => filterFlow({ filter: true, filterKind: kind, filterDirt: clog * FILTERS[kind].hold, mediaBio: 0.5, drainage: 1, ...o }, level);

test('a clean filter gives about its rated flow at the starter level, and clogging takes most of it', () => {
  for (const kind of Object.keys(FILTERS)) {
    const F = FILTERS[kind], c0 = run(kind, 0).lph, c5 = run(kind, 0.5).lph, c1 = run(kind, 1).lph;
    assert.ok(Math.abs(c0 - F.lph) / F.lph < 0.06, `${kind}: clean ${c0} vs rated ${F.lph}`);
    assert.ok(c0 > c5 && c5 > c1, `${kind}: flow falls as it clogs (${c0} > ${c5} > ${c1})`);
    assert.ok(c1 > F.lph * 0.15 && c1 < F.lph * 0.5, `${kind}: clogged solid it still passes a trickle (${c1})`);
    assert.ok(c0 < run(kind, 0).pump.lph, `${kind}: never more than its pump moves free`);
  }
});

test('B5e: an open box in the cabinet lifts more from deeper water and gets a bigger pump; a closed canister and the in-tank pumps do not care', () => {
  const s12 = run('sponge', 0, 12), s30 = run('sponge', 0, 30);
  assert.ok(s30.lift > s12.lift + 17, 'the sponge box lifts from its own water to the outlet over the pool');
  assert.ok(PUMP_LADDER.indexOf(s30.pump.id) > PUMP_LADDER.indexOf(s12.pump.id), `a bigger pump for more lift: ${s12.pump.name} > ${s30.pump.name}`);
  assert.ok(s12.fitted && Math.abs(s30.lph - s12.lph) < FILTERS.sponge.lph * 0.06, 'its flow knob sets each to the filter\'s flow');
  const c12 = run('canister', 0, 12), c30 = run('canister', 0, 30);
  assert.ok(c12.lift === SPOUT && c30.lift === SPOUT, 'a closed loop: the static lift is only the outlet over the water');
  const tall = filterFlow({ filter: true, filterKind: 'canister', filterDirt: 0, mediaBio: 0.5 }, 12, CABINET_DROP + 40);
  assert.ok(tall.head - tall.valve > c12.head - c12.valve && tall.lift === SPOUT, 'a taller cabinet costs hose friction, not lift');
  assert.ok(Math.abs(run('matten', 0, 30).lph - run('matten', 0, 12).lph) < 3);
});

test('the working point sits on the pump curve, a centrifugal pump\'s (B5e)', () => {
  for (const kind of Object.keys(FILTERS)) {
    const r = run(kind, 0.4);
    assert.ok(Math.abs(r.pump.lph * filterPumpCurve(r.head, r.pump.hmax) - r.lph) < 0.5, kind);
  }
  assert.ok(Math.abs(filterPumpCurve(50, 100) - Math.sqrt(0.5)) < 1e-12, 'H = Hmax (1 - (Q / Qmax)^2)');
  assert.equal(pumpCurve(40), pumpCurve(40, 80), 'the main pump keeps its curve');
});

test('hoses: real sizes, v = Q / A, the water goes down to the filter and up from it', () => {
  // 120 L/h through a 12 mm bore: 33.3 cm³/s over 1.131 cm² = 29.5 cm/s.
  assert.ok(Math.abs(hoseSpeed(120, 12) - 29.47) < 0.05);
  assert.equal(hoseSpeed(0, 12), 0);
  assert.ok(hoseLoss(400, 16, 85) > hoseLoss(400, 19, 85) && hoseLoss(400, 16, 85) > hoseLoss(120, 16, 85));
  for (const kind of ['sponge', 'canister']) {
    const r = run(kind), [i, o] = r.hoses;
    assert.deepEqual([i.role, i.dir, o.role, o.dir], ['intake', 'down', 'return', 'up']);
    assert.ok(HOSES.some(([a, b]) => a === i.id && b === i.od) && HOSES.some(([a, b]) => a === o.id && b === o.od), kind);
    assert.ok(i.id > o.id, `${kind}: the gravity drain is a size up on the return`);
    assert.ok(i.v < o.v, `${kind}: so the water runs slower in it`);
    for (const h of r.hoses) assert.ok(Math.abs(h.v - hoseSpeed(r.lph, h.id)) < 1e-9);
  }
  assert.ok(run('canister').hoses[1].od > run('sponge').hoses[1].od, 'a canister has the bigger hose');
  assert.ok(run('canister').hoses[1].v > run('sponge').hoses[1].v, 'and the faster water');
  assert.deepEqual(run('matten').hoses.map((h) => [h.role, h.dir]), [['riser', 'up']]);
  assert.ok(run('sponge', 0.8).hoses[1].v < run('sponge', 0).hoses[1].v * 0.5, 'a clogged filter: slow water in its hoses');
  assert.deepEqual(pumpHose(160), [9, 12]);
  assert.deepEqual(pumpHose(500), [12, 16]);
});

test('stages: the coarse one fills first, all are full when the filter is', () => {
  for (const kind of Object.keys(FILTERS)) {
    const F = FILTERS[kind];
    assert.ok(F.stages.length >= 2 && F.stages[0][0] === 'mech' && F.stages.some((s) => s[0] === 'bio'), kind);
    assert.ok(Math.abs(F.stages.reduce((a, s) => a + s[2], 0) - 1) < 1e-9, `${kind}: shares add up`);
    assert.ok(stageClogs(F, 0).every((s) => s.clog === 0));
    assert.ok(stageClogs(F, 1).every((s) => s.clog > 0.95));
    const half = stageClogs(F, 0.4);
    for (let k = 1; k < half.length; k++) assert.ok(half[k].clog <= half[k - 1].clog, `${kind}: ${half[k].id} after ${half[k - 1].id}`);
  }
  assert.ok(run('canister', 0, 12, { prefilter: true }).lph < run('canister').lph, 'the pre-filter foam costs a little flow');
});

test('off: no flow; filterEff follows the flow the sim found', () => {
  const r = filterFlow({ filter: false, filterKind: 'canister' }, 12);
  assert.equal(r.lph, 0);
  assert.ok(r.hoses.every((h) => h.v === 0));
  const E = { filter: true, filterKind: 'sponge', filterDirt: 12 };
  assert.ok(Math.abs(filterEff(E) - (1 - 0.75 * 0.5)) < 1e-9, 'before the first step: the plain estimate');
  E.filterFlow = filterFlow(E, lvl(E.filterKind));
  assert.ok(Math.abs(filterEff(E) - E.filterFlow.lph / FILTERS.sponge.lph) < 1e-9);
  E.filterKind = 'canister';
  assert.ok(Math.abs(filterEff(E) - (1 - 0.75 * 12 / 40)) < 1e-9, 'a stale result for another kind is not used');
  assert.equal(filterEff({ filter: false, filterFlow: E.filterFlow }), 0);
});

// ---- B5c: three more kinds (hang-on-back, internal submersible, false-bottom bed), each a FILTERS row with a mount ----
import { GEAR, plenumBio } from '../src/content/equipment.js';
import { MOUNTS } from '../src/sim/filterflow.js';
import { PLENUM } from '../src/sim/plenum.js';

const KINDS = ['sponge', 'matten', 'canister', 'hobS', 'hobM', 'hobL', 'internalS', 'internalM', 'internalL', 'bedS', 'bedM', 'bedL'];
const bedE = (o = {}) => ({ filter: true, filterKind: 'bedM', filterDirt: 0, mediaBio: 0.5, drainage: 1, ...o });

test('B5c: every kind is a row with a gear item, a mount, real hose sizes and a finite lift, and filterFlow answers for that kind', () => {
  assert.deepEqual(Object.keys(FILTERS).sort(), [...KINDS].sort());
  for (const [k, F] of Object.entries(FILTERS)) {
    assert.ok(GEAR[F.gear]?.name, `${k}: its gear item`);
    assert.ok(MOUNTS[F.mount], `${k}: mount ${F.mount}`);
    assert.equal(typeof F.prefilter, 'boolean', k);
    for (const [role, [id, od]] of Object.entries(F.hose)) assert.ok(HOSES.some(([a, b]) => a === id && b === od), `${k}: ${role} hose ${id}/${od} is a standard size`);
    const r = run(k);
    assert.equal(r.kind, k);
    assert.ok(Number.isFinite(r.lift) && Number.isFinite(r.head) && r.lph > 0, `${k}: lift ${r.lift}, flow ${r.lph}`);
    assert.ok(r.hoses.length >= 1 && r.hoses.every((h) => Number.isFinite(h.v) && h.v > 0), `${k}: water moves in every hose`);
  }
});

test('B5c: filterEff follows the flow the sim found, and clogging lowers it, for every kind', () => {
  for (const [k, F] of Object.entries(FILTERS)) {
    const E = { filter: true, filterKind: k, filterDirt: 0, mediaBio: 0.5, drainage: 1 };
    E.filterFlow = filterFlow(E, lvl(E.filterKind));
    assert.ok(Math.abs(filterEff(E) - E.filterFlow.lph / F.lph) < 1e-9, k);
    const clean = filterEff(E);
    E.filterDirt = F.hold * 0.8; E.filterFlow = filterFlow(E, lvl(E.filterKind));
    assert.ok(filterEff(E) < clean * 0.8, `${k}: clogged ${filterEff(E)} vs clean ${clean}`);
  }
});

test('B5c: where each one stands decides its lift', () => {
  // hang-on-back: the pump lifts from the pool to the box on the rim, so deeper water is less lift, more flow
  assert.ok(run('hobM', 0, 40).lph > run('hobM', 0, 12).lph * 1.05 && run('hobM', 0, 40).head < run('hobM', 0, 12).head);
  assert.deepEqual(run('hobM').hoses.map((h) => [h.role, h.dir]), [['uptake', 'up']]);   // a rigid tube down the glass, no return hose: a spillway
  // internal: it stands in the pool, its outlet under the surface: the level does not matter
  assert.ok(Math.abs(run('internalM', 0, 40).lph - run('internalM', 0, 12).lph) < 3);
  assert.deepEqual(run('internalM').hoses.map((h) => [h.role, h.dir]), [['outlet', 'up']]);
  // bed: the pump stands in the tower and lifts from the plenum's line to a spout over the pool, a few cm
  assert.ok(run('bedM').lift > 0 && run('bedM').lift < 6);
  assert.deepEqual(run('bedM').hoses.map((h) => [h.role, h.dir]), [['riser', 'up']]);
});

test('B5c: the bed filter needs a false bottom with water over its intake', () => {
  assert.ok(filterFlow(bedE(), 12).lph > 100);
  assert.equal(filterFlow(bedE({ drainage: 0 }), 12).lph, 0, 'no false bottom, no bed');
  assert.equal(filterFlow(bedE({ plenumLevel: PLENUM.intake - 0.1 }), 12).lph, 0, 'the pump in the tower runs dry');
  assert.ok(filterFlow(bedE({ plenumLevel: 10.5 }), 12).lph > 100);
  assert.ok(filterFlow(bedE({ plenumLevel: 6 }), 12).lph < filterFlow(bedE({ plenumLevel: 11 }), 12).lph, 'a lower plenum line is more lift');
});

test('B5c: a running bed filter is the false bottom\'s bio media, not a second set on top of it', () => {
  const E = { drainage: 1, filter: true, filterKind: 'sponge' };
  assert.ok(Math.abs(plenumBio(E) - 0.3) < 1e-9, 'a false bottom is a bed of bio-rings');
  assert.equal(plenumBio({ ...E, filterKind: 'bedM' }), 0, 'running as the filter, it counts through the filter row');
  assert.ok(plenumBio({ ...E, filterKind: 'bedM', filter: false }) > 0, 'switched off it is still a passive bed');
  assert.equal(plenumBio({ drainage: 0 }), 0);
});

// ---- the bed filter's pump in the tower: the false bottom's water, and the litres (sim/plenum.js stepPlenum) ----
import { stepPlenum } from '../src/sim/plenum.js';

test('B5c: the bed filter\'s pump holds the plenum under the pool\'s line, and the pool and the plenum together neither gain nor lose water in a day', () => {
  for (const bed of [false, true]) {
    let poolL = 10.8;                                          // a 30 x 30 cm pool, 0.9 L a cm, 12 cm deep
    const W = {
      terrain: { baseAt: () => 50 },                           // land over the whole mesh
      water: { level: 12, volumeLitres: () => poolL,
        hydro: { pump: { on: false, running: false, lph: 0 }, volumeAt: (h) => 900 * h, solveLevel() { W.water.level = poolL / 0.9; },
          exchange(mL) { poolL += mL / 1000; return mL; } } },
    };
    const E = { drainage: 1, plenumH: 12.5, filter: bed, filterKind: bed ? 'bedM' : 'sponge', filterLph: bed ? 300 : 0, rain: 0, mist: 0, soil: 0.4 };
    stepPlenum(W, E, 10);
    const total0 = poolL + E.plenumL;
    let expect = 0;
    for (let k = 0; k < 143; k++) { const f = stepPlenum(W, E, 10).flows; expect += (f.drip - f.wick - f.drain) * 10; }
    assert.ok(Math.abs(poolL + E.plenumL - total0 - expect) < 1e-6, `${bed ? 'bed' : 'no bed'}: ${poolL + E.plenumL - total0} L against ${expect} L of rain, wicking and drain`);
    if (bed) assert.ok(E.plenumLevel < W.water.level - 2 && E.plenumLevel > PLENUM.intake, `the pump (5 L/min, ${PLENUM.gap} L/min per cm) holds it about 2.5 cm under the pool: ${E.plenumLevel} vs ${W.water.level}`);
    else assert.ok(E.plenumLevel > W.water.level - 0.5, 'without the pump it settles at the pool\'s line');
  }
});

test('B5c: three sizes of each new family: more pump, more power, more money; plain names; the tower pumps as on the maker sheet', () => {
  for (const fam of ['hob', 'internal', 'bed']) {
    const rows = ['S', 'M', 'L'].map((z) => FILTERS[fam + z]);
    assert.ok(rows.every((F) => F.mount === rows[0].mount && /^[A-Z][A-Za-z-]+( [A-Za-z-]+)+$/.test(F.name) && !/\d/.test(F.name)), fam + ': plain names, no model codes');
    assert.equal(new Set(rows.map((F) => F.name)).size, 3);
    for (let i = 1; i < 3; i++) {
      assert.ok(rows[i].pump.lph > rows[i - 1].pump.lph && rows[i].lph > rows[i - 1].lph && rows[i].watts >= rows[i - 1].watts, `${fam}: size ${i} moves more`);
      assert.ok(GEAR[rows[i].gear].price > GEAR[rows[i - 1].gear].price, `${fam}: and costs more`);
    }
    if (fam !== 'bed') assert.ok(rows.every((F) => F.tank?.[0] > 0), fam + ': rated tank volume');
  }
  assert.deepEqual(['bedS', 'bedM', 'bedL'].map((k) => [FILTERS[k].pump.lph, FILTERS[k].pump.hmax, FILTERS[k].watts]), [[300, 60, 7], [600, 100, 7], [1000, 140, 15]]);
  assert.deepEqual(['bedS', 'bedM', 'bedL'].map((k) => FILTERS[k].hose.out), [[12, 16], [12, 16], [16, 22]]);
});

// ---- B5e: real pumps. Every installation's lift against its pump's maximum head, the pump fitted from a ladder of real ones ----
test('B5e: every tank tier x filter kind: lift within 0.8 of its pump\'s head, the working point on its curve, the target met or flagged', () => {
  const keep = { w: TANK.w, d: TANK.d, h: TANK.h };
  try {
    for (const t of TANK_ORDER) {
      Object.assign(TANK, { w: TANKS[t].w, d: TANKS[t].d, h: TANKS[t].h });
      for (const level of [12, TANKS[t].h * 0.5]) for (const k of Object.keys(FILTERS)) {
        const r = run(k, 0, level), at = `${t} ${k} at ${level} cm`;
        assert.ok(r.pump?.hmax > 0 && !r.blocked, at);
        assert.ok(r.lift <= LIFT_MARGIN * r.pump.hmax || r.undersized, `${at}: lift ${r.lift} against ${r.pump.name} ${r.pump.hmax} cm, not flagged`);
        assert.ok(Math.abs(r.pump.lph * filterPumpCurve(r.head, r.pump.hmax) - r.lph) < 0.5, `${at}: on the curve`);
        assert.ok(r.lph >= r.target * 0.97 || r.undersized, `${at}: ${r.lph} of ${r.target} L/h, not flagged`);
        if (r.lift >= r.pump.hmax) assert.ok(r.lph === 0 && r.low, `${at}: no head is cheated`);
      }
    }
  } finally { Object.assign(TANK, keep); }
});

test('B5e: every pump figure in the data is its row on the sheet', () => {
  const md = readFileSync(new URL('../docs/agents/lizards/FILTER_SHEETS.md', import.meta.url), 'utf8').split('## B5e pump ladder')[1];
  const num = (c) => parseFloat(c.match(/[\d.]+/)?.[0]), seen = new Set();
  for (const l of md.split('\n').filter((s) => /^\| [a-zA-Z]+ \|/.test(s) && !/^\| id /.test(s))) {
    const c = l.split('|').slice(1, -1).map((s) => s.trim()), id = c[0], P = PUMPS[id] ?? FILTERS[id]?.pump;
    assert.ok(P, `${id}: in the data`); seen.add(id);
    assert.equal(P.lph, num(c[3]), `${id}: flow`); assert.equal(P.hmax, Math.round(num(c[4]) * 100), `${id}: head`);
    assert.equal(PUMPS[id] ? P.watts : FILTERS[id].watts, num(c[5]), `${id}: watts`);
    if (PUMPS[id]) assert.ok(P.bore === num(c[6]) && P.name === c[1], `${id}: bore and name`);
  }
  for (const id of PUMP_LADDER) assert.ok(seen.has(id), id);
  for (const [k, F] of Object.entries(FILTERS)) assert.ok(seen.has(k) || Object.values(PUMPS).includes(F.pump), `${k}: its pump has a sheet row`);
});

test('B5e: a hang-on-back with the water far under the rim moves nothing, and the size a tank needs comes from its water', () => {
  assert.equal(TANK.h, 60);
  const low = run('hobM', 0, 12);
  assert.ok(low.lph === 0 && low.low && low.undersized && low.need === null, `52 cm of lift: ${low.lift}`);
  assert.ok(run('hobM').lph > 0 && !run('hobM').undersized);
  const E = { filter: true, filterKind: 'internalS', filterDirt: 0, mediaBio: 0.5 };
  assert.ok(!filterFlow(E, 12, CABINET_DROP, 20).undersized && filterFlow(E, 12, CABINET_DROP, 2000).undersized, '4 x the water an hour');
  assert.match(filterFlow(E, 12, CABINET_DROP, 110).need ?? '', /^Internal filter (Cobble|Boulder)$/);
  E.filterKind = 'sponge';
  assert.ok(filterFlow(E, 12, CABINET_DROP, 100).small && !filterFlow(E, 12, CABINET_DROP, 20).small, 'a fitted pump cannot make a small filter big');
});
