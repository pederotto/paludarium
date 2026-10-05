// Follow mode (C2): the pure state machine in src/editor/followmode.js. While following or zoomed in, the menu is hidden; Esc or a
// single tap brings the camera back to the pose it had before and the menu back; a double tap or a long press on another animal
// switches the follow to it (home pose kept, menu still hidden).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FREE, DBL_MS, step } from '../src/editor/followmode.js';

const P1 = { pos: [10, 20, 30], target: [0, 0, 0] }, P2 = { pos: [1, 2, 3], target: [4, 5, 6] };
const A = { id: 'gecko-1' }, B = { id: 'skink-1' };
const sel = (obj) => ({ kind: 'animal', obj });
const plant = { kind: 'plant', obj: { id: 'fern' } };
const types = (fx) => fx.map((f) => f.type);
const run = (evs, s = FREE) => { let fx = []; for (const ev of evs) ({ state: s, fx } = step(s, ev)); return { state: s, fx }; };
const following = run([{ type: 'follow', target: A, pose: P1 }]);

test('entering focus saves the home pose once and hides the menu', () => {
  assert.equal(following.state.mode, 'focus');
  assert.equal(following.state.home, P1);
  assert.deepEqual(types(following.fx), ['hideMenu', 'select', 'follow']);
  assert.equal(following.fx[2].obj, A);
  // A second follow or a zoom while in focus does not overwrite the pose saved on entering.
  const again = run([{ type: 'zoom', sel: plant, pose: P2 }, { type: 'follow', target: B, pose: P2 }], following.state);
  assert.equal(again.state.home, P1);
  assert.equal(again.state.target.obj, B);
  assert.ok(!types(again.fx).includes('showMenu'));
  // Zoom from free enters focus too.
  const z = run([{ type: 'zoom', sel: plant, pose: P2 }]);
  assert.equal(z.state.mode, 'focus'); assert.equal(z.state.home, P2); assert.deepEqual(types(z.fx), ['hideMenu', 'select', 'follow']);
  assert.equal(z.fx[2].obj, null);
});

test('Esc and a tap on nothing restore the home pose and show the menu', () => {
  for (const ev of [{ type: 'esc' }, { type: 'tap', hit: null, t: 1000 }]) {
    const r = step(following.state, ev);
    assert.equal(r.state.mode, 'free', ev.type);
    const home = r.fx.find((f) => f.type === 'restoreHome');
    assert.equal(home?.pose, P1, ev.type);
    assert.ok(types(r.fx).includes('showMenu'), ev.type);
    assert.equal(r.fx.find((f) => f.type === 'follow')?.obj, null, ev.type);
    assert.equal(r.fx.find((f) => f.type === 'select')?.sel, null, ev.type);
    assert.ok(!types(r.fx).includes('wait'), ev.type + ' acts at once');
  }
  // A tap on the followed animal itself or on a plant exits at once too.
  for (const hit of [sel(A), plant]) {
    const r = step(following.state, { type: 'tap', hit, t: 1000 });
    assert.equal(r.state.mode, 'free'); assert.equal(r.fx.find((f) => f.type === 'select').sel, hit);
  }
});

test('a single tap on another animal waits for a second tap, then exits and selects it', () => {
  const w = step(following.state, { type: 'tap', hit: sel(B), t: 1000 });
  assert.equal(w.state.mode, 'focus');
  assert.deepEqual(w.fx, [{ type: 'wait', ms: DBL_MS }]);
  const r = step(w.state, { type: 'timeout' });
  assert.equal(r.state.mode, 'free');
  assert.equal(r.fx.find((f) => f.type === 'select').sel.obj, B);
  assert.equal(r.fx.find((f) => f.type === 'restoreHome').pose, P1);
  assert.ok(types(r.fx).includes('showMenu'));
  // A stale timeout after that does nothing.
  assert.deepEqual(step(r.state, { type: 'timeout' }).fx, []);
});

test('a double tap, a dblclick or a long press on another animal follows it: home unchanged, menu hidden', () => {
  const two = run([{ type: 'tap', hit: sel(B), t: 1000 }, { type: 'tap', hit: sel(B), t: 1000 + DBL_MS - 50 }], following.state);
  const dbl = step(following.state, { type: 'dbl', hit: sel(B) });
  const long = step(following.state, { type: 'long', hit: sel(B) });
  for (const [name, r] of [['two taps', two], ['dbl', dbl], ['long', long]]) {
    assert.equal(r.state.mode, 'focus', name);
    assert.equal(r.state.target.obj, B, name);
    assert.equal(r.state.home, P1, name);
    assert.equal(r.state.pending, null, name);
    assert.ok(!types(r.fx).includes('showMenu') && !types(r.fx).includes('restoreHome'), name);
    assert.equal(r.fx.find((f) => f.type === 'follow').obj, B, name);
  }
  // Two taps too far apart are two single taps: the first one exits.
  const slow = run([{ type: 'tap', hit: sel(B), t: 1000 }, { type: 'tap', hit: sel(B), t: 1000 + DBL_MS + 50 }], following.state);
  assert.equal(slow.state.mode, 'free');
  // A long press on the followed animal or on nothing changes nothing.
  for (const hit of [sel(A), null]) assert.deepEqual(step(following.state, { type: 'long', hit }).fx, []);
});

test('the followed animal dying exits; Stop following exits; free taps are never delayed', () => {
  const r = step(following.state, { type: 'lost' });
  assert.equal(r.state.mode, 'free');
  assert.equal(r.fx.find((f) => f.type === 'restoreHome').pose, P1);
  assert.ok(types(r.fx).includes('showMenu'));
  const stop = step(following.state, { type: 'follow', target: null });
  assert.equal(stop.state.mode, 'free'); assert.ok(types(stop.fx).includes('restoreHome'));
  for (const ev of [{ type: 'tap', hit: sel(B), t: 5 }, { type: 'dbl', hit: sel(B) }, { type: 'long', hit: sel(B) }, { type: 'esc' }, { type: 'lost' }]) {
    assert.deepEqual(step(FREE, ev), { state: FREE, fx: [] }, ev.type);
  }
});
