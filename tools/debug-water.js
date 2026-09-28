// Used by `node tools/test.cjs --script=tools/debug-water.js`: reports the
// state of the water simulation (main pool, pools, falls, the basin under
// a few points) and, with `&cam=x,y,z,tx,ty,tz` in the query, moves the
// camera there for the screenshot.
(() => {
  const w = window.paludarium, H = w.water.hydro, f = w.terrain.field;
  const q = new URLSearchParams(location.search);
  const cam = q.get('cam');
  if (cam) window.paludariumUI.controls.setLookAt(...cam.split(',').map(Number), false);
  const out = [];
  out.push(`level ${H.level.toFixed(2)} resVol ${(H.resVol / 1000).toFixed(2)} L total ${(H.total() / 1000).toFixed(2)} L pump ${H.pump.running} flow ${H.flowOut.toFixed(1)} cm3/s`);
  for (const p of H.pools) out.push(`pool ${p.cells.length} cells ${p.litres.toFixed(2)} L level ${p.level.toFixed(2)}`);
  for (const f2 of H.falls) out.push(`fall q=${f2.q.toFixed(1)} w=${f2.width.toFixed(1)} from ${f2.from.toArray().map((v) => v.toFixed(1))} to ${f2.to.toArray().map((v) => v.toFixed(1))}`);
  for (const [x, z] of (q.get('probe') ?? '-25,-13;-3,-11;32,-15').split(';').map((s) => s.split(',').map(Number))) {
    const n = H.cellOf(x, z);
    const b = H.basin(n);
    out.push(`probe ${x},${z}: h=${f.h[n].toFixed(2)} d=${H.d[n].toFixed(2)} res=${H.res[n]} basin level=${b?.level.toFixed(2)} cells=${b?.cells.length} spill=${b ? H.cellXZ(b.spillCell).map((v) => v.toFixed(1)) : '-'}`);
  }
  // Height (and water) map around a window: x0,x1,z0,z1.
  const win = (q.get('win') ?? '-14,6,-18,-2').split(',').map(Number);
  for (let z = win[2]; z <= win[3]; z += 1) {
    let row = `${String(z).padStart(4)} `;
    for (let x = win[0]; x <= win[1]; x += 1) {
      const n = H.cellOf(x, z);
      row += (f.h[n].toFixed(0).padStart(3)) + (H.res[n] ? '~' : H.d[n] > 0.3 ? '*' : H.d[n] > 0.05 ? '.' : ' ');
    }
    out.push(row);
  }
  console.warn('HYDRO\n' + out.join('\n'));
})();
