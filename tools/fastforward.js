// Used by `node tools/test.cjs --script=tools/fastforward.js`: runs the
// simulation for several game days (moving animals in small steps) and
// prints a daily report to the console.
(() => {
  const w = window.paludarium;
  const report = [];
  for (let day = 0; day < 8; day++) {
    for (let k = 0; k < 1440 / 5; k++) {
      w.sim.step(5);
      w.animals.move(0.25);
    }
    const c = Object.fromEntries(Object.entries(w.animals.by).map(([k, v]) => [k, v.length]));
    const e = w.env;
    report.push(`day ${day + 1}: T=${e.temp.toFixed(1)} RH=${e.humidity.toFixed(0)} NH3=${e.ammonia.toFixed(2)} NO2=${e.nitrite.toFixed(2)} NO3=${e.nitrate.toFixed(0)} O2=${e.oxygen.toFixed(1)} det=${e.detritus.toFixed(1)} plants=${JSON.stringify(w.plants.list.reduce((o,p)=>(o[p.id]=(o[p.id]??0)+1,o),{}))} ${JSON.stringify(c)}`);
  }
  console.warn('FF\n' + report.join('\n') + '\n' + w.logs.slice(0, 12).map((l) => l.t + ' ' + l.msg).join('\n'));
})();
