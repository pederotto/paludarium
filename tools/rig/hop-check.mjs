// The frog's hop against physics and its muscles (docs/MUSCLES.md, the reference pack's hardest test). For the game's hop
// (sim/animals.js startHop: duration 0.22 + 0.09 sqrt(d) s, apex 0.5 + 0.25 d cm over the straight line, the legs pushing for HOP.push
// of it) and the arc a real frog makes over the same distance under gravity: flight time, take-off speed and angle, the work and
// power the hind-limb muscles must give at take-off (per kg of hind-limb muscle, against Marsh 2022's ~60 J/kg ceiling), and the
// order the leap's joints extend in (util/gait.js leapStroke: hip and knee before the ankle, Biomimetics 9(3):168, 2024).
//
//   node tools/rig/hop-check.mjs [--species=dartfrog] [--mass=<g>] [--takeoff=<s>]
// Body mass and the hind-limb muscle share are guesses until the research rows land (printed with their tags).
import { HOP, leapStroke } from '../../src/util/gait.js';
import { ANURAN_WHOLE } from '../../src/content/anuranmuscles.js';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const G = 981;                                              // cm/s²
const species = arg('species', 'dartfrog');
const massG = +arg('mass', 5);                              // a 4 cm Dendrobates tinctorius: a guess (R2's species data)
const hl = ANURAN_WHOLE.hindlimbOfBody.value, mus = massG * hl;
console.log(`hop-check ${species}: body ${massG} g (guess), hind-limb muscle ${(hl * 100).toFixed(0)} % = ${mus.toFixed(2)} g (${ANURAN_WHOLE.hindlimbOfBody.tag})`);
console.log('dist cm | game: flight s, apex cm, g felt | real at 40 deg: flight s, apex cm, take-off m/s | work J/kg muscle | power W/kg muscle (push in game time / 30 ms)');
for (const d of [1.5, 3, 5.5, 7.7]) {
  const dur = 0.22 + Math.sqrt(d) * 0.09, h = 0.5 + d * 0.25, push = HOP.push * dur, flight = dur - push;
  const gFelt = (8 * h) / (dur * dur);                       // the game's parabola over the whole hop: y = 4 h t (1 - t)
  const th = (40 * Math.PI) / 180, v = Math.sqrt((G * d) / Math.sin(2 * th)), tf = (2 * v * Math.sin(th)) / G, apex = (v * Math.sin(th)) ** 2 / (2 * G);
  const ke = 0.5 * (massG / 1000) * (v / 100) ** 2, w = ke / (mus / 1000);
  const pGame = w / push, p30 = w / 0.03;
  console.log(`${d.toFixed(1).padStart(4)}    | ${dur.toFixed(3)} s, ${h.toFixed(2)} cm, ${(gFelt / G).toFixed(3)} g | ${tf.toFixed(3)} s, ${apex.toFixed(2)} cm, ${(v / 100).toFixed(2)} m/s | ${w.toFixed(1)} | ${pGame.toFixed(0)} / ${p30.toFixed(0)}`);
}
// the leap's joint order: when each joint has made half its extension (cock -> leap), in hop time
const S = leapStroke(0), E = leapStroke(HOP.push);
const names = ['thigh th', 'shin th', 'foot th', 'toes th', 'thigh ph', 'shin ph', 'foot ph', 'toes ph', 'foot roll'];
const half = names.map((n, c) => {
  for (let i = 0; i <= 200; i++) { const t = (i / 200) * HOP.push, a = leapStroke(t).legA[c]; if (Math.abs(a - S.legA[c]) >= 0.5 * Math.abs(E.legA[c] - S.legA[c]) && Math.abs(E.legA[c] - S.legA[c]) > 1) return [n, t]; }
  return [n, null];
});
console.log('leap: half of each joint angle\'s take-off change reached at hop t (push ends at ' + HOP.push + '): ' + half.filter(([, t]) => t != null).map(([n, t]) => `${n} ${t.toFixed(3)}`).join(', '));
console.log('targets: real flight at the arc it makes; work <= ~60 J/kg hind-limb muscle (Marsh 2022, Cuban tree frog); hip and knee before the ankle; ankle 64-83 % of peak joint power (SICB abstract)');
