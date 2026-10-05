// X-B1 checker helpers: start the game through the title button, compose screenshots into one image.
export const OUT = process.env.XB1_OUT || 'test-output/xb1';
export async function start(page, re) {
  page.on('framenavigated', (fr) => { if (fr === page.mainFrame()) console.log('!! page reloaded during the run'); });
  await page.getByRole('button', { name: re }).first().click();
  await page.waitForFunction(() => window.__S?.screen.value === 'play', null, { timeout: 120000 });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('gone'), null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  const m = await page.evaluate(() => { try { return !!window.__S.modal.value; } catch { return false; } });
  if (m) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
}
export async function grid(page, items, cols, w, file) {
  const p2 = await page.context().newPage();
  const html = `<html><body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${cols},${w}px);gap:3px">` + items.map(([b, l]) => `<div style="position:relative"><img style="display:block;width:${w}px" src="data:image/png;base64,${b.toString('base64')}"><div style="position:absolute;left:4px;top:4px;background:#000b;color:#fff;font:bold 15px sans-serif;padding:2px 6px">${l}</div></div>`).join('') + '</body></html>';
  await p2.setViewportSize({ width: cols * (w + 3), height: 300 });
  await p2.setContent(html); await p2.waitForTimeout(300);
  await p2.screenshot({ path: file, fullPage: true }); await p2.close();
  console.log('composite', file);
}
