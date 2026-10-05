// B3: salamander larvae are their own species with their own body, not the frog tadpole.
// The body checks run on the tree. The species checks need the animals.js hunk (docs/agents/lizards/reports/B3.hunk.patch,
// waiting for the animals.js lock): until it lands they are SKIPPED as waiting, never passed. To run them before that, on a
// patched copy of src:   sh docs/agents/lizards/tools/b3-patched.sh   (copies src to docs/agents/lizards/tools/tmp/src, applies
// the patch there, runs this file with LARVA_SRC pointing at the copy).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const SRC = path.resolve(process.env.LARVA_SRC ?? 'src');
const imp = (p) => import(pathToFileURL(path.join(SRC, p)).href);
const { BODIES } = await imp('render/creatures/bodies/index.js');
const SAL = await imp('render/creatures/bodies/salamanders.js');
const { M } = await imp('render/creatures/kit.js');
// animals.js needs a browser (three/webgpu, import.meta.env), so its rows and the two methods are read from the source text.
const TXT = fs.readFileSync(path.join(SRC, 'sim/animals.js'), 'utf8');
const row = (id) => { const i = TXT.indexOf('\n  ' + id + ': {'); return i < 0 ? null : TXT.slice(i, TXT.indexOf('\n  },', i)); };
const field = (r, k) => (r.match(new RegExp('\\b' + k + ': ([^,}\\n]+(?:\\[[^\\]]*\\])?)')) ?? [])[1];
const list = (r, k) => JSON.parse(((r.match(new RegExp('\\b' + k + ": (\\[[^\\]]*\\])")) ?? [])[1] ?? 'null').replace(/'/g, '"'));
const method = (name, args) => { const i = TXT.indexOf('\n  ' + name + '('); const j = TXT.indexOf('\n  }\n', i); return [TXT.slice(TXT.indexOf('{', i) + 1, j), args]; };
const WAIT = !row('larva') && 'waiting for docs/agents/lizards/reports/B3.hunk.patch (animals.js is locked)';

test('the larva shape: 6 gill stalks, 4 legs, a dorsal fin that starts at mid-back (not behind the head like the axolotl)', () => {
  assert.equal(typeof SAL.larvaShape, 'function', 'salamanders.js exports larvaShape');
  const S = SAL.larvaShape(), A = SAL.axolotlShape();
  assert.equal(S.gills.length, 6);
  assert.equal(S.legs.length, 4);
  assert.equal(S.feet.length, 4);
  assert.ok(S.dorsal.z1 < 0.5 && A.dorsal.z1 > 1.5, `larva fin front ${S.dorsal.z1}, axolotl ${A.dorsal.z1}`);
  // slimmer than the axolotl: head half-width and trunk height (loft columns: z, centre y, half-width, top, bottom)
  assert.ok(S.rows.every((r, i) => r[2] < A.rows[i][2] * 0.8 + 0.06), 'narrower at every station');
});

test('BODIES.larva: its gill tips are gill (fin material) and each foot belongs to its own leg in the rig', () => {
  assert.ok(BODIES.larva, 'BODIES.larva is registered (SALAMANDERS)');
  const def = BODIES.larva(), S = SAL.larvaShape();
  assert.equal(def.bodyKey, 'larva');
  for (const g of S.gills) {
    assert.ok(def.sdf(...g.T) < 0.12, `gill tip inside the surface: ${def.sdf(...g.T)}`);
    assert.equal(def.mat(...g.T), M.FIN, 'gill tip is gill material');
  }
  const ids = new Set(S.feet.map((w) => def.rig(...w)[1]));
  assert.deepEqual([...ids].sort(), [1, 2, 3, 4], 'four legs in the rig');
});

test('species row: larva swims the bottom band, is young (rests on the floor like a tadpole), grows up, body is BODIES.larva', { skip: WAIT }, () => {
  const L = row('larva');
  assert.equal(field(L, 'kind'), "'swim'"); assert.equal(field(L, 'band'), "'bottom'"); assert.equal(field(L, 'young'), 'true');
  assert.ok(+field(L, 'metamorphDays') > 0);
  assert.match(L, /body: sdfBody\('larva'\)/);
  assert.deepEqual(list(L, 'from').sort(), ['firesal', 'marbled', 'newt']);
});

test('newts lay eggs that hatch into larvae; frogs and toads still make tadpoles; no salamander makes tadpoles', { skip: WAIT }, () => {
  assert.match(row('newt'), /eggs: \{[^}]*into: 'larva'/);
  assert.match(row('marbled'), /eggs: \{[^}]*into: 'larva'/);
  const ids = [...TXT.matchAll(/\n {2}(\w+): \{/g)].map((m) => m[1]).filter((id) => /into: 'tadpole'/.test(row(id)));
  assert.ok(ids.length >= 5, `rows making tadpoles: ${ids}`);
  for (const id of ids) assert.match(field(row(id), 'kind'), /'(frog|toad)'/, `${id} still makes tadpoles`);
});

test('a fire salamander gives birth to larvae (parent kept), not tadpoles', { skip: WAIT }, () => {
  const [body] = method('herpBirth');
  const herpBirth = new Function('V', 'one', 'a', 'sp', 'n', body);
  const added = [];
  const stub = {
    world: { terrain: { heightAt: () => 0 }, log() {} }, by: { tadpole: [], larva: [], firesal: [] },
    crabFind: () => ({ x: 0, z: 0 }), waterTop: () => 6,
    add: (id) => { const c = { sp: id }; added.push(c); return c; },
  };
  herpBirth.call(stub, (x, y, z) => ({ x, y, z }), (id) => id, { sp: 'firesal', pos: { x: 0, z: 0 } }, { cap: 6 }, 4);
  assert.equal(added.length, 4);
  for (const c of added) { assert.equal(c.sp, 'larva'); assert.equal(c.parent, 'firesal'); }
});

test('whoever eats tadpoles eats larvae too', { skip: WAIT }, () => {
  for (const m of TXT.matchAll(/\beats: (\[[^\]]*\])/g)) if (m[1].includes("'tadpole'")) assert.ok(m[1].includes("'larva'"), m[1]);
});

test('a resting larva or tadpole is woken by a predator or the camera, not by a big fish that passes (danger with threatOnly)', { skip: WAIT }, () => {
  const [body] = method('danger');
  assert.match(TXT.slice(TXT.indexOf('\n  danger('), TXT.indexOf('\n  danger(') + 40), /danger\(a, sp, threatOnly = false\)/);
  assert.match(TXT, /danger: \(\) => this\.danger\(a, sp, true\)/, 'swim() asks with threatOnly');
  const SP = { larva: { kind: 'swim', size: 1.4, eats: [] }, axolotl: { kind: 'axolotl', size: 2.6, eats: ['larva'] }, loach: { kind: 'swim', size: 4, eats: ['flake'] } };
  const danger = new Function('SPECIES', 'VIS', 'a', 'sp', 'threatOnly', body);
  const near = (list) => ({ camThreat: () => null, near: (k, x, y, z, visit) => list.forEach(visit) });
  const a = { sp: 'larva', pos: { x: 0, y: 0, z: 0 }, rad: 0.4 }, VIS = new Set(['axolotl']);
  const at = (sp) => ({ sp, pos: { x: 1.5, y: 0, z: 0 }, rad: 0.5 });
  const call = (list, t) => danger.call(near(list), SP, VIS, a, SP.larva, t);
  assert.ok(call([at('axolotl')], true), 'a predator wakes it');
  assert.equal(call([at('loach')], true), null, 'a big fish passing does not wake it');
  assert.ok(call([at('loach')], false), 'the big fish still counts as danger for a swimming one');
  assert.ok(danger.call({ camThreat: () => ({ x: 9, z: 0 }), near() {} }, SP, VIS, a, SP.larva, true), 'a camera swoop wakes it');
});
