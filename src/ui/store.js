// Reactive UI state (Preact signals). The simulation mutates plain objects
// at frame rate; the game shell copies a snapshot into `live` a few times a
// second, and components re-render from these signals.

import { signal } from '@preact/signals';

export const S = {
  screen: signal('title'),        // 'title' | 'play'
  tool: signal('view'),
  sub: signal({ sculpt: 'raise', paint: 4, water: 'channel', plant: 'fernph', animal: 'neon', rock: 'boulder', gear: 'fogger' }),
  brush: signal({ size: 5, strength: 1 }),
  speed: signal(1),               // index into SPEEDS
  modal: signal(null),            // null | 'codex' | 'studio' | 'lab' | 'care' | 'settings' | 'curator' | 'photo' | ...
  modalArg: signal(null),         // e.g. a codex entry id
  left: signal(true),             // tool options panel open
  right: signal(true),            // vitals panel open
  live: signal(null),             // snapshot of the tank and career, ~4 Hz
  hint: signal(''),
  toasts: signal([]),
  selection: signal(null),        // { kind: 'animal' | 'plant' | 'pool' | 'piece', obj }
  following: signal(null),        // an animal the camera is tracking
  lens: signal('off'),            // 'off' | 'humidity' | 'temperature' | 'light' | 'soil' | 'flow'
  piece: signal(null),            // selected hardscape piece
  pieceMode: signal('translate'),
  undoDepth: signal(0),
  guides: signal(false),          // composition guides (rule of thirds)
  photo: signal(false),
  tankTitle: signal(null),        // name of a generated terrarium, shown under the brand
  quality: signal('high'),
  backend: signal(''),
  fps: signal(0),
  career: signal(null),           // career snapshot (funds, rank, commissions…)
  coach: signal(null),            // a teaching card shown at the bottom
  busy: signal(null),             // { text } while a long thing runs (vacation, time-lapse)
  compact: signal(false),         // small screens
};

let toastId = 1;
export function toast(text, kind = 'info', ms = 2800) {
  const t = { id: toastId++, text, kind };
  S.toasts.value = [...S.toasts.value.slice(-3), t];
  setTimeout(() => { S.toasts.value = S.toasts.value.filter((x) => x.id !== t.id); }, ms);
}

export const hint = (text) => { S.hint.value = text; };

export function openModal(name, arg = null) { S.modal.value = name; S.modalArg.value = arg; }
export function closeModal() { S.modal.value = null; S.modalArg.value = null; }
