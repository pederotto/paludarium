// Save slots in IndexedDB (localStorage is too small for several tanks).
// Worlds are gzip-compressed when the browser supports it.

const DB = 'paludarium', STORE = 'kv';

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => res(out?.result);
    t.onerror = () => rej(t.error);
  });
}

async function pack(obj) {
  const text = JSON.stringify(obj);
  if (typeof CompressionStream === 'undefined') return text;
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return await new Response(stream).blob();
}
async function unpack(v) {
  if (typeof v === 'string') return JSON.parse(v);
  const stream = v.stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

export const Saves = {
  async put(key, obj) { const data = await pack(obj); await tx('readwrite', (s) => s.put(data, key)); },
  async get(key) {
    const v = await tx('readonly', (s) => s.get(key));
    return v ? unpack(v) : null;
  },
  async del(key) { await tx('readwrite', (s) => s.delete(key)); },
  async keys() { return (await tx('readonly', (s) => s.getAllKeys())) ?? []; },
  async has(key) { return (await this.keys()).includes(key); },
};

// Small metadata records (title screen "Continue" card) are kept in localStorage.
export const Meta = {
  get() { try { return JSON.parse(localStorage.getItem('paludarium.meta') ?? 'null'); } catch { return null; } },
  set(m) { try { localStorage.setItem('paludarium.meta', JSON.stringify(m)); } catch { /* blocked */ } },
};
