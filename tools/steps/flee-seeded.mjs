// Controlled flight test: N animals of one species (SP=newt|skink|crab, default newt) placed on land in the stuck test's cluttered tanks
// (10 scenes), each given the SAME injected threat (DIST cm away, default 2.5, a random side, for 4 s), then SECS s (default 12) watched.
// A fright that did not start in its refuge: did it flee, reach the refuge (newt: water >= 0.3 cm deep or swimming; skink: skinkNiche;
// crab: crabNiche), how soon, how far it moved, frozen (< 1.5 cm). The threat goes in through herpThreat and threatPlus (both builds have them),
// so the same harness measures live and new. Prints FLEE {...} per scene.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.game, null, { timeout: 60000 });
  page.setDefaultTimeout(900000);
  const res = await page.evaluate(async ([SP, DIST, SECS, SEED, NOFIELD, FIN]) => {
    const { seedRng } = await import('/src/util/rng.js');
    const game = window.game, frame0 = game.frame; game.frame = () => {};
    const gen = await import('/src/sim/generator.js');
    const { TANK } = await import('/src/sim/tank.js');
    const { SPECIES } = await import('/src/sim/animals.js');
    const out = [];
    const scenes = [['blackwater', 'standard', 11], ['swamp', 'nano', 3], ['suriname', 'standard', 5], ['blackwater', 'standard', 23], ['swamp', 'nano', 7],
      ['suriname', 'standard', 13], ['blackwater', 'standard', 31], ['swamp', 'nano', 17], ['suriname', 'standard', 29], ['swamp', 'nano', 41]];
    for (const [preset, tier, seed] of scenes) {
      const w = await window.game.loadTank(tier, { layout: 'empty' });
      game.frozen = true; seedRng(SEED + seed, true);
      gen.generateTerrarium(w, { preset, seed, tier });
      let s = seed * 7919 + 13; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
      const T = w.terrain;
      for (const [type, n] of [['roots', 10], ['wood', 8], ['boulder', 5], ['stump', 2], ['spire', 2]]) for (let i = 0; i < n; i++) { const x = (rnd() - 0.5) * (TANK.w - 14), z = (rnd() - 0.5) * (TANK.d - 14); const opt = { rot: rnd() * 6.28 }; if ((type === 'roots' || type === 'wood') && rnd() < 0.4) opt.y = Math.max(T.heightAt(x, z), w.water.level - 2) + 1 + rnd() * 8; w.decor.addPiece(type, x, z, opt); }
      game.worldRoot?.updateMatrixWorld?.(true);
      const A = w.animals; A.avoid = true; A.syncOccupancy(true); if (NOFIELD) A.noField = true; if (FIN != null) A.fieldIn = FIN;
      for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a);
      const depth = (x, z) => w.water.surfaceAt(x, z) - T.heightAt(x, z);
      const sp = SPECIES[SP];
      const refuge = (a) => SP === 'newt' ? !!a.swimming || depth(a.pos.x, a.pos.z) >= 0.3 : SP === 'skink' ? A.skinkNiche(a.pos.x, a.pos.z) > 0 : A.crabNiche(a.pos.x, a.pos.z, sp.crabProfile ?? { safeDepth: 2 }) > 0;
      for (let i = 0; i < 8; i++) for (let k = 0; k < 80; k++) { const x = (rnd() - 0.5) * (TANK.w - 8), z = (rnd() - 0.5) * (TANK.d - 8); if (depth(x, z) > 0) continue; const r = A.placement(SP, { point: { x, y: 0, z }, surface: 'ground' }); if (r.pos) { A.add(SP, r.pos); break; } }
      A.draw(); for (let k = 0; k < 300 && (A.modelsLoading ?? 0) > 0; k++) await new Promise((r) => setTimeout(r, 50)); A.draw(); game.worldRoot?.updateMatrixWorld?.(true);
      const tf0 = performance.now(); if (!NOFIELD && A.by[SP]?.[0] && A.refugeField) A.refugeField(A.by[SP][0], sp); const fieldMs = +(performance.now() - tf0).toFixed(1);
      A.move(0.2);
      const L = (A.by[SP] ?? []).filter((a) => !a.swimming && !refuge(a));
      const thr = new Map(); for (const a of L) { const ang = rnd() * 6.28; thr.set(a, { x: a.pos.x + Math.sin(ang) * DIST, z: a.pos.z + Math.cos(ang) * DIST }); }
      const T0 = A.t, inj = (a) => { const t = thr.get(a); return t && A.t < T0 + 4 ? { x: t.x, z: t.z, d: Math.hypot(t.x - a.pos.x, t.z - a.pos.z) } : null; };
      const ht0 = A.herpThreat.bind(A), tp0 = A.threatPlus.bind(A);
      A.herpThreat = function (a, ...r) { return inj(a) ?? ht0(a, ...r); };
      A.threatPlus = function (a, ...r) { return inj(a) ?? tp0(a, ...r); };
      const FLEE = new Set(['flee', 'retreat', 'freeze', 'dead']);
      const mode = (a) => (a.hm ?? a.sk ?? a.cb)?.mode;
      const st = new Map(L.map((a) => [a, { x0: a.pos.x, z0: a.pos.z, fled: false, reached: null, max: 0 }]));
      for (let j = 0; j < SECS * 5; j++) {
        A.move(0.2);
        for (const a of L) { const I = st.get(a); if (FLEE.has(mode(a))) I.fled = true; I.max = Math.max(I.max, Math.hypot(a.pos.x - I.x0, a.pos.z - I.z0)); if (I.reached == null && refuge(a)) I.reached = +(j * 0.2).toFixed(1); }
      }
      A.herpThreat = ht0; A.threatPlus = tp0;
      out.push({ preset, seed, fieldMs, eps: L.map((a) => { const I = st.get(a); return { fled: I.fled, reached: I.reached, max: +I.max.toFixed(1) }; }) });
    }
    game.frame = frame0; game.frozen = false;
    return out;
  }, [process.env.SP ?? 'newt', +(process.env.DIST ?? 2.5), +(process.env.SECS ?? 12), +(process.env.SEED ?? 900), process.env.FIELD === '0', process.env.FIN != null ? +process.env.FIN : null]);
  for (const r of res) console.log('FLEE ' + JSON.stringify(r));
};
