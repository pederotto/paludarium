// N6: the skink as the game draws it. Adds ONE crocodile skink on open ground in the emptied starter tank (noon, world paused),
// walks it by hand through its own mind (animals.js skink(), skink.js; the mind is steered toward a warm spot far ahead each
// slice) and prints, from the mesh that drew it (CreatureMesh.put patched on the game's own prototype, as lizard-cycle.mjs):
// the body file, skinned yes/no, bone count, drawn length in cm (rig.len x scale and the skinned vertices' extent), each foot's
// lowest bone point above the ground, and the skin stretch in the walk poses (every mesh edge skinned with the drawn bone rows,
// against its rest length: share > 1.5x and > 2x, worst). Exit 1 when the target fails (baked GLB, skinned, 25 bones, 16.8 cm
// +-2 %, feet 0 … 0.4 cm, no edge > 2x). Through the probe gate:
//   sh "$BB/tools/probe.sh" N6 node tools/steps/skink-body.mjs [--url=http://127.0.0.1:4656/] [--frames=8] [--dt=0.08] [--seed=7]
import { chromium } from 'playwright';
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://127.0.0.1:4656/'), N = +arg('frames', 8), dt = +arg('dt', 0.08), seed = +arg('seed', 7), sp = 'skink';

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
const page = await (await browser.newContext({ viewport: { width: 480, height: 480 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|40[34]/.test(m.text())) errors.push(m.text().slice(0, 240)); });
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message ?? e).slice(0, 240)));
await page.goto(url, { waitUntil: 'load', timeout: 240000 });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 }).catch(() => {});
await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
await page.waitForFunction(() => window.game?.world?.animals && !document.querySelector('#title, .title'), null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(2000);
const setup = await page.evaluate(async ({ sp, seed }) => {
  const I = await import('/src/render/creatures/instanced.js'), SK = await import('/src/render/creatures/skin.js'), K = await import('/src/render/creatures/skeleton.js');
  const g = window.game, W = g.world, A = W.animals, T = W.terrain, Wl = W.wall;
  g.setSpeed(0);
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
  const x0 = -8, z0 = 0;
  const a = A.add(sp, new V3(x0, T.heightAt(x0, z0), z0), { age: 1e6, hunger: 0.1 });
  if (!a) return { err: 'A.add(skink) returned nothing' };
  a.pos.set(x0, T.heightAt(x0, z0), z0); a.yaw = Math.PI / 2;
  const goal = { x: x0 + 40, z: z0, d: 40, temp: 45 };
  window.__a = a;
  window.__force = () => {   // steer the skink's own mind: no threat, wet and cold, a warm spot far ahead, walking now
    a.skT = 99; a.skShore = null; a.skWarm = goal; const m = a.sk; if (!m) return;
    Object.assign(m, { fear: 0, wet: 1, warm: 0, freezeT: 0, deadT: 0, pauseT: 0, walkT: Math.max(m.walkT, 1) });
  };
  window.__step = (sec) => { const n = Math.max(1, Math.round(sec / 0.04)), h = sec / n; for (let k = 0; k < n; k++) { window.__force(); A.move(h); } };
  const man = await fetch(new URL('assets/creatures/manifest.json', location.href)).then((r) => r.json()).catch(() => ({}));
  const rot = (q, v) => { const [qx, qy, qz, qw] = q, tx = 2 * (qy * v[2] - qz * v[1]), ty = 2 * (qz * v[0] - qx * v[2]), tz = 2 * (qx * v[1] - qy * v[0]);
    return [v[0] + qw * tx + qy * tz - qz * ty, v[1] + qw * ty + qz * tx - qx * tz, v[2] + qw * tz + qx * ty - qy * tx]; };
  let edges = null;
  window.__measure = () => {
    let best = null;
    for (const [mesh, r] of window.__puts) {
      const d = Math.hypot(r.pos[0] - a.pos.x, r.pos[1] - a.pos.y, r.pos[2] - a.pos.z);
      if (d < 4 && (!best || (mesh.skinRig && !best.mesh.skinRig))) best = { mesh, r };
    }
    const o = { mode: a.sk?.mode ?? a.state, state: a.state, pos: [a.pos.x, a.pos.z] };
    if (!best) return { ...o, drawn: false };
    const { mesh, r } = best, rig = mesh.skinRig, s = r.scale, geo = mesh.geometry, baked = !!geo?.attributes?.skin;
    Object.assign(o, { drawn: true, skinned: !!rig, bones: rig?.n ?? 0, body: baked ? `baked GLB (manifest ${sp}: ${man?.[sp]?.file ?? 'no key'}, ${(geo.index ? geo.index.count : geo.attributes.position.count) / 3} tris drawn, manifest hi ${man?.[sp]?.tris?.hi ?? '-'})` : 'procedural (no skin attribute)', scale: s, lenRig: rig ? rig.len * s : NaN });
    if (!rig || !window.__bones) return o;
    const M = window.__bones, row = (mesh.row0 + r.i) * K.ROW_FLOATS;
    const xf = (b, p) => [0, 1, 2].map((k) => { const q = row + b * 12 + k * 4; return M[q] * p[0] + M[q + 1] * p[1] + M[q + 2] * p[2] + M[q + 3]; });
    const wd = (p) => { const v = rot(r.quat, [p[0] * s, p[1] * s, p[2] * s]); return [v[0] + r.pos[0], v[1] + r.pos[1], v[2] + r.pos[2]]; };
    const above = (w) => w[1] - T.heightAt(w[0], w[2]);
    const low = (b) => Math.min(above(wd(xf(b, rig.head[b]))), above(wd(xf(b, rig.tail[b]))));
    const under = (b, root) => { let p = b; while (p != null && p >= 0 && p !== root) p = rig.parent[p]; return p === root && b !== root; };
    o.feet = {};
    for (const c of rig.chains ?? []) { const f = [...Array(rig.n).keys()].filter((b) => under(b, c.u) && b !== c.w); o.feet[rig.B[c.u]?.name ?? c.limb] = f.length ? Math.min(...f.map(low)) : NaN; }
    // skinned vertices (the shader's two-bone blend, skin.js: b0 = skin.x, b1 = skin.y, w0 = skin.z) and edge stretch against rest
    const P = geo.attributes.position, SKa = geo.attributes.skin, n = P.count, idx = geo.index;
    if (!edges) { const set = new Set(), e = []; const T3 = idx ? idx.count : n;
      for (let t = 0; t < T3; t += 3) for (let k = 0; k < 3; k++) { let u = idx ? idx.getX(t + k) : t + k, v = idx ? idx.getX(t + (k + 1) % 3) : t + (k + 1) % 3; if (u > v) [u, v] = [v, u]; const key = u * n + v; if (!set.has(key)) { set.add(key); e.push(u, v); } }
      edges = e; }
    const W = new Float32Array(n * 3); let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (let i = 0; i < n; i++) { const p = [P.getX(i), P.getY(i), P.getZ(i)], b0 = SKa.getX(i) | 0, b1 = SKa.getY(i) | 0, w = SKa.getZ(i), q0 = xf(b0, p), q1 = xf(b1, p);
      for (let k = 0; k < 3; k++) { W[i * 3 + k] = q0[k] * w + q1[k] * (1 - w); mn[k] = Math.min(mn[k], W[i * 3 + k]); mx[k] = Math.max(mx[k], W[i * 3 + k]); } }
    o.extent = Math.max(mx[0] - mn[0], mx[2] - mn[2]) * s;
    let o15 = 0, o2 = 0, worst = 0, m = edges.length / 2;
    for (let j = 0; j < edges.length; j += 2) { const u = edges[j], v = edges[j + 1];
      const r0 = Math.hypot(P.getX(u) - P.getX(v), P.getY(u) - P.getY(v), P.getZ(u) - P.getZ(v)); if (r0 < 1e-9) { m--; continue; }
      const q = Math.hypot(W[u * 3] - W[v * 3], W[u * 3 + 1] - W[v * 3 + 1], W[u * 3 + 2] - W[v * 3 + 2]) / r0;
      if (q > 1.5) o15++; if (q > 2) o2++; if (q > worst) worst = q; }
    Object.assign(o, { s15: (o15 / m) * 100, s2: (o2 / m) * 100, worst, edges: m });
    return o;
  };
  return { ok: true, hm: !!a.hm, sk: !!a.sk };
}, { sp, seed });
if (setup.err) { console.log(setup.err); await browser.close(); process.exit(2); }
console.log('rig2 (src/sim/animals.js as served):', JSON.stringify(await page.evaluate(async () => { const M = await import('/src/sim/animals.js'); return (M.SPECIES ?? M.default?.SPECIES)?.skink?.anim?.rig2 ?? 'no SPECIES export'; })));
console.log('hook:', JSON.stringify(await page.evaluate(() => window.__hook())));
const frame = () => page.evaluate(() => { const a = window.__a; window.game.controls.setLookAt(a.pos.x, a.pos.y + 6, a.pos.z + 30, a.pos.x, a.pos.y + 1.5, a.pos.z, false); window.__puts.clear(); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))); });
await page.evaluate(() => { window.__seed(0); window.__step(0.04); window.__step(1); });
await page.evaluate(() => { const a = window.__a; window.game.controls.setLookAt(a.pos.x, a.pos.y + 6, a.pos.z + 30, a.pos.x, a.pos.y + 1.5, a.pos.z, false); });
await page.waitForTimeout(3000);
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));
let fail = [], rows = [], p0 = null;
for (let i = 0; i < N; i++) {
  await page.evaluate((i) => { window.__seed(i + 1); }, i);
  await frame(); const m = await page.evaluate(() => window.__measure()); rows.push(m);
  if (i === 0) console.log(`body=${m.body ?? 'not drawn'} skinned=${m.skinned ? 'yes' : 'no'} bones=${m.bones ?? 0} scale=${f2(m.scale)} length rig=${f2(m.lenRig)} cm skinned-extent=${f2(m.extent)} cm`);
  const v = p0 ? Math.hypot(m.pos[0] - p0[0], m.pos[1] - p0[1]) / dt : 0; p0 = m.pos;
  console.log(`f${i} mode=${m.mode}/${m.state} v=${f2(v)} cm/s feet[cm] ${Object.entries(m.feet ?? {}).map(([k, x]) => `${k}=${f2(x)}`).join(' ')} stretch >1.5x ${f2(m.s15)}% >2x ${f2(m.s2)}% worst ${f2(m.worst)}x`);
  await page.evaluate((dt) => window.__step(dt), dt);
}
const sk = rows.filter((r) => r.skinned), r0 = sk[sk.length - 1] ?? rows[rows.length - 1] ?? {};   // (the first frame can be drawn before the near level is up)
const feet = sk.flatMap((r) => Object.values(r.feet ?? {})), worst = Math.max(...sk.map((r) => r.worst)), s2 = Math.max(...sk.map((r) => r.s2)), s15 = Math.max(...sk.map((r) => r.s15));
console.log(`drawn (last skinned frame, ${sk.length}/${rows.length} skinned): body=${r0.body} skinned=${r0.skinned ? 'yes' : 'no'} bones=${r0.bones} length rig=${f2(r0.lenRig)} cm skinned-extent=${f2(r0.extent)} cm`);
const hind = sk.flatMap((r) => [r.feet?.thighL, r.feet?.thighR]), fore = sk.flatMap((r) => [r.feet?.armL, r.feet?.armR]);
console.log(`feet fore ${f2(Math.min(...fore))}..${f2(Math.max(...fore))} cm, hind ${f2(Math.min(...hind))}..${f2(Math.max(...hind))} cm`);
if (!/baked GLB/.test(r0.body ?? '')) fail.push('not the baked GLB'); if (!r0.skinned) fail.push('not skinned'); if (r0.bones !== 25) fail.push(`bones ${r0.bones}`);
if (!(Math.abs(r0.lenRig - 16.8) <= 0.336)) fail.push(`length ${f2(r0.lenRig)} cm`);
if (!feet.length || feet.some((x) => !(x >= -0.1 && x <= 0.4))) fail.push(`feet ${f2(Math.min(...feet))}..${f2(Math.max(...feet))} cm`);
// (stretch is printed, not gated: the limit for lizards is not written down anywhere found; a guess would be invented)
console.log(`summary: feet ${f2(Math.min(...feet))}..${f2(Math.max(...feet))} cm, stretch max share >1.5x ${f2(s15)}% >2x ${f2(s2)}% worst ${f2(worst)}x`);
if (errors.length) console.log('page errors:', errors.slice(0, 3).join(' | '));
console.log(fail.length ? `FAIL: ${fail.join('; ')}` : 'PASS');
await browser.close();
process.exit(fail.length ? 1 : 0);
