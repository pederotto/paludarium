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

import * as THREE from 'three/webgpu';
import {
  pass, mrt, output, normalView, packNormalToRGB, unpackRGBToNormal, sample, screenUV, float, vec3, vec4, mix, smoothstep, uniform,
  dot, renderOutput,
} from 'three/tsl';
import { FOLIAGE, setFoliageMRT } from '../render/shaders.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { sharpen } from 'three/addons/tsl/display/SharpenNode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { Governor, PRESETS } from './governor.js';

export const QUALITY = {
  ultra:    { label: 'Ultra',    dpr: 2,    ao: true,  aoScale: 0.75, aoSamples: 16, aa: 'smaa', sharpen: 0.55, bloom: true,  shadow: 4096, aniso: 16 },
  high:     { label: 'High',     dpr: 1.5,  ao: true,  aoScale: 0.5,  aoSamples: 10, aa: 'smaa', sharpen: 0.7,  bloom: true,  shadow: 2048, aniso: 8 },
  balanced: { label: 'Balanced', dpr: 1.25, ao: false, aoScale: 0.5,  aoSamples: 8,  aa: 'msaa', sharpen: 0,    bloom: true,  shadow: 2048, aniso: 4 },
  low:      { label: 'Low',      dpr: 1,    ao: false, aoScale: 0.5,  aoSamples: 8,  aa: 'none', sharpen: 0,    bloom: false, shadow: 1024, aniso: 2 },
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

// What the governor settled on for this device last time, so the next visit does not have to find it out again.
const PROFILE_KEY = 'paludarium.gfx';
function loadProfile() {
  try {
    const o = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null');
    if (o && o.v === 1 && QUALITY[o.quality] && o.scale >= 0.5 && o.scale <= 1 && [30, 60, 120, 240].includes(o.cap)) return o;
  } catch { /* private mode */ }
  return null;
}
function saveProfile(o) { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(o)); } catch { /* private mode */ } }

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
const WEAK_GPU = /adreno|mali|powervr|videocore|swiftshader|llvmpipe|software|basic render|intel.*(hd |uhd|graphics 6|gen\d)/i;

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
    this._stable = 0; this._saved = false;
    this.shadowEvery = Math.max(1, +params.get('shadowevery') || 2);   // redraw the shadow map every Nth frame (1 = every frame)
    this._shadowLights = []; this._frameNo = 0;
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
    await r.init();
    this.backend = r.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
    this.maxAniso = r.getMaxAnisotropy?.() ?? 4;
    this.gpu = gpuName(r);
    if (p.has('lowres')) this.quality = 'low';
    const q = p.get('quality');
    const forced = p.has('lowres') || (q && QUALITY[q]);
    if (q && QUALITY[q]) this.quality = q;
    else if (this.backend !== 'WebGPU' && !p.has('lowres')) this.quality = WEAK_GPU.test(this.gpu) ? 'low' : 'balanced';
    const capMax = this.maxFps;
    const saved = forced ? null : loadProfile();
    if (saved) { this.quality = saved.quality; this.adapt = saved.scale; this.auto = saved.auto !== false; if (!p.get('fps') && saved.cap) this.maxFps = Math.min(capMax, saved.cap); }
    if (forced) this.auto = false;
    this.governor = new Governor({ cap: this.maxFps, capMax, scale: this.adapt, q: Math.max(0, PRESETS.indexOf(this.quality)), autoQuality: this.auto, warm: 300 });
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

  profile() { return { v: 1, quality: this.quality, scale: +this.adapt.toFixed(2), cap: this.maxFps, auto: this.auto }; }

  // Auto in Settings: the governor chooses the preset too, from where we are now.
  setAuto(on) {
    // Auto chooses between Low, Balanced and High; Ultra is only ever picked by hand, so leaving it means High.
    if (on && !PRESETS.includes(this.quality) && this.scene) { this.quality = 'high'; this.resize(); this.build(this.scene, this.camera); }
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

  pixelRatio() {
    return Math.max(0.5, Math.min(window.devicePixelRatio || 1, this.q.dpr) * this.adapt);
  }

  resize() {
    const w = this.host.clientWidth || window.innerWidth, h = this.host.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(w, h);
    this.aspect = w / h;
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
  }

  // (Re)builds the post-processing graph for the current quality. Cheap, so
  // it is also how photo mode switches depth of field on and off.
  build(scene, camera) {
    this.scene = scene; this.camera = camera;
    const q = this.q;
    const useAO = q.ao && !this.params.has('noao');
    const bloomOn = q.bloom && !this.params.has('nobloom');
    this.pipeline?.dispose?.();
    // Foliage skips the AO darkening (see FOLIAGE in render/shaders.js); that needs the MRT, so only while there is one.
    const withMRT = useAO || this.photo;
    if (FOLIAGE.mrt !== withMRT) {
      FOLIAGE.mrt = withMRT;
      scene.traverse((o) => { if (o.material?.userData?.foliage) setFoliageMRT(o.material, withMRT); });
    }
    const post = this.pipeline = new THREE.RenderPipeline(this.renderer);

    const scenePass = this.scenePass = pass(scene, camera, { samples: useAO || this.photo ? 0 : q.aa === 'msaa' ? 4 : 0 });
    let color = scenePass;
    if (useAO || this.photo) {
      scenePass.setMRT(mrt({ output, normal: packNormalToRGB(normalView) }));
      const col = scenePass.getTextureNode('output');
      color = col;
      if (useAO) {
        const nrm = scenePass.getTextureNode('normal');
        const aoPass = ao(scenePass.getTextureNode('depth'), sample((uv) => unpackRGBToNormal(nrm.sample(uv))), camera);
        aoPass.resolutionScale = q.aoScale;
        aoPass.samples.value = q.aoSamples;
        aoPass.radius.value = 3.5;
        aoPass.thickness.value = 2.5;
        aoPass.distanceExponent.value = 1.5;
        // GTAO is raw noise at half resolution (a dithered, smudgy floor at a grazing angle); denoise it against depth and normals.
        const aoClean = denoise(aoPass.getTextureNode(), scenePass.getTextureNode('depth'), null, camera);
        color = col.mul(mix(float(1), aoClean.r, nrm.a.mul(0.85)));   // alpha 0 = foliage: no AO
      }
    }
    if (this.photo) color = dof(color, scenePass.getViewZNode(), GRADE.focus, GRADE.focalLength, GRADE.bokeh);
    if (bloomOn) color = color.add(bloom(color, GRADE.bloomStrength, 0.4, 0.9));

    // Grade: exposure, then saturation and contrast around mid grey.
    color = vec4(color.rgb.mul(GRADE.exposure), 1);
    const luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    let graded = mix(vec3(luma), color.rgb, GRADE.saturation);
    graded = graded.sub(0.18).mul(GRADE.contrast).add(0.18).max(0);
    const vig = smoothstep(float(1.05), float(0.35), screenUV.sub(0.5).length().mul(1.35));
    graded = graded.mul(vig.mul(GRADE.vignette).add(float(1).sub(GRADE.vignette)));
    let out = renderOutput(vec4(graded, 1));
    if (q.aa === 'smaa' || this.photo) out = smaa(out);
    if (q.sharpen > 0) out = sharpen(out, q.sharpen);
    post.outputColorTransform = false;
    post.outputNode = out;
    this.applyLightQuality();
    this.governor?.warm(120);       // a new pipeline compiles its shaders in the first frames
    return post;
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
    this.pipeline.render();
  }

  // Call once per frame, before it is drawn, with the time since the previous drawn frame in seconds.
  frame(dt) {
    if (this.governor && this.measuring && !this.params.has('fixedres')) {
      const ch = this.governor.frame(dt);
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
