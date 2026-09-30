// One physically based material for a whole species. Which shading a vertex
// gets is chosen by its `mat` attribute (kit.js M.*), so a single instanced
// mesh can have glossy black eyes, translucent fins, an iridescent stripe and
// wet skin at once:
//
//   SKIN        matte-to-satin skin with micro-relief (grain) and fine colour variation
//   EYE         wet, black, very glossy: catches the lamp as a small bright glint
//   FIN         thin membrane: see-through (hashed alpha), lit from behind, flutters
//   IRIDESCENT  thin-film interference: hue shifts with the angle you look from
//   CHITIN      hard, glossy shell with a clear coat
//   GLOSS       very wet mucous skin: strong clear coat, low roughness
//   KERATIN     claws and horn: matte and pale
//   TRANSLUCENT glassy see-through shell (shrimp, larvae): hashed alpha, faint glow
//
// Underwater tint, caustics and dark-room lighting come from wet() (shaders.js).

import * as THREE from 'three/webgpu';
import {
  Fn, attribute, positionLocal, normalLocal, vec2, vec3, float, bool, sin, sqrt, mix, select, abs, max, mx_noise_float, normalize, dot, transformNormalToView,
  cross, time, cameraPosition, positionWorld, pow, smoothstep, texture, uv, length,
} from 'three/tsl';
import { wet } from '../shaders.js';

const qrot = (q, v) => v.add(cross(q.xyz, cross(q.xyz, v).add(v.mul(q.w))).mul(2));
const is = (id, n) => abs(id.sub(n)).lessThan(0.5);

// Default finish per species group; def.finish overrides any of it.
//   grain      frequency of the fine skin noise (per cm); bump its normal strength; tone the colour speckle
//   grainAmt   0…1 multiplier on the fine pebbling and speckle (default 1); 0 skips the noise completely
//   eyes       analytic eyes drawn in the fragment shader (see analyticEyes); replaces the M.EYE id for the species
export const FINISH = {
  fish: { rough: 0.3, coat: 0.5, coatRough: 0.16, grain: 10, bump: 0.03, tone: 0.05, flutter: 0.05, sheen: 0 },
  amphibian: { rough: 0.5, coat: 0.35, coatRough: 0.3, grain: 8, bump: 0.05, tone: 0.06, flutter: 0.03, sheen: 0 },
  reptile: { rough: 0.55, coat: 0.15, coatRough: 0.4, grain: 14, bump: 0.12, tone: 0.07, flutter: 0, sheen: 0 },
  invert: { rough: 0.4, coat: 0.45, coatRough: 0.22, grain: 12, bump: 0.05, tone: 0.05, flutter: 0, sheen: 0 },
};

// Eyes drawn per fragment from the eyeball's geometry, so the pupil edge is exact whatever the mesh
// resolution. Each eye: { c: [x, y, z] ball centre, r radius, axis (unit, looking direction),
// h, w (unit tangents: horizontal and up-ish), pupil: [a, b] half sizes in units of r, shape: 'oval' | 'tri',
// inner, outer (linear iris colours near the pupil and near the rim), cap: sine of the visible cap
// angle (0.84), mirror: also draw at -x (default true) }. Positions are in the mesh's own frame.
// Returns the eye mask k (0…1), its colour, and glint(nWorld, toEye): a small catchlight for a lamp overhead.
function analyticEyes(eyes) {
  const P = attribute('position', 'vec3');
  let k = float(0), col = vec3(0);
  const spots = [];
  for (const e of eyes) {
    const c = vec3(...e.c), ax = vec3(...e.axis), hh = vec3(...e.h), ww = vec3(...e.w);
    const Pm = e.mirror === false ? P : vec3(abs(P.x), P.y, P.z);
    const rel = Pm.sub(c), dd = length(rel);
    const cs = dot(rel, ax).div(max(dd, 1e-4));
    const u = dot(rel, hh), v = dot(rel, ww);
    const t = sqrt(u.mul(u).add(v.mul(v))).div(e.r * (e.cap ?? 0.84));            // 0 at the pupil centre … 1 at the rim of the cap
    const mask = float(1).sub(smoothstep(0.93, 1.03, t)).mul(smoothstep(0.1, 0.3, cs)).mul(float(1).sub(smoothstep(e.r * 1.15, e.r * 1.3, dd)));
    const [pa, pb] = e.pupil ?? [0.42, 0.4];
    const x = u.div(pa * e.r), y = v.div(pb * e.r);
    let q;
    if (e.shape === 'tri') {                                                          // rounded triangle, flat on top, apex down (Bombina)
      const a = abs(x).mul(2).add(y), b = y.negate();
      q = a.add(b).add(sqrt(a.sub(b).mul(a.sub(b)).add(0.06))).mul(0.5);
    } else q = sqrt(x.mul(x).add(y.mul(y)));
    const pup = float(1).sub(smoothstep(0.86, 1.08, q));
    const dir = vec2(u, v).div(max(length(vec2(u, v)), 1e-4));                       // fine radial streaks in the iris
    const streak = mx_noise_float(vec3(dir.x.mul(6), dir.y.mul(6), t.mul(2.5).add(e.seed ?? 3))).mul(0.22).add(1);
    const rim = vec3(...(e.rim ?? [0.006, 0.006, 0.008]));
    let iris = mix(vec3(...e.inner), vec3(...e.outer), smoothstep(0.3, 0.9, t)).mul(streak);
    iris = mix(iris, rim, smoothstep(0.7, 0.98, t));
    col = mix(col, mix(iris, rim, pup), mask);
    k = max(k, mask);
    spots.push(mask);
  }
  const glint = (nWorld, toEye) => {
    const nd = dot(nWorld, normalize(toEye.add(normalize(vec3(0.06, 1, 0.28)))));
    return spots.reduce((g, m) => max(g, smoothstep(0.984, 0.997, nd).mul(m)), float(0));
  };
  return { k, col, glint };
}

export function creatureMaterial(finish = {}, { map = null, normalMap = null, roughnessMap = null } = {}) {
  const f = { ...FINISH.amphibian, ...finish };
  const m = new THREE.MeshPhysicalNodeMaterial({ roughness: f.rough, metalness: 0.0, side: f.doubleSided ? THREE.DoubleSide : THREE.FrontSide });
  const id = attribute('rig', 'vec4').w;
  // Procedural bodies paint per-vertex colour; scanned or generated models bring a texture.
  const base = map ? texture(map, uv()).rgb : attribute('color', 'vec3');
  // Species with analytic eyes (finish.eyes) never use the eye id: material ids are interpolated across a
  // triangle, so a skin (0) to fin (2) seam would otherwise pass through the eye material (1) as a dark line.
  const eye = f.eyes ? bool(false) : is(id, 1), fin = is(id, 2), iri = is(id, 3), chitin = is(id, 4), gloss = is(id, 5), horn = is(id, 6), glass = is(id, 7);
  const P = positionLocal;
  const toEye = normalize(cameraPosition.sub(positionWorld));

  const A = f.eyes && f.eyes.length ? analyticEyes(f.eyes) : null;
  const eyeOff = A ? float(1).sub(A.k.mul(0.98)) : float(1);      // (exactly 0 turns the shading black on some GPUs)

  // Micro-relief: gradient of a fine 3D noise pushes the normal about, so skin
  // looks pebbled and scaled instead of smooth plastic. finish.grainAmt (default 1) scales it
  // and the fine colour speckle; 0 skips the noise entirely.
  const g = float(f.grain);
  const ga = f.grainAmt ?? 1;
  // (The vertex normal is read as a plain attribute: the shared `normalLocal` variable is a vertex-stage var and reads as
  // zero in the fragment stage, which turned the shading normal into the noise gradient alone.)
  const nrm = attribute('normal', 'vec3');
  let n = normalize(nrm), n0 = float(0);
  if (ga > 0) {
    const e = 0.02;
    n0 = mx_noise_float(P.mul(g));
    const gx = mx_noise_float(P.add(vec3(e, 0, 0)).mul(g)).sub(n0);
    const gy = mx_noise_float(P.add(vec3(0, e, 0)).mul(g)).sub(n0);
    const gz = mx_noise_float(P.add(vec3(0, 0, e)).mul(g)).sub(n0);
    const grad = vec3(gx, gy, gz).div(e);
    const bumpAmt = select(eye, float(0), select(fin, float(f.bump * 0.3), select(chitin, float(f.bump * 0.5), float(f.bump)))).mul(ga).mul(eyeOff);
    n = normalize(nrm.sub(grad.sub(nrm.mul(dot(grad, nrm))).mul(bumpAmt.mul(0.018))));
  }

  // Fine colour variation, stronger on skin than on eyes.
  const vary = n0.mul(0.5 * ga).add(mx_noise_float(P.mul(g.mul(0.23)).add(11)).mul(0.5));
  const tone = float(1).add(vary.mul(select(eye, float(0), float(f.tone ?? 0.06))).mul(eyeOff));
  let color = base.mul(tone);
  // Iridescent film: shift hue with the viewing angle (a cosine palette on n·v).
  const nW = normalize(qrot(attribute('iRot', 'vec4'), n));
  const ndv = abs(dot(nW, toEye));
  const film = vec3(sin(ndv.mul(9).add(0.0)), sin(ndv.mul(9).add(2.1)), sin(ndv.mul(9).add(4.2))).mul(0.5).add(0.5);
  color = select(iri, mix(base, film.mul(base.add(0.35)), 0.55), color);
  if (A) color = mix(color, A.col, A.k);
  const [wc, emissive] = wet(color);
  m.colorNode = wc;
  // Membranes glow a little where the lamp shines through them; the film stripe fluoresces.
  let emis = emissive.add(select(fin, base.mul(0.12), select(glass, base.mul(0.1), select(iri, film.mul(0.22), vec3(0)))));
  if (A) emis = emis.add(vec3(1, 1, 0.96).mul(A.glint(nW, toEye)).mul(1.6));
  m.emissiveNode = emis;
  let rough = select(eye, float(0.03), select(gloss, float(Math.min(f.rough, 0.22)), select(chitin, float(0.3), select(horn, float(0.8), select(iri, float(0.18), float(f.rough))))));
  let coat = select(eye, float(1), select(gloss, float(1), select(chitin, float(0.6), select(horn, float(0), float(f.coat)))));
  let coatRough = select(eye, float(0.02), float(f.coatRough));
  if (A) { rough = mix(rough, float(0.06), A.k); coat = mix(coat, float(0.8), A.k); coatRough = mix(coatRough, float(0.04), A.k); }
  m.roughnessNode = rough;
  m.metalnessNode = select(iri, float(0.25), float(0));
  m.clearcoatNode = coat;
  m.clearcoatRoughnessNode = coatRough;
  m.sheenNode = float(f.sheen);
  m.sheenRoughnessNode = float(0.5);
  // Fins: hashed (stochastic) transparency keeps depth writing and sorting simple.
  // A view-dependent see-through: more transparent face-on, denser at the rim (shrimp shells, fins).
  m.opacityNode = select(fin, float(0.5), select(glass, float(f.glassOpacity ?? 0.55), float(1)));
  m.alphaHash = true;
  m.vertexColors = false;
  if (normalMap) { m.normalMap = normalMap; m.normalScale = new THREE.Vector2(1, 1); }
  if (roughnessMap) m.roughnessMap = roughnessMap;
  return { material: m, n, is: { eye, fin, iri }, textured: !!map };
}

export { qrot, is };
