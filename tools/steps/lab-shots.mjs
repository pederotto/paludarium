// Pictures of the test lab for a report: a shore arena with a few animals, one on a figure of eight, and on the phone the sheets.
export default async (page, shot, name) => {
  await page.waitForFunction(() => window.lab?.L.ready.value, null, { timeout: 90000 });
  await page.evaluate(() => {
    const lab = window.lab;
    lab.ground('shore'); lab.depth(5); lab.rate(4); lab.pause(false);
    lab.add('dartfrog', 3, -30, 8); lab.add('gecko', 1, -12, -14); lab.add('newt', 2, 6, 4); lab.add('neon', 6, 30, -2); lab.add('skink', 1, -24, -10); lab.add('panther', 1, -6, 12);
    lab.add('toad', 1, -22, 0);
    lab.driver.path('figure8');
    lab.view('top');
  });
  await page.waitForTimeout(16000);
  await page.evaluate(() => { window.lab.L.tab.value = 'sel'; });
  await shot('lab-overview');
  if (name === 'phone') {
    await page.evaluate(() => { window.lab.L.tab.value = 'radar'; });
    await page.waitForTimeout(500);
    await shot('lab-radar-sheet');
    await page.evaluate(() => { window.lab.L.tab.value = 'animals'; });
    await page.waitForTimeout(500);
    await shot('lab-add-sheet');
  }
};
