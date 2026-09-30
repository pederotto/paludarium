// Small interactive teaching widgets used by the Field Guide. Each is wired to
// the current tank where it makes sense.

import { useState, useRef, useEffect } from 'preact/hooks';
import { S, toast } from '../store.js';
import { ctx } from '../../app/ctx.js';
import { Env } from '../../sim/env.js';
import { LENSES } from '../../tools/controller.js';

const live = () => S.live.value?.env ?? {};

// A range bar: comfortable range, with a marker for where the tank is now.
export function RangeBar({ label, unit = '', lo, hi, now, domain, dec = 0 }) {
  const [d0, d1] = domain;
  const pos = (v) => Math.max(0, Math.min(100, ((v - d0) / (d1 - d0)) * 100));
  const inside = now != null && now >= lo && now <= hi;
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
        <b>{label}</b>
        <span>{lo === hi ? `${lo}${unit}+` : `${lo}–${hi}${unit}`}{now != null ? <span style={{ marginLeft: 8, color: inside ? '#2a6a45' : '#b03a25', fontWeight: 600 }}>now {now.toFixed(dec)}{unit}</span> : null}</span>
      </div>
      <div class="range" style={{ marginTop: 6, marginBottom: 6 }}>
        <div class="track" />
        <div class="ok" style={{ left: pos(lo) + '%', width: Math.max(1, pos(hi) - pos(lo)) + '%' }} />
        {now != null ? <div class="now" style={{ left: pos(now) + '%' }} /> : null}
      </div>
    </div>
  );
}

// --- The nitrogen cycle, with this tank's numbers --------------------------------------
export function NitrogenWidget() {
  const e = live();
  const node = (x, name, sub, v, max, color) => {
    const r = 24 + 26 * Math.min(1, (v ?? 0) / max);
    return (
      <g key={name}>
        <circle cx={x} cy={80} r={r} fill={color} opacity="0.85" />
        <text x={x} y={76} text-anchor="middle" font-size="13" font-weight="700" fill="#fff">{name}</text>
        <text x={x} y={92} text-anchor="middle" font-size="11" fill="#fff">{(v ?? 0).toFixed(v < 10 ? 2 : 0)} ppm</text>
        <text x={x} y={148} text-anchor="middle" font-size="11" fill="#5a5238">{sub}</text>
      </g>
    );
  };
  const arrow = (x1, x2, label) => (
    <g>
      <path d={`M${x1} 80 L${x2 - 8} 80`} stroke="#5a5238" stroke-width="2" marker-end="url(#ah)" fill="none" />
      <text x={(x1 + x2) / 2} y={62} text-anchor="middle" font-size="10.5" fill="#5a5238">{label}</text>
    </g>
  );
  return (
    <div>
      <svg viewBox="0 0 520 165" style={{ width: '100%', maxWidth: 560 }} role="img" aria-label="Ammonia to nitrite to nitrate">
        <defs><marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#5a5238" /></marker></defs>
        <text x="20" y="28" font-size="11" fill="#5a5238">waste + rotting food</text>
        <path d="M60 34 L60 52" stroke="#5a5238" stroke-width="2" marker-end="url(#ah)" />
        {node(70, 'NH₃', 'ammonia: toxic', e.ammonia, 1, '#c0432b')}
        {arrow(125, 235, 'Nitrosomonas')}
        {node(260, 'NO₂⁻', 'nitrite: toxic', e.nitrite, 1, '#d08a2a')}
        {arrow(320, 420, 'Nitrospira')}
        {node(445, 'NO₃⁻', 'nitrate: fertiliser', e.nitrate, 80, '#3f8a5a')}
        <text x="445" y="28" text-anchor="middle" font-size="10.5" fill="#5a5238">plants, water changes</text>
        <path d="M445 32 L445 44" stroke="#5a5238" stroke-width="2" />
      </svg>
      <div style={{ fontSize: 13 }}>Bacteria in this tank: <b>{Math.round((e.cycle ?? 0) * 100)}%</b> of a mature colony. {e.cycle < 0.5 ? 'Not cycled yet: hold off on fish.' : e.cycle < 0.85 ? 'Nearly there.' : 'Cycled.'}</div>
    </div>
  );
}

// --- Dew point calculator -------------------------------------------------------------------
export function DewWidget() {
  const e = live();
  const [t, setT] = useState(Math.round((e.temp ?? 24) * 2) / 2);
  const [rh, setRh] = useState(Math.round(e.humidity ?? 85));
  const [room, setRoom] = useState(e.room ?? 21);
  const dew = Env.dewPoint(t, rh);
  const glass = room + (t - room) * 0.22;
  const fog = Math.max(0, Math.min(1, (dew - glass) / 4.2));
  const S_ = (label, v, set, min, max, step, unit) => (
    <label class="row" style={{ color: '#4a4530' }}><span style={{ width: 110 }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={v} onInput={(ev) => set(+ev.currentTarget.value)} />
      <output style={{ color: '#2b2a1d', width: 56 }}>{v}{unit}</output></label>
  );
  return (
    <div>
      {S_('Air temperature', t, setT, 10, 35, 0.5, ' °C')}
      {S_('Relative humidity', rh, setRh, 30, 100, 1, ' %')}
      {S_('Room temperature', room, setRoom, 10, 30, 0.5, ' °C')}
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', margin: '8px 0', fontSize: 13.5 }}>
        <span>Dew point <b>{dew.toFixed(1)} °C</b></span>
        <span>Glass ≈ <b>{glass.toFixed(1)} °C</b></span>
        <span>{fog > 0.05 ? <b style={{ color: '#3a6a7a' }}>Fog: {fog < 0.3 ? 'a few beads' : fog < 0.7 ? 'beading' : 'heavy'}</b> : <b style={{ color: '#2a6a45' }}>Glass stays clear</b>}</span>
      </div>
      <button class="btn sm" style={{ color: '#2b2a1d', borderColor: '#a79d7a', background: 'rgba(0,0,0,.05)' }} onClick={() => { setT(Math.round(e.temp * 2) / 2); setRh(Math.round(e.humidity)); setRoom(e.room); }}>Use my tank's numbers</button>
    </div>
  );
}

// --- Water cycle ----------------------------------------------------------------------------------
export function WaterCycleWidget() {
  const e = live();
  const fog = e.condense ?? 0;
  return (
    <div>
      <svg viewBox="0 0 320 230" style={{ width: '100%', maxWidth: 380 }} role="img" aria-label="Water cycle in a jar">
        <defs><marker id="ah2" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="#3a6a7a" /></marker></defs>
        <rect x="70" y="20" width="180" height="180" rx="30" fill="#dfeee8" stroke="#6b8f86" stroke-width="3" opacity="0.7" />
        <rect x="72" y="150" width="176" height="48" rx="14" fill="#6a4a30" />
        <ellipse cx="130" cy="150" rx="46" ry="6" fill="#3f7f5f" />
        {[...Array(Math.round(fog * 10) + 2)].map((_, i) => <circle key={i} cx={82 + (i * 37) % 160} cy={34 + (i * 53) % 40} r={2 + (i % 3)} fill="#7aa6b6" />)}
        <path d="M110 145 L110 95" stroke="#3a6a7a" stroke-width="2.5" marker-end="url(#ah2)" fill="none" />
        <text x="30" y="120" font-size="11" fill="#3a6a7a">evaporation +</text><text x="30" y="133" font-size="11" fill="#3a6a7a">transpiration</text>
        <path d="M170 90 L200 60" stroke="#3a6a7a" stroke-width="2.5" marker-end="url(#ah2)" fill="none" />
        <text x="205" y="70" font-size="11" fill="#3a6a7a">condensation</text>
        <path d="M225 80 L225 138" stroke="#3a6a7a" stroke-width="2.5" stroke-dasharray="4 4" marker-end="url(#ah2)" fill="none" />
        <text x="232" y="112" font-size="11" fill="#3a6a7a">rain</text>
      </svg>
      <div style={{ fontSize: 13 }}>Your tank: humidity <b>{Math.round(e.humidity ?? 0)}%</b>, glass fog <b>{Math.round(fog * 100)}%</b>, soil <b>{Math.round((e.soil ?? 0) * 100)}%</b> wet.</div>
    </div>
  );
}

// --- Photoperiod ---------------------------------------------------------------------------------------
export function PhotoWidget() {
  const e = live();
  const on = (e.lightsOn ?? 480) / 60, off = (e.lightsOff ?? 1200) / 60;
  const hours = e.lights === 'on' ? 24 : e.lights === 'off' ? 0 : ((off - on) + 24) % 24;
  const dli = hours * (e.lampPower ?? 1);
  const needs = [['Shade ferns and moss', 3.5], ['Most tropical plants', 6], ['Bright water plants and lilies', 9]];
  const setHours = (v) => { const w = ctx.game.world; w.env.lights = 'auto'; w.env.lightsOn = 8 * 60; w.env.lightsOff = (8 + v) * 60; S.live.value = { ...S.live.value }; };
  return (
    <div>
      <div style={{ position: 'relative', height: 28, background: 'rgba(60,50,20,.12)', borderRadius: 6, margin: '6px 0 4px' }}>
        <div style={{ position: 'absolute', left: (on / 24) * 100 + '%', width: ((hours / 24) * 100) + '%', top: 0, bottom: 0, background: '#e6b84a', borderRadius: 6 }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#6b6650' }}><span>00</span><span>06</span><span>12</span><span>18</span><span>24 h</span></div>
      <label class="row" style={{ color: '#4a4530' }}><span style={{ width: 110 }}>Hours of light</span>
        <input type="range" min="0" max="16" step="1" value={Math.round(hours)} onInput={(ev) => setHours(+ev.currentTarget.value)} />
        <output style={{ color: '#2b2a1d', width: 56 }}>{Math.round(hours)} h</output></label>
      <p style={{ margin: '6px 0' }}>Light dose today: <b>{dli.toFixed(1)}</b> lamp-hours (brightness × hours).</p>
      {needs.map(([n, need]) => (
        <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, margin: '3px 0' }}>
          <span style={{ width: 200 }}>{n}</span>
          <div style={{ flex: 1, height: 8, background: 'rgba(60,50,20,.12)', borderRadius: 4, overflow: 'hidden' }}><div style={{ width: Math.min(100, (dli / need) * 100) + '%', height: '100%', background: dli >= need ? '#4a9a6a' : '#c9a24a' }} /></div>
          <span style={{ width: 70, textAlign: 'right' }}>{dli >= need ? 'enough' : 'too little'}</span>
        </div>
      ))}
    </div>
  );
}

// --- Oxygen vs temperature -------------------------------------------------------------------------------
export function OxygenWidget() {
  const e = live();
  const sat = (t) => 14.6 - 0.39 * t + 0.0066 * t * t;   // mg/L in fresh water at sea level, good to ±1% for 5–35 °C
  const pts = [];
  for (let t = 5; t <= 35; t += 1) pts.push(`${40 + (t - 5) * 14},${150 - (sat(t) - 6) * 22}`);
  const now = e.temp ?? 24;
  return (
    <div>
      <svg viewBox="0 0 490 175" style={{ width: '100%', maxWidth: 520 }} role="img" aria-label="Oxygen saturation against temperature">
        <polyline points={pts.join(' ')} fill="none" stroke="#3a6a7a" stroke-width="3" />
        <line x1={40 + (now - 5) * 14} x2={40 + (now - 5) * 14} y1="10" y2="150" stroke="#c0432b" stroke-width="2" stroke-dasharray="4 3" />
        <circle cx={40 + (now - 5) * 14} cy={150 - (sat(now) - 6) * 22} r="5" fill="#c0432b" />
        {[10, 20, 30].map((t) => <text key={t} x={40 + (t - 5) * 14} y="167" text-anchor="middle" font-size="11" fill="#5a5238">{t} °C</text>)}
        {[8, 10, 12].map((v) => <text key={v} x="34" y={154 - (v - 6) * 22} text-anchor="end" font-size="11" fill="#5a5238">{v}</text>)}
        <text x="16" y="14" font-size="11" fill="#5a5238">mg/L</text>
      </svg>
      <div style={{ fontSize: 13 }}>Saturation at {now.toFixed(1)} °C is <b>{sat(now).toFixed(1)} mg/L</b>. Your tank reads <b>{(e.oxygen ?? 0).toFixed(1)}</b>.</div>
    </div>
  );
}

// --- Feedback control: a thermostat you can watch ---------------------------------------------------------------
export function FeedbackWidget() {
  const ref = useRef();
  const [band, setBand] = useState(2);
  useEffect(() => {
    const c = ref.current, g = c.getContext('2d');
    const W = c.width, H = c.height;
    let T = 21, on = false, t = 0, raf;
    const hist = [];
    const step = () => {
      for (let k = 0; k < 2; k++) {
        const target = 23;
        if (T < target - band / 2) on = true; else if (T > target + band / 2) on = false;
        T += (on ? 0.09 : 0) - (T - 18) * 0.012;
        hist.push([T, on]); if (hist.length > W) hist.shift();
      }
      g.clearRect(0, 0, W, H);
      g.fillStyle = 'rgba(74,154,106,.15)';
      const y = (v) => H - ((v - 17) / 10) * H;
      g.fillRect(0, y(23 + band / 2), W, y(23 - band / 2) - y(23 + band / 2));
      g.strokeStyle = '#c0432b'; g.lineWidth = 2; g.beginPath();
      hist.forEach(([v], i) => (i ? g.lineTo(i, y(v)) : g.moveTo(i, y(v)))); g.stroke();
      g.fillStyle = '#5a5238'; g.font = '11px sans-serif'; g.fillText(`heater ${on ? 'ON' : 'off'}`, 8, 14);
      t++; raf = requestAnimationFrame(step);
    };
    step();
    return () => cancelAnimationFrame(raf);
  }, [band]);
  return (
    <div>
      <canvas ref={ref} width="520" height="140" style={{ width: '100%', maxWidth: 520, background: 'rgba(255,255,255,.4)', borderRadius: 8 }} />
      <label class="row" style={{ color: '#4a4530' }}><span style={{ width: 130 }}>Dead band</span>
        <input type="range" min="0.2" max="5" step="0.2" value={band} onInput={(ev) => setBand(+ev.currentTarget.value)} />
        <output style={{ color: '#2b2a1d', width: 56 }}>{band.toFixed(1)} °C</output></label>
      <p style={{ margin: '4px 0 0', fontSize: 12.5 }}>Narrow band: the heater clicks on and off constantly. Wide band: the temperature swings. Real controllers pick a compromise.</p>
    </div>
  );
}

// --- Lens buttons -------------------------------------------------------------------------------------------------
export function LensWidget() {
  return (
    <div class="chips">
      {LENSES.map((l) => <button key={l} class={'chip' + (S.lens.value === l ? ' on' : '')} onClick={() => { S.lens.value = l; }}>{l === 'off' ? 'Lens off' : l}</button>)}
    </div>
  );
}

// --- Punnett square ------------------------------------------------------------------------------------------------------
export function PunnettWidget() {
  const [a, setA] = useState('Ll'), [b, setB] = useState('ll');
  const opts = ['LL', 'Ll', 'll'];
  const alle = (g) => [g[0], g[1]];
  const cell = (x, y) => [x, y].sort().join('');
  const kids = []; for (const x of alle(a)) for (const y of alle(b)) kids.push(cell(x, y));
  const look = (g) => (g === 'll' ? 'leucistic (pink)' : g === 'Ll' ? 'wild-type, carrier' : 'wild-type');
  const sel = (v, set) => <select value={v} onChange={(e) => set(e.currentTarget.value)} style={{ color: '#2b2a1d', background: '#fff' }}>{opts.map((o) => <option key={o} value={o}>{o} · {look(o)}</option>)}</select>;
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '6px 0' }}>Parent 1 {sel(a, setA)} Parent 2 {sel(b, setB)}</div>
      <table style={{ borderCollapse: 'collapse', margin: '8px 0' }}>
        <tbody>
          <tr><td></td>{alle(b).map((x, i) => <td key={i} style={{ padding: '4px 14px', fontWeight: 700 }}>{x}</td>)}</tr>
          {alle(a).map((x, i) => <tr key={i}><td style={{ padding: '4px 14px', fontWeight: 700 }}>{x}</td>{alle(b).map((y, j) => <td key={j} style={{ border: '1px solid #a79d7a', padding: '6px 14px', textAlign: 'center' }}>{cell(x, y)}</td>)}</tr>)}
        </tbody>
      </table>
      <div style={{ fontSize: 13 }}>{[...new Set(kids)].map((k) => `${kids.filter((x) => x === k).length * 25}% ${look(k)}`).join(' · ')}</div>
    </div>
  );
}

export const WIDGETS = { nitrogen: NitrogenWidget, dewpoint: DewWidget, watercycle: WaterCycleWidget, photoperiod: PhotoWidget, oxygen: OxygenWidget, feedback: FeedbackWidget, lens: LensWidget, punnett: PunnettWidget };
export { toast };
