// The metrics recorder works in a real browser: it hooks the game, records frames, GPU latency and the device, sees no blank frame in
// normal play, costs next to nothing, and its report is made. Prints PASS or FAIL. Needs a server that has the recorder: the dev
// server, `npm run preview` or `npm run metrics:serve` (a build served by anything else only has it when the address has ?metrics).
//   node tools/shot.mjs --steps=tools/steps/metrics.mjs --only=desktop --url=http://localhost:4173/ --query="?metrics=step&nooverlay"
export default async (page) => {
  const ok = (name, pass, detail = '') => console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  ok('the recorder is running', await page.evaluate(() => window.__metrics?.state === 'recording'));
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(9000);
  await page.evaluate(() => window.__metrics.mark('step'));
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__metrics.stop('step'));
  await page.waitForFunction(() => window.__metrics.state === 'stopped', null, { timeout: 30000 });
  const S = await page.evaluate(() => window.__metrics.summary());
  const probe = S.probe ?? {};
  const play = S.phases.find((p) => p.name === 'play');
  ok('the game was found and its frames recorded', (play?.frames ?? 0) + (play?.warm ?? 0) > 300, `${play?.frames} + ${play?.warm} warm frames in play`);
  ok('the device and the GPU are known', !!S.gpu.name && !!S.device.browser && S.device.cores > 0, `${S.gpu.api} ${S.gpu.name} | ${S.device.browser}`);
  ok('GPU latency was sampled', S.headline.gpuAvg != null && S.headline.gpuAvg >= 0, `${S.headline.gpuAvg} ms avg`);
  ok('the display refresh rate was found', S.device.hz > 0, `${S.device.hz} Hz`);
  ok('the load timeline has the game\'s marks', ['main', 'boot-end', 'showcase-end', 'ui'].every((k) => k in S.load.marks), Object.keys(S.load.marks).join(','));
  ok('the loading screen lift was seen', S.load.veil != null, `${S.load.veil} ms`);
  ok('no frame was drawn into a canvas that was then resized (a black flash)', S.blank.risk === 0, `${S.blank.risk} risk, ${S.blank.presented} presented, ${S.blank.changes} canvas changes`);
  ok('the mark was recorded with its context', S.marks.length === 1 && S.marks[0].label === 'step');
  ok('a picture of the screen was taken', S.snaps.length >= 1, `${S.snaps.length} snapshots`);
  ok('the recorder costs under 100 microseconds a frame', (probe.selfUs ?? 1e9) < 100, `${probe.selfUs} us`);
  ok('the report is produced', (await page.evaluate(() => window.__metrics.text())).includes('## Frames by phase'));
  ok('what the collector was sent equals what the page holds', await page.evaluate(() => window.__metrics.sink.state !== 'ok' || window.__metrics.sink.next === window.__metrics.sink.lines.length), `sink ${await page.evaluate(() => window.__metrics.sink.state)}`);
};
