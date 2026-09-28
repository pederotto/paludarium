# Paludarium

Build a living terrarium and aquarium in the browser, then watch it live. Sculpt islands and banks, dig ponds, run waterfalls down a mossy background, plant it, and stock it with frogs, fish, shrimp, crabs and insects. Each one has real needs. The tank has day and night, climate and a nitrogen cycle, and animals eat, breed and die.

Built with [three.js](https://threejs.org) on **WebGPU**, using three.js's shading language (TSL). It falls back to WebGL 2 automatically when WebGPU isn't available.

![The starter paludarium: a mossy island with a pond and waterfall on the left, a planted lagoon with fish and shrimp on the right](docs/screenshot.png)

## Run it

No build step: it's plain ES modules plus an import map.

```bash
git clone https://github.com/pederotto/paludarium
cd paludarium
python3 -m http.server 8000     # or any static server
```

Open http://localhost:8000. The first load needs an internet connection for three.js, which comes from the jsDelivr CDN.

- `?webgl` forces the WebGL 2 back end.
- `?fresh` ignores the autosave and loads the starter tank.
- `?lowres` renders at 1× pixel ratio.

## Playing

| Tool | What it does |
|---|---|
| **Look** | Drag to orbit, scroll to zoom, right-drag to pan. |
| **Sculpt** | Raise, lower, smooth or flatten the substrate *and* the background wall (push it out into ledges). |
| **Paint** | Soil, sand, gravel, rock, moss or cork bark. Painted moss grows tufts, and on the background it makes a moss wall. |
| **Rocks** | Place boulders. They are stamped into the ground, so animals climb them and water pools around them. |
| **Water** | Set the water level (everything below it is submerged). **Pond** fills a hollow you dug on land up to its spill point. **Waterfall** starts at the point you click on the wall or high ground; the water runs down the wall face, then downhill into a pond or the main water. |
| **Plants** | Land (fern, bilberry, grass), background (bromeliad, creeping fig), waterline (cattail, umbrella sedge), underwater (vallisneria, Amazon sword, Java fern), floating (frogbit, water lily). |
| **Animals** | Neon tetras, guppies, corydoras, cherry shrimp, vampire crabs, dwarf isopods, springtails, fruit flies, blue dart frogs, fire-bellied toads. |
| **Inspect** | Click an animal or plant to see its health, hunger and what's stressing it. |
| **Remove** | Click a plant, animal, rock, pond or waterfall. |

While editing, the left mouse button uses the tool and the right button orbits. Keys: <kbd>1</kbd>–<kbd>9</kbd> pick tools, <kbd>Space</kbd> pauses, <kbd>Esc</kbd> returns to Look, <kbd>H</kbd> hides the panels. The tank autosaves to your browser every minute; **Export** and **Import** move it between machines as JSON.

## The simulation

One real second is one minute in the tank at 1× (a day takes 24 minutes). 5×, 20× and 60× speed it up.

- **Light.** Lights run 08:00–20:00 with a dawn and dusk ramp (or on or off). Plants need light, and caustics dance on everything under water while the lights are on.
- **Climate.** Temperature follows the room, the lamp, the lid and the heater. Humidity rises with open water, waterfalls, moss, plants, misting and a closed lid, and falls when the lid is open or the tank is hot.
- **Nitrogen cycle.** Fish waste and rotting food make ammonia. Bacteria colonise the tank over about five days and turn ammonia into nitrite, then nitrate. Plants and water changes remove nitrate. Waterfalls and the filter add oxygen; warm water and many fish use it up.
- **Food web.** Fish eat flakes (use **Feed fish** or the auto-feeder). Corydoras, shrimp, isopods and springtails eat detritus and biofilm. Dart frogs and toads hunt fruit flies, springtails and isopods (toads also take shrimp). Dead animals and plants become detritus, which the clean-up crew recycles.
- **Needs.** Every species has a temperature range, and land animals need a minimum humidity (dart frogs 75%+). Aquatic animals suffer from ammonia, nitrite, high nitrate and low oxygen; everyone suffers from hunger. Stressed animals lose health and recover when conditions improve. Guppies, shrimp, isopods, springtails and fruit flies breed when well fed and healthy, up to what the tank can hold.
- **Plants** grow when they have light, damp air (land plants) or nutrients (water plants). Starved plants stall, and very poor conditions kill them.

## How it's built

```
index.html          UI, styles and the import map
src/main.js         WebGPU renderer, camera, lights, glass tank, frame loop
src/world.js        ties everything together; starter layout; save/load
src/terrain.js      substrate and background heightfields, sculpt and paint brushes
src/water.js        water level, ponds (basin fill), waterfalls (flow paths), water shaders
src/decor.js        rocks (stamped into the ground) and moss tufts
src/plants.js       plant species, leaf-card and low-poly geometry, growth
src/animals.js      animal species, low-poly models, behaviours (schooling, crawling, hopping, hunting, flying)
src/sim.js          climate, water chemistry, food web, health, breeding
src/shaders.js      TSL: triplanar textured substrate, caustics, plant sway
src/ui.js           tools, panels, input
assets/             textures (see CREDITS.md)
tools/              asset import script and headless browser tests
```

- **Substrate and background** are heightfields. Each vertex stores six material weights, and the shader blends six textures with triplanar projection, so steep banks and the vertical wall don't stretch.
- **Caustics** are two layers of drifting cellular noise. Where their cell borders meet, you get the bright net that a wavy surface focuses onto a pool floor.
- **Ponds** use a priority flood: the basin grows from its lowest neighbour until the next cell is lower than the highest rim crossed. That rim height is the spill level.
- **Waterfalls** trace down the wall face, then follow the steepest slope of the ground with a bit of momentum. Droplets ride the path, and a splash ring marks where it lands.
- **Animals** are instanced: one draw call per species (plus one for fish tails, which wag). Fish school with separation, alignment and cohesion; crawlers pick targets on their preferred ground (land animals prefer moss and damp spots); frogs sit, hop in arcs and snap prey with their tongue.
- **Plants** are instanced per species. They sway with a `sway` vertex attribute, more under water.

## Tests

```bash
npm install
npm test            # loads the page headless (WebGL 2 via SwiftShader), fails on console errors, saves a screenshot
npm run test:sim    # fast-forwards 8 days and prints a daily ecosystem report
npm run test:tools  # sculpts, digs a pond, adds a waterfall, paints moss, checks placement rules and save/load
```

## Assets

Textures come from open-source projects; see [CREDITS.md](CREDITS.md). To refresh them from a SeedThree checkout:

```bash
git clone --depth 1 https://github.com/SkyeShark/SeedThree ../SeedThree
npm run import-assets -- ../SeedThree
```

## Ideas for next steps

- A per-cell water simulation (so ponds overflow into streams by themselves) and ripples from animals.
- More species (axolotl, newts, snails, mourning geckos), eggs and tadpoles.
- Mist and fog particles, fireflies at night, a moonlight mode.
- Plants that spread, mosses that creep, algae blooms when nitrate and light are high.
- glTF models for the animals where good open-licensed ones exist.

## License

MIT; see [LICENSE](LICENSE). Third-party assets keep their own licenses (listed in CREDITS.md).
