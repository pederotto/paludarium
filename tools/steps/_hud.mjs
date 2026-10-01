// Helpers for the HUD v2 dock: items live in popovers (data-hub="tank|build|learn|camera").
export async function hubItem(page, hub, title) {
  await page.locator(`.dock2 [data-hub="${hub}"]`).click({ force: true, timeout: 60000 });
  await page.waitForTimeout(350);
  await page.locator(`.hubmenu [title="${title}"]`).first().click({ force: true, timeout: 60000 });
}
// Which hub holds which dock item (the old flat dock had Care, Lab, Field guide, Studio).
export const HUB_OF = { Care: 'tank', Lab: 'tank', Score: 'tank', Studio: 'build', Kits: 'build', 'Tanks and sizes': 'build', 'Field guide': 'learn', Commissions: 'learn', 'Photo mode': 'camera' };
export const openDockItem = (page, title) => hubItem(page, HUB_OF[title], title);
