// Procedural ambience, all synthesised with WebAudio (no sound files):
// falling water and pool burble scale with the tank's waterfalls, rain with
// the rain programme, a room-tone hum with the lights, and at night a chorus of
// crickets and the odd frog call when amphibians are kept. A convolution
// reverb gives the drips a glass-box space.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const KEY = 'paludarium.audio';

function loadPrefs() {
  try { return { volume: 0.4, on: true, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { volume: 0.4, on: true }; }
}

export class Ambience {
  constructor() {
    Object.assign(this, loadPrefs());
    this.ac = null;
    this.t = 0;            // seconds since start, for scheduling events
    this.nextChirp = 0; this.nextCall = 0; this.nextDrip = 0;
  }

  // Browsers only allow audio after a user gesture: call this from one.
  start() {
    if (this.ac) { this.ac.resume?.(); return; }
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) return;
    const ac = this.ac = new AC();
    this.master = ac.createGain();
    this.master.gain.value = this.on ? this.volume : 0;
    this.master.connect(ac.destination);

    // Reverb: a short decaying noise burst.
    const len = ac.sampleRate * 1.6, ir = ac.createBuffer(2, len, ac.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    this.verb = ac.createConvolver(); this.verb.buffer = ir;
    this.verbGain = ac.createGain(); this.verbGain.gain.value = 0.5;
    this.verb.connect(this.verbGain).connect(this.master);

    // Looped noise: white, and brown (integrated) for the low hum.
    const white = ac.createBuffer(1, ac.sampleRate * 3, ac.sampleRate), brown = ac.createBuffer(1, ac.sampleRate * 3, ac.sampleRate);
    const w = white.getChannelData(0), b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < w.length; i++) { const r = Math.random() * 2 - 1; w[i] = r; last = (last + 0.02 * r) / 1.02; b[i] = last * 3.5; }
    const loop = (buf) => { const s = ac.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
    const layer = (buf, nodes) => {
      let n = loop(buf);
      for (const x of nodes) { n.connect(x); n = x; }
      const g = ac.createGain(); g.gain.value = 0; n.connect(g); g.connect(this.master);
      return g;
    };
    const filt = (type, f, q = 0.7) => { const x = ac.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; return x; };
    this.water = layer(white, [filt('bandpass', 1100, 0.6), filt('lowpass', 3200)]);
    const bf = filt('bandpass', 420, 2.5);
    this.burble = layer(white, [bf]);
    this.rain = layer(white, [filt('highpass', 1800), filt('lowpass', 9000)]);
    this.hum = layer(brown, [filt('lowpass', 180)]);
    // The burble wobbles like water finding its way.
    const lfo = ac.createOscillator(), lg = ac.createGain();
    lfo.frequency.value = 0.35; lg.gain.value = 250;
    lfo.connect(lg); lg.connect(bf.frequency);
    lfo.start();
    document.addEventListener('visibilitychange', () => { document.hidden ? ac.suspend() : ac.resume(); });
  }

  setVolume(v) { this.volume = clamp(v, 0, 1); this.apply(); }
  setOn(on) { this.on = on; this.apply(); if (on) this.start(); }
  apply() {
    try { localStorage.setItem(KEY, JSON.stringify({ volume: this.volume, on: this.on })); } catch { /* private mode */ }
    if (this.master) this.master.gain.setTargetAtTime(this.on ? this.volume : 0, this.ac.currentTime, 0.15);
  }

  ramp(g, v, tc = 1.2) { g.gain.setTargetAtTime(v, this.ac.currentTime, tc); }

  // Called about twice a second with the game snapshot.
  update(live, dt = 0.5) {
    if (!this.ac || !this.on || !live) return;
    const ac = this.ac, now = ac.currentTime;
    this.t += dt;
    const falls = live.water?.falls ?? 0, pumping = live.water?.pumpRunning ? 1 : 0;
    const rain = clamp(live.env?.rain ?? 0, 0, 1);
    const light = live.clock?.light ?? 1;
    const night = clamp(1 - light * 1.6, 0, 1);
    this.ramp(this.water, clamp(falls * 0.07 + pumping * 0.03, 0, 0.32));
    this.ramp(this.burble, clamp(falls * 0.03 + (live.water?.pools ?? 0) * 0.01, 0, 0.14));
    this.ramp(this.rain, rain * 0.3, 0.6);
    this.ramp(this.hum, 0.16 + light * 0.05);
    const frogs = (live.census ?? []).filter((c) => ['dartfrog', 'strawberry', 'toad', 'leucomelas', 'auratus'].includes(c.id)).reduce((s, c) => s + c.n, 0);
    const humid = clamp(((live.env?.humidity ?? 70) - 60) / 30, 0, 1);

    if (night > 0.3 && this.t > this.nextChirp) { this.cricket(now, night * humid); this.nextChirp = this.t + 0.5 + Math.random() * 1.6; }
    if (frogs && this.t > this.nextCall && (night > 0.3 || rain > 0.3)) { this.call(now, clamp(0.3 + rain * 0.6, 0, 1)); this.nextCall = this.t + 2 + Math.random() * 6 / (1 + rain * 2); }
    if (humid > 0.3 && this.t > this.nextDrip) { this.drip(now); this.nextDrip = this.t + 1.5 + Math.random() * 5 / (1 + rain * 3); }
  }

  // A burst of three fast pulses of a high tone.
  cricket(t, vol) {
    const ac = this.ac, f = 3600 + Math.random() * 700;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < 3; i++) { const s = t + i * 0.07; g.gain.linearRampToValueAtTime(0.028 * (0.3 + vol), s + 0.02); g.gain.linearRampToValueAtTime(0, s + 0.055); }
    o.connect(g); g.connect(this.master); g.connect(this.verb);
    o.start(t); o.stop(t + 0.3);
  }

  // A soft two-note frog "unk".
  call(t, vol) {
    const ac = this.ac, base = 300 + Math.random() * 160;
    for (let i = 0; i < 2; i++) {
      const s = t + i * 0.16;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(base * 1.25, s); o.frequency.exponentialRampToValueAtTime(base, s + 0.12);
      g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.06 * vol, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0005, s + 0.16);
      o.connect(g); g.connect(this.master); g.connect(this.verb);
      o.start(s); o.stop(s + 0.2);
    }
  }

  // A drop falling into water: a short rising sine ping, mostly reverb.
  drip(t) {
    const ac = this.ac, f = 700 + Math.random() * 900;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.9, t + 0.09);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0004, t + 0.22);
    o.connect(g); g.connect(this.master); g.connect(this.verb);
    o.start(t); o.stop(t + 0.3);
  }
}
