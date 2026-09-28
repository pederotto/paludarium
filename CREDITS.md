# Credits

## Libraries

- **[three.js](https://github.com/mrdoob/three.js)** r186, MIT. The renderer (WebGPU and WebGL 2), TSL shading language, OrbitControls, RoomEnvironment and BufferGeometryUtils. It loads from the jsDelivr CDN at runtime.

## Assets and code from SeedThree

[SeedThree](https://github.com/SkyeShark/SeedThree) by SkyeShark, MIT License, Copyright (c) 2026 SkyeShark.

Textures, resized to 256–512 px by `tools/import-seedthree.cjs`:

| File here | SeedThree source |
|---|---|
| `assets/ground/soil.jpg` | `assets/ground/desert_ground_albedo.png` (tinted in the shader for soil and sand) |
| `assets/ground/gravel.jpg` | `assets/ground/gravel_albedo.png` |
| `assets/ground/rock.jpg` | `assets/ground/rock_albedo.png` |
| `assets/ground/rock_normal.jpg` | `assets/ground/rock_normal.png` |
| `assets/ground/mossy_rock.jpg` | `assets/ground/rock3_albedo.png` |
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

## Inspiration

- **[CAUSTIC//VOLUME](https://github.com/scottiefox/caustic-volume)** by Scottie (MIT) inspired the underwater look. Paludarium's caustics are its own simpler, noise-based version, not a port.
