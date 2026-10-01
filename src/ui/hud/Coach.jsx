// Mira's card: tutorial steps, and the lesson that comes with an event.

import { Icon } from '../icons.jsx';
import { S, openModal } from '../store.js';
import { ctx } from '../../app/ctx.js';

export function Coach() {
  const c = S.coach.value;
  if (!c) return null;
  const skip = () => { if (c.tutorial) { ctx.director.tutorial.skip(); } S.coach.value = null; };
  return (
    <div class="coach glass strong" role="status">
      <div class="avatar">{c.event ? '!' : 'M'}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h6>{c.title}{c.total ? <span style={{ color: 'var(--faint)', fontWeight: 500, marginLeft: 8, fontSize: 11 }}>{c.step}/{c.total}</span> : null}</h6>
        {c.text.split('\n\n').map((t, i) => <p key={i}>{t}</p>)}
        {c.hint ? <p style={{ color: 'var(--moss)' }}>{c.hint}</p> : null}
        <div class="acts">
          {c.concept ? <button class="btn sm" onClick={() => openModal('codex', 'concept:' + c.concept)}><Icon name="book" size={13} /> Read more</button> : null}
          <button class="btn sm ghost" onClick={skip}>{c.tutorial ? 'Skip tutorial' : 'Dismiss'}</button>
        </div>
      </div>
    </div>
  );
}
