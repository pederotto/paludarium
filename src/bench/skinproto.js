// Prototype: per-instance skeletal skinning from a bone data texture, against the game's per-vertex rig, on the creature bench
// (bench.html?sp=<id>&src=glb&proto=skin|rig&n=<instances>[&lod=hi][&webgl]; tools/skin-proto.mjs measures it). docs/SKELETON.md
// has the numbers and the plan.
//
// skin   every vertex is bound to 4 bones (bone ids and weights in a per-vertex data texture, read by vertex index: the creature
//        pipelines already use the 8 vertex buffers WebGPU allows, so skin attributes cannot be added as buffers); every instance
//        has its bone matrices in a row of a float texture written each frame from the CPU (15 bones: 3 along the spine and 3 down
//        each leg, a hierarchy composed in JS like a real skeleton would be); the vertex shader blends the four matrices, then
//        places the instance as the game does (render/creatures/instanced.js: position, quaternion, scale).
// rig    the game's material for the species (CreatureMesh), the same instances walking with the gait phase advancing.
// Both shade with the same creature material (render/creatures/material.js), so only the vertex stage and the per-frame CPU
// work differ.
import * as THREE from 'three/webgpu';
import { Fn, attribute, positionLocal, normalLocal, float, int, ivec2, vec3, vec4, mat4, textureLoad, vertexIndex, instanceIndex, transformNormalToView } from 'three/tsl';
import { CreatureMesh } from '../render/creatures/instanced.js';
import { creatureMaterial, qrot } from '../render/creatures/material.js';
import { packAnim } from '../util/gait.js';
import { SKIN, skinGeometry } from '../render/creatures/skin.js';

const NB = 15;          // bones: 0 … 2 the spine (pelvis, trunk, head), then 3 per leg (upper, lower, foot) for legs 1 … 4

export async function start({ renderer, scene, cam, lod, sp, q, info }) {
  const n = +(q.get('n') ?? 200), mode = q.get('proto');
  const src = (q.get('lod') === 'hi' && lod.hi ? lod.hi : lod.lo).geometry;
  lod.lo.mesh.visible = false; if (lod.hi) lod.hi.mesh.visible = false;
  // the species' geometry without the instance attributes
  const geo = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(src.attributes)) if (!/^i[A-Z]/.test(k)) geo.setAttribute(k, a);
  geo.setIndex(src.index);
  const P = geo.attributes.position.array, R = geo.attributes.rig.array, nv = P.length / 3;
  geo.computeBoundingBox();
  const bb = geo.boundingBox, ext = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 1.15;
  const cols = Math.ceil(Math.sqrt(n));
  const where = (i) => new THREE.Vector3(((i % cols) - cols / 2) * ext, 0, (Math.floor(i / cols) - cols / 2) * ext);
  cam.position.set(0, cols * ext * 0.9, cols * ext * 0.75); cam.lookAt(0, 0, 0); cam.far = 1e4; cam.updateProjectionMatrix();
  const opts = lod.opts;
  const stats = { mode, n, verts: nv, cpuMs: 0, frames: 0 };
  window.proto = stats;
  const quat = new THREE.Quaternion();

  // the game's own skinning (render/creatures/skin.js): the fine mesh of a scanned frog with its baked skeleton, walking
  if (mode === 'engine') {
    const hg = lod.opts.hiGeometry;
    if (!hg?.userData?.skeleton) { info.textContent = 'no skeleton on this model'; return; }
    SKIN.cap = n;
    const m = new CreatureMesh(scene, skinGeometry(hg), { ...opts, finish: lod.lo.finish, cap: n, skin: hg.userData.skeleton });
    stats.verts = hg.attributes.position.count;
    renderer.setAnimationLoop(() => {
      const t = performance.now() / 1000, c0 = performance.now();
      m.begin();
      for (let i = 0; i < n; i++) m.put(where(i), quat, sp.scale ?? 1, t * 3 + i, 0, t * 6 + i, packAnim(0, 0, 0, 0, 0, 0), 0.2, 0, 0, 0, 1, 0, 0, 0, 0);
      m.end();
      stats.cpuMs += performance.now() - c0; stats.frames++;
      renderer.render(scene, cam);
    });
    info.textContent = `engine skin x ${m.skinCap}, ${stats.verts} verts`;
    return;
  }

  if (mode === 'rig') {
    const m = new CreatureMesh(scene, geo, { ...opts, cap: n });
    renderer.setAnimationLoop(() => {
      const t = performance.now() / 1000, c0 = performance.now();
      m.begin();
      for (let i = 0; i < n; i++) m.put(where(i), quat, sp.scale ?? 1, t * 3 + i, 0, t * 6 + i, packAnim(0, 0, 0, 0, 0, 0), 0.2, 0, 0, 0, 1, 0, 0, 0, 0);
      m.end();
      stats.cpuMs += performance.now() - c0; stats.frames++;
      renderer.render(scene, cam);
    });
    info.textContent = `rig x ${n}, ${nv} verts`;
    return;
  }

  // --- skin: bind the vertices (bone ids from the rig's spine / leg / legT, blended across the bands) ------------------------------
  const W = 1024, H = Math.ceil(nv / W);
  const skinData = new Float32Array(W * 2 * H * 4);
  const heads = Array.from({ length: NB }, () => [0, 0, 0, 0]);
  for (let i = 0; i < nv; i++) {
    const s = R[i * 4], l = Math.round(R[i * 4 + 1]), t = R[i * 4 + 2];
    const band = (u) => Math.min(2, Math.floor(u * 3)), f = (u) => u * 3 - Math.floor(u * 3);
    const b0 = l >= 1 && l <= 4 ? 3 + (l - 1) * 3 + band(t) : band(s), u = l >= 1 && l <= 4 ? f(t) : f(s);
    const b1 = l >= 1 && l <= 4 ? (band(t) < 2 ? b0 + 1 : b0) : (band(s) < 2 ? b0 + 1 : b0);
    const o = ((Math.floor(i / W) * W * 2) + (i % W) * 2) * 4;
    skinData.set([b0, b1, 0, 0], o); skinData.set([1 - u * 0.5, u * 0.5, 0, 0], o + 4);
    const h = heads[b0]; h[0] += P[i * 3]; h[1] += P[i * 3 + 1]; h[2] += P[i * 3 + 2]; h[3]++;
  }
  for (const h of heads) if (h[3]) { h[0] /= h[3]; h[1] /= h[3]; h[2] /= h[3]; }
  const skinTex = new THREE.DataTexture(skinData, W * 2, H, THREE.RGBAFormat, THREE.FloatType);
  skinTex.needsUpdate = true;
  const boneData = new Float32Array(NB * 4 * n * 4);
  const boneTex = new THREE.DataTexture(boneData, NB * 4, n, THREE.RGBAFormat, THREE.FloatType);
  boneTex.needsUpdate = true;
  const parent = (b) => (b < 3 ? b - 1 : (b - 3) % 3 === 0 ? 1 : b - 1);

  const g = new THREE.InstancedBufferGeometry();
  for (const [k, a] of Object.entries(geo.attributes)) g.setAttribute(k, a);
  g.setIndex(geo.index);
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4), iRot = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  for (let i = 0; i < n; i++) { const p = where(i); iPos.setXYZW(i, p.x, p.y, p.z, sp.scale ?? 1); iRot.setXYZW(i, 0, 0, 0, 1); }
  g.setAttribute('iPos', iPos); g.setAttribute('iRot', iRot);
  g.instanceCount = n;
  const { material: mat, n: nrm } = creatureMaterial(opts.finish, { ...(opts.textures ?? {}), pass: 'all' });
  const qn = attribute('iRot', 'vec4'), ip = attribute('iPos', 'vec4');
  const vi = int(vertexIndex), sx = vi.mod(W).mul(2), sy = vi.div(W);
  const ids = textureLoad(skinTex, ivec2(sx, sy)), ws = textureLoad(skinTex, ivec2(sx.add(1), sy));
  const row = int(instanceIndex);
  const M = (b) => { const c = int(b).mul(4); return mat4(textureLoad(boneTex, ivec2(c, row)), textureLoad(boneTex, ivec2(c.add(1), row)), textureLoad(boneTex, ivec2(c.add(2), row)), textureLoad(boneTex, ivec2(c.add(3), row))); };
  const skinM = Fn(() => M(ids.x).mul(ws.x).add(M(ids.y).mul(ws.y)).add(M(ids.z).mul(ws.z)).add(M(ids.w).mul(ws.w)))().toVar();
  mat.positionNode = Fn(() => { const p = skinM.mul(vec4(positionLocal, 1)).xyz; return qrot(qn, p.mul(ip.w)).add(ip.xyz); })();
  mat.normalNode = transformNormalToView(qrot(qn, skinM.mul(vec4(nrm ?? normalLocal, 0)).xyz.normalize()));
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);

  const L = Array.from({ length: NB }, () => new THREE.Matrix4()), Wm = Array.from({ length: NB }, () => new THREE.Matrix4());
  const T1 = new THREE.Matrix4(), T2 = new THREE.Matrix4(), Rm = new THREE.Matrix4();
  renderer.setAnimationLoop(() => {
    const t = performance.now() / 1000, c0 = performance.now();
    for (let i = 0; i < n; i++) {
      const ph = t * 6 + i;
      for (let b = 0; b < NB; b++) {
        // a joint turn about the bone's head: the legs swing, the spine waves (enough to cost what a gait would)
        const leg = b >= 3 ? Math.floor((b - 3) / 3) : -1, a = leg >= 0 ? 0.35 * Math.sin(ph + (leg === 0 || leg === 3 ? 0 : Math.PI)) * (1 + ((b - 3) % 3) * 0.3) : 0.08 * Math.sin(ph * 0.5 + b);
        const h = heads[b];
        Rm.makeRotationY(a); T1.makeTranslation(h[0], h[1], h[2]); T2.makeTranslation(-h[0], -h[1], -h[2]);
        L[b].multiplyMatrices(T1, Rm).multiply(T2);
        const pb = parent(b);
        if (pb >= 0) Wm[b].multiplyMatrices(Wm[pb], L[b]); else Wm[b].copy(L[b]);
        boneData.set(Wm[b].elements, (i * NB + b) * 16);
      }
    }
    boneTex.needsUpdate = true;
    stats.cpuMs += performance.now() - c0; stats.frames++;
    renderer.render(scene, cam);
  });
  info.textContent = `skin x ${n}, ${nv} verts, ${NB} bones`;
}
