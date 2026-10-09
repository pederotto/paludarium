// Procedural terrariums: generateTerrarium(world, { preset, seed, tier }) fills a
// fresh world with a designed, planted, stocked and matured scene. The same
// (preset, seed, tier) always builds the same layout.
//
// Every preset composes the same few ideas an aquascaper uses: one focal point
// off centre near a third of the width, rocks in odd numbers and graded sizes,
// three depth layers of plants, water that leads the eye, 25-35 % open space,
// a limited palette, and relief with ledges on the background. The layout is
// read from TANK, so the same recipe fits the jar, nano, standard and grand tanks;
// the pieces in it are real sizes (sim/scale.js): a stone or a log is about the
// same size in any tank, and a bigger tank gets more of them (more stones, plant
// groups, spires and pools), a small one fewer, smaller ones that still fit.
//
// Nothing here bypasses the simulation: water is only where hydro.js can hold it
// (falls and pools are checked), plants go where plants.canPlace allows, animals
// where animals.placement allows, and the tank's environment is tuned so what
// lives there is comfortable.

import * as THREE from 'three/webgpu';
import { FILTERS as FILTER_KINDS } from '../content/equipment.js';
import { TANK, MAT, NMAT, sizeFactors } from './tank.js';
import { PLANTS } from './plants.js';
import { SPECIES } from './animals.js';
import { rng, smooth, clamp, lerp, hash3 } from '../util/math.js';
import { pieceScale, coverCount, fogScale, stockCount } from './scale.js';
import { PRESETS, PRESET_ORDER, presetsForTier, defaultPreset, describePreset } from '../content/presets.js';

export { PRESETS, PRESET_ORDER, presetsForTier, defaultPreset, describePreset };

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V3(0, 1, 0);

// ---------------------------------------------------------------------------
// Small maths helpers

// Smooth value noise in 0 … 1, different for every seed.
function makeNoise(seed) {
  const s = (seed % 9973) * 0.137 + 1.31;
  const lat = (ix, iz) => hash3(ix + s, iz - s * 0.7, s);
  return (x, z, f = 1) => {
    x *= f; z *= f;
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    return (lat(ix, iz) * (1 - u) + lat(ix + 1, iz) * u) * (1 - v) + (lat(ix, iz + 1) * (1 - u) + lat(ix + 1, iz + 1) * u) * v;
  };
}

// 1 inside the box, 0 outside, soft edges of width fx / fz.
const box = (x, z, x0, x1, z0, z1, fx = 2, fz = 2) => smooth(x0 - fx, x0, x) * smooth(x1 + fx, x1, x) * smooth(z0 - fz, z0, z) * smooth(z1 + fz, z1, z);
// 1 inside the ellipse (centre, radii), fading to 0 at `edge` times the radius.
const ell = (x, z, cx, cz, rx, rz, inner = 0.55, edge = 1) => smooth(edge, inner, Math.hypot((x - cx) / rx, (z - cz) / rz));

// ---------------------------------------------------------------------------
// The generator context

class Gen {
  constructor(world, preset, seed, tier) {
    this.W = world;
    this.T = world.terrain;
    this.F = this.T.field;
    this.Wl = world.wall;
    this.WF = this.Wl.field;
    this.preset = preset;
    this.P = PRESETS[preset];   // the set's recipe: what its real place holds (content/presets.js SETS)
    this.ps = this.P?.pool ?? 1;   // S1: the recipe's pool/lagoon size against the layout's (the share of the floor under water)
    this.seed = seed;
    this.tier = tier;
    this.w = TANK.w; this.d = TANK.d; this.h = TANK.h;
    this.sx = this.w / 90; this.sz = this.d / 45; this.sy = this.h / 60;
    this.sc = Math.sqrt(this.sx * this.sz);
    // Real sizes (sim/scale.js). `k` sizes the hardscape: 1 in the standard tank, a little more in a big one, less in a low,
    // shallow or small one. `area` and `wallA` are the floor and the background against the standard tank's: counts of
    // plants, stones, epiphytes and features follow them, so a big tank is fuller rather than a magnified standard one.
    this.dims = { w: this.w, d: this.d, h: this.h };
    this.k = pieceScale(this.dims);
    this.area = sizeFactors(this.dims).area;
    this.wallA = sizeFactors(this.dims).wall;
    // Spacing inside a group of pieces (spires in a cluster, a stump beside its roots): real size, but in a tank narrower or
    // shallower than the standard one squeezed with the tank, as before, so a cube's few pieces still leave it some water.
    this.kx = Math.min(this.k, this.sx); this.kz = Math.min(this.k, this.sz);
    let s = (Math.imul((seed >>> 0) + 1, 2654435761) ^ Math.imul(preset.length * 977 + preset.charCodeAt(0), 40503)) >>> 0;
    s = s || 12345;
    this.r = rng(s);
    for (let k = 0; k < 8; k++) this.r();
    this.n = makeNoise(s);
    this.warnings = [];
    this.counts = { pieces: 0, plants: 0, wall: 0 };
    this.gear = new Set();
  }

  // Random helpers (all from the seeded generator).
  rand(a = 0, b = 1) { return a + (b - a) * this.r(); }
  int(a, b) { return Math.floor(this.rand(a, b + 1 - 1e-9)); }
  pick(arr) { return arr[Math.floor(this.r() * arr.length) % arr.length]; }
  chance(p) { return this.r() < p; }
  warn(msg) { this.warnings.push(msg); }

  // Normalised tank coordinates: u −1 … 1 left → right, v 0 … 1 back → front.
  X(u) { return u * this.w / 2; }
  Z(v) { return -this.d / 2 + v * this.d; }
  // Water level as a fraction of the height.
  lvl(f) { return Math.round((this.P?.level ?? f) * this.h * 2) / 2; }   // S1: a recipe's `level` (fraction of the height) overrides the layout's

  ground(x, z) { return this.T.heightAt(x, z); }

  // --- Ground -------------------------------------------------------------
  fill(fn) {
    const F = this.F;
    for (let j = 0; j <= F.ny; j++) for (let i = 0; i <= F.nx; i++) {
      const [x, z] = F.toWorld(i, j);
      const n = F.idx(i, j);
      F.base[n] = clamp(fn(x, z, n), 0.6, F.maxH - 0.5);
    }
    F.dirty = true;
  }

  // Sets the material weights from shape. rule(x, z, h, up, m, sandy, n) fills m (NMAT weights).
  paint(rule) {
    const F = this.F, T = this.T;
    T.compose([]);
    const m = new Float32Array(NMAT);
    for (let j = 0; j <= F.ny; j++) for (let i = 0; i <= F.nx; i++) {
      const n = F.idx(i, j);
      const [x, z] = F.toWorld(i, j);
      const [gx, gz] = F.gradient(x, z);
      const up = 1 / Math.sqrt(1 + gx * gx + gz * gz);
      const sandy = F.mat[n * NMAT + MAT.sand];
      m.fill(0);
      rule(x, z, F.base[n], up, m, sandy, n);
      let sum = 0;
      for (let k = 0; k < NMAT; k++) sum += m[k];
      if (sum <= 0) m[MAT.soil] = sum = 1;
      for (let k = 0; k < NMAT; k++) F.mat[n * NMAT + k] = m[k] / sum;
    }
    F.dirty = true;
  }

  // The background: relief (cm forward of the glass) and material.
  wallFill(relief, paint) {
    const WF = this.WF;
    const m = new Float32Array(NMAT);
    for (let j = 0; j <= WF.ny; j++) for (let i = 0; i <= WF.nx; i++) {
      const n = WF.idx(i, j);
      const [x, y] = WF.toWorld(i, j);
      WF.h[n] = clamp(relief(x, y), 0.4, WF.maxH);
    }
    for (let j = 0; j <= WF.ny; j++) for (let i = 0; i <= WF.nx; i++) {
      const n = WF.idx(i, j);
      const [x, y] = WF.toWorld(i, j);
      m.fill(0);
      paint(x, y, WF.h[n], m);
      let sum = 0;
      for (let k = 0; k < NMAT; k++) sum += m[k];
      if (sum <= 0) m[MAT.stone] = sum = 1;
      for (let k = 0; k < NMAT; k++) WF.mat[n * NMAT + k] = m[k] / sum;
    }
    WF.dirty = true;
  }

  // --- Hardscape --------------------------------------------------------------
  piece(type, x, z, o = {}) {
    const D = this.W.decor;
    // A seed per piece: variant (when not given), non-uniform scale, flip and tint all differ.
    const opt = { rot: this.r() * 6.283, seed: this.int(1, 2 ** 30), ...o };
    // A third of the boulders a layout asks for by number are swapped for a procedural shape.
    if (type === 'boulder' && opt.variant !== undefined && D.parts.boulder?.length > 13 && this.chance(0.3)) opt.variant = 13 + this.int(0, D.parts.boulder.length - 14);
    let p = D.addPiece(type, x, z, opt);
    // Nothing may reach the lid: shrink a piece that would.
    for (let k = 0; k < 3 && p; k++) {
      const box = new THREE.Box3().setFromObject(p.mesh);
      const room = TANK.h - 3 - box.min.y, have = box.max.y - box.min.y;
      if (box.max.y <= TANK.h - 3 || have <= 0) break;
      D.removePiece(p);
      opt.size = (opt.size ?? 10) * clamp(room / have, 0.4, 0.95);
      p = D.addPiece(type, x, z, opt);
    }
    if (p) this.counts.pieces++;
    return p;
  }

  // Dresses steep ground with boulders half sunk into the face, so a heightfield reads as stacked rock.
  // test(x, y, z) picks where; sizes graded from small to large.
  dress(n, test, { size = [8, 20], variants = this.W.decor.pool('boulder'), accent = [2, 3, 5], slope = 0.86, lift = -0.12, tries = 500, gap = 0.55 } = {}) {
    const T = this.T, placed = [];
    let made = 0;
    for (let k = 0; k < tries && made < n; k++) {
      const x = (this.r() - 0.5) * (this.w - 6), z = (this.r() - 0.5) * (this.d - 6);
      const y = T.heightAt(x, z);
      if (T.normalAt(x, z).y > slope || !test(x, y, z)) continue;
      const sz = lerp(size[0], size[1], Math.pow(this.r(), 1.6));
      if (placed.some((q) => Math.hypot(q.x - x, q.z - z) < (q.s + sz) * gap)) continue;
      const v = this.chance(0.2) ? this.pick(accent) : this.pick(variants);
      if (this.piece('boulder', x, z, { size: sz, variant: v, y: y + sz * lift })) { placed.push({ x, z, s: sz }); made++; }
    }
    return made;
  }

  // A spire of the given height and (base) width in cm that stays clear of the lid.
  spire(x, z, height, width, o = {}) {
    const parts = this.W.decor.parts.spire;
    if (!parts?.length) return null;
    const variant = o.variant ?? this.int(0, parts.length - 1);
    const bb = parts[variant % parts.length].geometry.boundingBox;
    const rx = bb.max.x - bb.min.x, ry = bb.max.y - bb.min.y, rz = bb.max.z - bb.min.z;
    const hgt = Math.min(height, (TANK.h - 3 - this.ground(x, z)) / 0.9);
    const k = hgt / Math.max(rx, ry, rz);
    return this.piece('spire', x, z, { size: hgt, variant, scale: [width / (rx * k), 1, (width * this.rand(0.75, 1)) / (rz * k)], tilt: [this.rand(-0.05, 0.05), this.rand(-0.05, 0.05)], sink: 0.1, ...o });
  }

  // --- Water ----------------------------------------------------------------
  // pump: [x, z]; outlets: [{ x, z }] on the ground or { x, y, wall: true } on the background.
  water({ pump, level, outlets = [], rate = 160, settle = 150 }) {
    const Wt = this.W.water, H = Wt.hydro, T = this.T;
    this.W.groundChanged({ quick: true });
    Wt.setPump(pump[0], pump[1]);
    Wt.setLevel(level);
    H.pump.rate = rate;
    for (const o of outlets) {
      if (o.wall) Wt.addOutlet(V3(o.x, o.y, this.Wl.zAt(o.x, o.y) + 0.6), true);
      else Wt.addOutlet(V3(o.x, T.heightAt(o.x, o.z) + 0.2, o.z), false);
    }
    H.prime();
    for (let k = 0; k < settle; k++) H.step(1 / 30);
    // Water held up in pools and streams lowers the main pool; top it up to the wanted level.
    for (let it = 0; it < 4; it++) {
      const err = level - H.level;
      if (Math.abs(err) < 0.2) break;
      H.resVol = Math.max(0, H.resVol + H.volumeAt(level) - H.volumeAt(H.level));
      H.solveLevel(); H.updateMembership();
      for (let k = 0; k < 40; k++) H.step(1 / 30);
    }
    H.targetTotal = H.total();
    Wt.syncLevel();
    Wt.syncFalls(true);
  }

  // --- Plants ---------------------------------------------------------------------
  plant(id, x, z, o = {}) {
    id = this.allowPlant(id);
    const sp = PLANTS[id], W = this.W, T = this.T;
    if (!sp) return null;
    const y = T.heightAt(x, z);
    const point = V3(x, y, z);
    const normal = T.normalAt(x, z);
    if (W.plants.canPlace(id, { point, surface: 'terrain', normal }, W)) return null;
    if (W.plants.crowdingAt(id, point, { scale: o.scale ?? 1.1 })) return null;     // not inside another plant
    if (sp.habitat === 'floating') point.y = W.water.surfaceAt(x, z, 0.2);
    const nv = W.plants.variants[id] ?? 1;
    const p = W.plants.add(id, point, { normal, grown: o.grown ?? this.rand(0.8, 1), rot: this.r() * 6.283, scale: o.scale ?? this.rand(0.8, 1.25), variant: Math.floor(this.r() * nv) % nv });
    if (p) this.counts.plants++;
    return p;
  }

  wallPlant(id, x, y, o = {}) {
    id = this.allowPlant(id);
    if (!id) return null;
    const W = this.W, Wl = this.Wl;
    const z = Wl.zAt(x, y);
    const [gx, gy] = this.WF.gradient(x, y);
    const normal = V3(-gx, -gy, 1).normalize();
    const point = V3(x, y, z + 0.2);
    if (W.plants.canPlace(id, { point, surface: 'wall', normal }, W)) return null;
    if (W.plants.crowdingAt(id, point, { scale: o.scale ?? 1, surface: 'wall' })) return null;
    const nv = W.plants.variants[id] ?? 1;
    const p = W.plants.add(id, point, { surface: 'wall', normal, grown: o.grown ?? this.rand(0.8, 1), rot: this.r() * 6.283, scale: o.scale ?? this.rand(0.8, 1.2), variant: Math.floor(this.r() * nv) % nv });
    if (p) { this.counts.plants++; this.counts.wall++; }
    return p;
  }

  // A random spot on the floor: test(x, y, z, surface) → bool.
  spot(test, tries = 300, margin = 3) {
    const W = this.W, T = this.T;
    for (let k = 0; k < tries; k++) {
      const x = (this.r() - 0.5) * (this.w - margin * 2), z = (this.r() - 0.5) * (this.d - margin * 2);
      const y = T.heightAt(x, z);
      const s = W.water.surfaceAt(x, z);
      if (test(x, y, z, s)) return V3(x, y, z);
    }
    return null;
  }

  // n plants of one kind on spots that pass `test`, kept at least `gap` cm apart.
  scatter(id, n, test, { gap = 3, scale, grown, tries = Math.max(500, 40 * n) } = {}) {
    const placed = [];
    let made = 0;
    const csz = this.P?.clump ?? 0, grp = csz > 1 && n >= csz;   // S1: a recipe's `clump` plants a kind in groups of that size, as it grows
    const lim = this.w / 2 - 3, limz = this.d / 2 - 3;
    for (let k = 0; k < tries && made < n; k++) {
      const p = this.spot(test, 1);
      if (!p) continue;
      if (placed.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < gap * (grp ? 2.4 : 1))) continue;
      if (this.plant(id, p.x, p.z, { scale, grown })) {
        placed.push(p); made++;
        for (let c = 1; grp && c < csz && made < n; c++) {
          const a = this.r() * 6.283, r = this.rand(1.8, 4.2), x = clamp(p.x + Math.cos(a) * r, -lim, lim), z = clamp(p.z + Math.sin(a) * r, -limz, limz);
          if (this.plant(id, x, z, { scale, grown })) made++;
        }
      }
    }
    return made;
  }

  // n epiphytes on the background where test(x, y) holds, on ledges that face up and clear of the ground in front.
  wallScatter(id, n, test, { gap = 8, scale, tries = Math.max(600, 50 * n), ledge = true } = {}) {
    const placed = [];
    let made = 0;
    const W = this.W;
    for (let k = 0; k < tries && made < n; k++) {
      const x = (this.r() - 0.5) * (this.w - 8), y = this.rand(W.water.level + 3, this.h - 6);
      if (!test(x, y)) continue;
      if (placed.some((q) => Math.hypot(q[0] - x, q[1] - y) < gap)) continue;
      const z = this.Wl.zAt(x, y);
      if (y < this.T.heightAt(x, z + 2.5) + 2.5) continue;
      if (W.water.surfaceAt(x, z + 1) !== -Infinity) continue;
      if (ledge && this.WF.gradient(x, y)[1] > -0.22) continue;
      if (this.wallPlant(id, x, y, { scale })) { placed.push([x, y]); made++; }
    }
    return made;
  }

  // Clusters of one plant: `groups` centres, each with up to `each` plants within `radius` cm.
  clusters(id, groups, each, test, { radius = 7, gap = 3, scale, grown } = {}) {
    let made = 0;
    for (let k = 0; k < groups; k++) {
      const c = this.spot(test, 200);
      if (!c) continue;
      let placed = 0;
      const own = [];
      for (let t = 0; t < each * 6 && placed < each; t++) {
        const a = this.r() * 6.283, rr = radius * Math.sqrt(this.r());
        const x = c.x + Math.cos(a) * rr, z = c.z + Math.sin(a) * rr;
        if (Math.abs(x) > this.w / 2 - 2 || Math.abs(z) > this.d / 2 - 2) continue;
        const y = this.T.heightAt(x, z);
        if (!test(x, y, z, this.W.water.surfaceAt(x, z))) continue;
        if (own.some((q) => Math.hypot(q.x - x, q.z - z) < gap)) continue;
        if (this.plant(id, x, z, { scale, grown })) { own.push({ x, z }); placed++; made++; }
      }
    }
    return made;
  }

  // --- Animals ----------------------------------------------------------------------
  // `n` is what the recipe asks for; the tank decides (sim/scale.js stockCount): none of a species the tank is too small or too
  // low for or whose smallest group the water cannot hold, never fewer than that group, never more than the room it has.
  animal(id, n, test, o = {}) {
    if (!this.allowAnimal(id)) return 0;
    const W = this.W, sp = SPECIES[id];
    n = stockCount(sp, n, this.dims, W.water.volumeLitres());
    let made = 0;
    for (let k = 0; k < n; k++) {
      const p = this.spot(test, 400);
      if (!p) continue;
      const pl = W.animals.placement(id, { point: p, surface: 'terrain' });
      if (!pl.pos) continue;
      // a set's strains (`o.morphs`): `per` fish of each in turn, so founders arriving as trios get one strain per trio
      const morph = o.morphs?.length ? o.morphs[Math.floor((o.k ?? 0) / (o.per ?? 1)) % o.morphs.length] : undefined;
      const a = W.animals.add(id, pl.pos, { age: (sp.adultDays ?? 10) * 1440 * (1 + this.r()), hunger: o.hunger ?? 0.15, morph });
      if (a) { made++; o.k = (o.k ?? 0) + 1; }
    }
    return made;
  }

  // A gecko (or anything that climbs) placed on the background.
  wallAnimal(id, x, y) {
    if (!this.allowAnimal(id)) return null;
    const W = this.W, sp = SPECIES[id];
    if (!stockCount(sp, 1, this.dims)) return null;   // a tank too low to climb in (minH)
    const z = this.Wl.zAt(x, y) + 0.35;
    const [gx, gy] = this.WF.gradient(x, y);
    const a = W.animals.add(id, V3(x, y, z), { age: (sp.adultDays ?? 10) * 1440 * 1.5, hunger: 0.15 });
    if (a) { a.onWall = true; a.wallMode = true; a.normal = V3(-gx, -gy, 1).normalize(); }
    return a;
  }

  // --- What the set's real place holds (N15) ---------------------------------------------------------------------
  // A layout builder may be shared by several sets; each set lists the plants and animals of its place. Anything else a
  // builder asks for is dropped, and a stand-in the set names in `swap` becomes the native plant. A set without lists
  // (none today) places everything.
  allowPlant(id) {
    const P = this.P, m = P.swap?.[id] ?? id;
    return !P.plants || P.plants.includes(m) ? m : null;
  }
  allowAnimal(id) { return !this.P.animals || this.P.animals.includes(id); }

  // The set's own stock (`stock: [[id, n, zone, opt]]`, zone a zones() predicate name, 'deep:4' or 'wet:1:6'), for animals its
  // layout builder does not place. Species already in the tank are left alone. `opt.morphs` names the colour lines (strains) to
  // release, `opt.per` of each in turn (3: a dealer's trio of one strain).
  // `flora: [[id, n, zone]]` adds native plants where a shared layout's own plants were dropped (n per standard tank).
  stock() {
    const P = this.P;
    if (P.env) Object.assign(this.W.env, P.env);   // the place's climate (setpoint) over the shared layout's
    for (const k of P.gear ?? []) this.gear.add(k);   // S1: gear the place needs (a chiller for a cool set)
    if (!P.stock?.length && !P.flora?.length) return;
    const Z = this.zones(this.info?.L ?? this.W.water.level);
    const where = (zone) => { const [k, a, b] = zone.split(':'); return k === 'deep' ? Z.deep(+a) : k === 'wet' ? Z.wet(+a, +b) : Z[k]; };
    const L = this.info?.L ?? this.W.water.level;
    for (const [id, n, zone = 'flat'] of P.flora ?? []) {
      if (zone === 'wall') this.wallScatter(id, Math.max(1, Math.round(n * this.wallA)), (x, y) => y > L + 6, { gap: 10 });
      else this.scatter(id, this.cnt(n), where(zone), { gap: 4 });
    }
    for (const [id, n, zone = 'land', opt] of P.stock ?? []) {
      const o = opt?.morphs ? { morphs: opt.morphs, per: opt.per ?? 1, k: 0 } : {};
      const have = this.W.animals.by[id]?.length ?? 0, want = this.cnt(n);
      if (have >= want) continue;   // S1: the recipe tops a species up to its count (a layout may have placed fewer)
      let need = want - have;
      const front = (x, y, z, s) => Math.abs(x) < this.w * 0.3 && z > this.Z(0.3);   // S1 hero placement: the featured animal starts in the front-middle of the default view
      const z0 = where(zone);
      if (P.featured?.includes(id)) need -= this.animal(id, need, (x, y, z, s) => front(x, y, z, s) && z0(x, y, z, s), o);
      if (need > 0) need -= this.animal(id, need, z0, o);
      if (need > 0 && zone !== 'land' && !zone.startsWith('deep') && !zone.startsWith('wet')) this.animal(id, need, Z.land, o);
    }
  }

  // Predicates for where things may go, for a tank whose main water level is L.
  zones(L) {
    const W = this.W, T = this.T, F = this.F, H = W.water.hydro;
    const stamped = (x, z) => F.stamped[H.cellOf(x, z)];
    const dry = (x, y, z, s) => s === -Infinity && !W.water.nearestFall(V3(x, y, z), 2);
    const land = (x, y, z, s) => dry(x, y, z, s) && y > L + 1 && !stamped(x, z);
    const flat = (x, y, z, s) => land(x, y, z, s) && T.normalAt(x, z).y > 0.74;
    const ledge = (x, y, z, s) => flat(x, y, z, s) && y > L + 5;
    const bank = (x, y, z, s) => flat(x, y, z, s) && W.nearWater(V3(x, y, z), 3.5);
    const edge = (x, y, z, s) => (s !== -Infinity && s - y < 5 && s - y > -0.5) || (dry(x, y, z, s) && W.nearWater(V3(x, y, z), 2.5));
    const inPool = (x, z) => W.water.inMainPool(x, z);
    const deep = (dd) => (x, y, z, s) => inPool(x, z) && s !== -Infinity && s - y > dd;
    const wet = (a, b) => (x, y, z, s) => s !== -Infinity && s - y > a && s - y < b;
    return { dry, land, flat, ledge, bank, edge, inPool, deep, wet, stamped };
  }

  // Scales a count with the floor area of the tank (never below 1).
  cnt(n) { return Math.max(1, Math.round(n * this.sx * this.sz)); }
  // Scales a count with the background (epiphytes, climbers).
  wcnt(n) { return Math.max(1, Math.round(n * this.wallA)); }
  // How many real-size pieces cover what n pieces cover in the standard tank (dressing on rock faces that grow with the tank).
  cover(n) { return coverCount(n, this.dims); }
  // Extra groups a tank holds beyond the standard tank's composition: none up to the standard tank's room for pieces, then
  // `per` for every further standard tank's worth (a show tank holds about one more).
  extra(per) { return Math.max(0, Math.round((this.area / this.k ** 2 - 1) * per)); }
  // A height that is `f` of the standard tank's, at real size (spires and other accents that are not the tank's main feature).
  tall(f) { return f * 60 * this.k; }
  // A width or radius of a water feature: as the recipe has it, but in a big tank no more than its standard size grown with
  // the pieces (a stream in a show tank is not twice as wide as in the standard one).
  wide(v, std) { return Math.min(v, std * Math.max(1, this.k)); }

  // Is (x, z) in a stream bed (the pebbles carveChannel lays)?
  bed(x, z) { return this.F.mat[this.W.water.hydro.cellOf(x, z) * NMAT + MAT.sand] > 0.3; }

  // Is (x, z) at least r cm clear of every piece placed so far (by its footprint)?
  clear(x, z, r) {
    const D = this.W.decor;
    for (const p of D.pieces) {
      const b = D.pieceBox(p);
      const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2, pr = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) / 2;
      if (Math.hypot(cx - x, cz - z) < pr + r) return false;
    }
    return true;
  }

  // `groups` graded groups of boulders (odd numbers: 3, now and then 5) on ground that passes test(x, y, z, s), clear of the
  // pieces already placed: the extra hardscape a big tank holds at real size. `size` is the biggest stone in the standard
  // tank (cm). Returns how many stones were placed.
  scree(groups, test, { size = 11, variants = [6, 7, 8, 10, 11, 12], sink = 0.24, tries = 80 } = {}) {
    let made = 0;
    const s0 = size;   // scree stones are small: real size in every tank (sim/scale.js)
    for (let q = 0; q < groups; q++) {
      let c = null;
      for (let t = 0; t < tries && !c; t++) {
        const p = this.spot(test, 1, 4);
        if (p && this.clear(p.x, p.z, s0 * 0.9)) c = p;
      }
      if (!c) continue;
      const n = this.chance(0.35) ? 5 : 3, big = s0 * this.rand(0.85, 1.15), a0 = this.r() * 6.283;
      for (let i = 0; i < n; i++) {
        const s = big * [1, 0.62, 0.42, 0.32, 0.24][i];
        const a = a0 + i * 2.2 + this.rand(-0.4, 0.4), rr = i ? big * (0.5 + 0.22 * i) : 0;
        const x = clamp(c.x + Math.cos(a) * rr, -this.w / 2 + 3, this.w / 2 - 3), z = clamp(c.z + Math.sin(a) * rr * 0.8, -this.d / 2 + 3, this.d / 2 - 3);
        if (i && !test(x, this.ground(x, z), z, this.W.water.surfaceAt(x, z))) continue;
        if (this.piece('boulder', x, z, { size: s, variant: this.pick(variants), sink })) made++;
      }
    }
    return made;
  }

  // Lowers the ground toward the front glass so the substrate reads as a slope, not a floating sheet. In a tank built on a
  // false bottom (`falseFloor`, with the water level L: the egg-crate's mesh is fitted a centimetre over the water,
  // sim/plenum.js) land that meets the front glass keeps its own height up to a few centimetres of substrate over the mesh,
  // so the build shows through the glass as it does in a real one; the pool's bed still drops to the sill.
  sill(hgt, z, hFront = 4.5, reach = 8, L = null) {
    const k = smooth(this.d / 2 - reach, this.d / 2 - 1.5, z);
    if (this.falseFloor && L != null) hFront = lerp(hFront, Math.max(hFront, L + 4.5), smooth(L - 1, L + 2, hgt));
    return lerp(hgt, Math.min(hgt, hFront), k);
  }

  // A driftwood log lying across the ground with one end raised (decor.js settle rests it on its real lowest contact, or
  // plants it when it stands steeper than it is long; it used to be put at a height worked out from its middle and floated).
  log(x, z, len, tilt = 0.25, rot = 0, o = {}) {
    return this.piece('wood', x, z, { size: len, rot, tilt: [0, tilt], scale: [1, 1.5, 1.5], ...o });
  }

  // --- Environment ----------------------------------------------------------------------
  // A fogger is a fixed-output device: it is turned down in a small tank and up a little in a big one (sim/scale.js fogScale).
  env(o = {}, gear = []) {
    const E = this.W.env;
    if (o.fogger != null) o = { ...o, fogger: +(o.fogger * fogScale(this.dims)).toFixed(2) };
    E.matureTank();
    for (const [k, F] of Object.entries(FILTER_KINDS)) if (k !== 'sponge' && k !== 'matten' && gear.includes(F.gear)) E.filterKind = k;
    Object.assign(E, o);
    for (const g of gear) this.gear.add(g);
  }
}

// ---------------------------------------------------------------------------
// Shared building blocks

// Everything a fresh tank needs before a builder starts.
function resetWorld(g) {
  const W = g.W;
  W.clearAll();
  W.terrain.field.base.fill(3);
  W.terrain.field.setMaterial(MAT.soil);
  W.wall.field.h.fill(0.6);
  W.wall.field.setMaterial(MAT.stone);
  W.terrain.compose([]);
  W.water.setLevel(0);
  W.env.newTank();
}

// ---------------------------------------------------------------------------
// Builders. Each receives the Gen and returns nothing; they may set g.info notes.

const BUILDERS = {};

// ===== cascade ===============================================================
BUILDERS.cascade = (g) => {
  const { w, d, h, T, F } = g;
  const L = g.lvl(0.27);
  const nMid = h >= 75 ? 3 : h >= 55 ? 2 : 1;          // treads between the top pool and the lagoon
  const T0 = Math.round(Math.min(h - 9, h * 0.76));
  const D = (T0 - L) / (nMid + 1);
  const K = Array.from({ length: nMid + 1 }, (_, k) => T0 - k * D); // lip heights of the top pool and each tread
  const bedLow = 2.6;
  const rho = clamp(h * 0.033, 1.5, 3);                  // riser width
  const tl = clamp(d * 0.105, 3.4, 6.5);                 // tread length
  const xs = g.X(-0.44);                                 // the slot's centre: near a third of the width
  const hw = g.wide(clamp(w * 0.08, 4.2, 10), 90 * 0.08); // half width of the slot
  const cupD = 2.5, nd = 0.8, nw = clamp(hw * 0.62, 2.6, 5.4);
  const zTop = g.Z(0) + clamp(d * 0.15, 5.5, 8);
  const R0 = g.wide(clamp(w * 0.05, 3.6, 6.5), 90 * 0.05);
  const zs = [null, g.Z(0.215) + 0.5];                   // z where each riser starts
  for (let k = 2; k <= nMid + 1; k++) zs[k] = zs[k - 1] + rho + tl;
  const zFront = zs[nMid + 1] + rho * 1.6;
  const zEnd = zFront + 3;
  const noffs = [0, 1, -1, 0.6].map((o, k) => xs + o * g.rand(1.2, 2.6) * hw * 0.25);   // where each lip's notch sits
  const Kt = (k) => (k <= nMid ? K[k] : bedLow);
  const stair = (z) => {
    let v = K[0];
    for (let k = 1; k <= nMid + 1; k++) v -= (K[k - 1] - Kt(k)) * smooth(zs[k], zs[k] + (k === nMid + 1 ? rho * 1.6 : rho), z);
    return v;
  };
  const slotFloor = (x, z) => {
    let v = stair(z);
    for (let k = 1; k <= nMid; k++) {
      const z0 = zs[k] + rho, lip = zs[k + 1];
      v -= cupD * smooth(z0, z0 + 0.9, z) * smooth(lip, lip - 1.7, z);
      const dx = (x - noffs[k]) / nw;
      if (dx * dx < 1) v -= nd * (1 - dx * dx) * smooth(lip - 2.2, lip - 0.3, z) * smooth(lip + 0.9, lip - 0.1, z);
    }
    return v;
  };
  const lcx = g.X(0.05), lcz = g.Z(0.72), lrx = w * 0.56 * g.ps, lrz = d * 0.46 * g.ps;
  const cheekL = xs - hw - clamp(w * 0.12, 6, 16);
  const cheekR = xs + hw + clamp(w * 0.085, 4.5, 11);
  const shelf = { x0: g.X(0.3), z1: g.Z(0.3), y: Math.round(h * 0.4) };
  const P2 = { x: g.X(0.72), z: g.Z(0.15), R: g.wide(clamp(w * 0.038, 3, 5), 90 * 0.038) };
  const bankFront = { x: g.X(-0.7), z: g.Z(0.66), rx: w * 0.13, rz: d * 0.15 };
  const leftTop = Math.round(h * 0.5);                   // how high the ground reaches at the left glass

  g.fill((x, z) => {
    const nz = g.n(x, z, 0.09), nz2 = g.n(x, z, 0.25);
    const warp = (g.n(x + 30, z, 0.11) - 0.5) * 7 + (g.n(x, z + 9, 0.3) - 0.5) * 2.4;
    const lag = ell(x, z, lcx, lcz, lrx, lrz, 0.5, 1.0);
    const bank = L + 2.6 + nz * 1.8 + smooth(0.3, 0.0, (z + d / 2) / d) * 3;
    let hgt = lerp(bank, bedLow + 0.9 * nz2 + 0.8 * (1 - lag), lag);
    // The massif: the left third of the tank, a gorge with two cheeks, high in the middle.
    const mxR = smooth(cheekR + 2.5 + warp, cheekR - 2.5 + warp, x);
    const mz = smooth(zFront + 3 + warp * 0.5, zFront - 2.5 + warp * 0.5, z);
    const M = mxR * mz;
    const crest = T0 + 3.5 * (g.n(x, z, 0.1) - 0.5) * 2 * smooth(zs[1] - 1, zs[1] - 8, z);
    const slope = lerp(leftTop + 4 * nz, crest, smooth(-w / 2, cheekL - 2 + warp * 0.4, x));
    hgt = lerp(hgt, Math.max(hgt, slope), M);
    // The slot: stairs with cups and notches.
    const s = smooth(hw + 2.4, hw, Math.abs(x - xs)) * smooth(zEnd, zEnd - 3, z);
    hgt = lerp(hgt, slotFloor(x, z), s);
    // Back-right shelf with the spring pool.
    const sh = smooth(shelf.x0 - 6, shelf.x0 + 3, x) * smooth(shelf.z1 + 4, shelf.z1 - 4, z);
    hgt = lerp(hgt, Math.max(hgt, shelf.y + (g.n(x, z, 0.14) - 0.5) * 3), sh);
    // Front left bank.
    const bf = ell(x, z, bankFront.x, bankFront.z, bankFront.rx, bankFront.rz, 0.3, 1);
    hgt = Math.max(hgt, lerp(hgt, L + 4.5 + nz * 2, bf));
    // The front glass shows a low sill of sand, never a floating bank.
    hgt = lerp(hgt, Math.min(hgt, bedLow + 1.5 + (1 - smooth(d / 2 - 2, d / 2 - 9, z)) * 0 + 2.5 * smooth(d / 2 - 2, d / 2 - 9, z)), smooth(d / 2 - 9, d / 2 - 4, z));
    // Weathered ledges and gullies on the faces (only where the ground is steep).
    const face = clamp(M * (1 - M) * 4, 0, 1) + clamp(sh * (1 - sh) * 4, 0, 1);
    const groove = smooth(0.7, 1, 1 - Math.abs(2 * g.n(x * 0.32 + z * 0.06, z * 0.09, 3) - 1));
    return ledged(hgt - 2.4 * groove * face, face, 4.5);
  });

  // Top pool on the plateau, and the streams.
  T.digBasin(xs + noffs[0] * 0.3, zTop, R0, 3);
  T.carveChannel([V(xs + noffs[0] * 0.3, 0, zTop + R0 * 0.9), V(noffs[0], 0, zs[1] + 0.4)], 1.5, 0.6);
  T.digBasin(P2.x, P2.z, P2.R, 2.4);
  const st = [V(P2.x - 2, 0, P2.z + P2.R * 0.9), V(g.X(0.6), 0, g.Z(0.3)), V(g.X(0.5), 0, g.Z(0.44)), V(g.X(0.42), 0, g.Z(0.52)), V(g.X(0.36), 0, g.Z(0.6))];
  T.carveChannel(st, 1.7, 0.8);

  // Materials: weathered rock on the faces, moss on the tops, pebbles by the water.
  g.paint((x, z, hh, up, m, sandy) => {
    const mossy = g.n(x, z, 0.16) * 0.8 + g.n(x, z, 0.5) * 0.3;
    if (hh < L - 0.6) { m[MAT.sand] = 1; return; }
    const patch = smooth(0.35, 0.65, g.n(x * 1.3, hh * 0.8 + z, 0.21));
    if (up < 0.55) { m[MAT.stone] = 0.85 - 0.5 * patch; m[MAT.rock] = 0.15 + 0.5 * patch; return; }
    if (up < 0.82 && hh > L + 1.5) { m[MAT.rock] = 0.25 + 0.4 * patch; m[MAT.stone] = 0.75 - 0.4 * patch; if (mossy > 0.75) m[MAT.moss] = 0.55; return; }
    if (hh < L + 1.2) { m[MAT.gravel] = 0.6; m[MAT.soil] = 0.4; }
    else if (mossy > 0.45) m[MAT.moss] = 1;
    else m[MAT.soil] = 1;
    if (sandy > 0.3 && hh >= L - 0.6) { for (let k = 0; k < NMAT; k++) m[k] *= 1 - sandy; m[MAT.sand] += sandy; }
  });

  // Background: a broken rock face, quiet behind the falls, heavier over the cheeks.
  rockWall(g, {
    L, style: 'crag', moss: 0.9, rock: 0.5,
    calm: (x, y) => smooth(hw + 14, hw + 2, Math.abs(x - xs)) * smooth(T0 + 14, T0 + 2, y) * 0.85,
    extra: (x, y) => smooth(cheekR + 12, cheekR, x) * smooth(cheekL - 12, cheekL, x) * smooth(T0 - 6, T0 + 6, y) * 2.5,
  });

  // Hardscape: boulders in odd, graded numbers around the gorge, and spires as accents.
  const boulder = (x, z, size, v, o = {}) => g.piece('boulder', x, z, { size, variant: v, sink: 0.22, ...o });
  const mossy = [6, 7, 8, 10, 11, 12], warm = [2, 3, 5];
  boulder(cheekL + 3, g.Z(0.16), 24 * g.k, g.pick(warm));
  boulder(xs - hw - 4, zs[1] + 3, 12 * g.k, g.pick(mossy));
  boulder(cheekL - 2, g.Z(0.3), 15 * g.k, g.pick(mossy));
  boulder(cheekR - 1, zFront - 3, 16 * g.k, g.pick(warm));
  boulder(xs + hw + 4, zs[2] + 2, 9 * g.k, g.pick(mossy));
  boulder(xs - hw - 9, zFront + 5, 14 * g.k, g.pick(mossy));
  boulder(xs + hw + 6, zFront + 8, 8 * g.k, g.pick(warm));
  boulder(xs + hw + 14, zFront + 5, 4.5 * g.k, g.pick(mossy));
  boulder(bankFront.x + 3, bankFront.z, 14 * g.k, g.pick(mossy));
  boulder(bankFront.x - 6, bankFront.z + 2, 8 * g.k, g.pick(mossy));
  boulder(bankFront.x + 10, bankFront.z + 5, 5 * g.k, g.pick(mossy));
  boulder(g.X(0.5), g.Z(0.4), 10 * g.k, g.pick(warm));
  boulder(g.X(0.58), g.Z(0.47), 6 * g.k, g.pick(mossy));
  boulder(g.X(0.46), g.Z(0.36), 4 * g.k, g.pick(mossy));
  g.info = { dressed: g.dress(g.cover(10), (x, y, z) => y > L + 3 && Math.abs(x - xs) > hw + 3.5 && x > cheekL - 6 && x < cheekR + 5 && z < zFront + 1 && z > g.Z(0.04), { size: [8 * g.k, 19 * g.k], tries: 50 * g.cover(10) }) };
  g.spire(cheekL + 6, g.Z(0.06), g.tall(0.34), 7 * g.k);
  g.spire(cheekR - 2, g.Z(0.08), g.tall(0.3), 6 * g.k);
  g.spire(g.X(0.9), g.Z(0.08), g.tall(0.5), 9 * g.k);
  g.spire(g.X(0.8), g.Z(0.05), g.tall(0.34), 6 * g.k);
  // A bigger tank holds more stones at real size: graded groups on the banks and the shelf, clear of the slot, the pools and
  // the stream beds (none in the standard tank or a smaller one).
  g.scree(g.extra(2), (x, y, z) => y > L + 2 && Math.abs(x - xs) > hw + 6 && z < zFront + 12 && T.normalAt(x, z).y > 0.7 && !g.bed(x, z)
    && Math.hypot(x - P2.x, z - P2.z) > P2.R + 5, { size: 12 });

  g.water({ pump: [g.X(0.22), g.Z(0.78)], level: L, outlets: [{ x: xs + noffs[0] * 0.3, z: zTop }, { x: P2.x, z: P2.z }], rate: 300 });
  g.info = { ...g.info, L, cascade: { nMid, T0, xs, hw, zs, zTop } };

  // Plants: ferns and moss on the ledges, grasses by the water, tall leaves in the lagoon.
  const dry = (x, y, z, s) => s === -Infinity && !g.W.water.nearestFall(V(x, y, z), 2);
  const inSlot = (x, z) => Math.abs(x - xs) < hw + 5 && z < zFront + 9;
  const land = (x, y, z, s) => dry(x, y, z, s) && y > L + 1.2 && !inSlot(x, z) && !F.stamped[g.W.water.hydro.cellOf(x, z)];
  const flat = (x, y, z, s) => land(x, y, z, s) && g.T.normalAt(x, z).y > 0.72;
  const clingy = (x, y, z, s) => land(x, y, z, s) && y > L + 3 && g.T.normalAt(x, z).y > 0.5;
  g.clusters('fern', g.cnt(4), 3, clingy, { radius: 6, gap: 4 });
  g.clusters('weed', g.cnt(4), 3, clingy, { radius: 6, gap: 4 });
  g.scatter('fernph', g.cnt(12), (x, y, z, s) => flat(x, y, z, s) && y > L + 4, { gap: 5 });
  g.scatter('weed', g.cnt(10), flat, { gap: 4 });
  g.scatter('fern', g.cnt(6), flat, { gap: 5 });
  g.scatter('grass', g.cnt(8), (x, y, z, s) => flat(x, y, z, s) && g.W.nearWater(V(x, y, z), 3), { gap: 4 });
  g.scatter('javafern', g.cnt(4), (x, y, z, s) => g.W.water.inMainPool(x, z) && s - y > 4, { gap: 6 });
  g.scatter('vallisneria', g.cnt(8), (x, y, z, s) => g.W.water.inMainPool(x, z) && s - y > 7 && z < g.Z(0.7), { gap: 4 });
  g.wallScatter('bromeliad', g.wcnt(3), (x, y) => y > T0 + 4 || x > g.X(0.2));
  g.wallScatter('pothos', g.wcnt(4), (x, y) => y > L + 6);

  // Animals.
  g.animal('neon', Math.round(8 * g.sc), (x, y, z, s) => s - y > 6 && g.W.water.inMainPool(x, z));
  g.animal('newt', 4, (x, y, z, s) => s - y > 3 && g.W.water.inMainPool(x, z));
  g.animal('shrimp', Math.round(10 * g.sc), (x, y, z, s) => s - y > 2 && g.W.water.inMainPool(x, z));
  g.animal('isopod', g.cnt(8), land);
  g.animal('springtail', g.cnt(30), land);

  g.env({ setpoint: 20, drainage: 0.3, mediaBio: 0.6, lampPower: 1.1, fan: 0.1, rockMoss: 0.6, nitrate: 2, detritus: 8, algae: 0.02 }, ['fan']);
};

// A rock background. style: 'crag' (broken rock face), 'strata' (layered ledges), 'boulders' (rounded masses),
// 'blocks' (stacked slabs). calm(x, y) → 0 … 1 flattens the relief (behind falls and pools); extra(x, y) adds to it.
function rockWall(g, { L = 0, style = 'crag', moss = 0.8, rock = 0.5, mossMin = 3, calm = null, extra = null, relief = 1 } = {}) {
  const A = relief * clamp(g.WF.maxH / 16, 0.45, 1);
  const rd = (v) => 1 - Math.abs(2 * v - 1);
  const n = g.n;
  const styles = {
    crag: (x, y) => 1.5 + 4.5 * Math.pow(rd(n(x * 0.05, y * 0.13, 1)), 1.5) + 2 * rd(n(x * 0.12, y * 0.3, 3)) + 2.2 * n(x * 0.02, y * 0.03, 5),
    strata: (x, y) => {
      const r = 1.5 + 5 * Math.pow(rd(n(x * 0.04 + 3, y * 0.09)), 2);
      const band = y / 7 + n(x * 0.03, y * 0.03) * 1.5, f = band - Math.floor(band);
      return r + 2.4 * smooth(0, 0.1, f) * smooth(0.4, 0.1, f);
    },
    boulders: (x, y) => {
      const lump = smooth(0.35, 0.7, n(x * 0.045, y * 0.06));
      return 1.4 + lump * 6 + 1.6 * rd(n(x * 0.16, y * 0.2, 5)) * lump + 1.2 * rd(n(x * 0.1, y * 0.28, 9));
    },
    blocks: (x, y) => {
      const yy = y + (n(x * 0.05, y * 0.05) - 0.5) * 4, ch = 9, ci = Math.floor(yy / ch), fy = yy / ch - ci;
      const off = hash3(ci, 1, 2) * 30, cw = 13 + hash3(ci, 3, 4) * 12, bx = (x + off) / cw, bi = Math.floor(bx), fx = bx - bi;
      const eb = smooth(0, 0.16, fy) * smooth(1, 0.84, fy) * smooth(0, 0.1, fx) * smooth(1, 0.9, fx);
      return 1.4 + hash3(ci, bi, 5) * 4.2 * (0.3 + 0.7 * eb) + n(x * 0.2, y * 0.2) * 1.2;
    },
  };
  const fn = styles[style] ?? styles.crag;
  g.wallFill((x, y) => {
    const c = calm ? calm(x, y) : 0;
    const v = fn(x, y);
    return lerp(v * A, 1.2 + (v - 1.4) * 0.06, c) + (extra ? extra(x, y) : 0);
  }, (x, y, hh, m) => {
    const [, gy] = g.WF.gradient(x, y);
    const top = smooth(0.15, 0.7, -gy);           // ledges that face up gather moss
    const mo = g.n(x, y, 0.13) + g.n(x, y, 0.4) * 0.4 + top * 0.35;
    if (y > L + mossMin && mo > moss) { m[MAT.moss] = 0.85; m[MAT.rock] = 0.15; }
    else if (mo > rock) { m[MAT.rock] = 0.7; m[MAT.stone] = 0.3; }
    else m[MAT.stone] = 1;
  });
}

// Ground materials from shape: sand under water, rock on steep faces, moss and soil on the rest.
function groundPaint(g, L, { moss = 0.45, gravelBand = 1.2, rockUp = 0.82, stoneUp = 0.55, sand = null, bed = MAT.sand } = {}) {   // bed: the material under water (a recipe's `bed`: sand, soil = mud, gravel)
  g.paint((x, z, hh, up, m, sandy) => {
    const mo = g.n(x, z, 0.16) * 0.8 + g.n(x, z, 0.5) * 0.3;
    if (hh < L - 0.6 && (!sand || sand(x, z, hh))) { m[bed] = 1; return; }
    if (up < stoneUp) { m[MAT.stone] = 0.35; m[MAT.rock] = 0.65; return; }
    if (up < rockUp && hh > L + 1.5) { m[MAT.rock] = 0.75; m[MAT.stone] = 0.25; if (mo > 0.75) m[MAT.moss] = 0.55; return; }
    if (hh < L + gravelBand) { m[MAT.gravel] = 0.6; m[MAT.soil] = 0.4; }
    else if (mo > moss) m[MAT.moss] = 1;
    else m[MAT.soil] = 1;
    if (sandy > 0.3 && hh >= L - 0.6) { for (let k = 0; k < NMAT; k++) m[k] *= 1 - sandy; m[MAT.sand] += sandy; }
  });
}

// A mound: 1 at the centre, 0 at the edge, with a wobbly outline.
function mound(g, x, z, m) {
  const r = Math.hypot((x - m.x) / m.rx, (z - m.z) / m.rz);
  return smooth(1, 0, r + (g.n(x, z, 0.12) - 0.5) * 0.35);
}

// Weathered ledges on steep faces: `face` is 0 on flat ground, 1 on the flank of a mass.
function ledged(hgt, face, step = 4.5) {
  const t = hgt / step;
  const st = (Math.floor(t) + smooth(0.45, 0.9, t - Math.floor(t))) * step;
  return lerp(hgt, st, clamp(face, 0, 1) * 0.85);
}

// A rock outcrop: a steep-sided mass with a wobbly outline. Returns its mask 0 … 1.
function outcrop(g, x, z, o) {
  const r = Math.hypot((x - o.x) / o.rx, (z - o.z) / o.rz) + (g.n(x + 20, z, 0.09) - 0.5) * 0.5 + (g.n(x, z + 5, 0.3) - 0.5) * 0.12;
  return smooth(1.0, 0.62, r);
}

// ===== suriname ==============================================================
BUILDERS.suriname = (g) => {
  const { w, d, h, T } = g;
  const L = g.lvl(0.15);
  const out1 = { x: g.X(-0.3), z: g.Z(0.1), rx: w * 0.34, rz: d * 0.24, H: h * 0.62 };
  const out2 = { x: g.X(0.68), z: g.Z(0.1), rx: w * 0.2, rz: d * 0.22, H: h * 0.46 };
  const isl = { x: g.X(-0.44), z: g.Z(0.5), rx: w * 0.24, rz: d * 0.28, H: h * 0.34 };
  const pool = { x: g.X(0.3), z: g.Z(0.7), rx: w * 0.3 * g.ps, rz: d * 0.25 * g.ps };
  const seep = { x: out2.x, z: g.Z(0.16), R: g.wide(clamp(w * 0.03, 2.4, 4), 90 * 0.03) };
  const bedLow = 2.4;
  g.fill((x, z) => {
    const nz = g.n(x, z, 0.08), n2 = g.n(x, z, 0.3);
    let hgt = L + 2.4 + nz * 2.6 + n2 * 0.8;
    const m1 = outcrop(g, x, z, out1), m2 = outcrop(g, x, z, out2), mi = mound(g, x, z, isl);
    const top1 = out1.H + (g.n(x, z, 0.1) - 0.5) * 6, top2 = out2.H + (g.n(x, z, 0.12) - 0.5) * 4;
    hgt = lerp(hgt, Math.max(hgt, top1), m1);
    hgt = lerp(hgt, Math.max(hgt, top2), m2);
    hgt = lerp(hgt, Math.max(hgt, isl.H + (n2 - 0.5) * 3), Math.pow(mi, 0.8));
    const lag = ell(x, z, pool.x, pool.z, pool.rx, pool.rz, 0.5, 1.0);
    hgt = lerp(hgt, bedLow + (1 - lag) * 1.4 + 0.6 * n2, lag);
    hgt = ledged(hgt, Math.max(m1 * (1 - m1), m2 * (1 - m2)) * 4, 5);
    return g.sill(hgt, z, 5.5, 7);
  });
  T.digBasin(seep.x, seep.z, seep.R, 2);
  T.carveChannel([V(seep.x - 1, 0, seep.z + seep.R), V(g.X(0.58), 0, g.Z(0.3)), V(g.X(0.42), 0, g.Z(0.5)), V(g.X(0.34), 0, g.Z(0.6))], 1.6, 0.7);
  groundPaint(g, L, { moss: 0.34, gravelBand: 0.3, rockUp: 0.68, stoneUp: 0.45, sand: (x, z) => ell(x, z, pool.x, pool.z, pool.rx * 1.05, pool.rz * 1.05, 0.5, 1) > 0.05 });
  rockWall(g, { L, style: 'boulders', moss: 0.88, rock: 0.5, calm: (x, y) => smooth(seep.R + 9, seep.R + 2, Math.abs(x - seep.x)) * smooth(h * 0.85, h * 0.45, y) });

  const boulder = (x, z, size, v, o = {}) => g.piece('boulder', x, z, { size, variant: v, sink: 0.22, ...o });
  const mossy = [6, 7, 8, 10, 11, 12], warm = [2, 3, 5];
  g.piece('roots', isl.x + 3, isl.z - 2, { size: 40 * g.k, rot: 0.5, sink: 0.05, scale: [1, 1.5, 1] });
  g.piece('stump', isl.x - 9 * g.kx, isl.z + 8 * g.kz, { size: 18 * g.k, sink: 0.1 });
  g.log(isl.x + 1, isl.z - 6 * g.kz, 52 * g.k, 1.32, 0.3);
  boulder(out1.x + 14, out1.z + 16, 15 * g.k, g.pick(warm));
  boulder(out1.x + 21, out1.z + 18, 8 * g.k, g.pick(mossy));
  boulder(out1.x + 25, out1.z + 21, 4.5 * g.k, g.pick(mossy));
  boulder(out2.x - 6, out2.z + 16, 11 * g.k, g.pick(mossy));
  boulder(pool.x - pool.rx * 0.9, pool.z + 1, 9 * g.k, g.pick(mossy));
  g.log(pool.x + 2, pool.z - 9, 30 * g.k, 0.12, 0.45);
  // A bigger tank: a second root tangle on the far outcrop, and more stones on the higher ground.
  if (g.extra(1) > 0) g.piece('roots', out2.x - 4, out2.z + 9, { size: 30 * g.k, rot: 2.2, sink: 0.05, scale: [1, 1.3, 1] });
  g.scree(g.extra(2), (x, y, z) => y > L + 4 && T.normalAt(x, z).y > 0.7 && !g.bed(x, z) && Math.hypot(x - seep.x, z - seep.z) > seep.R + 5, { size: 10 });

  g.water({ pump: [pool.x, pool.z], level: L, outlets: [{ x: seep.x, y: h * 0.72, wall: true }], rate: 120 });
  g.info = { L };
  const Z = g.zones(L);
  g.clusters('fernph', g.cnt(4), 3, Z.flat, { radius: 8, gap: 5 });
  g.clusters('fern', g.cnt(3), 3, Z.flat, { radius: 7, gap: 5 });
  g.clusters('weed', g.cnt(5), 4, Z.flat, { radius: 7, gap: 3.5 });
  g.scatter('bilberry', g.cnt(3), Z.ledge, { gap: 8 });
  g.scatter('grass', g.cnt(8), Z.bank, { gap: 4 });
  g.scatter('bromeliad', g.cnt(3), (x, y, z, s) => Z.ledge(x, y, z, s) && y > L + 10, { gap: 10 });
  g.wallScatter('bromeliad', g.wcnt(4) + 1, (x, y) => y > L + 10, { gap: 12 });
  g.wallScatter('pothos', g.wcnt(4) + 1, (x, y) => y > L + 8, { gap: 10 });
  g.animal('dartfrog', Math.max(2, g.cnt(3)), Z.land);
  g.animal('isopod', g.cnt(16), Z.land);
  g.animal('springtail', g.cnt(60), Z.land);
  g.W.equipment.pos.fogger = { x: isl.x + 10 * g.k, z: isl.z + 10 * g.k };
  g.env({ setpoint: 24, drainage: 0.25, mediaBio: 0.5, lampPower: 1.1, fan: 0.15, fogger: 0.55, rockMoss: 0.7, nitrate: 1, detritus: 8, algae: 0.02, rainProgram: [{ at: 450, len: 6 }, { at: 1080, len: 6 }] }, ['fan', 'fogger', 'mister']);
};

// ===== blackwater ============================================================
BUILDERS.blackwater = (g) => {
  const { w, d, h, T } = g;
  const L = g.lvl(0.42);
  const bl = { x: g.X(-0.72), z: g.Z(0.14), rx: w * 0.26, rz: d * 0.3, H: L + 9 };
  const br = { x: g.X(0.78), z: g.Z(0.12), rx: w * 0.22, rz: d * 0.28, H: L + 5 };
  const bedLow = 2.6;
  g.fill((x, z) => {
    const nz = g.n(x, z, 0.09), n2 = g.n(x, z, 0.3);
    const lag = ell(x, z, g.X(0.05), g.Z(0.62), w * 0.66 * g.ps, d * 0.62 * g.ps, 0.6, 1.0);
    let hgt = lerp(L + 3 + nz * 2, bedLow + 2.2 * g.n(x, z, 0.06) + n2 * 0.7 + smooth(0.6, 0, (z + d / 2) / d) * 3, lag);
    hgt = lerp(hgt, Math.max(hgt, bl.H), mound(g, x, z, bl));
    hgt = lerp(hgt, Math.max(hgt, br.H), mound(g, x, z, br));
    return g.sill(hgt, z, 3.5, 6, L);
  });
  groundPaint(g, L, { moss: 0.5, bed: g.P.bed ? MAT[g.P.bed] : MAT.sand, ...(g.P.ground ?? {}) });
  rockWall(g, { L, style: 'boulders', moss: 0.9, rock: 0.5, calm: (x, y) => 0.25, ...(g.P.wall ?? {}) });   // S1: a recipe's `wall` (style, moss, rock, relief) gives each place its own back wall

  const boulder = (x, z, size, v, o = {}) => g.piece('boulder', x, z, { size, variant: v, sink: 0.25, ...o });
  const mossy = [6, 7, 8, 10, 11, 12];
  const fx = g.X(-0.3), fz = g.Z(0.52);
  // S1: the recipe's hardscape mix (`mix: { logs, roots, boulders }`, default 3, 1, 3) and `rocks` (stones on the bed)
  const mx = { logs: 3, roots: 1, boulders: 3, ...(g.P.mix ?? {}) };
  if (mx.roots > 0) g.piece('roots', fx - 6, fz + 2, { size: 36 * g.k, rot: 0.3, sink: 0.05 });
  [() => g.log(fx + 2, fz - 4, 46 * g.k, 0.62, 0.35), () => g.log(fx + 7, fz + 6, 34 * g.k, 0.42, 2.6), () => g.log(g.X(0.4), g.Z(0.6), 30 * g.k, 0.05, 0.4)].slice(0, mx.logs).forEach((f) => f());
  [() => boulder(fx - 12, fz + 8, 11 * g.k, g.pick(mossy)), () => boulder(fx + 14, fz + 9, 6 * g.k, g.pick(mossy)), () => boulder(g.X(0.12), g.Z(0.78), 3.5 * g.k, g.pick(mossy))].slice(0, mx.boulders).forEach((f) => f());
  for (let i = 1; i < mx.roots; i++) { const c = g.spot((x, y, z) => y > L - 5 && y < L + 8 && g.clear(x, z, 10 * g.k), 200); if (c) g.piece('roots', c.x, c.z, { size: g.rand(24, 34) * g.k, rot: g.r() * 6.283, sink: 0.05 }); }
  // S1: `rocks` = river stones on the bed (a flowing river variant)
  for (let i = 0; i < (g.P.rocks ?? 0); i++) { const c = g.spot((x, y, z) => y < L - 3 && g.clear(x, z, 8 * g.k), 200); if (c) boulder(c.x, c.z, g.rand(5, 9) * g.k, g.pick(mossy), { sink: 0.4 }); }
  // A bigger lagoon holds more wood at real size: a second tangle of roots and branches on the right, and sunken logs.
  if (g.extra(1) > 0) {
    const rx = g.X(0.45), rz = g.Z(0.42);
    g.piece('roots', rx, rz, { size: 30 * g.k, rot: 2.4, sink: 0.05 });
    g.log(rx - 6, rz + 5, 38 * g.k, 0.5, 2.9);
  }
  for (let i = 0; i < g.extra(2); i++) { const c = g.spot((x, y, z) => y < L - 6 && g.clear(x, z, 10 * g.k), 200); if (c) g.log(c.x, c.z, g.rand(22, 32) * g.k, g.rand(0, 0.15), g.r() * 6.283); }

  g.water({ pump: [g.X(0.35), g.Z(0.4)], level: L, outlets: [], rate: g.P.rate ?? 160 });   // S1: `rate` = the pump's flow (a river runs more than a pond)
  g.info = { L };
  const Z = g.zones(L);
  g.scatter('vallisneria', g.cnt(10), (x, y, z, s) => Z.deep(9)(x, y, z, s) && z < g.Z(0.55), { gap: 4 });
  g.scatter('sword', g.cnt(4), Z.deep(6), { gap: 9 });
  g.scatter('javafern', g.cnt(8), Z.deep(6), { gap: 5 });
  g.scatter('frogbit', g.cnt(8), Z.deep(6), { gap: 5 });
  g.scatter('fernph', g.cnt(5), Z.ledge, { gap: 6 });
  g.scatter('weed', g.cnt(5), Z.flat, { gap: 5 });
  g.scatter('grass', g.cnt(4), Z.bank, { gap: 5 });
  g.wallScatter('pothos', g.wcnt(4) + 1, (x, y) => y > L + 4, { gap: 10 });
  g.wallScatter('bromeliad', g.wcnt(2), (x, y) => y > L + 12, { gap: 14 });
  const litres = g.W.water.volumeLitres();
  const nf = clamp(Math.round(litres / 7), 5, 14);
  g.animal('cardinal', nf, Z.deep(6));
  g.animal('cory', Math.max(3, Math.round(nf / 3)), Z.deep(5));
  g.animal('shrimp', Math.max(4, Math.round(nf * 0.9)), Z.deep(3));
  g.env({ setpoint: 25.5, drainage: 0.3, mediaBio: 0.75, lampPower: 1, fan: 0.1, rockMoss: 0.6, nitrate: 6, algae: 0.02 }, ['fan', 'filterCanister']);
};

// ===== stream ================================================================
BUILDERS.stream = (g) => {
  const { w, d, h, T } = g;
  const L = g.lvl(0.17);
  const mir = g.chance(0.5) ? -1 : 1;
  const X = (u) => g.X(u * mir);
  // A seep on the rock at the back feeds a top pool; the water steps down through two more pools to the lagoon. The pools are
  // real sizes (no wider than their standard size grown with the pieces); a wide tank gets one more step instead, so its
  // stream is longer and winds further, not wider.
  const P = [
    { x: X(0.56), z: g.Z(0.1), r: g.wide(clamp(w * 0.045, 3, 6), 90 * 0.045), H: Math.round(h * 0.42) },
    { x: X(0.36), z: g.Z(0.33), r: g.wide(clamp(w * 0.07, 4, 8.5), 90 * 0.07), H: Math.round(h * 0.31) },
    { x: X(0.02), z: g.Z(0.5), r: g.wide(clamp(w * 0.155, 8, 18), 90 * 0.155), H: Math.round(h * 0.27), big: true },
  ];
  if (w >= 115) P.splice(1, 0, { x: X(0.72), z: g.Z(0.3), r: P[0].r * 1.1, H: Math.round(h * 0.36) });
  const Pb = P[P.length - 1], P1 = P[P.length - 2];      // the big pond, and the pool that spills into it
  const lag = { x: X(-0.42), z: g.Z(0.76), rx: w * 0.3 * g.ps, rz: d * 0.28 * g.ps };
  const rock = { x: X(0.64), z: g.Z(0.05), rx: w * 0.3, rz: d * 0.34, H: h * 0.7 };
  const bedLow = 2.6;
  g.fill((x, z) => {
    const nz = g.n(x, z, 0.09), n2 = g.n(x, z, 0.3);
    const v = (z + d / 2) / d;
    let hgt = lerp(0.32 * h, L + 2.6, smooth(0.0, 0.7, v)) + (nz - 0.5) * 5;
    const mr = outcrop(g, x, z, rock);
    hgt = lerp(hgt, Math.max(hgt, rock.H + (g.n(x, z, 0.1) - 0.5) * 6), mr);
    for (let k = 0; k < P.length; k++) {
      const p = P[k];
      const sh = ell(x, z, p.x, p.z, p.r * 1.7, p.r * 1.35, 0.7, 1.15);
      hgt = lerp(hgt, p.H + (n2 - 0.5) * 1.2, sh);
    }
    const lg = ell(x, z, lag.x, lag.z, lag.rx, lag.rz, 0.55, 1.0);
    hgt = lerp(hgt, bedLow + 1.5 * (1 - lg) + n2, lg);
    hgt = ledged(hgt, mr * (1 - mr) * 4, 5);
    return g.sill(hgt, z, 4, 7);
  });
  // Most basins are small cups; the biggest is a real pond (about 1.5 L in a standard tank, scaling with the tank) with room
  // for its own chemistry, deep enough for a fish.
  for (const p of P) { if (p.big) T.digBasin(p.x, p.z, p.r * 0.92, clamp(h * 0.105, 4, 8)); else T.digBasin(p.x, p.z, p.r * 0.75, 2.5); }
  const chan = (a, b, r0, r1, wd, bend) => {
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    const ax = a.x + (dx / len) * r0, az = a.z + (dz / len) * r0, bx = b.x - (dx / len) * r1, bz = b.z - (dz / len) * r1;
    T.carveChannel([V(ax, 0, az), V((ax + bx) / 2 + (bz - az) * bend, 0, (az + bz) / 2 - (bx - ax) * bend), V(bx, 0, bz)], wd, 0.8);
  };
  for (let k = 0; k < P.length - 1; k++) chan(P[k], P[k + 1], P[k].r * 0.7, P[k + 1].r * 0.6, k ? 1.7 : 1.5, k % 2 ? -0.15 : 0.15);
  chan(Pb, { x: lag.x + mir * lag.rx * 0.3, z: lag.z - lag.rz * 0.5 }, Pb.r * 0.7, 2, 1.9, 0.12);
  groundPaint(g, L, { moss: 0.34, gravelBand: 0.5, rockUp: 0.7, stoneUp: 0.5, sand: (x, z) => ell(x, z, lag.x, lag.z, lag.rx * 1.05, lag.rz * 1.05, 0.5, 1) > 0.02 });
  rockWall(g, { L, style: 'crag', moss: 0.88, rock: 0.5, calm: (x, y) => smooth(P[0].r + 10, P[0].r + 2, Math.abs(x - P[0].x)) * smooth(h * 0.9, h * 0.5, y) });

  const boulder = (x, z, size, v, o = {}) => g.piece('boulder', x, z, { size, variant: v, sink: 0.24, ...o });
  const mossy = [6, 7, 8, 10, 11, 12], warm = [2, 3, 5];
  boulder(P[0].x - mir * 10, P[0].z + 6, 12 * g.k, g.pick(mossy));
  boulder(P1.x - mir * 10, P1.z + 2, 15 * g.k, g.pick(warm));
  boulder(P1.x + mir * 3, P1.z + 9, 8 * g.k, g.pick(mossy));
  boulder(P1.x - mir * 14, P1.z + 7, 4.5 * g.k, g.pick(mossy));
  boulder(Pb.x - mir * 10, Pb.z + 3, 13 * g.k, g.pick(warm));
  boulder(Pb.x + mir * 7, Pb.z + 9, 7 * g.k, g.pick(mossy));
  boulder(lag.x + mir * lag.rx * 0.6, lag.z - 4, 9 * g.k, g.pick(mossy));
  boulder(lag.x - mir * lag.rx * 0.5, lag.z - 10, 5 * g.k, g.pick(mossy));
  g.dress(g.cover(9), (x, y, z) => y > L + 3 && outcrop(g, x, z, rock) > 0.05 && z > g.Z(0.02) && Math.hypot(x - P[0].x, z - P[0].z) > P[0].r + 3, { size: [7 * g.k, 17 * g.k], tries: Math.max(500, 50 * g.cover(9)) });
  g.spire(X(0.88), g.Z(0.16), g.tall(0.5), 7 * g.k);
  g.spire(X(-0.92), g.Z(0.1), g.tall(0.36), 6 * g.k);
  // More stones in a bigger tank, on the banks between the pools (not in a pool or a stream bed).
  g.scree(g.extra(2), (x, y, z) => y > L + 3 && T.normalAt(x, z).y > 0.7 && !g.bed(x, z) && P.every((p) => Math.hypot(x - p.x, z - p.z) > p.r * 1.3 + 3), { size: 11 });

  g.water({ pump: [lag.x, lag.z], level: L, outlets: [{ x: P[0].x, y: h * 0.8, wall: true }, { x: Pb.x + Pb.r * 0.5, z: Pb.z }], rate: 320, settle: 900 });   // the second outlet fills the big pond
  g.info = { ...g.info, L };
  const Z = g.zones(L);
  const clingy = (x, y, z, s) => Z.land(x, y, z, s) && y > L + 3 && T.normalAt(x, z).y > 0.55;
  g.clusters('fernph', g.cnt(5), 3, Z.flat, { radius: 8, gap: 5 });
  g.clusters('fern', g.cnt(3), 3, clingy, { radius: 6, gap: 5 });
  g.clusters('weed', g.cnt(5), 3, Z.flat, { radius: 7, gap: 3.5 });
  g.scatter('grass', g.cnt(10), Z.bank, { gap: 4 });
  g.scatter('bilberry', g.cnt(3), Z.ledge, { gap: 9 });
  g.scatter('javafern', g.cnt(4), Z.deep(4), { gap: 6 });
  g.scatter('vallisneria', g.cnt(6), Z.deep(7), { gap: 5 });
  g.wallScatter('pothos', g.wcnt(2), (x, y) => y > L + 6, { gap: 12 });
  g.wallScatter('bromeliad', g.wcnt(2) + 1, (x, y) => y > L + 10, { gap: 14 });
  g.animal('toad', Math.max(2, g.cnt(3)), (x, y, z, s) => Z.bank(x, y, z, s) || Z.edge(x, y, z, s));
  g.animal('shrimp', g.cnt(8), Z.deep(3));
  g.animal('isopod', g.cnt(8), Z.land);
  g.animal('springtail', g.cnt(30), Z.land);
  g.env({ setpoint: 18, drainage: 0.3, mediaBio: 0.6, lampPower: 1.05, fan: 0.1, rockMoss: 0.65, nitrate: 2, detritus: 8, algae: 0.02 }, ['fan']);
};

// ===== jar ==================================================================
BUILDERS.jar = (g) => {
  const { w, d, h } = g;
  const L = 2.4;
  const hill1 = { x: g.X(-0.34), z: g.Z(0.4), rx: w * 0.3, rz: d * 0.34, H: h * 0.36 };
  const hill2 = { x: g.X(0.5), z: g.Z(0.24), rx: w * 0.22, rz: d * 0.24, H: h * 0.2 };
  const flat = { x: g.X(0.2), z: g.Z(0.7), rx: w * 0.44, rz: d * 0.3 };
  g.fill((x, z) => {
    const nz = g.n(x, z, 0.16), n2 = g.n(x, z, 0.5);
    let hgt = L + 2.2 + nz * 2.4 + n2 * 0.5;
    hgt = lerp(hgt, Math.max(hgt, hill1.H + n2), mound(g, x, z, hill1));
    hgt = lerp(hgt, Math.max(hgt, hill2.H + n2), mound(g, x, z, hill2));
    // A shallow, wide flat of wet pebbles: hardly any water, plenty of damp surface.
    const pd = ell(x, z, flat.x, flat.z, flat.rx, flat.rz, 0.55, 1.0);
    hgt = lerp(hgt, 1.3 + 0.5 * n2, pd);
    return g.sill(hgt, z, 3.4, 5);
  });
  groundPaint(g, L, { moss: 0.3, gravelBand: 0.4 });
  rockWall(g, { L, style: 'blocks', moss: 0.55, rock: 0.4, mossMin: 1, relief: 0.7 });
  g.piece('boulder', g.X(-0.04), g.Z(0.4), { size: 12, variant: g.pick([6, 8, 10, 11]), sink: 0.25 });
  g.piece('boulder', g.X(0.1), g.Z(0.5), { size: 5.5, variant: g.pick([6, 7, 12]), sink: 0.25 });
  g.piece('boulder', g.X(-0.66), g.Z(0.66), { size: 3.6, variant: g.pick([6, 7, 12]), sink: 0.25 });
  g.water({ pump: [flat.x, flat.z], level: L, outlets: [], rate: 60 });
  g.info = { L };
  const Z = g.zones(L);
  g.scatter('fernph', 2, (x, y, z, s) => Z.flat(x, y, z, s) && y > L + 3, { gap: 8 });
  g.scatter('fern', 2, Z.flat, { gap: 7 });
  g.scatter('weed', 8, Z.flat, { gap: 3 });
  g.scatter('grass', 4, Z.flat, { gap: 4 });
  g.wallScatter('pothos', 3, (x, y) => y > L + 5, { gap: 8 });
  g.animal('isopod', 10, Z.land);
  g.animal('springtail', 50, Z.land);
  g.env({ setpoint: 22, drainage: 0.05, mediaBio: 0.4, lampPower: 1.0, fan: 0, filter: false, rockMoss: 0.8, nitrate: 1, detritus: 12, algae: 0.02 }, []);   // a sealed jar runs no filter
};

// ===== karst ================================================================
BUILDERS.karst = (g) => {
  const { w, d, h, T } = g;
  const L = g.lvl(0.19);
  const bedLow = 3;
  const back = { x: 0, z: g.Z(0.05), rx: w * 0.62, rz: d * 0.18 };
  // Spire groups: [height as a fraction of the tank, width in cm, dx, dz]; widths and spacing are real sizes (times g.k), so a
  // bigger tank gets a third, lower group in the back between the two instead of fatter towers.
  const clusters = [
    { x: g.X(-0.38), z: g.Z(0.42), s: [[0.86, 13, 0, 0], [0.6, 10, 9, 5], [0.38, 8, -8, 5]] },
    { x: g.X(0.5), z: g.Z(0.3), s: [[0.7, 11, 0, 0], [0.42, 8, -9, 6]] },
  ];
  if (g.extra(1) > 0) clusters.push({ x: g.X(0.08), z: g.Z(0.16), s: [[0.5, 10, 0, 0], [0.32, 7, 8, 4], [0.22, 6, -7, 5]] });
  const lone = [{ x: g.X(-0.88), z: g.Z(0.2), h: 0.32, w: 7 }, { x: g.X(0.88), z: g.Z(0.62), h: 0.26, w: 6 }];
  g.fill((x, z) => {
    const nz = g.n(x, z, 0.08), n2 = g.n(x, z, 0.3);
    let hgt = bedLow + 1.2 * nz + n2 * 0.6 + smooth(0.7, 0, (z + d / 2) / d) * 1.6;
    const bk = ell(x, z, back.x, back.z, back.rx, back.rz, 0.55 + 0.25 * n2, 1.0);
    hgt = lerp(hgt, L + 3 + nz * 2.4, bk);
    for (const c of clusters) for (const [, wd, dx, dz] of c.s) {
      const m = ell(x, z, c.x + dx * g.kx, c.z + dz * g.kz, wd * 0.9 * g.k + 3, wd * 0.75 * g.k + 3, 0.2, 1.0);
      hgt = lerp(hgt, Math.max(hgt, L + 2.4 + n2 * 1.4), m);
    }
    return g.sill(hgt, z, 3.6, 6);
  });
  groundPaint(g, L, { moss: 0.36, gravelBand: 0.6 });
  rockWall(g, { L, style: 'strata', moss: 0.9, rock: 0.3, mossMin: 2 });
  for (const c of clusters) for (const [hf, wd, dx, dz] of c.s) g.spire(c.x + dx * g.kx, c.z + dz * g.kz, h * hf, wd * g.k);
  for (const l of lone) g.spire(l.x, l.z, h * l.h, l.w * g.k);
  const boulder = (x, z, size, v) => g.piece('boulder', x, z, { size, variant: v, sink: 0.3 });
  boulder(clusters[0].x + 12 * g.kx, clusters[0].z + 10 * g.kz, 9 * g.k, g.pick([6, 7, 8, 10]));
  boulder(clusters[0].x - 4 * g.kx, clusters[0].z + 10 * g.kz, 5 * g.k, g.pick([6, 7, 12]));
  boulder(clusters[1].x - 5 * g.kx, clusters[1].z + 11 * g.kz, 7 * g.k, g.pick([6, 7, 8]));
  g.scree(g.extra(2), (x, y, z) => y > L + 1.5 && T.normalAt(x, z).y > 0.75, { size: 8 });
  g.water({ pump: [g.X(0.05), g.Z(0.62)], level: L, outlets: [], rate: 100 });
  g.info = { L };
  const Z = g.zones(L);
  g.clusters('bamboo', g.cnt(4), 3, Z.edge, { radius: 8, gap: 4 });
  g.clusters('cattail', g.cnt(3), 3, Z.edge, { radius: 7, gap: 4 });
  g.scatter('grass', g.cnt(8), Z.bank, { gap: 4 });
  g.scatter('fernph', g.cnt(6), Z.flat, { gap: 6 });
  g.scatter('weed', g.cnt(8), Z.flat, { gap: 4 });
  g.scatter('javafern', g.cnt(3), Z.deep(3.5), { gap: 6 });
  g.wallScatter('bromeliad', g.wcnt(3) + 1, (x, y) => y > L + 10, { gap: 14 });
  g.wallScatter('pothos', g.wcnt(5), (x, y) => y > L + 6, { gap: 9 });
  // Geckos with the background: two on the standard tank's, more on a bigger one, none in a tank too low to climb in.
  const perches = [[0.3, 0.5], [-0.05, 0.62], [0.62, 0.42], [-0.55, 0.56], [0.12, 0.38], [-0.78, 0.66]];
  for (const [u, f] of perches.slice(0, Math.min(perches.length, g.wcnt(2)))) g.wallAnimal('gecko', g.X(u), h * f);
  g.animal('springtail', g.cnt(40), Z.land);
  g.animal('isopod', g.cnt(10), Z.land);
  g.env({ setpoint: 25, drainage: 0.3, mediaBio: 0.5, lampPower: 1.15, fan: 0, fogger: 0.4, rockMoss: 0.5, nitrate: 2, detritus: 8, algae: 0.02 }, ['fogger']);
};

// ===== swamp ================================================================
BUILDERS.swamp = (g) => {
  const { w, d, h, T } = g;
  const L = g.lvl(0.15);
  const bedLow = 2.6;
  const ponds = [
    { x: g.X(-0.32), z: g.Z(0.62), rx: w * 0.26 * g.ps, rz: d * 0.28 * g.ps },
    { x: g.X(0.36), z: g.Z(0.68), rx: w * 0.28 * g.ps, rz: d * 0.24 * g.ps },
  ];
  const hum = [{ x: g.X(-0.74), z: g.Z(0.3), rx: w * 0.15, rz: d * 0.2, H: L + 9 }, { x: g.X(0.74), z: g.Z(0.28), rx: w * 0.14, rz: d * 0.2, H: L + 7 }, { x: g.X(0.02), z: g.Z(0.14), rx: w * 0.3, rz: d * 0.18, H: L + 10 }];
  const seep = { x: g.X(0.2), z: g.Z(0.1), R: g.wide(clamp(w * 0.03, 2.4, 4), 90 * 0.03) };
  g.fill((x, z) => {
    const nz = g.n(x, z, 0.1), n2 = g.n(x, z, 0.32);
    let hgt = L + 1.8 + nz * 3 + n2 * 1.2;
    for (const m of hum) hgt = lerp(hgt, Math.max(hgt, m.H + n2 * 1.4), mound(g, x, z, m));
    for (const p of ponds) hgt = lerp(hgt, bedLow + 0.8 * n2, ell(x, z, p.x, p.z, p.rx, p.rz, 0.55, 1.0));
    // A shallow channel joins the ponds.
    const ax = ponds[0].x, az = ponds[0].z, bx = ponds[1].x, bz = ponds[1].z;
    const vx = bx - ax, vz = bz - az, t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
    const c = smooth(3.6, 1.4, Math.hypot(x - ax - vx * t, z - az - vz * t));
    hgt = lerp(hgt, Math.min(hgt, L - 1.4), c);
    return g.sill(hgt, z, 3.6, 6, L);
  });
  T.digBasin(seep.x, seep.z, seep.R, 2);
  T.carveChannel([V(seep.x, 0, seep.z + seep.R), V(g.X(0.12), 0, g.Z(0.3)), V(g.X(0.02), 0, g.Z(0.46)), V(g.X(0.02), 0, g.Z(0.56))], 1.6, 0.6);
  groundPaint(g, L, { moss: 0.34, gravelBand: 0.5, rockUp: 0.7, stoneUp: 0.5 });
  rockWall(g, { L, style: 'crag', moss: 0.78, rock: 0.45, calm: (x, y) => smooth(seep.R + 8, seep.R + 2, Math.abs(x - seep.x)) * smooth(h * 0.85, h * 0.5, y) * 0.7 });
  const boulder = (x, z, size, v) => g.piece('boulder', x, z, { size, variant: v, sink: 0.3 });
  g.log(hum[0].x + 6, hum[0].z + 4, 50 * g.k, 1.3, 0.3);
  g.piece('stump', hum[0].x + 4, hum[0].z + 9, { size: 14 * g.k, sink: 0.1 });
  g.log(hum[2].x + 12, hum[2].z + 10, 32 * g.k, 0.1, 0.25);
  boulder(hum[1].x, hum[1].z + 4, 11 * g.k, g.pick([6, 7, 8, 10]));
  boulder(hum[1].x - 8, hum[1].z + 8, 6 * g.k, g.pick([6, 7, 12]));
  boulder(hum[1].x + 6, hum[1].z + 10, 3.5 * g.k, g.pick([6, 7, 12]));
  // A bigger swamp: a fallen log on the right hummock and stones on the higher ground.
  if (g.extra(1) > 0) g.log(hum[1].x - 4, hum[1].z - 2, 36 * g.k, 0.8, 2.7);
  g.scree(g.extra(2), (x, y, z) => y > L + 3 && T.normalAt(x, z).y > 0.72 && !g.bed(x, z), { size: 9 });
  g.water({ pump: [ponds[1].x, ponds[1].z], level: L, outlets: [{ x: seep.x, y: h * 0.7, wall: true }], rate: 100 });
  g.info = { L };
  const Z = g.zones(L);
  g.clusters('cattail', g.cnt(4), 4, Z.edge, { radius: 8, gap: 4 });
  g.clusters('bamboo', g.cnt(3), 3, Z.edge, { radius: 8, gap: 6 });
  g.clusters('grass', g.cnt(5), 4, Z.flat, { radius: 8, gap: 3.5 });
  g.scatter('weed', g.cnt(10), Z.flat, { gap: 4 });
  g.scatter('fernph', g.cnt(6), Z.ledge, { gap: 6 });
  g.scatter('bilberry', g.cnt(2), Z.ledge, { gap: 9 });
  g.scatter('frogbit', g.cnt(8), Z.deep(2.5), { gap: 4 });
  g.wallScatter('pothos', g.wcnt(5) + 1, (x, y) => y > L + 6, { gap: 10 });
  g.wallScatter('bromeliad', g.wcnt(2), (x, y) => y > L + 12, { gap: 14 });
  g.animal('crab', Math.max(2, g.cnt(3)), (x, y, z, s) => Z.land(x, y, z, s) && g.W.nearWater(V(x, y, z), 5));
  g.animal('shrimp', Math.max(3, g.cnt(6)), Z.wet(1.5, 9));
  g.animal('isopod', g.cnt(12), Z.land);
  g.animal('springtail', g.cnt(40), Z.land);
  g.env({ setpoint: 25, drainage: 0.45, mediaBio: 0.5, lampPower: 1.2, fan: 0.05, fogger: 0.6, rockMoss: 0.6, nitrate: 2, detritus: 8, algae: 0.02 }, ['fan', 'fogger']);
};

// ===== the care-sheet presets (2026-10): a landscape builder above, restocked and re-equipped for the new animals ====
// Takes the animals a base builder put in out again (species `out`), and sets climate and gear for the new ones.
function restock(g, out, env, gear = []) {
  const A = g.W.animals;
  for (const id of out) for (const a of [...(A.by[id] ?? [])]) A.remove(a);
  if (env.fogger != null) env = { ...env, fogger: +(env.fogger * fogScale(g.dims)).toFixed(2) };
  Object.assign(g.W.env, env);
  for (const k of gear) g.gear.add(k);
  if (env.ph != null || env.gh != null) g.W.water.bodies?.resetChem?.();
}
BUILDERS.streambank = (g) => {
  g.falseFloor = true;   // (built on a false bottom: the land at the front glass stands over its mesh, Gen.sill)
  BUILDERS.swamp(g);
  restock(g, ['crab', 'shrimp'], { setpoint: 25, basking: 0.55, uvb: 0.5, fogger: 0.6, drainage: 1, filterKind: 'matten', ph: 7.0, gh: 6, waterSource: 'remin' }, ['basking', 'uvb', 'falseBottom', 'filterMatten']);
  const Z = g.zones(g.info.L);
  g.log(g.X(0.1), g.Z(0.3), 26 * g.k, 0.2, 1.2);
  // Cork bark tubes to hide in, one by the water (and one more on the land of a bigger tank).
  const tubes = [[Z.ledge, 18], [Z.bank, 14], [Z.flat, 12]];
  if (g.extra(1) > 0) tubes.push([Z.flat, 15]);
  for (const [test, size] of tubes) { const c = g.spot(test, 300); if (c) g.piece('cork', c.x, c.z, { size: size * g.k, rot: g.r() * 6.28, sink: 0.1 }); }
  g.animal('skink', 1, (x, y, z, s) => Z.land(x, y, z, s) && g.W.nearWater(V(x, y, z), 12));
  g.animal('purpleiso', g.cnt(12), Z.land);
  g.animal('pandaking', g.cnt(4), Z.ledge);
};
BUILDERS.reedpool = (g) => {
  g.falseFloor = true;
  BUILDERS.blackwater(g);
  restock(g, ['cardinal', 'cory', 'shrimp'], { setpoint: 26, fogger: 0.4, drainage: 1, filterKind: 'matten', waterSource: 'remin', ph: 7.0, gh: 6 }, ['fogger', 'falseBottom', 'filterMatten']);
  const Z = g.zones(g.info.L);
  g.clusters('cattail', g.cnt(3), 4, Z.edge, { radius: 7, gap: 4 });
  g.clusters('bamboo', g.cnt(2), 3, Z.edge, { radius: 7, gap: 6 });
  g.wallScatter('bromeliad', g.wcnt(3) + 1, (x, y) => y > g.info.L + 6, { gap: 12 });
  g.animal('reedfrog', Math.max(3, g.cnt(4)), (x, y, z, s) => Z.land(x, y, z, s) && g.W.nearWater(V(x, y, z), 10));
  g.animal('cpd', Math.max(6, g.cnt(8)), Z.deep(4));
  g.animal('blueshrimp', Math.max(8, g.cnt(10)), Z.deep(2));
  g.animal('springtail', g.cnt(20), Z.land);
};
BUILDERS.matano = (g) => {
  BUILDERS.blackwater(g);
  restock(g, ['cardinal', 'cory', 'shrimp'], { setpoint: 26, filterKind: 'canister', prefilter: true, mediaBio: 1, waterSource: 'hard', ph: 8.1, gh: 13 }, ['filterCanister']);
  const Z = g.zones(g.info.L);
  // Slate: caves in the deep water and a ramp up the bank.
  for (let k = 0; k < g.cover(3); k++) { const c = g.spot(Z.deep(5), 300); if (c) g.piece('slate', c.x, c.z, { size: (12 + g.r() * 6) * g.k, rot: g.r() * 6.28, tilt: 0.25 + g.r() * 0.3 }); }
  const ramp = g.spot(Z.edge, 300);
  if (ramp) g.piece('slate', ramp.x, ramp.z, { size: 16 * g.k, rot: g.r() * 6.28, tilt: 0.45 });
  g.animal('panther', 1, Z.deep(4));
  g.animal('snail', g.cnt(8), Z.deep(2));
};
BUILDERS.everglades = (g) => {
  // On the blackwater lagoon (N15): the swamp layout holds ~5 L of pool even in the standard tank, too little for a group of
  // pygmy sunfish (sim/scale.js waterRoom: 2 per litre per 3 cm of fish).
  BUILDERS.blackwater(g);
  restock(g, ['cardinal', 'cory', 'shrimp'], { setpoint: 22, filterKind: 'matten', waterSource: 'remin', ph: 7.0, gh: 6 }, ['filterMatten']);
  g.W.water.hydro.pump.rate = 30;   // a trickle over the seep, not a current: the sunfish wants still water
  const Z = g.zones(g.info.L);
  g.animal('pygmy', Math.max(2, Math.floor(g.area + 0.25) * 3), Z.deep(2.5));   // S1: three per territory (one adult male keeps one: Sim.tankRules; sim/scale.js roomFor); the set's ref is the wide tank
};

// ===== canyon (run "sets", S3) ===============================================
// Liwu River in Taroko Gorge, Taiwan: one river over the whole length of the tank, between a banded marble cliff at the back and
// a low bank (a rock spur at the slot) at the front. The pump pool is the quiet lagoon at the right end; its whole flow goes up
// to one outlet on the wall at the head and runs the length of the tank above the pool level: head pool, riffle, a fall into a
// plunge pool, a narrow chute (the slot), a side eddy, a second riffle, then the lagoon. Features are bed geometry (hydro.js has
// no rapid object): the fall is a bed step over hydro.js JUMP (1.6 cm per cell), the riffle a boulder-strewn grade.
BUILDERS.canyon = (g) => {
  // After the owner's picture (7 Oct): two massifs of layered rock with a valley between them, a waterfall out of the back wall onto a
  // rock shelf, a short stream across the shelf and one more fall over its lip into a deep lagoon that fills the front. Planted ledges,
  // cobbles and a branch on the lagoon floor. (The first canyon ran a river along the front glass: a tall brown soil slab under it.)
  const { w, d, h, T } = g;
  const L = g.lvl(0.4);                                              // the lagoon, the pump reservoir (a recipe's `level` overrides)
  const rise = clamp(h * 0.12, 7, 11), shelfY = L + rise;             // the shelf the waterfall lands on, one short fall above the lagoon
  const HR = Math.round(h * (g.P.crestR ?? 0.9)), HL = Math.round(h * (g.P.crestL ?? 0.8));
  const bedLow = 2.5;
  const uOf = (x) => x / (w / 2), vOf = (z) => (z + d / 2) / d;
  const xl = (z) => g.X(-0.52 - 0.1 * smooth(0.05, 0.55, vOf(z)));    // inner foot of the left massif
  const xr = (z) => g.X(0.56 + 0.1 * smooth(0.2, 0.6, vOf(z)));      // inner foot of the right massif
    const fall = { x: g.X(0.42), z: g.Z(0.07) };                        // where the wall fall lands (a basin)
  const lip = { x: g.X(0.12), z: g.Z(0.34) };                          // where the stream leaves the shelf
  g.fill((x, z) => {
    const v = vOf(z), nz = g.n(x, z, 0.09), n2 = g.n(x, z, 0.3);
    const wp = (g.n(x + 30, z, 0.11) - 0.5) * 7 + (g.n(x, z + 9, 0.3) - 0.5) * 2.4;
    let hgt = bedLow + 1.2 * n2 + 1.6 * nz;                           // the lagoon floor
    const mid = ell(x, z, g.X(-0.22), g.Z(0.0), w * 0.18, d * 0.22, 0.55, 1.0);   // a low bank behind the lagoon, between the massifs
    hgt = lerp(hgt, Math.max(hgt, L + 8 + 2.5 * nz), mid);
    const ML = smooth(xl(z) + 3 + wp, xl(z) - 3 + wp, x) * smooth(g.Z(0.7), g.Z(0.46), z);
    const topL = lerp(HL * 0.62, HL + (nz - 0.5) * 5, smooth(xl(z) - 4, xl(z) - 24, x));   // a terrace at the foot, the crest toward the glass
    hgt = lerp(hgt, Math.max(hgt, topL), ML);
    const MR = smooth(xr(z) - 3 + wp, xr(z) + 3 + wp, x) * smooth(g.Z(0.72), g.Z(0.48), z);
    const topR = lerp(HR * 0.6, HR + (nz - 0.5) * 5, smooth(xr(z) + 4, xr(z) + 22, x));
    hgt = lerp(hgt, Math.max(hgt, topR), MR);
    const SH = smooth(g.X(0.0) - 2, g.X(0.0) + 6, x) * smooth(g.Z(0.4) + 4 + wp * 0.4, g.Z(0.4) - 4 + wp * 0.4, z);   // the shelf: from the back wall to a front edge, tilted a little toward the lip
    const shY = shelfY + 1.4 * (n2 - 0.5) - 3 * smooth(g.Z(0.08), g.Z(0.36), z);
    hgt = lerp(hgt, Math.max(hgt, shY), SH);
    const face = clamp(Math.max(ML, MR) * 0.75 + SH * (1 - SH) * 4, 0, 1);              // layered all over the massifs, not only at their feet
    const groove = smooth(0.7, 1, 1 - Math.abs(2 * g.n(x * 0.32 + z * 0.06, z * 0.09, 3) - 1));   // gullies down the faces
    return g.sill(ledged(hgt - 1.6 * groove * face, face, 5), z, 5.5, 7);
  });
  const cw = clamp(w * 0.03, 3, 5);                                    // the stream's half width
  T.digBasin(fall.x, fall.z, cw * 1.3, 3);
  T.carveChannel([V(fall.x, 0, fall.z + cw), V(g.X(0.34), 0, g.Z(0.14)), V(g.X(0.25), 0, g.Z(0.2)), V(g.X(0.18), 0, g.Z(0.27)), V(lip.x, 0, lip.z)], cw, 0.8);
  T.digBasin(g.X(0.27), g.Z(0.19), cw * 1.1, 2.4);
  // Cobbles under water, rock on the steep faces (moss on a few), moss and a little soil on the ledges.
  g.paint((x, z, hh, up, m) => {
    const mo = g.n(x, z, 0.16) * 0.8 + g.n(x, z, 0.5) * 0.3, patch = smooth(0.4, 0.62, g.n(x * 1.3, z * 1.1, 0.21));
    if (hh < L - 0.6) { m[MAT.gravel] = 0.75 - 0.4 * patch; m[MAT.stone] = 0.25 + 0.4 * patch; return; }
    if (up < 0.6) { m[MAT.rock] = 0.7; m[MAT.stone] = 0.3; if (mo > 0.8) m[MAT.moss] = 0.5; return; }
    if (hh < L + 1.2) { m[MAT.gravel] = 0.6; m[MAT.stone] = 0.4; return; }
    if (up < 0.8) { m[MAT.rock] = 0.6; m[MAT.stone] = 0.2; m[MAT.moss] = mo > 0.45 ? 0.5 : 0.2; return; }
    if (mo > 0.3) m[MAT.moss] = 1; else m[MAT.soil] = 1;
  });
  const yOut = clamp(Math.max(shelfY + 14, Math.round(h * 0.8)), shelfY + 10, h - 4);            // the wall fall starts this high
  rockWall(g, { L, style: g.P.wall ?? 'blocks', moss: 1.25, rock: 0.4, mossMin: 10, calm: (x, y) => smooth(cw + 12, cw + 3, Math.abs(x - fall.x)) * smooth(h * 0.92, h * 0.5, y) * 0.8, relief: 1.6 });

  const boulder = (x, z, size, v, o = {}) => g.piece('boulder', x, z, { size, variant: v, sink: 0.25, ...o });
  const warm = [2, 3, 5], mossy = [6, 7, 8, 10];
  // the lagoon floor: cobbles in odd, graded numbers and one branch
  for (const [u, vv, sz, pal] of [[-0.36, 0.84, 10, warm], [-0.28, 0.9, 6, mossy], [-0.12, 0.8, 8, warm], [0.12, 0.88, 5, mossy], [0.3, 0.8, 9, warm], [0.4, 0.9, 5, mossy], [-0.52, 0.5, 8, mossy], [-0.44, 0.74, 4, warm], [-0.2, 0.92, 4, warm], [0.0, 0.86, 3.5, mossy], [0.22, 0.94, 4, warm], [0.5, 0.84, 6, warm], [0.58, 0.72, 5, mossy], [-0.6, 0.78, 5, warm]]) boulder(g.X(u), g.Z(vv), sz * g.k, g.pick(pal));
  g.log(g.X(-0.02), g.Z(0.74), 46 * g.k, 0.18, 0.45);
  g.piece('roots', g.X(0.2), g.Z(0.66), { size: 22 * g.k, rot: 1.1, sink: 0.05, scale: [1, 1.2, 1] });
  // the rock itself: boulders half sunk into the massifs' faces, so the heightfield reads as stacked slabs
  g.dress(g.cover(16), (x, y, z) => y > L + 2 && T.normalAt(x, z).y > 0.5 && (x < xl(z) + 6 || x > xr(z) - 6), { size: [5 * g.k, 13 * g.k], tries: 70 * g.cover(16) });
  g.scree(6 + g.extra(3), (x, y, z) => y < L - 3 && z > g.Z(0.3) && T.normalAt(x, z).y > 0.85, { size: 6, variants: [1, 2, 3, 5, 6, 7], sink: 0.3 });   // cobbles on the lagoon floor
  g.spire(g.X(-0.82), g.Z(0.28), g.tall(0.5), 10 * g.k);
  g.spire(g.X(0.82), g.Z(0.2), g.tall(0.5), 9 * g.k);
  g.scree(g.extra(3), (x, y, z) => y > L + 2 && T.normalAt(x, z).y > 0.7 && !g.bed(x, z) && Math.hypot(x - fall.x, z - fall.z) > cw * 1.3 + 3, { size: 9 });

  const pump = { x: g.X(-0.5), z: g.Z(0.32) };
  g.water({ pump: [pump.x, pump.z], level: L, outlets: [{ x: fall.x, y: yOut, wall: true }], rate: g.P.rate ?? 240, settle: 900 });
  g.info = { ...g.info, L, canyon: { shelfY, rise, fall, lip, yOut, cw, HL, HR } };
  const Z = g.zones(L);
  const dry = (x, y, z, s) => Z.land(x, y, z, s) && !g.W.water.nearestFall(V(x, y, z), 2);
  const bank = (x, y, z, s) => dry(x, y, z, s) && y > L + 1.5 && T.normalAt(x, z).y > 0.55;
  g.clusters('fern', g.cnt(8), 3, (x, y, z, s) => bank(x, y, z, s) && !g.W.nearWater(V(x, y, z), 4), { radius: 6, gap: 4 });
  g.clusters('hartstongue', g.cnt(4), 3, (x, y, z, s) => bank(x, y, z, s) && y > L + 5, { radius: 5, gap: 6 });
  g.scatter('nidus', g.cnt(5), (x, y, z, s) => bank(x, y, z, s) && y > L + 4 && !g.W.nearWater(V(x, y, z), 6), { gap: 8 });
  g.scatter('miscanthus', g.cnt(3), bank, { gap: 6 });
  g.scatter('grass', g.cnt(8), (x, y, z, s) => bank(x, y, z, s) && g.W.nearWater(V(x, y, z), 3), { gap: 4 });
  g.clusters('crypt', g.cnt(3), 3, (x, y, z, s) => s !== -Infinity && s - y > 4 && Z.inPool(x, z), { radius: 5, gap: 4 });
  g.scatter('javafern', g.cnt(5), (x, y, z, s) => s !== -Infinity && s - y > 3, { gap: 6 });
  g.wallScatter('pothos', g.wcnt(6), (x, y) => y > L + 6, { gap: 9 });
  g.wallScatter('fern', g.wcnt(5), (x, y) => y > L + 6, { gap: 12 });
  g.wallScatter('begonia', g.wcnt(3), (x, y) => y > L + 6, { gap: 14 });
  const cap = (id, n) => { const c = g.P.caps?.[id]; return Math.min(n, Array.isArray(c) ? c[w >= 170 ? 1 : 0] : c ?? 999); };   // caps: a number, or [small tank, show tank]
  g.animal('shrimp', cap('shrimp', g.cnt(10)), (x, y, z, s) => s - y > 0.8 && Z.inPool(x, z));
  if (SPECIES.hillloach) g.animal('hillloach', cap('hillloach', g.cnt(5)), (x, y, z, s) => s - y > 1.2 && s - y < (g.P.hillDepth ?? 40));
  if (SPECIES.zacco) g.animal('zacco', cap('zacco', g.cnt(8)), (x, y, z, s) => s - y > 4);
  g.animal('isopod', g.cnt(8), dry);
  g.animal('springtail', g.cnt(30), dry);
  g.env({ setpoint: 22, drainage: 0.3, mediaBio: 0.6, lampPower: 1.05, fan: 0.05, fogger: 0.35, rockMoss: 0.25, nitrate: 2, detritus: 6, algae: 0.02, ...(g.P.canister ? { filterKind: 'canister', prefilter: true, mediaBio: 1 } : {}), ...(g.P.env?.air ? { air: g.P.env.air } : {}) }, [...(g.P.canister ? ['fan', 'fogger', 'filterCanister'] : ['fan', 'fogger']), ...(g.P.gear?.includes('airpump') ? ['airpump'] : [])]);
};

// ===== highland (run "sets", S3) ==============================================
// Upland brooks of the Central European Mittelgebirge (Teutoburg Forest / Harz): a plateau (about two thirds of the tank height)
// with three headwater seeps; their brooks merge, step down two terraces (a fall each) and end in a cool pool with a stony inlet.
BUILDERS.highland = (g) => {
  const { w, d, h, T } = g;
  const L = g.lvl(0.22);
  const Hp = Math.round(h * 0.66), T1 = L + (Hp - L) * 0.58, T2 = L + (Hp - L) * 0.28;
  const vOf = (z) => (z + d / 2) / d;
  const stair = (z) => {
    const v = vOf(z);
    return Hp - (Hp - T1) * smooth(0.40, 0.45, v) - (T1 - T2) * smooth(0.62, 0.67, v) - (T2 - (L + 2.6)) * smooth(0.8, 0.88, v);
  };
  const seeps = [[-0.62, 0.1], [0.05, 0.07], [0.66, 0.13]].map(([u, v]) => ({ x: g.X(u), z: g.Z(v), r: g.wide(clamp(w * 0.03, 2.8, 4.5), 90 * 0.03) }));
  const M = { x: g.X(0.0), z: g.Z(0.3) };                         // where the brooks meet
  const lips = [{ x: g.X(-0.03), z: g.Z(0.435) }, { x: g.X(-0.12), z: g.Z(0.655) }];
  const pool = { x: g.X(-0.3), z: g.Z(0.9), rx: w * 0.36, rz: d * 0.2 };
  // the brook's line down the terraces (x of the channel at each z): the terraces lean toward it so the water keeps to the brook
  const KX = [[0.3, M.x], [0.435, lips[0].x], [0.5, lips[0].x - 1], [0.6, lips[1].x + 1], [0.655, lips[1].x], [0.74, g.X(-0.2)], [0.86, g.X(-0.28)]];
  const xc = (z) => { const v = clamp(vOf(z), KX[0][0], KX[KX.length - 1][0]); for (let k = 1; k < KX.length; k++) if (v <= KX[k][0]) return lerp(KX[k - 1][1], KX[k][1], (v - KX[k - 1][0]) / (KX[k][0] - KX[k - 1][0])); return KX[KX.length - 1][1]; };
  g.fill((x, z) => {
    const nz = g.n(x, z, 0.09), n2 = g.n(x, z, 0.3);
    const lean = Math.min(11, 0.2 * Math.max(0, Math.abs(x - xc(z)) - 2.5)) * smooth(0.32, 0.42, vOf(z)) * smooth(0.9, 0.8, vOf(z));
    let hgt = lean + stair(z) + (nz - 0.5) * 2.2 * (vOf(z) < 0.8 ? 1 : 0.3);
    const side = smooth(0.7, 1, Math.abs(x) / (w / 2));                  // the valley's shoulders
    hgt = lerp(hgt, Math.max(hgt, Hp + 3 + (nz - 0.5) * 3), side * smooth(0.55, 0.3, vOf(z)));
    const lg = ell(x, z, pool.x, pool.z, pool.rx, pool.rz, 0.55, 1.0);
    hgt = lerp(hgt, 2.8 + n2, lg);
    const face = clamp(smooth(0.4, 0.45, vOf(z)) * smooth(0.5, 0.45, vOf(z)) * 4 + smooth(0.62, 0.67, vOf(z)) * smooth(0.72, 0.67, vOf(z)) * 4, 0, 1);
    const hF = lerp(L + 1.2, 4, ell(x, z, pool.x, pool.z, pool.rx * 1.1, pool.rz * 2, 0.9, 1));
    const hh = ledged(hgt, face, 4.5);
    return lerp(hh, Math.min(hh, hF), smooth(d / 2 - 7, d / 2 - 1.5, z));
  });
  for (const s of seeps) T.digBasin(s.x, s.z, s.r, 2.5);
  for (const s of seeps) T.carveChannel([V(s.x, 0, s.z + s.r * 0.9), V((s.x + M.x) / 2, 0, (s.z + M.z) / 2), V(M.x, 0, M.z)], 1.5, 0.7);
  T.digBasin(M.x, M.z, 3.2, 2);
  T.carveChannel([V(M.x, 0, M.z + 2), V(lips[0].x, 0, lips[0].z), V(lips[0].x - 1, 0, g.Z(0.5)), V(lips[1].x + 1, 0, g.Z(0.6)), V(lips[1].x, 0, lips[1].z), V(g.X(-0.2), 0, g.Z(0.74)), V(g.X(-0.28), 0, g.Z(0.86))], 1.8, 0.8);
  T.digBasin(lips[0].x - 1, g.Z(0.53), 3.5, 3);
  T.digBasin(lips[1].x, g.Z(0.72), 3.8, 3);
  groundPaint(g, L, { moss: 0.55, gravelBand: 0.6, rockUp: 0.7, stoneUp: 0.5, sand: (x, z) => ell(x, z, pool.x, pool.z, pool.rx * 1.05, pool.rz * 1.05, 0.5, 1) > 0.02 });
  rockWall(g, { L, style: 'crag', moss: 0.9, rock: 0.4, calm: (x, y) => 0.3 * smooth(Hp + 6, Hp - 6, y) });
  const boulder = (x, z, size, v) => g.piece('boulder', x, z, { size, variant: v, sink: 0.26 });
  const mossy = [6, 7, 8, 10, 11, 12];
  for (const [u, v, sz] of [[-0.45, 0.2, 10], [0.4, 0.25, 12], [0.2, 0.5, 8], [-0.5, 0.55, 9], [0.55, 0.75, 8], [-0.65, 0.78, 6], [0.1, 0.9, 7], [lips[1].x / (w / 2), 0.7, 6]]) boulder(g.X(u), g.Z(v), sz * g.k, g.pick(mossy));
  g.scree(g.extra(3), (x, y, z) => y > L + 3 && T.normalAt(x, z).y > 0.7 && !g.bed(x, z) && seeps.every((s) => Math.hypot(x - s.x, z - s.z) > s.r + 3), { size: 9 });
  g.water({ pump: [pool.x, pool.z], level: L, outlets: seeps.map((s) => ({ x: s.x, z: s.z })), rate: 240, settle: 900 });
  g.info = { ...g.info, L, highland: { Hp, T1, T2, seeps: seeps.length } };
  const Z = g.zones(L);
  const dry = (x, y, z, s) => Z.land(x, y, z, s) && !g.bed(x, z) && !g.W.water.nearestFall(V(x, y, z), 2);
  const bank = (x, y, z, s) => dry(x, y, z, s) && y > L + 1.5 && T.normalAt(x, z).y > 0.6;
  g.clusters('fernph', g.cnt(5), 3, bank, { radius: 7, gap: 5 });
  g.clusters('hartstongue', g.cnt(4), 3, bank, { radius: 5, gap: 6 });
  g.scatter('bilberry', g.cnt(5), bank, { gap: 7 });
  g.scatter('grass', g.cnt(8), bank, { gap: 4 });
  g.scatter('weed', g.cnt(5), bank, { gap: 4 });
  g.animal('firesal', Math.max(2, g.cnt(3)), (x, y, z, s) => bank(x, y, z, s) && y > L + 2);
  g.animal('bullhead', Math.max(2, g.cnt(2)), (x, y, z, s) => s - y > 3);
  g.animal('springtail', g.cnt(30), dry);
  g.env({ setpoint: 16, chill: 1, coolSet: 15.5, drainage: 0.3, mediaBio: 0.6, lampPower: 1.0, fan: 0.1, fogger: 0.35, rockMoss: 0.7, nitrate: 2, detritus: 10, algae: 0.02 }, ['fan', 'chiller', 'fogger']);
};

function V(x, y, z) { return new THREE.Vector3(x, y, z); }

// Lets the water run a little longer, then removes plants the water has drowned or left stranded
// (a stream finds its way over time) and animals that ended up where they cannot live.
function settleAndPrune(g) {
  const W = g.W, H = W.water.hydro;
  for (let k = 0; k < 90; k++) H.step(1 / 30);
  H.targetTotal = H.total();
  W.water.syncLevel();
  W.water.syncFalls(true);
  let pruned = 0;
  for (const p of [...W.plants.list]) {
    const sp = PLANTS[p.id];
    let bad;
    if (sp.habitat === 'floating') {
      const gr = W.terrain.heightAt(p.pos.x, p.pos.z);
      bad = !(W.water.surfaceAt(p.pos.x, p.pos.z, 0.2) - gr > 1.5);
    } else {
      bad = !!W.plants.canPlace(p.id, { point: p.pos, surface: p.surface, normal: p.normal }, W);
    }
    if (bad) { W.plants.remove(p); pruned++; }
  }
  for (const a of [...W.animals.all]) {
    const sp = SPECIES[a.sp];
    if (a.onWall) continue;
    const ground = W.terrain.heightAt(a.pos.x, a.pos.z), surf = W.water.surfaceAt(a.pos.x, a.pos.z);
    const wet = surf > ground + 0.3;
    if ((sp.kind === 'frog' || (sp.kind === 'crawlLand' && !sp.surface) || sp.kind === 'gecko') && wet) W.animals.remove(a, 'moved');
    if ((sp.kind === 'swim' || sp.kind === 'crawlWater') && !(surf - ground > 1.3)) W.animals.remove(a, 'moved');
  }
  g.pruned = pruned;
}

// ---------------------------------------------------------------------------
// The public entry point

// Fills `world` with a generated terrarium. `world` is a fresh world of the
// tank size you want (game.loadTank(tier, { layout: 'empty' })).
// Returns a report: { preset, seed, tier, name, biotope, litres, falls, pools, plants, animals, pieces, warnings, ... }.
export function generateTerrarium(world, { preset, seed = 1, tier } = {}) {
  tier = tier ?? TANK.id;
  // A custom-size tank (sandbox) suits every preset except the sealed jar.
  const suits = tier === 'custom' ? PRESETS[preset]?.id !== 'jar' : PRESETS[preset]?.tiers.includes(tier);
  if (!PRESETS[preset] || !suits) {
    const fallback = defaultPreset(tier);
    if (preset) console.warn(`Preset "${preset}" does not suit the ${tier} tank; building "${fallback}" instead.`);
    preset = fallback;
  }
  seed = Math.floor(seed) || 1;
  const g = new Gen(world, preset, seed, tier);
  if (tier !== TANK.id) g.warn(`world is a ${TANK.id} tank, not ${tier}`);
  resetWorld(g);
  BUILDERS[PRESETS[preset].layout ?? preset](g);
  g.stock();

  // Let everything settle into the finished picture.
  const W = world;
  settleAndPrune(g);
  for (const id of g.gear) W.equipment.buy(id);
  W.climate.settle();
  W.humus?.seed();   // a little leaf litter and humus under the plants
  W.updateMoss();
  W.decor.scatterMoss();
  W.terrain.update();
  W.wall.update();
  W.fx?.updateTerrain();
  const name = describePreset(preset, seed);
  W.log(`${name}: a ready-made ${PRESETS[preset].name.toLowerCase()}. ${PRESETS[preset].blurb}`);
  const animals = Object.fromEntries(Object.entries(W.animals.by).filter(([, v]) => v.length).map(([k, v]) => [k, v.length]));
  return {
    preset, seed, tier, name, biotope: PRESETS[preset].biotope, blurb: PRESETS[preset].blurb,
    featured: PRESETS[preset].featured ?? [], place: PRESETS[preset].place ?? null,
    litres: +W.water.volumeLitres().toFixed(1), level: +W.water.level.toFixed(1),
    falls: W.water.falls.length, pools: W.water.pools.length, plants: W.plants.list.length, wallPlants: g.counts.wall,
    animals, pieces: W.decor.pieces.length, gear: [...g.gear], warnings: g.warnings, ...(g.info ?? {}),
  };
}
