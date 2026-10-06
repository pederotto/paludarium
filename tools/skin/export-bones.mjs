// Writes the skeleton bones of a creature from public/assets/creatures/manifest.json as a JSON array (baked frame, cm), the input of
// tools/skin/skinlab.py --bones:   node tools/skin/export-bones.mjs toad.swim out/toad.swim.bones.json
import fs from 'node:fs';
const [id, out] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync('public/assets/creatures/manifest.json', 'utf8'));
const sk = manifest[id]?.skeleton;
if (!sk?.bones) { console.error(`no skeleton for "${id}" in the manifest`); process.exit(1); }
fs.writeFileSync(out, JSON.stringify(sk.bones));
console.log(`wrote ${sk.bones.length} bones of ${id} to ${out}`);
