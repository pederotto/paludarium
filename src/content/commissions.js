// Commissions: goals with a story. Each is a small lesson: the brief says
// why the client wants it, `teaches` links field-guide cards, and the goals
// are checked against a metrics snapshot (game/metrics.js). `hold` means the
// condition has to stay true for that many game days in a row.
//
// goal = { id, text, test(m, stats), progress?(m, stats) 0..1, progressText?(m, stats), hold?: days, need? }
//
// `need` says what a goal asks of the tank itself ({ id, n }: n animals of a species, or { minL, maxL } on the tank's
// litres), so the board can say when the tank you are looking at is too small for a commission (game/commissions.js
// tankFit, from the simulation's room per species). A commission can add its own `need` too.

import { BIOTOPES, BIOTOPE_ORDER } from './biotopes.js';
import { suggestedReward } from './economy.js';
import { SPECIES } from '../sim/animals.js';
import { PLANTS } from '../sim/plants.js';
import { morphName } from './morphs.js';

// --- Goal builders ---------------------------------------------------------------------------
const nm = (id) => SPECIES[id]?.name ?? id;
const pn = (id) => PLANTS[id]?.name ?? id;
const pct = (a, b) => Math.max(0, Math.min(1, a / Math.max(1e-6, b)));

const animals = (id, n, hold) => ({
  id: `a-${id}-${n}`, text: `Keep ${n} ${nm(id).toLowerCase()} healthy${hold ? ` for ${hold} days` : ''}`, hold, need: { id, n },
  test: (m) => (m.animals.healthyById[id] ?? 0) >= n,
  progress: (m) => pct(m.animals.healthyById[id] ?? 0, n), progressText: (m) => `${m.animals.healthyById[id] ?? 0}/${n}`,
});
const anyFrogs = (n, hold) => ({
  id: `frogs-${n}`, text: `Keep ${n} poison frogs healthy${hold ? ` for ${hold} days` : ''}`, hold, need: { id: 'strawberry', n },   // the poison frog that fits most tanks
  test: (m) => m.animals.healthyFrogs >= n, progress: (m) => pct(m.animals.healthyFrogs, n), progressText: (m) => `${m.animals.healthyFrogs}/${n}`,
});
const plants = (n) => ({ id: `plants-${n}`, text: `Grow ${n} plants`, test: (m) => m.plants.total >= n, progress: (m) => pct(m.plants.total, n), progressText: (m) => `${m.plants.total}/${n}` });
const moss = (p) => ({ id: `moss-${p}`, text: `Moss over ${p}% of the surfaces`, test: (m) => m.mossPct >= p, progress: (m) => pct(m.mossPct, p), progressText: (m) => `${Math.round(m.mossPct)}%` });
const humid = (lo, hi, hold) => ({
  id: `rh-${lo}-${hi}`, text: `Hold humidity between ${lo} and ${hi}%${hold ? ` for ${hold} days` : ''}`, hold,
  test: (m) => m.humidity >= lo && m.humidity <= hi, progressText: (m) => `${Math.round(m.humidity)}%`,
});
const temp = (lo, hi, hold) => ({
  id: `t-${lo}-${hi}`, text: `Hold ${lo}–${hi} °C${hold ? ` for ${hold} days` : ''}`, hold,
  test: (m) => m.temp >= lo && m.temp <= hi, progressText: (m) => `${m.temp.toFixed(1)} °C`,
});
const feature = (key, text) => ({ id: `f-${key}`, text, test: (m) => !!m.features[key] });
const goal = (id, text, test, extra = {}) => ({ id, text, test, ...extra });
// The tank's own size, for commissions that are about a small or a big tank.
const tankAtMost = (L) => goal(`tank-le-${L}`, `Build it in a tank of ${L} litres or less`, (m) => (m.size?.litres ?? 243) <= L, { need: { maxL: L }, progressText: (m) => `${Math.round(m.size?.litres ?? 0)} L` });
const tankAtLeast = (L) => goal(`tank-ge-${L}`, `Build it in a tank of ${L} litres or more`, (m) => (m.size?.litres ?? 243) >= L, { need: { minL: L }, progressText: (m) => `${Math.round(m.size?.litres ?? 0)} L` });
// The Curator's grade of this tank (the director puts it in the metrics: 1 D … 5 S).
const gradeAt = (g, letter, hold) => goal(`grade-${letter}-${hold ?? 0}`, `Hold a grade ${letter} or better from the Curator${hold ? ` for ${hold} days` : ''}`, (m) => (m.grade ?? 0) >= g, { hold, progressText: (m) => ['–', 'D', 'C', 'B', 'A', 'S'][m.grade ?? 0] });
const withinStock = () => goal('within-stock', 'Stock it no more than it carries comfortably', (m) => (m.stocking?.worst ?? 0) <= 1, { progressText: (m) => (m.stocking?.over?.length ? `${m.stocking.over.length} crowded` : 'none crowded') });
// Genetics goals read the metrics' `genetics`: healthy animals by 'species:morph', and those born in this tank.
const morphKey = (sp, morph) => `${sp}:${morph}`;
const morphCount = (sp, morphs, n, text) => ({
  id: `m-${sp}-${morphs.join('+')}-${n}`, text: text ?? `Keep ${n} healthy ${morphName(sp, morphs[0]).toLowerCase()} ${nm(sp).toLowerCase()}`,
  test: (m) => morphs.reduce((s, k) => s + (m.genetics?.morphs?.[morphKey(sp, k)] ?? 0), 0) >= n,
  progress: (m) => pct(morphs.reduce((s, k) => s + (m.genetics?.morphs?.[morphKey(sp, k)] ?? 0), 0), n),
  progressText: (m) => `${morphs.reduce((s, k) => s + (m.genetics?.morphs?.[morphKey(sp, k)] ?? 0), 0)}/${n}`,
});
const bredMorph = (sp, morph, n = 1, text) => ({
  id: `bred-${sp}-${morph}-${n}`, text: text ?? `Breed ${n > 1 ? n : 'a'} ${morphName(sp, morph).toLowerCase()} ${nm(sp).toLowerCase()}${n > 1 ? 's' : ''} in this tank`,
  test: (m) => (m.genetics?.bred?.[morphKey(sp, morph)] ?? 0) >= n,
  progress: (m) => pct(m.genetics?.bred?.[morphKey(sp, morph)] ?? 0, n), progressText: (m) => `${m.genetics?.bred?.[morphKey(sp, morph)] ?? 0}/${n}`,
});

// --- The list ---------------------------------------------------------------------------------------
const list = [
  // ---- Tier 1: the jar --------------------------------------------------------------------------
  {
    id: 'first-jar', tier: 1, level: 1, giver: 'Mira', title: 'The Moss Jar',
    brief: 'Welcome to the studio. Everyone starts with a jar. A sealed jar is a tiny planet: water rises from the soil, fogs the glass, and rains back down. Give it soil, plants, moss and a cleanup crew and it will look after itself.',
    teaches: ['water-cycle', 'bioactive'],
    goals: [plants(4), moss(5), animals('springtail', 15), humid(78, 100, 2)],
    reward: { funds: 80, rep: 60 }, next: ['cleaning-crew', 'damp-not-drowned'],
  },
  {
    id: 'cleaning-crew', tier: 1, level: 1, giver: 'Mira', title: 'The Cleaning Crew',
    brief: 'Mould loves a wet jar. The answer is not scrubbing but a crew: springtails eat mould, isopods eat waste and leaf litter. Grow a colony and the jar stays clean by itself.',
    teaches: ['bioactive', 'mould'],
    goals: [animals('springtail', 30), animals('isopod', 10), goal('no-mould', 'Keep mould below 20% for 5 days', (m) => m.mold < 0.2, { hold: 5, progressText: (m) => `${Math.round(m.mold * 100)}%` })],
    reward: { funds: 60, rep: 45 }, next: ['moss-carpet'],
  },
  {
    id: 'damp-not-drowned', tier: 1, level: 1, giver: 'Mira', title: 'Damp, Not Drowned',
    brief: 'Roots need air as well as water. Waterlogged soil has none. Aim for soil that is moist all through but never soaked: about half to four-fifths wet.',
    teaches: ['drainage'],
    goals: [goal('soil-band', 'Keep soil moisture between 45 and 85% for 4 days', (m) => m.soil >= 0.45 && m.soil <= 0.85, { hold: 4, progressText: (m) => `${Math.round(m.soil * 100)}%` }), plants(6)],
    reward: { funds: 60, rep: 40 }, next: [],
  },
  {
    id: 'moss-carpet', tier: 1, level: 1, giver: 'Mira', title: 'A Carpet of Moss',
    brief: 'Moss is the first thing that colonises bare stone in nature. Give it damp air and gentle light and it will spread across the soil and the background.',
    teaches: ['succession', 'humidity'],
    goals: [moss(20), humid(75, 100, 3)],
    reward: { funds: 70, rep: 50 }, next: ['pond-in-a-pot'],
  },
  // ---- Tier 2: water ---------------------------------------------------------------------------------------
  {
    id: 'pond-in-a-pot', tier: 2, level: 2, giver: 'Mira', title: 'A Pond in a Pot',
    brief: 'Now for water. Dig a pool, fill it, and put plants in and around it: their roots drink the nutrients that would otherwise feed algae.',
    teaches: ['nitrogen-cycle', 'algae'],
    goals: [goal('pond', 'Have a pool or pond holding at least 2 litres', (m) => m.litres >= 2 && (m.pools >= 1 || m.waterLevel >= 3), { progress: (m) => pct(m.litres, 2), progressText: (m) => `${m.litres.toFixed(1)} L` }),
      goal('waterplants', 'Grow 2 water plants', (m) => m.plants.water >= 2, { progress: (m) => pct(m.plants.water, 2), progressText: (m) => `${m.plants.water}/2` })],
    reward: { funds: 90, rep: 60 }, next: ['fishless-cycle', 'waterfall'],
  },
  {
    id: 'fishless-cycle', tier: 2, level: 2, giver: 'Ines', title: 'Cycle Complete',
    brief: 'A new tank is deadly to fish: there are no bacteria to process their waste. The kind way is a fishless cycle. Dose a little ammonia, test every day, and wait until ammonia and nitrite fall to zero while nitrate appears.',
    teaches: ['nitrogen-cycle'],
    goals: [goal('cycled3', 'Ammonia and nitrite below 0.1 with bacteria established, for 3 days', (m) => m.cycled, { hold: 3, progressText: (m) => `NH₃ ${m.ammonia.toFixed(2)}` }), goal('nitrate5', 'Nitrate above 4 ppm', (m) => m.nitrate > 4, { progressText: (m) => `${Math.round(m.nitrate)} ppm` })],
    reward: { funds: 100, rep: 80 }, next: ['first-school'],
  },
  {
    id: 'first-school', tier: 2, level: 2, giver: 'Ines', title: 'The First School',
    brief: 'Neon tetras are shoaling fish: alone they hide, in a group they relax and show their colours. Six or more in clean, cycled water will be happy.',
    teaches: ['nitrogen-cycle'],
    goals: [animals('neon', 6, 7), goal('clean-water', 'Keep ammonia below 0.25 for 7 days', (m) => m.ammonia < 0.25, { hold: 7, progressText: (m) => m.ammonia.toFixed(2) })],
    reward: { funds: 110, rep: 80 }, next: ['shrimp-colony'],
  },
  {
    id: 'shrimp-colony', tier: 2, level: 3, giver: 'Ines', title: 'A Shrimp Colony',
    brief: 'Cherry shrimp graze the biofilm on every surface. When a colony breeds, you know the water is right: shrimp are sensitive to metals and to sudden changes.',
    teaches: ['algae'],
    goals: [animals('shrimp', 12, 10)],
    reward: { funds: 130, rep: 90 }, next: [],
  },
  {
    id: 'waterfall', tier: 2, level: 3, giver: 'Mira', title: 'Make It Rain',
    brief: 'A waterfall does three jobs: it moves the water, adds oxygen and raises the humidity around it. Build one, and notice how the air near it feels different from the far corner.',
    teaches: ['microclimate', 'oxygen'],
    goals: [goal('fall1', 'Run a waterfall with the pump working', (m) => m.falls >= 1 && m.pumpRunning), goal('gradient', 'Make damp and dry spots differ by at least 8% humidity', (m) => m.humRange[1] - m.humRange[0] >= 8, { progressText: (m) => `${Math.round(m.humRange[1] - m.humRange[0])}%` })],
    reward: { funds: 120, rep: 80 }, next: ['rain-season'],
  },
  {
    id: 'rain-season', tier: 2, level: 3, giver: 'Dr. Okafor', title: 'The Wet Season',
    brief: 'Rainforest frogs breed when the rains come. A rain system on a timer imitates it. Program at least one shower a day and keep the air saturated.',
    teaches: ['humidity', 'parental-care'],
    goals: [goal('rainprog', 'Program a rain shower', (m) => m.equipment.rainProgram >= 1), humid(88, 100, 5)],
    reward: { funds: 140, rep: 90 }, next: ['frog-pad'],
  },
  {
    id: 'frog-pad', tier: 3, level: 4, giver: 'Dr. Okafor', title: 'A Home for Frogs',
    brief: 'Poison frogs are the reward of a well-built tank. They need warmth, saturated air, hiding places and live food every day. They cannot swim well, so give them land and a shallow pool.',
    teaches: ['humidity', 'parental-care'],
    goals: [anyFrogs(2, 10), humid(78, 100, 10)],
    reward: { funds: 200, rep: 130 }, next: ['tadpole-season'],
  },
  {
    id: 'tadpole-season', tier: 3, level: 5, giver: 'Dr. Okafor', title: 'Tadpole Season',
    brief: 'When a frog lays eggs and they hatch, the real work begins. Keep the water clean and the air humid, and give the tadpoles a bromeliad or a pool to grow in.',
    teaches: ['parental-care'],
    goals: [goal('metamorph', 'Raise a tadpole into a frog', (m, s) => (s.metamorphs ?? 0) >= 1 || m.metamorphs >= 1), anyFrogs(3)],
    reward: { funds: 260, rep: 160 }, next: [],
  },
  {
    id: 'perfect-nano', tier: 3, level: 4, giver: 'Mira', title: 'A Perfect Nano',
    brief: 'Small tanks are the hardest to keep perfect. A few litres of water foul in a day, a warm afternoon heats them in an hour, and there is no room to hide a mistake. Build a small tank that a judge cannot fault: a few animals, all of them well, and no more of them than it can carry.',
    teaches: ['carrying-capacity', 'composition'],
    goals: [tankAtMost(120), withinStock(), goal('all-well', 'Keep at least 4 animals, every one healthy, for 5 days', (m) => m.animals.total >= 4 && m.animals.healthy === m.animals.total, { hold: 5, progressText: (m) => `${m.animals.healthy}/${m.animals.total}` }), gradeAt(4, 'A', 3)],
    reward: suggestedReward(4, 2.5), next: [],
  },
];

// ---- Tier 3: one commission per real habitat --------------------------------------------------------------------------------------
const GIVERS = { suriname: 'Dr. Okafor', bocas: 'Dr. Okafor', blackwater: 'Ines', korea: 'The Museum', china: 'The Museum', java: 'Ines', xochimilco: 'The Museum', pacific: 'Ines' };
for (const id of BIOTOPE_ORDER) {
  const b = BIOTOPES[id];
  const natives = b.animals.filter((a) => !['springtail', 'isopod', 'fly'].includes(a));
  const featureText = { bromeliad2: 'Grow 2 bromeliads', bromeliad3: 'Grow 3 bromeliads', leaflitter: 'Build leaf litter and moss on the floor', shallowpool: 'A shallow pool', moss15: 'Moss over 15% of the surfaces', stream: 'A flowing stream', wood: 'Driftwood or roots', deep: 'A deep pool', cycled: 'Cycled water', falls: 'A waterfall', oxygen: 'Oxygen at 7 mg/L or more', stones: 'At least three stones', cool: 'A cool tank (22 °C or less)', tall4: 'Four tall plants or climbers', basking: 'A basking lamp', hardwater: 'Hard water (GH 10 or more)', softwater: 'Soft water (GH 6 or less)', stillwater: 'Still or gently moving water', uvb: 'A UVB tube', falsebottom: 'A false bottom under the land' };
  list.push({
    id: `biotope-${id}`, tier: 3, level: b.level, giver: GIVERS[id] ?? 'The Museum', title: b.name,
    brief: `${b.blurb} Recreate it: the climate, the animals that live there, and the features that make it recognisable.`,
    teaches: ['biotope'],
    goals: [
      temp(b.climate.temp[0], b.climate.temp[1], 5), humid(b.climate.humidity[0], b.climate.humidity[1], 5),
      ...natives.map((a) => animals(a, a === 'neon' || a === 'cardinal' ? 6 : a === 'shrimp' ? 6 : 2)),
      goal('native-plants', `Grow ${Math.min(3, b.plants.length)} of its native plants`, (m) => b.plants.filter((p) => (m.plants.byId[p] ?? 0) >= 1).length >= Math.min(3, b.plants.length), { progressText: (m) => `${b.plants.filter((p) => (m.plants.byId[p] ?? 0) >= 1).length}/${Math.min(3, b.plants.length)}` }),
      ...b.features.map((f) => feature(f, featureText[f] ?? f)),
    ],
    reward: suggestedReward(b.level, 2.5), next: [], biotope: id,
  });
}

list.push(
  {
    id: 'set-and-forget', tier: 4, level: 7, giver: 'Kenji', title: 'Set and Forget',
    brief: 'The best keepers are lazy in the right way: they build systems that look after the tank. Write a controller rule so that the humidity holds itself, then step back for a week.',
    teaches: ['feedback-control'],
    goals: [goal('rule', 'Have at least one automation rule', (m) => m.equipment.rules >= 1), humid(80, 94, 7)],
    reward: suggestedReward(7, 2.5), next: ['vacation-test', 'heatwave-drill'],
  },
  {
    id: 'heatwave-drill', tier: 4, level: 6, giver: 'Kenji', title: 'Heatwave Drill',
    brief: 'The forecast says a heatwave is coming, and warm water holds less oxygen. When the room heats up, keep the tank comfortable with a fan, a cooling unit, or both.',
    teaches: ['oxygen', 'feedback-control'],
    start: (world) => world.events?.force?.('heatwave'),
    goals: [goal('cool27', 'Keep the tank under 27 °C for 3 days while the room is hot', (m) => m.temp <= 27 && m.roomTemp >= 26, { hold: 3, progressText: (m) => `${m.temp.toFixed(1)} °C` }), goal('no-loss', 'Lose no animals', (m) => m.daysSinceDeath >= 3)],
    reward: suggestedReward(6, 2), next: [],
  },
  {
    id: 'vacation-test', tier: 4, level: 7, giver: 'Kenji', title: 'The Vacation Test',
    brief: 'Go away for a week. Your automation has to keep everything alive with nobody home. Use the Vacation button in the Lab and read the report.',
    teaches: ['feedback-control'],
    goals: [goal('vacation', 'Survive a 7-day Vacation with no losses', (m, s) => (s.vacationsSurvived ?? 0) >= 1)],
    reward: suggestedReward(7, 3), next: [],
  },
  {
    id: 'exhibit-a', tier: 5, level: 8, giver: 'The Museum', title: 'The Museum Wing',
    brief: 'The Museum of Living Worlds wants a showpiece for its new wing. It must live well, be composed with care, and teach a visitor where its animals come from.',
    teaches: ['composition', 'biotope'],
    goals: [goal('grade-a', 'Earn an A from the Curator', (m, s) => (s.bestGrade ?? 0) >= 4), goal('species8', 'Keep 8 species', (m) => m.animals.species >= 8, { progressText: (m) => `${m.animals.species}/8` })],
    reward: suggestedReward(8, 3), next: ['exhibit-s'],
  },
  {
    id: 'exhibit-s', tier: 5, level: 9, giver: 'The Museum', title: 'The Perfect Scape',
    brief: 'One more step. The jury wants nothing wrong: a grade S, a tank older than 60 days, and not a single loss for a month.',
    teaches: ['composition', 'conservation'],
    goals: [goal('grade-s', 'Earn an S from the Curator', (m, s) => (s.bestGrade ?? 0) >= 5), goal('age60', 'Keep the tank going for 60 days', (m) => m.tankDays >= 60, { progressText: (m) => `${Math.floor(m.tankDays)} d` }), goal('nolosses', 'A month without a loss', (m) => m.daysSinceDeath >= 30)],
    reward: suggestedReward(9, 4), next: [],
  },
  {
    id: 'grand-exhibit', tier: 5, level: 9, giver: 'The Museum', title: 'The Grand Exhibit',
    brief: 'Only a big tank can hold a whole landscape: a stream that winds from a waterfall to a lagoon, a forest floor, a planted wall and a canopy, each with its own animals. The Museum wants one for its main hall, and it must not look crowded.',
    teaches: ['composition', 'carrying-capacity'],
    goals: [tankAtLeast(400), goal('species10', 'Keep 10 species', (m) => m.animals.species >= 10, { progress: (m) => pct(m.animals.species, 10), progressText: (m) => `${m.animals.species}/10` }),
      goal('zones5', 'Land, open water, a stream, a planted wall and a canopy', (m) => (m.zones ?? 0) >= 5, { progressText: (m) => `${m.zones ?? 0}/5` }), withinStock(), gradeAt(3, 'B', 3)],
    reward: suggestedReward(9, 3.5), next: [],
  },
);

// ---- Genetics: breed the colour you want ------------------------------------------------------------------------------------
list.push(
  {
    id: 'purple-guppies', tier: 2, level: 3, giver: 'Ines', title: 'A Purple Surprise',
    brief: 'A guppy\'s tail colour is an in-between gene: one red copy and one blue copy make purple. Put a red guppy and a blue guppy together (pick the colours in the Animals tool), pair them up, and see what their babies look like. Then check the odds in the Lab.',
    teaches: ['genetics'],
    goals: [bredMorph('guppy', 'purple', 1, 'Breed a purple guppy in this tank'), animals('guppy', 4)],
    reward: suggestedReward(3, 1.5), next: ['blue-guppies'],
  },
  {
    id: 'blue-guppies', tier: 2, level: 3, giver: 'Ines', title: 'True Blue',
    brief: 'Two purple guppies are both half red and half blue. Their babies are a mix: a quarter red, a half purple and a quarter blue. Breed a blue guppy from two purple parents, and you have a line that breeds true.',
    teaches: ['genetics'],
    goals: [bredMorph('guppy', 'blue', 1, 'Breed a blue guppy in this tank')],
    reward: suggestedReward(3, 1.5), next: [],
  },
  {
    id: 'orange-shrimp', tier: 3, level: 4, giver: 'Ines', title: 'Orange Crush',
    brief: 'Red cherry shrimp carry a recessive red gene; yellow shrimp carry a recessive yellow gene. A shrimp with both, rr and yy, is a glowing orange. It will take a few generations: breed reds and yellows, and keep the carriers.',
    teaches: ['genetics'],
    goals: [bredMorph('shrimp', 'orange', 1, 'Breed an orange cherry shrimp in this tank')],
    reward: suggestedReward(4, 2), next: [],
  },
  {
    id: 'sky-frogs', tier: 3, level: 5, giver: 'Dr. Okafor', title: 'Sky-blue Frogs',
    brief: 'Most blue dart frogs are deep cobalt, but a recessive gene makes a pale sky-blue one. Two carriers can have sky-blue young, about one in four. Collect three sky-blue frogs, and keep them healthy.',
    teaches: ['genetics', 'parental-care'],
    goals: [morphCount('dartfrog', ['sky_spotted', 'sky_clean'], 3, 'Keep 3 healthy sky-blue dart frogs')],
    reward: suggestedReward(5, 2), next: [],
  },
  {
    id: 'pink-axolotl', tier: 5, level: 8, giver: 'The Museum', title: 'The Pink Axolotl',
    brief: 'The museum wants captive-bred axolotls for its new tank. Wild axolotls are dark; the pale pink leucistic form is a recessive gene. Pair two carriers or two leucistic axolotls in cold water, and raise a leucistic youngster.',
    teaches: ['genetics', 'conservation'],
    goals: [bredMorph('axolotl', 'leucistic', 1, 'Breed a leucistic axolotl in this tank'), animals('axolotl', 2)],
    reward: suggestedReward(8, 2.5), next: [],
  },
);

export const COMMISSIONS = Object.fromEntries(list.map((c) => [c.id, c]));
export const COMMISSION_ORDER = list.map((c) => c.id);
export const FIRST_COMMISSION = 'first-jar';
