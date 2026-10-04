// Where a waterfall lands in standing water: the plunge and the current it sets going (render/water.js draws the sheet).
//
// A real plunge pool: where the sheet goes in, water and air churn white; around it a ragged ring of foam and bubbles
// coming back up and popping; the surface there is broken (sparkles of the lamp); and the water the fall brings has to
// leave, so foam and streaks drift off across the pool toward its outlet (here the pump's intake), spreading and thinning
// out. One flat mesh per fall carries all of it: a disc round the foot and a trail along a curve on the surface, first
// along the fall's own heading, then bending toward the outlet, cut where the water ends. Its vertices carry where they
// lie relative to the foot (`pdat`), so one shared material serves every fall.

import * as THREE from 'three/webgpu';
import { float, vec2, vec3, uv, time, smoothstep, length, abs, max, min, clamp, mix, attribute, normalize, dot, reflect, pow, cameraPosition, positionWorld } from 'three/tsl';
import { noise3 } from './noise3.js';
import { U } from './uniforms.js';
import { FX } from './waterfx.js';

const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// foot: where the sheet meets the surface (y is the surface); dir: the fall's heading on the surface (x, z, unit);
// toward: the pool's outlet {x, z} or null; R: radius of the foam ring (cm); q: the fall's flow; wet(x, z): water there.
export function plungeGeometry({ foot, dir, toward, R, q, wet }) {
  const [dx, dz] = dir;
  let len = Math.min(32, 8 + q * 0.45), tx = dx, tz = dz;
  if (toward) {
    const vx = toward.x - foot.x, vz = toward.z - foot.z, l = Math.hypot(vx, vz);
    if (l > R * 1.5) { len = Math.min(len, l); tx = vx / l; tz = vz / l; }
  }
  // The trail's centre line: a quadratic curve leaving along the fall's heading and ending toward the outlet.
  const P0 = [foot.x, foot.z], C = [foot.x + dx * len * 0.45, foot.z + dz * len * 0.45], P2 = [foot.x + tx * len, foot.z + tz * len];
  const at = (t) => { const a = (1 - t) * (1 - t), b = 2 * t * (1 - t), c = t * t; return [a * P0[0] + b * C[0] + c * P2[0], a * P0[1] + b * C[1] + c * P2[1]]; };
  const line = [];   // [x, z, s, tangent x, tangent z]
  for (let s = -R; s < 0; s += 0.8) line.push([foot.x + dx * s, foot.z + dz * s, s, dx, dz]);
  const steps = Math.max(8, Math.ceil(len / 0.8));
  let s = 0, prev = P0;
  for (let i = 0; i <= steps; i++) {
    const p = at(i / steps), n = at(Math.min(1, (i + 1) / steps)), b = at(Math.max(0, (i - 1) / steps));
    s += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
    if (s > R && !wet(p[0], p[1])) break;   // the bank or a rock: the foam piles up there and goes no further
    const ex = n[0] - b[0], ez = n[1] - b[1], el = Math.hypot(ex, ez) || 1;
    line.push([p[0], p[1], s, ex / el, ez / el]);
  }
  const end = line[line.length - 1][2];
  const cols = 6, pos = [], uvs = [], dat = [], idx = [];
  const k = Math.min(1, 0.45 + q / 60);
  for (const [x, z, s, ux, uz] of line) {
    // Wide enough for the ring at the foot, then spreading as the current slows.
    const hw = s <= R ? R * 1.15 : Math.min(R * 1.9, R * 1.15 + (s - R) * 0.18);
    const fade = k * (1 - sm(Math.max(R * 1.5, end * 0.3), end * 0.85, s));
    for (let c = 0; c <= cols; c++) {
      const e = (c / cols) * 2 - 1, off = e * hw;
      pos.push(x - uz * off, foot.y, z + ux * off);
      uvs.push(e, s);
      dat.push(s, off, R, fade);
    }
  }
  for (let i = 0; i < line.length - 1; i++) for (let c = 0; c < cols; c++) {
    const a = i * (cols + 1) + c, d = a + cols + 1;
    idx.push(a, a + 1, d, a + 1, d + 1, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('pdat', new THREE.Float32BufferAttribute(dat, 4));
  g.setIndex(idx);
  return g;
}

// pdat: (s along the trail from the foot, cm; across, cm; R; strength × fade along the trail). Lit here, as the other
// water materials are (render/water.js): the standard lighting's environment map turns anything facing up white.
export function makePlungeMaterial() {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const pd = attribute('pdat', 'vec4');
  const s = pd.x, c = pd.y, R = pd.z, k = pd.w;
  const across = abs(uv().x);
  const r = length(vec2(s, c)).div(R);            // 0 at the impact, 1 at the edge of the foam ring
  // Churn: two layers boiling at different speeds.
  const n1 = noise3(vec3(s.mul(0.9), c.mul(0.9), time.mul(1.7)));
  const n2 = noise3(vec3(s.mul(2.4), c.mul(2.4), time.mul(3.3).add(5)));
  const boil = smoothstep(0.8, 0.15, r.add(n1.mul(0.4))).mul(smoothstep(-0.3, 0.2, n1.add(n2.mul(0.7)).add(0.2)));
  const ring = smoothstep(1.3, 0.6, r.add(n1.mul(0.5))).mul(smoothstep(-0.05, 0.3, n2.add(n1.mul(0.6))));
  // Bubbles coming up and popping: small bright specks that come and go, most round the ring.
  const nb = noise3(vec3(s.mul(5.0), c.mul(5.0), time.mul(2.6).add(9)));
  const bub = smoothstep(0.26, 0.36, nb).mul(smoothstep(1.9, 0.5, r));
  // The current: foam carried off downstream as a lace of thin lines (where a slowly changing pattern crosses zero), in
  // drifts that come and go, long along the flow, at a couple of centimetres a second.
  const sd = s.sub(time.mul(2.4));
  const patch = noise3(vec3(sd.mul(0.3), c.mul(0.8), time.mul(0.08).add(3)));
  const veins = noise3(vec3(sd.mul(0.35), c.mul(2.4), time.mul(0.15).add(11)));
  const down = smoothstep(-0.2, 1.0, s.div(R)).mul(smoothstep(0.7, 1.5, r));   // downstream of the ring only
  const trail = smoothstep(0.75, 0.95, float(1).sub(abs(veins).mul(6))).mul(smoothstep(0.02, 0.3, patch.add(n2.mul(0.5)))).mul(down);
  const scum = smoothstep(0.1, 0.45, patch.add(n2.mul(0.3))).mul(down);   // a thin film of foam under the lace, seen from afar
  const edge = smoothstep(1.0, 0.55, across.add(n1.mul(0.3)));
  const foam = max(max(boil, ring.mul(0.8)), trail.mul(0.45));
  // The broken surface round the foot catches the lamp: sparkles from a normal tilted by the churn.
  const nrm = normalize(vec3(n2.mul(0.9), 1, n1.mul(0.9)));
  const view = normalize(cameraPosition.sub(positionWorld));
  const rl = max(dot(reflect(view.negate(), nrm), FX.lightDir.negate()), 0);
  const glint = pow(rl, 70).mul(1.4).mul(U.daylight).mul(smoothstep(1.8, 0.4, r));
  const lit = U.daylight.mul(0.8).add(0.1);
  const col = mix(vec3(0.62, 0.72, 0.75), vec3(0.92, 0.95, 0.96), clamp(foam.add(bub), 0, 1)).mul(lit);
  m.colorNode = col.add(glint);
  m.opacityNode = clamp(max(max(foam.mul(0.85), bub.mul(0.75)), max(scum.mul(0.14), min(glint, 1))), 0, 1).mul(edge).mul(k);
  return m;
}
