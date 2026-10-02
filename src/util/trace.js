// User Timing marks for the loading path (`pal:<name>`). A mark costs a few microseconds and only a handful are made, so they
// stay in every build: they show in DevTools' Timings track, and the metrics recorder (src/diag) reads them to build the load
// timeline. Not for the frame loop: marks allocate (use the recorder's typed arrays there).
export function mark(name, detail) {
  try { performance.mark('pal:' + name, detail === undefined ? undefined : { detail }); } catch { /* no User Timing here */ }
}
