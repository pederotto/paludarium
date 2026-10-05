import fs from 'node:fs';
const F = process.argv[2]; let s = fs.readFileSync(F, 'utf8');
const rep = (old, neu, count = 1) => { const n = s.split(old).length - 1; if (n !== count) { console.log('MISMATCH', n, JSON.stringify(old.slice(0, 90))); process.exit(2); } s = s.split(old).join(neu); };
const NEED = `      if (need > 0) { if (kind === 'flick' || h + need > (kind === 'swim' ? top - Math.max(a.pos.y, y1) - 0.5 : d)) continue; h += need; }\n`;
rep(NEED, NEED + `      // the whole arc once, as leap() will fly it (B4b: the two points above let a hop pass through thin wood): blocked, next try
      if (this.occ.count) {
        const lift = sp.kind === 'swim' || a.swimming ? 0 : 0.5;
        let px = a.pos.x, py = a.pos.y + lift, pz = a.pos.z, hit = false;
        for (let i = 1; i <= 8 && !hit; i++) {
          const t = i / 8, e = kind === 'swim' ? t * t * (3 - 2 * t) : kind === 'flick' ? 1 - (1 - t) ** 3 : t;
          const qx = a.pos.x + (x1 - a.pos.x) * e, qz = a.pos.z + (z1 - a.pos.z) * e;
          const qy = a.pos.y + (y1 - a.pos.y) * e + h * (kind === 'swim' ? Math.pow(Math.sin(Math.PI * t), 0.6) : 4 * t * (1 - t)) + lift;
          hit = this.occ.segmentFreeAt(a, px, py, pz, qx, qy, qz, 0) < 1; px = qx; py = qy; pz = qz;
        }
        if (hit) continue;
      }
`);
const LX = `    a.pos.x = H.x0 + (H.x1 - H.x0) * e; a.pos.z = H.z0 + (H.z1 - H.z0) * e;\n`;
rep(LX, `    const ox = a.pos.x, oy = a.pos.y, oz = a.pos.z;\n` + LX);
const LY = `    a.pos.y = H.y0 + (H.y1 - H.y0) * e + H.h * arc;\n`;
rep(LY, LY + `    // (B4b) a long tick cuts the arc's corners: a piece across this tick's chord ends the leap short of it
    if (this.occ.count) {
      const lift = sp.kind === 'swim' || a.swimming ? 0 : 0.5, f = this.occ.segmentFreeAt(a, ox, oy + lift, oz, a.pos.x, a.pos.y + lift, a.pos.z);
      if (f < 1) { a.pos.set(ox + (a.pos.x - ox) * f, oy + (a.pos.y - oy) * f, oz + (a.pos.z - oz) * f); a.hop = null; a.state = 'rest'; a.timer = 0.5 + Math.random(); return false; }
    }
`);
const FREE = `    const free = (nx, nz) => (this.okFor(medium, nx, nz, maxD, a.rad) || (!here && Math.hypot(nx, nz * 1.6) < Math.hypot(x, z * 1.6) - 0.02 && !solid(nx, nz))) && !this.walkBlocked(a, nx, nz);\n`;
rep(FREE, `    // (and nothing solid between here and there: a long step at the fast speeds walked through thin wood, B4b)
    const swept = (nx, nz) => !this.avoid || this.occ.segmentFreeAt(a, x, a.pos.y + 0.5, z, nx, Math.max(a.pos.y, this.world.terrain.heightAt(nx, nz)) + 0.5, nz) === 1;
` + FREE.replace('!this.walkBlocked(a, nx, nz);', '!this.walkBlocked(a, nx, nz) && swept(nx, nz);'));
const NU = `      const x = a.pos.x + dx * f, y = a.pos.y + dy * f, z = a.pos.z + dz * f;\n`;
rep(NU, NU + `      // (B4b) a push never goes through a piece: a 2.5 cm nudge carried a fleeing skink through thin wood
      const nl = sp.kind === 'swim' || a.swimming ? 0 : 0.5;
      if (this.occ.segmentFreeAt(a, a.pos.x, a.pos.y + nl, a.pos.z, x, y + nl, z) < 1) continue;
`);
const SP = `      const st = Math.min(d, a.hsp * dt);\n      a.pos.x = clamp(a.pos.x + dx / d * st, -hx, hx);\n`;
rep(SP, `      let st = Math.min(d, a.hsp * dt);
      // (B4b) a piece against the wall is stopped at, not walked through
      const sf = this.occ.segmentFreeAt(a, a.pos.x, a.pos.y + 0.5, a.pos.z, a.pos.x + dx / d * st, a.pos.y + dy / d * st + 0.5, a.pos.z);
      if (sf < 1) st *= sf;
      a.pos.x = clamp(a.pos.x + dx / d * st, -hx, hx);
`);
rep(`if (this.okFor(medium, nx, nz, 5, a.rad) && !this.bumps(a, nx, nz)) {`, `if (this.okFor(medium, nx, nz, 5, a.rad) && !this.bumps(a, nx, nz) && this.occ.segmentFreeAt(a, a.pos.x, a.pos.y + 0.5, a.pos.z, nx, Math.max(a.pos.y, this.world.terrain.heightAt(nx, nz)) + 0.5, nz) === 1) {`, 2);
fs.writeFileSync(F, s); console.log('patched');
