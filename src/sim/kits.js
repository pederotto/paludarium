// Builds a kit (content/kits.js) on the tank, and mirrors pieces and kits.
//
// Kits go through the same code the Hardscape tool uses: Decor.addPiece sits
// each piece on the ground (or stamps it onto the piece under it, so pieces
// stack), and the ground is re-stamped as we go, so a piece placed later sees
// the pieces placed before it.
//
// A kit is first turned into a *layout*: a list of piece specs in world
// coordinates. The layout is deterministic for a seed (so a placement can be
// repeated) and varies a little from seed to seed: jittered spacing, sizes,
// variants, a small turn of the whole arrangement. A mirrored kit is the
// mirror image of the same layout, so both halves match exactly.

import * as THREE from 'three/webgpu';
import { PIECES } from './decor.js';
import { TANK, MAT } from './tank.js';
import { rng, clamp } from '../render/geo.js';

const TAU = Math.PI * 2;

// Kit distances are for a 90 cm tank; smaller and larger tanks scale them.
export const kitScale = () => clamp(TANK.w / 90, 0.38, 1.6);

// A repeatable seed from where (and how much) you have built.
export const kitSeed = (x, z, n = 0) => (Math.imul(Math.round(x * 4) + 977, 73856093) ^ Math.imul(Math.round(z * 4) + 313, 19349663) ^ Math.imul(n + 7, 83492791)) >>> 0;

// --- Layout (pure geometry) ---------------------------------------------------------------------

export function layoutKit(kit, { x = 0, z = 0, seed = 1, sc = kitScale() } = {}) {
  const r = rng(seed);
  const spin = (r() * 2 - 1) * (kit.spin ?? 0);
  const cs = Math.cos(spin), sn = Math.sin(spin);
  const at = (dx, dz, jit) => {
    const ax = (dx + (r() - 0.5) * jit) * sc, az = (dz + (r() - 0.5) * jit) * sc;
    return [x + ax * cs + az * sn, z - ax * sn + az * cs];
  };
  const pieces = kit.pieces.map((p) => {
    const [px, pz] = at(p.dx, p.dz, p.stack || p.bridge || p.atTop != null ? 0 : 2.4);
    const size = p.size * sc * (0.92 + r() * 0.16);
    const rr = r() * TAU, v = r(), lx = r() - 0.5, lz = r() - 0.5;
    const look = r() * 2 ** 31 | 0;       // one seed for the flip, tint and the little scale differences
    return {
      type: p.type, x: px, z: pz, size,
      variant: p.variants ? p.variants[Math.floor(v * p.variants.length)] : undefined, look,
      rot: p.rot != null ? p.rot + spin : rr,
      tilt: p.lean ? [lx * p.lean, lz * p.lean] : undefined,
      scale: p.scale, width: p.width ? p.width * sc * (0.92 + r() * 0.16) : undefined,
      stack: !!p.stack, bridge: p.bridge, atTop: p.atTop, flip: undefined, tint: undefined, mirrored: false,
    };
  });
  const banks = (kit.banks ?? []).map((b) => ({ pts: ring(x, z, b.ring * sc), cx: x, cz: z, r: b.ring * sc, width: b.width * sc, height: b.height * sc, moss: !!b.moss }));
  const outlets = kit.outlet ? [{ on: kit.outlet.on }] : [];
  return { pieces, banks, outlets };
}

function ring(cx, cz, R, n = 32) {
  return Array.from({ length: n + 1 }, (_, i) => ({ x: cx + Math.cos((i / n) * TAU) * R, z: cz + Math.sin((i / n) * TAU) * R }));
}

// One piece spec seen in the mirror (x -> -x about the centre of the tank). The yaw and the
// lean about Z reverse; the model is drawn flipped on x, so it reads as a mirror image.
export function mirrorSpec(s) {
  return { ...s, x: -s.x, rot: -(s.rot ?? 0), tilt: s.tilt ? [s.tilt[0], -s.tilt[1]] : undefined, mirrored: !s.mirrored };
}

export function mirrorLayout(l) {
  return {
    pieces: l.pieces.map(mirrorSpec),
    banks: l.banks.map((b) => ({ ...b, pts: b.pts.map((p) => ({ x: -p.x, z: p.z })), cx: -b.cx })),
    outlets: l.outlets,
  };
}

// --- Placing --------------------------------------------------------------------------------------------

// Are the models this kit needs loaded?
export const kitReady = (W, kit) => kit.pieces.every((p) => W.decor.parts[p.type]?.length);

// Where the ground is highest under a piece (the ground is stamped to its top surface), smoothed
// over a few points so a spike does not win. Returns [x, z].
function topOf(T, piece) {
  const box = new THREE.Box3().setFromObject(piece.mesh);
  let best = -Infinity, at = [piece.mesh.position.x, piece.mesh.position.z];
  for (let x = box.min.x + 1; x <= box.max.x - 1; x += 1) for (let z = box.min.z + 1; z <= box.max.z - 1; z += 1) {
    const h = T.heightAt(x, z) + 0.25 * (T.heightAt(x + 1.5, z) + T.heightAt(x - 1.5, z) + T.heightAt(x, z + 1.5) + T.heightAt(x, z - 1.5));
    if (h > best) { best = h; at = [x, z]; }
  }
  return at;
}

// Places one piece spec. `placed` holds the pieces of the same kit placed so far (for `bridge`).
// Returns the piece, or null when the model is not loaded.
export function placeSpec(W, s, placed = []) {
  const D = W.decor, T = W.terrain, def = PIECES[s.type];
  const list = D.parts[s.type];
  if (!def || !list?.length) return null;
  // The seeded look (variant, small scale differences, flip and tint) is the same for a piece and
  // its mirror image; the mirror image is drawn flipped.
  const look = D.look(s.type, s.look ?? 1);
  const variant = ((s.variant ?? look.variant) % list.length + list.length) % list.length;
  const flip = s.mirrored ? !(s.flip ?? look.flip) : !!(s.flip ?? look.flip);
  const tint = s.tint ?? look.tint;
  const jit = s.exact ? [1, 1, 1] : look.scale.map((v) => 1 + (v - 1) * 0.55);
  const bb = list[variant].geometry.boundingBox;
  const ext = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z];
  const m = 1.5 + s.size * 0.25;
  let [x, z] = s.atTop != null && placed[s.atTop] ? topOf(T, placed[s.atTop]) : [s.x, s.z];
  x = clamp(x, -TANK.w / 2 + m, TANK.w / 2 - m); z = clamp(z, -TANK.d / 2 + m, TANK.d / 2 - m);
  const sink = s.sink ?? 0.08;
  const yFor = (size) => {
    if (s.bridge) {
      const tops = s.bridge.map((i) => placed[i]).filter(Boolean).map((p) => T.heightAt(p.mesh.position.x, p.mesh.position.z));
      if (tops.length) return Math.max(...tops) - size * sink;
    }
    if (s.stack || s.atTop != null || !def.stamp || s.bridge) return T.heightAt(x, z) - size * sink;
    return undefined;
  };
  const make = (size) => {
    let sc = s.scale ?? [1, 1, 1];
    if (s.width) {        // a spire: `size` is the height, `width` the base width
      const k = size / Math.max(...ext);
      sc = [s.width / (ext[0] * k), 1, (s.width * 0.85) / (ext[2] * k)];
    }
    sc = [sc[0] * jit[0], sc[1] * jit[1], sc[2] * jit[2]];
    return D.addPiece(s.type, x, z, { variant, size, rot: s.rot, tilt: s.tilt, scale: sc, flip, tint, y: yFor(size), sink, snap: s.snap ?? (def.face ? 30 * kitScale() : undefined) });
  };
  let size = s.size;
  let p = make(size);
  // Nothing may reach the lid: shrink a piece that would.
  for (let k = 0; k < 3 && p; k++) {
    const box = new THREE.Box3().setFromObject(p.mesh);
    const room = TANK.h - 3 - box.min.y, have = box.max.y - box.min.y;
    if (box.max.y <= TANK.h - 3 || have <= 0) break;
    D.removePiece(p);
    size *= clamp(room / have, 0.4, 0.95);
    p = make(size);
  }
  return p;
}

// Places a layout. Returns { pieces, outlets } (what was actually added).
export function placeLayout(W, layout) {
  const T = W.terrain, D = W.decor, out = { pieces: [], outlets: [] };
  for (const b of layout.banks) {
    T.raiseBank(b.pts, b.width, b.height);
    if (b.moss) {
      const f = T.field;
      for (let i = 0; i < b.pts.length - 1; i += 2) f.brush(b.pts[i].x, b.pts[i].z, b.width * 1.5, 'paint', 3, { mat: MAT.moss });
      f.brush(b.cx, b.cz, b.r * 0.85, 'paint', 1.2, { mat: MAT.moss });
    }
    T.compose(D.stamps());
  }
  const placed = [];
  for (const spec of layout.pieces) {
    const p = placeSpec(W, spec, placed);
    placed.push(p);
    if (p) out.pieces.push(p);
  }
  for (const o of layout.outlets) {
    const p = placed[o.on];
    if (!p) continue;
    const { x, z } = p.mesh.position;
    out.outlets.push(W.water.addOutlet(new THREE.Vector3(x, T.heightAt(x, z) + 0.2, z), false));
  }
  return out;
}

// Builds `kit` with its centre at (x, z); with `mirror`, its mirror image across the tank's
// centre plane as well. The caller takes the undo snapshot. Returns { pieces, outlets }.
export function buildKit(W, kit, { x, z, seed, mirror = false }) {
  const layout = layoutKit(kit, { x, z, seed });
  const res = placeLayout(W, layout);
  if (mirror) {
    const m = placeLayout(W, mirrorLayout(layout));
    res.pieces.push(...m.pieces);
    res.outlets.push(...m.outlets);
  }
  return res;
}
