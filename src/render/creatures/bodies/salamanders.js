// Salamanders, newts, axolotls, geckos, tadpoles and eggs. All face +z, feet on y = 0.
import { ell, smin, cap, vnoise, C, lerp3, M } from '../kit.js';

// Four-legged amphibian/lizard: body, head, tail and legs with feet.
function quadruped(o) {
  const L = o.len, legs = [];
  // Shoulder and hip anchors; legs splay out and down.
  for (const [k, z, side] of [[1, o.shoulder, -1], [2, o.shoulder, 1], [3, o.hip, -1], [4, o.hip, 1]]) {
    const back = k > 2;
    const top = [side * o.bodyW * 0.8, o.bodyH * 0.8, z];
    const knee = [side * (o.bodyW + o.leg * 0.7), o.bodyH * 0.9, z + (back ? -o.leg * 0.2 : o.leg * 0.15)];
    const foot = [side * (o.bodyW + o.leg * 0.9), o.foot, z + (back ? -o.leg * (o.backReach ?? 0.3) : o.leg * 0.35)];
    legs.push({ k, top, knee, foot, r: back ? o.legR * (o.thigh ?? 1.2) : o.legR });
  }
  const sdf = (x, y, z) => {
    let d = ell(x, y - o.bodyH, z - o.bodyZ, o.bodyW, o.bodyH * (o.bodyTall ?? 1), o.bodyL);
    d = smin(d, ell(x, y - o.headY, z - o.headZ, o.headW, o.headH, o.headL), o.neck);
    if (o.tail) {
      const [t] = cap([x, y, z], [0, o.bodyH * 0.9, o.bodyZ - o.bodyL * 0.6], [o.tailCurl ?? 0, o.bodyH * 0.6, o.bodyZ - o.bodyL - o.tail], o.tailR, 0.05);
      let td = t;
      if (o.tailFin) td = smin(td, ell(x, y - o.bodyH * 0.8, z - (o.bodyZ - o.bodyL - o.tail * 0.5), 0.08, o.tailFin, o.tail * 0.55), 0.2);
      d = smin(d, td, o.tailBlend ?? 0.4);
    }
    for (const l of legs) {
      const [a] = cap([x, y, z], l.top, l.knee, l.r, l.r * 0.85);
      const [b] = cap([x, y, z], l.knee, l.foot, l.r * 0.8, l.r * 0.6);
      d = smin(d, Math.min(a, b), 0.18);
      if (o.toes) d = smin(d, ell(x - l.foot[0], y - o.foot, z - l.foot[2], o.toes, 0.06, o.toes * 0.9), 0.1);
    }
    for (const s of [-1, 1]) {
      d = smin(d, ell(x - s * o.eyeX, y - o.eyeY, z - o.eyeZ, o.eyeR, o.eyeR, o.eyeR), 0.08);
      if (o.gills) {
        for (let g = 0; g < 3; g++) {
          const base = [s * o.headW * 0.85, o.headY + 0.25 - g * 0.3, o.headZ - o.headL * 0.4];
          const tip = [s * (o.headW + o.gills), o.headY + 0.9 - g * 0.55, o.headZ - o.headL * 0.9 - g * 0.2];
          d = Math.min(d, cap([x, y, z], base, tip, 0.12, 0.06)[0] - (Math.sin((x + y + z) * 22) * 0.02));
        }
      }
    }
    return d;
  };
  const rig = (x, y, z) => {
    let best = 0, bt = 0, bd = 0.6;
    for (const l of legs) {
      const [a, ta] = cap([x, y, z], l.top, l.knee, l.r, l.r);
      const [b, tb] = cap([x, y, z], l.knee, l.foot, l.r, l.r);
      const d = Math.min(a, b);
      if (d < bd && Math.abs(x) > o.bodyW * 0.7) { bd = d; best = l.k; bt = a < b ? ta * 0.5 : 0.5 + tb * 0.5; }
    }
    const spine = Math.max(0, Math.min(1, (o.headZ + o.headL - z) / (o.headZ + o.headL - (o.bodyZ - o.bodyL - (o.tail ?? 0)))));
    return [spine, best, bt];
  };
  return { sdf, rig, lo: o.lo, hi: o.hi, cell: o.cell ?? 0.12 };
}

export const SALAMANDERS = {
  newt: () => {
    const b = quadruped({
      bodyW: 0.55, bodyH: 0.55, bodyL: 1.9, bodyZ: 0, bodyTall: 0.9, headW: 0.55, headH: 0.38, headL: 0.8, headY: 0.55, headZ: 2.2, neck: 0.4,
      eyeX: 0.35, eyeY: 0.85, eyeZ: 2.5, eyeR: 0.15, shoulder: 1.3, hip: -1.3, leg: 0.8, legR: 0.13, foot: 0.08, toes: 0.14,
      tail: 4.2, tailR: 0.42, tailFin: 0.5, lo: [-1.8, -0.3, -6.8], hi: [1.8, 1.6, 3.4], cell: 0.1,
    });
    b.color = (x, y, z) => {
      if (Math.abs(x) > 0.2 && y > 0.75 && z > 2.3) return C(0x050505);
      if (y < 0.3 && z > -2) return vnoise(x * 3, y, z * 3) > 0.6 ? C(0x1a120a) : C(0xef6a1c);
      return lerp3(C(0x2b2218), C(0x4a3a26), vnoise(x * 2, y * 2, z * 2));
    };
    return b;
  },
  axolotl: () => {
    const b = quadruped({
      bodyW: 0.9, bodyH: 0.85, bodyL: 2.4, bodyZ: 0, bodyTall: 0.85, headW: 1.25, headH: 0.7, headL: 1.1, headY: 0.85, headZ: 2.8, neck: 0.55,
      eyeX: 0.75, eyeY: 1.2, eyeZ: 3.2, eyeR: 0.13, shoulder: 1.5, hip: -1.6, leg: 1.0, legR: 0.18, foot: 0.08, toes: 0.2,
      tail: 5, tailR: 0.6, tailFin: 0.9, gills: 1.1, lo: [-3, -0.3, -8.4], hi: [3, 2.6, 4.2], cell: 0.12,
    });
    b.color = (x, y, z) => {
      const gill = Math.abs(x) > 1.0 && z > 1.2 && z < 3 && y > 0.6;
      if (gill) return C(0xd0304a);
      if (Math.abs(x) > 0.5 && y > 1.2 && z > 3.1) return C(0x1a1a1a);
      return lerp3(C(0xf2c6c6), C(0xffe0dc), vnoise(x * 2, y * 2, z * 2) * 0.7);
    };
    return b;
  },
  gecko: () => {
    const b = quadruped({
      bodyW: 0.5, bodyH: 0.45, bodyL: 1.5, bodyZ: 0, bodyTall: 0.8, headW: 0.5, headH: 0.35, headL: 0.75, headY: 0.5, headZ: 1.9, neck: 0.35,
      eyeX: 0.35, eyeY: 0.72, eyeZ: 2.05, eyeR: 0.2, shoulder: 1.0, hip: -1.0, leg: 0.8, legR: 0.1, foot: 0.05, toes: 0.2,
      tail: 3.4, tailR: 0.3, lo: [-1.7, -0.25, -5.4], hi: [1.7, 1.3, 2.9], cell: 0.08,
    });
    b.color = (x, y, z) => {
      if (Math.abs(x) > 0.2 && y > 0.6 && z > 1.9) return C(0x2a1a0a);
      if (y < 0.2) return C(0xe8dcc0);
      const chevron = Math.sin(z * 3.2 + Math.abs(x) * 5) > 0.6;
      return chevron ? C(0x5a4630) : lerp3(C(0xa8906a), C(0xc2ab82), vnoise(x * 3, y * 3, z * 3));
    };
    return b;
  },
};
