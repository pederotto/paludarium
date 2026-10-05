// The renderer and its post-processing pipeline, with quality presets and
// adaptive resolution.
//
// three.js WebGPURenderer (falls back to WebGL 2 by itself). The scene is
// rendered once into a half-float target, and then:
//
//   scene ─▶ ambient occlusion (GTAO) ─▶ bloom ─▶ depth of field (photo mode)
//         ─▶ colour grade ─▶ vignette ─▶ tone map ─▶ SMAA ─▶ contrast sharpen
//
// Anti-aliasing has two paths. When AO is on, the depth buffer has to be
// sampleable, and WebGPU cannot sample a multisampled depth texture, so the
// scene pass runs without MSAA and SMAA cleans the edges afterwards. When AO
// is off (Balanced) the scene pass uses 4× MSAA instead, which is cheaper.
// An adaptive resolution scaler trades pixels for frame rate on slow GPUs.
//
// A preset's `dpr` is its pixel ratio on a computer screen; `mp` is the most pixels (in millions) it may draw, which on a
// small screen buys a higher ratio than `dpr`: a phone is a third of a laptop's area at three device pixels a point, and at
// a laptop's ratio its picture was soft, at the governor's floor blocky. Unchanged at 1280×720 and up.

import * as THREE from 'three/webgpu';
import {
  pass, mrt, output, normalView, packNormalToRGB, unpackRGBToNormal, sample, screenUV, float, vec3, vec4, mix, smoothstep, uniform,
  dot, renderOutput,
} from 'three/tsl';
import { FOLIAGE, setFoliageMRT } from '../render/shaders.js';
import { U } from '../render/uniforms.js';
import { SKIN } from '../render/creatures/skin.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { sharpen } from 'three/addons/tsl/display/SharpenNode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { Governor, PRESETS, autoCeiling } from './governor.js';
import { gpuLatency } from './gpulatency.js';
import { ShaderCompiler } from './compiler.js';

export const QUALITY = {
  ultra:    { label: 'Ultra',    dpr: 2,    mp: 3,   ao: true,  aoScale: 0.75, aoSamples: 16, aa: 'smaa', sharpen: 0.55, bloom: true, bloomScale: 0.5,  shadow: 4096, aniso: 16 },
  high:     { label: 'High',     dpr: 1.5,  mp: 1.6, ao: true,  aoScale: 0.5,  aoSamples: 10, aa: 'smaa', sharpen: 0.7,  bloom: true, bloomScale: 0.5,  shadow: 2048, aniso: 8 },
  balanced: { label: 'Balanced', dpr: 1.25, mp: 1.2, ao: false, aoScale: 0.5,  aoSamples: 8,  aa: 'msaa', sharpen: 0,    bloom: true, bloomScale: 0.25,  shadow: 2048, aniso: 4 },
  low:      { label: 'Low',      dpr: 1,    mp: 0.6, ao: false, aoScale: 0.5,  aoSamples: 8,  aa: 'none', sharpen: 0,    bloom: false, bloomScale: 0.25, shadow: 1024, aniso: 2 },
};

// The look of the picture: everything here is live-adjustable uniforms.
export const GRADE = {
  exposure: uniform(1),
  saturation: uniform(1.1),
  contrast: uniform(1.06),
  vignette: uniform(0.55),
  bloomStrength: uniform(0.24),
  // Depth of field (photo mode).
  focus: uniform(70),
  focalLength: uniform(40),
  bokeh: uniform(2.2),
};

// What the governor settled on for this device last time, so the next visit does not have to find it out again. Version 2:
// a version-1 profile may hold the floor a phone was pushed to by frames the GPU was not to blame for (see governor.js).
const PROFILE_KEY = 'paludarium.gfx';
function loadProfile() {
  try {
    const o = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null');
    if (o && o.v === 2 && QUALITY[o.quality] && o.scale >= 0.5 && o.scale <= 1 && [30, 60, 120, 240].includes(o.cap)) return o;
  } catch { /* private mode */ }
  return null;
}
function saveProfile(o) { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(o)); } catch { /* private mode */ } }

// A remembered level must prove itself: the boot that uses it (or the hand-picked preset that saves it) leaves BOOT_KEY set
// until PROBATION frames have been drawn. Still set at the next boot means that one never got going (froze compiling, went
// black, was reloaded): its profile is dropped, so a level that broke the page (Safari went black on every reload) is not reused.
const BOOT_KEY = 'paludarium.gfx.boot', PROBATION = 300;
// Reloads after the GPU dropped the context, this tab (session storage), with their times.
const LOST_KEY = 'paludarium.gfx.lost';
const store = (s, k, v) => { try { if (v === null) s.removeItem(k); else s.setItem(k, v); } catch { /* private mode */ } };
function lostReloads() { try { return JSON.parse(sessionStorage.getItem(LOST_KEY) ?? '[]').filter((t) => Date.now() - t < 60000); } catch { return []; } }
function bootFailed() {
  try { if (!localStorage.getItem(BOOT_KEY)) return false; } catch { return false; }
  store(localStorage, PROFILE_KEY, null); store(localStorage, BOOT_KEY, null);
  return true;
}

// The graphics adapter's own name, as far as the browser says (WebGL's debug info, or the WebGPU adapter).
function gpuName(r) {
  try {
    const gl = r.backend?.gl;
    if (gl) { const x = gl.getExtension('WEBGL_debug_renderer_info'); if (x) return String(gl.getParameter(x.UNMASKED_RENDERER_WEBGL)); }
    const i = r.backend?.adapter?.info ?? r.backend?.device?.adapterInfo;
    if (i) return [i.vendor, i.architecture, i.description].filter(Boolean).join(' ');
  } catch { /* not available */ }
  return '';
}
// Integrated, mobile and software renderers: they start on the Low preset (the governor raises it if the machine proves fast).
const WEAK_GPU = /adreno|qualcomm|mali|powervr|videocore|swiftshader|llvmpipe|software|basic render|intel.*(hd |uhd|graphics 6|gen\d)/i;
// A phone (its GPU names itself like a laptop's: an iPhone says "apple", as an M1 does), by the size of its screen.
const isPhone = () => Math.min(screen.width || 1e4, screen.height || 1e4) < 600;

export class Gfx {
  constructor(host, params = new URLSearchParams()) {
    this.host = host;
    this.params = params;
    this.quality = 'high';
    this.adapt = 1;              // 0.6 … 1, multiplies the pixel ratio
    this.photo = false;
    this.pipeline = null;
    this.stats = { fps: 0, frameMs: 0, gpuMs: null, calls: 0, triangles: 0 };
    this._acc = 0; this._n = 0;
    this.maxFps = +params.get('fps') > 0 ? Math.min(240, +params.get('fps')) : 60;   // frames a second at most: a GPU kept busy all the time starves the rest of the desktop
    this.auto = true;            // the governor may change the preset (Auto in Settings); a preset picked by hand turns it off
    this.measuring = true;       // false while something else makes frames slow (a time-lapse)
    this.governor = null;
    this.onChange = null;        // (level) => void: the governor moved the render scale, preset or frame cap
    this._stable = 0; this._saved = false; this._trial = 0;
    this.shadowEvery = Math.max(1, +params.get('shadowevery') || 2);   // redraw the shadow map every Nth frame (1 = every frame)
    this._shadowLights = []; this._frameNo = 0;
    this.phone = false;
    this.cpuMs = -1;             // the main thread's time for the last frame (set by the game loop), for the governor
  }

  async init() {
    const p = this.params;
    const r = this.renderer = new THREE.WebGPURenderer({
      antialias: false,
      forceWebGL: p.has('webgl'),
      powerPreference: 'high-performance',
      trackTimestamp: p.has('perf'),
    });
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.host.appendChild(r.domElement);
    const lostDefault = r.onDeviceLost.bind(r);
    r.onDeviceLost = (info) => { lostDefault(info); this.lost(info); };
    await r.init();
    // Shaders build in the background and under a per-frame budget (engine/compiler.js); ?synccompile turns it off.
    this.compiler = new ShaderCompiler(r);
    if (p.has('synccompile')) Object.assign(this.compiler.enabled, { async: false, budget: false, keep: false });
    this.backend = r.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
    this.maxAniso = r.getMaxAnisotropy?.() ?? 4;
    this.gpu = gpuName(r);
    this.phone = isPhone();
    this.latency = gpuLatency(r, (ms) => this.governor?.gpu(ms));
    if (p.has('lowres')) this.quality = 'low';
    const q = p.get('quality');
    const forced = p.has('lowres') || (q && QUALITY[q]);
    if (q && QUALITY[q]) this.quality = q;
    else if (this.backend !== 'WebGPU' && !p.has('lowres')) this.quality = WEAK_GPU.test(this.gpu) ? 'low' : 'balanced';
    // WebGPU starts on High, except on an integrated or mobile GPU: Balanced (no ambient occlusion), from where the governor
    // raises it to High if the machine proves fast. Starting high and stepping down cost a few slow seconds on such machines.
    else if (!p.has('lowres') && (WEAK_GPU.test(this.gpu) || this.phone)) this.quality = 'balanced';
    // Reloaded after a lost context: Low, and on WebGL 2 Auto stays there (its ceiling is the start).
    if (!forced && lostReloads().length) this.quality = 'low';
    const capMax = this.maxFps;
    this.qCeil = autoCeiling(this.backend, this.quality);     // how high Auto may take the preset by itself (see governor.js)
    const saved = forced || bootFailed() ? null : loadProfile();
    if (saved) { this.quality = saved.quality; this.adapt = saved.scale; this.auto = saved.auto !== false; if (!p.get('fps') && saved.cap) this.maxFps = Math.min(capMax, saved.cap); this.probation(); }
    if (forced) this.auto = false;
    if (this.auto && PRESETS.indexOf(this.quality) > this.qCeil) this.quality = PRESETS[this.qCeil];   // a profile saved on a faster path
    this.governor = new Governor({ cap: this.maxFps, capMax, scale: this.adapt, q: Math.max(0, PRESETS.indexOf(this.quality)), qMax: this.qCeil, autoQuality: this.auto, warm: 300 });
    this.resize();
    return this;
  }

  // The governor asks for a different level: resolution, preset and frame cap. Called at the start of a frame, before it is
  // drawn, so a resize never presents a blank canvas.
  apply(ch) {
    this.adapt = ch.scale; this.maxFps = ch.cap;
    const to = PRESETS[ch.q];
    if (this.auto && to && to !== this.quality) { this.quality = to; this.resize(); if (this.scene) this.build(this.scene, this.camera); }
    else this.resize();
    this._stable = 0; this._saved = false;
    this.onChange?.({ quality: this.quality, scale: this.adapt, cap: this.maxFps, reason: ch.reason });
  }

  profile() { return { v: 2, quality: this.quality, scale: +this.adapt.toFixed(2), cap: this.maxFps, auto: this.auto }; }

  // Auto in Settings: the governor chooses the preset too, from where we are now.
  setAuto(on) {
    // Auto chooses between Low, Balanced and High, up to the ceiling of this graphics path; Ultra is only ever picked by hand.
    const at = PRESETS.indexOf(this.quality), to = at < 0 ? this.qCeil : Math.min(at, this.qCeil);
    if (on && to !== at && this.scene) { this.quality = PRESETS[to]; this.resize(); this.build(this.scene, this.camera); }
    this.auto = on;
    if (this.governor) { this.governor.autoQuality = on; this.governor.set({ q: Math.max(0, PRESETS.indexOf(this.quality)), scale: this.adapt }); }
    this._saved = false; this._stable = 0;
  }

  // The frame-rate limit (Settings): 0 means no limit.
  setCap(n) {
    this.maxFps = n || 240;
    if (this.governor) { this.governor.capMax = this.maxFps; this.governor.set({ cap: this.maxFps }); }
    this._saved = false; this._stable = 0;
    saveProfile(this.profile());
  }

  get q() { return QUALITY[this.quality]; }

  size() { return [this.host.clientWidth || window.innerWidth, this.host.clientHeight || window.innerHeight]; }

  // The preset's pixel ratio at full scale: its `dpr`, or more on a small screen while it stays inside the preset's `mp`.
  ratioCap() {
    const [w, h] = this.size(), q = this.q;
    return Math.min(window.devicePixelRatio || 1, Math.max(q.dpr, Math.sqrt(q.mp * 1e6 / Math.max(1, w * h))));
  }

  // However slow the GPU: on a phone one pixel a CSS pixel, below which a picture next to its three-times-sharper interface is
  // blocks; on a computer never coarser than 2x2 device pixels (a retina Mac at 0.6 drew 3x3 blocks, and Safari's frames were
  // no faster for it). The frame cap gives the GPU its rest instead.
  ratioFloor() { const d = window.devicePixelRatio || 1; return this.phone ? Math.min(d, 1) : Math.min(1, Math.max(0.5, d / 2)); }

  pixelRatio() { return Math.max(this.ratioFloor(), this.ratioCap() * this.adapt); }

  resize() {
    const [w, h] = this.size();
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(w, h);
    this.aspect = w / h;
    // Scale steps below the floor would change nothing: the governor moves on to the preset and the cap sooner.
    if (this.governor) this.governor.scaleMin = Math.min(1, Math.max(0.6, this.ratioFloor() / this.ratioCap()));
    this.governor?.warm(60);          // the first frames at a new size build render targets: not a measure of the GPU
    return [w, h];
  }

  // A preset picked by hand: Auto stops choosing the preset (the resolution and the frame cap still adapt).
  setQuality(name, scene, camera) {
    if (!QUALITY[name]) return;
    this.quality = name;
    this.adapt = 1;
    this.auto = false;
    if (this.governor) { this.governor.autoQuality = false; this.governor.set({ q: Math.max(0, PRESETS.indexOf(name)), scale: 1 }); }
    this.resize();
    if (scene) this.build(scene, camera);
    this._saved = false; this._stable = 0;
    saveProfile(this.profile());
    this.probation();
  }

  // Marks the remembered level as on trial (see BOOT_KEY); render() clears it after PROBATION drawn frames.
  probation() { store(localStorage, BOOT_KEY, '1'); this._trial = PROBATION; }

  // The GPU dropped the context: a GPU reset, the browser reclaiming memory, a watchdog on a frame that took too long. three.js
  // cannot rebuild its resources in place, so the canvas would stay black. Forget the level in force and reload into Low, at
  // most twice a minute; after that, say what happened instead of leaving a black page.
  lost(info) {
    store(localStorage, PROFILE_KEY, null); store(localStorage, BOOT_KEY, null);
    const n = lostReloads();
    if (n.length < 2) { store(sessionStorage, LOST_KEY, JSON.stringify([...n, Date.now()])); location.reload(); return; }
    const m = document.createElement('div');
    m.style.cssText = 'position:absolute;inset:0;z-index:50;display:grid;place-items:center;padding:20px;background:#050806;color:#cfd8d2;font:15px/1.5 system-ui,sans-serif;text-align:center';
    m.textContent = `The graphics card stopped drawing for this page (${info?.api ?? 'GPU'}: ${info?.message ?? 'context lost'}). Close other heavy tabs and reload; the game will start on Low.`;
    this.host.appendChild(m);
  }

  // (Re)builds the post-processing graph for the current quality. Cheap, so
  // it is also how photo mode switches depth of field on and off.
  build(scene, camera) {
    this.scene = scene; this.camera = camera;
    const q = this.q;
    const useAO = q.ao && !this.params.has('noao');
    U.surfaceDetail.value = this.quality === 'low' ? 0 : 1;           // rock relief and cracks (render/shaders.js substrateMaterial)
    SKIN.on = !this.params.has('noskin') && this.quality !== 'low' && !WEAK_GPU.test(this.gpu ?? '');   // skinned near vertebrates (render/creatures/skin.js)
    SKIN.swim = !this.params.has('noskin');          // (a swimming frog's stroke, on every preset: a few instances at most)
    const bloomOn = q.bloom && !this.params.has('nobloom');
    this.pipeline?.dispose?.();
    this.disposePasses();
    // Foliage skips the AO darkening (see FOLIAGE in render/shaders.js); that needs the MRT, so only while there is one.
    // Photo mode does not change the scene pass (its MRT or, on WebGL 2, its samples): depth of field needs only depth, and
    // a different scene pass recompiles every shader in the scene (35 s on an M1 on WebGL 2, tools/journey.mjs). WebGPU
    // cannot sample a multisampled depth texture, so there a multisampled pass still drops its samples for photo mode.
    const withMRT = useAO;
    if (FOLIAGE.mrt !== withMRT) {
      FOLIAGE.mrt = withMRT;
      scene.traverse((o) => { if (o.material?.userData?.foliage) setFoliageMRT(o.material, withMRT); });
    }
    const post = this.pipeline = new THREE.RenderPipeline(this.renderer);

    const msaa = q.aa === 'msaa' && !useAO && !(this.photo && this.backend === 'WebGPU');
    const scenePass = this.scenePass = this.keep(pass(scene, camera, { samples: msaa ? 4 : 0 }));
    let color = scenePass;
    if (useAO) {
      scenePass.setMRT(mrt({ output, normal: packNormalToRGB(normalView) }));
      const col = scenePass.getTextureNode('output');
      color = col;
      if (useAO) {
        const nrm = scenePass.getTextureNode('normal');
        const aoPass = this.keep(ao(scenePass.getTextureNode('depth'), sample((uv) => unpackRGBToNormal(nrm.sample(uv))), camera));
        aoPass.resolutionScale = q.aoScale;
        aoPass.samples.value = q.aoSamples;
        aoPass.radius.value = 3.5;
        aoPass.thickness.value = 2.5;
        aoPass.distanceExponent.value = 1.5;
        // GTAO is raw noise at half resolution (a dithered, smudgy floor at a grazing angle); denoise it against depth and normals.
        const aoClean = this.keep(denoise(aoPass.getTextureNode(), scenePass.getTextureNode('depth'), null, camera));
        color = col.mul(mix(float(1), aoClean.r, nrm.a.mul(0.85)));   // alpha 0 = foliage: no AO
      }
    }
    if (this.photo) color = this.keep(dof(color, scenePass.getViewZNode(), GRADE.focus, GRADE.focalLength, GRADE.bokeh));
    if (bloomOn) {
      // A glow is soft: below High it is worked out at a quarter of the resolution (a quarter of the cost: the bloom chain is
      // most of the post-processing on a weak GPU).
      const b = this.keep(bloom(color, GRADE.bloomStrength, 0.4, 1.2));
      b.setResolutionScale(q.bloomScale ?? 0.5);
      color = color.add(b);
    }

    // Grade: exposure, then saturation and contrast around mid grey.
    color = vec4(color.rgb.mul(GRADE.exposure), 1);
    const luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    let graded = mix(vec3(luma), color.rgb, GRADE.saturation);
    graded = graded.sub(0.18).mul(GRADE.contrast).add(0.18).max(0);
    const vig = smoothstep(float(1.05), float(0.35), screenUV.sub(0.5).length().mul(1.35));
    graded = graded.mul(vig.mul(GRADE.vignette).add(float(1).sub(GRADE.vignette)));
    let out = renderOutput(vec4(graded, 1));
    if (q.aa === 'smaa' || this.photo) out = this.keep(smaa(out));
    if (q.sharpen > 0) out = this.keep(sharpen(out, q.sharpen));
    post.outputColorTransform = false;
    post.outputNode = out;
    this.applyLightQuality();
    this.governor?.warm(120);       // a new pipeline compiles its shaders in the first frames
    return post;
  }

  // The passes of the pipeline own render targets the size of the screen (the scene pass and its depth and normals, AO,
  // denoise, bloom's chain, SMAA, sharpen, and the render-to-texture step each of the last ones puts in front of itself).
  // RenderPipeline.dispose() frees none of them and they stay reachable after the pipeline is replaced, so each rebuild (every
  // tank loaded, photo mode, a preset change) used to leave about 36 textures behind: 118 MB a tank at 1280x720, four times
  // that on a retina screen (tools/steps/tank-sizes.mjs prints the count). build() keeps them and frees the old ones.
  keep(node) { (this._passes ??= []).push(node); return node; }
  disposePasses() {
    // Freed a second later, not now (N20): the old pipeline can still be in a frame being encoded or awaiting submit, and
    // freeing its render targets and materials under it gave "Buffer used in submit while destroyed" on WebGPU.
    const old = this._passes ?? [];
    this._passes = [];
    if (old.length) setTimeout(() => {
      for (const n of old) {
        if (n.textureNode?.isRTTNode) n.textureNode.dispose();
        n.dispose?.();
      }
    }, 1000);
  }

  // Builds every shader and pipeline the scene pass will need, off the main thread's critical path (three yields between
  // materials), so the first visible frames do not stall on node-graph builds. The pass's render target is set up the way
  // PassNode.setup does it on its first frame: its sample count, format and size are part of the pipeline cache keys, and a
  // pipeline built for a differently configured target would be thrown away. Returns false when it could not run.
  // Opt-in (?precompile) because it measured no faster: compileAsync awaits each pipeline in turn, so the wall time
  // is the same or worse (seconds to tens of seconds on a loaded machine) and the node-graph build is merely spread out.
  async compile() {
    const sp = this.scenePass, r = this.renderer;
    if (!sp || !r?.compileAsync ) return false;
    try {
      const rt = sp.renderTarget;
      rt.samples = sp.options?.samples === undefined ? r.samples : sp.options.samples;
      rt.texture.type = r.getOutputBufferType();
      const size = r.getDrawingBufferSize(new THREE.Vector2());
      sp.setSize(size.x, size.y);
      this.applyLightQuality();
      await sp.compileAsync(r);
      return true;
    } catch (e) { console.warn('Precompile skipped', e); return false; }
  }

  applyLightQuality() {
    const q = this.q;
    this._shadowLights = []; this._frameNo = 0;
    this.scene?.traverse((o) => {
      if (o.isDirectionalLight && o.castShadow) { o.shadow.autoUpdate = true; this._shadowLights.push(o.shadow); }
      if (o.isDirectionalLight && o.castShadow && o.shadow.mapSize.x !== q.shadow) {
        o.shadow.mapSize.set(q.shadow, q.shadow);
        o.shadow.map?.dispose();
        o.shadow.map = null;
      }
    });
  }

  render() {
    // The shadow pass is a third of all draws; a shadow one frame (16 ms) old is not something the eye can place.
    // Not for the first 90 frames after a (re)build: pipelines and the shadow map are still being created.
    if (this.shadowEvery > 1 && this._frameNo++ > 90) {
      const due = this._frameNo % this.shadowEvery === 0;
      for (const sh of this._shadowLights) { sh.autoUpdate = false; if (due) sh.needsUpdate = true; }
    }
    const c = this.compiler;
    c.inFrame = true;
    try { this.pipeline.render(); } finally { c.inFrame = false; }
    if (this._trial > 0 && --this._trial === 0) store(localStorage, BOOT_KEY, null);
    this.latency?.after();
  }

  // Call once per frame, before it is drawn, with the time since the previous drawn frame in seconds.
  frame(dt) {
    if (this.governor && this.measuring && !this.params.has('fixedres')) {
      const ch = this.governor.frame(dt, this.cpuMs);
      if (ch) this.apply(ch);
      else if ((this._stable += dt) > 25 && !this._saved) { this._saved = true; saveProfile(this.profile()); }   // settled: remember it
    }
    this._acc += dt; this._n++;
    if (this._acc < 1.5) return;
    const fps = this._n / this._acc;
    this.stats.fps = Math.round(fps);
    this.stats.frameMs = +(1000 / fps).toFixed(1);
    const info = this.renderer.info.render;
    this.stats.calls = info.drawCalls ?? info.calls; this.stats.triangles = info.triangles;
    this._acc = 0; this._n = 0;
    if (this.params.has('perf') && this.renderer.resolveTimestampsAsync) {
      this.renderer.resolveTimestampsAsync('render').then((t) => { if (typeof t === 'number') this.stats.gpuMs = +t.toFixed(2); }).catch(() => {});
    }
  }
}
