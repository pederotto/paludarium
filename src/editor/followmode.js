// Follow mode (C2): while the camera follows an animal or is zoomed in on a selection, the menu is hidden. Esc or a single tap
// brings the camera back to the pose it had before (saved once, on entering) and the menu back; a double tap or a long press on
// another animal switches the follow to it (home pose kept, menu still hidden). Pure: no imports, no clock, no DOM. The controller
// feeds it events and applies the effects (editor/controller.js, fmStep).
//
// state: { mode: 'free' | 'focus', target: { kind, obj } | null, home: pose | null, pending: { hit, t } | null }
// events: follow { target: animal | null, pose }, zoom { sel, pose }, esc, tap { hit: sel | null, t (e.timeStamp) },
//         dbl { hit }, long { hit }, timeout (the 'wait' effect elapsed), lost (the followed animal died or the selection went)
// effects: hideMenu, showMenu, restoreHome { pose }, select { sel }, follow { obj }, wait { ms }
// Taps in free are never delayed (no effects: the controller selects as before). In focus only a tap on another animal waits
// DBL_MS for a second tap; anything else acts at once.

export const DBL_MS = 300;
export const LONG_MS = 500;
export const FREE = Object.freeze({ mode: 'free', target: null, home: null, pending: null });

const animal = (obj) => ({ kind: 'animal', obj });
const isOther = (s, hit) => hit?.kind === 'animal' && !!hit.obj && hit.obj !== s.target?.obj;
const none = (state) => ({ state, fx: [] });

function enter(target, pose) {
  return {
    state: { mode: 'focus', target, home: pose ?? null, pending: null },
    fx: [{ type: 'hideMenu' }, { type: 'select', sel: target }, { type: 'follow', obj: target.kind === 'animal' ? target.obj : null }],
  };
}

// Back to free: the camera flies home, the menu comes back. `sel` undefined leaves the selection as it is.
function exit(s, sel) {
  const fx = [{ type: 'restoreHome', pose: s.home }, { type: 'showMenu' }, { type: 'follow', obj: null }];
  if (sel !== undefined) fx.push({ type: 'select', sel });
  return { state: FREE, fx };
}

// Switch the follow (or the zoom) to another target: home kept, menu stays hidden.
function retarget(s, target) {
  return {
    state: { ...s, target, pending: null },
    fx: [{ type: 'follow', obj: target.kind === 'animal' ? target.obj : null }, { type: 'select', sel: target }],
  };
}

export function step(s, ev) {
  if (s.mode !== 'focus') {
    if (ev.type === 'follow') return ev.target ? enter(animal(ev.target), ev.pose) : { state: s, fx: [{ type: 'follow', obj: null }] };
    if (ev.type === 'zoom' && ev.sel) return enter(ev.sel, ev.pose);
    return none(s);
  }
  switch (ev.type) {
    case 'esc': return exit(s, null);
    case 'lost': return exit(s);
    case 'follow':
      if (!ev.target) return exit(s);
      return ev.target === s.target?.obj ? none(s) : retarget(s, animal(ev.target));
    case 'zoom': return ev.sel ? retarget(s, ev.sel) : none(s);
    case 'tap': {
      const p = s.pending;
      if (p && isOther(s, ev.hit) && ev.hit.obj === p.hit.obj && ev.t - p.t < DBL_MS) return retarget(s, ev.hit);
      if (!p && isOther(s, ev.hit)) return { state: { ...s, pending: { hit: ev.hit, t: ev.t } }, fx: [{ type: 'wait', ms: DBL_MS }] };
      return exit(s, ev.hit ?? null);
    }
    case 'timeout': return s.pending ? exit(s, s.pending.hit) : none(s);
    case 'dbl':
    case 'long': return isOther(s, ev.hit) ? retarget(s, ev.hit) : none(s);
    default: return none(s);
  }
}
