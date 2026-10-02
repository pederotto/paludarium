// Shader building without freezing the page.
//
// Everything new on screen needs shaders: three.js turns the material's node graph into shader code (JavaScript, on the
// main thread) and the driver compiles and links it. three does both inside the frame that first draws the object and
// waits for the driver, so a new tank (60 to 150 shaders), a new species (2 or 3) or a different pipeline froze the page:
// measured with tools/journey.mjs, a preset terrarium froze an M1 for 3 to 8 s on WebGL 2, photo mode for 35 s, and 5 of
// the 9.5 s were spent waiting in getProgramParameter for the link. On Windows (ANGLE turns every shader into Direct3D)
// it is several times worse. This module changes three things on the renderer:
//
//  1. Links in the background. The driver can compile while the page goes on (KHR_parallel_shader_compile on WebGL 2,
//     createRenderPipelineAsync on WebGPU); three uses that only inside compileAsync(). Here every scene pipeline takes
//     that path. three already skips drawing an object whose pipeline is not ready (Pipelines.isReady), so a new object
//     appears a few frames later instead of the page stopping. Full-screen passes (QuadMesh: the post-processing chain)
//     stay synchronous: drawing a frame without them would present a blank canvas. So does everything drawn outside the
//     frame's own render (Gfx.render sets `inFrame`): one-off pictures such as the room's environment map, the
//     portraits and the water-effect textures must come out whole the first time.
//  2. A budget for the node builds. Turning node graphs into shader code costs 10 to 60 ms a material; at most `budget`
//     ms of it run in one frame, the other new objects wait for the next frame (they are not drawn meanwhile).
//  3. Keeps what it built. three throws a shader away when the last object using it goes, so a new tank rebuilt
//     shaders identical to the old tank's. Pipelines and programs are kept (up to `keepMax`) and found again by their code.
//
// `pending` (pipelines being linked) and `deferred` (objects waiting for their turn this frame) tell the loading screens
// when the picture is complete: `settled()` resolves when both are zero.
//
// three is pinned (package.json); tests/compiler.test.mjs checks that the internals used here still exist.

export class ShaderCompiler {
  constructor(renderer, { budget = 8, keepMax = 1500 } = {}) {
    this.renderer = renderer;
    this.budget = budget;          // ms of node building per frame
    this.keepMax = keepMax;
    this.spent = 0;                // ms of node building in this frame
    this.pending = 0;              // pipelines linking in the background
    this.deferred = 0;             // objects skipped in this frame for lack of budget
    this.lastDeferred = 0;
    this.built = 0;                // pipelines created since boot
    this.buildMs = 0;              // total ms in node builds since boot
    this.kept = 0;
    this._waiters = [];
    this.enabled = { async: true, budget: true, keep: true };
    this.inFrame = false;          // set by Gfx.render around the frame's own drawing: only that may skip objects
    this._install();
  }

  _install() {
    const r = this.renderer, b = r.backend, self = this;
    const isWebGL = !!b?.isWebGLBackend;
    const canAsync = isWebGL ? !!b.parallel : !!b?.isWebGPUBackend;
    // 1. Background links.
    const create = b.createRenderPipeline;
    b.createRenderPipeline = function (renderObject, promises) {
      self.built++;
      if (promises !== null || !canAsync || !self.enabled.async || !self.inFrame || renderObject.object?.isQuadMesh) return create.call(this, renderObject, promises);
      const list = [];
      create.call(this, renderObject, list);
      if (!list.length) return undefined;
      self.pending++;
      Promise.all(list).finally(() => { self.pending--; });
      return undefined;
    };
    // 2. A per-frame budget for node builds, measured where three builds them.
    const nodes = r._nodes;
    const getForRender = nodes.getForRender;
    nodes.getForRender = function (renderObject, useAsync) {
      if (useAsync) return getForRender.call(this, renderObject, useAsync);
      const t = performance.now();
      try { return getForRender.call(this, renderObject, useAsync); } finally { const d = performance.now() - t; if (d > 0.05) { self.spent += d; self.buildMs += d; } }
    };
    const direct = r._renderObjectDirect;
    r._renderObjectDirect = function (object, material, scene, camera, lightsNode, group, clippingContext, passId) {
      if (self.inFrame && self.spent >= self.budget && self.enabled.budget && !object.isQuadMesh) {
        const ro = this._objects.get(object, material, scene, camera, lightsNode, this._currentRenderContext, clippingContext, passId);
        if (this._nodes.get(ro).nodeBuilderState === undefined) { self.deferred++; return; }
      }
      return direct.call(this, object, material, scene, camera, lightsNode, group, clippingContext, passId);
    };
    // 3. Keep pipelines and programs: a later tank finds them again by their code.
    const P = r._pipelines;
    const relPipe = P._releasePipeline, relProg = P._releaseProgram;
    P._releasePipeline = function (pipeline) {
      if (self.enabled.keep && self.kept < self.keepMax) { self.kept++; return; }
      return relPipe.call(this, pipeline);
    };
    P._releaseProgram = function (program) {
      if (self.enabled.keep && self.kept < self.keepMax) return;
      return relProg.call(this, program);
    };
  }

  // Call at the start of every frame.
  beginFrame() {
    this.lastDeferred = this.deferred;
    this.spent = 0;
    this.deferred = 0;
    this._check(true);
  }

  // Nothing is waiting: every object drawn last frame had its shaders.
  get idle() { return this.pending === 0 && this.lastDeferred === 0; }

  // Resolves once every visible object has its shaders (two idle frames in a row), or after `timeout` ms.
  settled(timeout = 60000) {
    return new Promise((resolve) => {
      const w = { resolve, n: 0, until: performance.now() + timeout };
      this._waiters.push(w);
    });
  }

  _check() {
    if (!this._waiters.length) return;
    const now = performance.now();
    this._waiters = this._waiters.filter((w) => {
      w.n = this.idle ? w.n + 1 : 0;   // counted once a frame
      if (w.n >= 3 || now > w.until) { w.resolve(this.idle); return false; }
      return true;
    });
  }

  stats() { return { pending: this.pending, deferred: this.lastDeferred, built: this.built, buildMs: Math.round(this.buildMs), kept: this.kept }; }
}
