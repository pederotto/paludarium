import { useState } from 'preact/hooks';
import { Icon } from '../icons.jsx';
import { ViewMenu } from './Bottom.jsx';
import { S, openModal, hudRules } from '../store.js';
import { ctx } from '../../app/ctx.js';
import { SPEEDS } from '../../sim/tank.js';
import { DISPLAY, toggleFullscreen, toggleZen, fullscreenSupported } from '../fullscreen.js';

const SPEED_LABEL = ['', '1×', '5×', '20×', '60×'];

export function TopBar() {
  const live = S.live.value;
  const career = S.career.value;
  const g = ctx.game;
  if (!live) return null;
  const light = live.clock.light;
  return (
    <div class="top">
      <div class="brand glass" onClick={() => openModal('studio')} title="Studio">
        <div class="mark"><Icon name="drop" size={18} stroke={2} /></div>
        <div>
          <b>Paludarium</b>
          <small>{S.tankTitle.value ?? live.tank.name} · {live.tank.litres} L</small>
        </div>
      </div>
      <div class="clock glass">
        <Icon name={light > 0.3 ? 'sun' : 'moon'} size={16} style={{ color: light > 0.3 ? 'var(--amber)' : 'var(--violet)' }} />
        <span class="day">Day {live.clock.day}</span>
        <span class="sub">{live.clock.time}</span>
      </div>
      <div class="speed glass" role="group" aria-label="Simulation speed">
        {SPEEDS.map((s, i) => (
          <button key={i} class={S.speed.value === i ? 'on' : ''} title={i === 0 ? 'Pause (Space)' : `${s}× speed`} onClick={() => { g.setSpeed(i); S.speed.value = i; }}>
            {i === 0 ? <Icon name="pause" size={14} /> : SPEED_LABEL[i]}
          </button>
        ))}
      </div>
      <button class="vchip glass" onClick={() => { S.right.value = !S.right.value; }} title="Tank vitals">
        <Icon name="thermo" size={15} style={{ color: 'var(--moss)' }} /><span class="vday">D{live.clock.day}</span>{live.env.temp.toFixed(0)}° <Icon name="drop" size={14} style={{ color: 'var(--water)' }} />{Math.round(live.env.humidity)}%
      </button>
      <div class="spacer" />
      {career && career.mode === 'career' && (
        <div class="wallet glass">
          <div class="funds" title="Funds"><Icon name="coin" size={16} /><span class="num">{Math.round(career.funds).toLocaleString()}</span></div>
          <div class="rank" onClick={() => openModal('studio', 'career')} title={`${career.rank} · ${career.rep} rep`}>
            <div class="ring" style={{ '--p': Math.round(career.levelProgress * 100) }}><span>{career.level}</span></div>
            <div><b>{career.rank}</b><small>{career.nextIn > 0 ? `${career.nextIn} to next` : 'Max rank'}</small></div>
          </div>
        </div>
      )}
      <div class="fsbtn glass" role="group" aria-label="Display">
        <button class={DISPLAY.value.fs ? 'on' : ''} onClick={toggleFullscreen} title={fullscreenSupported() ? 'Full screen (Shift+F)' : 'Full screen: Add to Home Screen on this browser'} aria-label="Full screen"><Icon name="eye" size={16} /></button>
        <button onClick={toggleZen} title="Zen: hide the interface (Shift+Z, Esc to return)" aria-label="Zen mode"><Icon name="sparkles" size={16} /></button>
      </div>
      <Dock />
    </div>
  );
}

function Dock() {
  const [more, setMore] = useState(false);
  const m = S.modal.value;
  const career = S.career.value;
  const btn = (id, icon, label, dot) => (
    <button class={m === id ? 'on' : ''} onClick={() => openModal(id)} title={label}>
      <Icon name={icon} size={17} /><span>{label}</span>{dot ? <i class="dot" /> : null}
    </button>
  );
  return (
    <div class="dock glass">
      {btn('care', 'heart', 'Care')}
      {hudRules().lab ? btn('lab', 'flask', 'Lab') : null}
      {btn('codex', 'book', 'Field guide')}
      {btn('studio', 'briefcase', 'Studio', career?.attention)}
      {S.compact.value ? (
        <>
          <button class={more ? 'on' : ''} onClick={() => setMore(!more)} title="Views, lens, photo, time-lapse"><Icon name="camera" size={17} /><span>View</span></button>
          {more ? <ViewMenu onClose={() => setMore(false)} /> : null}
        </>
      ) : null}
    </div>
  );
}
