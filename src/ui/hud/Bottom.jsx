import { Icon } from '../icons.jsx';
import { S, openModal } from '../store.js';
import { ctx } from '../../app/ctx.js';
import { LENSES } from '../../tools/controller.js';
import { LENS_INFO } from '../../render/lens.js';

export function Bottom() {
  const g = ctx.game;
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
        <button onClick={() => openModal('photo')} title="Photo mode"><Icon name="camera" size={15} /></button>
      </div>
    </div>
    </>
  );
}
