// Click an animal and a plant in the starter tank; capture the info banner and the zoom.
export default async (page, shot, name) => {
  await page.getByRole('button', { name: /starter paludarium/i }).click();
  await page.waitForTimeout(3000);
  // Find an animal on screen and click it.
  const pt = await page.evaluate(() => {
    const g = window.game, W = g.world;
    const a = W.animals.by.dartfrog[0] ?? W.animals.by.neon[0];
    const v = a.pos.clone().project(g.camera);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, sp: a.sp };
  });
  console.log('clicking', JSON.stringify(pt));
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(800);
  await shot('banner');
  const zoom = page.getByRole('button', { name: /Zoom in/ });
  if (await zoom.count()) { await zoom.first().click(); await page.waitForTimeout(2500); await shot('zoomed'); }
};
