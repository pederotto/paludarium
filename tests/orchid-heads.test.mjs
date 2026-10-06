// The Blender-made orchid assets (art-src/orchids -> src/sim/orchid-heads.js, public/assets/orchids/*.webp): the generated heads are consistent,
// every atlas coordinate lands inside a tile or is -1, nothing sits behind a head's origin (a bud folds about it), and the shipped maps are
// WebP files with power-of-two sides no bigger than 1024.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEADS } from '../src/sim/orchid-heads.js';
import { FLOWERING } from '../src/sim/flowering.js';
import { Builder } from '../src/render/geo.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPECIES = ['dracula', 'cuthbertsonii', 'masdevallia'];

test('each Blender head is consistent: array lengths, triangle indices, masks, leaf coordinates, atlas coordinates', () => {
  for (const id of SPECIES) {
    const H = HEADS[id], n = H.pos.length / 3;
    assert.ok(H, id);
    assert.equal(H.nor.length, n * 3, id); assert.equal(H.uv.length, n * 2, id); assert.equal(H.msk.length, n * 2, id); assert.equal(H.at.length, n * 2, id);
    assert.equal(H.idx.length % 3, 0, id);
    assert.ok(H.idx.length / 3 <= 480, `${id}: ${H.idx.length / 3} triangles`);
    for (const k of H.idx) assert.ok(Number.isInteger(k) && k >= 0 && k < n, `${id}: index ${k}`);
    let atlas = 0;
    for (let i = 0; i < n; i++) {
      const r = H.msk[2 * i], g = H.msk[2 * i + 1];
      assert.ok(r >= 0 && g >= 0 && r + g <= 1 + 1e-9, `${id}: mask ${r},${g}`);
      const u = H.uv[2 * i], v = H.uv[2 * i + 1];
      assert.ok(v === -1 || (v >= 0 && v <= 1 && u >= -1 && u <= 1), `${id}: leaf ${u},${v}`);
      const ax = H.at[2 * i], ay = H.at[2 * i + 1];
      if (ax < 0) assert.equal(ay, -1, id);
      else { atlas++; assert.ok(ax > 0 && ax < 1 && ay > 0 && ay < 0.125, `${id}: atlas ${ax},${ay} (band 0 of 8 until the shader adds the band)`); }
      assert.ok(Math.abs(Math.hypot(H.nor[3 * i], H.nor[3 * i + 1], H.nor[3 * i + 2]) - 1) < 0.05, `${id}: unit normal`);
    }
    assert.ok(atlas > n * 0.4, `${id}: the petals carry atlas coordinates (${atlas} of ${n})`);
  }
});

test('no vertex of a head sits behind its origin (the bud fold) and the species build the same heads', () => {
  for (const id of SPECIES) {
    const b = new Builder(); FLOWERING[id].flower.build(b);
    const g = b.build();
    assert.equal(g.attributes.position.count, HEADS[id].idx.length, id);
    assert.ok(g.attributes.atlas && g.attributes.atlas.count === g.attributes.position.count, `${id}: the geometry carries the atlas attribute`);
    g.computeBoundingBox();
    assert.ok(g.boundingBox.min.y > -0.31, `${id}: min y ${g.boundingBox.min.y}`);
  }
});

test('the shipped orchid maps are WebP, power-of-two sides, at most 1024', async () => {
  const sharp = (await import('sharp')).default, dir = path.join(ROOT, 'public', 'assets', 'orchids');
  const files = ['petals', 'petals_n', ...['pleurothallis', 'masdevallia', 'dracula', 'cuthbertsonii'].flatMap((s) => ['leaf', 'relief', 'tint'].map((k) => `${s}-${k}`))];
  const pow2 = (x) => x > 0 && (x & (x - 1)) === 0;
  for (const f of files) {
    const p = path.join(dir, f + '.webp');
    assert.ok(fs.existsSync(p), p);
    const m = await sharp(p).metadata();
    assert.equal(m.format, 'webp', f);
    assert.ok(pow2(m.width) && pow2(m.height) && m.width <= 1024 && m.height <= 1024, `${f}: ${m.width}x${m.height}`);
  }
});
