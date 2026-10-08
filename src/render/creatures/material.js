// One physically based material for a whole species. Which shading a vertex
// gets is chosen by its `mat` attribute (kit.js M.*), so a single instanced
// mesh can have glossy black eyes, translucent fins, an iridescent stripe and
// wet skin at once:
//
//   SKIN        matte-to-satin skin with micro-relief (grain) and fine colour variation
//   EYE         wet, black, very glossy: catches the lamp as a small bright glint
//   FIN         thin membrane: see-through (alpha-blended in a second pass), lit from behind, flutters
//   IRIDESCENT  thin-film interference: hue shifts with the angle you look from
//   CHITIN      hard, glossy shell with a clear coat
//   GLOSS       very wet mucous skin: strong clear coat, low roughness
//   KERATIN     claws and horn: matte and pale
//   TRANSLUCENT glassy see-through shell (shrimp, larvae): alpha-blended, faint glow
//
// Translucent parts are drawn by a second material (creatureMaterial(..., { pass: 'blend' })) on a second
// mesh sharing the geometry: the 'opaque' pass discards the fin/glass fragments and writes depth, the 'blend'
// pass draws only those with real alpha blending and no depth write. Pass 'all' is the old single hashed pass.
//
// Underwater tint, caustics and dark-room lighting come from wet() (shaders.js).

import * as THREE from 'three/webgpu';
import {
  Fn, attribute, positionLocal, normalLocal, vec2, vec3, float, bool, sin, sqrt, mix, select, abs, max, normalize, dot, transformNormalToView,
  cross, time, cameraPosition, positionWorld, pow, smoothstep, texture, uv, length, floor, varying, fwidth,
  dFdx, dFdy, positionView, inverseSqrt,
} from 'three/tsl';
import { noise3 } from '../noise3.js';
import { wet, waterAt } from '../shaders.js';
import { U } from '../uniforms.js';
import { LIFT_MAX } from '../../util/gait.js';

const qrot = (q, v) => v.add(cross(q.xyz, cross(q.xyz, v).add(v.mul(q.w))).mul(2));
const is = (id, n) => abs(id.sub(n)).lessThan(0.5);

// The second per-instance vector of the head-steering species (finish.rig2) is (head yaw, head pitch, A, B), where the animation
// packs several small numbers into the floats A and B (WebGPU allows only 8 vertex buffers a pipeline, so there is no room for
// another attribute): A = bend + 1024 * tail, each 0 … 1022 over -1 … 1 and -0.5 … 0.5 (so 0 is exact);
// B = tailLength * 63 + 64 * (dullness * 63 + 64 * (tailPiece * 127 + 128 * lift)). `rig2Pack` (util/gait.js, CPU) and `rig2Unpack` (a node
// graph) are inverses.
export const rig2Unpack = (a2) => {
  const tq = floor(a2.z.div(1024)), bq = a2.z.sub(tq.mul(1024));
  const hq = floor(a2.w.div(4096)), r = a2.w.sub(hq.mul(4096)), dq = floor(r.div(64)), fq = r.sub(dq.mul(64));
  const lq = floor(hq.div(128)), pq = hq.sub(lq.mul(128));
  return { bend: bq.div(1022).mul(2).sub(1), tail: tq.div(1022).sub(0.5), tailF: fq.div(63), dull: dq.div(63), piece: pq.div(127), lift: lq.div(30).mul(2 * LIFT_MAX).sub(LIFT_MAX) };
};

// Default finish per species group; def.finish overrides any of it.
//   grain      frequency of the fine skin noise (per cm); bump its normal strength; tone the colour speckle
//   grainAmt   0…1 multiplier on the fine pebbling and speckle (default 1); 0 skips the noise completely
//   eyes       analytic eyes drawn in the fragment shader (see analyticEyes); replaces the M.EYE id for the species
//   moist      amphibian skin (read from the species' own finish, which starts from FINISH[group]): a thin mucus film over finely
//              granular skin. The film (the clear coat) follows the granules (coatBump: its share of the grain's slope), so its
//              highlight breaks into small wet glints; it fades toward the silhouette, where the granules hide it; and thin parts
//              (toe discs, the throat) let a little warm light through (sss). Real frog skin is satin, not lacquer.
export const FINISH = {
  fish: { rough: 0.5, coat: 0.12, coatRough: 0.4, grain: 10, bump: 0.03, tone: 0.05, flutter: 0.05, sheen: 0 },
  amphibian: { rough: 0.5, coat: 0.35, coatRough: 0.3, grain: 8, bump: 0.05, tone: 0.06, flutter: 0.03, sheen: 0, moist: 1, coatBump: 0.01, sss: 0.3 },
  reptile: { rough: 0.55, coat: 0.15, coatRough: 0.4, grain: 14, bump: 0.12, tone: 0.07, flutter: 0, sheen: 0 },
  invert: { rough: 0.4, coat: 0.45, coatRough: 0.22, grain: 12, bump: 0.05, tone: 0.05, flutter: 0, sheen: 0 },
};

// Eyes drawn per fragment from the eyeball's geometry, so the pupil edge is exact whatever the mesh
// resolution. Each eye: { c: [x, y, z] ball centre, r radius, axis (unit, looking direction),
// h, w (unit tangents: horizontal and up-ish), pupil: [a, b] half sizes in units of r, shape: 'oval' | 'tri',
// inner, outer (linear iris colours near the pupil and near the rim), rim (pupil colour, near black), limb (colour of the
// ring at the cap's edge, default rim), shape: 'oval' | 'tri' | 'slit' (vertical lens, gecko), cap: sine of the visible
// cap angle (0.84), mirror: also draw at -x (default true), lid: a closed lid over it ({ col, vein, amount }, a sleeping model) }.
// Positions are in the mesh's own frame.
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
    } else if (e.shape === 'slit') {                                                  // vertical lens slit, pointed at both ends (geckos, cats)
      q = max(abs(y), abs(x).div(max(float(1).sub(y.mul(y)), 0.05)));
    } else q = sqrt(x.mul(x).add(y.mul(y)));
    const pup = float(1).sub(smoothstep(0.86, 1.08, q));
    const dir = vec2(u, v).div(max(length(vec2(u, v)), 1e-4));                       // fine radial streaks in the iris
    const streak = noise3(vec3(dir.x.mul(6), dir.y.mul(6), t.mul(2.5).add(e.seed ?? 3))).mul(0.22).add(1);
    const rim = vec3(...(e.rim ?? [0.006, 0.006, 0.008]));
    const limb = e.limb ? vec3(...e.limb) : rim;                                     // colour of the limbal ring at the edge of the cap
    let iris = mix(vec3(...e.inner), vec3(...e.outer), smoothstep(0.3, 0.9, t)).mul(streak);
    iris = mix(iris, limb, smoothstep(0.7, 0.98, t));
    let ec = mix(iris, rim, pup);
    if (e.lid) {
      // A closed lid drawn over the eye (a model of the animal asleep): `lid` { col, vein (linear), amount 0 … 1 }. The red-eyed
      // tree frog's lower lid is a translucent membrane netted with fine gold lines, the iris showing faintly through it.
      const L = e.lid, n = noise3(vec3(u.div(e.r).mul(7), v.div(e.r).mul(7), float((e.seed ?? 3) + 11)));
      const net = float(1).sub(smoothstep(0.03, 0.08, abs(n)));
      ec = mix(ec, mix(vec3(...L.col), vec3(...(L.vein ?? L.col)), net), L.amount ?? 0.85);
    }
    col = mix(col, ec, mask);
    k = max(k, mask);
    spots.push(mask);
  }
  const glint = (nWorld, toEye) => {
    const nd = dot(nWorld, normalize(toEye.add(normalize(vec3(0.06, 1, 0.28)))));
    return spots.reduce((g, m) => max(g, smoothstep(0.984, 0.997, nd).mul(m)), float(0));
  };
  return { k, col, glint };
}

// A baked tangent-space normal map (skin relief: tubercles, warts) applied in VIEW space around a given shading normal `nv`.
// The creature shader builds its own shading normal (the skinned, instance-turned one), and a creature has no tangent attribute (the 8
// vertex buffers are full), so three's built-in normal map cannot be used (it is ignored once normalNode is set). The frame is three's own
// derivative frame (accessors/TangentUtils.js, "normal mapping without precomputed tangents") built around OUR normal. The maps are baked
// in Blender (OpenGL, +green = +V of Blender's UV, which glTF stores flipped), and three's GLTFLoader flips the green channel for meshes
// without tangents (GLTFLoader.js: normalScale.y *= -1, mrdoob/three.js#11438), hence NORMALMAP_GREEN = -1.
const NORMALMAP_GREEN = -1;
function normalMapper(normalMap, strength = 1) {
  const st = uv();
  const q0 = dFdx(positionView), q1 = dFdy(positionView), st0 = dFdx(st), st1 = dFdy(st);
  const mapN = texture(normalMap, st).xyz.mul(2).sub(1);          // one sample, shared by the skin normal and the coat normal
  return (nv) => {
    const q1perp = cross(q1, nv), q0perp = cross(nv, q0);
    const T = q1perp.mul(st0.x).add(q0perp.mul(st1.x)), B = q1perp.mul(st0.y).add(q0perp.mul(st1.y));
    const det = max(dot(T, T), dot(B, B));
    const sc = det.equal(0).select(float(0), inverseSqrt(det));
    return normalize(T.mul(sc).mul(mapN.x.mul(strength)).add(B.mul(sc).mul(mapN.y.mul(strength * NORMALMAP_GREEN))).add(nv.mul(mapN.z)));
  };
}

// `nrm`: the vertex normal to shade with (a skinned mesh passes its posed normal as a varying); the attribute otherwise.
// A body with a `normalMap` also returns `nmap(nv)`: the caller (instanced.js) runs its final view-space normals through it. A body without one
// is shaded exactly as before.
export function creatureMaterial(finish = {}, { map = null, normalMap = null, roughnessMap = null, pass = 'all', nrm: nrmIn = null } = {}) {
  const f = { ...FINISH.amphibian, ...finish };
  const moist = !!finish.moist;                    // (not f.moist: f falls back on the amphibian defaults whatever the group)
  const m = new THREE.MeshPhysicalNodeMaterial({ roughness: f.rough, metalness: 0.0, side: f.doubleSided ? THREE.DoubleSide : THREE.FrontSide });
  const id = attribute('rig', 'vec4').w;
  // Procedural bodies paint per-vertex colour; scanned or generated models bring a texture.
  let base = map ? texture(map, uv()).rgb : attribute('color', 'vec3');
  // A palette model (a dwarf shrimp: one texture for every colour line): the texture is a mask, R pigment density, G shading,
  // B how far toward the deeper back colour; `finish.palette` colours it (base, deep, glass as linear colours, `clear` thinning the
  // pigment for a glassier line, `rili` clearing a band across the middle of the body between riliZ[0] and riliZ[1] (cm, front and
  // back)); the eggs (rig leg id 14) are yellow.
  if (map && f.palette) {
    const P = f.palette, t = texture(map, uv());
    let pig = t.r;
    if (P.clear) pig = pig.sub(P.clear * 0.5).div(1 - P.clear * 0.5).clamp(0, 1);
    if (P.rili && P.riliZ) {
      const z = attribute('position', 'vec3').z, [z0, z1] = P.riliZ;
      pig = pig.mul(float(1).sub(smoothstep(z1 - 0.12, z1 + 0.06, z).mul(float(1).sub(smoothstep(z0 - 0.06, z0 + 0.12, z))).mul(0.94)));
    }
    base = mix(vec3(...P.glass), mix(vec3(...P.base), vec3(...P.deep), t.b), pig).mul(t.g);
    if (P.egg) base = select(abs(attribute('rig', 'vec4').y.sub(14)).lessThan(0.5), vec3(...P.egg).mul(t.g.mul(0.5).add(0.5)), base);
  }
  // Before a shed the skin goes dull and milky (finish.rig2 species; decoded in the vertex stage and passed on as a varying, because a
  // large packed float does not survive interpolation exactly).
  if (f.rig2) {
    const dull = varying(rig2Unpack(attribute('iAnim2', 'vec4')).dull);
    const grey = dot(base, vec3(0.3, 0.55, 0.15));
    base = mix(base, vec3(grey.mul(0.55).add(0.3)), dull.mul(0.62));
  }
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
  const nrm = nrmIn ?? attribute('normal', 'vec3');
  let n = normalize(nrm), n0 = float(0), nCoat = n;
  if (ga > 0) {
    const e = 0.02;
    n0 = noise3(P.mul(g));
    const gx = noise3(P.add(vec3(e, 0, 0)).mul(g)).sub(n0);
    const gy = noise3(P.add(vec3(0, e, 0)).mul(g)).sub(n0);
    const gz = noise3(P.add(vec3(0, 0, e)).mul(g)).sub(n0);
    const grad = vec3(gx, gy, gz).div(e);
    const bumpAmt = select(eye, float(0), select(fin, float(f.bump * 0.3), select(chitin, float(f.bump * 0.5), float(f.bump)))).mul(ga).mul(eyeOff);
    const slope = grad.sub(nrm.mul(dot(grad, nrm)));
    n = normalize(nrm.sub(slope.mul(bumpAmt.mul(0.018))));
    // The mucus film lies on the granules, so it tilts with them much more than the diffuse skin does (that grain is kept faint
    // so the painted pattern stays clean): the coat's highlight breaks up into small wet glints instead of one mirror streak.
    if (moist) nCoat = normalize(nrm.sub(slope.mul(select(eye, float(0), float(f.coatBump ?? 0.01)).mul(eyeOff))));
  }

  // Fine colour variation, stronger on skin than on eyes.
  const vary = n0.mul(0.5 * ga).add(noise3(P.mul(g.mul(0.23)).add(11)).mul(0.5));
  const tone = float(1).add(vary.mul(select(eye, float(0), float(f.tone ?? 0.06))).mul(eyeOff));
  let color = base.mul(tone);
  // Iridescent film: shift hue with the viewing angle (a cosine palette on n·v).
  const nW = normalize(qrot(attribute('iRot', 'vec4'), n));
  const ndv = abs(dot(nW, toEye));
  const film = vec3(sin(ndv.mul(9).add(0.0)), sin(ndv.mul(9).add(2.1)), sin(ndv.mul(9).add(4.2))).mul(0.5).add(0.5);
  color = select(iri, mix(base, film.mul(base.add(0.35)), 0.55), color);
  if (A) color = mix(color, A.col, A.k);
  // Under water (tinted, the caustics on it) below the line where the drawn surface cuts the body, sharp and rising and falling
  // with the ripples; just above it the meniscus, the film of water drawn up the wet skin, catches the light as a fine bright line.
  const surf = waterAt(positionWorld), above = positionWorld.y.sub(surf);
  const edge = max(fwidth(above).mul(0.75), 0.012);
  const [wc, emissive] = wet(color, positionWorld, surf, U.creatureWater, 1, edge);
  m.colorNode = wc;
  const meniscus = smoothstep(edge.negate(), edge, above).mul(float(1).sub(smoothstep(0.02, edge.add(0.02), above)));
  // Membranes glow a little where the lamp shines through them; the film stripe fluoresces.
  let emis = emissive.add(select(fin, base.mul(0.12), select(glass, base.mul(0.1), select(iri, film.mul(0.22), vec3(0)))));
  emis = emis.add(vec3(0.05, 0.053, 0.056).mul(meniscus).mul(U.daylight.mul(0.85).add(0.15)));
  if (A) emis = emis.add(vec3(1, 1, 0.96).mul(A.glint(nW, toEye)).mul(1.6));
  const skinK = select(is(id, 0), float(1), float(0)).mul(eyeOff);              // plain skin, not the eyes
  if (moist) {
    // Thin parts pass the lamp's light through: the toe discs and webbing (the last third of a leg) and the throat (the underside
    // of the head) are lit a little from inside, warmer (blood under thin skin), most on their shaded undersides. Scaled by the
    // daylight, so nothing glows at night; a few multiplies, no extra pass.
    const R = attribute('rig', 'vec4');
    const toes = select(R.y.greaterThan(0.5).and(R.y.lessThan(4.5)), smoothstep(0.6, 0.95, R.z), float(0));
    const throat = float(1).sub(smoothstep(0.08, 0.26, R.x)).mul(smoothstep(0.2, 0.7, nrm.y.negate()));
    const thin = max(toes, throat).mul(skinK);
    const below = nW.y.negate().clamp(0, 1);
    emis = emis.add(base.mul(vec3(1, 0.6, 0.45)).mul(thin.mul(below.mul(0.6).add(0.15))).mul(U.daylight).mul(f.sss ?? 0.3));
  }
  m.emissiveNode = emis;
  let rough = select(eye, float(0.03), select(gloss, float(Math.min(f.rough, 0.22)), select(chitin, float(0.3), select(horn, float(0.8), select(iri, float(0.18), float(f.rough))))));
  let coat = select(eye, float(1), select(gloss, float(1), select(chitin, float(0.6), select(horn, float(0), float(f.coat)))));
  let coatRough = select(eye, float(0.02), float(f.coatRough));
  if (moist) {
    // Micro-shadowing: seen edge-on, the granules hide the film between them, so the coat and the skin's own sheen fade toward the
    // silhouette instead of turning into a bright mirror rim (three.js takes the coat's Fresnel to 1 at grazing angles and lays it
    // over the skin; under the LED and the room reflections that read as a glowing plastic outline).
    const graze = mix(float(1), smoothstep(0.04, 0.42, ndv), skinK);
    coat = coat.mul(graze);
    m.specularIntensityNode = graze.mul(0.6).add(0.4);
  }
  // Textured skins with a normal map: the baked colour carries "wet green vs matte black" (no third map): the darker the texel, the rougher
  // and the less coated (a black blotch is a keratin-rich, dry-looking patch). finish.matteBlack = { rough, coat } overrides the defaults.
  const mb = f.matteBlack ?? (normalMap && map ? { rough: 0.72, coat: 0 } : null);
  if (mb) {
    const blk = float(1).sub(smoothstep(0.008, 0.035, dot(base, vec3(0.2126, 0.7152, 0.0722)))).mul(skinK);
    rough = mix(rough, float(mb.rough), blk); coat = mix(coat, float(mb.coat), blk);
  }
  if (A) { rough = mix(rough, float(0.06), A.k); coat = mix(coat, float(0.8), A.k); coatRough = mix(coatRough, float(0.04), A.k); }
  m.roughnessNode = rough;
  m.metalnessNode = select(iri, float(0.25), float(0));
  m.clearcoatNode = coat;
  m.clearcoatRoughnessNode = coatRough;
  m.sheenNode = float(f.sheen);
  m.sheenRoughnessNode = float(0.5);
  // Translucent parts (fins, glass shells). One pass: hashed (stochastic) alpha. Two passes: the opaque pass
  // discards them; the blend pass draws only them, alpha blended and without depth write, so the opaque body keeps
  // writing depth and nothing sorts wrongly. Membranes are more see-through face-on and denser at the rim.
  const glassSolid = (f.glassOpacity ?? 0.55) >= 0.9;                       // an almost opaque shell (shrimp) is drawn as solid
  const trans = glassSolid ? fin : fin.or(glass);
  const rimK = float(1).sub(ndv);
  // finAlpha: the texture's alpha says how dense the membrane is (a painted guppy tail: render/creatures/guppypaint.js)
  const finOp = float(f.finOpacity ?? 0.5).mul(rimK.mul(0.5).add(0.8)).mul(f.finAlpha && map ? texture(map, uv()).a : float(1)), glassOp = float(f.glassOpacity ?? 0.55).mul(rimK.mul(0.5).add(0.8));
  // finFray (the guppy's tails, render/creatures/guppymodel.js): rig.y's fraction is how near the tail's rim a point is. The margin
  // thins and frays: the rays (dense texels) reach further than the membrane between them, so their tips stand out ragged.
  let fray = float(1);
  if (f.finFray) {
    const ry = attribute('rig', 'vec4').y;
    const e = select(ry.greaterThan(20.5), ry.fract().div(0.98), float(0)).min(1);
    const dens = map ? texture(map, uv()).a : float(0.8);
    const start = float(f.finFray.start ?? 0.8).add(dens.sub(0.6).mul(0.35)).add(noise3(positionLocal.mul(f.finFray.scale ?? 14)).sub(0.5).mul(0.08));
    fray = float(1).sub(smoothstep(start, float(1.0), e).mul(0.92));
  }
  const tOp = select(fin, finOp.mul(fray), glassOp).min(0.92);
  if (pass === 'opaque') {
    m.opacityNode = select(trans, float(0), float(1));
    m.alphaTest = 0.5;
  } else if (pass === 'blend') {
    m.opacityNode = select(trans, tOp, float(0));
    m.alphaTest = 0.02;
    m.transparent = true;
    m.depthWrite = false;
  } else if (pass === 'solid') {
    m.opacityNode = float(1);                                                     // nothing translucent in this mesh: no alpha at all
  } else {
    m.opacityNode = select(fin, float(0.5), select(glass, float(f.glassOpacity ?? 0.55), float(1)));
    m.alphaHash = true;
  }
  m.vertexColors = false;
  if (normalMap) { m.normalMap = normalMap; m.normalScale = new THREE.Vector2(1, 1); }
  if (roughnessMap) m.roughnessMap = roughnessMap;
  return { material: m, n, nCoat, is: { eye, fin, iri }, textured: !!map, nmap: normalMap ? normalMapper(normalMap, f.nmapStrength ?? 1) : null };
}

export { qrot, is };
