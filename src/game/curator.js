// The Curator: scores a tank on how well it lives (ecology), how well it is
// composed (design), how faithfully it copies a real habitat (biotope) and how
// it has been looked after (care). Every part comes with notes that say why it
// matters and what to change, so the score is a lesson, not just a number.
//
// Deterministic and fast (a few ms): it reads a metrics snapshot plus a coarse
// look at where things stand.

import { computeMetrics } from './metrics.js';
import { BIOTOPES } from '../content/biotopes.js';
import { SPECIES } from '../sim/animals.js';
import { PLANTS } from '../sim/plants.js';
import { TANK } from '../sim/tank.js';
import { GRADE_ORDER } from './appeal.js';

const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const note = (ok, text, concept) => ({ ok, text, concept });
export { GRADE_ORDER };
export { visitorAppeal } from './appeal.js';
const grade = (s) => (s >= 92 ? 'S' : s >= 80 ? 'A' : s >= 65 ? 'B' : s >= 50 ? 'C' : 'D');

// Points for a value: full inside [lo, hi], falling off linearly over `fall` either side.
const band = (v, lo, hi, fall) => (v >= lo && v <= hi ? 1 : v < lo ? clamp01((v - (lo - fall)) / fall) : clamp01(((hi + fall) - v) / fall));
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function ecologyScore(m) {
  const notes = [];
  let s = 0;
  const cyc = clamp01(m.cycle / 0.9) * (m.ammonia < 0.15 && m.nitrite < 0.2 ? 1 : 0.4);
  s += cyc * 20; notes.push(note(cyc > 0.9, cyc > 0.9 ? 'The nitrogen cycle is complete: waste is processed as fast as it is made.' : 'The nitrogen cycle is not finished: ammonia or nitrite can still rise. Wait, and test.', 'nitrogen-cycle'));
  const hr = m.animals.total ? m.animals.healthy / m.animals.total : 0.6;
  s += hr * 25; notes.push(note(hr > 0.85, hr > 0.85 ? 'Nearly every animal is healthy.' : `${Math.round((1 - hr) * 100)}% of the animals are stressed. Open the Inspect banner on one to see what it lacks.`, 'microclimate'));
  // Diversity against what a tank of this size can hold (game/stocking.js speciesTarget: 8 in the standard tank, about
  // 4 in a jar, 12 in the show tank), so a small tank is not marked down for being small, and a big one is asked for more.
  const target = m.speciesTarget ?? 8;
  const div = clamp01(m.animals.species / target);
  s += div * 15; notes.push(note(div > 0.7, div > 0.7 ? `A rich community: ${m.animals.species} species share the tank (about ${target} suit a tank this size).` : `Few species: a food web with more members (cleanup crew, prey, grazers) is more stable. A tank this size has room for about ${target}.`, 'carrying-capacity'));
  // The crew a tank needs grows with its floor: 15 springtails clean the standard tank, 6 a jar, 45 the show tank.
  const k = clamp((m.size?.floor ?? 4050) / 4050, 0.4, 3);
  const crew = (m.animals.byId.springtail ?? 0) >= Math.round(15 * k) || (m.animals.byId.isopod ?? 0) >= Math.round(6 * k) || (m.animals.byId.shrimp ?? 0) >= Math.round(6 * k);
  s += crew ? 10 : 0; notes.push(note(crew, crew ? 'A cleanup crew recycles waste.' : 'No cleanup crew: add springtails and isopods (land) or shrimp (water).', 'bioactive'));
  const clean = m.algae < 0.25 && m.mold < 0.25;
  s += clean ? 10 : m.algae < 0.4 && m.mold < 0.5 ? 5 : 0; notes.push(note(clean, clean ? 'No algae bloom and no mould.' : 'Algae or mould are getting a foothold: check light hours, feeding and airflow.', m.mold >= 0.25 ? 'mould' : 'algae'));
  const nut = m.nitrate >= 2 && m.nitrate <= 45;
  s += nut ? 5 : 0; notes.push(note(nut, nut ? 'Nutrients are in a healthy range.' : m.nitrate > 45 ? 'Nitrate is high: a water change or more plants will help.' : 'Nitrate is at zero: plants may be starving.', 'nitrogen-cycle'));
  const pr = m.plants.total ? m.plants.healthy / m.plants.total : 0;
  s += pr * 10; notes.push(note(pr > 0.85, pr > 0.85 ? 'The plants are thriving.' : 'Some plants are struggling: read why in their Inspect banner (light, humidity, soil).', 'photoperiod'));
  const o2 = m.oxygen >= 6.5 ? 5 : m.oxygen >= 5 ? 2.5 : 0;
  s += o2; notes.push(note(o2 === 5, o2 === 5 ? 'Plenty of dissolved oxygen.' : 'Oxygen is low: cool the water and add a waterfall or airflow.', 'oxygen'));
  // Crowding: more of a species than fit in a tank this size (the simulation's own room, sim/tank.js roomFor). Only a
  // crowded tank loses points; the standard starter is well inside its room and loses none.
  const st = m.stocking;
  if (st && st.worst > 0) {
    const over = st.over ?? [];
    if (over.length) s -= Math.min(10, 4 * over.length + (st.worst - 1) * 6);
    const o = over[0];
    notes.push(note(!over.length, o ? `Crowded: ${o.n} of the ${SPECIES[o.id]?.name.toLowerCase() ?? o.id} where about ${o.room} fit${over.length > 1 ? `, and ${over.length - 1} more species over their room` : ''}. Crowded animals stress each other, and their waste outruns the filter.` : 'Every species has the room it needs in a tank this size.', 'carrying-capacity'));
  }
  return { score: Math.round(clamp(s)), notes };
}

// Where things stand on the floor (0 = back-left … 1 = front-right).
function layout(world) {
  const pieces = world.decor.pieces.map((p) => {
    const q = p.mesh.position;
    return { type: p.type, x: q.x / TANK.w + 0.5, z: q.z / TANK.d + 0.5, size: p.mesh.scale.length() };
  });
  return pieces;
}

// Fraction of the floor with nothing on it (plants, stones): "negative space".
function openness(world) {
  const C = world.climate, F = C.f;
  let open = 0, n = 0;
  for (let c = 0; c < C.nx * C.nz; c++) { n++; if (F.plants[c] < 0.06 && F.canopy[c] < 0.02) open++; }
  return n ? open / n : 0;
}

export function designScore(world, m) {
  const notes = [];
  let s = 0;
  // Small tanks (the jar, the cube, the nano: game/stocking.js sizeClass) are judged on restraint: one stone, one pool,
  // one kind of rock. Large ones are asked to use the room: land, open water, a stream, a planted wall and a canopy.
  const cls = m.size?.cls ?? 'medium', small = cls === 'small', large = cls === 'large';
  const pcs = layout(world);
  // Focal point: the biggest piece should sit off-centre near a third.
  const big = [...pcs].sort((a, b) => b.size - a.size)[0];
  if (big) {
    const dx = Math.abs(big.x - 0.5);
    const good = dx > 0.14 && dx < 0.4;
    s += good ? 15 : 6; notes.push(note(good, good ? 'The largest piece sits off-centre, near a third: a natural focal point.' : 'The largest stone is dead centre or in a corner. Move it about a third of the way across.', 'composition'));
  } else notes.push(note(false, 'No hardscape yet: stones and wood give a scene its focal point.', 'composition'));
  // Odd numbers of stones look natural.
  const stones = m.hardscape.stone;
  const odd = (small ? stones >= 1 : stones >= 3) && stones % 2 === 1;
  s += odd ? 10 : stones >= 2 ? 4 : 0; notes.push(note(odd, odd ? `${stones} stone${stones > 1 ? 's' : ''}: an odd number reads as natural.` : small ? 'In a small tank one stone (or three) is enough; even numbers look staged.' : 'Use three, five or seven stones in graded sizes; even numbers look staged.', 'composition'));
  // Layers.
  const L = m.plants.heights;
  const lay = (L.low >= 3 ? 5 : L.low >= 1 ? 2 : 0) + (L.mid >= 3 ? 5 : L.mid >= 1 ? 2 : 0) + (L.tall >= 3 ? 5 : L.tall >= 1 ? 2 : 0);
  s += lay; notes.push(note(lay >= 13, lay >= 13 ? 'Low, medium and tall plants make three layers of depth.' : 'Plant in layers: low in front, medium in the middle, tall at the back and on the wall.', 'composition'));
  // Water feature.
  // A small tank needs only one water feature; a sealed jar's is the rain on its glass over a moss carpet.
  const w = small ? (m.falls >= 1 || m.pools >= 1 || m.streamCells >= 8 || (m.size?.closed && m.mossPct >= 20) ? 15 : 0)
    : (m.falls >= 1 ? 8 : 0) + (m.pools >= 1 ? 4 : 0) + (m.streamCells >= 8 ? 3 : 0);
  s += w; notes.push(note(w >= 11, w >= 11 ? (small ? 'One water feature, and the tank feels complete: in a small tank, that is enough.' : 'Flowing water gives the eye a path and the air its humidity.')
    : small ? (m.size?.closed ? 'A sealed jar needs no pump: a moss carpet and the water cycling over the glass are its water feature. Grow the moss.' : 'Even a small tank wants one water feature: a pool the size of a saucer will do.')
      : 'Add a waterfall, a pool or a stream: moving water is the centre of a paludarium.', 'composition'));
  // Negative space.
  const open = openness(world);
  const neg = band(open, 0.22, 0.4, 0.18);
  s += neg * 10; notes.push(note(neg > 0.8, neg > 0.8 ? 'Some open ground lets the busy parts breathe.' : open < 0.22 ? 'Crowded: leave a quarter of the floor open so the scene has room.' : 'Sparse: the floor is mostly empty. Plant it up.', 'composition'));
  // Variety.
  const types = Object.keys(m.hardscape.byType).length;
  if (small) {
    s += types >= 1 ? 5 : 0; notes.push(note(types >= 1, types >= 1 ? 'A single kind of stone or wood keeps a small tank calm.' : 'Give a small tank one piece of hardscape: a stone or a root.', 'composition'));
  } else if (large) {
    // Zones (game/metrics.js): land, open water, a stream, a planted wall, a canopy of tall plants.
    const zones = m.zones ?? 0, ok = types >= 3 && zones >= 4;
    s += ok ? 5 : types >= 2 || zones >= 3 ? 3 : 0;
    notes.push(note(ok, ok ? `A varied hardscape and ${zones} zones: the room is used.` : `A tank this big has room for land, open water, a stream, a planted wall and a canopy (${zones} of 5 so far), and for stone, wood and roots together.`, 'composition'));
  } else {
    s += types >= 3 ? 5 : types >= 2 ? 3 : 0; notes.push(note(types >= 3, types >= 3 ? 'Stone, wood and roots: a varied hardscape.' : 'Mix stone with wood or roots for variety.', 'composition'));
  }
  const wallNeed = small ? 2 : 4;
  const wallOk = m.wall.plants >= wallNeed;
  s += wallOk ? 5 : m.wall.plants >= 1 ? 2 : 0; notes.push(note(wallOk, wallOk ? 'The background is alive.' : 'Grow epiphytes and creeping figs on the background: it is a third of the view.', 'composition'));
  const mo = band(m.mossPct, 12, 55, 12);
  s += mo * 10; notes.push(note(mo > 0.8, mo > 0.8 ? 'Moss softens the stone and soil.' : 'Moss is a big part of the look: keep the air damp and the light moderate.', 'humidity'));
  const clear = m.algae < 0.2 && m.condense < 0.5;
  s += clear ? 10 : 4; notes.push(note(clear, clear ? 'Clear water and a clear glass.' : 'Green water or fogged glass hides the view: fix the algae, wipe the glass, add airflow.', m.condense >= 0.5 ? 'dew-point' : 'algae'));
  const dens = m.plants.total / Math.max(1, (TANK.w * TANK.d) / 100);
  const dp = band(dens, 0.6, 3, 0.5);
  s += dp * 5; notes.push(note(dp > 0.8, dp > 0.8 ? 'A healthy planting density.' : dens < 0.6 ? 'Plant more densely.' : 'Very dense: thin it out.', 'succession'));
  return { score: Math.round(clamp(s)), notes };
}

export function biotopeScore(m, biotopeId) {
  const b = BIOTOPES[biotopeId];
  if (!b) return null;
  const notes = [];
  let s = 0;
  const t = band(m.temp, b.climate.temp[0], b.climate.temp[1], 4);
  s += t * 30; notes.push(note(t > 0.9, t > 0.9 ? `Temperature suits ${b.name} (${b.climate.temp[0]}–${b.climate.temp[1]} °C).` : `${b.name} is ${b.climate.temp[0]}–${b.climate.temp[1]} °C; yours is ${m.temp.toFixed(1)} °C.`, 'biotope'));
  const h = band(m.humidity, b.climate.humidity[0], b.climate.humidity[1], 10);
  s += h * 20; notes.push(note(h > 0.9, h > 0.9 ? 'Humidity matches.' : `Humidity should be ${b.climate.humidity[0]}–${b.climate.humidity[1]}%; yours is ${Math.round(m.humidity)}%.`, 'humidity'));
  const natives = b.animals.filter((a) => !['springtail', 'isopod', 'fly'].includes(a));
  const have = natives.filter((a) => (m.animals.healthyById[a] ?? 0) >= 1);
  const af = natives.length ? have.length / natives.length : 1;
  s += af * 20; notes.push(note(af > 0.99, af > 0.99 ? 'All the native animals are here.' : `Missing animals from ${b.name}: ${natives.filter((a) => !have.includes(a)).map((a) => SPECIES[a]?.name).join(', ')}.`, 'biotope'));
  const pl = b.plants.filter((p) => (m.plants.byId[p] ?? 0) >= 1);
  const pf = Math.min(1, pl.length / Math.min(3, b.plants.length));
  s += pf * 15; notes.push(note(pf > 0.99, pf > 0.99 ? 'The plants are native.' : `Grow more native plants: ${b.plants.filter((p) => !pl.includes(p)).slice(0, 3).map((p) => PLANTS[p]?.name).join(', ')}.`, 'biotope'));
  const feats = b.features ?? [];
  const okF = feats.filter((f) => m.features[f]);
  const ff = feats.length ? okF.length / feats.length : 1;
  s += ff * 15; notes.push(note(ff > 0.99, ff > 0.99 ? 'The habitat features are all there.' : `Missing features: ${feats.filter((f) => !m.features[f]).join(', ')}.`, 'biotope'));
  return { score: Math.round(clamp(s)), notes, biotope: b.name };
}

export function careScore(m) {
  const notes = [];
  const days = Math.min(1, m.daysSinceDeath / 30);
  const hr = m.animals.total ? m.animals.healthy / m.animals.total : 1;
  const s = days * 40 + m.waterQuality * 30 + hr * 30;
  notes.push(note(days > 0.9, days > 0.9 ? 'A month without losing an animal.' : `${Math.round(m.daysSinceDeath)} days since the last loss.`, 'quarantine'));
  notes.push(note(m.waterQuality > 0.85, m.waterQuality > 0.85 ? 'Clean water.' : 'The water quality is poor: test and change some water.', 'nitrogen-cycle'));
  return { score: Math.round(clamp(s)), notes };
}

// score(world, { biotope, metrics }) -> { overall, grade, parts: { ecology, design, biotope?, care } }
export function score(world, { biotope = null, metrics = null } = {}) {
  const m = metrics ?? computeMetrics(world);
  const ecology = ecologyScore(m), design = designScore(world, m), care = careScore(m);
  const bio = biotope ? biotopeScore(m, biotope) : null;
  const overall = bio
    ? 0.3 * ecology.score + 0.25 * design.score + 0.3 * bio.score + 0.15 * care.score
    : 0.4 * ecology.score + 0.4 * design.score + 0.2 * care.score;
  const o = Math.round(overall);
  return { overall: o, grade: grade(o), parts: { ecology, design, care, ...(bio ? { biotope: bio } : {}) } };
}
