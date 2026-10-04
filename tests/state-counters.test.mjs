// The counters over a state dump (tools/steps/state-counters.mjs) on a synthetic dump: each one has an animal that must count and
// one that must not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDump, stuck, pile, waterTime, inSolid, tunnel, coverage, summary } from '../tools/steps/state-counters.mjs';

const EVERY = 10, SIZES = { gecko: 9.5, skink: 16.8 };
// animals: [{ id, sp, at(t) -> partial row | null (not present) }] sampled every 10 s from 0 to 600 s.
function dump(animals, T = 600) {
  const rows = [];
  for (let t = 0; t <= T; t += EVERY) for (const a of animals) {
    const p = a.at(t); if (!p) continue;
    rows.push({ t, day: 0, hour: 6 + t / 3600, id: a.id, uid: 1, sp: a.sp, x: 0, y: 0, z: 0, speed: 0, mode: 'forage', doing: null, awake: 1, onWall: 0, wallMode: 0, perch: null, swim: 0, inWater: 0, inSolid: 0, gx: null, gz: null, gd: null, tun: 0, ...p });
  }
  return rows;
}
const gecko = (id, at) => ({ id, sp: 'gecko', at });

test('stuck: awake with a goal and not moving counts; moving, asleep, goal-less and arrived do not', () => {
  const rows = dump([
    gecko('gecko-0', (t) => ({ x: t < 100 ? t : t < 170 ? 100 : 100 + (t - 160), gd: 5 })),   // moves, still 100..160 (60 s), moves on
    gecko('gecko-1', (t) => ({ x: 3 * t, gd: 5 })),                                         // always moving
    gecko('gecko-2', () => ({ gd: null })),                                                 // still, no goal
    gecko('gecko-3', () => ({ gd: 5, awake: 0 })),                                          // still, asleep
    gecko('gecko-4', () => ({ gd: 0.4 })),                                                  // still, at its goal
  ]);
  const s = stuck(rows, { T: 12 });
  assert.equal(s.count, 1);
  assert.equal(s.episodes[0].id, 'gecko-0');
  assert.equal(s.episodes[0].dur, 60);
  assert.equal(s.bySp.gecko, 1);
  assert.equal(stuck(rows, { T: 100 }).count, 0);
});

test('pile: three awake within a body length for over 5 min counts; sleeping, too short and a pair do not (in awake mode)', () => {
  const near = (i) => ({ x: i * 4, y: 0, z: 0 });                                            // 4 cm apart, skink body 16.8
  const rows = dump([
    { id: 'skink-0', sp: 'skink', at: (t) => (t >= 100 && t <= 500 ? near(0) : { x: -80 }) },
    { id: 'skink-1', sp: 'skink', at: (t) => (t >= 100 && t <= 500 ? near(1) : { x: 80 }) },
    { id: 'skink-2', sp: 'skink', at: (t) => (t >= 100 && t <= 500 ? near(2) : { z: 80 }) },
    gecko('gecko-0', () => ({ x: 300, awake: 0 })), gecko('gecko-1', () => ({ x: 302, awake: 0 })), gecko('gecko-2', () => ({ x: 304, awake: 0 })),   // asleep together
    gecko('gecko-3', () => ({ x: -300 })), gecko('gecko-4', () => ({ x: -302 })),                                                                // a pair
    { id: 'skink-3', sp: 'skink', at: (t) => (t >= 0 && t <= 200 ? { z: -300 } : { z: -200 - t }) },                                               // three together for 200 s only
    { id: 'skink-4', sp: 'skink', at: (t) => (t >= 0 && t <= 200 ? { z: -302 } : { z: -100 - t }) },
    { id: 'skink-5', sp: 'skink', at: (t) => (t >= 0 && t <= 200 ? { z: -304 } : { z: -50 - t }) },
  ]);
  const aw = pile(rows, { sizes: SIZES, awakeOnly: true }), all = pile(rows, { sizes: SIZES });
  assert.equal(aw.count, 1);
  assert.deepEqual(aw.episodes[0].ids.sort(), ['skink-0', 'skink-1', 'skink-2']);
  assert.equal(aw.episodes[0].dur, 400);
  assert.equal(all.count, 2);                                                                  // the sleeping gecko group (600 s) as well
  assert.equal(all.maxDur, 600);
});

test('waterTime: share per species, awake share, day and night', () => {
  const rows = dump([
    { id: 'newt-0', sp: 'newt', at: (t) => ({ inWater: t % 20 === 0 ? 1 : 0, swim: t % 20 === 0 ? 1 : 0 }) },     // half the samples
    { id: 'skink-0', sp: 'skink', at: (t) => ({ inWater: t < 60 ? 1 : 0, awake: t < 60 ? 0 : 1 }) },
    { id: 'gecko-0', sp: 'gecko', at: (t) => ({ hour: t < 300 ? 12 : 23, inWater: t < 300 ? 1 : 0 }) },
  ]);
  const w = waterTime(rows);
  assert.ok(Math.abs(w.newt.share - 31 / 61) < 1e-9);
  assert.equal(w.newt.animals, 1);
  assert.equal(w.skink.shareAwake, 0);                                                         // in the water only while asleep
  assert.ok(w.skink.share > 0.09 && w.skink.share < 0.11);
  assert.equal(w.gecko.dayShare, 1);
  assert.equal(w.gecko.nightShare, 0);
});

test('inSolid and tunnel', () => {
  const rows = dump([
    gecko('gecko-0', (t) => ({ inSolid: t >= 100 && t <= 120 ? 1 : 0, tun: t === 200 ? 2 : 0 })),   // one run of 3 samples, 2 tunnelling steps
    gecko('gecko-1', (t) => ({ tun: t === 300 ? 1 : 0 })),
    gecko('gecko-2', () => ({})),
  ]);
  const s = inSolid(rows);
  assert.deepEqual([s.rows, s.animals, s.episodes], [3, 1, 1]);
  assert.equal(s.bySp.gecko.rows, 3);
  assert.equal(tunnel(rows).total, 3);
  assert.equal(tunnel(rows).bySp.gecko, 3);
});

test('coverage: a late arrival is fine, a missing sample is not, a final animal without rows is not', () => {
  const ok = dump([gecko('gecko-0', () => ({})), gecko('gecko-1', (t) => (t >= 300 ? {} : null)), gecko('gecko-2', () => ({}))]);
  assert.equal(coverage(ok, { alive: ['gecko-0', 'gecko-1'] }).ok, true);
  const gap = ok.filter((r) => !(r.id === 'gecko-0' && r.t === 250));
  const c = coverage(gap);
  assert.equal(c.ok, false);
  assert.deepEqual(c.gaps.map((g) => g.id), ['gecko-0']);
  assert.deepEqual(coverage(ok, { alive: ['gecko-0', 'gecko-9'] }).missing, ['gecko-9']);
});

test('parseDump and summary', () => {
  const rows = dump([gecko('gecko-0', () => ({ gd: 4 })), { id: 'newt-0', sp: 'newt', at: () => ({ inWater: 1, swim: 1 }) }]);
  const text = [{ hdr: 1, sizes: SIZES }, ...rows, { end: 1, alive: ['gecko-0', 'newt-0'] }].map((o) => JSON.stringify(o)).join('\n') + '\n';
  const d = parseDump(text);
  assert.equal(d.rows.length, rows.length);
  assert.equal(d.hdr.sizes.gecko, 9.5);
  assert.deepEqual(d.end.alive, ['gecko-0', 'newt-0']);
  const s = summary(d.rows, d.hdr, d.end);
  assert.equal(s.species.gecko.count, 1);
  assert.equal(s.species.gecko.stuck, 1);
  assert.equal(s.species.newt.water, 1);
  assert.equal(s.coverage.ok, true);
});
