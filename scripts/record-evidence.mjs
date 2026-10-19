import { readFile, writeFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { reviewedDocuments } from './sources.mjs';
import { fetchOfficial, hash } from './monitor-lib.mjs';

// Deliberately separate from the scheduled monitor. This records evidence, not approval.
const reviewedAt = new Date().toISOString();
const documents = [];
for (const source of reviewedDocuments) {
  const response = await fetchOfficial(source.url);
  const sha256 = hash(response.bytes);
  const pdf = await getDocument({ data: new Uint8Array(response.bytes), useSystemFonts: true }).promise;
  const passages = [];
  for (const page of source.pages) {
    const content = await (await pdf.getPage(page)).getTextContent();
    passages.push({ page, text: content.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('') });
  }
  documents.push({ ...source, sha256, fetchedAt: reviewedAt, passages });
}
await writeFile('data/evidence.json', `${JSON.stringify({
  reviewedAt, lastHumanVerifiedAt: null,
  method: 'Coding-assistant primary-document extraction and cross-check. No human review is claimed.',
  governmentOrderCoverage: 'G.O.(Ms) No.50, Energy Department, 10 May 2026, is expressly implemented and quoted by TNERC Order 5/2026; a separate original GO copy has not been obtained.',
  documents
}, null, 2)}\n`);
if (process.argv.includes('--record-baseline')) {
  const status = JSON.parse(await readFile('data/status.json', 'utf8'));
  if (status.errors.length || status.observations.indexes.length !== 2) throw new Error('Cannot baseline failed or incomplete observations');
  for (const doc of documents) {
    if (!status.observations.documents.some(d => d.url === doc.url && d.sha256 === doc.sha256)) {
      throw new Error('Evidence changed between observation and extraction; review again');
    }
  }
  await writeFile('data/source-baseline.json', `${JSON.stringify({
    recordedAt: reviewedAt, purpose: 'Change-detection baseline only; current tariff not approved.',
    ...status.observations
  }, null, 2)}\n`);
}
