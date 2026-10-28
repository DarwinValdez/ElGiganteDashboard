import "server-only";
import { createClient } from "@supabase/supabase-js";

import { SUPABASE_URL } from "@/lib/env";

/**
 * Cliente con service role. SOLO para gestión de usuarios (Auth Admin API)
 * desde acciones que ya verificaron que el usuario es administrador.
 * Nunca se importa desde código de cliente ("server-only").
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY no está configurada; la gestión de usuarios no está disponible.");
  }
  return createClient(SUPABASE_URL, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
