// A colour morph of a finished frog body: the same geometry, skeleton, bones and finish with another colour map (the established variant route: a manifest key '<species>:<morph>[.<pose>]'
// with a file of its own, as 'dartfrog:sky_clean.swim'). The harlequin's mint-green form (the owner's scan's own colours; the black and orange-red form is the species' base) is made this way
// from harlequin.swim (9 Oct 2026). Run it AFTER every rebake of the base body (the maps are tied to its atlas).
//   node tools/rig/morph-copy.mjs <from key> <to key> <color.webp>      e.g. harlequin.swim harlequin:mint.swim art-src/textures/harlequin/color-mint.webp
// Copies <from>'s GLB pair (public/assets/creatures/<file>, <lo>) to the new key's file names (':' becomes '-'), swaps the new hi file's colour image through set-texture.mjs (the coarse level
// draws with the detailed file's material, so only the hi file carries it) and adds the manifest entry (a copy of the base's, with the new file names).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const DIR = 'public/assets/creatures/', [from, to, color] = process.argv.slice(2);
if (!from || !to || !color) { console.error('usage: node tools/rig/morph-copy.mjs <from key> <to key> <color.webp>'); process.exit(2); }
const man = JSON.parse(fs.readFileSync(DIR + 'manifest.json', 'utf8')), src = man[from];
if (!src) throw new Error(`no manifest entry ${from}`);
const name = (k) => k.replace(':', '-'), file = `${name(to)}.glb`, lo = `${name(to)}.lo.glb`;
fs.copyFileSync(DIR + src.file, DIR + file);
if (src.lo) fs.copyFileSync(DIR + src.lo, DIR + lo);
man[to] = { ...JSON.parse(JSON.stringify(src)), file, ...(src.lo ? { lo } : {}) };
// (a skeleton is written on one line, as tools/bake-frogpose.mjs and tools/bake-creature.mjs do)
const SK = [];
fs.writeFileSync(DIR + 'manifest.json', JSON.stringify(man, (key, v) => (key === 'skeleton' && v && typeof v === 'object' ? `@@skeleton${SK.push(v) - 1}@@` : v), 1).replace(/"@@skeleton(\d+)@@"/g, (_, i) => JSON.stringify(SK[+i])));
execFileSync(process.execPath, ['tools/rig/set-texture.mjs', to, color], { stdio: 'inherit' });
console.log(`${to}: ${file} (${Math.round(fs.statSync(DIR + file).size / 1024)} KB) with ${color}`);
