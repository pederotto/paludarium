// Counts WebGPU pipeline errors for each generated preset (standard) and a nano tank, to find which content breaks a shader.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  const msgs = [];
  page.on('console', (m) => { if (m.type() === 'error') msgs.push(m.text().slice(0, 120)); });
  await page.waitForFunction(() => window.game, null, { timeout: 60000 });
  const jobs = []; for (const seed of [11, 222, 3333, 44444, 9876, 1234, 777, 31337]) for (const p of ['suriname', 'cascade', 'swamp']) jobs.push([p, 'nano', seed]);
  for (const [preset, tier, seed] of jobs) {
    const before = msgs.length;
    await page.evaluate(async ([preset, tier, seed]) => {
      const gen = await import('/src/sim/generator.js');
      const w = await window.game.loadTank(tier, { layout: 'empty' });
      gen.generateTerrarium(w, { preset, seed, tier });
    }, [preset, tier, seed]);
    await page.waitForTimeout(2500);
    console.log(preset, tier, seed, 'errors', msgs.length - before);
  }
};
