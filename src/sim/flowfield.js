// Flow fields (Dijkstra maps): for one question ("how far to the nearest refuge?") a whole tank answers at once. Every cell holds the
// cost of the cheapest way from it to the nearest target cell, flooded outward over the cells the body may stand in and the steps it may
// take between them; an animal then only walks downhill, cell by cell. There is no route to plan per animal, no goal to check, nothing to
// give up and ban: a cell with no way to a refuge has no value (Infinity), so a frightened animal is never sent somewhere it cannot get to.
// Pure: typed arrays in, typed arrays out (Node tests run it). The engine fills the cells from its own rules (Animals.refugeField).
//
// grid: { nx, nz, cell, x0, z0 }  (cell i, k has its centre at x0 + (i + 0.5) * cell, z0 + (k + 0.5) * cell; index c = k * nx + i)
// open[c]   1: the body may stand there (the movers' own canOccupy, in its medium)
// h[c]      the ground (or surface) height there, cm
// cliff[c]  1: ground too steep to walk onto (the walkers' cliffAt): a step from a cell that is not one onto one that is is refused
// drop[c]   1: a cell it may enter however steep (a newt slides into water below a bank)
// target[c] 1: a refuge (cost 0 there)
// up, down  the most it climbs or steps down between two neighbouring cells (cm; Infinity: the cliff flags alone decide, as for walkers)
// wcost[c]  extra cost factor of moving into the cell (1 = plain ground; deep water for a body that only wades, ...)

const SQ2 = Math.SQRT2;
const DI = [1, -1, 0, 0, 1, 1, -1, -1], DK = [0, 0, 1, -1, 1, -1, 1, -1], DL = [1, 1, 1, 1, SQ2, SQ2, SQ2, SQ2];

export function makeField(nx, nz, cell, x0, z0) {
  const n = nx * nz;
  return {
    nx, nz, cell, x0, z0, n,
    open: new Uint8Array(n), h: new Float32Array(n), cliff: new Uint8Array(n), drop: new Uint8Array(n), target: new Uint8Array(n), wcost: new Float32Array(n).fill(1),
    dist: new Float32Array(n), heap: new Int32Array(n * 8 + 8), hk: new Float32Array(n * 8 + 8), up: 1, down: 1, built: false,
  };
}

// May a body step from cell p to its neighbour q? Both open; not onto a cliff from off one (Animals.walkBlocked) unless q is a drop cell;
// the rise within `up` and the fall within `down` (unless a drop cell).
export function canPass(F, p, q) {
  if (!F.open[p] || !F.open[q]) return false;
  if (F.cliff[q] && !F.cliff[p] && !F.drop[q]) return false;
  const dh = F.h[q] - F.h[p];
  if (dh > F.up) return false;
  if (-dh > F.down && !F.drop[q]) return false;
  return true;
}

// Flood from the targets: F.dist[c] = the cheapest cost from c to a target (Infinity: no way). The edges are walked backwards (a cell's
// cost is set from the neighbour it would step INTO), so an edge counts in the direction the animal would walk it (up and down differ).
export function buildField(F) {
  const { nx, nz, dist, heap, hk } = F;
  dist.fill(Infinity);
  let len = 0;
  const push = (c, d) => {
    let i = len++;
    while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= d) break; heap[i] = heap[p]; hk[i] = hk[p]; i = p; }
    heap[i] = c; hk[i] = d;
  };
  const pop = () => {
    const top = heap[0], last = heap[--len], lk = hk[len];
    let i = 0;
    for (;;) {
      let m = 2 * i + 1;
      if (m >= len) break;
      if (m + 1 < len && hk[m + 1] < hk[m]) m++;
      if (hk[m] >= lk) break;
      heap[i] = heap[m]; hk[i] = hk[m]; i = m;
    }
    heap[i] = last; hk[i] = lk;
    return top;
  };
  for (let c = 0; c < F.n; c++) if (F.target[c] && F.open[c]) { dist[c] = 0; push(c, 0); }
  while (len > 0) {
    const d0 = hk[0], q = pop();
    if (d0 > dist[q]) continue;                              // (a stale entry: q was reached cheaper since)
    const qi = q % nx, qk = (q - qi) / nx;
    for (let e = 0; e < 8; e++) {
      const pi = qi + DI[e], pk = qk + DK[e];
      if (pi < 0 || pk < 0 || pi >= nx || pk >= nz) continue;
      const p = pk * nx + pi;
      if (!canPass(F, p, q)) continue;                       // (p steps into q)
      if (e >= 4 && (!F.open[qk * nx + pi] || !F.open[pk * nx + qi])) continue;   // (no cutting a corner past a closed cell)
      const d = d0 + DL[e] * F.cell * F.wcost[q];
      if (d < dist[p] && len < heap.length) { dist[p] = d; push(p, d); }
    }
  }
  F.built = true;
  return F;
}

export const cellOf = (F, x, z) => {
  const i = Math.floor((x - F.x0) / F.cell), k = Math.floor((z - F.z0) / F.cell);
  return i < 0 || k < 0 || i >= F.nx || k >= F.nz ? -1 : k * F.nx + i;
};
export const cx = (F, c) => F.x0 + ((c % F.nx) + 0.5) * F.cell;
export const cz = (F, c) => F.z0 + (Math.floor(c / F.nx) + 0.5) * F.cell;

// Downhill from cell c for up to `steps` cells: each step to the neighbour it may step into with the lowest cost plus `penalty(q)`
// (a threat's: cells near it cost more, so it runs to its refuge AND away). Returns the last cell (c itself when no step goes down,
// a target when it gets there), or -1 when c has no way to a refuge. out (optional) gets { x, z, cost, cells }.
export function descend(F, c, steps, penalty = null, out = null) {
  if (c < 0 || !(F.dist[c] < Infinity)) return -1;
  const { nx, nz } = F;
  let cur = c, n = 0;
  for (; n < steps && !F.target[cur]; n++) {
    const ci = cur % nx, ck = (cur - ci) / nx;
    let best = -1, bv = Infinity;                          // (always downhill when it can be: the penalty only chooses among the ways down)
    for (let e = 0; e < 8; e++) {
      const qi = ci + DI[e], qk = ck + DK[e];
      if (qi < 0 || qk < 0 || qi >= nx || qk >= nz) continue;
      const q = qk * nx + qi;
      if (!(F.dist[q] < F.dist[cur]) || !canPass(F, cur, q)) continue;
      if (e >= 4 && (!F.open[ck * nx + qi] || !F.open[qk * nx + ci])) continue;
      const v = F.dist[q] + (penalty ? penalty(q) : 0);
      if (v < bv) { bv = v; best = q; }
    }
    if (best < 0) break;
    cur = best;
  }
  if (out) { out.x = cx(F, cur); out.z = cz(F, cur); out.cost = F.dist[cur]; out.cells = n; }
  return cur;
}
