// Pure counters over a state dump (tools/steps/state-dump.mjs; row format: docs/agents/lizards/CONTRACTS.md "State dump row").
// A dump is JSON lines: a header ({hdr:1,...}), one row per animal per sample, a footer ({end:1,...}). Everything here takes the rows
// (an array, in file order = time order per animal) and returns plain numbers, so a check can read them without a browser.
//   node tools/steps/state-counters.mjs test-output/state/<dump>.jsonl [--T=60] [--pileT=300] [--r=1]
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function parseDump(text) {
  const rows = []; let hdr = null, end = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const o = JSON.parse(line);
    if (o.hdr) hdr = o; else if (o.end) end = o; else rows.push(o);
  }
  return { hdr, rows, end };
}

const byId = (rows) => { const m = new Map(); for (const r of rows) { let l = m.get(r.id); if (!l) m.set(r.id, l = []); l.push(r); } return m; };
const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const bump = (o, k, v = 1) => { o[k] = (o[k] ?? 0) + v; };

// Stuck: awake, has a goal farther than `r` cm, and stayed within `r` cm (3-D) of where the run began for longer than T s.
// One episode per run; its dur is the last still sample minus the first. Needs the dump's `every` <= T / 3 to resolve T.
export function stuck(rows, { T = 60, r = 1 } = {}) {
  const episodes = [];
  for (const [id, list] of byId(rows)) {
    let anchor = null, ep = null;
    for (const row of list) {
      if (!(row.awake && row.gd != null && row.gd > r)) { anchor = null; ep = null; continue; }
      if (!anchor || d3(row, anchor) > r) { anchor = row; ep = null; continue; }
      const dur = row.t - anchor.t;
      if (dur > T) {
        if (!ep) { ep = { id, sp: row.sp, t0: anchor.t, day: anchor.day, hour: anchor.hour, mode: row.mode, x: anchor.x, y: anchor.y, z: anchor.z, dur }; episodes.push(ep); }
        ep.dur = dur;
      }
    }
  }
  const bySp = {};
  for (const e of episodes) bump(bySp, e.sp);
  return { count: episodes.length, maxDur: episodes.reduce((m, e) => Math.max(m, e.dur), 0), animals: new Set(episodes.map((e) => e.id)).size, bySp, episodes };
}

// Pile: 3 or more animals within one body length of each other (connected groups: A near B near C) and the same three staying
// together longer than T s. Body length per species from `sizes` (the dump header has them); a pair uses the longer of the two.
// awakeOnly drops rows with awake = 0 first (a tucked-in gecko group is natural: herp.js:523 sleeps in groups).
// overlap (N11c, the lead's rule: a pile is bodies that interpenetrate, not animals that touch; springtails, isopods and cory
// aggregate in life): when set, two animals link only while their centres are closer than overlap x their mean body length
// (0.5: each body reaches past the other's middle by a quarter length), with lengths from `real` (published adult lengths,
// REAL_LEN_CM) before `sizes` (the dump header: SPECIES.size x 4, state-dump.mjs:181, 3-25x too long for the crews).
export const REAL_LEN_CM = { springtail: 0.2, springpink: 0.2, springsea: 0.2, isopod: 0.4, purpleiso: 0.5, pandaking: 2.5, cory: 5.5, guppy: 3.5, pygmy: 3, redeye: 6 };
export const PILE_OVERLAP = 0.5;
export function pile(rows, { T = 300, sizes = {}, fallbackLen = 5, awakeOnly = false, overlap = null, real = REAL_LEN_CM } = {}) {
  const len = (sp) => (overlap ? real[sp] : null) ?? sizes[sp] ?? fallbackLen;
  const reach = overlap ? (a, b) => (overlap * (len(a) + len(b))) / 2 : (a, b) => Math.max(len(a), len(b));
  const at = new Map();
  for (const r of rows) { if (awakeOnly && !r.awake) continue; let l = at.get(r.t); if (!l) at.set(r.t, l = []); l.push(r); }
  const episodes = [];
  const close = (c) => { if (c.last - c.t0 > T) episodes.push({ ids: [...c.ids], size: c.ids.size, species: c.species, t0: c.t0, dur: c.last - c.t0, day: c.day, hour: c.hour, x: c.x, y: c.y, z: c.z }); };
  let active = [];
  for (const t of [...at.keys()].sort((a, b) => a - b)) {
    const g = at.get(t), par = g.map((_, i) => i);
    const find = (i) => (par[i] === i ? i : (par[i] = find(par[i])));
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) if (d3(g[i], g[j]) <= reach(g[i].sp, g[j].sp)) par[find(i)] = find(j);
    const comps = new Map();
    g.forEach((row, i) => { const k = find(i); let l = comps.get(k); if (!l) comps.set(k, l = []); l.push(row); });
    const next = [], used = new Set();
    for (const comp of comps.values()) {
      if (comp.length < 3) continue;
      const ids = new Set(comp.map((r) => r.id));
      let hit = null;
      for (const c of active) { if (used.has(c)) continue; let k = 0; for (const id of c.ids) if (ids.has(id)) k++; if (k >= 3) { hit = c; break; } }
      if (hit) { used.add(hit); hit.ids = new Set([...hit.ids].filter((id) => ids.has(id))); hit.last = t; next.push(hit); }
      else { const species = {}; for (const r of comp) bump(species, r.sp); next.push({ ids, species, t0: t, last: t, day: comp[0].day, hour: comp[0].hour, x: comp[0].x, y: comp[0].y, z: comp[0].z }); }
    }
    for (const c of active) if (!used.has(c)) close(c);
    active = next;
  }
  for (const c of active) close(c);
  return { count: episodes.length, maxDur: episodes.reduce((m, e) => Math.max(m, e.dur), 0), episodes };
}

// Share of samples under the water surface, per species: all rows, awake rows, and by lights (day = hour in [on, off)).
export function waterTime(rows, { lights = [8, 20] } = {}) {
  const out = {};
  for (const r of rows) {
    const q = (out[r.sp] ??= { ids: new Set(), rows: 0, water: 0, awakeRows: 0, awakeWater: 0, dayRows: 0, dayWater: 0, nightRows: 0, nightWater: 0, swim: 0 });
    q.ids.add(r.id); q.rows++; q.water += r.inWater ? 1 : 0; q.swim += r.swim ? 1 : 0;
    if (r.awake) { q.awakeRows++; q.awakeWater += r.inWater ? 1 : 0; }
    if (r.hour >= lights[0] && r.hour < lights[1]) { q.dayRows++; q.dayWater += r.inWater ? 1 : 0; } else { q.nightRows++; q.nightWater += r.inWater ? 1 : 0; }
  }
  const f = (a, b) => (b ? a / b : null);
  for (const q of Object.values(out)) { q.animals = q.ids.size; delete q.ids; q.share = f(q.water, q.rows); q.shareAwake = f(q.awakeWater, q.awakeRows); q.dayShare = f(q.dayWater, q.dayRows); q.nightShare = f(q.nightWater, q.nightRows); q.swimShare = f(q.swim, q.rows); }
  return out;
}

// Rows with the body inside a solid (the game's own occupancy test), the animals involved, and the runs of consecutive samples.
export function inSolid(rows) {
  const bySp = {}, ids = new Set();
  let total = 0, episodes = 0;
  for (const [id, list] of byId(rows)) {
    let prev = false;
    for (const r of list) {
      const q = (bySp[r.sp] ??= { rows: 0, animals: new Set(), episodes: 0 });
      if (r.inSolid) { q.rows++; total++; q.animals.add(id); ids.add(id); if (!prev) { q.episodes++; episodes++; } }
      prev = !!r.inSolid;
    }
  }
  for (const q of Object.values(bySp)) q.animals = q.animals.size;
  return { rows: total, animals: ids.size, episodes, bySp };
}

// Steps whose segment crossed a solid between two free ends. Counted in the page (tun = steps since the previous sample): a dump
// holds no solids and its samples are seconds apart, so the segments cannot be rebuilt from it.
export function tunnel(rows) {
  const bySp = {}; let total = 0;
  for (const r of rows) { if (r.tun) { bump(bySp, r.sp, r.tun); total += r.tun; } }
  return { total, bySp };
}

// Every animal that has a row at the last sample has rows at every sample from its first on (no gaps); animals the footer lists
// as alive must have a row at the last sample.
export function coverage(rows, end = null) {
  const ts = [...new Set(rows.map((r) => r.t))].sort((a, b) => a - b);
  const last = ts[ts.length - 1], lists = byId(rows);
  const gaps = [], missing = [];
  for (const [id, list] of lists) {
    if (list[list.length - 1].t !== last) continue;
    const expected = ts.filter((t) => t >= list[0].t).length;
    if (list.length !== expected) gaps.push({ id, rows: list.length, expected });
  }
  for (const id of end?.alive ?? []) if (!lists.has(id) || lists.get(id)[lists.get(id).length - 1].t !== last) missing.push(id);
  return { samples: ts.length, animals: lists.size, atEnd: [...lists.values()].filter((l) => l[l.length - 1].t === last).length, gaps, missing, ok: !gaps.length && !missing.length && ts.length > 0 };
}

// One table: per species, everything above.
export function summary(rows, hdr = null, end = null, { T = 60, r = 1, pileT = 300 } = {}) {
  const sizes = hdr?.sizes ?? {};
  const st = stuck(rows, { T, r }), pa = pile(rows, { T: pileT, sizes, awakeOnly: true, overlap: PILE_OVERLAP }), pl = pile(rows, { T: pileT, sizes, overlap: PILE_OVERLAP }), wt = waterTime(rows, { lights: hdr?.lights }), sol = inSolid(rows), tn = tunnel(rows);
  const species = {}, sp0 = new Map(rows.map((x) => [x.id, x.sp]));
  for (const x of rows) { const q = (species[x.sp] ??= { ids: new Set(), rows: 0 }); q.ids.add(x.id); q.rows++; }
  const pcount = (p, sp) => p.episodes.filter((e) => e.species[sp]).length;
  for (const [sp, q] of Object.entries(species)) {
    q.count = q.ids.size; delete q.ids;
    q.water = wt[sp]?.share ?? 0; q.waterAwake = wt[sp]?.shareAwake ?? 0; q.waterDay = wt[sp]?.dayShare ?? 0; q.waterNight = wt[sp]?.nightShare ?? 0;
    q.stuck = st.bySp[sp] ?? 0; q.pileAwake = pcount(pa, sp); q.pileAll = pcount(pl, sp); q.inSolid = sol.bySp[sp]?.rows ?? 0; q.tun = tn.bySp[sp] ?? 0;
  }
  return { T, species, gameStuck: end?.stuckStats ?? null, stuck: st, pileAwake: pa, pileAll: pl, inSolid: sol, tunnel: tn, coverage: coverage(rows, end), ids: sp0.size };
}

export function formatSummary(s) {
  const pc = (v) => (v == null ? '-' : (100 * v).toFixed(1) + '%');
  const L = ['species      animals  rows    water(all/awake/day/night)        stuck  pile(awake/all)  inSolid  tun'];
  for (const [sp, q] of Object.entries(s.species)) L.push(`${sp.padEnd(12)} ${String(q.count).padEnd(8)} ${String(q.rows).padEnd(7)} ${[pc(q.water), pc(q.waterAwake), pc(q.waterDay), pc(q.waterNight)].join(' / ').padEnd(33)} ${String(q.stuck).padEnd(6)} ${(q.pileAwake + ' / ' + q.pileAll).padEnd(16)} ${String(q.inSolid).padEnd(8)} ${q.tun}`);
  const c = s.coverage;
  L.push(`coverage: ${c.ok ? 'OK' : 'FAIL'} (${c.animals} animals, ${c.atEnd} present at the last of ${c.samples} samples, ${c.gaps.length} with gaps, ${c.missing.length} alive without a final row)`);
  L.push(`stuck (T=${s.T} s): ${s.stuck.count} episodes, longest ${s.stuck.maxDur} s; the game's own stuckStats: ${JSON.stringify(s.gameStuck)}; pile: ${s.pileAwake.count} awake / ${s.pileAll.count} all (longest ${s.pileAll.maxDur} s); inSolid: ${s.inSolid.rows} rows, ${s.inSolid.animals} animals; tunnel: ${s.tunnel.total}`);
  return L.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), file = args.find((a) => !a.startsWith('--'));
  const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? +a.split('=')[1] : d; };
  if (!file) { console.log('usage: node tools/steps/state-counters.mjs <dump.jsonl> [--T=60] [--pileT=300] [--r=1]'); process.exit(1); }
  const { hdr, rows, end } = parseDump(fs.readFileSync(file, 'utf8'));
  const s = summary(rows, hdr, end, { T: opt('T', 60), r: opt('r', 1), pileT: opt('pileT', 300) });
  console.log(formatSummary(s));
  for (const e of s.stuck.episodes.slice(0, 8)) console.log(`  stuck ${e.id} day ${e.day} ${e.hour} h  t=${e.t0}  ${e.dur} s in ${e.mode} at (${e.x}, ${e.y}, ${e.z})`);
}
