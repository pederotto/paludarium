// The lab as numbers: the arena, the animals, their drives and the dots. Small enough to paste into a bug report. (Loading one back
// is the scenario step of the lab; the snapshot is taken now so every report already carries it.)

import { L } from './state.js';

const r1 = (v) => Math.round(v * 10) / 10;

export function driveSpec(a) {
  const D = a.lab?.drive;
  if (!D) return null;
  const base = { type: D.type, pace: a.lab.pace, gait: a.lab.gait };
  if (D.type === 'goto') return { ...base, x: r1(D.x), z: r1(D.z) };
  if (D.type === 'follow') return { ...base, dot: D.dot, keep: D.keep };
  if (D.shape === 'drawn') return { ...base, shape: 'drawn', mode: D.mode, pts: (D.src ?? []).map((p) => [r1(p.x), r1(p.z)]) };
  return { ...base, shape: D.shape, size: D.size, mode: D.mode };
}

export function snapshot(game, driver) {
  const W = game.world;
  return {
    v: 1, tank: game.tankId, ground: L.ground.value, depth: L.depth.value, rate: L.rate.value,
    animals: W.animals.all.map((a) => ({ sp: a.sp, x: r1(a.pos.x), y: r1(a.pos.y), z: r1(a.pos.z), yaw: r1(a.yaw ?? 0), drive: driveSpec(a) })),
    dots: [...driver.dots.values()].map((d) => ({ id: d.id, kind: d.kind, x: r1(d.x), z: r1(d.z), speed: d.speed })),
  };
}
