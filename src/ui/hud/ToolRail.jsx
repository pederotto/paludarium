// The left rail: five grouped tools (Look, Shape, Add, Equipment, Remove), icon and label always visible.
// The groups own the underlying tool ids (tools/defs.js GROUPS); keys 1-9,0 still jump to a specific tool.

import { useEffect } from 'preact/hooks';
import { Icon } from '../icons.jsx';
import { S, hudRules } from '../store.js';
import { ctx } from '../../app/ctx.js';
import { GROUPS, groupOf } from '../../editor/defs.js';
import { R, lastOf, bindAutoCollapse } from './railState.js';
import './rail2.css';

export function ToolRail() {
  const cur = S.tool.value, hud = hudRules(), active = groupOf(cur);
  useEffect(() => bindAutoCollapse(ctx.tools?.controls), []);
  const items = GROUPS.filter((g) => !g.tools.every((t) => hud.hideTools?.includes(t))).map((g) => {
    const on = active.id === g.id;
    return (
      <button key={g.id} data-group={g.id} class={'tool' + (on ? ' on' : '')} aria-pressed={on} title={g.tip}
        onClick={() => {
          const T = ctx.tools; if (!T) return;
          if (g.id === 'look') { T.setTool('view'); return; }
          if (on) { if (S.left.value && !R.collapsed.value) T.setTool('view'); else { S.left.value = true; R.collapsed.value = false; } return; }
          S.left.value = true;
          const t = lastOf(g);
          T.setTool(hud.hideTools?.includes(t) ? g.tools.find((x) => !hud.hideTools?.includes(x)) : t);
        }}>
        <Icon name={g.icon} size={22} />
        <span class="lb">{g.name}</span>
      </button>
    );
  });
  return <div class="rail" role="toolbar" aria-label="Tools">{items}</div>;
}
