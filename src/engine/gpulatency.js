// How long after a frame was submitted the GPU had finished it, sampled every few frames, for the governor: a GPU that keeps
// up answers within a fraction of a frame, one that is the bottleneck takes a frame or more. The same method as the metrics
// recorder's probe (src/diag/gpu.js), which this layer cannot import:
//  * WebGPU: queue.onSubmittedWorkDone(), resolved when everything submitted before it is done.
//  * WebGL 2: a fence after the frame's draw calls, polled every couple of milliseconds until it is signalled.
// A busy main thread delays the answer, so the value errs towards "the GPU is busy", which keeps the governor's old behaviour.

const now = () => performance.now();

export function gpuLatency(renderer, onSample) {
  const b = renderer?.backend;
  try {
    const q = b?.isWebGPUBackend ? b.device?.queue : null;
    if (q?.onSubmittedWorkDone) {
      let n = 0, open = 0;
      return {
        after() {
          if (n++ % 4 || open >= 2) return;
          open++; const t = now();
          q.onSubmittedWorkDone().then(() => { open--; onSample(now() - t); }, () => { open--; });
        },
        dispose() {},
      };
    }
    const gl = b?.gl;
    if (gl?.fenceSync) {
      let n = 0, timer = 0;
      const fences = [];
      const poll = () => {
        timer = 0;
        const t = now();
        for (let i = fences.length - 1; i >= 0; i--) {
          const f = fences[i];
          if (gl.getSyncParameter(f.s, gl.SYNC_STATUS) === gl.SIGNALED || t - f.t > 2000) { onSample(t - f.t); gl.deleteSync(f.s); fences.splice(i, 1); }
        }
        if (fences.length) timer = setTimeout(poll, 2);
      };
      return {
        after() {
          if (n++ % 6 || fences.length >= 3) return;
          const s = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
          if (!s) return;
          gl.flush();
          fences.push({ s, t: now() });
          if (!timer) timer = setTimeout(poll, 2);
        },
        dispose() { clearTimeout(timer); for (const f of fences) try { gl.deleteSync(f.s); } catch { /* context gone */ } fences.length = 0; },
      };
    }
  } catch { /* no probe: the governor works from frame times alone */ }
  return null;
}
