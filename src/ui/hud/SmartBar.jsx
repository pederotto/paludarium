// The floating mini bar of the smart placement: after one tap places something, a few big buttons build a whole
// scene (Another, a group of 3 or 5, Adjust, Undo, Done). Undo is always on screen while building.
import { S, modeId } from '../store.js';
import { Icon } from '../icons.jsx';
import { ctx } from '../../app/ctx.js';
import { isSmart } from '../../app/modes.js';
import { SMART_TOOLS } from '../../editor/smart.js';
import '../explorer.css';

const BUILD = ['sculpt', 'paint', 'water'];

export function SmartBar() {
  if (S.kids.value) return null;
  const tool = S.tool.value;
  if (!isSmart(modeId(), S.smart.value) || !(SMART_TOOLS.includes(tool) || BUILD.includes(tool))) return null;
  const T = ctx.tools, sm = T?.smart;
  if (!sm) return null;
  const bar = S.smartBar.value, depth = S.undoDepth.value, sub = S.sub.value;
  const placing = SMART_TOOLS.includes(tool);
  const canUndo = (bar?.undo ?? 0) > 0 || depth > 0;
  const n = sub.smartN ?? 1;
  const has = !!bar?.kind;
  const piece = S.piece.value;
  const panel = !S.compact.value || SMART_TOOLS.includes(tool) || BUILD.includes(tool);
  return (
    <div class={'smartbar' + (panel ? '' : ' nopanel')} role="toolbar" aria-label="Quick build">
      {placing ? (
        <div class="sb-row glass strong">
          <span class="sb-seg"><em>Each tap places</em>
            {[1, 3, 5].map((k) => <button key={k} class={n === k ? 'on' : ''} aria-pressed={n === k} onClick={() => { S.sub.value = { ...S.sub.value, smartN: k }; }}>{k === 1 ? 'One' : k}</button>)}
          </span>
        </div>
      ) : null}
      <div class="sb-row glass strong">
        {placing && has ? (
          <>
            <button class="primary" onClick={() => sm.another()}>Another</button>
            <button onClick={() => sm.group(3)}>Group 3</button>
            <button onClick={() => sm.group(5)}>5</button>
            {bar.adjustable ? <button class={piece ? 'on' : ''} onClick={() => (piece ? sm.put() : sm.adjust())}>{piece ? 'Stop adjusting' : 'Adjust'}</button> : null}
          </>
        ) : null}
        <button disabled={!canUndo} onClick={() => T.undoAny()} aria-label="Undo"><Icon name="undo" size={16} /><span class="lbl">Undo</span></button>
        {placing && has ? <button onClick={() => sm.done()}>Done</button> : null}
      </div>
    </div>
  );
}
