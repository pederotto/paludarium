import { S } from '../store.js';
import { Settings } from './Settings.jsx';
import { Codex } from './Codex.jsx';
import { Studio } from './Studio.jsx';
import { CarePanel } from './Care.jsx';
import { LabPanel } from './Lab.jsx';
import { CuratorPanel } from './Curator.jsx';
import { FlowPanel } from './Flow.jsx';

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
