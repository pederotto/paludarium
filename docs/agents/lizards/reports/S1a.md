# S1a report: skink bake, 25 bones. Done, 8/8 checks pass (claude-opus-5-5)
Result: `node tools/bake-lizard.mjs skink` (about 65 s) writes skink.glb (hi 29,400 tris, 943 KB) and skink.lo.glb (lo 21,002 tris, 779 KB). Both keep the model's UVs and its 1024 WebP base colour. The metal-rough map is dropped; metal 0 / rough 0.6. Both carry `_RIG`, `_SKIN` and 25 bones (fans on). The original is copied untouched to art-src/raw/skink_mesh.glb (sha checked).
Size: snout to vent 9.00 cm, total **16.80 cm** (the game's skink today is 16.8), tail 7.80 cm (0.87 x SVL). SVL/total 0.536, against the source mesh's 0.538 (tail arc in 3D). Trunk kept wide: 6.75 cm span with the limbs, 4.16 cm high.
Bones, length / r cm: pelvis 1.83/1.28, spine 1.86/1.36, neck 2.04/1.20, head 1.95/1.20 (0.22 SVL), tail1-5 2.34 2.02 1.85 1.66 1.48 / 0.67-0.21;
  thigh 1.09/0.48, shin 1.13/0.35, foot 0.60/0.21, toes 0.58/0.13; arm 1.21/0.35, forearm 1.53/0.29, hand 0.46/0.19, fingers 0.53/0.11 (L = R, set to the mean).
  As a share of SVL: humerus 0.13, radius 0.17, hand+digits 0.11; femur 0.12, tibia 0.13, foot+toes 0.13. RIG_skink estimates fore 0.10-0.13 and hind 0.13-0.18: the forearm is long and the hind limb is at the low edge (elbow pick is noisy on the fused mesh, as with the gecko).
  Raw left/right differences before averaging: thigh 10.7 %, shin 8.9 %, hand 4.3 %, fingers 5.6 %, the rest under 1.5 %.
Weights: every vertex on 2 bones, w0 + w1 = 1, on both levels. Fewest vertices per bone on the full mesh (204k): fingers 402/417, toes 442/545; the trunk bones 18-44k.
Decimation (meshoptimizer relative error x 16.8 cm): hi 0.002, so at most about 0.34 mm off the source surface, which keeps the keels taller than that in the silhouette. lo 0.0098 (about 1.6 mm). Keels not checked on a render (no browser).
Tail, side view: the model holds it straight from above but sloping down 0.092 (1.5 cm) to the ground. readRaw levels it before measuring, using the shared straightenTail run in the y-z plane (x and y swapped, tip aimed at the vent's height). Tip now 0.02 % to the side and -0.09 % below the vent. Edge stretch: p99.9 1.32x, worst 2.13x, 12 edges past 2x (of about 840k; all slivers in the underside fold behind the vent). The default ramp gave 278 edges past 2x and a worst of 4.5x, so the skink uses ramp 0.1, soft 0.02, blend 0.2.
Shared tool: tools/bake-lizard.mjs got a `skink` entry in SPECIES plus the usage line (lock taken). tools/rig/lizard.mjs is unchanged, and so is the gecko's code path. The gecko was not re-baked.
Check: `node --test tests/lizard-rig-skink.test.mjs`
  skink: hi 29400 triangles, lo 21002 | tail tip: 0.02 % of the length to the side, -0.09 % above the vent
  snout-vent 9.00 cm of 16.79 cm: 0.536 (source model 0.538) | ℹ pass 8  ℹ fail 0
Files: +tools/rig/lizard-skink.mjs, +tests/lizard-rig-skink.test.mjs, +public/assets/creatures/skink{,.lo}.glb, +art-src/raw/skink_mesh.glb, CREDITS.md +1, tools/bake-lizard.mjs +3.
Rig gaps and workarounds: (1) lo stops at 21k, not 10k. At every error bound from 0.01 to 0.08 meshoptimizer keeps the UV seams, and this atlas has more islands than the gecko's. Going lower needs a new UV unwrap and a re-projected texture (not done). (2) The toes are fused, so each fan bends all of its digits together. (3) The neck bone runs from the shoulder line (2.04 cm), so a skink's short real neck sits in its first half. (4) Eyes and the orange ring are not measured (gap 7). (5) The extras `measures.modelRatio` (0.524) comes from a noisy re-trace of the levelled tail; the geometry ratio is 0.536.
Noticed, not touched: the source's vent fraction (0.56 +-0.02) is a slice estimate. A change moves SVL, and so the scale.

## Hand-off (runtime task)
- Skeleton: in skink.glb's mesh extras (`skeleton`: plan 'lizard', 25 bones in the CONTRACTS order, cm; `measures`). Manifest key to write: `skink` = `{ file: 'skink.glb', lo: 'skink.lo.glb', tris: [29400, 21002], sizeCm: [6.75, 4.162, 16.803], finish, skeleton: { plan: 'lizard', bones } }`.
- GLB frame as the gecko's: metres, midline x = 0, fore soles y = 0, origin at the middle of the length, head +z. Vent at y 1.83 cm (the tail is level at that height).
- rig2.len stays 16.8 (total 16.80 cm). The tail now rests level: the arched alert carriage and the tip touching the ground at rest are posing work (MOTION_skink.md).
- The hind soles sit about 0.35 cm above the fore soles (model pose: forebody propped up). Foot planting should take each foot's own height.
- Re-bake: `node tools/bake-lizard.mjs skink` (prints the tail-levelling stats line first). `SKINK_LOG=1` adds the limb measurement. Never re-bake without the lock on bake-lizard.mjs.
- Traps: the zones are fractions of the SOURCE length (`srcLen`), because the levelled tail is longer. The skin-stretch tool (tools/rig/skin-stretch.mjs) is wired only for the gecko today (a guess, not verified).
