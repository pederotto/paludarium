// The metrics collector plugin (tools/metrics-collector.mjs): the endpoint the page posts to, the recorder source it serves, the
// injection into index.html, and that it never writes outside its folder. Driven with fake requests, no server.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { metricsCollector } from '../tools/metrics-collector.mjs';

function setup(opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pal-metrics-'));
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'diag'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist', 'index.html'), '<!doctype html>\n<html><head><meta charset="utf-8"><title>x</title></head><body></body></html>');
  fs.writeFileSync(path.join(root, 'src', 'diag', 'boot.js'), '// boot');
  fs.writeFileSync(path.join(root, 'secret.js'), 'nope');
  const logs = [];
  const plugin = metricsCollector({ dir: path.join(root, 'rec'), log: (m) => logs.push(m), ...opts });
  plugin.configResolved({ root, build: { outDir: 'dist' } });
  const mw = plugin._handler('preview');
  // Runs one request through the middleware; resolves with what the response got (or 'next' when it passed).
  const call = (method, url, body = null, ip = '192.168.0.23') => new Promise((resolve) => {
    const req = new EventEmitter(); Object.assign(req, { method, url, socket: { remoteAddress: '::ffff:' + ip }, destroy() {} });
    const res = { writeHead(code, headers) { this.code = code; this.headers = headers; return this; }, end(b) { resolve({ code: this.code, headers: this.headers, body: b === undefined ? '' : String(b) }); } };
    mw(req, res, () => resolve('next'));
    if (body !== null) { req.emit('data', Buffer.from(body)); req.emit('end'); }
  });
  return { root, plugin, call, logs, files: () => (fs.existsSync(path.join(root, 'rec', 'sessions')) ? fs.readdirSync(path.join(root, 'rec', 'sessions')) : []) };
}
const line = (o) => JSON.stringify(o);

test('GET /__metrics says there is a collector', async () => {
  const { call } = setup();
  const r = await call('GET', '/__metrics');
  assert.equal(r.code, 200);
  assert.deepEqual(Object.keys(JSON.parse(r.body)).sort(), ['name', 'now', 'ok']);
  assert.equal(JSON.parse(r.body).ok, true);
});

test('a POST is appended to a file named after the time, the label and the session', async () => {
  const { call, files, root, logs } = setup();
  const env = line({ sid: 'abc123', k: 'env', label: 'snapdragon', t0: 100 }), sec = line({ sid: 'abc123', k: 'sec', list: [{ s: 0, n: 60, g95: 17 }] });
  const r = await call('POST', '/__metrics', env + '\n' + sec + '\n');
  assert.equal(r.code, 204);
  const f = files();
  assert.equal(f.length, 1);
  assert.match(f[0], /^\d{8}-\d{6}_snapdragon_abc123\.ndjson$/);
  assert.equal(fs.readFileSync(path.join(root, 'rec', 'sessions', f[0]), 'utf8'), env + '\n' + sec + '\n');
  assert.ok(logs.some((l) => l.includes('new recording abc123 (snapdragon) from 192.168.0.23')), logs.join('|'));
  await call('POST', '/__metrics', line({ sid: 'abc123', k: 'ev', list: [{ t: 1, n: 'end' }] }));
  assert.equal(files().length, 1, 'later batches go to the same file');
  assert.equal(fs.readFileSync(path.join(root, 'rec', 'sessions', f[0]), 'utf8').split('\n').filter(Boolean).length, 3);
  assert.ok(logs.some((l) => l.includes('abc123 finished')));
});

test('garbage, other sessions and bad ids are not written', async () => {
  const { call, files, root } = setup();
  assert.equal((await call('POST', '/__metrics', 'not json\n')).code, 400);
  assert.equal((await call('POST', '/__metrics', line({ sid: '../../etc', k: 'env' }))).code, 400);
  assert.equal((await call('POST', '/__metrics', line({ sid: 'x', k: 'env' }))).code, 400, 'too short an id');
  assert.equal(files().length, 0);
  const r = await call('POST', '/__metrics', ['{broken', line({ sid: 'good1', k: 'env', label: 'a/b\\c ../' }), line({ sid: 'other', k: 'ev', list: [] }), line({ sid: 'good1', k: 'ev', list: [] }), line({ sid: 'good1' })].join('\n'));
  assert.equal(r.code, 204);
  const f = files();
  assert.equal(f.length, 1);
  assert.match(f[0], /_abc\.\.\.?_good1\.ndjson$|_abc[.\w-]*_good1\.ndjson$/, 'the label is cleaned of separators: ' + f[0]);
  assert.ok(!f[0].includes('/') && !f[0].includes('\\'));
  const kept = fs.readFileSync(path.join(root, 'rec', 'sessions', f[0]), 'utf8').split('\n').filter(Boolean);
  assert.equal(kept.length, 2, 'only the valid lines of the first session');
});

test('a session that goes on after a restart continues in its own file', async () => {
  const a = setup();
  await a.call('POST', '/__metrics', line({ sid: 'resume1', k: 'env', label: 'x' }));
  const file = a.files()[0];
  const plugin2 = metricsCollector({ dir: path.join(a.root, 'rec'), log: () => {} });
  plugin2.configResolved({ root: a.root, build: { outDir: 'dist' } });
  const mw2 = plugin2._handler('preview');
  await new Promise((resolve) => {
    const req = new EventEmitter(); Object.assign(req, { method: 'POST', url: '/__metrics', socket: { remoteAddress: '1.2.3.4' }, destroy() {} });
    mw2(req, { writeHead() { return this; }, end: resolve }, () => resolve());
    req.emit('data', Buffer.from(line({ sid: 'resume1', k: 'ev', list: [] }))); req.emit('end');
  });
  assert.deepEqual(a.files(), [file]);
  assert.equal(fs.readFileSync(path.join(a.root, 'rec', 'sessions', file), 'utf8').split('\n').filter(Boolean).length, 2);
});

test('the recorder source is served from src/diag, and nothing else is', async () => {
  const { call } = setup();
  const ok = await call('GET', '/__metrics/diag/boot.js');
  assert.equal(ok.code, 200); assert.equal(ok.body, '// boot'); assert.match(ok.headers['content-type'], /javascript/);
  for (const bad of ['/__metrics/diag/..%2f..%2fsecret.js', '/__metrics/diag/boot.json', '/__metrics/diag/missing.js', '/__metrics/diag/sub/boot.js']) {
    assert.equal((await call('GET', bad)).code, 404, bad);
  }
  // A literal ../ is collapsed by URL parsing into /secret.js before the handler sees it: it is not ours, so it falls through.
  for (const dots of ['/__metrics/diag/../../secret.js', '/__metrics/diag/%2e%2e/secret.js']) assert.equal(await call('GET', dots), 'next', dots);
});

test('index.html gets the recorder first in <head> when the address asks for it, and only then', async () => {
  const { call } = setup();
  assert.equal(await call('GET', '/'), 'next', 'a plain page is left to the static server');
  const r = await call('GET', '/?metrics=laptop&bench');
  assert.equal(r.code, 200); assert.match(r.headers['content-type'], /html/);
  assert.match(r.body, /<head><script type="module" src="\/__metrics\/diag\/boot\.js"><\/script>\s*<meta charset/);
  assert.equal(await call('GET', '/assets/index.js?metrics'), 'next', 'only pages');
  assert.equal((await call('GET', '/index.html?metrics')).code, 200);
});

test('always mode injects every page load, unless the address says nometrics', async () => {
  const { call } = setup({ inject: 'always' });
  assert.equal((await call('GET', '/')).code, 200);
  assert.equal(await call('GET', '/?nometrics'), 'next');
});

test('the dev server variant injects through transformIndexHtml, and a build is never touched', () => {
  const { plugin } = setup();
  const h = plugin.transformIndexHtml.handler;
  assert.equal(h('<html>', { originalUrl: '/?metrics' }), undefined, 'no server: the build');
  assert.equal(h('<html>', { server: {}, originalUrl: '/' }), undefined);
  const tags = h('<html>', { server: {}, originalUrl: '/?metrics=a' });
  assert.equal(tags[0].tag, 'script'); assert.equal(tags[0].attrs.src, '/__metrics/diag/boot.js'); assert.equal(tags[0].injectTo, 'head-prepend');
});

test('an oversized body is refused', async () => {
  const { call, files } = setup();
  const r = await call('POST', '/__metrics', 'x'.repeat(17 * 1024 * 1024));
  assert.equal(r.code, 413);
  assert.equal(files().length, 0);
});
