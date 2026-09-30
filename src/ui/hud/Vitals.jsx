import { Icon } from '../icons.jsx';
import { S, toast, openModal } from '../store.js';
import { ctx } from '../../app/ctx.js';
import { Care } from '../../app/actions.js';
import { SPECIES } from '../../sim/animals.js';
import { PLANTS } from '../../sim/plants.js';

// A ring gauge: `good` is the comfortable range; outside it the ring warms to amber then coral.
function Gauge({ icon, label, value, text, unit, good, warn, onClick }) {
  const [lo, hi] = good;
  const dev = value < lo ? lo - value : value > hi ? value - hi : 0;
  const level = dev === 0 ? 'good' : dev < warn ? 'warn' : 'bad';
  return (
    <div class={'gauge ' + level} onClick={onClick} title={`${label}: comfortable ${lo}–${hi}${unit}`}>
      <Icon name={icon} size={18} style={{ color: level === 'good' ? 'var(--moss)' : level === 'warn' ? 'var(--amber)' : 'var(--coral)' }} />
      <b>{text}</b>
      <small>{label}</small>
    </div>
  );
}

const cls = (v, warn, bad, inv = false) => (inv ? (v < bad ? 'bad' : v < warn ? 'warn' : '') : (v > bad ? 'bad' : v > warn ? 'warn' : ''));

function Row({ label, value, level = '', onClick }) {
  return <div class={'stat ' + level + (onClick ? ' link' : '')} onClick={onClick}><span>{label}</span><b>{value}</b></div>;
}

export function Vitals() {
  const live = S.live.value;
  if (!live) return null;
  const open = S.right.value;
  if (!open) {
    return (
      <button class="btn glass icon" style={{ position: 'absolute', right: 10, top: 66, zIndex: 4 }} onClick={() => { S.right.value = true; }} title="Show panel (H)">
        <Icon name="chevronL" size={16} />
      </button>
    );
  }
  const e = live.env, has = (id) => ctx.game.world.equipment.has(id);
  const testKit = has('testKit'), hygro = has('hygro');
  return (
    <div class="vitals">
      <div class="card glass">
        <div class="stage-line"><b>{live.stage.name}</b><span class="num" style={{ color: 'var(--dim)', fontSize: 12 }}>day {Math.floor(e.tankDays) + 1}</span></div>
        <div class="bar" title="Maturity"><i style={{ width: Math.round(live.stage.progress * 100) + '%' }} /></div>
        <p class="note" style={{ marginBottom: 8 }}>{live.stage.tip}</p>
        {hygro ? (
          <div class="gauges">
            <Gauge icon="thermo" label="Temp" value={e.temp} text={e.temp.toFixed(1) + '°'} unit="°C" good={[20, 27]} warn={3} onClick={() => openModal('lab', 'temp')} />
            <Gauge icon="drop" label="Humidity" value={e.humidity} text={Math.round(e.humidity) + '%'} unit="%" good={[70, 96]} warn={12} onClick={() => openModal('lab', 'humidity')} />
            <Gauge icon="flask" label="Water" value={waterScore(e)} text={waterWord(e)} unit="" good={[0.7, 1]} warn={0.25} onClick={() => openModal('lab', 'nitrogen')} />
          </div>
        ) : <p class="note">Fit a thermo-hygrometer in the Studio shop to read temperature and humidity.</p>}
        <Row label="Water" value={`${live.water.litres.toFixed(1)} L`} level={live.water.outlets && !live.water.pumpRunning && live.water.pumpOn ? 'bad' : ''} />
        {testKit ? (
          <>
            <Row label="Ammonia" value={e.ammonia.toFixed(2) + ' ppm'} level={cls(e.ammonia, 0.2, 0.5)} onClick={() => openModal('codex', 'concept:nitrogen-cycle')} />
            <Row label="Nitrite" value={e.nitrite.toFixed(2) + ' ppm'} level={cls(e.nitrite, 0.25, 0.5)} onClick={() => openModal('codex', 'concept:nitrogen-cycle')} />
            <Row label="Nitrate" value={Math.round(e.nitrate) + ' ppm'} level={cls(e.nitrate, 40, 60)} onClick={() => openModal('codex', 'concept:nitrogen-cycle')} />
          </>
        ) : null}
        <Row label="Oxygen" value={e.oxygen.toFixed(1) + ' mg/L'} level={cls(e.oxygen, 5, 4, true)} />
        <Row label="Bacteria" value={Math.round(e.cycle * 100) + '% cycled'} level={e.cycle < 0.5 ? 'warn' : ''} onClick={() => openModal('codex', 'concept:nitrogen-cycle')} />
        <Row label="Algae" value={e.algae > 0.3 ? 'bloom' : e.diatoms > 0.3 ? 'diatoms' : e.algae > 0.15 ? 'some' : 'little'} level={e.algae > 0.3 ? 'bad' : e.algae > 0.15 || e.diatoms > 0.3 ? 'warn' : ''} onClick={() => openModal('codex', 'concept:algae')} />
        <Row label="Moss cover" value={Math.round(live.moss * 100) + '%'} />
        <Row label="Soil moisture" value={Math.round(e.soil * 100) + '%'} level={e.soil > 0.92 ? 'warn' : e.soil < 0.2 ? 'warn' : ''} onClick={() => openModal('codex', 'concept:soil-moisture')} />
        {e.mold > 0.15 ? <Row label="Mould" value={e.mold > 0.6 ? 'spreading' : 'appearing'} level={e.mold > 0.6 ? 'bad' : 'warn'} onClick={() => openModal('codex', 'concept:mould')} /> : null}
        {e.condense > 0.25 ? <Row label="Glass" value="fogged with dew" onClick={() => openModal('codex', 'concept:dew-point')} /> : null}
        {hygro ? <Row label="Damp ↔ dry spots" value={`${Math.round(live.micro.humRange[0])}–${Math.round(live.micro.humRange[1])}%`} onClick={() => { S.lens.value = 'humidity'; }} /> : null}
      </div>
      <QuickCare />
      <div class="card glass">
        <div class="h3">Inhabitants</div>
        {live.census.map((c) => (
          <div class="census" key={c.id}>
            <span class="n">{c.n}</span>
            <span>{c.name}</span>
            <span class={'bar hp' + (c.hp > 0.6 ? '' : c.hp > 0.3 ? ' mid' : ' low')} title="health"><i style={{ width: Math.round(c.hp * 100) + '%' }} /></span>
            <span class="bar hunger" title="hunger"><i style={{ width: Math.round(c.hunger * 100) + '%' }} /></span>
            {c.why ? <span class="why">{c.why}</span> : null}
          </div>
        ))}
        <div class="census"><span class="n">{live.plants.n}</span><span>Plants</span>{live.plants.sick ? <span class="why">{live.plants.sick} struggling</span> : null}</div>
      </div>
      <div class="card glass">
        <div class="h3">Journal</div>
        {live.logs.map((l, i) => <div key={i} class={'log ' + l.kind}><i>{l.t}</i>{l.msg}</div>)}
      </div>
    </div>
  );
}

function waterScore(e) {
  return Math.max(0, 1 - Math.min(1, e.ammonia / 0.6 + e.nitrite / 0.8 + Math.max(0, e.nitrate - 40) / 80));
}
function waterWord(e) {
  const s = waterScore(e);
  return s > 0.85 ? 'Clean' : s > 0.6 ? 'OK' : s > 0.35 ? 'Poor' : 'Toxic';
}

function QuickCare() {
  const g = ctx.game;
  const W = g.world;
  const act = (fn, ...a) => () => { toast(fn(g, ...a)); S.live.value = { ...S.live.value }; };
  const btn = (icon, label, fn, gear) => (
    <button key={label} class={'btn sm' + (gear && !W.equipment.has(gear) ? ' off' : '')} onClick={act(fn)} title={label}><Icon name={icon} size={14} />{label}</button>
  );
  return (
    <div class="card glass">
      <div class="h3">Quick care</div>
      <div class="chips" style={{ marginBottom: 0 }}>
        {btn('drop', 'Mist', Care.mist)}
        {btn('rain', 'Rain', Care.rain, 'mister')}
        {btn('bowl', 'Feed fish', Care.feed)}
        {btn('bug', 'Flies', Care.flies)}
        {btn('eraser', 'Wipe glass', Care.wipe)}
        {btn('flask', 'Water change', Care.waterChange)}
        <button class="btn sm ghost" onClick={() => openModal('care')}><Icon name="cog" size={14} />All controls</button>
      </div>
    </div>
  );
}

// What the player selected with Inspect: how it is doing, and why.
function Inspector({ live }) {
  const s = S.selection.value;
  if (!s || s.obj?.dead) return null;
  void live;
  if (s.kind === 'animal') {
    const a = s.obj, sp = SPECIES[a.sp];
    return (
      <div class="card glass">
        <div class="stage-line"><b>{sp.name}</b><button class="btn ghost icon sm" onClick={() => openModal('codex', 'animal:' + a.sp)} title="Field guide"><Icon name="book" size={14} /></button></div>
        <div class="note" style={{ marginTop: 0 }}>{sp.group} · {(a.age / 1440).toFixed(1)} days old</div>
        <Row label="Health" value={Math.round(a.health * 100) + '%'} level={a.health < 0.4 ? 'bad' : a.health < 0.7 ? 'warn' : 'good'} />
        <Row label="Hunger" value={Math.round(a.hunger * 100) + '%'} level={a.hunger > 0.75 ? 'bad' : a.hunger > 0.5 ? 'warn' : ''} />
        {a.T != null ? <Row label="Where it sits" value={`${a.T.toFixed(1)} °C${a.RH != null && sp.humidity ? `, ${Math.round(a.RH)}% RH` : ''}`} /> : null}
        <Row label="Needs" value={`${sp.temp[0]}–${sp.temp[1]} °C${sp.humidity ? `, ${sp.humidity}%+ RH` : ''}`} />
        {a.why?.length ? <Row label="Stress" value={a.why.join(', ')} level="bad" /> : <Row label="Status" value="content" level="good" />}
        <p class="note">{sp.note}</p>
      </div>
    );
  }
  if (s.kind === 'pool') {
    const p = s.obj;
    return (
      <div class="card glass"><div class="stage-line"><b>Pool</b></div>
        <Row label="Water" value={p.litres.toFixed(2) + ' L'} /><Row label="Surface" value={Math.round(p.area) + ' cm²'} /><Row label="Level" value={p.level.toFixed(1) + ' cm'} /></div>
    );
  }
  const p = s.obj, sp = PLANTS[p.id];
  return (
    <div class="card glass">
      <div class="stage-line"><b>{sp.name}</b><button class="btn ghost icon sm" onClick={() => openModal('codex', 'plant:' + p.id)} title="Field guide"><Icon name="book" size={14} /></button></div>
      <div class="note" style={{ marginTop: 0 }}>{sp.habitat.split('|').join(' / ')}</div>
      <Row label="Health" value={Math.round(p.health * 100) + '%'} level={p.health < 0.4 ? 'bad' : p.health < 0.7 ? 'warn' : 'good'} />
      <Row label="Grown" value={Math.round(p.grown * 100) + '%'} />
      {p.why?.length ? <Row label="Struggling" value={p.why.join(', ')} level="warn" /> : null}
      <p class="note">{sp.note}</p>
    </div>
  );
}
