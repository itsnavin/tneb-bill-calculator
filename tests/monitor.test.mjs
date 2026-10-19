import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { allowUrl, fetchOfficial, extractIndex, observe, compareObservation, makeStatus } from '../scripts/monitor-lib.mjs';
import { indexes, reviewedDocuments } from '../scripts/sources.mjs';

const tnercHtml = `<select id="ddYear"><option selected value="2026">2026</option></select><table id="thetable"><tr><th>Tariff orders</th></tr><tr><td>Order 5 domestic subsidy</td><td><a href="../Orders/files/test.pdf">Domestic subsidy</a></td><td>26/05/2026</td></tr></table>`;
const tnpdclHtml = `<div id="main"><h3>Tariff details</h3><ul><li><a href="/static/tnpdcl/assets/files/test.pdf">Tariff order</a></li></ul></div>`;
const pdf = Buffer.from('%PDF-1.7\nfixture');
const fixtureFetch = async url => ({
  url, bytes: indexes.some(i => i.url === url) ? Buffer.from(url.includes('tnpdcl') ? tnpdclHtml : tnercHtml) : pdf,
  contentType: indexes.some(i => i.url === url) ? 'text/html' : 'application/pdf'
});

test('official index parsing includes dates, labels, new links, and selected year', () => {
  const index = extractIndex(indexes[1], Buffer.from(tnercHtml));
  assert.equal(index.entries.length, 1);
  assert.equal(index.selectedYear, '2026');
  assert.match(index.entries[0].context, /26\/05\/2026/);
  const changed = extractIndex(indexes[1], Buffer.from(tnercHtml.replace('</table>', '<tr><td><a href="../Orders/files/new.pdf">New tariff</a></td></tr></table>')));
  assert.equal(changed.entries.length, 2);
  assert.notDeepEqual(index, changed);
});
test('unsupported index, missing links, login responses, formats and external links fail closed', () => {
  for (const html of [
    '<h1>Login</h1>', '<table id="thetable">Tariff</table>',
    tnercHtml.replace('test.pdf', 'test.docx'),
    tnercHtml.replace('../Orders/files/test.pdf', 'https://example.com/test.pdf'),
    tnercHtml.replace('../Orders/files/test.pdf', "javascript:__doPostBack('page')"),
    tnercHtml.replace('selected', '')
  ]) assert.throws(() => extractIndex(indexes[1], Buffer.from(html)));
});
test('allowlist rejects insecure URLs, deceptive hosts, credentials, ports and unknown paths', () => {
  for (const url of ['http://www.tnerc.tn.gov.in/TariffOrders.aspx', 'https://www.tnerc.tn.gov.in.evil.test/TariffOrders.aspx',
    'https://user@www.tnerc.tn.gov.in/TariffOrders.aspx', 'https://www.tnerc.tn.gov.in:444/TariffOrders.aspx',
    'https://www.tnerc.tn.gov.in/secret', 'https://127.0.0.1/test.pdf']) assert.throws(() => allowUrl(url), /Non-allowlisted/);
});
test('bounded retries report HTTP failures rather than returning old success', async () => {
  let calls = 0;
  await assert.rejects(fetchOfficial(indexes[0].url, {
    fetcher: async () => { calls++; return new Response('unavailable', { status: 503 }); },
    sleep: async () => {}
  }), /503/);
  assert.equal(calls, 3);
});
test('timeouts and transport errors are bounded', async () => {
  let calls = 0;
  await assert.rejects(fetchOfficial(indexes[0].url, {
    fetcher: async (url, options) => {
      assert.ok(options.signal); assert.equal(options.redirect, 'manual');
      calls++; throw new DOMException('timeout', 'TimeoutError');
    }, sleep: async () => {}
  }), /timeout/);
  assert.equal(calls, 3);
});
test('redirects are checked before requesting destinations', async () => {
  const calls = [];
  await assert.rejects(fetchOfficial(indexes[0].url, {
    fetcher: async url => { calls.push(url); return new Response(null, { status: 302, headers: { location: 'https://evil.test/test.pdf' } }); },
    sleep: async () => {}
  }), /Non-allowlisted/);
  assert.ok(calls.every(url => url === indexes[0].url));
  let n = 0;
  const response = await fetchOfficial(reviewedDocuments[0].url, {
    fetcher: async () => ++n === 1
      ? new Response(null, { status: 302, headers: { location: '/static/tnpdcl/assets/files/alternate.pdf' } })
      : new Response(pdf, { headers: { 'content-type': 'application/pdf' } })
  });
  assert.equal(n, 2);
  assert.match(response.url, /alternate.pdf/);
});
test('oversized responses are rejected', async () => {
  await assert.rejects(fetchOfficial(indexes[0].url, {
    fetcher: async () => new Response('', { headers: { 'content-length': '999999999' } }), sleep: async () => {}
  }), /limit/);
});
test('monitor fetches every linked PDF and pinned tariff/subsidy, not just HTTP 200 indexes', async () => {
  const { observations, errors } = await observe({ fetchSource: fixtureFetch });
  assert.deepEqual(errors, []);
  assert.equal(observations.indexes.length, 2);
  assert.equal(observations.documents.length, 5);
  for (const doc of reviewedDocuments) assert.ok(observations.documents.some(d => d.url === doc.url));
  assert.deepEqual(compareObservation(observations, observations), []);
  const changed = structuredClone(observations);
  changed.documents[0].sha256 = 'changed';
  assert.ok(compareObservation(observations, changed).some(s => /changed official document/.test(s)));
  changed.indexes[0].entries.push({ url: 'new.pdf', title: 'New tariff' });
  assert.ok(compareObservation(observations, changed).some(s => /index links/.test(s)));
});
test('PDF login/error HTML and source failures are visible even with HTTP 200', async () => {
  const result = await observe({ fetchSource: async url => {
    const response = await fixtureFetch(url);
    return url.endsWith('.pdf') ? { ...response, bytes: Buffer.from('<html>blocked</html>') } : response;
  } });
  assert.equal(result.errors.length, 5);
  assert.equal(result.observations.documents.length, 0);
});
test('successful fetches do not erase review changes or reset human tariff review', async () => {
  const { observations, errors } = await observe({ fetchSource: fixtureFetch });
  const now = '2026-10-19T20:00:00Z';
  const previous = { lastSuccessfulFetchAt: '2026-10-18T00:00:00Z', lastUnchangedAt: '2026-10-17T00:00:00Z' };
  const unchanged = makeStatus({ baseline: observations, observations, errors, previous, now });
  assert.equal(unchanged.result, 'unchanged');
  assert.equal(unchanged.currentRatesVerified, false);
  assert.equal(unchanged.lastSuccessfulFetchAt, now);
  assert.equal(unchanged.lastHumanVerifiedAt, undefined);
  const unreviewed = makeStatus({ baseline: null, observations, errors, previous, now });
  assert.equal(unreviewed.result, 'needs-review');
  const failed = makeStatus({ baseline: observations, observations, errors: ['timeout'], previous, now });
  assert.equal(failed.result, 'error');
  assert.equal(failed.lastSuccessfulFetchAt, previous.lastSuccessfulFetchAt);
  assert.equal(failed.lastUnchangedAt, previous.lastUnchangedAt);
  assert.equal(makeStatus({ baseline: null, observations, errors: ['down'], now }).lastSuccessfulFetchAt, null);
});
test('recorded provenance is pinned to observed official documents', async () => {
  const evidence = JSON.parse(await readFile('data/evidence.json', 'utf8'));
  const baseline = JSON.parse(await readFile('data/source-baseline.json', 'utf8'));
  assert.equal(evidence.lastHumanVerifiedAt, null);
  for (const doc of evidence.documents) {
    assert.ok(baseline.documents.some(d => d.url === doc.url && d.sha256 === doc.sha256));
    assert.ok(doc.passages.every(p => p.page > 0 && p.text.length > 100));
  }
  const subsidy = evidence.documents.find(d => d.id === 'subsidy-5-2026');
  assert.match(subsidy.passages.find(p => p.page === 2).text.replace(/\s+/g, ' '), /more than 500 units bimonthly, the existing tariff structure would continue including free electricity of 100 units/);
});
