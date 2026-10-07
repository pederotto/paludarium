// Run "sets" S2 leg 3: the new species in a running game. Add menu cards, Field guide pages, an in-game close-up of every new animal,
// console errors, and a cheap cost number (renderer calls / triangles added by 10 of a fish).
//   node tools/shot.mjs --url=$SERVER_URL --only=desktop --steps=tools/steps/s2-verify.mjs --out=<dir> [--query="?webgl"]
// Env: ANIMALS (default all new), CARDS (menu pictures), SKIPCOST=1.
import { pickTool } from './_tools.mjs';

const NEW_ANIMALS = ['tanichthys', 'zacco', 'hillloach', 'bullhead', 'bedotia', 'matanoshrimp', 'tylomelania', 'cambarellus'];
const MENU = { animal: ['Hillstream loach', 'White Cloud Mountain minnow', 'European bullhead'], plant: ['Cryptocoryne', "Bird's-nest fern", 'Silvergrass'] };

export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message.slice(0, 200)));
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3000);
  console.log('S2-VERIFY stamp', 'new species table:', await page.evaluate(async () => { const m = await import('/src/sim/animals.js'); return ['tanichthys', 'zacco', 'hillloach', 'bullhead', 'bedotia', 'matanoshrimp', 'tylomelania', 'cambarellus'].filter((i) => m.SPECIES[i]).length + '/8'; }));

  // 1. Add menu cards, then Field guide pages.
  for (const tab of ['animal', 'plant']) {
    await pickTool(page, tab, { wait: 500 });
    for (const label of MENU[tab]) {
      const ok = await page.evaluate((label) => {
        const el = [...document.querySelectorAll('.opts .pick')].find((e) => e.textContent.includes(label));
        if (!el) return false;
        el.scrollIntoView({ block: 'center', inline: 'center' });
        return true;
      }, label);
      await page.waitForTimeout(1500);   // portraits are files: wait for the <img>
      const pic = await page.evaluate((label) => { const el = [...document.querySelectorAll('.opts .pick')].find((e) => e.textContent.includes(label)); const i = el?.querySelector('img'); return i ? i.complete && i.naturalWidth : -1; }, label);
      console.log(`menu ${tab} "${label}": card ${ok ? 'found' : 'MISSING'}, picture width ${pic}`);
      if (ok) await shot(`ui-menu-${tab}-${label.replace(/\W+/g, '-').toLowerCase()}`);
    }
  }
  for (const key of ['animal:hillloach', 'animal:bullhead', 'plant:crypt', 'plant:nidus']) {
    try {
      await page.evaluate(async (k) => { const s = await import('/src/ui/store.js'); s.openModal('codex', k); }, key);
      await page.waitForTimeout(1500);
      await shot(`ui-guide-${key.replace(':', '-')}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    } catch (e) { console.log('guide', key, 'failed', e.message.slice(0, 120)); }
  }

  // 2. In-game close-ups: add one animal beside a neon, pause, look at it from a near camera.
  await page.addStyleTag({ content: '#ui{display:none!important}' });
  const ids = (process.env.ANIMALS ?? NEW_ANIMALS.join(',')).split(',');
  for (const id of ids) {
    const r = await page.evaluate(async (id) => {
      const g = window.game, W = g.world, { SPECIES } = await import('/src/sim/animals.js');
      const ref = W.animals.by.neon?.[0] ?? W.animals.by.shrimp?.[0] ?? W.animals.all[0];
      if (!ref) return { ok: false, why: 'no reference animal' };
      g.setSpeed(1);
      const a = W.animals.add(id, ref.pos.clone().add({ x: 1, y: 0, z: 1 }), { age: 1e6 });
      return { ok: !!a, size: SPECIES[id].size, uid: a?.id };
    }, id);
    if (!r.ok) { console.log('close', id, 'not added', r.why ?? ''); continue; }
    await page.waitForTimeout(1200);
    const look = await page.evaluate(async (id) => {
      const { SPECIES } = await import('/src/sim/animals.js');
      const g = window.game, a = g.world.animals.by[id]?.[0];
      if (!a) return null;
      g.setSpeed(0);
      const p = a.pos, d = Math.max(3.5, 2.4 * SPECIES[id].size * (SPECIES[id].scale ?? 1) + 2);
      g.rig.stopOrbit(); g.rig.moved = true;
      g.controls.setLookAt(p.x + d * 0.3, p.y + d * 0.2, p.z + d, p.x, p.y, p.z, false);
      return { x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1) };
    }, id);
    await page.waitForTimeout(900);
    console.log('close', id, JSON.stringify(look));
    await shot(`close-${id}`);
    await page.evaluate(() => window.game.setSpeed(1));
  }

  // 3. Cost: renderer calls / triangles added by 10 of a kind (cumulative readings).
  if (!process.env.SKIPCOST) {
    const cost = await page.evaluate(async (order) => {
      const g = window.game, W = g.world, out = [];
      const info = () => { const i = g.gfx?.renderer?.info ?? g.renderer?.info; const r = i?.render ?? {}; return { calls: r.drawCalls ?? r.calls, tris: r.triangles }; };
      const ref = W.animals.by.neon?.[0] ?? W.animals.all[0];
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      g.setSpeed(1);
      await wait(1500);
      out.push(['base', info()]);
      for (const id of order.split(',')) {
        for (let k = 0; k < 10; k++) W.animals.add(id, ref.pos.clone().add({ x: (k % 5) * 0.4 - 1, y: 0, z: Math.floor(k / 5) * 0.4 }), { age: 1e6 });
        await wait(2500);
        out.push([id + ' +10', info()]);
      }
      return out;
    }, process.env.COSTORDER ?? 'neon,tanichthys,zacco,hillloach,bullhead');
    for (const [k, v] of cost) console.log('cost', k, JSON.stringify(v));
  }
  console.log('S2-VERIFY console errors:', errors.length, JSON.stringify(errors.slice(0, 5)));
};
