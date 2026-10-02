// Serves the built game (dist/) to other computers on the network, with the metrics collector on and the recorder injected into
// every page, so opening the printed address on a laptop is enough: a small REC chip appears, the player plays, and the numbers
// arrive here in metrics/sessions/ (read them with `npm run metrics:report`). See docs/METRICS.md.
//
//   npm run metrics:serve                       http, port 4192
//   npm run metrics:serve -- --https            https with a self-made certificate: the browser warns once ("Advanced", "Proceed"),
//                                               and then the page is a secure context, so the game runs on WebGPU as it does on
//                                               GitHub Pages. Plain http gives the WebGL 2 fallback, a different picture.
//   options: --port=4192  --outDir=dist  --build (build first)  --inject=always|param (param: only addresses with ?metrics)
import { build, preview } from 'vite';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (k) => args.includes(`--${k}`);
const arg = (k, d = '') => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const port = +arg('port', 4192), outDir = path.resolve(root, arg('outDir', 'dist'));
process.env.PALUDARIUM_METRICS = arg('inject', 'always');

const lan = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);

// A certificate for this computer's addresses, made once and kept (metrics/ is not in git), remade when the address changes.
function certificate() {
  const dir = path.join(root, 'metrics', 'cert'), key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem'), ips = path.join(dir, 'ips.txt');
  const want = ['127.0.0.1', ...lan].join(',');
  if (!(fs.existsSync(cert) && fs.existsSync(key) && fs.existsSync(ips) && fs.readFileSync(ips, 'utf8') === want)) {
    fs.mkdirSync(dir, { recursive: true });
    const san = ['DNS:localhost', ...want.split(',').map((a) => 'IP:' + a)].join(',');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '365', '-subj', '/CN=paludarium-lan', '-addext', `subjectAltName=${san}`], { stdio: 'ignore' });
    fs.writeFileSync(ips, want);
    console.log('made a certificate for', want);
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

if (flag('build') || !fs.existsSync(path.join(outDir, 'index.html'))) { console.log('building…'); await build({ root, logLevel: 'warn' }); }
const https = flag('https') ? certificate() : undefined;
const server = await preview({ root, logLevel: 'warn', build: { outDir }, preview: { host: true, port, strictPort: true, open: false, https } });
const scheme = https ? 'https' : 'http';
console.log(`\nPaludarium with the metrics recorder, serving ${path.relative(root, outDir) || '.'} (${process.env.PALUDARIUM_METRICS === 'always' ? 'recorder in every page' : 'recorder with ?metrics only'})`);
console.log('Open one of these on the other computer (same Wi-Fi):');
for (const a of lan) console.log(`  ${scheme}://${a}:${port}/`);
console.log(`  ${scheme}://localhost:${port}/   (this computer)`);
if (https) console.log('The browser says the connection is not private: choose Advanced, then Proceed. The page is then a secure context (WebGPU).');
else console.log('This is plain http: no WebGPU there, the game runs on the WebGL 2 fallback. Use --https to test the WebGPU path.');
console.log(`Recordings arrive in ${path.relative(root, path.join(root, 'metrics', 'sessions'))}/ ; read them with: npm run metrics:report\n`);
process.on('SIGINT', async () => { await server.close(); process.exit(0); });
