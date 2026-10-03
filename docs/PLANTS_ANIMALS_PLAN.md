<!-- Written 2026-10-01 by a read-only audit agent against branch arch/optimize, with numbers from the metrics recorder (docs/METRICS.md). It is the plan for the "step up the game" phase: plants first (variety, visual decay, life cycles, roots), then animals. Decisions already taken are in HANDOFF.md. -->
# Plants and animals audit for the "step up the game" phase

Branch arch/optimize, repo `paludarium`. Read-only audit: nothing in
the repo was edited, no browser, build or server was started. Paths are repo-relative.

Evidence labels. **Verified** = read in the code, or produced by a command I ran (pure Node, niced, under 10 s in
total: `tools/inspect-glb.mjs` on the models; the real plant builders lifted out of `src/sim/plants.js`; the
real SDF mesher `bodyArrays` (`src/render/creatures/shape.js`) on 12 creature bodies; metrics NDJSON read from
`metrics/sessions/`). **Unverified** = inferred, needs a measurement. Triangle counts are those runs.

## 0. The facts that shape the plan

1. Plants are cheap in triangles, animals are not. The 51 starter plants are 24.5k triangles per pass (about 1%
   of the 2.33M recorded); the 106 animals' coarse meshes are 767k per pass. A springtail is 6,784 triangles and
   there are 40 of them (271k). The headroom for "dramatic" plants exists; for animals it must be made first.
2. Plants own 24 foliage material instances in 22 InstancedMeshes, all built at start even when empty
   (plants.js:361-365, 404; litter.js:32; decor.js:165). three keys each InstancedMesh's build by `object.uuid`
   (node_modules/three/src/renderers/common/RenderObject.js:846-850) and still builds a pipeline for a mesh with
   count 0 (Renderer.js:3955, before the empty-draw check at RenderObject.js:629). So about 24 of the ~130 shader
   builds (DESIGN.md:37) are plants (split unverified). One shared foliage shader fed by per-instance data is the
   largest load-time lever, and it is also the channel variety, decay, cycles and roots all need.
3. What varies per plant today: yaw, uniform scale, a health tint, and for 2 of 15 species a random GLB variant.
   Twelve species are a single fixed mesh: nine vallisneria in the starter tank are the same 20 leaves.
4. A plant has no stage. `p.age` is written and never read (plants.js:558). No flower, fruit, dormancy, lifespan.
   `Env.season` exists and is read by nothing (env.js:63). Death is `health <= 0` with instant removal
   (plants.js:617-622). The visible stress is one colour lerp on the instance (plants.js:517-519).
5. Roots exist only as a species-independent soil-holding disc (erosion.js:100-120, refreshed every 4 s from
   water.js:454), a flat waterlogging cap (plants.js:585), a pond boost for emergents (plants.js:597-601) and
   frogbit's dangling ribbons (plants.js:318-319). The hardscape "roots" piece (decor.js:40) is an unrelated
   44,960-triangle driftwood scan. Nothing is drawn below the soil: the substrate is one open heightfield.
6. Plant simulation runs every frame with dt of about 0.017 game minutes at 1x (game.js:185, sim.js:41-52,
   sim.js:116): redundant for a process whose clock is days. It also makes the leaf-litter view rebuild every 40
   ticks (litter.js:49), although its header says "every few game hours". Costs are unverified (not profiled).
7. Animals: 27 species, SDF bodies, a GPU rig `[spine, leg, legT, matId]`, 4 GLB upgrades. There is no
   head, tail or jaw channel, no continuous life-stage morph (tadpole to froglet is a swap, sim.js:269-271), and
   every creature fragment evaluates 5 to 6 Perlin noises (material.js:113-125), against the project's own rule.

## 1. What exists today

### 1.1 Plants: inventory (verified; tris from the real builders and `inspect-glb.mjs`)

15 ids in `PLANTS` (plants.js:102-345): 14 visible and the hidden `oldfern` (plants.js:142). Habitat strings
use `|`. Moss is not a plant species: it is a material weight on the ground and wall (ecology.js:116-182), drawn
as up to 5,000 instanced tufts (decor.js:164-167, scatterMoss decor.js:560) and as a shader on rocks.

```
id          habitat          built as                       var  tris per instance          starter
fernph      land             GLB fern_02 (Poly Haven)         4  2384/2248/784/816               7
weed        land+emergent    GLB weed_plant_02                5  1779/1363/1058/1155/1308        5
fern        land             8 fanned cards, fern.png         1  256                             4
bilberry    land             3 crossed cards (berries baked)  1  96                              2
grass       land+emergent    3 crossed cards                  1  96                             10
oldfern     land (hidden)    procedural ribbons               1  504                             0
bromeliad   land+wall (epi)  procedural ribbons               1  128                             3
pothos      wall+land (epi)  7 flat cards (bilberry.png)      1  224                             1
cattail     emergent         3 crossed cards                  1  96                              2
bamboo      emergent         procedural ("umbrella sedge")    1  348                             0
vallisneria aquatic          procedural, 20 ribbons           1  360                             9
sword       aquatic          procedural, 12 ribbons           1  144                             2
javafern    aquatic          procedural, 8 ribbons            1  80                              3
frogbit     floating         procedural discs + root ribbons  1  77                              3
lily        floating         procedural pads, petals, bud     1  100                             0
```

- Starter planting: world.js:283-301 (51 plants, matches the recording). `lily`, `bamboo` and `oldfern` are
  never planted by the starter or the generator (generator.js:532-940 lists the species it uses).
- Instancing: one `InstancedMesh` per species, one per GLB part (each part becomes a "variant", plants.js:386-406),
  cap 300 each (plants.js:360), `frustumCulled = false`, `castShadow = true` on all (plants.js:371);
  cards and GLBs also receive shadows (plants.js:373). Instance data: `instanceMatrix` + `instanceColor` only.
- Materials: `plantMaterial` (shaders.js:182-232), one per mesh, species constants (`amp`, `speed`,
  `underwaterAmp`) baked into the node graph. Structural classes: vertex-colour only (8 + litter), alpha card
  (5 + tufts), card + normal map (9 GLB variants). Toggling AO or photo mode recompiles all of them
  (shaders.js:22-25, gfx.js:190-195); Low has no AO (gfx.js:34).
- A second `Plants` instance (another 22 meshes and materials) is built when the first portrait is needed
  (portraits.js:39-40, lazily, Portrait.jsx:11). Cost on a weak machine unverified.
- Textures: cards are 512 px PNG (grass 256); each GLB has a 1024 px diffuse+alpha, 512 px normal and a 512 px
  roughness map that the game ignores (plants.js:404 passes only `map` and `normalMap`).
- Tool paths: `tools/import-polyhaven.mjs:25` and `tools/import-seedthree.cjs:19` write to `<repo>/assets`,
  not `public/assets`; fix or copy before using them for a plant batch.
- Placement rules: plants.js:413-447. Bug candidate (unverified in the game): `grass` and `weed` are
  `land|emergent`, the emergent branch returns first (plants.js:437-441), so on dry ground more than 3 cm
  above the waterline and farther than 5 cm from water they are refused with "Needs wet feet".
- Spread: `SPREAD` table, chance per day, reach and a per-species cap (plants.js:348-352; e.g. sword 6, lily 6,
  bilberry 8, vallisneria 40, frogbit 40).

### 1.2 Plants: cost per instance in the sim tick (verified by reading; milliseconds unverified)

`Plants.step` (plants.js:552-634) runs each frame for every plant. Land plants do about eleven bilinear map
reads (humidity, soil, light, fertility, humus, litter), `humus.take` and `humus.drop`; aquatic and floating
plants do a body lookup plus arithmetic (plantpond.js:23-36); emergents add an 8 to 16 probe `bodyFor`
(waterbodies.js:450-460). Then `WaterBodies.chemistry` loops all plants again (waterbodies.js:388-399),
`Climate.scan` splats each plant twice every 30 game minutes (climate.js:100-110), `Erosion.setRoots` visits the
cells under every plant every 4 s (water.js:454). `writeInstance` runs for a random 2% of plants per tick
(plants.js:623), about once a second per plant at 60 fps, with about a dozen short-lived objects each and a
whole-buffer upload flag. The recorder's whole "sim" phase is 2.2 ms per frame on the M1 (bench:hero, mean of 15 s,
`metrics/sessions/20261001-205445_bench1_muqfj2ujxqq3.ndjson`), so plants are a fraction of that, not measured.

### 1.3 Plants: variety today

```
what                  today                                          evidence
yaw                   random 0..2pi                                  plants.js:465, generator.js:230
scale                 uniform 0.8-1.2 (add), 0.8-1.25 (generator)    plants.js:454, generator.js:230
non-uniform scale     none                                           plants.js:514
variant               fernph 4, weed 5 (random); others 1            plants.js:451
colour                white times health tint; global patch noise    plants.js:518, shaders.js:214
leaf count, droop     fixed per species (fixed rng seeds 7..31)      plants.js:119, 188, 257 ...
size over time        uniform scale 0.3 to 1 with `grown`            plants.js:514
```

A player picks a species and a place; variant, scale and yaw are random and cannot be chosen (controller.js:470,
smart.js:225). Hard limits: 15 ids, 9 GLB variants, cap 300 per mesh, per-species spread caps, one material class
per mesh. The generator picks variants from its seed (generator.js:230) but has no per-patch palette.

### 1.4 Growth, cycles, death

- State on a plant (plants.js:463-467): `id, pos, reach, normal, surface, rot, scale, grown, health, age, index,
  variant`; transient `why[], fert, humusHere, litterHere, bodyName`. Saved: id, pos, normal, surface, variant,
  rot, scale, grown, health (plants.js:663-665); `age` is not saved. Save envelope `v: 3` (world.js:337).
- Growth: `ok` (0 to 1.2) is the minimum of limits: humidity below `humidity[0]`, soil below 0.22, drowned,
  waterlogged, mould above 0.7, light (daily mean `lightAvg`, sim.js:58), water chemistry for aquatics
  (plants.js:563-609). `ok > 0.6` grows ("full size in about 4 days", plants.js:610) and heals at 4x; `ok < 0.5`
  loses `3 x (1 - ok)` per 4 days; between 0.5 and 0.6 it stalls. Zero conditions kill in 1.3 game days. A game
  day is 24 real minutes at 1x (tank.js:48-49), so a plant matures in about 96 real minutes at 1x.
- Stages: none per plant. `STAGES` (ecology.js:32-40) is the tank's maturity, not a plant's.
- Flowering, fruiting, seeding: none (lily's bud and bilberry's berries are permanent geometry or texture).
  Seasons: `Env.season` is saved and never read. Photoperiod only enters as a 24 h light mean. Dormancy: none.
  Senescence: none; a plant that stays in range lives forever.
- Spreading: once `grown > 0.9` and `health > 0.8`, a daily chance places a `grown = 0.15` copy within reach
  (plants.js:624-630, offshoot 638-661). One mechanism for runners, plantlets and spores.
- Death and remains: instant `remove` (plants.js:632). Land plants drop `0.5 + 1.5 x size` litter on their cell
  (plants.js:619); every plant adds 0.8 detritus (sim.js:118). Litter becomes leaf cards (litter.js, cap 420),
  rots to humus and fertility (humus.js:112-152), feeds plants (plants.js:588-592). Aquatic and floating plants
  leave nothing visible. Healthy land plants shed litter continuously (plants.js:594); `leafDrop`, `soilMin`,
  `bog`, `canopy` and `tall` are read but no species defines them (verified by grep), so all species behave alike.
- Modes: `realism.harm` and mercy scale animal health only (sim.js:255, 277); plants die identically in every
  mode (plants.js does not read `world.realism`).

### 1.5 Visual decay: what the player sees

- Stressed or dying: the whole plant's colour multiplier moves from (1,1,1) to (0.85,0.6,0.3) as health falls
  (plants.js:518), computed on the CPU in `writeInstance` and applied through `instanceColor` (shaders.js:209).
  No wilt, droop, leaf drop, tip burn, yellowing by age, mould or rot. Size ignores health.
- Dead: the instance vanishes in one frame, a log line says "A X died" (sim.js:119). Land plants leave a litter
  patch; aquatic ones nothing.
- The causes are strings in `p.why` shown only in the Inspector as text (Vitals.jsx:165-167, InfoBanner.jsx:127-128).

### 1.6 Roots (verified)

- Data: none per plant. The only root array is the erosion field `root` 0..1 (erosion.js:56), rebuilt by
  `setRoots` (erosion.js:100-120): radius `clamp(1.5 + 2.5 x grown x min(1.5, scale), 1.5, 5.5)` cm, strength
  `0.8 (1 - d^2)`, the same for every species, ignoring health, substrate and species. Every terrain plant counts,
  aquatic and emergent too (water.js:32). It runs only while erosion is on (water.js:452-454).
- Effect: `hardness x (1 - 0.85 root)` (erosion.js:237) and `retainMap` (support.js:62-64), which lifts the slump
  limit by `1 + 2.5 x ret` (support.js:23, 107). Moss counts as "a mat of roots" (support.js:20).
- Rules that mention roots: waterlogged roots (plants.js:585, `env.soil > 0.9`, drainage < 0.3, nobody sets
  `bog`); emergents reach a pond within 6 cm for a boost of at most 0.3 (plants.js:597-601, plantpond.js:39-41);
  aquatics suffer "no oxygen at the roots" below 2 mg/L (plantpond.js:33); frogbit has hanging root ribbons
  2.5 to 4.5 cm long (plants.js:318-319). Epiphyte roots exist only in text (plant-info.js:46, 54).
- Substrate: plants never read the substrate material; `MAT` is imported and only re-exported (plants.js:9, 672).
  The false bottom and drainage are one tank-wide number (`env.drainage`, plants.js:585, climate.js:171).
- The hardscape "roots": `PIECES.roots` = `root_cluster_01.glb`, 44,960 triangles, `stamp: false`, variants warped
  from it (decor.js:40, 274). It shares only the word; animals treat it as occupied space (animals.js:357).
- Below the soil line: `Terrain` is `PlaneGeometry(1,1,nx,nz)` (terrain.js:230) with a front-face material
  (shaders.js:87-125) and a 0.02 cm margin to the glass (terrain.js:200). Grep finds no skirt, cutaway or
  section code. So no cross-section exists; how the soil edge looks at the front glass is unverified
  (needs a low-angle shot, `tools/angle-shot.mjs`). The only view of "roots" is the Stability lens (lens.js:23).

### 1.7 Plant animation and per-frame cost drivers

- Sway (shaders.js:194-207): two sines per vertex, weight `sway^2` (0 base, 1 tip; per-vertex attribute, for GLBs
  from radius and height, plants.js:397-400), phase `instanceIndex x 1.618`, amplitude from `AIR.air` or
  `AIR.flow`. Air and flow come from fan, fogger, rain, falls and the mean hydro speed (airflow.js:43-65);
  a still tank gives near-still plants (ambient 0.035). Growth is a uniform scale (plants.js:514); wall plants
  follow the wall normal; plants near the glass lean inward (plants.js:510-513).
- Fragment cost: one `mx_noise_float` per plant fragment (shaders.js:214), `wet()` (two `exp`, one caustic texture
  sample, shaders.js:38-60), back-light glow, alpha test on cards, `DoubleSide`. DESIGN.md:49 puts plants under
  1 ms at 2160x1350 on the M1; the Adreno cost is unverified.
- Shadows: all 22 meshes cast; the shadow map is redrawn every 2nd frame (gfx.js:90).
- CPU: section 1.2, plus `LitterView.build` (up to 420 leaves, three terrain/water queries and three
  allocations each, litter.js:55-94) every 40 ticks, `Decor.scatterMoss` in one go every 6 game hours
  (ecology.js:90-100, decor.js:560-600), and `updateAirflow` sampling up to 700 cells every 0.4 s.

### 1.8 Static performance facts (starter tank, 1280x720, M1, WebGPU, high)

```
category            instances   tris per pass     draws (main)         materials
plants              51          24.5k             <= 19 (unverified)   22 (+litter +tufts)
moss tufts          <= 5,000    <= 40k (8 each)   1                    1
leaf litter         <= 420      <= 3.4k           1                    1
animals, coarse     106         767k              >= 10, + blend, hi   per species or morph
hardscape "roots"   1           44,960            1                    own
recorded            51 plants, 106 animals, 212 draws, 2.33M tris, 60 fps (p50 16.5, p95 18.4 ms),
                    sim 2.2 ms, render submit 3.1 ms, GPU mean 12.5 ms (max 17.1), 0.8 s to title
```

Animals x 2 passes = 1.53M of the recorded 2.33M; the rest (hi meshes near the camera, terrain, rocks, water,
glass, plants) is not split: run `tools/drawcalls-by-kind.mjs`, which tallies main and shadow separately.

### 1.9 Animals

- 27 species (animals.js:141-308): fish 8, crustaceans 3, insects 4 (fly, maggot, pupa, springtail), snail 1,
  amphibians 10 (incl. tadpole, eggs), gecko 1. Behaviour kinds: `swim` 804, `crawl` 943, `frog` 1049, `fly`
  1009, `newt` 1717, `axolotl` 1741, `gecko` 1750 (animals.js). Hunters strike with a tongue pool of 12
  (animals.js:1402-1520, tongue.js:8).
- Bodies: one signed-distance function per species (`render/creatures/bodies/*.js`, 2,780 lines), meshed by naive
  surface nets in up to 4 workers (shape.js, meshpool.js:13-27) at two levels of detail; `hi` is 4x the triangles
  (cell x 0.5); the fine mesh is swapped in within `34 + 10 x size` cm of the camera (animals.js:331, instanced.js:240).
  Measured (lo / hi): neon 3.8k/15.1k, cory 7.6k/30.8k, shrimp 8.0k/33.2k, isopod 4.2k/18.0k, springtail
  6.8k/27.9k, fly 9.5k/38.5k, maggot 4.7k/19.0k, snail 13.0k/52.2k, gecko 15.5k/61.9k, newt 17.3k/70.3k,
  axolotl 17.8k/72.5k, dartfrog 21.4k/86.5k.
- GLB upgrades (manifest.json, written by `npm run import-creatures`): leucomelas 10k/30k, strawberry 7k/30k,
  firesal 8k/32k, loach 19k. Rig derived from shape (glb.js:76-97); static pose, legs optional; budgets hero
  40k/7k, small 9k/2.5k (import-creatures.mjs:26); brief in docs/ASSET_BRIEF.md.
- Animation (verified): GPU, one shader per finish (instanced.js:117-163): body wave along `spine`, diagonal-pair
  leg lift and swing, hop leg stretch, breathing swell, throat bulge, eye retraction, fin flutter. Per instance
  `iPos(xyz,scale) iRot iAnim(phase, amp, gait, packed hop+breath+throat+eye)` (instanced.js:29-31). CPU `vis()`
  (animals.js:1652-1715): blink, head yaw and roll twitches, alertness, gulp, crouch, lunge, nosing, settle.
- Life: size scales 0.35 to 1 over `adultDays` (animals.js:1805), eggs hatch to tadpoles, tadpoles are removed and
  a young frog added (sim.js:258-271); fruit fly egg, maggot, pupa, adult (flylife.js); 5 species have morphs
  from genetics (docs/GENETICS_SPEC.md).
- Material: `creatureMaterial` runs `mx_noise_float` four times for the bump gradient and once for tone, more per
  eye (material.js:76, 113-125); only `grainAmt: 0` skips it, and the GLB finishes use 0.15, so they still run it.
  A second alpha-blended pass exists per species with fins or glass (instanced.js:46-56).
- Cost drivers: triangles (coarse x shadow), per-fragment noise, blend pass, per-frame allocations in
  `Animals.draw` (animals.js:1791-1860), `castShadow` on every creature (instanced.js:44).

## 2. Gaps against the brief

**Variety.** A player cannot get a different looking plant of the same species, choose a variant, or tell two
vallisneria apart. There are no cultivars, no carpet plants, vines, stem plants, shrubs or flowering plants
besides the lily. The generator cannot make a coherent patch of one look. Everything that would add species (a
builder, a GLB, a card) also adds a material, a mesh and a build.

**Visual decay.** Stress is invisible except as a darker tint; the cause is text only. A drowned, a starving and a
dry plant look the same. Plants never wilt, shed, yellow in order of age, brown at the tips, rot at the base or
grow mould. Death is a pop, with no husk, and for water plants no remains.

**Plant cycles.** No seedling, juvenile, flowering, fruiting, dormant or senescent stage; no lifespan; no season
although the biotope text promises wet and dry seasons (biotopes.js:12) and rain programs exist; the bromeliad
"cup" and the berries are text and texture only; leaf litter is a constant trickle, not leaf fall.

**Roots and root dynamics.** A player cannot see, inspect, plan or damage roots. There is no root data, no
species difference (a grass mat and an epiphyte hold soil the same, an epiphyte holds soil at all), no uptake of
soil water, no competition between neighbours, no response to substrate, no rot with hysteresis, no exposure
when erosion undercuts, no aerial or submerged root growth, no way to look below the soil line.

**Animals (models and animation).** Over-tessellated tiny animals; no head, tail or jaw motion, no foot placement,
no gait blending or turn-in-place; juveniles are scaled adults; metamorphosis is a swap; behaviours described in
the field guide (tadpole carrying, calling, guarding, mothers feeding tadpoles: species-info.js:152-163,
concepts.js:194) do not exist in the sim; 23 of 27 species still use procedural bodies.

## 3. Constraints and budgets

Project rules that bind every stage (CLAUDE.md, DESIGN.md): nothing slow inside a frame (generators under
`sim/jobs.js`, which exists only in `Water`, water.js:53, and is pumped only while erosion is on, water.js:452-462,
so plants need their own `Jobs` pumped from `Game.frame` next to `slack`, game.js:178-188); no expensive noise per
fragment (bake or branch on a uniform); few unique material graphs; resize and pipeline changes before the frame;
kernels in pure modules with Node tests; `tests/architecture.test.mjs` green. Layering consequence: a new
`sim -> render` import fails the test (KNOWN list, architecture.test.mjs:30-43). Put kernels in `src/sim/` and
profiles in `src/content/` (util and content imports only), put shader code in `render/shaders.js` or a render
module it imports, and put any new view (soil section) in `engine/` or `app/`, driven by a frame hook.
Saves are `v: 3`: add optional fields with defaults; old saves derive new fields from position hashes.

Weak target (Windows 11 ARM, Adreno, WebGL 2 via ANGLE/D3D11, 16 GB, touch): fragment ALU and overdraw are the
risk; compile cost multiplies with unique graphs; a saturated GPU freezes the desktop, so Low (no AO, 1024
shadows, no bloom, gfx.js:34) and the 30 fps cap rung must keep working. Test the WebGL 2 path locally with
`metrics-run --lan` (plain http, no WebGPU).

```
resource        today (M1, measured)                  rule for this phase (proposals, validate on ARM)
frame           60 fps, p50 16.5, p95 18.4 ms         no p95 regression at the same preset
CPU sim phase   2.2 ms mean                           plants+roots+life <= +0.15 ms mean, 1.0 ms worst
CPU submit      3.1 ms mean                           <= +2 draw calls in total
GPU             12.5 ms mean, 17.1 max                plants <= +0.3 ms; no new per-fragment noise
draw calls      212                                   not above 212
triangles       2.33M                                 plants <= 3%; animals below 1.2M after S5a
shader builds   ~130 (DESIGN.md:37)                   plant materials 24 -> 6 or fewer; none per species
load            0.8 s to title                        no regression; compare builds on the ARM laptop
memory          instance attrs 19 floats per plant    <= 64 B per plant; new textures <= 1 MB
```

Numbers to track (recorder fields; `npm run metrics:run -- --label=<x>` or
`node tools/metrics-run.mjs --label=<x> --bench=quick`, `--compare <before> <after>`, two interleaved runs each):
`g50` and `g95` (frame ms, fps), `gpu` mean and max, `sim` and `rnd` ms per frame, gauges `calls`, `tris`,
`animals`, `plants` (src/diag/adapter.js:140-146), `heap`, the `tank-load` and first-paint events, `slow` and
`loaf` events. Add (not available today): plant sim ms per frame, litter rebuild ms, count and time of material
builds at load. Also `tools/drawcalls-by-kind.mjs` (main vs shadow per kind) and `tools/perf.mjs --profile=1
--cpu=4` for functions. Every stage: `npm run test:unit`, then 16:9 and phone screenshots (DESIGN.md:78).

## 4. Staged plan

Each stage ships alone. Sizes as in ROADMAP: S under a day, M a few days, L about a week.

### S0. Make room (S to M, no visible change)
- Changes: `plants.js` step becomes a scheduler: each plant has a due time (jittered, 10 game minutes or more),
  at most 2 plants per frame, each stepped with its own elapsed dt; `writeInstance` only when scale or tint moved
  past a threshold (replace plants.js:623); litter view rebuilt by game time (3 game hours) not by 40 ticks;
  plant meshes built on first use, as `Animals.meshFor` does (animals.js:407-416), and `oldfern` dropped; gauges
  for plant ms and litter ms. Extract the `ok`/boost arithmetic into a pure `src/sim/plantgrow.js`.
- Spikes (answer before S1): `attribute('iLife','vec4')` as an extra instanced attribute on an `InstancedMesh`
  in TSL on WebGPU and on the WebGL 2 path (creatures already do this on a plain Mesh, instanced.js:29-35);
  whether `BatchedMesh` (WebGPUBackend.js:2124, WebGLBackend.js:1054-1076, needs `WEBGL_multi_draw`) can hold
  all species in one object.
- Tests: `tests/plantgrow.test.mjs`: staggered stepping over 5 game days matches the per-tick result within 1%.
- Budget: sim phase 2.2 ms must not rise; fewer builds on the title tank. Accept: before/after recordings.

### S1. Variety and the shared foliage shader (M) - recommended start
- Changes: `src/content/plant-look.js` (per-species ranges, cultivars, palettes); `src/sim/plantlook.js` pure
  `rollLook(id, seed)` -> `{variant, sx, sy, sz, lean, hue, sat, leaves, seed}` (same pattern as
  `placement.rollLook`, placement.js:55); `plants.js` stores a `look` seed (saved; old saves derive it from
  `hash3(pos)` so they look the same on every load) and writes non-uniform scale into the matrix;
  `geo.js` `Builder` and `cardGeometry` emit a per-vertex `leaf` attribute (rank 0 oldest to 1 youngest, plus a part
  flag); `shaders.js` `plantMaterial` reads per-instance `iLook` and `iLife`, applies hue/saturation, stretch and a
  leaf-count threshold, and loses its per-fragment noise (shaders.js:214) in favour of per-instance tone.
  Species constants (amp, speed) move out of the graph into per-instance or per-species uniforms.
- Mesh and material: one material for all vertex-colour species and one for cards, by putting cards in one
  atlas (4 cards fit in 1024x1024, the vertex-colour species sample a white texel); GLB ferns keep a third.
  Build ranks for GLBs at import (`_LEAF` attribute from connected components, in tools/import-polyhaven.mjs) or
  at preload (union-find over 6k triangles, a few ms). Add 8 or more species from five growth-form builders
  (rosette, grass, stem, carpet, vine) with seeds, plus a patch palette in the generator.
- Data model: `look` seed (int) and optional cultivar index per plant, nothing else saved.
- Tests: `tests/plantlook.test.mjs` (deterministic, ranges, variants evenly used, no NaN, old-save derivation
  stable); architecture test unchanged.
- Budget: draws not above today; plant materials 24 -> at most 5; tris per plant unchanged (new species within the
  per-form caps: 400 tris, hero 1.5k); vertex +about 15 ops, fragment +0 net (one noise removed); instance data
  up to 8 floats more per plant.
- Accept: a contact sheet of 9 vallisneria and 7 ferns where no two match (16:9 and phone); recorder: calls
  and tris equal, GPU mean not worse, load not worse (expect better), builds counted before/after.

### S2. Visual decay and senescence (M)
- Changes: pure `src/sim/plantstress.js` turns structured stress channels (`dry, wet, dark, hungry, burn,
  mould, heat, rot`, replacing the `why` strings; the strings are derived from them) into `{yellow, tipBurn, wilt,
  shed, blacken, mould}` with hysteresis (wilt reverses in hours, yellowing in days, shed never) and species
  sensitivity. `plants.js` computes the channels (it already knows each cause). Death becomes dying, then a husk
  for 1 to 3 game days, then removal and litter (keep the litter amounts); aquatic husks add detritus over time.
  Inspector shows the cause and what to do; modes scale severity with `realism.harm` (Explorer 0.4).
- Shader: per-leaf rank against `iLife.y` (decay) and `iLife.z` (wilt): older leaves yellow and brown first, droop
  by bending around the base with `sway^2`, shrink and vanish toward the crown when shed; tip burn along
  `sway`; black base for rot; mould speckle from a baked noise texture (the `util/noise.js` + `render/dew.js`
  pattern) or a per-vertex hash. No new material. Visible causes:
  ```
  cause                 look                                           knob
  drought, dry air      droop, curl, grey-green, crisp brown tips      wilt, tipBurn
  waterlogged, rot      black base, lower leaves yellow and fall       blacken, shed
  too dark              pale, stretched, few small leaves              stretch, leaves
  starving              older leaves pale yellow first, small new ones yellow, leaves
  ammonia, nitrite      glassy patches, melting edges                  tipBurn
  stale wet air         white fuzz on old leaves                       mould
  age                   outer leaves yellow in order, drop to litter   shed by rank
  ```
- Tests: `tests/plantstress.test.mjs`: mapping monotone and bounded, hysteresis, each cause has a distinct
  dominant channel, death timeline, litter plus detritus conserved against the old formulas.
- Budget: vertex +about 20 ops, fragment +about 8; CPU only at per-plant updates; no draw or material added.
- Accept: a sheet of 7 causes x 3 severities x 3 growth forms readable at 640x360; a player can name the cause
  from the picture; recorder shows no GPU or p95 change; `tools/steps/deaths.mjs` and humus steps still pass.

### S3. Plant life cycles (L)
- Changes: `src/content/plant-life.js` per species: days to juvenile and mature, lifespan or perennial, bloom
  trigger (photoperiod window, temperature band, season, health), bloom and fruit duration, reproduction mode
  (runner, plantlet, spore, seed), dormancy trigger, leaf turnover. `src/sim/plantlife.js` pure stage machine
  `seed -> seedling -> juvenile -> mature -> flowering -> fruiting -> senescent -> dormant|dead -> husk -> gone`
  using an injected rng. `Env.season` becomes live: dry season is the player's lever (rain program, mist,
  humidity) and gates dormancy, flowering flush and frog breeding together. Fruit that drops feeds the fruit fly
  life cycle through the existing fruit list (fruit.js, flylife.js). Bromeliad cup water fed by rain, for tadpoles.
  Save `age`, `stage`, `look` (older saves default to mature). Inspector and Field Guide show the stage.
- Shader and mesh: flowers and fruit are flagged vertex parts in the same geometry, scaled by `iLook.w`
  (bloom) and `iLife.w` (fruit ripeness), vertex colours only; seedlings show fewer leaf ranks (growth is
  unfurling, `iLife.x`), dormancy sheds all ranks except the crown. Flower and fruit parts add at most 20% tris.
- Tests: `tests/plantlife.test.mjs`: stage order, bloom gated by photoperiod and season, dormancy and recovery,
  lifespan, spread caps hold, deterministic with a seed, save round trip, old save defaults.
- Budget: sim cost near zero (transitions are rare, steps staggered by S0); no new material.
- Accept: a 60x time-lapse of 30 game days takes a plant through at least 4 stages; no species outgrows its
  cap; a dry-season program triggers dormancy and the wet season a flush; recordings equal to S2.

### S4. Roots and root dynamics (L)
- Changes: `src/content/plant-roots.js` profiles (depth, spread, kind, appetite, hold, rot tolerance) and
  `src/sim/rootzone.js` pure kernel per plant: footprint on the 3 cm climate grid (at most about 25 cells),
  uptake of soil moisture and fertility with competition between overlapping plants (shares by root density),
  growth toward moisture (centroid bias) capped by ground height, rot with hysteresis from low oxygen
  (waterlogged, warm, no drainage), exposure when erosion lowers the ground below the crown (`groundChanged`,
  world.js:66-80). `Erosion.setRoots` takes per-plant `{x, z, r, hold}` from the kernel (erosion.js:100-120),
  so a grass mat holds a bank and an epiphyte does not, and a rotten or dead root loses hold over days.
  `climate.js` gains a substrate class map and a soil-water sink. Kinds: fibrous mat (grass, weed, ferns),
  taproot shrub (bilberry), heavy feeder rosette (sword), rhizome clinger (javafern: burying kills,
  plant-info.js:89), anchor plus runners (vallisneria), hanging (frogbit), aerial and clinging (bromeliad,
  pothos: mist and cup, no soil), emergent rhizome (cattail, sedge).
- What the player sees: (a) a "Roots" lens (lens.js, no new shader: root density on the 3 cm grid);
  (b) a soil cross-section strip along the front and side glass, built from the heightfield edge row
  (about 250 quads, one draw, one new material; layers by depth, root threads from a 512x64 data texture
  updated at most twice a second by a job, two texture reads per fragment, no noise); (c) aerial, exposed
  and submerged roots as flagged vertex parts scaled by `iLife` (bromeliad and pothos clinging roots, frogbit
  and lily hanging roots that lengthen in poor water, crown roots appearing as a bank erodes); (d) Inspector
  root panel (depth, spread, moisture, oxygen, rot). Rot reads as a black base (S2 channel), drought and root
  rot are told apart by soil wetness.
- Tests: `tests/rootzone.test.mjs` (soil water conserved, competition splits shares, rot hysteresis, hold grows
  with density and feeds `Erosion.setRoots`, exposure, determinism, save round trip); the existing "root
  mats resist" erosion test (erosion.test.mjs:96) keeps passing.
- Budget: kernel O(cells) per plant, staggered, about 0.02 ms per frame at 300 plants (estimate); +1 draw,
  +about 500 triangles, +131 KB texture; GPU +0.2 ms at most; load unchanged.
- Accept: a planted bank loses measurably less soil than a bare one in an erosion run; overwatering produces rot
  and a black base; an epiphyte grows aerial roots; the section is readable at 1280x720 and on a phone; the
  recorder shows +1 draw, GPU within budget. Unverified until built: how the soil edge looks today at the glass.

### S5. Animals: model and animation upgrade (L, in four independent pieces)
- 5a Triangle budget and LOD (S to M, do first, biggest performance win in the project): coarser cells for
  tiny species (springtail, fly, maggot, isopod, shrimp to 300 to 1,000 triangles; their shaded size is a few
  pixels), `hi` meshes off on Low, grain noise baked or branched off by preset and for tiny species
  (material.js:113-125). Test: a Node budget test meshes each body at `lo` with `bodyArrays` and asserts a
  per-class triangle cap (about 5 s for 27 bodies). Goal: starter animals 767k -> under 250k per pass.
- 5b Rig and secondary motion: a second vertex attribute `rig2` (head, tail, jaw weights) and a per-instance
  `iPose` (head yaw and pitch, tail bend, jaw) fed by a CPU spring-damper for the nearest N animals only;
  smooth `amp` and `gait` across state changes, turn in place, crouch to hop. Pure `src/sim/pose.js`
  kernel. Budget: CPU <= 0.1 ms, no new material, vertex +about 15 ops.
- 5c Life stages: age-driven proportion morph (large head and eyes, thin limbs) through `iPose.w`, and two or
  three intermediate bodies (tadpole with hind legs, froglet with tail stub) so metamorphosis is continuous
  instead of the swap at sim.js:269-271. Test: stage boundaries and the swap-free transition in a pure kernel.
- 5d Species behaviours as pure state machines in a new `src/sim/behaviour.js` (animals.js imports render and is
  not Node-testable): tadpole carrying and bromeliad nurseries, calling with the throat pulse, egg guarding,
  night sleep, gill pumping, shrimp moult. Needs S3's bromeliad cup. Accept: each behaviour has a unit test and
  a screenshot sequence.
- GLB route: keep static models plus derived rig for hero species (ASSET_BRIEF), add `_HEAD` and `_TAIL`
  vertex tags in the importer so `addRig` gets head and tail channels; do not add skinned bones (GPU cost for
  100 instanced animals on Adreno, unverified).

### Which stage first, and why
Start with S0 then S1. S1 is visible at once (every generated tank looks different), builds the per-instance
channel and the leaf-rank geometry that S2, S3 and S4 all reuse, cuts shader builds from 24 to about 5 (the weak
machine's load pain), touches no balance (career and commission tests unaffected) and is triangle and draw-call
neutral. S2 follows (the cheapest dramatic change); S5a can run in parallel because it is independent and is the
largest GPU saving. S3 and S4 come after the shared shader exists.

## 5. Open questions for the user

1. Pacing: should plant life run on the existing clock (a game day is 24 real minutes at 1x, so a plant matures in
   about 96 minutes and flowering is a time-lapse event), or be compressed so flowering, leaf fall and root growth
   show within a normal 10 to 20 minute session? This sets every duration in S3 and S4.
2. Plant art route: parametric growth-form builders (cheap, tintable, about 20 species, tiny triangle budget)
   or scanned and generated GLB plants (richer, bigger textures and triangles, needs a plant asset brief like the
   animal one)? New models in `art-src/drop` would change S1's content work.
3. Roots view: should the soil cross-section along the glass be always on (it changes the look of every tank and
   shows layers, drainage and roots) or only when a "Roots" view is switched on?

## Appendix: how the numbers were produced

- Plant triangles: lines 14-345 of `src/sim/plants.js` lifted into a temporary module with the real
  `Builder` (`src/render/geo.js`) and `rng`; each `build()` called; counted `index.count / 3` or
  `position.count / 3`. GLB triangles: `node tools/inspect-glb.mjs public/assets/models/<file>.glb`.
- Animal triangles: `bodyArrays(BODIES[key](), 'lo' | 'hi').index.length / 3` from
  `src/render/creatures/shape.js` and `bodies/index.js`, run under `nice`.
- Starter totals: 51 plants and 106 animals from world.js:283-320; multiplied by the per-instance counts.
- Recorder values: `metrics/sessions/20261001-205445_bench1_*.ndjson`, `sec` lines of phase `bench:hero`
  (`gpu` is `[samples, mean, max]`, recorder.js:96-100).
- The three temporary scripts were removed after use; nothing else was written outside this file and
  `agent-status.md`.
