// Runs a list of Test Lab scenarios headlessly, one browser at a time, and prints one result line per scenario (and appends it as a JSON line to $OUT).
//   SCEN=tools/scenarios/lab-fear.json OUT=test-output/fear.jsonl node tools/shot.mjs --only=desktop --url=http://localhost:4700/lab.html --steps=tools/steps/lab-scenarios.mjs --out=test-output/lab
//   SECS=12 shortens every scenario to 12 real seconds. The same file against the live site is the "before":  --url=https://pederotto.github.io/paludarium/lab.html
//   (the line says planner=yes on a build that has Animals.labGrid, planner=no on one that has not). Run ONE at a time (the owner: sequential only on the M1 8 GB),
//   and compare runs only at the same load (`uptime`): a run at load 30 gave 119 relocations where load 5 gave 8.
// SCEN: a JSON array of { name, seconds (real, default 20), rate (1..4, default 4), turn (true: yaw change by state, frogs), watch: [[i, j]] (closest distance
// between animals i and j), trace: [i] (the mode timeline of animal i), spec } where spec is the lab's scenario format (src/lab/scenario.js): { tank, ground,
// depth, obstacles: [{kind,x,z,size|w,d,h,rot}], dots, animals: [{sp,x,y?,z,yaw,wall?,drive}] }. Animals are listed in the order the world keeps them (by species
// as they were first added), not the order of the spec: say so in the scenario's name when it matters.
// Per animal it reports: reached / skipped / laps (path drives), cm walked, mean off-line, the fastest it moved between samples (cm/s: a pop shows here), the
// highest it was (cm: a climb), the closest its DRAWN body came to the back relief (cm, negative = through it), its modes over time (fear, perch-go/up/sit, swim,
// flee ...), whether it ended on the wall, whether it is finite; plus the bug radar's counts by kind and page errors. A species that is not in the build is
// reported as SPAWN 0/n. The first use of a species loads its model, so the run starts by spawning each species once (warm-up) and waits for it.
import fs from 'node:fs';

const an0 = (r) => r.animals.some((a) => a.modes && Object.keys(a.modes).length > 0);
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.lab?.L.ready.value, null, { timeout: 90000 });
  page.setDefaultTimeout(900000);
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message ?? e).slice(0, 140)));
  page.on('console', (m) => { if (m.type() === 'error' && !/403|font|computeBoundingSphere/i.test(m.text())) errs.push(m.text().slice(0, 140)); });
  const scen = JSON.parse(fs.readFileSync(process.env.SCEN, 'utf8'));
  const out = process.env.OUT;
  const origin = await page.evaluate(() => location.origin);
  console.log(`origin ${origin}  scenarios ${scen.length}`);
  // Warm-up: the first use of a species loads its model (seconds, the toad's the most), and its animals only appear when that is done. Spawn each
  // species once, wait for it, and say how long, so the scenarios below measure behaviour and not loading.
  const used = [...new Set(scen.flatMap((sc) => (sc.spec.animals ?? []).map((a) => a.sp)))];
  for (const sp of used) {
    const w = await page.evaluate(async (sp) => {
      const lab = window.lab, t0 = performance.now();
      const swimmer = lab.SPECIES[sp]?.kind === 'swim';      // (R6a: a fish needs water to be present: a depth-0 arena made the warm-up of cory/loach/guppy time out silently)
      await lab.apply({ v: 1, tank: swimmer ? 'standard' : 'column', ground: 'flat', depth: swimmer ? 18 : 0, obstacles: [], dots: [], rate: 4, animals: [lab.SPECIES[sp]?.kind === 'gecko' ? { sp, x: 0, y: 20, z: -19.9, yaw: 0, wall: true, drive: null } : { sp, x: 0, z: 0, yaw: 0, drive: null }] });
      lab.rate(4); lab.pause(false);
      const A = lab.game.world.animals;      // (read AFTER apply: it rebuilds the world, and the old world's animals are not the ones in the arena)
      while (!A.all.some((a) => a.sp === sp && !a.dead) && performance.now() - t0 < 90000) await new Promise((r) => setTimeout(r, 200));
      return { ok: A.all.some((a) => a.sp === sp && !a.dead), s: (performance.now() - t0) / 1000 };
    }, sp);
    console.log(`warm ${sp}: ${w.ok ? 'present' : 'NOT PRESENT'} after ${w.s.toFixed(1)} s`);
    if (!w.ok) { console.log(`WARM-UP FAIL: ${sp} did not appear (a fish needs water, a species needs to be in this build): scenarios using it do not count`); process.exitCode = 3; }
  }
  for (const sc of scen) {
    if (process.env.SECS) sc.seconds = +process.env.SECS;      // (SECS=12: every scenario 12 real seconds = 48 animal seconds at rate 4)
    const e0 = errs.length;
    const r = await page.evaluate(async (sc) => {
      const lab = window.lab;
      const rate = sc.rate ?? 4;
      await lab.apply({ v: 1, tank: 'column', ground: 'flat', depth: 0, obstacles: [], dots: [], ...sc.spec, rate });
      lab.rate(rate); lab.pause(false);
      const A = lab.game.world.animals;      // (read AFTER apply: it rebuilds the world; read before, this was the old, empty one)
      // (a species' model loads the first time it is used: its animals appear a few seconds after apply returns, so wait for them)
      const want = (sc.spec.animals ?? []).length, w0 = performance.now();
      const have = () => { const need = {}; for (const a of sc.spec.animals ?? []) need[a.sp] = (need[a.sp] ?? 0) + 1; let n = 0; for (const [sp, k] of Object.entries(need)) n += Math.min(k, A.all.filter((a) => a.sp === sp && !a.dead).length); return n; };
      while (have() < want && performance.now() - w0 < 30000) await new Promise((r) => setTimeout(r, 200));
      lab.radar.clear();
      // R6a: every stuck decision and every relocation of a swimmer, by the fish's own intent (hold / creep / go / inside) at that moment. Inline, so it
      // runs on a build without src/sim/stuckintent.js (the "before" number) and does not share the game's predicate.
      const CLS = {}, cls = (a) => { const m = a.fm; if (a.rest?.resting) return 'hold'; if (a.lab?.drive) return a.lab.goal ? 'go' : 'hold'; if (!m) return 'go'; if (a.dart || m.fleeT > 0 || m.I?.escape) return 'go'; if (a.nib || m.resting) return 'hold'; const d = m.goal ? Math.hypot(m.goal.x - a.pos.x, m.goal.z - a.pos.z) : 0; return d > 2.5 ? 'go' : d >= 1 ? 'creep' : 'hold'; };
      const bump = (a, ev, c) => { const o = ((CLS[a.sp] ??= {})[ev] ??= {}); o[c] = (o[c] ?? 0) + 1; };
      const proto = Object.getPrototypeOf(A);
      A.relocate = function (a, sp, ...rest) { if (sp.kind === 'swim') bump(a, 'reloc', rest[1] ? 'inside' : cls(a)); return proto.relocate.call(this, a, sp, ...rest); };
      A.keepFree = function (a, sp, dt) { const pre = sp.kind === 'swim' && a.anchor && (a.stillT ?? 0) + dt >= 3.5 && this.wantsMove(a, sp) ? cls(a) : null, ls = a.lastStuck; const r = proto.keepFree.call(this, a, sp, dt); if (pre && a.lastStuck !== ls) bump(a, 'stuck', pre); return r; };
      const st0 = JSON.parse(JSON.stringify(A.stuckStats ?? {})), diff = (n, o) => { const d = {}; for (const [k, v] of Object.entries(n ?? {})) { const q = o?.[k]; if (typeof v === 'number') { if (v - (q ?? 0)) d[k] = +(v - (q ?? 0)).toFixed(1); } else if (v && typeof v === 'object') { const x = diff(v, q); if (Object.keys(x).length) d[k] = x; } } return d; };
      const W = lab.game.world, all = A.all.filter((a) => !a.dead);
      const ang = (d) => { while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
      const mode = (a) => (a.fear ? 'fear' : a.perch ? 'perch-' + a.perch.ph : a.swimming ? 'swim' : (a.si?.mode ?? a.ci?.mode ?? a.cb?.mode ?? a.hm?.mode ?? a.fs ?? a.state ?? '?'));
      const minD = (sc.watch ?? []).map(() => 99), st = all.map((a) => ({ a, last: null, modes: {}, fast: 0, maxY: 0, margin: 99, wallTime: 0, ys: { turn: 0, walk: 0, hop: 0, crouch: 0, sit: 0 }, yt: 0 }));
      const t0 = performance.now(), t00 = A.t;
      while (performance.now() - t0 < (sc.seconds ?? 20) * 1000) {
        await new Promise((r) => setTimeout(r, 150));
        const t = A.t;
        (sc.watch ?? []).forEach(([i, j], q) => { const A1 = st[i]?.a, B1 = st[j]?.a; if (A1 && B1) minD[q] = Math.min(minD[q], Math.hypot(A1.pos.x - B1.pos.x, A1.pos.z - B1.pos.z)); });
        for (const s of st) {
          const a = s.a, sp = lab.SPECIES[a.sp];
          if (a.dead) continue;
          const onWall = !!(a.onWall || a.wallMode);
          if (s.last && t > s.last.t) {
            const dt = t - s.last.t;
            s.fast = Math.max(s.fast, Math.hypot(a.pos.x - s.last.x, a.pos.y - s.last.y, a.pos.z - s.last.z) / dt);
            if (sc.turn) { const k = a.hop ? 'hop' : a.fs in s.ys ? a.fs : 'sit'; s.ys[k] += Math.abs(ang(a.yaw - s.last.yaw)) * 57.3; }
          }
          s.last = { t, x: a.pos.x, y: a.pos.y, z: a.pos.z, yaw: a.yaw };
          const mo = mode(a); s.modes[mo] = (s.modes[mo] ?? 0) + 1; if (mo !== s.lastMode && (s.tr ??= []).length < 18) s.tr.push(`${(t - t00).toFixed(1)}s ${mo} (${a.pos.x.toFixed(1)},${a.pos.z.toFixed(1)}${a.pos.y > 3.8 ? ' y' + a.pos.y.toFixed(1) : ''})`); s.lastMode = mo;
          s.maxY = Math.max(s.maxY, a.pos.y);
          if (onWall) s.wallTime++;
          else if (sp.kind !== 'swim' && !a.swimming && !a.hop) {
            try {
              const bx = A.bodyBox(a, sp), fx = Math.sin(a.yaw), fz = Math.cos(a.yaw), y = a.pos.y + 0.6, zm = (bx.z0 + bx.z1) / 2;
              for (const [l, w] of [[bx.z1, 0], [bx.z0, 0], [zm, bx.X], [zm, -bx.X]]) { const px = a.pos.x + fx * l + fz * w, pz = a.pos.z + fz * l - fx * w; s.margin = Math.min(s.margin, pz - W.wall.zAt(px, y)); }
            } catch { /* body not measured yet */ }
          }
        }
      }
      const kinds = {}; for (const x of lab.radar.rows()) kinds[x.kind] = (kinds[x.kind] ?? 0) + x.n;
      const animals = st.map((s) => {
        const a = s.a, L = a.lab, D = L?.drive, S = L?.stats;
        const o = { sp: a.sp, modes: s.modes, trace: s.tr ?? [], drive: D?.type ?? 'none', reached: D?.reached ?? null, skipped: D?.skipped ?? 0, laps: D?.laps ?? null, stranded: !!D?.stranded, done: D?.done ?? null, walked: S ? +S.dist.toFixed(0) : null, xte: S?.xteN ? +(S.xteSum / S.xteN).toFixed(1) : null, fastest: +s.fast.toFixed(1), maxY: +s.maxY.toFixed(1), margin: s.margin === 99 ? null : +s.margin.toFixed(2), wall: !!(a.onWall || a.wallMode), crossing: !!a.gx, finite: [a.pos.x, a.pos.y, a.pos.z].every(Number.isFinite), at: [a.pos.x, a.pos.y, a.pos.z].map((v) => +v.toFixed(1)) };
        if (sc.turn) { const tot = Object.values(s.ys).reduce((p, v) => p + v, 0) || 1; o.yawShare = Object.fromEntries(Object.entries(s.ys).map(([k, v]) => [k, +(v / tot).toFixed(2)])); o.yawDeg = +tot.toFixed(0); }
        return o;
      });
      const samples = st.map((s) => Object.values(s.modes).reduce((p, v) => p + v, 0));
      delete A.relocate; delete A.keepFree;
      return { cls: CLS, animals, want, minD, radar: kinds, stuck: diff(A.stuckStats, st0), samples, planner: typeof A.labGrid === 'function' ? 'yes' : 'no', clock: +A.t.toFixed(0) };
    }, sc);
    const row = { name: sc.name, minD: r.minD, origin, planner: r.planner, spawned: r.animals.length, expected: r.want, animalSeconds: r.clock, radar: r.radar, stuck: r.stuck, cls: r.cls, samples: r.samples, errors: errs.slice(e0), animals: r.animals };
    if (out) fs.appendFileSync(out, JSON.stringify(row) + '\n');
    const an = r.animals;
    const sum = (k) => an.reduce((p, a) => p + (a[k] ?? 0), 0);
    if (r.minD?.length || an0(r)) console.log(`   ${r.minD?.length ? 'closest ' + r.minD.map((v) => v.toFixed(1)).join('/') + ' cm; ' : ''}modes: ${r.animals.map((a) => a.sp + ' ' + Object.entries(a.modes).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k, v]) => k + ':' + v).join(',')).join(' | ')}`);
    if (sc.trace) r.animals.forEach((a, i) => { if (sc.trace.includes(i)) console.log(`   trace ${a.sp}#${i}: ${a.trace.join(' > ')}`); });
    console.log(`${sc.name.padEnd(34)} planner=${r.planner} n=${an.length}${an.length !== r.want ? ' SPAWN ' + an.length + '/' + r.want + ' (refused: a spot inside a piece, or a species that is not in this build)' : ''} reached=${an.map((a) => a.reached ?? '-').join('/')} skipped=${sum('skipped')} walked=${an.map((a) => a.walked ?? '-').join('/')} fastest=${Math.max(...an.map((a) => a.fastest))}cm/s maxY=${Math.max(...an.map((a) => a.maxY))} minRelief=${Math.min(...an.map((a) => a.margin ?? 99))} radar=${JSON.stringify(r.radar)} stuck=${JSON.stringify(r.stuck)} cls=${JSON.stringify(r.cls)} samples/animal=${Math.min(...r.samples)}-${Math.max(...r.samples)}${row.errors.length ? ' ERR ' + row.errors[0] : ''}${an.some((a) => !a.finite) ? ' NONFINITE' : ''}`);
  }
};
