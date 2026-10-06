// The text a tester pastes into a chat: where the lab was, what was in it, what the radar found. Plain lines, no markup.
import { L } from './state.js';
import { snapshot } from './scenario.js';
import { TANKS } from '../content/tanks.js';

const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '—');

export function buildReport(game, driver, radar, obstacles) {
  const W = game.world, A = W.animals, tank = TANKS[game.tankId];
  const lines = [];
  lines.push('PALUDARIUM TEST LAB REPORT');
  lines.push(`page: ${location.href}`);
  lines.push(`graphics: ${game.gfx.backend}, ${game.gfx.quality}, ${Math.round(game.gfx.stats.fps)} fps   device: ${navigator.userAgent.replace(/\s+/g, ' ').slice(0, 90)}`);
  lines.push(`arena: ${tank?.name ?? game.tankId} ${tank?.w}×${tank?.d}×${tank?.h}, ground ${L.ground.value}, water ${L.depth.value ? L.depth.value + ' cm' : 'dry'}, rate ${L.paused.value ? 'paused' : L.rate.value + '×'}, animal clock ${f1(A.t ?? 0)} s`);
  const census = L.census.value.map((c) => `${c.n} ${c.name}`).join(', ');
  if (obstacles?.items.length) lines.push(`obstacles: ${obstacles.items.map((o) => `${o.kind}${o.size ? ' ' + o.size + ' cm' : ` ${o.w}×${o.d}×${o.h}`} at (${f1(o.x)}, ${f1(o.z)})`).join('; ')}`);
  lines.push(`animals: ${A.all.length}${census ? ' (' + census + ')' : ''}`);
  const info = L.info.value;
  if (info) { lines.push(`selected: ${info.name} #${info.id}`); for (const [k, v] of info.rows) lines.push(`  ${k}: ${v}`); }
  const rows = radar.rows();
  lines.push(`bug radar: ${rows.length} ${rows.length === 1 ? 'finding' : 'findings'}`);
  for (const r of rows.slice(0, 40)) lines.push(`  [${f1(r.t)} s] ${r.name} #${r.id} ${r.kind}: ${r.msg}${r.n > 1 ? ` (×${r.n})` : ''}  at (${f1(r.pos[0])}, ${f1(r.pos[1])}, ${f1(r.pos[2])})`);
  lines.push('scenario: ' + JSON.stringify(snapshot(game, driver, obstacles)));
  return lines.join('\n');
}

// Copy to the clipboard; where that is refused (a page without focus, some browsers) the caller shows the text to select by hand.
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
