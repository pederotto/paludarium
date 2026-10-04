// sim/filterflow.js: a filter's pump against its head (lift, media clog, hose), the water's speed in each hose, the stages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { filterFlow, hoseSpeed, hoseLoss, stageClogs, pumpHose, HOSES, CABINET_DROP } from '../src/sim/filterflow.js';
import { FILTERS, filterEff } from '../src/content/equipment.js';
import { pumpCurve } from '../src/sim/hydro.js';

const run = (kind, clog = 0, level = 12, o = {}) => filterFlow({ filter: true, filterKind: kind, filterDirt: clog * FILTERS[kind].hold, mediaBio: 0.5, ...o }, level);

test('a clean filter gives about its rated flow at the starter level, and clogging takes most of it', () => {
  for (const kind of Object.keys(FILTERS)) {
    const F = FILTERS[kind], c0 = run(kind, 0).lph, c5 = run(kind, 0.5).lph, c1 = run(kind, 1).lph;
    assert.ok(Math.abs(c0 - F.lph) / F.lph < 0.06, `${kind}: clean ${c0} vs rated ${F.lph}`);
    assert.ok(c0 > c5 && c5 > c1, `${kind}: flow falls as it clogs (${c0} > ${c5} > ${c1})`);
    assert.ok(c1 > F.lph * 0.15 && c1 < F.lph * 0.5, `${kind}: clogged solid it still passes a trickle (${c1})`);
    assert.ok(c0 < F.pump.lph, `${kind}: never more than its pump moves free`);
  }
});

test('an external filter gives less the higher it lifts; the corner foam filter does not care', () => {
  for (const kind of ['sponge', 'canister']) {
    assert.ok(run(kind, 0, 30).lph < run(kind, 0, 12).lph * 0.95, `${kind}: deeper water, more lift`);
    const tall = filterFlow({ filter: true, filterKind: kind, filterDirt: 0 }, 12, CABINET_DROP + 12).lph;
    assert.ok(tall < run(kind, 0, 12).lph, `${kind}: a taller cabinet, more lift`);
    assert.ok(run(kind, 0, 30).head > run(kind, 0, 12).head);
  }
  assert.ok(Math.abs(run('matten', 0, 30).lph - run('matten', 0, 12).lph) < 3);
});

test('the working point sits on the pump curve', () => {
  for (const kind of Object.keys(FILTERS)) {
    const r = run(kind, 0.4), F = FILTERS[kind];
    assert.ok(Math.abs(F.pump.lph * pumpCurve(r.head, F.pump.hmax) - r.lph) < 0.5, kind);
  }
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
  E.filterFlow = filterFlow(E, 12);
  assert.ok(Math.abs(filterEff(E) - E.filterFlow.lph / FILTERS.sponge.lph) < 1e-9);
  E.filterKind = 'canister';
  assert.ok(Math.abs(filterEff(E) - (1 - 0.75 * 12 / 40)) < 1e-9, 'a stale result for another kind is not used');
  assert.equal(filterEff({ filter: false, filterFlow: E.filterFlow }), 0);
});
