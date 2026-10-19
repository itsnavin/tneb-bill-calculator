import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateHistorical, parseUnits, validateTariff } from '../src/calculator.js';
import { sourceHealth, MAX_CHECK_AGE_MS } from '../src/freshness.js';

const tariff = JSON.parse(await readFile('data/tariff.json', 'utf8'));
const oracle = JSON.parse(await readFile('tests/official-oracles.json', 'utf8'));
const calculate = value => calculateHistorical(value, tariff, { historicalConsent: true });
for (const [units, expected] of oracle.cases) {
  test(`official-table independent oracle: ${units} kWh = ${expected} paise`, () => {
    assert.equal(calculate(units).totalPaise, expected);
  });
}
test('reviewed consumer rates and whole-consumption branch are exact', () => {
  assert.deepEqual(calculate('500').rows.map(r => [r.units, r.ratePaise]), [[100, 0], [100, 0], [200, 470], [100, 630]]);
  assert.deepEqual(calculate('501').rows.map(r => [r.units, r.ratePaise]), [[100, 0], [300, 470], [100, 630], [1, 840]]);
  assert.equal(calculate('500').freeUnits, 200);
  assert.equal(calculate('501').freeUnits, 100);
  assert.equal(calculate('500').approvedPaise, 264500);
  assert.equal(calculate('500').subsidyPaise, 107500);
  assert.equal(calculate('0').rows.length, 0);
});
test('integer-hundredth arithmetic handles decimals without floating drift', () => {
  assert.equal(parseUnits(' 000200.01 '), 20001);
  assert.equal(calculate('100000').totalPaise, 115032000);
});
test('free and chargeable units reflect government benefit conditions and actual consumption', () => {
  for (const [units, free, chargeable] of [
    ['0', 0, 0], ['99.99', 99.99, 0], ['100', 100, 0],
    ['199.99', 199.99, 0], ['200', 200, 0], ['200.01', 200, 0.01],
    ['499.99', 200, 299.99], ['500', 200, 300],
    ['500.01', 100, 400.01], ['501', 100, 401], ['1000', 100, 900]
  ]) {
    const bill = calculate(units);
    assert.equal(bill.freeUnits, free);
    assert.equal(bill.chargeableUnits, chargeable);
    assert.equal(Math.round((bill.freeUnits + bill.chargeableUnits) * 100), parseUnits(units));
  }
  assert.equal(calculate('500').subsidyPaise - calculate('501').subsidyPaise, 46960);
});
test('invalid, nonfinite, negative, excessive and overprecision inputs are visible errors', () => {
  for (const input of ['', ' ', '-1', '+1', 'NaN', NaN, Infinity, '-Infinity', '1e3', '0x10', '.5', '1.', '1,000', '200.001', '100000.01', '999999', null, undefined, '<script>']) {
    assert.throws(() => calculate(input), /Enter/);
  }
});
test('no current-rate API fallback and explicit historical consent required', () => {
  assert.equal(tariff.currentApproved, false);
  assert.equal(tariff.lastHumanVerifiedAt, null);
  assert.throws(() => calculateHistorical('350', tariff), /historical/);
  assert.throws(() => calculateHistorical('350', tariff, { historicalConsent: false }), /historical/);
});
test('invalid tariff payloads fail closed', () => {
  for (const mutate of [
    t => { t.rules[0].bands[0].subsidyPaise = 600; },
    t => { t.rules[0].bands[1].upTo = 90; },
    t => { t.rules[1].bands.at(-1).upTo = 1001; },
    t => { t.rules[0].bands[0].approvedPaise = 4.95; },
    t => { t.rules[0].bands = []; },
    t => { t.billingCycle = 'monthly'; },
    t => { t.rules[0].maxTotalUnits = 1000; },
    t => { t.fixedChargePaise = 100; },
    t => { t.effectiveFrom = '2030-01-01'; }
  ]) {
    const clone = structuredClone(tariff);
    mutate(clone);
    assert.throws(() => validateTariff(clone), /Invalid reviewed tariff/);
  }
  assert.throws(() => validateTariff(null));
});
test('stale, missing, future and failed source checks never claim freshness', () => {
  const now = Date.parse('2026-10-19T20:00:00Z');
  assert.equal(sourceHealth(null, now).kind, 'unavailable');
  assert.equal(sourceHealth({ checkedAt: 'invalid' }, now).kind, 'unavailable');
  assert.equal(sourceHealth({ checkedAt: new Date(now + 600_000).toISOString() }, now).kind, 'unavailable');
  assert.equal(sourceHealth({ checkedAt: new Date(now - MAX_CHECK_AGE_MS - 1).toISOString(), result: 'unchanged' }, now).kind, 'stale');
  for (const result of ['error', 'needs-review', 'unchanged']) assert.equal(sourceHealth({ checkedAt: new Date(now).toISOString(), result }, now).kind, result);
  assert.equal(sourceHealth({ checkedAt: new Date(now).toISOString(), result: 'unexpected' }, now).kind, 'unavailable');
});
