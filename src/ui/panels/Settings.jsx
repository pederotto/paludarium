import { useState } from 'preact/hooks';
import { S, closeModal } from '../store.js';
import { Sheet } from './Modals.jsx';
import { ctx } from '../../app/ctx.js';
import { QUALITY } from '../../engine/gfx.js';
import { DISPLAY, toggleFullscreen, toggleZen, fullscreenSupported, isStandalone } from '../fullscreen.js';
import { MODES } from '../../app/modes.js';
import { setMode } from '../../app/modes-runtime.js';
import { saveSmart } from '../store.js';
import '../explorer.css';

// How this tank is played. Switch at any time; the choice is saved with the game.
function ModePicker() {
  const cur = S.kids.value ? 'kids' : S.mode.value;
  const smart = S.smart.value;
  return (
    <>
      <div class="h3">How you play this tank</div>
      <div class="modelist">
        {['kids', 'explorer', 'naturalist'].map((id) => (
          <button key={id} class={cur === id ? 'on' : ''} disabled={id === 'kids'} title={id === 'kids' ? 'Open the Kids corner from the title screen' : ''} onClick={() => setMode(id)}>
            <b>{MODES[id].name}{id === 'kids' ? ' (from the title screen)' : ''}</b><span>{MODES[id].blurb}</span>
          </button>
        ))}
      </div>
      {cur === 'naturalist' ? <div class="row" style={{ gap: 8 }}><button class={'chip' + (smart ? ' on' : '')} onClick={() => { S.smart.value = !smart; saveSmart(!smart); ctx.tools?.setButtons?.(); }}>Smart place {smart ? 'on' : 'off'}</button><span class="note" style={{ margin: 0 }}>One tap places, orients and spaces things for you.</span></div> : null}
    </>
  );
}

function Sound() {
  const a = ctx.audio;
  const [, bump] = useState(0);
  if (!a) return null;
  return (
    <div class="row" style={{ gap: 10 }}>
      <button class={'chip' + (a.on ? ' on' : '')} onClick={() => { a.setOn(!a.on); bump((n) => n + 1); }}>{a.on ? 'On' : 'Off'}</button>
      <input type="range" min="0" max="1" step="0.05" value={a.volume} disabled={!a.on} onInput={(e) => { a.setVolume(+e.currentTarget.value); bump((n) => n + 1); }} />
    </div>
  );
}

// Simulation realism: erosion on or off and its strength (the water carries soil, banks slump).
function Realism() {
  const w = ctx.game?.world?.water;
  const [v, setV] = useState(w?.erosion?.strength ?? 1);
  if (!w?.erosion) return null;
  if (S.mode.value === 'explorer' && !S.kids.value) return <><div class="h3" style={{ marginTop: 14 }}>Simulation realism</div><p class="note">Explorer keeps erosion at half strength, slumping gentle, and looks after the pump and water level. Switch to Naturalist for every setting.</p></>;
  const set = (x) => { w.setErosion(x); setV(x); };
  return (
    <>
      <div class="h3" style={{ marginTop: 14 }}>Simulation realism</div>
      <div class="row" style={{ gap: 8 }}>
        <button class={'chip' + (v > 0 ? ' on' : '')} onClick={() => set(v > 0 ? 0 : 1)}>Erosion {v > 0 ? 'on' : 'off'}</button>
        <div class="seg">
          {[0.5, 1, 2].map((x) => <button key={x} class={v === x ? 'on' : ''} onClick={() => set(x)}>{x}×</button>)}
        </div>
      </div>
      <p class="note">Moving water carries soil and sand off the ground and drops it where it slows, so streams cut, ponds silt up and deltas grow, and steep unsupported banks slump. Rocks set into the ground, plant roots and stone hold the soil. Strength sets how fast it happens.</p>
    </>
  );
}

export function Settings() {
  const g = ctx.game;
  const q = S.quality.value;
  return (
    <Sheet title="Settings" icon="settings">
      <div class="two">
        <div>
          <ModePicker />
          <div class="h3" style={{ marginTop: 14 }}>Graphics quality</div>
          <div class="seg">
            {Object.entries(QUALITY).map(([id, v]) => (
              <button key={id} class={q === id ? 'on' : ''} onClick={() => { g.gfx.setQuality(id, g.scene, g.camera); S.quality.value = id; ctx.saveSettings?.(); }}>{v.label}</button>
            ))}
          </div>
          <p class="note">Ultra renders at up to 2× pixel density with full ambient occlusion and SMAA. The game lowers its resolution by itself if the frame rate drops. Balanced uses 4× MSAA without ambient occlusion; Low is for old machines and phones.</p>
          <div class="h3" style={{ marginTop: 14 }}>Display</div>
          <div class="row" style={{ gap: 8 }}>
            <button class={'chip' + (DISPLAY.value.fs ? ' on' : '')} onClick={() => { closeModal(); toggleFullscreen(); }}>{DISPLAY.value.fs && !isStandalone() ? 'Leave full screen' : 'Full screen'}</button>
            <button class="chip" onClick={() => { closeModal(); toggleZen(); }}>Zen (hide interface)</button>
          </div>
          <p class="note">Shift+F toggles full screen, Shift+Z toggles Zen and Esc brings the interface back.{fullscreenSupported() ? '' : ' This browser cannot go full screen: on an iPhone or iPad use Share, then Add to Home Screen, and open the game from there.'}</p>
          <div class="h3" style={{ marginTop: 14 }}>Sound</div>
          <Sound />
          <Realism />
          <div class="kv" style={{ marginTop: 12 }}>
            <dt>Renderer</dt><dd>{S.backend.value}</dd>
            <dt>Frame rate</dt><dd>{S.fps.value} fps ({g.gfx.stats.frameMs} ms)</dd>
            <dt>Pixel ratio</dt><dd>{g.renderer.getPixelRatio().toFixed(2)}</dd>
          </div>
        </div>
        <div>
          <div class="h3">Interface</div>
          <p class="note" style={{ marginTop: 0 }}>Keys: 1–0 pick tools · Space pauses · F frames the selection · L cycles the lens overlay · H hides panels · Ctrl+Z undoes · WASD/QE/ZX move the camera.</p>
          <button class="btn" onClick={closeModal}>Close</button>
        </div>
      </div>
    </Sheet>
  );
}
