// The Studio: your commissions board, the equipment shop, the market, your
// tanks and your career record.

import { useState, useEffect } from 'preact/hooks';
import { S, toast, openModal, closeModal } from '../store.js';
import { Sheet } from './Modals.jsx';
import { Icon } from '../icons.jsx';
import { ctx } from '../../app/ctx.js';
import { GEAR, GEAR_GROUPS } from '../../content/equipment.js';
import { TANKS, TANK_ORDER, CUSTOM_LIMITS, setCustomTank, clampCustom, cellsFor } from '../../content/tanks.js';
import { RANKS } from '../../content/levels.js';
import { ACHIEVEMENTS } from '../../content/achievements.js';
import { ANIMALS, unlocksAt } from '../../content/economy.js';
import { sellPrice, demand, isSellable } from '../../game/market.js';
import { SPECIES } from '../../sim/animals.js';
import { BIOTOPES, BIOTOPE_ORDER } from '../../content/biotopes.js';
import { loadPresets } from '../../app/lazy-gen.js';
import { KITS, kitCounts, kitReach } from '../../content/kits.js';
import { PIECES } from '../../sim/decor.js';
import { KitPrice, kitInfo } from '../hud/ToolOptions.jsx';
import '../builder.css';

const TABS = [['commissions', 'Commissions', 'clipboard'], ['shop', 'Shop', 'cog'], ['kits', 'Kits', 'layers'], ['market', 'Market', 'coin'], ['tanks', 'Tanks', 'home'], ['career', 'Career', 'trophy']];

export function Studio() {
  const arg = S.modalArg.value;
  const [tab, setTab] = useState(TABS.some((t) => t[0] === arg) ? arg : 'commissions');
  useEffect(() => { if (TABS.some((t) => t[0] === arg)) setTab(arg); }, [arg]);
  const career = S.career.value;
  const sandbox = career?.mode === 'sandbox';
  return (
    <Sheet title="Studio" icon="briefcase" tabs={TABS.filter((t) => !(sandbox && (t[0] === 'commissions' || t[0] === 'market')))} tab={tab} setTab={setTab} wide>
      {tab === 'commissions' ? <Commissions /> : tab === 'shop' ? <Shop /> : tab === 'kits' ? <Kits /> : tab === 'market' ? <Market /> : tab === 'tanks' ? <Tanks /> : <CareerTab />}
    </Sheet>
  );
}

const Reward = ({ r }) => <span class="price"><Icon name="coin" size={13} />{r.funds} <span style={{ color: 'var(--moss)', marginLeft: 6 }}>+{r.rep} rep</span></span>;

function Commissions() {
  const c = S.career.value;
  const D = ctx.director;
  useEffect(() => { D?.commissions.markSeen(); }, []);
  if (!c) return null;
  const accept = (id) => { const err = D.commissions.accept(id, ctx.game.world); if (err) toast(err, 'bad'); else { toast('Commission accepted.', 'good'); D.publish(); } };
  const claim = (id) => { D.commissions.claim(id); D.publish(); };
  return (
    <div>
      <div class="h3">Active ({c.active.length}/3)</div>
      {c.active.length === 0 ? <p class="note">No active commission. Accept one below.</p> : null}
      <div class="cols" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
        {c.active.map((a) => (
          <div key={a.id} class="tile" style={a.ready ? { borderColor: 'var(--amber)' } : null}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><h4>{a.title}</h4><span class="tag amber">{a.giver}</span></div>
            <p>{a.brief}</p>
            <div>
              {a.goals.map((g) => (
                <div key={g.id} class={'goal' + (g.done ? ' done' : '')}>
                  <span class="box">{g.done ? <Icon name="check" size={11} stroke={3} /> : null}</span><span>{g.text}</span>{g.progressText ? <span class="pg">{g.progressText}</span> : null}
                </div>
              ))}
            </div>
            {a.teaches?.length ? <div class="chips" style={{ marginBottom: 0 }}>{a.teaches.map((t) => <button key={t} class="chip" onClick={() => openModal('codex', 'concept:' + t)}><Icon name="book" size={12} /> {t.replace(/-/g, ' ')}</button>)}</div> : null}
            <div class="foot">
              <Reward r={a.reward} />
              {a.ready ? <button class="btn sm amber" onClick={() => claim(a.id)}>Claim reward</button> : <button class="btn sm ghost" onClick={() => { D.commissions.abandon(a.id); D.publish(); }}>Abandon</button>}
            </div>
          </div>
        ))}
      </div>
      <div class="h3" style={{ marginTop: 16 }}>Available</div>
      <div class="cols">
        {c.available.map((a) => (
          <div key={a.id} class={'tile' + (a.locked ? ' lock' : '')}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><h4>{a.title}</h4>{a.isNew ? <span class="tag coral">new</span> : null}</div>
            <p>{a.locked ? <span class="lockmark"><Icon name="lock" size={11} /> Rank {a.level}: {RANKS[a.level - 1].name}</span> : `${a.giver} · tier ${a.tier}`}</p>
            {!a.locked ? <div class="foot"><Reward r={a.reward} /><button class="btn sm primary" onClick={() => accept(a.id)}>Accept</button></div> : null}
          </div>
        ))}
        {!c.available.length ? <p class="note">Nothing new. Finish your active commissions, or rank up.</p> : null}
      </div>
      {c.done.length ? <p class="note" style={{ marginTop: 12 }}>{c.done.length} commission{c.done.length > 1 ? 's' : ''} completed.</p> : null}
    </div>
  );
}

function Shop() {
  const career = S.career.value;
  const W = ctx.game.world;
  const [, force] = useState(0);
  const buy = (id) => {
    const err = ctx.career.buy('gear', id);
    if (err) { toast(err, 'bad'); return; }
    W.equipment.buy(id);
    ctx.director.publish();
    toast(`${GEAR[id].name} fitted.`, 'good');
    force((n) => n + 1);
  };
  void career;
  return (
    <div>
      <p class="note" style={{ marginTop: 0 }}>Gear you buy is fitted to whichever tank you are looking at. Each item has a note on the real science behind it.</p>
      {GEAR_GROUPS.map((grp) => (
        <div key={grp}>
          <div class="h3" style={{ marginTop: 14 }}>{grp}</div>
          <div class="cols">
            {Object.values(GEAR).filter((g) => g.group === grp).map((g) => {
              const info = ctx.career.info('gear', g.id);
              const owned = W.equipment.has(g.id);
              return (
                <div key={g.id} class={'tile' + (info?.locked && !owned ? ' lock' : '')}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Icon name={g.icon} size={18} style={{ color: 'var(--moss)' }} /><h4>{g.name}</h4></div>
                  <p>{g.blurb}</p>
                  <p style={{ color: '#b9c9bf', fontStyle: 'italic' }}>{g.teach}</p>
                  <div class="foot">
                    {owned ? <span class="tag moss">Fitted</span> : info?.locked ? <span class="lockmark"><Icon name="lock" size={11} /> Rank {info.level}</span> : <span class="price"><Icon name="coin" size={13} />{g.price}</span>}
                    {!owned && !info?.locked ? <button class="btn sm primary" onClick={() => buy(g.id)}>Buy</button> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// Kits: prefab aquascape compositions. Pick one, then click the tank to drop it there.
const KIT_COLOR = { boulder: '#9aa39c', cliff: '#7f8a86', spire: '#b5bdc4', stump: '#c69a62', roots: '#b58a4f', wood: '#c9a56a' };

function KitPlan({ kit }) {
  const R = kitReach(kit) + 3;
  return (
    <svg class="kit-plan" viewBox={`${-R} ${-R * 0.75} ${R * 2} ${R * 1.5}`} role="img" aria-label={`Plan view of ${kit.name}`}>
      {(kit.banks ?? []).map((b, i) => <circle key={'b' + i} cx="0" cy="0" r={b.ring} fill="none" stroke="var(--moss)" stroke-width={b.width} opacity="0.45" />)}
      {kit.pieces.map((p, i) => (
        <ellipse key={i} cx={p.dx} cy={p.dz} rx={(p.width ?? p.size) / 2} ry={(p.width ?? p.size) / 2 * (p.type === 'wood' || p.type === 'roots' ? 0.45 : 0.85)} fill={KIT_COLOR[p.type] ?? '#999'}
          opacity={p.stack ? 0.95 : 0.78} stroke="rgba(0,0,0,0.35)" stroke-width="0.5" />
      ))}
      {kit.outlet ? <circle cx={kit.pieces[kit.outlet.on].dx} cy={kit.pieces[kit.outlet.on].dz} r="2" fill="var(--water)" stroke="#fff" stroke-width="0.5" /> : null}
    </svg>
  );
}

function Kits() {
  const [, force] = useState(0);
  void S.career.value;
  const use = (k) => {
    const info = kitInfo(k);
    if (info?.locked) { toast(`Unlocked at rank ${info.level}: ${RANKS[info.level - 1].name}.`, 'bad'); return; }
    ctx.tools.setKit(k.id);
    closeModal();
    toast(`${k.name} ready: click the tank to place it.`);
    force((n) => n + 1);
  };
  return (
    <div>
      <p class="note" style={{ marginTop: 0 }}>A kit is a whole composition dropped on the tank with one click, and one undo takes it back. Each placement varies a little. In a career it costs the sum of its pieces; in the sandbox it is free. Turn on Mirror (M) to place a mirror image beside it.</p>
      <div class="cols kit-cols">
        {KITS.map((k) => {
          const info = kitInfo(k);
          const counts = Object.entries(kitCounts(k));
          return (
            <div key={k.id} class={'tile kit' + (info?.locked ? ' lock' : '')}>
              <KitPlan kit={k} />
              <h4>{k.name}</h4>
              <p>{k.blurb}</p>
              <p class="teach">{k.teaches}</p>
              <div class="chips kit-parts">{counts.map(([t, n]) => <span key={t} class="tag">{PIECES[t]?.name ?? t} × {n}</span>)}{k.outlet ? <span class="tag water">Pump outlet</span> : null}</div>
              <div class="foot">
                {info ? <KitPrice kit={k} /> : <span class="tag moss">Free in the sandbox</span>}
                <button class="btn sm primary" onClick={() => use(k)} disabled={!!info?.locked}>Place a kit</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Market() {
  const c = ctx.career;
  const day = c.day;
  const rows = Object.entries(SPECIES).filter(([id]) => isSellable(id)).map(([id, sp]) => {
    const now = sellPrice({ sp: id, age: 999 * 1440, health: 1 }, day);
    const d = demand(id, day), d2 = demand(id, day + 5);
    return { id, name: sp.name, price: ANIMALS[id]?.price ?? 0, now, d, trend: d2 - d };
  }).sort((a, b) => b.now - a.now);
  return (
    <div>
      <p class="note" style={{ marginTop: 0 }}>Breeding pays. Buyers want healthy adults. Prices follow a slow cycle of demand: breed what is about to be wanted. Click an animal in your tank and choose Sell.</p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead><tr style={{ color: 'var(--dim)', textAlign: 'left' }}><th>Species</th><th>Buy price</th><th>Pays today</th><th>Demand</th><th>Next week</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderTop: '1px solid var(--line)' }}>
              <td style={{ padding: '6px 4px' }}>{r.name}</td><td>¤{r.price}</td><td class="num"><b>¤{r.now}</b></td>
              <td><div class="bar" style={{ width: 90 }}><i style={{ width: Math.round(Math.min(1, r.d / 1.5) * 100) + '%', background: r.d > 1.15 ? 'var(--moss)' : r.d < 0.9 ? 'var(--coral)' : 'var(--amber)' }} /></div></td>
              <td style={{ color: r.trend > 0.05 ? 'var(--moss)' : r.trend < -0.05 ? 'var(--coral)' : 'var(--dim)' }}>{r.trend > 0.05 ? '▲ rising' : r.trend < -0.05 ? '▼ falling' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Tanks() {
  const c = ctx.career;
  const [presets, setPresets] = useState(null);
  useEffect(() => { loadPresets().then(setPresets).catch(() => setPresets([])); }, []);
  const cur = ctx.game.tankId;
  const [pick, setPick] = useState(null);
  const build = async (tier, preset) => {
    const own = c.sandbox || c.tanks.has(tier);
    if (!own) { const err = c.buy('tank', tier); if (err) { toast(err, 'bad'); return; } ctx.director.publish(); }
    S.modal.value = null;
    await ctx.director.buildTank(tier, preset ? { id: preset.id, seed: preset.seed ?? ((Math.random() * 99999) | 0) } : null);
  };
  return (
    <div>
      <p class="note" style={{ marginTop: 0 }}>You are looking at the <b>{TANKS[cur]?.name}</b>. Building a new tank puts this one in your portfolio, exactly as it is, and you can come back to it.</p>
      <div class="cols">
        {TANK_ORDER.map((id) => {
          const t = TANKS[id];
          const info = c.info('tank', id);
          const owned = c.sandbox || c.tanks.has(id);
          return (
            <div key={id} class={'tile' + (info?.locked ? ' lock' : '')}>
              <h4>{t.name}{id === cur ? <span class="tag moss" style={{ marginLeft: 8 }}>current</span> : null}</h4>
              <p>{t.w} × {t.d} × {t.h} cm · {Math.round(t.w * t.d * t.h / 1000)} L{t.closed ? ' · sealed' : ''}</p>
              <p>{t.blurb}</p>
              <div class="foot">
                {info?.locked ? <span class="lockmark"><Icon name="lock" size={11} /> Rank {info.level}</span> : owned ? <span class="tag moss">Owned</span> : <span class="price"><Icon name="coin" size={13} />{t.price}</span>}
                {!info?.locked ? <button class="btn sm primary" onClick={() => setPick(id)}>{owned ? 'Build here' : 'Buy and build'}</button> : null}
              </div>
            </div>
          );
        })}
      </div>
      {c.sandbox ? <CustomSize onPick={() => { setPick('custom'); }} /> : null}
      {pick ? (
        <div class="tile" style={{ marginTop: 14 }}>
          <h4>New {TANKS[pick].name}: how do you want to start?</h4>
          <div class="cols">
            <button class="tile" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => build(pick, null)}><h4>Empty tank</h4><p>Bare glass and substrate. Build everything yourself.</p></button>
            {(presets ?? []).filter((p) => !p.tiers || (pick === 'custom' ? p.id !== 'jar' : p.tiers.includes(pick))).map((p) => (
              <button key={p.id} class="tile" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => build(pick, p)}><h4>{p.name}</h4><p>{p.blurb}</p><div class="chips" style={{ marginBottom: 0 }}>{(p.tags ?? []).slice(0, 3).map((t) => <span key={t} class="tag">{t}</span>)}</div></button>
            ))}
          </div>
        </div>
      ) : null}
      <PortfolioList />
    </div>
  );
}

// Sandbox only: a tank of any size within safe limits (the grid resolution is chosen to keep it fast).
function CustomSize({ onPick }) {
  const L = CUSTOM_LIMITS;
  const [v, setV] = useState(() => { const t = TANKS.custom; return t ? { w: t.w, d: t.d, h: t.h } : { w: 80, d: 40, h: 50 }; });
  const s = clampCustom(v.w, v.d, v.h);
  const row = (k, label) => (
    <label style={{ display: 'grid', gridTemplateColumns: '70px 1fr 56px', gap: 8, alignItems: 'center', margin: '4px 0' }}>
      <span>{label}</span>
      <input type="range" min={L[k][0]} max={L[k][1]} step={1} value={v[k]} onInput={(e) => setV({ ...v, [k]: +e.currentTarget.value })} />
      <span>{s[k]} cm</span>
    </label>
  );
  return (
    <div class="tile" style={{ marginTop: 14 }}>
      <h4>Custom size <span class="tag">sandbox</span></h4>
      <p>{s.w} × {s.d} × {s.h} cm · {Math.round(s.w * s.d * s.h / 1000)} L · grid {cellsFor(s.w, s.d, s.h)} cells per cm. Limits: {L.w[0]}–{L.w[1]} wide, {L.d[0]}–{L.d[1]} deep, {L.h[0]}–{L.h[1]} high, at most {L.maxLitres} L.</p>
      {row('w', 'Width')}{row('d', 'Depth')}{row('h', 'Height')}
      <div class="foot"><span />
        <button class="btn sm primary" onClick={() => { setCustomTank(s.w, s.d, s.h); onPick(); }}>Build this size</button>
      </div>
    </div>
  );
}

function PortfolioList() {
  const [list, setList] = useState(null);
  useEffect(() => { ctx.director.portfolio().then(setList); }, []);
  if (!list?.length) return null;
  return (
    <div>
      <div class="h3" style={{ marginTop: 18 }}>Portfolio</div>
      <div class="cols">
        {list.map((p) => (
          <div key={p.id} class="tile">
            <h4>{p.name}</h4><p>{TANKS[p.tier]?.name} · day {p.day} · {p.animals} animals</p>
            <div class="foot"><span /><button class="btn sm" onClick={async () => { S.modal.value = null; await ctx.director.openPortfolio(p.id); }}>Open</button></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CareerTab() {
  const c = S.career.value;
  if (!c) return null;
  const done = new Set(c.achievements);
  return (
    <div>
      <div class="two">
        <div>
          <div class="h3">Ranks</div>
          {RANKS.map((r) => (
            <div key={r.level} style={{ display: 'flex', gap: 10, padding: '6px 0', opacity: r.level > c.level ? 0.55 : 1, borderBottom: '1px solid var(--line)' }}>
              <span class="tag" style={r.level === c.level ? { background: 'var(--moss)', color: '#0b1a10' } : null}>{r.level}</span>
              <div style={{ flex: 1 }}><b>{r.name}</b> <span class="dim" style={{ color: 'var(--faint)' }}>{r.rep} rep</span>
                <div class="note" style={{ margin: 0 }}>{r.text}{r.level > 1 ? ` Unlocks: ${unlocksAt(r.level).map((u) => u.name).slice(0, 5).join(', ') || 'more'}.` : ''}</div></div>
            </div>
          ))}
        </div>
        <div>
          <div class="h3">Achievements ({done.size}/{ACHIEVEMENTS.length})</div>
          <div class="cols" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
            {ACHIEVEMENTS.map((a) => (
              <div key={a.id} class={'tile' + (done.has(a.id) ? '' : ' lock')} style={{ padding: 9 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Icon name={a.icon} size={15} style={{ color: done.has(a.id) ? 'var(--amber)' : 'var(--faint)' }} /><b style={{ fontSize: 12.5 }}>{a.name}</b></div>
                <p style={{ fontSize: 11 }}>{a.text}</p>
              </div>
            ))}
          </div>
          <div class="h3" style={{ marginTop: 14 }}>Journal</div>
          {c.journal.map((j, i) => <div key={i} class={'log ' + (j.kind === 'gold' ? 'eat' : j.kind)}><i>day {j.day}</i>{j.text}</div>)}
        </div>
      </div>
    </div>
  );
}

export { BIOTOPES, BIOTOPE_ORDER };
