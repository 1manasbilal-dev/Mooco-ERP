import type { Session } from '@supabase/supabase-js';
import { supabase, OPERATOR_AUTH_STORAGE_KEY } from './supabase';

// PIN operators sign in through the operator-login Edge Function, which checks the PIN and
// returns a Supabase session for that operator. Every later table/RPC call carries that session;
// without it the database refuses everything except the login directory.

export type OperatorLoginRequest =
  | { mode: 'username'; username: string; pin: string }
  | { mode: 'pin'; pin: string }
  | { mode: 'user'; user_id: string; pin: string };

export type OperatorLoginResult = { user?: any; message?: string };

const LOGIN_FAILED = 'Ghalat Username ya PIN code!';
const OFFLINE = 'Internet nahi hai. Login ke liye connection zaroori hai.';

const readFunctionError = async (error: any): Promise<string> => {
  // The request never reached the login service (network drop, DNS, relay): not a wrong PIN.
  if (error?.name === 'FunctionsFetchError' || error?.name === 'FunctionsRelayError') return OFFLINE;
  try {
    const body = await error?.context?.json?.();
    if (body?.message) return String(body.message);
  } catch (_) {}
  const msg = String(error?.message || '');
  if (/failed to fetch|network|load failed|fetch/i.test(msg)) return OFFLINE;
  return LOGIN_FAILED;
};

export async function operatorSignIn(request: OperatorLoginRequest): Promise<OperatorLoginResult> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { message: OFFLINE };
  const { data, error } = await supabase.functions.invoke('operator-login', { body: request });
  if (error) return { message: await readFunctionError(error) };
  if (!data?.user || !data?.session?.access_token || !data?.session?.refresh_token) {
    return { message: data?.message || LOGIN_FAILED };
  }
  const { error: sessionError } = await supabase.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token
  });
  if (sessionError) return { message: sessionError.message || LOGIN_FAILED };
  return { user: data.user };
}

export async function operatorSignOut(): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch (_) {
    // Offline sign-out still clears the local session below.
  }
  try { localStorage.removeItem(OPERATOR_AUTH_STORAGE_KEY); } catch (_) {}
}

/** The live session, or null. A stored-but-unrefreshable session (offline) also returns null. */
export async function getOperatorSession(): Promise<Session | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session ?? null;
  } catch (_) {
    return null;
  }
}

/** True when a session is saved on this device, even if it could not be refreshed yet (offline). */
export function hasStoredOperatorSession(): boolean {
  try {
    return !!localStorage.getItem(OPERATOR_AUTH_STORAGE_KEY);
  } catch (_) {
    return false;
  }
}

export function sessionOperatorId(session: Session | null): string | null {
  const id = session?.user?.app_metadata?.app_user_id;
  return typeof id === 'string' && id ? id : null;
}
