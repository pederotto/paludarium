// The frog's head muscles (docs/MUSCLES.md "Head"; the owner, 5 Oct: "muscle mechanics should also be applied to breathing,mouth and
// head movements"): the buccal pump that breathes it (the throat floor and the lungs), the swallow, the jaw and the neck, from
// .agents/muscles/research/head-muscles.json (R3b, checked by C1b). The game's frog has one head bone and no jaw or hyoid bone, so the
// pump moves the rig's channels (render/creatures/instanced.js): the throat floor's travel is `throat`, the lungs' fill is `breath`
// (the flanks), the eyes pulled down into the mouth are `eye`.
//
// A frog breathes with its mouth, not its ribs (it has none): with the nostrils open, the sternohyoid lowers the throat floor and
// draws air into the mouth, then the floor muscles raise it and push the air back out, about 90 times a minute (buccal oscillation:
// the throat flutter one sees). Every dozen or so cycles comes a lung breath: the floor drops deep, the glottis opens and the lungs
// empty into the mouth (the flanks sink), mixing with the fresh air there, then the nostrils shut and the floor rises hard, pumping
// the mixture back into the lungs (the flanks fill), and the glottis closes on it. (Vitalis & Shelton 1990, Rana pipiens: 90 ± 3.2
// buccal oscillations and 6.3 ± 0.8 lung ventilations a minute, two nostril expirations to a lung ventilation; checked by C1b round 5.) The floor is a mass on its elastic tissue moved by two Hill muscles with
// activation dynamics (util/musculo.js), so its travel comes from the forces, not from a sine.
import { forceLength, forceVelocity, activationStep } from '../util/musculo.js';

const K21 = 'Kunisch et al. 2021, J Anat (PMC8273601)', K22 = 'Keeffe et al. 2022, Integr Org Biol (PMC9665897)';
const VS90 = 'Vitalis & Shelton 1990, J Exp Biol 154:537 (abstract)';

// The groups the game moves, each from its members in head-muscles.json: origin, insertion, action, source.
export const HEAD_MUSCLES = [
  { id: 'SH', members: ['SH', 'OH'], from: 'pectoral girdle (epicoracoid; OH the scapula)', to: 'hyoid plate', drives: 'throat',
    acts: 'retracts the hyoid and expands the buccal cavity (the throat floor drops): air drawn into the mouth', src: `${K21} 4.4; OH ${K22}`, tag: 'scaled',
    note: 'the paper says retracts and expands; "lowers the floor" is read from it (C1b round 5, A1 item 19)' },
  { id: 'FLOOR', members: ['IM', 'IH', 'GH', 'PHA', 'PHP'], from: 'mandible rami, hyoid horns, otic capsule', to: 'midline raphe, hyoid plate',
    drives: 'throat', acts: 'raise the throat floor: air pushed out, or into the lungs with the nostrils shut', src: `${K21} 4.4; ${K22}`, tag: 'measured' },
  { id: 'DM', members: ['DM'], from: 'epaxial fascia behind the otic capsule', to: 'posterior end of the mandible', drives: 'mouth (the jaw bone of a one-body frog: util/frogstrike.js strikeMuscles)',
    acts: 'opens the mouth, before the tongue goes out', src: `${K21} 3.2, 4.4`, tag: 'measured' },
  { id: 'AM', members: ['AM_LAT', 'AM_EXT', 'AM_POST', 'AM_LONG_INT'], from: 'squamosal and skull', to: 'mandible', drives: 'mouth (the jaw bone of a one-body frog)',
    acts: 'close the jaw', src: `${K21} 3.2`, tag: 'measured' },
  // the tongue (gate 4, 7 Oct 2026: a one-body frog's four tongue bones, util/frogstrike.js): in Rana the jaw's fast drop flings the soft tongue out over the jaw tip (inertial
  // elongation), the genioglossus helping it up and forward; the hyoglossus, from the hyoid, draws it back in (Hu lab review 2018; Nishikawa's kinematic work on Rana)
  { id: 'GG', members: ['genioglossus'], from: 'mandible, behind the symphysis', to: 'the tongue', drives: 'tongue (one-body frog)',
    acts: 'stiffens and lifts the tongue as the jaw drops: it flips over the jaw tip', src: 'Hu lab tongue review 2018 (Georgia Tech); Nishikawa kinematics, Rana', tag: 'guess', note: 'the timing is the strike timeline\'s, not measured' },
  { id: 'HG', members: ['hyoglossus'], from: 'hyoid plate', to: 'the tongue', drives: 'tongue (one-body frog)',
    acts: 'draws the tongue back into the mouth with the prey', src: 'Hu lab tongue review 2018', tag: 'guess' },
  { id: 'RB', members: ['retractor bulbi'], from: 'braincase', to: 'eyeball', drives: 'eye',
    acts: 'pulls the eyes down into the mouth: blinking, and pushing a swallowed prey back (with it denervated, swallowing needed 74 % more swallows a cricket)',
    src: 'Levine, Monroy & Brainerd 2004, J Exp Biol 207:1361 (abstract; A1 item 21)', tag: 'measured' },
  { id: 'NECK', members: ['ITC', 'LDS', 'RC'], from: 'atlas and vertebrae', to: 'exoccipital', drives: 'none: the frog turns its body to look',
    acts: 'raise, lower and turn the head on the atlas', src: 'not found (head-muscles.json notFound)', tag: 'guess' },
];

export const BUCCAL = {
  rate: { value: 1.5, unit: 'Hz', src: `${VS90}: 90 ± 3.2 a minute, Rana pipiens`, tag: 'scaled', note: 'the same for the dart frog; no dendrobatid number found' },
  lungEvery: { value: 14, unit: 'buccal cycles', src: `${VS90}: 90 / 6.3, the ratio of the two means`, tag: 'scaled' },
  alert: { value: 0.3, note: 'up to 30 % faster when it is busy or wary', tag: 'guess' },
  // the lung breath's phases (s from its start; no durations in the abstract: guesses at about one buccal cycle and a half): the floor
  // held down while the lungs empty into the mouth (released early, its own spring raised it before the pump and the lungs stayed
  // half empty), then the pump
  lung: { deep: [0, 0.5], exhale: [0.22, 0.5], pump: [0.5, 0.82], end: 1.0, tag: 'guess' },
  // the floor: a unit mass on its elastic tissue (natural frequency `hz`, damping `zeta`), at rest a little lowered (`rest` of its travel);
  // the sternohyoid at full activation holds it near fully lowered, the floor muscles near closed. Muscle lengths change by `strain`
  // of their optimum over the floor's whole travel; Vmax in optimal lengths a second (Hill: util/musculo.js).
  floor: { hz: 5, zeta: 0.8, rest: 0.1, lowF: 0.95, highF: 0.55, strain: 0.25, vmax: 8, tag: 'guess' },
  // the excitations: a buccal cycle's lowering and raising halves, a lung breath's full ones
  drive: { osc: [0.32, 0.26], lung: [1, 1], tag: 'guess' },
  exhaleTau: { value: 0.07, unit: 's', note: 'the lungs empty by their own recoil and the flank muscles', tag: 'guess' },
  pumpGain: { value: 3.2, note: 'lung fill per unit of floor rise with the nostrils shut', tag: 'guess' },
  lungRest: { value: 0.18, note: 'the lungs are never empty: the fill after an exhalation', tag: 'guess' },
};

// A pump's state, started at a random point of its cycle (r0, r1: 0 … 1).
export function buccalState(r0 = Math.random(), r1 = Math.random()) {
  return { ph: r0, n: 0, every: nextEvery(r1), mode: 'osc', lt: 0, y: BUCCAL.floor.rest, vy: 0, aLo: 0, aHi: 0, lung: 0.9, cycles: 0, breaths: 0 };
}
const nextEvery = (r) => Math.round(BUCCAL.lungEvery.value * (0.75 + 0.5 * r));

// The floor's two muscles' forces (over the floor's mass) at its place y (0 closed … 1 fully lowered) moving at vy (1/s, + lowering).
function floorForces(s) {
  const F = BUCCAL.floor, w = 2 * Math.PI * F.hz, k = w * w;
  const lLo = 1 + F.strain * (0.5 - s.y), lHi = 1 - F.strain * (0.5 - s.y);       // (lowering shortens the sternohyoid)
  const vLo = (F.strain * s.vy) / F.vmax, vHi = -vLo;
  const lo = k * F.lowF * s.aLo * forceLength(lLo) * forceVelocity(vLo);
  const hi = k * F.highF * s.aHi * forceLength(lHi) * forceVelocity(vHi);
  return { lo, hi, k, c: 2 * F.zeta * w };
}

// Advance the pump by dt seconds. `alert` 0 … 1 (a busy or wary frog pumps faster); `extra` { lo, hi } excitations added for a swallow
// or a strike. Returns the state: s.y the throat floor (0 … 1), s.lung the lungs' fill (0 … 1).
export function buccalStep(s, dt, alert = 0, extra = null, rnd = Math.random) {
  const D = BUCCAL.drive, Lp = BUCCAL.lung;
  for (let left = Math.max(0, Math.min(dt, 0.25)); left > 1e-6;) {
    const h = Math.min(left, 1 / 480);
    left -= h;
    let eLo = 0, eHi = 0;
    if (s.mode === 'osc') {
      s.ph += h * BUCCAL.rate.value * (1 + BUCCAL.alert.value * alert);
      if (s.ph >= 1) {
        s.ph -= 1; s.cycles++;
        if (++s.n >= s.every) { s.mode = 'lung'; s.lt = 0; s.n = 0; s.every = nextEvery(rnd()); }
      }
      if (s.mode === 'osc') { eLo = s.ph < 0.45 ? D.osc[0] : 0; eHi = s.ph >= 0.5 && s.ph < 0.92 ? D.osc[1] : 0; }
    }
    if (s.mode === 'lung') {
      const t = (s.lt += h);
      eLo = t >= Lp.deep[0] && t < Lp.deep[1] ? D.lung[0] : 0;
      eHi = t >= Lp.pump[0] && t < Lp.pump[1] ? D.lung[1] : 0;
      // the glottis open: the lungs empty, then take the mouthful the rising floor pushes in with the nostrils shut
      if (t >= Lp.exhale[0] && t < Lp.exhale[1]) s.lung += (BUCCAL.lungRest.value - s.lung) * (1 - Math.exp(-h / BUCCAL.exhaleTau.value));
      if (t >= Lp.pump[0] && t < Lp.pump[1] && s.vy < 0) s.lung = Math.min(1, s.lung + BUCCAL.pumpGain.value * -s.vy * h * (1 - s.lung));
      if (t >= Lp.end) { s.mode = 'osc'; s.ph = 0; s.breaths++; }
    }
    if (extra) { eLo = Math.max(eLo, extra.lo ?? 0); eHi = Math.max(eHi, extra.hi ?? 0); }
    s.aLo = activationStep(s.aLo, eLo, h, 0.015, 0.05);
    s.aHi = activationStep(s.aHi, eHi, h, 0.015, 0.05);
    const f = floorForces(s), acc = f.lo - f.hi - f.k * (s.y - BUCCAL.floor.rest) - f.c * s.vy;
    s.vy += acc * h;
    s.y += s.vy * h;
    if (s.y < 0) { s.y = 0; s.vy = Math.max(0, s.vy); }          // (closed: the floor against the roof of the mouth)
    if (s.y > 1) { s.y = 1; s.vy = Math.min(0, s.vy); }
  }
  return s;
}

// The rig's channels from the pump: the throat (the floor's travel, to 0.36 of the vocal sac's full range: a lung breath's deep drop
// about a third of a calling frog's sac) and the flanks (the lungs' fill).
export const pumpThroat = (s) => 0.36 * s.y;
export const pumpBreath = (s) => s.lung;

// A swallow (sim/animals.js 'gulp', `u` 0 … 1 through it): two pushes, each the eyes pulled down into the mouth (the retractor bulbi)
// with the floor raised behind the prey; returns { eye (excitation), hi (floor excitation) }. The eye channel follows its own
// activation (RB: slower to relax than to pull).
export function swallowDrive(u) {
  const k = (u * 2) % 1, on = u < 1 && k < 0.55;
  return { eye: on ? 1 : 0, hi: on ? 0.8 : 0 };
}
export const eyeStep = (a, e, dt) => activationStep(a, e, dt, 0.03, 0.09);
