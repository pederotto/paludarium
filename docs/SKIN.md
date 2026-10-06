# Skin maps (realistic colour and relief)

The fire-bellied toad (`toad`, sitting, and `toad.swim`) carries two baked maps per body: a **colour map** (sRGB, no lighting) and a
**tangent-space normal map** (OpenGL, green up), both 1024² WebP, embedded in the creature GLB (`tools/rig/set-texture.mjs`). The look
(lime green, rough black blotches, honeycomb tubercles about 0.9 mm across, marbled orange belly, banded limbs, orange toe tips) comes from
the owner's reference photographs, which are kept out of git (`.agents/refs/`); no third-party image data is in the game.

## How the maps are made (tools/skin/)
1. Decode the baked body to a plain GLB (`tools/rig/glb-plain.mjs`) and export its skeleton: `node tools/skin/export-bones.mjs toad out/toad.bones.json`.
2. Bake in headless Blender (5.x, Cycles): `Blender -b -P tools/skin/skinlab.py -- --mesh out/toad.plain.glb --variant after --geo --bones out/toad.bones.json
   --eyebaked "<x>,<up>,<fwd>,<r>" --bake out/toad`. The procedural skin lives in `skinlab.py` (`SKIN` dict): domain-warped Voronoi tubercles with per-cell
   height, noise blotches sampled at each tubercle's centre, belly and limb undersides from the mesh normals, limb bands from the surface distance
   from the trunk, toe zones from the last bone of each hand and foot. Regions come from the game's own skeleton (manifest bones), so the recipe fits
   any frog body baked by the pipeline. It writes `<base>_color.png`, `<base>_normal.png` and `<base>_uv.npz`.
3. `python3 tools/skin/clean_normal.py out/toad_uv.npz out/toad_normal.png out/toad_normal_clean.png` flattens the bake gutter and invalid texels.
4. Convert both to WebP (colour q88, normal q90), keep them in `art-src/textures/<id>/`, embed with `set-texture.mjs`.
5. Check: `--variant baked --maps out/toad --view photo2|head|swim` renders the baked maps back (Cycles) next to the photos.
UVs come from the game bake (xatlas, deterministic): a mesh change that moves vertices without changing the atlas keeps the maps valid; a new atlas needs a re-bake
(minutes per body). Target texel density 90-130 per cm (sitting p50 104, swim p50 97).

## In the game (src/render/creatures/material.js, instanced.js)
- A body that carries a normal map gets `nmap`: the map is applied in view space around the shader's own skinned normal with three's derivative tangent
  frame (a creature has no tangent attribute and the 8 vertex buffers are full), for the skin and the clear coat. A body without one renders as before.
- `NORMALMAP_GREEN = -1`: Blender's bitangent runs opposite to three's derivative one, and three's GLTFLoader flips normalScale.y for meshes without tangents
  (mrdoob/three.js#11438). The function is pixel-identical to three's built-in normal map with normalScale (1, -1).
- Wet green against matte black without a third map: the darker the colour texel, the rougher and the less coated (`finish.matteBlack` overrides).
- Eyes: the maps keep a flat, dark eye zone out to 1.32 r around each analytic eye (tools/paint/eyes.mjs, `eyeCm` in the bake jobs); a body without eye bumps
  gets domes in the bake (`dome: true`), applied after the unwrap.

## Budget
Colour 0.2 MB + normal 0.25-0.3 MB per body (WebP); `toad.glb` 0.68 MB, `toad.swim.glb` 1.15 MB. The owner allows the 1.2 MB file line to be exceeded by 20% when frame
cost does not grow linearly: measure GPU memory and frame cost (docs/METRICS.md) before using it.

## Other species
Each species needs photographs of its own (the image-to-3D generator cannot texture an uploaded mesh) and a recipe pass in `SKIN` (palette, tubercle size, blotch
size, band period). The slim swim scan is the base for the European edible/common frog and will be reskinned the same way.
