IDENTIFICATION: `~/Downloads/sample_2026-10-04T213641.596.glb` = GECKO, fairly sure (about 85%, not user-confirmed): tan/pink mottled base colour with dark flecks, widest hind limbs, tail curved. The other sample (213008.005, dark brown) = skink. Method: base-colour atlas viewed once (downscaled) + slice profile. Render one view to be certain.
Tool: `BB/tools/glb-dump.mjs <glb> [--profile=25] [--sil] [--extract-image=<dir>]` (no binary printed). Textures extracted to `BB/tools/tmp/`. Models not copied or moved.

## What the model contains (measured)
- 1 scene, 2 nodes (`world` > `geometry_0`), 1 mesh, 1 primitive, 201,412 verts, 299,094 tris. Attributes: POSITION, NORMAL, TEXCOORD_0 (float32). No colours, no skin, no bones, no animation, no morph targets. File 10.4 MB (trimesh export, AI image-to-3D look).
- Material: baseColor 1024x1024 WebP (mean RGB 113,95,83) + metalRough 1024x1024 WebP (G~250, B~1: rough, not metal); factors metal 1 / rough 1. Needs `EXT_texture_webp` (required).
- Seamless one-piece mesh: limbs, toes and head are not separate parts.

## Scale and axes (measured)
- bbox X -0.271..0.257 (0.528), Y -0.180..0.180 (0.361), Z -0.5006..0.5008 (1.0015). No units: normalised so total length = 1.0. Z = body axis, head at +Z, tail at -Z (head is the blunt wide end, tail tapers); Y up (soles at the bottom); X lateral.
- Game size: `rig2.len` 9.5 cm (`src/sim/animals.js:325`) so 1 unit = 9.5 cm (guess: mourning gecko adults ~9-10 cm total). Game convention: cm, faces +z, feet on y=0 (`bodies/salamanders.js:1`): shift y by +0.18.

## Segments (fractions of total length; 25 slices of 0.04, so +-0.02; x 9.5 cm at game size)
- Head (snout to nape) 0.00-0.11, width 0.09 at snout to 0.15 behind the eyes. Forelimb roots 0.12-0.28 (span 0.41-0.45 incl. trunk).
- Trunk between limb pairs 0.28-0.48, width 0.14-0.17, depth 0.13-0.17. Hind limb zone 0.48-0.68 (span 0.51-0.53). Vent about 0.68, so snout-to-vent about 0.68 (6.5 cm).
- Tail 0.68-1.00 axial (0.32), about 0.36-0.40 along its curve: only about 0.55 x SVL (guess: a real adult tail is about equal to SVL, so this tail is short or regrown). Width 0.096 at base to 0.055 at tip (blunt end). It swings to +X: lateral offset 0.26 at the tip.
- Limbs (horizontal projection, splayed): forelimb 0.14 out from the trunk edge, hind 0.18. Real segment lengths cannot be separated from one fused mesh: use the ratios below.
- Height: soles y=-0.18, belly -0.10..-0.125 (clearance 0.06-0.08 = 0.6-0.8 cm), head underside +0.04..+0.09 (head carried 0.22-0.27 above soles), tail at y -0.05..-0.04 (held 0.13 off the ground, level). The video gecko lies belly-down when walking, so this pose is too high-standing.

## Anatomy the rig must cover (ratios ESTIMATED +-30% from `AG/refs/gecko/*.jpg`: crested side view, tokay top view; viewed once)
- Skull 0.20-0.25 of SVL, broad and flat, with a mobile neck (about 8 cervical vertebrae); about 26 presacral vertebrae in all; ribs along most of the trunk (long, slender); 2 sacral vertebrae; about 30+ caudal vertebrae with fracture planes (tail drop, see `herp.js`).
- Pectoral girdle (scapula, coracoid, clavicle) just behind the skull; pelvis (ilium, ischium, pubis) at the sacrum.
- Forelimb: humerus 0.14, radius/ulna 0.14, hand 0.14 of SVL. Hindlimb: femur 0.17, tibia 0.17, foot 0.22 (fourth toe longest). Five digits per foot, each with a pad (lamellae): 2 bones per digit, or one fan bone for the pad.
- Suggested bones: pelvis > spine (chest) > neck > head; tail1..tail6; per side arm > forearm > hand(+digit fan) and thigh > shin > foot(+digit fan). Frog list to mirror: `tools/rig/skeleton.mjs:250-268`.

## A finished rig, for comparison: `public/assets/creatures/leucomelas.swim.glb` (same dump script)
- 270 KB, 1 node (`leucomelas.swim`, scale 0.033), 1 mesh, 15,002 verts / 30,000 tris. No skin node, no animations, no textures (colour in COLOR_0; metal 0, rough 0.6). meshopt + KHR_mesh_quantization (int16 normalised positions).
- Rig = two extra vertex attributes, `_RIG` (spine 0..1, leg id/8, legT, material id/8; `render/creatures/glb.js:15`) and `_SKIN` (bone ids, weight; `tools/bake-frogpose.mjs:131-132`). The bones are NOT in the GLB: bone names and hierarchy are in code (pelvis > spine > head; thighL/R > shinL/R > footL/R > toesL/R; armL/R > forearm > hand) and limits in `src/util/bodyplan.js` (anuran, caudate, lizard).
- Per-creature data in `public/assets/creatures/manifest.json`: file + `.lo.glb`, tris hi 30000 / lo 10000, sizeCm [6.56,1.65,6.61], `finish.eyes`, pose. Runtime channels: `render/creatures/instanced.js:8-27` (leg ids 1-4, gait phase, rig2 = head yaw/pitch, body bend, tail swing).

## How the gecko is rigged today
- SDF-built body, no scan: `bodies/salamanders.js:794` geckoShape, `:878` geckoBody, registry `:526`; kind -> 'lizard' plan `util/bodyplan.js:137`. Anim and rig2 numbers `sim/animals.js:321-326`; mind `sim/herp.js:97-101`; eye shader (slit pupil) `render/creatures/material.js:87`; audit `docs/SKELETON.md:21,155`. This sample would be the first scanned lizard.

## Rig gaps and workarounds
1. No bones or weights: bake `_RIG` + `_SKIN` with a lizard bone list (own file; frog pipeline files are read-only), nearest-capsule binding as `bindCapsules` does.
2. 299k tris vs 30k hi / 10k lo for the frog: decimate to about 25-30k / 10k, keep UVs, bake relief into the 1024 texture. Risk: thin toes and pad edges collapse; check the silhouette.
3. Pose is splayed and high: bind in this pose; lower the body by 0.06-0.08 with the spine bones for belly-down walking, and angle the forelimbs as in `MOTION_gecko.md`.
4. Tail curves sideways (0.26 offset) and is short: the rig2 tail swing assumes a straight tail. Place tail bones along the curve, or straighten with a warp (`tools/rig/warps.mjs`); lengthening is a design choice to ask the user.
5. Not left-right symmetric (x range -0.271/+0.257): do not weight by sign of x; assign legs by nearest limb capsule (ids 1 FL, 2 FR, 3 BL, 4 BR).
6. Material factors metal 1 rough 1: override to metal 0 / rough 0.6 like the frog; WebP extension: check the loader accepts it (repo imports use WebP).
7. Eyes: not verified (mesh eyes not inspected); game draws its own (`finish.eyes`, slit): measure the eye sockets on the baked mesh.
8. Toes/pads cannot be separated from the fused mesh: bind each toe fan to the foot bone, no per-toe motion without a re-model.
