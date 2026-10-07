// The test lab's Climb drive (src/lab/driver.js climb / climbObject, sim/animals.js labClimb): a red-eyed tree frog sent up each glass pane and up an object of the arena (a log), the phase
// it reaches and how each ended. Desktop only. Needs the dev server:
//   node tools/shot.mjs --only=desktop --url=http://localhost:4660/lab.html --steps=tools/steps/lab-climb.mjs --out=test-output/lab
//   LAB_SECONDS=40 (real seconds a climb may take, at 4x animal time)   LAB_ONLY=front,right,object
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.lab?.L.ready.value, null, { timeout: 90000 });
  page.setDefaultTimeout(600000);
  const seconds = +(process.env.LAB_SECONDS ?? 40), only = process.env.LAB_ONLY ? process.env.LAB_ONLY.split(',') : null;
  const poll = () => page.evaluate(() => { const a = window.lab.L.sel.value, D = a?.lab?.drive; return D ? { type: D.type, phase: D.phase ?? null, done: D.done, failed: D.failed ?? null, sat: D.sat ?? 0, t: D.t ?? 0, x: +a.pos.x.toFixed(1), y: +a.pos.y.toFixed(1), z: +a.pos.z.toFixed(1), crawl: !!a.climbOn, set: a.climb?.set ?? null } : null; });
  const run = async (label, start, arg) => {
    if (only && !only.includes(label)) return null;
    const ok = await page.evaluate(start, arg);
    if (ok === false) return { label, error: 'could not start' };
    const seen = new Set(); let last = null;
    for (let i = 0; i < seconds * 2; i++) {
      await page.waitForTimeout(500);
      last = await poll();
      if (last?.phase) seen.add(last.phase);
      if (last?.done) break;
    }
    return { label, phases: [...seen].join(' > '), done: last?.done, failed: last?.failed, sat: +(last?.sat ?? 0).toFixed(1), t: +(last?.t ?? 0).toFixed(1), at: last && `${last.x}, ${last.y}, ${last.z}`, crawl: last?.crawl, keys: last?.set };
  };
  const results = [];
  const startPane = (pane) => { const lab = window.lab; lab.clearAll(); lab.ground('flat'); lab.depth(0); lab.rate(4); lab.pause(false); lab.add('redeye', 1, pane === 'front' ? -10 : pane === 'left' ? -20 : 20, pane === 'front' ? 6 : 0); return lab.driver.climb(pane); };
  for (const pane of ['front', 'left', 'right']) results.push(await run(pane, startPane, pane));
  // every kind of object a frog climbs (sim/animals.js PERCH_PIECES), one at a time on flat ground, the frog 8 cm from its side
  const startObject = async (kind) => {
    const lab = window.lab; lab.clearAll(); lab.ground('flat'); lab.depth(0); lab.rate(4); lab.pause(false);
    let it = null; for (let k = 0; k < 40 && !it; k++) { it = lab.obstacles.add({ kind, size: lab.L.obSize.value, rot: 0 }, 14, 4); if (!it) await new Promise((r) => setTimeout(r, 500)); }
    if (!it) return false;
    lab.add('redeye', 1, -6, 4);
    return lab.driver.climbObject(it.id);
  };
  for (const kind of (process.env.LAB_PIECES ?? 'wood,roots,stump,cork,bamboopole').split(',')) results.push(await run('object-' + kind, startObject, kind));
  for (const r of results.filter(Boolean)) console.log(JSON.stringify(r));
  const good = results.filter((r) => r && !r.error && (r.phases ?? '').includes('up'));
  console.log(good.length ? `PASS ${good.length} climb(s) got up: ${good.map((r) => r.label).join(', ')}` : 'FAIL no climb got off the ground');
  if (!good.length) throw new Error('lab-climb: no climb got off the ground');
};
