# 3D asset brief: animals for Paludarium

Goal: replace the procedural animal models with realistic, textured models. The game already runs each animal as a
GPU-instanced mesh with procedural animation (swimming wave, walking gait, hopping), so we need **static, neutral-pose,
textured models**, not animated clips. A model that is missing simply falls back to the built-in procedural one, so you can
deliver in any order.

## Best workflow (image first, then 3D)

Text-to-3D alone gives goofy animals. Image-to-3D from a clean reference photo gives much better shapes and textures.

1. Generate a **reference image** with your image tool using the prompt for that species below (neutral background,
   one animal, 3/4 view, even light).
2. Feed it to an image-to-3D tool (Meshy, Tripo, Rodin/Hyper3D, Hunyuan3D, Luma…) with **PBR textures on**, symmetric pose,
   "no base / no background". Prefer the tool's highest-quality mode.
3. Optional cleanup in Blender: delete stray geometry, set the origin and scale (see below), fix the pose if needed.
4. Export **glTF binary (.glb)**, Y-up, and drop the file into `art-src/creatures/` with the exact filename listed.

## Technical spec (all models)

| Item | Requirement |
|---|---|
| Format | `.glb` (glTF 2.0 binary), one file per animal/morph |
| Units | **metres**, real-world size (a blue dart frog is about `0.045` long). The game multiplies by 100 to get centimetres |
| Axes | **Y up, head towards +Z** (looking down −Z at the animal's tail), animal centred left/right on X |
| Origin | walkers/crawlers: on the ground plane, centred under the body. Swimmers (fish, tadpole): at the body centre |
| Pose | Neutral and **symmetrical**. Fish and salamanders: body and tail dead straight along Z (we bend them in the shader). Frogs: relaxed sitting pose, legs folded naturally. Geckos, newts, axolotls, crabs, isopods: standing, limbs splayed out to the sides so each leg is separate from the body. **No T-pose arms, no bent tail, no open mouth** |
| Triangles | hero animals (frogs, newt, axolotl, gecko, crab, shrimp): **15k–40k** tris. Schooling fish and tiny animals (tetras, springtail, fly, isopod): **3k–10k**. The game makes lower LODs automatically |
| Textures | PBR **base colour** (1024², or 2048² for heroes), **normal map** if available, **roughness/ORM** optional. **No baked lighting, shadows or highlights in the base colour** (most tools have an "albedo only / delight" option). sRGB colour, 8-bit |
| Materials | 1 material for the body is fine. If you can, split out **eyes** as a separate material named `eye` and fins/gills as a separate material named `fin` (translucent). Not required |
| Mesh | Single mesh or few meshes, no cameras/lights, no rig needed, no animations needed, no ground plane or pedestal, no text |
| Scale check | Bounding-box longest side matches the "real length" column below within ±15% |
| Licence | You must own or have commercial rights to the output (paid plans of most tools grant this; free tiers are often CC-BY: write the tool and plan in `art-src/creatures/CREDITS.txt`) |

If a tool auto-rigs and you want to try it: **bones are welcome but optional**. If provided they help legs move; name them
`spine_*`, `tail_*`, `leg_fl_*`, `leg_fr_*`, `leg_bl_*`, `leg_br_*`, `head`. If in doubt, deliver static.

## Priority order (non-fish first: these are the goofiest)

1. Blue dart frog · 2. Strawberry dart frog · 3. Fire-bellied toad · 4. Axolotl (pink) · 5. Paddle-tail newt ·
6. Mourning gecko · 7. Vampire crab · 8. Cherry shrimp · 9. Trumpet snail · 10. Dwarf isopod · 11. Poison-frog tadpole ·
12. Yellow-banded poison frog · 13. Green & black poison frog · 14. Axolotl morphs (wild, golden, melanoid) ·
15. Springtail · 16. Fruit fly · 17+ fish (neon, cardinal, ember, guppy male, guppy female, corydoras, otocinclus, betta).

## Prompts

Use the **Reference image prompt** in your image generator, then run image-to-3D. If your 3D tool is text-only, use the
**Direct 3D prompt** instead (results are usually weaker).

Shared suffix for every reference image: *"…, single animal, full body visible, plain neutral light-grey studio background,
soft even diffused lighting with no harsh shadows, sharp focus, macro photograph, photorealistic, anatomically accurate."*

Shared suffix for every direct 3D prompt: *"…, photorealistic PBR textures, anatomically accurate, symmetrical neutral pose,
game-ready, clean topology, no base, no background."*

### 1. `dartfrog.glb`: blue poison dart frog, real length 0.045 m
- **Reference image**: "Blue poison dart frog (Dendrobates tinctorius 'azureus') sitting in a natural relaxed pose, three-quarter front
  view from slightly above. Vivid cobalt-blue skin with irregular black spots on the back and head, blue legs with black spots,
  pale blue belly, large dark glossy eyes set high on the head, smooth moist skin, slender limbs, rounded fingertip discs on
  all toes."
- **Direct 3D**: "Blue poison dart frog, Dendrobates azureus, cobalt blue with black spots, sitting pose, round toe pads, large
  glossy black eyes, moist smooth skin."

### 2. `strawberry.glb`: strawberry poison frog, 0.023 m
- **Reference**: "Strawberry poison frog (Oophaga pumilio, 'blue jeans' morph) sitting, three-quarter view. Bright orange-red body
  with faint fine dark speckles, deep blue legs with black speckling, tiny, large dark eyes, small round toe discs, glossy skin."

### 3. `toad.glb`: fire-bellied toad, 0.045 m
- **Reference**: "Oriental fire-bellied toad (Bombina orientalis) sitting, three-quarter view. Warty olive-green skin with black blotches
  on the back, flattened body, webbed feet, heart-shaped pupils in golden eyes. (Optionally a second image showing the
  red-orange black-spotted belly.)" Deliver in the neutral sitting pose (green back showing).

### 4. `axolotl_leucistic.glb`: pink axolotl, 0.14 m (juvenile), also wanted: `axolotl_wild.glb`, `axolotl_golden.glb`, `axolotl_melanoid.glb`
- **Reference**: "Leucistic axolotl (Ambystoma mexicanum), side-three-quarter view, standing on the bottom, body and tail straight.
  Pale pink skin, wide flat head with the characteristic smile, tiny dark eyes, three pairs of large feathery bright red
  external gills spread outwards, slender limbs with thin fingers (4 front, 5 rear), a low fin running from the back down the tail."
- Morphs: wild = dark olive-brown with gold flecks; golden = golden yellow with pink-red eyes; melanoid = uniformly black.
  (Keep the same pose and shape so they are interchangeable: generate the pink one first and re-colour, or use the same mesh with new textures.)

### 5. `newt.glb`: Chinese paddle-tail newt (Pachytriton labiatus), 0.12 m
- **Reference**: "Chinese paddle-tail newt (Pachytriton labiatus), three-quarter view, standing. Stocky body, broad flat head,
  dark olive-brown back with orange-red blotches along the flanks and belly, thick limbs, laterally flattened paddle-shaped tail
  held straight."

### 6. `gecko.glb`: mourning gecko, 0.09 m including tail
- **Reference**: "Mourning gecko (Lepidodactylus lugubris), three-quarter view from above, standing on a flat surface, slender body,
  beige-tan skin with darker brown chevron and spot markings, large golden eyes with vertical pupils, wide toe pads with
  visible lamellae, long tail about as long as the body held straight."

### 7. `crab.glb`: vampire crab (Geosesarma dennerle), carapace 0.02 m wide
- **Reference**: "Vampire crab (Geosesarma dennerle), three-quarter view from above. Deep purple square carapace, two orange claws
  of slightly different size, bright yellow eyes on short stalks, four pairs of purple jointed walking legs with orange joints.
  Standing pose with legs splayed."
- **Note**: the game walks crabs sideways; deliver the animal facing +Z with claws forward (we rotate it).

### 8. `shrimp.glb`: cherry shrimp (Neocaridina davidi), 0.025 m
- **Reference**: "Red cherry shrimp (Neocaridina davidi) side view, translucent red body with visible segmented abdomen and fan tail,
  two long antennae, stalked black eyes, tiny front claws, several pairs of thin legs. Body only slightly arched."

### 9. `snail.glb`: Malaysian trumpet snail (Melanoides tuberculata), 0.025 m
- **Reference**: "Malaysian trumpet snail, three-quarter view, tall conical turreted spiral shell with fine spiral ribs and brown banding,
  pale grey soft body and two tentacles emerging from the shell opening."

### 10. `isopod.glb`: dwarf white isopod (Trichorhina tomentosa), 0.007 m
- **Reference**: "Dwarf white isopod (woodlouse) top three-quarter view, creamy white segmented oval domed back of seven overlapping plates,
  two short antennae, seven pairs of short legs, two tiny black eyes."

### 11. `tadpole.glb`: poison-frog tadpole, 0.018 m
- **Reference**: "Poison dart frog tadpole, side view, dark brown-grey oval body, small eyes, a tall translucent tail fin, tail straight."

### 12–13. `leucomelas.glb` (yellow-banded poison frog, 0.045 m), `auratus.glb` (green & black poison frog, 0.04 m)
- Same as the dart frog prompt with: **leucomelas** "bright yellow with two or three broad black transverse bands, black head cap, black legs with yellow flecks";
  **auratus** "black with irregular metallic green-turquoise patches, black legs with green spots".

### 15–16. `springtail.glb` (0.0025 m), `fly.glb` (0.003 m)
- Springtail: "Collembola springtail top three-quarter macro, cream-white elongated body, short antennae, folded spring under the abdomen."
- Fly: "Drosophila melanogaster fruit fly macro, red compound eyes, tan thorax, striped abdomen, six legs, wings folded over the back."

### 17+. Fish (lowest priority; the procedural fish are acceptable)
Straight body, fins relaxed, **side view** reference works best. Files: `neon.glb` (0.032 m), `cardinal.glb` (0.04), `ember.glb` (0.02),
`guppy_male.glb` (0.03, large colourful tail), `guppy_female.glb` (0.05), `cory.glb` (0.055), `oto.glb` (0.035), `betta.glb` (0.06 body, long fins).
Ask for a "translucent fins with fine rays" and, for the neon tetra, "an iridescent electric-blue stripe along the flank and red rear half".

## Delivery

Put files in `art-src/creatures/` (create the folder) with the filenames above, plus `CREDITS.txt`. The importer
(`npm run import-creatures`, being added) welds vertices, generates LODs, resizes textures to 1024², compresses them and writes
`public/assets/creatures/<id>.glb`; the game uses them automatically and falls back to the procedural model when a file is missing.

## Quick QA checklist before sending

- [ ] Correct species colours and markings; eyes look alive, not painted flat
- [ ] Pose symmetrical, limbs separate from the body, tail straight
- [ ] Size right (longest side vs table), origin on the ground/centre
- [ ] No baked shadows, no floor, no extra parts
- [ ] Opens in a glTF viewer (e.g. gltf-viewer.donmccurdy.com) with textures showing
