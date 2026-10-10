// Contact sheet of GLB files: each model framed from a 3/4 view (and a second view with --views=2: from the front, level) in a plain lit
// scene, with its name, triangle count and size under it. For looking at a batch of raw or decimated models at once (the Drop folder,
// tools/meshy-decor.mjs output) before deciding what each one is for. Not a game render: no tank, no game shaders.
//
//   node tools/model-sheet.mjs <a.glb> <b.glb> ... [--cols=4] [--size=360] [--views=1|2] [--out=test-output/sheet.png] [--bg=2b3138]
//   node tools/model-sheet.mjs --dir=../.agents/meshy-1008/lod --match=cactus --out=...      (every .glb of a folder, filtered by name)
// Needs Chrome (like tools/shot.mjs); WebGL, so it works with the machine's GPU or software.
import { chromium } from 'playwright';
import sharp from 'sharp';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const cols = +arg('cols', 4), size = +arg('size', 360), views = +arg('views', 1), out = arg('out', 'test-output/sheet.png'), bg = arg('bg', '2b3138');
let files = args.filter((a) => !a.startsWith('--'));
if (arg('dir', '')) files = fs.readdirSync(arg('dir')).filter((f) => f.endsWith('.glb') && f.includes(arg('match', ''))).sort().map((f) => path.join(arg('dir'), f));
if (!files.length) { console.error('usage: node tools/model-sheet.mjs <files.glb…> | --dir=<folder> [--match=text]'); process.exit(2); }
const root = path.resolve('.');

const PAGE = `<!doctype html><meta charset=utf-8><body style="margin:0;background:#${bg}">
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
const S = ${size};
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(S, S); renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#${bg}');
scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.6));
const sun = new THREE.DirectionalLight(0xfff2dd, 2.6); sun.position.set(2, 3, 2.5); scene.add(sun);
const fill = new THREE.DirectionalLight(0x9ab8ff, 0.8); fill.position.set(-2, 1, -2); scene.add(fill);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
window.shoot = async (url, azDeg, elDeg) => {
  const gltf = await loader.loadAsync(url);
  const obj = gltf.scene; scene.add(obj);
  const box = new THREE.Box3().setFromObject(obj), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
  const r = sz.length() / 2, cam = new THREE.PerspectiveCamera(30, 1, r / 20, r * 40);
  const az = azDeg * Math.PI / 180, el = elDeg * Math.PI / 180, d = r / Math.sin(15 * Math.PI / 180) * 0.78;
  cam.position.set(c.x + d * Math.cos(el) * Math.sin(az), c.y + d * Math.sin(el), c.z + d * Math.cos(el) * Math.cos(az)); cam.lookAt(c);
  renderer.render(scene, cam);
  const data = renderer.domElement.toDataURL('image/jpeg', 0.9);
  scene.remove(obj);
  obj.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); const m = o.material; for (const k in m) if (m[k]?.isTexture) m[k].dispose(); m.dispose(); } });
  return data;
};
window.ready = true;
</script>`;

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/') { res.setHeader('content-type', 'text/html'); return res.end(PAGE); }
  const m = u.match(/^\/f\/(\d+)$/);
  const f = m ? files[+m[1]] : path.join(root, u);
  if (!f || !fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : f.endsWith('.glb') ? 'model/gltf-binary' : 'application/octet-stream');
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: size, height: size } });
page.on('pageerror', (e) => console.error('pageerror', String(e.message).slice(0, 200)));
await page.goto(base + '/');
await page.waitForFunction(() => window.ready, null, { timeout: 30000 });

const label = (name, info, w) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="46"><rect width="100%" height="100%" fill="#${bg}"/><text x="8" y="19" font-family="Helvetica,Arial" font-size="15" font-weight="700" fill="#f2f2f2">${name.replace(/&/g, '&amp;').slice(0, 44)}</text><text x="8" y="38" font-family="Helvetica,Arial" font-size="12" fill="#b9c2cc">${info}</text></svg>`);
const tiles = [];
for (let i = 0; i < files.length; i++) {
  const f = files[i], name = path.basename(f, '.glb');
  const shots = [];
  try {
    for (const [az, el] of views === 2 ? [[35, 22], [0, 2]] : [[35, 22]]) {
      const url = await page.evaluate(([u, a, e]) => window.shoot(u, a, e), [`/f/${i}`, az, el]);
      shots.push(Buffer.from(url.split(',')[1], 'base64'));
    }
  } catch (e) { console.error('failed', name, String(e.message).slice(0, 160)); continue; }
  const row = await sharp({ create: { width: size * shots.length, height: size, channels: 3, background: `#${bg}` } })
    .composite(shots.map((b, k) => ({ input: b, left: k * size, top: 0 }))).png().toBuffer();
  const info = `${(fs.statSync(f).size / 1048576).toFixed(1)} MB`;
  tiles.push(await sharp(row).extend({ bottom: 46, background: `#${bg}` }).composite([{ input: label(name, info, size * shots.length), left: 0, top: size }]).png().toBuffer());
  console.log('ok', name);
}
await browser.close(); server.close();

const tw = size * views, th = size + 46, rows = Math.ceil(tiles.length / cols);
fs.mkdirSync(path.dirname(out), { recursive: true });
await sharp({ create: { width: tw * cols, height: th * rows, channels: 3, background: `#${bg}` } })
  .composite(tiles.map((input, i) => ({ input, left: (i % cols) * tw, top: Math.floor(i / cols) * th }))).png().toFile(out);
console.log('wrote', out, `${tw * cols}x${th * rows}`);
