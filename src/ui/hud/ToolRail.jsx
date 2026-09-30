import { Icon } from '../icons.jsx';
import { S } from '../store.js';
import { ctx } from '../../app/ctx.js';
import { TOOLS } from '../../tools/defs.js';

export function ToolRail() {
  const cur = S.tool.value;
  const items = [];
  let lastGroup = 0;
  for (const t of TOOLS) {
    if (t.group !== lastGroup) { items.push(<div class="sep" key={'s' + t.group} />); lastGroup = t.group; }
    items.push(
      <button key={t.id} class={'tool' + (cur === t.id ? ' on' : '')} title={`${t.name} (${t.key})`} onClick={() => ctx.tools.setTool(cur === t.id && t.id !== 'view' ? 'view' : t.id)}>
        <Icon name={t.icon} size={21} />
        <span class="lb">{t.name}</span>
        <kbd>{t.key}</kbd>
      </button>,
    );
  }
  return <div class="rail glass" role="toolbar" aria-label="Tools">{items}</div>;
}
