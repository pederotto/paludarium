// The Lab: charts of what the tank has been doing (with a data logger), the
// automation controller (rules over sensors), and the Vacation test.

import { useState, useRef, useEffect } from 'preact/hooks';
import { S, toast, openModal } from '../store.js';
import { Sheet } from './Sheet.jsx';
import { Icon } from '../icons.jsx';
import { ctx } from '../../app/ctx.js';
import { GEAR, SENSORS, ACTUATORS } from '../../content/equipment.js';
import { runVacation } from '../../game/vacation.js';
import { SPECIES } from '../../sim/animals.js';
import { hasGenetics, carriedGenes } from '../../sim/genetics.js';
import { morphName } from '../../content/morphs.js';
import { MorphDot, BreedingView } from '../GeneBits.jsx';

const TABS = [['charts', 'Charts', 'chart'], ['genetics', 'Genetics', 'wand'], ['automation', 'Automation', 'cpu'], ['vacation', 'Vacation', 'sun']];

export function LabPanel() {
  const arg = S.modalArg.value;
  const [tab, setTab] = useState(['nitrogen', 'temp', 'humidity'].includes(arg) ? 'charts' : TABS.some((t) => t[0] === arg) ? arg : 'charts');
  return (
    <Sheet title="Lab" icon="flask" tabs={TABS} tab={tab} setTab={setTab} wide>
      {tab === 'charts' ? <Charts start={arg} /> : tab === 'genetics' ? <GeneticsTab /> : tab === 'automation' ? <Automation /> : <Vacation />}
    </Sheet>
  );
}

// A multi-series line chart. Each series is scaled to its own range, labelled at the right.
export function LineChart({ series, height = 200, days }) {
  const ref = useRef();
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = devicePixelRatio || 1, w = c.clientWidth, h = height;
    c.width = w * dpr; c.height = h * dpr;
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, h);
    const padL = 8, padR = 88, padT = 10, padB = 20;
    const W = w - padL - padR, H = h - padT - padB;
    g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const y = padT + (H * i) / 4; g.beginPath(); g.moveTo(padL, y); g.lineTo(padL + W, y); g.stroke(); }
    const n = Math.max(...series.map((s) => s.data.length), 2);
    g.fillStyle = 'rgba(255,255,255,.4)'; g.font = '10px system-ui'; g.textAlign = 'center';
    const span = days ?? n / 24;
    for (let d = 0; d <= span; d += Math.max(1, Math.round(span / 7))) g.fillText(`d${Math.round(d)}`, padL + (W * d) / span, h - 5);
    series.forEach((s, k) => {
      if (!s.data.length) return;
      const lo = s.min ?? Math.min(...s.data), hi = s.max ?? Math.max(...s.data);
      const r = hi - lo || 1;
      g.strokeStyle = s.color; g.lineWidth = 2; g.beginPath();
      s.data.forEach((v, i) => { const x = padL + (W * i) / (n - 1), y = padT + H - ((v - lo) / r) * H; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.stroke();
      const last = s.data[s.data.length - 1];
      g.fillStyle = s.color; g.textAlign = 'left'; g.font = '11px system-ui';
      g.fillText(`${s.name} ${last.toFixed(s.dec ?? 1)}${s.unit ?? ''}`, padL + W + 6, padT + 12 + k * 15);
    });
  }, [series, height, days]);
  return <canvas ref={ref} class="chart" style={{ height }} />;
}

function Charts({ start }) {
  const W = ctx.game.world;
  const has = W.equipment.has('logger');
  const [view, setView] = useState(start === 'nitrogen' ? 'nitrogen' : 'climate');
  const h = W.history ?? [];
  S.live.value;
  if (!has) {
    return (
      <div class="tile lock"><div style={{ display: 'flex', gap: 8 }}><Icon name="lock" size={16} /><b>{GEAR.logger.name}</b></div><p>{GEAR.logger.blurb}</p><p style={{ fontStyle: 'italic' }}>{GEAR.logger.teach}</p>
        <div class="foot"><span class="price">¤{GEAR.logger.price}</span><button class="btn sm primary" onClick={() => openModal('studio', 'shop')}>Open shop</button></div></div>
    );
  }
  const col = (k) => h.map((r) => r[k]);
  const testKit = W.equipment.has('testKit');
  return (
    <div>
      <div class="seg" style={{ marginBottom: 12 }}>
        {[['climate', 'Temperature and humidity'], ['nitrogen', 'Nitrogen cycle'], ['other', 'Oxygen, soil, mould']].map(([v, l]) => <button key={v} class={view === v ? 'on' : ''} onClick={() => setView(v)}>{l}</button>)}
      </div>
      {h.length < 3 ? <p class="note">The logger has only just started. Let time pass (use the speed buttons) and the lines will appear.</p> : null}
      {view === 'climate' ? (
        <>
          <LineChart series={[{ name: 'Temp', color: '#f0705a', data: col('temp'), unit: ' °C' }, { name: 'Humidity', color: '#6cc4d1', data: col('hum'), unit: '%', dec: 0 }]} />
          <p class="note">Watch the daily rhythm: the lamp warms the tank and dries the air; at night the reverse. If humidity dips every day, a rain or fogger rule can fill the gap.</p>
        </>
      ) : view === 'nitrogen' ? (
        testKit ? (
          <>
            <LineChart series={[{ name: 'Ammonia', color: '#f0705a', data: col('nh3'), unit: ' ppm', dec: 2, min: 0 }, { name: 'Nitrite', color: '#ebb96c', data: col('no2'), unit: ' ppm', dec: 2, min: 0 }, { name: 'Nitrate', color: '#8fd6a4', data: col('no3'), unit: ' ppm', dec: 0, min: 0 }]} />
            <p class="note">In a new tank ammonia rises first, then nitrite, and nitrate last, as the two bacteria colonies grow one after the other. <a href="#" onClick={(e) => { e.preventDefault(); openModal('codex', 'concept:nitrogen-cycle'); }} style={{ color: 'var(--moss)' }}>The nitrogen cycle</a></p>
          </>
        ) : <p class="note">You need a water test kit (Studio → Shop) to see the nitrogen lines.</p>
      ) : (
        <LineChart series={[{ name: 'Oxygen', color: '#6cc4d1', data: col('o2'), unit: ' mg/L' }, { name: 'Soil', color: '#c9a24a', data: col('soil').map((v) => v * 100), unit: '%', dec: 0, min: 0, max: 100 }, { name: 'Mould', color: '#b9b9a8', data: col('mold').map((v) => v * 100), unit: '%', dec: 0, min: 0, max: 100 }]} />
      )}
    </div>
  );
}

// Pick two animals of one species, see a Punnett square for every gene and the exact odds of every colour in their babies.
function GeneticsTab() {
  const W = ctx.game.world;
  S.live.value;
  const all = W.animals.all.filter((a) => a.genes && hasGenetics(a.sp));
  const speciesIds = [...new Set(all.map((a) => a.sp))];
  const ids = S.geneParents.value;
  const pre = all.find((a) => a.id === ids[0]);
  const [sp0, setSp] = useState(pre?.sp ?? null);
  const sp = speciesIds.includes(sp0) ? sp0 : speciesIds[0] ?? null;
  const list = all.filter((a) => a.sp === sp);
  const chosen = ids.map((id) => list.find((a) => a.id === id)).filter(Boolean).slice(0, 2);
  const toggle = (a) => {
    const cur = chosen.map((x) => x.id);
    S.geneParents.value = cur.includes(a.id) ? cur.filter((x) => x !== a.id) : [...cur, a.id].slice(-2);
  };
  if (!all.length) {
    return (
      <div class="tile"><b>No animals with genes yet</b><p>Release axolotls, blue dart frogs, guppies, bettas or cherry shrimp with the Animals tool. Each one has a colour morph and a pair of genes behind it, and here you can see what a pair will pass on.</p>
        <div class="foot"><button class="btn sm" onClick={() => openModal('codex', 'concept:genetics')}><Icon name="book" size={14} /> Field guide: colour genetics</button></div></div>
    );
  }
  const [pa, pb] = chosen;
  const mates = pa && pb && pa.mate === pb.id;
  const slot = (a) => (a === pa ? 'A' : a === pb ? 'B' : null);
  const isAdult = (a) => a.age / 1440 >= (SPECIES[a.sp].adultDays ?? 10);
  return (
    <div>
      <p class="note" style={{ marginTop: 0 }}>Every animal has two copies of each gene. Choose two animals below to see what each can pass on and how likely each colour is among their babies. <a href="#" onClick={(e) => { e.preventDefault(); openModal('codex', 'concept:genetics'); }} style={{ color: 'var(--moss)' }}>Colour genetics</a></p>
      <div class="chips">
        {speciesIds.map((id) => <button key={id} class={'chip' + (sp === id ? ' on' : '')} onClick={() => setSp(id)}>{SPECIES[id].name} ({all.filter((a) => a.sp === id).length})</button>)}
      </div>
      <div class="glab-list">
        {list.map((a) => {
          const car = carriedGenes(a.sp, a.genes);
          return (
            <button key={a.id} class={'glab-card' + (slot(a) ? ' on' : '')} aria-pressed={!!slot(a)} onClick={() => toggle(a)}>
              <span class="top"><MorphDot sp={a.sp} morph={a.morph} /><span>{a.nick || morphName(a.sp, a.morph)}</span>{slot(a) ? <span class="slot">{slot(a)}</span> : null}</span>
              <code>{a.genes.join(' ')}</code>
              <span class="sub">#{a.id} · gen {a.gen ?? 0} · {isAdult(a) ? 'adult' : 'young'}{a.mate != null && W.animals.mateOf(a) ? ' · paired' : ''}{car.length ? ` · carries ${car.length}` : ''}</span>
            </button>
          );
        })}
      </div>
      {pa && pb ? (
        <div class="glab-out">
          <h4><MorphDot sp={sp} morph={pa.morph} /> {pa.nick || '#' + pa.id} × <MorphDot sp={sp} morph={pb.morph} /> {pb.nick || '#' + pb.id}</h4>
          <div class="gen-hint">{[pa, pb].map((a) => `${a.nick || '#' + a.id}: ${morphName(sp, a.morph)}${carriedGenes(sp, a.genes).length ? ', hidden ' + carriedGenes(sp, a.genes).map((g) => g.replace(' gene', '').toLowerCase()).join(' and ') : ''}`).join('  |  ')}</div>
          <BreedingView sp={sp} a={pa.genes} b={pb.genes} />
          <div class="chips">
            {mates ? <span class="tag moss">Marked as a pair: they will breed together</span> : <button class="btn sm primary" onClick={() => { W.animals.pairUp(pa, pb); toast('Marked as a pair. Adults that are fed and healthy will breed.'); up(); }}><Icon name="heart" size={14} /> Pair these two</button>}
            {!isAdult(pa) || !isAdult(pb) ? <span class="tag amber">Only adults breed</span> : null}
          </div>
        </div>
      ) : <p class="note">Tap {pa ? 'one more animal' : 'two animals'} above{list.length < 2 ? ' (you need at least two of this species)' : ''}.</p>}
    </div>
  );
  function up() { S.live.value = { ...S.live.value }; }
}

function Automation() {
  const W = ctx.game.world, eq = W.equipment;
  const [, force] = useState(0);
  const up = () => force((n) => n + 1);
  if (!eq.has('controller')) {
    const g = GEAR.controller, info = ctx.career?.info('gear', 'controller');
    return (
      <div class="tile lock"><div style={{ display: 'flex', gap: 8 }}><Icon name="lock" size={16} /><b>{g.name}</b></div><p>{g.blurb}</p><p style={{ fontStyle: 'italic' }}>{g.teach}</p>
        <div class="foot"><span class="price">{info?.locked ? `Rank ${info.level}` : `¤${g.price}`}</span><button class="btn sm primary" onClick={() => openModal('studio', 'shop')}>Open shop</button></div></div>
    );
  }
  const hours = Array.from({ length: 25 }, (_, i) => i);
  return (
    <div>
      <p class="note" style={{ marginTop: 0 }}>Rules run every minute of tank time, day and night, even while you are away. A rule that is true switches its actuator on; when false, the actuator returns to off (unless another rule wants it). A small dead band stops it chattering. <a href="#" onClick={(e) => { e.preventDefault(); openModal('codex', 'concept:feedback-control'); }} style={{ color: 'var(--moss)' }}>Feedback control</a></p>
      {eq.rules.map((r) => (
        <div key={r.id} class="tile" style={{ marginBottom: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <span class="tag" style={r.on ? { background: 'var(--moss)', color: '#0b1a10' } : null}>{r.on ? 'ON' : 'off'}</span>
          <span>When</span>
          <select value={r.sensor} onChange={(e) => { r.sensor = e.currentTarget.value; r.value = SENSORS[r.sensor].min + (SENSORS[r.sensor].max - SENSORS[r.sensor].min) / 2; up(); }}>{Object.entries(SENSORS).map(([k, s]) => <option key={k} value={k}>{s.name}</option>)}</select>
          <select value={r.op} onChange={(e) => { r.op = e.currentTarget.value; up(); }}><option value="below">is below</option><option value="above">is above</option></select>
          <input type="number" value={r.value} step={SENSORS[r.sensor].step} min={SENSORS[r.sensor].min} max={SENSORS[r.sensor].max} onInput={(e) => { r.value = +e.currentTarget.value; up(); }} style={{ width: 70, background: 'rgba(255,255,255,.07)', color: 'inherit', border: '1px solid var(--line-2)', borderRadius: 6, padding: 4 }} /> {SENSORS[r.sensor].unit}
          <span>between</span>
          <select value={r.from} onChange={(e) => { r.from = +e.currentTarget.value; up(); }}>{hours.slice(0, 24).map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</select>
          <span>and</span>
          <select value={r.to} onChange={(e) => { r.to = +e.currentTarget.value; up(); }}>{hours.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</select>
          <span>then</span>
          <select value={r.actuator} onChange={(e) => { r.actuator = e.currentTarget.value; up(); }}>{Object.entries(ACTUATORS).filter(([, a]) => eq.has(a.gear)).map(([k, a]) => <option key={k} value={k}>{a.name}</option>)}</select>
          <button class="btn sm ghost" onClick={() => { eq.removeRule(r.id); up(); }}>Delete</button>
        </div>
      ))}
      <button class="btn sm primary" onClick={() => { eq.addRule({ sensor: 'humidity', op: 'below', value: 82, actuator: eq.has('fogger') ? 'fogger' : 'fan' }); ctx.career?.stat('rulesWritten'); up(); }}><Icon name="plus" size={14} /> Add rule</button>
      {eq.trace.length ? (
        <>
          <div class="h3" style={{ marginTop: 14 }}>Recent firings</div>
          {eq.trace.slice(-6).reverse().map((t, i) => <div class="log" key={i}><i>{Math.floor(t.m / 1440) + 1}</i>{t.text}</div>)}
        </>
      ) : null}
    </div>
  );
}

function Vacation() {
  const W = ctx.game.world;
  const [days, setDays] = useState(7);
  const [revert, setRevert] = useState(true);
  const [report, setReport] = useState(null);
  const [prog, setProg] = useState(null);
  const go = async () => {
    const saved = revert ? W.serialize() : null;
    const wasSpeed = ctx.game.speed;
    ctx.game.frozen = true;
    setProg(0);
    S.busy.value = { text: `Away for ${days} days…` };
    const r = await runVacation(W, days, { onProgress: (p) => setProg(p) });
    S.busy.value = null;
    ctx.game.frozen = false; ctx.game.setSpeed(wasSpeed);
    if (revert) { W.load(saved); ctx.director.syncGear(); }
    if (r.verdict === 'Thriving' || r.verdict === 'Fine') ctx.career?.stat('vacationsSurvived');
    setProg(null); setReport(r);
    ctx.director.publish();
  };
  const col = { Thriving: 'var(--moss)', Fine: 'var(--moss)', Struggling: 'var(--amber)', Disaster: 'var(--coral)' };
  return (
    <div>
      <p class="note" style={{ marginTop: 0 }}>Go away and see what happens. The tank runs with no manual care; only your automation acts. Then read the report and fix what failed. It is the fastest way to learn what your build really depends on.</p>
      <div class="chips">{[3, 7, 14].map((d) => <button key={d} class={'chip' + (days === d ? ' on' : '')} onClick={() => setDays(d)}>{d} days</button>)}
        <Toggle2 on={revert} set={setRevert} label="Undo afterwards (test only)" /></div>
      <button class="btn primary" onClick={go} disabled={prog != null}><Icon name="sun" size={16} /> {prog != null ? `Away… ${Math.round(prog * 100)}%` : 'Start vacation'}</button>
      {report ? (
        <div class="tile" style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}><h4 style={{ fontSize: 24, color: col[report.verdict] }}>{report.verdict}</h4><span class="note" style={{ margin: 0 }}>after {report.days} days: {report.animals} animals, {report.deaths.length} lost, {report.births} born</span></div>
          <LineChart series={[{ name: 'Temp', color: '#f0705a', data: report.series.temp, unit: ' °C' }, { name: 'Humidity', color: '#6cc4d1', data: report.series.humidity, unit: '%', dec: 0 }, { name: 'Ammonia', color: '#ebb96c', data: report.series.ammonia, unit: '', dec: 2, min: 0 }]} days={report.days} />
          {report.deaths.map((d, i) => <div class="log bad" key={i}><i>day {d.day}</i>{d.note}</div>)}
          <div class="h3" style={{ marginTop: 10 }}>What to do</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{report.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </div>
      ) : null}
    </div>
  );
}
const Toggle2 = ({ on, set, label }) => <button class={'chip' + (on ? ' on' : '')} onClick={() => set(!on)}>{label}</button>;
export { toast };
