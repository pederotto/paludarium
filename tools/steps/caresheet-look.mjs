// In-game close-ups of the care-sheet species (2026-10) in the starter paludarium: adds them where they may live, lets the
// tank run a few game hours by day (reed frogs climb to their perches, the skink hides or basks), pauses, hides the
// interface and frames each species. Also prints what each one was doing.
//   node tools/shot.mjs --url=http://localhost:4377/ --only=desktop --steps=tools/steps/caresheet-look.mjs --wait=2500
//   IDS=skink,reedfrog,…   HOURS=4
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3000);
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  const ids = (process.env.IDS ?? 'skink,reedfrog,bumblebee,panther,pygmy,cpd,blueshrimp,pandaking,marbled').split(',');
  const info = await page.evaluate(({ ids, hours, startH, hunger }) => {
    const g = window.game, w = g.world, A = w.animals, E = w.env;
    E.minute = Math.floor(E.minute / 1440) * 1440 + startH * 60;
    E.uvb = 0.5; E.basking = 0.6;
    const n = { skink: 1, reedfrog: 4, bumblebee: 4, panther: 1, pygmy: 3, cpd: 8, blueshrimp: 10, pandaking: 5, marbled: 2 };
    let s = 99;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const { TANK } = window.__tank ?? {};
    for (const id of ids) for (let i = 0; i < (n[id] ?? 2); i++) for (let k = 0; k < 300; k++) {
      const x = (rnd() - 0.5) * 70, z = (rnd() - 0.5) * 30;
      const r = A.placement(id, { point: { x, y: 0, z }, surface: 'ground' });
      if (r.pos) { A.add(id, r.pos); break; }
    }
    for (let t = 0; t < hours * 60; t++) { if (hunger != null) for (const a of A.all) if (ids.includes(a.sp)) a.hunger = Math.max(a.hunger, hunger); w.sim.step(1); A.move(0.2); }
    for (let t = 0; t < 200; t++) A.move(0.05);
    g.setSpeed(0);
    const out = {};
    for (const id of ids) out[id] = (A.by[id] ?? []).map((a) => a.si?.mode ?? a.ci?.mode ?? (a.perch ? 'perch:' + a.perch.ph : a.swimming ? 'swim' : a.fs ?? a.state)).join(',');
    return out;
  }, { ids, hours: +(process.env.HOURS ?? 4), startH: +(process.env.START ?? 9), hunger: process.env.HUNGER ? +process.env.HUNGER : null });
  console.log(JSON.stringify(info));
  const DIST = { skink: 24, panther: 14, marbled: 18, reedfrog: 10, bumblebee: 9, pygmy: 8, cpd: 7, blueshrimp: 6, pandaking: 6 };
  for (const id of ids) {
    const ok = await page.evaluate(({ id, d }) => {
      const g = window.game, list = g.world.animals.by[id];
      if (!list?.length) return false;
      const a = list.find((b) => b.perch?.ph === 'sit') ?? list[0], p = a.pos;
      g.rig.stopOrbit(); g.rig.moved = true;
      g.controls.setLookAt(p.x + d * 0.25, p.y + d * 0.3, p.z + d, p.x, p.y + 0.3, p.z, false);
      return true;
    }, { id, d: DIST[id] ?? 10 });
    await page.waitForTimeout(1200);
    if (ok) await shot('care-' + id);
  }
};
