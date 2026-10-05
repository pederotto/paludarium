// Every vertex attribute the bakes write reaches the game: render/creatures/glb.js keeps only the names in KEEP (three.js names a
// custom glTF attribute in lower case), so an attribute a bake adds without adding it there is silently dropped. That happened to
// `_SKINX`: the four-bone skin binding was in the files from 5 Oct while the game kept skinning with two bones.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the loader keeps every attribute the bakes write', () => {
  const keep = JSON.parse(read('src/render/creatures/glb.js').match(/export const KEEP = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
  const written = new Set();
  // (a bake missing from this list fails, not skipped: C1b round 3, item 17; and an attribute named through a variable is caught by the
  // second pattern, any '_NAME' string in a bake)
  for (const f of ['tools/bake-creature.mjs', 'tools/bake-frogpose.mjs', 'tools/bake-lizard.mjs', 'tools/rig/muscles.mjs']) {
    assert.ok(fs.existsSync(new URL(`../${f}`, import.meta.url)), `${f} is gone: update this list`);
    for (const m of read(f).matchAll(/setAttribute\('(_[A-Z0-9_]+)'/g)) written.add(m[1]);
    for (const m of read(f).matchAll(/'(_(?:SKIN|SKINX|RIG|MUSC|MUSU|[A-Z]{3,6}))'/g)) written.add(m[1]);
  }
  assert.ok(written.has('_SKINX') && written.has('_MUSC'), `found ${[...written].join(', ')}`);
  const lost = [...written].filter((a) => !keep.includes(a.toLowerCase()));
  assert.deepEqual(lost, [], `written by a bake but dropped by glb.js KEEP: ${lost.join(', ')}`);
});
