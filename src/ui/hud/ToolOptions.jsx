import { Icon } from '../icons.jsx';
import { S, toast, hint, openModal } from '../store.js';
import { ctx } from '../../app/ctx.js';
import { TOOLS, WATER_TOOLS, SCULPT_OPS } from '../../tools/defs.js';
import { MATERIALS, TANK } from '../../sim/tank.js';
import { SPECIES } from '../../sim/animals.js';
import { PLANTS } from '../../sim/plants.js';
import { PIECES } from '../../sim/decor.js';

// A compact "will it thrive right now?" light for a species in this tank.
function fit(sp, live) {
  if (!live) return null;
  const { temp, humidity, ammonia, nitrite } = live.env;
  const aquatic = sp.kind === 'swim' || sp.kind === 'crawlWater';
  const [lo, hi] = sp.temp ?? [0, 99];
  let bad = 0, warn = 0;
  const why = [];
  if (temp < lo - 2 || temp > hi + 2) { bad++; why.push(temp < lo ? 'too cold' : 'too hot'); } else if (temp < lo || temp > hi) { warn++; why.push('temperature marginal'); }
  if (aquatic) {
    if (ammonia > 0.25 || nitrite > 0.3) { bad++; why.push('water not cycled'); }
  } else if (sp.humidity) {
    if (humidity < sp.humidity - 8) { bad++; why.push('air too dry'); } else if (humidity < sp.humidity) { warn++; why.push('air a little dry'); }
  }
  return { level: bad ? 'bad' : warn ? 'warn' : 'good', why: why.join(', ') || 'conditions suit it' };
}

const FIT_COLOR = { good: 'var(--moss)', warn: 'var(--amber)', bad: 'var(--coral)' };

function Slider({ label, value, min, max, step, onInput, fmt }) {
  return (
    <label class="row">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onInput={(e) => onInput(+e.currentTarget.value)} />
      <output>{fmt ? fmt(value) : value}</output>
    </label>
  );
}

function Toggle({ label, on, set, title }) {
  return <button class={'chip' + (on ? ' on' : '')} title={title} onClick={() => set(!on)}>{label}</button>;
}

function Brush({ depth }) {
  const b = S.brush.value;
  return (
    <>
      <Slider label={depth ? 'Radius / width' : 'Brush size'} value={b.size} min={1.5} max={14} step={0.5} onInput={(v) => { S.brush.value = { ...b, size: v }; }} />
      <Slider label={depth ? 'Depth' : 'Strength'} value={b.strength} min={0.2} max={3} step={0.1} onInput={(v) => { S.brush.value = { ...b, strength: v }; }} />
    </>
  );
}

function UndoRow() {
  return (
    <div class="chips">
      <button class="chip" onClick={() => ctx.tools.undo()} title="Ctrl+Z" disabled={!S.undoDepth.value}><Icon name="undo" size={13} /> Undo</button>
    </div>
  );
}

function Price({ kind, id }) {
  const info = ctx.career?.info(kind, id);
  if (!info) return null;
  if (info.locked) return <span class="lockmark"><Icon name="lock" size={11} /> Rank {info.level}</span>;
  return <span class="price">{info.price > 0 ? `¤${info.price}` : 'free'}</span>;
}

function Sculpt() {
  const sub = S.sub.value;
  return (
    <>
      <div class="chips">{SCULPT_OPS.map(([id, name]) => <button key={id} class={'chip' + (sub.sculpt === id ? ' on' : '')} onClick={() => ctx.tools.setSub('sculpt', id)}>{name}</button>)}</div>
      <Brush />
      <UndoRow />
      <p class="note">Sculpt the substrate <i>and</i> the background wall. Slopes drain; hollows hold water; a wall that bulges forward makes ledges for epiphytes and a face for a waterfall.</p>
    </>
  );
}

function Paint() {
  const sub = S.sub.value;
  return (
    <>
      <div class="chips">
        {MATERIALS.map((m, i) => (
          <button key={m.id} class={'chip' + (sub.paint === i ? ' on' : '')} onClick={() => ctx.tools.setSub('paint', i)}>
            <i style={{ width: 9, height: 9, borderRadius: '50%', background: `rgb(${m.color.map((c) => Math.round(c * 255)).join(',')})`, display: 'inline-block' }} /> {m.name}
          </button>
        ))}
      </div>
      <Brush />
      <UndoRow />
      <p class="note">Moss grows where the air and soil stay damp and light reaches it. Sand and gravel suit stream beds; soil suits plants.</p>
    </>
  );
}

function Rock() {
  const sub = S.sub.value, piece = S.piece.value, mode = S.pieceMode.value, b = S.brush.value;
  const T = ctx.tools;
  return (
    <>
      <div class="pick-grid">
        {Object.entries(PIECES).map(([id, p]) => {
          const info = ctx.career?.info('piece', id);
          return (
            <button key={id} class={'pick' + (sub.rock === id ? ' on' : '') + (info?.locked ? ' lock' : '')} onClick={() => ctx.tools.setSub('rock', id)}>
              <b>{p.name}</b>
              <small>{p.stamp ? 'Stone' : 'Wood'} <Price kind="piece" id={id} /></small>
            </button>
          );
        })}
      </div>
      <Slider label="Size" value={b.size} min={1.5} max={14} step={0.5} onInput={(v) => { S.brush.value = { ...b, size: v }; }} />
      {piece ? (
        <>
          <div class="grp">Selected: {PIECES[piece.type].name}</div>
          <div class="chips">
            {[['translate', 'Move', 'G'], ['rotate', 'Turn', 'R'], ['scale', 'Scale', 'T']].map(([m, l, k]) => (
              <button key={m} class={'chip' + (mode === m ? ' on' : '')} title={`${l} (${k})`} onClick={() => T.setPieceMode(m)}>{l}</button>
            ))}
          </div>
          <div class="chips">
            <button class="chip" onClick={() => T.duplicatePiece()} title="Ctrl+D">Duplicate</button>
            <button class="chip" onClick={() => T.dropPiece()} title="Sit it on whatever is under it">Drop</button>
            <button class="chip" onClick={() => T.levelPiece()}>Level</button>
            <button class="chip" onClick={() => T.deletePiece()}>Delete</button>
            <button class="chip" onClick={() => T.selectPiece(null)}>Done</button>
          </div>
        </>
      ) : <p class="note">Click the ground to place; click a piece to move, turn or scale it. Stack pieces by clicking on top. Odd numbers and a clear focal point read best.</p>}
      <UndoRow />
    </>
  );
}

function Water() {
  const sub = S.sub.value;
  const live = S.live.value;
  const W = ctx.game.world, H = W.water.hydro;
  const cur = WATER_TOOLS.find((t) => t[0] === sub.water);
  const total = H.total() / 1000, main = H.resVol / 1000;
  const pools = H.pools.reduce((s, p) => s + p.litres, 0);
  const pump = !H.outlets.length ? 'no outlets yet' : !H.pump.on ? 'switched off' : H.pump.running ? `${H.pump.rate} L/h` : 'running dry! add water';
  void live;
  return (
    <>
      <div class="chips">{WATER_TOOLS.map(([id, name, tip]) => <button key={id} class={'chip' + (sub.water === id ? ' on' : '')} onClick={() => ctx.tools.setSub('water', id, tip)}>{name}</button>)}</div>
      <p class="note" style={{ marginTop: 0 }}>{cur[2]}</p>
      {['channel', 'bank', 'basin'].includes(sub.water) ? <Brush depth /> : null}
      <div class="grp">Reservoir</div>
      <Slider label="Main level" value={W.water.level} min={0} max={TANK.h - 10} step={0.5} onInput={(v) => { W.setWaterLevel(v); S.live.value = { ...S.live.value }; }} fmt={(v) => v.toFixed(1)} />
      <Slider label="Pump flow" value={H.pump.rate} min={20} max={600} step={10} onInput={(v) => { H.pump.rate = v; S.live.value = { ...S.live.value }; }} fmt={(v) => v + ' L/h'} />
      <div class="chips">
        <Toggle label="Pump on" on={H.pump.on} set={(v) => { H.pump.on = v; S.live.value = { ...S.live.value }; }} />
        <Toggle label="Auto top-up" on={H.topUp} set={(v) => { H.topUp = v; if (v) H.targetTotal = Math.max(H.targetTotal, H.total()); S.live.value = { ...S.live.value }; }} title="Replaces evaporated water, like a float valve" />
      </div>
      <p class="note">Total {total.toFixed(1)} L · main pool {main.toFixed(1)} L<br />Pools {pools.toFixed(2)} L · streams {(total - main - pools).toFixed(2)} L<br />Pump: {pump}</p>
      {H.outlets.length ? (
        <>
          <div class="grp">Outlets</div>
          {H.outlets.map((o, i) => (
            <div class="stat" key={i}><span>{i + 1}. {o.wall ? 'Background spring' : 'On the ground'}</span>
              <button class="chip" onClick={() => { ctx.tools.pushUndo(); W.water.removeOutlet(o); S.live.value = { ...S.live.value }; }}>Remove</button></div>
          ))}
        </>
      ) : null}
      <UndoRow />
    </>
  );
}

function Plants() {
  const sub = S.sub.value, live = S.live.value;
  const groups = { land: 'Land', wall: 'Background', emergent: 'Waterline', aquatic: 'Underwater', floating: 'Floating' };
  const list = Object.entries(PLANTS).filter(([, p]) => !p.hidden);
  return (
    <>
      {Object.entries(groups).map(([hab, label]) => {
        const items = list.filter(([, p]) => p.habitat.split('|')[0] === hab);
        if (!items.length) return null;
        return (
          <div key={hab}>
            <div class="grp">{label}</div>
            <div class="pick-grid">
              {items.map(([id, p]) => {
                const info = ctx.career?.info('plant', id);
                return (
                  <button key={id} class={'pick' + (sub.plant === id ? ' on' : '') + (info?.locked ? ' lock' : '')} title={p.note} onClick={() => ctx.tools.setSub('plant', id, p.note)}>
                    <b>{p.name}</b>
                    <small><Price kind="plant" id={id} /> <span>{lightWord(p.light)}</span></small>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <div class="chips"><button class="chip" onClick={() => openModal('codex', 'plant:' + sub.plant)}><Icon name="book" size={13} /> Field guide: {PLANTS[sub.plant]?.name}</button></div>
      <p class="note">{PLANTS[sub.plant]?.note}</p>
      {void live}
    </>
  );
}

const lightWord = (l) => (l <= 0.25 ? 'shade' : l <= 0.45 ? 'part shade' : l <= 0.6 ? 'bright' : 'full light');

function Animals() {
  const sub = S.sub.value, live = S.live.value;
  const groups = {};
  for (const [id, s] of Object.entries(SPECIES)) if (s.kind !== 'egg' && !s.young) (groups[s.group] ??= []).push([id, s]);
  return (
    <>
      {Object.entries(groups).map(([g, items]) => (
        <div key={g}>
          <div class="grp">{g}</div>
          <div class="pick-grid">
            {items.map(([id, s]) => {
              const info = ctx.career?.info('animal', id);
              const f = fit(s, live);
              return (
                <button key={id} class={'pick' + (sub.animal === id ? ' on' : '') + (info?.locked ? ' lock' : '')} title={s.note + (f ? ` (${f.why})` : '')} onClick={() => ctx.tools.setSub('animal', id, s.note)}>
                  <b>{s.name}</b>
                  <small>
                    {f ? <i style={{ width: 7, height: 7, borderRadius: '50%', background: FIT_COLOR[f.level], display: 'inline-block' }} /> : null}
                    <Price kind="animal" id={id} />
                  </small>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {(() => { const s = SPECIES[sub.animal], f = fit(s, live); return (
        <>
          <div class="chips"><button class="chip" onClick={() => openModal('codex', 'animal:' + sub.animal)}><Icon name="book" size={13} /> Field guide: {s.name}</button></div>
          <p class="note">{s.note} {f ? <b style={{ color: FIT_COLOR[f.level] }}>Right now: {f.why}.</b> : null}</p>
        </>
      ); })()}
    </>
  );
}

function Gear() {
  const sub = S.sub.value, W = ctx.game.world;
  const items = [['fogger', 'Fogger'], ['basking', 'Basking lamp']];
  return (
    <>
      <div class="chips">{items.map(([id, name]) => <button key={id} class={'chip' + (sub.gear === id ? ' on' : '') + (W.equipment.has(id) ? '' : ' lock')} onClick={() => ctx.tools.setSub('gear', id)}>{name}{W.equipment.has(id) ? '' : ' 🔒'}</button>)}</div>
      <p class="note">Click the ground to move the {sub.gear === 'fogger' ? 'fogger: its fog raises the humidity around it' : 'basking lamp: it makes a warm patch you can see in the temperature lens'}.</p>
      <div class="chips">
        <button class="chip" onClick={() => openModal('care', 'equipment')}><Icon name="cog" size={13} /> Equipment settings</button>
        <button class="chip" onClick={() => openModal('studio', 'shop')}><Icon name="briefcase" size={13} /> Shop</button>
      </div>
    </>
  );
}

const BODY = { sculpt: Sculpt, paint: Paint, rock: Rock, water: Water, plant: Plants, animal: Animals, gear: Gear };

export function ToolOptions() {
  const id = S.tool.value;
  const B = BODY[id];
  if (!B || !S.left.value || (S.compact.value && S.right.value)) return null;
  const t = TOOLS.find((x) => x.id === id);
  return (
    <div class="opts glass strong">
      <h4>{t.name}<button class="btn ghost icon sm" title="Hide (H)" onClick={() => { S.left.value = false; }}><Icon name="chevronL" size={14} /></button></h4>
      <B />
    </div>
  );
}

export { fit, FIT_COLOR, toast, hint };
