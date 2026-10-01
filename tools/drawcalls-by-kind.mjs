// Draw calls per frame by kind, main pass vs shadow pass, measured from the backend.
//
//   node tools/drawcalls-by-kind.mjs [--url=http://localhost:4173/] [--size=1440x900] [--dpr=1] [--frames=3]
//        [--start=starter] [--json=test-output/drawcalls.json] [--list=1]
//
// Run against `npm run build && npx vite preview --port 4173`. Wraps backend.draw for a few frames and tallies
// every call by pass and by the object that issued it. Needs the installed Chrome with WebGPU.
// "empty" counts calls whose instanceCount is 0 (drawn, but nothing to see).
import { chromium } from 'playwright';
import fs from 'node:fs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://localhost:4173/');
const [W, H] = arg('size', '1440x900').split('x').map(Number);
const dpr = +arg('dpr', 1), frames = +arg('frames', 3);
const startLabel = new RegExp(arg('start', 'starter paludarium'), 'i');

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: dpr });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 }).catch(() => {});
await page.getByRole('button', { name: startLabel }).click({ force: true, timeout: 120000 });
await page.waitForFunction(() => window.game?.world?.sim && document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 }).catch(() => {});
await page.waitForTimeout(4000);

const res = await page.evaluate(async (frames) => {
  const g = window.game, r = g.renderer, be = r.backend;
  const kindOf = (o) => {
    const m = o.material, mt = Array.isArray(m) ? m[0] : m;
    const n = o.name || '', mname = mt?.type || '';
    if (o.isSprite) return 'sprite';
    if (o.isInstancedMesh) {
      if (/fruit|litter|food|drops|specks|puffs/i.test(n)) return 'effects:' + (n || 'instanced');
      return 'instanced:' + (n || (mname.replace('NodeMaterial', '')));
    }
    if (/water|surface|flow|pond|caustic/i.test(n)) return 'water:' + n;
    return (n || o.type) + ':' + mname.replace('NodeMaterial', '');
  };
  const tally = { main: new Map(), shadow: new Map() };
  const orig = be.draw.bind(be);
  let on = false;
  be.draw = (ro, info) => {
    if (on) {
      const rt = ro.context?.renderTarget;
      const shadow = !!rt && /shadow/i.test(rt.texture?.name || rt.depthTexture?.name || '') || ro.camera?.isOrthographicCamera;
      const dp = ro.getDrawParameters?.();
      const k = kindOf(ro.object), mp = shadow ? tally.shadow : tally.main;
      const e = mp.get(k) || { calls: 0, empty: 0, tris: 0 };
      e.calls++; if (dp && dp.instanceCount === 0) e.empty++;
      mp.set(k, e);
    }
    return orig(ro, info);
  };
  on = true;
  for (let i = 0; i < frames; i++) await new Promise((x) => requestAnimationFrame(() => x()));
  on = false; be.draw = orig;
  const out = {};
  for (const p of ['main', 'shadow']) out[p] = [...tally[p]].map(([k, v]) => ({ kind: k, calls: v.calls / frames, empty: v.empty / frames })).sort((a, b) => b.calls - a.calls);
  const sprites = []; g.scene.traverse((o) => { if (o.visible && o.isSprite) sprites.push(o.name || '(sprite)'); });
  return { out, info: { calls: r.info.render.calls, tris: r.info.render.triangles }, sprites: sprites.length };
}, frames);

const sum = (a, f = (x) => x.calls) => a.reduce((s, x) => s + f(x), 0);
const group = (a) => { const m = {}; for (const x of a) { const c = x.kind.split(':')[0]; m[c] = (m[c] || 0) + x.calls; } return m; };
console.log('per frame (avg of', frames, 'frames): main', sum(res.out.main), 'shadow', sum(res.out.shadow), '| renderer.info.calls', res.info.calls, 'tris', res.info.tris);
console.log('main by category  ', JSON.stringify(group(res.out.main)));
console.log('shadow by category', JSON.stringify(group(res.out.shadow)));
if (arg('list', '1') === '1') for (const p of ['main', 'shadow']) { console.log('--- ' + p); for (const x of res.out[p].slice(0, 40)) console.log(String(x.calls).padStart(6), String(x.empty).padStart(6), x.kind); }
const json = arg('json', '');
if (json) { fs.mkdirSync(json.replace(/\/[^/]*$/, '') || '.', { recursive: true }); fs.writeFileSync(json, JSON.stringify(res, null, 1)); }
await browser.close();
