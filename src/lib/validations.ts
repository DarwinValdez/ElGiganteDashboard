import { z } from "zod";

/** Convierte cadenas de formularios ("12,5", "") en números o undefined. */
const toNum = (v: unknown) => {
  if (v === "" || v === null || v === undefined) return undefined;
  if (typeof v === "string") {
    const n = Number(v.replace(/\s/g, "").replace(",", "."));
    return Number.isNaN(n) ? v : n;
  }
  return v;
};
const emptyToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const num = (msg = "Debe ser un número") => z.number({ error: msg });
export const zNum = (schema: z.ZodNumber = num()) => z.preprocess(toNum, schema);
export const zOptNum = (schema: z.ZodNumber = num()) => z.preprocess(toNum, schema.optional());
export const zOptStr = (max = 500) => z.preprocess(emptyToUndef, z.string().trim().max(max).optional());
export const zOptUuid = () => z.preprocess(emptyToUndef, z.uuid("Selección inválida").optional());
export const zDate = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");
export const zOptDate = () => z.preprocess(emptyToUndef, zDate().optional());

// ---------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------
export const productSchema = z.object({
  name: z.string().trim().min(2, "Nombre obligatorio").max(200),
  sku: zOptStr(50),
  barcode: z.preprocess(emptyToUndef, z.string().trim().regex(/^[0-9A-Za-z-]{4,32}$/, "Código de barras inválido").optional()),
  category_id: zOptUuid(),
  brand: zOptStr(100),
  purchase_unit: z.string().min(1, "Unidad de compra obligatoria"),
  inventory_unit: z.string().min(1, "Unidad de inventario obligatoria"),
  units_per_package: zNum(num().positive("Debe ser mayor que 0")),
  size_value: zOptNum(num().positive("Debe ser mayor que 0")),
  size_unit: zOptStr(20),
  default_supplier_id: zOptUuid(),
  sale_price: zOptNum(num().nonnegative("No puede ser negativo")),
  min_stock: zNum(num().nonnegative("No puede ser negativo")),
  active: z.boolean(),
  notes: zOptStr(2000),
});
export type ProductInput = z.input<typeof productSchema>;
export type ProductValues = z.output<typeof productSchema>;

export const categorySchema = z.object({ name: z.string().trim().min(2).max(100) });

export const unitSchema = z.object({
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{1,20}$/, "Código: minúsculas, números o _"),
  name: z.string().trim().min(1).max(50),
  kind: z.enum(["count", "weight", "volume", "length", "other"]),
  base_factor: zOptNum(num().positive()),
  is_package: z.boolean(),
});

// ---------------------------------------------------------------------
// Proveedores
// ---------------------------------------------------------------------
export const supplierSchema = z.object({
  trade_name: z.string().trim().min(2, "Nombre comercial obligatorio").max(200),
  legal_name: zOptStr(200),
  tax_id: zOptStr(50),
  contact_name: zOptStr(120),
  phone: zOptStr(50),
  email: z.preprocess(emptyToUndef, z.email("Correo inválido").optional()),
  address: zOptStr(500),
  payment_terms: zOptStr(200),
  payment_days: zOptNum(num().int().nonnegative()),
  notes: zOptStr(2000),
  active: z.boolean(),
});
export type SupplierInput = z.input<typeof supplierSchema>;

// ---------------------------------------------------------------------
// Órdenes de compra
// ---------------------------------------------------------------------
export const poItemSchema = z.object({
  product_id: z.uuid("Seleccione un producto"),
  description: zOptStr(300),
  quantity: zNum(num().positive("Cantidad > 0")),
  unit: z.string().min(1),
  units_per_package: zNum(num().positive()),
  unit_price: zNum(num().nonnegative("Precio inválido")),
  discount: zNum(num().nonnegative()),
  tax_rate: zNum(num().min(0).max(100)),
});

export const purchaseOrderSchema = z.object({
  id: zOptUuid(),
  supplier_id: z.uuid("Seleccione un proveedor"),
  order_date: zDate(),
  expected_date: zOptDate(),
  currency: z.string().length(3),
  notes: zOptStr(2000),
  discount_total: zNum(num().nonnegative()),
  items: z.array(poItemSchema).min(1, "Agregue al menos un producto"),
});
export type PurchaseOrderInput = z.input<typeof purchaseOrderSchema>;

// ---------------------------------------------------------------------
// Facturas
// ---------------------------------------------------------------------
export const invoiceItemSchema = z.object({
  supplier_code: zOptStr(80),
  original_description: z.string().trim().min(1, "Descripción obligatoria").max(500),
  product_id: zOptUuid(),
  match_method: zOptStr(30),
  match_score: zOptNum(num().min(0).max(1)),
  match_confirmed: z.boolean(),
  brand: zOptStr(100),
  quantity: zNum(num()),
  unit: zOptStr(20),
  unit_raw: zOptStr(50),
  package_description: zOptStr(100),
  conversion_factor: zNum(num().positive("Conversión > 0")),
  unit_price: zNum(num()),
  discount: zNum(num().nonnegative()),
  tax: zNum(num().nonnegative()),
  line_total: zNum(num()),
  ocr_confidence: zOptNum(num().min(0).max(1)),
  review_note: zOptStr(500),
});

export const invoiceReviewSchema = z.object({
  supplier_id: zOptUuid(),
  supplier_name_raw: zOptStr(200),
  invoice_number: zOptStr(80),
  issue_date: zOptDate(),
  due_date: zOptDate(),
  po_number_raw: zOptStr(80),
  purchase_order_id: zOptUuid(),
  currency: z.string().length(3),
  subtotal: zOptNum(),
  discount_total: zNum(num().nonnegative()),
  tax_total: zNum(num().nonnegative()),
  freight_total: zNum(num().nonnegative()),
  other_charges: zNum(num().nonnegative()),
  total: zOptNum(),
  payment_terms: zOptStr(200),
  notes: zOptStr(2000),
  items: z.array(invoiceItemSchema),
});
export type InvoiceReviewInput = z.input<typeof invoiceReviewSchema>;
export type InvoiceReviewValues = z.output<typeof invoiceReviewSchema>;

export const ALLOWED_INVOICE_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const MAX_INVOICE_BYTES = 15 * 1024 * 1024;

export const uploadRequestSchema = z.object({
  file_name: z.string().min(1).max(200),
  file_mime: z.enum(ALLOWED_INVOICE_MIME, "Formato no admitido (JPG, PNG, WEBP o PDF)"),
  file_size: z.number().int().positive().max(MAX_INVOICE_BYTES, "El archivo supera 15 MB"),
  file_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  supplier_id: zOptUuid(),
});

// ---------------------------------------------------------------------
// Recepciones, inventario y pagos
// ---------------------------------------------------------------------
export const receiptItemSchema = z.object({
  purchase_order_item_id: zOptUuid(),
  product_id: z.uuid("Seleccione un producto"),
  ordered_quantity: zNum(num().nonnegative()),
  received_quantity: zNum(num().nonnegative("No puede ser negativa")),
  unit: z.string().min(1),
  conversion_factor: zNum(num().positive()),
  ordered_unit_price: zOptNum(num().nonnegative()),
  unit_price: zOptNum(num().nonnegative()),
  is_extra: z.boolean(),
  difference_reason: zOptStr(300),
});

export const receiptSchema = z.object({
  purchase_order_id: zOptUuid(),
  supplier_id: zOptUuid(),
  received_at: zDate(),
  notes: zOptStr(2000),
  items: z.array(receiptItemSchema).min(1),
});
export type ReceiptInput = z.input<typeof receiptSchema>;

export const movementSchema = z.object({
  product_id: z.uuid("Seleccione un producto"),
  movement_type: z.enum(["sale", "issue", "adjustment_in", "adjustment_out", "damage", "loss", "return_supplier"]),
  quantity: zNum(num().positive("Cantidad > 0")),
  reason: zOptStr(300),
});
export type MovementInput = z.input<typeof movementSchema>;

export const paymentSchema = z.object({
  supplier_id: z.uuid("Seleccione un proveedor"),
  invoice_id: zOptUuid(),
  amount: zNum(num().positive("Monto > 0")),
  paid_at: zDate(),
  method: z.string().min(1).max(30),
  reference: zOptStr(100),
  notes: zOptStr(500),
});
export type PaymentInput = z.input<typeof paymentSchema>;

// ---------------------------------------------------------------------
// Administración
// ---------------------------------------------------------------------
export const settingsSchema = z.object({
  company_name: z.string().trim().min(2).max(120),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Código ISO de 3 letras"),
  cost_include_freight: z.boolean(),
  cost_include_discounts: z.boolean(),
  cost_include_nonrecoverable_tax: z.boolean(),
  cost_include_other_charges: z.boolean(),
  cost_update_source: z.enum(["invoice", "receipt"]),
  inventory_entry_source: z.enum(["invoice", "receipt"]),
  total_tolerance: zNum(num().min(0).max(100)),
  payments_enabled: z.boolean(),
  default_tax_rate: zNum(num().min(0).max(100)),
});
export type SettingsInput = z.input<typeof settingsSchema>;

export const newUserSchema = z.object({
  email: z.email("Correo inválido"),
  full_name: z.string().trim().min(2).max(120),
  password: z.string().min(8, "Mínimo 8 caracteres"),
  role: z.enum(["admin", "purchasing", "employee"]),
});
