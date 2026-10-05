// N11c: a walker walled in by solid cells. A crab spawned in a pocket under a piece (swamp crab-0, matano panther-0, S1) found
// every step direction refused by okFor's solid test (the cell at ground + 0.5) while its own spot was not inside a solid, so
// keepFree never moved it and it stood there the whole day. A real crab crawls out of such a gap: here it is set on the nearest
// open ground within a few cm (the last resort, as before, is relocate).
export const WALLED = { dirs: 8, every: 1, maxR: 6, ring: 0.5 };   // directions tested, s between tests, cm searched, cm per ring

// Every one of `dirs` directions one `step` away is blocked.
export function walledIn(x, z, step, blocked, dirs = WALLED.dirs) {
  for (let k = 0; k < dirs; k++) { const t = (k / dirs) * Math.PI * 2; if (!blocked(x + Math.sin(t) * step, z + Math.cos(t) * step)) return false; }
  return true;
}

// The nearest point (rings of `ring` cm, 12 angles each, out to maxR) that is open and not itself walled in; null if none.
export function nearestOpen(x, z, step, open, blocked, maxR = WALLED.maxR, ring = WALLED.ring) {
  for (let r = ring; r <= maxR + 1e-9; r += ring) {
    for (let k = 0; k < 12; k++) {
      const t = (k / 12) * Math.PI * 2, px = x + Math.sin(t) * r, pz = z + Math.cos(t) * r;
      if (open(px, pz) && !walledIn(px, pz, step, blocked)) return { x: px, z: pz, r };
    }
  }
  return null;
}

// keepFree's call (animals.js): true when it moved the animal. A = the Animals instance (occ, world, okFor, relocate, stuckStats).
export function freeWalledIn(A, a, sp, dt) {
  if (!A.occ?.count || sp.kind === 'swim' || a.swimming || a.onWall || a.hop || a.wallMode || a.perch) return false;
  a.wiT = (a.wiT ?? Math.random() * WALLED.every) - dt;
  if (a.wiT > 0) return false;
  a.wiT = WALLED.every;
  const T = A.world.terrain, step = Math.max(0.15, (a.rad ?? 0.5) * 0.5);
  const blocked = (px, pz) => A.occ.solidAt(px, T.heightAt(px, pz) + 0.5, pz);
  if (!walledIn(a.pos.x, a.pos.z, step, blocked)) return false;
  const st = A.stuckStats; st.walled = (st.walled ?? 0) + 1; (st.walledBy ??= {})[a.sp] = (st.walledBy[a.sp] ?? 0) + 1;
  // (a land walker is never set down in water: water only for one already standing in it, a panther crab in its lake)
  const wet = A.world.water.surfaceAt(a.pos.x, a.pos.z) - T.heightAt(a.pos.x, a.pos.z) > 0.3;
  const p = nearestOpen(a.pos.x, a.pos.z, step, (px, pz) => A.okFor('any', px, pz, wet ? 99 : 0.3, a.rad), blocked);
  if (!p) { A.relocate(a, sp); return true; }
  a.pos.x = p.x; a.pos.z = p.z; a.pos.y = T.heightAt(p.x, p.z);
  a.target = null; a.state = 'idle'; a.anchor = null; a.stillT = 0;
  return true;
}
