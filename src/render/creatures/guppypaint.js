// The guppy's skin for every look (content/guppy.js: a male strain, a female, a fry), painted onto the owner's models (art-src/raw/
// guppy_male_mesh.glb, guppy_female_mesh.glb, prepared by art-src/guppy/prep_glb.py). Pure functions, no three.js: the game runs them
// in a worker for the looks a tank breeds, and tools/guppy-maps.mjs writes the same images for checking.
//
// Each model comes with three maps in its own UVs (prep_glb.py bakes them):
//   coords    where a texel is on the fish: body R = s (snout 0 … tail root 1, a share of the standard length), G = v (back 0 … belly 1);
//             fins R = x (across the rays: lowest / first 0 … highest / last 1), G = t (out along them: base 0 … rim 1)
//   parts     R: 255 body, 200 tail, 160 dorsal, 120 pectoral, 80 the fins under the belly (pelvic, anal, gonopodium), 0 none
//   base      the owner's own colour texture
// The body keeps the owner's colours and detail (recoloured for gold and albino, and overlaid with the strain's rear colour, Moscow,
// platinum, half-black and snakeskin); the fins take the strain's colours and patterns, multiplied by the owner's fine detail (rays,
// ragged edges), with opacity in alpha (the fin shader reads it: material.js finAlpha).
//
// Colour from the owner's reference sheets (.agents/refs/guppy-1007): a tail runs from a light root (orange in reds, turquoise in blues,
// lilac in purples) through the strain colour to a deep rim, with light spangles near the root and dark speckles; patterns as the
// Encyclo-Fish sheet draws them (mosaic: a dark network over a light root; snakeskin: a chain on the body and lace on the tail;
// half-black: a black rear half; Moscow: a dark velvet body; platinum: a white metal head).
import { parseGuppyLook } from '../../content/guppy.js';

// ---- small maths ---------------------------------------------------------------------------------------------------------------
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sm = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];      // sRGB 0…1 (painted in sRGB)
// Integer hash -> [0, 1).
const ih = (x, y, s = 0) => { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function vnoise(x, y, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = ih(xi, yi, s), b = ih(xi + 1, yi, s), c = ih(xi, yi + 1, s), d = ih(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y, s = 0) => vnoise(x, y, s) * 0.55 + vnoise(x * 2.03, y * 2.03, s + 7) * 0.3 + vnoise(x * 4.1, y * 4.1, s + 13) * 0.15;
// Worley: distances to the nearest and second nearest jittered point (F1, F2), and the nearest point's own random value.
const W = { f1: 0, f2: 0, id: 0 };
function worley(x, y, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j, px = cx + ih(cx, cy, s), py = cy + ih(cx, cy, s + 1);
    const d = Math.hypot(x - px, y - py);
    if (d < f1) { f2 = f1; f1 = d; id = ih(cx, cy, s + 2); } else if (d < f2) f2 = d;
  }
  W.f1 = f1; W.f2 = f2; W.id = id;
  return W;
}

// ---- palettes --------------------------------------------------------------------------------------------------------------------
// Tail colours (sRGB): root, strain colour, rim, ray streak, dark speckle, light spangle.
const TAIL = {
  red: { root: 0xff8a34, mid: 0xe8281c, rim: 0x9e0c1a, ray: 0xb41616, dark: 0x1c0806, spangle: 0xffb27a },
  blue: { root: 0x52d8e4, mid: 0x2e72ec, rim: 0x172892, ray: 0x1f4cbc, dark: 0x080b22, spangle: 0xb0f6ff },
  purple: { root: 0xe08ae6, mid: 0x9040d4, rim: 0x481888, ray: 0x6626ac, dark: 0x16081e, spangle: 0xf2c4ff },
  albino_red: { root: 0xffa25a, mid: 0xff3a28, rim: 0xd41c2a, ray: 0xe8302c, dark: 0xff7a6a, spangle: 0xffd6aa },
  albino_blue: { root: 0xeef8ff, mid: 0xa6daf8, rim: 0x62acea, ray: 0x88c4f0, dark: 0xc4e2f6, spangle: 0xffffff },
  albino_purple: { root: 0xffd4e6, mid: 0xf684c0, rim: 0xd24494, ray: 0xe868aa, dark: 0xf8b6d6, spangle: 0xffffff },
  // (7 Oct: the yellow, white and black genes; from the owner's photos: yellow cobra, white lyretail, full black)
  yellow: { root: 0xfff59a, mid: 0xffd424, rim: 0xe89a0c, ray: 0xe0b020, dark: 0x1a1406, spangle: 0xfffbd8 },
  lime: { root: 0xf0fca0, mid: 0xbee432, rim: 0x6ea818, ray: 0x9ac828, dark: 0x101806, spangle: 0xf8ffd8 },
  green: { root: 0xa8f4c4, mid: 0x30c486, rim: 0x0e7a64, ray: 0x20a078, dark: 0x061810, spangle: 0xd8fff0 },
  white: { root: 0xffffff, mid: 0xf4f6f8, rim: 0xdfe4ea, ray: 0xe6eaee, dark: 0x9aa0a8, spangle: 0xffffff },
  pastel: { root: 0xfffdf0, mid: 0xfff2c6, rim: 0xf4d898, ray: 0xf6e4b0, dark: 0xb8a070, spangle: 0xffffff },
  black: { root: 0x30323e, mid: 0x14151c, rim: 0x07070a, ray: 0x22242e, dark: 0x000000, spangle: 0x4a5a9a },
  albino_yellow: { root: 0xfff8c0, mid: 0xffe050, rim: 0xf4b830, ray: 0xf0c840, dark: 0xffd890, spangle: 0xffffff },
  albino_lime: { root: 0xf6ffc8, mid: 0xd4f070, rim: 0x9ad040, ray: 0xbce060, dark: 0xe0f0b0, spangle: 0xffffff },
  albino_green: { root: 0xd8fff0, mid: 0x8ae8c4, rim: 0x48c09c, ray: 0x70d8b4, dark: 0xc0eedc, spangle: 0xffffff },
  albino_white: { root: 0xffffff, mid: 0xfaf8f8, rim: 0xf0e4e4, ray: 0xf4ecec, dark: 0xf0d8d8, spangle: 0xffffff },
  albino_pastel: { root: 0xfffef6, mid: 0xfff6dc, rim: 0xfae6bc, ray: 0xfaecd0, dark: 0xf4e0c8, spangle: 0xffffff },
};
// Body grounds: back, upper flank, flank (silver), belly, scale edge (melanophore), scale centre glint (iridophore).
const GROUND = {
  wild: { back: 0x56543a, upper: 0x8a8866, flank: 0xc2c4b2, belly: 0xeeead8, edge: 0x34321f, glint: 0xe4ece6 },
  gold: { back: 0xb48634, upper: 0xd8b064, flank: 0xeed292, belly: 0xfff4d6, edge: 0x946426, glint: 0xfff4d0 },
  albino: { back: 0xe6bcae, upper: 0xf0cec2, flank: 0xf6e0d6, belly: 0xfff6f0, edge: 0xe0a696, glint: 0xffffff },
};
const IRIDESCENT = [hex(0x5ed4c8), hex(0x6a98f2), hex(0xe8a848)];     // teal, blue and gold sheens on a wild-type flank
const BLACK = { wild: hex(0x121014), gold: hex(0x3c2814), albino: null };
const MOSCOW = { red: hex(0x3c0a12), blue: hex(0x10184a), purple: hex(0x26103e), yellow: hex(0x3a3010), lime: hex(0x26300e), green: hex(0x0c2e24), white: hex(0x4a4c52), pastel: hex(0x4a4436), black: hex(0x0a0a0e) };

const P = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, hex(v)]));
const tailPal = (p) => {
  const k = p.ground === 'albino' ? `albino_${p.colour}` : p.colour;
  const t = P(TAIL[k] ?? TAIL[p.colour] ?? TAIL.red);
  if (p.ground === 'gold') { const g = hex(0xffc84a); t.root = mix(t.root, g, 0.25); t.mid = mix(t.mid, g, 0.08); t.dark = mix(t.dark, hex(0x5a3a10), 0.6); }
  return t;
};

// ---- the painter -----------------------------------------------------------------------------------------------------------------
// Colour and opacity at one texel of the atlas for a parsed look. Returns [r, g, b, a] (sRGB 0…1; a = how opaque a fin is there).
function makePainter(look) {
  const p = parseGuppyLook(look) ?? parseGuppyLook('red');
  const male = p.sex === 'male', juv = p.sex === 'juv', fem = p.sex === 'female';
  const G = P(GROUND[p.ground] ?? GROUND.wild), T = tailPal(p), albino = p.ground === 'albino';
  const black = BLACK[p.ground] ?? BLACK.wild;
  const SL = male ? 2.2 : 3.2;                                       // cm: pattern sizes are real sizes
  const show = male ? 1 : fem ? 0.55 : 0;                            // how much of the line's tail colour this fish shows
  const snake = male && (p.pattern === 'snakeskin' || p.pattern === 'tiger' || p.pattern === 'cobra'), mos = male && (p.pattern === 'mosaic' || p.pattern === 'tiger');
  const leo = male && (p.pattern === 'leopard' || p.pattern === 'cobra'), grass = male && p.pattern === 'grass';

  // Scales: rows of overlapping scales, 27 along the side and 9 across (Fishes of Texas: 26-28, 8-9). Returns
  // [edge 0…1 (the dark free margin), glint 0…1 (the light centre)] at body (s, v).
  const scale = (s, v) => {
    const a = (s - 0.24) / 0.76 * 27, b = v * 9;
    if (a < -0.5) return [0, 0];
    const row = Math.floor(b), off = row % 2 ? 0.5 : 0, col = Math.floor(a + off);
    const fa = a + off - col, fb = b - row;
    // a scale's exposed part is its rear: a crescent margin at fa -> 1, the centre glints
    const r = Math.hypot((fa - 0.35) * 1.15, fb - 0.5);
    const edge = sm(0.42, 0.52, r) * (1 - sm(0.62, 0.72, r)) + sm(0.82, 0.98, fa) * 0.6;
    return [Math.min(1, edge) * sm(-0.5, 0.5, a), (1 - sm(0.05, 0.38, r)) * (0.5 + 0.5 * ih(col, row, 5)) * sm(-0.5, 0.5, a)];
  };

  const body = (s, v) => {
    // v: 0 dorsal … 1 ventral
    let tux = 0;
    let c = mix(G.back, G.upper, sm(0.0, 0.3, v));
    c = mix(c, G.flank, sm(0.25, 0.55, v));
    c = mix(c, G.belly, sm(0.62, 0.9, v));
    // the head: darker on top, the gill cover with a gold-green sheen, the cheek silver
    const head = 1 - sm(0.22, 0.27, s);
    c = mix(c, mix(G.back, G.upper, 0.3), head * (1 - sm(0.1, 0.35, v)) * 0.6);
    if (!albino) c = mix(c, mix(hex(0xc8c870), hex(0x7ad0a8), fbm(s * 30, v * 12, 3)), head * sm(0.12, 0.2, s) * sm(0.35, 0.55, v) * (1 - sm(0.7, 0.85, v)) * 0.35);
    const [edge, glint] = scale(s, v);
    const fish = juv ? 0.45 : 1;
    // fry: see-through, grey; little pigment yet
    if (juv) {
      c = mix(c, hex(0xc8ccc0), 0.35);
      c = mix(c, G.edge, edge * 0.2);
      return [...c, 1];
    }
    // iridescent sheen on a wild-type flank, stronger in males (teal, blue, gold patches)
    if (!albino && !p.moscow) {
      const k = fbm(s * 9, v * 6, 11), which = IRIDESCENT[Math.floor(fbm(s * 4, v * 3, 17) * 2.99)];
      c = mix(c, which, sm(0.5, 0.75, k) * sm(0.24, 0.32, s) * (1 - sm(0.55, 0.7, s)) * sm(0.25, 0.4, v) * (1 - sm(0.65, 0.8, v)) * (male ? 0.55 : 0.2));
    }
    if (male) {
      // the rear body takes the strain colour, along an irregular front (not a straight fade)
      const front = 0.5 + 0.08 * (fbm(v * 5, 1.3, 23) - 0.5) - 0.05 * Math.sin(v * Math.PI);
      const rear = sm(front - 0.06, front + 0.12, s) * (1 - sm(0.8, 0.98, v) * 0.6);
      const rc = mix(T.mid, T.root, 0.35 * (1 - sm(0.6, 1.0, s)));
      c = mix(c, rc, rear * 0.88);
      if (p.colour === 'blue' && !albino) c = mix(c, hex(0x48a8f0), sm(0.28, 0.4, s) * (1 - sm(0.5, 0.6, s)) * sm(0.2, 0.35, v) * (1 - sm(0.6, 0.7, v)) * 0.5);   // blue lines carry a metallic blue flank
      if (p.moscow) {
        const dark = MOSCOW[p.colour];
        c = mix(c, mix(dark, T.mid, 0.25 * sm(0.0, 0.25, 1 - v) * sm(0.1, 0.3, s)), sm(0.08, 0.16, s) * (1 - sm(0.82, 0.98, v) * 0.5));
      }
      if (p.platinum) c = mix(c, mix(hex(0xf6f8fc), hex(0xd8ecff), fbm(s * 20, v * 9, 31) * 0.6), (1 - sm(0.36, 0.52, s + 0.08 * v)) * (1 - sm(0.55, 0.85, v)) * 0.92);
      // Japan blue: a metallic blue front half (the owner's Japan blue red sword); neon: a turquoise band high on the flank
      if (p.japan) c = mix(c, mix(hex(0x2c6cf0), hex(0x7ec8ff), fbm(s * 18, v * 8, 37) * 0.7), sm(0.1, 0.18, s) * (1 - sm(0.5, 0.62, s)) * sm(0.05, 0.25, v) * (1 - sm(0.65, 0.8, v)) * 0.85);
      if (p.neon) c = mix(c, mix(hex(0x20e0e8), hex(0x40a0ff), sm(0.2, 0.8, s)), sm(0.16, 0.22, s) * (1 - sm(0.78, 0.9, s)) * sm(0.14, 0.2, v) * (1 - sm(0.36, 0.44, v)) * 0.9);
      if (p.colour === 'black') c = mix(c, mul(T.mid, 1.4), sm(0.4, 0.62, s) * 0.85);              // black fins spill onto the stalk
      if (p.pattern === 'cobra') c = mix(c, albino ? hex(0xf0c890) : hex(0x14140c), sm(0.62, 0.7, vnoise(s * SL * 9, v * 2.2, 43)) * sm(0.2, 0.3, s) * (1 - sm(0.8, 0.92, v)) * 0.8);   // vertical cobra bars
      if (snake) {
        const w = worley(s * SL * 13, v * 8.5, 41), chain = sm(0.05, 0.0, w.f2 - w.f1) + sm(0.2, 0.12, w.f1) * 0.35;
        const ground = mul(c, 0.55), line = albino ? hex(0xffd2a0) : p.ground === 'gold' ? hex(0xfff0a0) : hex(0xd8e47a);
        const zone = sm(0.2, 0.3, s) * (1 - sm(0.82, 0.92, v));
        c = mix(c, mix(ground, line, Math.min(1, chain)), zone * 0.9);
      }
    } else {
      // female: the gravid spot, a dark triangle over the belly between the pelvic and anal fins (FishBase), darker with a brood
      // a triangle: wide at the belly, narrowing up the flank, soft at its edges
      const g = sm(0.44, 0.54, s + 0.25 * (v - 0.8)) * (1 - sm(0.6, 0.7, s - 0.25 * (v - 0.8))) * sm(0.5, 0.7, v) * (1 - sm(0.88, 0.97, v));
      c = mix(c, albino ? hex(0xf09a70) : p.ground === 'gold' ? hex(0x6a4418) : hex(0x1e1a14), g * (p.gravid ? 0.95 : 0.6));
      c = mix(c, mix(c, T.mid, 0.5), sm(0.78, 1.0, s) * show * 0.6);               // a blush of the line's colour on the stalk
    }
    if (p.tuxedo && black) {
      const cut = 0.5 + 0.06 * (v - 0.5) + 0.02 * (fbm(v * 6, 3.1, 47) - 0.5);
      const tx = sm(cut - 0.02, cut + 0.04, s) * (1 - sm(0.84, 0.97, v) * 0.7) * (male ? 0.96 : 0.85);
      c = mix(c, black, tx);
      tux = tx;
    }
    // reticulation: dark scale margins, light glinting centres
    const coloured = male ? sm(0.5, 0.7, s) : 0;                                   // the strain's colour hides the margins on a male's rear
    c = mix(c, mul(G.edge, p.moscow ? 0.5 : 1), edge * (albino ? 0.2 : 0.3) * fish * (1 - 0.6 * coloured));
    c = mix(c, G.glint, glint * (p.moscow ? 0.12 : 0.16) * sm(0.15, 0.4, v) * (1 - 0.5 * coloured) * (1 - tux));
    return [...c, 1];
  };

  // A fin in its own coordinates: x across the rays, y out along them; nRays for the ray streaks; kind for its colours.
  // strip: a texel of the male's tail strip (art-src/guppy/tails.py: x across the rays, y out along them over the whole tail), which
  // has no rays of its own: real ones are drawn, 16 from the stalk, each forking twice on its way out (at about 0.45 and 0.75), jointed,
  // wavering a little; the pigment sits on the rays and the membrane between them is clearer.
  const fin = (kind, x, y, nRays, strip = false) => {
    let ray, rid;
    if (strip) {
      const xr = x + 0.006 * Math.sin(y * 7 + x * 40) + 0.004 * (vnoise(x * 30, y * 6, 131) - 0.5);
      const w = 0.16 * (1 - 0.35 * y);
      const line = (v) => 1 - sm(w * 0.4, w, Math.abs(v - Math.round(v)));
      const r0 = line(xr * 16), r1 = line(xr * 32 + 0.5) * sm(0.38, 0.5, y), r2 = line(xr * 64) * sm(0.68, 0.8, y) * 0.85;
      const joint = 0.82 + 0.18 * sm(0.0, 0.25, Math.abs(((y * 26 + ih(Math.round(xr * 16), 5, 67)) % 1) - 0.5));
      ray = Math.max(r0, r1 * 0.9, r2) * joint * sm(0.0, 0.06, y);
      rid = ih(Math.round(xr * 32), 3, 61);
    } else {
      const rx = x * (nRays - 1), rj = Math.round(rx);
      ray = nRays ? 1 - sm(0.06, 0.2, Math.abs(rx - rj)) : 0;                       // on a ray (0: the model's texture has its own)
      rid = ih(rj, 3, 61);
    }
    let c, a;
    if (kind === 'pectoral' || kind === 'pelvic' || (kind === 'anal' && male)) {
      // clear membranes; a big-ear fish's pectorals are white, a male's edged with its colour
      c = mix(hex(0xdcdfd2), G.flank, 0.3);
      a = 0.32 + ray * 0.2;
      if (kind === 'pectoral' && p.dumbo) { c = mix(hex(0xf6f4f0), T.mid, male ? 0.12 : 0.05); c = mix(c, T.rim, sm(0.72, 0.95, y) * (male ? 0.7 : 0.3)); a = 0.85; }
      if (kind === 'pelvic' && male) c = mix(c, T.mid, sm(0.4, 0.9, y) * 0.6);
      if (kind === 'anal' && male) { c = mix(G.flank, hex(0x9a988a), 0.5); a = 0.9; }
      return [...mix(c, mul(c, 0.8), ray), a];
    }
    if (kind === 'anal') {                                                           // a female's anal fin: clear, faintly tinted
      c = mix(hex(0xdcdfd2), T.mid, 0.12 * show); return [...mix(c, mul(c, 0.82), ray), 0.42 + ray * 0.2];
    }
    // tail and dorsal: the strain's colours. On the long tails (swords, pin, lyre) the rays run out along the sword (t reaches 1 only
    // at its tip, art-src/guppy/tails.py): a sword carries the strain colour to its tip, with only its last part deepening.
    const long = kind === 'caudal' && LONG_TAILS.has(p.tail);
    const edgeK = sm(0.8, 0.98, y) * (long ? 0.35 : 1);
    c = mix(T.root, T.mid, sm(0.05, 0.42, y));
    c = mix(c, T.rim, (long ? sm(0.8, 1.0, y) * 0.45 : sm(0.55, 1.0, y)) * (0.75 + 0.25 * Math.abs(x * 2 - 1)));
    // streaks along the rays and faint lighter membrane between them; each ray its own shade
    c = mix(c, T.ray, ray * 0.35);
    c = mul(c, 0.93 + 0.12 * rid);
    // ~cm in the fin (the strip fans out: across the rays it is narrow at the stalk and wide at the rim, so spots stretch along the rays)
    const fx = strip ? x * (0.3 + 1.3 * y) * 1.4 * SL : x * (kind === 'caudal' ? 1.5 : 0.8) * SL, fy = y * (kind === 'caudal' ? 0.8 : 0.4) * SL;
    if (male) {
      // light spangles near the root (iridophores), dark speckles further out
      const sp = worley(fx * 14, fy * 14, 71);
      c = mix(c, T.spangle, sm(0.22, 0.1, sp.f1) * (sp.id > 0.55 ? 1 : 0) * (1 - sm(0.25, 0.5, y)) * 0.8);
      const dk = worley(fx * 9, fy * 9, 83);
      c = mix(c, T.dark, sm(0.2, 0.1, dk.f1) * (dk.id > 0.72 ? 1 : 0) * sm(0.15, 0.35, y) * (1 - sm(0.7, 0.9, y)) * (albino ? 0.4 : 0.7));
      if (mos) {
        // mosaic: a dark irregular network over a lighter root, fading out toward the rim
        // blotches drawn out along the rays and branching (an fbm threshold, stretched across the rays), with fine dark veins
        const n = fbm(fx * 6.5, fy * 2.6, 91), n2 = fbm(fx * 13, fy * 5, 97);
        const net = Math.max(sm(0.56, 0.63, n), sm(0.62, 0.68, n2) * 0.7);
        const reach = 1 - sm(kind === 'caudal' ? 0.5 : 0.7, kind === 'caudal' ? 0.8 : 1.0, y + 0.15 * (n - 0.5));
        c = mix(c, mix(T.root, hex(0xffffff), 0.25), reach * 0.45);
        c = mix(c, albino ? mul(T.rim, 0.8) : mix(T.dark, T.rim, 0.35), net * reach * 0.92);
        if (p.pattern === 'tiger') c = mix(c, T.dark, sm(0.62, 0.7, vnoise(fx * 1.2, fy * 7, 101)) * 0.7);
      }
      if (leo) {
        // leopard: bold dark spots and broken bars across the rays, larger toward the rim (the owner's leopard male, the yellow cobra)
        const w = worley(fx * 5.5, fy * 3.6, 109), spot = sm(0.3, 0.22, w.f1 * (0.85 + 0.3 * w.id)) * (w.id > 0.15 ? 1 : 0);
        c = mix(c, albino ? mul(T.rim, 0.7) : mix(T.dark, hex(0x050505), 0.6), spot * sm(0.08, 0.25, y) * 0.95);
      }
      if (grass) {
        const w = worley(fx * 20, fy * 20, 113);                                     // grass: many fine dark dots
        c = mix(c, albino ? mul(T.rim, 0.8) : T.dark, sm(0.17, 0.09, w.f1) * (w.id > 0.35 ? 1 : 0) * sm(0.1, 0.3, y) * 0.85);
      }
      if (p.pattern === 'snakeskin') {
        // lace: a fine dark web over the whole fin
        const w = worley(fx * 22, fy * 13, 103);
        c = mix(mix(c, hex(0xe8e070), 0.15), albino ? mul(T.rim, 0.85) : T.dark, sm(0.05, 0.0, w.f2 - w.f1) * 0.7 * (0.6 + 0.4 * sm(0.0, 0.3, y)));
      }
      if (kind === 'dorsal' && !mos && !leo && !grass && p.pattern !== 'snakeskin') {
        const d = worley(fx * 10, fy * 10, 107);                                    // fancy dorsals: a few dark spots
        c = mix(c, T.dark, sm(0.18, 0.08, d.f1) * (d.id > 0.6 ? 1 : 0) * 0.6 * (albino ? 0.4 : 1));
      }
      if (p.tuxedo && black && kind === 'caudal') c = mix(c, black, (1 - sm(0.0, 0.16, y)) * 0.6);
      if (kind === 'caudal' && p.tail === 'doublesword' && Math.abs(x * 2 - 1) > 0.9) c = mix(c, albino ? T.rim : black ?? T.rim, sm(0.93, 0.99, Math.abs(x * 2 - 1)) * 0.6);   // the swords' outer edges dark
      c = mix(c, mul(T.rim, 0.75), edgeK * 0.5);
      a = 0.95 - 0.2 * edgeK + 0.05 * ray;
      if (strip) {
        // the membrane between the rays clearer and lighter, the rays deeper; the root translucent, taking the stalk's colour; the margin
        // paler (the game thins and frays it further: material.js finFray)
        const memb = mix(c, mix(c, hex(0xffffff), 0.18), 0.6), deep = mul(mix(c, T.ray, 0.35), 0.8);
        c = mix(memb, deep, ray);
        c = mix(mix(mix(T.root, G.flank, 0.35), c, 0.5), c, sm(0.03, 0.2, y));
        if (!long) c = mix(c, mix(T.mid, hex(0xffffff), 0.35), sm(0.86, 1.0, y) * 0.3);
        a = (0.62 + 0.34 * ray) * (0.7 + 0.3 * sm(0.0, 0.2, y));
      }
    } else {
      // females and fry: a clear fin washed with the line's colour, a few dark speckles
      const clear = mix(hex(0xd4d8c8), G.flank, 0.3);
      c = mix(clear, c, show * (0.6 + 0.3 * sm(0.2, 0.8, y)));
      const dk = worley(fx * 8, fy * 8, 113);
      c = mix(c, mul(G.edge, 0.8), sm(0.16, 0.08, dk.f1) * (dk.id > 0.75 ? 1 : 0) * 0.5 * (juv ? 0.3 : 1) * (albino ? 0.3 : 1));
      c = mix(c, mul(c, 0.82), ray);
      a = (juv ? 0.3 : 0.45 + 0.3 * show) - 0.12 * edgeK + 0.12 * ray;
    }
    return [...c, a];
  };

  return { p, body, fin, T, G, male, juv, albino, black };
}

// ---- painting onto a model ---------------------------------------------------------------------------------------------------------
const PART = { 255: 'body', 200: 'caudal', 160: 'dorsal', 120: 'pectoral', 80: 'ventral' };
const lumOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
// A box blur of the luminance (radius r texels), separable: the local mean the detail is measured against.
function blurLum(L, N, r, H = N) {
  const tmp = new Float32Array(N * H), out = new Float32Array(N * H), w = 2 * r + 1;
  for (let y = 0; y < H; y++) { let acc = 0; for (let x = -r; x <= r; x++) acc += L[y * N + Math.min(N - 1, Math.max(0, x))];
    for (let x = 0; x < N; x++) { tmp[y * N + x] = acc / w; acc += L[y * N + Math.min(N - 1, x + r + 1)] - L[y * N + Math.max(0, x - r)]; } }
  for (let x = 0; x < N; x++) { let acc = 0; for (let y = -r; y <= r; y++) acc += tmp[Math.min(H - 1, Math.max(0, y)) * N + x];
    for (let y = 0; y < H; y++) { out[y * N + x] = acc / w; acc += tmp[Math.min(H - 1, y + r + 1) * N + x] - tmp[Math.max(0, y - r) * N + x]; } }
  return out;
}
const GOLD_RAMP = [hex(0x5a3c14), hex(0xc89a44), hex(0xfff0c0)], ALBINO_RAMP = [hex(0xd8a090), hex(0xf2d4c8), hex(0xfffaf6)];
const LONG_TAILS = new Set(['topsword', 'bottomsword', 'doublesword', 'lyre', 'pin']);
const ramp = (R, L) => (L < 0.5 ? mix(R[0], R[1], L * 2) : mix(R[1], R[2], (L - 0.5) * 2));

// The texture of one look on one model: { N, H, rgba } (N wide, H high, row 0 at the top, as the maps). maps: { N, H, coords, parts,
// base } (RGBA bytes; H defaults to N: the male's maps are taller, his tails' strip below his own atlas: art-src/guppy/tails.py).
export function paintGuppyModel(look, maps) {
  const { N, coords, parts, base } = maps, H = maps.H ?? N, P = makePainter(look), { p, T, male, juv, albino, black } = P;
  const L = new Float32Array(N * H);
  for (let i = 0; i < N * H; i++) L[i] = lumOf(base[i * 4], base[i * 4 + 1], base[i * 4 + 2]) / 255;
  const M = blurLum(L, N, 2, H);
  const out = new Uint8ClampedArray(N * H * 4);
  for (let i = 0; i < N * H; i++) {
    const k = i * 4, pv = parts[k], part = pv < 40 ? null : PART[[255, 200, 160, 120, 80].reduce((m, q) => (Math.abs(q - pv) < Math.abs(m - pv) ? q : m), 255)];
    const b = [base[k] / 255, base[k + 1] / 255, base[k + 2] / 255];
    if (!part) { out[k] = base[k]; out[k + 1] = base[k + 1]; out[k + 2] = base[k + 2]; out[k + 3] = 255; continue; }
    const u = coords[k] / 255, w = coords[k + 1] / 255;
    const detail = Math.min(1.35, Math.max(0.65, (L[i] + 0.02) / (M[i] + 0.02)));
    let c, a = 1;
    if (part === 'body') {
      const s = u, v = w, Lb = L[i];
      c = b;
      if (s < 0.14 && Lb < 0.07) { out[k] = base[k]; out[k + 1] = base[k + 1]; out[k + 2] = base[k + 2]; out[k + 3] = 255; continue; }   // the eye
      if (p.ground === 'gold') c = mix(c, ramp(GOLD_RAMP, Math.min(1, Lb * 1.4)), 0.8);
      if (albino) c = mix(c, ramp(ALBINO_RAMP, Math.min(1, 0.35 + Lb)), 0.88);
      if (!male && !albino) {
        // females and fry: the wild female's olive back, silver flank and white belly with dark-edged scales (P.body), on the model's own
        // shading; the model's blue tint and red snout come from a male's photo
        const fb = mul(P.body(s, v), detail * (0.8 + 0.4 * Math.min(1, Lb * 2)));
        c = mix(c, p.ground === 'gold' ? mix(fb, ramp(GOLD_RAMP, Math.min(1, Lb * 1.4)), 0.5) : fb, 0.9);
        if (juv) c = mix(c, hex(0xc4c8bc), 0.35);
      } else if (juv) c = mix(c, mix(hex(0xc8ccc0), c, 0.5), 0.5);
      if (!juv && male) {
        const sc = P.body(s, v);                                                           // the strain's body (rear colour, patterns, spot)
        // keep the model's shading and scales: the strain colour scaled by the texel's brightness against its neighbourhood
        const strain = mul(sc, detail * (0.75 + 0.5 * Math.min(1, Lb * 2.2)));
        const rear = male ? sm(0.45, 0.8, s) : 0;
        const over = Math.max(rear * 0.75, p.moscow && male ? sm(0.08, 0.16, s) * 0.85 : 0, p.platinum && male ? (1 - sm(0.36, 0.52, s + 0.08 * v)) * (1 - sm(0.55, 0.85, v)) * 0.85 : 0,
          p.tuxedo && black ? sm(0.48, 0.56, s) * 0.92 : 0, (male && (p.pattern === 'snakeskin' || p.pattern === 'tiger' || p.pattern === 'cobra')) ? sm(0.2, 0.3, s) * 0.7 : 0,
          p.japan ? sm(0.1, 0.18, s) * (1 - sm(0.5, 0.62, s)) * sm(0.05, 0.25, v) * (1 - sm(0.65, 0.8, v)) * 0.85 : 0,
          p.neon ? sm(0.16, 0.22, s) * (1 - sm(0.78, 0.9, s)) * sm(0.14, 0.2, v) * (1 - sm(0.36, 0.44, v)) * 0.9 : 0,
          !male ? sm(0.48, 0.55, s) * (1 - sm(0.62, 0.68, s)) * sm(0.55, 0.68, v) * 0.9 : 0);
        c = mix(c, strain, over);
      }
    } else {
      const f = P.fin(part === 'ventral' ? 'anal' : part, u, w, 0, coords[k + 2] > 200);   // (blue 255: the male's tail strip)
      c = mul([f[0], f[1], f[2]], 0.92 + (coords[k + 2] > 200 ? 0.06 : 0.16) * (detail - 0.65) / 0.7);   // the model's fine rays and edges, not its spots
      a = f[3];
      if (part === 'ventral' || part === 'pectoral') { c = mix(c, b, 0.5); }                 // small clear fins: mostly the model's own
    }
    out[k] = c[0] * 255; out[k + 1] = c[1] * 255; out[k + 2] = c[2] * 255; out[k + 3] = Math.max(0, Math.min(1, a)) * 255;
  }
  return { N, H, rgba: out };
}
