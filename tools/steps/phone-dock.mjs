export default async (page, shot, name) => {
  if (name !== 'phone') return;
  await page.getByRole('button', { name: /starter paludarium/i }).click({ force: true, timeout: 90000 });
  await page.waitForTimeout(3000);
  console.log(JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#ui button')].filter((b) => b.offsetParent).map((b) => (b.title || b.textContent.trim()).slice(0, 20) + '@' + Math.round(b.getBoundingClientRect().x) + ',' + Math.round(b.getBoundingClientRect().y)).slice(0, 40))));
};
