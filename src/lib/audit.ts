import { INVOICE_STATUS_LABELS, PO_STATUS_LABELS } from "@/lib/labels";
import type { InvoiceStatus, PoStatus } from "@/lib/types";

export interface AuditLog {
  id: number;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  summary: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
}

const ENTITY_LABELS: Record<string, string> = {
  invoices: "Factura",
  purchase_orders: "Orden de compra",
  products: "Producto",
  suppliers: "Proveedor",
  payments: "Pago",
  goods_receipts: "Recepción",
  categories: "Categoría",
  profiles: "Usuario",
  app_settings: "Configuración",
  product_supplier_codes: "Código de proveedor",
};

export function entityLabel(e: string) {
  return ENTITY_LABELS[e] ?? e;
}

export function entityHref(log: AuditLog): string | null {
  const id = log.entity_id;
  if (!id) return null;
  switch (log.entity) {
    case "invoices":
      return `/invoices/${id}`;
    case "purchase_orders":
      return `/purchase-orders/${id}`;
    case "products":
      return `/products/${id}`;
    case "suppliers":
      return `/suppliers/${id}`;
    default:
      return null;
  }
}

/** Descripción legible de un registro de auditoría. */
export function describeAudit(log: AuditLog): string {
  if (log.summary) return log.summary;
  const rec = (log.after ?? log.before ?? {}) as Record<string, unknown>;
  const name =
    (rec.invoice_number as string) ??
    (rec.po_number as string) ??
    (rec.receipt_number as string) ??
    (rec.name as string) ??
    (rec.trade_name as string) ??
    (rec.email as string) ??
    "";
  const label = entityLabel(log.entity);
  if (log.action.startsWith("status:")) {
    const st = log.action.slice(7);
    const stLabel =
      log.entity === "invoices"
        ? INVOICE_STATUS_LABELS[st as InvoiceStatus]
        : log.entity === "purchase_orders"
          ? PO_STATUS_LABELS[st as PoStatus]
          : st;
    return `${label} ${name} → ${stLabel ?? st}`.replace(/\s+/g, " ");
  }
  if (log.action === "insert") return `${label} creado(a): ${name}`.trim();
  if (log.action === "delete") return `${label} eliminado(a): ${name}`.trim();
  if (log.action === "update") {
    const changed = Object.keys(log.after ?? {}).filter(
      (k) => JSON.stringify((log.after ?? {})[k]) !== JSON.stringify((log.before ?? {})[k]),
    );
    return `${label} ${name} modificado(a)${changed.length ? `: ${changed.slice(0, 4).join(", ")}` : ""}`;
  }
  return `${label} ${log.action} ${name}`;
}
