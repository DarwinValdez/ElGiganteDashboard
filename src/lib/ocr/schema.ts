import { z } from "zod";

/**
 * Estructura que el modelo de visión debe devolver. Todos los campos que no
 * aparecen en el documento deben ser null: nunca se inventan valores.
 */
export const extractedLineSchema = z.object({
  supplier_code: z.string().nullable().describe("Código o SKU del proveedor impreso en la línea, si existe"),
  description: z.string().describe("Descripción exactamente como aparece en la factura"),
  brand: z.string().nullable(),
  quantity: z.number().nullable(),
  unit_raw: z.string().nullable().describe("Unidad tal como aparece (CJ, SACO, LB, UND...)"),
  unit_code: z.string().nullable().describe("Código de unidad normalizado de la lista permitida, o null si no es claro"),
  package_description: z.string().nullable().describe("Presentación/empaque, ej. '12/1 L', '24/15 oz', '20 lb'"),
  units_per_package: z.number().nullable().describe("Unidades individuales por empaque si se deduce de la presentación (12/1 → 12)"),
  unit_price: z.number().nullable(),
  discount: z.number().nullable(),
  tax: z.number().nullable(),
  line_total: z.number().nullable().describe("Importe de la línea tal como está impreso"),
  generic_description_es: z.string().nullable().describe("Nombre genérico en español, en minúsculas, para buscar en el catálogo (ej. 'arroz grano largo 20 lb')"),
  confidence: z.number().describe("Confianza 0 a 1 en la lectura de esta línea"),
});

export const invoiceExtractionSchema = z.object({
  is_invoice: z.boolean().describe("true si el documento es una factura o documento de compra legible"),
  document_type: z.string().describe("factura, conduce, nota de crédito, recibo, otro"),
  supplier_name: z.string().nullable(),
  supplier_tax_id: z.string().nullable(),
  supplier_address: z.string().nullable(),
  supplier_phone: z.string().nullable(),
  invoice_number: z.string().nullable(),
  issue_date: z.string().nullable().describe("Formato YYYY-MM-DD"),
  due_date: z.string().nullable().describe("Formato YYYY-MM-DD"),
  purchase_order_number: z.string().nullable(),
  currency: z.string().nullable().describe("Código ISO 4217 (USD, DOP, EUR...)"),
  payment_terms: z.string().nullable(),
  subtotal: z.number().nullable(),
  discount_total: z.number().nullable(),
  tax_total: z.number().nullable(),
  freight_total: z.number().nullable(),
  other_charges: z.number().nullable(),
  total: z.number().nullable(),
  confidence_supplier: z.number(),
  confidence_invoice_number: z.number(),
  confidence_dates: z.number(),
  confidence_totals: z.number(),
  confidence_overall: z.number(),
  line_items: z.array(extractedLineSchema),
  warnings: z.array(z.object({ field: z.string(), message: z.string() })).describe("Campos ilegibles, ambiguos o dudosos"),
});

export type InvoiceExtraction = z.infer<typeof invoiceExtractionSchema>;
export type ExtractedLine = z.infer<typeof extractedLineSchema>;
