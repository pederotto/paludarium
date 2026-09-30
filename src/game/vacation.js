// The Vacation test: fast-forward the tank for a number of days with no manual
// care, only the player's automation running, and report what happened. It does
// not need the renderer: it advances the simulation directly, yielding to the
// event loop once per simulated day so the page stays responsive.

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

export async function runVacation(world, days = 7, { onProgress } = {}) {
  const E = world.env;
  const start = { minute: E.minute, deaths: world.stats.deaths, births: world.stats.births };
  const series = { temp: [], humidity: [], ammonia: [], nitrate: [], oxygen: [] };
  const deaths = [];
  const stressCounts = {};
  let lastDeaths = world.stats.deaths;
  for (let day = 0; day < days; day++) {
    for (let h = 0; h < 24; h++) {
      // Animals keep moving while the clock runs (as at 20x speed): they seek damp, warm spots and find food.
      for (let k = 0; k < 6; k++) { world.sim.step(10); for (let j = 0; j < 5; j++) world.animals.move(0.2); }
      series.temp.push(E.temp); series.humidity.push(E.humidity); series.ammonia.push(E.ammonia); series.nitrate.push(E.nitrate); series.oxygen.push(E.oxygen);
      if (h % 6 === 0) for (const arr of Object.values(world.animals.by)) for (const a of arr) for (const w of a.why ?? []) stressCounts[w] = (stressCounts[w] ?? 0) + 1;
      if (world.stats.deaths > lastDeaths) {
        for (let k = lastDeaths; k < world.stats.deaths; k++) deaths.push({ day: day + 1, note: world.logs.find((l) => /died/.test(l.msg))?.msg ?? 'an animal died' });
        lastDeaths = world.stats.deaths;
      }
    }
    onProgress?.((day + 1) / days, day + 1);
    await new Promise((r) => setTimeout(r, 0));
  }
  const rules = world.equipment.trace.filter((t) => t.m >= start.minute);
  const total = Object.values(world.animals.by).reduce((s, a) => s + a.length, 0);
  const sick = Object.values(world.animals.by).flat().filter((a) => a.health < 0.5).length;
  const verdict = deaths.length === 0 && sick === 0 ? 'Thriving' : deaths.length === 0 ? 'Fine' : deaths.length <= 2 ? 'Struggling' : 'Disaster';
  const range = (a) => [Math.min(...a), Math.max(...a)];
  const tips = [];
  const [tmin, tmax] = range(series.temp), [hmin, hmax] = range(series.humidity);
  if (hmax - hmin > 25) tips.push(`Humidity swung ${Math.round(hmin)}–${Math.round(hmax)}%. A fogger or rain rule with a tighter band would smooth it.`);
  if (hmin < 70) tips.push('The air got dry. Add a rain or fogger rule triggered when humidity falls below your target.');
  if (tmax > 28) tips.push(`It reached ${tmax.toFixed(1)} °C. A fan rule for high temperature, or a cooling unit, would help.`);
  if (tmin < 18) tips.push(`It fell to ${tmin.toFixed(1)} °C. Check the heater.`);
  const worstStress = Object.entries(stressCounts).sort((a, b) => b[1] - a[1])[0];
  if (worstStress) tips.push(`Most common stress: ${worstStress[0]}.`);
  if (Math.max(...series.ammonia) > 0.3) tips.push('Ammonia rose while you were away: a smaller feeding, more plants or a stronger filter would help.');
  if (!world.equipment.rules.length && verdict !== 'Thriving') tips.push('You have no automation rules. Buy the controller and write one for humidity.');
  if (!tips.length) tips.push('Nothing to fix: well built.');
  return {
    days, verdict, deaths, births: world.stats.births - start.births, animals: total, sick,
    ranges: { temp: [tmin, tmax], humidity: [hmin, hmax], ammonia: range(series.ammonia), nitrate: range(series.nitrate), oxygen: range(series.oxygen) },
    means: { temp: mean(series.temp), humidity: mean(series.humidity) },
    series, controllerFirings: rules.slice(-20), tips,
  };
}
