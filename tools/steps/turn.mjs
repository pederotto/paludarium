// How animals turn (standalone): `node tools/steps/turn.mjs [--url=http://127.0.0.1:5173/] [--census=40] [--json=out.json]`
//
// 1. Census: the starter tank as it comes, at night for the animals (lit for the picture), animal time advanced by hand for
//    `census` seconds. Per species: how much it turned (rad), how much of that with the legs still (a step in which the leg cycle
//    did not advance or the legs were calm: a rigid spin), the fastest yaw rate (rad/s, 95th percentile) and, for a body that
//    bends (finish.rig2), the share of the turning done without a bend into the turn.
// 2. Forced half turns, one animal at a time on open ground (frogs: the turn state; salamanders, newts, geckos: a goal behind
//    them they walk off to): the time it takes, the yaw rate, leg cycles per half turn, the drift of the pivot, and FOOT SLIP: each
//    foot's world position computed with the rig's own walking formula (render/creatures/instanced.js, util/gait.js footSwing,
//    plus the turning sweep when the build has one, util/turn.js footRig), summed over the time the foot is on the ground (cm per turn).
//
// Self-contained (reads only the animals' fields and the drawn meshes), so the same file measures a build before a change and after.
import { chromium } from 'playwright';
import fs from 'node:fs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://127.0.0.1:5173/'), census = +arg('census', 40), json = arg('json', '');
const forced = arg('species', 'dartfrog,toad,redeye,newt,firesal,gecko').split(',');
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message ?? e).slice(0, 300)));
await page.goto(url, { waitUntil: 'load', timeout: 240000 });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 }).catch(() => {});
await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
await page.waitForFunction(() => window.game?.world?.animals && !document.querySelector('#title, .title'), null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(2500);

// The shared measuring code, installed once in the page.
await page.evaluate(() => {
  const TAU = Math.PI * 2, frac = (x) => x - Math.floor(x);
  const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
  const A = window.game.world.animals;
  // The rest positions of the four feet (legT > 0.9) and the hips, in mesh units, from the drawn coarse mesh.
  const frames = {};
  window.__frame = (id) => {
    if (frames[id]) return frames[id];
    const lod = A.meshFor(id), geo = lod?.lo?.geometry ?? lod?._lo?.geometry;
    if (!geo?.attributes?.rig) return null;
    const P = geo.attributes.position.array, R = geo.attributes.rig.array, n = P.length / 3;
    const feet = { 1: [0, 0, 0], 2: [0, 0, 0], 3: [0, 0, 0], 4: [0, 0, 0] };
    for (let i = 0; i < n; i++) {
      const l = Math.round(R[i * 4 + 1]), t = R[i * 4 + 2];
      if (feet[l] && t > 0.9) { feet[l][0] += P[i * 3]; feet[l][1] += P[i * 3 + 2]; feet[l][2]++; }
    }
    const out = {};
    for (const k of [1, 2, 3, 4]) if (feet[k][2]) out[k] = [feet[k][0] / feet[k][2], feet[k][1] / feet[k][2]];
    return (frames[id] = Object.keys(out).length === 4 ? out : null);
  };
  const scaleOf = (a, sp) => (sp.scale ?? sp.size) * Math.min(1, Math.max(0.35, 0.35 + (a.age / 1440) / (sp.adultDays ?? 10) * 0.65)) * (a.sizeK ?? 1);
  // A foot's world position (x, z) as the rig draws it. τ (a.turnMix) and the pivot (A.turnFrame) exist only in builds with the turning sweep.
  window.__foot = (a, sp, f, leg) => {
    const sc = scaleOf(a, sp), stride = sp.anim?.stride ?? 0.35;
    const calm = Math.round(Math.min(1, Math.max(0, a.legCalm ?? 1)) * 7) / 7, go = 1 - calm;
    const lp = (a.gait ?? 0) + (leg === 1 || leg === 4 ? 0 : Math.PI);
    const u = frac(lp / TAU), sn = u < 0.5 ? -Math.cos(u * TAU) : 3 - 4 * u;
    const tau = a.turnMix ?? 0, tf = A.turnFrameOf?.(a.sp);
    let x = f[0], z = f[1] + sn * stride * go * (1 - Math.abs(tau));
    if (tau && tf) { const al = sn * go * tau * stride / tf.R, dz = z - tf.pz; const c = Math.cos(al), s = Math.sin(al); const nx = x * c + dz * s; z = tf.pz - x * s + dz * c; x = nx; }
    const cy = Math.cos(a.yaw), sy = Math.sin(a.yaw);
    return { x: a.pos.x + (x * cy + z * sy) * sc, z: a.pos.z + (-x * sy + z * cy) * sc, down: go < 0.05 || Math.sin(lp) <= 0 };
  };
  window.__angDiff = angDiff;
});

// --- 1. Census ---------------------------------------------------------------------------------------------------------------
const cen = await page.evaluate(async ({ census }) => {
  const g = window.game, W = g.world, A = W.animals;
  g.setSpeed(0);
  W.env.bright = () => 0;             // night to the animals, lit for the picture
  const E = W.env; E.minute = Math.floor(E.minute / 1440) * 1440 + 23 * 60;
  const stats = {}, prev = new Map();

  const dt = 0.04, n = Math.round(census / dt);
  for (let i = 0; i < n; i++) {
    A.move(dt);
    for (const [id, arr] of Object.entries(A.by)) for (const a of arr) {
      const p = prev.get(a);
      const now = { yaw: a.yaw ?? 0, gait: a.gait ?? 0, calm: a.legCalm ?? 0, bend: a.hr?.[2] ?? 0, tb: a.turnPose?.[1] ?? 0, swim: !!a.swimming || (a.swimSpeed !== undefined && a.legCalm === undefined && !a.cb) };
      prev.set(a, now);
      if (!p || a.hop || a.dead) continue;
      const s = (stats[id] ??= { n: 0, kind: '', yaw: 0, still: 0, nobend: 0, rates: [] });
      const dy = Math.abs(window.__angDiff(now.yaw, p.yaw));
      s.n++; s.yaw += dy; s.rates.push(dy / dt);
      // (a swimmer turns by bending, not by stepping: only animals on their legs count as turning with the legs still)
      if (!now.swim && (Math.abs(now.gait - p.gait) < 1e-4 || now.calm > 0.7)) s.still += dy;
      if (Math.abs(now.bend + now.tb) < 0.02) s.nobend += dy;
    }
  }
  const out = {};
  for (const [id, s] of Object.entries(stats)) {
    s.rates.sort((x, y) => x - y);
    out[id] = { kind: A.by[id][0] ? (A.by[id][0].sp) : id, count: A.by[id].length, yawRad: +s.yaw.toFixed(1), stillRad: +s.still.toFixed(1), stillPct: s.yaw > 0 ? Math.round(100 * s.still / s.yaw) : 0, noBendPct: s.yaw > 0 ? Math.round(100 * s.nobend / s.yaw) : 0, p95rate: +(s.rates[Math.floor(s.rates.length * 0.95)] ?? 0).toFixed(2), maxRate: +(s.rates.at(-1) ?? 0).toFixed(2) };
  }
  return out;
}, { census });
console.log(`census (${census} s of animal time, starter tank, night): yaw turned, with the legs still (rad, %), turned without a bend (%), yaw rate p95/max (rad/s)`);
for (const [id, s] of Object.entries(cen)) console.log(`  ${id.padEnd(12)} n=${String(s.count).padStart(2)}  yaw ${String(s.yawRad).padStart(6)}  still ${String(s.stillRad).padStart(6)} (${String(s.stillPct).padStart(3)}%)  no-bend ${String(s.noBendPct).padStart(3)}%  rate p95 ${s.p95rate} max ${s.maxRate}`);

// --- 2. Forced half turns -------------------------------------------------------------------------------------------------------
const turns = {};
for (const id of forced) {
  const r = await page.evaluate(async ({ id }) => {
    const g = window.game, W = g.world, A = W.animals, T = W.terrain;
    for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a, 'removed');
    A.food = [];
    // open, level, dry ground well clear of pieces
    let best = null, bs = -1e9;
    for (let x = -40; x <= 40; x += 1.5) for (let z = -25; z <= 20; z += 1.5) {
      const gnd = T.heightAt(x, z), s = W.water.surfaceAt(x, z, 0.2);
      if (Number.isFinite(s) && s > gnd - 0.2) continue;
      if (T.normalAt(x, z).y < 0.93) continue;
      if (!A.okFor('land', x, z, 0.3, 1)) continue;
      let ok = 0;          // room round it: ring points that are open, dry and about level
      for (let k = 0; k < 16; k++) { const xx = x + Math.cos(k / 16 * 6.283) * 4, zz = z + Math.sin(k / 16 * 6.283) * 4; ok += A.okFor('land', xx, zz, 0.3, 1) && T.normalAt(xx, zz).y > 0.8 && Math.abs(T.heightAt(xx, zz) - gnd) < 1.5 ? 1 : 0; }
      const sc = ok - Math.abs(x) * 0.02 - Math.abs(z) * 0.02;
      if (sc > bs) { bs = sc; best = { x, z, gnd }; }
    }
    if (!best) return { error: 'no spot' };
    const V3 = g.camera.position.constructor;
    const a = A.add(id, new V3(best.x, best.gnd, best.z), { age: 1e6, hunger: 0.05 });
    if (!a) return { error: 'cap' };
    a.yaw = 0.4;
    // settle a moment, then turn
    for (let i = 0; i < 25; i++) A.move(0.04);
    const f = window.__frame(id);
    if (!f) return { error: 'no rig' };
    const yaw0 = a.yaw, start = { x: a.pos.x, z: a.pos.z };
    const herp = !!a.hm;
    let goal = null;
    if (herp) {
      goal = { x: a.pos.x - Math.sin(yaw0) * 6, z: a.pos.z - Math.cos(yaw0) * 6 };
      const orig = A.herp;
      A.__orig = orig;
      A.herp = function (b, s2, arr, dt) {
        if (b !== a) return orig.call(this, b, s2, arr, dt);
        b.hr ??= [0, 0, 0, 0]; b.hr[0] = 0; b.hr[1] = 0; b.hr[2] = 0; b.hr[3] = 0;
        b.wantMove = true; b.state = 'walk'; b.target = new V3(goal.x, 0, goal.z);
        this.herpStep(b, s2, b.hm?.P ?? {}, goal, 2.0, dt, 'any', 99);
        b.pos.y = T.heightAt(b.pos.x, b.pos.z); b.normal = T.normalAt(b.pos.x, b.pos.z);
      };
    } else { a.order = null; a.chain = 0; a.faceTo = yaw0 + Math.PI; a.afterTurn = 'sit'; a.fs = 'turn'; }
    const dt = 0.04, feet = [1, 2, 3, 4];
    let slip = { 1: 0, 2: 0, 3: 0, 4: 0 }, still = 0, yawSum = 0, maxRate = 0, t = 0, gait0 = a.gait ?? 0, turnedAt = null;
    // (the species' stride as the mesh was built with it; these species are drawn at scale 1 times the animal's own size)
    const spec = { anim: { stride: A.meshFor(id).opts.legStride }, scale: 1, size: 1, adultDays: 1 };
    let prevF = feet.map((k) => window.__foot(a, spec, f[k], k)), py = a.yaw, pg = a.gait ?? 0;
    for (let i = 0; i < 150; i++) {
      A.move(dt); t += dt;
      const nowF = feet.map((k) => window.__foot(a, spec, f[k], k));
      for (let k = 0; k < 4; k++) if (prevF[k].down && nowF[k].down) slip[k + 1] += Math.hypot(nowF[k].x - prevF[k].x, nowF[k].z - prevF[k].z);
      const dy = Math.abs(window.__angDiff(a.yaw, py));
      yawSum += dy; maxRate = Math.max(maxRate, dy / dt);
      if (Math.abs((a.gait ?? 0) - pg) < 1e-4 || (a.legCalm ?? 0) > 0.7) still += dy;
      prevF = nowF; py = a.yaw; pg = a.gait ?? 0;
      // (turned round: facing the way back, or for a walker sent to a goal behind it, facing the goal)
      const off = Math.abs(window.__angDiff(a.yaw, herp ? Math.atan2(goal.x - a.pos.x, goal.z - a.pos.z) : yaw0 + Math.PI));
      if (turnedAt == null && off < 0.05) turnedAt = t;
      if (turnedAt != null && t > turnedAt + (herp ? 0.01 : 0.4)) break;
    }
    if (herp) A.herp = A.__orig;
    const drift = Math.hypot(a.pos.x - start.x, a.pos.z - start.z);
    const tot = slip[1] + slip[2] + slip[3] + slip[4];
    return { herp, scale: +(a.sizeK ?? 1).toFixed(2), secs: turnedAt ?? t, yaw: +yawSum.toFixed(2), maxRate: +maxRate.toFixed(2), cycles: +(((a.gait ?? 0) - gait0) / (2 * Math.PI)).toFixed(2), stillRad: +still.toFixed(2), slipCm: +tot.toFixed(2), slipFront: +(slip[1] + slip[2]).toFixed(2), slipHind: +(slip[3] + slip[4]).toFixed(2), slipPerRad: +(tot / Math.max(0.1, yawSum)).toFixed(2), drift: +drift.toFixed(2) };
  }, { id });
  r.frame = await page.evaluate((id) => { const f = window.game.world.animals.turnFrameOf?.(id); return f ? { pz: +f.pz.toFixed(2), R: +f.R.toFixed(2), theta: +f.theta.toFixed(2), maxRate: +f.maxRate.toFixed(2) } : null; }, id);
  turns[id] = r;
  if (r.error) { console.log(`  ${id}: ${r.error}`); continue; }
  console.log(`turn ${id.padEnd(10)} ${r.herp ? '(walk off behind)' : '(on the spot)    '} ${String(r.secs.toFixed(2)).padStart(5)} s  yaw ${r.yaw} rad  max ${r.maxRate} rad/s  legs ${r.cycles} cycles  yaw w/ legs still ${r.stillRad} rad  foot slip ${r.slipCm} cm (front ${r.slipFront}, hind ${r.slipHind}; ${r.slipPerRad} cm/rad)  body moved ${r.drift} cm${r.frame ? `  [pivot z ${r.frame.pz}, R ${r.frame.R} cm, ${r.frame.theta} rad a leg cycle, max ${r.frame.maxRate} rad/s]` : ''}`);
}
if (json) fs.writeFileSync(json, JSON.stringify({ census: cen, turns }, null, 1));
if (errors.length) console.log('page errors:\n' + [...new Set(errors)].slice(0, 6).join('\n'));
await browser.close();
