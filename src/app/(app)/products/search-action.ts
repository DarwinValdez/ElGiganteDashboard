"use server";

import { requireAction } from "@/lib/auth";
import { ilikePattern } from "@/lib/list-params";

export interface ProductOption {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  brand: string | null;
  purchase_unit: string;
  inventory_unit: string;
  units_per_package: number;
  last_purchase_price: number | null;
  normalized_unit_cost: number | null;
  current_stock: number;
}

const COLUMNS = "id, name, sku, barcode, brand, purchase_unit, inventory_unit, units_per_package, last_purchase_price, normalized_unit_cost, current_stock";

export async function searchProducts(q: string): Promise<ProductOption[]> {
  const { supabase } = await requireAction();
  let query = supabase.from("products").select(COLUMNS).eq("active", true);
  const term = q.trim();
  if (term) {
    const p = ilikePattern(term);
    query = query.or(`name.ilike.${p},sku.ilike.${p},barcode.eq.${term.replace(/[^0-9A-Za-z-]/g, "")},brand.ilike.${p}`);
  }
  const { data } = await query.order("name").limit(20);
  return (data ?? []) as ProductOption[];
}

export async function getProductsByIds(ids: string[]): Promise<ProductOption[]> {
  const { supabase } = await requireAction();
  if (!ids.length) return [];
  const { data } = await supabase.from("products").select(COLUMNS).in("id", ids);
  return (data ?? []) as ProductOption[];
}
