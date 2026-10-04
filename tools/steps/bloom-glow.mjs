// How much the glow (engine/gfx.js bloom) raises the picture: the starter tank by day, wide and a dart frog close up, each drawn
// with the glow and again with it off (GRADE.bloomStrength = 0), compared pixel by pixel. Prints the share of pixels the glow
// raises (by more than 3 and 12 levels of 255), the mean raise, and writes <out>/glow-<view>-<tag>.png (with glow), -off.png and
// glow-<view>-<tag>-diff.png (the raise x 8, so where the glow lands shows).
// --thresholds=0.9,1.2 draws the same frames at each glow threshold (set on the live bloom node), so the comparison is like for like.
//   node tools/steps/bloom-glow.mjs [--url=http://127.0.0.1:5173/] [--out=test-output] [--tag=now] [--thresholds=a,b]
//        [--query=?quality=high&fixedres]
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://127.0.0.1:5173/'), out = arg('out', 'test-output'), tag = arg('tag', 'now');
const query = arg('query', '?quality=high&fixedres'), ths = arg('thresholds', '').split(',').filter(Boolean).map(Number);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage();
await page.goto(url + query, { waitUntil: 'load', timeout: 240000 });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 }).catch(() => {});
await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
await page.waitForFunction(() => window.game?.world?.animals, null, { timeout: 90000 });
await page.waitForTimeout(3500);
await page.addStyleTag({ content: '#ui{display:none!important}' });
await page.evaluate(async () => {
  const g = window.game, W = g.world, E = W.env;
  g.setSpeed(0);
  E.minute = Math.floor(E.minute / 1440) * 1440 + 720;
  const { GRADE } = await import('/src/engine/gfx.js');
  window.__glow = (on) => { GRADE.bloomStrength.value = on ? (window.__glowS ??= GRADE.bloomStrength.value) : 0; };
  window.__glow(true);
  // the bloom node in the post-processing graph (the one with a threshold uniform)
  const seen = new Set(), walk = (n) => {
    if (!n || typeof n !== 'object' || seen.has(n)) return null;
    seen.add(n);
    if (n.isNode && n.threshold?.isNode && n.strength?.isNode) return n;
    for (const v of Object.values(n)) if (v && typeof v === 'object' && (v.isNode || Array.isArray(v))) { const r = walk(v); if (r) return r; }
    return null;
  };
  const b = walk(g.gfx.pipeline?.outputNode);
  window.__th = (t) => { if (b && t) b.threshold.value = t; return b ? b.threshold.value : null; };
});
console.log('bloom threshold in the build:', await page.evaluate(() => window.__th()));

const views = {
  tank: () => { const g = window.game; g.rig.stopOrbit(); g.rig.moved = true; g.controls.setLookAt(0, 30, 62, 0, 12, 0, false); return true; },
  leaves: () => {
    // the highest plant (nearest the light), from a little in front of it
    const g = window.game, P = g.world.plants.list;
    let top = null; for (const p of P) if (!top || p.pos.y > top.pos.y) top = p;
    if (!top) return false;
    const p = top.pos; g.rig.stopOrbit(); g.rig.moved = true;
    g.controls.setLookAt(p.x + 4, p.y + 6, p.z + 16, p.x, p.y + 2, p.z, false);
    return true;
  },
  frog: () => {
    // a dart frog set on open, level, dry ground toward the front glass, seen from just in front of it
    const g = window.game, W = g.world, A = W.animals, T = W.terrain, a = A.by.dartfrog?.[0];
    if (!a) return false;
    let best = null, bs = -1e9;
    for (let x = -40; x <= 40; x += 1.5) for (let z = -25; z <= 25; z += 1.5) {
      const gnd = T.heightAt(x, z), s = W.water.surfaceAt(x, z, 0.2);
      if ((Number.isFinite(s) && s > gnd - 0.2) || T.normalAt(x, z).y < 0.93 || !A.okFor('land', x, z, 0.3, 1)) continue;
      const sc = z * 0.1 - Math.abs(x) * 0.02;
      if (sc > bs) { bs = sc; best = { x, z, gnd }; }
    }
    if (best) { a.pos.x = best.x; a.pos.z = best.z; a.pos.y = best.gnd; a.yaw = 0.6; }
    const p = a.pos; g.rig.stopOrbit(); g.rig.moved = true;
    g.controls.setLookAt(p.x + 1.5, p.y + 2.2, p.z + 6, p.x, p.y + 0.6, p.z, false);
    return true;
  },
};
const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
// Shots alternate through the states (each threshold with the glow on, then the glow off) twice; a pixel counts as raised by the
// least the one state adds over the other across both rounds (the water, the caustics and swaying leaves move between frames).
const states = [...(ths.length ? ths : [null]), 'off'];
for (const [name, fn] of Object.entries(views)) {
  if (!(await page.evaluate(`(${fn})()`))) { console.log(`${name}: no subject`); continue; }
  await page.waitForTimeout(1500);
  const S = new Map(states.map((k) => [k, []]));
  let info = null;
  for (let round = 0; round < 2; round++) for (const k of states) {
    await page.evaluate((k) => { window.__glow(k !== 'off'); if (k !== 'off') window.__th(k); }, k);
    await page.waitForTimeout(600);
    const png = await page.screenshot();
    if (round === 0) fs.writeFileSync(`${out}/glow-${name}-${tag}-${k === 'off' ? 'off' : 't' + (k ?? 'build')}.png`, png);
    const r = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    info = r.info; S.get(k).push(r.data);
  }
  await page.evaluate(() => window.__glow(true));
  const n = info.width * info.height;
  const cmp = (hi, lo, file) => {      // min over `hi` shots minus max over `lo` shots
    let r3 = 0, r12 = 0, sum = 0; const diff = file ? Buffer.alloc(n * 3) : null;
    for (let i = 0, j = 0; j < n; i += 3, j++) {
      const d = Math.min(...hi.map((b) => lum(b, i))) - Math.max(...lo.map((b) => lum(b, i)));
      if (d > 3) r3++; if (d > 12) r12++; sum += Math.max(0, d);
      if (diff) { const v = Math.min(255, Math.max(0, d * 8)); diff[i] = v; diff[i + 1] = v; diff[i + 2] = v; }
    }
    if (file) sharp(diff, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toFile(file);
    return `>3 levels ${(r3 / n * 100).toFixed(2)}%, >12 levels ${(r12 / n * 100).toFixed(2)}%, mean ${(sum / n).toFixed(3)}`;
  };
  const off = S.get('off');
  console.log(`glow ${name.padEnd(6)} noise (off vs off): ${cmp([off[0]], [off[1]])}`);
  for (const k of states) if (k !== 'off') console.log(`glow ${name.padEnd(6)} raised by the glow at threshold ${k ?? 'build'}: ${cmp(S.get(k), off, `${out}/glow-${name}-${tag}-t${k ?? 'build'}-diff.png`)}`);
  for (let q = 1; q < states.length - 1; q++) console.log(`glow ${name.padEnd(6)} glow lost going ${states[q - 1]} -> ${states[q]}: ${cmp(S.get(states[q - 1]), S.get(states[q]), `${out}/glow-${name}-${tag}-lost-${states[q - 1]}-${states[q]}.png`)}`);
}
await browser.close();
