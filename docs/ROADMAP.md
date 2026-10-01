# Plan of action (from the 2026-09-30 feedback)

Status: **plan only, nothing below is built yet.** It is grouped by theme, with what I found in the code, what I propose, rough size
(S = under a day of focused work, M = a few days, L = about a week or more) and the decisions I need from you. Items are ordered
so that early ones unblock later ones.

## 0. Questions I need answered first

1. **The Hugging Face reference.** The water code today is the "virtual pipes" shallow-water model (Mei, Decaudin & Hu 2007, the
   family used by Webgl-Erosion and similar). I do not have a Hugging Face link in my notes. Please paste the model or Space you
   meant, so I can check whether it is the same method, a different one (for example SPH or a learned model), or only a source of
   erosion ideas. Until then I assume virtual pipes plus sediment.
2. **New GLB assets.** How many, and what are they (rocks and boulders, wood, plants, creatures, backgrounds)? Where do I find
   them? Are they one file per object or sets? Any licence notes I should put in CREDITS?
3. **"The random sets were not implemented."** Generated terrariums are in the build (Title screen, "Start from a generated
   terrarium", also "Surprise me" and the Kids' corner worlds), but they only exist locally: nothing was pushed, so the
   GitHub Pages site still shows the old game. Did you mean that, or something else (for example random sets of plants and objects
   inside a tank, or random layouts for the starter tank)?
4. **Modes.** Child mode exists. I propose three adult-facing levels, named below. Do the names and the split in section 4 feel right?
5. **Decided:** erosion and per-pond water quality are both wanted, and they can co-exist (see 2b and 2d: they share one water-body graph, built once in 2a).

## 1. Quick correctness fixes (do first, S each)

| Problem | What I found | Fix |
|---|---|---|
| Objects and plants go through the glass | `Decor.clampPiece` keeps only the piece *centre* 1 cm inside the tank. Big pieces, scaled or rotated pieces and wide plant canopies still cross the glass. Kits and the generator place pieces by centre too. | Clamp with the rotated bounding box (and a plant's canopy radius, leaning plants inward) against the inside of the glass; apply it to drag, kits, mirror copies, generator and loading old saves. Add a unit test that places every piece type at every wall. |
| Boulders and objects are always the same | `PIECES.boulder` has only two source models, spires are one procedural shape, and each placement just scales them. | Many more variants per type (your new GLBs), a seeded random pick plus non-uniform scale, rotation, flip and a per-piece material tint, so no two rocks match. The generator and kits pick variants from the seed. |
| Cliff positioning | A cliff face is stamped like a boulder: it is positioned by its centre and rotated freely, so it floats, tilts or sinks. | A "face" placement mode: snap to the back or side wall or to a slope, orient along the surface normal, embed a fixed depth, auto-ground, and a clear anchor indicator. The waterfall kit and the generator use it. |
| Fish and animals get stuck | Animals only test the height field and the tank bounds (`heightAt`). Pieces that are not stamped (roots, wood, arches, overhangs) are invisible to them, so they wedge in. | A coarse occupancy grid built from the pieces (updated when a piece moves), steering that avoids it, and a stuck detector (almost no movement for a few seconds: back off, re-target, last resort teleport to a free cell). |
| Plants "moving randomly" | The sway shader runs all the time with a fixed amplitude, as if there were wind in a closed tank. | Sway only where air or water really moves: strength from the fan, the fogger or rain, waterfall spray and the water current (flow velocity); still air means still plants. Default amplitude near zero. |
| Truly full screen | No Fullscreen API use. | A full-screen button (and `F11`-like hint) using the Fullscreen API with a hidden-chrome layout; on iPhone Safari (which does not allow it) a PWA manifest so "Add to Home Screen" runs full screen; safe-area and `dvh` fixes; a Zen toggle that hides all HUD. |

## 2. Water, ground and structure (the big realism block)

### 2a. Water balance and recirculation (M)
- **Today:** one main pool (the "reservoir") holds most of the water. A pump lifts water to outlets, the water runs over the
  ground (virtual pipes), fills hollows, spills, falls off ledges and returns. A top-up keeps the total volume. This is a good
  base, but the loop is not visible or measurable, and editing the ground breaks it.
- **Bug class "water disappears under the pump":** raising ground changes which cells belong to the reservoir. If the pump's
  intake cell is no longer under water the pump stops (`level > intake + 2.5`), and water that was sitting on cells you raised
  is deleted instead of moved. So volume is not conserved across edits.
- **Plan:**
  1. Conserve mass on every terrain edit: water displaced by raised ground is pushed to the nearest lower wet cells or the
     reservoir; water exposed by lowering ground flows in. A conservation test (total before and after every edit, within 0.1%).
  2. Make the circuit explicit and always balanced: intake (with a screen) -> pump (flow curve with head height) -> manifold ->
     outlets with a valve share each -> flow paths -> pools -> return weirs/drains -> sump (the main pool). The pump flow is
     split by the valves; the return equals what arrives, and the main pool level moves with the real balance (plus
     evaporation and top-off).
  3. A flow-balance panel and lens: litres per hour in and out of every outlet, pool, stream and the sump, with warnings
     ("this pool gets 80 L/h and returns 20: it will overflow", "pump is starving", "no return path"). Pump auto-moves or warns
     when you bury its intake.
  4. Pools get real weirs: overflow height, spill direction, level that follows inflow minus outflow, so ponds fill and settle
     the way real ones do instead of just accumulating.

### Shared foundation for 2b and 2d
Both need to know, every few ticks, which wet cells form one body of water and how water moves between bodies. 2a builds that **water-body graph** (connected wet cells plus the flow links between them). Erosion works per cell on the flow field; water quality works per body on the graph; sediment ties them together (turbidity per body cuts light, so algae and plants respond; eroded soil releases nutrients to the body that receives it).

### 2b. Erosion, sand and soil (M-L)
- Extend the shallow-water step with **suspended sediment** (capacity grows with flow speed and slope, shrinks with depth),
  **erosion and deposition** that really change the height field, material **hardness** (rock does not move, gravel a little,
  sand and soil a lot) and **thermal slumping** (angle of repose: loose material slides until stable). Visual feedback: cloudy
  water downstream, sand fans and delta deposits, bank undercutting, ripples; a "stability and erosion" lens; a sediment
  trap or a plant root mat reduces erosion (so planting banks matters).
- Runs on a coarse schedule (a few steps per second) and only where water flows fast, to keep frame cost low.

### 2c. Structure that "stands" like in real life (M-L)
- A support model: ground can only hold a slope up to its angle of repose unless it is supported; overhangs and tall
  vertical soil faces collapse (slump) unless a **retaining structure** holds them (hardscape, a wall of rocks, a false bottom,
  an egg-crate foundation). Pieces need contact with ground or another piece (a support graph with settle and a "this will
  fall" warning), and stacked heavy pieces on soft ground sink and tilt a little.
- Feedback: a stability lens (green stable, amber marginal, red will slump), a short creak/slide cue and dust, and a Fix hint.
- This ties to erosion (undercut banks fail) and to the cliff placement fix.

### 2d. Water quality per pond (M)
- Today ammonia, nitrite, nitrate, oxygen, temperature and algae are single values for the whole tank. Make them **per water
  body** (main pool, each pond, each stream reach), with exchange along the flow, plant uptake (the "depuration" cycle) in each
  body, fish and detritus load per body, temperature from the lamp and depth, and nitrifying bacteria per body.
- UI: a water-quality lens and a per-pond card; animals read the body they are in. Different ponds then genuinely differ
  (a planted shallow pond clean, a deep fish pond loaded).

## 3. Life on the ground: humus, decay and micro-fauna (M-L)

- **Decay chain:** dying plant parts and leaf litter become *litter* on the ground, which rots (rate from temperature and
  moisture, faster when warm and wet, mould when stale) into **humus**, which raises **fertility** that feeds plants.
- **Data:** per-cell `litter`, `humus` and `fertility` fields beside the soil/moisture maps, saved with the tank.
- **Visual:** humus darkens and enriches the soil shader, litter appears as scattered leaf cards that shrink as they rot, moss
  and plants favour fertile cells; a fertility lens.
- **Micro-fauna (first stage: fruit flies):** full life cycle egg -> larva (maggot) -> pupa -> adult. Larvae live in litter and
  rotting fruit, eat it and convert it to humus and frass; adults breed and feed frogs; frogs eat both. Population depends on
  food, moisture and temperature. Later stages add springtails, isopods, millipedes, earthworms and beetles with their own
  niches (the data model is species-driven so these are additions, not rewrites).

## 4. Modes: Child, Explorer, Naturalist (and what each changes) (M)

| | Child (built) | Explorer (intermediate) | Naturalist (realism) |
|---|---|---|---|
| Building | tap pictures, tap the tank | smart placement + presets, all tools available | every tool, precise handles, structure rules on |
| Failure | pets never die, helper cares | warnings and auto-recovery, deaths possible but slow | full consequences |
| Water and chemistry | hidden | simplified (clean / needs attention), water balance auto-managed | per-pond numbers, erosion, flow balance, support |
| Teaching | stickers and one fact | guided coach, concept cards | full field guide and Lab |

- **A mode picker** on the Title screen and in Settings (switchable per tank), driven by one table of rules that switches
  sim features (erosion, support, per-pond chemistry, failure) and UI density.
- **Placement without the tedium (mobile first):** "smart place": tap once and the object snaps to ground, wall or surface,
  orients itself, spaces itself from neighbours, embeds correctly and offers "place another / make a group"; drag handles only
  on request; large touch targets; one-finger place, two-finger orbit; undo always visible. Explorer reuses the Kids' tray
  pattern with more categories; Naturalist keeps today's precise tools as an "advanced" drawer.

## 5. More tank sizes (S-M)
- `content/tanks.js` is data-driven, so adding sizes is mostly data plus generator support. Proposed additions: Cube 30 (desk), Tall
  rainforest 60x45x90, Long riparium 150x40x50, Corner/wide 120x60x60, Grand 130 stays, Show 180x70x90; plus a **custom size** (sliders within
  safe limits) in sandbox. Each needs grid resolution (`cellsPerCm`) tuned for performance, camera fit, generator scaling per tier and unlock ranks.
  Non-rectangular tanks (round, hex) are a later, bigger step.

## 6. New GLB assets (S-M once I have them)
- Pipeline exists (`tools/import-creatures.mjs` for animals, `tools/import-polyhaven.mjs` for rocks and plants; flatten, weld,
  simplify, WebP textures, meshopt, manifest). Plan: generalise to `art-src/<category>/*.glb`, categories rocks / wood / plants /
  decor / creatures, auto LOD and collision proxy, a per-asset sheet in the bench, and registration in `PIECES` and `PLANTS`
  as variant lists so the variety fix in section 1 uses them immediately.

## 7. Suggested order
1. Section 1 fixes (glass, variants with your GLBs, cliffs, stuck animals, plant sway, full screen): a few days, high visible payoff.
2. Section 2a (mass conservation, circuit and balance panel): the water complaints and prerequisite for 2b-2d.
3. Mode framework + smart placement (section 4): makes the game usable on mobile before adding more depth.
4. Section 3 (humus, decay, fly life cycle).
5. Section 2b-2d (erosion, structure, per-pond quality) as the Naturalist tier.
6. Section 5 (tank sizes) can slot in anywhere after step 1.

Everything runs through the same checks as before: unit tests for pure logic (conservation, support, genetics, decay), a sweep of all
generated tanks for stability, and screenshots at 16:9 desktop and phone.
