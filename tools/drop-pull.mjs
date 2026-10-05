// Turns files sent through the Paludarium Drop page into real files in art-src/drop/.
//
//   node tools/drop-pull.mjs <dir> [--assets=<dir>] [--out=art-src/drop]
//
// <dir> is where the page's store was saved (ArtifactData list with out_dir): a manifest at drops/<id>.json. Two kinds:
//   via "assets" (videos, web images): `pieces` [{ id, bytes, sha256 }], each an asset of the artifact, fetched with the
//     Artifact tool (action read, path = the piece id) into --assets=<dir>, where each lands as <id>.<ext>.
//   db parts (everything else, and files sent before v4): drops/<id>/parts/<i>.json, saved with out_dir like the manifest.
// For every manifest still marked "waiting" the pieces or parts are checked (byte count and SHA-256 the browser
// recorded), joined and written under the file's original name. Prints one JSON line per file; exits 1 if any file
// failed its check. For each file that passed, mark its manifest received with ONE ArtifactData update, which the Drop
// page acts on by deleting the pieces or parts itself (it compares the hashes with what was sent):
//   assets: { status: "pulled", pulledPieces: <the "pieces" hashes printed here>, pulledBytes, pulledAt }
//   parts:  { status: "pulled", pulledSha256: <the "sha256" printed here>, pulledBytes, pulledAt }

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const out = (args.find((a) => a.startsWith('--out=')) ?? '--out=art-src/drop').slice(6);
const assetDir = (args.find((a) => a.startsWith('--assets=')) ?? '--assets=').slice(9);
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
    if (m.via === 'assets') {
      // Pieces are checked one by one and appended, so a long video never sits in memory whole.
      if (!assetDir) throw new Error('pieces need --assets=<dir> (Artifact read of each piece id)');
      const have = fs.readdirSync(assetDir);
      const dest = path.join(out, path.basename(m.name)), tmp = dest + '.part';
      fs.writeFileSync(tmp, '');
      let total = 0;
      for (const [i, q] of m.pieces.entries()) {
        const fn = have.find((n) => n === q.id || n.startsWith(q.id + '.'));
        if (!fn) throw new Error(`piece ${i + 1} of ${m.pieces.length} (${q.id}) not in ${assetDir}`);
        const buf = fs.readFileSync(path.join(assetDir, fn));
        if (buf.length !== q.bytes) throw new Error(`piece ${i + 1}: size ${buf.length}, expected ${q.bytes}`);
        if (crypto.createHash('sha256').update(buf).digest('hex') !== q.sha256) throw new Error(`piece ${i + 1}: sha-256 mismatch`);
        fs.appendFileSync(tmp, buf);
        total += buf.length;
      }
      if (total !== m.bytes) { fs.rmSync(tmp); throw new Error(`size ${total}, expected ${m.bytes}`); }
      fs.renameSync(tmp, dest);
      Object.assign(res, { ok: true, dest, verified: true, pieces: m.pieces.map((q) => q.sha256) });
      console.log(JSON.stringify(res));
      continue;
    }
    const partDir = path.join(dir, 'drops', m.id, 'parts');
    const bufs = [];
    for (let i = 0; i < m.chunks; i++) bufs.push(Buffer.from(load(path.join(partDir, `${i}.json`)).b64, 'base64'));
    const buf = Buffer.concat(bufs);
    if (buf.length !== m.bytes) throw new Error(`size ${buf.length}, expected ${m.bytes}`);
    const sum = crypto.createHash('sha256').update(buf).digest('hex');
    if (m.sha256 && sum !== m.sha256) throw new Error('sha-256 mismatch');
    const dest = path.join(out, path.basename(m.name));
    fs.writeFileSync(dest, buf);
    Object.assign(res, { ok: true, dest, verified: !!m.sha256, sha256: sum });
  } catch (e) {
    fs.rmSync(path.join(out, path.basename(m.name)) + '.part', { force: true });
    bad++;
    Object.assign(res, { ok: false, error: String(e.message || e) });
  }
  console.log(JSON.stringify(res));
}
process.exit(bad ? 1 : 0);
