// A reference piece is the same size in centimetres in every tank (BRIEF N20): a kit's stones in the 60 cm tall tank,
// the standard tank and the 180 cm show tank; in the 30 cm cube it shrinks just enough to fit. Before N20 kits followed the tank's width (cube 0.38x, show 1.6x).
import test from 'node:test';
import assert from 'node:assert/strict';
import { TANKS } from '../src/content/tanks.js';
import { KITS, kitReach } from '../src/content/kits.js';
import { kitFit } from '../src/sim/scale.js';   // sim/kits.js kitScale(kit) = kitFit(kitReach(kit), TANK)

const sizes = ['tall', 'standard', 'show'];   // 60, 90 and 180 cm wide
const T = (id) => Object.values(TANKS).find((t) => t.id === id);

test('the smallest kit has the same size in cm in the tall, the standard and the show tank, and shrinks only to fit the cube', () => {
  {
    // the smallest kit, by its biggest piece: it lies across a 30 cm cube
    const kit = [...KITS].sort((a, b) => kitReach(a) - kitReach(b))[0];
    const big = Math.max(...kit.pieces.map((p) => p.size ?? 0));
    const cm = sizes.map((id) => { return +(big * kitFit(kitReach(kit), T(id))).toFixed(2); });
    console.log(`reference stone (${kit.id ?? kit.name}, ${big} cm): tall ${cm[0]} / standard ${cm[1]} / show ${cm[2]} cm`);
    assert.ok(Math.abs(cm[0] - cm[1]) < 0.01 && Math.abs(cm[2] - cm[1]) < 0.01, `tall ${cm[0]}, standard ${cm[1]}, show ${cm[2]} cm`);
    // the cube: just small enough to lie across its 30 cm, not a fixed fraction of the tank
    const cube = 2 * kitReach(kit) * kitFit(kitReach(kit), T('cube'));
    assert.ok(Math.abs(cube - 0.95 * 30) < 0.01, `cube spread ${cube} cm`);
  }
});
