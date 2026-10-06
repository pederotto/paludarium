// Dumps each orchid leaf's true outline (sim/orchid-leaves.js ORCHID_LEAF) sampled per texture row, for the Blender leaf bake
// (art-src/orchids/leaf_bake.py): node tools/orchids/dump-leaf-shapes.mjs > art-src/orchids/leaf-shapes.json
// Row j of a W x H map is t = (j + 0.5) / H (0 base .. 1 tip); T = the true half-width and env = the coarse sheet's half-width, both as
// fractions of the sheet width (0.5 = full), asp = leaf length / width, notch = where the lobes of a heart close (or 0).
import { ORCHID_LEAF } from '../../src/sim/orchid-leaves.js';
const DIMS = { pleurothallis: [512, 512], masdevallia: [256, 1024], dracula: [128, 1024], cuthbertsonii: [256, 512] };
const out = {};
for (const [k, S] of Object.entries(ORCHID_LEAF)) {
  const [W, H] = DIMS[k];
  const T = [], env = [];
  for (let j = 0; j < H; j++) { const t = (j + 0.5) / H; T.push(+S.T(t).toFixed(5)); env.push(+S.env(t).toFixed(5)); }
  out[k] = { W, H, asp: S.asp, notch: S.notch ?? 0, T, env };
}
process.stdout.write(JSON.stringify(out));
