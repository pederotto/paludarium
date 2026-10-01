// Title -> Kids' corner -> a world -> each tray sheet -> place an animal and a plant by tapping the tank -> tap an animal's card.
export default async (page, shot, name) => {
  const phone = name === 'phone';
  await page.getByRole('button', { name: /Kids' corner/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(1200);
  await shot('k1-worlds');
  await page.locator('.kw-card', { hasText: /Frog Island/ }).click({ force: true });
  await page.waitForFunction(() => document.querySelector('.k-tray'), null, { timeout: 90000 });
  await page.waitForTimeout(3500);
  await shot('k2-hud');
  const tab = (t) => page.locator('.k-tab', { hasText: t }).click({ force: true });
  await tab('Animals'); await page.waitForTimeout(900); await shot('k3-animals');
  await page.locator('.k-card', { hasText: /Guppy/ }).click({ force: true });
  await page.waitForTimeout(600); await shot('k4-place');
  const pt = phone ? { x: 195, y: 560 } : { x: 640, y: 440 };
  await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(900); await shot('k5-placed');
  await page.locator('.k-round.stop').click({ force: true });
  await tab('Plants'); await page.waitForTimeout(600);
  await page.locator('.k-card').first().click({ force: true });
  await page.mouse.click(pt.x - 120, pt.y); await page.waitForTimeout(700);
  await page.locator('.k-round.stop').click({ force: true });
  await tab('Build'); await page.waitForTimeout(600); await shot('k6-build');
  await tab('Care'); await page.waitForTimeout(600); await shot('k7-care');
  await page.locator('.k-act', { hasText: 'Feed' }).click({ force: true }); await page.waitForTimeout(600);
  await tab('More'); await page.waitForTimeout(600); await shot('k8-more');
  await page.locator('.k-act', { hasText: 'Stickers' }).click({ force: true }); await page.waitForTimeout(600); await shot('k9-stickers');
  await page.locator('.k-sh-head .k-ico').last().click({ force: true });
  // tap an animal
  const a = await page.evaluate(() => { const g = window.game, A = g.world.animals.by.dartfrog?.[0] ?? g.world.animals.by.neon[0]; const v = A.pos.clone().project(g.camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }; });
  await page.mouse.click(a.x, a.y); await page.waitForTimeout(1000); await shot('k10-card');
  console.log('errors', JSON.stringify(await page.evaluate(() => window.__errs.slice(0, 6))));
};
