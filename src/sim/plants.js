// Plants: low-poly procedural geometry, one InstancedMesh per species. Each
// plant has a habitat, needs (light, humidity, nutrients) and grows or wilts
// with the conditions in the tank.

import * as THREE from 'three/webgpu';
import { Builder, PRIM } from '../render/geo.js';
import { rng, lerp, clamp } from '../util/math.js';
import { plantMaterial } from '../render/shaders.js';
import { plantLeafMap, hartstongueEnv, plantMaps } from './plant-leaves.js';
import { MAT, TANK } from './tank.js';
import { plantFit } from './placement.js';
import { waterCondition, emergentBoost } from './plantpond.js';
import { TEX, modelParts } from '../render/assets.js';
import { FLOWERING, BROMELIAD_FLOWER, headMatrix } from './flowering.js';
import { FlowerMesh, flowerGeometry, packRGB, packSway, FLOWER } from '../render/flowers.js';
import { newBloom, stepBloom, bloomLook, cycleOf, dayOpen, AFTER, packBloom, unpackBloom } from './bloom.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _seatRay = new THREE.Raycaster(), _seatO = V(0, 0, 0), _seatD = V(0, -1, 0);
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
  b.ribbon(pts, widths, sides, { color: (t) => c0.clone().lerp(c1, t), leaf: true });
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
    // leaf coordinates: across (-1 … 1 of the outline's half width there) and along (0 base … 1 tip)
    leaf: (lv) => { const q = lv.clone().sub(base), t = clamp(q.dot(d) / len, 0, 1); return [clamp(q.dot(side) / Math.max(1e-3, outline(t) * width), -1, 1), t]; },
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
  // Generated scans (Meshy, 8 Oct 2026; tools/meshy-piece.mjs, sources in art-src/drop/). `lazy`: their models load in the background after
  // the title screen (preloadMore) and a game waits for them before it builds a tank (Game.buildTank), as the hardscape does (sim/decor.js).
  // `model` may be a list: every mesh of every file is a variant.
  hosta: {
    name: 'Hosta', habitat: 'land', humidity: [55, 100], light: 0.35, size: 1, modelSize: 20, room: 0.6, lazy: true,
    note: 'Broad cream-edged leaves and a spike of lavender flowers. Loves shade and damp ground.',
    model: 'plant_hosta', material: { amp: 0.12, speed: 0.6 },
  },
  royalfern: {
    name: 'Royal fern', habitat: 'land', humidity: [60, 100], light: 0.3, size: 1, modelSize: 30, room: 0.6, lazy: true,
    note: 'A tall shuttlecock of fronds for the damp edge of a wood or a pond.',
    model: 'plant_royalfern', material: { amp: 0.25, speed: 0.8 },
  },
  crimsonfern: {
    name: 'Crimson moon fern', habitat: 'land|wall', humidity: [65, 100], light: 0.45, size: 1, modelSize: 16, room: 0.55, lazy: true,
    note: 'A rosette of narrow magenta leaves, like a bromeliad. Bright, humid, and no standing water in the heart of it.',
    model: 'plant_crimsonfern', material: { amp: 0.1, speed: 0.6 },
  },
  parrotheliconia: {
    name: 'Parrot heliconia', habitat: 'land', humidity: [70, 100], light: 0.6, size: 1, modelSize: 34, room: 0.6, lazy: true,
    note: 'Tall, paddle-leaved and bracted in yellow and orange: a plant of the clearings and creeksides of the wet tropics.',
    model: 'plant_heliconia', material: { amp: 0.15, speed: 0.7 },
  },
  hibiscus: {
    name: 'Hibiscus', habitat: 'land', humidity: [55, 100], light: 0.7, size: 1, modelSize: 24, room: 0.6, lazy: true,
    note: 'A shrub in flower: big pink trumpets with a red eye. Wants light and warmth.',
    model: 'plant_hibiscus', material: { amp: 0.1, speed: 0.6 },
  },
  forestginger: {
    name: 'Forest ginger', habitat: 'land', humidity: [65, 100], light: 0.4, size: 1, modelSize: 30, room: 0.55, lazy: true,
    note: 'Leafy, upright stems of long glossy leaves: the understorey of a damp tropical forest.',
    model: ['plant_ginger_a', 'plant_ginger_b'], material: { amp: 0.15, speed: 0.7 },
  },
  trillium: {
    name: 'Trillium', habitat: 'land', humidity: [60, 100], light: 0.3, size: 1, modelSize: 16, room: 0.5, lazy: true,
    note: 'Three leaves and one white flower, a woodland plant of cool, damp shade.',
    model: 'plant_trillium', material: { amp: 0.1, speed: 0.6 },
  },
  typha: {
    name: 'Bulrush', habitat: 'emergent', humidity: [40, 100], light: 0.6, size: 1, modelSize: 46, room: 0.45, lazy: true,
    note: 'Tall blades and a brown velvet spike. Wet feet: plant at the waterline.',
    model: 'plant_typha', material: { amp: 0.2, speed: 0.8 },
  },
  lotus: {
    name: 'Lotus', habitat: 'floating', light: 0.7, nutrients: 1, size: 1, modelSize: 28, room: 1.0, lazy: true,
    note: 'Big round pads with pink flowers held on the surface. Needs open water and space.',
    model: ['plant_lotus_a', 'plant_lotus_b'], material: { amp: 0.06, speed: 0.5 },
  },
  lilyscan: {
    name: 'Water lily (broad)', habitat: 'floating', light: 0.7, nutrients: 1, size: 1, modelSize: 26, room: 1.0, lazy: true,
    note: 'Broad pads and star-shaped flowers floating on the surface. Needs open water.',
    model: ['plant_lily_a', 'plant_lily_b'], material: { amp: 0.06, speed: 0.5 },
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
            b.pos.push(...bb.pos); b.nor.push(...bb.nor); b.col.push(...bb.col); b.leaf.push(...bb.leaf);
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
    note: 'Epiphyte. Grows on the background too. Its heart blushes red when it flowers.',
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
            // the inner leaves are flushed red at the base; the full blush and the flowers come with the bloom (flower)
            color: ring ? 0x8a3040 : 0x4c7a2e, tip: ring ? 0x4f7a32 : 0x7e3a3f, twist: r() * 0.4,
          });
        }
      }
      return b.build();
    },
    material: { veins: { kind: 'parallel', n: 5, rib: 0.03, k: 0.6 } },
    flower: BROMELIAD_FLOWER,
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
          b.pos.push(...bb.pos); b.nor.push(...bb.nor); b.col.push(...bb.col); b.leaf.push(...bb.leaf); b.sway.push(...bb.sway.map(() => 1));
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
      for (let k = 0; k < 28; k++) {
        const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * 1.7;
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        const h = 6 + Math.pow(r(), 1.4) * 20;          // many short, a few long
        const W = (0.38 + r() * 0.3) * (0.7 + h / 40);  // longer leaves are wider
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
        if (r() < 0.2) c1.lerp(new THREE.Color(0x9a9a46), 0.5);                // an older leaf yellowing toward the tip
        b.ribbon(pts, w, sides, { color: (t) => c0.clone().lerp(c1, Math.min(1, t * 1.15)) });
      }
      return b.build();
    },
    material: { amp: 0.4, underwaterAmp: 2.6, speed: 0.9, veins: { kind: 'parallel', n: 2, rib: 0.06, cross: 30, k: 1 } },
  },
  sword: {
    name: 'Amazon sword', habitat: 'aquatic', light: 0.5, nutrients: 1.5, size: 12,
    note: 'Rosette plant for the aquarium floor.',
    build() {
      // Echinodorus: a rosette of lance-shaped leaves on long stalks, the young ones in the middle short and upright, the old
      // ones outside long and arching out; arcuate veins that follow the margin (drawn by plantMaterial), a pale midrib.
      const b = new Builder();
      const r = rng(17);
      const lance = (t) => 0.5 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.03 + t * 0.98)), 0.85) * (1 - 0.25 * t) * (t < 0.12 ? 0.55 + t * 3.7 : 1);
      const N = 16;
      for (let k = 0; k < N; k++) {
        const age = k / (N - 1);                                  // 0 the youngest (middle) … 1 the oldest (outside)
        const a = k * 2.399 + r() * 0.3;                          // golden-angle phyllotaxis
        const out = 0.25 + age * 0.9, up = 1.0 - age * 0.35;
        const dir = V(Math.cos(a) * out, up, Math.sin(a) * out).normalize();
        const stalk = (2.2 + age * 3.2) * (0.85 + r() * 0.3);
        const p0 = V(Math.cos(a) * 0.15, 0, Math.sin(a) * 0.15), p1 = p0.clone().addScaledVector(dir, stalk);
        p1.y -= age * 0.35 * stalk;
        const sc = new THREE.Color(0x4d7a2c).multiplyScalar(0.85 + r() * 0.2);
        b.ribbon([p0, p0.clone().lerp(p1, 0.5).add(V(0, 0.1, 0)), p1], [0.28, 0.22, 0.18], V(-Math.sin(a), 0, Math.cos(a)), { color: sc });
        const ld = V(dir.x, dir.y * (0.75 - age * 0.55), dir.z);
        const dark = 0.82 + r() * 0.3;
        shapedLeaf(b, { base: p1, dir: ld, len: (3.5 + age * 4.5) * (0.85 + r() * 0.3), width: 1.5 + age * 0.9 + r() * 0.3, droop: 0.25 + age * 0.35, outline: lance,
          color: new THREE.Color(0x1f5e24).multiplyScalar(dark), tip: new THREE.Color(0x4f9a34).multiplyScalar(dark), rib: 0x8ab858, n: 14, cup: 0.15 });
      }
      return b.build();
    },
    material: { amp: 0.3, underwaterAmp: 1.2, speed: 0.8, veins: { kind: 'parallel', n: 3, rib: 0.08, cross: 10 } },
  },
  javafern: {
    name: 'Java fern', habitat: 'aquatic', light: 0.2, nutrients: 0.5, size: 9,
    note: 'Hardy, low light. Fine on rock or wood.',
    build() {
      // Microsorum pteropus: a creeping brown rhizome with tough, narrow lance leaves on short stalks, dark green with a wavy
      // margin, the veins standing out; a few young pale leaves.
      const b = new Builder();
      const r = rng(23);
      b.ribbon([V(-1.6, 0.15, -0.2), V(-0.4, 0.22, 0.1), V(0.8, 0.2, -0.1), V(1.7, 0.12, 0.15)], [0.38, 0.42, 0.4, 0.3], V(0, 0, 1), { color: 0x4a3a22, sway: () => 0 });
      b.ribbon([V(-1.6, 0.15, -0.2), V(-0.4, 0.22, 0.1), V(0.8, 0.2, -0.1), V(1.7, 0.12, 0.15)], [0.38, 0.42, 0.4, 0.3], V(0, 1, 0), { color: 0x3c2e1a, sway: () => 0 });
      for (let k = 0; k < 9; k++) {
        const x = -1.4 + k * 0.36 + (r() - 0.5) * 0.2, a = r() * Math.PI * 2, young = r() < 0.25;
        const wav = 2 + Math.floor(r() * 3), ph = r() * 6;
        const outline = (t) => (0.5 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.04 + t * 0.97)), 0.7) * (1 - 0.3 * t)) * (1 + 0.08 * Math.sin(t * wav * 6.28 + ph));
        const dir = V(Math.cos(a) * 0.55, 1, Math.sin(a) * 0.55).normalize();
        const p0 = V(x, 0.2, 0), p1 = p0.clone().addScaledVector(dir, 0.6 + r() * 0.4);
        b.ribbon([p0, p1], [0.12, 0.1], V(1, 0, 0), { color: 0x3a4a22 });
        const c = young ? 0x4d8a34 : 0x1d4e20, tip = young ? 0x8ac25a : 0x356e2a;
        shapedLeaf(b, { base: p1, dir, len: (young ? 3.5 : 5.5) + r() * 3, width: 1.2 + r() * 0.4, droop: 0.12 + r() * 0.15, outline, color: c, tip, rib: 0x6a8a48, n: 16, cup: 0.1 });
      }
      return b.build();
    },
    material: { amp: 0.2, underwaterAmp: 1.0, speed: 0.7, veins: { kind: 'pinnate', n: 9, slope: 1.3, rib: 0.07, k: 1.2 } },
  },
  // ---- From the keeper's care sheets (2026-10) ----
  // ---- Run "sets": plants the premade sets lacked (procedural leaf builders, no scan) ----
  nidus: {
    name: "Bird's-nest fern", habitat: 'land', humidity: [55, 100], light: 0.3, size: 16,
    note: 'Asplenium nidus: a rosette of broad, wavy, undivided fronds round a dark brown nest. Tropical forest floor, rocks and tree forks; needs warm, humid air.',
    build() {
      const b = new Builder();
      const r = rng(61);
      const strap = (wav, ph) => (t) => 0.5 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.02 + t * 0.98)), 0.5) * (t < 0.15 ? 0.45 + t * 3.6 : 1) * (1 - 0.22 * t) * (1 + 0.07 * Math.sin(t * wav * 6.28 + ph));
      // The nest: a crinkled brown crown of old stalk bases and unrolling fiddleheads.
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + r() * 0.5;
        const top = V(Math.cos(a) * 0.35, 1.3 + r() * 0.9, Math.sin(a) * 0.35);
        b.ribbon([V(Math.cos(a) * 0.15, 0, Math.sin(a) * 0.15), top], [0.35, 0.12], V(-Math.sin(a), 0, Math.cos(a)), { color: 0x3a2814 });
      }
      const N = 14;
      for (let k = 0; k < N; k++) {
        const age = k / (N - 1);                                  // 0 the youngest (upright, middle) … 1 the oldest (outside, low)
        const a = k * 2.399 + r() * 0.25;
        const out = 0.35 + age * 0.95, up = 1.05 - age * 0.55;
        const dir = V(Math.cos(a) * out, up, Math.sin(a) * out).normalize();
        const len = (6.5 + age * 6.5) * (0.85 + r() * 0.3), base = V(Math.cos(a) * 0.2, 0.2, Math.sin(a) * 0.2);
        const g = 0.85 + r() * 0.25;
        shapedLeaf(b, { base, dir, len, width: 2.2 + age * 1.1 + r() * 0.3, droop: 0.12 + age * 0.4, outline: strap(2 + Math.floor(r() * 3), r() * 6), color: new THREE.Color(0x4a7a0c).multiplyScalar(g), tip: new THREE.Color(0xa4be5a).multiplyScalar(g), rib: 0x1a2008, n: 16, cup: 0.18 });
      }
      return b.build();
    },
    material: { amp: 0.2, speed: 0.7, rough: 0.8, wax: [0.38, 0.82, 0.42], ...plantMaps('nidus'), leafPale: [0.5, 0.62, 0.3], leafBack: [1.0, 0.95, 0.8] },
  },
  crypt: {
    name: 'Cryptocoryne', habitat: 'aquatic', light: 0.25, nutrients: 0.8, size: 10,
    note: 'Cryptocoryne wendtii: a low bunch of crinkled, bronze-green leaves on stalks. Slow, shade-tolerant, for streams and the aquarium floor; it melts when the water changes suddenly.',
    build() {
      const b = new Builder();
      const r = rng(73);
      const oval = (wav, ph) => (t) => 0.5 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.04 + t * 0.96)), 0.8) * (1 - 0.2 * t) * (1 + 0.14 * Math.sin(t * wav * 6.28 + ph));
      const N = 13;
      for (let k = 0; k < N; k++) {
        const age = k / (N - 1);
        const a = k * 2.399 + r() * 0.3;
        const out = 0.22 + age * 0.75, up = 1.0 - age * 0.3;
        const dir = V(Math.cos(a) * out, up, Math.sin(a) * out).normalize();
        const stalk = (1.8 + age * 2.4) * (0.85 + r() * 0.3);
        const p0 = V(Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12), p1 = p0.clone().addScaledVector(dir, stalk);
        b.ribbon([p0, p0.clone().lerp(p1, 0.5), p1], [0.14, 0.11, 0.09], V(-Math.sin(a), 0, Math.cos(a)), { color: 0x5a4a2c });
        const dark = 0.85 + r() * 0.3;
        shapedLeaf(b, { base: p1, dir: V(dir.x, dir.y * 0.7, dir.z), len: (3.6 + age * 2.6) * (0.85 + r() * 0.3), width: 1.3 + age * 0.4 + r() * 0.2, droop: 0.2 + age * 0.25, outline: oval(4 + Math.floor(r() * 3), r() * 6), color: new THREE.Color(0x5a301b).multiplyScalar(dark), tip: new THREE.Color(0x7c4a34).multiplyScalar(dark), rib: 0x3d2416, n: 16, cup: 0.12 });
      }
      return b.build();
    },
    material: { amp: 0.25, underwaterAmp: 1.0, speed: 0.8, rough: 0.85, wax: [0.5, 0.85, 0.5], ...plantMaps('crypt'), leafPale: [0.55, 0.3, 0.2], leafBack: [1.5, 1.55, 1.6] },
  },
  hartstongue: {
    name: "Hart's-tongue fern", habitat: 'land', humidity: [60, 100], light: 0.25, size: 14,
    note: "Asplenium scolopendrium: an evergreen rosette of glossy, undivided, strap-shaped fronds with a heart-shaped base. Cool, damp, shady rock and stream banks of Europe; likes lime.",
    build() {
      const b = new Builder();
      const r = rng(83);
      const tongue = (t) => 0.5 * (t < 0.1 ? 0.55 + t * 3.2 : 1) * Math.pow(Math.sin(Math.PI * Math.min(1, 0.04 + t * 0.96)), 0.35) * (1 - 0.28 * t) * (1 + 0.05 * Math.sin(t * 17));
      const N = 12;
      for (let k = 0; k < N; k++) {
        const age = k / (N - 1);
        const a = k * 2.399 + r() * 0.3;
        const out = 0.3 + age * 0.85, up = 1.0 - age * 0.45;
        const dir = V(Math.cos(a) * out, up, Math.sin(a) * out).normalize();
        const p0 = V(Math.cos(a) * 0.15, 0, Math.sin(a) * 0.15), p1 = p0.clone().addScaledVector(dir, 1.2 + age * 1.2);
        b.ribbon([p0, p1], [0.2, 0.15], V(-Math.sin(a), 0, Math.cos(a)), { color: 0x4a3a1c });
        const g = 0.85 + r() * 0.3;
        shapedLeaf(b, { base: p1, dir, len: (6 + age * 5.5) * (0.85 + r() * 0.3), width: 1.5 + age * 0.5 + r() * 0.2, droop: 0.15 + age * 0.45, outline: hartstongueEnv, color: new THREE.Color(0x2f4c0a).multiplyScalar(g), tip: new THREE.Color(0x6b9622).multiplyScalar(g), rib: 0xb8cf7a, n: 16, cup: 0.12 });
      }
      return b.build();
    },
    // Textured fronds (S3 pilot): painted maps in public/assets/plants (art-src/plants/hartstongue_bake.py): leaf (veins, pale midrib, sori on the
    // underside, true outline as alpha), relief (midrib groove, vein ridges), tint (the owner's reference leaf, resampled), waxy gloss.
    material: { amp: 0.18, speed: 0.7, rough: 0.8, wax: [0.36, 0.82, 0.42], leafMap: plantLeafMap('hartstongue', 'leaf'), leafHue: plantLeafMap('hartstongue', 'tint'), leafRelief: plantLeafMap('hartstongue', 'relief'),
      leafPale: [0.62, 0.78, 0.42], leafBack: [1.0, 0.9, 0.72] },
  },
  miscanthus: {
    name: 'Silvergrass', habitat: 'land|emergent', humidity: [30, 100], light: 0.7, size: 16,
    note: 'Miscanthus sinensis: a tall clump of arching, white-midribbed blades with silver plumes. Sunny stream banks and slopes of China, Taiwan and Japan.',
    build() {
      const b = new Builder();
      const r = rng(97);
      for (let k = 0; k < 34; k++) {
        const a = r() * Math.PI * 2, rad = r() * 0.9, tall = r();
        blade(b, { dir: V(Math.cos(a) * (0.35 + 0.5 * r()), 1, Math.sin(a) * (0.35 + 0.5 * r())), len: 10 + tall * 7, width: 0.6 + r() * 0.25, droop: 0.6 + r() * 0.5, segs: 6, color: new THREE.Color(0x5a4a1c).multiplyScalar(0.8 + r() * 0.3), tip: 0x97855e, base: V(Math.cos(a) * rad, 0, Math.sin(a) * rad), twist: (r() - 0.5) * 0.8 });
      }
      // Plumes: a thin stem and a fan of silver, feathery spikelets.
      for (let k = 0; k < 5; k++) {
        const a = r() * Math.PI * 2, rad = 0.2 + r() * 0.6, h = 17 + r() * 4;
        const x = Math.cos(a) * rad, z = Math.sin(a) * rad, lean = V((r() - 0.5) * 6, 0, (r() - 0.5) * 6);
        const top = V(x + lean.x, h, z + lean.z), mid = V(x + lean.x * 0.4, h * 0.55, z + lean.z * 0.4);
        b.ribbon([V(x, 0, z), mid, top], [0.14, 0.1, 0.07], V(1, 0, 0), { color: 0x9a9a58 });
        b.ribbon([V(x, 0, z), mid, top], [0.14, 0.1, 0.07], V(0, 0, 1), { color: 0x9a9a58 });
        for (let q = 0; q < 8; q++) {
          const qa = (q / 8) * Math.PI * 2, sp = 0.5 + r() * 0.5;
          const tip = top.clone().add(V(Math.cos(qa) * sp, 2.4 + r() * 1.0, Math.sin(qa) * sp));
          const pale = new THREE.Color(0xc9c0a4).multiplyScalar(0.85 + r() * 0.2);
          b.ribbon([top.clone(), top.clone().lerp(tip, 0.55).add(V(0, 0.2, 0)), tip], [0.2, 0.17, 0.05], V(Math.cos(qa + 1.57), 0, Math.sin(qa + 1.57)), { color: pale });
        }
      }
      return b.build();
    },
    material: { amp: 0.4, speed: 0.9 },
  },
  heliconia: {
    name: 'Lobster-claw', habitat: 'land', humidity: [60, 100], light: 0.5, size: 22,
    note: 'Heliconia rostrata: banana-like paddle leaves and hanging chains of boat-shaped red bracts tipped yellow and green. Rainforest margins and clearings; needs warm, humid air.',
    build() {
      const b = new Builder();
      const r = rng(103);
      const paddle = (t) => 0.5 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.03 + t * 0.97)), 0.6) * (1 - 0.18 * t);
      for (let s = 0; s < 4; s++) {
        const a0 = s * 1.7 + r(), cx = Math.cos(a0) * 0.9, cz = Math.sin(a0) * 0.9, hh = 9 + r() * 4;
        b.ribbon([V(cx, 0, cz), V(cx, hh * 0.5, cz), V(cx, hh, cz)], [0.34, 0.26, 0.2], V(1, 0, 0), { color: 0x8a9a3e });
        b.ribbon([V(cx, 0, cz), V(cx, hh * 0.5, cz), V(cx, hh, cz)], [0.34, 0.26, 0.2], V(0, 0, 1), { color: 0x7a8a36 });
        for (let k = 0; k < 4; k++) {
          const a = a0 + k * 1.57 + r() * 0.4, dir = V(Math.cos(a) * 0.8, 0.55 + r() * 0.3, Math.sin(a) * 0.8).normalize();
          const g = 0.85 + r() * 0.25, h = (hh * (0.55 + k * 0.1));
          shapedLeaf(b, { base: V(cx, Math.min(h, hh), cz), dir, len: 6.5 + r() * 2.5, width: 2.6 + r() * 0.6, droop: 0.35 + r() * 0.25, outline: paddle, color: new THREE.Color(0x2c3618).multiplyScalar(g * 1.3), tip: new THREE.Color(0x686e31).multiplyScalar(g), rib: 0xb8c868, n: 14, cup: 0.12 });
        }
      }
      // One inflorescence: a zig-zag chain of boat-shaped bracts (red, yellow tip) hanging from a stalk.
      const top = V(0.4, 15, 0.2), n = 6;
      b.ribbon([V(0.3, 9, 0.2), V(0.5, 13, 0.3), top], [0.12, 0.1, 0.08], V(1, 0, 0), { color: 0xe0306a });
      for (let k = 0; k < n; k++) {
        const f = k / (n - 1), side = k % 2 ? 1 : -1, y = 14.6 - k * 1.4;
        const bract = (t) => 0.5 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.05 + t * 0.9)), 0.8) * (1 - 0.1 * t);
        shapedLeaf(b, { base: V(0.4 + side * 0.15 + f * 0.9, y, 0.2 + f * 0.4), dir: V(side * 0.9, -0.3, 0.2), len: 2.8 - f * 0.5, width: 1.2 - f * 0.2, droop: 0.4, outline: bract, color: 0xe0206a, tip: k % 2 ? 0xa8b040 : 0xc8a830, rib: 0xb41139, n: 10, cup: 0.4 });
      }
      return b.build();
    },
    material: { amp: 0.25, speed: 0.8 },
  },
  aponogeton: {
    name: 'Lace plant', habitat: 'aquatic', light: 0.35, nutrients: 0.7, size: 10,
    note: 'Aponogeton madagascariensis: leaves that are nearly all open lattice, like green lace. Clear, flowing, soft water of Madagascar; a rest period in winter.',
    build() {
      const b = new Builder();
      const r = rng(113);
      const blade2 = (t) => 0.5 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.05 + t * 0.95)), 0.7) * (1 - 0.1 * t);
      const N = 8;
      for (let k = 0; k < N; k++) {
        const age = k / (N - 1), a = k * 2.399 + r() * 0.3;
        const dir = V(Math.cos(a) * (0.3 + age * 0.7), 1 - age * 0.3, Math.sin(a) * (0.3 + age * 0.7)).normalize();
        const stalk = 2 + age * 2.2, p0 = V(Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1), p1 = p0.clone().addScaledVector(dir, stalk);
        b.ribbon([p0, p1], [0.12, 0.09], V(-Math.sin(a), 0, Math.cos(a)), { color: 0x327654 });
        const holes = [];
        for (let i = 0; i < 8; i++) for (let j = -2; j <= 2; j++) holes.push([0.16 + i * 0.095 + (j % 2 ? 0.04 : 0), j * 0.17, 0.065, 0.1]);
        const g = 0.85 + r() * 0.3;
        shapedLeaf(b, { base: p1, dir: V(dir.x, dir.y * 0.5, dir.z), len: 5 + age * 3.5, width: 1.7 + r() * 0.3, droop: 0.18 + age * 0.2, outline: blade2, color: new THREE.Color(0x1f5d39).multiplyScalar(g), tip: new THREE.Color(0x4a9a80).multiplyScalar(g), rib: 0x5dac9a, n: 14, cup: 0.05 });
      }
      return b.build();
    },
    // the lace is the leaf map's alpha (a lattice of bars; art-src/plants/leafbake.py aponogeton), not geometry holes
    material: { amp: 0.3, underwaterAmp: 1.2, speed: 0.8, rough: 0.7, ...plantMaps('aponogeton'), leafPale: [0.4, 0.62, 0.5], leafBack: [1.0, 1.0, 1.0] },
  },
  pandanus: {
    name: 'Screw pine', habitat: 'land', humidity: [50, 100], light: 0.6, size: 20,
    note: 'Pandanus (Madagascar screw pine): a spiral of long, stiff, saw-edged blades on a short trunk held up by prop roots. Coasts, river banks and humid forest; likes sun and warmth.',
    build() {
      const b = new Builder();
      const r = rng(127);
      b.ribbon([V(0, 0, 0), V(0, 3, 0), V(0, 6.4, 0)], [0.7, 0.55, 0.45], V(1, 0, 0), { color: 0x6a5a38 });
      b.ribbon([V(0, 0, 0), V(0, 3, 0), V(0, 6.4, 0)], [0.7, 0.55, 0.45], V(0, 0, 1), { color: 0x5e4e30 });
      for (let k = 0; k < 6; k++) {
        const a = k * 1.05 + r() * 0.4;
        b.ribbon([V(Math.cos(a) * 0.4, 5, Math.sin(a) * 0.4), V(Math.cos(a) * 1.8, 2.4, Math.sin(a) * 1.8), V(Math.cos(a) * 2.6, 0, Math.sin(a) * 2.6)], [0.18, 0.14, 0.1], V(-Math.sin(a), 0, Math.cos(a)), { color: 0x8a7a64, sway: () => 0 });
      }
      for (let k = 0; k < 26; k++) {
        const age = k / 25, a = k * 2.399, up = 1.2 - age * 1.0;
        blade(b, { dir: V(Math.cos(a), up, Math.sin(a)), len: 8 + (1 - age) * 3 + r() * 2, width: 0.55 + r() * 0.15, droop: 0.5 + age * 0.9, segs: 6, color: new THREE.Color(0x283511).multiplyScalar(1.4 + r() * 0.4), tip: 0x9ba87f, base: V(0, 6.2 + (1 - age) * 0.4, 0), twist: 0.6 });
      }
      return b.build();
    },
    material: { amp: 0.2, speed: 0.8 },
  },
  limnobium: {
    name: 'Spongeplant', habitat: 'floating', light: 0.5, nutrients: 0.8, size: 4,
    note: 'Limnobium spongia: a floating rosette of heart-shaped leaves with a spongy, air-filled underside and long dangling roots. Still and slow water of the Everglades and the south-east United States.',
    build() {
      const b = new Builder();
      const r = rng(131);
      for (let k = 0; k < 6; k++) {
        const a = r() * Math.PI * 2, rr = 0.3 + r() * 2.4, s = 1.1 + r() * 0.6;
        b.add(new THREE.CircleGeometry(1, 20), { p: [Math.cos(a) * rr, 0.07 + r() * 0.03, Math.sin(a) * rr], r: [-Math.PI / 2 + (r() - 0.5) * 0.7, (r() - 0.5) * 0.7, r() * 6], s: [s, s * 1.05, 1], color: r() > 0.5 ? 0x689513 : 0x9bc31f, sway: 0.4, j: 0.1,
          leaf: (lv) => [Math.atan2(lv.y, lv.x) / Math.PI * 0.7, Math.min(1, Math.hypot(lv.x, lv.y))] });
        b.ribbon([V(Math.cos(a) * rr, 0, Math.sin(a) * rr), V(Math.cos(a) * rr * 0.9, -3.5 - r() * 3, Math.sin(a) * rr * 0.9)], [0.1, 0.04], V(1, 0, 0), { color: 0xe6dcc0, sway: (t) => t });
      }
      return b.build();
    },
    material: { amp: 0.15, underwaterAmp: 0.4, speed: 0.6, rough: 0.7, wax: [0.32, 0.8, 0.42], ...plantMaps('limnobium'), leafPale: [0.72, 0.84, 0.4], leafBack: [1.25, 1.3, 1.05] },
  },
  sago: {
    name: 'Sago palm', habitat: 'land', humidity: [40, 100], light: 0.6, size: 18,
    note: 'A young cycad (Cycas) with a short woolly trunk and a crown of stiff, glossy, feather-shaped fronds. Slow-growing; coasts and open forest of the Pacific and Asia.',
    build() {
      const b = new Builder();
      const r = rng(139);
      b.ribbon([V(0, 0, 0), V(0, 1.6, 0), V(0, 3.2, 0)], [0.8, 0.7, 0.55], V(1, 0, 0), { color: 0x4a3a22 });
      b.ribbon([V(0, 0, 0), V(0, 1.6, 0), V(0, 3.2, 0)], [0.8, 0.7, 0.55], V(0, 0, 1), { color: 0x4e3c28 });
      const F = 9;
      for (let k = 0; k < F; k++) {
        const age = k / (F - 1), a = k * 2.399 + r() * 0.2, out = V(Math.cos(a), 0, Math.sin(a)), side = V(-Math.sin(a), 0, Math.cos(a));
        const Lr = 8 + (1 - age) * 3, h0 = 3.2, lift = 1.1 - age * 0.7;
        const pt = (t) => out.clone().multiplyScalar(Lr * t * (0.35 + age * 0.65)).add(V(0, h0 + Lr * (lift * t - (0.25 + age * 0.9) * t * t), 0));
        b.ribbon([pt(0), pt(0.5), pt(1)], [0.14, 0.1, 0.05], side, { color: 0x5c5c1e });
        const nL = 14;
        for (let i = 1; i <= nL; i++) {
          const t = 0.08 + (i / nL) * 0.9, p = pt(t), len = 2.6 * Math.sin(Math.PI * Math.min(1, 0.15 + (1 - t) * 0.9)) + 0.4;
          for (const sd of [-1, 1]) {
            const dir = side.clone().multiplyScalar(sd).add(out.clone().multiplyScalar(0.55)).add(V(0, 0.35, 0));
            blade(b, { dir, len, width: 0.2, droop: 0.2, segs: 2, color: new THREE.Color(0x433f13).multiplyScalar(1.1 + r() * 0.3), tip: 0x8f902e, base: p });
          }
        }
      }
      return b.build();
    },
    material: { amp: 0.15, speed: 0.7 },
  },
  tussock: {
    name: 'Bunchgrass', habitat: 'land', humidity: [20, 100], light: 0.8, size: 10,
    note: 'A dense, fountain-shaped tussock of fine golden-green blades (Festuca and Nassella type). Dry, windy, sunny highland slopes and stony ground.',
    build() {
      const b = new Builder();
      const r = rng(149);
      for (let k = 0; k < 90; k++) {
        const a = r() * Math.PI * 2, rad = Math.sqrt(r()) * 0.9, g = 0.8 + r() * 0.35;
        blade(b, { dir: V(Math.cos(a) * (0.3 + r() * 0.5), 1, Math.sin(a) * (0.3 + r() * 0.5)), len: 7 + r() * 6, width: 0.2 + r() * 0.08, droop: 0.9 + r() * 0.8, segs: 5, color: new THREE.Color(0x655529).multiplyScalar(g), tip: new THREE.Color(0xd0b389).multiplyScalar(g), base: V(Math.cos(a) * rad, 0, Math.sin(a) * rad) });
      }
      return b.build();
    },
    material: { amp: 0.4, speed: 1.0 },
  },
  crowfoot: {
    name: 'Water crowfoot', habitat: 'aquatic', light: 0.5, nutrients: 0.6, size: 12,
    note: 'Ranunculus aquatilis: long stems of finely divided, thread-like leaves under the water and small rounded floating leaves with white, yellow-centred flowers at the surface. Clean, cool streams and ponds of Europe.',
    build() {
      const b = new Builder();
      const r = rng(157);
      for (let s = 0; s < 6; s++) {
        const a0 = r() * Math.PI * 2, rr = r() * 0.8, H = 9 + r() * 4, sx = Math.cos(a0) * rr, sz = Math.sin(a0) * rr;
        const lean = V((r() - 0.5) * 3, 0, (r() - 0.5) * 3);
        b.ribbon([V(sx, 0, sz), V(sx + lean.x * 0.5, H * 0.5, sz + lean.z * 0.5), V(sx + lean.x, H, sz + lean.z)], [0.1, 0.08, 0.06], V(1, 0, 0), { color: 0x7a8a4a });
        // Whorls of thread-like leaves: each leaf forks into thin hair-ribbons.
        for (let k = 1; k < 8; k++) {
          const t = k / 8, p = V(sx + lean.x * t, H * t, sz + lean.z * t);
          for (let f = 0; f < 3; f++) {
            const a = a0 + k * 1.3 + f * 2.1, base = p.clone();
            for (let h = 0; h < 4; h++) {
              const ha = a + (h - 1.5) * 0.35, tip = base.clone().add(V(Math.cos(ha) * (1.6 + r() * 0.8), 0.4 + r() * 0.5 - t * 0.2, Math.sin(ha) * (1.6 + r() * 0.8)));
              b.ribbon([base, base.clone().lerp(tip, 0.55).add(V(0, 0.15, 0)), tip], [0.07, 0.05, 0.02], V(-Math.sin(ha), 0, Math.cos(ha)), { color: new THREE.Color(0x4a6a24).multiplyScalar(0.8 + r() * 0.3) });
            }
          }
        }
        // Floating leaves and flowers at the top.
        const top = V(sx + lean.x, H, sz + lean.z), lf = (lv) => [Math.atan2(lv.y, lv.x) / Math.PI * 0.7, Math.min(1, Math.hypot(lv.x, lv.y))];
        for (let k = 0; k < 3; k++) {
          const a = r() * Math.PI * 2, d = 0.5 + r() * 0.9;
          b.add(new THREE.CircleGeometry(1, 14), { p: [top.x + Math.cos(a) * d, top.y + 0.05, top.z + Math.sin(a) * d], r: [-Math.PI / 2, 0, r() * 6], s: [0.6 + r() * 0.2, 0.55, 1], color: 0x5a9e3c, sway: 0.3, j: 0.1, leaf: lf });
        }
        if (s < 4) {
          b.add(new THREE.CircleGeometry(1, 12), { p: [top.x + 0.2, top.y + 0.1, top.z + 0.1], r: [-Math.PI / 2, 0, 0], s: [0.55, 0.55, 1], color: 0xf4f4f6, sway: 0.3, j: 0.05, leaf: lf });
          b.add(new THREE.CircleGeometry(1, 8), { p: [top.x + 0.2, top.y + 0.13, top.z + 0.1], r: [-Math.PI / 2, 0, 0], s: [0.16, 0.16, 1], color: 0xd8d030, sway: 0.3, j: 0.05, leaf: lf });
        }
      }
      return b.build();
    },
    material: { amp: 0.3, underwaterAmp: 1.1, speed: 0.8 },
  },
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
    material: { amp: 0.12, underwaterAmp: 0.6, speed: 0.6, veins: { kind: 'pinnate', n: 11, slope: 0.9, rib: 0.07 } },
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
    material: { amp: 0.25, speed: 0.6, veins: { kind: 'pinnate', n: 6, slope: 1.1, rib: 0.06 } },
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
        b.add(new THREE.CircleGeometry(1, 20), { p: [Math.cos(a) * rr, 0.05 + r() * 0.03, Math.sin(a) * rr], r: [-Math.PI / 2, 0, 0], s: [s, s * 0.9, 1], color: r() > 0.5 ? 0x4f9a36 : 0x3f8a2c, sway: 0.4, jitter: 0.2,
          leaf: (lv) => [Math.atan2(lv.y, lv.x) / Math.PI * 0.7, Math.min(1, Math.hypot(lv.x, lv.y))] });
        // Dangling roots.
        b.ribbon([V(Math.cos(a) * rr, 0, Math.sin(a) * rr), V(Math.cos(a) * rr, -2.5 - r() * 2, Math.sin(a) * rr)], [0.12, 0.05], V(1, 0, 0), { color: 0xcfc6a8, sway: (t) => t });
      }
      return b.build();
    },
    material: { amp: 0.15, underwaterAmp: 0.4, speed: 0.6, veins: { kind: 'parallel', n: 30, rib: 0.004, k: 0.5 } },
  },
  lily: {
    name: 'Water lily', habitat: 'floating', light: 0.7, nutrients: 1, size: 7,
    note: 'Pads with a flower. Needs space on the surface.',
    build() {
      const b = new Builder();
      const r = rng(31);
      // Pads: round with the notch cut to the stalk, radial veins (plantMaterial, 'parallel' veins on an angle coordinate), the
      // rim a little turned up and reddish underneath at the edge; a younger, paler pad or two.
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + r(), rr = 2.2 + r() * 1.4, sc = 1.7 + r() * 0.8, young = k === 4;
        const pad = new THREE.CircleGeometry(1, 40, 0.22, Math.PI * 2 - 0.44);
        const pp = pad.attributes.position;
        for (let i = 0; i < pp.count; i++) { const x = pp.getX(i), y = pp.getY(i), d = Math.hypot(x, y); pp.setZ(i, Math.pow(d, 6) * 0.08); }
        const c0 = new THREE.Color(young ? 0x4a7a26 : 0x22521c), c1 = new THREE.Color(young ? 0x648a30 : 0x306624), rim = new THREE.Color(0x6a3a2a);
        b.add(pad, {
          p: [Math.cos(a) * rr, 0.05, Math.sin(a) * rr], r: [-Math.PI / 2, 0, r() * 6], s: [sc, sc, sc], sway: 0.5, jitter: 0.1,
          color: (lv) => { const d = Math.hypot(lv.x, lv.y); return c0.clone().lerp(c1, d).lerp(rim, Math.max(0, d - 0.93) * 6); },
          leaf: (lv) => [Math.atan2(lv.y, lv.x) / Math.PI * 0.7, Math.min(1, Math.hypot(lv.x, lv.y))],
        });
      }
      return b.build();
    },
    material: { amp: 0.1, underwaterAmp: 0.2, speed: 0.5, veins: { kind: 'parallel', n: 44, rib: 0.004, k: 0.6 } },
    // Nymphaea: four sepals, three whorls of pointed, cupped petals, a boss of golden petal-like stamens round the stigma. Each
    // flower lasts about three days, opening in the morning and shutting in the afternoon, then sinks; a well-lit plant sends up
    // the next bud every week or two. Mask colours: r main petal, g accent (sepals, tips), b centre (sim/bloom.js, render/flowers.js).
    flower: {
      build(b) {
        const M = (r, g, bl) => new THREE.Color(r, g, bl);
        const petal = (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.97 + 0.03)), 0.7) * (1 - 0.2 * t);
        const whorl = (n, a0, elev, len, width, base, tip, cup) => {
          for (let k = 0; k < n; k++) {
            const a = a0 + (k / n) * Math.PI * 2, ce = Math.cos(elev);
            shapedLeaf(b, { base: V(Math.cos(a) * 0.14, 0.04, Math.sin(a) * 0.14), dir: V(Math.cos(a) * ce, Math.sin(elev), Math.sin(a) * ce), len, width, droop: -0.12, outline: petal, color: base, tip, n: 9, cup });
          }
        };
        whorl(4, 0.4, 0.12, 1.75, 0.36, M(0.15, 0.85, 0), M(0.55, 0.45, 0), 0.25);          // sepals
        whorl(8, 0, 0.32, 1.7, 0.3, M(0.8, 0.1, 0.1), M(0.55, 0.45, 0), 0.35);               // outer petals, tips flushed
        whorl(8, 0.39, 0.62, 1.45, 0.27, M(0.85, 0, 0.15), M(0.75, 0.25, 0), 0.4);
        whorl(6, 0.2, 0.92, 1.1, 0.22, M(0.85, 0, 0.15), M(0.9, 0.1, 0), 0.45);
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2 + (k % 2) * 0.2, e = 1.05 + (k % 2) * 0.2;
          blade(b, { base: V(Math.cos(a) * 0.1, 0.06, Math.sin(a) * 0.1), dir: V(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)), len: 0.5, width: 0.09, droop: -0.2, segs: 2, color: M(0.05, 0, 0.95), tip: M(0.15, 0, 0.85) });
        }
        b.add(PRIM.sphereLo, { p: [0, 0.1, 0], s: [0.17, 0.07, 0.17], color: M(0, 0.15, 0.85) });   // the stigma's disc
      },
      palettes: [
        [0xf2bfd2, 0xd65a88, 0xf1bd3a],   // pink
        [0xf6f3ec, 0xd8e0c2, 0xf2c53d],   // white
        [0xd3304a, 0x9a1d36, 0xefb03a],   // red
        [0xf4e07c, 0xd9c35a, 0xe9a92a],   // yellow (N. mexicana)
        [0xb4b8ef, 0x7a80d4, 0xf2c64a],   // blue (a tropical lily)
      ],
      heads: () => [[0, 0.3, 0, 0, 1, 0, 1]],
      translucent: 0.6,
      daily: 'day',
      cycle: { budDays: 5, openDays: 3, fadeDays: 2, restDays: 8, season: 'any', minLight: 0.6, minHumidity: 0 },
      after: 'seed',
    },
  },
  ...FLOWERING,
};

// How plants spread once grown: [chance per day, reach in cm, most plants of that kind].
const SPREAD = {
  weed: [0.15, 5, 30], grass: [0.08, 4, 30], fernph: [0.03, 8, 16], fern: [0.03, 7, 14], bilberry: [0.02, 6, 8],
  pothos: [0.08, 6, 20], bromeliad: [0.02, 6, 10], cattail: [0.04, 5, 10], bamboo: [0.03, 6, 8],
  crowfoot: [0.1, 4, 24], heliconia: [0.02, 6, 6], aponogeton: [0.04, 4, 12], pandanus: [0.01, 5, 4], limnobium: [0.3, 5, 40], sago: [0.005, 6, 3], tussock: [0.03, 5, 14],
  nidus: [0.01, 4, 6], crypt: [0.08, 4, 30], hartstongue: [0.015, 5, 8], miscanthus: [0.03, 6, 10],
  vallisneria: [0.12, 5, 40], sword: [0.02, 8, 6], javafern: [0.05, 4, 16], frogbit: [0.35, 5, 40], lily: [0.03, 9, 6],
  anubias: [0.02, 4, 10], javamoss: [0.12, 4, 40], monstera: [0.04, 8, 10], fissidens: [0.05, 3, 30], rotala: [0.1, 4, 24],
  // flowering plants: bromeliads pup, the sinningia seeds itself, orchids are divided slowly
  neoregelia: [0.03, 5, 12], guzmania: [0.015, 6, 6], tillandsia: [0.02, 4, 12], masdevallia: [0.01, 4, 6], dracula: [0.01, 4, 6],
  pleurothallis: [0.015, 4, 8], lepanthes: [0.01, 3, 8], cuthbertsonii: [0.01, 3, 6], sinningia: [0.08, 4, 20], columnea: [0.02, 6, 6], begonia: [0.03, 5, 10],
};

// Aquatic and emergent plants lean in the water's push (B5b: util/plantbend.js, render/airflow.js plantFlow). They carry two
// per-instance attributes: `flow` (the flow at the plant, cm/s, in the plant's own axes: the last sample's xz, then the new one's)
// and `flowDepth` (the water over its base, in its own units). `bend`: how far a leaf tip goes at full lean, in the plant's own units
// (a scanned plant is 1 across); `stiffness`: 1 an average leaf, more is stiffer (by default from how much it sways: underwaterAmp).
function flowOptions(sp) {
  if (!/aquatic|emergent/.test(sp.habitat)) return {};
  const m = sp.material ?? {};
  return { flowBend: true, bend: m.bend ?? (sp.model ? 0.4 : Math.max(2, (sp.size ?? 6) * 0.4)), stiffness: m.stiffness ?? clamp(2.2 / (m.underwaterAmp ?? 2.2), 0.4, 4) };
}

export class Plants {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.meshes = {};
    this.variants = {};
    this.ready = null;   // the lazy model plants' load (preloadMore)
    this.cap = 300;
    // Flowers (sim/bloom.js, render/flowers.js): a mesh per flowering species, made with its first head; species whose heads
    // changed are redrawn at the end of a step (or at once outside one). `live`: stepped by a running tank (portraits never are,
    // so their flowers stay open whatever the hour).
    this.flowers = {};
    this.flowerSrc = {};
    this._dirty = new Set();
    this._stepping = false;
    this.live = false;
    // Procedural species are built when first used (the first plant of that species, a portrait): a tank pays the mesh,
    // the material and its shader build only for the species it grows. Reading this.meshes[id] builds it.
    for (const [id, sp] of Object.entries(PLANTS)) {
      if (sp.model) continue; // built in preload()
      this.variants[id] = 1;
      Object.defineProperty(this.meshes, id, { configurable: true, enumerable: false, get: () => {
        delete this.meshes[id];
        const geo = sp.build();
        this.addMesh(id, geo, plantMaterial({ ...(sp.material ?? {}), map: sp.map ? sp.map() : null, leafVeins: !!geo.attributes.leaf, ...flowOptions(sp) }));
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
    if (mat.userData.flowBend) {
      for (const [k, n] of [['flow', 4], ['flowDepth', 1]]) {
        const a = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * n), n);
        a.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute(k, a);
      }
    }
    this.scene.add(im);
    this.meshes[key] = im;
  }

  // Photoscanned plants: each mesh in the model becomes a variant, recentred
  // with its base at the origin and scaled to 1 across.
  async preload() {
    for (const [id, sp] of Object.entries(PLANTS)) {
      if (!sp.model || sp.lazy) continue;
      await this.loadModelPlant(id, sp);
    }
  }

  // The lazy model plants (PLANTS `lazy`), one at a time with a pause between them. Never rejects (a plant whose model fails to load
  // has no variants and is skipped); `ready` resolves when all are in: Game.buildTank awaits it before a real game's tank.
  preloadMore() {
    if (this.ready) return this.ready;
    const pause = () => new Promise((r) => setTimeout(r, 30));
    this.ready = (async () => {
      for (const [id, sp] of Object.entries(PLANTS)) {
        if (!sp.model || !sp.lazy) continue;
        try { await this.loadModelPlant(id, sp); } catch (e) { console.warn('plant model', id, e); }
        await pause();
      }
    })();
    return this.ready;
  }

  async loadModelPlant(id, sp) {
    const parts = [];
    for (const name of [].concat(sp.model)) parts.push(...await modelParts(name));
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
      this.addMesh(id + '#' + k, g, plantMaterial({ ...(sp.material ?? {}), map: src.map, normalMap: src.normalMap, ...flowOptions(sp) }));
    });
    this.variants[id] = parts.length;
  }

  key(p) { return this.variants[p.id] > 1 || PLANTS[p.id].model ? p.id + '#' + (p.variant ?? 0) : p.id; }
  // A plant's flow slot (B5b): zeroed for a new plant, copied to the plant that takes a freed slot.
  moveFlow(im, from, to) {
    const f = im.geometry.attributes.flow, d = im.geometry.attributes.flowDepth;
    if (!f) return;
    for (let k = 0; k < 4; k++) f.array[to * 4 + k] = from < 0 ? 0 : f.array[from * 4 + k];
    d.array[to] = from < 0 ? 0 : d.array[from];
    f.needsUpdate = d.needsUpdate = true;
  }

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

  add(id, pos, { normal = null, scale = null, rot = null, grown = 0.35, surface = 'terrain', health = 1, variant = null, bloom = null } = {}) {
    const nv = this.variants[id] ?? 1;
    const v = variant ?? Math.floor(Math.random() * nv);
    const im = this.meshes[PLANTS[id].model ? id + '#' + v : id];
    if (!im || im.count >= this.cap) return null;
    const scaleV = scale ?? 0.8 + Math.random() * 0.4;
    // The canopy (at full size) must stay inside the glass: keep the stem clear of the walls.
    const reach = this.reachOf(im, id, scaleV);
    pos = pos.clone();
    const fit = plantFit(pos.x, pos.z, reach, TANK, { clampZ: surface !== 'wall' });
    const onGround = surface === 'terrain' && PLANTS[id].habitat !== 'floating' && this.world;
    if (fit.x !== pos.x || fit.z !== pos.z) {
      pos.x = fit.x; pos.z = fit.z;
      if (onGround) pos.y = this.seatY(pos.x, pos.z);
    } else if (onGround && Math.abs(pos.y - this.world.terrain.heightAt(pos.x, pos.z)) < 0.05) pos.y = this.seatY(pos.x, pos.z);   // (set on the stamped height)
    const p = {
      id, pos, reach, normal: normal ? normal.clone() : new THREE.Vector3(0, 1, 0), surface,
      rot: rot ?? Math.random() * Math.PI * 2, scale: scaleV,
      grown, health, age: 0, index: im.count, variant: v,
    };
    const F = PLANTS[id].flower;
    if (F) p.bloom = unpackBloom(bloom, F) ?? newBloom(F, grown);
    im.count++;
    this.moveFlow(im, -1, p.index);
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
      this.moveFlow(im, last.index, p.index);
      last.index = p.index;
      this.writeInstance(last);
    }
    im.count--;
    this.list.splice(this.list.indexOf(p), 1);
    im.instanceMatrix.needsUpdate = true;
    if (p.bloom) this.flowerDirty(p.id);
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
    // `wallSpin` (optional, radians): on a wall the random turn stays within +-wallSpin, so the body's local +Z keeps pointing
    // down the wall (leaves that must hang, the orchids); missing = the full random turn as before.
    const spin = p.surface === 'wall' ? PLANTS[p.id].wallSpin : undefined;
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spin == null ? p.rot : ((((p.rot / (Math.PI * 2)) % 1) + 1) % 1 - 0.5) * 2 * spin));
    // Near a wall the plant leans inward so its canopy stays inside the glass.
    if (p.reach && PLANTS[p.id].habitat !== 'floating') {
      const f = plantFit(p.pos.x, p.pos.z, p.reach * (0.3 + 0.7 * p.grown), TANK, { clampZ: p.surface !== 'wall' });
      if (f.lean > 0.01) q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(f.dz, 0, -f.dx), f.lean));
    }
    const s = p.scale * (0.3 + 0.7 * p.grown) * (PLANTS[p.id].modelSize ?? 1);
    p._q = q; p._s = s;     // (the flower heads follow the plant)
    const m = new THREE.Matrix4().compose(p.pos, q, new THREE.Vector3(s, s, s));
    im.setMatrixAt(p.index, m);
    // Healthy plants are green; dying ones yellow and brown.
    const c = new THREE.Color(1, 1, 1).lerp(new THREE.Color(0.85, 0.6, 0.3), clamp(1 - p.health, 0, 1));
    im.setColorAt(p.index, c);
    im.instanceMatrix.needsUpdate = true;
    im.instanceColor.needsUpdate = true;
    if (p.bloom) this.flowerDirty(p.id);
  }

  // The plant whose base a new plant of species `id` at `point` would stand in, or null. Two plants may brush leaves, but a stem
  // inside another plant's crown reads as two models pushed into each other. Plants on the water, on the background and in
  // the ground only meet their own layer; `skip` is a plant to ignore (the parent of an offshoot is not, it is a neighbour).
  // What a plant on the ground stands on at (x, z): the ground as it is drawn (terrain.js `hv`), or the top of a piece under it. The
  // stamped height `h` is that wherever the drawn ground rises with a stamp, but at the rim of a stone's footprint the drawn ground
  // stays low and `h` runs straight from the stone's top to the ground beside it: a grass there stood 2 cm up in the air.
  seatY(x, z) {
    const W = this.world, T = W?.terrain;
    if (!T) return 0;
    const f = T.field, h = T.heightAt(x, z), hv = f.hv ? f.sample(x, z, f.hv) : h;
    if (h - hv < 0.05) return h;
    let y = hv;
    _seatRay.set(_seatO.set(x, h + 2, z), _seatD);
    for (const pc of W.decor?.pieces ?? []) {
      if (!pc.stamp || !pc.mesh) continue;
      const hit = _seatRay.intersectObject(pc.mesh, false)[0];
      if (hit && hit.point.y > y) y = hit.point.y;
    }
    return y;
  }

  crowdingAt(id, point, { scale = 1, surface = 'terrain', skip = null } = {}) {
    const layer = (pid, surf) => (surf === 'wall' ? 'wall' : PLANTS[pid].habitat === 'floating' ? 'float' : 'ground');
    const mine = layer(id, surface);
    const im = this.meshes[PLANTS[id].model ? id + '#0' : id];
    const r = im ? this.reachOf(im, id, scale) : 3;
    for (const q of this.list) {
      if (q === skip || layer(q.id, q.surface) !== mine) continue;
      const d = mine === 'wall' ? Math.hypot(q.pos.x - point.x, q.pos.y - point.y) : Math.hypot(q.pos.x - point.x, q.pos.z - point.z);
      // A clump of one kind may stand closer. A scanned plant has its own `room` (the share of the two reaches kept clear, whatever the
      // other plant is; the larger of the two counts): its leaves are big and many, and closer the leaves of neighbours interpenetrate and
      // floating pads lie on each other (coplanar, they flicker).
      const room = Math.max(PLANTS[id].room ?? 0, PLANTS[q.id].room ?? 0) || (q.id === id ? PLANT_ROOM * 0.55 : PLANT_ROOM);
      if (d < room * (r + q.reach)) return q;
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
    // Day flowers open after the lamp comes on and shut before it goes off; night flowers the other way round (render/flowers.js).
    FLOWER.day.value = dayOpen(env.minute % 1440, env);
    if (!this.live) { this.live = true; for (const q of this.list) if (q.bloom) this._dirty.add(q.id); }
    this._stepping = true;
    for (const p of [...this.list]) {
      const sp = PLANTS[p.id];
      p.age += dtMin;
      p.why = [];
      let ok = 1, boost = 0, hum = null;
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
        hum = C.humidityAt(p.pos.x, p.pos.y, p.pos.z);
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
      if (sp.flower) this.bloomStep(p, sp, env, world, days, { light: lightHere / 0.55, humidity: hum }, out);
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
    this._stepping = false;
    this.flushFlowers();
    return out;
  }

  // --- Flowers ---------------------------------------------------------------------------------------------------------
  // One plant's bloom cycle (sim/bloom.js) from its light at its spot (on the scale of a species' light need), the air at it
  // (land and wall plants), its health and size and the tank's season. Petals that drop become litter (or detritus in water);
  // a finished bloom may leave a keiki, a pup or a seedling (AFTER).
  bloomStep(p, sp, env, world, days, c, out) {
    const F = sp.flower;
    const b = p.bloom ??= newBloom(F, p.grown);
    const ev = stepBloom(b, cycleOf(F), { ...c, season: env.season, health: p.health, grown: p.grown }, days);
    if (ev === 'drop' || ev === 'blast') {
      const k = (ev === 'drop' ? 0.04 : 0.01) * this.headsOf(p).length;
      if (sp.habitat === 'floating' || sp.habitat === 'aquatic') env.detritus = (env.detritus ?? 0) + k;
      else world.humus?.drop(p.pos.x, p.pos.z, k);
      if (ev === 'drop') this.afterBloom(p, sp, world, out);
    }
    const look = bloomLook(b), was = p._look;
    if (ev || !was || Math.abs(look.open - was.open) > 0.01 || Math.abs(look.scale - was.scale) > 0.01 || Math.abs(look.fade - was.fade) > 0.01
      || Math.abs(look.petals - was.petals) > 0.01 || Math.abs(look.green - was.green) > 0.02) {
      p._look = look;
      this.flowerDirty(p.id);
    }
  }

  afterBloom(p, sp, world, out) {
    const kind = sp.flower.after, a = AFTER[kind];
    if (!a || Math.random() >= a.chance) return;
    const child = this.offshoot(p, [0, a.reach, SPREAD[p.id]?.[2] ?? 8], world, a.grown);
    if (child) { child.from = kind; out.born.push(child); }
    // a fallen berry is fruit for the fruit flies (sim/flylife.js)
    if (kind === 'berry' && world.flies && sp.habitat !== 'floating') world.flies.addFruit(p.pos.x, p.pos.z, 0.25);
  }

  flowerDirty(id) {
    this._dirty.add(id);
    if (!this._stepping) this.flushFlowers();
  }

  flushFlowers() {
    for (const id of this._dirty) this.drawFlowers(id);
    this._dirty.clear();
  }

  // Where plant p's heads sit (plant-local, before its instance transform; species flower.heads) and how much the stalk under
  // each sways (the nearest vertex of the plant's own mesh): kept until the plant has grown a little more.
  headsOf(p) {
    const c = p._heads;
    if (c && Math.abs(c.g - p.grown) < 0.03) return c.list;
    const F = PLANTS[p.id].flower, r = rng(1 + Math.floor((p.bloom?.j ?? 0.5) * 1e6));
    const raw = F.heads ? F.heads(r, p.grown) : [[0, 0, 0, 0, 1, 0, 1]];
    const g = this.meshes[this.key(p)]?.geometry, pa = g?.attributes.position, sa = g?.attributes.sway;
    const UP = V(0, 1, 0);
    const list = raw.map(([x, y, z, dx = 0, dy = 1, dz = 0, s = 1]) => {
      const local = V(x, y, z);
      let sw = 0;
      if (pa && sa) {
        let best = Infinity;
        for (let i = 0; i < pa.count; i++) {
          const d = (pa.getX(i) - x) ** 2 + (pa.getY(i) - y) ** 2 + (pa.getZ(i) - z) ** 2;
          if (d < best) { best = d; sw = sa.getX(i); }
        }
      }
      // Head frame as flowering.js headMatrix: +Y the facing, +Z (the dorsal sepal of a bilateral flower) as near plant-local
      // up as the facing allows; only a head that faces straight up (no top) gets a random turn about its axis.
      const spin = r() * Math.PI * 2, dir = V(dx, dy, dz).normalize();
      const q = new THREE.Quaternion().setFromRotationMatrix(headMatrix([0, 0, 0, dir.x, dir.y, dir.z, 1]));
      if (Math.abs(dir.y) > 0.95) q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, spin));
      return { local, q, s, sw };
    });
    p._heads = { g: p.grown, list };
    return list;
  }

  drawFlowers(id) {
    const OPEN = { stage: 'open', t: 0.5 };
    const sp = PLANTS[id], F = sp.flower;
    if (!F) return;
    const show = this.list.filter((p) => p.id === id && p.bloom && p._q && bloomLook(p.bloom).show);
    let fm = this.flowers[id];
    if (!fm && !show.length) return;
    let need = 0;
    for (const p of show) need += this.headsOf(p).length;
    if (!fm || need > fm.cap) {
      // the species' flower geometry is built once; a mesh that has run out of room is replaced by one twice the size
      const src = this.flowerSrc[id] ??= (() => { const b = new Builder(); F.build(b, rng(97)); return b.build(); })();
      const cap = Math.max(16, 2 ** Math.ceil(Math.log2(Math.max(1, need))), (fm?.cap ?? 0) * 2);
      fm?.dispose();
      fm = this.flowers[id] = new FlowerMesh(this.scene, flowerGeometry(src), cap, 'flower:' + id);
    }
    const MODE = { day: 1, night: 2 };
    const mode = this.live ? (MODE[F.daily] ?? 0) : 0, tr = clamp(F.translucent ?? 0.5, 0, 0.999);
    const amp = sp.material?.amp ?? 0.6, speed = sp.material?.speed ?? 1;
    const hp = new THREE.Vector3(), hq = new THREE.Quaternion();
    fm.begin();
    for (const p of show) {
      // (a portrait shows the flower open, in the species' first colours)
      const b = p.bloom, look = bloomLook(this.live ? b : OPEN), pi = this.live ? b.palette : 0, j = this.live ? b.j : 0.5;
      const pal = F.palettes?.[pi] ?? [0xf4f0e8, 0xe0a0b0, 0xf0c040];
      if (p._pal?.k !== pi + j) p._pal = { k: pi + j, v: pal.slice(0, 3).map((h) => packRGB(h, j)) };
      const P = [p._pal.v[0], p._pal.v[1], p._pal.v[2], (pal[4] ?? 0) * 64 + (pal[3] ?? 0) * 8 + mode * 2 + tr];     // surface style, pattern code (render/flowers.js)
      const ph = p.index * 1.618;
      for (const h of this.headsOf(p)) {
        hp.copy(h.local).multiplyScalar(p._s).applyQuaternion(p._q).add(p.pos);
        hq.copy(p._q).multiply(h.q);
        fm.put(hp, hq, p._s * h.s * look.scale, P, [look.open, look.fade > 0 ? look.fade : -look.green, look.petals, packSway(amp * h.sw * h.sw, speed, ph, ph * 1.3)]);
      }
    }
    fm.end();
  }

  count(id) { let n = 0; for (const p of this.list) if (p.id === id) n++; return n; }

  offshoot(p, [, r, max], world, grown = 0.15) {
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
      return this.add(p.id, hit.point, { normal: hit.normal, surface: hit.surface, grown });
    }
    return null;
  }

  serialize() {
    return this.list.map((p) => ({ id: p.id, pos: p.pos.toArray().map((v) => +v.toFixed(2)), n: p.normal.toArray().map((v) => +v.toFixed(3)), s: p.surface, v: p.variant, r: +p.rot.toFixed(2), sc: +p.scale.toFixed(2), g: +p.grown.toFixed(2), h: +p.health.toFixed(2), ...(p.bloom ? { b: packBloom(p.bloom) } : {}) }));
  }

  clear() {
    for (const p of [...this.list]) this.remove(p);
  }
}

export { MAT };
