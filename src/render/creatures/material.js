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
  Fn, attribute, positionLocal, normalLocal, vec3, float, sin, mix, select, abs, max, mx_noise_float, normalize, dot, transformNormalToView,
  cross, time, cameraPosition, positionWorld, pow, smoothstep, texture, uv,
} from 'three/tsl';
import { wet } from '../shaders.js';

const qrot = (q, v) => v.add(cross(q.xyz, cross(q.xyz, v).add(v.mul(q.w))).mul(2));
const is = (id, n) => abs(id.sub(n)).lessThan(0.5);

// Default finish per species group; def.finish overrides any of it.
export const FINISH = {
  fish: { rough: 0.3, coat: 0.5, coatRough: 0.16, grain: 10, bump: 0.03, tone: 0.05, flutter: 0.05, sheen: 0 },
  amphibian: { rough: 0.4, coat: 0.85, coatRough: 0.1, grain: 8, bump: 0.05, tone: 0.06, flutter: 0.03, sheen: 0 },
  reptile: { rough: 0.55, coat: 0.15, coatRough: 0.4, grain: 14, bump: 0.12, tone: 0.07, flutter: 0, sheen: 0 },
  invert: { rough: 0.4, coat: 0.45, coatRough: 0.22, grain: 12, bump: 0.05, tone: 0.05, flutter: 0, sheen: 0 },
};

export function creatureMaterial(finish = {}, { map = null, normalMap = null, roughnessMap = null } = {}) {
  const f = { ...FINISH.amphibian, ...finish };
  const m = new THREE.MeshPhysicalNodeMaterial({ roughness: f.rough, metalness: 0.0, side: f.doubleSided ? THREE.DoubleSide : THREE.FrontSide });
  const id = attribute('rig', 'vec4').w;
  // Procedural bodies paint per-vertex colour; scanned or generated models bring a texture.
  const base = map ? texture(map, uv()).rgb : attribute('color', 'vec3');
  const eye = is(id, 1), fin = is(id, 2), iri = is(id, 3), chitin = is(id, 4), gloss = is(id, 5), horn = is(id, 6), glass = is(id, 7);
  const P = positionLocal;

  // Micro-relief: gradient of a fine 3D noise pushes the normal about, so skin
  // looks pebbled and scaled instead of smooth plastic.
  const g = float(f.grain);
  const e = 0.02;
  const n0 = mx_noise_float(P.mul(g));
  const gx = mx_noise_float(P.add(vec3(e, 0, 0)).mul(g)).sub(n0);
  const gy = mx_noise_float(P.add(vec3(0, e, 0)).mul(g)).sub(n0);
  const gz = mx_noise_float(P.add(vec3(0, 0, e)).mul(g)).sub(n0);
  const grad = vec3(gx, gy, gz).div(e);
  const bumpAmt = select(eye, float(0), select(fin, float(f.bump * 0.3), select(chitin, float(f.bump * 0.5), float(f.bump))));
  const n = normalize(normalLocal.sub(grad.sub(normalLocal.mul(dot(grad, normalLocal))).mul(bumpAmt.mul(0.018))));

  // Fine colour variation, stronger on skin than on eyes.
  const vary = n0.mul(0.5).add(mx_noise_float(P.mul(g.mul(0.23)).add(11)).mul(0.5));
  const tone = float(1).add(vary.mul(select(eye, float(0), float(f.tone ?? 0.06))));
  let color = base.mul(tone);
  // Iridescent film: shift hue with the viewing angle (a cosine palette on n·v).
  const toEye = normalize(cameraPosition.sub(positionWorld));
  const ndv = abs(dot(normalize(qrot(attribute('iRot', 'vec4'), n)), toEye));
  const film = vec3(sin(ndv.mul(9).add(0.0)), sin(ndv.mul(9).add(2.1)), sin(ndv.mul(9).add(4.2))).mul(0.5).add(0.5);
  color = select(iri, mix(base, film.mul(base.add(0.35)), 0.55), color);
  const [wc, emissive] = wet(color);
  m.colorNode = wc;
  // Membranes glow a little where the lamp shines through them; the film stripe fluoresces.
  m.emissiveNode = emissive.add(select(fin, base.mul(0.12), select(glass, base.mul(0.1), select(iri, film.mul(0.22), vec3(0)))));
  m.roughnessNode = select(eye, float(0.03), select(gloss, float(Math.min(f.rough, 0.22)), select(chitin, float(0.3), select(horn, float(0.8), select(iri, float(0.18), float(f.rough))))));
  m.metalnessNode = select(iri, float(0.25), float(0));
  m.clearcoatNode = select(eye, float(1), select(gloss, float(1), select(chitin, float(0.6), select(horn, float(0), float(f.coat)))));
  m.clearcoatRoughnessNode = select(eye, float(0.02), float(f.coatRough));
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
