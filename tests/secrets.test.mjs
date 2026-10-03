// The secret guard (tools/check-secrets.mjs): nothing tracked looks like a key, .env stays ignored, and the patterns
// catch real-looking keys while leaving placeholders alone. Fake keys are assembled at run time so this file is clean itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { badName, scanText, scanTracked, scanDist } from '../tools/check-secrets.mjs';

const fill = (n, s = 'aB3dE6gH9k') => s.repeat(Math.ceil(n / s.length)).slice(0, n);
const FAKE = {
  github: 'gh' + 'p_' + fill(36),
  anthropic: 'sk-' + 'ant-api03-' + fill(40),
  aws: 'AK' + 'IA' + 'QWERTYUIOPASDFGH',
  google: 'AI' + 'za' + fill(35),
  key: '-----BEGIN ' + 'RSA PRIVATE KEY-----',
};

test('no tracked file is a key file or holds a secret', () => {
  const problems = scanTracked();
  assert.deepEqual(problems, [], problems.map((p) => `${p.file}:${p.line ?? ''} ${p.what}`).join('\n'));
});

test('git ignores .env files but not .env.example', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const ignored = (f) => { try { execFileSync('git', ['check-ignore', '-q', '--no-index', f], { cwd: root }); return true; } catch { return false; } };
  assert.ok(ignored('.env'));
  assert.ok(ignored('.env.local'));
  assert.ok(ignored('.env.production'));
  assert.ok(!ignored('.env.example'));
});

test('key files are refused by name', () => {
  for (const f of ['.env', '.env.local', 'tools/.env.production', 'server.pem', 'id_ed25519', 'deploy.key', 'credentials.json']) assert.ok(badName(f), f);
  for (const f of ['.env.example', 'src/app/env.js', 'keyboard.js', 'public/assets/manifest.json']) assert.equal(badName(f), null, f);
});

test('real-looking keys are caught', () => {
  for (const [kind, k] of Object.entries(FAKE)) assert.equal(scanText(`const k = '${k}';`).length, 1, kind);
  assert.equal(scanText(`fetch('https://bob:${fill(12)}@example.org/x')`).length, 1);
  assert.equal(scanText(`const apiKey = "${fill(24)}";`).length, 1);
  assert.equal(scanText(`{ "password": "${fill(10)}" }`).length, 1);
  assert.equal(scanText(`line one\nline two ${FAKE.github}`)[0].line, 2);
});

test('placeholders, env reads and the build-safe mode do not raise false alarms', () => {
  for (const s of [
    "const apiKey = process.env.API_KEY;",
    'const apiKey = "your-key-here";',
    'password: "${{ secrets.DB_PASSWORD }}"',
    'git push "https://x-access-token:${{ secrets.GITHUB_TOKEN }}@github.com/o/r.git"',
    'API_KEY=<paste it here>',
    'const E = game.world.env; E.secret = 1;',
    'const sk = "sk-short";',
    `const apiKey = "${fill(24)}"; // secrets-ok`,
  ]) assert.deepEqual(scanText(s), [], s);
  assert.deepEqual(scanText(`const apiKey = "${fill(24)}";`, { loose: false }), []);      // minified code is checked for token formats only
  assert.equal(scanText(FAKE.github, { loose: false }).length, 1);
});

test('the build is checked for key files and for values copied out of a local .env', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pal-secrets-'));
  fs.writeFileSync(path.join(dir, 'index.js'), `console.log(1)`);
  assert.deepEqual(scanDist(dir), []);
  fs.writeFileSync(path.join(dir, 'chunk.js'), `const t="${FAKE.github}"`);
  fs.writeFileSync(path.join(dir, '.env'), 'X=1');
  const found = scanDist(dir).map((p) => path.basename(p.file)).sort();
  assert.deepEqual(found, ['.env', 'chunk.js']);
  fs.rmSync(dir, { recursive: true, force: true });
});
