import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = Boolean(url && key);

/** Cloud (sign-in, sync, Claude proposals) turns on in Phase 4. Until then the app is phone-only. */
export const CLOUD = configured && import.meta.env.VITE_CLOUD === "on";

// Public URL + publishable (anon) key only. Row-level security does the protecting.
// The service-role key never appears in this app.
export const supabase = createClient(url ?? "http://localhost", key ?? "missing", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

export const ALLOWED_EMAIL = ((import.meta.env.VITE_ALLOWED_EMAIL as string | undefined) ?? "").trim().toLowerCase();
