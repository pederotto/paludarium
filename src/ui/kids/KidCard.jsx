// What you see when you tap an animal or a plant: a big portrait, a name, how it
// feels, what it likes in plain words, one "Did you know?", and three buttons.

import { useEffect, useState } from 'preact/hooks';
import './kids.css';
import { Icon } from '../icons.jsx';
import { S } from '../store.js';
import { ctx } from '../../app/ctx.js';
import { Portrait } from '../panels/Portrait.jsx';
import { Hearts } from './Hearts.jsx';
import { MorphDot } from '../GeneBits.jsx';
import { morphName } from '../../content/morphs.js';
import { SPECIES } from '../../sim/animals.js';
import { PLANTS } from '../../sim/plants.js';
import { ANIMAL_INFO } from '../../content/species-info.js';
import { PLANT_INFO } from '../../content/plant-info.js';
import { kidAnimal, kidPlant, shortFact, animalLikes, plantLikes } from '../../content/kids.js';
import { K, moodOf, faceOf, feedOne, setNick, rain } from '../../app/kids.js';

const WHY = {
  hungry: 'I am hungry!', 'too cold': 'I am cold.', 'too hot': 'I am hot.', 'air too dry': 'The air is dry.', 'out of water': 'I need water!',
  ammonia: 'The water is dirty.', nitrite: 'The water is dirty.', nitrate: 'The water is dirty.', 'low oxygen': 'I need fresh water.',
};
const FACE = { happy: 'smile', ok: 'meh', sad: 'frown' };

// ---- SLOT: family / baby colours -------------------------------------------------------------------------------------
// The genetics feature plugs in here. It receives the live animal object (`animal`). Render the
// parents, the colour morph and the baby colours as a short, kid-sized block (big pictures, few
// words, 16 px text or larger). Return null when there is nothing to show.
function FamilySlot({ animal }) {
  if (!animal?.genes || !animal.morph) return null;
  const sp = animal.sp;
  const colour = morphName(sp, animal.morph);
  const mum = animal.parents ? ctx.game.world.animals.all.find((x) => x.id === animal.parents[0]) : null;
  const dad = animal.parents ? ctx.game.world.animals.all.find((x) => x.id === animal.parents[1]) : null;
  const nice = (m) => morphName(sp, m).toLowerCase();
  return (
    <div class="likes" style={{ marginTop: 6 }}>
      <span class="hint"><MorphDot sp={sp} morph={animal.morph} size={18} />My colour: {colour}</span>
      {animal.parents ? <span class="hint"><Icon name="egg" size={20} />{mum && dad ? `A ${nice(mum.morph)} mum and a ${nice(dad.morph)} dad` : 'I am a baby!'}</span> : null}
    </div>
  );
}

export function KidCard({ sel }) {
  void S.live.value; void K.tick.value;
  const T = ctx.tools, g = ctx.game;
  const o = sel.obj, isAnimal = sel.kind === 'animal';
  const [naming, setNaming] = useState(false);
  const [text, setText] = useState('');
  useEffect(() => { setNaming(false); setText(o.nick ?? ''); }, [o]);
  if (o.dead) return null;

  const sp = isAnimal ? SPECIES[o.sp] : PLANTS[o.id];
  const kid = isAnimal ? kidAnimal(o.sp) : kidPlant(o.id);
  const info = isAnimal ? ANIMAL_INFO[o.sp] : PLANT_INFO[o.id];
  const mood = isAnimal ? moodOf(o) : Math.max(0, Math.min(1, o.health));
  const face = faceOf(mood);
  const species = kid?.n ?? sp.name;
  const title = (isAnimal && o.nick) || species;
  const why = isAnimal ? (o.hunger > 0.6 ? WHY.hungry : WHY[o.why?.[0]]) : (o.health < 0.6 ? 'I need light or water.' : '');
  const feeling = why || (face === 'happy' ? 'I am happy!' : face === 'ok' ? 'I am okay.' : 'I feel sad.');
  const likes = isAnimal ? animalLikes(sp) : plantLikes(sp);
  const fact = shortFact(info) || sp.note;
  const following = S.following.value === o;

  const reset = () => { if (g.rig) { g.rig.moved = false; g.rig.view('front', true); } };
  const close = () => { const f = S.following.value; T.select(null); if (f) reset(); };
  const follow = () => { if (following) { T.follow(null); reset(); } else T.zoomTo(sel); };
  const zoom = () => { if (S.following.value || g.rig.moved) { T.follow(null); reset(); } else T.zoomTo(sel); };
  const save = () => { setNick(o, text); setNaming(false); };

  return (
    <div class="kcard glass strong" role="dialog" aria-label={title}>
      <div class="hd">
        {isAnimal ? <Portrait kind="animal" id={o.sp} size={88} /> : <Portrait kind="plant" id={o.id} size={88} />}
        <div class="who">
          <h4>{title}</h4>
          <div class="sub">{isAnimal && o.nick ? species : feeling}</div>
          <div class="mood">
            <Hearts value={mood} size={24} label="How I feel" />
            <span class={'face ' + face}><Icon name={FACE[face]} size={26} stroke={2} /></span>
          </div>
        </div>
        <button class="close" aria-label="Close" onClick={close}><Icon name="x" size={26} stroke={2.4} /></button>
      </div>
      {isAnimal && o.nick ? <div class="sub" style={{ marginTop: 4 }}>{feeling}</div> : null}
      <div class="likes">
        <span class="say">{likes.line}</span>
        {likes.chips.map((c) => <span key={c.text} class="hint"><Icon name={c.icon} size={20} />{c.text}</span>)}
      </div>
      {fact ? <p class="fact"><b>Did you know?</b> {fact}</p> : null}
      <div class="fam" data-slot="family"><FamilySlot animal={isAnimal ? o : null} /></div>
      {naming ? (
        <div class="name-row">
          <input value={text} maxLength={14} placeholder="My name is…" autoFocus onInput={(e) => setText(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
          <button onClick={save}>OK</button>
        </div>
      ) : (
        <div class="acts">
          {isAnimal ? <button class="k-btn2 feed" onClick={() => feedOne(o)}><Icon name="bowl" size={24} />Feed</button> : <button class="k-btn2 feed" onClick={rain}><Icon name="rain" size={24} />Rain</button>}
          {isAnimal ? <button class={'k-btn2' + (following ? ' on' : '')} onClick={follow}><Icon name="eye" size={24} />{following ? 'Back' : 'Follow'}</button> : <button class="k-btn2" onClick={zoom}><Icon name="search" size={24} />Zoom</button>}
          {isAnimal ? <button class="k-btn2" onClick={() => setNaming(true)}><Icon name="pencil" size={24} />Name me</button> : null}
        </div>
      )}
    </div>
  );
}
