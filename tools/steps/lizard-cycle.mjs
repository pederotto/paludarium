// A lizard walking, drawn by the game itself (its near, skinned level of detail), as a contact sheet plus one line of numbers per
// frame, to be checked against BB/MOTION_<species>.md. Standalone (like swim-cycle.mjs); needs the dev server and real WebGPU.
//
//   node tools/steps/lizard-cycle.mjs [--species=gecko|skink] [--surface=ground|wall] [--view=side|top|three] [--frames=8]
//        [--dt=0.04 (animal seconds per frame, stepped in slices of at most 0.04 s)] [--warm=1 (seconds of walking first)]
//        [--out=test-output/lizard/] [--url=http://127.0.0.1:4630/] [--size=360] [--seed=7]
//
// Opens the starter tank, empties it (World.empty: flat substrate, no water, the stone background), noon, takes every animal
// out, adds ONE lizard on open ground (or on the background with the game's own wall mode: a.onWall / a.wallMode, animals.js
// geckoMove), pauses the world and steps Animals.move by hand with Math.random reseeded per frame, so the same command gives the
// same frames. The walk is forced each slice through the herp mind (mode patrol, a goal far ahead). The camera follows the animal
// in the frame of its body at the first frame. Which body is drawn is read from CreatureMesh.put (patched in the page): the
// mesh that drew the animal, whether it has a skeleton (skinned) and how many bones; the numbers come from that mesh's own row
// of the bone texture (skin.js boneData), i.e. the bones as drawn.
// Per frame: each foot's lowest bone point above the surface, belly clearance (lowest trunk bone point minus its radius), body
// bend (pelvis->spine against spine->neck), head yaw (against pelvis->neck), tail tip sideways off the pelvis->neck line, speed.
// Writes <out>/<species>-<surface>-<view>.png (the sheet) and .txt (the numbers and per-channel ranges).
import { chromium } from 'playwright';
import fs from 'node:fs';
import sharp from 'sharp';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://127.0.0.1:4630/'), sp = arg('species', 'gecko'), surface = arg('surface', 'ground'), view = arg('view', 'side');
const awake = arg('awake', '0') === '1';     // --awake=1: the species' mind never sleeps or finds the tank too warm (a fire salamander hides by day and above 20 C), so it walks at noon in the starter tank
const N = +arg('frames', 8), dt = +arg('dt', 0.04), warm = +arg('warm', 1), S = +arg('size', 360), seed = +arg('seed', 7);
const out = arg('out', 'test-output/lizard/').replace(/\/$/, '');
fs.mkdirSync(out, { recursive: true });
const base = `${out}/${sp}-${surface}-${view}`;
const lines = [];
const say = (s) => { console.log(s); lines.push(s); };

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
const page = await (await browser.newContext({ viewport: { width: S, height: S }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|40[34]/.test(m.text())) errors.push(m.text().slice(0, 240)); });
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message ?? e).slice(0, 240)));
await page.goto(url, { waitUntil: 'load', timeout: 240000 });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 }).catch(() => {});
await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
await page.waitForFunction(() => window.game?.world?.animals && !document.querySelector('#title, .title'), null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(2000);
await page.addStyleTag({ content: '#ui{display:none!important}' });

const setup = await page.evaluate(async ({ sp, surface, seed, awake }) => {
  const I = await import('/src/render/creatures/instanced.js'), SK = await import('/src/render/creatures/skin.js'), K = await import('/src/render/creatures/skeleton.js');
  const g = window.game, W = g.world, A = W.animals, T = W.terrain, Wl = W.wall;
  g.setSpeed(0);
  if (awake) { const H = await import('/src/sim/herp.js'); if (H.PROFILES[sp]) Object.assign(H.PROFILES[sp], { awakeAt: 0, tHot: 99 }); }
  W.empty();
  for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a, 'removed');
  A.food = [];
  const E = W.env; E.minute = Math.floor(E.minute / 1440) * 1440 + 12 * 60;
  const rng = (s) => () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  window.__seed = (k) => { Math.random = rng(seed * 1000 + k); };
  window.__seed(0);
  // Which mesh drew what: the last put of each CreatureMesh since __puts was cleared.
  // The game's own CreatureMesh class is reached through its live CreatureLODs (window.game, searched breadth first): an
  // import() of instanced.js from here can be a second copy of the module, whose prototype the game never calls.
  const findAll = (root, test, max) => {
    const seen = new Set([root]), q = [root], hits = [];
    for (let k = 0; k < q.length && k < max; k++) {
      const o = q[k];
      let vals; try { vals = o instanceof Map || o instanceof Set ? [...o.values()] : Object.keys(o).map((key) => { try { return o[key]; } catch { return null; } }); } catch { continue; }
      for (const v of vals) {
        if (!v || typeof v !== 'object' || seen.has(v) || ArrayBuffer.isView(v) || (Array.isArray(v) && v.length > 20000)) continue;
        seen.add(v); if (test(v)) hits.push(v); q.push(v);
      }
    }
    return hits;
  };
  window.__puts = new Map();
  window.__hook = async () => {
    const lods = findAll(g, (v) => '_lo' in v && 'near2' in v, 400000);
    const P = lods.find((l) => l._lo)?._lo && Object.getPrototypeOf(lods.find((l) => l._lo)._lo);
    if (!P) return { lods: lods.length };
    if (!P.__lc) {
      const put0 = P.put; P.__lc = true;
      P.put = function (pos, quat, scale, ...rest) {
        const i = this.n; put0.call(this, pos, quat, scale, ...rest);
        if (this.n > i) window.__puts.set(this, { i, pos: [pos.x, pos.y, pos.z], quat: [quat.x, quat.y, quat.z, quat.w], scale, ph: rest[2], ch: rest.slice(4, 8) });
      };
    }
    const same = P === I.CreatureMesh.prototype, sk = lods.map((l) => l.skinned).find((s) => s?.skinRig);
    // The bones as drawn: skin.js's boneData from the copy of the module that holds this skinned mesh in its `live` set
    // (the game may import instanced.js under a ?t= stamp after an edit, while skin.js stays the plain URL).
    let bones = null, how = 'not found';
    const urls = ['/src/render/creatures/skin.js', ...performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /\/creatures\/skin\.js/.test(n))];
    if (sk) for (const u of new Set(urls)) { try { const mod = u === urls[0] ? SK : await import(u); if (mod.live?.has?.(sk)) { bones = mod.boneData; how = 'skin.js boneData via ' + u.split('/').pop(); break; } } catch {} }
    window.__bones = bones;
    return { lods: lods.length, sameModule: same, boneData: how };
  };
  const V3 = g.camera.position.constructor;
  let a;
  const x0 = surface === 'wall' ? 0 : -8, z0 = 0;
  try { a = A.add(sp, new V3(x0, T.heightAt(x0, z0), z0), { age: 1e6, hunger: 0.1 }); } catch (e) { return { err: `A.add('${sp}') threw: ${e.message}` }; }
  if (!a) return { err: `A.add('${sp}') returned nothing` };
  let goal, note = '';
  if (surface === 'wall') {
    const wy = T.heightAt(x0, Wl.zAt(x0, 10) + 1.5) + 10;
    a.onWall = true; a.wallMode = true; a.yaw = Math.PI;                         // (on the wall yaw PI faces up: animals.js wallFrame / :3238)
    a.pos.set(x0, wy, Wl.zAt(x0, wy) + 0.5);
    goal = { x: x0, z: -(wy + 40), wall: true };                                // (the mind's plane on the wall is x, -y: animals.js:3871)
  } else {
    a.pos.set(x0, T.heightAt(x0, z0), z0); a.yaw = Math.PI / 2;               // facing +x
    goal = { x: x0 + 40, z: z0, wall: false };
    if (T.normalAt(x0, z0).y < 0.95) note = 'ground not level at the start';
  }
  window.__a = a;
  window.__force = () => {
    const m = a.hm;
    if (m) Object.assign(m, { mode: sp === 'firesal' ? 'forage' : 'patrol', modeT: 0, moveLeft: 5, pauseLeft: 0, goal, wantWall: surface === 'wall', thirst: 0, fear: 0 });
    else if (!a.plan) { a.plan = { type: 'walk', to: new V3(goal.x, 0, goal.z), ang: a.yaw, water: false, v: 1 }; a.fs = 'walk'; a.walkT = 0; }
  };
  window.__step = (sec) => { const n = Math.max(1, Math.round(sec / Math.min(0.04, sec))), h = sec / n; for (let k = 0; k < n; k++) { window.__force(); A.move(h); } };
  const rot = (q, v) => { const [qx, qy, qz, qw] = q, tx = 2 * (qy * v[2] - qz * v[1]), ty = 2 * (qz * v[0] - qx * v[2]), tz = 2 * (qx * v[1] - qy * v[0]);
    return [v[0] + qw * tx + qy * tz - qz * ty, v[1] + qw * ty + qz * tx - qx * tz, v[2] + qw * tz + qx * ty - qy * tx]; };
  window.__rot = rot;
  window.__measure = () => {
    let best = null;
    for (const [mesh, r] of window.__puts) {
      const d = Math.hypot(r.pos[0] - a.pos.x, r.pos[1] - a.pos.y, r.pos[2] - a.pos.z);
      if (d < 4 && (!best || (mesh.skinRig && !best.mesh.skinRig))) best = { mesh, r };
    }
    const o = { pos: [a.pos.x, a.pos.y, a.pos.z], wall: !!(a.wallMode || a.onWall), mode: a.hm?.mode ?? a.fs ?? a.state, hsp: a.hsp ?? null, puts: window.__puts.size };
    if (!best) return { ...o, drawn: false, near: [...window.__puts].map(([mesh, r]) => [+Math.hypot(r.pos[0] - a.pos.x, r.pos[1] - a.pos.y, r.pos[2] - a.pos.z).toFixed(2), r.pos.map((v) => +v.toFixed(2)), !!mesh.skinRig, +(+r.scale).toFixed(3)]).sort((p, q) => p[0] - q[0]).slice(0, 4) };
    const { mesh, r } = best, rig = mesh.skinRig, s = r.scale;
    Object.assign(o, { drawn: true, skinned: !!rig, bones: rig?.n ?? 0, body: mesh.geometry?.attributes?.skin ? 'baked GLB' : 'procedural (no skin attribute)', quat: r.quat, scale: s, ph: r.ph, ch: r.ch, len: (rig?.len ?? 7) * s });
    if (!rig || !window.__bones) return o;
    const M = window.__bones, row =(mesh.row0 + r.i) * K.ROW_FLOATS;
    const xf = (b, p) => [0, 1, 2].map((k) => { const q = row + b * 12 + k * 4; return M[q] * p[0] + M[q + 1] * p[1] + M[q + 2] * p[2] + M[q + 3]; });
    const wd = (p) => { const v = rot(r.quat, [p[0] * s, p[1] * s, p[2] * s]); return [v[0] + r.pos[0], v[1] + r.pos[1], v[2] + r.pos[2]]; };
    const above = (w) => (o.wall ? w[2] - Wl.zAt(w[0], w[1]) : w[1] - T.heightAt(w[0], w[2]));
    const low = (b) => Math.min(above(wd(xf(b, rig.head[b]))), above(wd(xf(b, rig.tail[b]))));
    const under = (b, root) => { let p = b; while (p != null && p >= 0 && p !== root) p = rig.parent[p]; return p === root && b !== root; };
    o.feet = {};
    for (const c of rig.chains ?? []) {
      const foot = [...Array(rig.n).keys()].filter((b) => under(b, c.u) && b !== c.w);
      o.feet[rig.B[c.u]?.name ?? c.limb] = foot.length ? Math.min(...foot.map(low)) : NaN;
    }
    // (G4) each limb's tip in the world and which legs the gait has in stance (lizardpose.js keeps the last closed-form feet in rig._open)
    o.tips = (rig.chains ?? []).map((c) => [c.limb, wd(xf(c.ends[c.ends.length - 1], c.T))]);
    o.stance = rig._open?.stance ? [...rig._open.stance] : null;
    o.miss = rig._miss ? [...rig._miss].map((v) => v * s) : null;   // (N7) |tip - target| per leg, world cm, after the fold's limit
    o.cap = rig.strideCap ?? null; o.feetFit = !!rig.feetFit;   // (N7 stamp: only the reach-guard code has these)
    const trunk = [...Array(rig.n).keys()].filter((b) => /spine|pelvis|chest|trunk|torso|belly/i.test(rig.B[b].name));
    o.trunk = trunk.map((b) => rig.B[b].name).join(',');
    o.belly = trunk.length ? Math.min(...trunk.map((b) => low(b) - (rig.B[b].r ?? 0) * s)) : NaN;
    const [spn, nk, hd] = rig.front, pv = rig.byName.pelvis ?? trunk[0];
    const Pp = xf(pv, rig.head[pv]), Sp = xf(spn, rig.head[spn]), Np = xf(nk, rig.head[nk]), H0 = xf(hd, rig.head[hd]), H1 = xf(hd, rig.tail[hd]);
    const sub = (u, v) => [u[0] - v[0], u[2] - v[2]];
    const ang = (u, v) => (Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]) * 180) / Math.PI;
    o.bend = ang(sub(Sp, Pp), sub(Np, Sp));
    o.headYaw = ang(sub(Np, Pp), sub(H1, H0));
    const tt = rig.tails?.length ? rig.tails[rig.tails.length - 1] : null;
    if (tt != null) { const tip = xf(tt, rig.tail[tt]), ax = sub(Np, Pp), L = Math.hypot(...ax), d = sub(tip, Pp); o.tailX = ((ax[0] * d[1] - ax[1] * d[0]) / L) * s; } else o.tailX = NaN;
    return o;
  };
  return { ok: true, note, kind: a.herp ? 'herp' : a.fs ? 'frog-like' : 'other', hm: !!a.hm };
}, { sp, surface, seed, awake });
if (setup.err) { console.log(setup.err); await browser.close(); process.exit(2); }

const frame = () => page.evaluate(() => { window.__puts.clear(); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))); });
const measure = async () => { await frame(); return page.evaluate(() => window.__measure()); };
await page.evaluate((w) => { window.__seed(0); window.__step(0.04); window.__step(w); }, warm);
await frame();
const hook = await page.evaluate(() => window.__hook());
let m = await measure();
const basis = (q) => page.evaluate((q) => [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((v) => window.__rot(q, v)), q);
let B = m.quat ? await basis(m.quat) : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const cam = (p, L) => page.evaluate(({ p, B, L, view }) => {
  const [s, n, f] = B, D = 2.3 * L, at = p.map((v, k) => v + n[k] * 0.1 * L);
  const off = view === 'top' ? n.map((v, k) => v * D * 1.1 - f[k] * 0.05 * D) : view === 'three' ? s.map((v, k) => (v * 0.55 + n[k] * 0.6 - f[k] * 0.6) * D) : s.map((v, k) => v * D + n[k] * 0.12 * D);
  window.game.controls.setLookAt(at[0] + off[0], at[1] + off[1], at[2] + off[2], at[0], at[1], at[2], false);
}, { p, B, L, view });
await cam(m.pos, m.len ?? 7);
m = await measure();
if (m.quat) { B = await basis(m.quat); await cam(m.pos, m.len ?? 7); m = await measure(); }
say(`${sp} ${surface} ${view}: frames ${N} dt ${dt} s warm ${warm} s seed ${seed}${setup.note ? ' (' + setup.note + ')' : ''}`);
say(`skinned=${m.drawn ? (m.skinned ? 'yes' : 'no') : 'not drawn near the animal'} bones=${m.bones ?? 0} body=${m.body ?? '-'} scale=${m.scale?.toFixed?.(3)} length=${m.len?.toFixed?.(2)} cm mind=${setup.hm ? 'herp' : 'none'} wall=${m.wall}`);
say(`hook: ${JSON.stringify(hook)}`);
{ const { execSync } = await import('node:child_process'), git = (c) => { try { return execSync(`git ${c}`, { encoding: 'utf8' }).trim(); } catch { return '?'; } };
  say(`stamp: tree ${git('rev-parse --short HEAD')} ${git('status --porcelain src').split('\n').filter(Boolean).length} dirty; rig strideCap=${m.cap == null ? 'none (no N7 reach guard)' : m.cap.toFixed(3) + ' cm'} feetFit=${m.feetFit ? 'yes' : 'no'}`); }
if (m.skinned && !m.feet) say('bone numbers: no bone data found');
if (!m.drawn) say(`not drawn: ${m.puts} meshes put something this frame; animal at ${m.pos.map((v) => v.toFixed(2))}; nearest puts [dist, pos, skinned, scale]: ${JSON.stringify(m.near)}`);
if (m.trunk) say(`trunk bones: ${m.trunk}; feet: ${Object.keys(m.feet).join(',')}`);

const f2 = (v) => (v == null || Number.isNaN(v) ? 'NaN' : v.toFixed(2));
const rows = [], shots = [];
let prev = m.pos, prevR = null;
for (let i = 0; i < N; i++) {
  await page.evaluate(({ i, dt }) => { window.__seed(i + 1); window.__step(dt); }, { i, dt });
  await cam((await page.evaluate(() => [window.__a.pos.x, window.__a.pos.y, window.__a.pos.z])), m.len ?? 7);
  const r = await measure();
  r.v = Math.hypot(r.pos[0] - prev[0], r.pos[1] - prev[1], r.pos[2] - prev[2]) / dt; prev = r.pos;
  // foot slip: how far a tip moved along the surface between two frames in both of which its leg was in stance (cm per frame)
  r.slip = {};
  if (prevR?.tips && r.tips && r.stance && prevR.stance) for (const [i, [limb, w]] of r.tips.entries()) {
    const p = prevR.tips[i]?.[1];
    if (p && r.stance[limb - 1] && prevR.stance[limb - 1]) r.slip[limb] = r.wall ? Math.hypot(w[0] - p[0], w[1] - p[1]) : Math.hypot(w[0] - p[0], w[2] - p[2]);
  }
  prevR = r;
  rows.push(r);
  shots.push(await page.screenshot());
  const feet = Object.entries(r.feet ?? {}).map(([k, v]) => `${k}=${f2(v)}`).join(' ');
  say(`f${i} stance(LF RF LH RH)=${r.stance ? r.stance.join('') : '-'} slip[cm/frame] ${Object.entries(r.slip).map(([k, v]) => `leg${k}=${f2(v)}`).join(' ') || '-'} tipMiss[cm] ${r.miss ? r.miss.map(f2).join(' ') : '-'}`);
  say(`f${i} t=${((i + 1) * dt).toFixed(2)}s ph=${f2(r.ph)} feet[cm] ${feet} belly=${f2(r.belly)} bend=${f2(r.bend)}° headYaw=${f2(r.headYaw)}° tailX=${f2(r.tailX)}cm v=${f2(r.v)}cm/s mode=${r.mode} wall=${r.wall} skinned=${r.skinned ? 'yes' : 'no'}`);
}
// Per-channel ranges and plain faults.
const ch = {};
for (const r of rows) {
  for (const [k, v] of Object.entries(r.feet ?? {})) (ch[k] ??= []).push(v);
  for (const k of ['belly', 'bend', 'headYaw', 'tailX', 'v']) (ch[k] ??= []).push(r[k]);
  for (const v of Object.values(r.slip ?? {})) (ch.slipStance ??= []).push(v);
  for (const v of r.miss ?? []) (ch.tipMiss ??= []).push(v);
}
say('ranges (min..max, span):');
for (const [k, vs] of Object.entries(ch)) {
  const ok = vs.filter((v) => Number.isFinite(v)), lo = Math.min(...ok), hi = Math.max(...ok), flags = [];
  if (ok.length < vs.length) flags.push('NaN');
  if (ok.length && hi - lo < 1e-3) flags.push('CONSTANT');
  if (k !== 'bend' && k !== 'headYaw' && k !== 'tailX' && k !== 'v' && lo < -0.3) flags.push('BELOW SURFACE');
  say(`  ${k}: ${f2(lo)}..${f2(hi)} span ${f2(hi - lo)}${flags.length ? '  ' + flags.join(' ') : ''}`);
}
const comps = [];
shots.forEach((png, i) => {
  comps.push({ input: png, left: i * S, top: 0 });
  comps.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="20"><text x="6" y="15" font-family="sans-serif" font-size="13" fill="#9fd">${sp} ${surface} ${view} f${i}</text></svg>`), left: i * S, top: 0 });
});
await sharp({ create: { width: S * N, height: S, channels: 3, background: '#060708' } }).composite(comps).png().toFile(`${base}.png`);
say(`sheet ${base}.png`);
if (errors.length) say('page errors:\n' + [...new Set(errors)].slice(0, 6).join('\n'));
fs.writeFileSync(`${base}.txt`, lines.join('\n') + '\n');
await browser.close();
process.exit(errors.length ? 1 : 0);
