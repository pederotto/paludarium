// Starts the starter tank, checks the ambience graph runs and makes sound (RMS via an analyser).
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(4000);
  const r = await page.evaluate(async () => {
    const a = window.__audio;
    a.start();
    await new Promise((r) => setTimeout(r, 500));
    const an = a.ac.createAnalyser(); an.fftSize = 2048; a.master.connect(an);
    await new Promise((r) => setTimeout(r, 4000));
    const buf = new Float32Array(an.fftSize); an.getFloatTimeDomainData(buf);
    const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
    return { state: a.ac.state, on: a.on, vol: a.volume, rms: +rms.toFixed(5), water: a.water.gain.value };
  });
  console.log('audio', JSON.stringify(r));
  console.log('errors', JSON.stringify(await page.evaluate(() => window.__errs.slice(0, 5))));
};
