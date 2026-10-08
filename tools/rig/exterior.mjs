// Holes seen from outside (the common frog, 7 Oct 2026; the owner's test for a posed body: "prove zero visible back-face holes from the exterior"). The game draws a
// creature's faces one-sided (back faces culled), so wherever the nearest surface along a line of sight is a back face (a face turned inside out, or the inside of
// the far wall through an opening in the skin), the renderer shows what lies behind it: a hole. Hidden folds (a back face with a front face just behind it, within
// `creaseCm`, as in a crease where skin presses on skin) draw as skin and are not counted. Of the rest, `seeThrough`: no skin of the body behind at all (the
// background or the ground shows through the animal); the others show some other skin of the body behind the fold.
// The posed body is drawn from `views` directions over the upper half of the sky (the camera stays above the ground; the ground, y = 0 of the ground frame, hides what
// is under it), orthographic, on a grid of `pixelCm`; per view the pixels whose nearest face is a back face with no front face within creaseCm behind it, and the
// largest such patch over all views, by the bone of the face.
//   exterior(Q, I, faceBone, names, { toGround, views, pixelCm, creaseCm })  Q: posed positions (cm, model frame), I: triangles, faceBone(t): a face's main bone,
//                                                                           toGround(p): model -> ground frame (y up from the ground)
export function exterior(Q, I, faceBone, names, { toGround = (p) => p, views = 96, pixelCm = 0.02, creaseCm = 0.05, ground = true } = {}) {
  const n = Q.length / 3, G = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) { const g = toGround([Q[i * 3], Q[i * 3 + 1], Q[i * 3 + 2]]); G[i * 3] = g[0]; G[i * 3 + 1] = g[1]; G[i * 3 + 2] = g[2]; }
  // the directions looked along (from the camera into the scene): a Fibonacci spiral over the half sphere looking down, horizontal to straight down
  const dirs = []; for (let k = 0; k < views; k++) { const y = -(k + 0.5) / views, r = Math.sqrt(1 - y * y), a = k * Math.PI * (3 - Math.sqrt(5)); dirs.push([r * Math.cos(a), y, r * Math.sin(a)]); }
  let worst = { areaMm2: 0, dir: null, byBone: {} }, totalPx = 0, viewsWithHoles = 0, viewsSeeThrough = 0, worstSee = 0; const allBones = {}, spots = [];
  for (const d of dirs) {
    // the view's frame: u across, v up the screen, depth along d
    const t0 = Math.abs(d[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0], u = norm(cross(d, t0)), v = cross(u, d);
    let u0 = 9e9, u1 = -9e9, v0 = 9e9, v1 = -9e9; const U = new Float64Array(n), Vv = new Float64Array(n), D = new Float64Array(n);
    for (let i = 0; i < n; i++) { const p = [G[i * 3], G[i * 3 + 1], G[i * 3 + 2]]; U[i] = dot(p, u); Vv[i] = dot(p, v); D[i] = dot(p, d); u0 = Math.min(u0, U[i]); u1 = Math.max(u1, U[i]); v0 = Math.min(v0, Vv[i]); v1 = Math.max(v1, Vv[i]); }
    const W = Math.ceil((u1 - u0) / pixelCm) + 2, H = Math.ceil((v1 - v0) / pixelCm) + 2, zAll = new Float64Array(W * H).fill(Infinity), zFront = new Float64Array(W * H).fill(Infinity), fAll = new Int32Array(W * H).fill(-1);
    const back = new Uint8Array(W * H);
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2], ax = (U[a] - u0) / pixelCm, ay = (Vv[a] - v0) / pixelCm, bx = (U[b] - u0) / pixelCm, by = (Vv[b] - v0) / pixelCm, cx = (U[c] - u0) / pixelCm, cy = (Vv[c] - v0) / pixelCm;
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax); if (Math.abs(area) < 1e-12) continue;
      // (front facing: its outward normal toward the camera, against d; on this screen (u right, v up, looking along d) its corners turn counter-clockwise, area > 0)
      const isBack = area < 0;
      const xa = Math.max(0, Math.floor(Math.min(ax, bx, cx))), xb = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx))), ya = Math.max(0, Math.floor(Math.min(ay, by, cy))), yb = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
        const px = x + 0.5, py = y + 0.5, w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area, w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area, w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * D[a] + w1 * D[b] + w2 * D[c], k = y * W + x;
        if (z < zAll[k]) { zAll[k] = z; fAll[k] = t; back[k] = isBack ? 1 : 0; }
        if (!isBack && z < zFront[k]) zFront[k] = z;
      }
    }
    // the ground: along a pixel's line of sight, where it meets y = 0 (nothing past it is seen)
    let px = 0, seeThrough = 0; const byBone = {}, hit = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = y * W + x; if (fAll[k] < 0 || !back[k]) continue;
      if (zFront[k] - zAll[k] <= creaseCm) continue;
      if (ground) { const o = [u[0] * (u0 + (x + 0.5) * pixelCm) + v[0] * (v0 + (y + 0.5) * pixelCm), u[1] * (u0 + (x + 0.5) * pixelCm) + v[1] * (v0 + (y + 0.5) * pixelCm), u[2] * (u0 + (x + 0.5) * pixelCm) + v[2] * (v0 + (y + 0.5) * pixelCm)];
        const zg = d[1] < -1e-9 ? -o[1] / d[1] : Infinity; if (zAll[k] > zg) continue; }
      px++; if (zFront[k] === Infinity) seeThrough++; const nm = names[faceBone(fAll[k])]; byBone[nm] = (byBone[nm] ?? 0) + 1;
      const t = fAll[k]; hit.push([0, 1, 2].map((q) => (G[I[t] * 3 + q] + G[I[t + 1] * 3 + q] + G[I[t + 2] * 3 + q]) / 3));
    }
    const mm2 = px * pixelCm * pixelCm * 100;
    totalPx += px; if (px) viewsWithHoles++; if (seeThrough) viewsSeeThrough++; worstSee = Math.max(worstSee, seeThrough * pixelCm * pixelCm * 100);
    for (const [k, c] of Object.entries(byBone)) allBones[k] = Math.max(allBones[k] ?? 0, +(c * pixelCm * pixelCm * 100).toFixed(3));
    if (mm2 > worst.areaMm2) worst = { areaMm2: +mm2.toFixed(3), dir: d.map((x) => +x.toFixed(2)), byBone: Object.fromEntries(Object.entries(byBone).map(([k, c]) => [k, +(c * pixelCm * pixelCm * 100).toFixed(3)])), at: hit.length ? [0, 1, 2].map((q) => +(hit.reduce((s, p) => s + p[q], 0) / hit.length).toFixed(2)) : null };
    for (const h of hit) spots.push(h);
  }
  // the places: hit points clustered within 0.3 cm (ground frame), largest first
  const cl = []; for (const p of spots) { const c = cl.find((q) => Math.hypot(q.c[0] - p[0], q.c[1] - p[1], q.c[2] - p[2]) < 0.3); if (c) { c.n++; for (let k = 0; k < 3; k++) c.s[k] += p[k]; c.c = c.s.map((x) => x / c.n); } else cl.push({ n: 1, s: [...p], c: [...p] }); }
  return { views, pixelMm: pixelCm * 10, creaseMm: creaseCm * 10, viewsWithHoles, seeThrough: { views: viewsSeeThrough, worstViewMm2: +worstSee.toFixed(3) }, worstView: worst, maxByBoneMm2: allBones, places: cl.sort((a, b) => b.n - a.n).slice(0, 6).map((c) => ({ atGroundCm: c.c.map((x) => +x.toFixed(2)), pixelsOverViews: c.n })) };
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], norm = (a) => { const l = Math.hypot(...a); return a.map((x) => x / l); };
