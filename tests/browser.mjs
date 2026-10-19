import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
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
    assert.match(await page.locator('.subsidy-guide').textContent(), /10 May 2026/);
    assert.match(await page.locator('.subsidy-caution').textContent(), /not current eligibility verification/);
    assert.equal(await page.locator('#calculate').isDisabled(), true);
    assert.equal(await page.locator('#bill-result').isVisible(), false);
    await page.locator('[data-units="500"]').click();
    assert.match(await page.locator('#input-error').textContent(), /unverified/);
    await page.locator('#mode').selectOption('historical');
    await page.locator('#units').fill('500');
    await page.locator('#calculate').click();
    assert.match(await page.locator('#total').textContent(), /1,570.00/);
    assert.equal(await page.locator('#slab-rows tr').count(), 4);
    assert.equal(await page.locator('#free-units').textContent(), '200 kWh');
    assert.equal(await page.locator('#chargeable-units').textContent(), '300 kWh');
    assert.equal(await page.locator('#consumed-units').textContent(), '500 kWh');
    assert.match(await page.locator('#benefit-condition').textContent(), /at most 500/);
    const downloadEvent = page.waitForEvent('download');
    await page.locator('#download').click();
    const download = await downloadEvent;
    assert.match(download.suggestedFilename(), /^historical-energy-500-kwh/);
    const itemization = await readFile(await download.path(), 'utf8');
    assert.match(itemization, /Government free units applied: 200 kWh; chargeable units: 300 kWh/);
    assert.match(itemization, /NOT CURRENT/);
    await page.locator('[data-units="501"]').click();
    assert.match(await page.locator('#total').textContent(), /2,048.40/);
    assert.equal(await page.locator('#free-units').textContent(), '100 kWh');
    assert.equal(await page.locator('#chargeable-units').textContent(), '401 kWh');
    assert.match(await page.locator('#benefit-condition').textContent(), /Units 101-200 are chargeable/);
    await page.locator('#units').fill('-1');
    assert.equal(await page.locator('#bill-result').isVisible(), false);
    await page.locator('#calculate').click();
    assert.match(await page.locator('#input-error').textContent(), /Enter/);
    await page.locator('#mode').selectOption('current');
    assert.equal(await page.locator('#calculate').isDisabled(), true);
    await page.locator('#mode').selectOption('historical');
    await page.locator('[data-units="100"]').click();
    assert.match(await page.locator('#total').textContent(), /0.00/);
    assert.equal(await page.locator('#free-units').textContent(), '100 kWh');
    assert.equal(await page.locator('#chargeable-units').textContent(), '0 kWh');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal page overflow');
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: `test-results/desktop-${viewport.width}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    await page.close();
  }
  const page = await browser.newPage();
  await page.route('**/data/status.json*', route => route.abort());
  await page.goto(base);
  await page.locator('#source-list li').first().waitFor();
  await page.waitForFunction(() => document.querySelector('#monitor-summary').textContent.includes('unavailable'));
  assert.equal(await page.locator('#calculate').isDisabled(), true);
  await page.unroute('**/data/status.json*');
  await page.route('**/data/status.json*', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ checkedAt: '2020-01-01T00:00:00Z', result: 'unchanged' })
  }));
  await page.locator('#refresh').click();
  await page.waitForFunction(() => document.querySelector('#monitor-summary').textContent.includes('stale'));
  const checkedAt = await page.locator('#checked-at').textContent();
  await page.locator('#refresh').click();
  await page.waitForFunction(() => document.querySelector('#status-loaded-at').textContent.includes('Published result loaded'));
  assert.equal(await page.locator('#checked-at').textContent(), checkedAt, 'Reload does not advance official-check timestamp');
  assert.match(await page.locator('#refresh-help').textContent(), /this public page cannot start one/);
  await page.unroute('**/data/status.json*');
  await page.route('**/data/status.json*', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ checkedAt: new Date().toISOString(), result: 'error', lastSuccessfulFetchAt: '2020-01-01T00:00:00Z', errors: ['Official source connection timed out'] })
  }));
  await page.locator('#refresh').click();
  await page.waitForFunction(() => document.querySelector('#monitor-summary').textContent.includes('failed'));
  assert.match(await page.locator('#monitor-issues').textContent(), /connection timed out/);
  assert.equal(await page.locator('#calculate').isDisabled(), true);
  await page.unroute('**/data/status.json*');
  await page.route('**/data/status.json*', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ checkedAt: new Date().toISOString(), result: 'unchanged' })
  }));
  await page.locator('#refresh').click();
  await page.waitForFunction(() => document.querySelector('#monitor-summary').textContent.includes('unchanged'));
  assert.equal(await page.locator('#calculate').isDisabled(), true, 'Fresh source health never approves current rates');
  await page.context().setOffline(true);
  await page.waitForFunction(() => document.querySelector('#network-status').textContent.includes('offline'));
  await page.close();
  console.log(`Desktop 1440, mobile 390/320, historical consent, 500/501, validation, download, failed/stale/offline status passed: ${base}`);
} finally {
  await browser.close();
  await new Promise(r => server.close(r));
}
