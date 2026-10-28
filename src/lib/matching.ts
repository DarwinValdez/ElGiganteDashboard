import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { MatchMethod, Unit } from "@/lib/types";
import { normalizeText, parsePackageCount, parseSize, proposeConversion } from "@/lib/units";

export interface MatchCandidate {
  product_id: string;
  name: string;
  sku: string;
  brand: string | null;
  method: MatchMethod;
  score: number;
  matched_text: string;
  purchase_unit: string;
  inventory_unit: string;
  units_per_package: number;
}

export interface LineMatch {
  product_id: string | null;
  method: MatchMethod | null;
  score: number | null;
  confirmed: boolean;
  conversion_factor: number;
  conversion_reason: string | null;
  candidates: MatchCandidate[];
}

export interface LineToMatch {
  supplier_code?: string | null;
  description: string;
  generic_description?: string | null;
  brand?: string | null;
  unit?: string | null;
  package_description?: string | null;
  units_per_package?: number | null;
}

/** Métodos exactos: se marcan como confirmados (el usuario puede cambiarlos). */
const EXACT: MatchMethod[] = ["barcode", "sku", "supplier_code"];
const SUGGEST_THRESHOLD = 0.35;

/**
 * Vincula líneas de factura con productos por prioridad:
 * 1) código de barras / SKU, 2) código del proveedor, 3) asociación confirmada,
 * 4) marca + presentación, 5) nombre normalizado + unidad, 6) similitud de texto.
 * Las coincidencias aproximadas NUNCA se confirman automáticamente.
 */
export async function matchLines(
  supabase: SupabaseClient,
  supplierId: string | null,
  lines: LineToMatch[],
  units: Unit[],
): Promise<LineMatch[]> {
  const raw = await Promise.all(
    lines.map((l) =>
      supabase.rpc("match_product_candidates", {
        p_supplier_id: supplierId,
        p_code: l.supplier_code ?? null,
        p_description: l.description,
        p_alt_description: l.generic_description ?? null,
        p_limit: 6,
      }),
    ),
  );
  const ids = Array.from(new Set(raw.flatMap((r) => (r.data ?? []).map((c: { product_id: string }) => c.product_id))));
  const { data: products } = ids.length
    ? await supabase
        .from("products")
        .select("id, name, sku, brand, purchase_unit, inventory_unit, units_per_package, size_value, size_unit")
        .in("id", ids)
    : { data: [] };
  const pmap = new Map((products ?? []).map((p) => [p.id, p]));

  return lines.map((line, idx) => {
    const lineBrand = normalizeText(line.brand);
    const lineSize = parseSize(`${line.description} ${line.package_description ?? ""}`);
    const candidates: MatchCandidate[] = ((raw[idx].data ?? []) as { product_id: string; method: MatchMethod; score: number; matched_text: string }[])
      .map((c) => {
        const p = pmap.get(c.product_id);
        if (!p) return null;
        let score = Number(c.score);
        let method = c.method;
        if (method === "fuzzy" || method === "alias") {
          const brandOk = !!lineBrand && !!p.brand && normalizeText(p.brand) === lineBrand;
          const productSize = p.size_value ? { value: Number(p.size_value), unit: p.size_unit } : parseSize(p.name);
          const sizeOk = !!lineSize && !!productSize && productSize.unit === lineSize.unit && Math.abs(productSize.value - lineSize.value) < 0.01;
          const sizeConflict = !!lineSize && !!productSize && productSize.unit === lineSize.unit && !sizeOk;
          const unitOk = !!line.unit && (line.unit === p.purchase_unit || line.unit === p.inventory_unit);
          if (method === "fuzzy" && brandOk && sizeOk) {
            method = "brand_presentation";
            score = Math.min(0.92, score + 0.2);
          } else if (method === "fuzzy" && unitOk && (sizeOk || brandOk)) {
            method = "name_unit";
            score = Math.min(0.88, score + 0.1);
          } else {
            if (brandOk) score += 0.05;
            if (sizeOk) score += 0.05;
          }
          // Presentaciones distintas no son el mismo producto
          if (sizeConflict) score -= 0.3;
        }
        return {
          product_id: p.id,
          name: p.name,
          sku: p.sku,
          brand: p.brand,
          method,
          score: Math.max(0, Math.min(1, Math.round(score * 10000) / 10000)),
          matched_text: c.matched_text,
          purchase_unit: p.purchase_unit,
          inventory_unit: p.inventory_unit,
          units_per_package: Number(p.units_per_package),
        } satisfies MatchCandidate;
      })
      .filter((c): c is MatchCandidate => c !== null)
      .sort((a, b) => b.score - a.score);

    const best = candidates[0];
    if (!best || best.score < SUGGEST_THRESHOLD) {
      return { product_id: null, method: null, score: null, confirmed: false, conversion_factor: line.units_per_package || 1, conversion_reason: null, candidates };
    }
    const confirmed = EXACT.includes(best.method) || (best.method === "alias" && best.score >= 0.97);
    const pkg = line.units_per_package ?? parsePackageCount(line.package_description ?? line.description);
    const conv = proposeConversion(line.unit, best, units, pkg);
    return {
      product_id: best.product_id,
      method: best.method,
      score: best.score,
      confirmed: confirmed && conv.certain,
      conversion_factor: conv.factor,
      conversion_reason: conv.reason,
      candidates,
    };
  });
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

export function diceSimilarity(a: string, b: string): number {
  const x = normalizeText(a).replace(/\s+/g, "");
  const y = normalizeText(b).replace(/\s+/g, "");
  if (!x || !y) return 0;
  if (x === y) return 1;
  const A = bigrams(x);
  const B = bigrams(y);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  return (2 * inter) / (x.length - 1 + y.length - 1);
}

/** Sugiere el proveedor por identificación fiscal o similitud del nombre. */
export async function suggestSupplier(
  supabase: SupabaseClient,
  name: string | null,
  taxId: string | null,
): Promise<{ id: string; trade_name: string; score: number; by: "tax_id" | "name" } | null> {
  const { data } = await supabase.from("suppliers").select("id, trade_name, legal_name, tax_id").eq("active", true);
  const suppliers = data ?? [];
  const cleanTax = (t: string | null) => (t ?? "").replace(/[^0-9a-z]/gi, "").toUpperCase();
  if (taxId && cleanTax(taxId).length >= 5) {
    const hit = suppliers.find((s) => cleanTax(s.tax_id) === cleanTax(taxId));
    if (hit) return { id: hit.id, trade_name: hit.trade_name, score: 1, by: "tax_id" };
  }
  if (!name) return null;
  let best: { id: string; trade_name: string; score: number; by: "name" } | null = null;
  for (const s of suppliers) {
    const score = Math.max(diceSimilarity(name, s.trade_name), s.legal_name ? diceSimilarity(name, s.legal_name) : 0);
    if (!best || score > best.score) best = { id: s.id, trade_name: s.trade_name, score, by: "name" };
  }
  return best && best.score >= 0.6 ? best : null;
}
