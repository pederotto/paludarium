// Collide probe: do the DRAWN frogs, toads, geckos, newts and crabs stay inside the glass, out of rocks, wood and plant stems, and
// hold a steady frame while they climb?
//
//   node tools/shot.mjs --only=desktop --steps=tools/steps/collide.mjs --wait=2500 --url=http://127.0.0.1:5173/
//   COLLIDE_SECONDS=180 COLLIDE_PRESETS=karst,suriname COLLIDE_TAG=before COLLIDE_SHOTS=1   (the defaults)
//
// Fills a generated standard tank with herps and crabs (two dart frogs started against the front glass and in its front-left
// corner, where the user's pictures show them), runs the animals at 1/30 s a tick (the frame loop's step at 2x) with the world's
// clock at noon, and records the transform every instance is drawn with (CreatureLOD.put), as tools/steps/clash.mjs does. Sample
// points come from the species' own mesh (the trunk and the legs, rest pose). Per animal and sample tick it counts:
//   glass    any point beyond the inner glass box (sides, front, back pane, under the floor or above the lid) by more than 0.1 cm
//   piece    more than 5% of its points inside a hardscape piece (nearest surface faces away and ray parity agrees)
//   stem     more than 10% of its trunk points inside a plant's stems (the core Animals.plantCores keeps walkers out of)
//   ground   more than 20% of its trunk points over 0.3 cm under the ground (stamped rocks are ground)
//   relief   more than 10% of its points behind the background relief (a gecko on it: more than 0.3 cm into it)
//   air      standing (not hopping, swimming, perching or climbing) with no point of it within 0.6 cm of the ground under it (its
//            feet too: the lowest point of each leg), off the ground's surface (the drop straight down times the ground normal's y:
//            on a steep bank a gecko climbs, a body lying on it is several times as far above the ground straight below)
//   swim     swimming (not a fault: a frog that cannot find a bank to climb out on swims on and on)
// and while it climbs (a gecko on the background, a frog on its perch, a stem or the glass, and the tick it gets on or off):
//   spike    the drawn body turning faster than 6 rad/s in a tick
//   flip     its up vector (belly normal) swinging more than 30 degrees in one tick: ground and wall frames swapping
//   shake    the turn reversing direction from one tick to the next, both over 1 rad/s
// and a gecko on the background's gap: its belly's mean distance off the relief (median; share over 0.5 cm: detached) and its
// deepest belly point (median; share more than 0.3 cm into the relief).
// Prints one JSON line per preset (stemBy: stem samples per animal, plant and doing: one animal stuck in a plant shows at once);
// pictures with COLLIDE_SHOTS=1 at the spots of the user's photos.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.game, null, { timeout: 60000 });
  page.setDefaultTimeout(900000);
  const seconds = +(process.env.COLLIDE_SECONDS ?? 180);
  const presets = (process.env.COLLIDE_PRESETS ?? 'karst,suriname').split(',');
  const tag = process.env.COLLIDE_TAG ?? 'run';
  const shots = +(process.env.COLLIDE_SHOTS ?? 1);
  for (const preset of presets) {
    const res = await page.evaluate(async ({ seconds, preset }) => {
      const gen = await import('/src/sim/generator.js');
      const { TANK } = await import('/src/sim/tank.js');
      const { SPECIES } = await import('/src/sim/animals.js');
      const { PLANTS } = await import('/src/sim/plants.js');
      const { bodyFootprint } = await import('/src/util/body.js');
      // The same random numbers on every run (the animals' choices too), so a before and an after run start alike.
      let rs = 0x9e3779b9 ^ preset.length * 7919;
      Math.random = () => { rs |= 0; rs = (rs + 0x6d2b79f5) | 0; let t = Math.imul(rs ^ (rs >>> 15), 1 | rs); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const game = window.game;
      // 'suriname@3459': the game's own start of that preset and seed, stocked as a player gets it (where the look agent saw a frog
      // floating); otherwise a generated tank stocked with the mix below and the two frogs at the glass.
      const [pname, pseed] = preset.split('@');
      let w;
      if (pseed) {
        await window.__ctx.start.preset(pname, +pseed, 'standard');
        for (let i = 0; i < 600 && !(window.__S?.screen?.value === 'play' && !window.__S?.busy?.value); i++) await new Promise((r) => setTimeout(r, 100));
        w = game.world; game.setSpeed?.(0);
      } else {
        w = await game.loadTank('standard', { layout: 'empty' });
        gen.generateTerrarium(w, { preset, seed: 5, tier: 'standard' });
      }
      w.env.minute = Math.floor(w.env.minute / 1440) * 1440 + 12 * 60;
      let s = 4242;
      const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
      const A = w.animals, T = w.terrain, Wl = w.wall;
      A.syncOccupancy(true);
      if (!pseed) for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a);
      const mix = pseed ? Object.fromEntries(Object.keys(A.by).filter((id) => A.by[id].length && ['frog', 'toad', 'newt', 'axolotl', 'gecko', 'skink', 'crab'].includes(SPECIES[id]?.kind)).map((id) => [id, 0]))
        : { dartfrog: 4, leucomelas: 2, redeye: 2, toad: 2, gecko: 4, newt: 2, marbled: 2, crab: 3 };
      const counted = new Set(Object.keys(mix));
      for (const [id, n] of Object.entries(mix)) {
        if (!SPECIES[id]) continue;
        for (let i = 0; i < n; i++) {
          for (let k = 0; k < 200; k++) {
            const x = (rnd() - 0.5) * (TANK.w - 8), z = (rnd() - 0.5) * (TANK.d - 8);
            const r = A.placement(id, { point: { x, y: 0, z }, surface: 'ground' });
            if (r.pos) { A.add(id, r.pos); break; }
          }
        }
      }
      // The two frogs of the user's pictures: one facing the front glass at its edge, one in the front-left corner.
      const V3 = game.camera.position.constructor;
      const edge = (pseed ? [] : [[6, TANK.d / 2 - 0.9, 0], [-TANK.w / 2 + 0.9, TANK.d / 2 - 0.9, -Math.PI / 4]]).map(([x, z, yaw]) => {
        const a = A.add('dartfrog', new V3(x, T.heightAt(x, z), z));
        if (a) { a.yaw = yaw; a.fs = 'sit'; a.fsT = 30; }
        return a;
      });
      const all = () => Object.values(A.by).flat();
      for (let i = 0; i < 20; i++) { A.move(0.05); await new Promise((r) => setTimeout(r, 120)); }
      for (const m of Object.values(A.meshes)) await m.ready?.catch?.(() => {});
      for (let i = 0; i < 10; i++) { A.move(0.0001); await new Promise((r) => setTimeout(r, 60)); }

      const Q = A._q.constructor, RC = window.__tools.ray.constructor;
      const rc = new RC(); rc.firstHitOnly = false;
      const pieceList = (w.decor?.pieces ?? []).filter((p) => p.mesh);
      const pieces = pieceList.map((p) => p.mesh);
      for (const m of pieces) m.updateMatrixWorld(true);
      const inv = pieces.map((m) => m.matrixWorld.clone().invert());
      const boxes = pieces.map((m) => { const b = { min: new V3(1e9, 1e9, 1e9), max: new V3(-1e9, -1e9, -1e9) }; m.geometry.computeBoundingBox?.(); const bb = m.geometry.boundingBox; if (bb) { const c = [bb.min, bb.max]; for (let k = 0; k < 8; k++) { const v = new V3(c[k & 1].x, c[(k >> 1) & 1].y, c[k >> 2].z).applyMatrix4(m.matrixWorld); b.min.min(v); b.max.max(v); } } return b; });
      const lq = new V3(), tgt = { point: new V3(), distance: 0, faceIndex: 0 }, va = new V3(), vb = new V3(), vc = new V3(), nn = new V3(), cw = new V3(), o = new V3();
      const DIRS = [[0, 1, 0], [0.6, 0.2, 0.77], [-0.7, 0.3, -0.65], [0.1, -0.2, 0.97], [-0.9, -0.1, 0.4]].map(([x, y, z]) => new V3(x, y, z).normalize());
      const inPiece = (x, y, z) => {
        for (let i = 0; i < pieces.length; i++) {
          const b = boxes[i];
          if (x < b.min.x || y < b.min.y || z < b.min.z || x > b.max.x || y > b.max.y || z > b.max.z) continue;
          const g = pieces[i].geometry, bvh = g.boundsTree;
          if (!bvh) continue;
          lq.set(x, y, z).applyMatrix4(inv[i]);
          if (!bvh.closestPointToPoint(lq, tgt)) continue;
          const ix = g.index, f = tgt.faceIndex * 3, P = g.attributes.position;
          va.fromBufferAttribute(P, ix ? ix.getX(f) : f); vb.fromBufferAttribute(P, ix ? ix.getX(f + 1) : f + 1); vc.fromBufferAttribute(P, ix ? ix.getX(f + 2) : f + 2);
          nn.subVectors(vc, vb).cross(va.clone().sub(vb)).normalize();
          if (nn.dot(lq.clone().sub(tgt.point)) >= 0) continue;
          if (cw.copy(tgt.point).applyMatrix4(pieces[i].matrixWorld).distanceTo(o.set(x, y, z)) <= 0.2) continue;
          let odd = 0;
          for (const d of DIRS) { rc.set(o.set(x, y, z), d); rc.near = 0; rc.far = 200; if (rc.intersectObject(pieces[i], false).length % 2 === 1) odd++; }
          if (odd >= 3) return pieceList[i].type;
        }
        return null;
      };
      const samples = new Map();
      const sampleOf = (key) => {
        if (samples.has(key)) return samples.get(key);
        const m = A.meshes[key], g = (m?._lo ?? m?.lo)?.geometry;
        const P = g?.attributes?.position?.array, R = g?.attributes?.rig?.array;
        if (!P) return null;
        const n = P.length / 3, core = [], legs = [];
        for (let i = 0; i < n; i++) (R && R[i * 4 + 1] > 0.5 ? legs : core).push(i);
        const pick = (ids, k) => { const out = []; const st = Math.max(1, Math.floor(ids.length / k)); for (let i = 0; i < ids.length && out.length < k; i += st) { const j = ids[i]; out.push([P[j * 3], P[j * 3 + 1], P[j * 3 + 2]]); } return out; };
        const fp = bodyFootprint(P, R ?? null);
        const tz0 = fp.tc - fp.tl, tz1 = fp.tc + fp.tl;
        const coreIn = core.filter((i) => P[i * 3 + 2] >= tz0 && P[i * 3 + 2] <= tz1 && Math.abs(P[i * 3]) <= fp.tw * 1.1);
        // the belly: the lowest fifth of the trunk (what touches a wall the gecko is clinging to)
        let ylo = 1e9, yhi = -1e9; for (const i of coreIn) { ylo = Math.min(ylo, P[i * 3 + 1]); yhi = Math.max(yhi, P[i * 3 + 1]); }
        const belly = coreIn.filter((i) => P[i * 3 + 1] <= ylo + (yhi - ylo) * 0.2);
        // the feet: the lowest point of each leg (an even pick of the leg points can miss every foot: a crab stands on its tips)
        const foot = new Map();
        if (R) for (const i of legs) { const k = Math.round(R[i * 4 + 1] * 4); if (!foot.has(k) || P[i * 3 + 1] < P[foot.get(k) * 3 + 1]) foot.set(k, i); }
        const r = { core: pick(coreIn.length ? coreIn : core, 36), legs: pick(legs, 24), belly: pick(belly.length ? belly : coreIn, 16), feet: [...foot.values()].map((j) => [P[j * 3], P[j * 3 + 1], P[j * 3 + 2]]) };
        samples.set(key, r);
        return r;
      };
      let cap = {};
      const wrap = () => {
        for (const [id, keys] of Object.entries(A.keys)) for (const key of keys) {
          const m = A.meshes[key];
          if (!m || m.put.__collide) continue;
          const orig = m.put.bind(m);
          m.put = (pos, quat, scale, ...rest) => { (cap[id] ??= []).push({ key, pos: pos.clone(), quat: quat.clone(), scale }); return orig(pos, quat, scale, ...rest); };
          m.put.__collide = true;
        }
      };
      const wp = new V3(), UPV = new V3(0, 1, 0), up = new V3(), qd = new Q(), qi = new Q();
      const toWorld = (c, p, out) => out.set(p[0], p[1], p[2]).multiplyScalar(c.scale).applyQuaternion(c.quat).add(c.pos);
      const stat = {}, bump = (sp, k, v = 1) => { const r = stat[sp] ??= { n: 0, glass: 0, piece: 0, stem: 0, ground: 0, relief: 0, air: 0, swim: 0, climbS: 0, spike: 0, flip: 0, shake: 0 }; r[k] += v; };
      const glassBy = {}, pieceBy = {}, pieceDoing = {}, groundDoing = {}, reliefDoing = {}, airDoing = {}, airCases = [], stemDoing = {}, stemBy = {}, gaps = [], means = [];
      const doingOf = (a) => a.wallMode ? 'wall' : a.onWall ? 'onWall' : a.perch ? `perch-${a.perch.glassN ? (a.perch.plant ? 'stem' : 'glass') : a.perch.plant ? 'leaf' : 'wood'}-${a.perch.ph}` : a.hop ? 'hop' : a.swimming ? 'swim' : a.cb?.sinkNow > 0.1 ? 'burrow' : a.state ?? '?';
      const add = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
      let maxOut = 0, edgeOut = 0;
      const prev = new Map();
      const climbing = (a) => !!(a.wallMode || a.onWall || (a.perch && a.perch.ph !== 'go'));
      const dtA = 1 / 30, ticks = Math.round(seconds / dtA);
      const hx = TANK.w / 2, hz = TANK.d / 2, E = 0.1;
      // (a gap measured straight down is the gap off the ground only where it is level: on a steep face, a gecko climbing the bank, it
      // is that times the slope's cosine, the ground normal's y)
      const nY = (x, z) => { const [gx, gz] = T.field.gradient(x, z); return 1 / Math.hypot(gx, 1, gz); };
      const stems = () => w.plants.list.filter((q) => q.surface !== 'wall' && !['javamoss', 'pothos'].includes(q.id) && !['floating', 'aquatic'].includes(PLANTS[q.id]?.habitat ?? '')).map((q) => ({ x: q.pos.x, y: q.pos.y, z: q.pos.z, q, r: Math.min(2.5, Math.max(0.5, (q.reach ?? 3) * (0.3 + 0.7 * q.grown) * 0.18)) * 0.8 }));
      let stemList = stems(), samplesN = 0;
      for (let tick = 0; tick < ticks; tick++) {
        w.sim.step(dtA);
        wrap(); cap = {};
        A.move(dtA);
        const list = [];
        for (const [id, arr] of Object.entries(A.by)) {
          const cs = cap[id] ?? [];
          arr.forEach((a, i) => { const c = cs[i]; if (!c || a.dead) return; const sm = sampleOf(c.key); if (sm) list.push({ a, c, sm }); });
        }
        // Climbing: the drawn frame from tick to tick.
        for (const { a, c } of list) {
          if (!counted.has(a.sp)) continue;
          const cl = climbing(a), p = prev.get(a);
          if (cl || p?.cl) {
            if (cl) bump(a.sp, 'climbS', dtA);
            if (p) {
              qd.copy(c.quat).multiply(qi.copy(p.q).invert());
              const ang = 2 * Math.acos(Math.min(1, Math.abs(qd.w))), om = ang / dtA;
              const s2 = Math.sqrt(Math.max(1e-12, 1 - qd.w * qd.w)) * Math.sign(qd.w || 1);
              const ax = [qd.x / s2, qd.y / s2, qd.z / s2];
              up.copy(UPV).applyQuaternion(c.quat);
              if (om > 6) bump(a.sp, 'spike');
              if (up.angleTo(p.up) > Math.PI / 6) bump(a.sp, 'flip');
              if (p.om > 1 && om > 1 && p.ax && ax[0] * p.ax[0] + ax[1] * p.ax[1] + ax[2] * p.ax[2] < -0.5) bump(a.sp, 'shake');
              prev.set(a, { q: c.quat.clone(), up: up.clone(), om, ax: om > 1e-3 ? ax : null, cl });
            } else prev.set(a, { q: c.quat.clone(), up: UPV.clone().applyQuaternion(c.quat), om: 0, ax: null, cl });
          } else prev.set(a, { q: c.quat.clone(), up: UPV.clone().applyQuaternion(c.quat), om: 0, ax: null, cl: false });
        }
        if (tick % 3) continue;
        samplesN++;
        const deep = tick % 6 === 0;
        if (tick % 90 === 0) stemList = stems();
        for (const { a, c, sm } of list) {
          if (!counted.has(a.sp)) continue;                    // (fruit flies and the like from the generator's cultures are not counted)
          bump(a.sp, 'n');
          if (a.swimming) bump(a.sp, 'swim');
          const pts = [...sm.core, ...sm.legs];
          let out = 0, nObj = 0, nGround = 0, nRel = 0, nStem = 0, objType = null, low = 1e9, stemHit = null;
          const wall = !!a.wallMode;
          for (let i = 0; i < pts.length; i++) {
            toWorld(c, pts[i], wp);
            const o1 = Math.max(Math.abs(wp.x) - hx, Math.abs(wp.z) - hz, -wp.y, wp.y - TANK.h);
            if (o1 > out) out = o1;
            const core = i < sm.core.length;
            const gh = T.heightAt(wp.x, wp.z);
            if (core && !wall && wp.y < gh - 0.3) nGround++;
            low = Math.min(low, (wp.y - gh) * nY(wp.x, wp.z));
            if (core && !a.perch && !wall) for (const q of stemList) { const dx = wp.x - q.x, dz = wp.z - q.z; if (dx * dx + dz * dz < q.r * q.r && wp.y > q.y - 0.5 && wp.y < q.y + 4) { nStem++; stemHit = q; break; } }
            if (wp.z < Wl.zAt(wp.x, wp.y) - (wall ? 0.3 : 0.15)) nRel++;
            if (deep && i % 2 === 0) { const t = inPiece(wp.x, wp.y, wp.z); if (t) { nObj += 2; objType = t; } }
          }
          if (out > E) { bump(a.sp, 'glass'); maxOut = Math.max(maxOut, out); add(glassBy, doingOf(a)); if (edge.includes(a)) edgeOut = Math.max(edgeOut, out); }
          if (deep && nObj > pts.length * 0.05) {
            bump(a.sp, 'piece', 2);
            add(pieceBy, objType); add(pieceDoing, `${a.sp}:${doingOf(a)}`);
          }
          if (sm.core.length && nGround > sm.core.length * 0.2 && !(a.cb?.sinkNow > 0.1)) { bump(a.sp, 'ground'); add(groundDoing, `${a.sp}:${doingOf(a)}`); }
          if (sm.core.length && nStem > sm.core.length * 0.1) { bump(a.sp, 'stem'); add(stemDoing, `${a.sp}:${doingOf(a)}`); add(stemBy, `${a.sp}#${a.id}:${stemHit.q.id}:${doingOf(a)}`); }
          if (nRel > pts.length * 0.1) { bump(a.sp, 'relief'); add(reliefDoing, `${a.sp}:${doingOf(a)}`); }
          // nothing of it within 0.6 cm of the ground under it, while it is meant to be standing there
          for (const p of sm.feet) { toWorld(c, p, wp); low = Math.min(low, (wp.y - T.heightAt(wp.x, wp.z)) * nY(wp.x, wp.z)); }
          if (low > 0.6 && !wall && !a.onWall && !a.hop && !a.perch && !a.swimming && !(a.pos.y < w.water.surfaceAt(a.pos.x, a.pos.z) + 0.2)) {
            bump(a.sp, 'air'); add(airDoing, `${a.sp}:${doingOf(a)}`);
            if (airCases.length < 4 && !airCases.some((k) => k.id === a.id)) airCases.push({ id: a.id, sp: a.sp, tick, pos: a.pos.toArray().map((v) => +v.toFixed(2)), drawnY: +c.pos.y.toFixed(2), ground: +T.heightAt(a.pos.x, a.pos.z).toFixed(2), low: +low.toFixed(2), water: +w.water.surfaceAt(a.pos.x, a.pos.z).toFixed(2), fs: a.fs ?? null, nY: +nY(a.pos.x, a.pos.z).toFixed(2), footDy: +(A.footing(a, SPECIES[a.sp])?.dy ?? NaN).toFixed(2) });
          }
          if (wall) {
            let g = 1e9, m = 0;
            for (const p of sm.belly) { toWorld(c, p, wp); const d = wp.z - Wl.zAt(wp.x, wp.y); g = Math.min(g, d); m += d / sm.belly.length; }
            gaps.push(g); means.push(m);
          }
        }
        if (tick % 300 === 0) { for (const a of all()) { a.health = Math.max(a.health, 0.8); a.hunger = Math.min(a.hunger, 0.5); } await new Promise((r) => setTimeout(r, 0)); }
      }
      const tot = Object.values(stat).reduce((t, r) => { for (const k in r) t[k] = (t[k] ?? 0) + r[k]; return t; }, {});
      const pc = (k) => +(tot[k] / tot.n * 100).toFixed(2);
      const perMin = (k) => (tot.climbS > 1 ? +(tot[k] / (tot.climbS / 60)).toFixed(1) : 0);
      gaps.sort((p, q) => p - q); means.sort((p, q) => p - q);
      window.__collide = { edge: edge.map((a) => a?.id), gecko: all().find((a) => a.wallMode)?.id ?? null };
      window.__collideTank = { TANK: { w: TANK.w, h: TANK.h, d: TANK.d } };
      return {
        preset, animals: all().length, samples: samplesN, seconds,
        pct: { glass: pc('glass'), piece: pc('piece'), stem: pc('stem'), ground: pc('ground'), relief: pc('relief'), air: pc('air') },
        maxOutCm: +maxOut.toFixed(2), edgeFrogOutCm: +edgeOut.toFixed(2), glassBy, pieceBy, pieceDoing, groundDoing, reliefDoing, airDoing, airCases, stemDoing, stemBy,
        climb: { minutes: +(tot.climbS / 60).toFixed(2), spikePerMin: perMin('spike'), flipPerMin: perMin('flip'), shakePerMin: perMin('shake') },
        wallGap: gaps.length ? { n: gaps.length, meanGap: +means[means.length >> 1].toFixed(2), off05: +(means.filter((g) => g > 0.5).length / means.length * 100).toFixed(1), deepest: +gaps[gaps.length >> 1].toFixed(2), into03: +(gaps.filter((g) => g < -0.3).length / gaps.length * 100).toFixed(1) } : null,
        table: Object.fromEntries(Object.entries(stat).sort().map(([k, r]) => [k, { n: r.n, glass: +(r.glass / r.n * 100).toFixed(1), piece: +(r.piece / r.n * 100).toFixed(1), stem: +(r.stem / r.n * 100).toFixed(1), ground: +(r.ground / r.n * 100).toFixed(1), relief: +(r.relief / r.n * 100).toFixed(1), air: +(r.air / r.n * 100).toFixed(1), swim: +(r.swim / r.n * 100).toFixed(1), climbMin: +(r.climbS / 60).toFixed(2), spike: r.spike, flip: r.flip, shake: r.shake }])),
      };
    }, { seconds, preset });
    const { table, ...head } = res;
    console.log(`COLLIDE ${tag} ${preset}`, JSON.stringify(head));
    for (const [k, r] of Object.entries(table)) console.log(`  ${k.padEnd(11)} n=${String(r.n).padStart(5)} glass ${String(r.glass).padStart(5)}%  piece ${String(r.piece).padStart(5)}%  stem ${String(r.stem).padStart(5)}%  ground ${String(r.ground).padStart(5)}%  relief ${String(r.relief).padStart(5)}%  air ${String(r.air).padStart(5)}%  swim ${String(r.swim).padStart(5)}%  climb ${r.climbMin} min  spikes ${r.spike} flips ${r.flip} shakes ${r.shake}`);
    if (!shots) continue;
    // Pictures at the spots of the user's photos, the world frozen, the interface hidden: the frog at the front glass (b2dda8b0)
    // and in the front-left corner (6570dbd3), seen along the glass; a gecko on the background (16c595f3), seen from the side.
    const spots = preset.includes('@') ? [['close', -2]] : [['front', 0], ['corner', 1], ['gecko', -1]];
    for (const [label, idx] of spots) {
      const ok = await page.evaluate(({ idx }) => {
        const g = window.game, A = g.world.animals, all = Object.values(A.by).flat();
        if (idx === -2) {
          // tools/steps/look-defects.mjs's close view of the tank
          const { TANK } = window.__collideTank;
          g.frozen = true; const ui = document.getElementById('ui'); if (ui) ui.style.visibility = 'hidden';
          g.rig?.stopOrbit?.(); if (g.rig) g.rig.moved = true;
          g.controls.setLookAt(-TANK.w * 0.18, TANK.h * 0.32, TANK.d * 0.5 + TANK.w * 0.22, -TANK.w * 0.12, TANK.h * 0.16, TANK.d * 0.1, false);
          A.move(0);
          return true;
        }
        let id = idx >= 0 ? window.__collide.edge[idx] : (all.find((a) => a.wallMode)?.id ?? window.__collide.gecko);
        if (idx < 0 && id == null && A.by.gecko?.length) {
          // no gecko on the background just now: one is put on it, a third of the way up, and let walk a few seconds
          const gk = A.by.gecko[0], W = g.world, x = -6, y = W.water.level + (60 - W.water.level) * 0.4;
          gk.pos.set(x, y, W.wall.zAt(x, y) + 0.5); gk.onWall = true; gk.wallMode = true; gk.yaw = Math.PI; if (gk.hm) gk.hm.wantWall = true;
          for (let i = 0; i < 90; i++) A.move(1 / 30);
          id = gk.wallMode ? gk.id : null;
        }
        const a = all.find((b) => b.id === id);
        if (!a) return false;
        g.frozen = true;
        const ui = document.getElementById('ui'); if (ui) ui.style.visibility = 'hidden';
        const p = a.pos;
        g.rig?.stopOrbit?.(); if (g.rig) g.rig.moved = true;
        if (idx === 0) g.controls.setLookAt(p.x + 7, p.y + 2.5, p.z + 7, p.x, p.y + 0.6, p.z, false);          // from outside the front glass
        else if (idx === 1) g.controls.setLookAt(p.x + 6, p.y + 3, p.z + 7, p.x, p.y + 0.6, p.z, false);       // into the corner from outside
        else { const n = a.normal ?? { x: 0, y: 0, z: 1 }; g.controls.setLookAt(p.x + n.x * 6 + 4, p.y + n.y * 6 + 1, p.z + n.z * 6 + 1, p.x, p.y, p.z, false); }   // the gecko from off the wall
        A.move(0);
        return true;
      }, { idx });
      if (!ok) { console.log('no animal for', label); continue; }
      await page.waitForTimeout(900);
      await shot(`collide-${tag}-${preset}-${label}`);
    }
    await page.evaluate(() => { window.game.frozen = false; const ui = document.getElementById('ui'); if (ui) ui.style.visibility = ''; });
  }
  const errs = await page.evaluate(() => window.__errs?.slice(0, 5) ?? []);
  if (errs.length) console.log('errors', JSON.stringify(errs));
};
