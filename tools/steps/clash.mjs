// Clash probe: do the DRAWN animals overlap each other, the hardscape, the ground or the background?
//
//   node tools/shot.mjs --only=desktop --steps=tools/steps/clash.mjs --wait=2500 --url=http://localhost:5173/
//   CLASH_SECONDS=90 CLASH_PRESETS=suriname,matano CLASH_TAG=before   (defaults: 60 s of animal time, suriname and matano)
//
// The sim's own separation works on its own radii (Animals.radiusOf), so a test that measures with those radii can only agree
// with itself: crowding.mjs reports no overlaps while a 6 cm crab drawn over a 0.6 cm circle walks through its neighbours.
// This probe measures what is drawn instead. It records the transform every instance is put with (CreatureLOD.put: position,
// rotation, scale), takes sample points from the species' own mesh (the trunk, rig leg id 0, and the legs separately), and
// per sample tick counts:
//   pairs     two animals whose trunks interpenetrate: a trunk point of one inside the other's trunk ellipsoid (fitted to the
//             mesh's trunk vertices, shrunk to 0.8 so touching flanks do not count)
//   object    an animal with more than 15% of its points inside a hardscape piece (ray parity against the drawn piece meshes)
//   ground    more than 20% of its trunk points more than 0.3 cm under the ground
//   wall      more than 10% of its points behind the background relief
// The shader's own deformation (body wave, leg swing) is not applied: these are rest-pose points.
// Prints one JSON line per preset, and a per-species table of the share of animal samples that clash.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.game, null, { timeout: 60000 });
  page.setDefaultTimeout(900000);
  const seconds = +(process.env.CLASH_SECONDS ?? 60);
  const presets = (process.env.CLASH_PRESETS ?? 'suriname,matano').split(',');
  const tag = process.env.CLASH_TAG ?? 'run';
  for (const preset of presets) {
    const res = await page.evaluate(async ({ seconds, preset }) => {
      const gen = await import('/src/sim/generator.js');
      const { TANK } = await import('/src/sim/tank.js');
      const { SPECIES } = await import('/src/sim/animals.js');
      const { PLANTS } = await import('/src/sim/plants.js');
      const { bodyFootprint } = await import('/src/util/body.js');
      const game = window.game;
      const w = await game.loadTank('standard', { layout: 'empty' });
      gen.generateTerrarium(w, { preset, seed: 5, tier: 'standard' });
      let s = 777;
      const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
      const A = w.animals, T = w.terrain, Wl = w.wall;
      A.syncOccupancy(true);
      for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a);
      const mix = preset === 'matano'
        ? { panther: 3, blueshrimp: 30, shrimp: 20, snail: 12, isopod: 25, pandaking: 10, springtail: 30, crab: 6, cricket: 10, dubia: 8, cpd: 15, oto: 6 }
        : { crab: 8, shrimp: 30, isopod: 30, pandaking: 10, purpleiso: 10, springtail: 30, springpink: 20, fly: 20, cricket: 12, dubia: 8, dartfrog: 6, leucomelas: 4, toad: 4, newt: 4, gecko: 4, neon: 20, cory: 8, snail: 10 };
      for (const [id, n] of Object.entries(mix)) {
        if (!SPECIES[id]) continue;
        for (let i = 0; i < n; i++) {
          const cx = (rnd() - 0.5) * (TANK.w - 20), cz = (rnd() - 0.5) * (TANK.d - 20);
          for (let k = 0; k < 160; k++) {
            const x = cx + (rnd() - 0.5) * 12, z = cz + (rnd() - 0.5) * 12;
            const r = A.placement(id, { point: { x, y: 0, z }, surface: 'ground' });
            if (r.pos) { A.add(id, r.pos); break; }
          }
        }
      }
      const all = () => Object.values(A.by).flat();
      // Let every mesh arrive (bodies are meshed in workers, GLB models are fetched), then a few frames so models swap in.
      for (let i = 0; i < 20; i++) { A.move(0.05); await new Promise((r) => setTimeout(r, 120)); }
      for (const m of Object.values(A.meshes)) await m.ready?.catch?.(() => {});
      for (let i = 0; i < 20; i++) { A.move(0.05); await new Promise((r) => setTimeout(r, 60)); }

      const V3 = all()[0].pos.constructor, Q = A._q.constructor;
      const RC = window.__tools.ray.constructor;
      const rc = new RC(); rc.firstHitOnly = false;
      const pieceList = (w.decor?.pieces ?? []).filter((p) => p.mesh);
      const pieces = pieceList.map((p) => p.mesh);
      for (const m of pieces) m.updateMatrixWorld(true);
      // Inside a piece: an odd number of crossings straight up (the meshes are closed shells; open ones count as outside).
      // Inside a piece: the nearest point of its surface (the piece's own BVH) faces away from the point, and is more than
      // 0.2 cm away. Works on open scanned meshes, where counting ray crossings does not.
      const inv = pieces.map((m) => m.matrixWorld.clone().invert());
      const boxes = pieces.map((m) => { const b = { min: new V3(1e9, 1e9, 1e9), max: new V3(-1e9, -1e9, -1e9) }; m.geometry.computeBoundingBox?.(); const bb = m.geometry.boundingBox; if (bb) { const c = [bb.min, bb.max]; for (let k = 0; k < 8; k++) { const v = new V3(c[k & 1].x, c[(k >> 1) & 1].y, c[k >> 2].z).applyMatrix4(m.matrixWorld); b.min.min(v); b.max.max(v); } } return b; });
      const lq = new V3(), tgt = { point: new V3(), distance: 0, faceIndex: 0 }, va = new V3(), vb = new V3(), vc = new V3(), nn = new V3(), cw = new V3();
      const inPiece = (x, y, z) => {
        for (let i = 0; i < pieces.length; i++) {
          const b = boxes[i];
          if (x < b.min.x || y < b.min.y || z < b.min.z || x > b.max.x || y > b.max.y || z > b.max.z) continue;
          const g = pieces[i].geometry, bvh = g.boundsTree;
          if (!bvh) continue;
          lq.set(x, y, z).applyMatrix4(inv[i]);
          if (!bvh.closestPointToPoint(lq, tgt)) continue;
          const ix = g.index, f = tgt.faceIndex * 3, P = g.attributes.position;
          const i0 = ix ? ix.getX(f) : f, i1 = ix ? ix.getX(f + 1) : f + 1, i2 = ix ? ix.getX(f + 2) : f + 2;
          va.fromBufferAttribute(P, i0); vb.fromBufferAttribute(P, i1); vc.fromBufferAttribute(P, i2);
          nn.subVectors(vc, vb).cross(va.clone().sub(vb)).normalize();
          const side = nn.dot(lq.clone().sub(tgt.point));
          if (side >= 0) continue;
          const dw = cw.copy(tgt.point).applyMatrix4(pieces[i].matrixWorld).distanceTo(o.set(x, y, z));
          if (dw <= 0.2) continue;
          // and counting crossings agrees, along most of five directions (a hole in a scan fools one or two)
          let odd = 0;
          for (const d of DIRS) { rc.set(o.set(x, y, z), d); rc.near = 0; rc.far = 200; if (rc.intersectObject(pieces[i], false).length % 2 === 1) odd++; }
          if (odd >= 3) return pieceList[i].type;
        }
        return null;
      };
      const o = new V3();
      const DIRS = [[0, 1, 0], [0.6, 0.2, 0.77], [-0.7, 0.3, -0.65], [0.1, -0.2, 0.97], [-0.9, -0.1, 0.4]].map(([x, y, z]) => new V3(x, y, z).normalize());
      // Sample points per mesh key, in the mesh's own units: trunk (leg id 0) and legs, and the trunk's ellipsoid.
      const samples = new Map();
      const sampleOf = (key) => {
        if (samples.has(key)) return samples.get(key);
        const m = A.meshes[key], g = (m?._lo ?? m?.lo)?.geometry;
        const P = g?.attributes?.position?.array, R = g?.attributes?.rig?.array;
        if (!P) return null;
        const n = P.length / 3, core = [], legs = [];
        let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
        for (let i = 0; i < n; i++) {
          const leg = R ? R[i * 4 + 1] > 0.5 : false;
          (leg ? legs : core).push(i);
          if (!leg) { x0 = Math.min(x0, P[i * 3]); x1 = Math.max(x1, P[i * 3]); y0 = Math.min(y0, P[i * 3 + 1]); y1 = Math.max(y1, P[i * 3 + 1]); z0 = Math.min(z0, P[i * 3 + 2]); z1 = Math.max(z1, P[i * 3 + 2]); }
        }
        const pick = (ids, k) => { const out = []; const st = Math.max(1, Math.floor(ids.length / k)); for (let i = 0; i < ids.length && out.length < k; i += st) { const j = ids[i]; out.push([P[j * 3], P[j * 3 + 1], P[j * 3 + 2]]); } return out; };
        // The trunk ellipsoid: the trunk as util/body.js measures it (the part at least a third as wide as its widest point, so
        // antennae and thin tail tips do not count), from the feet to the top of the back.
        const fp = bodyFootprint(P, R ?? null);
        const e = { c: [0, (y0 + y1) / 2, fp.tc], h: [fp.tw, Math.max((y1 - y0) / 2, 0.05), fp.tl] };
        const tz0 = fp.tc - fp.tl, tz1 = fp.tc + fp.tl;
        const coreIn = core.filter((i) => P[i * 3 + 2] >= tz0 && P[i * 3 + 2] <= tz1 && Math.abs(P[i * 3]) <= fp.tw * 1.1);
        const r = { core: pick(coreIn.length ? coreIn : core, 36), legs: pick(legs, 24), e, box: [x0, y0, z0, x1, y1, z1] };
        samples.set(key, r);
        return r;
      };
      // Capture every put: species id -> [{ key, pos, quat, scale }] in draw order (one per animal, then any dropped tails).
      let cap = {};
      const wrap = () => {
        for (const [id, keys] of Object.entries(A.keys)) for (const key of keys) {
          const m = A.meshes[key];
          if (!m || m.put.__clash) continue;
          const orig = m.put.bind(m);
          m.put = (pos, quat, scale, ...rest) => { (cap[id] ??= []).push({ key, pos: pos.clone(), quat: quat.clone(), scale }); return orig(pos, quat, scale, ...rest); };
          m.put.__clash = true;
        }
      };
      const qi = new Q(), lp = new V3(), wp = new V3();
      const toWorld = (c, p, out) => out.set(p[0], p[1], p[2]).multiplyScalar(c.scale).applyQuaternion(c.quat).add(c.pos);
      const inEll = (c, s, p, k = 0.8) => {
        lp.copy(p).sub(c.pos).applyQuaternion(qi.copy(c.quat).invert()).divideScalar(c.scale);
        const e = s.e;
        const u = (lp.x - e.c[0]) / (e.h[0] * k), v = (lp.y - e.c[1]) / (e.h[1] * k), q = (lp.z - e.c[2]) / (e.h[2] * k);
        return u * u + v * v + q * q < 1;
      };
      const stat = {}, pairT = new Map(), pairKinds = {}, objBy = {}, objDoing = {}, cases = window.__clashCases = [];
      let samplesN = 0, clashNow = 0;
      const bump = (sp, k) => { const r = stat[sp] ??= { n: 0, pair: 0, object: 0, ground: 0, wall: 0, stem: 0 }; r[k]++; };
      const dtA = 0.2, ticks = Math.round(seconds / dtA);
      for (let tick = 0; tick < ticks; tick++) {
        w.sim.step(1);
        wrap(); cap = {};
        A.move(dtA);
        if (tick % 5) continue;
        samplesN++;
        const list = [];
        for (const [id, arr] of Object.entries(A.by)) {
          const cs = cap[id] ?? [];
          arr.forEach((a, i) => { const c = cs[i]; if (!c || a.dead) return; const sm = sampleOf(c.key); if (sm) list.push({ a, c, sm }); });
        }
        // Plant stems (what Animals.plantCores calls a core: everything rooted in the ground but carpets, creepers and water plants).
        const stems = w.plants.list.filter((q) => q.surface !== 'wall' && !['javamoss', 'pothos'].includes(q.id) && !['floating', 'aquatic'].includes(PLANTS[q.id]?.habitat ?? '')).map((q) => ({ x: q.pos.x, y: q.pos.y, z: q.pos.z, r: Math.min(2.5, Math.max(0.5, (q.reach ?? 3) * (0.3 + 0.7 * q.grown) * 0.18)) * 0.8 }));
        for (const it of list) {
          const { a, c, sm } = it, sp = SPECIES[a.sp];
          bump(a.sp, 'n');
          const pts = [...sm.core, ...sm.legs];
          let nObj = 0, nGround = 0, nWall = 0, objType = null, nStem = 0;
          for (let i = 0; i < pts.length; i++) {
            toWorld(c, pts[i], wp);
            if (i < sm.core.length && wp.y < T.heightAt(wp.x, wp.z) - 0.3) nGround++;
            if (i < sm.core.length && !a.perch && !a.wallMode) for (const q of stems) { const dx = wp.x - q.x, dz = wp.z - q.z; if (dx * dx + dz * dz < q.r * q.r && wp.y > q.y - 0.5 && wp.y < q.y + 4) { nStem++; break; } }
            if (!a.wallMode && wp.z < Wl.zAt(wp.x, wp.y) - 0.15) nWall++;
            if (i % 2 === 0) { const t = inPiece(wp.x, wp.y, wp.z); if (t) { nObj += 2; objType = t; } }
          }
          it.world = sm.core.map((p) => toWorld(c, p, new V3()));
          if (nObj > pts.length * 0.15) {
            bump(a.sp, 'object');
            const doing = a.swimming ? 'swim' : a.hop ? 'hop' : a.perch ? 'perch' : a.wallMode || a.onWall ? 'wall' : a.sunk ? 'sunk' : a.cb?.sinkNow > 0.1 ? 'burrow' : a.state ?? '?';
            objBy[objType] = (objBy[objType] ?? 0) + 1; objDoing[doing] = (objDoing[doing] ?? 0) + 1;
            if (tick > ticks * 0.8 && !cases.some((k) => k.what === objType)) cases.push({ what: objType, id: a.id, sp: a.sp });
          }
          if (sm.core.length && nGround > sm.core.length * 0.2 && sp.kind !== 'swim') bump(a.sp, 'ground');
          if (nWall > pts.length * 0.1) bump(a.sp, 'wall');
          if (sm.core.length && nStem > sm.core.length * 0.2) bump(a.sp, 'stem');
        }
        const seen = new Set();
        clashNow = 0;
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
          const A1 = list[i], B1 = list[j];
          if (Math.abs(A1.c.pos.x - B1.c.pos.x) > 12 || Math.abs(A1.c.pos.z - B1.c.pos.z) > 12 || Math.abs(A1.c.pos.y - B1.c.pos.y) > 8) continue;
          let hit = 0;
          for (const p of A1.world) if (inEll(B1.c, B1.sm, p)) { hit++; if (hit >= 2) break; }
          if (hit < 2) for (const p of B1.world) if (inEll(A1.c, A1.sm, p)) { hit++; if (hit >= 2) break; }
          if (hit < 2) continue;
          clashNow++;
          if (tick > ticks * 0.8 && cases.filter((k) => k.what === 'pair').length < 3) cases.push({ what: 'pair', id: A1.a.id, sp: A1.a.sp, other: B1.a.sp });
          bump(A1.a.sp, 'pair'); bump(B1.a.sp, 'pair');
          const key = A1.a.id * 100000 + B1.a.id;
          seen.add(key);
          const t = (pairT.get(key) ?? 0) + dtA * 5;
          pairT.set(key, t);
          if (t >= 2 && t < 2 + dtA * 5) { const kk = [A1.a.sp, B1.a.sp].sort().join('/'); pairKinds[kk] = (pairKinds[kk] ?? 0) + 1; }
        }
        for (const k of [...pairT.keys()]) if (!seen.has(k)) pairT.delete(k);
        if (tick % 150 === 0) { for (const a of all()) a.health = Math.max(a.health, 0.8); await new Promise((r) => setTimeout(r, 0)); }
      }
      const table = Object.fromEntries(Object.entries(stat).sort().map(([k, r]) => [k, { n: r.n, pair: +(r.pair / r.n * 100).toFixed(1), object: +(r.object / r.n * 100).toFixed(1), ground: +(r.ground / r.n * 100).toFixed(1), wall: +(r.wall / r.n * 100).toFixed(1), stem: +(r.stem / r.n * 100).toFixed(1) }]));
      const tot = Object.values(stat).reduce((t, r) => ({ n: t.n + r.n, pair: t.pair + r.pair, object: t.object + r.object, ground: t.ground + r.ground, wall: t.wall + r.wall, stem: t.stem + r.stem }), { n: 0, pair: 0, object: 0, ground: 0, wall: 0, stem: 0 });
      return {
        preset, animals: all().length, samples: samplesN,
        pct: { pair: +(tot.pair / tot.n * 100).toFixed(2), object: +(tot.object / tot.n * 100).toFixed(2), ground: +(tot.ground / tot.n * 100).toFixed(2), wall: +(tot.wall / tot.n * 100).toFixed(2), stem: +(tot.stem / tot.n * 100).toFixed(2) },
        lastingPairs: Object.values(pairKinds).reduce((p, q) => p + q, 0), pairKinds, table, objBy, objDoing,
        pieceTypes: pieceList.map((p) => p.type).join(','),
      };
    }, { seconds, preset });
    console.log(`CLASH ${tag} ${preset}`, JSON.stringify({ preset: res.preset, animals: res.animals, samples: res.samples, pct: res.pct, lastingPairs: res.lastingPairs, pairKinds: res.pairKinds }));
    console.log('  objects by piece', JSON.stringify(res.objBy), 'by doing', JSON.stringify(res.objDoing), 'pieces', res.pieceTypes);
    // Pictures of the last cases found (the world is frozen, the camera looks at the animal from its side, 9 cm off).
    const nShots = +(process.env.CLASH_SHOTS ?? 0);
    const cases = nShots ? await page.evaluate(() => window.__clashCases) : [];
    for (const [i, c] of cases.slice(0, nShots).entries()) {
      const ok = await page.evaluate((c) => {
        const g = window.game, A = g.world.animals, a = A.all.find((b) => b.id === c.id);
        if (!a) return false;
        g.frozen = true;
        const ui = document.getElementById('ui'); if (ui) ui.style.visibility = 'hidden';
        const p = a.pos, d = 7 + 3 * (a.rad ?? 1), cy = Math.cos(a.yaw ?? 0), sy = Math.sin(a.yaw ?? 0);
        g.rig?.stopOrbit?.(); if (g.rig) g.rig.moved = true;
        g.controls.setLookAt(p.x + (cy * 0.8 + sy * 0.6) * d, p.y + d * 0.55, p.z + (-sy * 0.8 + cy * 0.6) * d, p.x, p.y + 0.3, p.z, false);
        return true;
      }, c);
      if (!ok) continue;
      await page.waitForTimeout(700);
      await shot(`clash-${tag}-${preset}-${i}-${c.sp}-${c.what}${c.other ? '-' + c.other : ''}`);
    }
    await page.evaluate(() => { window.game.frozen = false; const ui = document.getElementById('ui'); if (ui) ui.style.visibility = ''; });
    for (const [k, r] of Object.entries(res.table)) console.log(`  ${k.padEnd(12)} n=${String(r.n).padStart(5)}  pair ${String(r.pair).padStart(5)}%  object ${String(r.object).padStart(5)}%  ground ${String(r.ground).padStart(5)}%  wall ${String(r.wall).padStart(5)}%  stem ${String(r.stem).padStart(5)}%`);
  }
  const errs = await page.evaluate(() => window.__errs?.slice(0, 5) ?? []);
  if (errs.length) console.log('errors', JSON.stringify(errs));
};
