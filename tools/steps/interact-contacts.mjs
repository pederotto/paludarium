// Interaction probe: animals against animals (bodies inside each other, predation that eats a prey twice, a prey left "taken"
// forever, hunters and suitors chasing dead animals), against plants and objects (perches on a plant that is gone, bodies inside
// hardscape) and fish out of the water. Counts, it does not judge looks (tools/steps/collide.mjs measures the drawn meshes).
//
//   node tools/shot.mjs --only=desktop --steps=tools/steps/interact-contacts.mjs --wait=2500 --url=http://127.0.0.1:5173/
//   IC_PRESETS=suriname,swamp,blackwater IC_SEEDS=1,2,3 IC_SECONDS=90 IC_SPEED=5 IC_TAG=run   (the defaults)
//
// Each run: the preset generated at tank seed 5 (stocked by the generator) plus a mixed crowd of hunters and prey, Math.random
// seeded with the run's seed, hunters started hungry. Animals move at 1/30 s a tick; the sim (meals, deaths) runs IC_SPEED game
// minutes per animal second (fast-forward, where meals come often). Every third tick it counts:
//   overlap  a pair of bodies of the separation's own groups (land, water) whose heights overlap, more than 35% of the sum of their
//            radii inside each other (capsules along the heading for long bodies, as separate() sees them); `deep` over 70%;
//            `long` pairs that stay so for over 2 s
//   perch    two perched (or climbing) animals within half the sum of their radii (perches are outside the separation)
//   solid    an animal's middle inside a hardscape piece (the occupancy grid), not a perched/climbing/burrowing one
//   fishLand a fish whose middle is out of the water (above the surface or under the bed) or where the water is under 1 cm deep
//   refs     a live animal holding a dead one (order target, strike prey, courtWith, mate, anything with .sp and .dead)
//   perchGone an animal perched on a plant that is no longer in the tank
//   taken    a live prey marked taken (a tongue holds it) by an animal that is not striking at it: no one can eat it any more
// and per event: strikes, meals (consume), meals at the deadline (eatNow), the sim's own meal (fallback) and how many of those
// came while the eater was itself hunting or striking (busy), a prey eaten while held on another's tongue (stolen), remove() of an
// animal already dead (double), consume() of a dead prey.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.game, null, { timeout: 60000 });
  page.setDefaultTimeout(1800000);
  const presets = (process.env.IC_PRESETS ?? 'suriname,swamp,blackwater').split(',');
  const seeds = (process.env.IC_SEEDS ?? '1,2,3').split(',').map(Number);
  const seconds = +(process.env.IC_SECONDS ?? 90), speed = +(process.env.IC_SPEED ?? 5), tag = process.env.IC_TAG ?? 'run';
  const mixEnv = process.env.IC_MIX;
  for (const preset of presets) for (const seed of seeds) {
    const res = await page.evaluate(async ({ preset, seed, seconds, speed, mixEnv }) => {
      const gen = await import('/src/sim/generator.js');
      const { TANK } = await import('/src/sim/tank.js');
      const { SPECIES } = await import('/src/sim/animals.js');
      let rs = seed * 2654435761 >>> 0;
      Math.random = () => { rs |= 0; rs = (rs + 0x6d2b79f5) | 0; let t = Math.imul(rs ^ (rs >>> 15), 1 | rs); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const game = window.game;
      game.setSpeed?.(0);
      const w = await game.loadTank('standard', { layout: 'empty' });
      gen.generateTerrarium(w, { preset, seed: 5, tier: 'standard' });
      w.env.minute = Math.floor(w.env.minute / 1440) * 1440 + 11 * 60;
      const A = w.animals, T = w.terrain;
      A.syncOccupancy(true);
      const mix = mixEnv ? Object.fromEntries(mixEnv.split(',').map((s) => s.split(':')).map(([k, v]) => [k, +v]))
        : { fly: 25, springtail: 25, cricket: 6, isopod: 10, dartfrog: 3, redeye: 2, crab: 3, gecko: 2, newt: 2, shrimp: 8, neon: 8, cory: 4, guppy: 4 };
      for (const [id, n] of Object.entries(mix)) {
        if (!SPECIES[id]) continue;
        for (let i = 0; i < n; i++) for (let k = 0; k < 200; k++) {
          const x = (Math.random() - 0.5) * (TANK.w - 8), z = (Math.random() - 0.5) * (TANK.d - 8);
          const r = A.placement(id, { point: { x, y: 0, z }, surface: 'ground' });
          if (r.pos && !(A.occ.count && A.occ.solidAt(r.pos.x, r.pos.y + 0.5, r.pos.z))) { A.add(id, r.pos); break; }
        }
      }
      // Really inside a piece's mesh (the grid is 1.5 cm voxels thickened by one: near a piece is not in it): the nearest surface
      // faces away and rays cast five ways cross the shell an odd number of times in at least three (as collide.mjs).
      const V3 = game.camera.position.constructor, RC = window.__tools.ray.constructor, rc = new RC(); rc.firstHitOnly = false;
      const pieceList = (w.decor?.pieces ?? []).filter((p) => p.mesh);
      for (const p of pieceList) p.mesh.updateMatrixWorld(true);
      const bx = pieceList.map((p) => { p.mesh.geometry.computeBoundingBox(); return p.mesh.geometry.boundingBox.clone().applyMatrix4(p.mesh.matrixWorld); });
      const DIRS = [[0, 1, 0], [0.6, 0.2, 0.77], [-0.7, 0.3, -0.65], [0.1, -0.2, 0.97], [-0.9, -0.1, 0.4]].map(([x, y, z]) => new V3(x, y, z).normalize());
      const o3 = new V3();
      const inMesh = (x, y, z) => {
        for (let i = 0; i < pieceList.length; i++) {
          if (!bx[i].containsPoint(o3.set(x, y, z))) continue;
          let odd = 0;
          for (const d of DIRS) { rc.set(o3.set(x, y, z), d); rc.near = 0; rc.far = 200; if (rc.intersectObject(pieceList[i].mesh, false).length % 2 === 1) odd++; }
          if (odd >= 3) return pieceList[i].type;
        }
        return null;
      };
      const HUNT = new Set(['frog', 'toad', 'newt', 'axolotl', 'gecko', 'skink']);
      for (const a of A.all) if (HUNT.has(SPECIES[a.sp].kind)) a.hunger = 0.6;
      for (let i = 0; i < 10; i++) { A.move(0.05); await new Promise((r) => setTimeout(r, 80)); }
      for (const m of Object.values(A.meshes)) await m.ready?.catch?.(() => {});
      const stock = Object.fromEntries(Object.entries(A.by).filter(([, v]) => v.length).map(([k, v]) => [k, v.length]));

      // --- events ---
      const ev = { strike: 0, consume: 0, eatNow: 0, fallback: 0, fallbackBusy: 0, stolen: 0, double: 0, consumeDead: 0, removed: {} };
      const cases = {};
      const note = (k, o) => { const l = cases[k] ??= []; if (l.length < 4) l.push(o); };
      let tick = 0, fb = null, inConsume = null;
      const P = (v) => [+v.x.toFixed(1), +v.y.toFixed(1), +v.z.toFixed(1)];
      const doing = (a) => a.wallMode ? 'wall' : a.onWall ? 'onWall' : a.perch ? `perch-${a.perch.ph}` : a.hop ? 'hop' : a.swimming ? 'swim' : a.cb?.sinkNow > 0.1 ? 'burrow' : a.st ? 'strike' : a.hm?.mode ?? a.fs ?? a.state ?? '?';
      const rel = {}, oRelocate = A.relocate.bind(A);
      A.relocate = (a, sp, far = a.stuckLevel >= 3, inside = false) => {
        const mode = far && inside ? 'second' : inside ? 'inside' : far ? 'far' : 'stuck', from = a.pos.clone();
        const y = sp.kind === 'swim' || a.swimming ? a.pos.y : a.pos.y + 0.5, really = inside ? inMesh(a.pos.x, y, a.pos.z) : null;
        const st = a.st, prey = st?.prey;
        const r = oRelocate(a, sp, far, inside);
        const d = a.pos.distanceTo(from), k = `${a.sp}:${mode}`, o = rel[k] ??= { n: 0, notInMesh: 0, far5: 0, strike: 0, dsum: 0 };
        o.n++; o.dsum += d; if (inside && !really) o.notInMesh++; if (d > 5) o.far5++;
        if (st) { o.strike++; note('relocStrike', { t: tick, sp: a.sp, ph: st.ph, got: st.got, prey: prey?.sp, preyTaken: !!prey?.taken }); }
        note(`reloc:${k}`, { t: tick, id: a.id, from: P(from), to: P(a.pos), d: +d.toFixed(1), inMesh: really, doing: doing(a) });
        return r;
      };
      const oConsume = A.consume.bind(A), oRemove = A.remove.bind(A), oEatNow = A.eatNow.bind(A), oOrder = A.order.bind(A), oBegin = A.beginStrike.bind(A);
      A.consume = (a, sp, pid, p) => { ev.consume++; if (p.dead) { ev.consumeDead++; note('consumeDead', { t: tick, by: a.sp, prey: pid, cause: p.cause }); } inConsume = a; try { return oConsume(a, sp, pid, p); } finally { inConsume = null; } };
      A.eatNow = (a, sp, o) => { ev.eatNow++; return oEatNow(a, sp, o); };
      A.beginStrike = (a, sp, o) => { ev.strike++; return oBegin(a, sp, o); };
      A.order = (a, pid) => { const busy = !!(a.order || a.st); const r = oOrder(a, pid); fb = r ? null : { a, busy, pid }; return r; };
      A.remove = (a, cause = null) => {
        if (a.dead) { ev.double++; note('double', { t: tick, sp: a.sp, was: a.cause, now: cause }); }
        if (cause?.startsWith('eaten')) {
          if (!inConsume && fb) { ev.fallback++; if (fb.busy) { ev.fallbackBusy++; note('fallbackBusy', { t: tick, by: fb.a.sp, prey: a.sp, order: !!fb.a.order, st: fb.a.st?.ph ?? null }); } }
          if (a.taken && a.takenBy && a.takenBy !== inConsume && !a.takenBy.dead) { ev.stolen++; note('stolen', { t: tick, prey: a.sp, holder: a.takenBy.sp, by: inConsume?.sp ?? 'sim', ph: a.takenBy.st?.ph ?? null }); }
        }
        fb = null;
        ev.removed[cause?.startsWith('eaten') ? 'eaten' : cause ?? '?'] = (ev.removed[cause?.startsWith('eaten') ? 'eaten' : cause ?? '?'] ?? 0) + 1;
        return oRemove(a, cause);
      };

      // --- per tick counts ---
      const C = { samples: 0, overlap: {}, deep: {}, perch: {}, solid: {}, inMesh: {}, solidDoing: {}, fishLand: {}, refs: {}, perchGone: 0, taken: 0, takenMax: 0, longPairs: 0 };
      const add = (o, k, v = 1) => { o[k] = (o[k] ?? 0) + v; };
      const pairT = new Map();
      const dtA = 1 / 30, ticks = Math.round(seconds / dtA);
      const isAnimal = (v) => v && typeof v === 'object' && typeof v.sp === 'string' && 'dead' in v && v.pos;
      for (tick = 0; tick < ticks; tick++) {
        w.sim.step(dtA * speed);
        A.move(dtA);
        if (tick % 3) continue;
        C.samples++;
        const all = A.all.filter((a) => !a.dead);
        const plants = new Set(w.plants.list);
        let taken = 0;
        for (const a of all) {
          const sp = SPECIES[a.sp];
          // dangling references to dead animals
          for (const [k, v] of Object.entries(a)) {
            if (isAnimal(v) && v.dead) add(C.refs, `${k}`);
            else if (v && typeof v === 'object' && !Array.isArray(v) && k !== 'pos' && k !== 'vel' && k !== 'home') for (const [k2, v2] of Object.entries(v)) if (isAnimal(v2) && v2.dead && !(k === 'st' && v.got)) { add(C.refs, `${k}.${k2}`); note(`ref:${k}.${k2}`, { t: tick, sp: a.sp, of: v2.sp, cause: v2.cause }); }
          }
          if (a.mate != null && !A.mateOf(a)) add(C.refs, 'mate(id)');
          if (a.perch?.plant && !plants.has(a.perch.plant)) { C.perchGone++; note('perchGone', { t: tick, sp: a.sp, plant: a.perch.plant.id }); }
          if (a.taken && !(a.takenBy && a.takenBy.st && a.takenBy.st.prey === a && !a.takenBy.dead)) { taken++; note('taken', { t: tick, sp: a.sp, id: a.id, holder: a.takenBy?.sp, holderDead: !!a.takenBy?.dead, pos: P(a.pos) }); }
          // inside hardscape
          const climbing = a.wallMode || a.onWall || (a.perch && a.perch.ph !== 'go') || a.hop || a.cb?.sinkNow > 0.1 || sp.kind === 'egg';
          if (!climbing && A.occ.count && A.occ.solidAt(a.pos.x, a.pos.y + Math.max(0.2, (a.bh ?? 0.4) * 0.5), a.pos.z)) {
            add(C.solid, a.sp);
            const pt = inMesh(a.pos.x, a.pos.y + Math.max(0.2, (a.bh ?? 0.4) * 0.5), a.pos.z);
            if (pt) { add(C.inMesh, a.sp); add(C.solidDoing, `${a.sp}:${doing(a)}:${pt}`); note(`inMesh:${a.sp}`, { t: tick, id: a.id, pos: P(a.pos), doing: doing(a), piece: pt }); }
          }
          if (sp.kind === 'swim') {
            const g = T.heightAt(a.pos.x, a.pos.z), top = A.waterTop(a.pos.x, a.pos.z);
            const why = top - g < 1 ? 'dry' : a.pos.y > top + 0.2 ? 'above' : a.pos.y < g - 0.2 ? 'under' : null;
            if (why) { add(C.fishLand, `${a.sp}:${why}`); note(`fish:${a.sp}`, { t: tick, id: a.id, pos: P(a.pos), why, depth: +(top - g).toFixed(2) }); }
          }
        }
        C.taken += taken; C.takenMax = Math.max(C.takenMax, taken);
        // pairs
        const grp = all.filter((a) => a.grp === 'land' || a.grp === 'water');
        for (let i = 0; i < grp.length; i++) for (let j = i + 1; j < grp.length; j++) {
          const a = grp[i], b = grp[j];
          if (Math.abs(a.pos.x - b.pos.x) > 8 || Math.abs(a.pos.z - b.pos.z) > 8) continue;
          if (Math.min(a._y1, b._y1) - Math.max(a._y0, b._y0) < 0.1 * Math.min(a._y1 - a._y0, b._y1 - b._y0)) continue;
          let dx, dy = 0, dz;
          if (a.cap || b.cap) { const c = A.axes(a, b); dx = c[0] - c[2]; dz = c[1] - c[3]; }
          else { dx = a.pos.x - b.pos.x; dz = a.pos.z - b.pos.z; if (SPECIES[a.sp].kind === 'swim' && SPECIES[b.sp].kind === 'swim') dy = a.pos.y - b.pos.y; }
          const R = a.rad + b.rad, d = Math.hypot(dx, dy, dz), pen = (R - d) / R;
          const key = [a.sp, b.sp].sort().join('|'), pk = a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
          if (pen > 0.35) {
            add(C.overlap, key);
            if (pen > 0.7) { add(C.deep, key); note(`deep:${key}`, { t: tick, ids: [a.id, b.id], pos: P(a.pos), pen: +pen.toFixed(2), doing: [doing(a), doing(b)] }); }
            const n = (pairT.get(pk) ?? 0) + 1; pairT.set(pk, n);
            if (n === 20) { C.longPairs++; note(`long:${key}`, { t: tick, ids: [a.id, b.id], pos: P(a.pos), pen: +pen.toFixed(2), doing: [doing(a), doing(b)] }); }
          } else pairT.delete(pk);
        }
        const per = all.filter((a) => (a.perch && a.perch.ph !== 'go') || a.wallMode);
        for (let i = 0; i < per.length; i++) for (let j = i + 1; j < per.length; j++) {
          const a = per[i], b = per[j], R = (a.rad ?? 0.5) + (b.rad ?? 0.5), d = a.pos.distanceTo(b.pos);
          if (d < R * 0.5) { const key = [a.sp, b.sp].sort().join('|'); add(C.perch, key); note(`perch:${key}`, { t: tick, ids: [a.id, b.id], pos: P(a.pos), d: +d.toFixed(2), doing: [doing(a), doing(b)] }); }
        }
      }
      A.relocate = oRelocate; A.consume = oConsume; A.remove = oRemove; A.eatNow = oEatNow; A.order = oOrder; A.beginStrike = oBegin;
      const left = Object.fromEntries(Object.entries(A.by).filter(([, v]) => v.length).map(([k, v]) => [k, v.length]));
      for (const o of Object.values(rel)) { o.dmean = +(o.dsum / o.n).toFixed(1); delete o.dsum; }
      return { preset, seed, seconds, speed, stock, left, ev, C, rel, stuck: A.stuckStats, cases };
    }, { preset, seed, seconds, speed, mixEnv });
    console.log(`IC ${tag} ` + JSON.stringify(res));
  }
  const errs = await page.evaluate(() => window.__errs?.slice(0, 5) ?? []);
  if (errs.length) console.log('errors', JSON.stringify(errs));
};
