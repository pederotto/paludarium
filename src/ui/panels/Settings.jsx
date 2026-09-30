import { useState } from 'preact/hooks';
import { S, closeModal } from '../store.js';
import { Sheet } from './Modals.jsx';
import { ctx } from '../../app/ctx.js';
import { QUALITY } from '../../engine/gfx.js';

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

export function Settings() {
  const g = ctx.game;
  const q = S.quality.value;
  return (
    <Sheet title="Settings" icon="settings">
      <div class="two">
        <div>
          <div class="h3">Graphics quality</div>
          <div class="seg">
            {Object.entries(QUALITY).map(([id, v]) => (
              <button key={id} class={q === id ? 'on' : ''} onClick={() => { g.gfx.setQuality(id, g.scene, g.camera); S.quality.value = id; ctx.saveSettings?.(); }}>{v.label}</button>
            ))}
          </div>
          <p class="note">Ultra renders at up to 2× pixel density with full ambient occlusion and SMAA. The game lowers its resolution by itself if the frame rate drops. Balanced uses 4× MSAA without ambient occlusion; Low is for old machines and phones.</p>
          <div class="h3" style={{ marginTop: 14 }}>Sound</div>
          <Sound />
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
