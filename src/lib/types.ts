export type Role = "admin" | "purchasing" | "employee";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  active: boolean;
  created_at: string;
}

export interface AppSettings {
  id: number;
  company_name: string;
  currency: string;
  cost_include_freight: boolean;
  cost_include_discounts: boolean;
  cost_include_nonrecoverable_tax: boolean;
  cost_include_other_charges: boolean;
  cost_update_source: "invoice" | "receipt";
  inventory_entry_source: "invoice" | "receipt";
  total_tolerance: number;
  payments_enabled: boolean;
  default_tax_rate: number;
}

export interface Unit {
  code: string;
  name: string;
  kind: "count" | "weight" | "volume" | "length" | "other";
  base_factor: number | null;
  is_package: boolean;
  active: boolean;
}

export interface Category {
  id: string;
  name: string;
  parent_id: string | null;
  active: boolean;
}

export interface Supplier {
  id: string;
  trade_name: string;
  legal_name: string | null;
  tax_id: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  payment_terms: string | null;
  payment_days: number | null;
  notes: string | null;
  active: boolean;
  created_at: string;
}

export interface Product {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  category_id: string | null;
  brand: string | null;
  purchase_unit: string;
  inventory_unit: string;
  units_per_package: number;
  size_value: number | null;
  size_unit: string | null;
  default_supplier_id: string | null;
  last_purchase_price: number | null;
  normalized_unit_cost: number | null;
  effective_unit_cost: number | null;
  last_purchase_date: string | null;
  last_supplier_id: string | null;
  sale_price: number | null;
  min_stock: number;
  current_stock: number;
  active: boolean;
  notes: string | null;
  created_at: string;
}

export type PoStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "sent"
  | "partially_received"
  | "received"
  | "cancelled";

export type InvoiceStatus = "uploaded" | "processing" | "ocr_failed" | "needs_review" | "confirmed" | "voided";

export type MatchMethod =
  | "barcode"
  | "sku"
  | "supplier_code"
  | "alias"
  | "brand_presentation"
  | "name_unit"
  | "fuzzy"
  | "manual"
  | "created";

export interface Invoice {
  id: string;
  supplier_id: string | null;
  supplier_name_raw: string | null;
  invoice_number: string | null;
  issue_date: string | null;
  due_date: string | null;
  po_number_raw: string | null;
  purchase_order_id: string | null;
  currency: string;
  subtotal: number | null;
  discount_total: number;
  tax_total: number;
  freight_total: number;
  other_charges: number;
  total: number | null;
  payment_terms: string | null;
  status: InvoiceStatus;
  file_path: string | null;
  file_name: string | null;
  file_mime: string | null;
  file_size: number | null;
  file_sha256: string | null;
  ocr_provider: string | null;
  ocr_model: string | null;
  ocr_confidence: number | null;
  ocr_error: string | null;
  ocr_attempts: number;
  ocr_processed_at: string | null;
  warnings: OcrWarning[];
  total_exception_note: string | null;
  notes: string | null;
  confirmed_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
}

export interface OcrWarning {
  field: string;
  message: string;
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  line_no: number;
  supplier_code: string | null;
  original_description: string;
  product_id: string | null;
  match_method: MatchMethod | null;
  match_score: number | null;
  match_confirmed: boolean;
  brand: string | null;
  quantity: number;
  unit: string | null;
  unit_raw: string | null;
  package_description: string | null;
  conversion_factor: number;
  unit_price: number;
  discount: number;
  tax: number;
  line_total: number;
  ocr_confidence: number | null;
  review_note: string | null;
}

export interface InvoiceValidation {
  lines_count: number;
  lines_sum: number;
  computed_total: number;
  total_diff: number | null;
  subtotal_diff: number | null;
  line_mismatch_count: number;
  totals_ok: boolean;
  tolerance: number;
  unmatched_count: number;
  blocking: { code: string; message: string }[];
  warnings: { code: string; message: string }[];
  duplicates: { id: string; invoice_number: string | null; issue_date: string | null; total: number | null; status: InvoiceStatus; reason: string }[];
}

export type MovementType =
  | "receipt"
  | "sale"
  | "issue"
  | "adjustment_in"
  | "adjustment_out"
  | "damage"
  | "loss"
  | "return_supplier"
  | "reversal";

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };
