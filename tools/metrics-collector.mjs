// The metrics collector, as a Vite plugin: part of `vite dev` and `vite preview` (see vite.config.js), so a game opened from
// another computer can report what it sees on its own screen. It adds, to whichever server runs:
//   POST /__metrics          NDJSON lines from the page's recorder (src/diag/sink.js); appended to metrics/sessions/<time>_<label>_<id>.ndjson
//   GET  /__metrics          { ok: true, name }: how a page finds out there is a collector
//   GET  /__metrics/diag/*   the recorder's source (src/diag), so a build that does not contain it can be recorded too
//   GET  /  (preview only)   the build's index.html with the recorder injected, when the address has ?metrics (or always, with
//                            PALUDARIUM_METRICS=always, which `npm run metrics:serve` sets)
// It is a development tool for a trusted network: no authentication, and it only ever writes inside the recordings folder.
import fs from 'node:fs';
import path from 'node:path';

export const NAME = 'paludarium-metrics';
const MAX_BODY = 16 * 1024 * 1024;
const SID = /^[a-z0-9]{4,24}$/i;
const DIAG_FILE = /^[\w.-]+\.js$/;
const SCRIPT = '<script type="module" src="/__metrics/diag/boot.js"></script>';

const stamp = (d = new Date()) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
const clean = (s) => String(s ?? '').replace(/[^\w.-]/g, '').slice(0, 24);

// `dir`: where recordings go (default <project>/metrics, or $PALUDARIUM_METRICS_DIR). `inject`: 'param' | 'always'.
export function metricsCollector({ dir, inject = process.env.PALUDARIUM_METRICS === 'always' ? 'always' : 'param', log = process.env.PALUDARIUM_METRICS_QUIET === '1' ? () => {} : console.log } = {}) {
  let root = process.cwd(), outDir = path.join(root, 'dist');
  const out = () => path.resolve(dir ?? process.env.PALUDARIUM_METRICS_DIR ?? path.join(root, 'metrics'));
  const sessions = new Map();     // sid -> { file, ip, last, live }
  const rel = (f) => path.relative(root, f) || f;

  const wants = (q) => (inject === 'always' ? !q.has('nometrics') : q.has('metrics'));

  function fileFor(sid, first, ip) {
    let s = sessions.get(sid);
    if (s) return s;
    const folder = path.join(out(), 'sessions');
    fs.mkdirSync(folder, { recursive: true });
    // After a server restart a session that is still running goes on in its own file.
    const old = fs.readdirSync(folder).find((f) => f.endsWith(`_${sid}.ndjson`));
    const label = clean(first.label);
    const file = path.join(folder, old ?? `${stamp()}_${label || 'run'}_${sid}.ndjson`);
    s = { file, ip, last: 0, live: null };
    sessions.set(sid, s);
    if (!old) log(`[metrics] new recording ${sid}${label ? ' (' + label + ')' : ''} from ${ip} -> ${rel(file)}`);
    return s;
  }

  function receive(req, res) {
    const chunks = []; let size = 0, dead = false;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { dead = true; res.writeHead(413).end(); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (dead) return;
      const lines = Buffer.concat(chunks).toString('utf8').split('\n').filter((l) => l.trim());
      const good = []; let sid = null, first = null;
      for (const l of lines) {
        let o; try { o = JSON.parse(l); } catch { continue; }
        if (!o || typeof o !== 'object' || typeof o.k !== 'string' || !SID.test(String(o.sid))) continue;
        if (sid === null) { sid = String(o.sid); first = o; }
        if (String(o.sid) !== sid) continue;
        good.push(l);
        if (o.k === 'sec' && o.list?.length) { const s = sessions.get(sid); if (s) s.live = o.list[o.list.length - 1]; }
        if (o.k === 'ev' && o.list?.some((e) => e.n === 'end')) log(`[metrics] ${sid} finished`);
      }
      if (!good.length) { res.writeHead(400, { 'access-control-allow-origin': '*' }).end('no valid lines'); return; }
      const ip = String(req.socket?.remoteAddress ?? '').replace(/^::ffff:/, '');
      const s = fileFor(sid, first, ip);
      fs.appendFileSync(s.file, good.join('\n') + '\n');
      if (s.live && Date.now() - s.last > 5000) { s.last = Date.now(); const b = s.live; log(`[metrics] ${sid} (${s.ip}): ${b.n} fps, p95 ${b.g95 ?? '-'} ms, worst ${b.gx ?? '-'} ms${b.ph ? ', ' + b.ph : ''}`); }
      res.writeHead(204, { 'access-control-allow-origin': '*' }).end();
    });
    req.on('error', () => { dead = true; });
  }

  const send = (res, code, type, body, extra = {}) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'access-control-allow-origin': '*', ...extra }); res.end(body); };

  function handler(mode) {
    return (req, res, next) => {
      let url;
      try { url = new URL(req.url, 'http://x'); } catch { return next(); }
      const p = url.pathname;
      try {
        if (p === '/__metrics') {
          if (req.method === 'POST') return receive(req, res);
          if (req.method === 'OPTIONS') return send(res, 204, 'text/plain', '', { 'access-control-allow-methods': 'POST, GET', 'access-control-allow-headers': 'content-type' });
          if (req.method === 'GET') return send(res, 200, 'application/json', JSON.stringify({ ok: true, name: NAME, now: Date.now() }));
        }
        if (req.method === 'GET' && p.startsWith('/__metrics/diag/')) {
          const f = p.slice('/__metrics/diag/'.length);
          if (!DIAG_FILE.test(f)) return send(res, 404, 'text/plain', 'not found');
          const file = path.join(root, 'src', 'diag', f);
          if (!fs.existsSync(file)) return send(res, 404, 'text/plain', 'not found');
          return send(res, 200, 'text/javascript; charset=utf-8', fs.readFileSync(file));
        }
        if (mode === 'preview' && req.method === 'GET' && (p === '/' || p.endsWith('/index.html')) && wants(url.searchParams)) {
          const file = path.join(outDir, 'index.html');
          if (fs.existsSync(file)) return send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(file, 'utf8').replace(/<head[^>]*>/i, (m) => m + SCRIPT));
        }
      } catch (e) { return send(res, 500, 'text/plain', String(e?.message ?? e)); }
      next();
    };
  }

  return {
    name: NAME,
    configResolved(config) { root = config.root; outDir = path.resolve(config.root, config.build.outDir); },
    configureServer(server) { server.middlewares.use(handler('dev')); },
    configurePreviewServer(server) { server.middlewares.use(handler('preview')); },
    // The dev server builds index.html on request; the build itself is never touched (no `ctx.server` then).
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (!ctx?.server) return;
        const u = ctx.originalUrl ?? ctx.path ?? '';
        const q = new URLSearchParams(u.includes('?') ? u.slice(u.indexOf('?')) : '');
        if (wants(q)) return [{ tag: 'script', attrs: { type: 'module', src: '/__metrics/diag/boot.js' }, injectTo: 'head-prepend' }];
      },
    },
    // For tests: the handler without a server.
    _handler: handler, _recordingsDir: out,
  };
}

export default metricsCollector;
