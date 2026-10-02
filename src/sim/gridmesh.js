// Mesh arithmetic for the height-field meshes (the substrate and the back wall), straight on typed arrays.
//
// Sculpting, moss growth, erosion and the generator all refresh these meshes, some of them every frame, so the refresh
// has to be cheap: no array per vertex, no Vector3 per triangle. Pure functions with no scene, so Node tests can run them.

// Vertex normals of an indexed triangle mesh: the face normals (cb x ab, so area-weighted) summed per vertex in index
// order, then normalised. Bit-identical to THREE.BufferGeometry.computeVertexNormals for indexed geometry (checked by
// tests/gridmesh.test.mjs), about ten times faster.
export function normalsFromIndexed(pos, index, out) {
  out.fill(0);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    const cbx = pos[c] - pos[b], cby = pos[c + 1] - pos[b + 1], cbz = pos[c + 2] - pos[b + 2];
    const abx = pos[a] - pos[b], aby = pos[a + 1] - pos[b + 1], abz = pos[a + 2] - pos[b + 2];
    const nx = cby * abz - cbz * aby, ny = cbz * abx - cbx * abz, nz = cbx * aby - cby * abx;
    out[a] += nx; out[a + 1] += ny; out[a + 2] += nz;
    out[b] += nx; out[b + 1] += ny; out[b + 2] += nz;
    out[c] += nx; out[c + 1] += ny; out[c + 2] += nz;
  }
  for (let i = 0; i < out.length; i += 3) {
    const x = out[i], y = out[i + 1], z = out[i + 2];
    const l = Math.sqrt(x * x + y * y + z * z) || 1;
    out[i] = x / l; out[i + 1] = y / l; out[i + 2] = z / l;
  }
  return out;
}
