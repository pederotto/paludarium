// Eating test: a hunter stalks and strikes a prey animal, with the simulation stepped by hand (so the 150 ms
// strike can be photographed frame by frame). Screenshots land in test-output/eat-<species>-NN-<phase>.
//   EAT=dartfrog|toad|firesal|newt|axolotl|gecko  PREY=fly|springtail|isopod|shrimp  node tools/shot.mjs --only=desktop --steps=tools/steps/eating.mjs --wait=2500
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.game, null, { timeout: 60000 });
  page.setDefaultTimeout(300000);
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  const hunter = process.env.EAT ?? 'dartfrog', preyId = process.env.PREY ?? (hunter === 'axolotl' ? 'shrimp' : 'fly');
  const setup = await page.evaluate(async ({ hunter, preyId }) => {
    const gen = await import('/src/sim/generator.js');
    const { TANK } = await import('/src/sim/tank.js');
    const game = window.game;
    const w = await game.loadTank('standard', { layout: 'empty' });
    gen.generateTerrarium(w, { preset: 'suriname', seed: 5, tier: 'standard' });
    const A = w.animals;
    for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a);
    game.setSpeed(0);
    game.rig.stopOrbit(); game.rig.moved = true;
    // A flat dry spot (or water for aquatic hunters) near the front.
    let spot = null;
    for (let k = 0; k < 4000 && !spot; k++) {
      const x = (Math.random() - 0.5) * (TANK.w - 24), z = (Math.random() - 0.1) * (TANK.d / 2 - 6);
      const g = w.terrain.heightAt(x, z), s = w.water.surfaceAt(x, z);
      const aquatic = hunter === 'axolotl';
      const ok = aquatic ? s - g > 6 : (s === -Infinity && w.terrain.normalAt(x, z).y > 0.97 && w.terrain.normalAt(x + 6, z).y > 0.95);
      if (ok && !(A.occ.count && A.occ.solidAt(x, g + 1, z))) spot = { x, z, g };
    }
    if (!spot) return { error: 'no spot' };
    const V3 = game.camera.position.constructor;
    const h = A.add(hunter, new V3(spot.x, spot.g, spot.z));
    return { spot, ok: !!h };
  }, { hunter, preyId });
  console.log('setup', JSON.stringify(setup));
  if (setup.error) return;
  const phases = [];
  await page.evaluate(async ({ hunter, preyId }) => {
    const game = window.game, w = game.world, A = w.animals;
    const V3 = game.camera.position.constructor;
    const h = A.by[hunter][0];
    h.hunger = 0.7; h.yaw = 0.3;
    // Prey 7 cm away (a frog must stalk to it), on the ground (flies: resting).
    const px = h.pos.x + Math.sin(0.9) * 7, pz = h.pos.z + Math.cos(0.9) * 7;
    const pg = hunter === 'axolotl' ? h.pos.y : w.terrain.heightAt(px, pz);
    const p = A.add(preyId, new V3(px, preyId === 'fly' ? pg + 0.6 : pg, pz));
    if (preyId === 'fly') { p.state = 'rest'; p.timer = 1e6; }
    p.pinned = true;
    window.__t = { h, p };
    // Keep prey still: crawlers get their timers frozen.
    p.timer = 1e6; p.state = preyId === 'fly' ? 'rest' : 'rest';
    window.__cam = () => {
      const g = window.game, { h, p } = window.__t, d = +(window.__dist ?? 11);
      const mx = (h.pos.x + p.pos.x) / 2, my = (h.pos.y + p.pos.y) / 2, mz = (h.pos.z + p.pos.z) / 2;
      let dx = p.pos.x - h.pos.x, dz = p.pos.z - h.pos.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const s = dz > 0 ? -1 : 1;
      g.controls.setLookAt(mx + dz * s * d, my + d * 0.4, mz - dx * s * d, mx, my + 0.8, mz, false);
    };
    h.fs = 'sit'; h.fsT = 0.2;
    window.__ok = A.order(h, preyId);
  }, { hunter, preyId });
  console.log('ordered', await page.evaluate(() => window.__ok));
  let n = 0, last = '', seenOut = false, strikeDone = false;
  for (let step = 0; step < 1400 && !strikeDone; step++) {
    const info = await page.evaluate(() => {
      const { h, p } = window.__t, A = window.game.world.animals;
      const st = h.st;
      // Fine steps while a strike is in progress, coarse otherwise.
      A.move(st ? (st.ph === 'out' ? 0.03 : st.ph === 'back' ? 0.03 : 0.1) : 0.15);
      window.__cam();
      return { ph: st ? st.ph : (h.fs ?? h.state), t: st ? +st.t.toFixed(2) : 0, got: st?.got, prey: !p.dead, dist: +Math.hypot(h.pos.x - p.pos.x, h.pos.z - p.pos.z).toFixed(1), order: !!h.order, hunger: +h.hunger.toFixed(2) };
    });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const key = info.ph;
    const take = (key !== last && key !== 'sit') || (['walk'].includes(key) && step % 14 === 0) || ((key === 'out' || key === 'back') && step % 2 === 0);
    if (take && n < 22) { await shot(`eat-${hunter}-${String(n++).padStart(2, '0')}-${key}`); }
    last = key;
    if (!info.prey && !info.order && key !== 'gulp') strikeDone = true;
    if (step % 100 === 0) console.log(JSON.stringify(info));
    phases.push(key);
  }
  console.log('phases', [...new Set(phases)].join(','), 'hunter hunger now', await page.evaluate(() => +window.__t.h.hunger.toFixed(2)));
  await page.evaluate(() => { for (let i = 0; i < 20; i++) window.game.world.animals.move(0.05); });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await shot(`eat-${hunter}-final`);
};
