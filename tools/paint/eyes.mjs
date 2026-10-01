// Analytic eyes (src/render/creatures/material.js analyticEyes) for the baked meshes, in cm in the baked frame
// (head towards +z, standing on y = 0). One eye is given; the shader mirrors it across x = 0.
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const basis = (axis) => { const a = norm(axis), h = norm(cross(a, [0, 1, 0])); return { axis: a, h, w: norm(cross(a, h)) }; };
const lin = (c) => c.map((v) => Math.pow(v, 2.2));
const eye = (c, r, axis, o = {}) => ({ c, r, ...basis(axis), ...o });

const frog = (k) => ({
  finish: { eyes: [eye([0.66 * k, 2.58 * k, 1.5 * k], 0.3 * k, [0.62, 0.45, 0.65], { pupil: [0.5, 0.48], inner: lin([0.30, 0.19, 0.06]), outer: lin([0.08, 0.05, 0.02]) })], rough: 0.45, coat: 0.45, coatRough: 0.2, grainAmt: 0.15 },
});
export const EYES = {
  leucomelas: frog(1),
  strawberry: frog(0.511),
  firesal: { finish: { eyes: [eye([1.05, 3.7, 7.5], 0.5, [0.65, 0.5, 0.55], { pupil: [0.78, 0.76], inner: lin([0.06, 0.04, 0.02]), outer: lin([0.03, 0.02, 0.012]) })], rough: 0.5, coat: 0.5, coatRough: 0.2, grainAmt: 0.2 } },
};
