// Analytic eyes (src/render/creatures/material.js analyticEyes) for the baked meshes, in cm in the baked frame
// (head towards +z, standing on y = 0). One eye is given; the shader mirrors it across x = 0.
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const basis = (axis) => { const a = norm(axis), h = norm(cross(a, [0, 1, 0])); return { axis: a, h, w: norm(cross(a, h)) }; };
const lin = (c) => c.map((v) => Math.pow(v, 2.2));
const eye = (c, r, axis, o = {}) => ({ c, r, ...basis(axis), ...o });
// The shrimp's tail flick pivot in the baked frame (cm), as tools/bake-creature.mjs prints it for the shrimp job.
const SHRIMP_CURL = { z0: 0.08, y0: 0.308, len: 0.96, flick: true };
// Where a shrimp's egg clutch folds to inside the abdomen when she is not berried (cm; printed by the bake as the egg fold point).
const SHRIMP_EGGS = { y: 0.303, z: -0.26 };

const frog = (k) => ({
  finish: { eyes: [eye([0.66 * k, 2.58 * k, 1.5 * k], 0.3 * k, [0.62, 0.45, 0.65], { pupil: [0.5, 0.48], inner: lin([0.30, 0.19, 0.06]), outer: lin([0.08, 0.05, 0.02]) })], rough: 0.52, coat: 0.32, coatRough: 0.36, grain: 9, grainAmt: 0.15 },
});
// The scanned frog at another size, eye colour and skin finish (2026-10-04: satin, not lacquer: a softer, thinner coat; the material
// breaks its highlight up on the granules and fades it at grazing angles, render/creatures/material.js `moist`). Dart frogs have
// glossy near-black eyes (a faint bronze ring); toads a gold iris; `grain`/`bump` add the shader's fine relief on top of the painted
// granules.
const frogAs = (k, iris = {}, fin = {}) => {
  const f = frog(k).finish;
  return { finish: { ...f, eyes: f.eyes.map((e) => ({ ...e, ...iris })), ...fin } };
};
const DARK_EYE = { inner: lin([0.3, 0.2, 0.1]), outer: lin([0.07, 0.05, 0.03]), limb: lin([0.02, 0.015, 0.01]), pupil: [0.5, 0.48] };
export const EYES = {
  leucomelas: frogAs(1, DARK_EYE),
  strawberry: frogAs(0.511, DARK_EYE),
  dartfrog: frogAs(4.2 / 4.5, DARK_EYE, { rough: 0.5, coat: 0.34 }),
  harlequin: frogAs(3.3 / 4.5, DARK_EYE, { rough: 0.5, coat: 0.34 }),
  'dartfrog:cobalt_clean': frogAs(4.2 / 4.5, DARK_EYE, { rough: 0.5, coat: 0.34 }),
  'dartfrog:sky_spotted': frogAs(4.2 / 4.5, DARK_EYE, { rough: 0.5, coat: 0.34 }),
  'dartfrog:sky_clean': frogAs(4.2 / 4.5, DARK_EYE, { rough: 0.5, coat: 0.34 }),
  auratus: frogAs(4.0 / 4.5, DARK_EYE, { rough: 0.48, coat: 0.36 }),
  bumblebee: frogAs(2.8 / 4.5, { inner: lin([0.16, 0.11, 0.06]), outer: lin([0.05, 0.035, 0.02]), pupil: [0.46, 0.42] }, { rough: 0.62, coat: 0.12, coatRough: 0.5, grain: 9, bump: 0.035, grainAmt: 0.5 }),
  reedfrog: frogAs(3.0 / 4.5, { inner: lin([0.42, 0.3, 0.14]), outer: lin([0.14, 0.09, 0.04]), pupil: [0.5, 0.34] }, { rough: 0.38, coat: 0.45, coatRough: 0.28 }),
  toad: frogAs(1, { inner: lin([0.62, 0.40, 0.14]), outer: lin([0.24, 0.14, 0.07]), pupil: [0.5, 0.42], shape: 'tri' },   // owner's photos (6 Oct): a coppery ring round the pupil, the rest of the globe chocolate brown (was gold/amber, much too orange)
    { rough: 0.55, coat: 0.2, coatRough: 0.45, grain: 9, bump: 0.05, grainAmt: 0 }),   // grainAmt 0: the relief is the baked normal map now (the noise grain would double it and costs 4 noise3 a fragment)
  // European common frog (Rana temporaria, 7 Oct 2026): a gold-bronze iris finely veined dark, a horizontal pupil; wet, satiny (the skin session's lab values, linear)
  commonfrog: frogAs(1, { inner: [0.6383, 0.448, 0.1065], outer: [0.1626, 0.0835, 0.0245], pupil: [0.66, 0.40] },   // (the reference: a pale-gold ring round a wide horizontal pupil, a speckled bronze-brown iris)
    { rough: 0.5, coat: 0.3, coatRough: 0.4, grain: 9, bump: 0.03, grainAmt: 0 }),
  // Red-eyed tree frog: big bulging eyes (a sphere fitted to the scan's eye, 0.4 cm), an orange-red iris going darker at the rim and a
  // narrow vertical slit pupil (shape 'slit'); moist, satiny, finely granular skin (a lacquered coat read as plastic).
  redeye: { finish: { eyes: [eye([0.7, 2.21, 1.8], 0.4, [0.74, 0.36, 0.57], { shape: 'slit', pupil: [0.15, 0.6], inner: lin([1.0, 0.34, 0.08]), outer: lin([0.88, 0.14, 0.03]), limb: lin([0.32, 0.03, 0.01]), rim: lin([0.01, 0.006, 0.004]), cap: 0.9, seed: 9 })], rough: 0.52, coat: 0.3, coatRough: 0.34, grain: 9, grainAmt: 0.22 } },
  // Fire salamander (6 Oct, the owner's photos: glossy black domes with a sharp wet highlight, a dark bronze ring, a pupil that is not seen): two explicit eyes (`mirror: false`)
  // because the AI scan's head is not centred on x = 0 (its middle is at -0.43 cm), the sphere centres under the two dome tops measured on the baked mesh
  // (left top (-1.40, 3.28, 6.75), right (0.40, 3.22, 6.90) cm), r 0.42 cm, looking out, up and a little forward. The finish keeps the black wet:
  // `matteBlack` overrides the toad's rule that dark texels are dry; `grainAmt` 0 because the relief is the baked normal map.
  firesal: { finish: { eyes: [
    eye([-1.19, 2.94, 6.61], 0.42, [-0.5, 0.8, 0.33], { mirror: false, pupil: [0.8, 0.78], inner: lin([0.10, 0.065, 0.03]), outer: lin([0.025, 0.017, 0.01]), limb: lin([0.012, 0.009, 0.006]), seed: 5 }),
    eye([0.19, 2.88, 6.76], 0.42, [0.5, 0.8, 0.33], { mirror: false, pupil: [0.8, 0.78], inner: lin([0.10, 0.065, 0.03]), outer: lin([0.025, 0.017, 0.01]), limb: lin([0.012, 0.009, 0.006]), seed: 8 })],
    rough: 0.34, coat: 0.5, coatRough: 0.1, grain: 9, grainAmt: 0, bump: 0, matteBlack: { rough: 0.3, coat: 0.55 } } },
  // Vampire crab: glossy yellow eyes with a small dark pupil. The ball's centre, radius and stalk direction come from the
  // baked rig (tools/rig/crab.mjs), so `eyes` is a function of them. Hard shell: no skin grain (the scan has its own relief,
  // and grainAmt 0 skips the per-fragment noise).
  // Dwarf shrimp: glossy black eyes on short stalks (centre, radius and stalk from the baked rig, tools/rig/shrimp.mjs); a wet, smooth
  // shell; the `invert` rig: antennae sweeping, the walking legs stepping in a wave from tail to head, and the tail flick (`curl`,
  // the abdomen curled under about the pivot the bake prints, cm). The shell is nearly opaque, so it is drawn solid (glassOpacity).
  ...Object.fromEntries(['shrimp'].map((k) => [k, { finish: {
    eyes: (e) => [eye(e.c, e.r, e.axis, { pupil: [0.3, 0.3], inner: lin([0.02, 0.018, 0.016]), outer: lin([0.008, 0.007, 0.006]), rim: lin([0.004, 0.004, 0.004]), cap: 0.95, seed: 6 })],
    rough: 0.4, coat: 0.32, coatRough: 0.18, grainAmt: 0, tone: 0.02, glassOpacity: 0.95,
    invert: { antenna: 1, wave: 7, curl: SHRIMP_CURL, eggs: SHRIMP_EGGS },
  } }])),
  // Panther crab (the owner's Meshy model): its eyes are part of the painted texture (black beads); satin shell like the vampire crab's.
  // Matano shrimp (the owner's Meshy model): the dwarf shrimp's finish and rig (glossy black eyes, antennae, leg wave, tail flick, eggs); the pivots below are what the bake prints.
  matanoshrimp: { finish: {
    eyes: (e) => [eye(e.c, e.r, e.axis, { pupil: [0.3, 0.3], inner: lin([0.02, 0.018, 0.016]), outer: lin([0.008, 0.007, 0.006]), rim: lin([0.004, 0.004, 0.004]), cap: 0.95, seed: 6 })],
    rough: 0.4, coat: 0.32, coatRough: 0.18, grainAmt: 0, tone: 0.02, glassOpacity: 0.95,
    invert: { antenna: 1, wave: 7, curl: { z0: 0.12, y0: 0.628, len: 1.44, flick: true }, eggs: { y: 0.617, z: -0.103 } },
  } },
  // Mexican dwarf crayfish (the owner's Meshy model): satin orange shell (not the shrimp's glass), the `invert` rig of the shrimps (legs in a wave,
  // antennae, the tail flick); its claws pinch and feed with the crab's cycle (`claws`, fitted by the bake). The pivot is what the bake prints.
  cambarellus: { finish: { rough: 0.55, coat: 0.12, coatRough: 0.45, grainAmt: 0, tone: 0.02, invert: { antenna: 1, wave: 7, curl: { z0: 0.024, y0: 0.385, len: 1.174, flick: true } } } },
  // Hillstream loach (the owner's Meshy model): its eyes are in the texture; wet satin skin, fins about four fifths opaque (the Meshy fish's membranes).
  hillloach: { finish: { rough: 0.5, coat: 0.55, coatRough: 0.18, grainAmt: 0, finOpacity: 0.8 } },
  panther: { finish: { rough: 0.62, coat: 0.1, coatRough: 0.5, grainAmt: 0, tone: 0.02 } },
  crab: { finish: { eyes: (e) => [eye(e.c, e.r, e.axis, { pupil: [0.34, 0.34], inner: lin([0.96, 0.82, 0.19]), outer: lin([0.83, 0.6, 0.08]), rim: lin([0.04, 0.03, 0.02]), limb: lin([0.61, 0.42, 0.05]), cap: 0.97, seed: 4 })], rough: 0.68, coat: 0.08, coatRough: 0.55, grainAmt: 0, tone: 0.02 } },   // satin, not lacquered
};
