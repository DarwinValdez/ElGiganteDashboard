import "server-only";

import { can } from "@/lib/permissions";
import type { Category, Profile, Supplier, Unit } from "@/lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface Lookups {
  units: Unit[];
  categories: Pick<Category, "id" | "name">[];
  suppliers: Pick<Supplier, "id" | "trade_name">[];
}

/** Catálogos auxiliares para formularios y filtros. */
export async function getLookups(supabase: SupabaseClient, profile: Profile): Promise<Lookups> {
  const [units, categories, suppliers] = await Promise.all([
    supabase.from("units").select("*").eq("active", true).order("kind").order("name"),
    supabase.from("categories").select("id, name").eq("active", true).order("name"),
    can(profile.role, "suppliers.read")
      ? supabase.from("suppliers").select("id, trade_name").eq("active", true).order("trade_name")
      : Promise.resolve({ data: [] as Pick<Supplier, "id" | "trade_name">[] }),
  ]);
  return {
    units: (units.data ?? []) as Unit[],
    categories: categories.data ?? [],
    suppliers: (suppliers.data ?? []) as Pick<Supplier, "id" | "trade_name">[],
  };
}
