// What a walking body can stand on, layer by layer, as pure numbers (no scene: tests/surfaces.test.mjs runs it under Node).
//
// The tank floor is a grid of cells; in each cell the surfaces a body can stand on, lowest first: the ground, and the top of every piece
// (a log, cork, a root) rising from it, each with the room above it up to the next solid (its clearance). A piece lying on the ground is
// not a wall to a body that can step onto it: it is a second layer in those cells, and a body walks over it. It is baked once, when the
// pieces or the ground change (Occupancy.bakeSurfaces, from the pieces' exact tops), and read in O(1) by the planner (Animals.labGrid) and by
// the movers (Animals.standOn), never raycast per frame.

// How high a walker steps up (cm) and how far it drops, by what it is. A body longer than the log is thick, with limbs under it, steps over
// it; a hopper does not walk over things (its hop is checked by the hop itself); a gecko climbs anything (it has its own wall movement).
export const CLIMB = {
  skink: { up: 4.5, down: 9, cost: 3 },       // `cost`: what a cell it climbs over costs the planner, in cells of plain ground (it goes round a log when that is cheaper)
  crab: { up: 4, down: 8, cost: 3 },
  newt: { up: 4.2, down: 8, cost: 4 },        // the salamanders and newts (a fire salamander is 16 cm long: it crosses a log with a 3.7 cm top)
  axolotl: { up: 1.5, down: 4, cost: 6 },
};
// The kinds whose mover really climbs (Animals.standOn and the climber argument of okFor): the planner only routes these over a piece.
export const SURFACE_WALKERS = new Set(['skink', 'crab', 'newt']);

export const MAX_LAYERS = 4;

export class SurfaceMap {
  // nx x nz cells of `cell` cm, the first cell's corner at (x0, z0); up to MAX_LAYERS surfaces per cell.
  constructor(x0, z0, cell, nx, nz) {
    this.x0 = x0; this.z0 = z0; this.cell = cell; this.nx = nx; this.nz = nz;
    const n = nx * nz;
    this.n = new Uint8Array(n);                         // how many layers each cell has
    this.y = new Float32Array(n * MAX_LAYERS);          // the height of each layer's surface
    this.clr = new Float32Array(n * MAX_LAYERS);        // the room above it
    this.nrm = new Float32Array(n * MAX_LAYERS * 3);    // its unit normal
    this.piece = new Uint8Array(n * MAX_LAYERS);        // 0: the ground, 1: the top of a piece
  }

  ci(x) { return Math.floor((x - this.x0) / this.cell); }
  ck(z) { return Math.floor((z - this.z0) / this.cell); }
  has(i, k) { return i >= 0 && k >= 0 && i < this.nx && k < this.nz; }

  // Replace a cell's layers: [{ y, clr, n: [x, y, z], piece }], lowest first (at most MAX_LAYERS are kept).
  set(i, k, layers) {
    const c = k * this.nx + i, m = Math.min(layers.length, MAX_LAYERS);
    this.n[c] = m;
    for (let l = 0; l < m; l++) {
      const L = layers[l], o = c * MAX_LAYERS + l, nn = L.n ?? [0, 1, 0];
      this.y[o] = L.y; this.clr[o] = L.clr; this.piece[o] = L.piece ? 1 : 0;
      this.nrm[o * 3] = nn[0]; this.nrm[o * 3 + 1] = nn[1]; this.nrm[o * 3 + 2] = nn[2];
    }
  }

  // The surface a body at (x, z), now standing at height `y`, can go on to there: of the cell's layers, the one nearest its height that it
  // steps up to (`up`) or drops to (`down`) with at least `room` of clearance above it. Fills and returns `out` (y, clr, nx, ny, nz, piece), or
  // null when there is none: outside the grid, or the cell is a wall to this body (a piece taller than it can step, or a gap too low).
  stand(x, z, y, up, down, room, out = {}) {
    const best = this.pick(this.ci(x), this.ck(z), y, up, down, room);
    if (best < 0) return null;
    out.y = this.y[best]; out.clr = this.clr[best]; out.piece = this.piece[best] === 1;
    out.nx = this.nrm[best * 3]; out.ny = this.nrm[best * 3 + 1]; out.nz = this.nrm[best * 3 + 2];
    return out;
  }

  // The slot (index into y, clr, ...) of the layer of cell (i, k) a body at height `y` goes on to, or -1.
  pick(i, k, y, up, down, room) {
    if (!this.has(i, k)) return -1;
    const c = k * this.nx + i, m = this.n[c];
    let best = -1, bd = Infinity;
    for (let l = 0; l < m; l++) {
      const o = c * MAX_LAYERS + l, dy = this.y[o] - y;
      if (dy > up || -dy > down || this.clr[o] < room) continue;
      const d = Math.abs(dy);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  // The surface height under (x, z) for a body at `y`, smooth: the layers of the four cells round the point (each chosen as `stand` does),
  // blended by distance, so the height rises and falls across a log's round side instead of stepping at every cell edge. A corner cell with
  // no layer for this body (a wall to it) is left out. Fills and returns `out` (y, piece, nx, ny, nz: the nearest corner's), or null when
  // none of the four has a layer.
  heightAt(x, z, y, up, down, room, out = {}) {
    const fx = (x - this.x0) / this.cell - 0.5, fz = (z - this.z0) / this.cell - 0.5, i0 = Math.floor(fx), k0 = Math.floor(fz), tx = fx - i0, tz = fz - k0;
    let sw = 0, sy = 0, bw = -1, bo = -1;
    for (let dk = 0; dk < 2; dk++) for (let di = 0; di < 2; di++) {
      const w = (di ? tx : 1 - tx) * (dk ? tz : 1 - tz);
      if (w <= 0) continue;
      const o = this.pick(i0 + di, k0 + dk, y, up, down, room);
      if (o < 0) continue;
      sw += w; sy += w * this.y[o];
      if (w > bw) { bw = w; bo = o; }
    }
    if (bo < 0 || sw <= 0) return null;
    out.y = sy / sw; out.piece = this.piece[bo] === 1;
    out.nx = this.nrm[bo * 3]; out.ny = this.nrm[bo * 3 + 1]; out.nz = this.nrm[bo * 3 + 2];
    return out;
  }

  // Is there a piece layer in the cell that a body at `y` can step onto (a log it can cross, not a wall)?
  climbable(x, z, y, up, down, room) {
    const s = this.stand(x, z, y, up, down, room, _t);
    return s !== null && s.piece;
  }
}
const _t = {};

// Layers from a column of the occupancy grid: `runs` are the solid stretches [bottom, top] (cm, lowest first) of the cell, `ground` the height
// of the ground there, `topAt(run)` the exact top and normal of a run ({ y, n } or null: use the run's own top), `height` the tank's height.
// The ground layer's room is up to the first piece that comes down to (or touches) it, the pieces' tops each have the room to the next run.
export function layersOf(ground, runs, height, topAt = () => null) {
  const out = [], rs = runs.filter((r) => r[1] > ground + 0.3);        // (a run wholly in the ground is the ground)
  const first = rs.length ? rs[0][0] : height;
  out.push({ y: ground, clr: Math.max(0, first - ground), n: [0, 1, 0], piece: false });
  for (let r = 0; r < rs.length; r++) {
    const t = topAt(rs[r]) ?? { y: rs[r][1], n: [0, 1, 0] };
    const next = r + 1 < rs.length ? rs[r + 1][0] : height;
    out.push({ y: t.y, clr: Math.max(0, next - t.y), n: t.n ?? [0, 1, 0], piece: true });
  }
  return out;
}
