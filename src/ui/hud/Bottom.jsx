import { useState } from 'preact/hooks';
import { Icon } from '../icons.jsx';
import { startTimelapse } from '../../app/timelapse.js';
import { S, openModal } from '../store.js';
import { ctx } from '../../app/ctx.js';
import { LENSES } from '../../tools/controller.js';
import { LENS_INFO } from '../../render/lens.js';

// Everything the wide screen's camera bar does, as a list for phones (where that bar is hidden).
export function ViewMenu({ onClose }) {
  const g = ctx.game;
  const lens = S.lens.value;
  const go = (fn) => () => { onClose(); fn(); };
  return (
    <div class="viewmenu glass strong">
      <div class="vm-views">
        {['front', 'top', 'left', 'right', 'close'].map((v) => <button key={v} onClick={go(() => g.rig.view(v))}>{v[0].toUpperCase() + v.slice(1)}</button>)}
      </div>
      <button onClick={() => { S.lens.value = LENSES[(LENSES.indexOf(lens) + 1) % LENSES.length]; }}><Icon name="lens" size={16} />Lens: {lens === 'off' ? 'off' : lens}</button>
      <button onClick={go(() => openModal('curator'))}><Icon name="trophy" size={16} />Score this tank</button>
      <button onClick={go(() => { S.photo.value = true; })}><Icon name="camera" size={16} />Photo mode</button>
      <div class="vm-lapse"><Icon name="clock" size={16} /><span>Time-lapse</span>{[7, 30, 90].map((d) => <button key={d} onClick={go(() => startTimelapse(d))}>{d}d</button>)}</div>
    </div>
  );
}

export function Bottom() {
  const g = ctx.game;
  const [lapseMenu, setLapseMenu] = useState(false);
  const lens = S.lens.value;
  const career = S.career.value;
  const active = career?.active?.[0];
  const li = LENS_INFO[lens];
  return (
    <>
    {li ? (
      <div class="legend glass">
        <b>{li.name}</b>
        <div class="ramp" style={{ background: `linear-gradient(90deg, ${li.stops.join(', ')})` }} />
        <span>{li.lo}{li.unit}</span><span style={{ marginLeft: 'auto' }}>{li.hi}{li.unit}</span>
        <small>{li.blurb}</small>
      </div>
    ) : null}
    <div class="bottom">
      <div class="hintbar glass">{S.hint.value}</div>
      {active && (
        <div class="objs glass" onClick={() => openModal('studio', 'commissions')} title="Open commissions">
          <h5><Icon name="clipboard" size={14} />{active.title}</h5>
          {active.goals.slice(0, 4).map((goal) => (
            <div key={goal.id} class={'goal' + (goal.done ? ' done' : '')}>
              <span class="box">{goal.done ? <Icon name="check" size={11} stroke={3} /> : null}</span>
              <span>{goal.text}</span>
              {goal.progressText && !goal.done ? <span class="pg">{goal.progressText}</span> : null}
            </div>
          ))}
        </div>
      )}
      <div class="camera glass">
        {['front', 'top', 'left', 'right', 'close'].map((v) => (
          <button key={v} onClick={() => g.rig.view(v)} title={`${v} view`}>{v[0].toUpperCase() + v.slice(1)}</button>
        ))}
        <button onClick={() => { S.lens.value = LENSES[(LENSES.indexOf(lens) + 1) % LENSES.length]; }} title="Lens overlay (L)" class={lens !== 'off' ? 'on' : ''} style={lens !== 'off' ? { color: 'var(--moss)' } : null}>
          <Icon name="lens" size={15} />{lens === 'off' ? 'Lens' : lens}
        </button>
        <button onClick={() => openModal('curator')} title="The Curator: score this tank"><Icon name="trophy" size={15} />Score</button>
        <span class="lapse-wrap">
          <button onClick={() => setLapseMenu(!lapseMenu)} title="Time-lapse: watch the tank change over days"><Icon name="clock" size={15} /></button>
          {lapseMenu ? (
            <div class="lapse-menu glass strong">
              {[7, 30, 90].map((d) => <button key={d} onClick={() => { setLapseMenu(false); startTimelapse(d); }}>{d} days</button>)}
            </div>
          ) : null}
        </span>
        <button onClick={() => { S.photo.value = true; }} title="Photo mode"><Icon name="camera" size={15} /></button>
      </div>
    </div>
    </>
  );
}
