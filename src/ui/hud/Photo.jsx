// Photo mode: the interface steps aside, depth of field blurs what is not in
// focus, click anything to focus on it, and Snap saves a PNG.

import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../icons.jsx';
import { S, toast } from '../store.js';
import { ctx } from '../../app/ctx.js';
import { GRADE } from '../../engine/gfx.js';

export function Photo() {
  const g = ctx.game;
  const [blur, setBlur] = useState(2.2);
  const [expo, setExpo] = useState(1);
  const guides = S.guides.value;

  useEffect(() => {
    GRADE.focus.value = g.controls.distance;
    GRADE.focalLength.value = Math.max(12, g.controls.distance * 0.5);
    const el = g.renderer.domElement;
    const onDown = (e) => {
      if (e.button !== 0) return;
      const t = ctx.tools;
      t.setMouse(e);
      const hit = t.pick(['terrain', 'wall', 'water']);
      const a = g.world.animals.pick(t.ray.ray, 2.5);
      const p = a ? a.pos : hit?.point;
      if (p) { GRADE.focus.value = g.camera.position.distanceTo(p); GRADE.focalLength.value = Math.max(10, GRADE.focus.value * 0.35); }
    };
    el.addEventListener('pointerdown', onDown);
    return () => { el.removeEventListener('pointerdown', onDown); GRADE.exposure.value = 1; };
  }, []);
  useEffect(() => { GRADE.bokeh.value = blur; }, [blur]);
  useEffect(() => { GRADE.exposure.value = expo; }, [expo]);

  const snap = () => {
    g.gfx.render();
    g.renderer.domElement.toBlob((blob) => {
      if (!blob) { toast('The capture failed: try again.', 'bad'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `paludarium-day${g.world.env.day + 1}.png`;
      document.body.append(a); a.click(); a.remove();
      ctx.career?.stat('photos');
      toast('Saved a photograph.', 'good');
    }, 'image/png');
  };

  return (
    <>
      {guides ? (
        <div class="guides">
          {[33.33, 66.66].map((p) => <i key={'v' + p} style={{ left: p + '%', top: 0, bottom: 0, width: 1 }} />)}
          {[33.33, 66.66].map((p) => <i key={'h' + p} style={{ top: p + '%', left: 0, right: 0, height: 1 }} />)}
        </div>
      ) : null}
      <div class="photo glass strong">
        <div class="row"><span>Blur</span><input type="range" min="0" max="6" step="0.1" value={blur} onInput={(e) => setBlur(+e.currentTarget.value)} /></div>
        <div class="row"><span>Exposure</span><input type="range" min="0.6" max="1.6" step="0.02" value={expo} onInput={(e) => setExpo(+e.currentTarget.value)} /></div>
        <div class="acts">
          <button class={'btn sm' + (guides ? ' primary' : '')} onClick={() => { S.guides.value = !guides; }}><Icon name="grid" size={14} /> Thirds</button>
          <button class="btn primary" onClick={snap}><Icon name="camera" size={16} /> Snap</button>
          <button class="btn sm" onClick={() => { S.photo.value = false; }}><Icon name="x" size={14} /> Done</button>
        </div>
        <small>Click anything to focus on it. Drag to move the camera.</small>
      </div>
    </>
  );
}
