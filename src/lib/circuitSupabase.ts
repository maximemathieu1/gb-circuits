// src/lib/circuitSupabase.ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = String(
  import.meta.env.VITE_CIRCUIT_SUPABASE_URL ||
    "https://ukftoqjgyychsswfxqyw.supabase.co"
).trim();

const supabaseAnonKey = String(
  import.meta.env.VITE_CIRCUIT_SUPABASE_ANON_KEY || ""
).trim();

if (!supabaseAnonKey) {
  throw new Error(
    "VITE_CIRCUIT_SUPABASE_ANON_KEY est manquant. Utilise la clé publishable/anon du projet Circuit Scolaire."
  );
}

export const circuitSupabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
