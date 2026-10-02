# Paludarium

**[▶ Play in your browser](https://pederotto.github.io/paludarium/)** (best in a recent Chrome or Edge; other browsers fall back to WebGL 2)

A terrarium and paludarium simulator you can play, learn from and just look at. Build a living miniature landscape (rock, soil, moss, streams, waterfalls, plants), stock it with frogs, newts, geckos, fish, shrimp and crabs, and keep it healthy while the climate, the water chemistry and the animals' needs play out for real. Start a career and grow a studio, or open the sandbox and build anything.

Built with [three.js](https://threejs.org) on **WebGPU** (TSL shaders, WebGL 2 fallback), with a sharp post pipeline: ambient occlusion, bloom, SMAA and contrast-adaptive sharpening. The interface is Preact.

![The starter paludarium](docs/screenshot.png)

## Ways to play

- **Career.** Start with a jar and a little money. Take commissions ("hold a dart frog terrarium at 80% humidity for ten days"), earn funds and reputation, climb twelve ranks, unlock species, plants and equipment, and work up to grand tanks, automation rules, heatwave and vacation tests and exhibitions. A Curator scores your tanks; a tutorial guide (Mira) teaches the basics as you go. Sell animals to the market, keep a portfolio of tanks, save to slots.
- **Sandbox.** Everything unlocked and free. Start from a blank tank, the starter paludarium, or one of the **generated terrariums**: a stream through ferns, a cascade canyon, a Suriname forest island, a blackwater lagoon, karst towers, a lowland swamp or a sealed moss jar. Every one is built from a seed, so each is different and complete with plants and a suitable community.
- **Kids' corner.** A simplified mode for children: pick a world, tap picture cards to add animals, plants and kits, feed and care with big buttons, earn stickers, name your pets. Pets never die (a care helper looks after them), and the game still teaches one fact at a time.
- **Genetics.** Axolotls, blue dart frogs, guppies, bettas and cherry shrimp have colour genes: dominant and recessive alleles, carriers, incomplete dominance (red × blue guppy gives purple) and rare mutations. Choose morphs, pair animals, read the Punnett square in the Lab, and breed rare colours for commissions. See [docs/GENETICS_SPEC.md](docs/GENETICS_SPEC.md).
- **Field guide.** An in-game encyclopaedia of concepts (nitrogen cycle, dew point, photoperiod, drainage, bioactive clean-up crews…), animals, plants and real biotopes, with a live "See it in your tank" for each idea.

## What it simulates

- **Microclimate.** Humidity, temperature, light and soil moisture are maps across the tank, not single numbers. Plants, moss and animals respond to their own spot, and animals seek the comfort they need. Switch **lenses** (`L`) to see humidity, temperature, light, soil and water-flow overlays.
- **Glass and dew.** Condensation forms on the glass when the tank is warmer and damper than the room, as beads and haze, from a dew-point calculation. Wipe it, or fix the cause.
- **Equipment.** Lights and timers, heater and chiller, fan, fogger, rain programmes, basking lamps, filters, false-bottom drainage and an auto-feeder, plus automation rules ("if humidity is below 75%, run the fogger").
- **Water and the nitrogen cycle.** A conserved water simulation (pump, pools, streams, waterfalls), ammonia → nitrite → nitrate, oxygen, algae, and white mould that creeps over wood and stone in stale, saturated air (a fan starves it; springtails and isopods eat it).
- **Sound.** Ambience is synthesised live (no audio files): waterfalls and pools, rain, a room hum, and at night crickets and frog calls. Volume and mute are in Settings.
- **Life.** Animals eat, breathe, breed, metamorphose, age and die; plants grow, spread and rot; moss creeps over damp stone. Time runs at 1× to 60×.

## Controls

| | Desktop | Touch |
|---|---|---|
| Look | drag to orbit, right-drag to pan, scroll to zoom | drag, two fingers to pan and pinch |
| Select | click any animal, plant or piece for an info banner (zoom and follow buttons) | tap |
| Tools | `1`–`9`, or the rail on the left | the tool rail |
| Camera | `W A S D` pan, `Q E` turn, `Z X` zoom, `F` frame selection | view buttons |
| Piece | `G` move, `R` turn, `T` scale, `Ctrl+D` duplicate, `Del` remove | handles |
| Build | `M` mirror (symmetry across the tank's centre), Kits list in Hardscape and in the Studio | Mirror chip |
| Other | `L` lens, `Space` pause, `H` hide panels, `Ctrl+Z` undo, `Esc` back | View menu (top right) |

**Kits** drop a whole composition in one click (waterfall cliff, root arch, stepping stones, spire cluster, mossy island), scaled to the tank and taught by a composition tip. **Time-lapse** (clock button; on phones the View menu) runs 7, 30 or 90 days in seconds while the camera drifts around the tank, then reports what grew, spread or died.

Photo mode (camera button): the interface steps aside, click anything to focus on it, adjust blur and exposure, switch on the thirds grid and **Snap** to save a PNG.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # production build in dist/
npm run test:unit    # career and economy logic tests
```

Other scripts:

| Command | What it does |
|---|---|
| `npm run shot` | Playwright screenshots at 16:9 desktop (1280×720) and phone (390×844). `--only=desktop`, `--steps=tools/steps/<file>.mjs` to script a flow. |
| `npm run bench -- <ids>` | Contact sheet of one or more creatures from the real game shading: `--lod=hi`, `--water=1`, `--views=front,side,top,three,closeup`, `--src=glb`. Output in `test-output/bench/`. |
| `npm run import-creatures` | Turns `art-src/creatures/<id>.glb` models into optimised game assets (see [docs/ASSET_BRIEF.md](docs/ASSET_BRIEF.md)). |
| `node tools/errcheck.mjs` | Loads the game headless and reports console and page errors. |
| `npm run metrics:serve` | Serves `dist/` with the metrics recorder in every page: open the printed address on another computer and the numbers (frames, GPU latency, load phases, flashes, device) arrive in `metrics/`. `-- --https` gives the WebGPU path. See [docs/METRICS.md](docs/METRICS.md). |
| `npm run metrics:run -- --label=x` | The same recorder in headless Chrome: a one-minute hands-off test and its report (`--lan`, `--cpu=4 --dpr=2`, `--outDir=…`, `--url=… --inject`, `--screencast`). |
| `npm run metrics:report` | Reads recordings: the newest, `--list`, `--compare a b`, `--snaps`. |

Deploying: the workflow in `.github/workflows/pages.yml` builds and publishes to GitHub Pages. In the repository settings, set Pages ▸ Source to **GitHub Actions** once.

## How it is built

See [docs/DESIGN.md](docs/DESIGN.md) for the architecture, the frame budget and the performance notes. In short: `src/util` (math helpers), `src/content` (all the words and numbers), `src/sim` (world, climate, animals, plants, hydrology, erosion, generator), `src/game` (career, market, commissions, curator, events), `src/render` (terrain, water, lens, creatures), `src/engine` (renderer, camera, stage), `src/editor` (the in-game tools), `src/ui` (HUD and panels), `src/app` (the director that ties it together). `tests/architecture.test.mjs` keeps the layering honest.

## What is next

The plan for water physics, erosion, structure, humus and decay, game modes, more tank sizes and new assets is in [docs/ROADMAP.md](docs/ROADMAP.md).

## Credits

See [CREDITS.md](CREDITS.md). Rocks, roots and ferns are CC0 photoscans from Poly Haven; textures and the rock generator come from SeedThree; the ripple, caustics and meshing ideas from CAUSTIC//VOLUME. MIT licensed.

## Adding art

Drop raw assets (models, textures, images, audio) in `art-src/drop/` and ask Claude to optimise them; the originals are kept in `art-src/raw/` and the game's files land in `public/assets/`. **Rule: keep every file under 50 MB.** GitHub refuses files over 100 MB, so anything larger needs Git LFS set up first. `npm run backup` makes a local backup of the history and the art.
