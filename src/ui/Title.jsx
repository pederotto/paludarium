import { Icon } from './icons.jsx';
import { S, openModal } from './store.js';
import { ctx } from '../app/ctx.js';

export function Title() {
  const meta = ctx.meta;
  const start = ctx.start;
  return (
    <div class="title">
      <div class="box">
        <h1 class="serif">Paludarium</h1>
        <p class="tag-line">Build living worlds of moss, stone and water. Learn how real terrariums and paludariums work by keeping one alive.</p>
        <div class="menu">
          {meta ? <button class="btn primary" onClick={() => start.continue()}><Icon name="play" size={16} />Continue · {meta.name}<span style={{ opacity: 0.7, fontWeight: 500, marginLeft: 'auto' }}>day {meta.day}</span></button> : null}
          <button class={'btn' + (meta ? '' : ' primary')} onClick={() => start.career()}><Icon name="sprout" size={16} />New career<span style={{ opacity: 0.6, fontWeight: 500, marginLeft: 'auto' }}>learn as you build</span></button>
          <button class="btn" onClick={() => start.sandbox('starter')}><Icon name="wand" size={16} />Sandbox: the starter paludarium</button>
          <button class="btn" onClick={() => start.sandbox('empty')}><Icon name="mountain" size={16} />Sandbox: an empty tank</button>
          <button class="btn ghost" onClick={() => openModal('settings')}><Icon name="settings" size={16} />Settings</button>
        </div>
      </div>
      <div class="foot">
        <span>{S.backend.value}</span><span>·</span><span>three.js WebGPU</span><span>·</span>
        <a href="https://github.com/pederotto/paludarium" target="_blank" rel="noopener" style={{ color: 'inherit' }}>source</a>
      </div>
    </div>
  );
}
