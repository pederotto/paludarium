// The water-body graph: every connected region of standing or running water
// (the main pool, each pond, each stream reach) as one node, with the flow
// links between them taken from the hydraulics ledger (hydro.js).
//
// It is the shared foundation for water quality (this file: ammonia, nitrite,
// nitrate, oxygen, temperature and algae are kept per body, mixed along the
// flows) and for erosion later (the ledger and the per-cell flow field say
// where the water goes; a body says what it carries and what it receives).
//
// Pure data and arithmetic: nothing here touches the scene, so the tests run
// it under Node. Species and plant tables are handed in by sim.js.

import { clamp, lerp } from '../util/math.js';
import { filterOf, filterEff, filterClog, sourceOf, plenumBio } from '../content/equipment.js';
import { sizeFactors } from './tank.js';

export const NODE = { GROUND: 0, SUMP: 1, EXT: 2, OUT0: 3, OUTS: 12, BODY0: 15, BODIES: 48, TRANSIT: 63, MAX: 64 };

const WET_STREAM = 0.12;   // cm of water that makes a stream cell
// An air pump's airstone (content/equipment.js airpump, Env.air 0 … 1): the oxygen it adds to the main pool's target at full setting, mg/l
// (a guess: a falling sheet or a filter's return adds about 1 to 2); the other bodies of the tank feel a third of it through the stirring.
const AIR_O2 = 2.2;
const CHEM = ['ammonia', 'nitrite', 'nitrate', 'oxygen', 'temp', 'co2', 'ph', 'gh'];
// Hardscape that leaches tannins (softens and acidifies the water a little) or minerals (hardens it).
const TANNIN = { wood: 1, roots: 1, stump: 0.6, cork: 0.5, bamboopole: 0.15, floatlog: 0.8 }, MINERAL = { boulder: 0.25, spire: 0.15, cliff: 0.3, slate: 0.35, pebbles: 0.1 };
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function makeBody(uid, kind, name) {
  return {
    uid, key: uid === 0 ? 'sump' : 'b' + uid, kind, name, slot: -1,
    n: 0, area: 0, vol: 0, depth: 0, maxDepth: 0, cx: 0, cz: 0, surfY: 0, bottom: 0,
    ammonia: 0, nitrite: 0, nitrate: 0, oxygen: 7.5, temp: 23, co2: 4, algae: 0, ph: 7.4, gh: 9, flow: 0.1,
    inLph: 0, outLph: 0, dStoreLph: 0, fill: 0, spill: null, spillVer: -1,
    fishLoad: 0, plantUse: 0, letter: null, pool: null,
    sediment: 0, turbidity: 0, silt: 0,   // cm3 in suspension, cloudiness 0..1, cm3 settled so far (erosion.js)
  };
}

export class WaterBodies {
  constructor(world, H) {
    this.world = world;
    this.H = H;
    this.sump = makeBody(0, 'sump', 'Main pool');
    this.list = [this.sump];
    this.slots = new Array(NODE.BODIES).fill(null);
    this.nextUid = 1;
    this.pending = null;      // saved per-pond chemistry, matched to ponds as they are found
    this.last = null;         // what we last wrote into env (to notice outside changes)
  }

  // --- Naming the ledger's nodes ----------------------------------------------
  keyOf(id) {
    if (id === NODE.GROUND) return 'ground';
    if (id === NODE.SUMP) return 'sump';
    if (id === NODE.EXT) return 'ext';
    if (id < NODE.BODY0) return 'o' + (id - NODE.OUT0);
    return this.slots[id - NODE.BODY0]?.key ?? 'x' + id;
  }
  byKey(key) { return this.list.find((b) => b.key === key) ?? null; }

  // The body whose water is at (x, z), or null on dry ground.
  at(x, z) {
    const H = this.H, n = H.cellOf(x, z);
    if (H.res[n]) return this.sump;
    const g = H.grp[n];
    return g >= NODE.BODY0 ? this.slots[g - NODE.BODY0] ?? null : null;
  }

  // --- Finding the bodies --------------------------------------------------------
  // Called by the ledger at the start of every window: regroups the cells,
  // keeps each body's identity (and chemistry) when it is still the same
  // water, merges and splits sensibly, and measures them.
  identify(H) {
    const N = H.N, d = H.d, res = H.res, nb = H.nb, h = H.f.h, grp = H.grp, area = H.area;
    const oldGrp = grp.slice();
    const oldSlots = this.slots.slice();
    const comps = [];
    const taken = new Uint8Array(N);
    for (const p of H.pools) { comps.push({ cells: p.cells, kind: 'pool', pool: p }); for (const c of p.cells) taken[c] = 1; }
    const seen = new Uint8Array(N);
    for (let n = 0; n < N; n++) {
      if (seen[n] || taken[n] || res[n] || d[n] < WET_STREAM) continue;
      const cells = [], stack = [n];
      seen[n] = 1;
      while (stack.length) {
        const c = stack.pop();
        cells.push(c);
        for (let k = 0; k < 4; k++) {
          const m = nb[c * 4 + k];
          if (m >= 0 && !seen[m] && !taken[m] && !res[m] && d[m] >= WET_STREAM) { seen[m] = 1; stack.push(m); }
        }
      }
      if (cells.length >= 3) comps.push({ cells, kind: 'stream', pool: null });
    }
    // Measure and order by volume.
    for (const c of comps) {
      let v = 0, sx = 0, sz = 0, mx = 0, lo = Infinity, sy = 0;
      for (const n of c.cells) {
        v += d[n]; if (d[n] > mx) mx = d[n]; if (h[n] < lo) lo = h[n];
        sy += h[n] + d[n];
        const [x, z] = H.cellXZ(n); sx += x; sz += z;
      }
      const k = c.cells.length;
      Object.assign(c, { vol: v * area / 1000, depth: v / k, maxDepth: mx, cx: sx / k, cz: sz / k, surfY: sy / k, bottom: lo, area: k * area });
    }
    comps.sort((a, b) => b.vol - a.vol);
    if (comps.length > NODE.BODIES) comps.length = NODE.BODIES;
    // Match with last window's bodies by shared cells.
    const pairs = [];
    comps.forEach((c, i) => {
      const cnt = new Map();
      for (const n of c.cells) { const g = oldGrp[n]; if (g >= NODE.BODY0) cnt.set(g - NODE.BODY0, (cnt.get(g - NODE.BODY0) ?? 0) + 1); }
      c.overlap = cnt;
      for (const [s, k] of cnt) if (oldSlots[s]) pairs.push([k, i, s]);
    });
    pairs.sort((a, b) => b[0] - a[0]);
    const usedOld = new Set(), got = new Array(comps.length).fill(null);
    for (const [, i, s] of pairs) {
      if (got[i] || usedOld.has(s)) continue;
      got[i] = oldSlots[s]; usedOld.add(s);
    }
    const sump = this.sump;
    const letters = new Set(comps.map((c, i) => got[i]?.letter).filter(Boolean));
    let streamNo = 0;
    const next = new Array(NODE.BODIES).fill(null);
    const bodies = [sump];
    comps.forEach((c, i) => {
      let b = got[i];
      if (!b) {
        b = makeBody(this.nextUid++, c.kind, '');
        this.inheritChem(b, c, oldSlots);
      } else if (c.overlap.size > 1) {
        // Merged water: the mixture of what flowed together.
        this.mixInto(b, c, oldSlots);
      }
      b.kind = c.kind;
      if (b.kind === 'pool') {
        if (!b.letter) { let k = 0; while (letters.has(LETTERS[k % 26] + (k >= 26 ? Math.floor(k / 26) : ''))) k++; b.letter = LETTERS[k % 26] + (k >= 26 ? Math.floor(k / 26) : ''); letters.add(b.letter); }
        b.name = 'Pond ' + b.letter;
      } else { b.letter = null; b.name = 'Stream ' + (++streamNo); }
      b.slot = i;
      b.cells = c.cells;
      b.pool = c.pool;
      if (c.pool) c.pool.body = b;
      b.n = c.cells.length; b.area = c.area; b.vol = c.vol; b.depth = c.depth; b.maxDepth = c.maxDepth;
      b.cx = c.cx; b.cz = c.cz; b.surfY = c.surfY; b.bottom = c.bottom;
      next[i] = b;
      bodies.push(b);
    });
    // Regroup the cells.
    grp.fill(0);
    let nRes = 0, rx = 0, rz = 0, lo = Infinity;
    for (let n = 0; n < N; n++) {
      if (res[n]) {
        grp[n] = NODE.SUMP;
        if (H.level > h[n] + 0.05) { nRes++; const [x, z] = H.cellXZ(n); rx += x; rz += z; if (h[n] < lo) lo = h[n]; }
      }
    }
    comps.forEach((c, i) => { const g = NODE.BODY0 + i; for (const n of c.cells) grp[n] = g; });
    this.slots = next;
    this.list = bodies;
    sump.n = nRes; sump.area = nRes * area; sump.vol = H.resVol / 1000;
    sump.depth = nRes ? sump.vol * 1000 / sump.area : 0;
    sump.maxDepth = nRes ? Math.max(0, H.level - lo) : 0;
    sump.cx = nRes ? rx / nRes : 0; sump.cz = nRes ? rz / nRes : 0;
    sump.surfY = H.level; sump.bottom = nRes ? lo : 0;
    this.measureSpills(H);
  }

  inheritChem(b, c, oldSlots) {
    // Water that flowed in from elsewhere starts like the pool it came from
    // (saved ponds come back as they were).
    const sump = this.sump;
    let src = null;
    if (this.pending?.ponds?.length) {
      let bd = 12;
      for (const q of this.pending.ponds) {
        if (q.used) continue;
        const dd = Math.hypot(q.x - c.cx, q.z - c.cz);
        if (dd < bd) { bd = dd; src = q; }
      }
      if (src) src.used = true;
    }
    if (src) { for (const k of [...CHEM, 'algae']) if (src[k] !== undefined) b[k] = src[k]; return; }
    if (c.overlap?.size) { this.mixInto(b, c, oldSlots, true); return; }
    for (const k of [...CHEM, 'algae']) b[k] = sump[k];
  }

  mixInto(b, c, oldSlots, fresh = false) {
    let w = 0;
    const acc = {};
    for (const k of [...CHEM, 'algae']) acc[k] = 0;
    for (const [s, cnt] of c.overlap) {
      const o = oldSlots[s];
      if (!o) continue;
      const wt = cnt * Math.max(0.1, o.depth);
      w += wt;
      for (const k of Object.keys(acc)) acc[k] += o[k] * wt;
    }
    if (w <= 0) return;
    if (!fresh && c.overlap.size === 1) return;
    for (const k of Object.keys(acc)) b[k] = acc[k] / w;
  }

  // --- Sediment (erosion.js) -------------------------------------------------
  // Suspended sediment and water volume per ledger node (cm3) and what settled this
  // run: cloudiness per body, silt on its floor (which becomes detritus), a trace of nutrients.
  setSediment(sed, vol, dep, K = 220) {
    const E = this.world.env;
    for (const b of this.list) {
      const g = b === this.sump ? NODE.SUMP : b.slot >= 0 ? NODE.BODY0 + b.slot : -1;
      if (g < 0) continue;
      b.sediment = sed[g];
      b.turbidity = vol[g] > 1 ? 1 - Math.exp(-K * sed[g] / vol[g]) : 0;
      const settled = dep[g];
      if (settled > 0) {
        b.silt += settled;
        if (E && Number.isFinite(E.detritus)) E.detritus += settled * 0.002;
        if (b.vol > 0.05) b.nitrate += settled * 0.0004 / b.vol;
      }
    }
  }

  // Light that gets through the water at (x, z): 1 clear … 0.4 muddy (plants and algae use it).
  lightFactorAt(x, z) {
    const b = this.at(x, z);
    return b ? 1 - 0.6 * b.turbidity : 1;
  }

  // Spill height and direction of every pond (cached until the ground changes).
  measureSpills(H) {
    for (const b of this.list) {
      if (b.kind !== 'pool' || !b.cells.length) continue;
      if (b.spillVer !== H.groundVer || !b.spill || b.spillAt !== b.cells.length) {
        let start = b.cells[0];
        for (const n of b.cells) if (H.f.h[n] < H.f.h[start]) start = n;
        const bs = H.basin(start);
        if (bs) {
          const [sx, sz] = bs.spillCell >= 0 ? H.cellXZ(bs.spillCell) : [b.cx, b.cz];
          b.spill = { h: bs.level, cell: bs.spillCell, dir: bs.spillCell >= 0 ? dirWord(sx - b.cx, sz - b.cz) : null, toSump: bs.spillCell >= 0 && !!H.res[bs.spillCell] };
        } else b.spill = null;
        b.spillVer = H.groundVer; b.spillAt = b.cells.length;
      }
      const sp = b.spill;
      const surf = b.pool?.level ?? b.surfY;
      b.fill = sp ? clamp((surf - b.bottom) / Math.max(0.3, sp.h - b.bottom), 0, 1.2) : 0;
    }
  }

  // --- Reading the ledger ---------------------------------------------------------
  // Adds per-node figures (litres per hour in and out, storage) to the
  // ledger and copies them onto the bodies.
  annotate(ledger, S1, S0, inn, out, T) {
    const H = this.H, k = 3.6 / T;
    const sumIn = new Map(), sumOut = new Map();
    for (const l of ledger.links) {
      sumOut.set(l.from, (sumOut.get(l.from) ?? 0) + l.lph);
      sumIn.set(l.to, (sumIn.get(l.to) ?? 0) + l.lph);
    }
    const nodes = [];
    const add = (id, kind, name, extra = {}) => {
      const key = this.keyOf(id);
      nodes.push({
        key, id, kind, name, inLph: sumIn.get(key) ?? 0, outLph: sumOut.get(key) ?? 0,
        storeL: S1[id] / 1000, dStoreLph: (S1[id] - S0[id]) * k,
        imbalanceCm3: inn[id] - out[id] - (S1[id] - S0[id]), ...extra,
      });
    };
    add(NODE.SUMP, 'sump', 'Main pool');
    H.outlets.forEach((o, i) => add(H.outNode(i), 'outlet', 'Outlet ' + (i + 1), { valve: o.valve ?? 1, head: o.head ?? 0, q: (o.q ?? 0) * 3.6 }));
    this.slots.forEach((b, i) => { if (b) add(NODE.BODY0 + i, b.kind, b.name); });
    add(NODE.GROUND, 'ground', 'Wet ground');
    ledger.nodes = nodes;
    for (const n of nodes) {
      const b = this.byKey(n.key);
      if (b) { b.inLph = n.inLph; b.outLph = n.outLph; b.dStoreLph = n.dStoreLph; }
    }
    ledger.paths = this.reduce(ledger.links);
    const P = H.pump;
    ledger.pump = {
      on: P.on, running: P.running, ratedLph: P.rate, lph: P.lph, bypassLph: P.bypass, submerge: P.submerge,
      intakeDepth: Math.max(0, H.level - H.f.h[H.seed]),
      outletsLph: H.flowOut * 3.6,
    };
    ledger.evapLph = H.evapLph; ledger.topUpLph = H.topUpLph;
  }

  // The circuit without the plumbing: streams and wet ground carry water but
  // hold none, so flows between the real stops (outlets, ponds, the main pool)
  // are followed through them. Each path says what it passed through.
  reduce(links) {
    const isPass = (key) => key === 'ground' || (key[0] === 'b' && this.byKey(key)?.kind === 'stream');
    const outs = new Map();
    for (const l of links) {
      if (l.kind === 'bypass' || l.to === 'ext' || l.from === 'ext') continue;
      if (!outs.has(l.from)) outs.set(l.from, []);
      outs.get(l.from).push(l);
    }
    const paths = new Map();
    const add = (from, to, lph, via) => {
      if (from === to || lph < 0.2) return;
      const k = from + '>' + to;
      const p = paths.get(k) ?? { from, to, lph: 0, via: new Set() };
      p.lph += lph;
      for (const v of via) p.via.add(v);
      paths.set(k, p);
    };
    const walk = (src, key, amount, via, seen) => {
      const o = outs.get(key) ?? [];
      let tot = 0;
      for (const l of o) tot += l.lph;
      if (tot < 0.05 || seen.size > 12) return;
      for (const l of o) {
        const a = amount * l.lph / tot;
        if (isPass(l.to)) { if (!seen.has(l.to)) walk(src, l.to, a, [...via, l.to], new Set([...seen, l.to])); } else add(src, l.to, a, via);
      }
    };
    for (const [from, o] of outs) {
      if (isPass(from)) continue;
      for (const l of o) {
        if (isPass(l.to)) walk(from, l.to, l.lph, [l.to], new Set([l.to]));
        else add(from, l.to, l.lph, []);
      }
    }
    return [...paths.values()].map((p) => ({ from: p.from, to: p.to, lph: p.lph, via: [...p.via].filter((k) => k !== 'ground').map((k) => this.byKey(k)?.name ?? k) }));
  }

  // Plain-language problems with the circuit.
  warnings(ledger) {
    const H = this.H, P = H.pump, out = [];
    const f1 = (v) => (v >= 10 ? Math.round(v) : v.toFixed(1));
    if (!H.outlets.length) out.push({ level: 'info', text: 'No outlets yet: the pump only circulates water inside the main pool. Place an outlet to send water over the hardscape.' });
    if (!P.on) out.push({ level: 'warn', text: 'The pump is switched off, so nothing flows and the ponds will stagnate.' });
    else if (H.resVol <= 1) out.push({ level: 'bad', text: 'Pump is starving: the main pool is empty. Add water.' });
    else if (P.submerge < 0.05) out.push({ level: 'bad', text: 'Pump is starving: its intake is out of the water. Raise the water level or move the pump.' });
    else if (P.submerge < 0.9) out.push({ level: 'warn', text: `Pump is starving: the intake is only ${(H.level - H.f.h[H.seed]).toFixed(1)} cm under water, so flow is cut to ${Math.round(P.submerge * 100)}%.` });
    if (P.on && P.submerge >= 0.05) {
      H.outlets.forEach((o, i) => {
        const c = o.head > 0 ? 1 - (o.head / 80) ** 2 : 1;
        if (c < 0.7 && (o.valve ?? 1) > 0.05) out.push({ level: 'warn', text: `Outlet ${i + 1} is ${Math.round(o.head)} cm above the water: the pump delivers only ${Math.round(Math.max(0, c) * 100)}% of its rate there.` });
      });
    }
    const sumpN = ledger.nodes.find((n) => n.key === 'sump');
    if (sumpN && sumpN.dStoreLph < -12 && !H.topUp) out.push({ level: 'warn', text: `The main pool is losing ${f1(-sumpN.dStoreLph)} L/h: more water is stored upstream than comes back. Its level will keep falling.` });
    let pondFlow = 0, ret = 0;
    for (const l of ledger.links) { if (l.kind === 'outlet') pondFlow += l.lph; if (l.kind === 'return' || l.kind === 'seep') ret += l.lph; }
    let allFull = true;
    for (const b of this.list) {
      if (b.kind !== 'pool') continue;
      const net = b.inLph - b.outLph;
      const vol = b.vol;
      if (b.fill < 0.95) allFull = false;
      if (b.fill >= 0.95 && b.outLph > 2) out.push({ level: 'info', text: `${b.name} is full and spills ${b.spill?.dir ? 'toward the ' + b.spill.dir : 'over its lowest lip'}: ${f1(b.outLph)} L/h out.`, node: b.key });
      else if (b.inLph > 5 && b.outLph < 0.2 * b.inLph && net > 3 && b.fill < 0.95) {
        const cap = b.spill ? Math.max(0, (b.spill.h - (b.pool?.level ?? b.surfY))) * b.area / 1000 : 0;
        const mins = cap > 0 ? Math.round((cap / net) * 60) : null;
        out.push({ level: 'warn', text: `${b.name} gets ${f1(b.inLph)} L/h and returns ${f1(b.outLph)}: it will overflow${mins != null ? ' in about ' + (mins < 1 ? 'a minute' : mins + ' min') : ''}.`, node: b.key });
      } else if (b.inLph > 5 && b.outLph < 1 && b.fill >= 0.95) out.push({ level: 'bad', text: `${b.name} gets ${f1(b.inLph)} L/h but has no way out. It spills over its lip and floods the ground nearby.`, node: b.key });
      else if (b.inLph < 0.5 && b.outLph > 5) out.push({ level: 'warn', text: `${b.name} is draining (${f1(b.outLph)} L/h out, almost nothing in).`, node: b.key });
      else if (b.inLph < 0.5 && b.outLph < 0.5 && vol > 0.3) out.push({ level: 'info', text: `${b.name} is still water: nothing flows through it, so its chemistry will drift on its own.`, node: b.key });
    }
    if (P.running && pondFlow > 15 && ret < 0.25 * pondFlow && allFull && H.outlets.length) out.push({ level: 'bad', text: `No return path: ${f1(pondFlow)} L/h leaves the outlets but only ${f1(ret)} L/h gets back to the main pool. Dig a channel from the lowest pond down to it.` });
    const E = this.world.env;
    if (E?.filter && filterClog(E) > 0.6) out.push({ level: filterClog(E) > 0.85 ? 'bad' : 'warn', text: `The ${filterOf(E).name.toLowerCase()} is clogging with the dirt it caught: it passes ${Math.round(filterEff(E) * 100)}% of its flow. Rinse it in old tank water (Care > Water).` });
    if (H.intakeNote && ledger.t - H.intakeNote.at < 30) out.push({ level: 'info', text: H.intakeNote.text });
    return out;
  }

  // --- Chemistry ----------------------------------------------------------------
  // The nitrogen cycle, oxygen, temperature and algae per body, then mixed
  // along the flows. env keeps the volume-weighted mean so charts, goals and
  // the helper keep working. `dtMin` is game minutes.
  chemistry(dtMin, ctx) {
    const W = this.world, E = W.env, H = this.H, d = dtMin;
    const { SPECIES, PLANTS, light, rotting } = ctx;
    const list = this.list, sump = this.sump;
    sump.vol = H.resVol / 1000;
    if (!this.last) this.adoptAll(E);
    else this.adopt(E);
    const Vb = (b) => (b === sump ? Math.max(1, b.vol) : Math.max(0.25, b.vol));
    let Vtot = 0;
    for (const b of list) Vtot += Vb(b);
    const waterFrac = ctx.waterFrac ?? 0.2;
    // Who lives where: waste, fish load, plant uptake, falls.
    for (const b of list) { b.waste = 0; b.fishLoad = 0; b.plantUse = 0; b.falls = 0; }
    let shared = 0;
    for (const a of W.animals.all) {
      const sp = SPECIES[a.sp];
      if (!sp) continue;
      const k = sp.kind;
      const w = k === 'swim' ? sp.size * 0.00035 : k === 'crawlWater' ? 0.00006 : k === 'toad' || k === 'crab' ? 0.0002 : 0;
      const aq = k === 'swim' || k === 'crawlWater';
      if (!w && !aq) continue;
      const B = this.at(a.pos.x, a.pos.z);
      if (B) { B.waste += w; if (aq) B.fishLoad += sp.size; } else { shared += w; if (aq) sump.fishLoad += sp.size; }
    }
    for (const p of W.plants.list) {
      const sp = PLANTS[p.id];
      if (!sp) continue;
      const hab = sp.habitat;
      let use = 0;
      if (hab === 'aquatic' || hab === 'floating') use = p.grown * p.scale * (hab === 'floating' ? 1.6 : 1);
      else if (hab === 'emergent') use = p.grown * p.scale * 0.35;
      if (!use) continue;
      let B = this.at(p.pos.x, p.pos.z);
      if (!B && hab === 'emergent') for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) { B = this.at(p.pos.x + dx, p.pos.z + dz); if (B) break; }
      if (B) B.plantUse += use;
    }
    for (const r of W.water.falls) { const B = this.at(r.end.x, r.end.z); if (B) B.falls++; }
    const fallK = H.pump.running ? 1 : 0.3;
    const C = W.climate;
    // Light on the water (for algae) and the air above it (for warmth).
    let raw = 0, rawV = 0;
    const nitRef = Math.max(1, list.reduce((s, b) => s + b.nitrate * Vb(b), 0) / Vtot);
    // Filter, plenum and the water the tank is topped up with (content/equipment.js).
    const F = filterOf(E), src = sourceOf(E), fEff = filterEff(E);   // a clogged filter passes less water
    // The false bottom's bio-rings are one big filter bed, as far as they are under water.
    const plenum = plenumBio(E);   // (a running bed filter counts through its own row)
    let tannin = 0, mineral = 0;
    for (const p of W.decor?.pieces ?? []) { tannin += TANNIN[p.type] ?? 0; mineral += MINERAL[p.type] ?? 0; }
    const pumpTurn = H.pump?.running ? (H.pump.lph ?? 0) / Math.max(1, sump.vol) : 0;   // tank volumes an hour
    // A filter's current is its pump's jet spread through the water: the same filter stirs a cube's pool hard and barely moves a
    // show tank's (the tank's volume against the standard one, softened: a keeper points the outlet where it is needed).
    const filterStir = clamp(sizeFactors().vol ** -0.5, 0.5, 2);
    for (const b of list) {
      const V = Vb(b);
      // Every wet surface carries some bacteria (0.6); the filter's media only while it runs.
      const media = b === sump ? 0.6 + (E.filter ? Math.min(E.mediaBio, F.mediaMax) * 0.9 * (0.4 + 0.6 * fEff) : 0) + plenum : 0.6;
      // --- Nitrogen cycle
      const rot = rotting * V / Vtot;
      b.ammonia += ((b.waste + shared * V / Vtot + rot) * d * 0.25) / V;
      const toNitrite = b.ammonia * clamp(E.cycle * 0.012 * media * d, 0, 0.9);
      b.ammonia -= toNitrite; b.nitrite += toNitrite;
      const toNitrate = b.nitrite * clamp(E.cycle * 0.01 * media * d, 0, 0.9);
      b.nitrite -= toNitrate; b.nitrate += toNitrate * 2.7;
      // Plants take up nitrate, ammonia and CO2 in their own body (what each plant reads and feels is in plants.js).
      this.plantUptake(b, d, light, V);
      // CO2: fish, rot and the dark breathe it out; air exchange and plants (by day) take it away.
      const co2T = 3.5 + b.fishLoad * 0.9 / V + b.ammonia * 2 + (1 - clamp(light * 2, 0, 1)) * 1.5;
      b.co2 = Math.max(0, lerp(b.co2 ?? 4, co2T, clamp(d * 0.004 * clamp(8 / Math.max(1, b.depth || 6), 0.5, 2), 0, 1)));
      // --- Oxygen: shallow water breathes quickly; falls, the filter (in the
      // sump), plants by day and a stream's churn add; fish and heat take away.
      const depth = Math.max(1, b.depth || 6);
      const aer = clamp(8 / depth, 0.5, 2.5) * (1 - 0.5 * (E.film ?? 0));    // a surface film slows gas exchange
      const oT = 5.2 + Math.min(4, b.falls) * fallK * 0.9 + (b === sump && E.filter ? F.oxygen * (0.4 + 0.6 * fEff) : b.kind === 'stream' ? 1.2 : 0.3) + E.fan * 0.4 + E.rain * 0.5 + (E.air ?? 0) * (b === sump ? AIR_O2 : AIR_O2 * 0.3)
        + (light - 0.4) * b.plantUse * 0.02 * Math.sqrt(100 / V) - b.fishLoad * 0.8 / V - Math.max(0, b.temp - 24) * 0.12;
      b.oxygen = clamp(lerp(b.oxygen, oT, clamp(d * 0.01 * aer, 0, 1)), 0.5, 10);
      // --- Temperature: shallow water takes the warmth of the lamp, deep
      // water follows the tank.
      let tAir = E.temp;
      if (C?.tempAt && b.n) tAir = C.tempAt(b.cx, b.surfY || 0, b.cz);
      const w = 0.6 * clamp(1 - depth / 14, 0.1, 1);
      const tT = E.temp + clamp((tAir - E.temp) * w, -3, 3);
      b.temp = lerp(b.temp, tT, clamp(d * 0.01 / (1 + V / 25), 0, 1));
      // --- Hardness and pH. GH drifts (over weeks) toward the source water plus what rock leaches; pH (over a day) toward
      // what the hardness buffers it to, pushed down by CO2 (at night), nitrate and tannins from wood and leaves.
      const ghT = src.gh + Math.min(4, mineral) * (1 + 2 / Math.max(2, V));
      b.gh = lerp(b.gh ?? src.gh, ghT, clamp(d / (1440 * 20), 0, 1));
      const buf = 6.0 + 0.16 * Math.min(b.gh, 16);                 // a harder water holds a higher pH
      const phT = buf + (src.ph - (6.0 + 0.16 * src.gh)) - 0.35 * clamp((b.co2 - 4) / 8, 0, 1) - 0.004 * b.nitrate
        - Math.min(0.6, tannin * 0.12) * clamp(4 / Math.max(2, V), 0.3, 1) * (b.gh < 6 ? 1.4 : 1);
      b.ph = clamp(lerp(b.ph ?? src.ph, phT, clamp(d / 1440, 0, 1)), 4.5, 9.5);
      // --- Current: the filter and the pump turnover in the main pool, the run of water in streams and fed ponds.
      b.flow = b === sump ? clamp((E.filter ? F.flow * fEff * filterStir : 0) + Math.min(0.5, pumpTurn / 60), 0, 1) : b.kind === 'stream' ? 0.7 : clamp(b.inLph / Math.max(0.25, b.vol) / 10, 0, 1);
      // --- Algae likes light, nutrients and shallows.
      const lampLight = C?.lightAt && b.n ? C.lightAt(b.cx, b.cz) / Math.max(0.2, E.lampPower) : 1;
      b.rawAlgae = clamp(lampLight, 0.15, 1.3) * (0.3 + 0.7 * b.nitrate / nitRef) * clamp(8 / depth, 0.5, 2) * (1 - 0.6 * b.turbidity);
      raw += b.rawAlgae * V; rawV += V;
    }
    // --- Mixing along the flows
    this.exchange(d, Vb);
    // --- Mean back into env; algae spread around the mean.
    const mean = (k) => list.reduce((s, b) => s + b[k] * Vb(b), 0) / Vtot;
    for (const k of ['ammonia', 'nitrite', 'nitrate', 'oxygen', 'ph', 'gh']) E[k] = mean(k);
    E.flow = sump.flow;
    const kA = rawV ? raw / rawV : 1;
    for (const b of list) b.algae = clamp(E.algae * (kA ? b.rawAlgae / kA : 1), 0, 1);
    this.last = { ammonia: E.ammonia, nitrite: E.nitrite, nitrate: E.nitrate, oxygen: E.oxygen };
  }

  // The body a plant stands in, or (reach > 0, emergent plants) the nearest body its roots reach.
  bodyFor(x, z, reach = 0) {
    let b = this.at(x, z);
    if (b || !reach) return b;
    for (const f of [0.5, 1]) {
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4;
        b = this.at(x + Math.cos(a) * reach * f, z + Math.sin(a) * reach * f);
        if (b) return b;
      }
    }
    return null;
  }

  // Plants (`b.plantUse` units of appetite) draw nitrate, ammonia and CO2 from body `b` over d minutes.
  // The draw slows as the water runs short of nitrate (a clean pond is hardly touched).
  plantUptake(b, d, light, V = Math.max(0.25, b.vol)) {
    if (!(b.plantUse > 0)) return 0;
    const day = 0.3 + light;
    const n0 = b.nitrate, a0 = b.ammonia;
    const sat = b.nitrate / (b.nitrate + 2.5);
    const nUp = Math.min(b.nitrate, b.plantUse * 0.0022 * d * day * (0.25 + 0.75 * sat * 1.6) / V);
    b.nitrate -= nUp;
    // Ammonia is the preferred food: taken first, and fast.
    const aUp = Math.min(b.ammonia, b.plantUse * 0.0016 * d * day / V * (b.ammonia / (b.ammonia + 0.15)));
    b.ammonia -= aUp;
    b.co2 = Math.max(0, (b.co2 ?? 4) - b.plantUse * 0.003 * d * clamp(light * 1.6, 0, 1) / V);
    b.uptakeNow = (n0 - b.nitrate) + (a0 - b.ammonia);
    return b.uptakeNow;
  }

  // Water moving between bodies carries its chemistry along (an upwind mix:
  // each body drifts toward the flow-weighted mean of what flows into it).
  exchange(d, Vb) {
    const H = this.H, sump = this.sump, hours = d / 60;
    const by = new Map(this.list.map((b) => [b.key, b]));
    const inflow = new Map();
    const links = H.ledger.links;
    // Wet ground holds no water but carries it: it has the mix of what runs onto it.
    const ground = { key: 'ground' };
    let gq = 0;
    for (const k of CHEM) ground[k] = 0;
    for (const l of links) {
      if (l.to !== 'ground' || l.kind === 'bypass') continue;
      const src = l.from[0] === 'o' ? sump : by.get(l.from);
      if (!src) continue;
      gq += l.lph;
      for (const k of CHEM) ground[k] += src[k] * l.lph;
    }
    if (gq > 0) for (const k of CHEM) ground[k] /= gq;
    for (const l of links) {
      if (l.kind === 'bypass' || l.to === 'ext' || l.from === 'ext' || l.to[0] === 'o' || l.to === 'ground') continue;
      const src = l.from === 'ground' ? (gq > 0 ? ground : null) : l.from[0] === 'o' ? sump : by.get(l.from);
      const dst = by.get(l.to);
      if (!src || !dst || src === dst) continue;
      let a = inflow.get(dst);
      if (!a) inflow.set(dst, a = []);
      a.push([src, l.lph]);
    }
    const nx = new Map();
    for (const [dst, srcs] of inflow) {
      let q = 0;
      for (const [, f] of srcs) q += f;
      if (q <= 0) continue;
      const frac = Math.min(1, q * hours / Vb(dst));
      const o = {};
      for (const k of CHEM) {
        let m = 0;
        for (const [s, f] of srcs) m += s[k] * f;
        o[k] = dst[k] + frac * (m / q - dst[k]);
      }
      nx.set(dst, o);
    }
    for (const [b, o] of nx) Object.assign(b, o);
  }

  // Outside changes to env's water values (a water change, dosing, an event,
  // the ecology): a drop scales every body, a rise is added everywhere.
  adopt(E) {
    for (const k of ['ammonia', 'nitrite', 'nitrate', 'oxygen']) {
      const was = this.last[k], now = E[k];
      if (Math.abs(now - was) < 1e-9) continue;
      if (this.list.length === 1) { this.sump[k] = now; continue; }
      if (now < was && was > 1e-6) { const f = now / was; for (const b of this.list) b[k] *= f; }
      else for (const b of this.list) b[k] = Math.max(0, b[k] + (now - was));
    }
  }

  adoptAll(E) {
    for (const b of this.list) { b.ammonia = E.ammonia; b.nitrite = E.nitrite; b.nitrate = E.nitrate; b.oxygen = E.oxygen; b.temp = E.temp; b.algae = E.algae; b.ph = E.ph ?? 7.4; b.gh = E.gh ?? 9; }
    this.last = { ammonia: E.ammonia, nitrite: E.nitrite, nitrate: E.nitrate, oxygen: E.oxygen };
  }

  // After a tank was loaded (env is in place): bring the saved ponds back.
  afterLoad() {
    const E = this.world.env;
    this.adoptAll(E);
    const p = this.pending;
    if (p?.sump) for (const k of [...CHEM, 'algae']) if (p.sump[k] !== undefined) this.sump[k] = p.sump[k];
    this.pending = null;
  }

  // Resets every body to the tank-wide values (a new tank).
  resetChem() { this.adoptAll(this.world.env); }

  serialize() {
    const r = (v) => +v.toFixed(3);
    const pack = (b) => Object.fromEntries([...CHEM, 'algae'].map((k) => [k, r(b[k] ?? 0)]));
    return {
      sump: pack(this.sump),
      ponds: this.list.filter((b) => b.kind !== 'sump').map((b) => ({ x: +b.cx.toFixed(1), z: +b.cz.toFixed(1), ...pack(b) })),
    };
  }
}

// A direction word for the camera's view: z grows toward the viewer.
function dirWord(dx, dz) {
  const a = Math.atan2(dz, dx);   // 0 = right, +90deg = front
  const dirs = ['right', 'front right', 'front', 'front left', 'left', 'back left', 'back', 'back right'];
  return dirs[(Math.round(a / (Math.PI / 4)) + 8) % 8];
}
