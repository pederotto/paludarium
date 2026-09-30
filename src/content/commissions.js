// Commissions: goals with a story. Each is a small lesson: the brief says
// why the client wants it, `teaches` links field-guide cards, and the goals
// are checked against a metrics snapshot (game/metrics.js). `hold` means the
// condition has to stay true for that many game days in a row.
//
// goal = { id, text, test(m, stats), progress?(m, stats) 0..1, progressText?(m, stats), hold?: days }

import { BIOTOPES, BIOTOPE_ORDER } from './biotopes.js';
import { suggestedReward } from './economy.js';
import { SPECIES } from '../sim/animals.js';
import { PLANTS } from '../sim/plants.js';

// --- Goal builders ---------------------------------------------------------------------------
const nm = (id) => SPECIES[id]?.name ?? id;
const pn = (id) => PLANTS[id]?.name ?? id;
const pct = (a, b) => Math.max(0, Math.min(1, a / Math.max(1e-6, b)));

const animals = (id, n, hold) => ({
  id: `a-${id}-${n}`, text: `Keep ${n} ${nm(id).toLowerCase()} healthy${hold ? ` for ${hold} days` : ''}`, hold,
  test: (m) => (m.animals.healthyById[id] ?? 0) >= n,
  progress: (m) => pct(m.animals.healthyById[id] ?? 0, n), progressText: (m) => `${m.animals.healthyById[id] ?? 0}/${n}`,
});
const anyFrogs = (n, hold) => ({
  id: `frogs-${n}`, text: `Keep ${n} poison frogs healthy${hold ? ` for ${hold} days` : ''}`, hold,
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
];

// ---- Tier 3: one commission per real habitat --------------------------------------------------------------------------------------
const GIVERS = { suriname: 'Dr. Okafor', bocas: 'Dr. Okafor', blackwater: 'Ines', korea: 'The Museum', china: 'The Museum', java: 'Ines', xochimilco: 'The Museum', pacific: 'Ines' };
for (const id of BIOTOPE_ORDER) {
  const b = BIOTOPES[id];
  const natives = b.animals.filter((a) => !['springtail', 'isopod', 'fly'].includes(a));
  const featureText = { bromeliad2: 'Grow 2 bromeliads', bromeliad3: 'Grow 3 bromeliads', leaflitter: 'Build leaf litter and moss on the floor', shallowpool: 'A shallow pool', moss15: 'Moss over 15% of the surfaces', stream: 'A flowing stream', wood: 'Driftwood or roots', deep: 'A deep pool', cycled: 'Cycled water', falls: 'A waterfall', oxygen: 'Oxygen at 7 mg/L or more', stones: 'At least three stones', cool: 'A cool tank (22 °C or less)', tall4: 'Four tall plants or climbers', basking: 'A basking lamp' };
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
);

export const COMMISSIONS = Object.fromEntries(list.map((c) => [c.id, c]));
export const COMMISSION_ORDER = list.map((c) => c.id);
export const FIRST_COMMISSION = 'first-jar';
