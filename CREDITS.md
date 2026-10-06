# Credits

## Libraries

- **[Preact](https://preactjs.com)** and **[@preact/signals](https://github.com/preactjs/signals)** (MIT): the interface. **[Vite](https://vitejs.dev)** (MIT): the build. **[Playwright](https://playwright.dev)** (Apache-2.0): the screenshot and test harness. Fonts: **Fraunces** and **Inter** via Fontsource (SIL OFL).

- **[three.js](https://github.com/mrdoob/three.js)** r186, MIT. The renderer (WebGPU and WebGL 2), TSL shading language, OrbitControls, RoomEnvironment, GLTFLoader, BufferGeometryUtils and the bloom post-processing node. It is bundled by Vite. The ripple simulation in `src/render/waterfx.js` follows the structure of its `webgpu_compute_water` example.
- **[gltf-transform](https://github.com/donmccurdy/glTF-Transform)** (MIT) and **[meshoptimizer](https://github.com/zeux/meshoptimizer)** (MIT), used offline by `tools/import-polyhaven.mjs` and `tools/import-creatures.mjs` to simplify models and pack them as .glb (meshopt, WebP textures).
- **[sharp](https://github.com/lovell/sharp)** (Apache-2.0), used offline to resize textures.
- **[camera-controls](https://github.com/yomotsu/camera-controls)** by yomotsu (MIT): the camera (eased orbit, pan and zoom toward the pointer, animated views).
- **[three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh)** by Garrett Johnson (MIT): bounding volume hierarchies for fast ray casts when rocks are stamped into the ground.
- three.js's **TransformControls** (the handles for moving, turning and scaling rocks), **GTAONode** (ambient occlusion) and the flow-map technique of **Water2Mesh** (after Alex Vlachos, "Water Flow in Portal 2", SIGGRAPH 2010), used for the moving foam and streaks on streams.

## Techniques

- The water outside the main pool uses the "virtual pipes" shallow-water model from X. Mei, P. Decaudin and B.-G. Hu, "Fast Hydraulic Erosion Simulation and Visualization on GPU" (Pacific Graphics 2007), as used by open-source terrain simulators such as [LanLou123/Webgl-Erosion](https://github.com/LanLou123/Webgl-Erosion) and [bshishov/UnityTerrainErosionGPU](https://github.com/bshishov/UnityTerrainErosionGPU). Written from the paper for this project.

## CAUSTIC//VOLUME

[CAUSTIC//VOLUME](https://github.com/scottiefox/caustic-volume) by Scottie, MIT License, Copyright (c) 2026 Scottie. Ported to three.js WebGPU/TSL:

- `src/render/waterfx.js`: the ripple height field (wave equation, glass walls reflect the waves), and the caustics: a grid on the surface sends refracted light rays to the floor and the area ratio of each patch gives its brightness. Also the way bodies move the water, after the sandbox's coupling of its floating objects (`sandbox/src/10_sim.js`): each body is a few spheres, and the column of water a sphere takes up now, less the one it took up a step ago, goes into the height field; and its solver's viscosity on the surface's vertical speed. Written anew for this game's animals (their skeletons are the spheres).
- `src/render/creatures/mesher.js` and `kit.js`: the surface-nets meshing idea (from the rubber duck in `lite/index.html`) and the SDF helpers (ellipsoid distance, smooth minimum). The mesher here is a new adaptive version with two levels of detail, a vertex rig for animation and per-material shading.

## Poly Haven (CC0)

Photoscanned models and textures from [Poly Haven](https://polyhaven.com), all CC0 (public domain). Poly Haven isn't reachable from every network, so they were taken from the public mirror in [JimLiu/taohuayuan](https://github.com/JimLiu/taohuayuan) (`assets-src/polyhaven`) and optimised by `tools/import-polyhaven.mjs`.

- Models in `assets/models/`: rock_moss_set_01, rock_moss_set_02, rock_face_01, root_cluster_01, fern_02, weed_plant_02, tree_stump_01, dead_tree_trunk.
- Textures in `assets/ground/`: clean_pebbles (sand), forest_ground_04 (soil), mossy_rock (rock), lichen_rock (dark stone, spires), cliff_side (spires), forrest_ground_01, brown_mud_leaves_01.

## Assets and code from SeedThree

[SeedThree](https://github.com/SkyeShark/SeedThree) by SkyeShark, MIT License, Copyright (c) 2026 SkyeShark.

Textures, resized to 256–512 px by `tools/import-seedthree.cjs`:

| File here | SeedThree source |
|---|---|
| `assets/ground/soil.jpg` | `assets/ground/desert_ground_albedo.png` (tinted in the shader for soil and sand) |
| `assets/ground/gravel.jpg` | `assets/ground/gravel_albedo.png` |
| `assets/ground/rock.jpg` | `assets/ground/rock_albedo.png` |
| `assets/ground/rock_normal.jpg` | `assets/ground/rock_normal.png` |
| `assets/ground/moss.jpg` | `assets/ground/grass_albedo.png` (tinted as moss) |
| `assets/ground/bark.jpg` | `assets/ground/rock2_albedo.png` (used as cork bark) |
| `assets/cards/fern.png` | `assets/leaves/fern_albedo.png` |
| `assets/cards/cattail.png` | `assets/leaves/cattail_reed_card.png` |
| `assets/cards/grass_tuft.png` | `assets/leaves/grass_tuft.png` |
| `assets/cards/bilberry.png` | `assets/leaves/bilberry_albedo.png` |

Code: the rock shapes in `src/sim/decor.js` (welded, noise-displaced icosahedra with triplanar rock textures) are adapted from SeedThree's `src/core/rocks.js`.

The MIT license text of CAUSTIC//VOLUME and SeedThree (Paludarium's own licence is in `LICENSE`; it does not change these):

```
MIT License

Copyright (c) 2026 Scottie (CAUSTIC//VOLUME)
Copyright (c) 2026 SkyeShark (SeedThree)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Creature models

The clown loach, the sculpted frog and the salamander meshes (`art-src/raw/`) were supplied by the project owner (AI-generated, reference photos of a clown loach, yellow-banded poison frog, strawberry poison frog and fire salamander). `tools/bake-creature.mjs` paints the untextured meshes procedurally with vertex colours (`tools/paint/`); `tools/import-creatures.mjs` compresses the textured loach. Game assets total about 1.4 MB. The frog swimming-pose scan (`art-src/raw/frog_swim_mesh.glb`, with the leaping-pose scan `frog_leap_mesh.glb` kept for later) was supplied by the project owner too, AI-generated from the reference photos in `art-src/raw/reference/`; `tools/bake-frogpose.mjs` paints it with the same species colours into `<species>.swim.glb`.

- Red-eyed tree frog (`public/assets/creatures/redeye.glb`, `redeye.lo.glb`): an AI-generated untextured mesh of a standing *Agalychnis callidryas* the project owner supplied through the Paludarium Drop on 2026-10-03 (original kept as `art-src/raw/redeye_frog_mesh.glb`), with AI-generated reference pictures (standing, leaping, clinging to a stem: `art-src/raw/reference/agalychnis_*.jpg`); rig, ambient occlusion and a painted 1024 texture baked by `tools/bake-creature.mjs redeye` (`tools/paint/callidryas.mjs`).
- Dwarf shrimp (`public/assets/creatures/shrimp.glb`, `shrimp.lo.glb`, every colour line and the blue dream): an AI-generated untextured shrimp mesh the project owner supplied on the same day (original `art-src/raw/shrimp_mesh.glb`, reference picture `art-src/raw/reference/shrimp_banded.jpg`); rig (`tools/rig/shrimp.mjs`, which also adds the long antennae, the swimmerets and the egg clutch as geometry) and a pigment-mask texture baked by `tools/bake-creature.mjs shrimp`; the game colours it per colour line.
- Vampire crab (`public/assets/creatures/crab.glb`, `crab.lo.glb`): an AI-generated untextured mesh the project owner supplied through the Paludarium Drop on 2026-10-02 (original kept as `art-src/raw/crab_mesh.glb`, SHA-256 ce7311aa…5a8a); rig, colours and ambient occlusion baked by `tools/bake-creature.mjs crab`.
- Mourning gecko (`public/assets/creatures/gecko.glb`, `gecko.lo.glb`): gecko mesh provided by the project owner, Peder Winterniz, 2026-10-04, a generated textured model (original kept untouched as `art-src/raw/gecko_mesh.glb`, SHA-256 f19935a4e2fe4a24…); tail straightened along its length, simplified with its own UVs and base-colour texture, skeleton and skin binding baked by `tools/bake-lizard.mjs gecko`.
- Red-eyed crocodile skink (`public/assets/creatures/skink.glb`, `skink.lo.glb`): skink mesh provided by the project owner, Peder Winterniz, 2026-10-04, a generated textured model (original kept untouched as `art-src/raw/skink_mesh.glb`, SHA-256 413cc9026743a9a7…); tail levelled and straightened along its length, simplified with its own UVs and base-colour texture, skeleton and skin binding baked by `tools/bake-lizard.mjs skink`.
- Pygmy sunfish (`public/assets/creatures/pygmy.glb`, `pygmy.lo.glb`): a textured AI-generated sunfish model the project owner supplied on 2026-10-02 (`bluespotted_sunfish.glb`, original kept as `art-src/raw/bluespotted_sunfish.glb`, SHA-256 0a850705…e3ac3816). `tools/bake-texcolors.mjs` turns it, centres it and scales it to 3 cm; `tools/bake-sunfish.mjs` keeps the body and its photo texture (background filled from the fish's colours), drops the original fins and eye discs, builds new fins and paints their pattern into a corner of the texture.

## Orchid flower heads, petal atlas and leaf maps

Made in-house for the project owner, Peder Winterniz, with Blender 5.2 (headless; Noise, Voronoi and White Noise node bakes plus numpy), 2026-10-06: the Dracula, *Dendrobium cuthbertsonii* and Masdevallia flower heads (`src/sim/orchid-heads.js`, generated), the petal pattern and relief atlases and the four leaf, relief and hue maps (`public/assets/orchids/*.webp`). Sources and bake scripts: `art-src/orchids/` (`orchidlib.py`, `<species>.py`, `petal_bake.py`, `petal_relief_bake.py`, `leaf_bake.py`, `export_heads.py`, the `pack_*.py` scripts; the leaf outlines come from `tools/orchids/dump-leaf-shapes.mjs`). Shapes were judged by eye against the owner's reference photos; no photo pixel and no third-party mesh or texture is in them, so there is no third-party licence to record.
