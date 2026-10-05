// Kids' corner, the logic half: a forgiving "gentle guardian" that runs once a
// second while the simplified HUD is on (animals never die, hunger is sped up
// a little so feeding matters, the care helper keeps the tank safe), the happy
// meter, the guide's one-suggestion-at-a-time, placing things by tapping the
// tank, stickers, and the kids' own save slot. The simulation is untouched:
// everything here only nudges values the sim already owns.

import { signal } from '@preact/signals';
import { S } from '../ui/store.js';
import { ctx } from './ctx.js';
import { SPECIES, one } from '../sim/animals.js';
import { TANK } from '../sim/tank.js';
import { Care } from './actions.js';
import { Saves } from './saves.js';
import { Career } from '../game/career.js';
import { startTimelapse } from './timelapse.js';
import { STICKERS, SAY, animalName, animalPlural, kidAnimal } from '../content/kids.js';
import { computeMetrics } from '../game/metrics.js';
import { PLANTS } from '../sim/plants.js';
import { newProgress, storyStep, currentChallenge } from '../content/kids-story.js';

const STORE = 'paludarium.kids.v1', META = 'paludarium.kids.meta', SLOT = 'kids1';
const NOT_PETS = new Set(['fly', 'flylarva', 'flypupa', 'springtail', 'isopod', 'eggs']);
const HUNGER_PER_SECOND = 0.0016;     // a fed pet is hungry after about four minutes of play
const MIN_HEALTH = 0.4;               // pets look sad instead of dying

const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k) ?? 'null') ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* blocked */ } };
const stored = read(STORE, {});

export const K = {
  sheet: signal(null),          // null | 'animals' | 'plants' | 'build' | 'care' | 'more' | 'stickers'
  place: signal(null),          // { kind: 'animal'|'plant'|'piece'|'kit'|'hill'|'pond', id, name, where }
  undoN: signal(0),
  happy: signal(0.8),           // 0..1, smoothed
  mood: signal('happy'),        // 'happy' | 'ok' | 'sad'
  guide: signal({ text: SAY.start }),
  toasts: signal([]),
  stickers: signal(stored.stickers ?? {}),
  pop: signal(null),            // the sticker just earned
  confetti: signal(0),
  banner: signal(null),         // { text } a cheerful banner ("A baby frog!")
  helper: signal(false),
  sound: signal(true),
  light: signal('auto'),
  meta: signal(read(META, null)),
  tick: signal(0),              // bumps when something on a card changed (a name)
  story: signal(stored.story ?? newProgress()), // N18: "Pip finds a home" progress (content/kids-story.js)
  fed: signal(stored.fed ?? 0), // feeds so far: the story's "Feed your frogs" counter
};

let session = { cared: 0 };
let known = null, snap = null, acc = 0, saveT = 0, lightAt = 0, guideAt = 0, guideKey = '', celebrate = null;
const last = { feed: 0, flies: 0, water: 0, mist: 0 };
const undoStack = [];
let installed = false, attached = null;

// --- Small helpers ------------------------------------------------------------------------------------------------
let toastN = 1;
export function kToast(text, kind = 'info', ms = 2400) {
  const t = { id: toastN++, text, kind };
  K.toasts.value = [...K.toasts.value.slice(-1), t];
  setTimeout(() => { K.toasts.value = K.toasts.value.filter((x) => x.id !== t.id); }, ms);
}

const persist = () => write(STORE, { stickers: K.stickers.value, story: K.story.value, fed: K.fed.value });

export function earn(id) {
  if (K.stickers.value[id]) return;
  const st = STICKERS.find((s) => s.id === id);
  if (!st) return;
  K.stickers.value = { ...K.stickers.value, [id]: Date.now() };
  persist();
  const pop = { id, name: st.name, n: toastN++ };
  K.pop.value = pop;
  K.confetti.value++;
  celebrate = { text: SAY.sticker(st.name), until: performance.now() + 5000 };
  setTimeout(() => { if (K.pop.value === pop) K.pop.value = null; }, 3400);
}

const pets = (W) => { const out = []; for (const id in W.animals.by) if (!NOT_PETS.has(id)) out.push(...W.animals.by[id]); return out; };
const allAnimals = (W) => { const out = []; for (const id in W.animals.by) out.push(...W.animals.by[id]); return out; };
const aquatic = (sp) => sp.kind === 'swim' || sp.kind === 'crawlWater' || sp.kind === 'axolotl';

// How an animal is feeling, 0..1: hunger matters most, then health and any stress.
export function moodOf(a) {
  const hungry = Math.max(0, Math.min(1, (a.hunger - 0.35) / 0.6));
  const hurt = Math.max(0, Math.min(1, (1 - a.health) / 0.6));
  return Math.max(0, Math.min(1, 1 - 0.55 * hungry - 0.25 * hurt - (a.why?.length ? 0.12 : 0)));
}
export const faceOf = (m) => (m >= 0.72 ? 'happy' : m >= 0.45 ? 'ok' : 'sad');

// --- Assessing the tank ------------------------------------------------------------------------------------------------
function assess(W) {
  const E = W.env, list = pets(W);
  let mood = 0, air = 0, nAir = 0, hasAqua = false;
  const hungry = {};
  for (const a of list) {
    const sp = SPECIES[a.sp];
    mood += moodOf(a);
    if (aquatic(sp)) hasAqua = true;
    else if (sp.humidity) { air += Math.min(1, (a.RH ?? E.humidity) / sp.humidity); nAir++; }
    if (a.hunger > 0.6 && a.sp !== 'tadpole') (hungry[a.sp] ??= []).push(a);
  }
  const n = list.length;
  const bad = Math.max((E.ammonia - 0.12) / 0.5, (E.nitrite - 0.15) / 0.5, (E.nitrate - 30) / 60, 0);
  const water = hasAqua ? 1 - Math.min(1, bad) : 1;
  const airOk = nAir ? air / nAir : 1;
  let happy;
  if (!n) {
    const pl = W.plants.list; let h = 0; for (const p of pl) h += Math.max(0, Math.min(1, p.health));
    happy = 0.55 + 0.4 * (pl.length ? h / pl.length : 0);
  } else {
    let w = 0.7, v = 0.7 * (mood / n);
    if (hasAqua) { w += 0.15; v += 0.15 * water; }
    if (nAir) { w += 0.15; v += 0.15 * airOk; }
    happy = v / w;
  }
  return { happy, hungry, n, water, airOk, dirty: hasAqua && (E.ammonia > 0.25 || E.nitrite > 0.25 || E.nitrate > 45), dry: nAir > 0 && airOk < 0.9 };
}

// --- Care -----------------------------------------------------------------------------------------------------------------------
const cared = () => { session.cared++; };

export function feed() {
  const g = ctx.game, W = g?.world;
  if (!W) return;
  let aqua = false, land = false;
  for (const a of pets(W)) {
    const sp = SPECIES[a.sp];
    if (sp.eats?.includes('flake')) aqua = true; else land = true;
    a.hunger = Math.max(0, a.hunger - 0.4);
  }
  if (aqua) Care.feed(g);
  if (land && (W.animals.by.fly?.length ?? 0) < 30) Care.flies(g);
  cared(); earn('feed'); K.fed.value++;
  kToast('Yum! Dinner time!', 'good');
}

export function rain() {
  const g = ctx.game;
  if (!g?.world) return;
  Care.rain(g, 6); Care.mist(g);
  cared(); earn('rain');
  kToast('Here comes the rain!', 'good');
}

export function clean() {
  const g = ctx.game, E = g?.world?.env;
  if (!E) return;
  Care.waterChange(g); Care.scrubAlgae(g); Care.wipe(g);
  E.ammonia *= 0.3; E.nitrite *= 0.3; E.nitrate *= 0.45;
  cared(); earn('clean');
  kToast('Sparkly clean!', 'good');
}

export function toggleLight() {
  const E = ctx.game?.world?.env;
  if (!E) return;
  const dark = E.light() > 0.5;
  E.lights = dark ? 'off' : 'on';
  lightAt = performance.now();
  K.light.value = E.lights;
  if (dark) earn('night');
  kToast(dark ? 'Good night!' : 'Good morning!', 'good');
}

export function toggleHelper(v = !K.helper.value) {
  K.helper.value = v;
  kToast(v ? 'The helper will look after your pets.' : 'You are in charge!', 'good');
}

export function toggleTwin() {
  const T = ctx.tools;
  const v = !S.mirror.value;
  if (T) T.toggleMirror(v); else S.mirror.value = v;
  kToast(v ? 'Twin is on: things come in pairs!' : 'Twin is off.', 'good');
}

export function toggleSound() {
  const a = ctx.audio;
  if (!a) return;
  a.setOn(!a.on);
  K.sound.value = a.on;
}

export function setNick(a, text) {
  const t = (text ?? '').trim().slice(0, 14);
  a.nick = t || undefined;
  K.tick.value++;
  if (t) { earn('named'); kToast(`Hello, ${t}!`, 'good'); }
}

export function feedOne(a) {
  const g = ctx.game, W = g?.world;
  if (!W) return;
  const sp = SPECIES[a.sp];
  a.hunger = Math.max(0, a.hunger - 0.5);
  if (sp.eats?.includes('flake')) Care.feed(g);
  else if ((W.animals.by.fly?.length ?? 0) < 30) Care.flies(g);
  cared(); earn('feed'); K.fed.value++;
  kToast('Yum!', 'good');
}

// --- Placing things by tapping the tank -------------------------------------------------------------------------
export function startPlace(p) {
  const T = ctx.tools;
  if (!T) return;
  T.selectPiece(null); T.select(null);
  T.keys.delete('shift');
  if (p.kind === 'animal') { T.setTool('animal'); T.setSub('animal', p.id); }
  else if (p.kind === 'plant') { T.setTool('plant'); T.setSub('plant', p.id); }
  else if (p.kind === 'piece') { T.setTool('rock'); T.setSub('rock', p.id); S.brush.value = { size: 6, strength: 1 }; T.keys.add('shift'); }
  else if (p.kind === 'kit') T.setKit(p.id);
  else if (p.kind === 'hill') { T.setTool('sculpt'); T.setSub('sculpt', 'raise'); }
  else if (p.kind === 'pond') { T.setTool('water'); T.setSub('water', 'basin'); S.brush.value = { size: Math.max(5, Math.min(8, TANK.w * 0.09)), strength: 1.2 }; }
  K.place.value = p;
  K.sheet.value = null;
}

export function stopPlace() {
  const T = ctx.tools;
  K.place.value = null;
  if (!T) return;
  T.keys.delete('shift');
  T.selectPiece(null);
  T.setTool('view');
}

export function undo() {
  const T = ctx.tools, W = ctx.game?.world;
  if (!W) return;
  const e = undoStack.pop();
  K.undoN.value = undoStack.length;
  if (!e) { kToast('Nothing to undo.'); return; }
  for (const a of e.animals) { W.animals.remove(a, 'removed'); known?.add(a.id); }
  for (const p of e.plants) W.plants.remove(p);
  if (e.world) T.undo();
  kToast('Undone!', 'good');
}

function onDownCapture() {
  const W = ctx.game?.world;
  if (!S.kids.value || !K.place.value || !W) return;
  snap = { animals: new Set(allAnimals(W)), plants: new Set(W.plants.list), last: W.undoStack[W.undoStack.length - 1] };
}

function onDownAfter(e) {
  const p = K.place.value, T = ctx.tools, W = ctx.game?.world;
  if (!S.kids.value || !p || !snap || !W) return;
  try {
    if (p.kind === 'hill') hill(e, T, W);
    else if (p.kind === 'pond') pond(e, T, W);
    else if (p.kind === 'piece') T.selectPiece(null);
  } catch (err) { console.error(err); }
  const entry = { animals: allAnimals(W).filter((a) => !snap.animals.has(a)), plants: W.plants.list.filter((x) => !snap.plants.has(x)), world: W.undoStack[W.undoStack.length - 1] !== snap.last };
  snap = null;
  if (!entry.animals.length && !entry.plants.length && !entry.world) return;
  for (const a of entry.animals) known?.add(a.id);
  undoStack.push(entry);
  if (undoStack.length > 30) undoStack.shift();
  K.undoN.value = undoStack.length;
  if (p.kind === 'animal') kToast(`A ${animalName(p.id).toLowerCase()}!`, 'good', 1400);
  else if (p.kind === 'plant') kToast('Planted!', 'good', 1400);
  else if (p.kind === 'hill') { earn('hill'); kToast('A new hill!', 'good', 1400); }
  else if (p.kind === 'pond') { earn('pond'); kToast('A new pond!', 'good', 1400); }
  else { earn('build'); kToast('Built!', 'good', 1400); }
  if (p.kind === 'animal') earn('friend');
  if (p.kind === 'plant') earn('plant');
  if (S.mirror.value && ['piece', 'kit', 'plant', 'hill', 'pond'].includes(p.kind)) earn('twin');
}

// One tap raises a round hill (and its twin when Twin is on).
function hill(e, T, W) {
  T.down = false; T.strokeChanged = false;
  T.setMouse(e);
  const hit = T.pick(['terrain']);
  if (!hit || hit.surface === 'wall') return;
  const R = Math.max(6, Math.min(13, TANK.w * 0.11));
  const xs = [hit.point.x];
  if (T.mirrored(hit.point.x, R * 0.6)) xs.push(-hit.point.x);
  for (const x of xs) W.terrain.field.brush(x, hit.point.z, R, 'raise', 6, {});
  W.groundChanged();
  T.game.events.emit('edit', 'sculpt');
}

// The controller digs the pool; we fill it from the main pool so it is a real pond.
function pond(e, T, W) {
  T.setMouse(e);
  const hit = T.pick(['terrain']);
  if (!hit) return;
  const xs = [hit.point.x];
  if (T.mirrored(hit.point.x, T.brush.size * 0.5)) xs.push(-hit.point.x);
  for (const x of xs) W.water.fillAt(x, hit.point.z);
  W.plants.onWaterChanged(W);
}

// --- The per-frame clamp and the per-second guardian ---------------------------------------------------------------
function frame(g) {
  if (!S.kids.value || !g.world) return;
  for (const id in g.world.animals.by) {
    if (id === 'eggs') continue;
    for (const a of g.world.animals.by[id]) if (a.health < MIN_HEALTH) a.health = MIN_HEALTH;
  }
}

function tick(g, dt) {
  if (!S.kids.value || S.screen.value !== 'play' || !g.world) return;
  acc += dt;
  if (acc < 1) return;
  const sec = acc; acc = 0;
  const W = g.world, E = W.env, now = performance.now(), lapse = g.lapse > 0;
  if (ctx.director?.events) ctx.director.events.enabled = false;
  const list = pets(W);

  // Hunger builds a little faster than real time so that feeding matters within minutes.
  for (const a of list) {
    if (a.sp === 'tadpole') continue;
    a.hunger = lapse ? Math.min(a.hunger, 0.45) : Math.min(1, a.hunger + HUNGER_PER_SECOND * sec);
  }
  const A = assess(W);

  // Light goes back to the day and night timer a couple of minutes after the child used the switch.
  if (E.lights !== 'auto' && now - lightAt > 120000) { E.lights = 'auto'; K.light.value = 'auto'; }
  if (E.lights === 'auto') { E.lightsOn = 8 * 60; E.lightsOff = 20 * 60; }

  // The care helper (and the time-lapse) keep the tank safe.
  if (K.helper.value || lapse) {
    if (A.n && Object.keys(A.hungry).length) {
      const land = Object.keys(A.hungry).some((id) => !SPECIES[id].eats?.includes('flake'));
      if (now - last.feed > 20000) { last.feed = now; Care.feed(g); for (const id in A.hungry) for (const a of A.hungry[id]) a.hunger = Math.max(0, a.hunger - 0.4); }
      if (land && now - last.flies > 40000 && (W.animals.by.fly?.length ?? 0) < 25) { last.flies = now; Care.flies(g); }
    }
    if (A.dirty && now - last.water > 45000) { last.water = now; Care.waterChange(g); E.ammonia *= 0.4; E.nitrite *= 0.4; }
    if (A.dry && now - last.mist > 25000) { last.mist = now; Care.mist(g); }
  }

  // The happy meter rises fast when you help and falls slowly when you forget.
  const k = A.happy > K.happy.value ? 0.45 : 0.12;
  K.happy.value += (A.happy - K.happy.value) * k;
  K.mood.value = K.happy.value >= 0.72 ? 'happy' : K.happy.value >= 0.45 ? 'ok' : 'sad';

  watchBabies(W);
  stickers(W);
  story(W, sec);
  guide(W, A, now);

  if (!lapse && now - saveT > 30000) { saveT = now; save(); }
  K.sound.value = ctx.audio?.on ?? true;
  K.light.value = E.lights;
}

function watchBabies(W) {
  const cur = allAnimals(W);
  if (!known) { known = new Set(cur.map((a) => a.id)); return; }
  const fresh = [];
  for (const a of cur) if (!known.has(a.id)) { known.add(a.id); if (!NOT_PETS.has(a.sp) && a.age < 2 * 1440) fresh.push(a); }
  if (!fresh.length) return;
  const sp = fresh[0].sp;
  const who = (kidAnimal(sp)?.n ?? one(sp)).toLowerCase();
  const text = fresh.length > 1 ? 'Baby animals!' : SAY.baby(who);
  K.banner.value = { text, n: toastN++ };
  K.confetti.value++;
  celebrate = { text, until: performance.now() + 6000 };
  earn('baby');
  const b = K.banner.value;
  setTimeout(() => { if (K.banner.value === b) K.banner.value = null; }, 4200);
}

function stickers(W) {
  if (list(W).length - (session.pets ?? 0) >= 3) earn('busy');
  if (W.plants.list.length - (session.plants ?? 0) >= 5) earn('forest');
  if (K.happy.value >= 0.95 && session.cared >= 1) earn('happy');
  if (S.timelapse.value?.done) earn('lapse');
}
const list = (W) => pets(W);

const ACT_LABEL = { animals: 'Animals', plants: 'Plants', build: 'Build', care: 'Care', more: 'More' };
// The story: the current chapter's challenges are checked against the same metrics career reads.
function story(W, sec) {
  if (!currentChallenge(K.story.value)) return;
  let m;
  try { m = computeMetrics(W); } catch { return; }
  // Cup plants (same rule as game/metrics.js features.bromeliad2), so the story counts the ones the child adds.
  const cups = Object.entries(m.plants?.byId ?? {}).reduce((s, [id, c]) => s + (id === 'bromeliad' || PLANTS[id]?.phytotelma ? c : 0), 0);
  const r = storyStep(K.story.value, m, { fed: K.fed.value, cups }, sec);
  if (r.p === K.story.value) return;
  K.story.value = r.p;
  for (const e of r.events) {
    if (e.type === 'challenge') kToast(`Done: ${e.x.text}`, 'good', 2600);
    else { earn(e.ch.sticker); const b = (K.banner.value = { text: `${e.ch.title}: done!`, n: toastN++ }); K.confetti.value++; setTimeout(() => { if (K.banner.value === b) K.banner.value = null; }, 4200); }
  }
  if (r.events.length) persist();
}
export function restartStory() { K.story.value = newProgress(); persist(); }

// The guide: one friendly suggestion at a time. It keeps a line for a few seconds so it never flickers.
function guide(W, A, now) {
  const have = (id) => !!K.stickers.value[id];
  let key, text, act = null;
  if (celebrate && now < celebrate.until) { key = 'cheer:' + celebrate.text; text = celebrate.text; }
  else if (!A.n) { key = 'noAnimals'; text = SAY.noAnimals; act = { label: 'Animals', run: 'animals' }; }
  else if (Object.keys(A.hungry).length) {
    const ids = Object.keys(A.hungry), one1 = ids.length === 1 && A.hungry[ids[0]].length === 1;
    const who = ids.length === 1 ? (one1 ? animalName(ids[0], 'pet').toLowerCase() : animalPlural(ids[0], 'pets')) : 'pets';
    key = 'hungry'; text = one1 ? SAY.hungryOne(who) : SAY.hungry(who); act = { label: 'Feed', run: 'feed' };
  }
  else if (A.dirty) { key = 'dirty'; text = SAY.dirty; act = { label: 'Clean', run: 'clean' }; }
  else if (A.dry) { key = 'dry'; text = SAY.dry; act = { label: 'Rain', run: 'rain' }; }
  else if (K.happy.value < 0.5 && !K.helper.value) { key = 'helper'; text = SAY.helper; act = { label: 'Care', run: 'care' }; }
  else if (currentChallenge(K.story.value)) { const { x } = currentChallenge(K.story.value); key = 'story:' + x.id; text = x.text; act = { label: ACT_LABEL[x.act] ?? 'Story', run: x.act ?? 'story' }; }
  else if (W.plants.list.length < 3) { key = 'plants'; text = SAY.plants; act = { label: 'Plants', run: 'plants' }; }
  else if (!have('build')) { key = 'build'; text = SAY.build; act = { label: 'Build', run: 'build' }; }
  else if (!have('rain')) { key = 'rain'; text = SAY.rain; act = { label: 'Rain', run: 'rain' }; }
  else if (!have('named')) { key = 'name'; text = SAY.name; }
  else if (!have('photo')) { key = 'photo'; text = SAY.photo; act = { label: 'Photo', run: 'photo' }; }
  else if (!have('twin')) { key = 'twin'; text = SAY.twin; act = { label: 'Build', run: 'build' }; }
  else if (!have('lapse')) { key = 'lapse'; text = SAY.lapse; act = { label: 'More', run: 'more' }; }
  else { const i = Math.floor(now / 15000) % SAY.cheer.length; key = 'cheer' + i; text = SAY.cheer[i]; }
  if (key === guideKey) return;
  const urgent = key === 'hungry' || key === 'dirty' || key.startsWith('cheer:');
  if (now - guideAt < 6000 && !urgent) return;
  guideKey = key; guideAt = now;
  K.guide.value = { text, act };
}

export function act(name) {
  if (['animals', 'plants', 'build', 'care', 'more', 'story'].includes(name)) { stopPlace(); K.sheet.value = name; }
  else if (name === 'feed') feed();
  else if (name === 'rain') { rain(); }
  else if (name === 'clean') clean();
  else if (name === 'photo') openPhoto();
}

// --- Photo and time-lapse ---------------------------------------------------------------------------------------------
export function openPhoto() { stopPlace(); K.sheet.value = null; S.selection.value = null; S.photo.value = true; }
export function closePhoto() { S.photo.value = false; }

export function snapPhoto() {
  const g = ctx.game;
  g.gfx.render();
  g.renderer.domElement.toBlob((blob) => {
    if (!blob) { kToast('Oops! Try again.', 'bad'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `my-world-day${g.world.env.day + 1}.png`;
    document.body.append(a); a.click(); a.remove();
    earn('photo');
    kToast('Click! Photo saved.', 'good');
  }, 'image/png');
}

export function startLapse() { stopPlace(); K.sheet.value = null; S.selection.value = null; startTimelapse(5); }

export function lapseLines(t) {
  const W = ctx.game?.world;
  if (!W || !t?.before) return [];
  const a = t.before, out = [];
  const plants = W.plants.list.length - a.plants;
  const animals = Object.values(W.animals.by).reduce((s, x) => s + x.length, 0) - a.animals;
  const babies = W.stats.births - a.births;
  if (plants > 0) out.push(plants === 1 ? '1 new plant grew' : `${plants} new plants grew`);
  if (babies > 0) out.push(babies === 1 ? 'A baby was born' : 'Babies were born');
  else if (animals > 0) out.push('New little animals appeared');
  if (!out.length) out.push('Everything stayed cozy');
  return out;
}

// --- Entering, leaving, saving -------------------------------------------------------------------------------------
export function enter() {
  const g = ctx.game;
  S.kids.value = true;
  document.documentElement.classList.add('kids-on');
  if (ctx.director?.events) ctx.director.events.enabled = false;
  g.setSpeed(1);
  session = { cared: 0, pets: g.world ? pets(g.world).length : 0, plants: g.world ? g.world.plants.list.length : 0 };
  K.place.value = null; K.sheet.value = null; K.banner.value = null; K.pop.value = null;
  undoStack.length = 0; K.undoN.value = 0;
  known = null; snap = null; celebrate = null; guideKey = ''; guideAt = 0; acc = 0; saveT = performance.now();
  S.mirror.value = false;
  S.photo.value = false;
  ctx.tools?.setTool('view'); ctx.tools?.select(null);
  const E = g.world?.env;
  if (E) { E.lights = 'auto'; E.lightsOn = 8 * 60; E.lightsOff = 20 * 60; K.light.value = 'auto'; }
  if (g.world) { K.happy.value = assess(g.world).happy; K.guide.value = { text: SAY.start }; }
  K.sound.value = ctx.audio?.on ?? true;
  const el = g.renderer.domElement;
  if (attached !== el) {
    attached?.removeEventListener('pointerdown', onDownCapture, true);
    attached?.removeEventListener('pointerdown', onDownAfter);
    el.addEventListener('pointerdown', onDownCapture, true);
    el.addEventListener('pointerdown', onDownAfter);
    attached = el;
  }
}

export function leave() {
  S.kids.value = false;
  document.documentElement.classList.remove('kids-on');
  K.place.value = null; K.sheet.value = null;
  if (ctx.director?.events) ctx.director.events.enabled = true;
  const T = ctx.tools;
  if (T) { T.keys.delete('shift'); T.selectPiece(null); T.select(null); T.setTool('view'); }
  if (S.mirror.value) T?.toggleMirror(false);
}

export async function save() {
  const g = ctx.game;
  if (!S.kids.value || !g?.world) return;
  try {
    const name = S.tankTitle.value ?? 'My world';
    await Saves.put(SLOT, { v: 1, tank: g.tankId, title: S.tankTitle.value, world: g.world.serialize(), at: Date.now() });
    const meta = { name, at: Date.now(), hearts: Math.round(K.happy.value * 5) };
    write(META, meta);
    K.meta.value = meta;
  } catch { /* storage full or blocked: playing on is fine */ }
}

// Back to the title screen; the world is kept in the kids' own slot.
export async function goHome() {
  const g = ctx.game;
  await save();
  leave();
  S.photo.value = false; S.timelapse.value = null; g.lapse = 0;
  S.tankTitle.value = null;
  g.rig.freeZone(); g.setRoom(true);
  await g.loadTank('standard', { layout: 'starter' });
  g.rig.startOrbit(0.04);
  g.rig.view('hero', false);
  S.screen.value = 'title';
}

// Kids' corner's "keep playing": loads the kids' own slot (never the career save).
export async function loadSaved() {
  const data = await Saves.get(SLOT);
  if (!data) return false;
  const g = ctx.game, d = ctx.director;
  d.attach(new Career({ mode: 'sandbox' }));
  await g.loadTank(data.tank ?? 'standard', { save: data.world });
  d.syncGear();
  d.tutorial.finished = true;
  S.tankTitle.value = data.title ?? null;
  d.publish();
  return true;
}

// Grown-up mode: the same tank, the regular HUD. Needs a long press (see the More sheet).
export async function grownUp() {
  await save();
  leave();
}

export const tierForScreen = () => (matchMedia('(max-aspect-ratio: 1/1)').matches || innerWidth < 700 ? 'nano' : 'standard');

export function install(g) {
  if (installed) return;
  installed = true;
  g.frameHooks.push(() => frame(g));
  g.tickHooks.push((dt) => tick(g, dt));
  g.events.on('tank', () => { known = null; snap = null; });
  addEventListener('beforeunload', () => { save(); });
}
