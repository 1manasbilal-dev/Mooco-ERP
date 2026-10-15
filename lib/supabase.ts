import { createClient } from '@supabase/supabase-js';

// Credentials are injected at build time from .env.local (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
// The anon key is a publishable key — it is safe to ship, but ONLY because RLS protects the data.
// Never put the service_role key here.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    '[Mooco] Missing Supabase configuration. Copy .env.example to .env.local and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});
