// B5a in-tank check. One Chrome, several seeds in a row through the state dump (tools/steps/state-dump.mjs runDump: same world, same
// stepping as the game loop), then each swimmer's mind (a.fm.st, src/sim/fishmind.js) and the cost counter (fishmind COST).
// Before the swim() hunk (BB/reports/B5a.hunk.patch) it finds no minds and only writes the dumps: keep them as the BASE for the tadpole check.
//   node docs/agents/lizards/tools/fishflow-tank.mjs --preset=karst --tier=standard --days=0.25 --seeds=1,2,3 \
//        --mix='neon:8,cory:4,tadpole:6' --only=neon,cory,tadpole --clear=1 --every=10 --out=test-output/b5a/after/
//   then per seed: DUMP=<jsonl> BASE=<before jsonl> node --test tests/tadpole-rest.test.mjs
// Prints per seed: filter flow (L/h), fish, share of fish time in slack water (|w| < SLACK x Us), fish held > 5 s within a body length
// of the glass or the intake in moving water, heading-vs-flow resultant (ground-distance weighted; 1 = locked to the flow), ms per frame.
import { chromium } from 'playwright';
import { parseArgs, runDump } from '../../../../tools/steps/state-dump.mjs';

const base = parseArgs();
const seeds = (process.argv.find((a) => a.startsWith('--seeds='))?.slice(8) ?? '1,2,3').split(',').map(Number);
const server = await chromium.launchServer({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist'] });
console.log(`fishflow-tank: chrome pid ${server.process()?.pid} (kill it if this script dies)`);
const browser = await chromium.connect(server.wsEndpoint());
const read = () => import('/src/sim/fishmind.js').then((M) => ({ ms: M.COST.ms, frames: M.COST.frames })).catch(() => ({ ms: 0, frames: 0 }));
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage();
  await page.goto(base.url, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.game, null, { timeout: 300000 });
  await page.waitForTimeout(4000);
  for (const seed of seeds) {
    const c0 = await page.evaluate(read);
    const r = await runDump(page, { ...base, seed }, () => {});
    const s = await page.evaluate(async ([c0]) => {
      let c1 = { ms: 0, frames: 0 };
      try { const M = await import('/src/sim/fishmind.js'); c1 = { ms: M.COST.ms, frames: M.COST.frames }; } catch { /* not loaded */ }
      const g = window.game, W = g.world ?? g.sim?.world, A = g.animals ?? W?.animals ?? g.sim?.animals;
      const fish = (A?.all ?? []).filter((a) => a.fm && !a.dead);
      const sum = (k) => fish.reduce((t, a) => t + a.fm.st[k], 0);
      const by = {};
      for (const a of fish) { const b = by[a.sp] ??= { n: 0, t: 0, slack: 0 }; b.n++; b.t += a.fm.st.t; b.slack += a.fm.st.slack; }
      return {
        lph: W?.water?.hydro?.ports?.lph ?? 0, n: fish.length, slack: sum('slack') / Math.max(1e-9, sum('t')),
        pinned: fish.filter((a) => a.fm.st.pinMax > 5).length, pinMax: Math.max(0, ...fish.map((a) => a.fm.st.pinMax)),
        R: Math.hypot(sum('c'), sum('s')) / Math.max(1e-9, sum('d')), dist: sum('d'), tiredNow: fish.filter((a) => a.fm.tired).length,
        msPerFrame: (c1.ms - c0.ms) / Math.max(1, c1.frames - c0.frames), frames: c1.frames - c0.frames,
        by: Object.fromEntries(Object.entries(by).map(([k, b]) => [k, `${b.n} fish, slack ${(100 * b.slack / Math.max(1e-9, b.t)).toFixed(1)} %`])),
      };
    }, [c0]);
    console.log(`seed ${seed}: ${r.file}\n  filter ${s.lph.toFixed(0)} L/h, ${s.n} swimmers with a mind, slack ${(100 * s.slack).toFixed(1)} %, pinned > 5 s: ${s.pinned} (longest ${s.pinMax.toFixed(1)} s), heading-vs-flow R ${s.R.toFixed(3)} over ${s.dist.toFixed(0)} cm, tired now ${s.tiredNow}, ${s.msPerFrame.toFixed(4)} ms/frame over ${s.frames} frames\n  ${JSON.stringify(s.by)}`);
  }
} finally { await browser.close().catch(() => {}); await server.close(); }
