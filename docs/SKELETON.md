# Skeletons, muscles and turning

The rule for every animal (2026-10-03): an anatomical skeleton first (bones and joints from real anatomy or measured on the scan, the
skin bound to the bones, poses and gaits made by turning joints), then muscles (bulging and sliding as the joints bend), then skin.
This file is the audit of where each species stands, the shared framework (`src/util/bodyplan.js`, `src/util/turn.js`,
`tools/rig/skeleton.mjs`), how animals turn, and the measured plan for real skeletal animation in the engine.

## Audit (2026-10-04)

Rig types: **vertex rig** = the per-vertex rig of `render/creatures/instanced.js` (attribute `rig` = spine, leg id, legT, material;
legs shear forward and back, the body waves); **rig2** = plus the head/bend/tail channel; **baked rig** = the vertex rig's attribute
computed by a bake tool on a scan (`tools/rig/frog.mjs` thickness segmentation, `crab.mjs`, `shrimp.mjs`); **addRig** = guessed at
load (`glb.js addRig`); **skeleton** = bones measured on the scan, skinned by `tools/rig/skeleton.mjs` (bake time only so far).

| Species | Plan | Model, rig | Walk | Turn (new) | Hop / jump | Swim | Climb | Muscles |
|---|---|---|---|---|---|---|---|---|
| dart frogs (4 morphs), strawberry, leucomelas, auratus, bumblebee, reed frog, toad | anuran | scan GLB, baked vertex rig (far); **skeleton (17 bones) measured on the scan, skinned near the camera (runtime)**; swim-pose GLB | near: the legs turn at hip and shoulder, the knee, heel and elbow bend (skeleton); far: diagonal legs sweep (shear) | pivot on the hips, legs swing round the pivot (turnSweep, tau in anim.y), no bend (stiff trunk) | near: hip, knee and heel extend until the leg trails behind; far: vertex shift (`hopLegs`) | pose model + kick cycle | reed frog: body on the stem/glass normal + gait | throat as a normal bulge; near: thigh, calf and shoulder swell with their joints |
| red-eyed tree frog | anuran | scan GLB, baked rig with hind-leg skeleton chain; **skeleton (17 bones)** for the baked `sleep` pose (not skinned at run time yet, see below) | far-style shear at every distance | as above | vertex shift | pose model | perch route, body on the leaf/glass | throat; **the sleep pose baked with muscles** (thighs, calves, shoulders); joint limits checked on it |
| paddle-tail newt, marbled newt, axolotl | caudate | SDF body, vertex rig + rig2 | trot + S-wave + head counter-swing | pivot on the hips, legs round the pivot (tau in rig2 A), C-bend into the turn, head leads, tail lags | none | legs swung back about shoulder and hip onto the flanks (75 / 85 degrees, length kept, feet at flank height) and one travelling wave along the whole body (wavelength 0.9 body, amplitude from 0 at the snout to the tail tip): `swimmer` in render/creatures/instanced.js (2026-10-04; before, the legs stuck out sideways and only the tail wagged); turns by the C-bend | none | throat pumping |
| fire salamander | caudate | scan GLB, addRig + rig2 | as newt | as newt | none | as newt | none | throat |
| mourning gecko | lizard | SDF body, vertex rig + rig2 (tail drop, stump) | trot + wave | as newt (lizard limits: more neck, faster stepping) | none | none | on the background: body on the wall normal, gait; yaw in the wall plane (no pivot shift there) | none |
| crocodile skink | lizard | SDF body, vertex rig + **rig2 (new)** | wave + legs | pivot on the hips, legs round it, C-bend, head leads (its look-round is now the head, not the body) | none | none | none | none |
| neon, cardinal, ember, guppy, betta, cory, oto, celestial pearl danio, tadpole; pygmy sunfish, clown loach (GLB, addRig) | fish | SDF (or GLB + addRig), vertex rig + **rig2 bend (new)** | body wave | swings round an arc (`steerLimit`), yaw rate capped (5 rad/s, 9 darting), C-bend from the yaw rate | none | body wave | none | none |
| cherry / blue dream shrimp | decapod | scan GLB, baked rig (16 leg ids: walking legs, pincers, swimmerets, antennae) | legs in two shuffled groups | legs step through the turn (gait driven by the turn), rate-limited | tail flick (curl) | swimmerets | none | none |
| vampire crab, panther crab | decapod | scan GLB, baked rig, sideways legs | sideways scuttle | legs step through the turn (calm lifted while turning), pivot on the middle | none | (aquatic panther walks) | burrow digging | none |
| isopods (3), springtails (3), fruit fly, cricket, dubia | arthropod | procedural invert rig (leg waves, antennae, wings, furcula, curl) | leg wave | legs step through the turn | furcula / cricket legs / flutter (the take-off yaw is still instant: an insect leaping) | none | none | none |
| earthworm, waxworm, maggot, pupa, trumpet snail | soft | procedural, body wave or rigid | wave / glide | rate-limited (a snail turns at 0.8 rad/s) | none | none | none | none |

What is still not anatomical: far from the camera, and for every animal but the frogs of the dart-frog scan, the walking legs are a
shear of the leg vertices and the hop a vertex shift; the red-eyed frog, the salamanders, newts, geckos, the skink and the fish have
no runtime skeleton yet (see "Runtime skinning" below for why the red-eye waits).

## The framework

* **Body plans** (`src/util/bodyplan.js`): `anuran`, `caudate`, `lizard`, `fish`, `decapod`, `arthropod`, `soft`; `planOf(species)`.
  Each has
  * `joints`: the range of every bone of the skeleton tool against its parent (degrees between them, 0 straight, 180 folded back):
    an anuran's knee and ankle fold to 175, its head turns at most 30 against the trunk; a salamander's trunk bends 60, its neck 40.
  * `rig`: the same limits as the game's channels see them: head yaw, C-bend, tail swing. `limitRig()` clamps what the mind, the
    gait and a turn ask for together, so nothing turns a neck further than the animal has one (a frog: 10 degrees).
  * `muscles`: bellies on bones that swell as a named joint bends (thigh with the knee, calf with the ankle, deltoid, epaxials,
    throat), `muscleBulge()`.
  * `turn`: the pivot (`hips`, `centre`, `none`), the fastest stepping in a turn, and how much of the rig range a turn uses.
* **Bake** (`tools/rig/skeleton.mjs`): `poseMatrices(bones, pose, { plan })` keeps every joint inside its range (a target past
  it is brought back in the plane of the bone and its parent; `clamped` lists them); `poseAngles()` reads a pose's joint bends;
  `applyMuscles()` swells the posed skin along its normals. `tools/bake-creature.mjs` passes the job's plan (`skeleton.plan`, an
  anuran for frog bones) and applies muscles when the job says `muscles: true` (off until checked in the bench). tests/turn.test.mjs checks the red-eyed frog's scan pose and sleep pose
  against the anuran ranges (all inside) and that a head turned over the shoulder is clamped.
* **Runtime**: the turning code below, and `limitRig` on every rig2 animal's head, bend and tail each frame.

## Turning

User report: animals "turn around their axle with no anatomic movement but just floating". Causes found:
1. every walker yawed about its middle at a fixed rate (3.2 rad/s), the feet sweeping back along the body as if walking, so planted
   feet slid 3.4 to 5.6 cm per radian; 2. fish and newts set yaw straight from velocity: a reversal flipped them 180 degrees in one
   step (up to 78 rad/s); 3. the look-round twitch (`vis`) rotated the whole body by up to 0.85 rad with no step at all, and the
   salamanders' nosing swung the whole body by 0.55 rad; 4. shrimp, crabs and bugs turned with their legs still.

Now (`src/util/turn.js`, `Animals.turnTo / turnPoseStep`, the shader's `turnSweep`):
* **Rate from the legs**: the fastest yaw is the yaw per leg cycle (4 x the leg sweep / the farthest foot's distance from the pivot,
  measured on the mesh: `limbFrame`) times the plan's fastest stepping. Dart frog 1.6 rad/s, toad 2.0, newt 1.5, gecko 4.1. Turns
  ease in (acceleration limit) and stop on the heading.
* **Pivot on the support**: on the ground the body turns about the hips (`pivotShift`), which stay where they are; the frog's planned
  leap or walk is carried with the body so it still goes straight ahead.
* **Legs**: every bit of turning drives the leg cycle (`turnSteps`), and the turning mix tau tells the vertex shader to swing the
  legs round the pivot instead of back along the body (`footRig` is the same formula), so a planted foot stays put. Small turns
  blend with walking by the mix.
* **Spine**: the C-bend into the turn, the head leading into it, the tail lagging (0.35 s) and swinging back after (`turnPose`),
  within the plan's joint limits; frogs do not bend.
* **Looking round**: an animal with a neck turns its head (the twitch and the nosing go to the head channel); one without (frogs,
  crabs, bugs) turns on the spot to look, stepping (`a.lookTo`).
* **Swimmers**: the wanted direction is held within 1.2 rad of the heading (1.6 for a salamander steered by its mind), so a fish
  swings round an arc, its yaw rate is capped and its body bends into the turn.

Measured (`node tools/steps/turn.mjs`, starter tank, baseline 10825ec vs this change; forced half turns on open ground):

| | before | after |
|---|---|---|
| foot slip per half turn, dart frog / toad / red-eye (on the spot) | 11.3 / 11.4 / 12.0 cm | 1.2 / 1.4 / 3.0 cm |
| foot slip, newt / gecko (turn to a goal behind and walk off) | 15.9 / 12.8 cm | 3.5 / 1.1 cm (fire salamander 3.6 to 11.3: its walk-off slides round obstacles) |
| yaw with the legs still in a forced turn | 0.10 to 0.13 rad (frogs) | 0 to 0.03 rad |
| fastest yaw in the tank, 40 s: neon / cory / newt | 77 / 75 / 79 rad/s | 5.4 / 5 / 2.2 rad/s |
| shrimp: share of turning with the legs still | 56 % | 10 % |
| fish / newt / gecko: share of turning without a bend into it | 100 / 100 / 19 % | 9-13 / 1 / 11 % |
| the look-round twitch | whole body spun by up to 0.85 rad | head (rig2), or a stepped turn |

Left as they are: the take-off yaw of jumping and flying insects and the shrimp's tail-flick escape (a leap, not a turn), and the
unstick in `keepFree` (`a.yaw = ang`, about 2 fish in 40 s; containment code, flagged to that owner).

Frame cost: same pipeline count (142 to 145 builds either way). Steady frame time ABBA inconclusive on a loaded machine (WebGPU gfx
18.5 / 23.8 ms baseline vs 22.1 ms; WebGL 24.3 / 24.4 vs 24.2 ms). The first load of the changed shaders is slower once (Metal
compiles the new variants, then caches them).

## Runtime skeletons: the prototype and the decision

`src/bench/skinproto.js` (bench.html?proto=skin|rig, measured by `node tools/skin-proto.mjs`): N dart frogs skinned per instance
from a bone texture (15 bones in a hierarchy composed on the CPU each frame, one texture row per instance; 4 bones per vertex, the
vertex's bone ids and weights read from a per-vertex data texture by vertex index, because the creature pipelines already use the 8
vertex buffers WebGPU allows), against the game's own rig material, same shading, frames uncapped, A B B A. M1, 2026-10-04:

| setting | rig | bone-texture skin | extra |
|---|---|---|---|
| WebGPU, 100 x 6.9k verts | 3.9 ms | 7.6 ms (CPU 0.42 ms) | 2.4 ns a vertex (with the shadow pass) |
| WebGPU, 400 x 6.9k | 10.3 ms | 21.2 ms (CPU 1.66 ms) | 3.9 ns |
| WebGPU, 400 x 15k (fine mesh) | 17.5 ms | 49.3 ms | 5.3 ns |
| WebGL 2, 100 x 6.9k | 3.1 ms | 8.6 ms | 7.9 ns |
| WebGL 2, 400 x 6.9k | 7.0 ms | 25.7 ms | 6.7 ns |

The starter tank draws 376k creature vertices, of which 59k are four-legged vertebrates (frogs, newts, gecko); the swarms
(springtails 106k, flies 84k, isopods 38k, shrimp 51k) are most of the rest. **Decision**: per-instance skinning is affordable for the
vertebrates only: about +0.25 ms (WebGPU) / +0.4 ms (WebGL) of GPU and +0.05 ms of CPU on the M1 for the starter tank, roughly three
times that on the Snapdragon laptop. Not for the invertebrate swarms, which keep the vertex rig. It is about twice the rig's vertex
cost, so the engine version should halve it: 2 bones a vertex (enough for limbs), bones as 3 texels (affine 3x4), the skin data in one
texel, and only the fine (near) LOD skinned.

## Runtime skinning (phase 3, 2026-10-04)

The frogs of the dart-frog scan (dartfrog and its morphs, leucomelas, strawberry, auratus, bumblebee, reed frog, toad) are drawn by
their skeleton within `near` cm of the camera; farther away, and with the switch off, the vertex rig draws them as before.

* **Skeleton** (`tools/bake-creature.mjs` FROG_SKELETON): joints measured on the scan with `tools/rig/joints-view.mjs` (top, side and
  front views in the rig's frame, coloured by the bone each vertex is bound to): the hind leg folded in a Z (thigh forward and out to
  the knee at the front of the lobe, shin back to the heel at its rear tip, foot forward along the ground), the arm straight down
  with the elbow back. Each species' warp carries the joints with the skin (`carryJoints`); the manifest holds the skeleton in cm.
* **Binding** (`bindCapsules`): two bones a vertex, each bone a capsule (`radius`); the second bone is always across a joint from the
  first (or a limb's root and a body bone), the weights smoothed over the mesh (6 passes), and the hand or foot past the middle of
  the limb only on its own bones (a sitting frog's toes lie under its thigh). Written as `_SKIN` into the detailed file only.
* **Pose** (`src/render/creatures/skeleton.js`, per instance on the CPU): the toe tip goes where the rig would put it (gait, turn, swim
  pose). A hind leg turns about the hip as a whole and opens or closes its fold, knee and heel together, for the reach (two-bone IK
  over thigh and shin is useless on a Z-folded leg: the heel sits so close to the hip that a 3 mm step swung the knee 7 mm); walking,
  the hind feet are set a sweep further out than when sitting, because the scan's knee is already at 156 of its 175 degrees. The
  forelegs reach by two-bone IK with the hand laid down and yawed with the turn. A hop extends hip, knee and heel until the leg trails
  behind (85 % of its length). Knee, elbow, heel and wrist are kept inside the anuran ranges. Muscles: the plan's thigh, calf and
  shoulder bellies as a radial scale of the bone with the joint's flexion against the rest pose (no shader cost).
* **GPU** (`src/render/creatures/skin.js`): bones as 3 texels (affine 3x4) in one shared float texture, 64 x 64 texels (64 instances,
  at most `SKIN.cap` = 8 of a species: more of it near the camera fall back to the rig); an instance's row rides in anim.y; the skin
  attribute interleaved with `rig` in one vertex buffer (WebGPU's 8 a pipeline); the normal skinned too (a varying for the shading).
  One more material per skinned species (its near mesh), built while the tank loads.
* **Switch**: `?noskin`; off on the Low preset and on WEAK_GPU adapters (`engine/gfx.js`).

Measured (M1, other agents running):

| | rig | skinned |
|---|---|---|
| bench, 48 dart frogs x 15k verts, WebGPU (`node tools/skin-proto.mjs --n=48 --lod=hi --b=engine`) | 4.40 ms | 5.07 ms (+0.9 ns a vertex; CPU 8 us an instance) |
| same, WebGL 2 | 3.59 ms | 6.37 ms (+3.9 ns a vertex) |
| skin stretched past 2x in a walk / hop, dart frog (`node tools/rig/skin-stretch.mjs`) | 0.2 % / 2.8 % of triangles | 1.5 % / 8.0 % (the knee and hip creases; the hop's thigh parting from the flank the scan fused) |

In the starter tank 3 or 4 frogs are near the camera in a close view (60k vertices: about +0.05 ms WebGPU, +0.2 ms WebGL by the bench's
per-vertex cost); the in-game A B B A (`node tools/steps/skin-perf.mjs`) was inconclusive on the loaded machine.

Not yet: the **red-eyed frog** (its hind legs lie folded flat, thigh and shin fused in one lobe, the long toes beside the hands:
walking on its joints tore the lobe and left toe tips behind, 2.7 % of triangles past 2x in a walk, 11 % in a hop; the joints need
measuring again with the lobe split), the **fire salamander** (the scan has no baked rig to bind against; caudate plans need spine
and tail bones driven by the rig2 channels), the SDF bodies (newts, axolotl, gecko, skink: no scan to bind), the fish.

## Swimming blueprint (frogs and toads, 2026-10-04)

User report: frogs in the water "just float and twitch instead of interacting with water and moving naturally", then, of the first
fix, "the kick goes in a crazy direction". Two causes. The motion: the legs slid straight back and forth in a fixed V, which is not
how a frog swims. The body: the sitting scan's hind legs are one folded lump (thigh, shin and foot fused), so any pose that stretches
them smears the skin into ribbons, whatever the bones do. Now every frog and toad swims with ONE system, in two layers, in a body made
for it, and a new frog plugs in by adding its profile and its swimming body.

**The swimming body** (`<id>.swim.glb`, tools/bake-frogpose.mjs): the frog scanned mid-stroke (art-src/raw/frog_swim_mesh.glb), its
four limbs apart and half bent, which is the pose a skeleton binds best in. The bake measures its skeleton on the scan
(`SWIM_SKELETON`: the same 17 bones as the sitting frog's, tools/rig/skeleton.mjs frogBones), binds the skin (bindCapsules, `_SKIN`)
and writes the skeleton to the manifest with `bind: 'swim'`. Painted by the species' own painter, so it matches the sitting body.

**Motion layer** (pure, `src/util/gait.js`, tests/swim.test.mjs):
* the **stroke as joint angles**, read off film of swimming frogs from above (the user's references) and the four beats of the "frog
  kick": `HIND` key poses (cocked: thighs forward beside the flanks, feet turned out; kick: the feet sweep out and back; open: legs
  straight in a V; glide: legs together, toes pointed; draw: knees out, shins angled back in, a diamond from above; turn: feet turning
  out) joined by a curve that passes through each without overshoot (`STROKE_KEYS`, `strokeAngles(p, out, o, amp, float)`); the
  forelegs laid back as it drives and held out as it draws its legs up (`FORE`, `armAngles`, `armOpen`). A segment's direction is two
  angles in the frog's own frame (from straight back round to forward, and up or down), so the same numbers pose any frog's bones.
* inputs: the species' **SWIM profile** (`src/util/bodyplan.js SWIM`: kick rate `kickHz` [pottering, urgent], `reach` (body lengths a
  kick), `burst` and `rest` (weak swimmers kick in short bursts and rest with the legs trailing), `drag`, `headUp`, `hang` and `float`
  (rests at the surface, hanging from its nostrils: the fire-bellied toad), `arms` (how far the forelegs are held out)); the body's
  length; from the behaviour layer urgency (0 pottering … 1 a dash for the way out), floating, and `steer`.
* `swimStep(state, profile, { urgency, floating, steer, bodyLen }, dt)`: the stroke clock (phase in kicks), bursts and rests; both
  legs together when it means to get somewhere, one after the other when it potters (`alt`), the inner leg of a turn trailing
  (`steer`); returns the speed in cm/s: a surge as the legs drive, a glide that decays, `reach` body lengths a kick.
* `swimPose(state, profile, { level, t })`: `stroke` for the skeleton ({ pL, pR, ampL, ampR, float, scull, arms }), the body's
  `pitch` / `roll` / `yaw` (level at the surface with the nose up, lifting as the legs drive; hanging when it floats; swinging a little
  when it kicks one leg at a time), and `hop` for the rig of a body without bones.
* `leapStroke(t)`: a **leap** by the same body (below).

**Render layer**: `render/creatures/skeleton.js poseStroke(rig, stroke, …)` points every limb bone by its angles from the limb's root
outward (forward kinematics: lengths kept, each bone keeping the side it turns to the frog's back, the foot rolling from web-upright
as it pushes to flat as it trails); muscles swell as in poseBones. `CreatureMesh.put(…, stroke)` → `CreatureLOD.put(…, stroke)`. The
swimming body is drawn by its bones at any distance and on every preset (`SKIN.swim`, off only with `?noskin`): there are never more
than a few frogs in the water, and without bones it is one frozen pose.

**Behaviour layer** (`src/sim/animals.js`): `frog()` decides it is in the water, `frogSwim()` where to (the nearest way out: a bank
to hop onto (`shoreLand`), a steep bank to climb (`exitClimb`), the glass for a frog with toe pads (`exitGlass`); a toad may float or
potter instead), how urgent and which way to steer; `swimClock()` runs the motion layer and moves the frog by its speed along its
heading (turns through `turnTo`); `swimDepth()` puts its back awash and its eyes out (from the swimming body's spine); `swimWake()`
and the kick ring disturb the water. Avoidance (`tooDeep`): a frog is not pushed or slid into water deeper than half its body.

**The leap**: a frog in the air is drawn in the same body (`leapStroke`: legs driven from cocked to straight, hips and knees before
ankles and feet, the order measured for a frog's take-off (Biomimetics 9(3):168, 2024, the user's reference); trailing through the
flight; folded before the landing; the forelegs drawn back under the chest, then reaching forward and down to land on). The sitting
body is drawn on the ground before and after. This replaces the sitting skeleton's hop, whose skin stretched about threefold.

**Adding a frog**: a job in tools/bake-frogpose.mjs (size, painter, eyes: `node tools/bake-frogpose.mjs <id>.swim`), a SWIM row in
bodyplan.js (copy the nearest species, then set kick rate and reach from its biology: a weak swimmer 0.4-0.5 body lengths a kick, a
strong one 0.8), then `node --test tests/swim.test.mjs`, `node tools/steps/swim-cycle.mjs --ids=<id>` (the stroke from above, the
side and three-quarter, to hold against film of the real animal), `tools/steps/swim-film.mjs` and `tools/steps/leap-film.mjs` (in a
tank) and `tools/steps/frog-water.mjs` (time in the water, exits). A frog with a body of another build (the red-eyed tree frog)
needs its own swimming scan and `SWIM_SKELETON`; until it has one it swims and leaps on its sitting skeleton.

## Phased plan

1. **Done (this pass)**: body plans with joint limits and muscles; limits enforced at bake (`poseMatrices`) and at runtime
   (`limitRig`); turning by the legs about the pivot with the spine bending, for every walker and swimmer; probes and tests.
2. **Skeletons for every vertebrate scan** (dart-frog scan and red-eye done; fire salamander, fish open): measure joints on each scan the way the red-eyed frog was (`.tmp-re/joints.mjs`,
   posepreview), store them in the bake jobs, bind with `bindSkin`; bake the pose library from joint angles (sleep, swim, crouch,
   turn-lean, call) with `{ plan }` limits and `applyMuscles`, checked in the bench. No runtime cost.
3. **Runtime skinning for the near LOD** (done for the dart-frog scan's frogs, 2026-10-04, above; the plan as written: bake bone ids/weights into the GLB as a per-vertex texture,
   2 bones and 3-texel bones per the prototype, one shared bone texture for all species (rows allocated per instance), gait and turn
   as joint-angle controllers (`util/gait.js` curves turned into hip, knee, ankle, shoulder, elbow angles with IK feet on the
   ground), far instances keep the vertex rig with the same channels. Measure with `tools/skin-proto.mjs` and `tools/perf.mjs` on the
   M1 and the Windows laptop before switching a species over.)
4. **Runtime muscles**: per-bone bulge scalars from the joint angles (the plan's muscles), a normal offset in the skinning shader.
   (Done as a radial scale of the bone in its matrix: no shader cost.)
5. **Hop by joints**: the take-off and landing as hip-knee-ankle extension from the skeleton (replaces the vertex shift). (Done near
   the camera for the skinned frogs.)

## Checking

* `node --test tests/turn.test.mjs` (pivot, rate limit, no yaw without legs, no foot slip on the spot, bend/head/tail, swimmer arc,
  joint limits on the frog skeleton, muscles), `tests/gait.test.mjs` (the turning mix in rig2Pack).
* `node tools/steps/turn.mjs --url=<dev server>` (census and forced half turns with foot slip); runs against an older build too.
* `node tools/bench.mjs dartfrog --src=glb --pose=turn --views=top,three` (one leg cycle of a turn on the spot, fixed camera: the hips
  and planted feet stay put); `tools/animals-seq.mjs --force=turn --open=1 --view=top` in the tank (salamanders and geckos too).
* `node tools/skin-proto.mjs --n=100,400 --lod=lo,hi [--webgl=1]` for the skinning cost (`--b=engine --n=48 --lod=hi`: the game's).
* `node --test tests/skin.test.mjs` (bone packing, leg IK reaching the rig's foot, joint ranges, hop, row allocator, capsule binding);
  `node tools/rig/skin-stretch.mjs` (skin stretch per pose, rig against skeleton); `node tools/bench.mjs dartfrog --src=glb --lod=hi
  --pose=walk|turn|hop [--query=noskin --tag=rig]`; `node tools/steps/skin-look.mjs` (in-game close-ups, skinned and `?noskin`).
