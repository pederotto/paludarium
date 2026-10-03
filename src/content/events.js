// Things that happen to a tank. Each is a small lesson: what happened, why,
// and what a keeper does. `start` changes the world; `end` puts it back.
// (Durations are game days; `weight` is relative likelihood.)

const SP = (W, id) => W.animals.by[id]?.length ?? 0;

export const EVENTS = [
  {
    id: 'heatwave', title: 'Heatwave', weight: 2, duration: 3, concept: 'oxygen', kind: 'bad',
    text: 'A hot spell has heated the room by 6 °C. Warm water holds less oxygen, and amphibians overheat.',
    fix: 'Turn on the fan, open the lid a little, or run a cooling unit. Shade the lamp (lower its power).',
    canStart: (m) => m.animals.total >= 3,
    start: (W) => { W.env.room += 6; }, end: (W) => { W.env.room -= 6; },
  },
  {
    id: 'power-cut', title: 'Power cut', weight: 1.4, duration: 0.3, concept: 'feedback-control', kind: 'bad',
    text: 'The power is off. The heater, lights, pumps, filter and fan stopped, and the temperature is slowly falling.',
    fix: 'Nothing to do but wait; a tank with good insulation, a closed lid and a stable population rides it out. Next time, plan a backup.',
    canStart: (m) => m.tankDays > 20,
    start: (W) => { const E = W.env; E._pc = { heater: E.heater, lights: E.lights, pump: W.water.hydro.pump.on, fan: E.fan, filter: E.filter }; E.heater = false; E.lights = 'off'; W.water.hydro.pump.on = false; E.fan = 0; E.filter = false; },
    end: (W) => { const E = W.env, s = E._pc; if (!s) return; E.heater = s.heater; E.lights = s.lights; W.water.hydro.pump.on = s.pump; E.fan = s.fan; E.filter = s.filter ?? true; delete E._pc; },
  },
  {
    id: 'springtail-boom', title: 'Springtail boom', weight: 1.6, duration: 0.1, concept: 'carrying-capacity', kind: 'good',
    text: 'A wave of springtails has hatched: the colony found a new pocket of mould to eat. Good news for the frogs.',
    fix: 'Nothing: the boom will fade when the food runs out.',
    canStart: (m) => (m.animals.byId.springtail ?? 0) >= 10 && (m.animals.byId.springtail ?? 0) < 120,
    start: (W) => { for (let k = 0; k < 20; k++) { const p = W.randomSpot((x, y, z, s) => s === -Infinity); if (p) W.animals.add('springtail', p); } },
    end: () => {},
  },
  {
    id: 'snail-boom', title: 'Snail explosion', weight: 1.2, duration: 0.1, concept: 'carrying-capacity', kind: 'bad',
    text: 'The trumpet snails have multiplied: uneaten food gives them all they need. It is a sign of overfeeding.',
    fix: 'Feed less, remove the excess food, and let the population fall back to what the tank can feed.',
    canStart: (m) => (m.animals.byId.snail ?? 0) >= 3 && (m.animals.byId.snail ?? 0) < 60,
    start: (W) => { for (let k = 0; k < 15; k++) { const p = W.randomSpot((x, y, z, s) => s - y > 1); if (p) W.animals.add('snail', p, { age: 20 * 1440 }); } },
    end: () => {},
  },
  {
    id: 'mould-bloom', title: 'Mould bloom', weight: 1.4, duration: 2, concept: 'mould', kind: 'bad',
    text: 'White mould is fuzzing the wood: still, saturated air and something to eat. Springtails will help, airflow will help more.',
    fix: 'Turn on the fan, add springtails and isopods, and remove the dead plant matter.',
    canStart: (m) => m.tankDays > 14 && m.humidity > 85,
    start: (W) => { W.env.mold = Math.min(1, W.env.mold + 0.45); W.env.detritus += 4; }, end: () => {},
  },
  {
    id: 'algae-bloom', title: 'Algae bloom', weight: 1.2, duration: 2, concept: 'algae', kind: 'bad',
    text: 'The water has turned green: light and nutrients are outrunning the plants.',
    fix: 'Shorten the light hours, add floating plants, feed less, change some water, and add grazers.',
    canStart: (m) => m.litres > 3,
    start: (W) => { W.env.algae = Math.min(1, W.env.algae + 0.4); W.env.nitrate += 12; }, end: () => {},
  },
  {
    id: 'dry-spell', title: 'Dry spell', weight: 1.4, duration: 3, concept: 'humidity', kind: 'bad',
    text: 'The house is dry today: indoor air at 25% humidity pulls moisture out of every tank.',
    fix: 'Mist, run the rain system, or raise the fogger. A closed lid holds the humidity in.',
    canStart: (m) => m.animals.total >= 3,
    start: (W) => { W.env.roomHumidity -= 22; }, end: (W) => { W.env.roomHumidity += 22; },
  },
  {
    id: 'visitors', title: 'A school group visits', weight: 1.2, duration: 0.1, concept: 'conservation', kind: 'good',
    text: 'A class of ten-year-olds is in the studio. If your tank looks alive they will remember it.',
    fix: '',
    canStart: (m) => m.animals.total >= 6 && m.plants.total >= 12,
    start: () => {}, end: () => {}, reward: { rep: 25, funds: 20, needsHealthy: 0.8 },
  },
];

export const EVENT_BY_ID = Object.fromEntries(EVENTS.map((e) => [e.id, e]));
export { SP };
