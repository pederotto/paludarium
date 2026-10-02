// The Curator's report: a grade, four scores, and notes that teach.

import { useState } from 'preact/hooks';
import { S, openModal } from '../store.js';
import { Sheet } from './Sheet.jsx';
import { Icon } from '../icons.jsx';
import { ctx } from '../../app/ctx.js';
import { score } from '../../game/curator.js';
import { BIOTOPES, BIOTOPE_ORDER } from '../../content/biotopes.js';

const NAMES = { ecology: 'Ecology', design: 'Design', biotope: 'Biotope fidelity', care: 'Care' };
const tone = (s) => (s >= 80 ? 'var(--moss)' : s >= 60 ? 'var(--amber)' : 'var(--coral)');

export function CuratorPanel() {
  const D = ctx.director;
  const arg = S.modalArg.value;
  const [bio, setBio] = useState(BIOTOPES[arg] ? arg : D.biotope);
  const r = score(ctx.game.world, { biotope: bio });
  D.biotope = bio;
  const parts = Object.entries(r.parts);
  return (
    <Sheet title="The Curator" icon="trophy" wide>
      <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ textAlign: 'center' }}><div class="serif" style={{ fontSize: 84, lineHeight: 1, color: tone(r.overall) }}>{r.grade}</div><div class="num" style={{ color: 'var(--dim)' }}>{r.overall} / 100</div></div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div class="h3">Aim for a real habitat (optional)</div>
          <select value={bio ?? ''} onChange={(e) => setBio(e.currentTarget.value || null)}>
            <option value="">No target: score the tank on its own merits</option>
            {BIOTOPE_ORDER.map((b) => <option key={b} value={b}>{BIOTOPES[b].name}</option>)}
          </select>
          <p class="note">The Curator weighs how well the tank lives, how it is composed, how faithfully it copies its habitat and how it has been cared for. Each note says why it matters.</p>
        </div>
      </div>
      <div class="cols" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
        {parts.map(([k, p]) => (
          <div key={k} class="tile">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><h4>{NAMES[k]}{p.biotope ? `: ${p.biotope}` : ''}</h4><b class="num" style={{ color: tone(p.score) }}>{p.score}</b></div>
            <div class="bar"><i style={{ width: p.score + '%', background: tone(p.score) }} /></div>
            {p.notes.map((n, i) => (
              <div key={i} class={'goal' + (n.ok ? ' done' : '')} style={{ alignItems: 'flex-start', color: n.ok ? 'var(--text)' : 'var(--dim)' }}>
                <span class="box" style={{ marginTop: 2 }}>{n.ok ? <Icon name="check" size={11} stroke={3} /> : null}</span>
                <span>{n.text}{n.concept ? <> <a href="#" onClick={(e) => { e.preventDefault(); openModal('codex', 'concept:' + n.concept); }} style={{ color: 'var(--moss)' }}>Why?</a></> : null}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Sheet>
  );
}
