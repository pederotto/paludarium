// Audit of the premade sets (run "sets", S1): cross-checks every set in src/content/presets.js against the species sheets in
// src/sim/animals.js SPECIES (temp, humidity, pH, GH, flow, flock, cap, territorial, minL, minH, eats, size), the set's own
// climate and layout, its biotope's lists, the tank room (sim/scale.js stockCount / sim/tank.js roomFor) and a coarse
// region table. No browser: SPECIES is read out of the source text (animals.js imports three and cannot load in node).
//   node tools/set-audit.mjs [--counts=path/to/S1.counts.json] [--out=path.md] [--json]
// With --counts (written by tools/steps/set-counts.mjs: what a seed-1 build really holds after settle) the table also checks
// the placed animals and plants; without it only the recipe is checked. Severity: wrong (a keeper would not do it / the sim
// stresses it), thin (legal but empty or below a real group), ok. Facts tagged (guess) in the tables below are not verified.
import fs from 'node:fs';
import { PRESETS, PRESET_ORDER } from '../src/content/presets.js';
import { BIOTOPES } from '../src/content/biotopes.js';
import { TANKS } from '../src/content/tanks.js';
import { HABITAT } from '../src/content/habitats.js';
import { sizeFactors, roomFor } from '../src/sim/tank.js';
import { stockCount, waterRoom } from '../src/sim/scale.js';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const root = decodeURIComponent(new URL('..', import.meta.url).pathname);

// ---- SPECIES out of the source text ------------------------------------------------------------------------------------
function loadSpecies() {
  const src = fs.readFileSync(root + 'src/sim/animals.js', 'utf8');
  const a = src.indexOf('export const SPECIES = {');
  const b = src.indexOf('\n};\n', a);
  const text = src.slice(a + 'export const SPECIES = '.length, b + 2);
  const stub = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 1 : stub), apply: () => stub });
  const scope = new Proxy({}, { has: (t, k) => typeof k === 'string' && !(k in globalThis), get: (t, k) => (typeof k === 'symbol' ? undefined : stub) });
  return new Function('__s', `with (__s) { return (${text}); }`)(scope);
}
const SPECIES = loadSpecies();

// ---- tables (guess = from the keeper's knowledge, not verified) ----------------------------------------------------------
const FEEDERS = new Set(['fly', 'flylarva', 'flypupa', 'springtail', 'springpink', 'springsea', 'isopod', 'purpleiso', 'pandaking', 'cricket', 'dubia', 'earthworm', 'waxworm', 'tadpole', 'larva', 'eggs']);
const CREW = new Set(['springtail', 'springpink', 'springsea', 'isopod', 'purpleiso', 'pandaking', 'fly']);   // the clean-up crew and feeders: never the display
// region of origin: am = tropical/subtropical Americas incl. Mexico and Florida, ap = Asia-Pacific, mg = Madagascar, eu = Europe, * = cosmopolitan/hobby (guess)
const SP_REGION = { neon: 'am', guppy: 'am', cory: 'am', loach: 'ap', shrimp: 'ap', crab: 'ap', isopod: '*', springtail: '*', fly: '*', dartfrog: 'am', strawberry: 'am', toad: 'ap', newt: 'ap', firesal: 'eu', axolotl: 'am', gecko: 'ap', cardinal: 'am', ember: 'am', betta: 'ap', oto: 'am', snail: '*', bedotia: 'mg', tylomelania: 'ap', matanoshrimp: 'ap', cambarellus: 'am', tanichthys: 'ap', hillloach: 'ap', zacco: 'ap', bullhead: 'eu', leucomelas: 'am', auratus: 'am', cpd: 'ap', pygmy: 'am', blueshrimp: 'ap', panther: 'ap', skink: 'ap', bumblebee: 'am', reedfrog: 'mg', redeye: 'am', marbled: 'eu', purpleiso: '*', pandaking: 'ap', springpink: '*', springsea: '*' };
const PL_REGION = { fernph: '*', weed: '*', fern: '*', bilberry: 'eu', grass: '*', bromeliad: 'am', pothos: 'ap', cattail: '*', bamboo: '*', vallisneria: '*', sword: 'am', javafern: 'ap', fissidens: '*', rotala: 'ap', anubias: 'af', javamoss: 'ap', monstera: 'am', frogbit: 'am', lily: '*', masdevallia: 'am', dracula: 'am', pleurothallis: 'am', lepanthes: 'am', cuthbertsonii: 'ap', neoregelia: 'am', guzmania: 'am', tillandsia: 'am', sinningia: 'am', columnea: 'am', begonia: '*', nidus: 'ap', crypt: 'ap', hartstongue: 'eu', miscanthus: 'ap', heliconia: 'am', aponogeton: 'mg', pandanus: '*', limnobium: 'am', sago: 'ap', tussock: '*' };
const BIO_REGION = { newguinea: 'ap', madagascar: 'mg', matano: 'ap', everglades: 'am', suriname: 'am', bocas: 'am', blackwater: 'am', korea: 'ap', china: 'ap', java: 'ap', xochimilco: 'am', pacific: 'ap', costarica: 'am', cacao: 'am', bolivar: 'am', cordoba: 'am', teutoburg: 'eu', galicia: 'eu', sumatra: 'ap', thai: 'ap', shan: 'ap', taiwan: 'ap', putumayo: 'am', araguaia: 'am', trinidad: 'am', tapajos: 'am', mataatlantica: 'am', kerala: 'ap', thaicave: 'ap', litterjar: '*', guppyfarm: '*' };
// air/water setpoint of each layout builder (generator.js g.env lines) and the water the layout fills with (guess: tap unless restock sets it)
const LAYOUT_SETPOINT = { cascade: 20, suriname: 24, blackwater: 25.5, stream: 18, jar: 22, karst: 25, swamp: 25, canyon: 22, highland: 16 };
const RESTOCK = { streambank: { out: ['crab', 'shrimp'], sp: 25, ph: 7.0, gh: 6 }, reedpool: { out: ['cardinal', 'cory', 'shrimp'], sp: 26, ph: 7.0, gh: 6 }, matano: { out: ['cardinal', 'cory', 'shrimp'], sp: 26, ph: 8.1, gh: 13 }, everglades: { out: ['cardinal', 'cory', 'shrimp'], sp: 22, ph: 7.0, gh: 6 } };
const TAP = { ph: 7.5, gh: 10 };   // content/equipment.js WATER_SOURCES.tap
const FLOWING = new Set(['cascade', 'stream', 'canyon', 'highland']);   // layouts with a moving stream (guess: the rest are still)

const counts = (() => { const p = arg('counts', ''); try { return p ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; } catch { return null; } })();
const layoutOf = (P) => P.layout ?? P.id;
const layoutUse = {};
for (const id of PRESET_ORDER) layoutUse[layoutOf(PRESETS[id])] = (layoutUse[layoutOf(PRESETS[id])] ?? 0) + 1;
const inRange = (v, r, m = 0) => !r || (v >= r[0] - m && v <= r[1] + m);

const rows = [];
for (const id of PRESET_ORDER) {
  const P = PRESETS[id], layout = layoutOf(P), T = TANKS[P.ref], B = BIOTOPES[P.biotope];
  const F = sizeFactors(T), rs = RESTOCK[id];
  const C = counts?.[id];
  const findings = [];   // [severity, text]
  const add = (sev, text) => findings.push([sev, text]);
  const volL = (T.w * T.d * T.h) / 1000;
  const litres = C?.litres ?? Math.round(volL * (P.water ?? 0) * 0.55);   // 0.55 = water depth as a share of tank height (guess) when no build is available
  const setpoint = P.env?.setpoint ?? rs?.sp ?? LAYOUT_SETPOINT[layout];
  const chem = rs ?? TAP;
  const myRegion = BIO_REGION[P.biotope] ?? '*';
  const animals = P.animals ?? [], plants = P.plants ?? [];
  const display = animals.filter((a) => !CREW.has(a));

  // lists vs biotope, region
  for (const a of animals) { const r = SP_REGION[a] ?? '*'; if (r !== '*' && myRegion !== '*' && r !== myRegion) add('wrong', `${a} is from ${r}, the place is ${myRegion}`); }
  for (const p of plants) { const r = PL_REGION[p] ?? '*'; if (r !== '*' && myRegion !== '*' && r !== myRegion) add('wrong', `plant ${p} is from ${r}, the place is ${myRegion}`); }
  // stock / flora entries that the allow-list would drop
  for (const [a] of P.stock ?? []) if (!animals.includes(a)) add('wrong', `stock ${a} is not in animals (dropped)`);
  for (const [p] of P.flora ?? []) if (!plants.includes(p)) add('wrong', `flora ${p} is not in plants (dropped)`);
  // a layout builder's animals that the restock/allow-list removes
  if (rs) add('thin', `layout ${layout} builds the lagoon then restock() removes ${rs.out.join('/')} (the set rebuilds its own stock)`);
  if (layoutUse[layout] > 2) add('thin', `layout "${layout}" is shared by ${layoutUse[layout]} sets (same landscape, different name)`);

  // species vs the set's climate and water
  for (const a of display.concat(animals.filter((x) => CREW.has(x)))) {
    const sp = SPECIES[a]; if (!sp) { add('wrong', `${a} has no SPECIES row`); continue; }
    if (sp.temp && !inRange(setpoint, sp.temp)) add(inRange(setpoint, sp.temp, 2) ? 'thin' : 'wrong', `${a} wants ${sp.temp.join('-')} C, setpoint ${setpoint}`);
    if (P.climate?.temp && sp.temp && (P.climate.temp[1] < sp.temp[0] || P.climate.temp[0] > sp.temp[1])) add('wrong', `${a} wants ${sp.temp.join('-')} C, the place is ${P.climate.temp.join('-')}`);
    if (sp.humidity && P.climate?.rh && P.climate.rh[1] < sp.humidity) add('wrong', `${a} wants RH >= ${sp.humidity}, the place tops at ${P.climate.rh[1]}`);
    const aqua = sp.kind === 'swim' || sp.kind === 'crawlWater';
    if (aqua) {
      if (sp.ph && !inRange(chem.ph, sp.ph)) add(inRange(chem.ph, sp.ph, 0.3) ? 'thin' : 'wrong', `${a} wants pH ${sp.ph.join('-')}, water ${chem.ph}`);
      if (sp.gh && !inRange(chem.gh, sp.gh)) add(chem.gh >= sp.gh[0] - 1 && chem.gh <= sp.gh[1] + 3 ? 'thin' : 'wrong', `${a} wants GH ${sp.gh.join('-')}, water ${chem.gh}`);
      const still = !FLOWING.has(layout);
      if (sp.flow != null && still && sp.flow >= 0.5) add('thin', `${a} wants flow ${sp.flow}, layout ${layout} is still (guess)`);
      if (sp.flow != null && !still && sp.flow <= 0.2) add('thin', `${a} wants still water (flow ${sp.flow}), layout ${layout} runs a stream (guess)`);
    }
    if (C?.env?.flow != null && sp.flowMin && C.env.flow < sp.flowMin) add('thin', `${a} needs a current (flowMin ${sp.flowMin}), the tank's measured flow is ${C.env.flow} (care stress ${((sp.flowMin - 0.1 - C.env.flow) * 0.25 + 0.02).toFixed(3)})`);
    if (sp.minL && volL < sp.minL * 0.8) add('wrong', `${a} needs >= ${sp.minL} L, ${P.ref} is ${Math.round(volL)} L`);
    if (sp.minH && T.h < sp.minH * 0.85) add('wrong', `${a} needs height >= ${sp.minH}, ${P.ref} is ${T.h}`);
  }
  // predators and prey among the set's own animals
  for (const a of animals) for (const b of animals) {
    if (a === b || !SPECIES[a]?.eats?.includes(b)) continue;
    if (FEEDERS.has(b)) { if (!CREW.has(b)) add('wrong', `${a} eats ${b}, both stocked`); }
    else if (id === 'matano' && a === 'panther' && b === 'matanoshrimp') add('thin', `${a} eats ${b} in the real lake (known); a colony of 24 is stocked, to be confirmed by the 5-day check`);
    else add('wrong', `${a} eats ${b}, both stocked`);
  }
  // group size, room and territory at the reference tank
  const placed = C?.animals ?? null;
  for (const a of display) {
    const sp = SPECIES[a]; if (!sp) continue;
    const want = (P.stock ?? []).find((s) => s[0] === a)?.[1];
    const lo = sp.flock?.[0] ?? (sp.school ? 3 : 1);
    const room = roomFor(sp, F), fits = Math.min(room.crowd, waterRoom(sp, litres));
    if (fits < lo) add('wrong', `${a}: the water (${litres} L) holds ${fits} < smallest group ${lo}; the generator will skip it`);
    const n = placed ? (placed[a] ?? 0) : (want != null ? stockCount(sp, want, T, litres) : null);
    if (n === 0) add('wrong', `${a} (${P.featured?.includes(a) ? 'featured' : 'listed'}) is not placed at ${P.ref}`);
    else if (n != null && n < lo) add('wrong', `${a}: ${n} placed < group of ${lo}`);
    else if (n != null && sp.school && n < 6) add('thin', `${a}: school of ${n} (a keeper keeps 6+)`);
    else if (n != null && n < Math.min(lo + 1, 3) && sp.kind !== 'gecko' && !sp.territorial) add('thin', `${a}: only ${n}`);
    if (n != null && n > room.crowd) add('wrong', `${a}: ${n} placed > crowd limit ${room.crowd}`);
    if (sp.territorial && n != null && n > room.territories * 3) add('wrong', `${a}: territorial, ${n} placed for ${room.territories} male territories (3 fish each)`);
  }
  // populated: kinds and numbers
  const placedAnimals = C ? Object.entries(C.animals).filter(([k]) => !CREW.has(k) && !FEEDERS.has(k)).reduce((s, [, v]) => s + v, 0) : null;
  const floorM2 = (T.w * T.d + T.w * T.h) / 10000;
  const nPlants = C ? Object.values(C.plants).reduce((s, v) => s + v, 0) : null;
  const kindsPlaced = C ? Object.keys(C.plants).length : null;
  if (plants.length <= 3) add('thin', `only ${plants.length} plant kinds allowed (${plants.join(',') || 'none'})`);
  if (display.length < 2 && !P.featured?.every((f) => CREW.has(f))) add('thin', `one display species (${display.join(',') || 'none'}) and no companion`);
  if (C) {
    if (kindsPlaced <= 3) add('thin', `only ${kindsPlaced} plant kinds placed: ${Object.entries(C.plants).map(([k, v]) => `${k}${v}`).join(' ')}`);
    if (nPlants / floorM2 < 35) add('thin', `${(nPlants / floorM2).toFixed(0)} plants per m2 of floor+wall (${nPlants} in ${floorM2.toFixed(2)} m2)`);
    if (placedAnimals < 4 && !P.featured?.some((f) => (SPECIES[f]?.flock?.[1] ?? 99) <= 2)) add('thin', `${placedAnimals} display animals placed`);
    if (C.visible && P.featured?.length && !P.featured.some((f) => (C.visible[f] ?? 0) > 0)) add('thin', `featured ${P.featured.join('/')} not in the default view`);
    if (C.pieces != null && C.pieces < 6) add('thin', `${C.pieces} hardscape pieces`);
    const unused = plants.filter((p) => !(p in C.plants));
    if (unused.length) add('thin', `allowed but never placed: ${unused.join(',')}`);
  }
  if (P.needs?.length) add('thin', `needs: ${P.needs.join(', ')}`);
  if (P.blockedBy?.length) add('thin', `blocked by ${P.blockedBy.join(',')}`);
  const sev = findings.some((f) => f[0] === 'wrong') ? 'wrong' : findings.some((f) => f[0] === 'thin') ? 'thin' : 'ok';
  rows.push({ id, layout, ref: P.ref, litres, setpoint, plantsAllowed: plants.length, animalsAllowed: animals.length, placedAnimals, nPlants, kindsPlaced, pieces: C?.pieces ?? null, sev, findings });
}

// ---- output -------------------------------------------------------------------------------------------------------------
const out = [];
const tally = { wrong: 0, thin: 0, ok: 0 };
for (const r of rows) tally[r.sev]++;
out.push(`# S1 audit: ${rows.length} sets, wrong ${tally.wrong}, thin ${tally.thin}, ok ${tally.ok} (${counts ? `build counts from ${counts._stamp ?? 'counts file'}` : 'recipe only, no build counts'})`);
out.push('', '| set | layout (sets sharing) | ref | litres | setpoint C | plants allowed / placed (kinds) | animals allowed / display placed | pieces | severity | wrong |', '|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) out.push(`| ${r.id} | ${r.layout} (${layoutUse[r.layout]}) | ${r.ref} | ${r.litres} | ${r.setpoint} | ${r.plantsAllowed} / ${r.nPlants ?? '-'} (${r.kindsPlaced ?? '-'}) | ${r.animalsAllowed} / ${r.placedAnimals ?? '-'} | ${r.pieces ?? '-'} | ${r.sev} | ${r.findings.filter((f) => f[0] === 'wrong').length} |`);
out.push('', '## Findings per set');
for (const r of rows) { out.push(`### ${r.id}: ${r.sev}`); for (const [s, t] of r.findings) out.push(`- ${s}: ${t}`); if (!r.findings.length) out.push('- none'); }
const cause = {};
for (const r of rows) for (const [s, t] of r.findings) { const k = `${s}: ${t.replace(/[0-9.]+/g, '#').replace(/\b[a-z]+ (wants|eats|needs|is from|:)/, '<sp> $1').slice(0, 60)}`; (cause[k] ??= new Set()).add(r.id); }
out.push('', '## Causes by number of sets hit (normalised text)');
for (const [k, v] of Object.entries(cause).sort((a, b) => b[1].size - a[1].size).slice(0, 25)) out.push(`- ${v.size} sets: ${k}`);
const needs = {};
for (const id of PRESET_ORDER) for (const n of PRESETS[id].needs ?? []) (needs[n] ??= []).push(id);
out.push('', '## Missing assets by number of sets served');
for (const [k, v] of Object.entries(needs).sort((a, b) => b[1].length - a[1].length)) out.push(`- ${v.length}: ${k} (${v.join(', ')})`);
const text = out.join('\n') + '\n';
const o = arg('out', '');
if (o) fs.writeFileSync(o, text); else process.stdout.write(text);
if (process.argv.includes('--json')) console.log(JSON.stringify(rows.map((r) => ({ id: r.id, sev: r.sev, n: r.findings.length }))));
process.exitCode = tally.wrong ? 1 : 0;
