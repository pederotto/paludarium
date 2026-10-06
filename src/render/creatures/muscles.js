// The visible muscles of a skinned frog (docs/MUSCLES.md): each frame, after its bones, the state of every visible belly is written
// into the instance's row of the bone texture, one texel a belly after the bones, for the vertex shader (skin.js skinVertex) to push
// the skin over it out or in. The state comes from the muscle layer, not from a joint angle: the belly's muscle-tendon length in this
// pose (content/anuranmuscles.js, tendons wrapped over the knee and ankle), its fibres in equilibrium with the tendon at the activation
// the motion asks for (musculo.js fibreState, `excitation`), and the belly keeping its volume as its fibres shorten or lengthen
// (bellyChange: thicker and bunched toward its origin, or thinner and drawn out). Texel: [dR / R0, slide (belly lengths), activation, 0].
import { anuranMuscleSet, anuranFrames, muscleUnit, musclePathLength, visibleSlots, excitation, MOTOR } from '../../content/anuranmuscles.js';
import { fibreState, bellyChange, movePoint } from '../../util/musculo.js';

// on: off with ?nomuscle (the bellies stay at rest: the skin as the bones alone draw it), for side-by-side checks; writes: a count the
// probes read as their stamp (tools/steps/muscle-look.mjs).
export const MUSCLES = { on: typeof location === 'undefined' || !/[?&]nomuscle\b/.test(location.search), writes: 0 };
if (typeof window !== 'undefined') window.__muscles = MUSCLES;

export const MUSCLE_TEXEL0 = 54;               // a frog's bones fill texels 0 … 53 of its row (17 bones use 0 … 50; an 18-bone swim body with spineB 0 … 53); the bellies follow (21 free)

// The bellies of a baked frog skeleton, or null when the template does not fit it.
export function bellyRig(skel) {
  if ((skel.plan ?? 'anuran') !== 'anuran' || skel.bones.length * 3 > MUSCLE_TEXEL0) return null;
  const set = anuranMuscleSet(skel);
  if (!set) return null;
  const F = anuranFrames(skel);
  const items = visibleSlots().map((k, slot) => {
    const mu = set.find((m) => m.id + m.side === k);
    if (!mu) return null;
    mu._F = F;
    const u = muscleUnit(mu, skel), f0 = fibreState(u, u.L0, MOTOR.tone);
    return { mu, u, slot, lf0: f0.lf };
  }).filter(Boolean);
  return { skel, F, items };
}

// The motion a pose belongs to, for one side: the swimming body's stroke (each leg its own phase) or leap, the sitting body's hop,
// walk or rest.
export function motionOf(st, stroke, side) {
  // (an activation mode a poser asks for, with each leg's own phase and strength; absent = the motions below)
  const mv = st?.move;
  if (mv) { const L = side === 'L'; return { mode: mv.mode, t: (L ? mv.pL : mv.pR) ?? 0, amp: (L ? mv.ampL : mv.ampR) ?? 1 }; }
  if (stroke) {
    if (st?.legA) return { mode: 'leap', t: st.t ?? 0.5 };
    const p = side === 'L' ? st?.pL : st?.pR;
    return { mode: 'swim', t: p == null ? 0.45 : p - Math.floor(p) };
  }
  if ((st?.hop ?? 0) > 0.01) return { mode: 'hop', t: 0 };
  return (st?.calm ?? 1) < 0.5 ? { mode: 'walk', t: 0 } : { mode: 'sit', t: 0 };
}

// The bellies' state for a pose: bones turned by R[b] (3 x 3, row-major) about their rest heads, now at H[b]; written into `out` from
// the instance's row start `o`.
export function writeBellies(B, R, H, head, out, o, st, stroke) {
  const at = (b, p) => movePoint(R[b], head[b], H[b], p);
  const ctx = { L: motionOf(st, stroke, 'L'), R: motionOf(st, stroke, 'R') };
  MUSCLES.writes++;
  if (!MUSCLES.on) { for (const it of B.items) out.fill(0, o + (MUSCLE_TEXEL0 + it.slot) * 4, o + (MUSCLE_TEXEL0 + it.slot) * 4 + 4); return; }
  const cache = {};
  for (const it of B.items) {
    const L = musclePathLength(it.mu, B.skel, at, B.F, undefined, cache), a = excitation(it.mu.def, ctx[it.mu.side]);
    const f = fibreState(it.u, L, a, 0, 14), c = bellyChange(1, it.u.lb, it.lf0, f.lf, Math.cos(f.alpha));
    const p = o + (MUSCLE_TEXEL0 + it.slot) * 4;
    out[p] = Math.max(-0.5, Math.min(0.8, c.dR)); out[p + 1] = Math.max(-0.4, Math.min(0.4, c.slide)); out[p + 2] = a; out[p + 3] = 0;
  }
}
