// Obstacles in the arena: exact-size shapes cut into the ground (sim/labshapes.js) and the game's own hardscape (Decor pieces), so an
// animal meets them as it meets them in play. Shapes are kept as a list and the ground is rebuilt from the list each time, so removing
// one gives the ground back exactly; a piece is added and removed through Decor.

import { PIECES } from '../sim/decor.js';
import { TANK } from '../sim/tank.js';
import { KINDS, DEFAULTS } from '../sim/labshapes.js';
import { clamp } from '../util/math.js';
import { L } from './state.js';
import { shapeGround, setDepth } from './arena.js';

export const SHAPE_KINDS = KINDS;
// The pieces the lab offers (the whole hardscape list but the cliff face, which needs a wall to stand on).
export const PIECE_KINDS = Object.fromEntries(Object.entries(PIECES).filter(([id]) => id !== 'cliff').map(([id, d]) => [id, d.name]));
export const isPiece = (kind) => kind in PIECE_KINDS;

export function createObstacles(game) {
  const items = [];
  let next = 1;
  const margin = 2;

  const publish = () => { L.obstacles.value = items.map(({ piece, ...o }) => o); };
  const shapes = () => items.filter((o) => !o.piece);
  const regrow = () => {
    shapeGround(game, L.ground.value, shapes());
    setDepth(game, L.depth.value);
    publish();
  };
  const inside = (x, z) => [clamp(x, -TANK.w / 2 + margin, TANK.w / 2 - margin), clamp(z, -TANK.d / 2 + margin, TANK.d / 2 - margin)];

  const api = {
    items, shapes,
    // The kind chosen in the panel, with the sizes on its sliders.
    spec() {
      const kind = L.obKind.value;
      return isPiece(kind)
        ? { kind, size: L.obSize.value, rot: (L.obRot.value * Math.PI) / 180 }
        : { kind, w: L.obW.value, d: L.obD.value, h: L.obH.value, rot: (L.obRot.value * Math.PI) / 180 };
    },
    // Put one down at (x, z). Returns the item, or null (a piece whose model has not loaded yet).
    add(spec, x, z) {
      [x, z] = inside(x, z);
      const W = game.world;
      if (isPiece(spec.kind)) {
        const piece = W.decor.addPiece(spec.kind, x, z, { size: spec.size, rot: spec.rot, seed: next * 7919 });
        if (!piece) { L.note.value = 'That piece is still loading: try again in a moment.'; return null; }
        W.groundChanged();
        const it = { id: next++, kind: spec.kind, x, z, size: spec.size, rot: spec.rot, piece };
        items.push(it);
        publish();
        return it;
      }
      const it = { id: next++, kind: spec.kind, x, z, w: spec.w, d: spec.d, h: spec.h, rot: spec.rot };
      items.push(it);
      regrow();
      return it;
    },
    place(x, z) { return api.add(api.spec(), x, z); },
    // In the way of the selected animal: ahead of it, with the obstacle's long side across its heading.
    inWay(gap = 7) {
      const a = L.sel.value;
      if (!a || a.dead) { L.note.value = 'Select an animal first.'; return null; }
      const spec = api.spec(), reach = (isPiece(spec.kind) ? spec.size : spec.d) / 2 + gap;
      const yaw = a.yaw ?? 0;
      return api.add({ ...spec, rot: isPiece(spec.kind) ? spec.rot : yaw }, a.pos.x + Math.sin(yaw) * reach, a.pos.z + Math.cos(yaw) * reach);
    },
    remove(id) {
      const i = items.findIndex((o) => o.id === id);
      if (i < 0) return;
      const [it] = items.splice(i, 1);
      if (it.piece) { game.world.decor.removePiece(it.piece); game.world.groundChanged(); publish(); } else regrow();
    },
    clear() {
      const W = game.world;
      let ground = false;
      for (const it of items.splice(0)) { if (it.piece) W?.decor.removePiece(it.piece); else ground = true; }
      if (W) { if (ground) regrow(); else W.groundChanged(); }
      publish();
    },
    // The ground under the obstacles changed shape (the arena was reshaped): put the shapes back into it.
    reapply() { if (shapes().length) regrow(); else publish(); },
    snapshot() { return items.map(({ piece, id, ...o }) => o); },
  };

  game.events.on('unload', () => { items.length = 0; publish(); });
  return api;
}

export { DEFAULTS };
