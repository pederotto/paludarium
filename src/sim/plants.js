// Plants: low-poly procedural geometry, one InstancedMesh per species. Each
// plant has a habitat, needs (light, humidity, nutrients) and grows or wilts
// with the conditions in the tank.

import * as THREE from 'three/webgpu';
import { Builder, PRIM } from '../render/geo.js';
import { rng, lerp, clamp } from '../util/math.js';
import { plantMaterial } from '../render/shaders.js';
import { MAT, TANK } from './tank.js';
import { plantFit } from './placement.js';
import { waterCondition, emergentBoost } from './plantpond.js';
import { TEX, modelParts } from '../render/assets.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
// How close two plants' stems may stand, as a fraction of their two crowns' reach added: closer, and one grows out of the other
// (plants of one kind may stand at about half of it: a clump of grass or a stand of vallisneria).
export const PLANT_ROOM = 0.35;

// Bent, tapering leaf blade from the origin along `dir`, curving down by
// `droop`. Adds one ribbon to the builder.
// base: where the blade starts (default the plant's origin).
function blade(b, { dir, len, width, droop = 0.4, segs = 5, color, tip, twist = 0, flat = false, base = null }) {
  const pts = [], widths = [], sides = [];
  const d = dir.clone().normalize();
  const up = V(0, 1, 0);
  let side = new THREE.Vector3().crossVectors(up, d);
  if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
  side.normalize();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = d.clone().multiplyScalar(len * t);
    p.y -= droop * len * t * t;
    if (base) p.add(base);
    pts.push(p);
    widths.push(width * Math.sin(Math.PI * Math.min(0.98, 0.12 + t * 0.9)) * (flat ? 1 : 1));
    sides.push(side.clone().applyAxisAngle(d, twist * t));
  }
  const c0 = new THREE.Color(color), c1 = new THREE.Color(tip ?? color);
  b.ribbon(pts, widths, sides, { color: (t) => c0.clone().lerp(c1, t) });
}

// A flat leaf with a real outline (and holes): `outline(t)` is the half-width at t (0 base … 1 tip) as a fraction of
// `width`; `holes` are [t, u, length, width] ellipses in leaf space (u: -0.5 … 0.5 across). The leaf runs from `base`
// along `dir` and droops toward the tip; the midrib is darker. Used for the monstera's split leaves and the anubias.
function shapedLeaf(b, { base = V(0, 0, 0), dir, len, width, droop = 0.2, outline, holes = [], color, tip, rib = null, n = 14, cup = 0 }) {
  const shape = new THREE.Shape();
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push([outline(t) * width, t * len]); }
  shape.moveTo(0, 0);
  for (const [u, v] of pts) shape.lineTo(u, v);
  for (let i = n; i >= 0; i--) shape.lineTo(-pts[i][0], pts[i][1]);
  for (const [t, u, hl, hw] of holes) {
    const h = new THREE.Path(), cx = u * width, cy = t * len;
    for (let k = 0; k <= 10; k++) { const a = (k / 10) * Math.PI * 2; const x = cx + Math.cos(a) * hw * width * 0.5, y = cy + Math.sin(a) * hl * len * 0.5; if (k === 0) h.moveTo(x, y); else h.lineTo(x, y); }
    shape.holes.push(h);
  }
  const g = new THREE.ShapeGeometry(shape, 1);
  const d = dir.clone().normalize();
  let side = new THREE.Vector3().crossVectors(V(0, 1, 0), d);
  if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
  side.normalize();
  const up = new THREE.Vector3().crossVectors(d, side).normalize();
  const pa = g.attributes.position;
  for (let i = 0; i < pa.count; i++) {
    const u = pa.getX(i), v = pa.getY(i), t = v / len;
    const p = base.clone().addScaledVector(d, v).addScaledVector(side, u);
    p.y -= droop * len * t * t;
    p.addScaledVector(up, cup * (u / width) * (u / width) * width);       // edges curl up a little
    pa.setXYZ(i, p.x, p.y, p.z);
  }
  const c0 = new THREE.Color(color), c1 = new THREE.Color(tip ?? color), cr = rib != null ? new THREE.Color(rib) : null;
  b.add(g, {
    color: (lv) => {
      const t = clamp(lv.clone().sub(base).dot(d) / len, 0, 1), c = c0.clone().lerp(c1, t);
      if (cr) { const u = Math.abs(lv.clone().sub(base).dot(side)) / width; if (u < 0.05) c.lerp(cr, 0.6 * (1 - u / 0.05)); }
      return c;
    },
    sway: (v) => clamp(v.distanceTo(base) / len, 0, 1),
  });
}

// Leaf-card geometry for the SeedThree textures. Each card is a small grid
// laid over the texture: `pivot` is the uv of the stem base, `tip` the uv of
// the far end. The card runs from the base along `out`, rising at `elev`
// radians and drooping by `droop`, so a flat fern photo becomes an arching
// frond. Several cards merge into one geometry.
function cardGeometry(cards) {
  const pos = [], uvs = [], sway = [], col = [], idx = [];
  const R = 4;
  for (const c of cards) {
    const [pu, pv] = c.pivot ?? [0.5, 0.02];
    const [tu, tv] = c.tip ?? [0.5, 1];
    const ang = Math.atan2(tu - pu, tv - pv);
    const lenUV = Math.hypot(tu - pu, tv - pv);
    const k = c.len / lenUV; // cm per uv unit
    const out = (c.out ?? V(1, 0, 0)).clone().setY(0).normalize();
    const side = c.side ?? new THREE.Vector3().crossVectors(V(0, 1, 0), out).normalize();
    const up = V(0, 1, 0);
    const elev = c.elev ?? Math.PI / 2;
    const base = c.at ?? V(0, 0, 0);
    const color = new THREE.Color(c.color ?? 0xffffff);
    const start = pos.length / 3;
    for (let j = 0; j <= R; j++) {
      for (let i = 0; i <= R; i++) {
        const gu = i / R, gv = j / R;
        // Rotate texture space so the stem runs along +b.
        const du = gu - pu, dv = gv - pv;
        const a = (du * Math.cos(ang) - dv * Math.sin(ang)) * k;
        const b = (du * Math.sin(ang) + dv * Math.cos(ang)) * k;
        const t = clamp(b / c.len, 0, 1);
        const p = base.clone()
          .addScaledVector(side, a)
          .addScaledVector(out, b * Math.cos(elev))
          .addScaledVector(up, b * Math.sin(elev) - (c.droop ?? 0) * b * t);
        pos.push(p.x, p.y, p.z);
        uvs.push(gu, gv);
        sway.push(t);
        col.push(color.r, color.g, color.b);
      }
    }
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const a = start + j * (R + 1) + i, b = a + 1, d = a + R + 1, e = d + 1;
      idx.push(a, b, d, b, e, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('sway', new THREE.Float32BufferAttribute(sway, 1));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// n vertical cards crossed around the stem (for bushy photos).
function crossCards(n, len, opt = {}) {
  const cards = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI;
    cards.push({ len, out: V(Math.cos(a + Math.PI / 2), 0, Math.sin(a + Math.PI / 2)), side: V(Math.cos(a), 0, Math.sin(a)), elev: Math.PI / 2, ...opt });
  }
  return cardGeometry(cards);
}

export const PLANTS = {
  fernph: {
    name: 'Lady fern', habitat: 'land', humidity: [60, 100], light: 0.3, size: 1, modelSize: 13,
    note: 'Photoscanned fern (Poly Haven). Loves shade and damp air.',
    model: 'fern_02', material: { amp: 0.25, speed: 0.8 },
  },
  weed: {
    name: 'Creeping jenny', habitat: 'land|emergent', humidity: [50, 100], light: 0.4, size: 1, modelSize: 9,
    note: 'Low trailing plant (Poly Haven scan). Softens rock edges.',
    model: 'weed_plant_02', material: { amp: 0.15, speed: 0.8 },
  },
  fern: {
    name: 'Fern', habitat: 'land', humidity: [60, 100], light: 0.3, size: 1,
    note: 'Loves shade and damp air.',
    map: () => TEX.cards.fern,
    build() {
      // Fronds from SeedThree's fern texture: stem base bottom-left, tip top-right.
      const r = rng(7);
      const cards = [];
      const n = 8;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + r() * 0.4;
        cards.push({ pivot: [0.13, 0.04], tip: [0.9, 0.93], len: 8 + r() * 3, out: V(Math.cos(a), 0, Math.sin(a)), elev: 0.75 + r() * 0.35, droop: 0.45, color: new THREE.Color(0xffffff).multiplyScalar(0.85 + r() * 0.2) });
      }
      return cardGeometry(cards);
    },
  },
  bilberry: {
    name: 'Bilberry shrub', habitat: 'land', humidity: [45, 100], light: 0.45, size: 1,
    note: 'Small leafy shrub with berries.',
    map: () => TEX.cards.bilberry,
    build: () => crossCards(3, 9, { pivot: [0.47, 0.02], tip: [0.47, 1] }),
  },
  grass: {
    name: 'Grass tuft', habitat: 'land|emergent', humidity: [30, 100], light: 0.5, size: 1,
    note: 'Fine grass. Also grows at the water’s edge.',
    map: () => TEX.cards.grassTuft,
    build: () => crossCards(3, 6, { pivot: [0.5, 0.02], tip: [0.5, 1] }),
  },
  oldfern: {
    hidden: true,
    name: 'Fern (low-poly)', habitat: 'land', humidity: [60, 100], light: 0.3, size: 7,
    build() {
      const b = new Builder();
      const r = rng(7);
      const n = 7;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + r() * 0.4;
        const dir = V(Math.cos(a), 0.9 + r() * 0.5, Math.sin(a));
        const len = 6 + r() * 2.5;
        // Rachis with leaflets.
        const segs = 8;
        const d = dir.clone().normalize();
        const pts = [];
        for (let i = 0; i <= segs; i++) {
          const t = i / segs;
          const p = d.clone().multiplyScalar(len * t);
          p.y -= 0.55 * len * t * t;
          pts.push(p);
        }
        for (let i = 1; i < segs; i++) {
          const t = i / segs;
          const p = pts[i];
          const tan = pts[i + 1].clone().sub(pts[i - 1]).normalize();
          const side = new THREE.Vector3().crossVectors(V(0, 1, 0), tan).normalize();
          const ll = (1 - t) * 1.8 + 0.3;
          for (const s of [-1, 1]) {
            const dirL = side.clone().multiplyScalar(s).addScaledVector(tan, 0.6).normalize();
            const bb = new Builder();
            blade(bb, { dir: dirL, len: ll, width: 0.55, droop: 0.2, segs: 2, color: 0x3f7d2a, tip: 0x6fae3e });
            for (let q = 0; q < bb.pos.length; q += 3) { bb.pos[q] += p.x; bb.pos[q + 1] += p.y; bb.pos[q + 2] += p.z; }
            b.pos.push(...bb.pos); b.nor.push(...bb.nor); b.col.push(...bb.col);
            b.sway.push(...bb.sway.map(() => t));
          }
        }
        b.ribbon(pts, pts.map(() => 0.12), V(1, 0, 0), { color: 0x2f5a1f });
      }
      return b.build();
    },
  },
  bromeliad: {
    name: 'Bromeliad', habitat: 'land|wall', humidity: [55, 100], light: 0.5, size: 6,
    note: 'Epiphyte. Grows on the background too.',
    build() {
      const b = new Builder();
      const r = rng(11);
      for (let ring = 0; ring < 2; ring++) {
        const n = ring ? 7 : 9;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + ring * 0.35;
          const up = ring ? 2.2 : 1.1;
          blade(b, {
            dir: V(Math.cos(a), up, Math.sin(a)), len: ring ? 4 : 5.5, width: 1.1, droop: ring ? 0.25 : 0.45, segs: 4,
            color: ring ? 0xb3263c : 0x4c7a2e, tip: ring ? 0xe0506a : 0x7e3a3f, twist: r() * 0.4,
          });
        }
      }
      return b.build();
    },
  },
  pothos: {
    name: 'Creeping fig', habitat: 'wall|land', humidity: [50, 100], light: 0.3, size: 1,
    note: 'Small leaves that creep over the background.', wallTilt: 0.1,
    map: () => TEX.cards.bilberry,
    build() {
      // Leafy sprays fanned out flat, so on the background they hug the wall.
      const r = rng(3);
      const cards = [];
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + r() * 0.5;
        cards.push({ pivot: [0.47, 0.02], tip: [0.47, 1], len: 5 + r() * 3, out: V(Math.cos(a), 0, Math.sin(a)), elev: 0.12 + r() * 0.2, droop: 0.05, color: new THREE.Color(0.75, 0.9, 0.75).multiplyScalar(0.85 + r() * 0.2) });
      }
      return cardGeometry(cards);
    },
  },
  cattail: {
    name: 'Cattail', habitat: 'emergent', humidity: [40, 100], light: 0.6, size: 1,
    note: 'Wet feet: plant at the waterline.',
    map: () => TEX.cards.cattail,
    build: () => crossCards(3, 20, { pivot: [0.5, 0.02], tip: [0.5, 1] }),
  },
  bamboo: {
    name: 'Umbrella sedge', habitat: 'emergent', humidity: [40, 100], light: 0.6, size: 14,
    note: 'Wet feet: plant at the waterline.',
    build() {
      const b = new Builder();
      const r = rng(5);
      for (let k = 0; k < 6; k++) {
        const x = (r() - 0.5) * 1.6, z = (r() - 0.5) * 1.6;
        const h = 11 + r() * 5;
        const lean = V((r() - 0.5) * 0.25, 1, (r() - 0.5) * 0.25).normalize();
        const top = lean.clone().multiplyScalar(h).add(V(x, 0, z));
        b.ribbon([V(x, 0, z), top], [0.25, 0.18], V(1, 0, 0), { color: 0x5d8b3a });
        b.ribbon([V(x, 0, z), top], [0.25, 0.18], V(0, 0, 1), { color: 0x5d8b3a });
        for (let q = 0; q < 9; q++) {
          const a = (q / 9) * Math.PI * 2;
          const bb = new Builder();
          blade(bb, { dir: V(Math.cos(a), 0.15, Math.sin(a)), len: 3, width: 0.35, droop: 0.5, segs: 3, color: 0x6d9e3f, tip: 0x8fbf55 });
          for (let i = 0; i < bb.pos.length; i += 3) { bb.pos[i] += top.x; bb.pos[i + 1] += top.y; bb.pos[i + 2] += top.z; }
          b.pos.push(...bb.pos); b.nor.push(...bb.nor); b.col.push(...bb.col); b.sway.push(...bb.sway.map(() => 1));
        }
      }
      return b.build();
    },
  },
  vallisneria: {
    name: 'Vallisneria', habitat: 'aquatic', light: 0.4, nutrients: 1, size: 18,
    note: 'Tall ribbon grass. Needs water at least 6 cm deep.',
    build() {
      // Tapering ribbon grass: a clump of 20 leaves of very different length,
      // each pointed at the tip and narrow at the base, gently twisted and
      // arching outward, in several shades of green.
      const b = new Builder();
      const r = rng(13);
      const SEG = 9;
      for (let k = 0; k < 20; k++) {
        const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * 1.7;
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        const h = 6 + Math.pow(r(), 1.4) * 20;          // many short, a few long
        const W = (0.5 + r() * 0.45) * (0.7 + h / 40);  // longer leaves are wider
        const bend = (0.4 + r() * 1.1) * h * 0.06, bd = r() * Math.PI * 2;
        const wob = r() * 6, tw = (r() - 0.5) * 2.2;
        const pts = [], w = [], sides = [];
        for (let i = 0; i <= SEG; i++) {
          const t = i / SEG;
          pts.push(V(x + Math.cos(bd) * bend * t * t + Math.sin(t * 2.4 + wob) * 0.5 * t, h * t * (1 - 0.12 * t * t), z + Math.sin(bd) * bend * t * t + Math.cos(t * 2 + wob) * 0.4 * t));
          w.push(W * Math.min(1, 0.4 + t * 4) * Math.max(0.04, 1 - Math.pow(t, 1.8)));
          sides.push(V(Math.cos(a + 1.5 + tw * t), 0, Math.sin(a + 1.5 + tw * t)));
        }
        const dark = 0.75 + r() * 0.35, hue = r();
        const c0 = new THREE.Color(0x2c6a24).multiplyScalar(dark).lerp(new THREE.Color(0x3d7a2a), hue * 0.5);
        const c1 = new THREE.Color(0x6aa83a).multiplyScalar(0.85 + r() * 0.25);
        b.ribbon(pts, w, sides, { color: (t) => c0.clone().lerp(c1, Math.min(1, t * 1.15)) });
      }
      return b.build();
    },
    material: { amp: 0.4, underwaterAmp: 2.6, speed: 0.9 },
  },
  sword: {
    name: 'Amazon sword', habitat: 'aquatic', light: 0.5, nutrients: 1.5, size: 12,
    note: 'Rosette plant for the aquarium floor.',
    build() {
      const b = new Builder();
      const r = rng(17);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2 + r() * 0.3;
        blade(b, { dir: V(Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5), len: 7 + r() * 6, width: 2.0 + r() * 0.9, droop: 0.3 + r() * 0.15, segs: 6, color: new THREE.Color(0x24682a).multiplyScalar(0.85 + r() * 0.3), tip: 0x5da83a, twist: 0.3 });
      }
      return b.build();
    },
    material: { amp: 0.3, underwaterAmp: 1.2, speed: 0.8 },
  },
  javafern: {
    name: 'Java fern', habitat: 'aquatic', light: 0.2, nutrients: 0.5, size: 9,
    note: 'Hardy, low light. Fine on rock or wood.',
    build() {
      const b = new Builder();
      const r = rng(23);
      for (let k = 0; k < 8; k++) {
        const a = r() * Math.PI * 2;
        blade(b, { dir: V(Math.cos(a) * 0.8, 1, Math.sin(a) * 0.8), len: 6 + r() * 3, width: 1.5, droop: 0.2, segs: 5, color: 0x1f5a24, tip: 0x3a7a2e, twist: 0.8 });
      }
      return b.build();
    },
    material: { amp: 0.2, underwaterAmp: 1.0, speed: 0.7 },
  },
  // ---- From the keeper's care sheets (2026-10) ----
  anubias: {
    name: 'Anubias', habitat: 'emergent', humidity: [60, 100], light: 0.15, nutrients: 0.4, size: 6,
    note: 'Tough, slow, dark-leaved: on wood or stone in the water or at the edge, where fire-bellied toads rest on its leaves.',
    build() {
      // A creeping green rhizome along the wood, stiff stalks, and broad oval leaves with a pale midrib, held up and out.
      const b = new Builder();
      const r = rng(41);
      b.ribbon([V(-1.4, 0.15, 0), V(0, 0.2, 0.05), V(1.4, 0.15, -0.05)], [0.4, 0.45, 0.35], V(0, 0, 1), { color: 0x4a6a2c, sway: () => 0 });
      b.ribbon([V(-1.4, 0.15, 0), V(0, 0.2, 0.05), V(1.4, 0.15, -0.05)], [0.4, 0.45, 0.35], V(0, 1, 0), { color: 0x3e5e26, sway: () => 0 });
      const oval = (t) => Math.pow(Math.sin(Math.PI * Math.min(1, 0.06 + t * 0.97)), 0.75) * 0.5 * (1 - 0.15 * t);
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + r() * 0.4, x = (k - 3) * 0.4;
        const out = V(Math.cos(a) * 0.9, 0.9 + r() * 0.6, Math.sin(a) * 0.9).normalize();
        const stalk = 1 + r() * 0.8, tipP = V(x, 0.2, 0).addScaledVector(out, stalk);
        b.ribbon([V(x, 0.2, 0), tipP], [0.16, 0.12], V(1, 0, 0), { color: 0x3a6026 });
        shapedLeaf(b, { base: tipP, dir: V(out.x, out.y * 0.45, out.z), len: 3.2 + r() * 1.3, width: 1.9 + r() * 0.4, droop: 0.15, outline: oval, color: 0x1b471b, tip: 0x2b6324, rib: 0x5e8a3e, cup: 0.25 });
      }
      return b.build();
    },
    material: { amp: 0.12, underwaterAmp: 0.6, speed: 0.6 },
  },
  javamoss: {
    name: 'Java moss', habitat: 'emergent', humidity: [65, 100], light: 0.15, nutrients: 0.3, size: 4,
    note: 'Fine, tangled moss for wood, stone and the water\'s edge: cover for fry and shrimp, grazing for both.',
    build() {
      // A low, tangled mound: wiry strands that wander out and branch irregularly, each clothed in tiny leaves (drawn as a
      // fuzz of short flat scales), darker and browner at the base, fresh green at the tips.
      const b = new Builder();
      const r = rng(43);
      const strand = (p0, dir, len, depth) => {
        const segs = 4, pts = [p0.clone()];
        let p = p0.clone(), d = dir.clone();
        for (let i = 1; i <= segs; i++) {
          d.add(V((r() - 0.5) * 0.7, (r() - 0.6) * 0.4, (r() - 0.5) * 0.7)).normalize();
          p = p.clone().addScaledVector(d, len / segs);
          pts.push(p);
        }
        const sides = pts.map((_, i) => V(Math.cos(i * 1.7 + depth), 0.3, Math.sin(i * 1.7 + depth)).normalize());
        b.ribbon(pts, pts.map((_, i) => 0.34 - i * 0.04), sides, { color: (t) => new THREE.Color(0x24461a).lerp(new THREE.Color(0x5f9a34), t * (0.6 + depth * 0.3)) });
        if (depth < 2) for (let k = 0; k < 2; k++) { const i = 1 + Math.floor(r() * (segs - 1)); strand(pts[i], d.clone().add(V((r() - 0.5) * 1.6, 0.2, (r() - 0.5) * 1.6)).normalize(), len * 0.55, depth + 1); }
      };
      for (let k = 0; k < 34; k++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 1.5;
        strand(V(Math.cos(a) * d, 0.05, Math.sin(a) * d), V(Math.cos(a) * 1.2, 0.35 + r() * 0.6, Math.sin(a) * 1.2).normalize(), 1.4 + r() * 1.2, 0);
      }
      return b.build();
    },
    material: { amp: 0.25, underwaterAmp: 1.4, speed: 0.9 },
  },
  monstera: {
    name: 'Monstera vine', habitat: 'wall|land', humidity: [60, 100], light: 0.35, size: 1,
    note: 'Monstera adansonii: a climbing aroid with big broad leaves; reed frogs sit on them. Climbs the background.', wallTilt: 0.4,
    build() {
      // A climbing stem with big ovate leaves on stalks, each with the swiss-cheese holes of Monstera adansonii: two rows of
      // long oval windows either side of the midrib (fewer on the young leaves low down, none on the first).
      const b = new Builder();
      const r = rng(47);
      const ovate = (t) => 0.5 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.04 + t * 0.98)), 0.7) * (1 + 0.25 * Math.max(0, 0.3 - t)) * (1 - 0.35 * t * t);
      for (let k = 0; k < 6; k++) {
        const y = 0.5 + k * 1.6, a = k * 2.4 + r() * 0.5;
        const out = V(Math.cos(a), 0.25, Math.sin(a)).normalize(), stalk = 0.8 + r() * 0.4, at = V(0, y, 0).addScaledVector(out, stalk);
        b.ribbon([V(0, y, 0), at], [0.18, 0.14], V(0, 1, 0), { color: 0x3a6026 });
        const holes = [];
        const nh = k === 0 ? 0 : Math.min(4, 1 + k);
        for (let h = 0; h < nh; h++) {
          const t = 0.22 + (h / Math.max(1, nh - 1)) * 0.5 * (nh > 1 ? 1 : 0) + (nh === 1 ? 0.25 : 0);
          for (const sd of [-1, 1]) holes.push([t + (r() - 0.5) * 0.05, sd * (0.17 + r() * 0.05), 0.11 + r() * 0.04, 0.12 + r() * 0.04]);
        }
        shapedLeaf(b, { base: at, dir: V(out.x, 0.2, out.z), len: 4.2 + r() * 1.2 + k * 0.15, width: 3.4 + k * 0.1, droop: 0.22, outline: ovate, holes, color: 0x2a6322, tip: 0x45862f, rib: 0x6a9a48, n: 16, cup: 0.12 });
      }
      blade(b, { base: V(0, 0, 0), dir: V(0, 1, 0.1), len: 10, width: 0.25, droop: 0, segs: 4, color: 0x3a5a22, tip: 0x4a6a2a });
      return b.build();
    },
    material: { amp: 0.25, speed: 0.6 },
  },
  fissidens: {
    name: 'Fissidens moss', habitat: 'aquatic', light: 0.15, nutrients: 0.3, size: 3,
    note: 'A tiny feathery moss for wood and stone under water: slow, dense, a cushion of fronds shrimp graze.',
    build() {
      // A dense cushion of short, flat, feather-like fronds (a stem with two ranks of small leaves), standing up and out.
      const b = new Builder();
      const r = rng(53);
      for (let k = 0; k < 40; k++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 1.6;
        const base = V(Math.cos(a) * d, 0, Math.sin(a) * d);
        const dir = V(Math.cos(a) * (0.3 + d * 0.3), 1, Math.sin(a) * (0.3 + d * 0.3)).normalize();
        const len = 0.8 + r() * 0.9, side = new THREE.Vector3().crossVectors(V(0, 1, 0), dir).normalize();
        if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
        const tipP = base.clone().addScaledVector(dir, len);
        b.ribbon([base, tipP], [0.08, 0.05], side, { color: 0x2e5a22 });
        for (let i = 1; i <= 6; i++) {
          const t = i / 7, p = base.clone().addScaledVector(dir, len * t), ll = 0.42 * (1 - t * 0.6);
          for (const sd of [-1, 1]) blade(b, { base: p, dir: side.clone().multiplyScalar(sd).addScaledVector(dir, 0.8), len: ll, width: 0.2, droop: 0.05, segs: 1, color: 0x2f6a24, tip: 0x5a9a38 });
        }
      }
      return b.build();
    },
    material: { amp: 0.15, underwaterAmp: 0.8, speed: 0.8 },
  },
  rotala: {
    name: 'Rotala (stem plant)', habitat: 'aquatic', light: 0.55, nutrients: 1.4, size: 14,
    note: 'Rotala rotundifolia: a bunch of fast stems with small paired round leaves, the tips blushing pink in strong light. Trim and replant the tops.',
    build() {
      // Seven stems rising and bending a little, with pairs of small round leaves at every node, crossed at right angles,
      // green below and rose-pink at the tips.
      const b = new Builder();
      const r = rng(59);
      for (let k = 0; k < 7; k++) {
        const x = (r() - 0.5) * 1.8, z = (r() - 0.5) * 1.8, h = 9 + r() * 7, bd = r() * Math.PI * 2, bend = 0.6 + r() * 1.2;
        const nodes = Math.round(h / 0.75), pts = [];
        for (let i = 0; i <= nodes; i++) { const t = i / nodes; pts.push(V(x + Math.cos(bd) * bend * t * t, h * t, z + Math.sin(bd) * bend * t * t)); }
        b.ribbon(pts, pts.map(() => 0.12), V(1, 0, 0), { color: (t) => new THREE.Color(0x6a5a2e).lerp(new THREE.Color(0xb05a6a), t * t) });
        for (let i = 1; i <= nodes; i++) {
          const t = i / nodes, p = pts[i], ll = 0.55 + 0.25 * Math.sin(Math.PI * t), a = i * Math.PI / 2 + r() * 0.3;
          const c0 = new THREE.Color(0x3f8a2e).lerp(new THREE.Color(0xd77a86), Math.max(0, t - 0.55) * 2.2), c1 = c0.clone().lerp(new THREE.Color(0xe6a0a8), t * 0.4);
          for (const sd of [-1, 1]) blade(b, { base: p, dir: V(Math.cos(a) * sd, 0.55 + t * 0.5, Math.sin(a) * sd), len: ll, width: ll * 0.75, droop: 0.15, segs: 2, color: c0, tip: c1 });
        }
      }
      return b.build();
    },
    material: { amp: 0.3, underwaterAmp: 1.6, speed: 0.8 },
  },
  frogbit: {
    name: 'Frogbit', habitat: 'floating', light: 0.5, nutrients: 0.8, size: 4,
    note: 'Floats on the surface and shades the water.',
    build() {
      const b = new Builder();
      const r = rng(29);
      for (let k = 0; k < 7; k++) {
        const a = r() * Math.PI * 2, rr = r() * 2.6;
        const s = 0.9 + r() * 0.6;
        b.add(new THREE.CircleGeometry(1, 9), { p: [Math.cos(a) * rr, 0.05 + r() * 0.03, Math.sin(a) * rr], r: [-Math.PI / 2, 0, 0], s: [s, s, 1], color: r() > 0.5 ? 0x4f9a36 : 0x3f8a2c, sway: 0.4, jitter: 0.2 });
        // Dangling roots.
        b.ribbon([V(Math.cos(a) * rr, 0, Math.sin(a) * rr), V(Math.cos(a) * rr, -2.5 - r() * 2, Math.sin(a) * rr)], [0.12, 0.05], V(1, 0, 0), { color: 0xcfc6a8, sway: (t) => t });
      }
      return b.build();
    },
    material: { amp: 0.15, underwaterAmp: 0.4, speed: 0.6 },
  },
  lily: {
    name: 'Water lily', habitat: 'floating', light: 0.7, nutrients: 1, size: 7,
    note: 'Pads with a flower. Needs space on the surface.',
    build() {
      const b = new Builder();
      const r = rng(31);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + r(), rr = 2.5 + r();
        const pad = new THREE.CircleGeometry(1, 12, 0.3, Math.PI * 2 - 0.3);
        b.add(pad, { p: [Math.cos(a) * rr, 0.05, Math.sin(a) * rr], r: [-Math.PI / 2, 0, r() * 6], s: [2.2, 2.2, 1], color: 0x3a7a2c, sway: 0.5, jitter: 0.2 });
      }
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        blade(b, { dir: V(Math.cos(a), 1.1, Math.sin(a)), len: 1.8, width: 0.8, droop: -0.1, segs: 2, color: 0xf4d7e4, tip: 0xe07aa6 });
      }
      b.add(PRIM.sphereLo, { p: [0, 0.4, 0], s: 0.4, color: 0xf2c53d });
      return b.build();
    },
    material: { amp: 0.1, underwaterAmp: 0.2, speed: 0.5 },
  },
};

// How plants spread once grown: [chance per day, reach in cm, most plants of that kind].
const SPREAD = {
  weed: [0.15, 5, 30], grass: [0.08, 4, 30], fernph: [0.03, 8, 16], fern: [0.03, 7, 14], bilberry: [0.02, 6, 8],
  pothos: [0.08, 6, 20], bromeliad: [0.02, 6, 10], cattail: [0.04, 5, 10], bamboo: [0.03, 6, 8],
  vallisneria: [0.12, 5, 40], sword: [0.02, 8, 6], javafern: [0.05, 4, 16], frogbit: [0.35, 5, 40], lily: [0.03, 9, 6],
  anubias: [0.02, 4, 10], javamoss: [0.12, 4, 40], monstera: [0.04, 8, 10], fissidens: [0.05, 3, 30], rotala: [0.1, 4, 24],
};

export class Plants {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.meshes = {};
    this.variants = {};
    this.cap = 300;
    // Procedural species are built when first used (the first plant of that species, a portrait): a tank pays the mesh,
    // the material and its shader build only for the species it grows. Reading this.meshes[id] builds it.
    for (const [id, sp] of Object.entries(PLANTS)) {
      if (sp.model) continue; // built in preload()
      this.variants[id] = 1;
      Object.defineProperty(this.meshes, id, { configurable: true, enumerable: false, get: () => {
        delete this.meshes[id];
        this.addMesh(id, sp.build(), plantMaterial({ ...(sp.material ?? {}), map: sp.map ? sp.map() : null }));
        return this.meshes[id];
      } });
    }
  }

  addMesh(key, geo, mat) {
    const im = new THREE.InstancedMesh(geo, mat, this.cap);
    im.count = 0;
    im.castShadow = !this.shadowless;
    // Thin flat ribbons self-shadow into noise: the procedural (non-card) plants only cast.
    im.receiveShadow = !!(PLANTS[key.split('#')[0]]?.map || PLANTS[key.split('#')[0]]?.model);
    im.frustumCulled = false;
    im.name = 'plant:' + key;
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3).fill(1), 3);
    this.scene.add(im);
    this.meshes[key] = im;
  }

  // Photoscanned plants: each mesh in the model becomes a variant, recentred
  // with its base at the origin and scaled to 1 across.
  async preload() {
    for (const [id, sp] of Object.entries(PLANTS)) {
      if (!sp.model) continue;
      const parts = await modelParts(sp.model);
      parts.forEach((part, k) => {
        const g = part.geometry;
        const bb = g.boundingBox;
        g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
        const ext = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z, bb.max.y - bb.min.y);
        g.scale(1 / ext, 1 / ext, 1 / ext);
        g.computeBoundingBox();
        const h = Math.max(1e-3, g.boundingBox.max.y);
        const n = g.attributes.position.count;
        const sway = new Float32Array(n), col = new Float32Array(n * 3).fill(1);
        for (let i = 0; i < n; i++) {
          const x = g.attributes.position.getX(i), z = g.attributes.position.getZ(i), y = g.attributes.position.getY(i);
          sway[i] = Math.min(1, Math.hypot(x, z) * 1.6 + y / h * 0.5);
        }
        g.setAttribute('sway', new THREE.BufferAttribute(sway, 1));
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const src = part.material;
        this.addMesh(id + '#' + k, g, plantMaterial({ ...(sp.material ?? {}), map: src.map, normalMap: src.normalMap }));
      });
      this.variants[id] = parts.length;
    }
  }

  key(p) { return this.variants[p.id] > 1 || PLANTS[p.id].model ? p.id + '#' + (p.variant ?? 0) : p.id; }

  // Checks whether species `id` may grow at a surface hit.
  canPlace(id, hit, world) {
    this.world = world;
    const sp = PLANTS[id];
    const hab = sp.habitat.split('|');
    const { point, surface } = hit;
    const wl = world.water.level;
    if (surface === 'wall') {
      if (!hab.includes('wall')) return 'This plant can’t grow on the background.';
      if (point.y < wl + 1) return 'That part of the wall is under water.';
      return null;
    }
    if (surface === 'water' || surface === 'pond') {
      if (!hab.includes('floating')) return 'Only floating plants go on the water surface. Click the ground under it.';
      return null;
    }
    const depth = world.water.surfaceAt(point.x, point.z) - point.y;
    if (hab.includes('floating')) {
      if (depth > 1.5) return null;
      return 'Floating plants need open water.';
    }
    if (hab.includes('aquatic')) {
      if (depth < (id === 'vallisneria' ? 6 : 3)) return 'Aquatic plants need to be under water.';
      return null;
    }
    if (hab.includes('emergent')) {
      if (depth > 6) return 'Too deep; plant it where the ground meets the water.';
      if (depth < -3 && !world.nearWater(point, 5)) return 'Needs wet feet: put it at the water’s edge.';
      return null;
    }
    if (hab.includes('land')) {
      if (depth > -0.2) return 'Land plants would drown here.';
      return null;
    }
    return 'Can’t place here.';
  }

  add(id, pos, { normal = null, scale = null, rot = null, grown = 0.35, surface = 'terrain', health = 1, variant = null } = {}) {
    const nv = this.variants[id] ?? 1;
    const v = variant ?? Math.floor(Math.random() * nv);
    const im = this.meshes[PLANTS[id].model ? id + '#' + v : id];
    if (!im || im.count >= this.cap) return null;
    const scaleV = scale ?? 0.8 + Math.random() * 0.4;
    // The canopy (at full size) must stay inside the glass: keep the stem clear of the walls.
    const reach = this.reachOf(im, id, scaleV);
    pos = pos.clone();
    const fit = plantFit(pos.x, pos.z, reach, TANK, { clampZ: surface !== 'wall' });
    if (fit.x !== pos.x || fit.z !== pos.z) {
      pos.x = fit.x; pos.z = fit.z;
      if (surface === 'terrain' && PLANTS[id].habitat !== 'floating' && this.world) pos.y = this.world.terrain.heightAt(pos.x, pos.z);
    }
    const p = {
      id, pos, reach, normal: normal ? normal.clone() : new THREE.Vector3(0, 1, 0), surface,
      rot: rot ?? Math.random() * Math.PI * 2, scale: scaleV,
      grown, health, age: 0, index: im.count, variant: v,
    };
    im.count++;
    this.list.push(p);
    this.writeInstance(p);
    return p;
  }

  // How far the canopy of a full-grown plant reaches sideways from its stem (cm).
  reachOf(im, id, scale) {
    const g = im.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const b = g.boundingBox;
    const hr = Math.max(-b.min.x, b.max.x, -b.min.z, b.max.z);
    return hr * 0.9 * scale * (PLANTS[id].modelSize ?? 1);
  }

  remove(p) {
    const im = this.meshes[this.key(p)];
    const last = this.list.filter((q) => this.key(q) === this.key(p) && q.index === im.count - 1)[0];
    if (last && last !== p) {
      last.index = p.index;
      this.writeInstance(last);
    }
    im.count--;
    this.list.splice(this.list.indexOf(p), 1);
    im.instanceMatrix.needsUpdate = true;
  }

  writeInstance(p) {
    const im = this.meshes[this.key(p)];
    const q = new THREE.Quaternion();
    if (p.surface === 'wall') {
      // Grow out from the wall: plant "up" follows the wall normal, tilted up.
      const n = p.normal.clone().add(new THREE.Vector3(0, PLANTS[p.id].wallTilt ?? 0.9, 0)).normalize();
      q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    } else if (PLANTS[p.id].habitat === 'floating') {
      q.identity();
    } else {
      const n = p.normal.clone().lerp(new THREE.Vector3(0, 1, 0), 0.6).normalize();
      q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    }
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot));
    // Near a wall the plant leans inward so its canopy stays inside the glass.
    if (p.reach && PLANTS[p.id].habitat !== 'floating') {
      const f = plantFit(p.pos.x, p.pos.z, p.reach * (0.3 + 0.7 * p.grown), TANK, { clampZ: p.surface !== 'wall' });
      if (f.lean > 0.01) q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(f.dz, 0, -f.dx), f.lean));
    }
    const s = p.scale * (0.3 + 0.7 * p.grown) * (PLANTS[p.id].modelSize ?? 1);
    const m = new THREE.Matrix4().compose(p.pos, q, new THREE.Vector3(s, s, s));
    im.setMatrixAt(p.index, m);
    // Healthy plants are green; dying ones yellow and brown.
    const c = new THREE.Color(1, 1, 1).lerp(new THREE.Color(0.85, 0.6, 0.3), clamp(1 - p.health, 0, 1));
    im.setColorAt(p.index, c);
    im.instanceMatrix.needsUpdate = true;
    im.instanceColor.needsUpdate = true;
  }

  // The plant whose base a new plant of species `id` at `point` would stand in, or null. Two plants may brush leaves, but a stem
  // inside another plant's crown reads as two models pushed into each other. Plants on the water, on the background and in
  // the ground only meet their own layer; `skip` is a plant to ignore (the parent of an offshoot is not, it is a neighbour).
  crowdingAt(id, point, { scale = 1, surface = 'terrain', skip = null } = {}) {
    const layer = (pid, surf) => (surf === 'wall' ? 'wall' : PLANTS[pid].habitat === 'floating' ? 'float' : 'ground');
    const mine = layer(id, surface);
    const im = this.meshes[PLANTS[id].model ? id + '#0' : id];
    const r = im ? this.reachOf(im, id, scale) : 3;
    for (const q of this.list) {
      if (q === skip || layer(q.id, q.surface) !== mine) continue;
      const d = mine === 'wall' ? Math.hypot(q.pos.x - point.x, q.pos.y - point.y) : Math.hypot(q.pos.x - point.x, q.pos.z - point.z);
      if (d < (q.id === id ? PLANT_ROOM * 0.55 : PLANT_ROOM) * (r + q.reach)) return q;      // a clump of one kind may stand closer
    }
    return null;
  }

  // How tall plant p stands (cm), from its model's bounds at its size and growth.
  heightOf(p) {
    const im = this.meshes[this.key(p)];
    if (!im) return 3;
    const g = im.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    return g.boundingBox.max.y * p.scale * (0.3 + 0.7 * p.grown) * (PLANTS[p.id].modelSize ?? 1);
  }

  near(point, r) {
    let best = null, bd = r;
    for (const p of this.list) {
      const d = p.pos.distanceTo(point);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // Keep floating plants on the water when the level changes, and drop
  // plants the new water has drowned or left dry.
  onWaterChanged(world) {
    this.world = world;
    for (const p of [...this.list]) {
      const sp = PLANTS[p.id];
      if (sp.habitat === 'floating') {
        // Stranded floaters sit on the mud (and slowly die, see step()).
        const s = world.water.surfaceAt(p.pos.x, p.pos.z, 0.2);
        const y = s === -Infinity ? world.terrain.heightAt(p.pos.x, p.pos.z) : s;
        if (Math.abs(y - p.pos.y) < 0.02) continue;
        p.pos.y = y;
        this.writeInstance(p);
      }
    }
  }

  // Sim step: `env` gives light and the air; each plant reads the water body it stands in (or the soil
  // fertility under it). dtMin = game minutes.
  step(dtMin, env, world) {
    this.world = world;
    const out = { nitrateUse: 0, shade: 0, deaths: [], born: [] };
    const bodies = world.water.bodies, humus = world.humus, days = dtMin / 1440;
    for (const p of [...this.list]) {
      const sp = PLANTS[p.id];
      p.age += dtMin;
      p.why = [];
      let ok = 1, boost = 0;
      const hab = sp.habitat;
      const size = p.grown * p.scale;
      if (hab === 'aquatic' || hab === 'floating') {
        // Submerged and floating plants read the pond they stand in, not the tank mean: a planted shallow
        // pond is lush while a loaded fish pond burns them. (They draw on it in waterbodies.chemistry.)
        const B = bodies?.bodyFor(p.pos.x, p.pos.z) ?? null;
        p.bodyName = B?.name ?? null;
        const c = waterCondition(sp, B ?? env);
        ok = Math.min(ok, c.ok); boost = c.boost;
        for (const w of c.why) p.why.push(w);
        out.nitrateUse += p.grown * p.scale * (hab === 'floating' ? 1.6 : 1);
        if (hab === 'floating') out.shade += p.grown * p.scale * 40;
        if (world.water.surfaceAt(p.pos.x, p.pos.z) === -Infinity) ok = 0;
      } else {
        // Land plants read their own spot: the local air, the light that
        // reaches them under the canopy, how wet the soil is and how fertile.
        const [hmin] = sp.humidity;
        const C = world.climate;
        const hum = C.humidityAt(p.pos.x, p.pos.y, p.pos.z);
        if (hum < hmin) { ok = Math.min(ok, 1 - (hmin - hum) / 25); p.why.push('air too dry here'); }
        if (hab !== 'emergent' && world.water.surfaceAt(p.pos.x, p.pos.z) > p.pos.y + 0.5) { ok = 0; p.why.push('under water'); }
        if (p.surface !== 'wall') {
          const soil = C.soilAt(p.pos.x, p.pos.z);
          if (soil < (sp.soilMin ?? 0.22)) { ok = Math.min(ok, 0.35 + soil * 2); p.why.push('soil too dry'); }
          if (env.soil > 0.9 && (env.drainEff ?? env.drainage) < 0.3 && !sp.bog && soil > 0.9) { ok = Math.min(ok, 0.5); p.why.push(env.plenum?.state === 'mud' ? 'waterlogged roots (water over the false bottom)' : 'waterlogged roots (no drainage)'); }
          if (humus) {
            // Rich, humus-fed soil boosts growth and is slowly used up; bare soil only slows things a little.
            const f = humus.fertilityAt(p.pos.x, p.pos.z);
            p.fert = f; p.humusHere = humus.humusAt(p.pos.x, p.pos.z); p.litterHere = humus.litterAt(p.pos.x, p.pos.z);
            boost += f * 0.7 - 0.08;
            if (f < 0.06) p.why.push('poor soil (add leaf litter or wait for humus)');
            humus.take(p.pos.x, p.pos.z, size * (hab === 'emergent' ? 0.5 : 1) * 0.02 * days);
            // Leaf drop: a healthy plant sheds a little every day.
            humus.drop(p.pos.x, p.pos.z, size * (sp.leafDrop ?? 0.012) * days * 8);
          }
        }
        if (hab === 'emergent') {
          // Roots reach into the nearest pond.
          const B = bodies?.bodyFor(p.pos.x, p.pos.z, 6) ?? null;
          if (B) boost += emergentBoost(B);
        }
        if (env.mold > 0.7) { ok = Math.min(ok, 0.7); p.why.push('mould'); }
      }
      // Light: a crude daily light integral, at this plant's own spot.
      const shade = clamp(world.climate.lightAt(p.pos.x, p.pos.z) / Math.max(0.2, env.lampPower), 0.15, 1.3);
      const lightHere = env.lightAvg * (hab === 'floating' ? 1 : shade);
      const lightOk = clamp(lightHere / Math.max(0.05, sp.light * 0.55), 0, 1.2);
      if (lightOk < 0.6) p.why.push(shade < 0.6 ? 'too shaded here' : 'not enough light');
      ok = Math.min(ok, lightOk);
      const rate = dtMin / (60 * 24 * 4); // full size in ~4 days
      if (ok > 0.6) {
        p.grown = Math.min(1, p.grown + rate * ok * (1 + clamp(boost, -0.2, 0.9)));
        p.health = Math.min(1, p.health + rate * 4);
      } else if (ok < 0.5) {
        p.health -= rate * (1 - ok) * 3;
      } // In between: the plant stalls but survives.
      if (p.health <= 0) {
        // A dead plant becomes litter where it stood.
        if (humus && p.surface !== 'wall' && hab !== 'aquatic' && hab !== 'floating') humus.drop(p.pos.x, p.pos.z, 0.5 + size * 1.5);
        out.deaths.push(p);
        continue;
      }
      if (Math.random() < 0.02) this.writeInstance(p);
      // Healthy, full-grown plants spread: runners, plantlets, spores. Fertile ground favours them.
      const sprd = SPREAD[p.id];
      const fertK = p.fert != null ? 0.7 + p.fert * 0.8 : 1;
      if (sprd && p.grown > 0.9 && p.health > 0.8 && Math.random() < sprd[0] * fertK * dtMin / 1440) {
        const child = this.offshoot(p, sprd, world);
        if (child) out.born.push(child);
      }
    }
    for (const p of out.deaths) this.remove(p);
    return out;
  }

  count(id) { let n = 0; for (const p of this.list) if (p.id === id) n++; return n; }

  offshoot(p, [, r, max], world) {
    if (this.count(p.id) >= max) return null;
    const sp = PLANTS[p.id];
    for (let k = 0; k < 6; k++) {
      const a = Math.random() * Math.PI * 2, d = r * (0.4 + Math.random() * 0.6);
      let hit;
      if (p.surface === 'wall') {
        const x = p.pos.x + Math.cos(a) * d, y = p.pos.y + Math.sin(a) * d;
        const [gx, gy] = world.wall.field.gradient(x, y);
        hit = { point: new THREE.Vector3(x, y, world.wall.zAt(x, y) + 0.2), surface: 'wall', normal: new THREE.Vector3(-gx, -gy, 1).normalize() };
      } else {
        const x = p.pos.x + Math.cos(a) * d, z = p.pos.z + Math.sin(a) * d;
        if (Math.abs(x) > 43 || Math.abs(z) > 20.5) continue;
        const y = world.terrain.heightAt(x, z);
        hit = { point: new THREE.Vector3(x, y, z), surface: 'terrain', normal: world.terrain.normalAt(x, z) };
      }
      if (this.canPlace(p.id, hit, world)) continue;
      const crowd = this.list.some((q) => q.id === p.id && q.pos.distanceTo(hit.point) < r * 0.35) || this.crowdingAt(p.id, hit.point, { surface: hit.surface });
      if (crowd) continue;
      if (sp.habitat === 'floating') hit.point.y = world.water.surfaceAt(hit.point.x, hit.point.z, 0.2);
      return this.add(p.id, hit.point, { normal: hit.normal, surface: hit.surface, grown: 0.15 });
    }
    return null;
  }

  serialize() {
    return this.list.map((p) => ({ id: p.id, pos: p.pos.toArray().map((v) => +v.toFixed(2)), n: p.normal.toArray().map((v) => +v.toFixed(3)), s: p.surface, v: p.variant, r: +p.rot.toFixed(2), sc: +p.scale.toFixed(2), g: +p.grown.toFixed(2), h: +p.health.toFixed(2) }));
  }

  clear() {
    for (const p of [...this.list]) this.remove(p);
  }
}

export { MAT };
