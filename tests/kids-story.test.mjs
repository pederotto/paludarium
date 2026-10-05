// N18: Kids' story "Pip finds a home". Every challenge is checked against the same
// metrics snapshot career goals read (game/metrics.js), so each one gets a fixture
// that fails and one that passes. Every fact names its source in the game data, and
// every line a child reads is at most 8 words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STORY, newProgress, storyStep, currentChallenge, storyLines, MAX_WORDS } from '../src/content/kids-story.js';
import { ANIMAL_INFO } from '../src/content/species-info.js';
import { STICKERS } from '../src/content/kids.js';

const ANIMALS_SRC = readFileSync(new URL('../src/sim/animals.js', import.meta.url), 'utf8');
// The text of one SPECIES entry in animals.js (SPECIES imports three, so it is read as text).
function speciesBlock(id) {
  const i = ANIMALS_SRC.indexOf(`\n  ${id}: {`);
  if (i < 0) return '';
  const j = ANIMALS_SRC.indexOf('\n  },', i);
  return ANIMALS_SRC.slice(i, j);
}

// A neutral tank: nothing built yet. Only fields by name, independent of tank size.
const base = () => ({
  humidity: 50, waterQuality: 0.5, algae: 0.5, births: 0, pools: 0,
  plants: { total: 0, water: 0 }, hardscape: { wood: 0, stone: 0, pieces: 0 },
  animals: { byId: {} }, features: { shallowpool: false, bromeliad2: false },
});
// Per challenge: [not met, met]. Counters `c` are the kids' own (feeds), `b` the chapter's baseline.
const FIX = {
  'land-plants': [{ plants: { total: 4, water: 2 } }, { plants: { total: 5, water: 2 } }],
  'wood': [{ hardscape: { wood: 0, stone: 3, pieces: 3 } }, { hardscape: { wood: 1, stone: 0, pieces: 1 } }],
  'damp': [{ humidity: 74 }, { humidity: 76 }],
  'two-frogs': [{ animals: { byId: { dartfrog: 1 } } }, { animals: { byId: { dartfrog: 2 } } }],
  'feed-frogs': [{ $c: { fed: 3 }, $b: { fed: 3 } }, { $c: { fed: 4 }, $b: { fed: 3 } }],
  'pond': [{ pools: 1, $b: { pools: 1 } }, { pools: 2, $b: { pools: 1 } }],
  'cups': [{ $c: { cups: 3 }, $b: { cups: 2 } }, { $c: { cups: 4 }, $b: { cups: 2 } }],
  'baby': [{ births: 2, $b: { births: 2 } }, { births: 3, $b: { births: 2 } }],
  'six-neons': [{ animals: { byId: { neon: 5 } } }, { animals: { byId: { neon: 6 } } }],
  'water-plants': [{ plants: { total: 6, water: 1 } }, { plants: { total: 6, water: 2 } }],
  'clean-water': [{ waterQuality: 0.79 }, { waterQuality: 0.85 }],
  'ten-shrimp': [{ animals: { byId: { shrimp: 9 } } }, { animals: { byId: { shrimp: 10 } } }],
  'shrimp-clean': [{ waterQuality: 0.9, algae: 0.4 }, { waterQuality: 0.9, algae: 0.1 }],
};
const fixture = (f) => { const { $c, $b, ...m } = f; return { m: { ...base(), ...m }, c: { fed: 0, ...$c }, b: { fed: 0, births: 0, ...$b } }; };
const all = () => STORY.flatMap((ch) => ch.challenges.map((x) => ({ ch, x })));

test('the story has chapters with building challenges, and each has a fixture', () => {
  assert.ok(STORY.length >= 5, 'at least five chapters');
  const ids = all().map(({ x }) => x.id);
  assert.equal(new Set(ids).size, ids.length, 'challenge ids are unique');
  assert.deepEqual([...ids].sort(), Object.keys(FIX).sort(), 'every challenge has a met and a not-met fixture');
});

test('each challenge is checked by the game state: not met, then met', () => {
  for (const { x } of all()) {
    const [no, yes] = FIX[x.id].map(fixture);
    assert.equal(!!x.test(no.m, no.c, no.b), false, `${x.id} must fail on its not-met state`);
    assert.equal(!!x.test(yes.m, yes.c, yes.b), true, `${x.id} must pass on its met state`);
    assert.equal(!!x.test(base(), { fed: 0 }, { fed: 0, births: 0 }), false, `${x.id} must fail on an empty tank`);
  }
});

test('thresholds are the species data', () => {
  assert.match(speciesBlock('dartfrog'), /humidity: 75\b/);
  assert.match(speciesBlock('neon'), /Keep 6 or more/);
  assert.match(speciesBlock('shrimp'), /flock: \[10,/);
});

test('every fact has a source that exists in the game data', () => {
  let n = 0;
  for (const ch of STORY) for (const item of [ch, ...ch.challenges]) {
    for (const f of item.facts ?? []) {
      n++;
      assert.ok(f.src, `fact "${f.text}" has a source`);
      const { in: where, id, field, i, has } = f.src;
      if (where === 'info') {
        const v = ANIMAL_INFO[id]?.[field];
        const s = Array.isArray(v) ? v[i] : v;
        assert.ok(typeof s === 'string' && s.includes(has), `ANIMAL_INFO.${id}.${field}${i != null ? `[${i}]` : ''} contains "${has}"`);
      } else if (where === 'species') {
        assert.ok(speciesBlock(id).includes(has), `SPECIES.${id} contains "${has}"`);
      } else assert.fail(`unknown source kind ${where}`);
    }
  }
  assert.ok(n >= 10, `at least ten facts (${n})`);
});

test('every line a child reads is at most 8 words', () => {
  assert.equal(MAX_WORDS, 8);
  const lines = storyLines();
  assert.ok(lines.length > 40);
  for (const l of lines) assert.ok(l.split(/\s+/).filter(Boolean).length <= MAX_WORDS, `too long: "${l}"`);
});

test('each chapter gives a sticker that exists', () => {
  for (const ch of STORY) assert.ok(STICKERS.find((s) => s.id === ch.sticker), `sticker ${ch.sticker}`);
});

test('counts are what the child added since the chapter began', () => {
  const x = STORY[0].challenges[0];
  assert.equal(x.test({ ...base(), plants: { total: 50, water: 0 } }, {}, { land: 47 }), true);
  assert.equal(x.test({ ...base(), plants: { total: 49, water: 0 } }, {}, { land: 47 }), false, 'a full world does not finish it alone');
});

test('N18b: a world that already has a pool or 2 cup plants does not finish pond or cups at once', () => {
  const ch = STORY.findIndex((c) => c.id === 'babies');
  const full = { ...base(), pools: 1, features: { shallowpool: true, bromeliad2: true } };
  let { p } = storyStep({ ...newProgress(), chapter: ch }, full, { fed: 0, cups: 2 }, 1);
  assert.equal(!!p.done.pond, false, 'pond: the pool was there before the chapter');
  assert.equal(!!p.done.cups, false, 'cups: the 2 cup plants were there before the chapter');
  ({ p } = storyStep(p, { ...full, pools: 2 }, { fed: 0, cups: 3 }, 1));
  assert.equal(!!p.done.pond, true, 'a pond the child dug counts');
  assert.equal(!!p.done.cups, false, 'one new cup plant is not 2');
  ({ p } = storyStep(p, { ...full, pools: 2 }, { fed: 0, cups: 4 }, 1));
  assert.equal(!!p.done.cups, true, '2 new cup plants count');
});

test('storyStep walks the chapters in order, holds need their time, counters use the chapter baseline', () => {
  let p = newProgress();
  assert.equal(currentChallenge(p).x.id, 'land-plants');
  const m = base();
  // An empty tank does nothing.
  let r = storyStep(p, m, { fed: 0 }, 1); p = r.p;
  assert.equal(r.events.length, 0);
  // Chapter 1.
  m.plants = { total: 3, water: 0 }; m.hardscape = { wood: 1, stone: 0, pieces: 1 };
  r = storyStep(p, m, { fed: 0 }, 1); p = r.p;
  assert.deepEqual(r.events.map((e) => e.type), ['challenge', 'challenge', 'chapter']);
  assert.equal(p.chapter, 1);
  // Chapter 2: humidity must hold for the challenge's time.
  m.humidity = 80;
  const hold = STORY[1].challenges[0].hold;
  assert.ok(hold >= 10);
  r = storyStep(p, m, { fed: 0 }, 1); p = r.p;
  assert.equal(p.chapter, 1, 'one second of damp air is not enough');
  m.humidity = 60; r = storyStep(p, m, { fed: 0 }, hold); p = r.p;
  assert.equal(p.chapter, 1, 'a dry spell resets the hold');
  m.humidity = 80; r = storyStep(p, m, { fed: 0 }, hold); p = r.p;
  assert.equal(p.chapter, 2);
  // Chapter 3: feeding before the chapter does not count; the baseline is taken at its start.
  r = storyStep(p, m, { fed: 5 }, 1); p = r.p;
  assert.equal(p.chapter, 2, 'the feed counter starts at the chapter');
  m.animals = { byId: { dartfrog: 2 } };
  r = storyStep(p, m, { fed: 6 }, 1); p = r.p;
  assert.equal(p.chapter, 3);
  // A finished story stays finished and serialises as plain data.
  p = JSON.parse(JSON.stringify({ ...p, chapter: STORY.length }));
  assert.equal(currentChallenge(p), null);
  assert.equal(storyStep(p, m, { fed: 6 }, 1).events.length, 0);
});
