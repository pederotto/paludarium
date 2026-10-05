// Switching tanks must let the old tank go. Each loadTank builds a new World with its own Lens; the Lens subscribes to the
// quality-metric signal, and a subscription that is never stopped kept every World ever left alive (with its Stage's shadow
// map and its mist texture). See tools/steps/tank-sizes.mjs for the same check in the running game.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { Lens, qualityMetric } from '../src/render/lens.js';
import { configureTank } from '../src/sim/tank.js';
import { TANKS } from '../src/content/tanks.js';

// The parts of a World a Lens reads when it is built.
const fakeWorld = () => ({ climate: { nx: 30, nz: 15, cs: 3 }, terrain: { geo: new THREE.PlaneGeometry(1, 1) }, wall: { geo: new THREE.PlaneGeometry(1, 1) } });

test('a new tank\'s Lens disposes the one before it, so the old world is no longer reachable from the signal', () => {
  configureTank(TANKS.standard);
  const a = new Lens(new THREE.Group(), fakeWorld());
  let calls = 0, texGone = false;
  a.tex.addEventListener('dispose', () => { texGone = true; });
  a.name = 'quality';
  a.set = () => { calls++; };
  qualityMetric.value = 'ammonia';
  assert.equal(calls, 1, 'the live lens follows the metric');
  configureTank(TANKS.long);
  const b = new Lens(new THREE.Group(), fakeWorld());
  qualityMetric.value = 'nitrate';
  assert.equal(calls, 1, 'the old lens no longer follows the metric (its effect was stopped)');
  assert.ok(texGone, 'the old lens texture was disposed');
  // Disposing twice (the game may also dispose it on unload) is harmless, and a disposed lens is not "current".
  a.dispose();
  b.dispose();
  b.dispose();
  const c = new Lens(new THREE.Group(), fakeWorld());
  assert.ok(c.stopFx, 'a lens built after the current one was disposed still subscribes');
  c.dispose();
  qualityMetric.value = 'worst';
  configureTank(TANKS.standard);
});
