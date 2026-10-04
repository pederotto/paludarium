// Dwarf shrimp (Neocaridina davidi and its colour lines), painted on the shrimp scan (tools/rig/shrimp.mjs gives `part`: 'body',
// 'tail', 'leg', 'claw', 'antenna', 'swimmeret', 'eye', 'mouth'; `zf` 0 at the telson … 1 at the rostrum, beyond 1 on the whips).
// A living shrimp is not a lacquered plate: its colour is pigment cells (chromatophores) scattered in a glassy shell, densest on the
// back and the sides of the carapace, thinning out toward the belly, the legs and the tail fan, which go see-through at the edges.
// So: a base colour; a fine stipple of darker pigment dots and a few pale flecks; glassy (pale, desaturated) belly, leg joints, fan
// edges and antenna tips; the seams between the abdomen's segments a little darker (the baked occlusion does most of that).
//   paintFor(morph) / texelFor(morph): morph 'red' (cherry, the default), 'wild', 'yellow', 'orange', 'blue' (blue dream)
import { hex, mix3, sstep, fbm, vnoise, cells } from './common.mjs';

const MORPHS = {
  red: { base: 0xc0141c, deep: 0x7a0a12, light: 0xe4473e, glass: 0xf0c8c0, dot: 0x5a060c, fleck: 0xffe6dc, clear: 0.28 },
  wild: { base: 0x7d7255, deep: 0x3f3a26, light: 0xa8a080, glass: 0xdcdccc, dot: 0x1e1a10, fleck: 0xf0ecd8, clear: 0.85 },
  yellow: { base: 0xe8b00c, deep: 0xb07800, light: 0xffd447, glass: 0xfff0c4, dot: 0x8a5600, fleck: 0xfff8e0, clear: 0.3 },
  orange: { base: 0xe8560e, deep: 0xa33006, light: 0xff8a3a, glass: 0xffdcc4, dot: 0x7a2004, fleck: 0xfff0e0, clear: 0.3 },
  blue: { base: 0x1d3fb4, deep: 0x0c1f6e, light: 0x4a7ae8, glass: 0xc4d4f2, dot: 0x081448, fleck: 0xe0eaff, clear: 0.25 },
};

function palette(m) {
  const P = MORPHS[m] ?? MORPHS.red;
  return { base: hex(P.base), deep: hex(P.deep), light: hex(P.light), glass: hex(P.glass), dot: hex(P.dot), fleck: hex(P.fleck), clear: P.clear };
}

// The colour from the large-scale pattern only (what a vertex can carry).
function broad(v, C) {
  const up = v.n[1], w = fbm(v.x * 2.2 + 3, v.y * 2.2, v.z * 2.2);
  let c;
  switch (v.part) {
    case 'eye': return mix3(C.deep, hex(0x050404), 0.85);
    case 'leg': case 'claw': {
      // banded: coloured segments with glassy joints, paler toward the tips
      const t = v.legT / (v.part === 'claw' ? 0.35 : 1);
      const joint = Math.max(...[0.28, 0.52, 0.74].map((j) => 1 - sstep(0.0, 0.05, Math.abs(t - j))));
      c = mix3(C.base, C.light, 0.25 + 0.25 * w + 0.2 * t);
      c = mix3(c, C.glass, Math.max(joint * 0.35, sstep(0.8, 1, t) * 0.5));
      return c;
    }
    case 'antenna': {
      const t = Math.min(1, (v.legT ?? 0) / 0.6);
      return mix3(mix3(C.base, C.light, 0.35), C.glass, sstep(0.15, 0.9, t) * 0.75);
    }
    case 'swimmeret': return mix3(C.light, C.glass, 0.45);
    case 'egg': return mix3(hex(0xd8b830), hex(0x8a9a30), w * 0.6);           // yellow, greening as they develop
    default: {
      // body and tail: deep colour on the back, the base on the sides, glassy below
      const m = fbm(v.x * 4 + 7, v.y * 4, v.z * 4);
      c = mix3(C.base, C.deep, sstep(0.3, 0.95, up) * 0.5 + (w - 0.5) * 0.35 + sstep(0.58, 0.75, m) * 0.3);
      c = mix3(c, C.light, sstep(-0.05, -0.5, up) * 0.4 + sstep(0.62, 0.8, w) * 0.15);
      c = mix3(c, C.glass, sstep(-0.35, -0.85, up) * (0.45 + C.clear * 0.5));
      if (v.part === 'tail') {
        // the fan: coloured at its root, clear toward the rim (the fan lies behind the body's end: zf below 0)
        const rim = sstep(-0.03, -0.11, v.zf ?? 0);
        c = mix3(c, C.glass, rim * 0.75);
      }
      return c;
    }
  }
}

export function paintFor(morph = 'red') {
  if (morph === 'mask') return (v) => maskTexel(v);
  const C = palette(morph);
  return (v) => { const c = broad(v, C), shade = 1 - 0.5 * (v.ao ?? 0); return c.map((k) => k * shade); };
}
export const paint = paintFor('red');

// Per texel: the stipple of pigment cells (0.15-0.3 mm), pale flecks, glassy patches over the sides (more in lower grades and the wild
// form), and the dark seam where each abdominal plate laps over the next (from the occlusion, sharpened).
export function texelFor(morph = 'red') {
  if (morph === 'mask') return maskTexel;
  const C = palette(morph);
  return (v) => {
    let c = broad(v, C);
    const [d1, id1] = cells(v.x * 38, v.y * 38, v.z * 38);          // pigment cells
    const [d2, id2] = cells(v.x * 14 + 5, v.y * 14, v.z * 14);      // pale flecks
    const g = fbm(v.x * 5 + 11, v.y * 5, v.z * 5);
    const shell = v.part === 'body' || v.part === 'tail';
    const limb = v.part === 'leg' || v.part === 'claw' || v.part === 'swimmeret';
    if (shell || limb) {
      const dense = shell ? sstep(-0.6, 0.4, v.n[1]) : 0.5;
      c = mix3(c, C.dot, 0.55 * (1 - sstep(0.18, 0.34, d1)) * sstep(1 - dense * 0.8, 1, id1 + 0.35));
      c = mix3(c, C.fleck, 0.5 * (1 - sstep(0.12, 0.24, d2)) * sstep(0.82, 0.92, id2) * (shell ? 1 : 0.4));
    }
    if (shell) {
      c = mix3(c, C.glass, sstep(0.55, 0.78, g) * C.clear * 1.2 * sstep(0.7, -0.3, v.n[1]));            // glassy patches on the sides
      c = mix3(c, mix3(C.deep, hex(0x000000), 0.3), 0.6 * sstep(0.32, 0.6, v.ao ?? 0));                  // plate seams
    }
    if (v.part === 'antenna') c = mix3(c, C.dot, 0.35 * (0.5 + 0.5 * Math.sin((v.legT ?? 0) * 140)));    // fine rings on the whip
    const shade = 1 - 0.45 * Math.pow(v.ao ?? 0, 0.8);
    return c.map((q) => q * shade);
  };
}
export const texel = texelFor('red');

// The colour lines (genetics: wild, red, yellow, blue and their mixes, each solid or rili) are not baked one texture each: the
// texture holds where the pigment is and the game colours it per line (render/creatures/material.js `palette`, content/morphs.js
// SHRIMP_PALETTE). 'mask' bakes R = pigment density (1 fully coloured … 0 clear shell: the belly, the joints, the fan's rim, pale
// flecks), G = shading (occlusion, plate seams, the pigment cells' dark stipple), B = how far to the deeper back colour (the back,
// darker mottles). The eggs and eyes are coloured by the rig and the eye shader.
export function maskTexel(v) {
  const up = v.n[1], w = fbm(v.x * 2.2 + 3, v.y * 2.2, v.z * 2.2), m = fbm(v.x * 4 + 7, v.y * 4, v.z * 4), g = fbm(v.x * 5 + 11, v.y * 5, v.z * 5);
  const [d1, id1] = cells(v.x * 38, v.y * 38, v.z * 38), [d2, id2] = cells(v.x * 14 + 5, v.y * 14, v.z * 14);
  let pig = 1, shade = 1, deep = 0;
  switch (v.part) {
    case 'leg': case 'claw': {
      const t = v.legT / (v.part === 'claw' ? 0.35 : 1);
      const joint = Math.max(...[0.28, 0.52, 0.74].map((j) => 1 - sstep(0.0, 0.05, Math.abs(t - j))));
      pig = 0.92 - 0.22 * t - joint * 0.3; deep = 0.2; break;
    }
    case 'antenna': pig = 0.75 * (1 - sstep(0.1, 0.9, Math.min(1, (v.legT ?? 0) / 0.6))) + 0.08; shade = 0.85 + 0.15 * Math.sin((v.legT ?? 0) * 140); break;
    case 'swimmeret': pig = 0.4; break;
    case 'egg': case 'eye': pig = 0; break;
    default: {
      pig = 0.95 - sstep(-0.35, -0.85, up) * 0.75;                                   // the belly is clear
      pig -= sstep(0.55, 0.78, g) * 0.35 * sstep(0.7, -0.3, up);                       // glassy patches on the sides
      pig -= 0.8 * (1 - sstep(0.12, 0.24, d2)) * sstep(0.85, 0.94, id2);                // pale flecks
      if (v.part === 'tail') pig *= 1 - sstep(-0.03, -0.11, v.zf ?? 0) * 0.85;         // the fan clears toward its rim
      deep = sstep(0.3, 0.95, up) * 0.55 + (w - 0.5) * 0.3 + sstep(0.58, 0.75, m) * 0.3;
      shade *= 1 - 0.5 * sstep(0.32, 0.6, v.ao ?? 0);                                  // plate seams
    }
  }
  if (v.part !== 'egg' && v.part !== 'eye') shade *= 1 - 0.35 * (1 - sstep(0.18, 0.34, d1)) * sstep(0.45, 1, id1 + 0.3);   // pigment cells
  shade *= 1 - 0.45 * Math.pow(v.ao ?? 0, 0.8);
  const c = (x) => Math.max(0, Math.min(1, x));
  return [c(pig), c(shade), c(deep)];
}
