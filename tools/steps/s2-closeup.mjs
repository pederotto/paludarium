// S2 pilot: one animal at 5 cm and 15 cm, sim paused, side-on to its heading, interface hidden. ANIMAL=hillloach (default).
import { pickTool } from './_tools.mjs';
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  const errors = []; page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); }); page.on('pageerror', (e) => errors.push('pageerror ' + e.message.slice(0, 160)));
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3000);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  const id = process.env.ANIMAL ?? 'hillloach';
  const info = await page.evaluate(async (id) => {
    const g = window.game, W = g.world, ref = W.animals.by.neon?.[0] ?? W.animals.all[0];
    g.setSpeed(1);
    const a = W.animals.add(id, ref.pos.clone().add({ x: 1, y: 0, z: 1 }), { age: 1e6 });
    return { ok: !!a, keys: a ? Object.keys(a).slice(0, 40).join(',') : '' };
  }, id);
  console.log('S2-CLOSEUP stamp', id, JSON.stringify(info));
  await page.waitForTimeout(2500);
  const models = await page.evaluate(async (id) => { const g = window.game; return { loaded: !!g.world.animals.models?.[id], loading: g.world.animals.modelsLoading }; }, id);
  console.log('model', JSON.stringify(models));
  for (const d of [5, 15]) {
    const r = await page.evaluate(([id, d, process_top]) => {
      const g = window.game, a = g.world.animals.by[id]?.[0];
      if (!a) return null;
      g.setSpeed(0);
      const p = a.pos, yaw = a.yaw ?? a.heading ?? (a.vel ? Math.atan2(a.vel.x, a.vel.z) : 0);
      // the camera on the animal's right-hand side, level with it, looking at it
      const sx = Math.cos(yaw), sz = -Math.sin(yaw);
      g.rig.stopOrbit(); g.rig.moved = true;
      if (process_top) g.controls.setLookAt(p.x + 0.001, p.y + d, p.z + 0.25 * d, p.x, p.y, p.z, false); else g.controls.setLookAt(p.x + sx * d, p.y + d * 0.12, p.z + sz * d, p.x, p.y, p.z, false);
      return { yaw: +yaw.toFixed(2), x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1) };
    }, [id, d, !process.env.SIDE]);
    await page.waitForTimeout(1200);
    console.log('closeup', d, JSON.stringify(r));
    await shot(`pilot-${id}-${d}cm`);
  }
  console.log('S2-CLOSEUP console errors:', errors.length, JSON.stringify(errors.slice(0, 4)));
};
