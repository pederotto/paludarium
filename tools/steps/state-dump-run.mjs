// Runs tools/steps/state-dump.mjs in a headless Chrome against a running dev server and prints the counters.
//   node tools/steps/state-dump-run.mjs --preset=karst --tier=standard --seed=1 --days=1 [--mix='gecko:3,skink:2'] [--every=10]
//        [--speed=1] [--out=test-output/state/] [--url=http://127.0.0.1:4630/]      (all flags: state-dump.mjs header)
//   Stall guard: 120 s without output kills the Chrome process group this runner started and exits 2.
import fs from 'node:fs';
import { chromium } from 'playwright';
import { parseArgs, runDump } from './state-dump.mjs';
import { parseDump, summary, formatSummary } from './state-counters.mjs';

const cfg = parseArgs();
const server = await chromium.launchServer({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const pid = server.process()?.pid;
const browser = await chromium.connect(server.wsEndpoint());
let last = Date.now();
const say = (...a) => { last = Date.now(); console.log(...a); };
const dog = setInterval(() => {
  if (Date.now() - last < 120000) return;
  console.error(`state-dump-run: no output for 120 s, killing Chrome pid ${pid} (its process group) and exiting`);
  try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  process.exit(2);
}, 5000);
say(`state-dump-run: chrome pid ${pid}`);
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage();
  await page.goto(cfg.url, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.game, null, { timeout: 300000 });
  say('state-dump-run: page loaded');
  await page.waitForLoadState('networkidle', { timeout: 100000 }).catch(() => say('state-dump-run: network never went idle, going on'));
  await page.waitForTimeout(2500);
  say('state-dump-run: page ready');
  const r = await runDump(page, cfg, say);
  say(`wrote ${r.file}: ${r.rows} rows, ${r.end.frames} frames, ${r.gameDays.toFixed(2)} game days, wall ${r.wallS.toFixed(0)} s = ${(r.wallS / Math.max(1e-9, r.gameDays)).toFixed(0)} s per game day (${(r.wallS / Math.max(1e-9, cfg.seconds / 3600)).toFixed(0)} s per animal hour); frames that threw ${r.end.thrown}${r.end.errors.length ? ' ' + r.end.errors[0].slice(0, 200) : ''}`);
  const d = parseDump(fs.readFileSync(r.file, 'utf8'));
  const s = summary(d.rows, d.hdr, d.end);
  console.log(formatSummary(s));
  if (!s.coverage.ok || r.end.thrown || !d.rows.length) process.exitCode = 1;
} finally { await browser.close().catch(() => {}); await server.close(); clearInterval(dog); }
