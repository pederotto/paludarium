// Water leaving a nozzle: how fast, how far it holds together, where it lands, how deep it drives air into the pool and how fast
// that air comes back up. Plain numbers for render/jet.js (the spray and bubbles) and render/plumbing.js (the jet's column).
// Units: cm, s, g; water at about 20 °C.
//
//   exit speed       v = Q / A (the flow over the bore's area)
//   Reynolds         Re = v d / nu; over about 2300 the jet is turbulent: its surface is rough and wobbles (pump outlets
//                    are always well over: 600 L/h through a 9 mm bore is Re ≈ 24 000)
//   Weber            We = rho v^2 d / sigma
//   breakup length   laminar (Weber 1931, low viscosity): L / d ≈ 12 sqrt(We); turbulent (Grant & Middleman 1966):
//                    L / d ≈ 8.51 We^0.32. A pump's jet over the few cm to the pool stays one rough column: it does not
//                    break into drops before it lands, it throws a crown of drops where it does.
//   penetration      a jet plunging into a pool carries bubbles down to H ≈ 2.1 d V / U_T (Clanet & Lasheras 1997),
//                    U_T ≈ 22 cm/s the rise speed of the mm-size bubbles it entrains; no deeper than the pool
//   bubble rise      terminal speed of an air bubble in tap or tank water (surfactants slow small ones): approximate
//                    values read from the "contaminated water" curve of Clift, Grace & Weber (1978), labelled as such
//   crown splash     drops thrown up where a jet lands leave at about a quarter of its impact speed (a guess, labelled)

export const NU = 0.01;        // cm²/s, kinematic viscosity of water at 20 °C
export const SIGMA = 72;       // dyn/cm, surface tension of water against air
export const RHO = 1;          // g/cm³
export const G = 981;          // cm/s²
export const U_T = 22;         // cm/s, rise speed of the 2-4 mm bubbles a plunging jet entrains
export const SPLASH = 0.25;    // share of the impact speed the crown's drops leave with (a guess)

// Speed of `lph` litres an hour through a bore of `dMm` mm (cm/s).
export const jetSpeed = (lph, dMm) => (Math.max(0, lph) * 1000 / 3600) / (Math.PI * (dMm / 20) ** 2);
export const reynolds = (v, dCm) => (v * dCm) / NU;
export const weber = (v, dCm) => (RHO * v * v * dCm) / SIGMA;
export const turbulent = (v, dCm) => reynolds(v, dCm) > 2300;

// How far (cm) a free jet of speed v from a bore of dCm runs before it breaks into drops.
export function breakupLength(v, dCm) {
  const we = weber(v, dCm);
  if (!(we > 0)) return 0;
  return turbulent(v, dCm) ? dCm * 8.51 * we ** 0.32 : dCm * 12 * Math.sqrt(we);
}

// A thrown jet from p (x, y, z) along the unit direction dir at speed v, falling under gravity, until it is down at height
// surfY: the time, the point and the speed it lands with. Null when it starts under surfY.
export function landing(p, dir, v, surfY) {
  const h = p.y - surfY;
  if (h < 0) return null;
  const vy = dir.y * v;
  const t = (vy + Math.sqrt(vy * vy + 2 * G * h)) / G;
  const vx = dir.x * v, vz = dir.z * v, vyl = vy - G * t;
  return { t, x: p.x + vx * t, y: surfY, z: p.z + vz * t, v: Math.hypot(vx, vyl, vz), vy: vyl };
}

// How deep (cm) a jet of bore dCm landing at speed v drives its bubbles into water `depth` deep.
export const penetration = (dCm, v, depth) => Math.max(0, Math.min(depth, (2.1 * dCm * v) / U_T));

// Rise speed (cm/s) of an air bubble dMm across in tank water. Approximate (Clift, Grace & Weber 1978, contaminated water).
const RISE = [[0.1, 0.5], [0.2, 1.7], [0.5, 6.5], [1, 10], [2, 19], [3, 22], [5, 23]];
export function bubbleRise(dMm) {
  if (dMm <= RISE[0][0]) return RISE[0][1] * dMm / RISE[0][0];
  for (let k = 1; k < RISE.length; k++) {
    const [d1, u1] = RISE[k];
    if (dMm <= d1) { const [d0, u0] = RISE[k - 1]; return u0 + (u1 - u0) * (dMm - d0) / (d1 - d0); }
  }
  return RISE[RISE.length - 1][1];
}

// The speed a submerged jet's centre line keeps at distance x (cm) from a nozzle of bore dCm: the core runs at full speed
// for about 6 bores, then falls off as 6.2 d / x (round turbulent jet).
export const subJetSpeed = (v, dCm, x) => v * Math.min(1, (6.2 * dCm) / Math.max(1e-6, x));

// Where a thrown jet comes down on uneven ground or water: steps along its ballistic path (dt s) until it is under the surface
// `floorAt(x, z)` gives there ({ y, water }: the ground's height, or the water's where there is water over it). Null when it
// starts under that surface or is still in the air after `tMax` s. Returns the time, the point, the impact speed and whether
// it came down in water.
export function landOn(p, dir, v, floorAt, dt = 0.004, tMax = 2) {
  const f0 = floorAt(p.x, p.z);
  if (p.y < f0.y) return null;
  const vx = dir.x * v, vz = dir.z * v;
  let x = p.x, y = p.y, z = p.z, vy = dir.y * v;
  for (let t = dt; t <= tMax; t += dt) {
    const nx = x + vx * dt, nz = z + vz * dt, nvy = vy - G * dt, ny = y + (vy + nvy) * 0.5 * dt;
    const f = floorAt(nx, nz);
    if (ny <= f.y) {
      // the crossing between the two steps, by the height above the surface on either side
      const a = y - floorAt(x, z).y, b = ny - f.y, k = a > b ? a / (a - b) : 1;
      return { t: t - dt + dt * k, x: x + (nx - x) * k, y: f.y, z: z + (nz - z) * k, v: Math.hypot(vx, vy + (nvy - vy) * k, vz), water: !!f.water };
    }
    x = nx; y = ny; z = nz; vy = nvy;
  }
  return null;
}
