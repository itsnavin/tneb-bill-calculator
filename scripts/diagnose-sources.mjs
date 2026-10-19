import { Resolver } from 'node:dns/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { indexes } from './sources.mjs';

const execute = promisify(execFile);
const resolver = new Resolver({ timeout: 5000, tries: 1 });
for (const source of indexes) {
  const hostname = new URL(source.url).hostname;
  console.log(`Diagnostic only (not tariff verification): ${source.id}`);
  try {
    const addresses = await resolver.resolve4(hostname);
    console.log('DNS IPv4:', JSON.stringify(addresses));
  } catch (error) {
    console.error(`DNS failed: ${error.code}: ${error.message}`);
    process.exitCode = 1;
  }
  try {
    const { stdout } = await execute('curl', [
      '--silent', '--show-error', '--fail', '--output', process.platform === 'win32' ? 'NUL' : '/dev/null',
      '--proto', '=https', '--connect-timeout', '10', '--max-time', '20',
      '--user-agent', 'tneb-bill-calculator/1.0 official-source-monitor (+https://github.com/itsnavin/tneb-bill-calculator)',
      '--write-out', 'HTTP %{http_code}; peer %{remote_ip}; DNS %{time_namelookup}s; connect %{time_connect}s; TLS %{time_appconnect}s; total %{time_total}s\n',
      source.url
    ], { timeout: 25_000 });
    console.log(stdout);
  } catch (error) {
    console.error(`Normal HTTPS diagnostic failed: exit ${error.code}; ${error.stderr || error.message}; ${error.stdout || ''}`);
    process.exitCode = 1;
  }
}
