// Frame-time statistics shared by the in-page recorder, the report and the tests. No DOM and no Node APIs: it runs in both.

// A histogram of times in milliseconds: 0.25 ms bins up to 100 ms, 5 ms bins up to 1 s, 50 ms bins up to 10 s, one bin above.
// Fixed size, mergeable, one increment per sample, and percentiles good to half a bin (0.125 ms where frames live).
const A = 400, B = 180, C = 180;
export const NBINS = A + B + C + 1;

export function binOf(ms) {
  if (!(ms >= 0)) return 0;
  if (ms < 100) return (ms * 4) | 0;
  if (ms < 1000) return A + (((ms - 100) / 5) | 0);
  if (ms < 10000) return A + B + (((ms - 1000) / 50) | 0);
  return NBINS - 1;
}
// The middle of a bin, in ms.
export function binMid(i) {
  if (i < A) return (i + 0.5) / 4;
  if (i < A + B) return 100 + (i - A + 0.5) * 5;
  if (i < A + B + C) return 1000 + (i - A - B + 0.5) * 50;
  return 10000;
}

export class FrameHist {
  constructor() { this.bins = new Uint32Array(NBINS); this.n = 0; this.sum = 0; this.max = 0; this.min = Infinity; }
  add(ms) {
    this.bins[binOf(ms)]++; this.n++; this.sum += ms;
    if (ms > this.max) this.max = ms;
    if (ms < this.min) this.min = ms;
  }
  merge(o) {
    for (let i = 0; i < NBINS; i++) this.bins[i] += o.bins[i];
    this.n += o.n; this.sum += o.sum; this.max = Math.max(this.max, o.max); this.min = Math.min(this.min, o.min);
    return this;
  }
  mean() { return this.n ? this.sum / this.n : 0; }
  // p in 0..1. The largest value is exact, the others are bin middles.
  percentile(p) {
    if (!this.n) return 0;
    if (p >= 1) return this.max;
    const rank = Math.max(1, Math.ceil(p * this.n));
    let acc = 0;
    for (let i = 0; i < NBINS; i++) { acc += this.bins[i]; if (acc >= rank) return Math.min(this.max, Math.max(this.min, binMid(i))); }
    return this.max;
  }
}

// Percentile of an array already sorted ascending (nearest rank).
export function quantile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

// Summary of a list of numbers: count, mean, min, p50, p95, p99, max. Sorts a copy.
export function describe(values) {
  const a = Float64Array.from(values).sort();
  const n = a.length;
  if (!n) return { n: 0, mean: 0, min: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  let s = 0; for (let i = 0; i < n; i++) s += a[i];
  return { n, mean: s / n, min: a[0], p50: quantile(a, 0.5), p95: quantile(a, 0.95), p99: quantile(a, 0.99), max: a[n - 1] };
}

// The display refresh rate that best explains a set of frame-to-frame gaps (ms): the median of the plausible gaps, snapped to a
// common rate when within 4%. Returns 0 when there is nothing to go on.
const RATES = [24, 30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240];
export function refreshRate(gaps) {
  const ok = gaps.filter((g) => g > 3 && g < 45).sort((a, b) => a - b);
  if (ok.length < 20) return 0;
  const med = ok[ok.length >> 1], hz = 1000 / med;
  const near = RATES.reduce((b, r) => (Math.abs(r - hz) < Math.abs(b - hz) ? r : b), RATES[0]);
  return Math.abs(near - hz) / near < 0.04 ? near : Math.round(hz);
}

export const round = (v, d = 1) => { const k = 10 ** d; return Math.round(v * k) / k; };
