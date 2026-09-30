// Evaluate metrics, the curator, every commission goal, events and a vacation on real tanks.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(2500);
  const rep = await page.evaluate(async () => {
    const { computeMetrics } = await import('/src/game/metrics.js');
    const { score } = await import('/src/game/curator.js');
    const { COMMISSIONS } = await import('/src/content/commissions.js');
    const { EVENTS } = await import('/src/content/events.js');
    const { EventDirector } = await import('/src/game/events.js');
    const { runVacation } = await import('/src/game/vacation.js');
    const W = window.game.world;
    const out = {};
    const m = computeMetrics(W);
    out.metricsKeys = Object.keys(m).length;
    out.stage = m.stage; out.species = m.animals.species; out.features = Object.entries(m.features).filter(([, v]) => v).map(([k]) => k);
    const s = score(W, {});
    out.curator = { overall: s.overall, grade: s.grade, parts: Object.fromEntries(Object.entries(s.parts).map(([k, p]) => [k, p.score])) };
    out.curatorNotesFailed = Object.values(s.parts).flatMap((p) => p.notes.filter((n) => !n.ok).map((n) => n.text)).slice(0, 6);
    const errs = [], goals = {};
    for (const c of Object.values(COMMISSIONS)) for (const g of c.goals) {
      try { const v = g.test(m, {}); goals[c.id] = (goals[c.id] ?? 0) + (v ? 1 : 0); g.progressText?.(m, {}); } catch (e) { errs.push(`${c.id}/${g.id}: ${e.message}`); }
    }
    out.goalsMet = Object.entries(goals).filter(([, n]) => n).map(([k, n]) => `${k}:${n}/${COMMISSIONS[k].goals.length}`);
    out.goalErrors = errs;
    // Events on the running tank.
    const ev = new EventDirector(5); const evErr = [];
    for (const e of EVENTS) { try { ev.force(W, e.id); W.sim.step(30); ev.finish(W); } catch (x) { evErr.push(e.id + ': ' + x.message); } }
    out.eventErrors = evErr;
    // A three-day vacation, reverted.
    const saved = W.serialize();
    const r = await runVacation(W, 3);
    out.vacation = { verdict: r.verdict, deaths: r.deaths.length, tips: r.tips, ranges: r.ranges };
    W.load(saved);
    out.commissionCount = Object.keys(COMMISSIONS).length;
    return out;
  });
  console.log(JSON.stringify(rep, null, 1));
};
