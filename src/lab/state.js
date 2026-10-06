// The test lab's reactive state (Preact signals). The simulation mutates plain objects at frame rate; the lab copies what the
// panels show into these a few times a second (index.js tick), as the game does with ui/store.js.

import { signal } from '@preact/signals';

export const RATES = [0.25, 0.5, 1, 2, 4];

export const L = {
  ready: signal(false),
  note: signal(''),               // the last thing the lab wants to say (an error from a placement, what a button did)
  paused: signal(false),
  rate: signal(1),                // animal time per real time (Game.rateOverride)
  tank: signal('standard'),       // content/tanks.js id
  ground: signal('flat'),         // 'flat' | 'shore' (arena.js GROUNDS)
  depth: signal(0),               // water depth, cm (flat: over the whole floor; shore: in the pool; 0 = dry)
  species: signal('toad'),        // what the Add button and a floor tap release
  count: signal(1),
  tapAdds: signal(false),         // a tap on the floor releases animals (else it only selects)
  sel: signal(null),              // the selected animal: a live object of world.animals
  info: signal(null),             // readout of the selected animal, ~4 Hz (readout.js)
  census: signal([]),             // [{ id, name, n }]
  fps: signal(0),
  backend: signal(''),
  // driving (driver.js)
  dtab: signal('free'),           // the open Drive tab: 'free' | 'goto' | 'path' | 'follow'
  pick: signal(null),             // what the next tap on the floor does: null | 'goto' | 'draw' | 'place'
  draft: signal([]),              // waypoints tapped so far in draw mode
  dots: signal([]),               // [{ id, kind, x, z }]
  pace: signal(1),                // the drive's speed as a share of the species' walking pace
  gait: signal('auto'),           // a frog's or toad's gait: 'auto' | 'walk' | 'hop'
  pathMode: signal('loop'),       // 'loop' | 'once' | 'pingpong'
  size: signal(28),               // a shape's width, cm
  dotKind: signal('wander'),      // 'wander' | 'orbit' | 'fixed'
  dotSpeed: signal(3),            // cm/s
  keep: signal(4),                // how close a follower comes to its dot, cm
  all: signal(false),             // a drive goes to every animal of the selected species
  // random paths and scenarios (driver.js, fuzz.js)
  rndStyle: signal('mixed'),      // a style of sim/labrandom.js STYLES
  rndSeed: signal(1),
  rndLength: signal(240),         // cm
  fuzzN: signal(8), fuzzSeconds: signal(12),
  fuzz: signal(null),             // the running or last batch of random scenarios: { n, done, seconds, rows: [...] }
  // obstacles (obstacles.js)
  obKind: signal('step'),         // a shape (sim/labshapes.js) or a hardscape piece (sim/decor.js PIECES)
  obW: signal(14), obD: signal(14), obH: signal(3),   // cm
  obSize: signal(12),             // a piece's largest extent, cm
  obRot: signal(0),               // degrees
  obstacles: signal([]),          // what is in the arena: [{ id, kind, x, z, w, d, h, rot } | { id, kind, x, z, size, rot }]
  // the bug radar (radar.js)
  log: signal([]),                // findings, newest first
  bugs: signal(0),
  pauseOnBug: signal(false),      // freeze the clock on a finding that is a bug on its face
  report: signal(null),           // the report text when it could not be copied: shown to select by hand
  restored: signal(false),        // this page came back from a saved session
  tab: signal('animals'),         // phone: the open sheet ('world' | 'animals' | 'sel' | null)
};
