// The fire salamander's tail centreline from the baked mesh: the middle of each cross-section (x and y extents) along z, in the baked frame (cm),
// against the bones' tail joints. Prints the slice centres at the joints' z and the section sizes.
//   node tools/rig/firesal-tail.mjs [path to a plain GLB (tools/rig/firesal-plain.mjs)]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import fs from 'node:fs';
const glb = process.argv[2] ?? '../firesal/blender/firesal_hi.glb', sk = JSON.parse(fs.readFileSync('../firesal/blender/firesal.bones.json', 'utf8'));
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(glb);
const node = doc.getRoot().listNodes().find((n) => n.getMesh()), s = node.getScale(), t = node.getTranslation();
const pos = node.getMesh().listPrimitives()[0].getAttribute('POSITION'), n = pos.getCount(), P = [];
for (let i = 0; i < n; i++) { const v = pos.getElement(i, []); P.push([(v[0] * s[0] + t[0]) * 100, (v[1] * s[1] + t[1]) * 100, (v[2] * s[2] + t[2]) * 100]); }
const slice = (z, h = 0.12) => { const S = P.filter((p) => Math.abs(p[2] - z) < h); if (!S.length) return null; const mm = (k) => [Math.min(...S.map((p) => p[k])), Math.max(...S.map((p) => p[k]))]; const [x0, x1] = mm(0), [y0, y1] = mm(1); return { cx: +((x0 + x1) / 2).toFixed(2), cy: +((y0 + y1) / 2).toFixed(2), w: +(x1 - x0).toFixed(2), h: +(y1 - y0).toFixed(2), y0: +y0.toFixed(2), y1: +y1.toFixed(2) }; };
const B = Object.fromEntries(sk.bones.map((b) => [b.name, b])), out = [];
const J = { sacrum: B.pelvis.head, mid: B.spine.head, chest: B.spine.tail, nape: B.neck.tail, snout: B.head.tail,
  tail: [B.tail1.head, B.tail1.tail, B.tail2.tail, B.tail3.tail, B.tail4.tail, B.tail5.tail] };
console.log('joint z   bone (x, y)        mesh centre (x, y)   section w x h   (y range)');
for (const [i, p] of J.tail.entries()) { const c = slice(p[2]); out.push(c && [c.cx, c.cy, p[2]]); console.log(`tail${i} z${String(p[2]).padStart(7)}  (${p[0]}, ${p[1]})`.padEnd(34), c ? `(${c.cx}, ${c.cy})  ${c.w} x ${c.h}  (${c.y0}..${c.y1})` : 'none'); }
for (const k of ['sacrum', 'mid', 'chest', 'nape', 'snout']) { const p = J[k], c = slice(p[2]); console.log(k.padEnd(8), `z${String(p[2]).padStart(7)}  (${p[0]}, ${p[1]})`.padEnd(26), c ? `(${c.cx}, ${c.cy})  ${c.w} x ${c.h}  (${c.y0}..${c.y1})` : 'none'); }
console.log('tail centre line', JSON.stringify(out.map((c) => c && [c[0], c[1], c[2]])));
