// MASKING CONTROL for the swimmer watchdog (R6a). Four fish in open water in the Test Lab, each PINNED: every keepFree call puts it back at its pin point
// (an unyielding collision) and sets what its mind wants:
//   cory, neon  'go'   : mind spot 6 cm away (full intent, pinned)  -> the watchdog MUST still fire (stuck decisions, then relocations)
//   loach, guppy 'hold': mind spot = here (it means to stay)         -> the base build fires (the false positive); the fix must stay quiet until HOLD_CAP (150 s), then fire once
// Counts stuck decisions (a.lastStuck changes) and relocate calls per fish and the animal time of each of the first ones. SECS = real seconds at rate 4.
//   SECS=60 node tools/shot.mjs --only=desktop --url=http://localhost:<port>/lab.html --steps=tools/steps/lab-pin-control.mjs
// Expected on the fixed build: the two 'go' fish show the same stuck decisions and relocations as an unfixed build (a real snag is still caught); the two 'hold' fish
// show ONE stuck decision at about 154 animal-s (HOLD_CAP 150 s + the 3.5 s timer) and no relocation. On an unfixed build all four fire every ~3.5 s.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  await page.waitForFunction(() => window.lab?.L.ready.value, null, { timeout: 90000 });
  page.setDefaultTimeout(900000);
  const res = await page.evaluate(async (secs) => {
    const lab = window.lab;
    await lab.apply({ v: 1, tank: 'standard', ground: 'flat', depth: 18, obstacles: [], dots: [], rate: 4,
      animals: [{ sp: 'cory', x: -10, z: 0, yaw: 0, drive: null }, { sp: 'neon', x: -4, z: 0, yaw: 0, drive: null }, { sp: 'loach', x: 4, z: 0, yaw: 0, drive: null }, { sp: 'guppy', x: 10, z: 0, yaw: 0, drive: null }] });
    lab.rate(4); lab.pause(false);
    const A = lab.game.world.animals;
    const MODE = { cory: 'go', neon: 'go', loach: 'hold', guppy: 'hold' };
    const w0 = performance.now();
    while (Object.keys(MODE).some((sp) => !A.all.some((a) => a.sp === sp && !a.dead)) && performance.now() - w0 < 60000) await new Promise((r) => setTimeout(r, 200));
    await new Promise((r) => setTimeout(r, 3000));      // (let each settle at its depth)
    const pins = new Map(), out = {};
    for (const a of A.all) if (MODE[a.sp]) { pins.set(a, { x: a.pos.x, y: a.pos.y, z: a.pos.z, mode: MODE[a.sp] }); out[a.sp] = { mode: MODE[a.sp], stuck: [], reloc: 0, t0: A.t }; }
    const keep0 = Object.getPrototypeOf(A).keepFree, rel0 = Object.getPrototypeOf(A).relocate;
    A.relocate = function (a, sp, ...rest) { const P = pins.get(a); if (P) out[a.sp].reloc++; return rel0.call(this, a, sp, ...rest); };
    A.keepFree = function (a, sp, dt) {
      const P = pins.get(a);
      if (P) {
        a.pos.set(P.x, P.y, P.z); a.vel.set(0, 0, 0);
        if (a.fm) { a.fm.goal = P.mode === 'go' ? { x: P.x + 6, z: P.z } : { x: P.x, z: P.z }; a.fm.tired = false; a.fm.fleeT = 0; }
        a.nib = null; a.dart = false;
      }
      const ls = a.lastStuck;
      const r = keep0.call(this, a, sp, dt);
      if (P && a.lastStuck !== ls) out[a.sp].stuck.push(+(A.t - out[a.sp].t0).toFixed(0));
      return r;
    };
    const t0 = performance.now();
    while (performance.now() - t0 < secs * 1000) await new Promise((r) => setTimeout(r, 250));
    delete A.keepFree; delete A.relocate;
    const held = A.stuckStats.held ?? null;
    return { out, animalSeconds: +(A.t - Math.min(...Object.values(out).map((o) => o.t0))).toFixed(0), held };
  }, +(process.env.SECS ?? 60));
  console.log('PIN ' + JSON.stringify(res));
  for (const [sp, o] of Object.entries(res.out)) console.log(`PIN ${sp.padEnd(6)} ${o.mode.padEnd(4)} stuck decisions ${String(o.stuck.length).padStart(3)} relocations ${String(o.reloc).padStart(3)}  first stuck at animal-s ${o.stuck.slice(0, 6).join(', ')}`);
};
