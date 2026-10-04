// Footing probe: where does Animals.footing() put a body's FEET? For each species, a body is stood at every dry point of a 1.5 cm grid
// over a generated tank, facing 8 ways, drawn as draw() does it (onto the footing plane, lifted by its dy), and the gap between each of
// its four feet (the lowest point of each leg of the mesh) and the ground under it is measured along the ground normal.
//
//   node tools/shot.mjs --only=desktop --steps=tools/steps/footing.mjs --wait=2500 --url=http://127.0.0.1:5173/
//   FOOT_PRESETS=suriname,karst FOOT_SPECIES=gecko,newt,marbled,dartfrog   (the defaults; seed 5, standard tank)
//
// Per preset and species: poses measured, `lifted` the share with every foot more than 0.6 cm off the ground (standing in the air), the
// worst such lift (cm), `sunk` the share with a foot more than 0.6 cm into it.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.game, null, { timeout: 60000 });
  page.setDefaultTimeout(600000);
  const species = (process.env.FOOT_SPECIES ?? 'gecko,newt,marbled,dartfrog').split(',');
  for (const preset of (process.env.FOOT_PRESETS ?? 'suriname,karst').split(',')) {
    const r = await page.evaluate(async ({ preset, species }) => {
      const gen = await import('/src/sim/generator.js');
      const { TANK } = await import('/src/sim/tank.js');
      const { SPECIES } = await import('/src/sim/animals.js');
      const g = window.game, w = await g.loadTank('standard', { layout: 'empty' });
      gen.generateTerrarium(w, { preset, seed: 5, tier: 'standard' });
      const A = w.animals, T = w.terrain, V3 = g.camera.position.constructor, Q = A._q.constructor;
      for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a);
      const out = {};
      for (const id of species) {
        const a = A.add(id, new V3(0, T.heightAt(0, 0), 0));
        for (let i = 0; i < 50 && !A.bodyOf(id); i++) { A.move(0.0001); await new Promise((res) => setTimeout(res, 200)); }
        const m = A.meshes[id], geo = (m?._lo ?? m)?.geometry, P = geo?.attributes?.position?.array, R = geo?.attributes?.rig?.array;
        if (!P || !R || !a) { out[id] = null; continue; }
        const low = new Map();
        for (let i = 0; i < P.length / 3; i++) { const k = R[i * 4 + 1]; if (k <= 0.5) continue; const j = low.get(k); if (j == null || P[i * 3 + 1] < P[j * 3 + 1]) low.set(k, i); }
        const feet = [...low.values()].map((i) => new V3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
        const sp = SPECIES[id], UP = new V3(0, 1, 0), q = new Q(), tq = new Q(), wp = new V3();
        const sc = A.bodyBox(a, sp).H / A.bodyOf(id).hh;                      // (the drawn scale)
        const nY = (x, z) => { const [gx, gz] = T.field.gradient(x, z); return 1 / Math.hypot(gx, 1, gz); };
        let n = 0, lifted = 0, sunk = 0, worst = 0;
        for (let x = -TANK.w / 2 + 4; x <= TANK.w / 2 - 4; x += 1.5) for (let z = -TANK.d / 2 + 4; z <= TANK.d / 2 - 4; z += 1.5) {
          if (w.water.surfaceAt(x, z, 0.3) !== -Infinity) continue;
          for (let k = 0; k < 8; k++) {
            a.pos.set(x, T.heightAt(x, z), z); a.yaw = k * Math.PI / 4; a.normal = T.normalAt(x, z);
            const ft = A.footing(a, sp);
            if (!ft) continue;
            q.setFromUnitVectors(UP, ft.up).multiply(tq.setFromAxisAngle(UP, a.yaw));
            let lo = 1e9, hi = -1e9;
            for (const f of feet) { wp.copy(f).multiplyScalar(sc).applyQuaternion(q).add(a.pos); wp.y += ft.dy; const gap = (wp.y - T.heightAt(wp.x, wp.z)) * nY(wp.x, wp.z); lo = Math.min(lo, gap); hi = Math.max(hi, gap); }
            n++;
            if (lo > 0.6) { lifted++; worst = Math.max(worst, lo); }
            if (lo < -0.6) sunk++;
          }
        }
        out[id] = { poses: n, liftedPct: +(lifted / n * 100).toFixed(2), worstLiftCm: +worst.toFixed(2), sunkPct: +(sunk / n * 100).toFixed(2) };
        A.remove(a);
      }
      return { preset, ...out };
    }, { preset, species });
    console.log('FOOTING', JSON.stringify(r));
  }
};
