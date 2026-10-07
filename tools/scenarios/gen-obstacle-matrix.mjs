// Writes tools/scenarios/lab-obstacles.json: every walking species against the same obstacle set, one animal per scenario, so a failure is the species meeting that obstacle
// and nothing else. Run:  node tools/scenarios/gen-obstacle-matrix.mjs   then   SCEN=tools/scenarios/lab-obstacles.json OUT=... node tools/shot.mjs ... --steps=tools/steps/lab-scenarios.mjs
import fs from 'node:fs';

const SPECIES = (process.env.SP ?? 'toad,dartfrog,redeye,gecko,skink,crab,newt,firesal').split(',');
const FOUR = [{ kind: 'wood', x: 2.84, z: 4.16, size: 23, rot: 0 }, { kind: 'wood', x: -15.38, z: -13.1, size: 23, rot: 0 }, { kind: 'wood', x: 2.08, z: 12.77, size: 23, rot: Math.PI / 2 }, { kind: 'wood', x: -1.91, z: -12.09, size: 23, rot: Math.PI / 2 }];
const goto = (x, z) => ({ type: 'goto', x, z, tol: 1.5 });
const fig8 = { type: 'path', shape: 'figure8', size: 28, mode: 'loop', cx: -14, cz: 10, sx: -14, sz: 10, h: 0.5, pace: 1, gait: 'auto' };
const cases = [
  { id: 'log23', label: 'goto across a 23 cm log (way round)', seconds: 22, obstacles: [{ kind: 'wood', x: 0, z: 0, size: 23, rot: Math.PI / 2 }], from: [-12, 0], drive: goto(12, 0) },
  { id: 'log40', label: 'goto across a 40 cm log (no way round)', seconds: 22, obstacles: [{ kind: 'wood', x: 0, z: 0, size: 40, rot: Math.PI / 2 }], from: [-12, 0], drive: goto(12, 0) },
  { id: 'boulders', label: 'goto past 3 boulders in a line', seconds: 22, obstacles: [{ kind: 'boulder', x: 0, z: -9, size: 10, rot: 0 }, { kind: 'boulder', x: 0, z: 0, size: 10, rot: 0 }, { kind: 'boulder', x: 0, z: 9, size: 10, rot: 0 }], from: [-12, 0], drive: goto(12, 0) },
  { id: 'hide', label: 'goto across a cork tube and a slate', seconds: 22, obstacles: [{ kind: 'cork', x: 0, z: 0, size: 16, rot: Math.PI / 2 }, { kind: 'slate', x: 5, z: 4, size: 18, rot: 0.6 }], from: [-12, 0], drive: goto(12, 0) },
  { id: 'fig8', label: 'fig8 across the 4 logs', seconds: 30, obstacles: FOUR, from: [-14, 10], drive: fig8 },
  { id: 'free', label: 'free roam among the 4 logs', seconds: 40, obstacles: FOUR, from: [-14, 10], drive: null },
];
const out = [];
for (const sp of SPECIES) for (const c of cases) {
  out.push({ name: `${sp} ${c.label}`, seconds: c.seconds, spec: { obstacles: c.obstacles, animals: [{ sp, x: c.from[0], z: c.from[1], yaw: 1.57, drive: c.drive }] } });
}
fs.writeFileSync(new URL('./lab-obstacles.json', import.meta.url), JSON.stringify(out));
console.log(`${out.length} scenarios for ${SPECIES.join(', ')}`);
