import { calculateHistorical, money, validateTariff } from './calculator.js';
import { sourceHealth } from './freshness.js';

const byId = id => document.getElementById(id);
let tariff;
let evidence;
let status;
let latestBill;
const date = value => value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZoneName: undefined }) : 'None recorded';
const text = (id, value) => { byId(id).textContent = value; };
const formatDate = value => value ? `${date(value)} (your local time)` : 'None recorded';

async function readJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Unable to load ${path}: HTTP ${response.status}`);
  return response.json();
}

function clearResult() {
  latestBill = null;
  byId('bill-result').hidden = true;
  byId('empty-result').hidden = false;
}

function updateMode() {
  clearResult();
  text('input-error', '');
  const historical = byId('mode').value === 'historical';
  byId('calculate').disabled = !tariff || !evidence || !historical;
  text('calculate', historical ? 'Illustrate historical energy charges' : 'Current rates need review');
}

function showStatus() {
  const health = sourceHealth(status);
  text('monitor-summary', health.text);
  byId('monitor-summary').dataset.kind = health.kind;
  text('network-status', navigator.onLine ? '' : 'You are offline. Published monitoring data cannot be refreshed; this is not a live official-source check.');
  text('checked-at', formatDate(status?.checkedAt));
  text('last-success', formatDate(status?.lastSuccessfulFetchAt));
  text('coverage', status?.coverage || 'Monitoring status could not be loaded; coverage and freshness are unknown.');
  const issues = byId('monitor-issues');
  issues.replaceChildren();
  for (const issue of [...(status?.errors || []), ...(status?.changes || [])]) {
    const li = document.createElement('li');
    li.textContent = issue;
    issues.append(li);
  }
  const run = byId('run-link');
  run.hidden = !status?.runUrl;
  if (status?.runUrl?.startsWith('https://github.com/itsnavin/tneb-bill-calculator/actions/runs/')) run.href = status.runUrl;
}

async function refreshStatus() {
  byId('refresh').disabled = true;
  try {
    status = await readJson('./data/status.json');
    showStatus();
  } catch (error) {
    status = null;
    showStatus();
    text('monitor-summary', `${error.message}. Monitoring unavailable; current rates remain blocked.`);
  } finally {
    byId('refresh').disabled = false;
  }
}

byId('bill-form').addEventListener('submit', event => {
  event.preventDefault();
  clearResult();
  try {
    if (!tariff || !evidence) throw new Error('Reviewed historical evidence is unavailable.');
    const bill = calculateHistorical(byId('units').value, tariff, { historicalConsent: byId('mode').value === 'historical' });
    text('input-error', '');
    byId('units').removeAttribute('aria-invalid');
    text('total', money(bill.totalPaise));
    text('result-summary', `${bill.units} kWh / two months. Rates effective 10 May 2026; illustration limited to 30 June 2026. Not valid as a current estimate.`);
    text('approved-total', money(bill.approvedPaise));
    text('subsidy-total', money(bill.subsidyPaise));
    text('free-units', `${bill.freeUnits} kWh`);
    const body = byId('slab-rows');
    body.replaceChildren();
    for (const row of bill.rows) {
      const tr = document.createElement('tr');
      for (const cell of [`>${row.from} to ${row.to}`, row.units, money(row.ratePaise), money(row.amountPaise)]) {
        const td = document.createElement('td');
        td.textContent = cell;
        tr.append(td);
      }
      body.append(tr);
    }
    latestBill = bill;
    byId('bill-result').hidden = false;
    byId('empty-result').hidden = true;
  } catch (error) {
    text('input-error', error.message);
    byId('units').setAttribute('aria-invalid', 'true');
  }
});
byId('mode').addEventListener('change', updateMode);
byId('units').addEventListener('input', () => {
  clearResult();
  text('input-error', '');
  byId('units').removeAttribute('aria-invalid');
});
document.querySelectorAll('[data-units]').forEach(button => button.addEventListener('click', () => {
  byId('units').value = button.dataset.units;
  clearResult();
  if (byId('mode').value === 'historical') byId('bill-form').requestSubmit();
  else text('input-error', 'Current rates are unverified. Choose the historical schedule explicitly to use these examples.');
}));
byId('refresh').addEventListener('click', refreshStatus);
window.addEventListener('online', showStatus);
window.addEventListener('offline', showStatus);
setInterval(showStatus, 60_000);
byId('download').addEventListener('click', () => {
  if (!latestBill) return;
  const bill = latestBill;
  const lines = [
    'TAMIL NADU LT I-A HISTORICAL ENERGY ILLUSTRATION - NOT CURRENT OR AN OFFICIAL BILL',
    'Schedule: 10 May to 30 June 2026. Standard two-month domestic household only.',
    `Consumption: ${bill.units} kWh`,
    ...bill.rows.map(row => `>${row.from} to ${row.to} kWh: ${row.units} x ${money(row.ratePaise)} = ${money(row.amountPaise)} (approved ${money(row.approvedRatePaise)}/unit less subsidy ${money(row.subsidyRatePaise)}/unit)`),
    `Approved energy: ${money(bill.approvedPaise)}`,
    `Energy subsidy: ${money(bill.subsidyPaise)}`,
    `Consumer energy: ${money(bill.totalPaise)}; free units: ${bill.freeUnits}; fixed charge: nil.`,
    tariff.rounding,
    'Excludes taxes, arrears, deposits, penalties, meter adjustments, solar, mixed/prorated cycles and account-specific eligibility.',
    `Evidence review: ${evidence.reviewedAt}; human verification: none recorded.`,
    `Monitor attempt: ${status?.checkedAt || 'unavailable'}; result: ${sourceHealth(status).text}`,
    ...evidence.documents.map(doc => `${doc.title}: ${doc.url} SHA-256 ${doc.sha256}`)
  ];
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = `historical-energy-${bill.units}-kwh.txt`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

async function initialize() {
  try {
    [tariff, evidence] = await Promise.all([readJson('./data/tariff.json'), readJson('./data/evidence.json')]);
    validateTariff(tariff);
    if (!evidence.documents?.length || !evidence.reviewedAt) throw new Error('Historical evidence payload is invalid');
    text('blocker', tariff.currentBlocker);
    text('reviewed-at', `${formatDate(evidence.reviewedAt)} - assistant review`);
    const list = byId('source-list');
    for (const source of evidence.documents) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = source.url; a.textContent = source.title;
      const small = document.createElement('small');
      small.textContent = `Effective from ${source.effectiveFrom}; evidence pages ${source.pages.join(', ')}. SHA-256 recorded in provenance.`;
      li.append(a, small); list.append(li);
    }
    updateMode();
  } catch (error) {
    tariff = null; evidence = null;
    text('blocker', `${error.message}. All calculation is blocked.`);
    text('input-error', 'Historical tariff evidence could not be loaded. Reload when available.');
  }
}
await Promise.all([initialize(), refreshStatus()]);
