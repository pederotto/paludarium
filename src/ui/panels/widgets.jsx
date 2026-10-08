// Small interactive teaching widgets used by the Field Guide. Each is wired to
// the current tank where it makes sense.

import { useState, useRef, useEffect } from 'preact/hooks';
import { S, toast, openModal } from '../store.js';
import { ctx } from '../../app/ctx.js';
import { Env } from '../../sim/env.js';
import { LENSES } from '../../editor/controller.js';
import { SPECIES } from '../../sim/animals.js';
import { SPECIES_GENETICS, lociOf, describe, morphOf, sexedSpecies, sexGenes } from '../../sim/genetics.js';
import { GUPPY_LOCI, GUPPY_TAIL_RECIPES } from '../../content/guppy.js';
import { LOCI_TEXT, morphName } from '../../content/morphs.js';
import { MorphDot, BreedingView } from '../GeneBits.jsx';

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

// --- Genetics: Punnett squares, offspring odds, and the field-guide widget ----------------------------------------------
// Field-guide widget: pick a species and two parents (from your tank if you have some) and see the odds.
export function PunnettWidget() {
  const W = ctx.game?.world;
  const tankAnimals = (id) => (W ? W.animals.by[id] ?? [] : []).filter((x) => x.genes);
  // (a species with sex chromosomes, the guppy: parent 1 is the mother, parent 2 the father, and each is offered only the genotypes
  // its sex can have: none on the Y for a mother, one copy on the X and the Y for a father)
  const sexed = (id) => sexedSpecies(id);
  const carrier0 = (id) => lociOf(id).map((l, i) => (i === 0 ? l.alleles[0] + l.alleles[1] : l.alleles[0] + l.alleles[0]));
  // (a guppy starts as a plain purple fish: the common allele of every gene, sexGenes' default, with one of each tail colour)
  const carrier = (id, who) => (sexed(id) ? sexGenes(id, lociOf(id).map((l, i) => (i === 0 ? l.alleles[0] + l.alleles[1] : undefined)), who === 0) : carrier0(id));
  const firstSp = ['axolotl', 'dartfrog', 'guppy', 'betta', 'shrimp'].find((id) => tankAnimals(id).length >= 2) ?? 'axolotl';
  const init = (id) => {
    const t = tankAnimals(id), f = sexed(id) ? t.find((x) => x.female) : t[0], m = sexed(id) ? t.find((x) => x.female === false) : t[1];
    return f && m ? [[...f.genes], [...m.genes], true] : [carrier(id, 0), carrier(id, 1), false];
  };
  const [sp, setSp] = useState(firstSp);
  const [[a, b, fromTank], setAB] = useState(() => init(firstSp));
  const pick = (id) => { setSp(id); setAB(init(id)); };
  const opts = (i, who = 0) => {
    const l = lociOf(sp)[i]; const [x, y] = l.alleles;
    if (!sexed(sp)) return [x + x, x + y, y + y];
    if (l.sex) return [who === 0 ? 'XX' : 'XY'];
    if (l.link === 'y') return who === 0 ? ['--'] : ['-' + x, '-' + y];
    if (l.link === 'x') return who === 0 ? [x + x, x + y, y + y] : [x + '-', y + '-'];
    return [x + x, x + y, y + y];
  };
  const label = (i, g, who = 0) => describe(sp, lociOf(sp).map((_, j) => (j === i ? g : opts(j, who)[0])))[i];
  const set = (who, i, g) => setAB(([p, q]) => (who === 0 ? [p.map((x, j) => (j === i ? g : x)), q, false] : [p, q.map((x, j) => (j === i ? g : x)), false]));
  const tank = tankAnimals(sp), tankFor = (who) => (sexed(sp) ? tank.filter((x) => !!x.female === (who === 0)) : tank);
  const fromAnimal = (who, id) => { const an = tank.find((x) => String(x.id) === id); if (an) setAB(([p, q]) => (who === 0 ? [[...an.genes], q, true] : [p, [...an.genes], true])); };
  const parent = (who, genes) => (
    <div class="gen-parent">
      <b>{sexed(sp) ? (who === 0 ? 'Mother' : 'Father') : `Parent ${who + 1}`}</b>
      {genes.map((g, i) => (opts(i, who).length < 2 ? null : (
        <select key={i} value={g} aria-label={LOCI_TEXT[sp][i].name} title={LOCI_TEXT[sp][i].name} onChange={(e) => set(who, i, e.currentTarget.value)}>
          {opts(i, who).map((o) => <option key={o} value={o}>{LOCI_TEXT[sp][i].name.replace(' gene', '')} {o}: {label(i, o, who).label}</option>)}
        </select>
      )))}
      {tankFor(who).length ? (
        <select value="" aria-label="Use an animal from your tank" onChange={(e) => fromAnimal(who, e.currentTarget.value)}>
          <option value="">from my tank…</option>
          {tankFor(who).map((x) => <option key={x.id} value={x.id}>{x.nick ?? '#' + x.id}: {morphName(sp, x.morph)}</option>)}
        </select>
      ) : null}
      <span><MorphDot sp={sp} morph={morphOf(sp, genes)} /> {morphName(sp, morphOf(sp, genes))}</span>
    </div>
  );
  return (
    <div class="gen">
      <div class="chips" style={{ margin: '6px 0' }}>
        {Object.keys(SPECIES_GENETICS).map((id) => <button key={id} class={'btn sm' + (sp === id ? ' primary' : '')} style={sp === id ? null : { color: '#2b2a1d', borderColor: '#a79d7a' }} onClick={() => pick(id)}>{SPECIES[id].name}</button>)}
      </div>
      {parent(0, a)}
      {parent(1, b)}
      {fromTank ? <div class="gen-hint">Using animals from your tank.</div> : null}
      <BreedingView sp={sp} a={a} b={b} />
    </div>
  );
}

// The guppy breeding guide's widget (Field Guide 'guppy-breeding'): the guppies in this tank, every gene with where it sits and how it
// shows, and the recipe of each of the twelve tails, all read from content/guppy.js.
const LINK_TEXT = { y: 'father to every son (Y)', x: 'son from his mother (X)' };
const MODE_TEXT = { dom: 'one copy shows', rec: 'needs two copies', inc: 'blends: one of each is in between' };
const TAIL_NAME = { delta: 'Delta', veil: 'Veil', flag: 'Flag', fan: 'Fan', spade: 'Spade', lyre: 'Lyre', round: 'Round', spear: 'Spear', pin: 'Pin', topsword: 'Top sword', bottomsword: 'Bottom sword', doublesword: 'Double sword' };
export function GuppyWidget() {
  S.live.value;
  const all = ctx.game?.world?.animals?.by?.guppy ?? [];
  const adult = (a) => a.age / 1440 >= (SPECIES.guppy.adultDays ?? 8);
  const males = all.filter((a) => a.female === false && adult(a)), females = all.filter((a) => a.female && adult(a));
  const fry = all.length - males.length - females.length, gravid = females.filter((a) => a.gv).length;
  const strains = {}; for (const a of males) strains[a.morph] = (strains[a.morph] ?? 0) + 1;
  const td = { padding: '3px 8px 3px 0', verticalAlign: 'top', borderBottom: '1px solid rgba(80,70,40,.15)' };
  return (
    <div class="gen">
      {all.length ? (
        <div>
          <p style={{ margin: '4px 0' }}><b>In this tank:</b> {males.length} male{males.length === 1 ? '' : 's'}, {females.length} female{females.length === 1 ? '' : 's'}{gravid ? ` (${gravid} carrying a brood)` : ''}{fry ? `, ${fry} young` : ''}.</p>
          <div class="chips" style={{ margin: '4px 0' }}>{Object.entries(strains).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([m, n]) => <span key={m} class="tag"><MorphDot sp="guppy" morph={m} /> {morphName('guppy', m)}{n > 1 ? ` × ${n}` : ''}</span>)}</div>
          <button class="btn sm" style={{ color: '#2b2a1d', borderColor: '#a79d7a' }} onClick={() => openModal('lab', 'genetics')}>Odds for two of them in the Lab</button>
        </div>
      ) : <p style={{ margin: '4px 0' }}>No guppies in this tank yet: release a trio with the Animals tool (one male, two females).</p>}
      <h3 style={{ marginTop: 12 }}>The twelve tails</h3>
      <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}><tbody>
        {GUPPY_TAIL_RECIPES.map((r) => <tr key={r.tail}><td style={{ ...td, fontWeight: 650, whiteSpace: 'nowrap' }}>{TAIL_NAME[r.tail]}</td><td style={td}>{r.recipe}</td></tr>)}
      </tbody></table>
      <h3 style={{ marginTop: 12 }}>The genes</h3>
      <table style={{ borderCollapse: 'collapse', fontSize: 12.5, width: '100%' }}><tbody>
        <tr><th style={{ ...td, textAlign: 'left' }}>Gene</th><th style={{ ...td, textAlign: 'left' }}>Letters</th><th style={{ ...td, textAlign: 'left' }}>Shows</th><th style={{ ...td, textAlign: 'left' }}>Passed on</th></tr>
        {GUPPY_LOCI.filter((l) => l.mode !== 'sex').map((l) => {
          const show = l.mode === 'rec' ? l.alleles[1] : l.mode === 'dom' ? l.alleles[0] : null;
          return (
            <tr key={l.key}>
              <td style={td}><b>{l.name.replace(' gene', '')}</b>{show ? <div style={{ opacity: 0.75 }}>{l.traits[show]}</div> : <div style={{ opacity: 0.75 }}>{l.alleles.map((a) => l.traits[a]).join(' / ')}; {l.mixed}</div>}</td>
              <td style={td}><code>{l.alleles.join(' ')}</code></td>
              <td style={td}>{MODE_TEXT[l.mode]}</td>
              <td style={td}>{LINK_TEXT[l.link] ?? 'one copy from each parent'}</td>
            </tr>
          );
        })}
      </tbody></table>
    </div>
  );
}

export const WIDGETS = { guppy: GuppyWidget, nitrogen: NitrogenWidget, dewpoint: DewWidget, watercycle: WaterCycleWidget, photoperiod: PhotoWidget, oxygen: OxygenWidget, feedback: FeedbackWidget, lens: LensWidget, punnett: PunnettWidget };
export { toast };
