import { readFile, writeFile, rename } from 'node:fs/promises';
import { observe, makeStatus } from './monitor-lib.mjs';

async function optionalJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

const baseline = await optionalJson('data/source-baseline.json');
const previous = await optionalJson('data/status.json');
const { observations, errors } = await observe();
const status = makeStatus({
  baseline, previous, observations, errors,
  runUrl: process.env.GITHUB_RUN_ID
    ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null
});
await writeFile('data/status.json.tmp', `${JSON.stringify(status, null, 2)}\n`);
await rename('data/status.json.tmp', 'data/status.json');
console.log(`${status.result}: ${observations.indexes.length} indexes, ${observations.documents.length} PDFs fetched`);
for (const message of [...status.errors, ...status.changes]) console.error(message);
if (status.result !== 'unchanged') process.exitCode = 1;
