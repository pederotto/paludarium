// Flower head close-ups in the LIVE flower renderer (src/render/flowers.js, drawn by the portrait renderer
// engine/portraits.js with live: true), bloom forced open (or any STAGE). Unlike flowering-look.mjs (previewGeometry merges
// the flowers into static geometry, so patterns never show there) this shows palettes, pattern codes and translucency as
// the game draws them. The first head of the plant is framed from each VIEW: front = along its facing (+Y of the head),
// side = its local +X, tq = three-quarter.
// Dev server only (it imports /src modules):
//   npx vite --port 4492 --strictPort --host 127.0.0.1
//   IDS=dracula,cuthbertsonii node tools/shot.mjs --url=http://127.0.0.1:4492/ --only=desktop \
//     --steps=tools/steps/plant-head.mjs --out=test-output/heads [--query=?webgl]
//   IDS=a,b        species ids from sim/plants.js PLANTS (default dracula)
//   PALETTE=k      colour form k (default 0); portraits draw palette 0 only, so form k is copied into slot 0 in the page
//   CODES=c,..     instead of PALETTE: 10+k = colour form k; 0..4 = set every form's pattern code (1 spots, 2 net,
//                  3 veins, 4 sparkle) in the page only
//   VIEWS=front,side,tq (default all three)   R=n framing radius in head units (default 6; smaller = closer)
//   STAGES=stage:t,..  bloom stage and time per picture (default open:0.5). Check a bud and a half-open flower too
//                  (e.g. bud:0.9,opening:0.5): petal vertices behind the head's origin fold into loose shards there.
// Writes <out>/plant-head-<id>-c<code>-<view>-<stage><t>.png. Stamp per picture:
//   STAMP plant-head <git sha of the cwd tree[-dirty]> <id> code view stage headTris heads backend
// (headTris = triangles of one head built by PLANTS[id].flower.build; heads = flower instances the renderer drew; 0 or
// NO PORTRAIT means no flower was drawn and the picture does not count).
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const sha = () => {
  try {
    const run = (c) => execSync(c, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return run('git rev-parse --short HEAD') + (run('git status --porcelain --untracked-files=no') ? '-dirty' : '');
  } catch { return 'no-git'; }
};

export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  const out = (process.argv.find((a) => a.startsWith('--out=')) ?? '--out=test-output').slice(6);
  fs.mkdirSync(out, { recursive: true });
  const tree = sha();
  const codes = (process.env.CODES || String(10 + +(process.env.PALETTE || 0))).split(',').map(Number);
  for (const id of (process.env.IDS || 'dracula').split(','))
    for (const st of (process.env.STAGES || 'open:0.5').split(','))
      for (const code of codes)
        for (const view of (process.env.VIEWS || 'front,side,tq').split(',')) {
          const [stage, bt] = st.split(':');
          const r = await page.evaluate(async ({ id, code, view, stage, bt, R }) => {
            const { PLANTS } = await import('/src/sim/plants.js');
            const { Portraits } = await import('/src/engine/portraits.js');
            const { Builder } = await import('/src/render/geo.js');
            const def = PLANTS[id];
            if (!def?.flower) return { err: 'no flowering plant ' + id };
            const ps = def.flower.palettes;
            window.__plantHeadOrig ??= {};
            window.__plantHeadOrig[id] ??= ps.map((p) => [...p]);
            const orig = window.__plantHeadOrig[id];
            orig.forEach((p, i) => { ps[i] = [...p]; });                       // undo the previous picture's change
            if (code >= 10) ps[0] = [...orig[Math.min(code - 10, orig.length - 1)]]; else for (const p of ps) p[3] = code;
            const gb = new Builder(); def.flower.build(gb);
            const tris = gb.build().attributes.position.count / 3;
            const P = new Portraits({ live: true });
            await (P.ready ??= P.init());
            let q = null, drawn = 0;
            const df = P.plants.drawFlowers.bind(P.plants);                   // count the heads the renderer really drew
            P.plants.drawFlowers = (i, ...a) => { const v = df(i, ...a); if (i === id) drawn = Math.max(drawn, P.plants.flowers?.[i]?.n ?? 0); return v; };
            const add = P.plants.add.bind(P.plants), frame = P.frame.bind(P);
            P.plants.add = (...a) => { q = add(...a); if (q) q.bloom = { stage, t: +bt, palette: 0, j: 0.5, k: 1, why: null }; return q; };
            P.frame = (box, dir, pad) => {                                   // frame the first head, not the whole plant
              const h = P.plants.headsOf(q)[0], s = q._s ?? 1, Q = q._q.clone().multiply(h.q);
              const c = h.local.clone().multiplyScalar(s).applyQuaternion(q._q).add(q.pos), Rr = (R || 6) * s * h.s;
              const Y = c.clone().set(0, 1, 0).applyQuaternion(Q), X = c.clone().set(1, 0, 0).applyQuaternion(Q);
              const f = (view === 'side' ? X : view === 'tq' ? Y.clone().add(X.multiplyScalar(0.9)) : Y).normalize();
              return frame(box.clone().setFromCenterAndSize(c.clone().addScaledVector(Y, Rr * 0.2), c.clone().set(2 * Rr, 2 * Rr, 2 * Rr)), f, pad);
            };
            P.cache?.clear?.();
            let url = await P.get('plant', id);
            if (!drawn) { P.cache?.clear?.(); await new Promise((res) => setTimeout(res, 1500)); url = await P.get('plant', id); }
            const be = window.game?.renderer?.backend;
            return { url, tris, heads: drawn,
              backend: be ? (be.isWebGLBackend ? 'webgl2' : 'webgpu') : (/webgl/.test(location.search) ? 'webgl2?' : 'webgpu?') };
          }, { id, code, view, stage, bt, R: +(process.env.R || 0) });
          if (r.err) { console.log('STAMP plant-head', tree, id, 'ERROR', r.err); break; }
          const file = path.join(out, `plant-head-${id}-c${code}-${view}-${stage}${bt}.png`);
          if (r.url) fs.writeFileSync(file, Buffer.from(r.url.split(',')[1], 'base64'));
          console.log('STAMP plant-head', tree, id, 'code', code, view, stage, bt, 'headTris', r.tris, 'heads', r.heads, r.backend, r.url ? file : 'NO PORTRAIT');
        }
};
