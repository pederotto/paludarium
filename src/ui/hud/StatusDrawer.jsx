// The right-hand status drawer: what needs attention (with one-tap fixes), quick care, who lives here,
// and an "All readings" accordion with every number. Closed by default; the choice is remembered (wide screens).
import { effect } from '@preact/signals';
import { useState } from 'preact/hooks';
import './hud2.css';
import { Icon } from '../icons.jsx';
import { S, openModal, saveDrawerPref } from '../store.js';
import { assess } from './StatusChip.jsx';
import { Readings, Inhabitants, Journal, QuickCare, runCare } from './Vitals.jsx';

effect(() => { const v = S.right.value; if (!S.compact.peek()) saveDrawerPref(v); });

function Acc({ title, id, children }) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('paludarium.acc.' + id) === '1'; } catch { return false; } });
  const flip = () => { const v = !open; setOpen(v); try { localStorage.setItem('paludarium.acc.' + id, v ? '1' : '0'); } catch { /* private window */ } };
  return (
    <section class={'acc' + (open ? ' open' : '')}>
      <button class="acc-h" onClick={flip} aria-expanded={open} data-testid={'acc-' + id}><span>{title}</span><Icon name={open ? 'chevronD' : 'chevronR'} size={14} /></button>
      {open ? <div class="acc-b">{children}</div> : null}
    </section>
  );
}

export function StatusDrawer() {
  const live = S.live.value;
  if (!live || !S.right.value) return null;
  const a = assess(live);
  const top = a.concerns.slice(0, 3);
  return (
    <aside class="sdrawer glass" aria-label="Tank status" data-testid="status-drawer">
      <header class="sd-head">
        <div><b class={'sd-state ' + a.state}>{a.label}</b><small>{live.stage.name} · day {Math.floor(live.env.tankDays) + 1}</small></div>
        <button class="btn ghost icon sm" onClick={() => { S.right.value = false; }} title="Close (H)" aria-label="Close status"><Icon name="x" size={16} /></button>
      </header>
      <div class="sd-scroll">
        <section>
          <div class="h3">{top.length ? 'Right now' : 'All good'}</div>
          {top.length ? top.map((c) => (
            <div class={'concern ' + c.level} key={c.id}>
              <i class="cdot" />
              <button class="ctext" onClick={() => c.more && openModal(...c.more)} title={c.more ? 'Learn more' : undefined}>{c.text}</button>
              {c.fix ? <button class="btn sm fix" onClick={() => runCare(c.fix.fn)} data-testid="fix"><Icon name={c.fix.icon} size={13} />{c.fix.label}</button> : null}
            </div>
          )) : <p class="note" style={{ marginTop: 0 }}>{live.stage.tip}</p>}
        </section>
        <section>
          <div class="h3">Quick care</div>
          <QuickCare />
        </section>
        <section>
          <div class="h3">Inhabitants</div>
          <Inhabitants live={live} />
        </section>
        <Acc title="All readings" id="readings"><Readings live={live} /></Acc>
        <Acc title="Journal" id="journal"><Journal live={live} /></Acc>
      </div>
    </aside>
  );
}
