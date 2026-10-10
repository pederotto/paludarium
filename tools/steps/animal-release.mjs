// "One" releases one: the Animals tool (Explorer smart bar, Naturalist options) places exactly the count the player chose, and a
// guppy batch is a variety of lines (different strains, both sexes), not N copies of the first listed strain. The gene card keeps
// its loci out of sight until "Genes" is pressed.
//   node tools/shot.mjs --url=http://127.0.0.1:4890/ --only=desktop --steps=tools/steps/animal-release.mjs --wait=2500
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForSelector('.modecard', { timeout: 90000 });
  await page.locator('.modecard', { hasText: 'Explorer' }).click({ force: true });
  await page.getByRole('button', { name: /Sandbox: the starter paludarium/ }).click({ force: true });
  await page.waitForFunction(() => document.querySelector('.rail'), null, { timeout: 90000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => { const W = window.game.world; W.plants.clear(); W.animals.clear(); W.decor.clear(); W.groundChanged(); });
  const wet = await page.evaluate(() => {
    const W = window.game.world, L = W.water.level;
    for (let x = -30; x <= 30; x += 2) for (let z = -15; z <= 15; z += 2) if (L - W.terrain.heightAt(x, z) > 8) return { x, z };
  });
  const run = (n, id = 'guppy') => page.evaluate(async ({ wet, n, id }) => {
    const T = window.__tools, W = window.game.world, { S } = await import('/src/ui/store.js');
    const before = W.animals.by[id].length;
    S.sub.value = { ...S.sub.value, animal: id, smartN: n };
    T.setTool('animal');
    const Vector3 = window.game.camera.position.constructor;
    T.smart.animals(id, { point: new Vector3(wet.x, 0, wet.z) }, T.smart.count);
    const a = W.animals.by[id].slice(before);
    return { n: a.length, morphs: [...new Set(a.map((x) => x.morph))].length, sexes: a.map((x) => (x.female ? 'F' : 'M')).join(''), list: a.map((x) => x.morph) };
  }, { wet, n, id });
  const one = await run(1), three = await run(3), five = await run(5);
  console.log('one', JSON.stringify(one)); console.log('three', JSON.stringify(three)); console.log('five', JSON.stringify(five));
  const bad = [];
  if (one.n !== 1) bad.push('One released ' + one.n);
  if (three.n !== 3 || three.morphs < 3) bad.push('3 should be 3 different lines: ' + JSON.stringify(three));
  if (five.n !== 5 || five.morphs < 4) bad.push('5 should be mostly different lines: ' + JSON.stringify(five));
  // neon tetras: the smart bar's One must not release the shoal of 6
  const neon = await run(1, 'neon');
  console.log('neon one', JSON.stringify(neon));
  if (neon.n !== 1) bad.push('neon One released ' + neon.n);
  // the gene card: loci hidden until 'Genes' is pressed
  await page.evaluate(async () => { const { S } = await import('/src/ui/store.js'); S.selection.value = { kind: 'animal', obj: window.game.world.animals.by.guppy[0] }; });
  await page.waitForSelector('.gene-card', { timeout: 10000 });
  const shown = () => page.evaluate(() => !!document.querySelector('.gene-card .gene-loci'));
  if (await shown()) bad.push('gene loci visible before Genes was pressed');
  await shot('genes-hidden');
  await page.locator('.gene-card .gene-toggle').click({ force: true });
  await page.waitForTimeout(300);
  if (!(await shown())) bad.push('Genes did not show the loci');
  await shot('genes-shown');
  await page.locator('.gene-card .gene-toggle').click({ force: true });
  console.log(bad.length ? 'FAIL ' + bad.join('; ') : 'ANIMAL-RELEASE ok');
  if (bad.length) process.exitCode = 1;
};
