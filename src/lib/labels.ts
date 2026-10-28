import type { InvoiceStatus, MatchMethod, MovementType, PoStatus, Role } from "@/lib/types";

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  purchasing: "Encargado de compras",
  employee: "Empleado",
};

export const PO_STATUS_LABELS: Record<PoStatus, string> = {
  draft: "Borrador",
  pending_approval: "Pendiente de aprobación",
  approved: "Aprobada",
  sent: "Enviada al proveedor",
  partially_received: "Recibida parcialmente",
  received: "Recibida completamente",
  cancelled: "Cancelada",
};

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  uploaded: "Subida",
  processing: "Procesando OCR",
  ocr_failed: "OCR fallido",
  needs_review: "Pendiente de revisión",
  confirmed: "Confirmada",
  voided: "Anulada",
};

export const MATCH_METHOD_LABELS: Record<MatchMethod, string> = {
  barcode: "Código de barras",
  sku: "SKU",
  supplier_code: "Código del proveedor",
  alias: "Asociación confirmada",
  brand_presentation: "Marca y presentación",
  name_unit: "Nombre y unidad",
  fuzzy: "Similitud de texto",
  manual: "Selección manual",
  created: "Producto creado",
};

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  receipt: "Entrada por compra",
  sale: "Venta",
  issue: "Salida / consumo",
  adjustment_in: "Ajuste positivo",
  adjustment_out: "Ajuste negativo",
  damage: "Daño",
  loss: "Pérdida",
  return_supplier: "Devolución a proveedor",
  reversal: "Reverso por anulación",
};

export const PAYMENT_METHODS = ["transferencia", "efectivo", "cheque", "tarjeta", "otro"] as const;
