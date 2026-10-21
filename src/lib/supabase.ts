import { createClient } from '@supabase/supabase-js';

// Credentials are injected at build time from .env.local (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
// The anon key is a publishable key — it is safe to ship because, on its own, it can reach nothing
// but the login directory: every table and business RPC needs an operator session (see
// src/lib/operatorAuth.ts and docs/security.md). Never put the service_role key here.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    '[Mooco] Missing Supabase configuration. Copy .env.example to .env.local and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
  );
}

/** localStorage key holding the operator's Supabase session (access + refresh token). */
export const OPERATOR_AUTH_STORAGE_KEY = 'mooco-operator-auth';

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    // The operator session must survive reloads and offline periods; the refresh token renews it
    // once the device is back online.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: OPERATOR_AUTH_STORAGE_KEY
  }
});
