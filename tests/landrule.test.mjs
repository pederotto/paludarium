// The land/water rule of the land-frog terrariums (owner, 8 Oct 2026): a species with `landTol` wants the USABLE land share (objects
// and plants count half, World.usable) within that tolerance of its `land`. The measure itself needs a world (tools/steps/land-rule.mjs);
// the rule's data and wording are checked here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { landBand, landFits, landWhy } from '../src/sim/habitat.js';

// animals.js needs a browser (three/webgpu): the frogs' land data is read from its source, species block by species block.
const SRC = fs.readFileSync(new URL('../src/sim/animals.js', import.meta.url), 'utf8');
const SPECIES = {}, body = SRC.slice(SRC.indexOf('export const SPECIES')), starts = [...body.matchAll(/\n  ([a-z0-9]+): \{\n    name:/g)];
starts.forEach((m, i) => {
  const b = body.slice(m.index, starts[i + 1]?.index ?? body.length), num = (k) => { const x = b.match(new RegExp(`\\b${k}: ([0-9.]+)`)); return x ? +x[1] : undefined; };
  SPECIES[m[1]] = { group: b.match(/group: '([^']*)'/)?.[1], kind: b.match(/kind: '([^']*)'/)?.[1], land: num('land'), landTol: num('landTol') };
});

test('every frog and toad has a strict land band, and every band is a sane share', () => {
  const frogs = Object.entries(SPECIES).filter(([, s]) => s.group === 'Amphibians' && (s.kind === 'frog' || s.kind === 'toad'));
  assert.ok(frogs.length >= 9, 'the frogs the game has');
  for (const [id, s] of frogs) {
    assert.ok(s.land != null && s.landTol != null, `${id} has no land share and tolerance`);
    const [lo, hi] = landBand(s);
    assert.ok(lo >= 0 && hi <= 1 && hi - lo >= 0.15 && hi - lo <= 0.45, `${id} band ${lo}..${hi}`);
  }
});

test('the band is land +- tol, clamped, and the verdict and the wording agree', () => {
  const sp = { land: 0.5, landTol: 0.1 };
  assert.deepEqual(landBand(sp).map((v) => +v.toFixed(2)), [0.4, 0.6]);
  assert.equal(landFits(sp, { share: 0.4 }), true);
  assert.equal(landFits(sp, { share: 0.6 }), true);
  assert.equal(landFits(sp, { share: 0.39 }), false);
  assert.equal(landFits(sp, { share: 0.61 }), false);
  assert.match(landWhy(sp, { share: 0.25 }), /too little land: 25% .*count half.* 40 to 60%/);
  assert.match(landWhy(sp, { share: 0.8 }), /too little water: 80%/);
  assert.deepEqual(landBand({ land: 0.95, landTol: 0.1 }).map((v) => +v.toFixed(2)), [0.85, 1]);
});

test('the dart frogs, which had no land share, are dry-footed: mostly land, a little water', () => {
  for (const id of ['dartfrog', 'strawberry', 'leucomelas', 'auratus']) {
    const [lo, hi] = landBand(SPECIES[id]);
    assert.ok(lo >= 0.6 && hi <= 0.95, `${id} ${lo}..${hi}`);
  }
});
