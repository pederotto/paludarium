// Starting a game from the title screen reuses the title screen's tank (Game.restartTank) instead of rebuilding it:
// the same world object, no shader builds, and a state equal to a freshly built starter tank. Prints PASS or FAIL lines.
//   node tools/shot.mjs --steps=tools/steps/restart.mjs --only=desktop
export default async (page, shot) => {
  const ok = (name, pass, detail = '') => console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  await page.evaluate(() => {
    window.__builds = 0; window.__w0 = window.game.world;
    const be = window.game.renderer.backend, make = be.createNodeBuilder.bind(be);
    be.createNodeBuilder = (o, r) => { const nb = make(o, r), build = nb.build.bind(nb); nb.build = function () { window.__builds++; return build(); }; return nb; };
  });
  const shows = await page.evaluate(() => window.game.showcase);
  ok('the title tank is marked as the showcase', shows === true);
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3000);
  const s = await page.evaluate(() => {
    const g = window.game, W = g.world;
    return { same: W === window.__w0, builds: window.__builds, showcase: g.showcase, tank: g.tankId, screen: window.__S.screen.value, births: W.stats.births, deaths: W.stats.deaths,
      animals: Object.values(W.animals.by).reduce((n, a) => n + a.length, 0), plants: W.plants.list.length, pieces: W.decor.serialize().length, logs: W.logs.map((l) => l.msg.slice(0, 20)), day: W.env.day, undo: W.undoStack.length };
  });
  console.log(JSON.stringify(s));
  ok('it is the same world object', s.same);
  ok('no shaders were built to start the game', s.builds <= 5, `${s.builds} builds`);
  ok('the showcase flag is cleared', s.showcase === false);
  ok('the game started on the standard tank', s.tank === 'standard' && s.screen === 'play');
  ok('counters start at zero', s.births === 0 && s.deaths === 0);
  ok('the layout is the starter tank (106 animals, 51 plants, 21 pieces)', s.animals === 106 && s.plants === 51 && s.pieces === 21);
  ok('one welcome line, day 1, nothing to undo', s.logs.length === 1 && s.logs[0].startsWith('Welcome') && s.day === 0 && s.undo === 0, JSON.stringify(s.logs));
  await shot('restart-play');
  ok('no page errors', !(await page.evaluate(() => (window.__errs ?? []).some((e) => e.startsWith('error') || e.startsWith('uncaught')))));
};
