// What the selected animal is doing, as rows for the panel. Read-only: nothing here changes an animal.

import { SPECIES, one } from '../sim/animals.js';

const deg = (r) => `${((((r ?? 0) * 180) / Math.PI) % 360 + 360) % 360 | 0}°`;
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '—');

// The name of the mind's current mode, whichever mind the species has (they keep it in different places).
export function modeOf(a) {
  return a.hm?.mode ?? a.sk?.mode ?? a.cb?.mode ?? a.fs ?? a.state ?? '—';
}

// What the drive is doing, as rows: the goal, laps, how far off the line, how far it went and how fast, against what it was given.
function driveRows(a) {
  const L = a.lab, D = L?.drive;
  if (!D) return [];
  const S = L.stats, g = L.goal;
  const rows = [['drive', D.type === 'path' ? `${D.shape} · ${D.mode}` : D.type === 'follow' ? `follow ${D.dot} (keep ${D.keep} cm)` : D.type]];
  if (g) rows.push(['goal', `${f1(g.x)}, ${f1(g.z)}  (${f1(Math.hypot(g.x - a.pos.x, g.z - a.pos.z))} cm away)`]);
  else rows.push(['goal', D.done ? 'arrived' : 'none']);
  if (D.type === 'path') { rows.push(['laps', `${D.laps}  ·  waypoint ${D.i}/${D.pts.length}`]); if (S?.xteN) rows.push(['off the line', `mean ${f1(S.xteSum / S.xteN)}  max ${f1(S.xteMax)} cm`]); }
  if (S?.t > 1) rows.push(['walked', `${f1(S.dist)} cm in ${f1(S.t)} s  =  ${f1(S.dist / S.t)} cm/s`]);
  return rows;
}

export function readout(a) {
  const sp = SPECIES[a.sp];
  const where = a.wallMode || a.onWall ? 'on the wall' : a.swimming || sp.kind === 'swim' ? 'swimming' : a.hop ? 'in a hop' : a.perch ? 'perched' : a.stranded ? 'stranded' : 'on the ground';
  return {
    name: sp.name, id: a.id, sp: a.sp, kind: sp.kind,
    rows: [
      ['kind', sp.kind],
      ['mode', String(modeOf(a))],
      ['doing', a.doing ? String(a.doing) : '—'],
      ['where', where],
      ['speed', `${f1(a.speedNow)} cm/s`],
      ['table speed', `${f1(sp.speed)} cm/s`],
      ['position', `${f1(a.pos.x)}, ${f1(a.pos.y)}, ${f1(a.pos.z)} cm`],
      ['heading', deg(a.yaw)],
      ['legs', a.stepping > 0 ? 'stepping' : 'still'],
      ...driveRows(a),
    ],
  };
}

export function census(animals) {
  const n = {};
  for (const a of animals.all) n[a.sp] = (n[a.sp] ?? 0) + 1;
  return Object.entries(n).map(([id, c]) => ({ id, name: one(id), n: c })).sort((p, q) => q.n - p.n);
}
