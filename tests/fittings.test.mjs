import test from 'node:test';
import assert from 'node:assert/strict';
import { glassThickness, trimThickness, lightBars, barSection, furniture, roomFrame, roomScene, BAR_LENGTHS, ROOM_SHARE } from '../src/engine/fittings.js';
import { TANKS, TANK_ORDER, CUSTOM_LIMITS } from '../src/content/tanks.js';

const outside = (t) => { const g = glassThickness(t.w, t.h), r = t.closed ? 0 : trimThickness(t.w); return [t.w + 2 * (g + r), t.d + 2 * (g + r)]; };

test('the standard tank keeps the hardware it always had', () => {
  const s = TANKS.standard;
  assert.equal(glassThickness(s.w, s.h), 0.6);
  assert.equal(trimThickness(s.w), 1.2);
  assert.deepEqual(lightBars(s.w), [{ x: 0, len: 75 }]);
  assert.deepEqual(barSection(75), { h: 1.2, d: 5 });
  const f = furniture(...outside(s));
  assert.equal(f.kind, 'cabinet');
  assert.equal(f.h, 70);
  assert.deepEqual(roomScene(s).furn, f);
});

test('glass gets thicker with the tank, like real glass', () => {
  assert.equal(glassThickness(TANKS.cube.w, TANKS.cube.h), 0.4);
  assert.equal(glassThickness(TANKS.jar.w, TANKS.jar.h), 0.4);
  assert.ok(glassThickness(TANKS.long.w, TANKS.long.h) >= 1);
  assert.equal(glassThickness(TANKS.show.w, TANKS.show.h), 1.2);
  let last = 0;
  for (const w of [25, 40, 60, 90, 120, 150, 180, 200]) { const g = glassThickness(w, 50); assert.ok(g >= last && g >= 0.4 && g <= 1.2, `${w}: ${g}`); last = g; }
  assert.ok(glassThickness(60, 90) > glassThickness(60, 50), 'a tall front is thicker');
});

test('lamps are stock-length bars: one over a small tank, two or three over a long one, never past the ends', () => {
  assert.equal(lightBars(TANKS.cube.w).length, 1);
  assert.ok(lightBars(TANKS.cube.w)[0].len < 30);
  assert.equal(lightBars(TANKS.long.w).length, 2);
  assert.equal(lightBars(TANKS.show.w).length, 3);
  for (let w = CUSTOM_LIMITS.w[0]; w <= CUSTOM_LIMITS.w[1]; w += 5) {
    const bars = lightBars(w);
    for (const b of bars) {
      assert.ok(BAR_LENGTHS.includes(b.len), `${w}: ${b.len}`);
      assert.ok(Math.abs(b.x) + b.len / 2 <= w / 2 + 0.01 || w < 22, `${w}: bar at ${b.x} of ${b.len} overhangs`);
    }
    const cover = bars.reduce((s, b) => s + b.len, 0) / w;
    assert.ok(cover > 0.45 && cover <= 1, `${w}: covers ${cover}`);
  }
});

test('small tanks stand on a side table, the rest on a cabinet of realistic height as long as the tank', () => {
  for (const id of TANK_ORDER) {
    const [ow, od] = outside(TANKS[id]), f = furniture(ow, od);
    if (['jar', 'cube', 'spire'].includes(id)) { assert.equal(f.kind, 'table', id); assert.ok(f.w >= ow + 30, `${id}: room beside it on the table`); continue; }
    assert.equal(f.kind, 'cabinet', id);
    assert.ok(f.h >= 70 && f.h <= 90, `${id}: ${f.h}`);
    assert.ok(f.w >= ow && f.w <= ow + 4 && f.d >= od, id);
    assert.ok(f.w / f.doors > 35 && f.w / f.doors < 70, `${id}: doors ${f.doors} for ${f.w} cm`);
  }
  assert.ok(furniture(...outside(TANKS.show)).h > furniture(...outside(TANKS.standard)).h);
});

test('the room is framed at a physical scale: the whole scene in view, and a clear progression of sizes', () => {
  const frame = (id) => roomFrame(TANKS[id]);
  // What the scene needs: from the floor (and a strip of it) to above the lamp, and the plant and switch either side.
  for (const id of [...TANK_ORDER, 'custom']) {
    const t = TANKS[id] ?? { w: 200, d: 80, h: 75 }, f = roomFrame(t), { furn, outW } = roomScene(t);
    const bottom = f.y - f.h / 2, top = f.y + f.h / 2;
    assert.ok(bottom <= -0.8 - furn.h - 3, `${id}: the floor is in view (${bottom} vs ${-0.8 - furn.h})`);
    assert.ok(top >= t.h + 6, `${id}: the lamp is in view`);
    assert.ok(f.w >= Math.max(outW, furn.w) + 80, `${id}: the plant and the switch are in view`);
    assert.ok(t.w / f.w <= ROOM_SHARE + 1e-9, `${id}: at most ${ROOM_SHARE} of the width`);
    assert.ok(Math.abs(f.w * 9 / 16 - f.h) < 1e-6 || f.h > f.w * 9 / 16, `${id}: fits a 16:9 view`);
  }
  // Clicking along the picker: each size takes more of the view than the one before (by the area of its front).
  const area = (id) => (TANKS[id].w / frame(id).w) * (TANKS[id].h / frame(id).h);
  const order = ['cube', 'jar', 'nano', 'standard', 'long', 'show'];
  for (let i = 1; i < order.length; i++) assert.ok(area(order[i]) > area(order[i - 1]) * 1.05, `${order[i]} bigger than ${order[i - 1]}: ${area(order[i])} vs ${area(order[i - 1])}`);
  for (const id of TANK_ORDER) if (TANKS[id].w > 90) assert.ok(area(id) > area('standard'), id);
  // The frame grows much more slowly than the tank.
  assert.ok(frame('show').w / frame('standard').w < 0.7 * (TANKS.show.w / TANKS.standard.w));
  assert.ok(frame('jar').w / frame('standard').w > 1.5 * (TANKS.jar.w / TANKS.standard.w));
});
