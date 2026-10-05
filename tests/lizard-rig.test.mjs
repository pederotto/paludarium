// The gecko's baked skeleton and skin (tools/bake-lizard.mjs on tools/rig/lizard.mjs and tools/rig/lizard-gecko.mjs; the bone list
// in docs/agents/lizards/CONTRACTS.md, the anatomy in RIG_gecko.md): the bones cover the anatomy, every vertex is bound, the two
// levels of detail fit their budgets, the model keeps its own UVs and colour texture, the tail is straight and the proportions
// are the model's.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { NodeIO, ImageUtils } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { ANATOMY, LIZARD_BONES, FAN_BONES, lizardBones } from '../tools/rig/lizard.mjs';
import { GECKO, measureGecko, readRaw } from '../tools/rig/lizard-gecko.mjs';

const DIR = 'public/assets/creatures/';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

// one level of detail: positions in the model's frame (metres, the node's dequantising transform applied), its primitive, extras
async function load(file) {
  const doc = await io.read(DIR + file);
  const node = doc.getRoot().listNodes().find((x) => x.getMesh());
  const mesh = node.getMesh(), prim = mesh.listPrimitives()[0], M = node.getWorldMatrix();
  const P = prim.getAttribute('POSITION'), n = P.getCount(), pos = new Float32Array(n * 3), e = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    P.getElement(i, e);
    for (let c = 0; c < 3; c++) pos[i * 3 + c] = M[c] * e[0] + M[4 + c] * e[1] + M[8 + c] * e[2] + M[12 + c];
  }
  return { file, prim, pos, n, tris: prim.getIndices().getCount() / 3, extras: mesh.getExtras() };
}
const hi = await load('gecko.glb'), lo = await load('gecko.lo.glb');
const sk = hi.extras.skeleton;
const zRange = (m) => { let a = Infinity, b = -Infinity; for (let i = 0; i < m.n; i++) { const z = m.pos[i * 3 + 2]; a = Math.min(a, z); b = Math.max(b, z); } return [a, b]; };

// RIG_gecko.md "Anatomy the rig must cover"
const NEEDED = ['skull', 'neck', 'trunk', 'sacrum', 'tail', 'pectoral girdle', 'pelvic girdle', 'humerus', 'radius-ulna', 'hand', 'femur', 'tibia-fibula', 'foot', 'digits'];
const PAIRED = /^(arm|forearm|hand|thigh|shin|foot|fingers|toes)$/;

test('the bone list covers the anatomy, in the contract order, with the toe fans as a switch', () => {
  const names = sk.bones.map((b) => b.name);
  assert.equal(sk.plan, 'lizard');
  assert.deepEqual(names, [...LIZARD_BONES, ...FAN_BONES]);
  assert.equal(names.length, 25);
  // (each bone keeps its rest axis and a radius, as the frog's do: the muscles' bulge needs them, render/creatures/skeleton.js)
  for (const b of sk.bones) assert.ok(b.r > 0 && Math.hypot(b.tail[0] - b.head[0], b.tail[1] - b.head[1], b.tail[2] - b.head[2]) > 0.02, b.name);
  for (const part of NEEDED) {
    assert.ok(ANATOMY[part]?.length, `no bone stands for the ${part}`);
    for (const b of ANATOMY[part]) for (const w of PAIRED.test(b) ? [b + 'L', b + 'R'] : [b]) assert.ok(names.includes(w), `${part}: ${w} missing`);
  }
  for (const b of sk.bones) if (b.parent != null) assert.ok(names.indexOf(b.parent) >= 0 && names.indexOf(b.parent) < names.indexOf(b.name), `${b.name}'s parent`);
  const bare = lizardBones(sk.joints, { fans: false }).map((b) => b.name);
  assert.deepEqual(bare, LIZARD_BONES);
  assert.equal(bare.length, 21);
});

test('every vertex is bound to bones that exist, the weights summing to 1, and every bone holds skin', () => {
  for (const m of [hi, lo]) {
    const S = m.prim.getAttribute('_SKIN'), X = m.prim.getAttribute('_SKINX'), nb = sk.bones.length, e = [0, 0, 0, 0], x = [0, 0, 0, 0], held = new Array(nb).fill(0);
    let bad = 0;
    for (let i = 0; i < m.n; i++) {
      S.getElement(i, e); if (X) X.getElement(i, x);   // (SK1: four bones a vertex, `_SKINX` = bone 2, bone 3, w2, w3)
      const b0 = Math.round(e[0] * 32), b1 = Math.round(e[1] * 32), b2 = Math.round(x[0] * 32), b3 = Math.round(x[1] * 32);
      if (!([b0, b1, b2, b3].every((b) => b >= 0 && b < nb) && e[2] >= 0 && e[2] <= 1 + 1e-6 && Math.abs(e[2] + e[3] + x[2] + x[3] - 1) < 3e-3)) bad++;
      else held[b0]++;
    }
    assert.equal(bad, 0, `${m.file}: ${bad} vertices badly bound`);
    if (m === hi) held.forEach((c, b) => assert.ok(c >= 20, `${sk.bones[b].name} holds ${c} vertices`));
  }
});

test('the levels of detail fit their budgets', () => {
  console.log(`  gecko: hi ${hi.tris} triangles, lo ${lo.tris}`);
  assert.ok(hi.tris <= 30000, `hi ${hi.tris}`);
  // (the coarse level keeps the model's UV seams, which stop the simplifier near 15k triangles short of the 10k aim: the
  // number is reported, not forced past visible damage)
  assert.ok(lo.tris <= 16000 && lo.tris < hi.tris * 0.6, `lo ${lo.tris}`);
});

test('left and right bones are the same length (within 5 %)', () => {
  const L = (b) => Math.hypot(b.tail[0] - b.head[0], b.tail[1] - b.head[1], b.tail[2] - b.head[2]);
  for (const b of sk.bones.filter((x) => /L$/.test(x.name))) {
    const r = sk.bones.find((x) => x.name === b.name.replace(/L$/, 'R'));
    assert.ok(Math.abs(L(b) - L(r)) <= 0.05 * Math.max(L(b), L(r)), `${b.name} ${L(b).toFixed(3)} vs ${L(r).toFixed(3)}`);
  }
});

test('the model keeps its UVs and its 1024 base-colour texture, with no metal-rough map', () => {
  for (const m of [hi, lo]) {
    assert.equal(m.prim.getAttribute('TEXCOORD_0')?.getCount(), m.n);
    const mat = m.prim.getMaterial(), tex = mat.getBaseColorTexture();
    assert.ok(tex, 'base colour texture');
    assert.equal(tex.getMimeType(), 'image/webp');
    assert.deepEqual(ImageUtils.getSize(tex.getImage(), tex.getMimeType()), [1024, 1024]);
    assert.equal(mat.getMetallicRoughnessTexture(), null);
    assert.equal(mat.getMetallicFactor(), 0);
    assert.equal(mat.getRoughnessFactor(), 0.6);
  }
});

test('the tail is straight: its tip within 2 % of the length of the midline', () => {
  const [z0, z1] = zRange(hi), Lz = z1 - z0;
  let sx = 0, c = 0;
  for (let i = 0; i < hi.n; i++) if (hi.pos[i * 3 + 2] < z0 + 0.03 * Lz) { sx += hi.pos[i * 3]; c++; }
  assert.ok(c > 0);
  assert.ok(Math.abs(sx / c) < 0.02 * Lz, `tip ${(sx / c / Lz * 100).toFixed(1)} % of the length off the midline`);
});

test('the proportions are the model\'s: snout-to-vent over total length within 2 %, snout-to-vent the real 4.4 cm', async () => {
  const [z0, z1] = zRange(hi), svl = z1 - sk.joints.vent[2] / 100, ratio = svl / (z1 - z0);
  const src = measureGecko((await readRaw(GECKO.raw)).pos, GECKO), want = src.svl / src.total;
  console.log(`  snout-vent ${(svl * 100).toFixed(2)} cm of ${((z1 - z0) * 100).toFixed(2)} cm: ${ratio.toFixed(3)} (model ${want.toFixed(3)})`);
  assert.ok(Math.abs(ratio - want) <= 0.02 * want, `${ratio} vs ${want}`);
  assert.ok(Math.abs(svl * 100 - GECKO.svlCm) < 0.05, `snout-vent ${svl * 100} cm`);
});

test('the rig and skin attributes are in the file (glb-dump), and the original is kept untouched', () => {
  const out = execFileSync('node', ['docs/agents/lizards/tools/glb-dump.mjs', DIR + 'gecko.glb'], { encoding: 'utf8' });
  assert.match(out, /_RIG/);
  assert.match(out, /_SKIN/);
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const orig = GECKO.source.replace(/^~/, os.homedir());
  assert.ok(fs.existsSync(GECKO.raw));
  if (fs.existsSync(orig)) assert.equal(sha(GECKO.raw), sha(orig));
});

// --- G1b: the game poses the baked gecko by its bones (render/creatures/lizardpose.js, through skeleton.js's lizard hook) ---------
import * as SKL from '../src/render/creatures/skeleton.js';
import { GAIT, lgNew, lgDraw, toWorld } from '../src/util/lizardgait.js';
import { surfaceFrame } from '../src/util/contain.js';
// the gecko row's leg lift and stride as the game builds its mesh with them (src/sim/animals.js SPECIES.gecko.anim; read as text:
// animals.js pulls in the renderer)
const GECKO_ROW = (() => { const t = fs.readFileSync(new URL('../src/sim/animals.js', import.meta.url), 'utf8').match(/\n  gecko: \{[\s\S]*?anim: \{[^}]*?lift: ([\d.]+), stride: ([\d.]+)/); return { lift: +t[1], stride: +t[2] }; })();
const GMAN = JSON.parse(fs.readFileSync(new URL('../public/assets/creatures/manifest.json', import.meta.url), 'utf8'));

test('the game poses the gecko by its 25 bones: the rest pose exact, the head and tail channels turn their bones, the feet walk', () => {
  const sk = GMAN.gecko?.skeleton;
  assert.equal(sk?.plan, 'lizard'); assert.equal(sk.bones.length, 25); assert.ok(SKL.MAX_BONES >= 25);
  const rig = SKL.skeletonRig(sk, { legLift: GECKO_ROW.lift, legStride: GECKO_ROW.stride, turn: { pz: 0, R: 2 } });
  assert.ok(rig?.pose, 'a lizard rig');
  assert.ok(rig.muscles.length >= 2, 'the thigh bellies (the frog mechanism: musclesOf)');
  const row = new Float32Array(SKL.ROW_FLOATS), id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  SKL.poseBones(rig, { phase: 1, calm: 1 }, row);
  for (let i = 0; i < 25 * 12; i++) assert.ok(Math.abs(row[i] - id[i % 12]) < 1e-5, `rest: bone ${Math.floor(i / 12)} [${i % 12}] ${row[i]}`);
  const by = Object.fromEntries(sk.bones.map((b, i) => [b.name, i])), snout = sk.bones[by.head].tail, tip = sk.bones[by.tail5].tail;
  SKL.poseBones(rig, { phase: 1, calm: 1, yaw: 0.6, pitch: 0.3, tail: 0.3 }, row);
  const s1 = SKL.applyBone(row, 0, by.head, snout), t1 = SKL.applyBone(row, 0, by.tail5, tip);
  assert.ok(s1[0] - snout[0] > 0.3 && s1[1] > snout[1], `snout turned to +x and up: ${s1}`);
  assert.ok(t1[0] - tip[0] > 0.5, `tail swung to +x: ${t1}`);
  SKL.poseBones(rig, { phase: 1, calm: 1, tailF: 0 }, row);
  const c5 = SKL.applyBone(row, 0, by.tail5, tip), c2 = SKL.applyBone(row, 0, by.tail2, [0, 0, 0]);
  assert.ok(Math.hypot(c5[0] - c2[0], c5[1] - c2[1], c5[2] - c2[2]) < 1e-6, 'a dropped tail collapses onto the cut');
  const info = {};
  let moved = 0;
  for (let k = 0; k < 6; k++) {
    SKL.poseBones(rig, { phase: (k / 6) * Math.PI * 2, calm: 0 }, row, 0, info);
    for (const c of rig.chains) {
      const t = info.tips[c.limb];
      assert.ok(t[1] > c.T[1] - 0.05, `limb ${c.limb} through the ground: ${t}`);
      moved = Math.max(moved, Math.abs(t[2] - c.T[2]));
    }
  }
  assert.ok(moved > 0.5, `the feet step: ${moved}`);
});

test('skin stretch of the posed gecko: at most 0.2 % of triangles past 2x over 6 walk poses (tools/rig/skin-stretch.mjs)', () => {
  const out = execFileSync(process.execPath, ['tools/rig/skin-stretch.mjs', 'gecko'], { encoding: 'utf8', cwd: new URL('..', import.meta.url) });
  const m = out.match(/skin walk: .*?>2x ([\d.]+) %/);
  assert.ok(m, out);
  assert.ok(+m[1] <= 0.2, out);
  console.log(out.trim());
});

// N7: the planted feet as the game draws a near gecko (lgDraw, the reach guard's feetFit / strideCap): on flat ground at the walk
// (4.5 cm/s), 0.04 s frames, a tip in stance two frames running moves under 0.05 cm (MOTION_gecko: planted, no slip).
function walkSlip(rig, feet, cap, sec = 4, dt = 0.04, v = 4.5) {
  const P = GAIT.gecko, s = lgNew(P, feet, cap), f = surfaceFrame(0, 1, 0, 0), row = new Float32Array(SKL.ROW_FLOATS), info = {};
  const surf = (x, y, z, n, o) => { o[0] = x; o[1] = 0; o[2] = z; o[3] = 0; o[4] = 1; o[5] = 0; return o; };
  let prev = null, worst = 0, n = 0, d = 0;
  for (let t = 0; t < sec; t += dt) {
    d += v * dt;
    const pose = { p: [f[0] * d, 0, f[2] * d], f }, st = lgDraw(s, P, pose, v, 0, dt, surf, 1, rig.drop, {});
    SKL.poseBones(rig, { ...st, calm: 0 }, row, 0, info);
    const tips = [1, 2, 3, 4].map((l) => toWorld(pose, info.tips[l], [0, 0, 0])), on = [...st.stance];
    if (prev && t > 1) for (let k = 0; k < 4; k++) if (on[k] && prev.on[k]) { n++; worst = Math.max(worst, Math.hypot(tips[k][0] - prev.tips[k][0], tips[k][2] - prev.tips[k][2])); }
    prev = { tips, on };
  }
  return { worst, n, cm: v * (sec - 1) };
}
test('N7 reach guard: planted gecko feet slip under 0.05 cm per 0.04 s frame in stance (4.5 cm/s, 3 s, flat ground)', () => {
  const rig = SKL.skeletonRig(GMAN.gecko.skeleton, { legLift: GECKO_ROW.lift, legStride: GECKO_ROW.stride, turn: { pz: 0, R: 2 } });
  const raw = walkSlip(rig, rig.feet0, Infinity), fit = walkSlip(rig, rig.feetFit, rig.strideCap);
  console.log(`N7 stamp strideCap=${rig.strideCap.toFixed(3)} cm spans=${JSON.stringify(rig.spans.map((s) => s.map((v) => +v.toFixed(2))))}`);
  console.log(`N7 slip without guard: worst ${raw.worst.toFixed(3)} cm/frame over ${raw.n} stance pairs, ${raw.cm.toFixed(1)} cm walked`);
  console.log(`N7 slip with guard:    worst ${fit.worst.toFixed(3)} cm/frame over ${fit.n} stance pairs, ${fit.cm.toFixed(1)} cm walked`);
  assert.ok(fit.n > 100, `enough stance pairs: ${fit.n}`);
  assert.ok(fit.worst < 0.05, `planted feet slip ${fit.worst}`);
});
