// Reactive UI state (Preact signals). The simulation mutates plain objects
// at frame rate; the game shell copies a snapshot into `live` a few times a
// second, and components re-render from these signals.

import { signal } from '@preact/signals';
import { morphList } from '../sim/genetics.js';
import { DEFAULT_MODE, normalizeMode, rules } from '../app/modes.js';

const MODE_KEY = 'paludarium.mode', SMART_KEY = 'paludarium.smart';
const read = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
export const lastMode = () => { const m = normalizeMode(read(MODE_KEY, DEFAULT_MODE)); return m === 'kids' ? DEFAULT_MODE : m; };

export const S = {
  screen: signal('title'),        // 'title' | 'play'
  tool: signal('view'),
  sub: signal({ sculpt: 'raise', paint: 4, water: 'channel', plant: 'fernph', animal: 'neon', rock: 'boulder', gear: 'fogger' }),
  brush: signal({ size: 5, strength: 1 }),
  speed: signal(1),               // index into SPEEDS
  modal: signal(null),            // null | 'codex' | 'studio' | 'lab' | 'care' | 'settings' | 'curator' | 'photo' | ...
  modalArg: signal(null),         // e.g. a codex entry id
  left: signal(true),             // tool options panel open
  right: signal(false),           // status drawer open (remembered between visits on wide screens, see drawerPref)
  live: signal(null),             // snapshot of the tank and career, ~4 Hz
  hint: signal(''),
  toasts: signal([]),
  selection: signal(null),        // { kind: 'animal' | 'plant' | 'pool' | 'piece', obj }
  following: signal(null),        // an animal the camera is tracking
  focusHide: signal(false),       // follow mode: the menu is hidden while following or zoomed in (editor/followmode.js, body.focus-hide)
  layer: signal('surface'),       // view layer: 'surface' | 'xray' | 'bottom' (render/layers.js)
  lens: signal('off'),            // 'off' | 'humidity' | 'temperature' | 'light' | 'soil' | 'flow'
  piece: signal(null),            // selected hardscape piece
  pieceMode: signal('translate'),
  undoDepth: signal(0),
  guides: signal(false),          // composition guides (rule of thirds)
  photo: signal(false),
  kids: signal(false),            // the simplified Kids mode HUD (src/ui/kids)
  mirror: signal(false),          // symmetry: mirror strokes and placements across the tank's centre plane
  timelapse: signal(null),        // null | { days, from, day } while a time-lapse runs
  tankTitle: signal(null),        // name of a generated terrarium, shown under the brand
  quality: signal('high'),
  gfxAuto: signal(true),          // the graphics governor may choose the preset (Settings ▸ Auto)
  fpsCap: signal(60),             // frame-rate limit, frames a second (240 = none)
  backend: signal(''),
  fps: signal(0),
  career: signal(null),           // career snapshot (funds, rank, commissions…)
  coach: signal(null),            // a teaching card shown at the bottom
  busy: signal(null),             // { text } while a long thing runs (vacation, time-lapse)
  compact: signal(false),         // small screens
  morph: signal({}),              // the colour morph chosen per species for the Animals tool ('*' = a random wild mix)
  pairing: signal(null),          // an animal waiting to be paired with the next animal you tap
  geneParents: signal([]),        // ids of the two animals shown in the Lab's Genetics tab
  mode: signal(lastMode()),       // the adult mode of this tank: 'explorer' | 'naturalist' (Kids is S.kids); see app/modes.js
  smart: signal(read(SMART_KEY, '0') === '1'),   // Naturalist: the optional 'Smart place' toggle
  hub: signal(null),              // the dock hub whose menu is open: 'tank' | 'build' | 'learn' | 'camera' | null
  hintPulse: signal(0),           // bump to re-show the hint toast
  smartBar: signal(null),         // the floating mini bar after a smart placement: { kind, id, n, adjust } or null
};

// The morph the Animals tool will release for a species: the chosen one, else the first listed, or null for a random mix.
export function morphChoice(id) {
  const v = S.morph.value[id];
  if (v === '*') return null;
  const list = morphList(id);
  return v && list.includes(v) ? v : list[0] ?? null;
}

let toastId = 1;
export function toast(text, kind = 'info', ms = 2800) {
  const t = { id: toastId++, text, kind };
  S.toasts.value = [...S.toasts.value.slice(-3), t];
  setTimeout(() => { S.toasts.value = S.toasts.value.filter((x) => x.id !== t.id); }, ms);
}

export const hint = (text) => { S.hint.value = text; };

export function openModal(name, arg = null) {
  // Explorer keeps the pump, valves and top-up in order itself: the Flow balance panel stays shut.
  if (name === 'flow' && !S.kids.value && rules(S.mode.value).hud.flowPanel === false) { toast('Explorer keeps the pump and water level balanced for you. Switch to Naturalist in Settings to tune the flow.'); return; }
  S.modal.value = name; S.modalArg.value = arg;
}
const DRAWER_KEY = 'paludarium.drawer';
export const drawerPref = () => read(DRAWER_KEY, '0') === '1';
export function saveDrawerPref(v) { try { localStorage.setItem(DRAWER_KEY, v ? '1' : '0'); } catch { /* private window */ } }
export function saveModeChoice(m) { try { if (m !== 'kids') localStorage.setItem(MODE_KEY, m); } catch { /* private window */ } }
export function saveSmart(v) { try { localStorage.setItem(SMART_KEY, v ? '1' : '0'); } catch { /* private window */ } }
// The mode in force: Kids' corner, else the adult mode of this tank.
export const modeId = () => (S.kids.value ? 'kids' : S.mode.value);
export const explorer = () => modeId() === 'explorer';
export const hudRules = () => rules(modeId()).hud;
export function closeModal() { S.modal.value = null; S.modalArg.value = null; }
