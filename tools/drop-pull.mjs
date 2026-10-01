// Turns files sent through the Paludarium Drop page into real files in art-src/drop/.
//
//   node tools/drop-pull.mjs <dir> [--out=art-src/drop]
//
// <dir> is where the page's store was saved (ArtifactData read with out_dir): a
// manifest at drops/<id>.json and its parts at drops/<id>/parts/<i>.json. For every
// manifest still marked "waiting" the parts are joined, decoded, checked against the
// byte count and SHA-256 the browser recorded, and written under their original name.
// Prints one JSON line per file; exits 1 if any file failed its check.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const out = (args.find((a) => a.startsWith('--out=')) ?? '--out=art-src/drop').slice(6);
if (!dir || !fs.existsSync(path.join(dir, 'drops'))) {
  console.error('usage: node tools/drop-pull.mjs <dir containing drops/> [--out=art-src/drop]');
  process.exit(2);
}

// A saved document may be the fields themselves or wrapped as { data: {...}, version }.
const load = (f) => { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return j && typeof j.data === 'object' && j.data ? j.data : j; };

fs.mkdirSync(out, { recursive: true });
let bad = 0;
for (const f of fs.readdirSync(path.join(dir, 'drops')).filter((n) => n.endsWith('.json')).sort()) {
  const m = load(path.join(dir, 'drops', f));
  if (!m.name || m.status !== 'waiting') continue;
  const res = { id: m.id, name: m.name, kind: m.kind, note: m.note || '', bytes: m.bytes };
  try {
    const partDir = path.join(dir, 'drops', m.id, 'parts');
    const bufs = [];
    for (let i = 0; i < m.chunks; i++) bufs.push(Buffer.from(load(path.join(partDir, `${i}.json`)).b64, 'base64'));
    const buf = Buffer.concat(bufs);
    if (buf.length !== m.bytes) throw new Error(`size ${buf.length}, expected ${m.bytes}`);
    const sum = crypto.createHash('sha256').update(buf).digest('hex');
    if (m.sha256 && sum !== m.sha256) throw new Error('sha-256 mismatch');
    const dest = path.join(out, path.basename(m.name));
    fs.writeFileSync(dest, buf);
    Object.assign(res, { ok: true, dest, verified: !!m.sha256 });
  } catch (e) {
    bad++;
    Object.assign(res, { ok: false, error: String(e.message || e) });
  }
  console.log(JSON.stringify(res));
}
process.exit(bad ? 1 : 0);
