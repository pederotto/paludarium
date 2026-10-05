# Muscles

The third layer of the building rule (an anatomical skeleton, then muscles, then skin; docs/SKELETON.md). Frogs first; the guideline
is the "Frog hindlimb muscle reference pack" (Claude Doc) and its build approach: a functional muscle layer first, the visuals derived
from it, every number tagged with its source, validators before many muscles, one frog hind limb as the pilot with the hop as the
hardest test, then the other frogs through one template with per-species overrides.

How it fits the animation: the game's motions (walk, hop, swim stroke, leap: joint angles from footage and papers, util/gait.js) are
the base. The muscle layer computes what every muscle does through them (length, force, tendon stretch); where a motion asks for
what the muscles cannot give (timing, extension order, take-off speed against muscle power and the tendon catapult) the motion is
changed to match, checked against the owner's videos and published joint-angle curves; the visible bellies come from the same states.

## Files

| File | What |
|---|---|
| `src/util/musculo.js` | The mechanics, pure: landmark points on bone frames, path length, tendon wrapping over a hinge (`wrapLength`), moment arms, Hill-type fibres in series with an elastic tendon (`fibreState`), tendon energy, belly volume and shape (`bellyChange`: volume kept, bunching toward the origin), activation dynamics |
| `src/content/anuranmuscles.js` | The frog template: `ANURAN_LANDMARKS` (36, on the 17-bone skeleton), `ANURAN_MUSCLES` (16 a side), `ANURAN_WRAPS` (knee, ankle), `ANURAN_WHOLE` (mass shares, specific tension); the frames on a baked skeleton, the muscle set, path lengths, joint turning, moment arms, `muscleUnit` (fibre and tendon lengths), `excitation` (the motor pattern) |
| `tests/anuran-muscles.test.mjs` | The validators (below); prints the stamp `MUSCLES_SCHEMA <n>` |
| `src/render/creatures/muscles.js`, `skin.js` | The visible bellies: each muscle's state written after the bones (texels 51+ of the frog's row), the skin swelled and slid along its normal by the shader |
| `tools/rig/muscles.mjs` | The mass budget against a model, and the skin's binding to the bellies (`_MUSC`, `_MUSU`; `--write`, every existing attribute checked unchanged). All 21 frog models bound on 5 October |
| `src/util/hop.js`, `util/gait.js leapPose` | The hop as real frogs make it (below) |
| `src/content/anuranheadmuscles.js` | The head: the buccal pump (breathing), the swallow, the jaw and neck groups (below) |
| `tests/frog-hop.test.mjs`, `hop-plan.test.mjs`, `anuran-head.test.mjs` | The hop drawn as the game draws it against the owner's clips; the hop's physics over every hop the game can ask for; the pump against its source |

Research and its checks live outside the repo, in `paludarium master/.agents/muscles/` (research/, control/, scheme/, figures/).

## Schema (MUSCLES_SCHEMA 1)

**Landmark** `{ bone, t, post, dors, out, at, soft, what }`: on a bone of the skeleton, `t` along it in bone lengths from its head, then
across it in that bone's flesh radii (`r` of the manifest skeleton). `post` is the flexor side: the side the next bone folds onto (the
back of the thigh, the calf, the sole; the leg folds in a Z, so the calf faces the thigh and the sole faces away from the shin);
`dors` toward the back; `out` away from the midline (pelvis only). A pelvis landmark hangs from its side's hip (`at: 'hip'`) or from
the pelvis' axis (`at: 'axis'`, the urostyle). `soft`: an aponeurosis or a tendon's bend, not bone, but inside the skin.

Why from the hip: the skeleton's hip is where the thigh leaves the body (0.45 cm off the midline on the dart frog), lateral of the
real acetabulum, which sits in a pelvic disc that is thin from side to side. Pelvic landmarks are placed from it with the real
offsets (the ischium behind, the pubis below and in front, the ilium forward), so the lines of pull about the joint the skin turns
about stay true.

**Muscle** `{ id, members, drive, path, wraps, belly, seg, share, fibre: { lf, alpha, ln0 }, e0, hipAt, acts, actSrc, visible, num }`:
a muscle or a functional group (the papers' abbreviations in `members`), a path of landmarks from origin to insertion, the joints its
tendon wraps over, the fleshy part of the path, its share of its segment's muscle mass, its fibres (length over the belly's, pennation,
length over optimal in the sitting crouch), the tendon's strain at maximum force, its action per joint as its source gives it and at
which femur angles that holds. `visible`: a superficial belly that shapes the skin. `num`: where the numbers come from.

**Tags**: every number is `measured` (the species or a homologous muscle in the paper), `scaled` (another species, or a stated rule)
or `guess`. On 5 October: the attachments rest on Collings & Richards 2019 Table 2 (checked by the run's control agent, 11 of 11
entries confirmed), the actions on Collings et al. 2022 Table 6 and Leavey et al. 2024 Table 1; the hind-limb muscle share of body
mass (13 %, scaled: the walker-hopper's of 13-25 %) and the specific tension (21.4 N/cm2, measured) on Roberts, Abbott & Azizi 2011
Table 1 (re-read by the control agent; "combined limb" read as both legs, not stated). Per-muscle shares, fibre and tendon numbers and
the wrap radii are guesses (their sources are paywalled or in supplements not opened).

## The groups (16 a side)

Thigh: TRI (cruralis, gluteus magnus, tensor fasciae latae: the knee's extensor over the knee aponeurosis), SM, GR (major and minor),
IFB, ST, SA_AL (sartorius, adductor longus), AM, ILI (iliacus internus and externus), HIPR (pyriformis, quadratus femoris,
gemellus), OE_PEC (obturator externus, pectineus), IFM. Shank: PL (plantaris longus, over the heel to the plantar aponeurosis),
TiAL, TiP, TiAB, PER_ECB (peroneus, extensor cruris brevis). Not modelled: the obturator internus (a ring round the hip that turns the
femur about its length; a path cannot hold it), the back and pelvis muscles, the foot.

## Validators (tests/anuran-muscles.test.mjs), all passing on 5 October

| Check | How | Result |
|---|---|---|
| Attachments on or inside their bone | every landmark within 0.75 flesh radii of its bone (0.9 soft), every placed point within its bone's flesh (pelvis: 1.35) on all 15 anuran bodies | pass |
| Left and right alike | exact (0.1 %) on a mirrored skeleton; on the scans, both legs in the same pose, within 3 % or the scan's own left/right difference in the bones the muscle spans and 1 % (the swimming dart frog's left toes are 13.5 % longer than its right) | pass |
| Each muscle acts as its source says | moment arm by virtual work, hip at femur protraction 45, 90, 135 deg (Collings 2022), HIPR 90-135 (the push), others 90; knee and ankle at a 90 deg fold; 'variable' not asserted | pass, both dart frog bodies |
| Muscle-tendon length in range | 0.6-1.6 of rest through the game's walk, hop, stroke and the hop as drawn, and over each crossed joint's whole range (knee and ankle 20-170 deg, femur 10-135) | pass |
| Fibres on their force-length curve | off and fully on at every pose drawn with bones: 0.5-1.6 of optimal, never outside the solver's bracket | pass |
| Mass budget | hind-limb muscle 13-25 % of body mass (body mass from the scan's volume); each leg segment's muscle volume inside the capsule of its bone's measured flesh radius | pass: dart frog thigh 89-91 %, swimming body 96-98 % (tight), toad 55 %, reed frog 69 % |
| The hop against the owner's clips | tests/frog-hop.test.mjs: planted toes, real gravity, no foot above the back, no midline crossing, nothing through the floor (steps up and down too), no bone twisting, wide knees and dropping shanks in the push, bent elbows from the launch on | pass |
| Joint curves against video | the hop's joint angles against published curves | open: Porro 2017 and Kargo 2002 not reachable (paywall) |

Corrected after the anatomy specialists (5 Oct afternoon, `.agents/muscles/control/anatomy-A1.md`): HIPR runs the pyriformis' line
from the posterior urostyle and stays a retractor over the femur's whole tested range, 10-135 deg (from the ischium it turned
protractor below about 60); SM inserts into the knee aponeurosis laterally (it ran behind the knee); TiP arises from the shank's
posterior mid-shaft (CR19 0.33-1.0), its fibres raised to 0.6 of the belly (a guess, bounded by the fibre validator); TiAL runs along
the shank's front. Known, open: the force-velocity curve's lengthening slope at zero equals the shortening one (real muscle is several
times steeper there); the dart frog's `foot` bone is about twice the real tarsus, so a heel lift or a foot sweep looks about twice as
large (skeleton work, A1 item 17).

What the first runs caught (5 October): the extensor tendons cut through the folded knee and heel instead of wrapping round them
(16 wrong signs: fixed by `wrapLength`); flexor paths hooked past the knee in the crouch; the sartorius and adductor magnus shared an
origin, so one of them had to act wrongly (the sartorius now arises from the pubis, in front: Collings 2022); the short hip muscles
changed length far too much without a path round the femoral head.

Noticed, not changed (skeleton work): against Leavey's proportions (femur 0.34, tibiofibula 0.33, tarsus 0.19 of snout-vent length,
walker-hoppers) the dart frog skeleton's femur matches (0.34), its shin is long (0.42) and its `foot` bone, heel to the rig's ankle,
is about twice the real tarsus (0.38): the rig's ankle joint sits at the base of the toes.

## The hop (src/util/hop.js, util/gait.js leapPose, render/creatures/skeleton.js plantDirs)

Rebuilt on 5 October from the owner's two clips (`.agents/muscles/refs/JUMPS.md`: a short uneven hop from behind, a long jump from
above) and Essner et al. 2022, Li et al. 2021, Duman et al. 2023, Cox et al. 2018:
- **Launch**: the hind toes stay planted while the body accelerates along the take-off line, uniformly from rest over the push; the
  launch lasts 30-90 ms (Essner: 41 ms mean in 1 cm frogs), the push shortened or lengthened to keep it there. One leg leads; the other
  pushes 10-35 % of the launch later and leaves last; the body rolls a little toward it. Seen from behind (clip A, 0.97-1.29 s) the
  thighs swing out of the crouch to wide knees and the shanks drop from them: solved in the world from the hip down (the thigh's wanted
  direction, then the shank and the long tarsus reaching the planted toes with the heel back and down, out under the knee). Solved from
  the toes up, as before 13:50, the ankle sat in by the vent and pulled the knee in under the hip: the hip's skin stretched past 1.5x on
  45 % of its triangles; now 18 % (the swim stroke: 23 %), pinched below 0.5x 4.5 % then, 2.0 % now (tools/rig/skin-stretch.mjs).
- **Flight**: a ballistic arc under 981 cm/s2 from where the toes leave to the landing, chosen so it comes down onto the landing
  (tan theta >= 2.6 dy/dz): a hop no arc can bring down onto a ledge that high so near is refused (`plan.ok`; the game's hop check).
  Short hops: the legs fold out to the sides at once (clip A); long jumps: straight behind, folding from mid-flight (clip B). The body
  keeps near level in a short hop and lies along the arc in a long jump (pitch 0.25-0.6 of the line), at most 18 deg a frame.
- **Long jumps** (the owner's clips B-E, Porro et al. 2017): the push keeps the shank's direction through the first ~80 % while the
  thigh and the tarsus turn together, parallel from above (solved as a two-link reach in one vertical plane), then the shank
  retracts; no wide knees. In the air the legs trail in a narrow V and the arms lie back along the flanks. Short hops keep clip A's
  wide knees and open arms; the two blend between 0.25 and 0.75 of `plan.short`.
- **Arms**: off the floor from the launch; in a short hop out to the sides and a little back, the elbows bent (about 130 deg inside),
  the forearms forward and down; in a long jump back along the flanks; coming down the upper arm forward, the elbow at 107 deg as
  the hands meet the floor wide apart (Cox et al. 2018: 110 +- 12 at touchdown; Duman et al. 2023: 63; ranids land on straight arms,
  Nauwelaerts 2006: the conflict is open).
- **Open** (control C2 round 2): the long jump's knees sit 0.65-0.90 thigh lengths out, about the crouch's width, as the thigh and
  tarsus swing back through the side together; Porro measured retraction twice the adduction, but no knee width was read: measure it
  on Porro's dorsal-view figures before narrowing.
- **Open**: in the owner's clips C and D the body tilts up along the take-off line before the legs move; tilting inside the 30-90 ms
  launch turned the body up to 27 deg a frame, so it needs an aim phase ahead of the launch (the nose-up is capped at 30 deg).
- **Landing**: on the hands first, the body held at 0.15 snout-vent lengths on them, then settling; the pitch eased level from the one
  it came down with.

## The head (src/content/anuranheadmuscles.js; the owner, 5 Oct: "muscle mechanics should also be applied to breathing,mouth and head movements")

From `.agents/muscles/research/head-muscles.json` (Kunisch et al. 2021, Keeffe et al. 2022, Vitalis & Shelton 1990; checked by the
control agent, round 5).
- **Breathing**: the buccal pump. The throat floor is a mass on its elastic tissue moved by two Hill muscles with activation dynamics:
  the sternohyoid lowers it, the floor muscles (intermandibularis, interhyoid, geniohyoid, petrohyoids) raise it, about 90 times a
  minute (Rana pipiens: 90 +- 3.2). About every 14 cycles a lung breath (6.3 +- 0.8 a minute): the floor drops deep and is held, the lungs
  empty into the mouth (the flanks sink), the nostrils shut and the rising floor pumps them full. The rig's `throat` is the floor's
  travel, `breath` (the flanks) the lungs' fill (sim/animals.js vis, frogs and toads).
- **Swallow**: two pushes, each the eyes pulled down into the mouth (retractor bulbi: activation dynamics) with the floor raised.
- **Mouth**: the depressor and adductor groups are in the data (gape 70 deg, open 227 ms in cane toads), but the models have no jaw: a
  visible gape needs a jaw mask in the bake (the owner's models: asked before any re-bake).
- **Head turns**: the neck muscles were not found in the literature read; a frog turns its body to look (sim/animals.js), unchanged.

## The swim stroke (util/gait.js STROKE_KEYS, HIND, FORE; the owner's clips of 4 Oct, `.agents/muscles/refs/SWIM.md`)

Re-read on 5 Oct from the owner's pool frog and teaching toad (scout V2), checked by anatomy specialist A2 against Peters 1996,
Nauwelaerts 2005 and Richards 2010 (`control/anatomy-A2.md`):
- The kick keeps its quarter of the cycle, front-loaded (cock 0, kick 0.08, open 0.16), then the glide with the legs together
  (0.26-0.55).
- The draw ends in the diamond at 0.72 (knees out, heels together behind the vent, feet trailing), held there by a frog pottering
  (`DIAMOND_HOLD`: up to 0.12 of a cycle at urgency 0, none fleeing; the pool frog held it about twice its draw).
- The turn-out parts the heels (shin -25 rather than -38, which kept them on the midline and made an X from above) and turns the feet
  out; cocked, the knees are at the sides (thigh 105, the clips 95-110), the feet out to the sides.
- A leg that kicks less holds the diamond while the other kicks (the pool frog's turn), rather than drifting to the floating pose.
- The arms sweep back over the kick's first half, lie back along the body through the glide, and brace forward with the elbow bent at
  most halfway as the legs draw up (never out like wings).
- Floating is by species (the owner: "species based mix"): `floatPose` 'spread' (the fire-bellied toad, spread-eagled, head up) or
  'trail' (the legs trailing back, the body near level, the owner's toad clip) in `util/bodyplan.js SWIM`.
