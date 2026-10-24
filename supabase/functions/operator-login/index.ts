// operator-login: turns a PIN operator login into a real Supabase Auth session.
//
// The browser only holds the public anon key, which (after the lockdown migration) can read or
// write nothing. It POSTs the PIN here; this function checks it with the existing hashed,
// rate-limited login RPCs (callable only by service_role), then signs the operator in to a
// Supabase Auth user that belongs to that app_users row. The returned access/refresh tokens make
// every later request run as `authenticated`, and RLS lets it through only while the operator is
// active (app_private.is_operator()).
//
// Each operator's Auth password is derived here (HMAC of its auth uuid with a server secret) and
// never leaves this function, so nobody can sign in as an operator without passing the PIN check.
//
// Request body (one of):
//   { "mode": "username", "username": "ali", "pin": "1234" }   -> app_login
//   { "mode": "user", "user_id": "user_x", "pin": "1234" }     -> app_verify_pin
// PIN-only login ("mode": "pin" -> app_login_with_pin) is not accepted: the app never uses it,
// and one guess tests the PIN of every operator at once while its lockout blocks everybody.
// A wrong PIN comes back from the RPCs as null (so the failed attempt is kept for the lockout).
// Response: { user, session: { access_token, refresh_token, expires_at } } or { message } on error.

import { createClient } from 'npm:@supabase/supabase-js@2.106.2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const modernKeys = (() => {
  try { return JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'); } catch { return {}; }
})();
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || modernKeys.default || '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
// A dedicated secret is preferred; the service key is the fallback so the function works with no
// manual setup. Rotating either only means the next login re-syncs the derived password.
const PASSWORD_SECRET = Deno.env.get('OPERATOR_SESSION_SECRET') || SERVICE_KEY;
const OPERATOR_EMAIL_DOMAIN = 'operators.mooco.pk';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// A fresh client per sign-in so sessions never leak between requests.
const signInClient = () =>
  createClient(SUPABASE_URL, ANON_KEY || SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

async function derivePassword(authUserId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(PASSWORD_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`mooco-operator:${authUserId}`)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const isPin = (v: unknown): v is string => typeof v === 'string' && /^\d{4,10}$/.test(v.trim());

async function verifyPin(body: any): Promise<{ user?: any; message?: string }> {
  const mode = body?.mode;
  let rpc: { fn: string; args: Record<string, string> } | null = null;
  if (mode === 'username' && typeof body.username === 'string' && body.username.trim() && isPin(body.pin)) {
    rpc = { fn: 'app_login', args: { p_username: body.username.trim().toLowerCase(), p_pin: body.pin.trim() } };
  } else if (mode === 'user' && typeof body.user_id === 'string' && body.user_id.trim() && isPin(body.pin)) {
    rpc = { fn: 'app_verify_pin', args: { p_user_id: body.user_id.trim(), p_pin: body.pin.trim() } };
  }
  if (!rpc) return { message: 'Wrong username or PIN code!' };

  const { data, error } = await admin.rpc(rpc.fn, rpc.args);
  // The RPC messages are already user-facing (wrong PIN, too many attempts).
  if (error || !data) return { message: error?.message || 'Wrong username or PIN code!' };
  return { user: data };
}

async function signInOperator(user: any) {
  const authUserId: string | undefined = user.auth_user_id;
  if (!authUserId) throw new Error('Operator account is not ready for secure login. Run the prep migration.');
  const email = `${authUserId}@${OPERATOR_EMAIL_DOMAIN}`;
  const password = await derivePassword(authUserId);

  const attempt = () => signInClient().auth.signInWithPassword({ email, password });
  let { data, error } = await attempt();
  if (!error && data.session) return data.session;

  // First login for this operator, or the secret changed: create / repair the Auth user, retry once.
  const attrs = { email, password, email_confirm: true, app_metadata: { app_user_id: user.id } };
  const created = await admin.auth.admin.createUser({ id: authUserId, ...attrs });
  if (created.error) {
    const updated = await admin.auth.admin.updateUserById(authUserId, { ...attrs, ban_duration: 'none' });
    if (updated.error) throw new Error(`Could not prepare operator session: ${updated.error.message}`);
  }
  ({ data, error } = await attempt());
  if (error || !data.session) throw new Error(`Could not start operator session: ${error?.message || 'no session'}`);
  return data.session;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ message: 'Login service is not configured.' }, 500);

  let body: any;
  try {
    const text = await req.text();
    if (text.length > 2048) return json({ message: 'Request too large.' }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ message: 'Invalid request.' }, 400);
  }

  const { user, message } = await verifyPin(body);
  if (!user) return json({ message }, 401);

  try {
    const session = await signInOperator(user);
    const { pin, pin_hash, pin_salt, ...safeUser } = user;
    return json({
      user: safeUser,
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
      },
    });
  } catch (e) {
    console.error('[operator-login]', (e as Error).message);
    return json({ message: 'Login could not be completed. Please try again.' }, 502);
  }
});
