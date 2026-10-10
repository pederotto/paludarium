// Orthographic views of a GLB with a coordinate grid drawn on them, for reading landmarks off a scan (snout, vent, knee, heel, eye ...) and
// measuring it against a table of proportions (docs: realism gates, gate 3). Units are the model's own: a ratio between two readings
// needs no scale. Side = looking along -x (x is the axis out of the picture, z to the right, y up), top = looking down (x right, z up),
// front = looking along -z (x right, y up).
//
//   node tools/model-ortho.mjs <a.glb> [--views=side,top,front] [--size=1200] [--grid=0.1] [--out=test-output/ortho.png] [--sat=1] [--nometal=1]
// Writes one picture per view side by side. Needs Chrome (like tools/shot.mjs). --nometal: draw the colour map on a non-metallic material (a
// generated scan with a metal map renders black without an environment).
import { chromium } from 'playwright';
import sharp from 'sharp';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const file = args.find((a) => !a.startsWith('--'));
const views = arg('views', 'side,top,front').split(','), size = +arg('size', 1200), grid = +arg('grid', 0.1), out = arg('out', 'test-output/ortho.png');
if (!file) { console.error('usage: node tools/model-ortho.mjs <a.glb> [--views=side,top,front]'); process.exit(2); }
const root = path.resolve('.');

const PAGE = `<!doctype html><meta charset=utf-8><body style="margin:0;background:#20262c">
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
const S = ${size};
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(S, S); renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#20262c');
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a96a3, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(2, 3, 2.5); scene.add(sun);
const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('/f');
if (${arg('nometal', '0')} === 1) gltf.scene.traverse((o) => { if (o.isMesh) { o.material.metalness = 0; o.material.metalnessMap = null; o.material.roughness = 0.6; o.material.roughnessMap = null; } });
scene.add(gltf.scene);
const box = new THREE.Box3().setFromObject(gltf.scene), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
window.info = { min: box.min.toArray(), max: box.max.toArray() };
const G = ${grid};
window.shoot = (view) => {
  // the picture's plane axes: u (right), v (up), and the camera's place on the third axis
  const spec = { side: { u: 2, v: 1, w: 0, up: [0, 1, 0], sgn: 1 }, top: { u: 0, v: 2, w: 1, up: [0, 0, -1], sgn: 1 }, front: { u: 0, v: 1, w: 2, up: [0, 1, 0], sgn: 1 } }[view];
  const mn = box.min.toArray(), mx = box.max.toArray();
  const su = mx[spec.u] - mn[spec.u], sv = mx[spec.v] - mn[spec.v], half = Math.max(su, sv) * 0.56;
  const cu = (mx[spec.u] + mn[spec.u]) / 2, cv = (mx[spec.v] + mn[spec.v]) / 2;
  const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.01, 100);
  const pos = [0, 0, 0]; pos[spec.u] = cu; pos[spec.v] = cv; pos[spec.w] = 10;
  cam.position.set(...pos); cam.up.set(...spec.up);
  const look = [0, 0, 0]; look[spec.u] = cu; look[spec.v] = cv; look[spec.w] = 0; cam.lookAt(...look);
  // side: looking along -x with z to the right needs a mirrored axis: the camera sits at +x looking at -x, up y: right = -z; flip with the frustum
  if (view === 'side') { cam.left = half; cam.right = -half; cam.updateProjectionMatrix(); }
  renderer.render(scene, cam);
  const cvs = document.createElement('canvas'); cvs.width = cvs.height = S;
  const g = cvs.getContext('2d'); g.drawImage(renderer.domElement, 0, 0);
  const toPx = (uu, vv) => [((uu - cu) / half * (view === 'side' ? -1 : 1) * 0.5 + 0.5) * S, (0.5 - (vv - cv) / half * 0.5) * S];
  g.font = '13px Helvetica'; g.textBaseline = 'top';
  for (let a = Math.ceil((cu - half) / G) * G; a <= cu + half; a += G) { const [x] = toPx(a, cv), major = Math.abs(Math.round(a / G) % 5) === 0; g.strokeStyle = major ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke(); if (major) { g.fillStyle = '#ffe28a'; g.fillText(a.toFixed(2), x + 3, 2); } }
  for (let b = Math.ceil((cv - half) / G) * G; b <= cv + half; b += G) { const [, y] = toPx(cu, b), major = Math.abs(Math.round(b / G) % 5) === 0; g.strokeStyle = major ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)'; g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); if (major) { g.fillStyle = '#9fe3ff'; g.fillText(b.toFixed(2), 3, y + 2); } }
  g.fillStyle = '#fff'; g.font = '16px Helvetica'; g.fillText(view + ' (' + ['x', 'y', 'z'][spec.u] + ' across, ' + ['x', 'y', 'z'][spec.v] + ' up), grid ' + G, 8, S - 24);
  return cvs.toDataURL('image/png');
};
window.ready = true;
</script>`;
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/') { res.setHeader('content-type', 'text/html'); return res.end(PAGE); }
  const f = u === '/f' ? path.resolve(file) : path.join(root, u);
  if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: size, height: size } });
page.on('pageerror', (e) => console.error('pageerror', String(e.message).slice(0, 200)));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => window.ready, null, { timeout: 120000 });
console.log('bbox', JSON.stringify(await page.evaluate(() => window.info)));
const shots = [];
for (const v of views) shots.push(Buffer.from((await page.evaluate((v) => window.shoot(v), v)).split(',')[1], 'base64'));
await browser.close(); server.close();
fs.mkdirSync(path.dirname(out), { recursive: true });
await sharp({ create: { width: size * shots.length, height: size, channels: 3, background: '#20262c' } }).composite(shots.map((input, i) => ({ input, left: i * size, top: 0 }))).png().toFile(out);
console.log('wrote', out);
