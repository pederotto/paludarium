IDENTIFICATION: `~/Downloads/sample_2026-10-04T213008.005.glb` = red-eyed crocodile SKINK, fairly sure (about 85%, not user-confirmed): very dark brown/black base colour with pale cream blotches, long straight tapering tail, narrower head. The other sample (213641.596, tan mottled) = gecko. Method: base-colour atlas viewed once (downscaled) + slice profile. Render one view to be certain.
Tool: `BB/tools/glb-dump.mjs <glb> [--profile=25] [--sil] [--extract-image=<dir>]` (no binary printed). Textures extracted to `BB/tools/tmp/`. Models not copied or moved.

## What the model contains (measured)
- 1 scene, 2 nodes (`world` > `geometry_0`), 1 mesh, 1 primitive, 204,671 verts, 280,479 tris. Attributes POSITION, NORMAL, TEXCOORD_0 (float32). No colours, no skin, no bones, no animation, no morph targets. File 10.3 MB (trimesh export, AI image-to-3D look).
- Material: baseColor 1024x1024 WebP (mean RGB 38,28,18, very dark) + metalRough 1024x1024 WebP: G mean 192 (rough), B mean 180 (metal about 0.7!) with factors metal 1 / rough 1: it would render like dull metal. Needs `EXT_texture_webp` (required).
- One fused piece: keels, limbs, toes and head are not separate parts. The orange eye ring (the species signature) was NOT visible in the downscaled atlas: not verified, check on a render.

## Scale and axes (measured)
- bbox X -0.2103..0.2103 (0.4205), Y -0.1278..0.1314 (0.2593), Z -0.5006..0.5006 (1.0012). No units; total length = 1.0. Z body axis, head at +Z, tail at -Z; Y up; X lateral. Nearly left-right symmetric (X range equal), tail straight.
- Game size: `rig2.len` 16.8 cm (`src/sim/animals.js:407`; `lizards.js:3` says about 17 cm, half of it tail), so 1 unit = 16.8 cm. Game convention: cm, +z forward, feet on y=0: shift y by +0.128.

## Segments (fractions of total length; 25 slices of 0.04, so +-0.02; x 16.8 cm at game size)
- Head 0.00-0.11, width 0.13 at the snout to 0.19 at the back; head underside held at y +0.00..+0.03.
- Forelimb roots 0.12-0.28 (span 0.34-0.40 incl. trunk). Trunk between limb pairs 0.28-0.38, width 0.19, depth 0.16 (wide and flat, with keels). Hind limb zone 0.40-0.56 (span 0.36-0.42). Vent about 0.56, so snout-to-vent about 0.56 (9.4 cm).
- Tail 0.56-1.00 (0.44, 7.4 cm): straight, tapers 0.086 to 0.018 wide, slopes down from y +0.014 to -0.095 so its tip rests on the ground. Matches "half of it tail".
- Limbs (horizontal projection): forelimb 0.107 out from the trunk edge, hind 0.115. Segment lengths cannot be separated from the fused mesh.
- Height: soles y -0.128 (fore), -0.105 (hind); belly -0.059 (clearance about 0.07 = 1.2 cm); head carried 0.13 above the soles. Fits the footage: forebody propped up on straight arms.

## Anatomy the rig must cover (ESTIMATED; there is no skink skeleton in `AG/refs`, only the gecko drawings, viewed once; a skink has shorter limbs, no toe pads, less neck than a gecko)
- Skull: triangular casque, about 0.20-0.25 of SVL; short neck (cervical about 8); about 26-28 presacral vertebrae, ribs on most of the trunk; 2 sacrals; caudal vertebrae along a tail of about 0.8 x SVL (a skink tail may break but is not a gecko-style drop in the game: check `sim/skink.js`).
- Pectoral girdle behind the skull, pelvis at the sacrum. Forelimb: humerus, radius/ulna, hand about 0.10-0.13 of SVL each; hindlimb: femur, tibia, foot about 0.13-0.18 each. Five digits, no pads.
- Suggested bones: pelvis > spine > neck > head; tail1..tail6; per side arm > forearm > hand and thigh > shin > foot. Frog list to mirror: `tools/rig/skeleton.mjs:250-268`.

## A finished rig, for comparison: `public/assets/creatures/leucomelas.swim.glb` (same dump script)
- 270 KB, 1 node (`leucomelas.swim`, scale 0.033), 1 mesh, 15,002 verts / 30,000 tris. No skin node, no animations, no textures (colour in COLOR_0; metal 0, rough 0.6). meshopt + KHR_mesh_quantization.
- Rig = two extra vertex attributes: `_RIG` (spine 0..1, leg id/8, legT, material id/8; `render/creatures/glb.js:15`) and `_SKIN` (`tools/bake-frogpose.mjs:131-132`). Bones are NOT in the GLB: names and hierarchy in `tools/rig/skeleton.mjs:250-268` (pelvis > spine > head; thigh > shin > foot > toes; arm > forearm > hand, per side), joint limits in `src/util/bodyplan.js`.
- `public/assets/creatures/manifest.json` entry: file + `.lo.glb`, tris 30000/10000, sizeCm, `finish.eyes`, pose. Runtime: `render/creatures/instanced.js:8-27` (leg ids, gait phase, rig2 head yaw/pitch, body bend, tail swing).

## How the skink is rigged today
- SDF body, no scan: `render/creatures/bodies/lizards.js:196` skinkShape (keels as displacement, rig "is the gecko's": rig.x spine 0..1, leg ids 1-4, header lines 10-13); `sim/animals.js:402-407` (anim amp 0.4, wave 1.0, stride 0.6, rig2 neck 0.13, s0 0.03, s1 0.17, neckY 0.55, len 16.8); mind `sim/skink.js:31-49`; `util/bodyplan.js:137` 'lizard'; `docs/SKELETON.md:22,155`.

## Rig gaps and workarounds
1. No bones or weights: bake `_RIG` + `_SKIN` with a lizard bone list (own file; frog pipeline files read-only).
2. 280k tris vs 30k hi / 10k lo: decimate to about 25-30k / 10k. The dorsal keels are many tiny spikes: keep a few big ones in the silhouette, bake the rest into normal/AO (or reuse the game's keel displacement).
3. Metal 0.7 in the ORM texture: override material to metal 0, rough about 0.6; drop the metalRough texture.
4. WebP extension required: check the loader accepts it.
5. Tail slopes down to the ground (tip y -0.095): bind straight; the tail swing (rig2) then acts from a horizontal base; raise it for the arched alert carriage seen in `MOTION_skink.md`.
6. Body is wide (0.19 of length = 3.2 cm at 16.8 cm; a real skink trunk is slimmer, guess about 2 cm): ask the user if the proportions may be slimmed with a warp.
7. Eyes and orange ring: not verified in the atlas; game draws eyes itself (`finish.eyes`); measure sockets on the baked mesh and add the ring there.
8. Toes fused: bind digit fans to the foot bone; legs by nearest-limb capsule (ids 1 FL, 2 FR, 3 BL, 4 BR).
