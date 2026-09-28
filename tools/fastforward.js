// Used by `node tools/test.cjs --script=tools/fastforward.js`: runs the
// simulation for several game days (moving animals in small steps) and
// prints a daily report to the console. With `&newtank` in the query it
// first sets up a new tank (sculpted, watered, planted, no animals) to
// watch it cycle, bloom and settle.
(() => {
  const w = window.paludarium;
  const V = w.terrain.mesh.position.constructor;
  const q = new URLSearchParams(location.search);
  const days = +(q.get('days') ?? 24);
  if (q.has('newtank')) {
    w.empty();
    const f = w.terrain.field;
    for (let j = 0; j <= f.ny; j++) for (let i = 0; i <= f.nx; i++) {
      const [x, z] = f.toWorld(i, j);
      f.base[f.idx(i, j)] = 3 + Math.max(0, -z - 2) * 1.1 + Math.max(0, Math.abs(x) - 25) * 0.5;
    }
    w.groundChanged();
    w.water.setPump(0, 15);
    w.setWaterLevel(10);
    w.water.addOutlet(new V(0, 40, w.wall.zAt(0, 40) + 0.6), true);
    for (let k = 0; k < 30; k++) w.wall.field.brush(0, 32, 5, 'paint', 1, { mat: 4 });
    w.groundChanged();
    const put = (id, n, test) => { for (let k = 0; k < n; k++) { const p = w.randomSpot(test); if (p) w.plants.add(id, p, { normal: w.terrain.normalAt(p.x, p.z), grown: 0.4 }); } };
    put('fernph', 4, (x, y, z, s) => s === -Infinity && y > 12);
    put('grass', 4, (x, y, z, s) => s === -Infinity && y > 10.5);
    put('vallisneria', 5, (x, y, z, s) => s - y > 5);
    put('javafern', 2, (x, y, z, s) => s - y > 3);
  }
  const report = [];
  for (let day = 0; day < days; day++) {
    for (let k = 0; k < 1440 / 5; k++) {
      w.sim.step(5);
      w.animals.move(0.25);
      if (k % 12 === 0) w.water.animate(0.1, 1);
    }
    const c = Object.fromEntries(Object.entries(w.animals.by).filter(([, v]) => v.length).map(([k, v]) => [k, v.length]));
    const e = w.env;
    const plants = w.plants.list.reduce((o, p) => ((o[p.id] = (o[p.id] ?? 0) + 1), o), {});
    report.push(`day ${day + 1} [${w.sim.eco.stage}] T=${e.temp.toFixed(1)} RH=${e.humidity.toFixed(0)} NH3=${e.ammonia.toFixed(2)} NO2=${e.nitrite.toFixed(2)} NO3=${e.nitrate.toFixed(0)} O2=${e.oxygen.toFixed(1)} cyc=${e.cycle.toFixed(2)} algae=${e.algae.toFixed(2)} diat=${e.diatoms.toFixed(2)} moss=${(w.mossFraction() * 100).toFixed(1)}% water=${w.water.volumeLitres().toFixed(1)}L plants=${JSON.stringify(plants)} ${JSON.stringify(c)}`);
  }
  console.warn('FF\n' + report.join('\n') + '\n' + w.logs.slice(0, 14).map((l) => l.t + ' ' + l.msg).join('\n'));
})();
