// Salamanders, newts, axolotls and geckos in the real game (sim/herp.js): puts two fire salamanders, two newts, an axolotl and
// three geckos on the starter tank with some prey, runs the game for `seconds` of real time at speed index `speed` through a day
// and a night, and reports what each species did: time per mode, where, and any animal found stuck, inside a solid or stranded.
//
//   node tools/steps/herps.mjs [--url=http://localhost:5173/] [--seconds=60] [--speed=2] [--start=night|day] [--cool=15] [--hunt=1] [--life=1] [--out=test-output/herps]
//   --cool holds the air at that temperature (the starter tank is about 24 °C, too warm for a fire salamander); --hunt puts springtails
//   in front of the land animals and counts the strikes and catches; --life brings the slow things forward (a skin due, courting males,
//   a fire salamander with larvae, a gecko that is caught) and counts sheds, matings, births and dropped tails
//
// PASS when nothing threw, nobody was stuck for long and no animal was out of bounds or non-finite. The mode table is the
// thing to read (a warm tank keeps a fire salamander in its hide all night: that is right).
import { chromium } from 'playwright';
import fs from 'node:fs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const hunt = arg('hunt', '0') === '1';
const url = arg('url', 'http://localhost:5173/'), seconds = +arg('seconds', 60), speed = +arg('speed', 2), out = arg('out', 'test-output/herps'), start = arg('start', 'night'), cool = arg('cool', ''), life = arg('life', '0') === '1';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 800, height: 520 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message ?? e).slice(0, 300) + ' ' + String(e.stack ?? '').split('\n').slice(1, 4).join(' | ').slice(0, 400)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 }).catch(() => {});
await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
await page.waitForFunction(() => window.game?.world?.animals && !document.querySelector('#title, .title'), null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(3000);

await page.evaluate(([h, c, l]) => { window.__hunt = h; window.__cool = c; window.__life = l; }, [hunt, cool, life]);
const setup = await page.evaluate(({ start }) => {
  const g = window.game, W = g.world, A = W.animals, T = W.terrain;
  for (const arr of Object.values(A.by)) for (const a of [...arr]) A.remove(a, 'removed');
  const E = W.env;
  if (window.__cool !== '') { W.climate.tempAt = () => +window.__cool; E.temp = +window.__cool; }
  window.__strikes = {}; window.__caught = {};
  { const bs = A.beginStrike.bind(A), cs = A.consume.bind(A); A.beginStrike = (a, sp, o) => { window.__strikes[a.sp] = (window.__strikes[a.sp] ?? 0) + 1; return bs(a, sp, o); }; A.consume = (a, sp, pid, p) => { window.__caught[a.sp] = (window.__caught[a.sp] ?? 0) + 1; return cs(a, sp, pid, p); }; }
  E.minute = Math.floor(E.minute / 1440) * 1440 + (start === 'night' ? 22 * 60 : 10 * 60);
  const V3 = g.camera.position.constructor;
  const spot = (kind) => {
    for (let k = 0; k < 400; k++) {
      const x = (Math.random() - 0.5) * 70, z = (Math.random() - 0.5) * 30;
      const gy = T.heightAt(x, z), d = W.water.surfaceAt(x, z) - gy;
      if (kind === 'water' ? d > 4 : d < -0.5 && A.okFor('land', x, z)) return new V3(x, gy, z);
    }
    return null;
  };
  const made = [];
  const put = (id, n, kind, extra = {}) => { for (let i = 0; i < n; i++) { const p = spot(kind); if (p) { const a = A.add(id, p, { hunger: 0.5, age: 99999, ...extra }); if (a) made.push(a); } } };
  put('firesal', 2, 'land'); put('newt', 2, 'water'); put('axolotl', 1, 'water'); put('gecko', 3, 'land');
  put('springtail', 8, 'land'); put('fly', 4, 'land'); put('isopod', 4, 'land');
  if (window.__hunt) for (const h of made.filter((a) => ['firesal', 'newt', 'gecko'].includes(a.sp))) for (let i = 0; i < 3; i++) { const id = h.sp === 'newt' ? 'flake' : 'springtail'; if (id === 'flake') continue; const p = h.pos.clone(); p.x += Math.sin(h.yaw + i - 1) * (5 + i); p.z += Math.cos(h.yaw + i - 1) * (5 + i); A.add('springtail', p, {}); }
  window.__eaten0 = (A.stats?.eaten ?? 0);
  if (window.__life) {
    // Adults of both sexes (so there are pairs), and the slow things made soon.
    put('newt', 2, 'water', { age: 99999 }); put('firesal', 2, 'land', { age: 99999 }); put('axolotl', 1, 'water', { age: 99999 });
    let i = 0;
    for (const a of made.filter((x) => ['firesal', 'newt', 'axolotl'].includes(x.sp))) { a.male = (i++ % 2) === 0; a.hm = null; }
    window.__lifeRefs = made;
  }
  window.__herps = made.filter((a) => ['firesal', 'newt', 'axolotl', 'gecko'].includes(a.sp));
  window.__hist = {}; window.__bad = []; window.__ent = {};
  window.__ev = { shed: 0, mated: 0, birth: 0, drop: 0 };
  if (window.__life) {
    const orig2 = A.herp.bind(A);
    A.herp = (a, sp, arr, dt) => {
      if (!a.hm) { orig2(a, sp, arr, dt); const m = a.hm; if (m) { m.shedIn = a.sp === 'gecko' ? 0.004 : 3; if (a.male) m.courtDrive = 1; if (a.sp === 'firesal' && !a.male) { m.gravid = true; } } return; }
      orig2(a, sp, arr, dt);
      const it = a.hit;
      if (it?.shed) window.__ev.shed++;
      if (it?.mated) window.__ev.mated++;
      if (it?.birth) window.__ev.birth += it.birth;
      if (it?.dropTail) window.__ev.drop++;
    };
    // a gecko is caught now and then: a threat right on top of it
    setInterval(() => { const g = window.__herps.find((x) => x.sp === 'gecko' && !x.dead && x.hm); if (g && !window.__dropped) { window.__dropped = true; const o = A.herpThreat; A.herpThreat = (a, ...r) => (a === g ? { x: a.pos.x + 1, z: a.onWall ? -a.pos.y : a.pos.z, d: 1.2 } : o.call(A, a, ...r)); setTimeout(() => { A.herpThreat = o; }, 3000); } }, 20000);
  }
  window.__pos0 = window.__herps.map((a) => [a.sp, +a.pos.x.toFixed(1), +a.pos.z.toFixed(1)]);
  const orig = A.move.bind(A);
  A.move = (dt) => {
    orig(dt);
    for (const a of window.__herps) {
      if (a.dead || !a.hm) continue;
      const h = (window.__hist[a.sp] ??= {});
      h[a.hm.mode] = (h[a.hm.mode] ?? 0) + 1;
      if (a.__lm !== a.hm.mode) { a.__lm = a.hm.mode; const e = (window.__ent[a.sp] ??= {}); e[a.hm.mode] = (e[a.hm.mode] ?? 0) + 1; }
      if (!Number.isFinite(a.pos.x + a.pos.y + a.pos.z) || Math.abs(a.pos.x) > 100) window.__bad.push(`${a.sp} non-finite/out of bounds`);
      if ((a.stillT ?? 0) > 12) window.__bad.push(`${a.sp} stuck ${a.stillT.toFixed(0)} s in ${a.hm.mode}`);
    }
  };
  return { n: window.__herps.length, pos: window.__pos0 };
}, { start });
console.log('placed', JSON.stringify(setup));
await page.evaluate((s) => window.game.setSpeed(s), speed);
for (let t = 0; t < seconds; t += 10) {
  await page.waitForTimeout(10000);
  console.log(await page.evaluate(() => `${(window.game.world.env.minute % 1440 / 60).toFixed(1)} h  ` + window.__herps.map((a) => `${a.sp}:${a.hm?.mode}${a.onWall ? '(wall)' : a.swimming ? '(swim)' : ''}`).join(' ')));
  if (t === 20) await page.screenshot({ path: `${out}/mid.png` });
}
await page.evaluate(() => window.game.setSpeed(0));
const res = await page.evaluate(() => ({
  ev: window.__ev, tails: window.game.world.animals.tails.length, larvae: window.game.world.animals.by.tadpole.filter((t) => t.parent === 'firesal').length, strikes: window.__strikes, caught: window.__caught, hist: window.__hist, ent: window.__ent, bad: [...new Set(window.__bad)].slice(0, 12),
  end: window.__herps.map((a) => [a.sp, a.hm?.mode, +a.pos.x.toFixed(1), +a.pos.z.toFixed(1), +a.health.toFixed(2), a.hm && +a.hm.wet.toFixed(2), a.hm && +a.hm.air.toFixed(2)]),
}));
console.log('mode steps (entries) per species:');
for (const [sp, h] of Object.entries(res.hist)) console.log(' ', sp.padEnd(8), Object.entries(h).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v} (${res.ent[sp]?.[k] ?? 0})`).join(', '));
console.log('strikes', JSON.stringify(res.strikes), 'caught', JSON.stringify(res.caught), 'life', JSON.stringify(res.ev), 'tails', res.tails, 'larvae', res.larvae);
console.log('end', JSON.stringify(res.end));
console.log(res.bad.length ? 'problems: ' + res.bad.join('; ') : 'no problems', errors.length ? '\npage errors:\n' + errors.slice(0, 8).join('\n') : '');
console.log(!errors.length && !res.bad.length ? 'PASS' : 'FAIL');
await browser.close();
