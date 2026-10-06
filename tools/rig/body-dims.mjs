// A baked body's dimensions, measured the same way for any body: per bone the radial distance of the vertices it owns from its axis, and along the
// trunk (snout 0 ... vent 1) the width and height of the trunk's own vertices. Used to adapt one scan's girth to another's (tools/bake-frogpose.mjs `conform`).
//   node tools/rig/body-dims.mjs <manifest id> [--dir=<folder with manifest.json and the glb>]
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
const TRUNK = ['pelvis', 'spine', 'spineB', 'head'];

// The measures from vertex positions P (cm), each vertex's dominant bone index `dom` and the bones B ({ name, head, tail } in the same cm).
export function measure(P, dom, B) {
  const n = P.length;
  const axisDist = (p, b) => {
    const h = B[b].head, t = B[b].tail, d = t.map((v, k) => v - h[k]), l2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
    const u = Math.max(0, Math.min(1, ((p[0] - h[0]) * d[0] + (p[1] - h[1]) * d[1] + (p[2] - h[2]) * d[2]) / l2));
    return Math.hypot(...p.map((v, k) => v - h[k] - d[k] * u));
  };
  const per = {};
  for (let i = 0; i < n; i++) (per[B[dom[i]].name] ??= []).push(axisDist(P[i], dom[i]));
  const bones = Object.fromEntries(Object.entries(per).map(([k, a]) => [k, { n: a.length, r50: +q(a, 0.5).toFixed(3), r75: +q(a, 0.75).toFixed(3), r90: +q(a, 0.9).toFixed(3) }]));
  // the trunk: the vertices the trunk bones own, in 8 stations along z from the snout to the vent
  const idx = P.map((_, i) => i).filter((i) => TRUNK.includes(B[dom[i]].name));
  const zs = idx.map((i) => P[i][2]), z0 = Math.min(...zs), z1 = Math.max(...zs), st = [];
  for (let k = 0; k < 8; k++) {
    const a = z1 - (k + 1) * (z1 - z0) / 8, b = z1 - k * (z1 - z0) / 8, v = idx.filter((i) => P[i][2] >= a && P[i][2] < b + 1e-9);
    if (v.length < 8) { st.push(null); continue; }
    const xs = v.map((i) => Math.abs(P[i][0])), ys = v.map((i) => P[i][1]);
    st.push({ t: +((k + 0.5) / 8).toFixed(3), halfWidth: +q(xs, 0.95).toFixed(3), height: +(q(ys, 0.97) - q(ys, 0.03)).toFixed(3), yc: +((q(ys, 0.97) + q(ys, 0.03)) / 2).toFixed(3) });
  }
  return { bones, trunk: st, length: +(z1 - z0).toFixed(2), z0, z1 };
}

// A baked body from the creature folder (meshopt-compressed GLB, manifest skeleton in cm).
export async function bodyDims(id, dir = 'public/assets/creatures/') {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const man = JSON.parse(fs.readFileSync(dir + 'manifest.json', 'utf8'))[id], doc = await io.read(dir + man.file);
  const node = doc.getRoot().listNodes().find((nd) => nd.getMesh()), M = node.getWorldMatrix(), pr = node.getMesh().listPrimitives()[0];
  const n = pr.getAttribute('POSITION').getCount(), el = [], P = [], dom = [];
  for (let i = 0; i < n; i++) {
    pr.getAttribute('POSITION').getElement(i, el);
    P.push([0, 1, 2].map((r) => (M[r] * el[0] + M[4 + r] * el[1] + M[8 + r] * el[2] + M[12 + r]) * 100));
    pr.getAttribute('_SKIN').getElement(i, el);
    dom.push(Math.round(el[el[2] >= 0.5 ? 0 : 1] * 32));
  }
  return measure(P, dom, man.skeleton.bones);
}

if (process.argv[1].endsWith('body-dims.mjs')) {
  const id = process.argv[2], dir = (process.argv.find((a) => a.startsWith('--dir=')) ?? '').slice(6);
  const d = await bodyDims(id, dir ? dir.replace(/\/?$/, '/') : undefined);
  console.log(id, 'trunk length', d.length, 'cm');
  for (const [k, v] of Object.entries(d.bones)) console.log(' ', k.padEnd(9), JSON.stringify(v));
  console.log(' trunk stations (snout -> vent):');
  for (const s of d.trunk) console.log('  ', JSON.stringify(s));
}
