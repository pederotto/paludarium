// Shared by tools/meshy-decor.mjs and tools/meshy-piece.mjs: simplification of a generated (Meshy) static model that keeps its texture.
//
// Attribute-aware simplification (meshoptimizer simplifyWithAttributes): the UVs and normals count in the error, so an edge is not
// collapsed where that would smear the texture. The plain position-only simplifier either stalls far above the budget (every UV
// island is a border: a 2.1 M triangle rock stopped at 340 k) or, with Permissive alone, collapses across seams and scrambles the
// texture (chevron smears on leaves and rock). Permissive stays on so seams can still collapse where the attributes agree.
import { compactPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

export const slug = (file) => file.split('/').pop().replace(/\.glb$/, '').replace(/^Meshy_AI_/, '').replace(/_\d{4}(\d{6})_texture$/, '_$1').replace(/_+_/, '_').toLowerCase();

// Simplifies every primitive of the document so that the whole stays near `budget` triangles (each primitive gets its share, at least
// 300). o: err (target error, 0.5 lets the budget decide), uvw, nw (attribute weights), permissive.
export function simplifyAttr(document, budget, o = {}) {
  const { err = 0.5, uvw = 2, nw = 0.5, permissive = true } = o;
  const prims = document.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
  const total = prims.reduce((n, p) => n + p.getIndices().getCount() / 3, 0);
  for (const prim of prims) {
    const pos = prim.getAttribute('POSITION'), uv = prim.getAttribute('TEXCOORD_0'), nor = prim.getAttribute('NORMAL');
    const idx = Uint32Array.from(prim.getIndices().getArray()), n = pos.getCount();
    const target = Math.max(300, Math.round((idx.length / 3 / total) * budget)) * 3;
    if (idx.length <= target) continue;
    const stride = (uv ? 2 : 0) + (nor ? 3 : 0), at = new Float32Array(n * stride), w = [];
    if (uv) w.push(uvw, uvw);
    if (nor) w.push(nw, nw, nw);
    for (let i = 0; i < n; i++) {
      let k = i * stride;
      if (uv) { const t = uv.getElement(i, [0, 0]); at[k++] = t[0]; at[k++] = t[1]; }
      if (nor) { const v = nor.getElement(i, [0, 0, 0]); at[k++] = v[0]; at[k++] = v[1]; at[k++] = v[2]; }
    }
    const [dst] = MeshoptSimplifier.simplifyWithAttributes(idx, pos.getArray(), 3, at, stride, w, null, target, err, permissive ? ['Permissive'] : []);
    prim.getIndices().setArray(dst);
    compactPrimitive(prim);
  }
}
