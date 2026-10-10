// Releasing animals into the lab arena through the game's own placement rules (Animals.placement), so an animal that cannot
// live at a spot is refused with the game's reason, and one that can is added exactly as the Add tool adds it.

import * as THREE from 'three/webgpu';
import { SPECIES } from '../sim/animals.js';

const GOLDEN = 2.399963;

// Where the k-th of n animals goes round `at`: a sunflower spiral, so any number fit and none start inside another.
export function spiral(k, spacing) {
  if (k === 0) return [0, 0];
  const r = spacing * Math.sqrt(k), a = k * GOLDEN;
  return [Math.cos(a) * r, Math.sin(a) * r];
}

// Species the lab offers, grouped by how they move (the kind), the way the readout names it.
export function speciesList() {
  const out = [];
  for (const [id, sp] of Object.entries(SPECIES)) if (sp.kind !== 'egg') out.push({ id, name: sp.name, kind: sp.kind });
  const order = ['frog', 'toad', 'newt', 'axolotl', 'gecko', 'skink', 'crab', 'crawlLand', 'crawlWater', 'swim', 'fly'];
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.name.localeCompare(b.name));
}

// Release `n` of species `id` round `hit` ({ point, surface }). Returns { added: [animals], error? }.
export function spawn(game, id, n, hit) {
  const A = game.world.animals, sp = SPECIES[id];
  if (!sp) return { added: [], error: `No species ${id}.` };
  const pl = A.placement(id, hit, { lab: true });
  if (pl.error) return { added: [], error: pl.error };
  const spacing = Math.max(1.6, 1.6 * sp.size);
  const added = [];
  for (let k = 0; k < n; k++) {
    let again = pl;
    if (!pl.wall) {
      const [dx, dz] = spiral(k, spacing);
      again = A.placement(id, { point: new THREE.Vector3(hit.point.x + dx, hit.point.y, hit.point.z + dz), surface: hit.surface }, { lab: true });
      if (again.error) continue;       // (outside the tank, or not where this species lives)
    }
    const a = A.add(id, again.pos, { morph: null });
    if (!a) break;                     // (the species' cap)
    if (pl.wall) { a.onWall = true; a.wallMode = true; a.normal = new THREE.Vector3(0, 0, 1); }
    added.push(a);
  }
  return { added, error: added.length ? null : `Could not place ${sp.name.toLowerCase()} there.` };
}
