// How hardscape pieces and plants meet the DRAWN ground, in a few generated presets: for every piece, its lowest real
// vertices against the ground drawn under them (the terrain mesh's `hv` plus the tops of the other pieces): `gap` (> 0: the
// piece floats, nothing touches) and `bury` (how deep its lowest point sits under the ground) and `hidden` (the share of its surface under the ground);
// for every plant on the ground, its base against the same ground; pairs of pieces pushed into each other and plants growing
// inside a piece; and the bark's texel density on wood (texels per cm: spread along trunks and roots, and the stretch, the
// ratio of the two principal densities of each triangle).
//   node tools/shot.mjs --url=http://127.0.0.1:4493/ --only=desktop --steps=tools/steps/decor-ground.mjs --wait=1500 [--query=?webgl]
//   env: PRESETS=cascade,suriname,streambank SEED=1 TIER=standard SHOTS=1 (close-ups of the biggest wood piece and the floor)
//   TAG=before|after names the pictures.
//   SCENES=starter,kits,editor (instead of PRESETS): the starter tank as world.js builds it; every kit (content/kits.js) built
//   by sim/kits.js buildKit at two spots of the starter tank's sculpted ground (its pieces cleared); and pieces put down
//   through the editor's own code (ToolController.clickRock, its ray pick replaced by a fixed hit) on that ground and
//   Shift-stacked on a boulder.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.game, null, { timeout: 60000 });
  await page.evaluate(`window.__measure = ${measure.toString()}`);
  const presets = process.env.SCENES ? process.env.SCENES.split(',').map((s) => '@' + s) : (process.env.PRESETS ?? 'cascade,suriname,streambank').split(',');
  const seed = +(process.env.SEED ?? 1), tier = process.env.TIER ?? 'standard', tag = process.env.TAG ?? 'now';
  const all = [];
  for (const preset of presets) {
    const info = await page.evaluate(async ({ preset, seed, tier }) => {
      const game = window.game;
      window.__PLANTS = (await import('/src/sim/plants.js')).PLANTS;
      if (preset.startsWith('@')) return scene(preset.slice(1));
      const gen = await import('/src/sim/generator.js');
      const w = await game.loadTank(tier, { layout: 'empty' });
      return gen.generateTerrarium(w, { preset, seed, tier })?.name;
      async function scene(kind) {
        // Seeded, so the editor's random looks and the starter's random variants are the same in every tree and run.
        let a = 0x9e3779b9;
        Math.random = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
        const W = await game.loadTank('standard', { layout: 'starter' });
        if (kind === 'starter') return 'starter tank';
        const D = W.decor;
        const bare = () => { D.clear(); W.groundChanged(); };
        bare(); W.plants.clear();
        if (kind === 'kits') {
          const { KITS } = await import('/src/content/kits.js'), K = await import('/src/sim/kits.js');
          // One kit at a time (so kits do not land on each other), on a slope and on the flat; measured after each.
          window.__KITRES = [];
          for (const kit of KITS) for (const [x, z] of [[-26, 2], [22, 6]]) {
            bare();
            K.buildKit(W, kit, { x, z, seed: 7 });
            W.groundChanged();
            window.__KITRES.push({ kit: kit.id, m: window.__measure() });
          }
          return `kits ${KITS.map((k) => k.id).join(', ')}`;
        }
        // The editor: pieces put down with ToolController.clickRock, its ray pick replaced by a fixed hit.
        const tools = window.__tools, { S } = await import('/src/ui/store.js');
        const put = (type, x, z, on = null) => {
          S.sub.value = { ...S.sub.value, rock: type, kit: null };
          tools.selectPiece(null);
          const V = W.terrain.mesh.position.constructor;
          let y = W.terrain.heightAt(x, z);
          if (on) { D.ray.set(new V(x, 200, z), new V(0, -1, 0)); y = D.ray.intersectObject(on.mesh, false)[0]?.point.y ?? y; }
          tools.pick = () => ({ point: new V(x, y, z), surface: 'terrain', normal: new V(0, 1, 0), object: on ? on.mesh : W.terrain.mesh });
          if (on) tools.keys.add('shift');
          tools.clickRock();
          tools.keys.delete('shift');
          return D.pieces.at(-1);
        };
        const types = ['wood', 'roots', 'cork', 'floatlog', 'slate', 'bamboopole', 'stump', 'boulder'];
        const spots = [[-32, 4], [-16, 10], [0, 6], [16, -2], [32, 8], [-26, -10], [6, -12], [30, -12]];
        types.forEach((t, i) => put(t, ...spots[i]));
        bare();
        types.forEach((t, i) => put(t, ...spots[(i + 3) % spots.length]));
        const b = put('boulder', -6, 14);
        put('wood', -6, 14, b);
        const b2 = put('boulder', 22, 14);
        put('roots', 22, 14, b2);
        delete tools.pick;
        tools.selectPiece(null);
        W.groundChanged();
        return 'editor';
      }
    }, { preset, seed, tier }).catch((e) => String(e));
    await page.waitForTimeout(2500);
    let r;
    if (preset === '@kits') {
      const res = await page.evaluate(() => window.__KITRES) ?? [];
      for (const { kit, m } of res) console.log(`  kit ${kit.padEnd(10)} ` + m.pieces.map((p) => `${p.type} gap ${p.gap.toFixed(2)} bury ${p.bury.toFixed(1)}`).join(' | '));
      const pairs = res.flatMap(({ m }) => m.overlaps.pairs);
      r = { pieces: res.flatMap(({ m }) => m.pieces), plants: { n: 0, gapMax: 0, gapMean: 0, sunkMax: 0, sunkMean: 0, floating: 0, sunk: 0 }, overlaps: { pairs, plantIn: 0, plantBy: {} }, bark: {} };
    } else r = await page.evaluate(measure);
    r.preset = preset;
    all.push(r);
    console.log(`\n== ${preset} (${info}): ${r.pieces.length} pieces, ${r.plants.n} plants`);
    const by = {};
    for (const p of r.pieces) (by[p.type] ??= []).push(p);
    for (const [t, L] of Object.entries(by)) {
      console.log(`  ${t.padEnd(10)} n=${L.length} gap max ${Math.max(...L.map((p) => p.gap)).toFixed(2)} mean ${(L.reduce((a, p) => a + p.gap, 0) / L.length).toFixed(2)} cm`
        + ` | bury max ${Math.max(...L.map((p) => p.bury)).toFixed(2)} mean ${(L.reduce((a, p) => a + p.bury, 0) / L.length).toFixed(2)} cm`
        + ` | hidden max ${(100 * Math.max(...L.map((p) => p.buryK))).toFixed(0)}% mean ${(100 * L.reduce((a, p) => a + p.buryK, 0) / L.length).toFixed(0)}% | floating ${L.filter((p) => p.gap > 0.3).length}`);
    }
    console.log(`  plants    gap max ${r.plants.gapMax.toFixed(2)} mean ${r.plants.gapMean.toFixed(2)} | sunk max ${r.plants.sunkMax.toFixed(2)} mean ${r.plants.sunkMean.toFixed(2)} cm | floating ${r.plants.floating} sunk ${r.plants.sunk}`);
    console.log(`  overlaps: piece pairs ${r.overlaps.pairs.length} (${r.overlaps.pairs.map((p) => p.join('+')).join(', ')}) | plants inside a piece ${r.overlaps.plantIn} (${Object.entries(r.overlaps.plantBy).map(([k, v]) => k + ' ' + v).join(', ')})`);
    for (const [t, b] of Object.entries(r.bark)) console.log(`  bark ${t.padEnd(9)} texels/cm p5 ${b.p5.toFixed(1)} p50 ${b.p50.toFixed(1)} p95 ${b.p95.toFixed(1)} (p95/p5 ${(b.p95 / b.p5).toFixed(1)}) | stretch p50 ${b.s50.toFixed(2)} p95 ${b.s95.toFixed(2)}`);
    if (process.env.SHOTS) {
      await page.addStyleTag({ content: '#ui{display:none!important}' });
      const kinds = ['trunk', 'floor', ...(process.env.SHOTS === '2' ? ['stump', 'cork', 'floatlog', 'roots', 'wood'] : [])];
      for (const k of kinds) {
        const ok = await page.evaluate((k) => {
          const g = window.game, W = g.world, D = W.decor;
          g.setSpeed(0);
          const E = W.env; E.minute = Math.floor(E.minute / 1440) * 1440 + 12 * 60;
          g.rig.stopOrbit(); g.rig.moved = true;
          if (k === 'trunk') {
            const wood = D.pieces.filter((p) => ['roots', 'wood', 'stump', 'cork', 'floatlog'].includes(p.type));
            if (!wood.length) return false;
            // The tallest wood piece (a trunk), seen from in front of the glass.
            const big = wood.map((p) => { p.mesh.geometry.computeBoundingBox(); const b = p.mesh.geometry.boundingBox.clone().applyMatrix4(p.mesh.matrixWorld); return { b, s: b.max.y - b.min.y }; }).sort((a, b) => b.s - a.s)[0].b;
            const c = b2c(big), d = Math.max(12, big.getSize(c.clone()).length() * 0.7), front = W.terrain.field.ob + W.terrain.field.sizeB;
            g.controls.setLookAt(c.x + d * 0.15, c.y + d * 0.05, Math.max(front + 2, c.z + d), c.x, c.y, c.z, false);
          } else if (k !== 'floor') {
            // A close look at the first piece of that kind, from the front and a little above.
            const p = D.pieces.find((q) => q.type === k);
            if (!p) return false;
            const b = p.mesh.geometry.boundingBox.clone().applyMatrix4(p.mesh.matrixWorld), c = b2c(b), d = Math.max(9, b.getSize(c.clone()).length() * 0.8);
            g.controls.setLookAt(c.x + d * 0.25, c.y + d * 0.45, c.z + d * 0.85, c.x, c.y, c.z, false);
          } else {
            const T = W.terrain, z = 4, y = T.heightAt(0, z);
            g.controls.setLookAt(0, y + 14, z + 30, 0, y, z - 4, false);
          }
          return true;
          function b2c(b) { return b.getCenter(b.min.clone()); }
        }, k);
        await page.waitForTimeout(1500);
        if (ok) await shot(`dg-${tag}-${preset}-${k}`);
      }
    }
  }
  // Totals over the presets.
  const P = all.flatMap((r) => r.pieces);
  const tot = (f) => P.reduce((a, p) => a + f(p), 0);
  console.log(`\nTOTAL pieces ${P.length}: gap max ${Math.max(...P.map((p) => p.gap)).toFixed(2)} mean ${(tot((p) => p.gap) / P.length).toFixed(3)} cm, floating ${P.filter((p) => p.gap > 0.3).length}`
    + ` | bury max ${Math.max(...P.map((p) => p.bury)).toFixed(2)} mean ${(tot((p) => p.bury) / P.length).toFixed(2)} cm, over half hidden ${P.filter((p) => p.buryK > 0.5).length}`);
  console.log(`TOTAL plants: floating ${all.reduce((a, r) => a + r.plants.floating, 0)}, sunk ${all.reduce((a, r) => a + r.plants.sunk, 0)}, gap max ${Math.max(...all.map((r) => r.plants.gapMax)).toFixed(2)}`
    + ` | overlapping piece pairs ${all.reduce((a, r) => a + r.overlaps.pairs.length, 0)}, plants inside pieces ${all.reduce((a, r) => a + r.overlaps.plantIn, 0)}`);
};

// Runs in the page.
function measure() {
  const W = window.game.world, D = W.decor, T = W.terrain, f = T.field;
  const V3 = D.pieces[0]?.mesh.position.constructor;
  const RC = D.ray.constructor;
  const first = new RC(); first.firstHitOnly = true;
  const every = new RC(); every.firstHitOnly = false;
  const drawnGround = (x, z) => f.sample(x, z, T.bare ? f.base : f.hv);
  const boxes = new Map();
  for (const p of D.pieces) { const g = p.mesh.geometry; if (!g.boundingBox) g.computeBoundingBox(); boxes.set(p, g.boundingBox.clone().applyMatrix4(p.mesh.matrixWorld)); }
  const o = V3 ? new V3() : null, down = V3 ? new V3(0, -1, 0) : null, up = V3 ? new V3(0, 1, 0) : null;
  // The top of what is drawn at (x, z) besides `skip`: the ground mesh, or a piece standing there.
  const groundAt = (x, z, skip, from = 200) => {
    let g = drawnGround(x, z);
    for (const q of D.pieces) {
      if (q === skip) continue;
      const b = boxes.get(q);
      if (x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z || b.max.y < g) continue;
      first.set(o.set(x, Math.min(from, b.max.y + 1), z), down);
      const h = first.intersectObject(q.mesh, false)[0];
      if (h && h.point.y > g) g = h.point.y;
    }
    return g;
  };
  // Is a world point inside a piece's closed mesh (odd number of crossings straight up), and deeper than `depth` cm?
  const inside = (pt, q, depth = 0.8) => {
    const m = q.mesh, side = m.material.side;
    m.material.side = 2;
    every.set(pt, up);
    const hits = every.intersectObject(m, false);
    let res = false;
    if (hits.length % 2 === 1 && hits[0].distance > depth) {
      every.set(pt, down);
      const dh = every.intersectObject(m, false);
      res = dh.length % 2 === 1 && dh[0].distance > depth;
    }
    m.material.side = side;
    return res;
  };
  const verts = (p, max) => {
    const a = p.mesh.geometry.attributes.position, e = p.mesh.matrixWorld.elements, out = [];
    const st = Math.max(1, Math.ceil(a.count / max));
    for (let i = 0; i < a.count; i += st) {
      const x = a.getX(i), y = a.getY(i), z = a.getZ(i);
      out.push([e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]]);
    }
    return out;
  };
  const pieces = [];
  for (const p of D.pieces) {
    // The ground as drawn without this piece's own stamp (a stamped stone raises the drawn ground to its own top).
    if (p.stamp) T.compose(D.pieces.map((q) => (q === p ? null : q.stamp)));
    const b = boxes.get(p), h = b.max.y - b.min.y;
    const vs = verts(p, 3000);
    // Only the lower part can touch: vertices within 35% of the height of the lowest one, or every vertex of a flat piece.
    let minD = Infinity;
    for (const v of vs) {
      if (v[1] > b.min.y + Math.max(1.5, h * 0.35)) continue;
      const d = v[1] - groundAt(v[0], v[2], p, v[1] + 0.05);
      if (d < minD) minD = d;
    }
    // Burial: how far under the drawn ground its lowest point is, and the share of its surface hidden under the ground.
    let bury = 0, hid = 0;
    for (const v of vs) { const d = drawnGround(v[0], v[2]) - v[1]; if (d > bury) bury = d; if (d > 0.2) hid++; }
    pieces.push({ type: p.type, gap: Math.max(0, minD), minD, bury, buryK: hid / vs.length, h });
  }
  T.compose(D.stamps());
  // Pieces pushed into each other.
  const pairs = [];
  for (let i = 0; i < D.pieces.length; i++) for (let j = i + 1; j < D.pieces.length; j++) {
    const A = D.pieces[i], B = D.pieces[j], a = boxes.get(A), b = boxes.get(B);
    if (!a.intersectsBox(b)) continue;
    let k = 0, n = 0;
    for (const [P, Q] of [[A, B], [B, A]]) {
      const vs = verts(P, 400);
      for (const v of vs) { n++; if (inside(o.set(v[0], v[1], v[2]), Q, 1)) k++; }
    }
    if (k / n > 0.03) pairs.push([A.type, B.type]);
  }
  // Plants on the ground.
  let gapMax = 0, gapSum = 0, sunkMax = 0, sunkSum = 0, floating = 0, sunk = 0, n = 0, plantIn = 0;
  const plantBy = {};
  const PL = W.plants;
  for (const p of PL.list) {
    if (p.surface === 'wall') continue;
    const sp = window.__PLANTS?.[p.id];
    if (p.surface === 'water' || p.surface === 'pond') continue;
    if (!sp || sp.habitat === 'floating') continue;
    const g = groundAt(p.pos.x, p.pos.z, null, p.pos.y + 1.5);
    const d = p.pos.y - g;
    n++;
    if (d > 0) { gapMax = Math.max(gapMax, d); gapSum += d; if (d > 0.3) floating++; } else { sunkMax = Math.max(sunkMax, -d); sunkSum += -d; if (-d > 0.6) sunk++; }
    for (const q of D.pieces) {
      const b = boxes.get(q);
      if (p.pos.x < b.min.x || p.pos.x > b.max.x || p.pos.z < b.min.z || p.pos.z > b.max.z || p.pos.y < b.min.y || p.pos.y > b.max.y) continue;
      if (inside(o.set(p.pos.x, p.pos.y + 0.3, p.pos.z), q, 0.8)) { plantIn++; plantBy[q.type] = (plantBy[q.type] ?? 0) + 1; break; }
    }
  }
  // Bark: texels per cm on every triangle of the wood pieces (sampled), area-weighted.
  const bark = {};
  const WOOD = ['roots', 'stump', 'wood', 'cork', 'floatlog'];
  for (const p of D.pieces) {
    if (!WOOD.includes(p.type)) continue;
    // What the material does with the uv: a scale (and the texture size) it published in userData, and for the root ball the
    // attribute its bark coordinates are in and the one saying which vertices are on a root strand (only those are measured).
    const m = p.mesh, bu = m.material.userData.barkUV;
    const g = m.geometry, pos = g.attributes.position, uv = g.attributes[bu?.attr ?? 'uv'], mk = bu?.mask ? g.attributes[bu.mask] : null, e = m.matrixWorld.elements;
    if (!uv) continue;
    const tex = bu?.size ?? (m.material.map?.image?.width ?? m.material.userData.texSize ?? 512);
    const sx = Math.hypot(e[0], e[1], e[2]), sy = Math.hypot(e[4], e[5], e[6]), sz = Math.hypot(e[8], e[9], e[10]);
    // barkMaterial: v times the piece's scale along the grain over its scale round it (see sim/decor.js).
    const vk = bu?.along === 'x' ? (2 * sx) / (sy + sz) : bu?.along === 'y' ? (2 * sy) / (sx + sz) : 1;
    const idx = g.index ? g.index.array : null, nt = (idx ? idx.length : pos.count) / 3, st = Math.max(1, Math.ceil(nt / 4000));
    const L = (bark[p.type] ??= { d: [], s: [] });
    const P3 = (i) => { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); return [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]]; };
    for (let t = 0; t < nt; t += st) {
      const i0 = idx ? idx[t * 3] : t * 3, i1 = idx ? idx[t * 3 + 1] : t * 3 + 1, i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      if (mk && (mk.getX(i0) < 0.5 || mk.getX(i1) < 0.5 || mk.getX(i2) < 0.5)) continue;
      const a = P3(i0), b = P3(i1), c = P3(i2);
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const l1 = Math.hypot(...e1);
      const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
      const area2 = Math.hypot(nx, ny, nz);
      if (l1 < 1e-6 || area2 < 1e-8) continue;
      // Triangle in its own plane: p1 = (l1, 0), p2 = (x2, y2).
      const x2 = (e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2]) / l1, y2 = area2 / l1;
      const k = tex, kv = tex * vk;
      const du1 = (uv.getX(i1) - uv.getX(i0)) * k, dv1 = (uv.getY(i1) - uv.getY(i0)) * kv, du2 = (uv.getX(i2) - uv.getX(i0)) * k, dv2 = (uv.getY(i2) - uv.getY(i0)) * kv;
      // M = [du1 du2; dv1 dv2] * inverse([l1 x2; 0 y2])
      const m00 = du1 / l1, m01 = (du2 - du1 * x2 / l1) / y2, m10 = dv1 / l1, m11 = (dv2 - dv1 * x2 / l1) / y2;
      const A = m00 * m00 + m10 * m10, B = m00 * m01 + m10 * m11, C = m01 * m01 + m11 * m11;
      const tr = A + C, det = Math.max(0, A * C - B * B), q = Math.sqrt(Math.max(0, tr * tr / 4 - det));
      const s1 = Math.sqrt(tr / 2 + q), s2 = Math.sqrt(Math.max(0, tr / 2 - q));
      if (s2 < 1e-6) continue;
      L.d.push([Math.sqrt(s1 * s2), area2]); L.s.push([s1 / s2, area2]);
    }
  }
  const pct = (arr, q) => { const s = arr.slice().sort((a, b) => a[0] - b[0]), tot = s.reduce((a, v) => a + v[1], 0); let acc = 0; for (const v of s) { acc += v[1]; if (acc >= q * tot) return v[0]; } return s.at(-1)?.[0] ?? 0; };
  const barkOut = {};
  for (const [t, L] of Object.entries(bark)) if (L.d.length) barkOut[t] = { p5: pct(L.d, 0.05), p50: pct(L.d, 0.5), p95: pct(L.d, 0.95), s50: pct(L.s, 0.5), s95: pct(L.s, 0.95) };
  return {
    pieces,
    plants: { n, gapMax, gapMean: n ? gapSum / n : 0, sunkMax, sunkMean: n ? sunkSum / n : 0, floating, sunk },
    overlaps: { pairs, plantIn, plantBy },
    bark: barkOut,
  };
}
