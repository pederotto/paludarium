// GPU latency: how long after a frame's commands were submitted the GPU had finished them, sampled on every few frames.
// It is the number that tells a GPU that keeps up (a few milliseconds) from one that is the bottleneck (more than a frame,
// growing), and a GPU that never gets a rest is what freezes a whole desktop, not just this page.
//  * WebGPU: queue.onSubmittedWorkDone(), resolved when everything submitted before it is done.
//  * WebGL 2: a fence sync after the frame's draw calls, polled every couple of milliseconds until it is signalled.
// Neither needs a timer-query extension. The value is what the main thread sees (a busy main thread delays the callback),
// which is also what matters. A dozen microseconds a sampled frame.

const now = () => performance.now();

export function createGpuProbe(rec, renderer) {
  const b = renderer?.backend;
  if (!b) return null;
  try {
    const q = b.isWebGPUBackend ? b.device?.queue : null;
    if (q?.onSubmittedWorkDone) {
      let n = 0, open = 0;
      return {
        kind: 'webgpu',
        after() {
          if (n++ % 4) return;
          if (open >= 2) { rec.gpuSkipped = (rec.gpuSkipped ?? 0) + 1; return; }   // the GPU is two samples behind: not asking for more
          open++; const t = now();
          q.onSubmittedWorkDone().then(() => { open--; rec.gpu(now() - t); }, () => { open--; });
        },
        poll() {}, dispose() {},
      };
    }
    const gl = b.gl;
    if (gl?.fenceSync) {
      let n = 0, timer = 0;
      const fences = [];
      const poll = () => {
        timer = 0;
        const t = now();
        for (let i = fences.length - 1; i >= 0; i--) {
          const f = fences[i];
          if (gl.getSyncParameter(f.s, gl.SYNC_STATUS) === gl.SIGNALED || t - f.t > 2000) { rec.gpu(t - f.t); gl.deleteSync(f.s); fences.splice(i, 1); }
        }
        if (fences.length) timer = setTimeout(poll, 2);
      };
      return {
        kind: 'webgl2',
        after() {
          if (n++ % 6) return;
          if (fences.length >= 3) { rec.gpuSkipped = (rec.gpuSkipped ?? 0) + 1; return; }
          const s = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
          if (!s) return;
          gl.flush();
          fences.push({ s, t: now() });
          if (!timer) timer = setTimeout(poll, 2);
        },
        poll() {},
        dispose() { clearTimeout(timer); for (const f of fences) try { gl.deleteSync(f.s); } catch { /* context gone */ } fences.length = 0; },
      };
    }
  } catch { /* no probe */ }
  return null;
}
