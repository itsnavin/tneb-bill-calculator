export function parseUnits(value) {
  const text = String(value).trim();
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(text)) {
    throw new Error('Enter 0 to 100,000 kWh, with at most two decimal places. No signs or exponent notation.');
  }
  const [whole, fraction = ''] = text.split('.');
  const hundredths = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (hundredths > 10_000_000) throw new Error('Enter no more than 100,000 kWh.');
  return hundredths;
}

export function validateTariff(tariff) {
  const fail = () => { throw new Error('Invalid reviewed tariff data; calculation blocked.'); };
  if (!tariff || tariff.billingCycle !== 'two-month' || tariff.fixedChargePaise !== 0 ||
      tariff.taxIncluded !== false || tariff.rules?.length !== 2 ||
      tariff.rules[0].maxTotalUnits !== 500 || tariff.rules[1].maxTotalUnits !== null ||
      !/^\d{4}-\d{2}-\d{2}$/.test(tariff.effectiveFrom) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(tariff.illustrationThrough) ||
      tariff.effectiveFrom > tariff.illustrationThrough) fail();
  for (const [index, rule] of tariff.rules.entries()) {
    if (!Array.isArray(rule.bands) || !rule.bands.length) fail();
    let previous = 0;
    for (const [i, band] of rule.bands.entries()) {
      if (!Number.isSafeInteger(band.approvedPaise) || !Number.isSafeInteger(band.subsidyPaise) ||
          band.approvedPaise < 0 || band.subsidyPaise < 0 ||
          band.subsidyPaise > band.approvedPaise) fail();
      if (band.upTo === null) {
        if (index !== 1 || i !== rule.bands.length - 1) fail();
      } else {
        if (!Number.isSafeInteger(band.upTo) || band.upTo <= previous || band.upTo > 100_000) fail();
        previous = band.upTo;
      }
    }
    if (rule.bands.at(-1).upTo !== (index === 0 ? 500 : null)) fail();
  }
  return tariff;
}

export function calculateHistorical(value, tariff, { historicalConsent = false } = {}) {
  if (!historicalConsent) throw new Error('Choose the historical illustration explicitly; current calculation is unavailable.');
  validateTariff(tariff);
  const hundredths = parseUnits(value);
  const rule = tariff.rules[hundredths <= 50_000 ? 0 : 1];
  const rows = [];
  let previous = 0;
  let approvedExact = 0n;
  let subsidyExact = 0n;
  for (const band of rule.bands) {
    const upper = band.upTo === null ? hundredths : band.upTo * 100;
    const count = Math.max(0, Math.min(hundredths, upper) - previous);
    if (count) {
      const approved = BigInt(count) * BigInt(band.approvedPaise);
      const subsidy = BigInt(count) * BigInt(band.subsidyPaise);
      approvedExact += approved;
      subsidyExact += subsidy;
      rows.push({
        from: previous / 100, to: Math.min(hundredths, upper) / 100,
        units: count / 100, approvedRatePaise: band.approvedPaise,
        subsidyRatePaise: band.subsidyPaise,
        ratePaise: band.approvedPaise - band.subsidyPaise,
        amountPaise: Number((approved - subsidy + 50n) / 100n)
      });
    }
    previous = upper;
    if (previous >= hundredths) break;
  }
  const round = exact => Number((exact + 50n) / 100n);
  return {
    units: hundredths / 100, rows,
    totalPaise: round(approvedExact - subsidyExact),
    approvedPaise: round(approvedExact), subsidyPaise: round(subsidyExact),
    freeUnits: Math.min(hundredths / 100, hundredths <= 50_000 ? 200 : 100),
    historical: true
  };
}

export const money = paise => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', minimumFractionDigits: 2
}).format(paise / 100);
