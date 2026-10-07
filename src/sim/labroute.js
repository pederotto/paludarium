// Going round what is in the way, as pure numbers (the test lab: Animals.labSteer builds the grid from what a body can stand on and
// hands a driven animal the next point of the route). A grid of the floor in which each cell is open or blocked, A* over it, and the
// route pulled straight again wherever the way is clear. No scene, no DOM: the unit tests run it under Node (tests/labroute.test.mjs).
//
// A route only names points to walk or hop to: the species' own movement still does the walking (the lab never moves an animal).

export class Grid {
  // nx x nz cells of `cell` cm, the first cell's corner at (x0, z0). Every cell starts open.
  constructor(x0, z0, cell, nx, nz) {
    this.x0 = x0; this.z0 = z0; this.cell = cell; this.nx = nx; this.nz = nz;
    this.bad = new Uint8Array(nx * nz);
    this.mult = new Uint8Array(nx * nz).fill(1);     // what a cell costs to cross, in cells of plain ground: more where a body climbs over something
  }

  ci(x) { return Math.floor((x - this.x0) / this.cell); }
  ck(z) { return Math.floor((z - this.z0) / this.cell); }
  cx(i) { return this.x0 + (i + 0.5) * this.cell; }
  cz(k) { return this.z0 + (k + 0.5) * this.cell; }
  has(i, k) { return i >= 0 && k >= 0 && i < this.nx && k < this.nz; }

  // Mark the blocked cells: block(x, z) says whether a body cannot stand at the cell's middle. cost(x, z), asked right after block for the same cell,
  // is what the cell costs to cross (1, 2, 3 ...; default 1).
  fill(block, cost = null) {
    for (let k = 0; k < this.nz; k++) for (let i = 0; i < this.nx; i++) {
      const x = this.cx(i), z = this.cz(k), c = k * this.nx + i;
      this.bad[c] = block(x, z) ? 1 : 0;
      this.mult[c] = cost ? Math.max(1, Math.min(255, cost(x, z) | 0)) : 1;
    }
  }

  // What the straight way from a to b costs in cells of plain ground (its length over the cell, each stretch weighted by the cost of the cell
  // it crosses): the length when the way is plain ground, more when it climbs over something.
  lineCost(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    if (len < 1e-6) return 0;
    const n = Math.max(1, Math.ceil(len / (this.cell / 3)));
    let sum = 0;
    for (let s = 0; s < n; s++) {
      const t = (s + 0.5) / n, i = this.ci(ax + dx * t), k = this.ck(az + dz * t);
      sum += this.has(i, k) ? this.mult[k * this.nx + i] : 1;
    }
    return (sum / n) * len;
  }

  // Outside the grid counts as blocked.
  blockedAt(x, z) {
    const i = this.ci(x), k = this.ck(z);
    return !this.has(i, k) || this.bad[k * this.nx + i] === 1;
  }

  // Is the straight way from a to b open? Looked at every third of a cell. Spots within `slack` cm of either end are not held against
  // it: a body at the edge of a blocked cell (its own clearance reaches into the neighbour) is not walled in by it.
  lineFree(ax, az, bx, bz, slack = 0) {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    if (len < 1e-6) return true;
    const n = Math.max(1, Math.ceil(len / (this.cell / 3)));
    for (let s = 0; s <= n; s++) {
      const d = (s / n) * len;
      if (d <= slack || len - d <= slack) continue;
      if (this.blockedAt(ax + (dx * s) / n, az + (dz * s) / n)) return false;
    }
    return true;
  }

  // The nearest open cell's middle to (x, z), searched in rings of cells out to `maxR` cells; null if there is none.
  nearestFree(x, z, maxR = 12) {
    const i0 = this.ci(x), k0 = this.ck(z);
    let best = null, bd = Infinity;
    for (let r = 0; r <= maxR; r++) {
      if (best && r * this.cell > Math.sqrt(bd) + this.cell) break;
      for (let dk = -r; dk <= r; dk++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dk)) !== r) continue;
        const i = i0 + di, k = k0 + dk;
        if (!this.has(i, k) || this.bad[k * this.nx + i]) continue;
        const d = (this.cx(i) - x) ** 2 + (this.cz(k) - z) ** 2;
        if (d < bd) { bd = d; best = { x: this.cx(i), z: this.cz(k) }; }
      }
    }
    return best;
  }
}

// A* over the grid, eight ways, never cutting the corner of a blocked cell. Returns the cells' middles from start to the cell
// nearest `to` that can be reached (the goal itself when it is open and reachable); `reached` says whether that is the goal's cell.
function search(g, si, sk, ti, tk) {
  const { nx, nz, bad } = g, N = nx * nz;
  const gs = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), done = new Uint8Array(N);
  const h = (i, k) => { const dx = Math.abs(i - ti), dz = Math.abs(k - tk); return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz); };
  // (a binary heap of [f, cell])
  const heap = [];
  const push = (f, c) => { heap.push([f, c]); let n = heap.length - 1; while (n > 0) { const p = (n - 1) >> 1; if (heap[p][0] <= heap[n][0]) break; [heap[p], heap[n]] = [heap[n], heap[p]]; n = p; } };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) { heap[0] = last; let n = 0; for (;;) { const l = 2 * n + 1, r = l + 1; let m = n; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === n) break; [heap[m], heap[n]] = [heap[n], heap[m]]; n = m; } }
    return top;
  };
  const s = sk * nx + si, t = tk * nx + ti;
  gs[s] = 0; push(h(si, sk), s);
  let near = s, nearH = h(si, sk);
  while (heap.length) {
    const [, c] = pop();
    if (done[c]) continue;
    done[c] = 1;
    const i = c % nx, k = (c / nx) | 0, hc = h(i, k);
    if (hc < nearH) { nearH = hc; near = c; }
    if (c === t) break;
    for (let dk = -1; dk <= 1; dk++) for (let di = -1; di <= 1; di++) {
      if (!di && !dk) continue;
      const ni = i + di, nk = k + dk;
      if (!g.has(ni, nk) || bad[nk * nx + ni]) continue;
      if (di && dk && (bad[k * nx + ni] || bad[nk * nx + i])) continue;
      const n = nk * nx + ni, cost = gs[c] + (di && dk ? Math.SQRT2 : 1) * g.mult[n];
      if (cost < gs[n]) { gs[n] = cost; from[n] = c; push(cost + h(ni, nk), n); }
    }
  }
  const end = done[t] ? t : near, out = [];
  for (let c = end; c !== -1; c = from[c]) out.push({ x: g.cx(c % nx), z: g.cz((c / nx) | 0) });
  return { cells: out.reverse(), reached: end === t };
}

// Pull a route straight: from each point on to the furthest later one the way to is open.
function pull(g, pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  let a = 0;
  while (a < pts.length - 1) {
    let b = pts.length - 1;
    // (a shortcut must be open and cost no more than the way it replaces: it may not cut across a log the route went round)
    const along = (to) => { let c = 0; for (let q = a; q < to; q++) c += g.lineCost(pts[q].x, pts[q].z, pts[q + 1].x, pts[q + 1].z); return c; };
    while (b > a + 1 && !(g.lineFree(pts[a].x, pts[a].z, pts[b].x, pts[b].z) && g.lineCost(pts[a].x, pts[a].z, pts[b].x, pts[b].z) <= along(b) * 1.02 + 0.1)) b--;
    out.push(pts[b]);
    a = b;
  }
  return out;
}

// A route from (fx, fz) to (tx, tz): { pts: [{ x, z }], clipped } with the points to go to, in order, not counting where it stands.
// `clipped`: the goal itself cannot be stood on (it is inside something) or cannot be reached, so the route ends at the nearest open
// place that can. null: there is nowhere open near the start at all.
export function planRoute(g, fx, fz, tx, tz) {
  const start = g.blockedAt(fx, fz) ? g.nearestFree(fx, fz) : { x: fx, z: fz };
  if (!start) return null;
  const goalOpen = !g.blockedAt(tx, tz);
  const goal = goalOpen ? { x: tx, z: tz } : g.nearestFree(tx, tz);
  if (!goal) return null;
  // (straight at it when the way is open and plain ground: a way over a costly stretch goes through the search below, which weighs the way round)
  if (goalOpen && g.lineFree(start.x, start.z, tx, tz, g.cell * 0.75) && g.lineCost(start.x, start.z, tx, tz) <= Math.hypot(tx - start.x, tz - start.z) * 1.02 + 0.1) return { pts: [{ x: tx, z: tz }], clipped: false };
  const { cells, reached } = search(g, g.ci(start.x), g.ck(start.z), g.ci(goal.x), g.ck(goal.z));
  // (the first cell is where it stands: its own place; the last is the goal's exact point when that is open and was reached)
  const raw = [{ x: fx, z: fz }, ...cells.slice(1)];
  if (goalOpen && reached) { if (raw.length > 1) raw[raw.length - 1] = { x: tx, z: tz }; else raw.push({ x: tx, z: tz }); }
  const pts = pull(g, raw).slice(1);
  return { pts: pts.length ? pts : [{ x: goal.x, z: goal.z }], clipped: !(goalOpen && reached) };
}
