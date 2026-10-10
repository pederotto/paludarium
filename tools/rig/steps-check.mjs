// A one-body frog's feet on the ground, checked through the game's own code (9 Oct 2026, the owner's movement rule: "no yaw without the legs stepping"): the body is turned on the spot or walked
// along a line or an arc, the stepper (util/steps.js) plants, lifts and re-plants its four feet, the legs are solved to them (render/creatures/skeleton.js stepDirs through poseStroke) and
// the shipped file is skinned on the CPU with its four-bone weights. Per run: how many steps, how far each planted foot's tip slides in the world (it must not: < 1 mm), how far the solved
// tip is from where the foot is meant to be (a leg out of reach), the lowest skin point against the ground (the stance's own at rest), and the biggest jump of any skin point between
// two frames beyond the body's own motion (a pop).
//   node tools/rig/steps-check.mjs [id] [--run turn|walk|arc|all] [--rate 2.5] [--speed 3] [--secs 1.5] [--json]
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { skeletonRig, poseStroke, stanceFeet, ROW_FLOATS } from '../../src/render/creatures/skeleton.js';
import { lungePose, lungeRoot } from '../../src/util/frogstrike.js';
import { HIND, FORE } from '../../src/util/gait.js';
import { STEP, stepperNew, stepperStep } from '../../src/util/steps.js';
await MeshoptDecoder.ready;
const args = process.argv.slice(2), id = args[0] && !args[0].startsWith('--') ? args[0] : 'harlequin.swim';
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const RUN = opt('--run', 'all'), RATE = +opt('--rate', 2.5), SPEED = +opt('--speed', 3), SECS = +opt('--secs', 1.5), JSONOUT = args.includes('--json'), STRIDE = +opt('--every', 3);
const DIR = 'public/assets/creatures/', man = JSON.parse(fs.readFileSync(DIR + 'manifest.json', 'utf8'))[id];
const src = fs.readFileSync('src/sim/animals.js', 'utf8'), k0 = src.indexOf(`\n  ${id.split('.')[0]}: {`), blk = src.slice(Math.max(0, k0));
const SIT = Function('return ' + blk.match(/sit: (\{ pitchDeg[^\n]*?\}),?\n/)[1])(), SIZE = +(blk.match(/size: ([0-9.]+)/)?.[1] ?? 1), SVL = 2.6 * SIZE, SC = 1;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(DIR + man.file), node = doc.getRoot().listNodes().find((n) => n.getMesh()), prim = node.getMesh().listPrimitives()[0], Mw = node.getWorldMatrix();
const get = (name) => { const a = prim.getAttribute(name), n = a.getCount(), c = a.getElementSize(), o = new Float32Array(n * c), e = []; for (let i = 0; i < n; i++) { a.getElement(i, e); for (let k = 0; k < c; k++) o[i * c + k] = e[k]; } return o; };
const P0 = get('POSITION'), SK = get('_SKIN'), SX = get('_SKINX'), n = P0.length / 3;
for (let i = 0; i < n; i++) { const x = P0[i * 3], y = P0[i * 3 + 1], z = P0[i * 3 + 2]; for (let r = 0; r < 3; r++) P0[i * 3 + r] = (Mw[r] * x + Mw[4 + r] * y + Mw[8 + r] * z + Mw[12 + r]) * 100; }
const bones = (i) => [[SK[i * 4] * 32, SK[i * 4 + 2]], [SK[i * 4 + 1] * 32, SK[i * 4 + 3]], [SX[i * 4] * 32, SX[i * 4 + 2]], [SX[i * 4 + 1] * 32, SX[i * 4 + 3]]].map(([b, w]) => [Math.round(b), w]);
const rig = skeletonRig(man.skeleton, {}), out = new Float32Array(ROW_FLOATS);
const bonePt = (b, p) => { const m = b * 12; return [out[m] * p[0] + out[m + 1] * p[1] + out[m + 2] * p[2] + out[m + 3], out[m + 4] * p[0] + out[m + 5] * p[1] + out[m + 6] * p[2] + out[m + 7], out[m + 8] * p[0] + out[m + 9] * p[1] + out[m + 10] * p[2] + out[m + 11]]; };
const skin = (i, o) => { let x = 0, y = 0, z = 0; for (const [b, w] of bones(i)) { if (w <= 1e-6) continue; const q = bonePt(b, [P0[i * 3], P0[i * 3 + 1], P0[i * 3 + 2]]); x += w * q[0]; y += w * q[1]; z += w * q[2]; } o[0] = x; o[1] = y; o[2] = z; return o; };

// the instance transform the game draws the sitting body with: world = pos + qy (Rx(rest.pitch) (p sc) + off sc)
const root = lungeRoot(SIT, 0, 0, 0, {}), cr = Math.cos(root.pitch), sr = Math.sin(root.pitch);
const qyaw = (a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
const rot = (q, v) => { const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]); return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)]; };
const conj = (q) => [-q[0], -q[1], -q[2], q[3]];
const toWorld = (pos, q, p) => { const m = [p[0] * SC, cr * p[1] * SC - sr * p[2] * SC + root.off[1] * SC, sr * p[1] * SC + cr * p[2] * SC + root.off[2] * SC]; m[0] += root.off[0] * SC; const r = rot(q, m); return [pos[0] + r[0], pos[1] + r[1], pos[2] + r[2]]; };
const toModel = (pos, q, w) => { const v = rot(conj(q), [w[0] - pos[0], w[1] - pos[1], w[2] - pos[2]]); const u = [v[0] / SC - root.off[0], v[1] / SC - root.off[1], v[2] / SC - root.off[2]]; return [u[0], cr * u[1] + sr * u[2], -sr * u[1] + cr * u[2]]; };
const dirModel = (q, d) => { const v = rot(conj(q), d); return [v[0], cr * v[1] + sr * v[2], -sr * v[1] + cr * v[2]]; };

const homes = stanceFeet(rig, SIT), limbOf = (key) => rig.limbs.find((l) => (l.hind ? 'h' : 'f') + l.side === key);
function run(name) {
  const S = stepperNew(homes), st = {}, dt = 1 / 60, N = Math.round(SECS / dt);
  let pos = [0, 0, 0], yaw = 0, steps = 0, swingMax = 0, tipErr = 0, slide = 0, lowest = 1e9, popMax = 0, activeFrames = 0, prevSkin = null, prevPos = null, slideAt = '', conflict = 0, lowAt = '';
  const planted = {}, errBy = {};
  for (let f = 0; f < N; f++) {
    const t = f * dt;
    if (name === 'turn') yaw += RATE * dt;
    else if (name === 'walk') { pos = [pos[0] + Math.sin(yaw) * SPEED * dt, 0, pos[2] + Math.cos(yaw) * SPEED * dt]; }
    else if (name === 'arc') { yaw += (RATE * 0.4) * dt; pos = [pos[0] + Math.sin(yaw) * SPEED * dt, 0, pos[2] + Math.cos(yaw) * SPEED * dt]; }
    const q = qyaw(yaw), active = stepperStep(S, { pos, q, sc: SC }, dt, STEP, SVL);
    const ls = lungePose(SIT, 0, 0, 0, HIND, FORE, st);
    if (active) { activeFrames++; ls.feetSit = SIT; { const nW = dirModel(q, [0, 1, 0]); ls.feetUp = { n: nW, c: rot(q, [root.off[0] * SC, root.off[1] * SC, root.off[2] * SC])[1], sc: SC }; } ls.feet = {}; for (const ft of S.feet) ls.feet[ft.key] = { T: toModel(pos, q, ft.W), D: dirModel(q, ft.D) }; } else ls.feet = null;
    poseStroke(rig, ls, out);
    // feet: where the solved tips are against where they should be, and the planted ones' slide
    let air = 0; const keys = []; for (const ft of S.feet) { if (ft.to) { air++; keys.push(ft.key); } }
    swingMax = Math.max(swingMax, air);
    // (two feet of a girdle or of a side in the air together)
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) if (keys[i][0] === keys[j][0] || keys[i].slice(1) === keys[j].slice(1)) conflict++;
    if (active) for (const ft of S.feet) {
      const lm = limbOf(ft.key), b = lm.bones[lm.bones.length - 1], tip = toWorld(pos, q, bonePt(b, rig.tail[b])), e = Math.hypot(tip[0] - ft.W[0], tip[1] - ft.W[1], tip[2] - ft.W[2]);
      tipErr = Math.max(tipErr, e); if (e > (errBy[ft.key]?.e ?? 0)) errBy[ft.key] = { e: +e.toFixed(3), t: +t.toFixed(2), u: +ft.u.toFixed(2) };
      if (!ft.to) { const pk = planted[ft.key]; if (pk && Math.abs(pk[3] - ft.W[0]) < 1e-9 && Math.abs(pk[4] - ft.W[2]) < 1e-9) { const d = Math.hypot(tip[0] - pk[0], tip[2] - pk[2]); if (d > slide) { slide = d; slideAt = `${ft.key} t ${t.toFixed(2)}`; } } else planted[ft.key] = [tip[0], tip[1], tip[2], ft.W[0], ft.W[2]]; }
      else planted[ft.key] = null;
    }
    if (f % STRIDE === 0) {
      let low = 1e9, lowI = -1; const cur = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { const m = skin(i, [0, 0, 0]), w = toWorld(pos, q, m); cur[i * 3] = w[0]; cur[i * 3 + 1] = w[1]; cur[i * 3 + 2] = w[2]; if (w[1] < low) { low = w[1]; lowI = i; } }
      if (low < lowest) { lowest = low; lowAt = `${rig.B[bones(lowI).reduce((m, x) => (x[1] > m[1] ? x : m), [0, -1])[0]]?.name} t ${t.toFixed(2)}`; }
      if (prevSkin) { // the biggest move of a skin point beyond what the body's own motion explains: the points' median move is the body's
        const d = new Float32Array(n); for (let i = 0; i < n; i++) d[i] = Math.hypot(cur[i * 3] - prevSkin[i * 3], cur[i * 3 + 1] - prevSkin[i * 3 + 1], cur[i * 3 + 2] - prevSkin[i * 3 + 2]);
        const s = Array.from(d).sort((a, b) => a - b), med = s[s.length >> 1]; popMax = Math.max(popMax, s[s.length - 1] - med - 0.001 * STRIDE * 60 * 0 - 0.3); }
      prevSkin = cur;
    }
    for (const ft of S.feet) if (ft.to && ft.u === 0) steps++;
  }
  return { run: name, frames: N, activeFrames, steps, maxInAir: swingMax, conflicts: conflict, tipErrCm: +tipErr.toFixed(3), plantedSlideCm: +slide.toFixed(4), slideAt, errBy, lowestCm: +lowest.toFixed(3), lowAt, popCm: +Math.max(0, popMax).toFixed(3) };
}
// the stance's own lowest skin, for the floor
let stanceLow = 1e9; { const ls = lungePose(SIT, 0, 0, 0, HIND, FORE, {}); poseStroke(rig, ls, out); for (let i = 0; i < n; i++) stanceLow = Math.min(stanceLow, toWorld([0, 0, 0], qyaw(0), skin(i, [0, 0, 0]))[1]); }
const runs = (RUN === 'all' ? ['turn', 'walk', 'arc'] : [RUN]).map(run);
if (JSONOUT) console.log(JSON.stringify({ id, stanceLow: +stanceLow.toFixed(3), runs }));
else { console.log(`${id}: svl ${SVL.toFixed(2)} cm, the stance's lowest skin ${stanceLow.toFixed(3)} cm`); for (const r of runs) console.log(JSON.stringify(r)); }
