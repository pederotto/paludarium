// Used by `node tools/test.cjs --script=tools/frogcam.js`: pauses, lines up
// the amphibians on a patch of flat ground and frames them for a close-up.
(() => {
  const w = window.paludarium, ui = window.paludariumUI;
  ui.setSpeed(0);
  const p = w.randomSpot((x, y, z, s) => s === -Infinity && Math.abs(x) < 38 && z > -14 && w.terrain.normalAt(x, z).y > 0.85 && w.terrain.normalAt(x + 5, z).y > 0.8 && w.terrain.normalAt(x - 6, z).y > 0.8 && w.water.surfaceAt(x + 5, z) === -Infinity && w.water.surfaceAt(x - 6, z) === -Infinity, 2000);
  if (!p) { console.warn('FROGCAM no flat spot'); return; }
  const ids = ['dartfrog', 'strawberry', 'toad', 'newt', 'gecko'];
  ids.forEach((id, i) => {
    const x = p.x - 6 + i * 3;
    const a = w.animals.add(id, new p.constructor(x, w.terrain.heightAt(x, p.z), p.z));
    if (a) { a.yaw = 0.6; a.normal = w.terrain.normalAt(x, p.z); }
  });
  const q = new URLSearchParams(location.search);
  const hop = +(q.get('hop') ?? 0);
  if (hop) for (const a of w.animals.by.dartfrog) a.hop = { from: a.pos.clone(), to: a.pos.clone(), t: hop, dur: 1, h: 0 };
  w.animals.draw(0.016);
  ui.controls.setLookAt(p.x + 2, p.y + 6, p.z + 14, p.x, p.y + 0.8, p.z, false);
  console.warn(`FROGCAM at ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`);
})();
