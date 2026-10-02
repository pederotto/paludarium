// Reads recordings made by the metrics recorder (src/diag, docs/METRICS.md) and prints what they say.
//
//   node tools/metrics-report.mjs                    the newest recording
//   node tools/metrics-report.mjs --list             one line per recording
//   node tools/metrics-report.mjs <name> [<name>…]   recordings whose file name contains <name> (an id, a label, a date), or a path
//   node tools/metrics-report.mjs --last=3           the three newest
//   node tools/metrics-report.mjs --compare <a> <b>  the same numbers side by side (a is the baseline)
//   --json[=file]   the summary as JSON          --snaps   save the pictures of the screen to metrics/snapshots/<id>/
//   --dir=<folder>  where the recordings are (default metrics/, or $PALUDARIUM_METRICS_DIR)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNdjson, summarize, renderText, compareText } from '../src/diag/report.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const args = process.argv.slice(2);
const flag = (k) => args.some((a) => a === `--${k}` || a.startsWith(`--${k}=`));
const opt = (k, d = '') => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const names = args.filter((a) => !a.startsWith('--'));
const dir = path.resolve(opt('dir', process.env.PALUDARIUM_METRICS_DIR ?? path.join(root, 'metrics')));
const sessionsDir = path.join(dir, 'sessions');

const all = () => (fs.existsSync(sessionsDir) ? fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.ndjson')).sort() : []);
const load = (file) => { const S = summarize(parseNdjson(fs.readFileSync(file, 'utf8'))); S.file = file; return S; };

function pick(list) {
  if (!names.length) return list.slice(-Math.max(1, +opt('last', 1))).map((f) => path.join(sessionsDir, f));
  const out = [];
  for (const n of names) {
    if (fs.existsSync(n) && fs.statSync(n).isFile()) { out.push(path.resolve(n)); continue; }
    const hit = list.filter((f) => f.includes(n));
    if (!hit.length) { console.error(`no recording matches "${n}" in ${sessionsDir}`); process.exit(1); }
    out.push(...(flag('compare') ? hit.slice(-1) : hit).map((f) => path.join(sessionsDir, f)));
  }
  return out;
}

const list = all();
if (!list.length && !names.some((n) => fs.existsSync(n))) { console.error(`no recordings in ${sessionsDir}. Run the game with ?metrics (npm run metrics:serve) or node tools/metrics-run.mjs.`); process.exit(1); }

if (flag('list')) {
  for (const f of list) {
    try {
      const S = load(path.join(sessionsDir, f)), H = S.headline;
      console.log(`${f.replace('.ndjson', '').padEnd(46)} ${String(Math.round(S.durationS)).padStart(4)} s  ${String(H.fps).padStart(5)} fps p95 ${String(H.p95).padStart(5)}  ${S.gpu.api || '?'}  ${S.device.os} ${S.device.browser}  ${S.gpu.name.slice(0, 40)}${S.findings.some((x) => x.sev === 'bad') ? '  ✗' : ''}`);
    } catch (e) { console.log(`${f}  (unreadable: ${e.message})`); }
  }
  process.exit(0);
}

const files = pick(list);
if (flag('compare')) {
  if (files.length < 2) { console.error('--compare needs two recordings'); process.exit(1); }
  console.log(compareText(load(files[0]), load(files[1])));
  process.exit(0);
}

const jsonOut = flag('json') ? opt('json', '-') : null;
const outs = [];
for (const file of files) {
  const S = load(file);
  if (flag('snaps')) {
    const snapDir = path.join(dir, 'snapshots', S.sid);
    fs.mkdirSync(snapDir, { recursive: true });
    let i = 0;
    for (const r of parseNdjson(fs.readFileSync(file, 'utf8'))) {
      if (r.k !== 'snap') continue;
      const f = path.join(snapDir, `${String(++i).padStart(2, '0')}-${String(r.why).replace(/[^\w-]+/g, '_')}-${Math.round(r.t / 1000)}s.jpg`);
      fs.writeFileSync(f, Buffer.from(r.jpeg, 'base64'));
      console.error('snapshot', path.relative(root, f));
    }
  }
  if (jsonOut) outs.push(S); else console.log(renderText(S) + (files.length > 1 ? '\n\n---\n' : ''));
}
if (jsonOut) {
  const text = JSON.stringify(outs.length === 1 ? outs[0] : outs, null, 1);
  if (jsonOut === '-') console.log(text); else fs.writeFileSync(jsonOut, text);
}
