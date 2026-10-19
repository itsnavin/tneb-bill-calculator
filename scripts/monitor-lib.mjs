import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { indexes, reviewedDocuments } from './sources.mjs';

export const hash = body => createHash('sha256').update(body).digest('hex');
const normalize = text => text.replace(/\s+/g, ' ').trim();
const MAX_BYTES = 32 * 1024 * 1024;

export function allowUrl(value) {
  const url = new URL(value);
  const allowed = url.protocol === 'https:' && !url.username && !url.password && !url.port &&
    ((url.hostname === 'www.tnpdcl.org' && (
      url.pathname === '/en/tnpdcl/billing-services/schedules-tariff/' ||
      url.pathname.startsWith('/static/tnpdcl/assets/files/'))) ||
     (url.hostname === 'www.tnerc.tn.gov.in' && (
       url.pathname === '/TariffOrders.aspx' || url.pathname.startsWith('/Orders/files/'))));
  if (!allowed) throw new Error(`Non-allowlisted source or redirect: ${url.origin}${url.pathname}`);
  url.hash = '';
  return url.href;
}

export async function fetchOfficial(value, { fetcher = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const original = allowUrl(value);
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      let url = original;
      for (let redirects = 0; redirects <= 3; redirects++) {
        const response = await fetcher(url, {
          redirect: 'manual', signal: AbortSignal.timeout(20_000),
          headers: { 'User-Agent': 'tneb-bill-calculator/1.0 official-source-monitor (+https://github.com/itsnavin/tneb-bill-calculator)' }
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          await response.body?.cancel();
          if (!location || redirects === 3) throw new Error('Redirect limit or missing Location');
          url = allowUrl(new URL(location, url).href);
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`HTTP ${response.status} for ${url}`);
        }
        if (Number(response.headers.get('content-length')) > MAX_BYTES) {
          await response.body?.cancel();
          throw new Error('Official source exceeds 32 MiB limit');
        }
        let size = 0;
        const chunks = [];
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > MAX_BYTES) throw new Error('Official source exceeds 32 MiB limit');
          chunks.push(chunk);
        }
        return { url, bytes: Buffer.concat(chunks), contentType: response.headers.get('content-type') || '' };
      }
    } catch (error) {
      last = error;
      if (attempt < 2) await sleep(500 * (attempt + 1));
    }
  }
  throw last;
}

export function extractIndex(source, bytes) {
  const $ = load(bytes.toString('utf8'));
  const section = source.type === 'tnerc' ? $('#thetable') : $('#main');
  if (section.length !== 1 || !/tariff/i.test(section.text())) throw new Error(`Unrecognized tariff index: ${source.id}`);
  if (section.find('a[href*="__doPostBack"]').length) throw new Error('Unsupported paginated order index');
  const selectedYear = source.type === 'tnerc' ? $('#ddYear option[selected]').val() : null;
  if (source.type === 'tnerc' && !/^\d{4}$/.test(selectedYear || '')) throw new Error('Cannot determine TNERC index year');
  const entries = [];
  section.find('a[href]').each((i, element) => {
    const a = $(element);
    const url = allowUrl(new URL(a.attr('href'), source.url).href);
    if (!/\.pdf$/i.test(new URL(url).pathname)) throw new Error(`Unsupported linked tariff document: ${url}`);
    entries.push({
      url, title: normalize(a.text()),
      context: normalize(source.type === 'tnerc' ? a.closest('tr').text() : a.closest('li').text())
    });
  });
  if (!entries.length || entries.length > 40) throw new Error('Unexpected tariff document count');
  entries.sort((a, b) => a.url.localeCompare(b.url));
  return { selectedYear, entries };
}

export async function observe({ fetchSource = fetchOfficial } = {}) {
  const observations = { indexes: [], documents: [] };
  const errors = [];
  const urls = new Set(reviewedDocuments.map(d => d.url));
  for (const source of indexes) {
    try {
      const response = await fetchSource(source.url);
      if (!/text\/html/i.test(response.contentType)) throw new Error('Index is not HTML');
      const index = extractIndex({ ...source, url: response.url }, response.bytes);
      observations.indexes.push({ id: source.id, url: source.url, resolvedUrl: response.url, sha256: hash(response.bytes), ...index });
      for (const entry of index.entries) urls.add(entry.url);
    } catch (error) {
      errors.push(`${source.id}: ${error.message}`);
    }
  }
  if (urls.size > 60) errors.push('Too many linked documents; manual coverage review required');
  else for (const url of urls) {
    try {
      const response = await fetchSource(url);
      if (!/application\/pdf/i.test(response.contentType) || response.bytes.subarray(0, 5).toString() !== '%PDF-') {
        throw new Error('Unsupported document: expected a PDF, not a login, error page, or other payload');
      }
      observations.documents.push({ url, resolvedUrl: response.url, sha256: hash(response.bytes), bytes: response.bytes.length });
    } catch (error) {
      errors.push(`${url}: ${error.message}`);
    }
  }
  observations.documents.sort((a, b) => a.url.localeCompare(b.url));
  return { observations, errors };
}

export function compareObservation(baseline, observations) {
  if (!baseline) return ['No reviewed source baseline exists'];
  const changes = [];
  for (const current of observations.indexes) {
    const previous = baseline.indexes?.find(i => i.id === current.id);
    if (!previous || previous.resolvedUrl !== current.resolvedUrl ||
        JSON.stringify([previous.selectedYear, previous.entries]) !== JSON.stringify([current.selectedYear, current.entries])) {
      changes.push(`${current.id}: index links, descriptions, dates, or selected year changed`);
    }
  }
  for (const doc of observations.documents) {
    const previous = baseline.documents?.find(d => d.url === doc.url);
    if (!previous || previous.sha256 !== doc.sha256 || previous.resolvedUrl !== doc.resolvedUrl) changes.push(`New or changed official document: ${doc.url}`);
  }
  for (const previous of baseline.documents || []) {
    if (!observations.documents.some(d => d.url === previous.url)) changes.push(`Document no longer observed: ${previous.url}`);
  }
  return changes;
}

export function makeStatus({ baseline, observations, errors, previous, now = new Date().toISOString(), runUrl = null }) {
  const changes = compareObservation(baseline, observations);
  const result = errors.length ? 'error' : changes.length ? 'needs-review' : 'unchanged';
  return {
    schemaVersion: 1, checkedAt: now, result, runUrl,
    lastSuccessfulFetchAt: errors.length ? previous?.lastSuccessfulFetchAt || null : now,
    lastUnchangedAt: result === 'unchanged' ? now : previous?.lastUnchangedAt || null,
    currentRatesVerified: false,
    errors, changes, observations,
    coverage: 'TNPDCL tariff index; TNERC default-year tariff index; all PDFs linked in those sections; three pinned tariff/subsidy PDFs. Not every government order, archive, court ruling, or account-specific rule.',
    note: 'Source availability and unchanged hashes are not proof that no newer order exists. No rates or review timestamps are auto-approved.'
  };
}
