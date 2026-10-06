// Skin maps of the toad bodies (owner's photos, 6 Oct 2026): each carries a colour map and a tangent-space normal map, both WebP, square, a
// power of two, at most 1024, and the normal map is a real normal map (blue dominant, mean close to (0.5, 0.5, 1)). Put in tests/, run after
// tools/rig/set-texture.mjs has embedded both maps in toad.glb and toad.swim.glb.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const pow2 = (n) => n > 0 && (n & (n - 1)) === 0;

for (const id of ['toad', 'toad.swim']) {
  test(`${id}: colour and normal maps are WebP, square, power of two, at most 1024`, async () => {
    const doc = await io.read(`public/assets/creatures/${id}.glb`);
    const mat = doc.getRoot().listMaterials()[0];
    for (const [name, tex] of [['colour', mat.getBaseColorTexture()], ['normal', mat.getNormalTexture()]]) {
      assert.ok(tex, `${id} has a ${name} map`);
      assert.equal(tex.getMimeType(), 'image/webp', `${id} ${name} map is WebP`);
      const [w, h] = tex.getSize();
      assert.equal(w, h, `${id} ${name} map is square`);
      assert.ok(pow2(w) && w <= 1024, `${id} ${name} map is a power of two, at most 1024 (is ${w})`);
    }
  });
  test(`${id}: the normal map is a tangent-space normal map`, async () => {
    const doc = await io.read(`public/assets/creatures/${id}.glb`);
    const tex = doc.getRoot().listMaterials()[0].getNormalTexture();
    const { data, info } = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let r = 0, g = 0, b = 0; const n = info.width * info.height;
    for (let i = 0; i < n; i++) { r += data[i * 3]; g += data[i * 3 + 1]; b += data[i * 3 + 2]; }
    r /= n * 255; g /= n * 255; b /= n * 255;
    assert.ok(Math.abs(r - 0.5) < 0.06 && Math.abs(g - 0.5) < 0.06 && b > 0.85, `mean (${r.toFixed(2)}, ${g.toFixed(2)}, ${b.toFixed(2)}) is flat-ish blue`);
  });
}
