// Kids' corner on the title screen: the "Choose your world" screen of six
// picture cards.

import './kids.css';
import { Icon } from '../icons.jsx';
import { ctx } from '../../app/ctx.js';
import { K, tierForScreen } from '../../app/kids.js';
import { WORLDS } from '../../content/kids.js';

export function KidsWorlds({ back }) {
  const meta = K.meta.value;
  const pick = (id) => ctx.start.kids(id, (Math.random() * 99999) | 0, tierForScreen());
  return (
    <div class="kw">
      <div class="kw-head">
        <button class="kw-back" onClick={back}><Icon name="chevronL" size={24} stroke={2.4} />Back</button>
        {meta ? <button class="kw-keep" onClick={() => ctx.start.kidsContinue()}><Icon name="play" size={22} />Keep playing</button> : null}
        <h1>Choose your world</h1>
      </div>
      <div class="kw-grid">
        {WORLDS.map((w) => (
          <button key={w.id} class="kw-card" style={{ '--c1': w.c1, '--c2': w.c2 }} onClick={() => pick(w.id)}>
            <div class="orb"><Icon name={w.icon} size={46} stroke={1.8} /></div>
            <b>{w.name}</b>
            <span>{w.line}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
