// N15 preset check, part 1 (build): builds every premade set on its reference tank for seeds 1-3 and reports, per build,
// the plants and animals placed, which of them the set does not list (must be none), and whether the featured animal is
// in the tank. Stamp: the generator report's `featured` field (added by N15) and the served HEAD.
// Part 2 (batch 3) adds the state-dump runs: 3 seeds x 2 game days, water/solids/pile/stuck, featured in range.
//   PRESETS=cascade,jar SEEDS=1,2,3 sh "$BB/tools/probe.sh" N15 node tools/shot.mjs --url=http://127.0.0.1:4672/ --only=desktop --steps=tools/steps/preset-check.mjs --wait=2500
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.waitForFunction(() => window.game, null, { timeout: 90000 });
  page.setDefaultTimeout(1800000);
  const only = (process.env.PRESETS ?? '').split(',').filter(Boolean);
  const seeds = (process.env.SEEDS ?? '1,2,3').split(',').map(Number);
  const res = await page.evaluate(async ({ only, seeds }) => {
    const gen = await import('/src/sim/generator.js');
    const game = window.game;
    const ids = only.length ? only : gen.PRESET_ORDER;
    const out = [];
    for (const id of ids) {
      const P = gen.PRESETS[id];
      for (const seed of seeds) {
        const w = await game.loadTank(P.ref, { layout: 'empty' });
        const r = gen.generateTerrarium(w, { preset: id, seed, tier: P.ref });
        const plants = {};
        for (const p of w.plants.list) plants[p.id ?? p.type ?? p.sp?.id] = (plants[p.id ?? p.type ?? p.sp?.id] ?? 0) + 1;
        const animals = r.animals;
        const strayP = Object.keys(plants).filter((k) => P.plants && !P.plants.includes(k));
        const strayA = Object.keys(animals).filter((k) => P.animals && !P.animals.includes(k));
        const featured = (r.featured ?? []).map((f) => `${f}:${animals[f] ?? 0}`);
        out.push({ id, seed, tier: P.ref, stamp: r.featured ? 'N15' : 'none', featured, strayP, strayA, litres: r.litres, nPlants: w.plants.list.length, plants, animals, warnings: r.warnings?.length ?? 0 });
      }
    }
    return out;
  }, { only, seeds });
  const { execSync } = await import('node:child_process');
  let head = '?';
  try { head = execSync('git rev-parse --short HEAD').toString().trim() + (execSync('git status --porcelain src').toString().trim() ? ' dirty' : ''); } catch { /* no git */ }
  console.log(`preset-check build, HEAD ${head}`);
  let bad = 0;
  for (const r of res) {
    const miss = r.featured.some((f) => f.endsWith(':0'));
    if (r.strayP.length || r.strayA.length || miss || r.stamp !== 'N15') bad++;
    console.log(`${r.id} s${r.seed} ${r.tier} stamp=${r.stamp} featured=${r.featured.join(',')} litres=${r.litres} nPlants=${r.nPlants} strayPlants=${r.strayP.join(',') || 0} strayAnimals=${r.strayA.join(',') || 0} plants=${JSON.stringify(r.plants)} animals=${JSON.stringify(r.animals)}`);
  }
  console.log(`builds ${res.length}, failing ${bad}; errors: ${errors.length ? [...new Set(errors)].slice(0, 5).join(' | ') : 'none'}`);
};

// ---- Part 2: behaviour screen (node CLI, one state-dump run per set through the probe gate) ------------------------------
//   BB="$BB" node tools/steps/preset-check.mjs --screen [--sets=a,b] [--seed=1] [--days=1] [--url=http://127.0.0.1:4672/]
// Per set: tools/steps/state-dump-run.mjs on the set's reference tank, then tools/steps/state-counters.mjs summary. Fails on:
// a water species out of water (< 99 % of rows in water), a land/wall species in water (> 5 % of rows, > 25 % if its
// habitats.js maxDepth is 1 cm or more: shallow-pool walkers), any inSolid row, an awake pile, a stuck episode, or a featured
// species alive at the start and dead at the end. Temperature/RH are not in the dump yet: not checked here.
async function screen() {
  const { spawnSync, execSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const { PRESETS, PRESET_ORDER } = await import('../../src/content/presets.js');
  const { HABITAT } = await import('../../src/content/habitats.js');
  const { parseDump, summary, PILE_OVERLAP } = await import('./state-counters.mjs');
  const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
  const sets = arg('sets', '') ? arg('sets', '').split(',') : PRESET_ORDER.filter((id) => !PRESETS[id].hidden);
  const seed = arg('seed', '1'), days = arg('days', '1'), url = arg('url', 'http://127.0.0.1:4672/');
  let head = '?';
  try { head = execSync('git rev-parse --short HEAD').toString().trim() + (execSync('git status --porcelain src').toString().trim() ? ' dirty' : ''); } catch { /* no git */ }
  console.log(`preset-check screen, HEAD ${head}, seed ${seed}, game days ${days}, sets ${sets.length}, pile = overlap ${PILE_OVERLAP} x mean real length`);
  const pct = (v) => `${Math.round(v * 100)} %`;
  let failing = 0;
  for (const id of sets) {
    const P = PRESETS[id];
    const cmd = ['tools/steps/state-dump-run.mjs', `--preset=${id}`, `--tier=${P.ref}`, `--seed=${seed}`, `--days=${days}`, '--out=test-output/state/n15/', `--url=${url}`];
    const t0 = Date.now();
    const r = process.env.BB ? spawnSync('sh', [`${process.env.BB}/tools/probe.sh`, 'N15', 'node', ...cmd], { encoding: 'utf8', maxBuffer: 1e8 })
      : spawnSync('node', cmd, { encoding: 'utf8', maxBuffer: 1e8 });
    const m = /wrote (\S+\.jsonl)/.exec(r.stdout ?? '');
    if (!m) { failing++; console.log(`${id} ${P.ref} FAIL no dump (exit ${r.status}) ${String(r.stderr ?? '').trim().slice(-160)}`); continue; }
    const d = parseDump(fs.readFileSync(m[1], 'utf8'));
    const s = summary(d.rows, d.hdr, d.end);
    const fails = [];
    for (const [sp, q] of Object.entries(s.species)) {
      const H = HABITAT[sp] ?? {};
      if (H.zone === 'water' && q.water < 0.99) fails.push(`${sp} out of water ${pct(1 - q.water)}`);
      if ((H.zone === 'land' || H.zone === 'wall') && q.water > ((H.maxDepth ?? 0) >= 1 ? 0.25 : 0.05)) fails.push(`${sp} in water ${pct(q.water)}`);
    }
    const at0 = new Set(d.rows.filter((x) => x.t === 0).map((x) => x.sp));
    const alive = new Set((d.end?.alive ?? []).map((x) => String(x).replace(/-\d+$/, '')));
    for (const f of P.featured) if (at0.has(f) && !alive.has(f)) fails.push(`featured ${f} died`);
    const noRows = P.featured.filter((f) => !s.species[f]);
    if (s.inSolid.rows) fails.push(`inSolid ${s.inSolid.rows} rows (${s.inSolid.animals} animals)`);
    if (s.pileAwake.count) fails.push(`pile ${s.pileAwake.count}`);
    if (s.stuck.count) fails.push(`stuck ${s.stuck.count} (longest ${s.stuck.maxDur} s)`);
    if (d.end?.thrown) fails.push(`thrown ${d.end.thrown}`);
    if (fails.length) failing++;
    const sp = Object.entries(s.species).map(([k, q]) => `${k}:${q.count}/w${pct(q.water)}`).join(' ');
    console.log(`${id} ${P.ref} ${fails.length ? 'FAIL' : 'pass'} rows=${d.rows.length} wall=${Math.round((Date.now() - t0) / 1000)}s ${fails.join('; ')}${noRows.length ? ` [no rows: ${noRows.join(',')}]` : ''}${P.blockedBy ? ` [blockedBy ${P.blockedBy.join(',')}]` : ''} | ${sp}`);
  }
  console.log(`screen: ${sets.length} sets, failing ${failing}`);
}
if (process.argv.includes('--screen')) await screen();
