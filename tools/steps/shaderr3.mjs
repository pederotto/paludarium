// Open the Kids Animals sheet and print every console message (any type) in order, to find the root shader error.
export default async (page, shot, name) => {
  if (name !== 'desktop') return;
  const msgs = [];
  page.on('console', (m) => msgs.push(m.type() + ': ' + m.text().slice(0, 1500)));
  await page.getByRole('button', { name: /Kids' corner/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(800);
  await page.locator('.kw-card', { hasText: /Frog Island/ }).click({ force: true });
  await page.waitForFunction(() => document.querySelector('.k-tray'), null, { timeout: 90000 });
  await page.waitForTimeout(3500);
  const n0 = msgs.length;
  await page.locator('.k-tab', { hasText: 'Animals' }).click({ force: true });
  await page.waitForTimeout(3000);
  console.log('BEFORE', n0, 'AFTER', msgs.length);
  for (const m of msgs.slice(n0, n0 + 4)) console.log('----\n' + m);
};
