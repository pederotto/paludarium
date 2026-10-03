// The bottom of the screen: the dock, and above it a small stack of quiet chips (hint toast, lens legend,
// active commission). The old camera bar, hint bar and commission box live in the dock hubs and these chips now.
import './hud2.css';
import { Icon } from '../icons.jsx';
import { S, openModal } from '../store.js';
import { Dock } from './Dock.jsx';
import { HintToast } from './Toasts.jsx';
import { lensLegend, qualityMetric, QUALITY_METRICS } from '../../render/lens.js';
import { VIEW_LAYERS } from '../../render/layers.js';

// Which view layer is on, when it is not the plain Surface view, with a way back.
function LayerChip() {
  const l = S.layer.value;
  if (l === 'surface' || S.kids.value) return null;
  const v = VIEW_LAYERS[l];
  return (
    <div class="legend2 glass" title={v.blurb} data-testid="layer-chip">
      <div class="lg-row">
        <Icon name="layers" size={14} /><b>{v.name}</b>
        <button class="chip" onClick={() => { S.layer.value = 'surface'; }} title="Back to the Surface view (V cycles)" aria-label="Surface view"><Icon name="x" size={11} /></button>
      </div>
      <small class="lg-blurb">{v.blurb}</small>
    </div>
  );
}

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
        <LayerChip />
        <LensLegend />
        <CommissionChip />
      </div>
      <Dock />
    </>
  );
}
