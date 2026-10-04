// In-game close-ups of the skinned frogs (standalone; docs/SKELETON.md "Runtime"): the starter tank by day, a camera a few cm from a
// frog of each species present, the frog walking (animals run normally for a moment, then the game is paused for the picture),
// with and without the skeleton (?noskin), so the pair shows the near level of detail on its bones against the vertex rig.
//
//   node tools/steps/skin-look.mjs [--url=http://127.0.0.1:4478/] [--out=test-output/skin] [--webgl=1] [--ids=dartfrog,strawberry]
//
// Prints per species how many animals drew skinned (window.__skin.drawn) and page errors.
import { chromium } from 'playwright';
import fs from 'node:fs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const url = arg('url', 'http://127.0.0.1:4478/'), out = arg('out', 'test-output/skin'), webgl = arg('webgl', '0') === '1';
const ids = arg('ids', 'dartfrog,strawberry,leucomelas,auratus,toad,redeye').split(',');
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
for (const mode of ['skin', 'noskin']) {
  const page = await (await browser.newContext({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message ?? e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  await page.goto(`${url}?quality=high&fixedres${webgl ? '&webgl' : ''}${mode === 'noskin' ? '&noskin' : ''}`, { waitUntil: 'load', timeout: 240000 });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 }).catch(() => {});
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForFunction(() => window.game?.world?.animals, null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(5000);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  const line = [];
  for (const id of ids) {
    const ok = await page.evaluate((id) => {
      const g = window.game, A = g.world.animals, list = A.by[id];
      if (!list?.length) {
        // (a species the starter tank lacks: add one where the first frog is)
        const f = A.by.dartfrog?.[0];
        if (!A.add || !f) return false;
        try { A.add(id, f.pos.clone()); } catch { return false; }
      }
      g.setSpeed?.(1);
      const E = g.world.env; if (E) E.minute = Math.floor(E.minute / 1440) * 1440 + 12 * 60;     // (by day: night renders are black)
      return true;
    }, id);
    if (!ok) { line.push(`${id}: absent`); continue; }
    await page.waitForTimeout(1500);
    const r = await page.evaluate((id) => {
      const g = window.game, a = g.world.animals.by[id]?.[0];
      if (!a) return null;
      g.setSpeed(0);
      const p = a.pos, yaw = a.yaw ?? 0, side = [Math.cos(yaw), -Math.sin(yaw)];
      g.rig.stopOrbit?.(); g.rig.moved = true;
      g.controls.setLookAt(p.x + side[0] * 7 + Math.sin(yaw) * 4, p.y + 4, p.z + side[1] * 7 + Math.cos(yaw) * 4, p.x, p.y + 0.8, p.z, false);
      return { drawn: window.__skin?.drawn ?? 0 };
    }, id);
    await page.waitForTimeout(1200);
    const drawn = await page.evaluate(() => window.__skin?.drawn ?? 0);
    await page.screenshot({ path: `${out}/${id}-${mode}${webgl ? '-webgl' : ''}.png` });
    line.push(`${id}: skinned ${drawn}`);
    await page.evaluate(() => window.game.setSpeed(1));
  }
  console.log(mode, webgl ? 'WebGL2' : 'WebGPU', line.join(', '), errors.length ? '\n  errors: ' + [...new Set(errors)].slice(0, 4).join(' | ') : '');
  await page.close();
}
await browser.close();
