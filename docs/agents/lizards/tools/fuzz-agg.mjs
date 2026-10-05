// Sums interact-fuzz JSON lines (lapse or ff mode): per preset x speed, counts per seed, tunnels by species and samples.
//   node docs/agents/lizards/tools/fuzz-agg.mjs <log.jsonl>
import fs from 'node:fs';
const L = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const K = ['tunnel', 'tunnelReloc', 'inSolid', 'stuck', 'relocJump', 'hopCut', 'hangCut', 'floating'];
const out = {};
for (const r of L) for (const [name, v] of (r.cfg ? Object.entries(r.cfg) : [[r.mode, r]])) {
  const o = (out[`${r.preset} ${name}`] ??= { seeds: {}, bySp: {}, ex: [] }); const c = v?.cnt ?? {};
  for (const k of K) o.seeds[k] = (o.seeds[k] ?? '') + `s${r.seed}:${Object.values(c[k] ?? {}).reduce((a, b) => a + b, 0)} `;
  for (const k of ['tunnel', 'tunnelReloc']) for (const [sp, n] of Object.entries(c[k] ?? {})) o.bySp[`${k}/${sp}`] = (o.bySp[`${k}/${sp}`] ?? 0) + n;
  for (const k of ['tunnel', 'tunnelReloc']) for (const h of (v?.an?.[k] ?? []).slice(0, 6)) o.ex.push(`${k === 'tunnel' ? 'T' : 'R'} ${h.sp}/${h.kind} d${h.d} by=${h.by ?? '-'} do=${h.doing ?? '-'} hop=${h.hop ?? '-'}`);
}
for (const [k, o] of Object.entries(out)) console.log(k, JSON.stringify(o.seeds), JSON.stringify(o.bySp), '\n   ', o.ex.slice(0, 8).join(' | '));
