// Top left: one pill with the tank name, the day and time, and the speed control folded into it.
// Tap it to open 1x / 5x / 20x / 60x / pause inline; it folds away again after a few seconds (Space still pauses).
import { useState, useEffect, useRef } from 'preact/hooks';
import './hud2.css';
import { Icon } from '../icons.jsx';
import { StatusChip } from './StatusChip.jsx';
import { S, openModal, toast } from '../store.js';
import { DISPLAY, toggleFullscreen, toggleZen } from '../fullscreen.js';
import { ctx } from '../../app/ctx.js';
import { SPEEDS } from '../../sim/tank.js';

const SPEED_LABEL = ['', '1×', '5×', '20×', '60×'];

const closeMenu = () => { if (S.hub.value === 'menu') S.hub.value = null; };

// The pill's Menu: leave to the title screen (saving first), save, settings, display.
function MenuPop() {
  const run = (fn) => async () => { closeMenu(); await fn(); };
  const busy = async (text, fn) => {
    S.busy.value = { text };
    await new Promise((r) => setTimeout(r, 30));
    try { await fn(); await ctx.game?.settle(); } catch (e) { console.error(e); toast('That did not work: ' + (e?.message ?? e), 'bad'); } finally { S.busy.value = null; }
  };
  const item = (icon, label, desc, onClick, on) => (
    <button class={'hi' + (on ? ' on' : '')} role="menuitem" title={label} data-testid={'menu-' + label} onClick={onClick}>
      <Icon name={icon} size={18} /><span class="hi-t"><b>{label}</b><small>{desc}</small></span>
    </button>
  );
  return (
    <div class="menupop glass strong" role="menu" aria-label="Menu" data-testid="menupop">
      {item('home', 'Home', 'Save and go back to the title screen', run(() => busy('Saving…', () => ctx.director.goHome())))}
      {item('check', 'Save now', 'Keep this game safe in your browser', run(async () => { await ctx.director.save(); toast('Game saved.', 'good'); }))}
      {item('settings', 'Settings', 'Graphics, sound and realism', run(() => openModal('settings')))}
      {item('eye', 'Full screen', 'Give the tank the whole screen', run(toggleFullscreen), DISPLAY.value.fs)}
      {item('sparkles', 'Zen mode', 'Hide the interface (Esc to return)', run(toggleZen))}
    </div>
  );
}

export function TopBar() {
  const live = S.live.value;
  const [open, setOpen] = useState(false);
  const timer = useRef(0);
  const touch = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 3500); };
  useEffect(() => { if (open) touch(); return () => clearTimeout(timer.current); }, [open]);
  // Esc opens the menu when nothing else wants it: no modal, selection, tool, hub or zen. State is read in the
  // capture phase, before the other Escape handlers (close a modal, put a tool away, leave zen) have run.
  useEffect(() => {
    let free = false;
    const pre = (e) => {
      free = e.key === 'Escape' && !S.modal.value && !S.selection.value && S.tool.value === 'view' && !S.sub.value.kit && !S.piece.value
        && !S.hub.value && !S.coach.value?.event && !document.body.classList.contains('zen') && !S.photo.value && !S.timelapse.value;
      if (e.key === 'Escape' && S.hub.value) { S.hub.value = null; }
    };
    const post = (e) => { if (e.key === 'Escape' && free) { free = false; S.right.value = false; S.hub.value = 'menu'; } };
    addEventListener('keydown', pre, true);
    addEventListener('keydown', post);
    return () => { removeEventListener('keydown', pre, true); removeEventListener('keydown', post); };
  }, []);
  if (!live) return null;
  const g = ctx.game;
  const menu = S.hub.value === 'menu';
  const light = live.clock.light;
  const sp = S.speed.value;
  const set = (i) => { g.setSpeed(i); S.speed.value = i; touch(); };
  return (
    <div class={'topbar' + (menu ? ' menuopen' : '') + (S.career.value?.mode === 'career' ? ' career' : '')}>
      <div class="pillwrap">
      <div class={'pill glass' + (open ? ' open' : '')} data-testid="top-pill">
        <button class="pill-menu" onClick={() => { S.right.value = false; S.hub.value = menu ? null : 'menu'; }} aria-expanded={menu} aria-haspopup="menu" title="Menu: home, save, settings" data-testid="menu-button">
          <Icon name="menu" size={16} /><span class="pm-label">Menu</span>
        </button>
        <i class="vsep" />
        <button class="pill-main" onClick={() => setOpen(!open)} aria-expanded={open} title="Day, time and speed: tap to change speed (Space pauses)">
          <Icon name={light > 0.3 ? 'sun' : 'moon'} size={16} style={{ color: light > 0.3 ? 'var(--amber)' : 'var(--violet)' }} />
          <span class="pill-name">{S.tankTitle.value ?? live.tank.name}</span>
          <span class="pill-time num"><b>Day {live.clock.day}</b><span class="pt-clock"> {live.clock.time}</span></span>
          <span class={'pill-speed' + (sp === 0 ? ' paused' : '')}>{sp === 0 ? <Icon name="pause" size={13} /> : SPEED_LABEL[sp]}</span>
        </button>
        {open ? (
          <div class="seg" role="group" aria-label="Simulation speed">
            {SPEEDS.map((s, i) => (
              <button key={i} class={sp === i ? 'on' : ''} title={i === 0 ? 'Pause (Space)' : `${s}× speed`} aria-label={i === 0 ? 'Pause' : `${s}× speed`} onClick={() => set(i)}>
                {i === 0 ? <Icon name="pause" size={13} /> : SPEED_LABEL[i]}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {menu ? <MenuPop /> : null}
      </div>
      <StatusChip />
    </div>
  );
}
