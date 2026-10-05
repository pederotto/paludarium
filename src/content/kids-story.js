// Kids' story "Pip finds a home": chapters with building challenges, the way career's
// commissions teach (content/commissions.js). Each challenge is checked against the same
// metrics snapshot career goals read (game/metrics.js computeMetrics), read by field name.
// `c` are the kids' own counters ({ fed }), `b` the counters at the chapter's start.
// Every fact names its source in the game data (`src`): `info` = ANIMAL_INFO in
// content/species-info.js, `species` = the SPECIES entry in sim/animals.js. A fact
// without a source is left out. Lines are for early readers (about 5-8 years, a guess):
// at most 8 words, one idea each. Plain data, no imports, so it can be tested under Node.

export const MAX_WORDS = 8;

const info = (id, field, i, has) => ({ in: 'info', id, field, i, has });
const species = (id, has) => ({ in: 'species', id, has });
const n = (v) => v ?? 0;

export const STORY = [
  {
    id: 'home', title: 'Pip needs a home', sticker: 'story-home', card: 'dartfrog', icon: 'frog',
    story: ['This is Pip, a blue frog.', 'Pip has no home yet.', "Let's build one together!"],
    challenges: [
      {
        id: 'land-plants', text: 'Plant 3 plants on the land.', act: 'plants',
        test: (m) => n(m.plants?.total) - n(m.plants?.water) >= 3,
        facts: [{ text: 'Blue frogs need land to live on.', src: info('dartfrog', 'care', 1, 'give it land') }],
      },
      {
        id: 'wood', text: 'Add a log, roots or a stump.', act: 'build',
        test: (m) => n(m.hardscape?.wood) >= 1,
        facts: [{ text: 'Frogs like a drier spot to rest.', src: info('dartfrog', 'care', 0, 'a drier spot to rest') }],
      },
    ],
  },
  {
    id: 'damp', title: 'Damp air for Pip', sticker: 'story-damp', card: 'dartfrog', icon: 'rain',
    story: ['Pip likes damp air.', 'Rain makes the air damp.', 'Tap Care, then Rain!'],
    challenges: [
      {
        id: 'damp', text: 'Make the air damp. Keep it damp!', act: 'care', hold: 20,
        test: (m) => n(m.humidity) >= 75,
        facts: [{ text: 'Blue frogs need very damp air.', src: species('dartfrog', 'humidity: 75') }],
      },
    ],
  },
  {
    id: 'movein', title: 'Pip moves in', sticker: 'story-friend', card: 'dartfrog', icon: 'heart',
    story: ['The home is ready!', 'Pip moves in.', 'Pip would like a friend.'],
    challenges: [
      {
        id: 'two-frogs', text: 'Add 2 blue frogs.', act: 'animals',
        test: (m) => n(m.animals?.byId?.dartfrog) >= 2,
        facts: [{ text: 'Bright blue says: do not eat me!', src: info('dartfrog', 'facts', 0, 'warns predators') }],
      },
      {
        id: 'feed-frogs', text: 'Feed your frogs.', act: 'care',
        test: (m, c, b) => n(c?.fed) > n(b?.fed),
        facts: [
          { text: 'Blue frogs eat tiny live bugs.', src: info('dartfrog', 'care', 2, 'live food') },
          { text: 'Little flies make a good dinner.', src: species('dartfrog', "eats: ['fly'") },
        ],
      },
    ],
  },
  {
    id: 'babies', title: 'A pool for babies', sticker: 'story-baby', card: 'dartfrog', icon: 'egg',
    story: ['Frog dads are great helpers.', 'A dad carries his tadpoles.', 'He takes them to tiny pools.'],
    facts: [{ text: 'Dads carry tadpoles on their backs.', src: info('dartfrog', 'facts', 1, "onto his back and he carries them") }],
    challenges: [
      {
        id: 'pond', text: 'Dig a little pond.', act: 'build',
        test: (m) => !!m.features?.shallowpool,
        facts: [
          { text: 'Blue frogs cannot swim well.', src: info('dartfrog', 'care', 1, 'Cannot swim well') },
          { text: 'So their pool must be shallow.', src: info('dartfrog', 'care', 1, 'shallow pool') },
        ],
      },
      {
        id: 'cups', text: 'Plant 2 spiky or star flowers.', act: 'plants',
        test: (m) => !!m.features?.bromeliad2,
        facts: [{ text: 'These flowers hold a tiny pool.', src: info('dartfrog', 'facts', 1, 'often held in a bromeliad') }],
      },
      {
        id: 'baby', text: 'Wait for a baby. Try Time flies!', act: 'more',
        test: (m, c, b) => n(m.births) > n(b?.births),
        facts: [{ text: 'Frog eggs hatch into tadpoles.', src: species('dartfrog', "into: 'tadpole'") }],
      },
    ],
  },
  {
    id: 'fish', title: 'Friends in the water', sticker: 'story-fish', card: 'neon', icon: 'fish',
    story: ['The pond is very quiet.', 'Neon fish like to swim together.'],
    challenges: [
      {
        id: 'six-neons', text: 'Add 6 neon fish.', act: 'animals',
        test: (m) => n(m.animals?.byId?.neon) >= 6,
        facts: [
          { text: 'Keep six or more neon fish.', src: info('neon', 'care', 0, 'Keep six or more') },
          { text: 'A group keeps each fish safer.', src: info('neon', 'facts', 1, 'a group is safer') },
        ],
      },
      { id: 'water-plants', text: 'Plant 2 plants in the water.', act: 'plants', test: (m) => n(m.plants?.water) >= 2 },
      {
        id: 'clean-water', text: 'Keep the water clean. Tap Clean!', act: 'care', hold: 20,
        test: (m) => n(m.waterQuality) >= 0.8,
        facts: [
          { text: 'Dirty water can hurt neon fish.', src: info('neon', 'care', 1, 'a little ammonia is deadly') },
          { text: 'Their stripe shines like a soap bubble.', src: info('neon', 'facts', 0, 'like a soap bubble') },
        ],
      },
    ],
  },
  {
    id: 'shrimp', title: 'The tiny cleaners', sticker: 'story-shrimp', card: 'shrimp', icon: 'sparkles',
    story: ['Red shrimp are tiny cleaners.', 'They nibble all day long.'],
    facts: [{ text: 'Shrimp eat a little, all the time.', src: info('shrimp', 'facts', 2, 'eat tiny amounts constantly') }],
    challenges: [
      {
        id: 'ten-shrimp', text: 'Add 10 red shrimp.', act: 'animals',
        test: (m) => n(m.animals?.byId?.shrimp) >= 10,
        facts: [{ text: 'Shrimp live in big groups.', src: species('shrimp', 'flock: [10, 80]') }],
      },
      {
        id: 'shrimp-clean', text: 'Keep the water clean and clear.', act: 'care', hold: 20,
        test: (m) => n(m.waterQuality) >= 0.8 && n(m.algae) < 0.3,
        facts: [
          { text: 'Shrimp help keep algae away.', src: info('shrimp', 'facts', 2, 'keep algae in check') },
          { text: 'A see-through shrimp is an old skin.', src: info('shrimp', 'facts', 1, 'shed skin') },
        ],
      },
    ],
  },
];

export const STORY_END = ['Pip has a home and friends.', 'You built it all yourself!'];

// Every line a child reads (for the word-count check).
export function storyLines() {
  const out = [...STORY_END];
  for (const ch of STORY) {
    out.push(ch.title, ...ch.story, ...(ch.facts ?? []).map((f) => f.text));
    for (const x of ch.challenges) out.push(x.text, ...(x.facts ?? []).map((f) => f.text));
  }
  return out;
}

export const newProgress = () => ({ chapter: 0, done: {}, held: {}, base: null });

// The first unfinished challenge of the current chapter, or null when the story is finished.
export function currentChallenge(p) {
  const ch = STORY[p?.chapter ?? 0];
  if (!ch) return null;
  const i = ch.challenges.findIndex((x) => !p.done?.[x.id]);
  return i < 0 ? null : { ch, x: ch.challenges[i], i };
}

// One check of the current chapter against the metrics `m` and the kids' counters `c`, `sec` seconds
// after the last. Returns the new progress (plain data, saved as is) and what happened.
export function storyStep(p0, m, c = {}, sec = 1) {
  const ch = STORY[p0?.chapter ?? 0];
  if (!ch || !m) return { p: p0, events: [] };
  const p = { ...p0, done: { ...p0.done }, held: { ...p0.held } };
  p.base ??= { fed: n(c.fed), births: n(m.births) };
  const events = [];
  for (const x of ch.challenges) {
    if (p.done[x.id]) continue;
    let ok = false;
    try { ok = !!x.test(m, c, p.base); } catch { ok = false; }
    if (x.hold) { p.held[x.id] = ok ? n(p.held[x.id]) + sec : 0; ok = p.held[x.id] >= x.hold; }
    if (ok) { p.done[x.id] = true; events.push({ type: 'challenge', ch, x }); }
  }
  if (ch.challenges.every((x) => p.done[x.id])) {
    events.push({ type: 'chapter', ch });
    p.chapter += 1; p.held = {}; p.base = null;
  }
  return { p, events };
}
