// A semi-transparent card that follows whatever you click (animal, plant,
// stone, pool): what it is, how it is doing, and buttons to zoom in, follow it
// and open its field-guide page. On phones it docks above the tool bar.

import { useEffect, useRef } from 'preact/hooks';
import * as THREE from 'three/webgpu';
import { Icon } from '../icons.jsx';
import { S, openModal, toast, saveShowGenes } from '../store.js';
import { ctx } from '../../app/ctx.js';
import { SPECIES } from '../../sim/animals.js';
import { PLANTS } from '../../sim/plants.js';
import { PIECES } from '../../sim/decor.js';
import { ANIMAL_INFO } from '../../content/species-info.js';
import { PLANT_INFO } from '../../content/plant-info.js';
import { describe, hasGenetics } from '../../sim/genetics.js';
import { morphInfo, morphName } from '../../content/morphs.js';
import { livebearerText } from '../../sim/livebearer.js';
import { MorphDot, Stars } from '../GeneBits.jsx';

const v = new THREE.Vector3(), v2 = new THREE.Vector3();

function Meter({ label, value, tone }) {
  return (
    <div class="bn-meter" title={label}>
      <span>{label}</span>
      <div class="bar"><i style={{ width: Math.round(Math.max(0, Math.min(1, value)) * 100) + '%', background: tone }} /></div>
    </div>
  );
}

// Where a flowering plant is in its bloom cycle (sim/bloom.js: rest → bud → open → fade, the petals dropping at the end of fade),
// and while it rests, what keeps it from setting a bud.
function FlowerLine({ b }) {
  const pc = (t) => Math.round(Math.max(0, Math.min(1, t)) * 100) + '%';
  if (b.stage === 'bud') return <div class="bn-line">Flower: <b>in bud</b> <span class="dim">({pc(b.t)} of the way to opening)</span></div>;
  if (b.stage === 'open') return <div class="bn-line">Flower: <b>in bloom</b></div>;
  if (b.stage === 'fade') return <div class="bn-line">Flower: <b>{b.t < 0.55 ? 'fading' : 'dropping its petals'}</b></div>;
  return b.why ? <div class="bn-line warn">Flower: resting, {b.why}</div> : <div class="bn-line">Flower: <b>resting</b> <span class="dim">(next bud {pc(b.t)} of the way)</span></div>;
}

// An animal's colour morph and genes: what it looks like, what it carries, which generation it is, and who it is paired with.
function GeneCard({ a }) {
  const id = a.gsp ?? a.sp, info = morphInfo(id, a.morph);
  if (!info || !a.genes) return null;
  const A = ctx.game.world.animals;
  const mate = A.mateOf(a);
  const adultSp = hasGenetics(a.sp);
  const waiting = S.pairing.value === a;
  const pairUp = () => { S.pairing.value = a; toast(`Now tap the ${SPECIES[a.sp].name.toLowerCase()} you want to pair it with.`); };
  const lab = () => { S.geneParents.value = [a.id, mate?.id].filter((x) => x != null); openModal('lab', 'genetics'); };
  const show = S.showGenes.value;
  return (
    <div class="gene-card">
      <div class="gene-head"><MorphDot sp={id} morph={a.morph} size={13} /><b>{info.name}</b><Stars r={info.rarity} />
        <button class="btn sm ghost gene-toggle" aria-expanded={show} title={show ? 'Hide the genes' : 'Show the genes, the generation and the odds'} onClick={() => saveShowGenes(!show)}><Icon name="flask" size={13} />{show ? 'Hide genes' : 'Genes'}</button>
      </div>
      {SPECIES[a.sp]?.livebearer ? <div class="gene-meta"><span>{livebearerText(a, SPECIES[a.sp])}</span></div> : null}
      {mate ? <div class="gene-meta"><span class="heart">Paired with {morphName(id, mate.morph).toLowerCase()} #{mate.id}</span></div> : null}
      {show ? (
        <>
          <div class="gene-blurb">{info.blurb}</div>
          <ul class="gene-loci">{describe(id, a.genes).map((l) => <li key={l.name} class={'g-' + l.state}>{l.name}: <code>{l.genotype}</code> {l.label}</li>)}</ul>
          <div class="gene-meta">
            <span>{a.gen ? `Generation ${a.gen}` : 'Founder (generation 0)'}</span>
            {a.mut ? <span class="amber">A mutation!</span> : null}
          </div>
          <div class="gene-acts">
            {adultSp && !waiting ? <button class="btn sm" onClick={pairUp}><Icon name="heart" size={14} />{mate ? 'Change mate' : 'Pair up'}</button> : null}
            {waiting ? <button class="btn sm amber" onClick={() => { S.pairing.value = null; }}>Cancel pairing</button> : null}
            {mate ? <button class="btn sm ghost" onClick={() => A.unpair(a)}>Unpair</button> : null}
            <button class="btn sm" onClick={lab}><Icon name="flask" size={14} />Odds in the Lab</button>
            {a.sp === 'guppy' ? <button class="btn sm ghost" onClick={() => openModal('codex', 'concept:guppy-breeding')}><Icon name="book" size={14} />Breeding guide</button> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

const good = (x) => (x > 0.7 ? '#6fcf7a' : x > 0.4 ? '#ebb96c' : '#f0705a');

export function InfoBanner() {
  const sel = S.selection.value;
  const live = S.live.value;
  const ref = useRef();

  // Keep the card next to the thing it describes: project its position to the screen every frame. The card takes the first
  // side (right, left, above, below) where it leaves the subject uncovered, and keeps that side while it still fits, so it
  // does not hop about. It used to sit up and to the right and be pushed back by the screen margins, which on a followed
  // animal (always in the middle of the view) put it right over the animal.
  useEffect(() => {
    if (!sel) return undefined;
    const g = ctx.game;
    let side = null;
    const place = () => {
      const el = ref.current;
      if (!el) return;
      if (S.compact.value) { el.style.transform = 'none'; return; }
      const f = ctx.tools.focusOf(sel);
      const W = innerWidth, H = innerHeight, r = el.getBoundingClientRect();
      v.copy(f.p).project(g.camera);
      const behind = v.z > 1;
      const sx = (v.x * 0.5 + 0.5) * W, sy = (-v.y * 0.5 + 0.5) * H;
      // The subject's size on screen: a point one body radius to the side of it.
      const rad = sel.kind === 'animal' ? Math.max(1, (SPECIES[sel.obj.sp]?.size ?? 2) * 0.6) : sel.kind === 'plant' ? Math.max(2, (sel.obj.reach ?? 4) * 0.4) : 3;
      v2.setFromMatrixColumn(g.camera.matrixWorld, 0).multiplyScalar(rad).add(f.p).project(g.camera);
      const R = Math.min(Math.max(W, H) * 0.3, Math.max(18, Math.hypot((v2.x * 0.5 + 0.5) * W - sx, (-v2.y * 0.5 + 0.5) * H - sy))) + 10;
      const x0 = 96, x1 = Math.max(x0, W - r.width - 316), y0 = 64, y1 = Math.max(y0, H - r.height - 70);
      const cand = {
        right: [sx + R + 14, sy - r.height * 0.5],
        left: [sx - R - 14 - r.width, sy - r.height * 0.5],
        above: [sx - r.width * 0.5, sy - R - 14 - r.height],
        below: [sx - r.width * 0.5, sy + R + 14],
      };
      const fit = (k) => {
        const x = Math.max(x0, Math.min(x1, cand[k][0])), y = Math.max(y0, Math.min(y1, cand[k][1]));
        const ox = Math.max(0, Math.min(x + r.width, sx + R) - Math.max(x, sx - R)), oy = Math.max(0, Math.min(y + r.height, sy + R) - Math.max(y, sy - R));
        return { x, y, over: ox * oy };
      };
      let pick = side && fit(side).over === 0 ? side : null;
      if (!pick) {
        let best = Infinity;
        for (const k of ['right', 'left', 'above', 'below']) { const o = fit(k).over; if (o < best) { best = o; pick = k; } if (o === 0) break; }
      }
      side = pick;
      const { x, y } = fit(pick);
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
      {sel.kind === 'animal' ? <button class={'btn sm' + (following ? ' amber' : '')} onClick={() => T.followMode(following ? null : sel.obj)}><Icon name="eye" size={14} />{following ? 'Stop following' : 'Follow'}</button> : null}
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
        <div class="bn-head"><b class="serif">{a.nick || sp.name}</b>{info?.status ? <span class={'tag ' + (/Critically|Endangered|Vulnerable/.test(info.status) ? 'coral' : 'moss')}>{info.status.split(/[;(]/)[0].trim()}</span> : null}</div>
        <div class="bn-sub">{a.nick ? `${sp.name} · ` : ''}{info?.sci ? <i>{info.sci}</i> : sp.group} · {adult ? 'adult' : 'juvenile'}, {days.toFixed(days < 10 ? 1 : 0)} days old</div>
        <div class="bn-meters"><Meter label="Health" value={a.health} tone={good(a.health)} /><Meter label="Fed" value={1 - a.hunger} tone={good(1 - a.hunger)} /></div>
        {a.T != null ? <div class="bn-line">Here: <b>{a.T.toFixed(1)} °C</b>{sp.humidity && a.RH != null ? <>, <b>{Math.round(a.RH)}%</b> RH</> : null} <span class="dim">(needs {sp.temp[0]}–{sp.temp[1]} °C{sp.humidity ? `, ${sp.humidity}%+` : ''})</span></div> : null}
        {a.why?.length ? <div class="bn-line bad">Stressed: {a.why.join(', ')}</div> : <div class="bn-line ok">Content.</div>}
        <GeneCard a={a} />
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
        {p.bloom ? <FlowerLine b={p.bloom} /> : null}
        {p.bodyName ? <div class="bn-line">Water: {p.bodyName}</div> : p.fert != null ? <div class="bn-line">Soil: fertility {Math.round(p.fert * 100)}% · humus {Math.round((p.humusHere ?? 0) * 100)}% · litter {Math.round((p.litterHere ?? 0) * 100)}%</div> : null}
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
        {p.body ? <div class="bn-line"><b>{p.body.name}</b>: NH₃ <b>{p.body.ammonia.toFixed(2)}</b> · NO₃ <b>{Math.round(p.body.nitrate)}</b> ppm · O₂ <b>{p.body.oxygen.toFixed(1)}</b> mg/L · <b>{p.body.temp.toFixed(1)} °C</b>, in {Math.round(p.body.inLph)} / out {Math.round(p.body.outLph)} L/h{p.body.spill?.dir ? `, spills ${p.body.spill.dir}` : ''}</div> : null}
        <p class="bn-fact">Pools fill from streams and falls and spill over their lowest lip. Amphibians lay eggs in the shallows; frogs cannot swim well.</p>
        <div class="bn-acts"><button class="btn sm primary" onClick={() => T.zoomTo(sel)}><Icon name="search" size={14} />Zoom in</button></div>
      </>
    );
  }
  const pairing = S.pairing.value;
  return (
    <>
      {pairing && !pairing.dead ? <div class="pairing-flag" style={{ top: 'calc(96px + var(--st))' }}>Tap another {SPECIES[pairing.sp].name.toLowerCase()} to pair them (tap empty space to cancel)</div> : null}
      <div class="banner glass" ref={ref} role="dialog" aria-label="Details">
        <button class="btn ghost icon sm bn-x" onClick={close} title="Close (Esc)"><Icon name="x" size={14} /></button>
        {body}
      </div>
    </>
  );
}
