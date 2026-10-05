# G4a report: lizard gait, pure module and pose side, no animals.js edits. Done (claude-opus-5-5, 21 calls this authorization)
Result: the gecko's skinned legs follow the sheet's gait: diagonal pairs, duty 0.65 at a walk, an S-bend that flips with each pair, the head turned back against it, the tail swaying against it. The trunk is lowered 0.16 cm. Feet are planted in closed form at the phase's stride. Planted world feet (`lgStep`) exist and are tested; the game uses them only once the animals.js hunks below land.
Files:
- +src/util/lizardgait.js: GAIT.gecko with a sheet line on every number, gaitAt, legU/stanceOf/peelOf, axialAt, neutralFeet, openFeet, lgNew/lgStep/lgFeet, toBody/toWorld, bellyDrop. It imports nothing.
- +tests/lizardgait.test.mjs: 8 tests, written failing first (module missing), then green.
- src/render/creatures/lizardpose.js:
  - imports and `DROP_MAX = 0.16`.
  - lizardRig computes rig.gait, feet0, restBelly (0.269) and drop.
  - poseLizard lowers the root by `st.drop ?? drop x (1 - calm)`.
  - axial adds axialAt (spine, neck, head; tail sway unless `st.tailBase` is given).
  - legs aims each tip at `st.feet ?? openFeet(...)` (stride = strideFor(rig.legStride), so no slip at the phase's rate); `rig.foot` is no longer used.
- src/render/creatures/instanced.js:128, the approved line: `feet: st?.feet, peel: st?.peel` added to poseBones' state. skeleton.js was not touched: its hook already forwards `st` whole.
- tools/steps/lizard-cycle.mjs: tip world points, `stance(LF RF LH RH)` per frame (rig._open), `slip[cm/frame]` per leg in stance in two frames running, and a `slipStance` range.
- Architecture fix: the test failed on "util imports nothing from src" (not a cycle): util/lizardmuscles.js imported util/bodyplan.js. I moved the file with `git mv` to src/content/lizardmuscles.js (content may import util) and updated the importers in lizardpose.js and tests/lizard-muscles.test.mjs.
- CONTRACTS.md: lizardgait API updated.
Check: `node --test tests/architecture.test.mjs tests/lizard-muscles.test.mjs tests/lizard-rig.test.mjs tests/lizardgait.test.mjs tests/turn.test.mjs tests/skeleton.test.mjs`
  ℹ tests 43  ℹ pass 43  ℹ fail 0
  skin walk: >1.5x 0.61 %, >2x 0.20 %, p95 1.09x, worst 5.5x   (limit 0.2 %; G1b had 0.13 %)
Skin stretch against belly drop (>2x):
| drop (cm) | 0 | 0.09 | 0.12 | 0.16 | 0.239 (full, belly 0.03 cm) |
|---|---|---|---|---|---|
| >2x | 0.22 % | 0.19 % | 0.20 % | 0.20 % | 0.25 % FAIL |
- The lowest belly that passes is 0.27 - 0.16 = 0.11 cm; the sheet's target is 0.03 cm.
- The drop is not the main cost: even at drop 0 the gait reaches 0.22 %.
- The stance sweep is ±0.98 cm because the phase still runs at anim.stride 0.75 (3 cm per cycle).
- Going lower needs the stride hunk below (2 cm per cycle, sweep ±0.65 cm), then re-measure. If that is not enough, the shoulder and hip skin weights must change in the bake (tools/bake-lizard.mjs).
- My first sprawl guess (feet moved in from the rest pose) gave 0.58 %, so feet0 = the baked rest tips (GAIT.restFeet).
Viewer, ground side (`node tools/steps/lizard-cycle.mjs --species=gecko --surface=ground --view=side --frames=16`): skinned=yes, bones 25, v 4.49-4.50 cm/s.
- belly 0.11 CONSTANT (was 0.27); bend -9.99..9.85 deg (was 0); headYaw -4.87..4.94 deg; tailX -0.18..0.13 cm.
- feet -0.13..0.21 cm (armL lowest -0.13: wrist bones slightly in the ground).
- Stance pattern 0111, 1111, 1001, 1011, 0110: the diagonals alternate with four-foot overlaps.
- Foot slip during stance: 0.00 cm/frame for most of the stance, but 0.08-0.14 cm/frame in the first 2-3 frames after each touchdown (the body moves 0.18 cm/frame). My guess: the 3 cm stride puts the touchdown target beyond the limb's reach. Not verified.
- Wall numbers wait for the second authorization.
Risks:
- Belly 0.11 cm is above the 0.03 cm target.
- Early-stance slip as above.
- A standing gecko rises back to the rest height (drop x (1 - calm)) until animals.js passes st.drop.
- The head's yaw against pelvis->neck is ±4.9 deg rather than ~0 (the neck takes part of the wave).
Noticed, not touched: src/util/bodyplan.js (lock held by someone else) still names util/lizardmuscles.js in a comment. animals.js has someone's uncommitted +34 lines: its line numbers moved (draw put now :4516, phase rate :953).

## Hand-off: animals.js hunks for the second authorization (anchor by text; take BB/locks/animals.js.lock)
1. Size, gecko row: `size: 1.4` -> `1.04`; anim `lift: 0.3, stride: 0.75` -> `lift: 0.18, stride: 0.5` (strideFor 0.5 = 2 cm = 0.45 SVL, so :953's strideRate keeps no slip; gaitAt only differs above 27 cm/s). RADIUS `gecko: 0.7` -> `0.52`. Then re-run the stretch test and raise DROP_MAX if it passes.
2. Draw, before the gecko's `cm.put(pos, q, sc, a.wph, amp, a.gait ?? 0, packed, …, a.turnMix ?? 0)`, for a near skinned gecko:
   - `a.lg ??= lgNew(GAIT.gecko, rig.feet0)`; pose = { p: a.pos, f: surfaceFrame(n, a.yaw) }.
   - `lgStep(a.lg, GAIT.gecko, pose, a.speedNow, yawRate, dt, a.wallMode ? wallSurf : groundSurf, sc)`.
   - `st = lgFeet(a.lg, GAIT.gecko, pose, sc, a.lgSt ??= {})`; `st.drop = rig.drop`.
   - Pass `st` as put's last argument and `a.lg.phase` instead of `a.gait`.
   - groundSurf: (x, T.heightAt(x, z), z, T.normalAt). wallSurf: (x, y, Wl.zAt(x, y), wall normal). Whether CreatureLOD exposes skinRig: NOT verified.
3. Tail base: `a.lgTail = tailBaseSwing(a.lgTail ?? 0, retL, retR, dt)` (now src/content/lizardmuscles.js) -> `st.tailBase`. retL/R = hind tip retraction, atan2(-(z - feet0 z), |x - hip x|) from st.feet.
4. wallFrame (~1143-1162):
   - Sample `b.feet` as footing() does for TAILED kinds, or a.lg's planted world feet when present, instead of hlen/hw.
   - Drop the max-lift loop (`lift = max(…)`); use `z = zp(a.pos.x, a.pos.y)`.
   - `a.pos.z = z + 0.12` -> `a.pos.z = z` (the pose's drop holds the belly).
   - Then run the viewer with `--surface=wall`.
Traps: `assert.equal` is Object.is (avoid -0); node's test summary lines start with "ℹ"; one lizard in the scene, so rig._open is that lizard's.
