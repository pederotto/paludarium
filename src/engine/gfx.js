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

export class Gfx {
  constructor(host, params = new URLSearchParams()) {
    this.host = host;
    this.params = params;
    this.quality = 'high';
    this.adapt = 1;              // 0.6 … 1, multiplies the pixel ratio
    this.photo = false;
    this.pipeline = null;
    this.stats = { fps: 0, frameMs: 0, gpuMs: null, calls: 0, triangles: 0 };
    this._acc = 0; this._n = 0; this._slow = 0; this._fast = 0;
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
    if (p.has('lowres')) this.quality = 'low';
    const q = p.get('quality');
    if (q && QUALITY[q]) this.quality = q;
    else if (this.backend !== 'WebGPU' && !p.has('lowres')) this.quality = 'balanced';
    this.resize();
    return this;
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
    return [w, h];
  }

  setQuality(name, scene, camera) {
    if (!QUALITY[name]) return;
    this.quality = name;
    this.adapt = 1;
    this.resize();
    if (scene) this.build(scene, camera);
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

    const scenePass = pass(scene, camera, { samples: useAO || this.photo ? 0 : q.aa === 'msaa' ? 4 : 0 });
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
    return post;
  }

  applyLightQuality() {
    const q = this.q;
    this._shadowLights = [];
    this.scene?.traverse((o) => {
      if (o.isDirectionalLight && o.castShadow) { o.shadow.autoUpdate = this.shadowEvery === 1; this._shadowLights.push(o.shadow); }
      if (o.isDirectionalLight && o.castShadow && o.shadow.mapSize.x !== q.shadow) {
        o.shadow.mapSize.set(q.shadow, q.shadow);
        o.shadow.map?.dispose();
        o.shadow.map = null;
      }
    });
  }

  render() {
    // The shadow pass is a third of all draws; a shadow one frame (16 ms) old is not something the eye can place.
    if (this.shadowEvery > 1) {
      const due = this._frameNo++ % this.shadowEvery === 0;
      for (const sh of this._shadowLights) { sh.autoUpdate = false; if (due) sh.needsUpdate = true; }
    }
    this.pipeline.render();
  }

  // Call once per frame with the frame time in seconds.
  frame(dt) {
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
    // Adaptive resolution: hold about 45 fps by trading pixels.
    if (this.params.has('fixedres')) return;
    if (fps < 42) { if (++this._slow >= 2 && this.adapt > 0.6) { this.adapt = Math.max(0.6, this.adapt - 0.15); this.resize(); this._slow = 0; } this._fast = 0; }
    else if (fps > 58 && this.adapt < 1) { if (++this._fast >= 4) { this.adapt = Math.min(1, this.adapt + 0.1); this.resize(); this._fast = 0; } this._slow = 0; }
    else { this._slow = 0; this._fast = 0; }
  }
}
