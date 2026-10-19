export const MAX_CHECK_AGE_MS = 48 * 60 * 60 * 1000;

export function sourceHealth(status, now = Date.now()) {
  const checked = Date.parse(status?.checkedAt);
  if (!Number.isFinite(checked) || checked > now + 5 * 60 * 1000) {
    return { kind: 'unavailable', text: 'No trustworthy source-check timestamp. Current rates are unverified.' };
  }
  if (now - checked > MAX_CHECK_AGE_MS) {
    return { kind: 'stale', text: 'Source monitoring is stale (over 48 hours). Current rates are unverified.' };
  }
  if (status.result === 'error') return { kind: 'error', text: 'Official-source check failed. See the errors below.' };
  if (status.result === 'needs-review') return { kind: 'needs-review', text: 'Official sources changed or need review. No automatic rate approval.' };
  if (status.result === 'unchanged') return { kind: 'unchanged', text: 'Monitored sources unchanged. This does not certify current rates.' };
  return { kind: 'unavailable', text: 'Unknown monitoring result. Current rates are unverified.' };
}
