// Grounding probe: how far each animal sits from the ground you SEE, and what overlaps what.
//
//   node tools/steps/grounding.mjs [--url=http://127.0.0.1:4400/] [--out=test-output/grounding] [--run=20] [--shots=6] [--tag=before]
//
// Opens the starter tank, lets it run, then for every land animal casts a ray straight down through the drawn scene (terrain,
// hardscape, everything but creatures, plants, water and litter) and compares the first hit with the animal's height: the
// gap is what reads as "floating" (positive) or "sunk" (negative). Also counts animal pairs whose bodies overlap and animals
// standing inside a plant's stem, and takes close-ups of a few animals through the game's own Zoom in.
import { chromium } from 'playwright';
import fs from 'node:fs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://127.0.0.1:4400/');
const out = arg('out', 'test-output/grounding');
const run = +arg('run', 20), nShots = +arg('shots', 6), tag = arg('tag', 'before');
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
});
const page = await (await browser.newContext({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message ?? e).slice(0, 300)));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 }).catch(() => {});
await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
await page.waitForFunction(() => window.game?.world?.animals?.all?.length && !document.querySelector('#title, .title'), null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(run * 1000);

// Shared helpers in the page: the drawn ground, and whether something solid hides a point from the camera.
await page.evaluate(() => {
  const g = window.game, rc = window.__tools.ray;
  const solid = () => { const m = []; g.scene.traverse((o) => { if (o.isMesh && o.visible && /^(terrain|wall|piece)$/.test(o.name)) m.push(o); }); return m; };
  window.__probe = {
    solid,
    // The drawn ground below a point: cast down from just above it.
    groundBelow(p, above = 2) {
      const o = p.clone(); o.y += above;
      rc.set(o, o.clone().set(0, -1, 0)); rc.far = 40; rc.near = 0;
      const h = rc.intersectObjects(solid(), true)[0];
      return h ? { y: h.point.y, what: h.object.name } : null;
    },
    // How much of the camera-to-target line is behind a solid surface.
    blocked(cam, target) {
      const t = target.clone(); t.y += 0.6;          // the animal's back, not the ground it stands on
      const dir = t.sub(cam), len = dir.length(); dir.normalize();
      rc.set(cam.clone(), dir); rc.near = 0; rc.far = len - 1;
      const h = rc.intersectObjects(solid(), true)[0];
      return h ? { what: h.object.name, at: +h.distance.toFixed(1), len: +len.toFixed(1) } : null;
    },
  };
});

const report = await page.evaluate(() => {
  const g = window.game, W = g.world, A = W.animals, P = window.__probe;
  const SP = A.constructor.SPECIES ?? null; void SP;
  const rows = [];
  for (const a of A.all) {
    if (a.dead || a.swimming || a.wallMode || a.perch || a.hop) continue;
    const kind = a.kindNow ?? '';
    const gb = P.groundBelow(a.pos);
    if (!gb) continue;
    rows.push({ sp: a.sp, gap: +(a.pos.y - gb.y).toFixed(2), on: gb.what, kind, field: +(a.pos.y - W.terrain.heightAt(a.pos.x, a.pos.z)).toFixed(2) });
  }
  // Animal pairs whose bodies overlap by more than a quarter (land and water; long bodies as capsules, see Animals.axes).
  let pairs = 0; const pairEx = [];
  const live = A.all.filter((a) => !a.dead && (a.grp === 'land' || a.grp === 'water') && a.rad > 0.5);
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a = live[i], b = live[j];
    if (a.grp !== b.grp || Math.abs(a.pos.y - b.pos.y) > 1.5) continue;
    const c = A.axes ? A.axes(a, b) : [a.pos.x, a.pos.z, b.pos.x, b.pos.z];
    const d = Math.hypot(c[0] - c[2], c[1] - c[3]);
    if (d < (a.rad + b.rad) * 0.75) { pairs++; if (pairEx.length < 8) pairEx.push(`${a.sp}/${b.sp} ${d.toFixed(1)}<${(a.rad + b.rad).toFixed(1)}`); }
  }
  // Animals standing in a plant's stem.
  let inStem = 0; const stemEx = [];
  for (const a of live) {
    if (a.grp !== 'land' || a.rad < 0.8 || a.perch) continue;      // frogs, toads, salamanders, geckos, skinks, crabs
    for (const q of W.plants.list) {
      if (q.surface === 'wall') continue;
      const d = Math.hypot(q.pos.x - a.pos.x, q.pos.z - a.pos.z);
      if (d < Math.max(0.5, q.reach * 0.12) && Math.abs(q.pos.y - a.pos.y) < 3) { inStem++; if (stemEx.length < 6) stemEx.push(`${a.sp} in ${q.id} ${d.toFixed(1)}`); }
    }
  }
  // Plants whose stems stand inside another plant's canopy core.
  let plantOver = 0; const plantEx = [];
  const pl = W.plants.list.filter((p) => p.surface !== 'wall' && p.surface !== 'water');
  for (let i = 0; i < pl.length; i++) for (let j = i + 1; j < pl.length; j++) {
    const p = pl[i], q = pl[j];
    const d = Math.hypot(p.pos.x - q.pos.x, p.pos.z - q.pos.z);
    if (d < 0.35 * (p.reach + q.reach)) { plantOver++; if (plantEx.length < 10) plantEx.push(`${p.id}/${q.id} d=${d.toFixed(1)} reach ${p.reach.toFixed(1)}+${q.reach.toFixed(1)}`); }
  }
  return { rows, pairs, pairEx, inStem, stemEx, plantOver, plantEx, nPlants: pl.length, nAnimals: A.all.length };
});
const gaps = report.rows.map((r) => r.gap).sort((a, b) => a - b);
const pct = (p) => gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))];
console.log(`land animals ${report.rows.length}: gap above drawn ground p10 ${pct(0.1)} p50 ${pct(0.5)} p90 ${pct(0.9)} max ${gaps.at(-1)}; > 0.3 cm: ${gaps.filter((x) => x > 0.3).length}; < -0.3 cm: ${gaps.filter((x) => x < -0.3).length}`);
const bySp = {};
for (const r of report.rows) (bySp[r.sp] ??= []).push(r.gap);
for (const [k, v] of Object.entries(bySp)) console.log(`  ${k.padEnd(12)} n=${v.length} gaps ${v.slice(0, 12).join(' ')}`);
console.log('on:', Object.entries(report.rows.reduce((m, r) => (m[r.on] = (m[r.on] ?? 0) + 1, m), {})).map((e) => e.join('=')).join(' '));
console.log(`animals overlapping: ${report.pairs}  ${report.pairEx.join(', ')}`);
console.log(`animals in a plant stem: ${report.inStem}  ${report.stemEx.join(', ')}`);
console.log(`plants inside another plant (${report.nPlants} plants): ${report.plantOver}  ${report.plantEx.join('; ')}`);
fs.writeFileSync(`${out}/report-${tag}.json`, JSON.stringify(report, null, 1));

// Close-ups through the game's own Zoom in, and whether the view of the animal is blocked.
await page.addStyleTag({ content: '#ui{display:none!important}' });
const picks = await page.evaluate((n) => {
  const A = window.game.world.animals;
  const want = ['leucomelas', 'dartfrog', 'auratus', 'toad', 'firesal', 'newt', 'gecko', 'isopod', 'springtail', 'crab', 'skink'];
  const out = [];
  for (const id of want) { const a = (A.by[id] ?? []).find((x) => !x.dead && !x.swimming); if (a) out.push(a.id); if (out.length >= n) break; }
  return out;
}, nShots);
let blockedN = 0;
for (const id of picks) {
  const info = await page.evaluate((id) => {
    const A = window.game.world.animals, a = A.all.find((x) => x.id === id);
    window.__tools.select({ kind: 'animal', obj: a });
    window.__tools.zoomTo({ kind: 'animal', obj: a });
    return { sp: a.sp };
  }, id);
  await page.waitForTimeout(1800);
  const bl = await page.evaluate((id) => {
    const g = window.game, a = g.world.animals.all.find((x) => x.id === id);
    return a ? window.__probe.blocked(g.camera.position, a.pos) : null;
  }, id);
  if (bl) blockedN++;
  await page.screenshot({ path: `${out}/zoom-${info.sp}-${tag}.png` });
  console.log(`zoom ${info.sp}: ${bl ? `BLOCKED by ${bl.what} at ${bl.at} of ${bl.len} cm` : 'clear'}`);
  await page.evaluate(() => { window.__tools.follow(null); window.__tools.select(null); window.game.rig.view('front', false); });
  await page.waitForTimeout(300);
}
console.log(`zoom-ins blocked: ${blockedN}/${picks.length}`);

// Following: zoom in on an animal, then sample twice a second for 12 s whether it is hidden behind a solid surface (the
// drawn meshes, not the height fields the camera uses) or off the screen, and how far the camera is.
for (const want of [['leucomelas', 'dartfrog', 'auratus'], ['firesal', 'newt'], ['gecko']]) {
  const id = await page.evaluate((want) => {
    const A = window.game.world.animals;
    for (const sp of want) for (const a of A.by[sp] ?? []) if (!a.dead) { window.__tools.select({ kind: 'animal', obj: a }); window.__tools.zoomTo({ kind: 'animal', obj: a }); return a.id; }
    return null;
  }, want);
  if (id == null) continue;
  let hidden = 0, off = 0, n = 0, sp = '', dist = [];
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(500);
    const r = await page.evaluate((id) => {
      const g = window.game, a = g.world.animals.all.find((x) => x.id === id);
      if (!a) return null;
      const v = a.pos.clone().project(g.camera);
      return { sp: a.sp, bl: !!window.__probe.blocked(g.camera.position, a.pos), off: Math.abs(v.x) > 1 || Math.abs(v.y) > 1 || v.z > 1, d: g.camera.position.distanceTo(a.pos) };
    }, id);
    if (!r) break;
    sp = r.sp; n++; if (r.bl) hidden++; if (r.off) off++; dist.push(r.d);
  }
  dist.sort((x, y) => x - y);
  console.log(`follow ${sp}: hidden ${hidden}/${n}, off screen ${off}/${n}, camera ${dist[0]?.toFixed(1)}-${dist.at(-1)?.toFixed(1)} cm`);
  await page.evaluate(() => { window.__tools.follow(null); window.__tools.select(null); window.game.rig.view('front', false); });
}

// The hard case: the camera starts where a bank, a rock or the background hides the animal, then Follow is switched on
// (as the Follow button does). Counts how long it stays hidden, and whether the camera ends up behind the surface.
{
  let cases = 0, stuck = 0, hiddenSum = 0, behind = 0;
  const ids = await page.evaluate(() => window.game.world.animals.all.filter((a) => !a.dead && !a.swimming && a.rad > 0.8).slice(0, 8).map((a) => a.id));
  for (const id of ids) {
    const ok = await page.evaluate((id) => {
      const g = window.game, a = g.world.animals.all.find((x) => x.id === id), V3 = g.camera.position.constructor;
      for (const el of [0.15, 0.35, 0.6]) for (let k = 0; k < 24; k++) {
        const az = k / 24 * Math.PI * 2, dir = new V3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
        const cam = a.pos.clone().addScaledVector(dir, 16);
        if (Math.abs(cam.x) > 55 || cam.y > 60) continue;
        const b = window.__probe.blocked(cam, a.pos);
        if (b && b.at > 3) { window.__tools.follow(null); g.controls.setLookAt(cam.x, cam.y, cam.z, a.pos.x, a.pos.y, a.pos.z, false); window.__tools.follow(a); return true; }
      }
      return false;
    }, id);
    if (!ok) continue;
    cases++;
    let hidden = 0;
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(500);
      const r = await page.evaluate((id) => {
        const g = window.game, a = g.world.animals.all.find((x) => x.id === id);
        if (!a) return null;
        const W = g.world, c = g.camera.position, inside = Math.abs(c.x) < 50 && Math.abs(c.z) < 25 && (c.y < W.terrain.heightAt(c.x, c.z) || c.z < W.wall.zAt(c.x, c.y));
        return { bl: !!window.__probe.blocked(c, a.pos), inside };
      }, id);
      if (!r) break;
      if (r.bl) hidden++;
      if (r.inside) behind++;
    }
    hiddenSum += hidden;
    if (hidden >= 10) stuck++;
  }
  await page.evaluate(() => { window.__tools.follow(null); window.game.rig.view('front', false); });
  console.log(`follow from a hidden start: ${cases} cases, hidden ${hiddenSum}/${cases * 12} samples, stuck the whole 6 s: ${stuck}, camera inside the ground or wall: ${behind} samples`);
}

// Side strips: a low camera beside a walking frog and a walking salamander or newt, eight frames 0.25 s apart, to judge
// whether the feet are on the ground (--side=0 skips).
if (arg('side', '1') !== '0') {
  const sharp = (await import('sharp')).default;
  for (const want of [['leucomelas', 'dartfrog', 'auratus', 'strawberry', 'toad'], ['firesal', 'newt', 'gecko']]) {
    const id = await page.evaluate((want) => {
      const A = window.game.world.animals;
      for (const sp of want) for (const a of A.by[sp] ?? []) if (!a.dead && !a.swimming && !a.wallMode && !a.perch) return a.id;
      return null;
    }, want);
    if (id == null) continue;
    const frames = [];
    let sp = '';
    for (let i = 0; i < 8; i++) {
      sp = await page.evaluate((id) => {
        const g = window.game, a = g.world.animals.all.find((x) => x.id === id), d = 10 + (a.rad ?? 1) * 4;
        const V3 = g.camera.position.constructor, at = new V3(a.pos.x, a.pos.y + 0.5, a.pos.z);
        // Beside it (either flank, then quartering), low, from whichever side has a clear line.
        let best = null, bc = -1;
        pick: for (const el of [0.25, 0.5, 0.8]) for (const off of [0, Math.PI, 0.5, -0.5, Math.PI + 0.5, Math.PI - 0.5]) {
          const yaw = a.yaw + Math.PI / 2 + off, dir = new V3(Math.sin(yaw), el, Math.cos(yaw)).normalize();
          const c = g.rig.clearance(at, dir, d);
          if (c > bc) { bc = c; best = dir; }
          if (c >= d) break pick;
        }
        void bc;
        window.__tools.follow(null);
        g.controls.setLookAt(at.x + best.x * d, at.y + best.y * d, at.z + best.z * d, at.x, at.y, at.z, false);
        return a.sp;
      }, id);
      await page.waitForTimeout(250);
      frames.push(await page.screenshot({ clip: { x: 150, y: 100, width: 600, height: 400 } }).then((b) => sharp(b).resize(450, 300).toBuffer()));
    }
    const file = `${out}/side-${sp}-${tag}.png`;
    await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#000' } })
      .composite(frames.map((f, i) => ({ input: f, left: (i % 2) * 450, top: Math.floor(i / 2) * 300 }))).png().toFile(file);
    console.log('side strip ->', file);
  }
}
if (errors.length) console.log(errors.join('\n'));
await browser.close();
