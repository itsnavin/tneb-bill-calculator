import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { validateTariff } from '../src/calculator.js';
import { allowUrl } from './monitor-lib.mjs';

const tariff = validateTariff(JSON.parse(await readFile('data/tariff.json', 'utf8')));
const evidence = JSON.parse(await readFile('data/evidence.json', 'utf8'));
if (tariff.currentApproved !== false || tariff.lastHumanVerifiedAt !== null) {
  throw new Error('Current approval requires an implemented, independently reviewed current-date gate; this release supports historical illustrations only');
}
if (evidence.documents.length !== 3 || !Number.isFinite(Date.parse(evidence.reviewedAt))) throw new Error('Missing provenance');
for (const doc of evidence.documents) {
  allowUrl(doc.url);
  if (!/^[a-f0-9]{64}$/.test(doc.sha256) || !doc.passages.length) throw new Error('Invalid provenance');
}
JSON.parse(await readFile('data/status.json', 'utf8'));
await mkdir('dist', { recursive: true });
for (const path of ['index.html', 'src', 'data']) await cp(path, `dist/${path}`, { recursive: true });
await writeFile('dist/.nojekyll', '');
console.log('Static site built in dist; current-rate calculation remains blocked.');
