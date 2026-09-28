# Credits

## Libraries

- **[three.js](https://github.com/mrdoob/three.js)** r186, MIT. The renderer (WebGPU and WebGL 2), TSL shading language, OrbitControls, RoomEnvironment, GLTFLoader, BufferGeometryUtils and the bloom post-processing node. It loads from the jsDelivr CDN at runtime. The ripple simulation in `src/waterfx.js` follows the structure of its `webgpu_compute_water` example.
- **[gltf-transform](https://github.com/donmccurdy/glTF-Transform)** (MIT) and **[meshoptimizer](https://github.com/zeux/meshoptimizer)** (MIT), used offline by `tools/import-polyhaven.mjs` to simplify the scanned models and pack them as .glb.
- **[sharp](https://github.com/lovell/sharp)** (Apache-2.0), used offline to resize textures.
- **[camera-controls](https://github.com/yomotsu/camera-controls)** by yomotsu (MIT): the camera (eased orbit, pan and zoom toward the pointer, animated views). Loaded from jsDelivr.
- **[three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh)** by Garrett Johnson (MIT): bounding volume hierarchies for fast ray casts when rocks are stamped into the ground. Loaded from jsDelivr.
- three.js's **TransformControls** (the handles for moving, turning and scaling rocks), **GTAONode** (ambient occlusion) and the flow-map technique of **Water2Mesh** (after Alex Vlachos, "Water Flow in Portal 2", SIGGRAPH 2010), used for the moving foam and streaks on streams.

## Techniques

- The water outside the main pool uses the "virtual pipes" shallow-water model from X. Mei, P. Decaudin and B.-G. Hu, "Fast Hydraulic Erosion Simulation and Visualization on GPU" (Pacific Graphics 2007), as used by open-source terrain simulators such as [LanLou123/Webgl-Erosion](https://github.com/LanLou123/Webgl-Erosion) and [bshishov/UnityTerrainErosionGPU](https://github.com/bshishov/UnityTerrainErosionGPU). Written from the paper for this project.

## CAUSTIC//VOLUME

[CAUSTIC//VOLUME](https://github.com/scottiefox/caustic-volume) by Scottie, MIT License, Copyright (c) 2026 Scottie. Ported to three.js WebGPU/TSL:

- `src/waterfx.js`: the ripple height field (wave equation, glass walls reflect the waves), and the caustics: a grid on the surface sends refracted light rays to the floor and the area ratio of each patch gives its brightness.
- `src/creatures.js`: the naive surface-nets mesher (from the rubber duck in `lite/index.html`) and its SDF helpers (ellipsoid distance, smooth minimum).

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

Code: the rock shapes in `src/decor.js` (welded, noise-displaced icosahedra with triplanar rock textures) are adapted from SeedThree's `src/core/rocks.js`.

SeedThree's MIT license text:

```
MIT License

Copyright (c) 2026 SkyeShark

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
