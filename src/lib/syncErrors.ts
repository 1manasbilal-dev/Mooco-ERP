/** Network blips stay retryable. Only a definite data/rule rejection is permanent. */

const RETRYABLE = /failed to fetch|network|timeout|timed out|aborted|abort|load failed|econn|enotfound|offline|connection refused|socket|502|503|504|fetch/i;

const PERMANENT_CODES = new Set([
  '22P02',
  '23502',
  '23505',
  '23514',
  '42501',
  '42883',
  'PGRST202',
  'PGRST204'
]);

// A missing or expired operator session: the work is fine, it just needs a login first.
const AUTH_CODES = new Set(['MOOCO401', 'PGRST301', 'PGRST302', 'PGRST303']);
const AUTH_MESSAGE = /login zaroori|login required|jwt expired|invalid jwt|not authenticated/i;

export function isPermanentSyncError(err: any): boolean {
  const msg = `${err?.message || ''} ${err?.details || ''} ${err?.hint || ''}`;
  if (RETRYABLE.test(msg)) return false;
  const code = String(err?.code || '');
  if (AUTH_CODES.has(code) || AUTH_MESSAGE.test(msg)) return false;
  if (PERMANENT_CODES.has(code)) return true;
  if (/is required|must be greater|cannot be negative|unsupported offline action/i.test(msg)) return true;
  return false;
}

/** 2s, 4s, 8s … capped at 60s. Connectivity failures are never dead-lettered. */
function backoffMs(retryCount: number): number {
  const n = Math.max(0, retryCount || 0);
  return Math.min(60_000, 2000 * 2 ** Math.min(n, 5));
}

export function readyToRetry(row: { retry_count?: number; last_retry_at?: string }): boolean {
  if (!row.last_retry_at || !row.retry_count) return true;
  const elapsed = Date.now() - new Date(row.last_retry_at).getTime();
  return elapsed >= backoffMs(row.retry_count);
}
