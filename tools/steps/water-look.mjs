// Pictures of the pump circuit: each filter kind, the pump switched off and on.
export default async (page, shot, name) => {
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(4000);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  const look = async (label, pos, tgt, prep) => {
    await page.evaluate(([p, t, f]) => {
      const g = window.game; if (f) (0, eval)(f)(g);
      g.world.plumbing.t = 99; g.rig.stopOrbit(); g.rig.moved = true; g.controls.setLookAt(...p, ...t, false);
    }, [pos, tgt, prep ? prep.toString() : null]);
    await page.waitForTimeout(1800);
    await shot('wl-' + label);
  };
  const wide = [0, 40, 95], wt = [0, 12, -10];
  await look('sponge', wide, wt, (g) => { g.world.env.filterKind = 'sponge'; });
  await look('matten', wide, wt, (g) => { g.world.env.filterKind = 'matten'; });
  await look('matten-close', [-30, 22, 40], [-44, 6, 5]);
  await look('canister', wide, wt, (g) => { g.world.env.filterKind = 'canister'; g.world.env.prefilter = true; });
  await look('pump-off', wide, wt, (g) => { g.world.water.hydro.pump.on = false; });
};
