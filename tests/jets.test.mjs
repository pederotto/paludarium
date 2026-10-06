// sim/jets.js: water leaving a nozzle against published figures (exit speed, turbulence, breakup, landing, plunge depth, rise).
import test from 'node:test';
import assert from 'node:assert/strict';
import { jetSpeed, reynolds, weber, turbulent, breakupLength, landing, penetration, bubbleRise, subJetSpeed, G } from '../src/sim/jets.js';

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} ± ${tol}`);

test('600 L/h through a 9 mm bore leaves at about 2.6 m/s and is turbulent (Re about 24 000)', () => {
  const v = jetSpeed(600, 9);
  near(v, 262, 2, 'exit speed cm/s');
  near(reynolds(v, 0.9), 23600, 400, 'Re');
  assert.ok(turbulent(v, 0.9));
  // a slow trickle from a 4 mm bore is laminar
  assert.ok(!turbulent(30, 0.4), 'trickle laminar');
});

test('breakup length: turbulent by Grant & Middleman, laminar by Weber', () => {
  const v = jetSpeed(600, 9);
  near(weber(v, 0.9), 858, 10, 'We');
  near(breakupLength(v, 0.9), 0.9 * 8.51 * 858 ** 0.32, 1, 'turbulent L');   // ≈ 66 cm: no breakup in a tank's few cm of air
  assert.ok(breakupLength(v, 0.9) > 40);
  near(breakupLength(30, 0.4), 0.4 * 12 * Math.sqrt(weber(30, 0.4)), 0.01, 'laminar L');
  assert.equal(breakupLength(0, 0.9), 0);
});

test('a jet thrown level from 2 cm lands after sqrt(2h/g) and further out the faster it is', () => {
  const L = landing({ x: 0, y: 2, z: 0 }, { x: 1, y: 0, z: 0 }, 100, 0);
  near(L.t, Math.sqrt(4 / G), 1e-6, 'time');
  near(L.x, 100 * Math.sqrt(4 / G), 1e-6, 'reach');
  near(L.v, Math.hypot(100, G * L.t), 1e-6, 'impact speed');
  assert.ok(landing({ x: 0, y: 2, z: 0 }, { x: 1, y: 0, z: 0 }, 200, 0).x > L.x);
  assert.equal(landing({ x: 0, y: -1, z: 0 }, { x: 1, y: 0, z: 0 }, 100, 0), null);
});

test('plunging jets drive bubbles down 2.1 d V / U_T, never under the floor', () => {
  near(penetration(0.63, 262, 100), 2.1 * 0.63 * 262 / 22, 1e-9, 'H');
  assert.equal(penetration(0.63, 262, 5), 5);
});

test('bubbles rise faster the bigger they are, about 19 cm/s at 2 mm and 10 at 1 mm', () => {
  near(bubbleRise(2), 19, 0.01, '2 mm');
  near(bubbleRise(1), 10, 0.01, '1 mm');
  let last = 0;
  for (let d = 0.05; d <= 6; d += 0.05) { const u = bubbleRise(d); assert.ok(u >= last - 1e-9, `monotonic at ${d}`); last = u; }
});

test('a submerged jet keeps its speed for about 6 bores, then slows as 1/x', () => {
  near(subJetSpeed(100, 1, 3), 100, 1e-9, 'core');
  near(subJetSpeed(100, 1, 12.4), 50, 1e-9, 'half at 12.4 bores');
});

test('a jet over uneven ground lands on the ground where it is higher, in the water where the water is', async () => {
  const { landOn, landing } = await import('../src/sim/jets.js');
  const flat = () => ({ y: 0, water: true });
  const L0 = landing({ x: 0, y: 2, z: 0 }, { x: 1, y: 0, z: 0 }, 100, 0), L1 = landOn({ x: 0, y: 2, z: 0 }, { x: 1, y: 0, z: 0 }, 100, flat);
  assert.ok(Math.abs(L1.x - L0.x) < 0.05 && L1.water, `flat water: same as the analytic landing (${L1.x} vs ${L0.x})`);
  // a rock 1.5 cm high from x = 3 on: the jet (which would land at 6.4 cm) hits the rock's top first, not the water
  const rock = (x) => (x >= 3 ? { y: 1.5, water: false } : { y: 0, water: true });
  const L2 = landOn({ x: 0, y: 2, z: 0 }, { x: 1, y: 0, z: 0 }, 100, rock);
  assert.ok(!L2.water && L2.y === 1.5 && L2.x > 3 && L2.x < 6.4, `lands on the rock: ${JSON.stringify(L2)}`);
  assert.equal(landOn({ x: 0, y: -1, z: 0 }, { x: 1, y: 0, z: 0 }, 100, flat), null);
});
