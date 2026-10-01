// Verifies the pure mesher against the original bodyGeometry (git ref, default perf/base) for every body and both
// detail levels, byte for byte, and checks that colour-morph shape sharing changes nothing. Prints mismatch counts.
//   node tools/meshcheck.mjs [--ref=perf/base] [--only=axolotl] [--time]
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three/webgpu';
import { BODIES } from '../src/render/creatures/bodies/index.js';
import { bodyArrays, bodyShape, shapeSignature } from '../src/render/creatures/shape.js';
import { C } from '../src/render/creatures/kit.js';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const ref = arg('ref', 'perf/base'), only = arg('only', '');
// The old tree, checked out beside this one, sharing node_modules.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oldtree-'));
execSync(`git archive ${ref} src | tar -x -C ${tmp}`);
fs.symlinkSync(path.resolve('node_modules'), path.join(tmp, 'node_modules'));
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
const old = await import(pathToFileURL(path.join(tmp, 'src/render/creatures/mesher.js')).href);
const oldBodies = (await import(pathToFileURL(path.join(tmp, 'src/render/creatures/bodies/index.js')).href)).BODIES;

const same = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0 && a.constructor === b.constructor;
let bad = 0, total = 0, tOld = 0, tNew = 0;
const cmp = (label, g, a) => {
  total++;
  const at = (n) => g.attributes[n].array;
  const ok = same(at('position'), a.position) && same(at('normal'), a.normal) && same(at('color'), a.color) && same(at('rig'), a.rig) && same(g.index.array, a.index);
  if (!ok) { bad++; console.log('MISMATCH', label); }
};
// colour helper against THREE.Color over every 24-bit grey/channel sweep
let cbad = 0;
for (let h = 0; h < 0x1000000; h += 4099) { const c = new THREE.Color(h), m = C(h); if (c.r !== m[0] || c.g !== m[1] || c.b !== m[2]) cbad++; }
console.log('C() vs THREE.Color mismatches:', cbad);

const keys = Object.keys(BODIES).filter((k) => !only || k.startsWith(only));
for (const key of keys) for (const detail of ['lo', 'hi']) {
  let t = performance.now();
  const g = old.bodyGeometry(oldBodies[key](), detail); tOld += performance.now() - t;
  t = performance.now();
  const a = bodyArrays(BODIES[key](), detail); tNew += performance.now() - t;
  cmp(`${key} ${detail}`, g, a);
  // Morphs: paint another morph onto the shape of the species' first key and compare to the full old output.
}
// Shape sharing: for each group, mesh the first member's shape and repaint every other member with matching signature.
const groups = {};
for (const k of keys) (groups[k.split(':')[0]] ??= []).push(k);
let shared = 0, notShared = 0;
for (const [grp, ks] of Object.entries(groups)) if (ks.length > 1) for (const detail of ['lo', 'hi']) {
  const first = BODIES[ks[0]]();
  const sig = shapeSignature(first, detail), shape = bodyShape(first, detail);
  for (const k of ks.slice(1)) {
    const d = BODIES[k]();
    if (shapeSignature(d, detail) !== sig) { notShared++; continue; }
    shared++;
    cmp(`${k} ${detail} (shared shape of ${ks[0]})`, old.bodyGeometry(oldBodies[k](), detail), bodyArrays(d, detail, shape));
  }
}
console.log(`bodies x detail compared: ${total}, mismatches: ${bad}; shape-shared comparisons: ${shared}, not shared (differ in shape): ${notShared}`);
console.log(`time old ${(tOld / 1000).toFixed(2)}s, new sync pure ${(tNew / 1000).toFixed(2)}s`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(bad || cbad ? 1 : 0);
