// Skull and mandible schemes: the skeleton a mouth is built on (6 Oct 2026, the owner, with a labelled plate of an amphibian skull: "skull and
// mandible should schematically and conceptually follow this to have some realism ... generalise the rule and approach for future mouths").
//
// THE RULE (every animal with a mouth, docs/SKELETON.md "Skulls and mandibles"): before a mouth is cut into a model, the animal gets a SKULL and a
// MANDIBLE, schematic but with the real bones in their real places and relations, fitted inside its own head surface. The mouth then comes from them:
//   * the lip line is the tooth line: premaxilla + maxilla above, the dentary below (their tooth rows meet on one surface, `lip`)
//   * the jaw hinge is the quadrate-articular joint (a pair, one each side, on one transverse axis): the jaw bone's pivot is that axis
//   * the lower jaw is ONE rigid piece of bones (dentary, angular/prearticular, articular with its retroarticular process); it turns about the hinge
//   * the roof of the mouth is the palate bones (vomer, pterygoid, parasphenoid), the cavity is the space between palate and mandible rami
//   * the eyes sit in the orbits (open between prefrontal, frontal, squamosal and the maxilla), the braincase (otic-occipital) is the back wall
//   * every bone lies inside the skin with a margin (the skull may not poke through; the mouth cavity may not either: a red patch once did)
// A plan names the bones of one animal class with their places as FRACTIONS (along the skull, across it, up it), so the same plan fits any species of the
// class from its own head measures; the fit writes cm in the baked frame (x lateral, y up, z forward) as a JSON the Blender scripts and the tests read.
//
// Plans: `caudate` (salamanders, newts: from the labelled amphibian plate and Salamandra anatomy: no tympanum, maxilla ends under the orbit, fused premaxilla,
// the vomer carries the tooth rows, the palatine is lost, a stout hyobranchial skeleton) and `anuran` (the plate's own frog skull: long curved maxilla to the
// quadratojugal, frontoparietal, big orbits, free pterygoid): that one is data for the frogs' mouths, not fitted yet. Proportions are SCHEMATIC (guesses to
// the plate and the literature, not measured on a specimen): they are tagged `guess` in the JSON until a CT of the species replaces them.
//
//   node tools/rig/skull.mjs firesal <mouth.glb> [out.json]      fit the caudate plan to the fire salamander's head, check, write the JSON
//   Blender -b -P tools/blender/skull.py -- <skull.json> <head-without-mouth.glb> <out_prefix>      meshes, x-ray renders, containment check
import { NodeIO } from '@gltf-transform/core';
import fs from 'node:fs';

const lerp = (a, b, t) => a + (b - a) * t;
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v) => { const n = Math.hypot(...v) || 1; return v.map((x) => x / n); };
const rot = (v, k, deg) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), d = v[0] * k[0] + v[1] * k[1] + v[2] * k[2], x = cross(k, v); return v.map((vi, i) => vi * c + x[i] * s + k[i] * d * (1 - c)); };

// The fire salamander's own numbers: the lip plane and the hinge (tools/rig/firesal-mouth.mjs fitMouth on the bake, tools/blender/firesal-mouth.py), the eyes
// (tools/paint/eyes.mjs). tests/skull.test.mjs keeps them equal to those files.
export const CONFIG = {
  // the owner's slim swimming scan (white_mesh 10), sculpted (6 Oct night, .agents/skin/skull/frog-sculpt.py) and scaled to a 16 cm lab frog (SVL about 8.5 cm), levelled, head to +z.
  // The lip plane and the hinge are the frog's: the tooth line runs from the snout tip back and a little down to the mouth angle under the tympanum. xr: the head's lateral window for
  // the profile rows; yBand: the height above which a midline band belongs to the head; roofDrop: how far the skull roof falls toward the sides (a flat head, not a dome);
  // eyeZone: the containment test leaves out the skin faces within 1.15 eye radii of an eye (the scan's eyeballs are spheres merged into the skin: their sheets fool a sign test).
  // The globes are sunk 0.19 cm into the orbits (the scan had them at up 3.27).
  frog: { plan: 'anuran', snoutZ: 7.97, hingeZ: 5.0, lip: { y0: 2.85 - 0.232 * 7.4, slope: 0.232 }, skinCm: 0.08, softCm: 0.16, xr: [-1.62, 1.62], yBand: 1.0, roofDrop: 0.85, eyeZone: 1.15,
    eyes: [{ c: [-0.672, 3.080, 6.069], r: 0.481 }, { c: [0.672, 3.080, 6.069], r: 0.477 }] },
  firesal: { plan: 'caudate', snoutZ: 8.0, hingeZ: 5.8, lip: { y0: 2.178 - 0.0595 * 5.8, slope: 0.0595 }, skinCm: 0.08, softCm: 0.16, xr: [-2.2, 1.4], yBand: 0.9,
    eyes: [{ c: [-1.19, 2.94, 6.61], r: 0.42 }, { c: [0.19, 2.88, 6.76], r: 0.42 }],
    // what goes into the mouth on top of the skull (tools/blender/skull.py --fit-cavity): a tongue pad on the floor (a share of the skull's length and of its width,
    // its top that far below the lip surface) and the teeth (cm): pleurodont cones along the tooth rows, a short row on each vomer
    dress: { tongue: { at: 0.40, lengthShare: 0.30, widthShare: 0.5, topDy: -0.07 }, teeth: { spacing: 0.07, r: 0.013, len: 0.065, lean: 12, vomerLen: 0.045, vomerR: 0.011, vomerRow: 7 } } },
};

// fractions: t along the skull (0 snout tip, 1 occipital condyles), u across (0 midline, 1 the skull's half width at that station), dy up from the lip plane
// (cm) or { roof: -cm } below the skin of the roof; fa across and fb along the plate as fractions, c its thickness in cm.
const R = 0.045;                                    // the tooth-row bones' radius, cm
const CAUDATE = {
  condyleBackCm: 0.12,                              // the occipital condyles sit this far in front of the jaw joint
  bones: [
    // skull roof, front to back (plate: n, nasal, prefrontal, frontal, parietal)
    { name: 'premaxilla', code: 'pm', group: 'skull', mid: true, parts: [
      { k: 'rod', pts: [[-0.42, 0.075, R], [-0.2, 0.04, R], [0, 0.03, R], [0.2, 0.04, R], [0.42, 0.075, R]], tooth: 'upper' },
      { k: 'plate', c: [0, 0.07, { roof: -0.05 }], fa: 0.34, fb: 0.06, th: 0.04, n: 'roof' }] },
    { name: 'maxilla', code: 'm', group: 'skull', pair: true, parts: [
      { k: 'rod', pts: [[0.42, 0.075, R], [0.62, 0.15, R], [0.80, 0.28, R * 0.9], [0.90, 0.43, R * 0.8], [0.95, 0.58, R * 0.6], [0.97, 0.68, R * 0.45]], tooth: 'upper' }] },
    { name: 'nasal', code: 'n', group: 'skull', pair: true, parts: [{ k: 'plate', c: [0.27, 0.20, { roof: -0.04 }], fa: 0.27, fb: 0.09, th: 0.035, n: 'roof', roll: 12 }] },
    { name: 'prefrontal', code: 'pf', group: 'skull', pair: true, parts: [{ k: 'plate', c: [0.52, 0.30, { roof: -0.10 }], fa: 0.17, fb: 0.06, th: 0.035, n: 'roof', roll: 35 }] },
    { name: 'frontal', code: 'f', group: 'skull', pair: true, parts: [{ k: 'plate', c: [0.19, 0.48, { roof: -0.05 }], fa: 0.19, fb: 0.17, th: 0.045, n: 'roof', roll: 8 }] },
    { name: 'parietal', code: 'p', group: 'skull', pair: true, parts: [
      { k: 'plate', c: [0.30, 0.76, { roof: -0.06 }], fa: 0.31, fb: 0.15, th: 0.05, n: 'roof', roll: 8 },
      { k: 'rod', pts: [[0.45, 0.78, { roof: -0.14 }, 0.04], [0.58, 0.84, { roof: -0.26 }, 0.035], [0.70, 0.88, { roof: -0.42 }, 0.03]] }] },
    { name: 'otic-occipital', code: 'o.o.c', group: 'skull', pair: true, parts: [
      { k: 'ell', c: [0.40, 0.90, 0.44], fa: 0.30, fb: 0.11, ry: 0.24 },
      { k: 'ell', c: [0.13, 1.0, 0.33], fa: 0.10, fb: 0.04, ry: 0.07 }] },        // the occipital condyle
    { name: 'squamosal', code: 'sq', group: 'skull', pair: true, parts: [
      { k: 'rod', pts: [[0.80, 0.82, 0.55, 0.045], [0.93, 0.89, 0.40, 0.05], [0.99, 0.93, 0.22, 0.05]] },
      { k: 'plate', c: [0.90, 0.86, 0.46], fa: 0.20, fb: 0.07, th: 0.03, n: 'side' }] },
    { name: 'quadrate', code: 'qu', group: 'skull', pair: true, parts: [{ k: 'rod', pts: [[0.99, 0.93, 0.22, 0.05], [1.0, 'H', 0.04, 0.06]], joint: 'hinge' }] },
    { name: 'pterygoid', code: 'pt', group: 'skull', pair: true, parts: [
      { k: 'rod', pts: [[0.98, 0.94, 0.12, 0.05], [0.80, 0.80, 0.17, 0.04], [0.58, 0.60, 0.19, 0.035], [0.50, 0.46, 0.18, 0.03]] },
      { k: 'plate', c: [0.66, 0.70, 0.19], fa: 0.12, fb: 0.09, th: 0.022, n: 'floor' }] },
    { name: 'vomer', code: 'v', group: 'skull', pair: true, parts: [{ k: 'plate', c: [0.17, 0.24, 0.17], fa: 0.19, fb: 0.11, th: 0.025, n: 'floor', roll: 10, teeth: 'vomerine' }] },
    { name: 'parasphenoid', code: 'ps', group: 'skull', mid: true, parts: [
      { k: 'plate', c: [0, 0.68, 0.30], fa: 0.17, fb: 0.22, th: 0.03, n: 'floor' },
      { k: 'rod', pts: [[0, 0.46, 0.22, 0.025], [0, 0.30, 0.19, 0.018]] }] },     // the cultriform process, toward the vomers
    // lower jaw (one rigid piece, turns on the hinge): dentary with the lower tooth row, angular + prearticular, articular with the retroarticular process
    { name: 'dentary', code: 'den', group: 'mandible', pair: true, parts: [
      { k: 'rod', pts: [[0.06, 0.075, R], [0.30, 0.10, R], [0.62, 0.18, R], [0.82, 0.32, R * 0.95], [0.91, 0.50, R * 0.85], [0.95, 0.66, R * 0.7]], tooth: 'lower' }] },
    { name: 'angular-prearticular', code: 'prart', group: 'mandible', pair: true, parts: [
      { k: 'rod', pts: [[0.93, 0.62, -0.09, 0.05], [0.95, 0.76, -0.08, 0.055], [0.98, 0.90, -0.045, 0.06]] },
      { k: 'plate', c: [0.84, 0.74, -0.10], fa: 0.10, fb: 0.10, th: 0.02, n: 'side' }] },
    { name: 'articular', code: 'art', group: 'mandible', pair: true, parts: [
      { k: 'ell', c: [1.0, 'H', -0.03], fa: 0.08, fb: 0.035, ry: 0.06, joint: 'hinge' },
      { k: 'rod', pts: [[1.0, 'H', -0.03, 0.05], [1.0, 0.99, -0.13, 0.04], [1.0, 1.02, -0.20, 0.03]] }] },    // the retroarticular process: the depressor mandibulae's lever
    { name: 'mentomeckelian', code: 'sym', group: 'mandible', mid: true, parts: [{ k: 'ell', c: [0, 0.06, -0.09], fa: 0.06, fb: 0.025, ry: 0.05 }] },
    // the hyobranchial skeleton: the tongue's and the throat pump's frame (held, not moved by the jaw)
    { name: 'hyobranchial', code: 'hy', group: 'hyoid', mid: true, parts: [
      { k: 'rod', pts: [[0, 0.30, { floor: 0.20 }, 0.04], [0, 0.46, { floor: 0.20 }, 0.045], [0, 0.62, { floor: 0.20 }, 0.04]] },                           // basibranchial
      { k: 'rod', pts: [[0.04, 0.34, { floor: 0.21 }, 0.03], [0.24, 0.40, { floor: 0.22 }, 0.03], [0.46, 0.50, { floor: 0.24 }, 0.03]], mirror: true },          // ceratohyal
      { k: 'rod', pts: [[0.04, 0.60, { floor: 0.21 }, 0.028], [0.30, 0.78, { floor: 0.23 }, 0.026], [0.55, 0.92, { floor: 0.26 }, 0.024]], mirror: true }] },    // ceratobranchial
  ],
};
// The anuran plan (frogs: the plate's own frog skull: broad and flat, big orbits, a long toothed maxilla running back to the quadratojugal and the quadrate, a
// frontoparietal roof plate, a three-armed pterygoid, a toothless dentary, an articular cartilage at the jaw joint, a flat hyoid plate). Same fractions as the caudate plan.
const ANURAN = {
  condyleBackCm: 0.15,
  bones: [
    { name: 'premaxilla', code: 'pm', group: 'skull', mid: true, parts: [
      { k: 'rod', pts: [[-0.30, 0.06, R], [-0.14, 0.03, R], [0, 0.025, R], [0.14, 0.03, R], [0.30, 0.06, R]], tooth: 'upper' },
      { k: 'plate', c: [0, 0.075, { roof: -0.10 }], fa: 0.22, fb: 0.06, th: 0.03, n: 'roof' }] },
    { name: 'maxilla', code: 'm', group: 'skull', pair: true, parts: [
      { k: 'rod', pts: [[0.30, 0.06, R], [0.52, 0.15, R], [0.72, 0.32, R], [0.86, 0.52, R * 0.9], [0.94, 0.72, R * 0.8], [0.97, 0.86, R * 0.6]], tooth: 'upper' }] },
    { name: 'quadratojugal', code: 'qj', group: 'skull', pair: true, parts: [{ k: 'rod', pts: [[0.97, 0.86, 0.04, 0.04], [0.985, 0.93, 0.05, 0.045], [0.995, 'H', 0.04, 0.05]] }] },
    { name: 'nasal', code: 'n', group: 'skull', pair: true, parts: [{ k: 'plate', c: [0.18, 0.19, { roof: -0.12 }], fa: 0.20, fb: 0.12, th: 0.03, n: 'roof', roll: 12 }] },
    { name: 'sphenethmoid', code: 'os', group: 'skull', mid: true, parts: [{ k: 'plate', c: [0, 0.34, { roof: -0.11 }], fa: 0.20, fb: 0.12, th: 0.04, n: 'roof' }] },
    { name: 'prefrontal', code: 'pf', group: 'skull', pair: true, parts: [{ k: 'plate', c: [0.62, 0.36, { roof: -0.22 }], fa: 0.12, fb: 0.07, th: 0.03, n: 'roof', roll: 35 }] },
    { name: 'frontoparietal', code: 'f/p', group: 'skull', pair: true, parts: [{ k: 'plate', c: [0.05, 0.62, { roof: -0.27 }], fa: 0.065, fb: 0.32, th: 0.04, n: 'roof', roll: 6 }] },
    { name: 'squamosal', code: 'sq', group: 'skull', pair: true, parts: [
      { k: 'rod', pts: [[0.74, 0.70, { roof: -0.30 }, 0.035], [0.88, 0.80, { roof: -0.40 }, 0.04], [0.94, 0.92, 0.24, 0.045]] },
      { k: 'plate', c: [0.90, 0.84, 0.26], fa: 0.12, fb: 0.08, th: 0.025, n: 'side' }] },
    { name: 'quadrate', code: 'qu', group: 'skull', pair: true, parts: [{ k: 'rod', pts: [[0.985, 0.93, 0.12, 0.05], [0.995, 'H', 0.04, 0.06]], joint: 'hinge' }] },
    { name: 'otic-occipital', code: 'o.o.c', group: 'skull', pair: true, parts: [
      { k: 'ell', c: [0.50, 0.93, 0.36], fa: 0.26, fb: 0.10, ry: 0.20 },
      { k: 'ell', c: [0.13, 1.0, 0.36], fa: 0.10, fb: 0.04, ry: 0.07 }] },        // the two occipital condyles
    { name: 'pterygoid', code: 'pt', group: 'skull', pair: true, parts: [
      { k: 'rod', pts: [[0.90, 0.60, 0.04, 0.035], [0.72, 0.46, 0.02, 0.035], [0.50, 0.34, 0.03, 0.03]] },          // the arm to the maxilla and palatine (kept low, under the orbit)
      { k: 'rod', pts: [[0.90, 0.60, 0.06, 0.035], [0.95, 0.80, 0.05, 0.04], [0.985, 0.93, 0.05, 0.045]] },         // the arm to the quadrate
      { k: 'rod', pts: [[0.88, 0.62, 0.07, 0.035], [0.55, 0.74, 0.13, 0.03], [0.28, 0.84, 0.20, 0.03]] }] },        // the arm to the braincase
    { name: 'vomer', code: 'v', group: 'skull', pair: true, parts: [{ k: 'plate', c: [0.16, 0.20, 0.15], fa: 0.16, fb: 0.09, th: 0.025, n: 'floor', roll: 8 }] },
    { name: 'neopalatine', code: 'pl', group: 'skull', pair: true, parts: [{ k: 'rod', pts: [[0.52, 0.30, 0.13, 0.03], [0.28, 0.31, 0.14, 0.03], [0.10, 0.32, 0.15, 0.03]] }] },
    { name: 'parasphenoid', code: 'ps', group: 'skull', mid: true, parts: [
      { k: 'plate', c: [0, 0.66, 0.26], fa: 0.18, fb: 0.26, th: 0.03, n: 'floor' },
      { k: 'rod', pts: [[0, 0.44, 0.20, 0.025], [0, 0.26, 0.16, 0.018]] }] },
    // lower jaw (one rigid piece on the hinge): the dentary is toothless in frogs (the maxilla is the tooth row), the angulosplenial (prearticular), the articular cartilage, the mentomeckelian
    { name: 'dentary', code: 'den', group: 'mandible', pair: true, parts: [
      { k: 'rod', pts: [[0.08, 0.05, -0.045, 0.045], [0.34, 0.14, -0.045, 0.045], [0.62, 0.34, -0.045, 0.045], [0.82, 0.56, -0.05, 0.045], [0.92, 0.76, -0.06, 0.045]] }] },
    { name: 'angular-prearticular', code: 'prart', group: 'mandible', pair: true, parts: [
      { k: 'rod', pts: [[0.90, 0.66, -0.12, 0.05], [0.96, 0.82, -0.10, 0.055], [0.99, 0.94, -0.06, 0.06]] },
      { k: 'plate', c: [0.86, 0.74, -0.12], fa: 0.10, fb: 0.10, th: 0.02, n: 'side' }] },
    { name: 'articular', code: 'art', group: 'mandible', pair: true, parts: [{ k: 'ell', c: [0.995, 'H', -0.03], fa: 0.08, fb: 0.035, ry: 0.06, joint: 'hinge' }] },
    { name: 'mentomeckelian', code: 'sym', group: 'mandible', mid: true, parts: [{ k: 'ell', c: [0, 0.06, -0.08], fa: 0.07, fb: 0.03, ry: 0.05 }] },
    // the hyoid: a flat plate in the floor with the anterior cornua (the tongue's and the throat pump's frame; held, not moved by the jaw)
    { name: 'hyobranchial', code: 'hy', group: 'hyoid', mid: true, parts: [
      { k: 'ell', c: [0, 0.50, { floor: 0.28 }], fa: 0.18, fb: 0.16, ry: 0.03 },
      { k: 'rod', pts: [[0.04, 0.34, { floor: 0.28 }, 0.03], [0.30, 0.40, { floor: 0.30 }, 0.03], [0.50, 0.50, { floor: 0.32 }, 0.03]], mirror: true },
      { k: 'rod', pts: [[0, 0.62, { floor: 0.28 }, 0.03], [0, 0.82, { floor: 0.30 }, 0.03]] }] },
  ],
};
export const PLANS = {
  caudate: CAUDATE,
  anuran: ANURAN,
};

export async function readPositions(file) {
  const doc = await new NodeIO().read(file), pos = doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION');
  const out = [], e = []; for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, e); out.push([e[0] * 100, e[1] * 100, e[2] * 100]); }
  return out;
}

// the head's measures along z from its mesh (cm): the lip-level outline (middle line, half width), the roof and the underside along the middle
export function headProfile(P, cfg) {
  const lipY = (z) => cfg.lip.y0 + cfg.lip.slope * z, rows = [];
  for (let z = cfg.snoutZ - 0.05; z > cfg.hingeZ - 0.5; z -= 0.1) {
    const at = P.filter((p) => Math.abs(p[2] - z) < 0.07 && Math.abs(p[1] - lipY(z)) < 0.14 && p[0] > cfg.xr[0] && p[0] < cfg.xr[1]);
    if (at.length < 2) continue;
    const xs = at.map((p) => p[0]), lo = Math.min(...xs), hi = Math.max(...xs);
    const mid = (lo + hi) / 2, band = P.filter((p) => Math.abs(p[2] - z) < 0.07 && Math.abs(p[0] - mid) < 0.15 && p[1] > cfg.yBand);
    rows.push({ z, mid, half: (hi - lo) / 2, top: Math.max(...band.map((p) => p[1])), bottom: Math.min(...band.map((p) => p[1])) });
  }
  // rows whose midline band caught only a point or two (near the shoulders) have no real underside: keep the last good one
  rows.forEach((r, i) => { if (r.top - r.bottom < 0.6 && i > 0) { r.bottom = rows[i - 1].bottom; } });
  // a row whose band caught the mouth's cavity or missed the surface is an outlier: take the median of its five neighbours instead
  for (const key of ['mid', 'half', 'top', 'bottom']) {
    const v = rows.map((r) => r[key]), med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
    rows.forEach((r, i) => { const m = med(v.slice(Math.max(0, i - 2), i + 3)); if (Math.abs(r[key] - m) > 0.12) r[key] = m; });
  }
  return rows;
}

// the tongue's pad as an ellipse on the floor of the mouth (baked cm: centre x and z, half width, half length) and the teeth's numbers, from the head's own measures
function dressOf(cfg, { z0, L, mid, half }) {
  const d = cfg.dress; if (!d) return undefined;
  const cz = z0 - d.tongue.at * L;
  return { tongue: { cx: +mid(cz).toFixed(3), cz: +cz.toFixed(3), ax: +(d.tongue.widthShare * half(cz)).toFixed(3), az: +(d.tongue.lengthShare * L).toFixed(3), topDy: d.tongue.topDy }, teeth: d.teeth };
}

export function fitSkull(P, id = 'firesal') {
  const cfg = CONFIG[id], plan = PLANS[cfg.plan], lipY = (z) => cfg.lip.y0 + cfg.lip.slope * z;
  const rows = headProfile(P, cfg).sort((a, b) => b.z - a.z);
  const sample = (key, z) => { for (let i = 0; i < rows.length - 1; i++) if (z <= rows[i].z && z >= rows[i + 1].z) return lerp(rows[i][key], rows[i + 1][key], (rows[i].z - z) / (rows[i].z - rows[i + 1].z)); return z > rows[0].z ? rows[0][key] : rows[rows.length - 1][key]; };
  const z0 = cfg.snoutZ - 0.07, zc = cfg.hingeZ - plan.condyleBackCm, L = z0 - zc, hingeT = (z0 - cfg.hingeZ) / L;
  const mid = (z) => sample('mid', z), half = (z) => Math.max(0.3, sample('half', z) - cfg.softCm), top = (z) => sample('top', z) - cfg.skinCm;
  const slope = (z) => (top(z + 0.1) - top(z - 0.1)) / 0.2;                      // d roof / d z
  const bottom = (z) => sample('bottom', z);
  const yOf = (z, v, u = 0) => (typeof v === 'number' ? lipY(z) + v : v.roof !== undefined ? top(z) + v.roof - (cfg.roofDrop ?? 0) * Math.max(0, top(z) - lipY(z) + 0.3) * u * u : bottom(z) + v.floor);
  const T = (t) => (t === 'H' ? hingeT : t), r3 = (v) => +v.toFixed(3);
  // a point from (u, t, dy): across (fraction of the half width), along (fraction of the skull), up (cm from the lip plane, or below the roof)
  const pt = (u, t, dy) => { const z = z0 - T(t) * L; return [mid(z) + u * half(z), yOf(z, dy, u), z]; };
  const bones = [], joints = [];
  const side = (b, sx, tag) => {
    const parts = [];
    for (const p of b.parts) {
      if (p.k === 'rod') {
        const mk = (sgn) => p.pts.map((q) => { const r = p.tooth ? q[2] : q[3], dy = p.tooth ? (p.tooth === 'upper' ? r : -r) : q[2]; return [...pt(q[0] * sgn, q[1], dy).map(r3), r3(r)]; });
        const pts = mk(sx);
        parts.push({ k: 'rod', pts, ...(p.tooth ? { tooth: p.tooth } : {}), ...(p.joint ? { joint: p.joint } : {}) });
        if (p.joint) joints.push({ side: tag, kind: 'quadrate', at: pts[pts.length - 1].slice(0, 3), r: pts[pts.length - 1][3] });
        if (p.mirror) parts.push({ k: 'rod', pts: mk(-sx) });
      } else {
        const [u, t, dy] = p.c, c = pt(u * sx, t, dy), z = c[2];
        if (p.k === 'plate') {
          const kk = slope(z), lon = unit([0, kk, 1]);
          let lat = [1, 0, 0], lo = lon, nn = unit([0, 1, -kk]);
          if (p.n === 'side') { lat = [0, 1, 0]; lo = [0, 0, 1]; nn = unit([sx, 0.15, 0]); }
          else if (p.n === 'floor') { lat = [1, 0, 0]; lo = [0, 0, 1]; nn = [0, -1, 0]; }
          if (p.roll) { lat = rot(lat, lo, -sx * p.roll); nn = rot(nn, lo, -sx * p.roll); }
          parts.push({ k: 'ell', c: c.map(r3), r: [r3(p.fa * half(z)), r3(p.fb * L), p.th], ax: [lat, lo, nn].map((v) => v.map((x) => +x.toFixed(4))), ...(p.teeth ? { teeth: p.teeth } : {}) });
        } else {
          parts.push({ k: 'ell', c: c.map(r3), r: [r3(p.fa * half(z)), r3(p.fb * L), p.ry], ax: [[1, 0, 0], [0, 0, 1], [0, 1, 0]], ...(p.joint ? { joint: p.joint } : {}) });
          if (p.joint) joints.push({ side: tag, kind: 'articular', at: c.map(r3), r: p.ry });
        }
      }
    }
    return parts;
  };
  for (const b of plan.bones) for (const [sx, tag] of b.pair ? [[1, 'R'], [-1, 'L']] : [[1, '']]) bones.push({ name: b.name + (tag ? '.' + tag : ''), code: b.code, group: b.group, parts: side(b, sx, tag) });
  // the hinge of each side: where the quadrate's end meets the articular (their mean); the two joints share one transverse axis
  const hinge = ['L', 'R'].map((sd) => { const q = joints.find((j) => j.side === sd && j.kind === 'quadrate'), a = joints.find((j) => j.side === sd && j.kind === 'articular');
    return { side: sd, at: q.at.map((v, i) => r3((v + a.at[i]) / 2)), gap: r3(Math.hypot(...q.at.map((v, i) => v - a.at[i]))), reach: r3(q.r + a.r) }; });
  // the rule's own checks, in numbers (cm)
  const upper = [], lower = [];
  for (const b of bones) for (const p of b.parts) if (p.k === 'rod' && p.tooth) for (const q of p.pts) (p.tooth === 'upper' ? upper : lower).push(q[1] - lipY(q[2]) + (p.tooth === 'upper' ? -q[3] : q[3]));
  const checks = { toothRowOffLipUpper: +Math.max(...upper.map(Math.abs)).toFixed(3), toothRowOffLipLower: +Math.max(...lower.map(Math.abs)).toFixed(3),
    hingeOffLip: +Math.max(...hinge.map((h) => Math.abs(h.at[1] - lipY(h.at[2])))).toFixed(3), jointGap: Math.max(...hinge.map((h) => h.gap)), jointReach: Math.min(...hinge.map((h) => h.reach)), hingeSpan: +(hinge[1].at[0] - hinge[0].at[0]).toFixed(3), skullLengthCm: +L.toFixed(3), skullWidthCm: +(2 * half(cfg.hingeZ)).toFixed(3) };
  return { id, units: 'cm', frame: 'baked: x lateral, y up, z forward', plan: cfg.plan, status: 'schematic proportions (guess to the plate and literature); not measured on a specimen',
    lip: { zh: cfg.hingeZ, y0: +lipY(cfg.hingeZ).toFixed(4), slope: cfg.lip.slope }, snoutZ: cfg.snoutZ, skullLengthCm: +L.toFixed(3), hingeT: +hingeT.toFixed(3),
    hinge, jawAxis: [1, 0, 0], eyes: cfg.eyes, ...(cfg.eyeZone ? { eyeZone: cfg.eyeZone } : {}), dress: dressOf(cfg, { z0, L, mid, half }), profile: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, +v.toFixed(3)]))), checks, bones };
}

if (process.argv[1]?.endsWith('skull.mjs') && process.argv[2]) {
  const id = process.argv[2], file = process.argv[3], out = process.argv[4] ?? `art-src/skull/${id}.skull.json`;
  const sk = fitSkull(await readPositions(file), id);
  fs.mkdirSync(out.replace(/\/[^/]*$/, ''), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(sk, null, 1));
  console.log(`${id}: ${sk.bones.length} bones, skull ${sk.skullLengthCm} cm long, hinge at z ${sk.lip.zh}; checks`, JSON.stringify(sk.checks), '->', out);
}
