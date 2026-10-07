// Taps on the canvas: the animal under the pointer, and the point on the ground, wall or water surface it is over.
// The same ray tests as editor/controller.js pick, without the editor's state.

import * as THREE from 'three/webgpu';

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();

export function rayAt(game, e) {
  const r = game.renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, game.camera);
  return ray;
}

export function animalAt(game, e, reach = 2.2) {
  return game.world.animals.pick(rayAt(game, e).ray, reach);
}

// { point, surface: 'terrain' | 'wall' | 'water', normal } or null. `wall`: the background counts too (a gecko climbs it).
export function groundAt(game, e, { wall = false, water = true } = {}) {
  const W = game.world;
  const r = rayAt(game, e);
  const objs = [W.terrain.mesh, ...W.decor.meshes];
  if (wall) objs.push(W.wall.mesh);
  const hits = r.intersectObjects(objs, false);
  if (!hits.length) return null;
  const hit = hits[0];
  let surface = hit.object.userData.surface ?? 'terrain';
  if (hit.object.name === 'piece') surface = 'terrain';
  const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
  if (water && surface !== 'wall') {
    const s = W.water.surfaceAt(hit.point.x, hit.point.z, 0.2);
    if (s > hit.point.y + 0.05 && r.ray.direction.y < -0.01) {
      const t = (s - r.ray.origin.y) / r.ray.direction.y;
      const q = r.ray.at(t, new THREE.Vector3());
      if (t > 0 && t < hit.distance) return { point: q, surface: 'water', normal: new THREE.Vector3(0, 1, 0), ground: hit.point.clone() };
    }
  }
  return { point: hit.point.clone(), surface, normal };
}

// A tap is a press and release that stay put and are quick; anything else is the camera being turned.
export function onTap(el, fn) {
  let down = null;
  el.addEventListener('pointerdown', (e) => { if (e.button === 0) down = { x: e.clientX, y: e.clientY, t: e.timeStamp }; else down = null; });
  el.addEventListener('pointermove', (e) => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) >= 6) down = null; });
  el.addEventListener('pointerup', (e) => {
    const d = down; down = null;
    if (d && e.timeStamp - d.t < 500) fn(e);
  });
  el.addEventListener('pointercancel', () => { down = null; });
}

// The obstacle (items of obstacles.js) whose piece the pointer is over, or null: for sending a climbing frog up an object by tapping it.
export function pieceAt(game, e, items) {
  const hit = rayAt(game, e).intersectObjects(game.world.decor.meshes, true)[0];
  for (let o = hit?.object; o; o = o.parent) { const it = items.find((i) => i.piece && i.piece.mesh === o); if (it) return it; }
  return null;
}
