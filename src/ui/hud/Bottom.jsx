// The bottom of the screen: the dock, and above it a small stack of quiet chips (hint toast, lens legend,
// active commission). The old camera bar, hint bar and commission box live in the dock hubs and these chips now.
import './hud2.css';
import { Icon } from '../icons.jsx';
import { S, openModal } from '../store.js';
import { Dock } from './Dock.jsx';
import { HintToast } from './Toasts.jsx';
import { lensLegend, qualityMetric, QUALITY_METRICS } from '../../render/lens.js';

function LensLegend() {
  const lens = S.lens.value;
  const li = lensLegend(lens, qualityMetric.value);
  if (!li) return null;
  return (
    <div class="legend2 glass" title={li.blurb}>
      <div class="lg-row">
        <b>{li.name}</b>
        <span class="lg-lo num">{li.lo}{li.unit}</span>
        <div class="ramp" style={{ background: `linear-gradient(90deg, ${li.stops.join(', ')})` }} />
        <span class="lg-hi num">{li.hi}{li.unit}</span>
        <button class="chip" onClick={() => { S.lens.value = 'off'; }} title="Turn the lens off" aria-label="Lens off"><Icon name="x" size={11} /></button>
      </div>
      {lens === 'quality' ? (
        <div class="lg-metrics">
          {Object.entries(QUALITY_METRICS).map(([k, m]) => (
            <button key={k} class={'chip' + (qualityMetric.value === k ? ' on' : '')} onClick={() => { qualityMetric.value = k; }}>{m.label}</button>
          ))}
        </div>
      ) : null}
      <small class="lg-blurb">{li.blurb}</small>
    </div>
  );
}

function CommissionChip() {
  const active = S.career.value?.active?.[0];
  if (!active) return null;
  const done = active.goals.filter((g) => g.done).length;
  return (
    <button class="cchip glass" onClick={() => openModal('studio', 'commissions')} title={`${active.title}: open commissions`} data-testid="commission-chip">
      <Icon name="clipboard" size={14} />
      <span>Commission: <b class="num">{done}/{active.goals.length}</b> goals</span>
      <Icon name="chevronR" size={12} />
    </button>
  );
}

export function Bottom() {
  return (
    <>
      <div class="hud-stack">
        <HintToast />
        <LensLegend />
        <CommissionChip />
      </div>
      <Dock />
    </>
  );
}
