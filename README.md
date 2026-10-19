# Tamil Nadu home electricity calculator

[Open the app](https://itsnavin.github.io/tneb-bill-calculator/) ·
[Daily monitoring](https://github.com/itsnavin/tneb-bill-calculator/actions/workflows/tariff-monitor.yml)

Static, responsive, privacy-preserving **domestic household LT I-A** energy-charge
illustrations. No account IDs, login, payments, analytics, external fonts, runtime
scripts, paid backend, or connection to your electricity account.

## Current accuracy status: blocked, not guessed

**Current-rate calculation is deliberately unavailable.** Official TNPDCL's tariff
index links Order 6/2025. Its page 34 explicitly says the FY 2026-27 revision is
effective **1 July 2026**. At initial investigation, the official TNERC default-year
2026 index did not establish that distribution revision and its corresponding
consumer-payable subsidy. An unchanged official page is not proof that no newer
order exists. This repository does not invent a July tariff or advertise live rates.

The user must explicitly choose a **historical rate illustration for 10 May–30 June
2026**. This is a reviewed rate-schedule scenario for a normal two-month cycle, not
a retrospective bill assessment, transition-period calculation, or current estimate.
No determination of how a cycle straddling effective dates is billed is made.

### Primary evidence

| Official document | Evidence used |
| --- | --- |
| [TNERC Order 6/2025, 30 June 2025](https://www.tnpdcl.org/static/tnpdcl/assets/files/tariff/2025/TO062025/TO62025.pdf) | Page 34: approved energy tariff effective 1 July 2025, nil fixed charge, and scheduled July 2026 revision |
| [TNERC Order 4/2026, 27 April 2026](https://www.tnerc.tn.gov.in/Orders/files/TO-Order%20No%20280420261156.pdf) | Pages 5–6: FY 2026-27 subsidy per unit, including different treatment above 500 kWh |
| [TNERC Order 5/2026, 26 May 2026](https://www.tnerc.tn.gov.in/Orders/files/TO-Order%20No%20270520261449.pdf) | Pages 1–4: implementation of GO (Ms) 50 dated 10 May 2026, additional 101–200 unit subsidy only when total consumption is at most 500 kWh |

Order 5/2026 expressly cites the Government of Tamil Nadu's **GO (Ms) No.50, Energy
Department, 10 May 2026**, effective that day. A separate original GO copy was not
obtained; the implementing primary regulatory order is the evidence, not a
third-party article. The latest September Order 6/2026 was also inspected: it is a
final subsidy reconciliation for **FY 2025-26**, not a new FY 2026-27 tariff.

[`data/evidence.json`](data/evidence.json) pins fetched PDF SHA-256 hashes, page
numbers, extracted passages, and the actual assistant evidence-review timestamp.
**No human tariff verification is claimed** (`lastHumanVerifiedAt: null`).
Automatic fetches never change this timestamp or the tariff data.

### Historical consumer-payable energy schedule

All rates below are approved tariff **less** government subsidy, not the approved
tariff misrepresented as what the household pays.

| Bi-monthly units in band | Total usage at most 500 kWh | Total usage above 500 kWh |
| --- | ---: | ---: |
| First 100 | Free | Free |
| Above 100 through 200 | Free | Rs 4.70/kWh |
| Above 200 through 400 | Rs 4.70/kWh | Rs 4.70/kWh |
| Above 400 through 500 | Rs 6.30/kWh | Rs 6.30/kWh |
| Above 500 through 600 | — | Rs 8.40/kWh |
| Above 600 through 800 | — | Rs 9.45/kWh |
| Above 800 through 1000 | — | Rs 10.50/kWh |
| Above 1000 | — | Rs 11.55/kWh |

At 500 kWh: 200 free + 200 × Rs 4.70 + 100 × Rs 6.30 = **Rs 1,570.00**.
At 501 kWh: 100 free + 300 × Rs 4.70 + 100 × Rs 6.30 + 1 × Rs 8.40
= **Rs 2,048.40**. Crossing the threshold changes earlier units, not just the last
unit. These are independently hand-worked examples from official tables, **not**
examples represented as printed official bills.

Input accepts 0–100,000 kWh with at most two decimal places. Decimal inputs are
explicit analytical illustrations, **not a claim about TNPDCL's meter or billing
rounding convention**. Internally units are integer hundredths and money uses
integer paise with BigInt products. Exact energy products are summed before one
half-up rounding to paise. Rounded display rows or approved/subsidy subtotals can
differ by one paise from their combined rounded total.

This is **energy only**, with nil fixed charge supported by Order 6/2025. No tax
amount or tax exemption is inferred. It excludes taxes, arrears, penalties, deposits,
meter adjustments, common-area supply, solar/net metering, opt-out/ineligible
subsidy connections, multi-cycle or prorated assessments, and mixed-rate periods.
Only TNPDCL can establish your actual account's payable bill and eligibility.

## Daily official-source monitoring

[`tariff-monitor.yml`](.github/workflows/tariff-monitor.yml) runs once daily at
**02:17 UTC (07:47 IST)** on `main`, and supports **Run workflow** manually.
GitHub schedules can be delayed, skipped under platform conditions, or disabled
after repository inactivity; the app marks checks older than **48 hours** stale.
A missing, future, failed, or unknown status never appears fresh.

**Initial deployment observation:** local requests fetched both indexes and all
16 PDFs successfully. The first GitHub-hosted manual run could not fetch either
official host. It committed and deployed `result: error`, retained the previous
successful local-fetch timestamp, and failed visibly after publishing. A live
deployment is not evidence that hosted official-source access succeeded. Network
errors (including their underlying connection/TLS cause when available) are
published without disabling TLS or bypassing access controls.

Each scheduled/manual run:

1. Fetches the [TNPDCL tariff index](https://www.tnpdcl.org/en/tnpdcl/billing-services/schedules-tariff/)
   and [TNERC default-year tariff index](https://www.tnerc.tn.gov.in/TariffOrders.aspx).
   Checks structure, selected year, document links, descriptions and row dates.
   HTML hashes are recorded, but comparisons ignore unrelated navigation and
   volatile ASP.NET hidden fields by comparing the parsed tariff entries.
2. Fetches **every PDF linked in those tariff sections**, plus the three pinned
   tariff/subsidy PDFs. The initial baseline includes **two indexes and 16 PDFs**.
   Compares PDF hashes and resolved redirect destinations to a separate
   reviewed change-detection baseline.
3. Allows only HTTPS paths on the explicit official TNPDCL/TNERC hosts. Validates
   every redirect before following it (maximum three); three attempts, 20-second
   request/body timeout, 32 MiB document limit, 40 links per index / 60 documents
   total. Rejects non-PDF payloads, HTML errors with HTTP 200, unsupported links,
   unexpected pagination, empty indexes, and missing year metadata. Incomplete
   fetches are reported as failures, not misclassified as removed source documents.
4. Atomically writes `data/status.json`, preserving the prior last-success time
   on failure. A complete unchanged fetch updates **source health only**, never
   reviewed rates, human verification, or current approval.
5. Commits the result to `main` and deploys it to Pages **even when checks fail or
   documents change**, then fails the workflow visibly for actionable attention.
   No issues are auto-created, so there is no issue spam.

`unchanged` means only that the monitored evidence matches the baseline.
`needs-review` persists until an explicit baseline review; `error` publishes the
actual fetch/format failure. Current rates remain unverified in all three cases.
Browser **Reload published status** fetches this published result, not the official
sites; browser offline state is displayed separately. No service worker conceals
failed updates with a silent cached-success fallback.

**Coverage limitation:** this is not an exhaustive crawler of every government
gazette, archive year, court ruling, press release, or customer condition. TNERC's
default selected year is monitored; a rollover changes the baseline and requires
review. It does not silently fetch or claim coverage of all historical years.
Document hashes detect changes, not legal completeness or correctness.

Actions use pinned official actions, a lockfile, repository-scoped write access
only in the publishing job, and Pages OIDC. Pull-request CI has read-only access.
Publishing is serialized without cancellation. Bot status commits use the built-in
GitHub token and do not recursively trigger new workflow runs. Pushes deploy but
do not perform another source check; scheduled/manual runs check and deploy in one
workflow, including failure status. No repository secret is required.

## Local development and validation

Requires Node.js 24+, npm. On Windows use `npm.cmd` / `npx.cmd` if PowerShell script
execution policy prevents the `.ps1` npm shim.

```text
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:browser
npm run dev
```

Preview: `http://127.0.0.1:4173`. Browser checks start/stop their own temporary server
and cover desktop 1440px, mobile 390px and 320px, explicit historical consent,
500/501 kWh, input errors, downloads, no horizontal overflow, missing/stale/offline
monitoring status. Screenshot artifacts go to ignored `test-results/`.

Unit tests include independently worked official-table reference fixtures at zero
and below/at/above every supported band threshold, invalid inputs, exact rates,
schema errors, and monitor mocks for HTTP failures, timeouts, redirects, source
changes, new links, unsupported documents, provenance and stale checks. There is
no arithmetic oracle copied from this calculator's implementation, and no invented
official worked-bill oracle.

```text
npm run monitor
```

Makes real network requests, writes actual monitoring results, and exits nonzero
on changed or failed evidence. Tests/builds themselves do not contact official
sites and never fabricate a successful check timestamp.

## Reviewing a new tariff

1. Find the original distribution tariff **and** applicable government subsidy
   directions and TNERC implementing orders. Confirm scope, effective dates,
   total-use threshold conditions, eligibility, fixed charges and rounding.
   Review newly linked PDFs, not just the unchanged pinned order.
2. Run the monitor and inspect `data/status.json`. Resolve every error and changed
   link. The change-detection baseline is not current-rate approval.
3. Update `scripts/sources.mjs` to relevant evidence pages. The explicit maintainer
   command `node scripts/record-evidence.mjs --record-baseline` extracts and pins
   primary evidence and records a baseline **only after a complete successful
   observation and matching evidence hashes**. It does not update rates or approve
   anything as current. Never run it automatically to silence a changed-source
   warning. Inspect the diff before committing.
4. Update tariff data, independent oracle fixtures, UI dates/conditions and this
   documentation together. Add below/at/above cases for every changed threshold
   and independent official calculator/worked-bill fixtures if available.
5. To enable a current estimate, implement and review an explicit date/eligibility
   gate tied to comprehensively reviewed tariff + subsidy coverage and source
   freshness. **This release intentionally has no current-calculation path**;
   flipping a JSON flag is rejected by the build. Record real human reviewer
   evidence and dates only after that review; never manufacture them.
6. Run tests, build and browser checks; commit evidence separately from automatic
   source health. Dispatch the daily workflow and verify the deployed status.
