import { Icon } from '../icons.jsx';
import { S, hudRules } from '../store.js';
import { ctx } from '../../app/ctx.js';
import { TOOLS } from '../../tools/defs.js';

export function ToolRail() {
  const cur = S.tool.value;
  const items = [];
  let lastGroup = 0;
  const hud = hudRules();
  for (const t of TOOLS) {
    if (hud.hideTools?.includes(t.id)) continue;
    if (t.group !== lastGroup) { items.push(<div class="sep" key={'s' + t.group} />); lastGroup = t.group; }
    items.push(
      <button key={t.id} class={'tool' + (cur === t.id ? ' on' : '')} title={`${t.name} (${t.key})`} onClick={() => ctx.tools.setTool(cur === t.id && t.id !== 'view' ? 'view' : t.id)}>
        <Icon name={t.icon} size={21} />
        <span class="lb">{hud.toolNames?.[t.id] ?? t.name}</span>
        <kbd>{t.key}</kbd>
      </button>,
    );
  }
  return <div class="rail glass" role="toolbar" aria-label="Tools">{items}</div>;
}
