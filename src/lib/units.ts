import type { Unit } from "@/lib/types";

/** Normaliza texto: minúsculas, sin acentos ni signos (igual que normalize_text en SQL). */
export function normalizeText(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Extrae el número de unidades de una presentación tipo "12/1", "24/15 oz", "12x1L", "CJ 24". */
export function parsePackageCount(desc: string | null | undefined): number | null {
  if (!desc) return null;
  const s = desc.toLowerCase();
  const slash = s.match(/(\d+)\s*[/x×]\s*\d+(?:[.,]\d+)?\s*[a-z]*/);
  if (slash) return Number(slash[1]);
  const pack = s.match(/\b(?:cj|caja|pq|paq|paquete|fardo|bandeja|bulto)\s*(?:de\s*)?(\d+)\b/);
  if (pack) return Number(pack[1]);
  const und = s.match(/\b(\d+)\s*(?:und|unid|unidades|uds|pcs|ct)\b/);
  if (und) return Number(und[1]);
  return null;
}

/** Busca un tamaño "20 lb", "15 oz", "1 L" dentro de un texto. */
export function parseSize(desc: string | null | undefined): { value: number; unit: string } | null {
  if (!desc) return null;
  const m = desc.toLowerCase().replace(",", ".").match(/(\d+(?:\.\d+)?)\s*(lbs?|libras?|kg|kilos?|oz|onzas?|g|gr|gramos?|gal|galon(?:es)?|l|lt|litros?|ml)\b/);
  if (!m) return null;
  const map: Record<string, string> = { lb: "lb", lbs: "lb", libra: "lb", libras: "lb", kg: "kg", kilo: "kg", kilos: "kg", oz: "oz", onza: "oz", onzas: "oz", g: "g", gr: "g", gramo: "g", gramos: "g", gal: "gal", galon: "gal", galones: "gal", l: "l", lt: "l", litro: "l", litros: "l", ml: "ml" };
  return { value: Number(m[1]), unit: map[m[2]] ?? m[2] };
}

/**
 * Propone cuántas unidades de inventario representa una unidad facturada.
 * Nunca mezcla tipos distintos (peso con conteo, etc.).
 */
export function proposeConversion(
  lineUnit: string | null | undefined,
  product: { purchase_unit: string; inventory_unit: string; units_per_package: number },
  units: Unit[],
  packageCount?: number | null,
): { factor: number; reason: string; certain: boolean } {
  const upp = Number(product.units_per_package) || 1;
  if (!lineUnit) return { factor: upp, reason: `Sin unidad: se asume 1 ${product.purchase_unit} = ${upp} ${product.inventory_unit}`, certain: false };
  if (lineUnit === product.inventory_unit) return { factor: 1, reason: `Facturado en ${lineUnit} (unidad de inventario)`, certain: true };
  if (lineUnit === product.purchase_unit) return { factor: upp, reason: `1 ${lineUnit} = ${upp} ${product.inventory_unit}`, certain: true };
  const lu = units.find((u) => u.code === lineUnit);
  const iu = units.find((u) => u.code === product.inventory_unit);
  if (lu?.base_factor && iu?.base_factor && lu.kind === iu.kind) {
    const f = Number(lu.base_factor) / Number(iu.base_factor);
    return { factor: Math.round(f * 1e6) / 1e6, reason: `Conversión ${lineUnit} → ${product.inventory_unit}`, certain: true };
  }
  if (lu?.is_package && packageCount) {
    return { factor: packageCount, reason: `Presentación: ${packageCount} ${product.inventory_unit} por ${lineUnit}`, certain: false };
  }
  return { factor: upp, reason: `Unidad ${lineUnit} distinta a la del producto: verifique la conversión`, certain: false };
}
