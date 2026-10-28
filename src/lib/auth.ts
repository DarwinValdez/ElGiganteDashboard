import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";

import { can, type Permission } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import type { AppSettings, Profile } from "@/lib/types";

/** Sesión verificada contra Supabase Auth (getUser valida el JWT con el servidor). */
export const getSession = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle<Profile>();
  return { supabase, user, profile };
});

/** Para páginas: exige sesión activa y, opcionalmente, un permiso. */
export async function requirePage(permission?: Permission) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.profile || !session.profile.active) redirect("/login?error=inactive");
  if (permission && !can(session.profile.role, permission)) redirect("/?denied=1");
  return { supabase: session.supabase, profile: session.profile };
}

export class AuthError extends Error {}

/** Para Server Actions / Route Handlers: lanza AuthError en lugar de redirigir. */
export async function requireAction(permission?: Permission) {
  const session = await getSession();
  if (!session?.profile || !session.profile.active) throw new AuthError("Sesión no válida. Vuelva a iniciar sesión.");
  if (permission && !can(session.profile.role, permission)) throw new AuthError("No tiene permiso para esta operación.");
  return { supabase: session.supabase, profile: session.profile, user: session.user };
}

export const getSettings = cache(async (): Promise<AppSettings> => {
  const supabase = await createClient();
  const { data } = await supabase.from("app_settings").select("*").eq("id", 1).maybeSingle<AppSettings>();
  return (
    data ?? {
      id: 1,
      company_name: "EL GIGANTE SUPERMARKET",
      currency: "USD",
      cost_include_freight: true,
      cost_include_discounts: true,
      cost_include_nonrecoverable_tax: false,
      cost_include_other_charges: true,
      cost_update_source: "invoice",
      inventory_entry_source: "invoice",
      total_tolerance: 0.05,
      payments_enabled: true,
      default_tax_rate: 0,
    }
  );
});
