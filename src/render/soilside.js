// The soil profile seen through the front and side glass: what a keeper sees of the build below the surface. From the
// bottom up: the drainage (none, a layer of LECA clay balls, or a false bottom: the white egg-crate grid on PVC legs, bio-rings in
// the plenum's water), the fibreglass mesh over it, then the substrate (content/equipment.js SUBSTRATES: topsoil, ABG mix,
// coco coir, coir under sphagnum) with its leaf litter on top. Where the plenum's water is over the mesh the soil above it
// shows dark and soaked (mud). The plenum's water stands at its own simulated level (sim/plenum.js E.plenumLevel): it fills
// from the soil, the pump in the tower draws it down, and it is open to the pool through a screen.
//
// One mesh of vertical strips just inside the glass, from the floor to the ground (the sculpted base, not the rocks on it),
// rebuilt when the ground changes; one material whose layers are all drawn from uniforms in the fragment, so changing the
// build or the substrate costs no rebuild and no shader compile. The patterns are cheap hashes (no noise per fragment) over
// one read of the soil photo, and each fragment works out only its own zone and the chosen substrate (branches on uniforms).

import * as THREE from 'three/webgpu';
import { Fn, If, uniform, attribute, positionWorld, positionLocal, texture, vec2, vec3, float, fract, floor, sin, dot, mix, smoothstep, step, length, abs, max, min, clamp, time, sign, exp, pow, normalize, refract, cameraPosition } from 'three/tsl';
import { noise3 } from './noise3.js';
import { TANK } from '../sim/tank.js';
import { U } from './uniforms.js';
import { TEX } from './assets.js';
import { SUBSTRATE_ORDER } from '../content/equipment.js';
import { belowGround, groundGrid, BODY_SINK } from '../sim/plenum.js';

const STEP = 0.75;       // cm between columns
const INSET = 0.04;      // cm inside the glass

const hash = (p) => fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453));

export class SoilSide {
  constructor(parent, world) {
    this.world = world;
    this.u = { L: uniform(0), mode: uniform(0), water: uniform(0), sub: uniform(0), wet: uniform(0.5), mud: uniform(0), pool: uniform(0),
      flow: uniform(0), stir: uniform(0), tower: uniform(new THREE.Vector2(1e4, 1e4)), level: uniform(0), minG: uniform(0) };
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material());
    this.mesh.name = 'soil-profile';
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    parent.add(this.mesh);
    this.body = this.makeBody(parent);
    this.layer = 'surface';             // render/layers.js: the body shows in 'xray' and 'bottom'
    this.sig = ''; this.t = 1e9;
  }

  material() {
    const { L: Ltrue, mode, water: wTrue, sub, wet, mud, pool, flow, stir, tower } = this.u;
    const pw = positionWorld, top0 = attribute('top', 'float');
    // A cut-away: generated tanks slope the ground down to a few centimetres at the front glass, so the drainage is drawn at
    // most about half as deep as the ground there (its true depth where there is room). The water in it is drawn at the same
    // share of that depth as it really fills; over the mesh, at its true height over the mesh.
    const drawnL = (t) => min(Ltrue, t.mul(0.55));
    const drawnWater = (Ld) => wTrue.lessThan(Ltrue).select(wTrue.mul(Ld).div(max(Ltrue, 0.01)), Ld.add(wTrue.sub(Ltrue)));
    // The water part of the tank has no drainage under it (the ground there is lower than the layer); a false bottom lies
    // under the land only (the pool is walled off from it, open through a screen).
    const drainOn = (t) => step(0.5, mode).mul(step(1.6, t)).mul(max(step(mode, 1.5), step(pool.add(0.3), t)));
    // (Everything the branches below share is made a variable at the top of the function, before the first branch: a
    // variable first used inside one branch is not set in the others.)
    let y, a, top, L, water, under, inDrain, meshBand;
    // Particles: in each cell of a grid (cells per cm `k`, stretched by `sx`, `sy`) a jittered blob of random size, round or
    // (`ang` 1) angular like a broken chunk; about a third of the cells left empty (`fill`), so no rows show.
    // Returns [mask 0 … 1, the cell's random number, distance from its centre over its radius].
    const blob = (k, sx, sy, rMin, rMax, seed, ang = 0, fill = 0.32, jit = 0.6) => {
      const q = vec2(a.mul(k * sx), y.mul(k * sy)), c = floor(q), h = hash(c.add(seed));
      const f = fract(q).sub(0.5).add(vec2(hash(c.add(seed + 1.7)), hash(c.add(seed + 3.1))).sub(0.5).mul(jit));
      const r = h.mul(rMax - rMin).add(rMin);
      const d = ang ? mix(length(f), abs(f.x).add(abs(f.y)).mul(0.8), h.mul(0.6).add(0.3)) : length(f);
      return [smoothstep(r, r.sub(0.06), d).mul(step(fill, hash(c.add(seed + 5.3)))), h, d.div(r)];
    };

    // A caustic net at p (vec2, cm), moving: the bright lines where two slowly changing baked-noise fields cross zero (two reads
    // of render/noise3.js, no noise computed per fragment). Light that comes in through the front glass and is focused by the
    // rippled water under the substrate draws it on what lies under that water.
    const caus = (p) => {
      const n1 = noise3(vec3(p.x.mul(0.95), p.y.mul(0.95), time.mul(0.55))), n2 = noise3(vec3(p.x.mul(1.9).add(3.1), p.y.mul(1.9), time.mul(0.8).add(5)));
      return pow(clamp(float(1).sub(abs(n1).mul(3.2)), 0, 1), 3).add(pow(clamp(float(1).sub(abs(n2).mul(3.2)), 0, 1), 3).mul(0.6));
    };

    const col = Fn(() => {
      y = pw.y.toVar(); a = pw.x.add(pw.z).toVar(); top = top0.toVar();
      L = drawnL(top).toVar(); water = drawnWater(L).toVar(); under = step(y, water).toVar();
      const on = drainOn(top);
      inDrain = on.mul(step(y, L)).toVar();
      meshBand = on.mul(step(L, y)).mul(step(y, L.add(0.2))).toVar();
      const out = vec3(0).toVar();
      If(inDrain.greaterThan(0.5), () => {
        If(mode.lessThan(1.5), () => {
          // --- LECA: clay pebbles of every size from 8 to 16 mm, packed at random, dark gaps, water in the bottom ----------
          // (The pebbles' rough, porous skin: the soil photo's grain.)
          const grit = texture(TEX.ground[0], vec2(a, y).mul(1 / 6)).g.mul(6).add(0.4);
          const [b1, h1, d1] = blob(0.85, 1, 1, 0.37, 0.45, 71, 0, 0.05, 0.12), [b2, h2, d2] = blob(1.4, 1, 1, 0.36, 0.44, 77, 0, 0.05, 0.12);
          const shade = (d, h) => vec3(0.36, 0.16, 0.07).mul(h.mul(0.45).add(0.7)).mul(float(1).sub(d.mul(d).mul(0.7))).mul(grit);
          const c1 = mix(vec3(0.05, 0.03, 0.018).mul(grit), shade(d2, h2).mul(0.7), b2);   // the smaller ones further back
          out.assign(mix(c1, shade(d1, h1), b1));
          out.assign(mix(out, out.mul(vec3(0.5, 0.42, 0.3)).add(vec3(0.02, 0.016, 0.008)), under));
          // Under the water table, a faint caustic net on the pebbles' faces at the glass, fading a few cm down.
          const lit = caus(vec2(a, y.mul(1.6))).mul(under).mul(step(0.05, water)).mul(exp(water.sub(y).mul(-0.35))).mul(max(b1, b2.mul(0.6)));
          out.addAssign(vec3(0.3, 0.27, 0.19).mul(lit).mul(U.daylight.mul(0.8).add(0.2)));
        }).Else(() => {
          // --- False bottom, seen through the glass: the plenum behind it as a room, by interior mapping (as three's TSL
          // SkyscraperGenerator.interior(): the view ray is followed into a box behind the flat strip, no geometry added).
          // Under the plenum's water line the ray bends into the water at the glass (index 1.333); over it, it crosses the
          // air between the water and the crate. It meets the first of: the tank's floor (mulm on the glass bottom, with the
          // caustic net that light coming in through the front glass makes after the rippled surface focuses it), the
          // water's surface (from above: the crate's underside mirrored by Fresnel and the floor seen through it; from below:
          // a silver mirror, total internal reflection), the white egg-crate's underside overhead, two rows of PVC legs and
          // the dark back of the plenum. Light comes in through the glass, so it fades with depth; the water takes it on
          // the way, tea-coloured by the soil's tannins (exp of the path in the water). Then on the glass itself: a single
          // layer of bio-rings at the bottom, specks carried along by the pump's draw, the meniscus.
          const ct = min(float(1), L.mul(0.3)), crateY = L.sub(ct);
          // The water is live: it runs along the glass toward the pump tower (sim/plenum.js pump flow over the plenum's cross
          // section, `flow` cm/s), carrying specks of tannin and soil; its surface ripples, more where rain drips in (`stir`)
          // and around the tower, where the pump draws it down. Two sines and one hash per fragment, false-bottom zone only.
          const nrm = attribute('normal', 'vec3'), rel = tower.sub(vec2(pw.x, pw.z)), dT = length(rel);
          const dir = sign(rel.x.mul(abs(nrm.z)).add(rel.y.mul(abs(nrm.x))));
          const near = smoothstep(22, 2, dT);
          const amp = stir.mul(0.12).add(0.05).add(near.mul(flow.mul(4).min(1)).mul(0.2));
          const wl = water.add(sin(a.mul(2.3).add(dir.mul(time).mul(2.2))).mul(amp).add(sin(a.mul(0.85).sub(time.mul(1.3))).mul(amp.mul(0.6)))).toVar();
          const wet2 = step(y, wl);
          const hasW = step(0.05, water);
          // The ray: N out of the glass, T along it (the direction `a` grows in), into the box behind.
          const Tg = vec3(abs(nrm.z), 0, abs(nrm.x)), V = normalize(pw.sub(cameraPosition));
          const R = mix(V, refract(V, nrm, 1 / 1.333), wet2.mul(hasW));
          const rin = max(dot(R, nrm.negate()), 0.06), ra = dot(R, Tg), ry = R.y;
          const BIG = 1e4, BACK = 11;
          const tBack = float(BACK).div(rin);
          const tFloor = ry.lessThan(-0.002).select(y.div(ry.negate()), BIG);
          const tCeil = ry.greaterThan(0.002).select(crateY.sub(y).div(ry), BIG);
          const tWat = hasW.greaterThan(0.5).select(wet2.greaterThan(0.5).select(ry.greaterThan(0.002).select(wl.sub(y).div(ry), BIG), ry.lessThan(-0.002).select(y.sub(wl).div(ry.negate()), BIG)), BIG);
          // PVC legs, 2.1 cm across, every 12 cm along the glass: a row 3.2 cm in and one 9.5 cm in, offset by half a step.
          const legAt = (s, off) => {
            const t = float(s).div(rin), ya = y.add(ry.mul(t)), lx = fract(a.add(ra.mul(t)).add(off).div(12)).sub(0.5).mul(12);
            return [step(abs(lx), 1.05).mul(step(0, ya)).mul(step(ya, crateY)), t, lx];
          };
          const [l1, t1, x1] = legAt(3.2, 0), [l2, t2, x2] = legAt(9.5, 6);
          const tLeg = l1.greaterThan(0.5).select(t1, l2.greaterThan(0.5).select(t2, BIG)), lxh = l1.greaterThan(0.5).select(x1, x2);
          const tHit = min(min(min(tBack, tFloor), min(tCeil, tWat)), tLeg).toVar();
          const P = vec3(a.add(ra.mul(tHit)), y.add(ry.mul(tHit)), rin.mul(tHit)).toVar();    // along, height, depth behind the glass
          const light = (s) => exp(s.mul(-0.2)).mul(0.85).add(0.15).mul(U.daylight.mul(0.8).add(0.2));
          // what each surface looks like where the ray meets it
          const floorAt = (p) => {
            const mulm = texture(TEX.ground[0], vec2(p.x, p.z).mul(1 / 9)).rgb.mul(vec3(0.5, 0.42, 0.32)).add(vec3(0.03, 0.025, 0.018));
            const c = caus(vec2(p.x, p.z)).mul(hasW).mul(step(wl, crateY.sub(0.2)).mul(0.6).add(0.4)).mul(exp(wl.mul(-0.12))).mul(0.55);
            return mulm.add(vec3(0.75, 0.72, 0.55).mul(c)).mul(light(p.z));
          };
          const crateUnder = (p) => {
            const gx = fract(p.x.div(1.27)), gz = fract(p.z.div(1.27));
            const web = max(smoothstep(0.16, 0.1, gx), smoothstep(0.16, 0.1, gz));
            return mix(vec3(0.022, 0.02, 0.018), vec3(0.62, 0.63, 0.6), web).mul(light(p.z));
          };
          const backC = vec3(0.02, 0.017, 0.012).mul(light(float(BACK)));
          const legC = vec3(0.68, 0.69, 0.66).mul(float(1).sub(lxh.div(1.05).pow(2).mul(0.6))).mul(light(P.z));
          // the water's surface: from above, the crate mirrored (Fresnel) over the floor seen through it; from below, a mirror
          const ryw = ry.abs();
          const fresW = pow(float(1).sub(ryw), 5).mul(0.95).add(0.02);
          const dIn = wl.div(max(refract(R, vec3(0, 1, 0), 1 / 1.333).y.abs(), 0.08));   // the path down to the floor through it
          // The floor and the crate are shaded once and picked from (no branches: each copy of them in a branch made the
          // material's shader longer, and a longer shader is a longer freeze when a tank loads).
          const fl = floorAt(P).toVar(), cu = crateUnder(P).toVar();
          const waterC = wet2.greaterThan(0.5).select(mix(fl.mul(0.7), vec3(0.42, 0.4, 0.34).mul(light(P.z)), float(0.45)), mix(fl.mul(exp(dIn.mul(-0.16))), cu.mul(0.8), fresW));
          const hitC = tHit.equal(tLeg).select(legC, tHit.equal(tWat).select(waterC, tHit.equal(tFloor).select(fl, tHit.equal(tCeil).select(cu, backC))));
          // How much of the path ran through the water: all of it from under the line; from over it, what lies under the line.
          const inW = hasW.mul(wet2.greaterThan(0.5).select(tHit, max(float(0), tHit.sub(tWat)).mul(step(tWat, tHit.sub(0.001)))));
          const absorb = exp(vec3(0.1, 0.15, 0.3).mul(inW.negate()));
          const scatter = vec3(0.075, 0.05, 0.022).mul(U.daylight.mul(0.8).add(0.2));
          const plen = hitC.mul(absorb).add(scatter.mul(float(1).sub(absorb.g))).toVar();
          // on the glass: a single layer of bio-rings at the bottom, in the water
          const [ring, rh, rd] = blob(0.7, 1, 1.25, 0.34, 0.46, 81, 0, 0.45);
          const ringC = vec3(0.5, 0.46, 0.4).mul(rh.mul(0.25).add(0.8)).mul(mix(float(1), float(0.35), smoothstep(0.32, 0.25, rd)));
          plen.assign(mix(plen, ringC.mul(mix(vec3(1), vec3(0.62, 0.5, 0.32), wet2)), ring.mul(step(y, 1.4))));
          const sq = vec2(a.sub(dir.mul(time).mul(flow)).mul(2.4), y.mul(2.4)), sc = floor(sq), sh = hash(sc.add(91));
          const speck = smoothstep(0.1, 0.05, length(fract(sq).sub(0.5).add(vec2(hash(sc.add(92.7)), hash(sc.add(94.1))).sub(0.5).mul(0.7)))).mul(step(0.82, sh));
          plen.addAssign(vec3(0.11, 0.08, 0.045).mul(speck).mul(wet2).mul(step(y, crateY)));
          const meniscus = smoothstep(0.1, 0.0, abs(y.sub(wl))).mul(hasW).mul(step(wl, crateY));
          plen.addAssign(vec3(0.16, 0.15, 0.12).mul(meniscus));
          // The egg-crate: 1.27 cm cells, 2 mm walls; through its cells the dark under the soil.
          const gx = fract(a.div(1.27)), cy = y.sub(crateY).div(max(ct, 0.01));
          const wall = max(smoothstep(0.17, 0.12, gx), max(step(cy, 0.14), step(0.86, cy)));
          // Through a cell: its white walls running back into the dark, lit from below.
          const crate = mix(mix(vec3(0.3, 0.3, 0.29), vec3(0.08, 0.08, 0.075), cy), vec3(0.8, 0.81, 0.78), wall);
          out.assign(mix(plen, mix(crate, crate.mul(vec3(0.62, 0.5, 0.32)), wet2), step(crateY, y)));
        });
      }).Else(() => {
        // --- Substrates: a photographed soil (sampled side-on) under the particles that make each mix --------------------
        const soil = texture(TEX.ground[0], vec2(a, y).mul(1 / 11)).rgb;
        const fine = (tint) => soil.mul(tint);
        const c = vec3(0).toVar();
        If(sub.lessThan(0.5), () => {
          // Topsoil and peat: dark, fine, with flecks of perlite.
          const [perl] = blob(2.2, 1, 1, 0.12, 0.24, 21, 1, 0.86);
          c.assign(mix(fine(vec3(0.55, 0.45, 0.36)), vec3(0.62, 0.62, 0.58), perl.mul(0.8)));
        }).ElseIf(sub.lessThan(1.5), () => {
          // ABG mix: chunks of fir bark (some dark: charcoal) in peat and tree-fern fibre.
          const [bark, bh, bd] = blob(1.15, 1, 1.25, 0.22, 0.44, 31, 1, 0.5);
          const barkC = mix(vec3(0.15, 0.075, 0.035), vec3(0.24, 0.12, 0.055), bh).mul(soil.r.mul(3).add(0.55)).mul(float(1).sub(bd.mul(0.4)));
          c.assign(mix(fine(vec3(0.5, 0.4, 0.3)), mix(barkC, vec3(0.022, 0.021, 0.02).mul(soil.r.mul(3).add(0.6)), step(bh, 0.12)), bark.mul(0.9)));
        }).Else(() => {
          // Coco coir (and the coir under sphagnum): reddish fibre, stringy along the glass.
          const [fib, fh] = blob(3, 0.45, 2.2, 0.14, 0.3, 41, 1, 0.45);
          c.assign(mix(fine(vec3(0.66, 0.44, 0.3)), vec3(0.22, 0.11, 0.05).mul(fh.mul(0.4).add(0.75)).mul(soil.g.mul(4).add(0.6)), fib.mul(0.4)));
          If(sub.greaterThan(2.5), () => {
            // Living sphagnum in the top three centimetres: pale straw and green strands.
            const [strand, sh] = blob(2.4, 0.5, 1.6, 0.2, 0.42, 51, 0, 0.15);
            const sph = mix(vec3(0.3, 0.29, 0.16), vec3(0.42, 0.44, 0.2), sh).mul(strand.mul(0.45).add(0.55));
            c.assign(mix(c, sph, smoothstep(top.sub(3.4), top.sub(2.8), y)));
          });
        });
        // Damp soil is darker, more so near the bottom where water wicks up; a flooded false bottom soaks it to mud.
        const wick = smoothstep(L.add(4), L, y).mul(0.25);
        c.assign(c.mul(float(1).sub(clamp(wet.mul(0.3).add(wick), 0, 0.55))));
        c.assign(mix(c, c.mul(0.35).add(vec3(0.02, 0.014, 0.008)), mud.mul(smoothstep(water.add(3), water.sub(0.5), y)).mul(0.9)));
        // Under the water table of a LECA layer or a plain substrate (sim/plenum.js stepGround: it stands at the pool's line,
        // over it after rain) the soil is saturated: darker and a touch cooler, with a wet line where the table stands.
        const table = step(mode, 1.5).mul(step(0.05, water));
        c.assign(mix(c, c.mul(vec3(0.5, 0.5, 0.52)), table.mul(step(y, water)).mul(0.85)));   // N3b: wet sand, darker and a little cooler
        c.addAssign(vec3(0.06, 0.055, 0.045).mul(table).mul(smoothstep(0.12, 0.0, abs(y.sub(water)))));
        // Leaf litter: the top centimetre, brown leaf fragments lying flat.
        const [leafM, leafH] = blob(1.4, 0.45, 2.4, 0.22, 0.4, 61, 0, 0.35);
        const litter = mix(fine(vec3(0.4, 0.3, 0.22)), mix(vec3(0.1, 0.055, 0.025), vec3(0.2, 0.11, 0.045), leafH).mul(soil.r.mul(3).add(0.6)), leafM.mul(0.85));
        c.assign(mix(c, litter, smoothstep(top.sub(1.3), top.sub(0.7), y).mul(0.9)));
        // The fibreglass mesh: a dark screen between the drainage and the soil.
        out.assign(mix(c, vec3(0.045, 0.045, 0.042), meshBand));
      });
      return out;
    })();

    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
    m.colorNode = col;
    // Light from the planted tank and the room reaches the glass even where the lamp does not: the build never goes black.
    m.emissiveNode = col.mul(U.daylight.mul(0.22).add(0.03));
    const Lr = drawnL(top0), yr = pw.y;
    m.roughnessNode = mix(float(0.92), float(0.35), max(max(drainOn(top0).mul(step(yr, Lr)).mul(step(yr, drawnWater(Lr))), mud.mul(0.6)),
      step(mode, 1.5).mul(step(0.05, wTrue)).mul(step(yr, drawnWater(Lr))).mul(0.5)));
    return m;
  }

  signature() {
    const W = this.world;
    return `${W.water.hydro.groundVer}|${TANK.w}|${TANK.d}`;
  }

  update(dt) {
    const W = this.world, E = W.env;
    const u = this.u;
    // The water below the ground (sim/plenum.js belowGround): the false bottom's plenum, or the water table in a LECA layer or
    // a plain substrate. The cut-away at the glass and the X-ray body draw the same level.
    const bg = belowGround(E, W.water.level), mode = bg.mode;
    this.below = bg;
    u.mode.value = mode;
    u.L.value = bg.layerH;
    u.pool.value = W.water.level;
    u.water.value = bg.level > 0.02 ? bg.level : -10;
    // The X-ray body: only in the X-ray and Bottom layers. Its height is a uniform, moved when the level moves a visible amount:
    // the water never rebuilds it (only the ground does, below).
    const show = this.layer !== 'surface' && bg.level > 0.05 && !(this.hidden?.());
    this.body.visible = show;
    if (show) {
      if (Math.abs(u.level.value - bg.level) > 0.02) u.level.value = bg.level;
      u.minG.value = mode === 2 ? bg.layerH + 1 : 0;   // a plenum lies under the land only
    }
    u.sub.value = Math.max(0, SUBSTRATE_ORDER.indexOf(E.substrate ?? 'soil'));
    U.backdrop.value = E.backdrop === 'foam' ? 1 : 0;
    u.wet.value = E.soil ?? 0.5;
    u.mud.value += ((E.plenum?.state === 'mud' ? 1 : 0) - u.mud.value) * Math.min(1, dt * 0.5);
    // How the plenum's water moves (sim/plenum.js): the pump's draw spread over the water's cross-section along the glass,
    // cm/s, and how much rain is dripping into it; the tower stands in the back corner where render/plumbing.js puts it.
    const pl = E.plenum, depth = Math.max(0.5, Math.min(E.plenumLevel ?? 0, u.L.value)), cm3s = ((pl?.flows?.pump ?? 0) * 1000) / 60;
    this.flowCms = mode === 2 ? cm3s / (depth * TANK.d * 0.85) : 0;
    u.flow.value = Math.min(1.5, this.flowCms);
    u.stir.value += (Math.min(1, (pl?.flows?.drip ?? 0) * 8) - u.stir.value) * Math.min(1, dt);
    if (mode === 2) {
      const T = W.terrain, hw = TANK.w / 2 - 3.2, z = -TANK.d / 2 + 7;
      const sx = T.heightAt(hw, z) >= u.L.value + 1 ? 1 : -1;
      u.tower.value.set(sx * hw, z);
    }
    this.mesh.visible = !(this.hidden?.());
    this.t += dt;
    if (this.t < 1) return;
    this.t = 0;
    const s = this.signature();
    if (s !== this.sig) { this.sig = s; this.rebuild(); }
  }

  // Strips along the front glass and both side glasses, floor to ground.
  rebuild() {
    const T = this.world.terrain;
    const pos = [], nor = [], tops = [], idx = [];
    const strip = (n, at, normal) => {
      const base = pos.length / 3;
      for (let k = 0; k <= n; k++) {
        const [x, z] = at(k / n);
        const h = Math.max(0, T.baseAt(x, z));
        pos.push(x, 0, z, x, h, z);
        nor.push(...normal, ...normal);
        tops.push(h, h);
      }
      for (let k = 0; k < n; k++) {
        const i = base + k * 2;
        // Wound to face outward (toward the glass and the viewer).
        if (normal[0] <= 0) idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3); else idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
      }
    };
    const hw = TANK.w / 2 - INSET, hd = TANK.d / 2 - INSET;
    strip(Math.ceil(TANK.w / STEP), (t) => [-hw + t * 2 * hw, hd], [0, 0, 1]);
    strip(Math.ceil(TANK.d / STEP), (t) => [-hw, -hd + t * 2 * hd], [-1, 0, 0]);
    strip(Math.ceil(TANK.d / STEP), (t) => [hw, -hd + t * 2 * hd], [1, 0, 0]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('top', new THREE.Float32BufferAttribute(tops, 1));
    geo.setIndex(idx);
    const old = this.mesh.geometry;
    this.mesh.geometry = geo;
    old.dispose();
    this.rebuildBody();
  }

  // The water below the ground as a body, for the X-ray and Bottom layers (render/layers.js): tea-coloured, glowing through the
  // ground that covers it like the plumbing's X-ray (render/plumbing.js makeGhost: drawn only where something is in front, after
  // the opaque pass, nothing added to the scene pass). One draw call; hidden in the Surface layer.
  makeBody(parent) {
    const { level, minG, mode } = this.u, g = attribute('g', 'float'), up = attribute('up', 'float');
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthFunc: THREE.GreaterDepth, side: THREE.DoubleSide });
    // The sheet at the sim's bodyTop (sim/plenum.js): the level, a millimetre under the ground where the ground is lower.
    m.positionNode = vec3(positionLocal.x, max(min(level, g.sub(BODY_SINK)), 0).mul(up), positionLocal.z);
    // Coloured like the pool water in every layer (U.tint: render/water.js volume and surface, shaders.js fog), lifted a little
    // to glow through the ground; the sheet as see-through as the pool's deep veil (water.js, 0.12 + 0.35), the walls fainter.
    // tools/steps/below-ground.mjs reads these same uniforms through userData.look.
    // That is the false bottom's open water (mode 2). In a LECA layer or a plain substrate the water fills the pores: the zone is
    // wet substrate, not open water, so the cut-away's sand must stay readable through it (N3b). There the body has no walls (they
    // stand 1.5 cm behind the side and front glass and stacked over the sand as a pale block and, edge-on at the side glass, a tall
    // column) and its sheet is a faint dark film of the tint, so it only darkens and cools what lies behind it.
    const look = { gain: uniform(0.9), lift: uniform(0.08), sheet: uniform(0.45), wall: uniform(0.3), wetGain: uniform(0.08), wetSheet: uniform(0.12) };
    const open = step(1.5, mode);
    m.colorNode = mix(U.tint.mul(look.wetGain), U.tint.mul(look.gain).add(look.lift), open);
    m.opacityNode = step(minG, g).mul(mix(look.wetSheet.mul(up), mix(look.wall, look.sheet, up), open));
    m.userData.look = () => ({ rgb: ['r', 'g', 'b'].map((k) => U.tint.value[k] * look.gain.value + look.lift.value), opacity: look.sheet.value, wall: look.wall.value,
      wet: { rgb: ['r', 'g', 'b'].map((k) => U.tint.value[k] * look.wetGain.value), opacity: look.wetSheet.value, wall: 0 } });
    const b = new THREE.Mesh(new THREE.BufferGeometry(), m);
    b.name = 'water-below-xray'; b.frustumCulled = false; b.renderOrder = 3; b.visible = false;
    parent.add(b);
    return b;
  }

  // Its mesh: a sheet over the floor's 3 cm grid (sim/plenum.js groundGrid: the cells the sim counts) and walls down to the floor
  // along its rim, 1.5 cm in from the glass (behind the cut-away). Each vertex carries its cell's ground `g` and `up` (1 on the
  // sheet, 0 on the floor). Rebuilt with the ground only.
  rebuildBody() {
    const G = groundGrid(this.world), { nx, nz, sx, sz } = G;
    const pos = [], gs = [], up = [], idx = [];
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { pos.push(-TANK.w / 2 + (i + 0.5) * sx, 1, -TANK.d / 2 + (j + 0.5) * sz); gs.push(G.g[j * nx + i]); up.push(1); }
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i; idx.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1); }
    const rim = [];
    for (let i = 0; i < nx; i++) rim.push(i);
    for (let j = 1; j < nz; j++) rim.push(j * nx + nx - 1);
    for (let i = nx - 2; i >= 0; i--) rim.push((nz - 1) * nx + i);
    for (let j = nz - 2; j >= 0; j--) rim.push(j * nx);
    const base = pos.length / 3;
    for (const v of rim) { pos.push(pos[v * 3], 0, pos[v * 3 + 2]); gs.push(gs[v]); up.push(0); }
    for (let k = 0; k < rim.length - 1; k++) idx.push(rim[k], base + k, rim[k + 1], rim[k + 1], base + k, base + k + 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('g', new THREE.Float32BufferAttribute(gs, 1));
    geo.setAttribute('up', new THREE.Float32BufferAttribute(up, 1));
    geo.setIndex(idx);
    const old = this.body.geometry;
    this.body.geometry = geo;
    old.dispose();
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.body.removeFromParent();
    this.body.geometry.dispose();
  }
}
