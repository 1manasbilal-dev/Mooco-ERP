/**
 * Helpers for the all-or-nothing money RPCs (supabase/migrations/20261023110000 .. 119000).
 *
 * Each money action runs as one Postgres function that is idempotent on a request id. The id is
 * kept until the server gives a definite answer, so pressing Save again after a lost response
 * (the server may have committed) resends the SAME id and the server posts nothing twice. A real
 * answer, success or refusal, forgets it, so the next action gets a fresh id.
 */

const openRequests = new Map<string, string>();

// No SQLSTATE / PostgREST code and a transport-looking message: the request may or may not have
// reached the database.
const TRANSPORT = /failed to fetch|network|timeout|timed out|aborted|load failed|econn|enotfound|offline|socket|502|503|504/i;

export function isLostResponse(err: any): boolean {
  if (!err) return false;
  const code = String(err?.code || '');
  if (/^[0-9A-Z]{5}$/.test(code) || code.startsWith('PGRST') || code === 'MOOCO401') return false;
  return TRANSPORT.test(`${err?.message || ''} ${err?.details || ''} ${err?.name || ''}`);
}

/** The request id for this action: the one an unanswered earlier try used, else a new one. */
export function requestIdFor(key: string, make: () => string): string {
  let id = openRequests.get(key);
  if (!id) {
    id = make();
    openRequests.set(key, id);
  }
  return id;
}

/** Forgets the id once the server answered; keeps it after a lost response so a resend reuses it. */
export function settleRequest(key: string, error: unknown): void {
  if (!error || !isLostResponse(error)) openRequests.delete(key);
}

/** What to tell the user when a money RPC fails. The functions raise readable messages (older servers in Roman Urdu, newer ones in English). */
export function moneyRpcMessage(err: any): string {
  const code = String(err?.code || '');
  const message = String(err?.message || '').trim();
  if (code === 'PGRST202' || code === '42883') {
    return 'The server still handles this the old way (a database update is pending). Please contact the admin; nothing was saved.';
  }
  if (code === 'MOOCO401' || code === 'PGRST301' || /login zaroori|login required|jwt expired/i.test(message)) {
    return 'Login required. Please sign in again; nothing was saved.';
  }
  if (/row-level security|permission denied/i.test(message)) return "You don't have permission to do this.";
  if (isLostResponse(err)) {
    return "No reply from the server. Check the internet and press Save again: if the first try was already saved, it won't be posted twice.";
  }
  return message || 'Something went wrong. Please try again.';
}
