// Picks a tool through the new grouped rail: click the group button on the left rail, then the tab inside the options card.
// Usage: await pickTool(page, 'plant');   ids: view inspect sculpt paint water rock kits plant animal gear erase
export const GROUP = { view: 'look', inspect: 'look', sculpt: 'shape', paint: 'shape', water: 'shape', rock: 'add', kits: 'add', plant: 'add', animal: 'add', gear: 'gear', erase: 'erase' };
const TAB = new Set(['sculpt', 'paint', 'water', 'rock', 'kits', 'plant', 'animal']);

export async function pickTool(page, id, opts = {}) {
  const force = opts.force ?? true;
  if (id === 'inspect') { await page.evaluate(() => window.__tools.setTool('inspect')); return; }
  const g = GROUP[id];
  const active = await page.evaluate(() => { const t = window.__tools; return { tool: t.tool }; });
  const GROUPS = { view: 'look', inspect: 'look', sculpt: 'shape', paint: 'shape', water: 'shape', rock: 'add', plant: 'add', animal: 'add', gear: 'gear', erase: 'erase' };
  if (GROUPS[active.tool] !== g || (id === 'view')) await page.locator(`.rail .tool[data-group="${g}"]`).click({ force });
  if (TAB.has(id)) {
    // the card may be collapsed to a chip (phones): open it first
    if (await page.locator('.opts.oc-chip').count()) await page.locator('.opts.oc-chip').click({ force });
    await page.locator(`.opts [data-tool="${id}"]`).click({ force });
  }
  await page.waitForTimeout(opts.wait ?? 400);
}
