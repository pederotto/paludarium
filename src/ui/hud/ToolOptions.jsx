import { useState, useRef, useEffect } from 'preact/hooks';
import { Icon } from '../icons.jsx';
import { S, toast, hint, openModal, morphChoice, hudRules, saveSmart } from '../store.js';
import { plantFit } from '../../editor/smart.js';
import { R } from './railState.js';
import { Portrait } from '../panels/Portrait.jsx';
import { ctx } from '../../app/ctx.js';
import { groupOf, WATER_TOOLS, SCULPT_OPS, MIRROR_WATER } from '../../editor/defs.js';
import { KITS, kitById, kitPrice, kitRank } from '../../content/kits.js';
import '../builder.css';
import { MATERIALS, TANK } from '../../sim/tank.js';
import { SPECIES } from '../../sim/animals.js';
import { PLANTS } from '../../sim/plants.js';
import { PIECES } from '../../sim/decor.js';
import { hasGenetics, morphList } from '../../sim/genetics.js';
import { morphInfo } from '../../content/morphs.js';
import { MorphDot, Stars } from '../GeneBits.jsx';

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
      <Slider label={depth ? 'Width' : 'Brush size'} value={b.size} min={1.5} max={14} step={0.5} onInput={(v) => { S.brush.value = { ...b, size: v }; }} />
      <Slider label={depth ? 'Depth' : 'Strength'} value={b.strength} min={0.2} max={3} step={0.1} onInput={(v) => { S.brush.value = { ...b, strength: v }; }} />
    </>
  );
}

// Symmetry: repeat everything you build across the middle of the tank (key M).
function MirrorToggle() {
  const on = S.mirror.value;
  return (
    <button class={'chip mirror' + (on ? ' on' : '')} title="Mirror across the middle of the tank (M)" aria-pressed={on} onClick={() => ctx.tools.toggleMirror()}>
      <Icon name="swap" size={13} /> Mirror
    </button>
  );
}

function UndoRow() {
  return (
    <div class="chips">
      <button class="chip" onClick={() => ctx.tools.undoAny()} title="Ctrl+Z" disabled={!S.undoDepth.value}><Icon name="undo" size={13} /> Undo</button>
    </div>
  );
}

function Price({ kind, id }) {
  const info = ctx.career?.info(kind, id);
  if (!info) return null;
  if (info.locked) return <span class="lockmark"><Icon name="lock" size={11} /> Rank {info.level}</span>;
  return <span class="price">{info.price > 0 ? `¤${info.price}` : 'free'}</span>;
}

// What a kit costs and needs in a career: null in the sandbox (everything is free there).
export function kitInfo(kit) {
  const c = ctx.career;
  if (!c || c.sandbox) return null;
  const level = kitRank(kit);
  return { locked: level > c.level, level, price: kitPrice(kit) };
}

export function KitPrice({ kit }) {
  const info = kitInfo(kit);
  if (!info) return null;
  if (info.locked) return <span class="lockmark"><Icon name="lock" size={11} /> Rank {info.level}</span>;
  return <span class="price">¤{info.price}</span>;
}

// --- Picture cards ----------------------------------------------------------------------------------
// A species portrait is drawn lazily, only once its card scrolls into view (engine/portraits.js draws them one at a time).
function Pic({ kind, id, icon }) {
  const [seen, setSeen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!kind || !ref.current || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { rootMargin: '40px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [kind, id]);
  return <span class="pic" ref={ref}>{seen && kind ? <Portrait kind={kind} id={id} size={44} /> : <Icon name={icon ?? 'leaf'} size={20} />}</span>;
}

function Pick({ on, lock, title, kind, id, icon, name, children, onClick, tool }) {
  return (
    <button class={'pick' + (on ? ' on' : '') + (lock ? ' lock' : '')} title={title} aria-pressed={on} data-pick={tool ?? id} onClick={onClick}>
      <Pic kind={kind} id={id} icon={icon} />
      <b>{name}</b>
      <small>{children}</small>
    </button>
  );
}

const KIT_ICON = { waterfall: 'waterfall', arch: 'arch', steps: 'steps', spires: 'tower', island: 'island' };
const ANIMAL_ICON = { Fish: 'fish', Crustaceans: 'bug', Insects: 'bug', Frogs: 'frog', Amphibians: 'frog' };

// The Advanced accordion: closed by default. Its body stays in the DOM (hidden) so toggles inside it keep their state.
function Adv({ id, children, label = 'Advanced' }) {
  const open = !!R.adv.value[id];
  return (
    <div class={'adv' + (open ? ' open' : '')}>
      <button class="adv-t" aria-expanded={open} onClick={() => { R.adv.value = { ...R.adv.value, [id]: !open }; }}>
        <span>{label}</span><Icon name="chevronD" size={14} />
      </button>
      <div class="adv-b">{children}</div>
    </div>
  );
}

// The "will it thrive right now?" footer for a plant or an animal.
function Thrive({ name, f, note, guide }) {
  return (
    <div class="thrive">
      <div class="th-l">
        <b>{name}</b>
        <span class="th-s">{f ? <><i class="ex-light" style={{ background: FIT_COLOR[f.level] }} /> <span style={{ color: FIT_COLOR[f.level] }}>{f.why}</span></> : <span class="th-n">{note}</span>}</span>
      </div>
      <button class="btn sm ghost" title="Open the field guide" onClick={guide}><Icon name="book" size={14} /> Guide</button>
    </div>
  );
}

function Mirror() {
  return <div class="chips"><MirrorToggle /></div>;
}

function Sculpt() {
  const sub = S.sub.value;
  return (
    <>
      <div class="oc-main">
        <div class="seg sm">{SCULPT_OPS.map(([id, name]) => <button key={id} class={sub.sculpt === id ? 'on' : ''} onClick={() => ctx.tools.setSub('sculpt', id)}>{name}</button>)}</div>
        <Brush />
        <UndoRow />
      </div>
      <Adv id="sculpt">
        <Mirror />
        <p class="note">Sculpt the substrate <i>and</i> the background wall. Slopes drain; hollows hold water; a wall that bulges forward makes ledges for epiphytes and a face for a waterfall.</p>
      </Adv>
    </>
  );
}

function Paint() {
  const sub = S.sub.value;
  return (
    <>
      <div class="oc-main">
        <div class="chips">
          {MATERIALS.map((m, i) => (
            <button key={m.id} class={'chip' + (sub.paint === i ? ' on' : '')} onClick={() => ctx.tools.setSub('paint', i)}>
              <i style={{ width: 9, height: 9, borderRadius: '50%', background: `rgb(${m.color.map((c) => Math.round(c * 255)).join(',')})`, display: 'inline-block' }} /> {m.name}
            </button>
          ))}
        </div>
        <Brush />
        <UndoRow />
      </div>
      <Adv id="paint">
        <Mirror />
        <p class="note">Moss grows where the air and soil stay damp and light reaches it. Sand and gravel suit stream beds; soil suits plants.</p>
      </Adv>
    </>
  );
}

function Rock() {
  const sub = S.sub.value, piece = S.piece.value, mode = S.pieceMode.value, b = S.brush.value;
  const T = ctx.tools;
  const kit = kitById(sub.kit);
  return (
    <>
      <div class="oc-main">
        <div class="pick-grid">
          {Object.entries(PIECES).map(([id, p]) => {
            const info = ctx.career?.info('piece', id);
            return (
              <Pick key={id} on={sub.rock === id && !sub.kit} lock={info?.locked} id={id} icon={p.stamp ? 'rock' : 'log'} name={p.name} onClick={() => T.setSub('rock', id)}>
                {p.stamp ? 'Stone' : 'Wood'} <Price kind="piece" id={id} />
              </Pick>
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
              <button class="chip" onClick={() => T.deletePiece()}>Delete</button>
              <button class="chip" onClick={() => T.selectPiece(null)}>Done</button>
            </div>
          </>
        ) : <p class="note">Click the ground to place; click a piece to move, turn or scale it. Stack pieces by clicking on top.</p>}
        <UndoRow />
      </div>
      <Adv id="rock">
        <Mirror />
        {piece ? (
          <div class="chips">
            <button class="chip" onClick={() => T.duplicatePiece()} title="Ctrl+D">Duplicate</button>
            <button class="chip" onClick={() => T.dropPiece()} title="Sit it on whatever is under it">Drop</button>
            <button class="chip" onClick={() => T.levelPiece()}>Level</button>
          </div>
        ) : null}
        {hudRules().toolOptions === 'full' ? <SmartToggle /> : null}
        <p class="note">Odd numbers and a clear focal point read best.</p>
      </Adv>
    </>
  );
}

function Kits() {
  const sub = S.sub.value, T = ctx.tools, kit = kitById(sub.kit);
  return (
    <>
      <div class="oc-main">
        <div class="pick-grid">
          {KITS.map((k) => {
            const info = kitInfo(k);
            return (
              <Pick key={k.id} on={sub.kit === k.id} lock={info?.locked} title={k.blurb} id={k.id} icon={KIT_ICON[k.id] ?? 'rock'} name={k.name} onClick={() => T.setKit(sub.kit === k.id ? null : k.id)}>
                {k.pieces.length} pieces <KitPrice kit={k} />
              </Pick>
            );
          })}
        </div>
        {kit ? (
          <div class="kit-armed">
            <p class="note" style={{ marginTop: 0 }}><b>{kit.name}</b>: click the tank to place it. {kit.teaches}</p>
            <div class="chips"><button class="chip" onClick={() => T.setKit(null)}>Put away</button></div>
          </div>
        ) : <p class="note">A kit is a whole composition in one click. Pick one, then click the tank.</p>}
        <UndoRow />
      </div>
      <Adv id="kits"><Mirror /></Adv>
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
  const full = hudRules().toolOptions === 'full';
  return (
    <>
      <div class="oc-main">
        <div class="chips">{WATER_TOOLS.filter((t) => hudRules().waterTools.includes(t[0])).map(([id, name, tip]) => <button key={id} class={'chip' + (sub.water === id ? ' on' : '')} onClick={() => ctx.tools.setSub('water', id, tip)}>{name}</button>)}</div>
        <p class="note" style={{ marginTop: 0 }}>{cur[2]}</p>
        {['channel', 'bank', 'basin'].includes(sub.water) ? <Brush depth /> : null}
        <UndoRow />
      </div>
      <Adv id="water">
        {MIRROR_WATER.includes(sub.water) ? <Mirror /> : null}
        {full ? (<>
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
        </>) : null}
      </Adv>
    </>
  );
}

function Plants() {
  const sub = S.sub.value, live = S.live.value;
  const groups = { land: 'Land', wall: 'Background', emergent: 'Waterline', aquatic: 'Underwater', floating: 'Floating' };
  const list = Object.entries(PLANTS).filter(([, p]) => !p.hidden);
  const cur = PLANTS[sub.plant], f = plantFit(sub.plant, live);
  return (
    <>
      <div class="oc-main">
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
                    <Pick key={id} on={sub.plant === id} lock={info?.locked} title={p.note} kind="plant" id={id} icon="leaf" name={p.name} onClick={() => ctx.tools.setSub('plant', id, p.note)}>
                      <Price kind="plant" id={id} /> <span>{lightWord(p.light)}</span>
                    </Pick>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <Adv id="plant">
        <Mirror />
        {hudRules().toolOptions === 'full' ? <SmartToggle /> : null}
        <p class="note">{cur?.note}</p>
      </Adv>
      <Foot><Thrive name={cur?.name} f={f} note={cur?.note} guide={() => openModal('codex', 'plant:' + sub.plant)} /></Foot>
    </>
  );
}

const lightWord = (l) => (l <= 0.25 ? 'shade' : l <= 0.45 ? 'part shade' : l <= 0.6 ? 'bright' : 'full light');

// The sticky footer of a card (outside the scrolling body).
function Foot({ children }) { return <div class="oc-foot">{children}</div>; }

// Which colour morph to release, for species with genetics. A rare morph costs more in a career.
function MorphPicker({ id }) {
  const chosen = S.morph.value[id] === '*' ? '*' : morphChoice(id);
  const info = ctx.career?.info('animal', id);
  const base = info && !info.locked ? info.price : null;
  const set = (m) => { S.morph.value = { ...S.morph.value, [id]: m }; };
  const cur = chosen !== '*' ? morphInfo(id, chosen) : null;
  return (
    <div class="morph-pick">
      <div class="grp">Colour morph</div>
      <div class="chips">
        {morphList(id).map((m) => {
          const mi = morphInfo(id, m);
          return (
            <button key={m} class={'chip' + (chosen === m ? ' on' : '')} title={mi.blurb} aria-pressed={chosen === m} onClick={() => set(m)}>
              <MorphDot sp={id} morph={m} /> {mi.name} <Stars r={mi.rarity} />{base != null ? <small>¤{Math.ceil(base * mi.price)}</small> : null}
            </button>
          );
        })}
        <button class={'chip' + (chosen === '*' ? ' on' : '')} title="Each animal gets random genes, like wild-caught stock: some may be hidden carriers" aria-pressed={chosen === '*'} onClick={() => set('*')}>Mixed</button>
      </div>
      <p class="morph-note">{cur ? cur.blurb : 'Random wild genes: some animals will carry hidden colours.'}</p>
    </div>
  );
}

function Animals() {
  const sub = S.sub.value, live = S.live.value;
  const groups = {};
  for (const [id, s] of Object.entries(SPECIES)) if (s.kind !== 'egg' && !s.young) (groups[s.group] ??= []).push([id, s]);
  const s = SPECIES[sub.animal], f = fit(s, live);
  return (
    <>
      <div class="oc-main">
        {Object.entries(groups).map(([g, items]) => (
          <div key={g}>
            <div class="grp">{g}</div>
            <div class="pick-grid">
              {items.map(([id, sp]) => {
                const info = ctx.career?.info('animal', id);
                const ft = fit(sp, live);
                return (
                  <Pick key={id} on={sub.animal === id} lock={info?.locked} title={sp.note + (ft ? ` (${ft.why})` : '')} kind="animal" id={id} icon={ANIMAL_ICON[g] ?? 'frog'} name={sp.name} onClick={() => ctx.tools.setSub('animal', id, sp.note)}>
                    {ft ? <i class="ex-light" style={{ background: FIT_COLOR[ft.level] }} /> : null}
                    <Price kind="animal" id={id} />
                  </Pick>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <Adv id="animal">
        {hasGenetics(sub.animal) ? <MorphPicker id={sub.animal} /> : null}
        {hudRules().toolOptions === 'full' ? <SmartToggle /> : null}
        <p class="note">{s.note}</p>
      </Adv>
      <Foot><Thrive name={s.name} f={f} note={s.note} guide={() => openModal('codex', 'animal:' + sub.animal)} /></Foot>
    </>
  );
}

function Gear() {
  const sub = S.sub.value, W = ctx.game.world;
  const items = [['fogger', 'Fogger'], ['basking', 'Basking lamp']];
  return (
    <div class="oc-main">
      <div class="seg sm">{items.map(([id, name]) => <button key={id} class={(sub.gear === id ? 'on' : '') + (W.equipment.has(id) ? '' : ' lock')} onClick={() => ctx.tools.setSub('gear', id)}>{name}{W.equipment.has(id) ? '' : ' 🔒'}</button>)}</div>
      <p class="note">Click the ground to move the {sub.gear === 'fogger' ? 'fogger: its fog raises the humidity around it' : 'basking lamp: it makes a warm patch you can see in the temperature lens'}.</p>
      <div class="chips" style={{ marginTop: 8 }}>
        <button class="chip" onClick={() => openModal('care', 'equipment')}><Icon name="cog" size={13} /> Equipment settings</button>
        <button class="chip" onClick={() => openModal('studio', 'shop')}><Icon name="briefcase" size={13} /> Shop</button>
      </div>
    </div>
  );
}

function Erase() {
  return (
    <div class="oc-main">
      <p class="note" style={{ marginTop: 0 }}>Click a plant, animal, rock or outlet to remove it, or a pool to drain it.</p>
      <UndoRow />
    </div>
  );
}

// Naturalist: the optional one-tap placement, switched on and off here.
function SmartToggle() {
  const on = S.smart.value;
  return (
    <div class="chips">
      <button class={'chip' + (on ? ' on' : '')} aria-pressed={on} title="One tap places, orients and spaces things for you, then offers Another and Group" onClick={() => { const v = !on; S.smart.value = v; saveSmart(v); ctx.tools.setButtons(); }}>Smart place {on ? 'on' : 'off'}</button>
    </div>
  );
}

// Explorer: the three placing tools as one short list of big picture cards (one tap places: see tools/smart.js).
function ExplorerPicks({ id }) {
  const sub = S.sub.value, live = S.live.value, T = ctx.tools, piece = S.piece.value, mode = S.pieceMode.value;
  const dot = (f) => (f ? <i class="ex-light" style={{ background: FIT_COLOR[f.level] }} title={f.why} /> : null);
  if (id === 'rock') {
    const kit = kitById(sub.kit);
    return (
      <div class="ex-body">
        <div class="pick-grid">
          {Object.entries(PIECES).map(([k, p]) => {
            const info = ctx.career?.info('piece', k);
            return <Pick key={k} on={sub.rock === k && !sub.kit} lock={info?.locked} id={k} icon={p.stamp ? 'rock' : 'log'} name={p.name} onClick={() => T.setSub('rock', k)}><Price kind="piece" id={k} /></Pick>;
          })}
          {KITS.map((k) => {
            const info = kitInfo(k);
            return <Pick key={k.id} on={sub.kit === k.id} lock={info?.locked} title={k.blurb} id={k.id} icon={KIT_ICON[k.id] ?? 'rock'} name={k.name} onClick={() => T.setKit(sub.kit === k.id ? null : k.id)}>kit <KitPrice kit={k} /></Pick>;
          })}
        </div>
        {piece ? (
          <div class="chips">
            {[['translate', 'Move'], ['rotate', 'Turn'], ['scale', 'Size']].map(([m, l]) => <button key={m} class={'chip' + (mode === m ? ' on' : '')} onClick={() => T.setPieceMode(m)}>{l}</button>)}
            <button class="chip" onClick={() => T.deletePiece()}>Delete</button>
            <button class="chip" onClick={() => T.selectPiece(null)}>Done</button>
          </div>
        ) : <p class="ex-note">{kit ? kit.blurb : 'Tap the tank. Rocks are placed, turned and spaced for you.'}</p>}
      </div>
    );
  }
  if (id === 'plant') {
    const list = Object.entries(PLANTS).filter(([, p]) => !p.hidden);
    const f = plantFit(sub.plant, live);
    return (
      <div class="ex-body">
        <div class="pick-grid">
          {list.map(([k, p]) => {
            const info = ctx.career?.info('plant', k);
            return <Pick key={k} on={sub.plant === k} lock={info?.locked} kind="plant" id={k} icon="leaf" name={p.name} onClick={() => T.setSub('plant', k, p.note)}>{dot(plantFit(k, live))}<Price kind="plant" id={k} /></Pick>;
          })}
        </div>
        <div class="chips"><button class="chip" onClick={() => openModal('codex', 'plant:' + sub.plant)}><Icon name="book" size={13} /> About</button></div>
        <p class="ex-note">Tap to plant, hold and drag to scatter. {f ? <b style={{ color: FIT_COLOR[f.level] }}>{PLANTS[sub.plant]?.name}: {f.why}.</b> : null}</p>
      </div>
    );
  }
  const groups = Object.entries(SPECIES).filter(([, s]) => s.kind !== 'egg' && !s.young);
  const s = SPECIES[sub.animal], fs = fit(s, live);
  return (
    <div class="ex-body">
      <div class="pick-grid">
        {groups.map(([k, sp]) => {
          const info = ctx.career?.info('animal', k);
          return <Pick key={k} on={sub.animal === k} lock={info?.locked} kind="animal" id={k} icon={ANIMAL_ICON[sp.group] ?? 'frog'} name={sp.name} onClick={() => T.setSub('animal', k, sp.note)}>{dot(fit(sp, live))}<Price kind="animal" id={k} /></Pick>;
        })}
      </div>
      <div class="chips"><button class="chip" onClick={() => openModal('codex', 'animal:' + sub.animal)}><Icon name="book" size={13} /> About</button></div>
      <p class="ex-note">{s.note} {fs ? <b style={{ color: FIT_COLOR[fs.level] }}>Right now: {fs.why}.</b> : null}</p>
    </div>
  );
}

const BODY = { sculpt: Sculpt, paint: Paint, rock: Rock, kits: Kits, water: Water, plant: Plants, animal: Animals, gear: Gear, erase: Erase };
const SMART_TOOLS = ['rock', 'plant', 'animal'];

// What the collapsed chip shows: the current selection of a tool.
function selection(id, sub) {
  switch (id) {
    case 'sculpt': return SCULPT_OPS.find((o) => o[0] === sub.sculpt)?.[1];
    case 'paint': return MATERIALS[sub.paint]?.name;
    case 'water': return WATER_TOOLS.find((t) => t[0] === sub.water)?.[1];
    case 'rock': return kitById(sub.kit)?.name ?? PIECES[sub.rock]?.name;
    case 'plant': return PLANTS[sub.plant]?.name;
    case 'animal': return SPECIES[sub.animal]?.name;
    case 'gear': return sub.gear === 'fogger' ? 'Fogger' : 'Basking lamp';
    default: return 'Click to remove';
  }
}

export function ToolOptions() {
  const id = S.tool.value, group = groupOf(id), hud = hudRules();
  if (group.id === 'look' || !S.left.value || (S.compact.value && S.right.value)) return null;
  const sub = S.sub.value;
  const simple = hud.toolOptions === 'simple' && SMART_TOOLS.includes(id);
  const tabs = group.tabs.filter(([t]) => !(simple && t === 'kits') && !hud.hideTools?.includes(t));
  const kitsTab = id === 'rock' && !simple && (R.kitsTab.value || !!sub.kit);
  const tab = kitsTab ? 'kits' : id;
  const T = ctx.tools;
  const label = group.tabs.length ? group.name : (hud.toolNames?.[id] ?? group.name);
  if (R.collapsed.value) {
    return (
      <button class="opts oc-chip" data-group={group.id} title={`${group.name}: show options`} onClick={() => { R.collapsed.value = false; R.dirty = false; }}>
        <Icon name={group.icon} size={18} />
        <span class="oc-chip-t"><em>{label}</em><b>{selection(id, sub)}</b></span>
        <Icon name="chevronU" size={16} />
      </button>
    );
  }
  const B = BODY[tab];
  const pickTab = (t) => {
    if (t === 'kits') { R.kitsTab.value = true; if (id !== 'rock') T.setTool('rock'); return; }
    R.kitsTab.value = false;
    if (t === 'rock' && sub.kit) T.setKit(null);
    if (t !== id) T.setTool(t);
  };
  // Dragging the handle down (or tapping it) folds the card on phones.
  let y0 = null;
  return (
    <div class={'opts oc glass' + (simple ? ' simple' : '')} data-group={group.id} data-tab={tab}>
      <button class="oc-handle" aria-label="Collapse options" onPointerDown={(e) => { y0 = e.clientY; }} onPointerUp={(e) => { if (y0 == null || e.clientY - y0 > -12) R.collapsed.value = true; y0 = null; }}><i /></button>
      <div class="oc-head">
        <h4>{label}</h4>
        <span class="oc-acts">
          <button class="btn ghost icon sm" title="Collapse (keep tool)" aria-label="Collapse options" onClick={() => { R.collapsed.value = true; }}><Icon name="chevronD" size={16} /></button>
          <button class="btn ghost icon sm" title="Close (Esc)" aria-label="Close options" onClick={() => T.setTool('view')}><Icon name="x" size={16} /></button>
        </span>
      </div>
      {tabs.length > 1 ? (
        <div class="seg" role="tablist" aria-label={group.name}>
          {tabs.map(([t, name]) => (
            <button key={t} role="tab" data-tool={t} aria-selected={tab === t} class={tab === t ? 'on' : ''} onClick={() => pickTab(t)}>{hud.toolNames?.[t] ?? name}</button>
          ))}
        </div>
      ) : null}
      <div class="oc-body">
        {simple ? <ExplorerPicks id={id} /> : <B />}
      </div>
    </div>
  );
}

export { fit, FIT_COLOR, toast, hint };
