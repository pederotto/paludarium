// The hardware around a tank comes in real sizes, not in sizes scaled to the tank, and that is much of how a keeper
// tells a big tank from a small one: thin glass and one short lamp on a desk cube, thick glass, two or three lamps and a
// long cabinet under a show tank. Pure numbers in centimetres (engine/stage.js builds from them, engine/camera.js frames
// the room with them, tests/fittings.test.mjs checks them). The standard tank (90 x 45 x 60) keeps the sizes it always had.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;

// Glass thickness. Real tanks: about 4 mm for a desk cube, 5 mm for 60 cm, 8 mm for 90 to 120 cm and 10 to 12 mm for 150
// to 180 cm, a little more for a tall front (the pressure of the water grows with the height). The standard tank's panes
// stay 6 mm, as they have always been drawn.
export function glassThickness(w, h) {
  const byLength = w <= 40 ? 0.4 : w <= 90 ? lerp(0.4, 0.6, (w - 40) / 50) : lerp(0.6, 1.2, Math.min(1, (w - 90) / 90));
  const byHeight = h > 70 ? (h - 70) * 0.01 : 0;
  return Math.round(clamp(byLength + byHeight, 0.4, 1.2) * 20) / 20;
}

// The black trim round the edges: a little heavier on a big tank, as before (1.2 cm on the standard tank).
export const trimThickness = (w) => clamp(w / 75, 0.9, 1.4);

// LED bars come in a few fixed lengths. An open tank gets one bar up to about a metre wide and two or three side by side
// beyond that, each the longest stock length that leaves the tank's ends uncovered (the standard tank keeps its 75 cm bar;
// a 30 cm cube gets a 20 cm nano lamp). Returns the bars' centres (x) and lengths, left to right.
export const BAR_LENGTHS = [20, 30, 45, 60, 75, 90, 120];
export function lightBars(w) {
  const n = w <= 100 ? 1 : w <= 160 ? 2 : 3;
  const want = (w * 0.8) / n, room = (w / n) * 0.95;
  const fit = BAR_LENGTHS.filter((l) => l <= room);
  const len = fit.length ? fit.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a)) : BAR_LENGTHS[0];
  return Array.from({ length: n }, (_, i) => ({ x: w * ((i + 0.5) / n - 0.5), len }));
}

// A bar's cross-section: a nano lamp is slimmer than a 120 cm bar (the standard tank's 75 cm bar keeps 1.2 x 5 cm).
export const barSection = (len) => ({ h: clamp(0.9 + len / 250, 0.9, 1.4), d: clamp(3 + len / 37.5, 3.5, 6) });

// What the tank stands on. A small tank stands on a side table that is the same whatever sits on it (so the jar looks
// small on it); anything bigger gets a cabinet as long and deep as the tank, 70 cm high for up to a metre and a little
// higher under the long ones (real stands for 150 to 180 cm tanks are about 80 cm), with doors about half a metre wide.
// `outW`/`outD`: the tank's outside size (glass and trim included). Heights are from the floor to the cabinet's top.
export function furniture(outW, outD) {
  if (outW <= 50 && outD <= 40) return { kind: 'table', w: 70, d: 44, h: 62 };
  const w = outW + 2, d = outD + 2;
  return { kind: 'cabinet', w, d, h: Math.round(clamp(70 + (outW - 92) * 0.17, 70, 82)), doors: Math.max(1, Math.round(w / 50)) };
}

// The tank's outside size and what it stands on, from its inside size (Stage builds them, roomFrame frames them).
export function roomScene(t) {
  const g = glassThickness(t.w, t.h), trim = t.closed ? 0 : trimThickness(t.w);
  const outW = t.w + 2 * (g + trim), outD = t.d + 2 * (g + trim);
  return { g, trim, outW, outD, furn: furniture(outW, outD) };
}

// The room view (title screen) is framed at a physical scale, and always shows the whole scene: the lamp, the tank, the
// furniture down to the floor and the skirting, with the pot plant and the light switch beside it, so the things that never
// change size (a 70 to 82 cm cabinet, 50 cm doors, a switch a metre up, the plant) say how big the tank is. The frame grows
// more slowly than the tank: on a 16:9 screen the tank's share of the width goes from about a sixth (the jar) to a third
// (the standard tank) and a half (the show tank), and a long low tank stops at 55%. Returns the width and height (cm) to
// fit, and the height of the frame's middle (y, the tank's floor at 0): the floor stays at the bottom of the frame and any
// spare height goes above.
export const ROOM_SHARE = 0.55;
export function roomFrame(t) {
  const { outW, furn } = roomScene(t);
  const bottom = -0.8 - furn.h - 5, top = t.h + (t.closed ? 13 : 7), tall = (top - bottom) * 1.04;
  const w = Math.max((tall * 16) / 9, Math.max(outW, furn.w) + 90, t.w / ROOM_SHARE);
  const h = Math.max(tall, (w * 9) / 16);
  return { w, h, y: bottom - tall * 0.02 + h / 2 };
}
