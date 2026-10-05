// The frog's visible muscles in the game (docs/MUSCLES.md): a dart frog in the starter tank by day, frozen in three poses (sitting
// at rest, the leap's take-off with its extensors on, the leap's flight with its flexors folding the legs), each drawn with the
// muscles and with ?nomuscle (the bellies held at rest), side by side with their difference x8, from a few cm.
//
//   node tools/steps/muscle-look.mjs [--url=http://127.0.0.1:4640/] [--out=test-output/muscles] [--webgl=1] [--dist=6]
// Stamp: window.__muscles.writes (belly writes so far) must grow in the muscle run, or the picture does not count.
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://127.0.0.1:4640/'), out = arg('out', 'test-output/muscles'), webgl = arg('webgl', '0') === '1', dist = +arg('dist', '6');
fs.mkdirSync(out, { recursive: true });
const POSES = [['rest', null], ['takeoff', 0.1], ['flight', 0.5]];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const shots = {};
for (const mode of ['muscle', 'nomuscle']) {
  const page = await (await browser.newContext({ viewport: { width: 700, height: 520 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message ?? e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  await page.goto(`${url}?quality=high&fixedres${webgl ? '&webgl' : ''}${mode === 'nomuscle' ? '&nomuscle' : ''}`, { waitUntil: 'load', timeout: 240000 });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 }).catch(() => {});
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForFunction(() => window.game?.world?.animals?.by?.dartfrog?.length, null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(6000);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  for (const [name, t] of POSES) {
    await page.evaluate(({ t, dist }) => {
      const g = window.game, a = g.world.animals.by.dartfrog[0];
      const E = g.world.env; if (E) E.minute = Math.floor(E.minute / 1440) * 1440 + 12 * 60;
      g.setSpeed(0);
      a.swimming = false;
      a.hop = t == null ? null : { from: a.pos.clone(), to: a.pos.clone().setZ(a.pos.z + 3), t, dur: 0.38, h: 1.25, y0: a.yaw ?? 0, y1: a.yaw ?? 0 };
      const p = a.pos, yaw = a.yaw ?? 0, side = [Math.cos(yaw), -Math.sin(yaw)];
      g.rig.stopOrbit?.(); g.rig.moved = true;
      g.controls.setLookAt(p.x + side[0] * dist + Math.sin(yaw) * dist * 0.4, p.y + dist * 0.5, p.z + side[1] * dist + Math.cos(yaw) * dist * 0.4, p.x, p.y + 0.8, p.z, false);
    }, { t, dist });
    await page.waitForTimeout(1500);
    const st = await page.evaluate(() => ({ writes: window.__muscles?.writes ?? -1, on: window.__muscles?.on, drawn: window.__skin?.drawn ?? 0 }));
    const f = `${out}/${name}-${mode}${webgl ? '-webgl' : ''}.png`;
    await page.screenshot({ path: f });
    shots[`${name}-${mode}`] = f;
    console.log(`${mode} ${name}: stamp writes ${st.writes} (on ${st.on}), skinned ${st.drawn}`);
  }
  if (errors.length) console.log('  errors: ' + [...new Set(errors)].slice(0, 4).join(' | '));
  await page.close();
}
await browser.close();
// side by side with the difference x8, one row a pose
const rows = [];
for (const [name] of POSES) {
  const A = sharp(shots[`${name}-muscle`]), B = sharp(shots[`${name}-nomuscle`]);
  const [a, b] = await Promise.all([A.raw().toBuffer({ resolveWithObject: true }), B.raw().toBuffer({ resolveWithObject: true })]);
  const d = Buffer.alloc(a.data.length);
  let changed = 0;
  for (let i = 0; i < d.length; i += a.info.channels) {
    let m = 0; for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(a.data[i + c] - b.data[i + c]));
    if (m > 4) changed++;
    for (let c = 0; c < 3; c++) d[i + c] = Math.min(255, m * 8); if (a.info.channels === 4) d[i + 3] = 255;
  }
  console.log(`${name}: ${changed} pixels differ by more than 4 levels`);
  const diff = await sharp(d, { raw: a.info }).png().toBuffer();
  rows.push(await sharp({ create: { width: a.info.width * 3, height: a.info.height, channels: 3, background: '#000' } })
    .composite([{ input: shots[`${name}-muscle`], left: 0, top: 0 }, { input: shots[`${name}-nomuscle`], left: a.info.width, top: 0 }, { input: diff, left: a.info.width * 2, top: 0 }]).png().toBuffer());
}
const meta = await sharp(rows[0]).metadata();
await sharp({ create: { width: meta.width, height: meta.height * rows.length, channels: 3, background: '#000' } })
  .composite(rows.map((r, i) => ({ input: r, left: 0, top: i * meta.height }))).png().toFile(`${out}/muscle-look${webgl ? '-webgl' : ''}.png`);
console.log(`wrote ${out}/muscle-look${webgl ? '-webgl' : ''}.png (columns: muscles, no muscles, difference x8; rows: ${POSES.map((p) => p[0]).join(', ')})`);
