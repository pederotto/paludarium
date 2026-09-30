import { useState, useEffect } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { S, openModal } from './store.js';
import { ctx } from '../app/ctx.js';
import { TANKS, TANK_ORDER } from '../content/tanks.js';
import { loadPresets } from '../app/lazy-gen.js';

export function Title() {
  const [view, setView] = useState('menu');
  return (
    <div class="title">
      {view === 'menu' ? <Menu go={setView} /> : <Generated back={() => setView('menu')} />}
      <div class="foot">
        <span>{S.backend.value}</span><span>·</span><span>three.js WebGPU</span><span>·</span>
        <a href="https://github.com/pederotto/paludarium" target="_blank" rel="noopener" style={{ color: 'inherit' }}>source</a>
      </div>
    </div>
  );
}

function Menu({ go }) {
  const meta = ctx.meta;
  const start = ctx.start;
  return (
    <div class="box">
      <h1 class="serif">Paludarium</h1>
      <p class="tag-line">Build living worlds of moss, stone and water. Learn how real terrariums and paludariums work by keeping one alive.</p>
      <div class="menu">
        {meta ? <button class="btn primary" onClick={() => start.continue()}><Icon name="play" size={16} />Continue · {meta.name}<span style={{ opacity: 0.7, fontWeight: 500, marginLeft: 'auto' }}>day {meta.day}</span></button> : null}
        <button class={'btn' + (meta ? '' : ' primary')} onClick={() => start.career()}><Icon name="sprout" size={16} />New career<span style={{ opacity: 0.6, fontWeight: 500, marginLeft: 'auto' }}>learn as you build</span></button>
        <button class="btn" onClick={() => go('gen')}><Icon name="wand" size={16} />Start from a generated terrarium<span style={{ opacity: 0.6, fontWeight: 500, marginLeft: 'auto' }}>sandbox</span></button>
        <button class="btn" onClick={() => start.sandbox('starter')}><Icon name="mountain" size={16} />Sandbox: the starter paludarium</button>
        <button class="btn" onClick={() => start.sandbox('empty')}><Icon name="grid" size={16} />Sandbox: an empty tank</button>
        <button class="btn ghost" onClick={() => openModal('settings')}><Icon name="settings" size={16} />Settings</button>
      </div>
    </div>
  );
}

// Pre-formed, procedurally generated terrariums: pick a size and a style, or roll the dice.
function Generated({ back }) {
  const [presets, setPresets] = useState(null);
  const [tier, setTier] = useState('standard');
  const [seeds, setSeeds] = useState({});
  useEffect(() => { loadPresets().then(setPresets).catch(() => setPresets([])); }, []);
  const seed = (id) => seeds[id] ?? 1000 + (id.length * 977) % 9000;
  const list = (presets ?? []).filter((p) => !p.tiers || p.tiers.includes(tier));
  const surprise = () => { const p = list[(Math.random() * list.length) | 0]; if (p) ctx.start.preset(p.id, (Math.random() * 99999) | 0, tier); };
  return (
    <div class="box" style={{ maxWidth: 640 }}>
      <button class="btn ghost sm" onClick={back}><Icon name="chevronL" size={14} /> Back</button>
      <h1 class="serif" style={{ fontSize: 'clamp(30px, 4.5vw, 46px)', marginTop: 8 }}>Generated terrariums</h1>
      <p class="tag-line" style={{ marginTop: 8 }}>Each one is composed, planted and stocked for you, then left running. Every seed is different.</p>
      <div class="seg" style={{ marginBottom: 12 }}>{TANK_ORDER.map((t) => <button key={t} class={tier === t ? 'on' : ''} onClick={() => setTier(t)}>{TANKS[t].name.split(' ')[0]}</button>)}</div>
      {presets === null ? <p class="note">Loading…</p> : !presets.length ? <p class="note">The generator is not available in this build.</p> : (
        <div class="cols" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', maxHeight: '46vh', overflowY: 'auto', alignContent: 'start', gridAutoRows: 'max-content' }}>
          {list.map((p) => (
            <div key={p.id} class="tile glass" style={{ cursor: 'pointer' }} onClick={() => ctx.start.preset(p.id, seed(p.id), tier)}>
              <h4>{p.name}</h4><p>{p.blurb}</p>
              <div class="foot"><span class="tag">seed {seed(p.id)}</span>
                <button class="btn sm ghost" title="New seed" onClick={(e) => { e.stopPropagation(); setSeeds({ ...seeds, [p.id]: (Math.random() * 99999) | 0 }); }}><Icon name="swap" size={13} /></button></div>
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}><button class="btn primary" onClick={surprise} disabled={!list.length}><Icon name="wand" size={16} /> Surprise me</button></div>
    </div>
  );
}
