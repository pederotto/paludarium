// A red-eyed tree frog in the Lab, climbing a glass pane or a log (drawn on its walking/climbing body, `redeye.swim`), paused once it is on the climb and seen from close by
// from 8 directions round its head: the game's own renderer, lights and post, for judging the eye as a player sees it (11 Oct 2026).
//   node tools/shot.mjs --only=desktop --url=http://localhost:5173/lab.html --steps=tools/steps/lab-eye.mjs --out=test-output/lab-eye [--query=?webgl]
//   EYE_ON=left|right|front|wood (where it climbs)   LAB_SECONDS=30 (the longest wait for it to be on the climb)   EYE_DIST=7 (cm from the head)
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.lab?.L.ready.value, null, { timeout: 240000 });   // (a first dev-server build of the Lab on a loaded Mac takes minutes)
  await page.addStyleTag({ content: '#ui,.lab-panel,aside,header{display:none!important}' });
  const target = process.env.EYE_ON ?? 'left';   // a glass pane (left, right, front) or 'wood'
  const started = await page.evaluate(async (target) => {
    const lab = window.lab; lab.clearAll(); lab.ground('flat'); lab.depth(0); lab.rate(2); lab.pause(false);
    if (target !== 'wood') { lab.add('redeye', 1, target === 'front' ? -10 : target === 'left' ? -20 : 20, target === 'front' ? 6 : 0); return lab.driver.climb(target); }
    let it = null; for (let k = 0; k < 40 && !it; k++) { it = lab.obstacles.add({ kind: 'wood', size: lab.L.obSize.value, rot: 0 }, 14, 4); if (!it) await new Promise((r) => setTimeout(r, 500)); }
    if (!it) return 'no log';
    lab.add('redeye', 1, -6, 4);
    return lab.driver.climbObject(it.id);
  }, target);
  console.log('climb started:', started);
  // paused the moment the frog is on the climb (drawn on its climbing body), a little way up, or after LAB_SECONDS
  for (let i = 0, n = +(process.env.LAB_SECONDS ?? 30) * 4; i < n; i++) {
    const on = await page.evaluate(() => { const a = window.lab.animals()[0]; return !!(a?.climbOn && a.climb && (a.lab?.drive?.phase === 'up' || (a.lab?.drive?.t ?? 0) > 3)); });
    if (on) break;
    await page.waitForTimeout(250);
  }
  const info = await page.evaluate(() => { window.lab.pause(true); const a = window.lab.animals()[0]; const D = a?.lab?.drive; return a && { phase: D?.phase, climb: !!a.climb, climbOn: !!a.climbOn, pos: [a.pos.x, a.pos.y, a.pos.z].map((v) => +v.toFixed(2)), yaw: +(a.yaw ?? 0).toFixed(2) }; });
  console.log('frog:', JSON.stringify(info));
  const d = +(process.env.EYE_DIST ?? 7);
  for (let k = 0; k < 8; k++) {
    await page.evaluate(({ k, d }) => {
      const a = window.lab.animals()[0], g = window.game, ang = (a.yaw ?? 0) + (k / 8) * Math.PI * 2;
      // the head is ahead of the origin along the heading; look at a point a little forward and up
      const up = a.climbOn ? 1 : 0, f = up ? 0 : 1.5;   // (on a pane the head is above the origin; on the ground ahead of it)
      const hx = a.pos.x + Math.sin(a.yaw ?? 0) * f, hz = a.pos.z + Math.cos(a.yaw ?? 0) * f, hy = a.pos.y + 1.5 + up * 1.5;
      g.rig.controls.setLookAt(hx + Math.sin(ang) * d, hy + d * 0.45, hz + Math.cos(ang) * d, hx, hy, hz, false);
    }, { k, d });
    await page.waitForTimeout(700);
    await shot(`eye-${k}`);
  }
};
