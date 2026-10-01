// Bottom centre: one dock of four hubs (Tank, Build, Learn, Camera). Each opens a popover above it
// (a bottom sheet on phones). Only one menu is ever open, and opening one closes the status drawer on phones.
import { useRef, useState } from 'preact/hooks';
import { effect } from '@preact/signals';
import './hud2.css';
import { Icon } from '../icons.jsx';
import { S } from '../store.js';
import { HUBS, HubMenu, closeHub } from './HubMenu.jsx';

// A modal opening, or leaving play, closes any open menu.
effect(() => { if (S.modal.value || S.screen.value !== 'play' || S.photo.value) S.hub.value = null; });

export function Dock() {
  const hub = S.hub.value;
  const career = S.career.value;
  const [x, setX] = useState(null);
  const wrap = useRef(null);
  const toggle = (id) => (e) => {
    if (S.hub.value === id) { closeHub(); return; }
    const b = e.currentTarget, w = wrap.current;
    if (b && w) {
      const bw = b.getBoundingClientRect(), ww = w.getBoundingClientRect();
      setX(bw.left - ww.left + bw.width / 2);
    }
    if (S.compact.value) S.right.value = false;
    S.hub.value = id;
  };
  return (
    <>
      {hub ? <div class="hub-away" onClick={closeHub} /> : null}
      <div class="dockwrap" ref={wrap}>
        {HUBS.some((h) => h.id === hub) ? <HubMenu hub={hub} x={x} /> : null}
        <nav class="dock2 glass" aria-label="Menu">
          {HUBS.map((h) => (
            <button key={h.id} class={hub === h.id ? 'on' : ''} data-hub={h.id} data-testid={'hub-' + h.id} title={h.label} aria-haspopup="menu" aria-expanded={hub === h.id} onClick={toggle(h.id)}>
              <Icon name={h.icon} size={19} /><span>{h.label}</span>
              {h.id === 'build' && career?.mode === 'career' && career?.attention ? <i class="dot" /> : null}
            </button>
          ))}
        </nav>
      </div>
    </>
  );
}
