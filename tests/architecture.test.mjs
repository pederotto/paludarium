// The layering rules of src/ (docs/DESIGN.md), checked from the import graph, so they stay true as the code grows.
//
// Every layer may import the layers listed for it and no others; the exceptions that exist today are named in KNOWN, and
// each is a piece of debt: a new violation fails this test, and so does an exception that no longer exists (delete it
// from the list when you pay it down). There must be no import cycles between modules.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

// layer -> the layers it may import (itself is always allowed). Lower layers know nothing of the ones above them.
const MAY = {
  util: [],
  content: ['util'],
  sim: ['util', 'content'],
  game: ['util', 'content', 'sim'],
  render: ['util', 'content', 'sim'],
  engine: ['util', 'content', 'sim', 'render'],
  editor: ['util', 'content', 'sim', 'render', 'engine', 'game', 'app', 'ui'],
  bench: ['util', 'content', 'sim', 'render', 'engine'],
  diag: [],   // the metrics recorder knows nothing of the game: it is handed window.game at run time (src/diag/adapter.js)
  ui: ['util', 'content', 'sim', 'render', 'engine', 'game', 'editor', 'app'],
  app: ['util', 'content', 'sim', 'render', 'engine', 'game', 'editor', 'ui'],
  lab: ['util', 'content', 'sim', 'render', 'engine', 'game', 'editor', 'ui', 'app'],   // the test lab (lab.html): a second page, on top of everything
  main: ['util', 'content', 'sim', 'render', 'engine', 'game', 'editor', 'ui', 'app', 'diag'],
};

// Debt: sim entities own their scene objects (meshes, materials, views), and two content/game modules read the species and
// plant tables that live beside the entities. Splitting views from models would pay these down.
const KNOWN = [
  'sim/plants.js -> render/geo.js', 'sim/plants.js -> render/shaders.js', 'sim/plants.js -> render/assets.js', 'sim/plants.js -> render/flowers.js',
  'sim/flowering.js -> render/geo.js',
  'sim/terrain.js -> render/shaders.js',
  'sim/sim.js -> render/fruit.js', 'sim/sim.js -> render/uniforms.js',
  'sim/world.js -> render/water.js',
  'sim/decor.js -> render/assets.js', 'sim/decor.js -> render/shaders.js', 'sim/decor.js -> render/uniforms.js',
  'sim/ecology.js -> render/uniforms.js', 'sim/ecology.js -> render/litter.js',
  'sim/animals.js -> render/geo.js', 'sim/animals.js -> render/creatures.js', 'sim/animals.js -> render/creatures/glb.js',
  'sim/animals.js -> render/creatures/instanced.js', 'sim/animals.js -> render/creatures/tongue.js',
  'content/commissions.js -> sim/animals.js', 'content/commissions.js -> sim/plants.js',
];

const layerOf = (rel) => { const top = rel.split('/')[0]; return rel.includes('/') ? top : 'main'; };
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|jsx)$/.test(e.name)) files.push(p);
  }
})(SRC);
const rel = (p) => path.relative(SRC, p).split(path.sep).join('/');

function resolve(from, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base, base + '.js', base + '.jsx', path.join(base, 'index.js'), path.join(base, 'index.jsx')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

const edges = new Map();   // file -> [imported files]
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  const out = new Set();
  for (const re of [/(?:^|\n)\s*(?:import|export)\s+(?:[^'"\n;]*?\sfrom\s+)?['"]([^'"]+)['"]/g, /import\(\s*['"]([^'"]+)['"]\s*\)/g, /import\.meta\.glob\(\s*['"]([^'"]+)['"]/g]) {
    let m;
    while ((m = re.exec(text))) { const r = resolve(f, m[1]); if (r && files.includes(r)) out.add(r); }
  }
  edges.set(f, [...out]);
}

test('every layer imports only the layers below it, apart from the named exceptions', () => {
  const found = new Set(), bad = [];
  for (const [f, list] of edges) {
    const a = layerOf(rel(f));
    for (const t of list) {
      const b = layerOf(rel(t));
      if (a === b || MAY[a].includes(b)) continue;
      const pair = `${rel(f)} -> ${rel(t)}`;
      found.add(pair);
      if (!KNOWN.includes(pair)) bad.push(pair);
    }
  }
  assert.deepEqual(bad, [], `new layering violations (see docs/DESIGN.md):\n  ${bad.join('\n  ')}`);
  const stale = KNOWN.filter((k) => !found.has(k));
  assert.deepEqual(stale, [], `these exceptions no longer exist, remove them from KNOWN:\n  ${stale.join('\n  ')}`);
});

test('util imports nothing from src (it is the bottom of the stack)', () => {
  for (const [f, list] of edges) if (layerOf(rel(f)) === 'util') assert.deepEqual(list, [], rel(f));
});

test('there are no import cycles between modules', () => {
  let idx = 0; const st = [], on = new Set(), ix = new Map(), low = new Map(), cycles = [];
  const strong = (v) => {
    ix.set(v, idx); low.set(v, idx); idx++; st.push(v); on.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!ix.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); } else if (on.has(w)) low.set(v, Math.min(low.get(v), ix.get(w)));
    }
    if (low.get(v) === ix.get(v)) { const comp = []; let w; do { w = st.pop(); on.delete(w); comp.push(rel(w)); } while (w !== v); if (comp.length > 1) cycles.push(comp); }
  };
  for (const f of files) if (!ix.has(f)) strong(f);
  assert.deepEqual(cycles, [], `import cycles: ${JSON.stringify(cycles)}`);
});
