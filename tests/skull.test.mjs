// The mouth rule (owner, 6 Oct 2026: "skull and mandible should schematically and conceptually follow this [a labelled amphibian skull plate]"): a mouth sits on a
// skull and a mandible. tools/rig/skull.mjs fits the class plan to a species' head, tools/blender/skull.py builds and checks it (written back as `verified`),
// art-src/skull/<id>.skull.json is the result. These tests keep the scheme true to the plate and the mouth true to the scheme.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PLANS, CONFIG } from '../tools/rig/skull.mjs';

const sk = JSON.parse(fs.readFileSync('art-src/skull/firesal.skull.json', 'utf8'));
const man = JSON.parse(fs.readFileSync('public/assets/creatures/manifest.json', 'utf8'));
const mouthPy = fs.readFileSync('tools/blender/firesal-mouth.py', 'utf8');
const num = (re) => +mouthPy.match(re)[1];

test('the caudate plan has the bones of the plate, with the plate\'s own codes', () => {
  const codes = new Set(PLANS.caudate.bones.map((b) => b.code));
  for (const c of ['pm', 'm', 'n', 'pf', 'f', 'p', 'sq', 'qu', 'pt', 'v', 'ps', 'o.o.c', 'den', 'prart', 'art']) assert.ok(codes.has(c), `plan lacks ${c}`);
  const groups = (g) => PLANS.caudate.bones.filter((b) => b.group === g).map((b) => b.code);
  assert.deepEqual(groups('mandible').sort(), ['art', 'den', 'prart', 'sym'], 'the lower jaw is the dentary, angular/prearticular, articular and the symphysis');
  assert.ok(groups('skull').includes('qu') && !groups('mandible').includes('qu'), 'the quadrate is the skull\'s half of the joint');
  assert.ok(PLANS.anuran.bones.length >= 14, 'the plate\'s frog skull is listed for the frogs\' mouths');
});

test('the fire salamander skull: bones in pairs, the lower jaw in one piece', () => {
  const names = sk.bones.map((b) => b.name);
  for (const b of sk.bones) if (b.name.endsWith('.R')) assert.ok(names.includes(b.name.replace(/\.R$/, '.L')), `${b.name} has no left twin`);
  assert.equal(sk.bones.filter((b) => b.group === 'mandible').every((b) => /^(dentary|angular-prearticular|articular|mentomeckelian)/.test(b.name)), true);
  assert.ok(sk.skullLengthCm > 2.0 && sk.skullLengthCm < 2.5, `skull length ${sk.skullLengthCm} cm (a 16 cm animal: about 2.2)`);
  const ratio = sk.checks.skullWidthCm / sk.skullLengthCm;
  assert.ok(ratio > 0.65 && ratio < 0.95, `a broad salamander skull: width / length ${ratio.toFixed(2)}`);
});

test('the lip line is the tooth line and the hinge is the quadrate-articular joint', () => {
  assert.ok(sk.checks.toothRowOffLipUpper <= 0.01 && sk.checks.toothRowOffLipLower <= 0.01, 'upper and lower tooth rows meet on the lip surface');
  const [a, b] = sk.hinge;
  assert.ok(Math.abs(a.at[1] - b.at[1]) < 0.02 && Math.abs(a.at[2] - b.at[2]) < 0.02, 'one transverse axis: the two joints at the same height and the same z');
  assert.ok(sk.checks.hingeOffLip <= 0.02, 'the hinge is on the lip surface');
  assert.ok(sk.checks.jointGap <= sk.checks.jointReach, 'the quadrate and the articular touch');
  // the mouth built in the mesh (tools/blender/firesal-mouth.py, the jaw bone of the manifest) is the one the skull was fitted to
  const ZH = num(/\bZH\s*=\s*([\d.]+)/), LIP0 = num(/LIP0, SLOPE\s*=\s*([\d.]+),/), SLOPE = num(/LIP0, SLOPE\s*=\s*[\d.]+,\s*([\d.]+)/);
  assert.ok(Math.abs(sk.lip.zh - ZH) < 0.01 && Math.abs(sk.lip.y0 - LIP0) < 0.01 && Math.abs(sk.lip.slope - SLOPE) < 0.001, 'the skull\'s lip surface equals the mouth script\'s');
  assert.ok(Math.abs(CONFIG.firesal.hingeZ - ZH) < 0.01, 'the plan config and the mouth script agree on the hinge');
  const jaw = man.firesal.skeleton.bones.find((x) => x.name === 'jaw');
  assert.ok(Math.abs(jaw.head[2] - sk.hinge[0].at[2]) < 0.02 && Math.abs(jaw.head[1] - sk.hinge[0].at[1]) < 0.02, `the jaw bone pivots on the hinge: ${jaw.head} vs ${sk.hinge[0].at}`);
});

test('every bone lies inside the skin, clear of the eyes, and the mouth cavity stays inside too (Blender check, tools/blender/skull.py)', () => {
  const v = sk.verified;
  assert.ok(v, 'the skull has not been checked in Blender: run tools/blender/skull.py');
  assert.equal(v.bones, sk.bones.length);
  assert.deepEqual(v.boneOutside, [], 'no bone through the skin');
  assert.ok(v.minMarginCm >= 0.03, `the smallest margin to the skin is ${v.minMarginCm} cm`);
  assert.ok(v.eyeIntrusionMaxCm <= 0.03, `bones in the eyeballs: ${v.eyeIntrusionMaxCm} cm`);
  assert.equal(v.cavity.outside, 0, 'the mouth cavity must not poke out of the head');
  const cb = v.cavity.bones;                                                // the roof against the palate bones, the floor against the rami and the hyoid (after the cavity was fitted to them)
  assert.ok(cb.roof.minGapCm >= -0.05 && cb.floor.minGapCm >= -0.05, `the cavity is inside a bone by more than 0.05 cm: roof ${cb.roof.minGapCm}, floor ${cb.floor.minGapCm}`);
  assert.ok(cb.roof.inside <= 5 && cb.floor.inside <= 20, 'a few vertices may graze a bone (0.03 cm), not many');
  assert.ok(v.toothRows >= 5, 'tooth rows: premaxilla, maxillae, dentaries, vomers');
  const d = v.dressing;                                                    // the mouth dressed on the skull (skull.py --fit-cavity): teeth along the tooth rows, a tongue pad on the floor
  assert.ok(d && d.teeth.upper >= 40 && d.teeth.lower >= 35 && d.teeth.vomerine >= 10, `teeth upper / lower / vomerine: ${JSON.stringify(d?.teeth)}`);
  assert.ok(d.tonguePadVerts >= 60, 'a tongue pad');
  assert.ok(sk.dress.tongue.az > 0.5 && sk.dress.tongue.ax > 0.3 && sk.dress.tongue.topDy < 0, 'the pad is an ellipse on the floor, its top below the lip surface');
  assert.ok(sk.dress.teeth.len < 0.1 && sk.dress.teeth.r < 0.03, 'salamander teeth are tiny (under a millimetre)');
});

// ---- the frogs (6 Oct 2026, night): the anuran plan fitted to the sculpted slim scan (the owner's white_mesh 10), shared by the edible and the common frog. Lab chain:
// .agents/skin/skull (frog-sculpt.py -> tools/rig/skull.mjs frog -> tools/blender/skull.py -> frog-mouth.py -> skull.py --fit-cavity). The skull is fitted to the LAB head; it is
// re-fitted when a frog body is baked for the game.
const fr = JSON.parse(fs.readFileSync('art-src/skull/frog.skull.json', 'utf8'));

test('the anuran plan has the bones of the plate\'s frog skull, the lower jaw in one piece, no teeth on the dentary', () => {
  const codes = new Set(PLANS.anuran.bones.map((b) => b.code));
  for (const c of ['pm', 'm', 'qj', 'n', 'os', 'pf', 'f/p', 'sq', 'qu', 'o.o.c', 'pt', 'v', 'pl', 'ps', 'den', 'prart', 'art', 'sym', 'hy']) assert.ok(codes.has(c), `plan lacks ${c}`);
  const groups = (g) => PLANS.anuran.bones.filter((b) => b.group === g).map((b) => b.code);
  assert.deepEqual(groups('mandible').sort(), ['art', 'den', 'prart', 'sym'], 'dentary, angulosplenial (prearticular), articular, mentomeckelian');
  assert.ok(groups('skull').includes('qu') && groups('skull').includes('qj') && !groups('mandible').includes('qu'), 'the quadrate and the quadratojugal are the skull\'s');
  assert.ok(!PLANS.anuran.bones.find((b) => b.code === 'den').parts.some((p) => p.tooth), 'the dentary is toothless in frogs: the maxilla is the tooth row');
  assert.ok(PLANS.anuran.bones.find((b) => b.code === 'm').parts.some((p) => p.tooth === 'upper'), 'the maxilla and premaxilla carry the teeth');
});

test('the frog skull: 33 bones in pairs, a broad flat skull, the globes sunk into the orbits', () => {
  assert.equal(fr.bones.length, 33);
  const names = fr.bones.map((b) => b.name);
  for (const b of fr.bones) if (b.name.endsWith('.R')) assert.ok(names.includes(b.name.replace(/\.R$/, '.L')), `${b.name} has no left twin`);
  assert.ok(fr.bones.filter((b) => b.group === 'mandible').every((b) => /^(dentary|angular-prearticular|articular|mentomeckelian)/.test(b.name)));
  assert.ok(fr.skullLengthCm > 2.8 && fr.skullLengthCm < 3.3, `skull length ${fr.skullLengthCm} cm (a 16 cm lab frog: about 3.05)`);
  const ratio = fr.checks.skullWidthCm / fr.skullLengthCm;
  assert.ok(ratio > 0.8 && ratio < 1.05, `a broad frog skull: width / length ${ratio.toFixed(2)}`);
  assert.ok(Math.abs(fr.eyes[0].c[0] + fr.eyes[1].c[0]) < 0.01 && Math.abs(fr.eyes[0].c[1] - fr.eyes[1].c[1]) < 0.01, 'two eyes, mirrored about the midline');
  assert.ok(fr.eyes[1].c[1] > 2.95 && fr.eyes[1].c[1] < 3.2, `the globes sit ${fr.eyes[1].c[1]} cm up: sunk into the orbits (the scan had 3.27)`);
});

test('the frog\'s lip line is the tooth line and the hinge is the quadrate-articular joint', () => {
  assert.ok(fr.checks.toothRowOffLipUpper <= 0.01, 'the upper tooth row lies on the lip surface');
  assert.equal(fr.checks.toothRowOffLipLower, null, 'no lower tooth row: the dentary is toothless');
  const [a, b] = fr.hinge;
  assert.ok(Math.abs(a.at[1] - b.at[1]) < 0.02 && Math.abs(a.at[2] - b.at[2]) < 0.02, 'one transverse axis');
  assert.ok(fr.checks.hingeOffLip <= 0.02 && fr.checks.jointGap <= fr.checks.jointReach, 'the hinge is on the lip surface and the quadrate and the articular touch');
  const C = CONFIG.frog;
  assert.ok(Math.abs(fr.lip.zh - C.hingeZ) < 0.01 && Math.abs(fr.lip.y0 - (C.lip.y0 + C.lip.slope * C.hingeZ)) < 0.01 && Math.abs(fr.lip.slope - C.lip.slope) < 0.001, 'the skull\'s lip surface is the config\'s');
  assert.equal(fr.eyeZone, C.eyeZone, 'the containment test leaves out the eyeball zone (the scan\'s eyes are spheres merged into the skin)');
});

test('every frog bone lies inside the skin, clear of the eyes, and the mouth cavity stays inside (Blender check, tools/blender/skull.py)', () => {
  const v = fr.verified;
  assert.ok(v, 'the frog skull has not been checked in Blender: run tools/blender/skull.py');
  assert.equal(v.bones, fr.bones.length);
  assert.deepEqual(v.boneOutside, [], 'no bone through the skin');
  assert.ok(v.minMarginCm >= 0.03, `the smallest margin to the skin is ${v.minMarginCm} cm`);
  assert.ok(v.eyeIntrusionMaxCm <= 0.03, `bones in the eyeballs: ${v.eyeIntrusionMaxCm} cm`);
  assert.equal(v.cavity.outside, 0, 'the mouth cavity must not poke out of the head');
  assert.ok(v.cavity.underEye > 100 && v.cavity.underEyeMinClearCm >= -0.02, `the palate dips round the globes (clearance ${v.cavity.underEyeMinClearCm} cm over ${v.cavity.underEye} vertices)`);
  const cb = v.cavity.bones;                                                // the frog's lining is a sheet of 3,400 vertices a side: a graze of at most 0.15 mm is accepted, not a dive
  assert.ok(cb.roof.minGapCm >= -0.05 && cb.floor.minGapCm >= -0.05, `the cavity is inside a bone by more than 0.05 cm: roof ${cb.roof.minGapCm}, floor ${cb.floor.minGapCm}`);
  assert.ok(cb.roof.inside <= 15 && cb.floor.inside <= 500, `grazes: roof ${cb.roof.inside}, floor ${cb.floor.inside}`);
  assert.ok(v.toothRows >= 3, 'tooth rows: the premaxilla and the two maxillae');
});
