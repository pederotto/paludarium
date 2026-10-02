// Vampire crab (Geosesarma): a violet carapace, darker in the grooves and lighter at the front rim, a mauve-grey
// underside, purple legs with pale tan joints and amber-tipped dactyls, golden-yellow claws whose arms stay purple and
// whose fingertips fade to cream, yellow eyes on purple stalks (the pupil is drawn by the analytic eye shader).
// Receives v.part ('shell' | 'leg' | 'claw' | 'eye') and v.ao (0 open … 1 deep crevice) from the crab rig.
import { hex, mix3, sstep, fbm, vnoise, cells } from './common.mjs';

const VIO = hex(0x3c2766), VIO_L = hex(0x6a54a0), VIO_D = hex(0x1b1030), MAUVE = hex(0x6c5e82);
const LEG = hex(0x3a2460), LEG_D = hex(0x22143c), JOINT = hex(0xa08058), AMBER = hex(0x9a5a1c);
const GOLD = hex(0xf2b52c), GOLD_D = hex(0xd88a1a), CREAM = hex(0xf6e2b0), EYE = hex(0xf0c428);

export function paint(v) {
  const w = fbm(v.x * 1.6, v.y * 1.6, v.z * 1.6);
  const speck = vnoise(v.x * 9, v.y * 9, v.z * 9);
  const up = v.n[1];
  const shade = 1 - 0.55 * (v.ao ?? 0);
  let c;
  if (v.part === 'eye') {
    c = mix3(VIO, EYE, sstep(0.45, 0.6, v.eyeT ?? 0));
  } else if (v.part === 'claw') {
    // purple arm, a short blend over the wrist, golden palm, cream fingertips; a darker gold underneath
    const arm = 1 - sstep(0.22, 0.4, v.legT);
    c = mix3(mix3(GOLD, GOLD_D, 0.3 + 0.4 * (1 - sstep(-0.2, 0.6, up)) + 0.2 * (w - 0.5)), CREAM, sstep(0.82, 0.97, v.legT));
    c = mix3(c, mix3(LEG, VIO_L, 0.3 * w), arm);
    c = mix3(c, hex(0xffe7a0), 0.25 * sstep(0.72, 0.8, speck) * (1 - arm));          // fine pale granules on the palm
  } else if (v.part === 'leg') {
    // segments: pale joints at the knee, ankle and wrist; the last segment (dactyl) ends in an amber claw
    const t = v.legT;
    const joint = Math.max(...[0.3, 0.55, 0.78].map((j) => 1 - sstep(0.0, 0.035, Math.abs(t - j))));
    c = mix3(LEG, VIO_L, 0.15 + 0.35 * sstep(0.2, 0.9, up) * w);
    c = mix3(c, LEG_D, 0.35 * (1 - sstep(-0.3, 0.3, up)));
    c = mix3(c, JOINT, 0.5 * joint);
    c = mix3(c, AMBER, sstep(0.88, 0.97, t));
  } else {
    // shell: violet on top with darker grooves and a lighter front rim; mauve-grey underneath
    const top = sstep(-0.1, 0.45, up);
    c = mix3(VIO_D, VIO, 0.55 + 0.45 * w);
    c = mix3(c, VIO_L, 0.35 * sstep(0.55, 0.85, w) * top);
    c = mix3(c, VIO_L, 0.45 * top * sstep(0.55, 0.85, v.zf ?? 0));                    // the frontal rim catches light
    c = mix3(MAUVE, c, top);
  }
  return c.map((k) => k * shade);
}

// Per texel (1024 texture, about 140 texels per cm): the same colours as `paint` plus the detail a vertex cannot hold,
// sized to read at play distance. Shell: a two-tone mottle, pale granules (0.3-0.5 mm) thickest towards the rim, dark pits,
// dark grooves (occlusion), the pale front rim. Legs: a dark band in each segment, pale joints, rows of dark bristle spots,
// amber-brown dactyl tips. Claws: raised granules (a bright cap with an orange-brown ring), orange at the wrist and along the
// finger edges, cream fingertips.
export function texel(v) {
  const base = paint({ ...v, ao: 0 });
  const [d1, id1] = cells(v.x * 7, v.y * 7, v.z * 7);                 // 1.4 mm cells: granules, tubercles
  const [d2, id2] = cells(v.x * 16 + 7, v.y * 16, v.z * 16);          // 0.6 mm cells: pits, bristles
  const m1 = fbm(v.x * 3, v.y * 3, v.z * 3), m2 = fbm(v.x * 9 + 3, v.y * 9, v.z * 9);
  const up = v.n[1];
  const dot = (d, r) => 1 - sstep(r * 0.6, r, d);
  let c = base;
  if (v.part === 'shell') {
    c = mix3(c, mix3(VIO_D, VIO, 0.35), 0.65 * sstep(0.48, 0.68, m1));                       // dark blotches
    c = mix3(c, VIO_L, 0.35 * sstep(0.55, 0.75, m2) * sstep(0, 0.5, up));                    // light patches on top
    const rimW = sstep(0.55, 0.95, Math.abs(v.x) / 1.05) + sstep(0.75, 0.95, v.zf ?? 0);
    c = mix3(c, hex(0xa898d0), 0.7 * dot(d1, 0.32) * sstep(0.45, 0.8, id1) * sstep(-0.2, 0.4, up) * (0.4 + 0.6 * Math.min(1, rimW)));   // granules
    c = mix3(c, hex(0x120a1e), 0.6 * dot(d2, 0.22) * sstep(0.6, 0.85, id2));               // pits
  } else if (v.part === 'leg') {
    const J = [0, 0.3, 0.55, 0.78, 1.01];
    let k = 0; while (k < 3 && v.legT >= J[k + 1]) k++;
    const s = (v.legT - J[k]) / (J[k + 1] - J[k]);
    c = mix3(c, LEG_D, 0.55 * Math.sin(Math.PI * s) * sstep(0.35, 0.65, m1 + 0.2 * up));      // dark mid-segment band
    c = mix3(c, hex(0x7a62a8), 0.4 * sstep(0.5, 0.9, up) * sstep(0.45, 0.7, m2));            // light upper ridge
    c = mix3(c, hex(0x120a18), 0.8 * dot(d2, 0.28) * sstep(0.55, 0.8, id2) * sstep(0.15, 0.4, v.legT));   // bristle spots
  } else if (v.part === 'claw' && v.legT > 0.3) {
    const live = 1 - sstep(0.8, 0.9, v.legT);
    const gran = dot(d1, 0.38) * sstep(0.3, 0.7, id1) * live;
    const ring = sstep(0.28, 0.38, d1) * (1 - sstep(0.38, 0.5, d1)) * sstep(0.3, 0.7, id1) * live;
    c = mix3(c, hex(0xffe9a6), 0.55 * gran * sstep(-0.4, 0.4, up));                          // granule caps
    c = mix3(c, hex(0xa85a12), 0.5 * ring);                                                   // their shaded rims
    c = mix3(c, hex(0xc86a18), 0.6 * (1 - sstep(0.3, 0.52, v.legT)) + 0.3 * sstep(0.55, 0.75, m2) * live);   // orange wrist, blotches
  } else if (v.part === 'claw') {
    c = mix3(c, hex(0x2a1640), 0.4 * sstep(0.5, 0.7, m2));
  }
  const shade = 1 - 0.65 * Math.pow(v.ao ?? 0, 0.75);
  return c.map((q) => q * shade);
}
