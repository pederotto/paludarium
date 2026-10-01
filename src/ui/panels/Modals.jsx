import { S, closeModal } from '../store.js';
import { Icon } from '../icons.jsx';
import { Settings } from './Settings.jsx';
import { Codex } from './Codex.jsx';
import { Studio } from './Studio.jsx';
import { CarePanel } from './Care.jsx';
import { LabPanel } from './Lab.jsx';
import { CuratorPanel } from './Curator.jsx';
import { FlowPanel } from './Flow.jsx';

export function Sheet({ title, icon, tabs, tab, setTab, children, wide, onClose = closeModal }) {
  return (
    <div class="scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="sheet glass strong" style={wide ? { width: 'min(1240px, 100%)' } : null}>
        <div class="sheet-head">
          {icon ? <Icon name={icon} size={22} style={{ color: 'var(--moss)' }} /> : null}
          <h2>{title}</h2>
          <button class="btn ghost icon" onClick={onClose} title="Close (Esc)"><Icon name="x" size={18} /></button>
        </div>
        {tabs ? (
          <div class="sheet-tabs">
            {tabs.map(([id, label, ic]) => <button key={id} class={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{ic ? <Icon name={ic} size={15} /> : null}{label}</button>)}
          </div>
        ) : null}
        <div class="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function Modals() {
  const m = S.modal.value;
  if (!m) return null;
  if (m === 'settings') return <Settings />;
  if (m === 'codex') return <Codex />;
  if (m === 'studio') return <Studio />;
  if (m === 'care') return <CarePanel />;
  if (m === 'lab') return <LabPanel />;
  if (m === 'curator') return <CuratorPanel />;
  if (m === 'flow') return <FlowPanel />;
  return null;
}
