// Pool of module workers that mesh bodies in the background (mesh.worker.js). requestBody(def, detail) resolves to a
// BufferGeometry identical to bodyGeometry(def, detail). Falls back to the main thread (deferred, one macrotask) when
// Workers are unavailable, a worker fails, or the def has no id (legacy defs).
import { geometryFromArrays } from './mesher.js';
import { bodyArrays } from './shape.js';

let workers = null, failed = false;
const pending = new Map();
const load = [];                 // outstanding jobs per worker
const home = new Map();          // species group -> worker index, so morphs of one species meet and share their shape
let nextId = 1;

function spawn() {
  if (workers || failed) return workers;
  if (typeof Worker === 'undefined') { failed = true; return null; }
  try {
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    workers = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./mesh.worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => settle(i, e.data);
      w.onerror = () => fail();
      workers.push(w); load.push(0);
    }
  } catch { fail(); }
  return workers;
}

function settle(i, { id, arrays, error }) {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id); load[i]--;
  if (error) { console.warn('[meshpool] worker failed, meshing on the main thread:', error.split('\n')[0]); p.fallback(); }
  else p.resolve(geometryFromArrays(arrays));
}

function fail() {
  failed = true;
  for (const w of workers ?? []) w.terminate();
  workers = null;
  for (const p of [...pending.values()]) p.fallback();
  pending.clear();
}

export function requestBody(def, detail) {
  return new Promise((resolve) => {
    const local = () => setTimeout(() => resolve(geometryFromArrays(bodyArrays(def, detail))), 0);
    const key = def.bodyKey;
    if (!key || !spawn()) return local();
    const group = key.split(':')[0];
    let i = home.get(group);
    if (i === undefined) { i = load.indexOf(Math.min(...load)); home.set(group, i); }
    const id = nextId++;
    pending.set(id, { resolve, fallback: local });
    load[i]++;
    workers[i].postMessage({ id, key, detail });
  });
}
