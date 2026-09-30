// Care and equipment: lights, climate, water, rain, feeding, foundation. Each
// control is only live if the gear is fitted; otherwise it says where to buy it.

import { useState } from 'preact/hooks';
import { S, toast, openModal } from '../store.js';
import { Sheet } from './Modals.jsx';
import { Icon } from '../icons.jsx';
import { ctx } from '../../app/ctx.js';
import { Care } from '../../app/actions.js';
import { GEAR } from '../../content/equipment.js';
import { TANK } from '../../sim/tank.js';

const TABS = [['lights', 'Lights', 'sun'], ['climate', 'Climate', 'thermo'], ['rain', 'Rain', 'rain'], ['water', 'Water', 'drop'], ['feeding', 'Feeding', 'bowl'], ['foundation', 'Foundation', 'layers']];
const hh = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:00`;

function refresh() { S.live.value = { ...S.live.value }; }

function Slider({ label, value, min, max, step, set, fmt, disabled }) {
  return (
    <label class="row" style={disabled ? { opacity: 0.4 } : null}>
      <span style={{ width: 130 }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onInput={(e) => { set(+e.currentTarget.value); refresh(); }} />
      <output style={{ width: 60 }}>{fmt ? fmt(value) : value}</output>
    </label>
  );
}
function Toggle({ label, on, set, disabled, title }) {
  return <button class={'chip' + (on ? ' on' : '')} disabled={disabled} title={title} onClick={() => { set(!on); refresh(); }}>{label}</button>;
}

// A control that needs gear: shows a lock note instead when it is not fitted.
function Gated({ gear, children }) {
  const W = ctx.game.world;
  if (W.equipment.has(gear)) return children;
  const g = GEAR[gear], info = ctx.career?.info('gear', gear);
  return (
    <div class="tile lock" style={{ margin: '8px 0' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Icon name="lock" size={15} /><b>{g.name}</b></div>
      <p>{g.blurb}</p>
      <div class="foot"><span class="price">{info?.locked ? `Rank ${info.level}` : `¤${g.price}`}</span><button class="btn sm" onClick={() => openModal('studio', 'shop')}>Open shop</button></div>
    </div>
  );
}

export function CarePanel() {
  const arg = S.modalArg.value;
  const [tab, setTab] = useState(TABS.some((t) => t[0] === arg) ? arg : 'lights');
  const W = ctx.game.world, E = W.env;
  const live = S.live.value; void live;
  const eq = W.equipment;
  return (
    <Sheet title="Care and equipment" icon="heart" tabs={TABS} tab={tab} setTab={setTab}>
      {tab === 'lights' ? (
        <>
          <div class="seg" style={{ marginBottom: 10 }}>{[['auto', 'Timer'], ['on', 'Always on'], ['off', 'Off']].map(([v, l]) => <button key={v} class={E.lights === v ? 'on' : ''} onClick={() => { E.lights = v; refresh(); }}>{l}</button>)}</div>
          <Slider label="Lamp on at" value={E.lightsOn / 60} min={0} max={23} step={1} set={(v) => { E.lightsOn = v * 60; }} fmt={(v) => hh(v * 60)} />
          <Slider label="Lamp off at" value={E.lightsOff / 60} min={1} max={24} step={1} set={(v) => { E.lightsOff = v * 60; }} fmt={(v) => hh(v * 60)} />
          <Slider label="Brightness" value={E.lampPower} min={0.2} max={eq.has('ledPro') ? 1.4 : 1} step={0.05} set={(v) => { E.lampPower = v; }} fmt={(v) => Math.round(v * 100) + '%'} />
          <p class="note">{E.photoperiod.toFixed(0)} hours of light a day. More brightness and longer days feed plants and algae alike. <a href="#" onClick={(e) => { e.preventDefault(); openModal('codex', 'concept:photoperiod'); }} style={{ color: 'var(--moss)' }}>Why?</a></p>
          <Gated gear="ledPro">
            <Slider label="Colour" value={E.lampWarmth} min={0} max={1} step={0.05} set={(v) => { E.lampWarmth = v; }} fmt={(v) => (v < 0.3 ? 'cool white' : v > 0.7 ? 'warm white' : 'neutral')} />
            <Toggle label="Moonlight at night" on={E.moonlight} set={(v) => { E.moonlight = v; }} />
          </Gated>
          <Gated gear="basking">
            <Slider label="Basking lamp" value={E.basking} min={0} max={1} step={0.05} set={(v) => { E.basking = v; W.climate.scanAcc = 1e9; }} fmt={(v) => (v ? Math.round(v * 100) + '%' : 'off')} />
            <p class="note">Place it with the Equipment tool, then look at the temperature lens (L).</p>
          </Gated>
        </>
      ) : tab === 'climate' ? (
        <>
          <Slider label="Heater keeps at least" value={E.setpoint} min={16} max={30} step={0.5} set={(v) => { E.setpoint = v; }} fmt={(v) => v.toFixed(1) + ' °C'} />
          <div class="chips">
            {!TANK.closed ? <Toggle label={E.lid ? 'Lid on' : 'Lid off'} on={E.lid} set={(v) => { E.lid = v; W.stage?.setLid(v); }} /> : <span class="tag">Sealed jar: no lid</span>}
            <button class="chip" onClick={() => { toast(Care.wipe(ctx.game)); refresh(); }}>Wipe glass</button>
          </div>
          <Gated gear="fan"><Slider label="Ventilation fan" value={E.fan} min={0} max={1} step={0.05} set={(v) => { E.fan = v; }} fmt={(v) => (v ? Math.round(v * 100) + '%' : 'off')} /></Gated>
          <Gated gear="fogger"><Slider label="Fogger" value={E.fogger} min={0} max={1} step={0.05} set={(v) => { E.fogger = v; W.climate.scanAcc = 1e9; }} fmt={(v) => (v ? Math.round(v * 100) + '%' : 'off')} /></Gated>
          <Gated gear="chiller">
            <div class="chips"><Toggle label={E.chill ? 'Cooling on' : 'Cooling off'} on={!!E.chill} set={(v) => { E.chill = v ? 1 : 0; }} /></div>
            <Slider label="Hold at" value={E.coolSet} min={12} max={26} step={0.5} set={(v) => { E.coolSet = v; }} fmt={(v) => v.toFixed(1) + ' °C'} />
          </Gated>
          <p class="note">Room {E.room.toFixed(0)} °C, {Math.round(E.roomHumidity)}% RH. A sealed tank in a cool room fogs its glass: <a href="#" onClick={(e) => { e.preventDefault(); openModal('codex', 'concept:dew-point'); }} style={{ color: 'var(--moss)' }}>dew point</a>.</p>
        </>
      ) : tab === 'rain' ? (
        <Gated gear="mister">
          <div class="chips"><button class="btn sm primary" onClick={() => { toast(Care.rain(ctx.game, 5)); refresh(); }}><Icon name="rain" size={14} /> Shower now</button></div>
          <div class="h3">Daily programme</div>
          {E.rainProgram.map((r, i) => (
            <div key={i} class="row">
              <span style={{ width: 90 }}>Shower {i + 1}</span>
              <select value={r.at / 60} onChange={(e) => { r.at = +e.currentTarget.value * 60; refresh(); }}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hh(h * 60)}</option>)}</select>
              <select value={r.len} onChange={(e) => { r.len = +e.currentTarget.value; refresh(); }}>{[2, 4, 8, 15, 30].map((m) => <option key={m} value={m}>{m} min</option>)}</select>
              <button class="btn sm ghost" onClick={() => { E.rainProgram.splice(i, 1); refresh(); }}>Remove</button>
            </div>
          ))}
          <button class="btn sm" onClick={() => { E.rainProgram.push({ at: 8 * 60 + E.rainProgram.length * 240, len: 4 }); ctx.career?.stat('rainPrograms'); refresh(); }}>Add a shower</button>
          <p class="note">Rainforest frogs breed when the rains come: a programme of several showers a day, with saturated air, imitates the wet season.</p>
        </Gated>
      ) : tab === 'water' ? (
        <>
          <div class="chips"><button class="btn sm" onClick={() => { toast(Care.waterChange(ctx.game)); refresh(); }}><Icon name="flask" size={14} /> Change 40% of the water</button><button class="btn sm" onClick={() => { toast(Care.scrubAlgae(ctx.game)); refresh(); }}>Scrub algae</button></div>
          <Toggle label="Filter running" on={E.filter} set={(v) => { E.filter = v; }} />
          <Slider label="Filter media" value={E.mediaBio} min={0.2} max={eq.has('filterCanister') ? 1 : 0.6} step={0.05} set={(v) => { E.mediaBio = v; }} fmt={(v) => Math.round(v * 100) + '%'} />
          <p class="note">A filter is mostly a home for nitrifying bacteria: more media, more capacity. A canister filter allows more.</p>
          <div class="chips"><button class="chip" onClick={() => { toast(Care.ammonia(ctx.game)); refresh(); }}>Dose ammonia (fishless cycle)</button><button class="chip" onClick={() => { toast(Care.fertilise(ctx.game)); refresh(); }}>Fertilise</button></div>
        </>
      ) : tab === 'feeding' ? (
        <>
          <div class="chips"><button class="btn sm" onClick={() => { toast(Care.feed(ctx.game)); refresh(); }}><Icon name="bowl" size={14} /> Feed fish</button><button class="btn sm" onClick={() => { toast(Care.flies(ctx.game)); refresh(); }}><Icon name="bug" size={14} /> Add fruit flies</button></div>
          <Gated gear="autofeeder"><Toggle label="Auto-feeder" on={E.autoFeed} set={(v) => { E.autoFeed = v; }} /></Gated>
          <Gated gear="flyCulture"><Toggle label="Fruit fly culture" on={E.culture} set={(v) => { E.culture = v; }} /></Gated>
          <p class="note">Feed little. Uneaten food rots into ammonia: the most common way to ruin a tank.</p>
        </>
      ) : (
        <>
          <p class="note" style={{ marginTop: 0 }}>The foundation decides where extra water goes. Right now: <b>{E.drainage === 0 ? 'flat glass (soil can waterlog)' : E.drainage < 1 ? 'drainage layer' : 'false bottom with a drain'}</b>.</p>
          <div class="cols">
            {[['none', 'Flat glass', 0, null], ['leca', 'Drainage layer', 0.6, 'drainageLeca'], ['fb', 'False bottom', 1, 'falseBottom']].map(([id, name, v, gear]) => {
              const owned = !gear || eq.has(gear);
              return (
                <div key={id} class={'tile' + (owned ? '' : ' lock')}>
                  <h4>{name}</h4><p>{gear ? GEAR[gear].teach : 'The simplest build: soil sits straight on the glass, and stays wet.'}</p>
                  <div class="foot"><span class="price">{owned ? '' : `¤${GEAR[gear].price}`}</span>
                    {owned ? <button class={'btn sm' + (Math.abs(E.drainage - v) < 0.01 ? ' primary' : '')} onClick={() => { E.drainage = v; refresh(); }}>{Math.abs(E.drainage - v) < 0.01 ? 'Selected' : 'Use'}</button> : <button class="btn sm" onClick={() => openModal('studio', 'shop')}>Shop</button>}</div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Sheet>
  );
}
