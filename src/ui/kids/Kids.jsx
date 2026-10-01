// The Kids HUD: a friendly top bar with the happy meter, a one-line guide, a bottom tray of big round buttons
// and picture sheets. It replaces the grown-up HUD while S.kids is on. The logic lives in src/app/kids.js.

import { useState, useRef, useEffect } from 'preact/hooks';
import './kids.css';
import { Icon } from '../icons.jsx';
import { S } from '../store.js';
import { ctx } from '../../app/ctx.js';
import { Portrait } from '../panels/Portrait.jsx';
import { Hearts } from './Hearts.jsx';
import { KidCard } from './KidCard.jsx';
import * as KK from '../../app/kids.js';
import { KID_ANIMALS, KID_PLANTS, KID_PIECES, KID_KITS, KID_TERRAIN, STICKERS } from '../../content/kids.js';
import { endTimelapse } from '../../app/timelapse.js';

const { K } = KK;

const TABS = [
  ['animals', 'Animals', 'frog', '#57c27a', '#2c8a57'],
  ['plants', 'Plants', 'leaf', '#9ad36a', '#4f9a3a'],
  ['build', 'Build', 'rock', '#b8a2f0', '#6f5ab8'],
  ['care', 'Care', 'heart', '#ff8fab', '#e0407a'],
  ['photo', 'Photo', 'camera', '#7bdff2', '#2f7fc0'],
  ['more', 'More', 'sparkles', '#ffd166', '#e09a2a'],
];

const SHEET_TITLE = { animals: 'Pick a friend', plants: 'Pick a plant', build: 'Build something', care: 'Look after them', more: 'More fun', stickers: 'My stickers' };

function Pic({ c1, c2, icon, size = 40 }) {
  return <span class="k-pic" style={{ '--c1': c1, '--c2': c2 }}><Icon name={icon} size={size} stroke={1.9} /></span>;
}

function Sheet({ id, children, back }) {
  return (
    <div class="k-sheet glass strong">
      <div class="k-sh-head">
        {back ? <button class="k-ico" onClick={() => { K.sheet.value = back; }} aria-label="Back"><Icon name="chevronL" size={26} stroke={2.4} /></button> : null}
        <h3>{SHEET_TITLE[id]}</h3>
        <button class="k-ico" onClick={() => { K.sheet.value = null; }} aria-label="Close"><Icon name="x" size={26} stroke={2.4} /></button>
      </div>
      {children}
    </div>
  );
}

function AnimalsSheet() {
  const W = ctx.game.world;
  const ok = KID_ANIMALS.filter((a) => W.animals.by[a.id]);
  return (
    <Sheet id="animals">
      <div class="k-row">
        {ok.map((a) => (
          <button key={a.id} class="k-card" onClick={() => KK.startPlace({ kind: 'animal', id: a.id, name: a.n, where: a.where })}>
            <Portrait kind="animal" id={a.id} size={84} />
            <span class="nm">{a.n}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function PlantsSheet() {
  return (
    <Sheet id="plants">
      <div class="k-row">
        {KID_PLANTS.map((p) => (
          <button key={p.id} class="k-card" onClick={() => KK.startPlace({ kind: 'plant', id: p.id, name: p.n, where: p.where })}>
            <Portrait kind="plant" id={p.id} size={84} />
            <span class="nm">{p.n}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function BuildSheet() {
  const [tab, setTab] = useState('kits');
  const twin = S.mirror.value;
  const list = tab === 'kits' ? KID_KITS : tab === 'rocks' ? KID_PIECES : KID_TERRAIN;
  const kind = tab === 'kits' ? 'kit' : tab === 'rocks' ? 'piece' : null;
  return (
    <Sheet id="build">
      <div class="k-sh-head" style={{ minHeight: 0 }}>
        <div class="k-chips">
          {[['kits', 'Kits'], ['rocks', 'Rocks'], ['land', 'Land']].map(([id, n]) => <button key={id} class={'k-chip' + (tab === id ? ' on' : '')} onClick={() => setTab(id)}>{n}</button>)}
        </div>
      </div>
      <div class="k-row">
        {list.map((b) => (
          <button key={b.id} class="k-card" onClick={() => KK.startPlace({ kind: kind ?? b.id, id: b.id, name: b.n, where: 'ground' })}>
            <Pic c1={b.c1} c2={b.c2} icon={b.icon} />
            <span class="nm">{b.n}</span>
          </button>
        ))}
      </div>
      <button class={'k-switch' + (twin ? ' on' : '')} onClick={KK.toggleTwin}><Icon name="twin" size={28} stroke={2} />Twin: build in pairs<i class="knob" /></button>
    </Sheet>
  );
}

function CareSheet() {
  const night = K.light.value === 'off' || (K.light.value === 'auto' && ctx.game.world.env.light() < 0.5);
  return (
    <Sheet id="care">
      <div class="k-big">
        <button class="k-act" style={{ '--c1': '#f2b25a', '--c2': '#d98a2a' }} onClick={KK.feed}><Icon name="bowl" size={40} stroke={1.9} />Feed</button>
        <button class="k-act" style={{ '--c1': '#7fb6f0', '--c2': '#3f6fc0' }} onClick={KK.rain}><Icon name="rain" size={40} stroke={1.9} />Rain</button>
        <button class="k-act" style={{ '--c1': '#7fe0d8', '--c2': '#2f9a9a' }} onClick={KK.clean}><Icon name="sparkles" size={40} stroke={1.9} />Clean</button>
        <button class="k-act" style={{ '--c1': night ? '#f2b25a' : '#7a7ad0', '--c2': night ? '#d98a2a' : '#3a3a8a' }} onClick={KK.toggleLight}><Icon name={night ? 'sun' : 'moon'} size={40} stroke={1.9} />{night ? 'Day' : 'Night'}</button>
      </div>
      <button class={'k-switch' + (K.helper.value ? ' on' : '')} onClick={() => KK.toggleHelper()}><Icon name="heart" size={28} stroke={2} />Care helper<i class="knob" /></button>
    </Sheet>
  );
}

// "Grown-up mode" needs a long press so little fingers do not wander off into the big game.
function HoldButton({ onDone, children }) {
  const [go, setGo] = useState(false);
  const t = useRef(0);
  const down = () => { setGo(true); t.current = setTimeout(() => { setGo(false); onDone(); }, 1200); };
  const up = () => { clearTimeout(t.current); setGo(false); };
  return (
    <button class={'k-act hold' + (go ? ' go' : '')} style={{ '--c1': '#6b7a74', '--c2': '#3a4640' }} onPointerDown={down} onPointerUp={up} onPointerLeave={up} onPointerCancel={up}>
      {children}<small>hold</small><i />
    </button>
  );
}

function MoreSheet() {
  const have = Object.keys(K.stickers.value).length;
  return (
    <Sheet id="more">
      <div class="k-more">
        <button class="k-act" style={{ '--c1': '#ff8fab', '--c2': '#e0407a' }} onClick={() => ctx.start.kids(['cascade', 'suriname', 'blackwater', 'stream', 'karst', 'swamp'][(Math.random() * 6) | 0], (Math.random() * 99999) | 0, KK.tierForScreen())}><Icon name="sparkles" size={36} stroke={1.9} />Surprise me</button>
        <button class="k-act" style={{ '--c1': '#ffd166', '--c2': '#e09a2a' }} onClick={() => { K.sheet.value = 'stickers'; }}><Icon name="star" size={36} stroke={1.9} />Stickers<small>{have} of {STICKERS.length}</small></button>
        <button class="k-act" style={{ '--c1': '#8aa8f0', '--c2': '#4a5ac0' }} onClick={KK.startLapse}><Icon name="clock" size={36} stroke={1.9} />Time flies</button>
        <HoldButton onDone={KK.grownUp}><Icon name="lock" size={36} stroke={1.9} />Grown-up mode</HoldButton>
      </div>
    </Sheet>
  );
}

function StickersSheet() {
  const got = K.stickers.value;
  return (
    <Sheet id="stickers" back="more">
      <div class="k-stickers">
        {STICKERS.map((s) => (
          <div key={s.id} class={'k-st' + (got[s.id] ? '' : ' off')} style={{ '--c1': s.c1, '--c2': s.c2 }}>
            <span class="badge"><Icon name={got[s.id] ? s.icon : 'lock'} size={32} stroke={1.9} /></span>
            <span>{got[s.id] ? s.name : '???'}</span>
            <small>{s.hint}</small>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

function PlaceBar() {
  const p = K.place.value;
  const n = K.undoN.value;
  return (
    <div class="k-place glass strong">
      <button class="k-round stop" onClick={KK.stopPlace} aria-label="Stop"><Icon name="x" size={30} stroke={2.6} /></button>
      <div class="mid">
        <div>
          <b>{p.name}</b>
          <span class="k-tap">{p.kind === 'hill' ? 'Tap to make a hill!' : p.kind === 'pond' ? 'Tap to dig a pond!' : 'Tap the tank!'}</span>
        </div>
      </div>
      <button class="k-round undo" disabled={!n} onClick={KK.undo} aria-label="Undo"><Icon name="undo" size={30} stroke={2.4} />{n ? <em>{n}</em> : null}</button>
    </div>
  );
}

function Toasts() {
  const list = K.toasts.value, b = K.banner.value, pop = K.pop.value;
  const st = pop ? STICKERS.find((s) => s.id === pop.id) : null;
  return (
    <>
      <div class="k-toasts">{list.map((t) => <div key={t.id} class={'k-toast ' + t.kind}>{t.text}</div>)}</div>
      {b ? <div key={b.n} class="k-banner">{b.text}</div> : null}
      {st ? (
        <div key={pop.n} class="k-pop" style={{ '--c1': st.c1, '--c2': st.c2 }}>
          <span class="badge"><Icon name={st.icon} size={58} stroke={1.8} /></span>
          <small>New sticker!</small>
          <b>{st.name}</b>
        </div>
      ) : null}
    </>
  );
}

const CONF = Array.from({ length: 34 }, (_, i) => {
  const a = (i / 34) * Math.PI * 2 + (i % 3) * 0.3, r = 120 + ((i * 53) % 130);
  return { x: Math.round(Math.cos(a) * r) + 'px', y: Math.round(Math.sin(a) * r * 0.8 - 60) + 'px', r: ((i * 97) % 720) - 360 + 'deg', d: ((i % 7) * 0.04).toFixed(2) + 's', c: ['#ffd166', '#ff8fab', '#7bdff2', '#7fe08a', '#c0a0f0', '#ff9a5a'][i % 6] };
});

function Confetti() {
  const n = K.confetti.value;
  if (!n) return null;
  return <div key={n} class="k-confetti">{CONF.map((c, i) => <i key={i} style={{ '--x': c.x, '--y': c.y, '--r': c.r, '--d': c.d, '--c': c.c }} />)}</div>;
}

function Lapse() {
  const t = S.timelapse.value;
  if (!t) return null;
  const pct = Math.min(100, Math.round((t.day / t.days) * 100));
  return (
    <div class="kids-bottom">
      <div class="k-lapse glass strong">
        {t.done ? (
          <>
            <h3>Wow, look what happened!</h3>
            <ul>{KK.lapseLines(t).map((l) => <li key={l}>{l}</li>)}</ul>
            <button class="go" onClick={endTimelapse}>Back to my world</button>
          </>
        ) : (
          <>
            <h3>Time is flying…</h3>
            <div class="bar"><i style={{ width: pct + '%' }} /></div>
            <button class="go" onClick={() => ctx.game && (ctx.game.lapse = 0, endTimelapse())}>Stop</button>
          </>
        )}
      </div>
    </div>
  );
}

function Photo() {
  return (
    <>
      <div class="k-photo-hint">Look around, then tap the button!</div>
      <button class="k-photo-x" onClick={KK.closePhoto} aria-label="Done"><Icon name="x" size={32} stroke={2.6} /></button>
      <button class="k-shutter" onClick={KK.snapPhoto} aria-label="Take photo"><Icon name="camera" size={40} stroke={2} /></button>
    </>
  );
}

export function KidsHud() {
  const sheet = K.sheet.value, place = K.place.value, sel = S.selection.value;
  const light = ctx.game?.world?.env?.light?.() ?? 1;
  const guide = K.guide.value;
  // Ask the camera to re-frame the tank in the space the HUD leaves free.
  useEffect(() => { ctx.relayout?.(); });
  if (S.photo.value) return (<><Photo /><Toasts /><Confetti /></>);
  if (S.timelapse.value) return (<><Lapse /><Toasts /><Confetti /></>);
  const card = sel && (sel.kind === 'animal' || sel.kind === 'plant') && !place;
  return (
    <>
      <div class="kids-top">
        <div class="k-bar glass strong">
          <button class="k-ico k-home" onClick={KK.goHome} aria-label="Home"><Icon name="home" size={28} stroke={2} /></button>
          <div class="k-name">{S.tankTitle.value ?? 'My world'}</div>
          <Hearts value={K.happy.value} size={30} />
          <button class="k-ico k-sun" onClick={KK.toggleLight} aria-label="Day or night"><Icon name={light > 0.3 ? 'sun' : 'moon'} size={28} stroke={2} /></button>
          <button class="k-ico k-snd" onClick={KK.toggleSound} aria-label="Sound"><Icon name={K.sound.value ? 'sound' : 'mute'} size={28} stroke={2} /></button>
        </div>
        {guide?.text ? (
          <div class="k-guide glass strong">
            <span class="avatar">M</span>
            <p>{guide.text}</p>
            {guide.act ? <button class="go" onClick={() => KK.act(guide.act.run)}>{guide.act.label}</button> : null}
          </div>
        ) : null}
      </div>
      <Toasts />
      <Confetti />
      <div class="kids-bottom">
        {card ? <KidCard sel={sel} /> : null}
        {place ? <PlaceBar /> : null}
        {!place && sheet === 'animals' ? <AnimalsSheet /> : null}
        {!place && sheet === 'plants' ? <PlantsSheet /> : null}
        {!place && sheet === 'build' ? <BuildSheet /> : null}
        {!place && sheet === 'care' ? <CareSheet /> : null}
        {!place && sheet === 'more' ? <MoreSheet /> : null}
        {!place && sheet === 'stickers' ? <StickersSheet /> : null}
        {!place ? (
          <div class="k-tray glass strong">
            {TABS.map(([id, name, icon, c1, c2]) => (
              <button key={id} class={'k-tab' + (sheet === id || (id === 'more' && sheet === 'stickers') ? ' on' : '')} style={{ '--c1': c1, '--c2': c2 }} onClick={() => (id === 'photo' ? KK.openPhoto() : (K.sheet.value = sheet === id ? null : id))}>
                <span class="dot"><Icon name={icon} size={30} stroke={2} /></span>{name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}
