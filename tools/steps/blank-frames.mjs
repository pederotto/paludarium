// A change of render resolution must never present a blank canvas. The graphics governor changes the resolution at the start
// of a frame, before it is drawn (Game.frame calls gfx.frame, then gfx.render); drawing first and resizing after used to leave
// one blank frame per change, a black flash on screen. This forces a change every 90 frames through the game's own frame path
// and counts blank frames in a screencast. Prints PASS or FAIL.
//   node tools/shot.mjs --steps=tools/steps/blank-frames.mjs --only=desktop
import sharp from 'sharp';

export default async (page) => {
  const ok = (name, pass, detail = '') => console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(7000);
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', (f) => { frames.push(f.data); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 40, maxWidth: 240, maxHeight: 135, everyNthFrame: 1 });
  const changes = await page.evaluate(async () => {
    const g = window.game, gov = g.gfx.governor; let n = 0, w = 1, k = 0;
    const real = gov.frame.bind(gov);
    gov.frame = () => { if (++n % 90) return null; w = w === 1 ? 0.85 : 1; k++; return { q: gov.level.q, scale: w, cap: g.gfx.maxFps, reason: 'test' }; };
    g.gfx.measuring = true;
    await new Promise((r) => setTimeout(r, 11000));
    gov.frame = real; g.gfx.adapt = 1; g.gfx.resize();
    return k;
  });
  await cdp.send('Page.stopScreencast');
  const lum = [];
  for (const d of frames) lum.push((await sharp(Buffer.from(d, 'base64')).greyscale().stats()).channels[0].mean);
  const med = [...lum].sort((a, b) => a - b)[lum.length >> 1];
  const blank = lum.filter((m) => m < 0.55 * med).length;
  ok(`${changes} forced resolution changes, ${frames.length} frames captured`, changes >= 4 && frames.length > 100);
  ok('no blank frame was presented', blank === 0, `${blank} blank`);
};
