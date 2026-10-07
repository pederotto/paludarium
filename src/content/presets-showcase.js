// Two showcase sets (run "sets", S3): a long-flow canyon and a highland with streams.
// SHOWCASE_LAYOUTS: PRESETS-style layout entries (id = BUILDERS key, tiers it is built for).
// SHOWCASE_SETS:    the recipe fields of presets.js SETS (place, ref, water, climate, plants, animals, swap, flora, stock, env ...).
// SHOWCASE_BIOTOPES: biotope entries for biotopes.js.
// Glue in presets.js (the lead's two lines):
//   import { SHOWCASE_LAYOUTS, SHOWCASE_SETS } from './presets-showcase.js';  Object.assign(PRESETS, SHOWCASE_LAYOUTS); for (const [id, s] of Object.entries(SHOWCASE_SETS)) Object.assign(PRESETS[id], s);
//   (+ 'canyon', 'highland' in PRESET_ORDER, and `...SHOWCASE_BIOTOPES` into BIOTOPES in biotopes.js.)

export const SHOWCASE_LAYOUTS = {
  canyon: {
    id: 'canyon', name: 'Gorge river', biotope: 'liwu',
    blurb: 'A river runs the whole length of the tank between a banded marble cliff and a low bank: a riffle, a fall into a plunge pool, a narrow chute, a side eddy, then a quiet pool.',
    tiers: ['long', 'show'], tags: ['river', 'long flow', 'waterfall', 'showpiece', 'rapids', 'cool water'],
    adjectives: ['Marble', 'Turquoise', 'Rushing', 'Narrow', 'Misty', 'Cliffside', 'Tumbling'],
    noun: 'Gorge',
  },
};

SHOWCASE_LAYOUTS.highland = {
  id: 'highland', name: 'Highland brooks', biotope: 'mittelgebirge',
  blurb: 'A cool upland plateau with three headwater seeps that merge into one brook, step down two terraces and end in a stony pool: fire salamanders on the banks, bullheads in the water.',
  tiers: ['wide', 'standard'], tags: ['stream', 'cool water', 'ferns', 'highland', 'fire salamander', 'terraces'],
  adjectives: ['Upland', 'Misty', 'Beechwood', 'Bubbling', 'Shaded', 'Harz', 'Cool'],
  noun: 'Brook',
};

export const SHOWCASE_SETS = {
  canyon: {
    featured: ['hillloach', 'zacco'], place: 'Liwu River, Taroko Gorge, Taiwan', ref: 'long', water: 0.25, climate: { temp: [18, 26], rh: [70, 95] }, env: { setpoint: 22 },
    plants: ['fern', 'grass', 'miscanthus', 'nidus', 'pothos', 'begonia', 'javafern', 'javamoss'],
    animals: ['shrimp', 'hillloach', 'zacco', 'isopod', 'springtail'],
  },
  highland: {
    featured: ['firesal', 'bullhead'], place: 'Upland brooks, Teutoburg Forest and Harz, Germany', ref: 'wide', water: 0.2, climate: { temp: [10, 18], rh: [75, 95] }, env: { setpoint: 16, chill: 1, coolSet: 15.5 }, gear: ['chiller', 'fan', 'fogger'],
    plants: ['fernph', 'hartstongue', 'bilberry', 'grass', 'weed'],
    animals: ['firesal', 'bullhead', 'springtail'],
  },
};

export const SHOWCASE_BIOTOPES = {
  liwu: {
    id: 'liwu', name: 'Liwu River, Taroko Gorge', country: 'Taiwan', level: 6,
    animals: ['shrimp', 'hillloach', 'zacco', 'isopod', 'springtail'], plants: ['fern', 'grass', 'miscanthus', 'nidus', 'pothos', 'begonia', 'javafern', 'javamoss'],
    climate: { temp: [18, 26], humidity: [70, 95] },
    features: ['stream', 'stones', 'moss15', 'rapids'],
    blurb: 'A turquoise river that cut a gorge through banded marble on the east coast of Taiwan. Cold, fast, clear water over boulders; ferns and silvergrass on the banks.',
    facts: ['The marble was laid down as limestone and folded by the collision of two plates.', 'Fish and shrimp here live in the current, holding in the lee of stones.'],
    hint: 'Cool, fast, clear water, boulders to shelter behind, and banks of fern.',
  },
  mittelgebirge: {
    id: 'mittelgebirge', name: 'Mittelgebirge headwater brooks', country: 'Germany', level: 6,
    animals: ['firesal', 'bullhead', 'springtail'], plants: ['fernph', 'hartstongue', 'bilberry', 'grass', 'weed'],
    climate: { temp: [10, 18], humidity: [75, 95] },
    features: ['stream', 'cool', 'stones', 'terraces'],
    blurb: 'Beech-wood uplands with springs that join into stony brooks, cold and clear all year. Bullheads hold under stones in the current; fire salamanders hide on the damp banks and put their larvae into the pools.',
    facts: ['The bullhead has no swim bladder and sits on the stream floor.', 'Female fire salamanders drop living larvae into small clear brooks.'],
    hint: 'Cold (under 18 C), clear moving water over stones, damp banks with ferns.',
  },
};
