// Gecko vs camera probe (N2): is the keeper's lens a predator?
//
//   node tools/steps/gecko-cam.mjs [--url=http://127.0.0.1:4652/] [--seeds=1,2,3] [--n=4]
//
// Opens the starter tank, pauses the world, takes every animal out, sets the clock to 23:00 (geckos are out at night) and adds
// `n` geckos. Then it steps Animals.move by hand (dt 0.05 s) with Math.random reseeded per seed and performance.now replaced by a
// clock that advances 50 ms per step, so Animals.trackTime sees a steady frame rate and the camera's velocity is reproducible.
// Phases (camera moved by hand each step, the followed gecko set as Animals.watched the way controller.frame does it):
//   follow  20 s: gecko 0 followed; the lens orbits it at 10 cm and dives in from 25 to 5 cm at 40 cm/s every 4 s
//   jump    20 s: gecko 0 followed; every 2 s the lens cuts to 8 cm from another gecko (a view jump)
//   slow    per gecko not followed: the lens closes from 25 to 6 cm at 12 cm/s, then sits 4 s
//   threat  a toad pinned 3 cm beside each gecko in turn (a real predator in range): does each one flee?
// Counts entries into 'flee' and 'alert' (the freeze) of the herp mind (a.hm.mode) by cause: 'cam' when the threat the gecko
// sensed this step is the camera (Animals.herpThreat compared with Animals.camThreat), else 'other'. Also: flights at the first
// step after a cut, and how long each slow-approach freeze lasted.
import { chromium } from 'playwright';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://127.0.0.1:4652/');
const seeds = arg('seeds', '1,2,3').split(',').map(Number);
const N = +arg('n', 4);

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
const page = await (await browser.newContext({ viewport: { width: 800, height: 500 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message ?? e).slice(0, 200)));
await page.goto(url, { waitUntil: 'load', timeout: 240000 });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 }).catch(() => {});
await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
await page.waitForFunction(() => window.game?.world?.animals?.all?.length, null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(3000);

const out = [];
for (const seed of seeds) {
  const r = await page.evaluate(({ seed, N }) => {
    const g = window.game, W = g.world, A = W.animals, T = W.terrain, E = W.env, cam = g.camera.position;
    const V3 = cam.constructor;
    g.setSpeed(0);
    const rng = (s) => () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const rand0 = Math.random, now0 = performance.now.bind(performance);
    Math.random = rng(seed * 7919);
    let clock = now0();
    performance.now = () => clock;
    const camSave = cam.clone();
    for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a, 'removed');
    E.minute = Math.floor(E.minute / 1440) * 1440 + 23 * 60;
    // Cause of the threat each animal sensed this step.
    let pin = null;
    const cause = new Map(), lastT = new Map(), origThreat = A.herpThreat;
    A.herpThreat = function (a, sp, P, wall) {
      if (pin && a === pin.tgt) { pin.toad.pos.set(a.pos.x + 3, a.pos.y, a.pos.z); pin.toad.speedNow = 3; }   // held 3 cm off as it senses
      const t = origThreat.call(this, a, sp, P, wall), ct = t ? this.camThreat(a, 22) : null;
      cause.set(a, t ? (t.cam || (ct && t.x === ct.x) ? 'cam' : 'other') : null); lastT.set(a, t);
      return t;
    };
    const G = [];
    for (let i = 0; i < N; i++) {
      const x = -12 + i * 8 + (Math.random() - 0.5) * 3, z = (Math.random() - 0.5) * 8;
      try { const a = A.add('gecko', new V3(x, T.heightAt(x, z), z), { age: 1e6, hunger: 0.2 }); if (a) G.push(a); } catch (e) { return { err: e.message }; }
    }
    if (!G.length) return { err: 'no gecko added' };
    const dt = 0.05, c = { cam: { flee: 0, alert: 0 }, other: { flee: 0, alert: 0 } };
    const ph = {}, prev = new Map(), freezeT = new Map(), freezes = [];
    const camFleeD = [];
    let phase = '', cutFlee = 0, cuts = 0, followedCamFlee = 0, threatFlee = 0;
    const step = (justCut = false) => {
      clock += dt * 1000;
      A.move(dt);
      for (const a of G) {
        const m = a.hm?.mode ?? a.state, was = prev.get(a);
        if (m !== was && (m === 'flee' || m === 'alert')) {
          const k = cause.get(a) ?? 'other';
          c[k][m]++; (ph[phase] ??= { camFlee: 0, camFreeze: 0, otherFlee: 0, otherFreeze: 0 })[(k === 'cam' ? 'cam' : 'other') + (m === 'flee' ? 'Flee' : 'Freeze')]++;
          if (m === 'flee' && justCut) cutFlee++;
          if (m === 'flee' && k === 'cam') camFleeD.push(phase + ':' + (lastT.get(a)?.d ?? -1).toFixed(1));
          if (m === 'flee' && k === 'cam' && a === A.watched) followedCamFlee++;
          if (m === 'flee' && k === 'other' && phase === 'threat') threatFlee++;
          if (m === 'alert') freezeT.set(a, 0);
        }
        if (m === 'alert' && freezeT.has(a)) freezeT.set(a, freezeT.get(a) + dt);
        if (was === 'alert' && m !== 'alert' && freezeT.has(a)) { if (phase === 'slow') freezes.push(+freezeT.get(a).toFixed(2) + (m === 'flee' ? 'F' : '')); freezeT.delete(a); }
        prev.set(a, m);
      }
    };
    const at = (a, d, ang, up = 4) => cam.set(a.pos.x + Math.cos(ang) * d, a.pos.y + up, a.pos.z + Math.sin(ang) * d);
    // Warm up with the lens far away.
    phase = 'warm'; A.watched = null; cam.set(0, 40, 80);
    for (let i = 0; i < 200; i++) step();
    const f = G[0];
    phase = 'follow'; A.watched = f;
    for (let i = 0; i < 400; i++) {
      const s = (i * dt) % 4, d = s < 0.5 ? 25 - 40 * s : Math.max(5, 10);
      at(f, d, i * dt * 0.6); step(i === 0);
    }
    phase = 'jump';
    for (let i = 0; i < 400; i++) {
      const cut = i % 40 === 0;
      if (cut && (i / 40) % 2) cam.set(0, 40, 80);
      else if (cut) { const o = G[1 + ((i / 80) % (G.length - 1 || 1))] ?? f; at(o, 8, Math.random() * 6.28, 2); cuts++; }
      step(cut);
    }
    phase = 'slow'; A.watched = null;
    for (const a of G.slice(1)) {
      cam.set(0, 40, 80); for (let i = 0; i < 60; i++) step();
      const ang = Math.random() * 6.28;
      for (let d = 25; d > 6; d -= 12 * dt) { at(a, d, ang, 2); step(); }
      for (let i = 0; i < 80; i++) step();
    }
    // A real predator inside the threat range (herpThreat: bigger than 1.25x the gecko, closer than 0.7 scareCm, moving or
    // within 3.5 cm): a fire-bellied toad held 3 cm beside each gecko in turn (re-placed as that gecko senses, since the toad's own move and the
    // spacing push it off) for up to 4 s, the lens far away.
    phase = 'threat'; cam.set(0, 40, 80);
    for (let i = 0; i < 40; i++) step();
    let toad = null;
    try { toad = A.add('toad', new V3(-30, T.heightAt(-30, 0), 0), { age: 1e6, hunger: 0.1 }); } catch (e) { /* none */ }
    const threatRuns = [];
    for (const tgt of toad ? G : []) {
      const n0 = threatFlee;
      pin = { tgt, toad };
      for (let i = 0; i < 80; i++) { step(); if (threatFlee > n0) break; }
      pin = null;
      const lt = lastT.get(tgt); threatRuns.push(threatFlee > n0 ? 1 : `0(${tgt.hm?.mode} d=${lt ? lt.d.toFixed(1) : 'none'} toad=${Math.hypot(toad.pos.x - tgt.pos.x, toad.pos.y - tgt.pos.y, toad.pos.z - tgt.pos.z).toFixed(1)})`);
      toad.pos.set(-30, T.heightAt(-30, 0), 0);
      for (let i = 0; i < 100; i++) step();
    }
    A.herpThreat = origThreat; Math.random = rand0; performance.now = now0; cam.copy(camSave); A.watched = null;
    return { geckos: G.length, ph, followedCamFlee, cutFlee, cuts, freezes, threatFlee, threatRuns, camFleeD, toad: !!toad, modes: G.map((a) => a.hm?.mode ?? a.state) };
  }, { seed, N });
  out.push(r);
  console.log(`seed ${seed}: ${JSON.stringify(r)}`);
}
const sum = (k) => out.reduce((s, r) => s + (r[k] ?? 0), 0);
const camFlee = out.reduce((s, r) => s + Object.values(r.ph ?? {}).reduce((q, p) => q + p.camFlee, 0), 0);
console.log(`TOTAL camFlee=${camFlee} followedCamFlee=${sum('followedCamFlee')} cutFlee(first step)=${sum('cutFlee')} threatFlee=${sum('threatFlee')} errors=${errors.length}`);
if (errors.length) console.log(errors.slice(0, 3).join('\n'));
await browser.close();
