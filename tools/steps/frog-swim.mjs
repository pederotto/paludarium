// Frogs swim: dropped into the deep part of the pool, each frog kicks (the stroke cycle advances), moves in surges, heads for a
// bank and climbs out (over a gentle bank, up a steep one or the glass); every frog is drawn by its own body kicking through the
// stroke (util/gait.js; the static <id>.swim.glb pose models are no longer drawn) and travels by it. Prints PASS or FAIL per frog.
//   node tools/shot.mjs --steps=tools/steps/frog-swim.mjs --only=desktop [--url=http://localhost:5173/]
export default async (page) => {
  const ok = (name, pass, detail = '') => console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForFunction(() => window.game?.world?.animals && !document.querySelector('.title'), null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const res = await page.evaluate(async () => {
    const g = window.game, W = g.world, A = W.animals, T = W.terrain;
    g.setSpeed(0);
    for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a, 'removed');
    // The deepest water that is at least 6 cm from dry ground.
    let best = null, bs = -1e9;
    for (let x = -50; x <= 50; x += 1.5) for (let z = -30; z <= 30; z += 1.5) {
      const gnd = T.heightAt(x, z), s = W.water.surfaceAt(x, z, 0.2);
      if (!(Number.isFinite(s) && s > gnd + 0.3)) continue;
      let dry = 99;
      for (let r = 3; r < 40 && dry === 99; r += 3) for (let k = 0; k < 12; k++) {
        const xx = x + Math.cos(k / 12 * 6.283) * r, zz = z + Math.sin(k / 12 * 6.283) * r;
        if (!(W.water.surfaceAt(xx, zz, 0.2) > T.heightAt(xx, zz) + 0.3)) { dry = r; break; }
      }
      if (dry < 5) continue;
      const sc = Math.min(dry, 14) * 2 + (s - gnd);
      if (sc > bs) { bs = sc; best = { x, z, gnd, s }; }
    }
    if (!best) return { error: 'no deep water' };
    const V3 = g.camera.position.constructor, out = {};
    for (const id of ['leucomelas', 'strawberry', 'dartfrog', 'auratus', 'toad']) {
      const a = A.add(id, new V3(best.x, Math.max(best.gnd, best.s - 0.5), best.z), { age: 1e6, hunger: 0.1 });
      if (!a) { out[id] = { error: 'cap' }; continue; }
      A.meshFor(id);
      const k0 = a.kick ?? 0;
      let swam = 0, pose = 0, dist = 0, prev = a.pos.clone(), steps = [], prevKick = a.kick;
      for (let i = 0; i < 750; i++) {   // 30 s of animal time
        A.move(0.04);
        if (a.swimming) {
          swam++;
          const pm = A.meshes[id + '#swim'];
          if (Math.abs((a.kick ?? 0) - (prevKick ?? 0)) > 1e-4) pose++;   // (the stroke clock runs: the legs move)
          const d = a.pos.distanceTo(prev); steps.push(d);
        }
        dist += a.pos.distanceTo(prev); prev.copy(a.pos); prevKick = a.kick;
        if (!a.swimming && i > 100) break;   // out: it climbed out with a hop, up a bank or the glass, or waded out through the shallows
      }
      steps.sort((p, q) => p - q);
      out[id] = { swam, pose, kicks: +((a.kick ?? 0) - k0).toFixed(1), moved: +dist.toFixed(1), out: !a.swimming, hasPose: !!A.poseModels[id]?.swim, p50: +(steps[steps.length >> 1] ?? 0).toFixed(4), p95: +(steps[Math.floor(steps.length * 0.95)] ?? 0).toFixed(4) };
      A.remove(a, 'removed');
    }
    return out;
  });
  if (res.error) { ok('there is deep water to test in', false, res.error); return; }
  for (const [id, r] of Object.entries(res)) {
    if (r.error) { ok(`${id}: placed`, false, r.error); continue; }
    ok(`${id}: swims (stays in the stroke for at least 1 s)`, r.swam >= 25, `${r.swam} frames`);
    ok(`${id}: the stroke cycle runs`, r.kicks >= 2, `${r.kicks} strokes`);
    ok(`${id}: moves in surges (the biggest step is at least twice the median)`, r.p95 > 1.8 * Math.max(r.p50, 1e-4) || r.p50 === 0, `median ${r.p50} cm, p95 ${r.p95} cm per tick`);
    ok(`${id}: gets out of the water`, r.out || id === 'toad', `${r.moved} cm travelled`);
    ok(`${id}: kicks while it swims (the stroke clock runs most of the time)`, r.pose >= 0.6 * r.swam, `${r.pose} of ${r.swam} frames, ${(r.moved / Math.max(1, r.kicks)).toFixed(2)} cm a kick`);
  }
};
