// The Field Guide: concept cards, animals, plants and biotopes, on cream paper.

import { useState, useEffect } from 'preact/hooks';
import { S, openModal } from '../store.js';
import { Sheet } from './Modals.jsx';
import { Icon } from '../icons.jsx';
import { RangeBar, WIDGETS } from './widgets.jsx';
import { ctx } from '../../app/ctx.js';
import { SPECIES } from '../../sim/animals.js';
import { PLANTS } from '../../sim/plants.js';
import { ANIMAL_INFO } from '../../content/species-info.js';
import { PLANT_INFO } from '../../content/plant-info.js';
import { CONCEPTS } from '../../content/concepts.js';
import { BIOTOPES, BIOTOPE_ORDER } from '../../content/biotopes.js';
import { Portrait } from './Portrait.jsx';

const TABS = [['concept', 'Concepts', 'book'], ['animal', 'Animals', 'frog'], ['plant', 'Plants', 'leaf'], ['biotope', 'Biotopes', 'home']];

function parse(arg) {
  if (!arg) return { tab: 'concept', id: null };
  const [tab, id] = arg.split(':');
  return { tab, id };
}

const animals = () => Object.entries(SPECIES).filter(([id]) => !['eggs'].includes(id));
const plants = () => Object.entries(PLANTS).filter(([, p]) => !p.hidden);

function known(kind, id) {
  return ctx.career ? ctx.career.knows(kind, id) : true;
}

export function Codex() {
  const start = parse(S.modalArg.value);
  const [tab, setTab] = useState(start.tab);
  const [id, setId] = useState(start.id);
  const [page, setPage] = useState(!!start.id);   // narrow screens: list ↔ page
  useEffect(() => { const p = parse(S.modalArg.value); setTab(p.tab); setId(p.id); setPage(!!p.id); }, [S.modalArg.value]);
  const pick = (t, i) => { setTab(t); setId(i); setPage(true); ctx.career?.discover?.(t, i); };
  const list = tab === 'concept' ? Object.values(CONCEPTS).map((c) => [c.id, c.title, c.icon])
    : tab === 'animal' ? animals().map(([i, s]) => [i, s.name, null])
      : tab === 'plant' ? plants().map(([i, p]) => [i, p.name, null])
        : BIOTOPE_ORDER.map((b) => [b, BIOTOPES[b].name, null]);
  const cur = id ?? list[0]?.[0];
  return (
    <Sheet title="Field guide" icon="book" tabs={TABS} tab={tab} setTab={(t) => { setTab(t); setId(null); setPage(false); }} wide>
      <div class={'codex' + (page ? ' on-page' : '')}>
        <div class="codex-list">
          {list.map(([i, name, ic]) => {
            const ok = tab === 'concept' || tab === 'biotope' || known(tab, i);
            return (
              <button key={i} class={'codex-item' + (cur === i ? ' on' : '') + (ok ? '' : ' lock')} onClick={() => pick(tab, i)}>
                {tab === 'animal' || tab === 'plant' ? <Portrait kind={tab} id={i} size={34} silhouette={!ok} /> : ic ? <Icon name={ic} size={17} /> : <Icon name="home" size={17} />}
                <span>{ok ? name : '???'}</span>
              </button>
            );
          })}
        </div>
        <div class="codex-page">
          <button class="btn sm ghost codex-back" onClick={() => setPage(false)}><Icon name="chevronL" size={14} /> Index</button>
          {tab === 'concept' ? <ConceptPage id={cur} pick={pick} />
            : tab === 'animal' ? <AnimalPage id={cur} pick={pick} />
              : tab === 'plant' ? <PlantPage id={cur} pick={pick} />
                : <BiotopePage id={cur} pick={pick} />}
        </div>
      </div>
    </Sheet>
  );
}

function Sections({ sections }) {
  return sections.map((s, i) => (
    <div key={i}>
      {s.h ? <h2>{s.h}</h2> : null}
      {s.p?.map((t, j) => <p key={j}>{t}</p>)}
      {s.ul ? <ul>{s.ul.map((t, j) => <li key={j}>{t}</li>)}</ul> : null}
      {s.fact ? <div class="fact"><b>Did you know</b>{s.fact}</div> : null}
      {s.tryit ? <div class="try"><b>Try it</b>{s.tryit}</div> : null}
    </div>
  ));
}

function ConceptPage({ id, pick }) {
  const c = CONCEPTS[id];
  if (!c) return null;
  const Wd = c.widget ? WIDGETS[c.widget] : null;
  return (
    <div class="paper">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><Icon name={c.icon ?? 'book'} size={30} style={{ color: '#3f8a5a' }} /><div><h1>{c.title}</h1><div class="latin">{c.blurb}</div></div></div>
      <div class="rule" />
      <Sections sections={c.sections} />
      {Wd ? <><div class="rule" /><h3>See it in your tank</h3><Wd /></> : null}
      {c.related?.length ? <><div class="rule" /><div class="chips">{c.related.map((r) => <button key={r} class="btn sm" style={{ color: '#2b2a1d', borderColor: '#a79d7a' }} onClick={() => pick('concept', r)}>{CONCEPTS[r]?.title}</button>)}</div></> : null}
    </div>
  );
}

function AnimalPage({ id, pick }) {
  const sp = SPECIES[id], info = ANIMAL_INFO[id];
  const live = S.live.value;
  if (!sp) return null;
  if (!known('animal', id)) return <div class="paper"><h1>Undiscovered</h1><p>Keep this species, or read about it in the shop, to learn its secrets.</p></div>;
  const e = live?.env ?? {};
  const aquatic = sp.kind === 'swim' || sp.kind === 'crawlWater';
  const n = live?.census.find((c) => c.id === id);
  return (
    <div class="paper">
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <Portrait kind="animal" id={id} size={132} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1>{sp.name}</h1>
          {info?.sci ? <div class="latin">{info.sci}{info.family ? ` · ${info.family}` : ''}</div> : null}
          <div class="chips" style={{ marginTop: 8 }}>
            <span class="tag moss">{sp.group}</span>
            {info?.status ? <span class={'tag ' + (/Critically|Endangered|Vulnerable/.test(info.status) ? 'coral' : /Near/.test(info.status) ? 'amber' : '')}>{info.status}</span> : null}
            {info?.region ? <span class="tag">{info.region}</span> : null}
          </div>
        </div>
      </div>
      <div class="rule" />
      <h3>What it needs</h3>
      <RangeBar label="Temperature" unit=" °C" lo={sp.temp[0]} hi={sp.temp[1]} now={e.temp} domain={[10, 34]} dec={1} />
      {sp.humidity && !aquatic ? <RangeBar label="Humidity" unit="%" lo={sp.humidity} hi={100} now={e.humidity} domain={[30, 100]} /> : null}
      <p style={{ fontSize: 12.5 }}><b>Eats:</b> {sp.eats.join(', ') || 'nothing'}. <b>Lives:</b> up to {Math.round(sp.lifeDays / 365 * 10) / 10} years. {sp.breed ? <b>Breeds on its own.</b> : null}</p>
      {n ? <p style={{ fontSize: 12.5 }}>In your tank now: <b>{n.n}</b>, average health <b>{Math.round(n.hp * 100)}%</b>.</p> : null}
      {info ? (
        <>
          <div class="rule" />
          {info.habitat ? <><h3>Home</h3><p>{info.habitat}</p></> : null}
          <h3>Natural history</h3>
          <ul>{info.facts.map((f, i) => <li key={i}>{f}</li>)}</ul>
          <h3>Keeping it</h3>
          <ul>{info.care.map((f, i) => <li key={i}>{f}</li>)}</ul>
          {info.lesson ? <button class="btn sm" style={{ color: '#2b2a1d', borderColor: '#a79d7a' }} onClick={() => pick('concept', info.lesson)}><Icon name="book" size={14} /> {CONCEPTS[info.lesson]?.title}</button> : null}
        </>
      ) : <p>{sp.note}</p>}
    </div>
  );
}

function PlantPage({ id, pick }) {
  const sp = PLANTS[id], info = PLANT_INFO[id];
  const e = S.live.value?.env ?? {};
  if (!sp) return null;
  if (!known('plant', id)) return <div class="paper"><h1>Undiscovered</h1><p>Plant it, or read about it in the shop, to learn its secrets.</p></div>;
  const land = !['aquatic', 'floating'].includes(sp.habitat.split('|')[0]);
  return (
    <div class="paper">
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <Portrait kind="plant" id={id} size={132} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1>{sp.name}</h1>
          {info?.sci ? <div class="latin">{info.sci}</div> : null}
          <div class="chips" style={{ marginTop: 8 }}>
            <span class="tag moss">{sp.habitat.split('|').join(' / ')}</span>
            {info?.role ? <span class="tag amber">{info.role}</span> : null}
            {info?.region ? <span class="tag">{info.region}</span> : null}
          </div>
        </div>
      </div>
      <div class="rule" />
      <h3>What it needs</h3>
      {land ? <RangeBar label="Humidity" unit="%" lo={sp.humidity?.[0] ?? 50} hi={100} now={e.humidity} domain={[30, 100]} /> : null}
      <p style={{ fontSize: 12.5 }}><b>Light:</b> {sp.light <= 0.25 ? 'shade' : sp.light <= 0.45 ? 'part shade' : sp.light <= 0.6 ? 'bright' : 'full light'}. {land ? 'Soil should be damp, not soaked.' : 'Takes nutrients from the water.'}</p>
      {info ? (
        <>
          <div class="rule" />
          <h3>Natural history</h3>
          <ul>{info.facts.map((f, i) => <li key={i}>{f}</li>)}</ul>
          <h3>Keeping it</h3>
          <ul>{info.care.map((f, i) => <li key={i}>{f}</li>)}</ul>
          {info.lesson ? <button class="btn sm" style={{ color: '#2b2a1d', borderColor: '#a79d7a' }} onClick={() => pick('concept', info.lesson)}><Icon name="book" size={14} /> {CONCEPTS[info.lesson]?.title}</button> : null}
        </>
      ) : <p>{sp.note}</p>}
    </div>
  );
}

function BiotopePage({ id, pick }) {
  const b = BIOTOPES[id];
  const e = S.live.value?.env ?? {};
  if (!b) return null;
  return (
    <div class="paper">
      <h1>{b.name}</h1>
      <div class="latin">{b.country}</div>
      <div class="rule" />
      <p>{b.blurb}</p>
      <h3>Climate</h3>
      <RangeBar label="Temperature" unit=" °C" lo={b.climate.temp[0]} hi={b.climate.temp[1]} now={e.temp} domain={[10, 34]} dec={1} />
      <RangeBar label="Humidity" unit="%" lo={b.climate.humidity[0]} hi={b.climate.humidity[1]} now={e.humidity} domain={[30, 100]} />
      <h3>Who lives there</h3>
      <div class="chips">
        {b.animals.map((a) => <button key={a} class="tag moss" style={{ border: 0, cursor: 'pointer' }} onClick={() => pick('animal', a)}>{SPECIES[a]?.name}</button>)}
        {b.plants.map((p) => <button key={p} class="tag" style={{ border: 0, cursor: 'pointer' }} onClick={() => pick('plant', p)}>{PLANTS[p]?.name}</button>)}
      </div>
      <div class="fact"><b>How to build it</b>{b.hint}</div>
      <ul>{b.facts.map((f, i) => <li key={i}>{f}</li>)}</ul>
      <p style={{ fontSize: 12.5 }}>The Curator scores your tank against a biotope: climate, species, plants and features. Pick one in the Studio.</p>
      <button class="btn sm primary" onClick={() => openModal('curator', id)}>Score my tank against this</button>
    </div>
  );
}
