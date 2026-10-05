// The four dock hubs and the popover (bottom sheet on phones) each one opens.
import { useState } from 'preact/hooks';
import './hud2.css';
import { Icon } from '../icons.jsx';
import { S, openModal, hudRules } from '../store.js';
import { ctx } from '../../app/ctx.js';
import { startTimelapse } from '../../app/timelapse.js';
import { LENSES } from '../../editor/controller.js';
import { VIEW_LAYERS, LAYER_ORDER } from '../../render/layers.js';

export const HUBS = [
  { id: 'tank', label: 'Tank', icon: 'heart' },
  { id: 'build', label: 'Build', icon: 'layers' },
  { id: 'learn', label: 'Learn', icon: 'book' },
  { id: 'camera', label: 'Camera', icon: 'camera' },
];

export const closeHub = () => { S.hub.value = null; };
const go = (fn) => () => { closeHub(); fn(); };
const modal = (id, arg) => go(() => openModal(id, arg));

function Item({ hub, icon, label, desc, onClick, on, dot, pressed }) {
  return (
    <button class={'hi' + (on ? ' on' : '')} title={label} data-hub={hub} data-testid={'hub-item-' + label} onClick={onClick} aria-pressed={pressed}>
      <Icon name={icon} size={18} />
      <span class="hi-t"><b>{label}</b><small>{desc}</small></span>
      {dot ? <i class="dot" /> : null}
    </button>
  );
}

function TankItems({ hud }) {
  return (
    <>
      <Item hub="tank" icon="heart" label="Care" desc="Feed, mist, light, climate and gear" onClick={modal('care')} />
      {hud.flowPanel ? <Item hub="tank" icon="drop" label="Flow balance" desc="Pump, valves and pond levels" onClick={modal('flow')} /> : null}
      {hud.lab ? <Item hub="tank" icon="flask" label="Lab" desc="Charts, genetics, automation, vacation" onClick={modal('lab')} /> : null}
      <Item hub="tank" icon="trophy" label="Score" desc="The Curator rates this tank" onClick={modal('curator')} />
    </>
  );
}

function BuildItems() {
  const career = S.career.value;
  const sandbox = career?.mode === 'sandbox';
  const mirror = S.mirror.value;
  return (
    <>
      <Item hub="build" icon="briefcase" label="Studio" desc={sandbox ? 'Shop, kits and tanks' : 'Shop, market, commissions, career'} dot={career?.mode === 'career' && career?.attention} onClick={modal('studio', sandbox ? 'shop' : null)} />
      <Item hub="build" icon="layers" label="Kits" desc="Ready-made scenes to place" onClick={modal('studio', 'kits')} />
      <Item hub="build" icon="home" label="Tanks and sizes" desc="Switch tank or set a custom size" onClick={modal('studio', 'tanks')} />
      <Item hub="build" icon="swap" label="Mirror" desc={mirror ? 'On: building is copied across the middle' : 'Copy what you build across the middle (M)'} on={mirror} pressed={mirror} onClick={() => ctx.tools?.toggleMirror()} />
    </>
  );
}

function LearnItems() {
  const career = S.career.value;
  const isCareer = career?.mode === 'career';
  const tutorial = () => {
    const d = ctx.director, t = d?.tutorial;
    if (!t) return;
    if (t.finished) { t.step = 0; t.finished = false; }
    d.showCoach(t.current());
  };
  return (
    <>
      <Item hub="learn" icon="book" label="Field guide" desc="Animals, plants and biotopes" onClick={modal('codex')} />
      <Item hub="learn" icon="info" label="Concepts" desc="How a living tank works" onClick={modal('codex', 'concept')} />
      {isCareer ? <Item hub="learn" icon="clipboard" label="Commissions" desc="Jobs from clients, with goals" onClick={modal('studio', 'commissions')} /> : null}
      {isCareer ? <Item hub="learn" icon="wand" label="Tutorial" desc="Mira's guided first steps" onClick={go(tutorial)} /> : null}
      <Item hub="learn" icon="sparkles" label="Show tip" desc="Show the hint for the current tool again" onClick={go(() => { S.hintPulse.value++; })} />
    </>
  );
}

function CameraItems() {
  const g = ctx.game;
  const lens = S.lens.value;
  const [, bump] = useState(0);
  const pl = g.world?.plumbing;
  const showEq = pl ? pl.show !== false : true;
  return (
    <>
      <div class="hm-views" role="group" aria-label="Camera views">
        {[['tank', 'Tank', 'The whole tank'], ['bottom', 'Bottom', 'Substrate and water, level with the glass'], ['back', 'Back', 'The background and what grows on it'], ['top', 'Top', 'Looking down into the tank']].map(([v, l, t]) => <button key={v} class={'chip' + (g.rig.zone === v ? ' on' : '')} title={t} data-hub="camera" onClick={go(() => { ctx.tools?.follow?.(null); g.rig.setZone(v); })}>{l}</button>)}
      </div>
      <div class="hm-row"><Icon name="layers" size={16} /><b>Layers</b><small>See through to the build (V)</small></div>
      <div class="hm-chips" role="group" aria-label="View layer">
        {LAYER_ORDER.map((l) => <button key={l} class={'chip' + (S.layer.value === l ? ' on' : '')} title={VIEW_LAYERS[l].blurb} data-hub="camera" onClick={() => { S.layer.value = l; }}>{VIEW_LAYERS[l].name}</button>)}
      </div>
      <div class="hm-row"><Icon name="lens" size={16} /><b>Lens</b><small>See humidity, light, flow and more</small></div>
      <div class="hm-chips" role="group" aria-label="Lens">
        {LENSES.map((l) => <button key={l} class={'chip' + (lens === l ? ' on' : '')} title={l === 'off' ? 'Lens off' : `${l} lens`} data-hub="camera" onClick={() => { S.lens.value = l; }}>{l === 'off' ? 'Off' : l[0].toUpperCase() + l.slice(1)}</button>)}
      </div>
      <Item hub="camera" icon="camera" label="Photo mode" desc="Frame, grade and save a picture" onClick={go(() => { S.photo.value = true; })} />
      <div class="hm-row"><Icon name="clock" size={16} /><b>Time-lapse</b><small>Watch days pass</small></div>
      <div class="hm-chips" role="group" aria-label="Time-lapse">
        {[7, 30, 90].map((d) => <button key={d} class="chip" title={`Time-lapse ${d} days`} data-hub="camera" onClick={go(() => startTimelapse(d))}>{d} days</button>)}
      </div>
      {pl ? <Item hub="camera" icon="cog" label="Show equipment" desc="Draw the pump, filter and overflow in the tank (the hoses stay hidden)" on={showEq} pressed={showEq} onClick={() => { pl.show = !showEq; bump((n) => n + 1); }} /> : null}
    </>
  );
}

export function HubMenu({ hub, x }) {
  const hud = hudRules();
  const title = HUBS.find((h) => h.id === hub)?.label;
  return (
    <div class={'hubmenu glass strong hub-' + hub} role="menu" aria-label={title} style={x != null ? { '--ax': x + 'px' } : null} data-testid={'hubmenu-' + hub}>
      <div class="hm-grab" aria-hidden="true" />
      {hub === 'tank' ? <TankItems hud={hud} /> : hub === 'build' ? <BuildItems /> : hub === 'learn' ? <LearnItems /> : <CameraItems />}
    </div>
  );
}
