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
  finish: { eyes: [eye([0.66 * k, 2.58 * k, 1.5 * k], 0.3 * k, [0.62, 0.45, 0.65], { pupil: [0.5, 0.48], inner: lin([0.30, 0.19, 0.06]), outer: lin([0.08, 0.05, 0.02]) })], rough: 0.45, coat: 0.45, coatRough: 0.2, grainAmt: 0.15 },
});
// The scanned frog at another size, eye colour and skin finish. Dart frogs have glossy near-black eyes (a faint bronze ring);
// toads a gold iris; `grain`/`bump` add the shader's fine relief on top of the painted granules.
const frogAs = (k, iris = {}, fin = {}) => {
  const f = frog(k).finish;
  return { finish: { ...f, eyes: f.eyes.map((e) => ({ ...e, ...iris })), ...fin } };
};
const DARK_EYE = { inner: lin([0.3, 0.2, 0.1]), outer: lin([0.07, 0.05, 0.03]), limb: lin([0.02, 0.015, 0.01]), pupil: [0.5, 0.48] };
export const EYES = {
  leucomelas: frogAs(1, DARK_EYE),
  strawberry: frogAs(0.511, DARK_EYE),
  dartfrog: frogAs(4.2 / 4.5, DARK_EYE, { rough: 0.42, coat: 0.5 }),
  'dartfrog:cobalt_clean': frogAs(4.2 / 4.5, DARK_EYE, { rough: 0.42, coat: 0.5 }),
  'dartfrog:sky_spotted': frogAs(4.2 / 4.5, DARK_EYE, { rough: 0.42, coat: 0.5 }),
  'dartfrog:sky_clean': frogAs(4.2 / 4.5, DARK_EYE, { rough: 0.42, coat: 0.5 }),
  auratus: frogAs(4.0 / 4.5, DARK_EYE, { rough: 0.38, coat: 0.55 }),
  bumblebee: frogAs(2.8 / 4.5, { inner: lin([0.16, 0.11, 0.06]), outer: lin([0.05, 0.035, 0.02]), pupil: [0.46, 0.42] }, { rough: 0.62, coat: 0.12, coatRough: 0.5, grain: 9, bump: 0.035, grainAmt: 0.5 }),
  reedfrog: frogAs(3.0 / 4.5, { inner: lin([0.42, 0.3, 0.14]), outer: lin([0.14, 0.09, 0.04]), pupil: [0.5, 0.34] }, { rough: 0.28, coat: 0.65, coatRough: 0.12 }),
  toad: frogAs(1, { inner: lin([0.95, 0.72, 0.22]), outer: lin([0.62, 0.4, 0.12]), pupil: [0.5, 0.42], shape: 'tri' }, { rough: 0.55, coat: 0.2, coatRough: 0.45, grain: 9, bump: 0.05, grainAmt: 0.7 }),
  // Red-eyed tree frog: big bulging eyes (a sphere fitted to the scan's eye, 0.4 cm), a blood-red iris going darker at the rim and a
  // narrow vertical slit pupil (shape 'slit'); smooth, wet, glossy skin with almost no grain.
  redeye: { finish: { eyes: [eye([0.7, 2.21, 1.8], 0.4, [0.74, 0.36, 0.57], { shape: 'slit', pupil: [0.15, 0.6], inner: lin([0.97, 0.16, 0.05]), outer: lin([0.78, 0.07, 0.02]), limb: lin([0.22, 0.02, 0.01]), rim: lin([0.01, 0.006, 0.004]), cap: 0.9, seed: 9 })], rough: 0.36, coat: 0.55, coatRough: 0.18, grainAmt: 0.1 } },
  firesal: { finish: { eyes: [eye([1.05, 3.7, 7.5], 0.5, [0.65, 0.5, 0.55], { pupil: [0.78, 0.76], inner: lin([0.06, 0.04, 0.02]), outer: lin([0.03, 0.02, 0.012]) })], rough: 0.5, coat: 0.5, coatRough: 0.2, grainAmt: 0.2 } },
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
  crab: { finish: { eyes: (e) => [eye(e.c, e.r, e.axis, { pupil: [0.34, 0.34], inner: lin([0.96, 0.82, 0.19]), outer: lin([0.83, 0.6, 0.08]), rim: lin([0.04, 0.03, 0.02]), limb: lin([0.61, 0.42, 0.05]), cap: 0.97, seed: 4 })], rough: 0.68, coat: 0.08, coatRough: 0.55, grainAmt: 0, tone: 0.02 } },   // satin, not lacquered
};
