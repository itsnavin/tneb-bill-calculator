import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createSiteServer } from '../scripts/serve.mjs';

const server = createSiteServer();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = process.env.TEST_URL || `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
try {
  for (const viewport of [{ width: 1440, height: 1100 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.locator('#source-list li').first().waitFor();
    assert.equal(await page.locator('#calculate').isDisabled(), true);
    assert.equal(await page.locator('#bill-result').isVisible(), false);
    await page.locator('[data-units="500"]').click();
    assert.match(await page.locator('#input-error').textContent(), /unverified/);
    await page.locator('#mode').selectOption('historical');
    await page.locator('#units').fill('500');
    await page.locator('#calculate').click();
    assert.match(await page.locator('#total').textContent(), /1,570.00/);
    assert.equal(await page.locator('#slab-rows tr').count(), 4);
    const downloadEvent = page.waitForEvent('download');
    await page.locator('#download').click();
    assert.match((await downloadEvent).suggestedFilename(), /^historical-energy-500-kwh/);
    await page.locator('[data-units="501"]').click();
    assert.match(await page.locator('#total').textContent(), /2,048.40/);
    await page.locator('#units').fill('-1');
    assert.equal(await page.locator('#bill-result').isVisible(), false);
    await page.locator('#calculate').click();
    assert.match(await page.locator('#input-error').textContent(), /Enter/);
    await page.locator('#mode').selectOption('current');
    assert.equal(await page.locator('#calculate').isDisabled(), true);
    await page.locator('#mode').selectOption('historical');
    await page.locator('[data-units="100"]').click();
    assert.match(await page.locator('#total').textContent(), /0.00/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal page overflow');
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: `test-results/desktop-${viewport.width}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    await page.close();
  }
  const page = await browser.newPage();
  await page.route('**/data/status.json', route => route.abort());
  await page.goto(base);
  await page.locator('#source-list li').first().waitFor();
  await page.waitForFunction(() => document.querySelector('#monitor-summary').textContent.includes('unavailable'));
  assert.equal(await page.locator('#calculate').isDisabled(), true);
  await page.unroute('**/data/status.json');
  await page.route('**/data/status.json', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ checkedAt: '2020-01-01T00:00:00Z', result: 'unchanged' })
  }));
  await page.locator('#refresh').click();
  await page.waitForFunction(() => document.querySelector('#monitor-summary').textContent.includes('stale'));
  await page.context().setOffline(true);
  await page.waitForFunction(() => document.querySelector('#network-status').textContent.includes('offline'));
  await page.close();
  console.log(`Desktop 1440, mobile 390/320, historical consent, 500/501, validation, download, failed/stale/offline status passed: ${base}`);
} finally {
  await browser.close();
  await new Promise(r => server.close(r));
}
