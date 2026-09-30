// A semi-transparent card that follows whatever you click (animal, plant,
// stone, pool): what it is, how it is doing, and buttons to zoom in, follow it
// and open its field-guide page. On phones it docks above the tool bar.

import { useEffect, useRef } from 'preact/hooks';
import * as THREE from 'three/webgpu';
import { Icon } from '../icons.jsx';
import { S, openModal } from '../store.js';
import { ctx } from '../../app/ctx.js';
import { SPECIES } from '../../sim/animals.js';
import { PLANTS } from '../../sim/plants.js';
import { PIECES } from '../../sim/decor.js';
import { ANIMAL_INFO } from '../../content/species-info.js';
import { PLANT_INFO } from '../../content/plant-info.js';

const v = new THREE.Vector3();

function Meter({ label, value, tone }) {
  return (
    <div class="bn-meter" title={label}>
      <span>{label}</span>
      <div class="bar"><i style={{ width: Math.round(Math.max(0, Math.min(1, value)) * 100) + '%', background: tone }} /></div>
    </div>
  );
}

const good = (x) => (x > 0.7 ? '#6fcf7a' : x > 0.4 ? '#ebb96c' : '#f0705a');

export function InfoBanner() {
  const sel = S.selection.value;
  const live = S.live.value;
  const ref = useRef();

  // Keep the card next to the thing it describes: project its position to the screen every frame.
  useEffect(() => {
    if (!sel) return undefined;
    const g = ctx.game;
    const place = () => {
      const el = ref.current;
      if (!el) return;
      if (S.compact.value) { el.style.transform = 'none'; return; }
      const f = ctx.tools.focusOf(sel);
      v.copy(f.p).project(g.camera);
      const W = innerWidth, H = innerHeight, r = el.getBoundingClientRect();
      let x = (v.x * 0.5 + 0.5) * W + 26, y = (-v.y * 0.5 + 0.5) * H - r.height - 14;
      const behind = v.z > 1;
      x = Math.max(96, Math.min(W - r.width - 316, x));
      y = Math.max(64, Math.min(H - r.height - 70, y));
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      el.style.opacity = behind ? '0' : '1';
    };
    g.frameHooks.push(place);
    place();
    return () => { const i = g.frameHooks.indexOf(place); if (i >= 0) g.frameHooks.splice(i, 1); };
  }, [sel?.obj]);

  if (!sel || sel.obj?.dead) return null;
  void live;
  const T = ctx.tools;
  const close = () => T.select(null);
  const following = S.following.value === sel.obj;
  const acts = (guide) => (
    <div class="bn-acts">
      <button class="btn sm primary" onClick={() => T.zoomTo(sel)}><Icon name="search" size={14} />Zoom in</button>
      {sel.kind === 'animal' ? <button class={'btn sm' + (following ? ' amber' : '')} onClick={() => T.follow(following ? null : sel.obj)}><Icon name="eye" size={14} />{following ? 'Stop following' : 'Follow'}</button> : null}
      {guide ? <button class="btn sm" onClick={() => openModal('codex', guide)}><Icon name="book" size={14} />Field guide</button> : null}
    </div>
  );

  let body = null;
  if (sel.kind === 'animal') {
    const a = sel.obj, sp = SPECIES[a.sp], info = ANIMAL_INFO[a.sp];
    const days = a.age / 1440;
    const adult = days >= (sp.adultDays ?? 10);
    body = (
      <>
        <div class="bn-head"><b class="serif">{sp.name}</b>{info?.status ? <span class={'tag ' + (/Critically|Endangered|Vulnerable/.test(info.status) ? 'coral' : 'moss')}>{info.status.split(/[;(]/)[0].trim()}</span> : null}</div>
        <div class="bn-sub">{info?.sci ? <i>{info.sci}</i> : sp.group} · {adult ? 'adult' : 'juvenile'}, {days.toFixed(days < 10 ? 1 : 0)} days old</div>
        <div class="bn-meters"><Meter label="Health" value={a.health} tone={good(a.health)} /><Meter label="Fed" value={1 - a.hunger} tone={good(1 - a.hunger)} /></div>
        {a.T != null ? <div class="bn-line">Here: <b>{a.T.toFixed(1)} °C</b>{sp.humidity && a.RH != null ? <>, <b>{Math.round(a.RH)}%</b> RH</> : null} <span class="dim">(needs {sp.temp[0]}–{sp.temp[1]} °C{sp.humidity ? `, ${sp.humidity}%+` : ''})</span></div> : null}
        {a.why?.length ? <div class="bn-line bad">Stressed: {a.why.join(', ')}</div> : <div class="bn-line ok">Content.</div>}
        {info?.facts?.[0] ? <p class="bn-fact">{info.facts[0].length > 170 ? info.facts[0].slice(0, 168).replace(/\s\S*$/, '') + '…' : info.facts[0]}</p> : <p class="bn-fact">{sp.note}</p>}
        {acts('animal:' + a.sp)}
        {ctx.career?.canSell?.(a) ? <button class="btn sm amber" onClick={() => ctx.career.sellAnimal(a)}><Icon name="coin" size={14} />Sell for ¤{ctx.career.sellQuote(a).price}</button> : null}
      </>
    );
  } else if (sel.kind === 'plant') {
    const p = sel.obj, sp = PLANTS[p.id], info = PLANT_INFO[p.id];
    body = (
      <>
        <div class="bn-head"><b class="serif">{sp.name}</b></div>
        <div class="bn-sub">{info?.sci ? <i>{info.sci}</i> : sp.habitat.split('|').join(' / ')}{info?.role ? ` · ${info.role}` : ''}</div>
        <div class="bn-meters"><Meter label="Health" value={p.health} tone={good(p.health)} /><Meter label="Grown" value={p.grown} tone="#8fd6a4" /></div>
        {p.why?.length ? <div class="bn-line warn">Struggling: {p.why.join(', ')}</div> : <div class="bn-line ok">Thriving.</div>}
        <p class="bn-fact">{info?.facts?.[0] ? (info.facts[0].length > 170 ? info.facts[0].slice(0, 168).replace(/\s\S*$/, '') + '…' : info.facts[0]) : sp.note}</p>
        {acts('plant:' + p.id)}
      </>
    );
  } else if (sel.kind === 'piece') {
    const p = sel.obj;
    body = (
      <>
        <div class="bn-head"><b class="serif">{PIECES[p.type].name}</b><span class="tag">hardscape</span></div>
        <div class="bn-sub">Water pools against it, animals climb it, moss grows on its damp upper faces.</div>
        <div class="bn-line">Moss on stone: <b>{Math.round((S.live.value?.env ? ctx.game.world.env.rockMoss : 0) * 100)}%</b></div>
        <div class="bn-acts">
          <button class="btn sm primary" onClick={() => T.zoomTo(sel)}><Icon name="search" size={14} />Zoom in</button>
          <button class="btn sm" onClick={() => { T.setTool('rock'); T.selectPiece(p); T.select(null); }}><Icon name="cog" size={14} />Move / edit</button>
        </div>
      </>
    );
  } else {
    const p = sel.obj;
    body = (
      <>
        <div class="bn-head"><b class="serif">Pool</b><span class="tag water">water</span></div>
        <div class="bn-line"><b>{p.litres.toFixed(2)} L</b> over <b>{Math.round(p.area)} cm²</b>, level {p.level.toFixed(1)} cm</div>
        <p class="bn-fact">Pools fill from streams and falls and spill over their lowest lip. Amphibians lay eggs in the shallows; frogs cannot swim well.</p>
        <div class="bn-acts"><button class="btn sm primary" onClick={() => T.zoomTo(sel)}><Icon name="search" size={14} />Zoom in</button></div>
      </>
    );
  }
  return (
    <div class="banner glass" ref={ref} role="dialog" aria-label="Details">
      <button class="btn ghost icon sm bn-x" onClick={close} title="Close (Esc)"><Icon name="x" size={14} /></button>
      {body}
    </div>
  );
}
