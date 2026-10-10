// The owner's Meshy models baked through tools/bake-creature.mjs (9 Oct 2026): the hillstream loach, the Matano shrimp and the Mexican dwarf
// crayfish. Each file must carry the rig the game's shader reads (_RIG: spine, leg id / rigLeg, legT, material id / 8), in the ids its species
// moves with, and its manifest entry the finish that drives it. A bake that lost a limb (a piece not found, a part not labelled) fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const DIR = new URL('../public/assets/creatures/', import.meta.url);
const man = JSON.parse(fs.readFileSync(new URL('manifest.json', DIR), 'utf8'));
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

// the whole numbers the shader gets back from the file's _RIG attribute: which leg ids and material ids the model carries, and how many vertices of each
async function rigIds(file, legDiv) {
  const doc = await io.read(new URL(file, DIR).pathname.replace(/%20/g, ' '));
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0], r = prim.getAttribute('_RIG'), legs = {}, mats = {}, v = [0, 0, 0, 0];
  for (let i = 0; i < r.getCount(); i++) {
    r.getElement(i, v);
    const l = Math.round(v[1] * legDiv), m = Math.round(v[3] * 8);
    legs[l] = (legs[l] ?? 0) + 1; mats[m] = (mats[m] ?? 0) + 1;
    assert.ok(v[0] >= -1e-3 && v[0] <= 1.001 && v[2] >= -1e-3 && v[2] <= 1.001, `${file}: spine and legT stay in 0 … 1`);
  }
  return { legs, mats, n: r.getCount(), uv: !!prim.getAttribute('TEXCOORD_0'), tex: doc.getRoot().listTextures().length };
}

test('the hillstream loach is the owner\'s Meshy model: textured, fin membranes marked, 6.5 cm', async () => {
  const m = man.hillloach;
  assert.equal(m.rig, 'baked'); assert.equal(m.legs, false);
  assert.ok(Math.abs(m.sizeCm[2] - 6.5) < 0.1, 'nose to tail tip 6.5 cm');
  assert.ok(m.finish.finOpacity > 0.5 && m.finish.finOpacity <= 1, 'finOpacity says how dense the fins are');
  assert.equal(m.finish.eyes, undefined, 'its eyes are in the texture, not analytic');
  const r = await rigIds(m.file, 8);
  assert.ok(r.uv && r.tex === 1, 'one UV map and one colour texture');
  assert.ok(r.mats[0] > 3000, 'skin vertices (material 0)');
  assert.ok(r.mats[2] > 0.15 * r.n && r.mats[2] < 0.5 * r.n, `fin membrane vertices (material 2): ${r.mats[2]} of ${r.n}`);
  assert.deepEqual(Object.keys(r.legs), ['0'], 'a fish has no legs');
  assert.ok(m.tris.hi <= 14500 && m.tris.lo <= 5200, 'within the fish budget');
});

test('the Matano shrimp carries the dwarf shrimp\'s rig: pincers, walking legs, antennae, swimmerets, eggs', async () => {
  const m = man.matanoshrimp;
  assert.equal(m.rig, 'baked'); assert.equal(m.rigLeg, 16);
  const r = await rigIds(m.file, 16);
  for (const id of [1, 2, 3, 4, 7, 8, 10, 14, 15, 16]) assert.ok(r.legs[id] > 20, `leg id ${id} has vertices (${r.legs[id] ?? 0})`);
  assert.ok(r.legs[0] > 1500, 'the body');
  const inv = m.finish.invert;
  assert.ok(inv.curl.flick && inv.curl.len > 0.5 && inv.eggs, 'tail flick pivot and the egg clutch\'s fold point');
  assert.equal(m.finish.eyes.length, 1, 'one analytic eye (the shader mirrors it)');
  assert.ok(m.sizeCm[2] < 4.5, 'about 2.4 cm of body, the antennae extra');
});

test('the Mexican dwarf crayfish has two claws that pinch, walking legs, antennae and a flat tail fan', async () => {
  const m = man.cambarellus;
  assert.equal(m.rig, 'baked'); assert.equal(m.rigLeg, 16);
  const r = await rigIds(m.file, 16);
  for (const id of [1, 2, 3, 4, 7, 8, 15, 16]) assert.ok(r.legs[id] > 20, `leg id ${id} has vertices (${r.legs[id] ?? 0})`);
  assert.ok(r.legs[15] > 300 && r.legs[16] > 300, 'the claws are big pieces');
  assert.ok(m.finish.claws[5] && m.finish.claws[6], 'the pinch is fitted (tools/rig/claws.mjs clawIds 15, 16)');
  assert.ok(m.finish.invert.curl.flick, 'tail flick pivot');
  assert.equal(m.finish.invert.eggs, undefined, 'no egg clutch');
  // the tail fan was turned flat after painting: the model's rear end is no taller than the carapace (the Meshy fan stands on end)
  assert.ok(m.sizeCm[1] < 1.4, `height ${m.sizeCm[1]} cm`);
});
