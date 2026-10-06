// Pictures of the lab's newer sheets on the phone layout: the Arena sheet with obstacles, Selected with the random path controls, and Random scenarios.
export default async (page, shot, name) => {
  await page.waitForFunction(() => window.lab?.L.ready.value, null, { timeout: 90000 });
  await page.evaluate(async () => {
    const lab = window.lab;
    await lab.arena({ ground: 'shore', depth: 5 });
    lab.obstacles.add({ kind: 'wall', w: 24, d: 2, h: 5, rot: 0.5 }, -24, 2); lab.obstacles.add({ kind: 'boulder', size: 10, rot: 0 }, -34, -8); lab.obstacles.add({ kind: 'ramp', w: 16, d: 10, h: 4, rot: 0 }, -10, 10);
    lab.add('gecko', 1, -20, -8); lab.add('toad', 1, -36, 8); lab.add('panther', 1, -8, -2);
    lab.L.sel.value = lab.animals()[0]; lab.driver.random('mixed', 21); lab.L.dtab.value = 'path'; lab.rate(4); lab.view('top');
  });
  await page.waitForTimeout(7000);
  await page.evaluate(() => { window.lab.L.tab.value = 'sel'; });
  await page.waitForTimeout(600);
  await shot('lab-phone-selected');
  await page.evaluate(() => { window.lab.L.tab.value = 'world'; });
  await page.waitForTimeout(600);
  await shot('lab-phone-arena');
  await page.evaluate(() => { window.lab.L.tab.value = 'fuzz'; });
  await page.waitForTimeout(600);
  await shot('lab-phone-random');
};
