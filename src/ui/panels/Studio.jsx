// The Studio: your commissions board, the equipment shop, the market, your
// tanks and your career record.

import { useState, useEffect } from 'preact/hooks';
import { S, toast, openModal } from '../store.js';
import { Sheet } from './Modals.jsx';
import { Icon } from '../icons.jsx';
import { ctx } from '../../app/ctx.js';
import { GEAR, GEAR_GROUPS } from '../../content/equipment.js';
import { TANKS, TANK_ORDER } from '../../content/tanks.js';
import { RANKS } from '../../content/levels.js';
import { ACHIEVEMENTS } from '../../content/achievements.js';
import { ANIMALS, unlocksAt } from '../../content/economy.js';
import { sellPrice, demand, isSellable } from '../../game/market.js';
import { SPECIES } from '../../sim/animals.js';
import { BIOTOPES, BIOTOPE_ORDER } from '../../content/biotopes.js';
import { loadPresets } from '../../app/lazy-gen.js';

const TABS = [['commissions', 'Commissions', 'clipboard'], ['shop', 'Shop', 'cog'], ['market', 'Market', 'coin'], ['tanks', 'Tanks', 'home'], ['career', 'Career', 'trophy']];

export function Studio() {
  const arg = S.modalArg.value;
  const [tab, setTab] = useState(TABS.some((t) => t[0] === arg) ? arg : 'commissions');
  useEffect(() => { if (TABS.some((t) => t[0] === arg)) setTab(arg); }, [arg]);
  const career = S.career.value;
  const sandbox = career?.mode === 'sandbox';
  return (
    <Sheet title="Studio" icon="briefcase" tabs={TABS.filter((t) => !(sandbox && (t[0] === 'commissions' || t[0] === 'market')))} tab={tab} setTab={setTab} wide>
      {tab === 'commissions' ? <Commissions /> : tab === 'shop' ? <Shop /> : tab === 'market' ? <Market /> : tab === 'tanks' ? <Tanks /> : <CareerTab />}
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
      {pick ? (
        <div class="tile" style={{ marginTop: 14 }}>
          <h4>New {TANKS[pick].name}: how do you want to start?</h4>
          <div class="cols">
            <button class="tile" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => build(pick, null)}><h4>Empty tank</h4><p>Bare glass and substrate. Build everything yourself.</p></button>
            {(presets ?? []).filter((p) => !p.tiers || p.tiers.includes(pick)).map((p) => (
              <button key={p.id} class="tile" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => build(pick, p)}><h4>{p.name}</h4><p>{p.blurb}</p><div class="chips" style={{ marginBottom: 0 }}>{(p.tags ?? []).slice(0, 3).map((t) => <span key={t} class="tag">{t}</span>)}</div></button>
            ))}
          </div>
        </div>
      ) : null}
      <PortfolioList />
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
