// Full screen, Zen and viewport fill test (run at both sizes), plus the plant-sway airflow uniforms.
//   node tools/shot.mjs --only=desktop --steps=tools/steps/fullscreen.mjs --wait=2500
export default async (page, shot, name) => {
  const fill = () => page.evaluate(() => {
    const c = document.querySelector('#view canvas'), r = c.getBoundingClientRect();
    return { win: [innerWidth, innerHeight], canvasCss: [Math.round(r.width), Math.round(r.height), Math.round(r.left), Math.round(r.top)], buffer: [c.width, c.height], fs: !!document.fullscreenElement, zen: document.body.classList.contains('zen'), docScroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight] };
  });
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(2500);
  const f0 = await fill();
  console.log(name, 'start', JSON.stringify(f0));
  const ok = (f) => f.canvasCss[0] === f.win[0] && f.canvasCss[1] === f.win[1] && f.canvasCss[2] === 0 && f.canvasCss[3] === 0 && f.docScroll[0] <= f.win[0] && f.docScroll[1] <= f.win[1];
  console.log(name, 'canvas fills viewport:', ok(f0));
  await shot('fs-hud');
  // Full screen button (feature detected) and Shift+F.
  await page.keyboard.press('Shift+F');
  await page.waitForTimeout(800);
  const f1 = await fill();
  console.log(name, 'after Shift+F', JSON.stringify(f1), 'fills:', ok(f1));
  await page.keyboard.press('Shift+F');
  await page.waitForTimeout(600);
  // Zen.
  await page.keyboard.press('Shift+Z');
  await page.waitForTimeout(600);
  const z = await page.evaluate(() => ({ zen: document.body.classList.contains('zen'), ui: getComputedStyle(document.getElementById('ui')).display, exit: getComputedStyle(document.querySelector('.zen-exit')).display }));
  console.log(name, 'zen', JSON.stringify(z));
  await shot('fs-zen');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  console.log(name, 'zen off', await page.evaluate(() => document.body.classList.contains('zen')));
  // Airflow uniforms: paused = still, fan = sway, ambient = tiny.
  const air = await page.evaluate(async () => {
    const AIR = window.__AIR;
    const g = window.game, E = g.world.env;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const read = () => ({ air: +AIR.air.value.toFixed(3), flow: +AIR.flow.value.toFixed(3) });
    const out = {};
    g.setSpeed(1); E.fan = 0; E.fogger = 0; await wait(1500); out.ambient = read();
    E.fan = 1; await wait(1500); out.fan = read();
    E.fan = 0; E.fogger = 1; await wait(1500); out.fogger = read();
    E.fogger = 0; g.setSpeed(0); await wait(1500); out.paused = read();
    g.setSpeed(1);
    return out;
  });
  console.log(name, 'airflow', JSON.stringify(air));
};
