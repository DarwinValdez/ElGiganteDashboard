import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { INVOICE_STATUS_LABELS, MOVEMENT_LABELS, PO_STATUS_LABELS } from "@/lib/labels";
import type { InvoiceStatus, MovementType, PoStatus } from "@/lib/types";

export type ColFormat = "text" | "money" | "cost" | "number" | "date" | "datetime" | "pct";
export interface ReportColumn {
  key: string;
  label: string;
  format?: ColFormat;
}
export interface ReportResult {
  title: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  totals?: Record<string, number>;
}
export interface ReportFilters {
  from: string;
  to: string;
  supplier?: string | null;
  product?: string | null;
}

export const REPORTS: { key: string; label: string; filters: ("date" | "supplier" | "product")[] }[] = [
  { key: "purchases_period", label: "Compras por período", filters: ["date", "supplier"] },
  { key: "purchases_supplier", label: "Compras por proveedor", filters: ["date"] },
  { key: "purchases_category", label: "Compras por categoría", filters: ["date", "supplier"] },
  { key: "price_history", label: "Historial de precios", filters: ["date", "supplier", "product"] },
  { key: "cost_increases", label: "Productos con aumento de costo", filters: ["date"] },
  { key: "cost_decreases", label: "Productos con disminución de costo", filters: ["date"] },
  { key: "pending_invoices", label: "Facturas pendientes de revisión", filters: ["supplier"] },
  { key: "open_pos", label: "Órdenes de compra abiertas", filters: ["supplier"] },
  { key: "po_invoice_diff", label: "Diferencias entre órdenes y facturas", filters: ["date"] },
  { key: "inventory_current", label: "Inventario actual", filters: [] },
  { key: "inventory_movements", label: "Movimientos de inventario", filters: ["date", "product"] },
  { key: "product_rotation", label: "Productos con mayor rotación", filters: ["date"] },
  { key: "supplier_debts", label: "Deudas con proveedores", filters: ["supplier"] },
  { key: "payments", label: "Pagos a proveedores", filters: ["date", "supplier"] },
];

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as T;
}

type R = Record<string, unknown>;

export async function runReport(supabase: SupabaseClient, key: string, f: ReportFilters): Promise<ReportResult> {
  const def = REPORTS.find((r) => r.key === key);
  if (!def) throw new Error("Reporte no encontrado");
  const title = def.label;

  switch (key) {
    case "purchases_period": {
      const rows = check<R[]>(await supabase.rpc("purchases_by_month", { p_from: f.from, p_to: f.to, p_supplier_id: f.supplier ?? null }));
      return {
        title,
        columns: [
          { key: "month", label: "Mes", format: "date" },
          { key: "invoices", label: "Facturas", format: "number" },
          { key: "total", label: "Total", format: "money" },
        ],
        rows,
        totals: { invoices: rows.reduce((a, r) => a + Number(r.invoices), 0), total: rows.reduce((a, r) => a + Number(r.total), 0) },
      };
    }
    case "purchases_supplier": {
      const rows = check<R[]>(await supabase.rpc("purchases_by_supplier", { p_from: f.from, p_to: f.to }));
      return {
        title,
        columns: [
          { key: "trade_name", label: "Proveedor" },
          { key: "invoices", label: "Facturas", format: "number" },
          { key: "total", label: "Total", format: "money" },
        ],
        rows,
        totals: { invoices: rows.reduce((a, r) => a + Number(r.invoices), 0), total: rows.reduce((a, r) => a + Number(r.total), 0) },
      };
    }
    case "purchases_category": {
      const rows = check<R[]>(await supabase.rpc("purchases_by_category", { p_from: f.from, p_to: f.to, p_supplier_id: f.supplier ?? null }));
      return {
        title,
        columns: [
          { key: "category", label: "Categoría" },
          { key: "lines", label: "Líneas", format: "number" },
          { key: "total", label: "Total (antes de impuestos)", format: "money" },
        ],
        rows,
        totals: { total: rows.reduce((a, r) => a + Number(r.total), 0) },
      };
    }
    case "price_history": {
      let q = supabase
        .from("product_cost_history")
        .select("purchase_date, document_number, quantity, unit, conversion_factor, package_price, normalized_unit_cost, effective_unit_cost, line_tax, allocated_freight, products(name, sku, inventory_unit), suppliers(trade_name)")
        .eq("voided", false)
        .gte("purchase_date", f.from)
        .lte("purchase_date", f.to)
        .order("purchase_date", { ascending: false })
        .limit(5000);
      if (f.supplier) q = q.eq("supplier_id", f.supplier);
      if (f.product) q = q.eq("product_id", f.product);
      const data = check<R[]>(await q);
      return {
        title,
        columns: [
          { key: "purchase_date", label: "Fecha", format: "date" },
          { key: "product", label: "Producto" },
          { key: "supplier", label: "Proveedor" },
          { key: "document_number", label: "Factura" },
          { key: "quantity", label: "Cantidad", format: "number" },
          { key: "unit", label: "Unidad" },
          { key: "package_price", label: "Precio por unidad facturada", format: "money" },
          { key: "normalized_unit_cost", label: "Costo normalizado", format: "cost" },
          { key: "inventory_unit", label: "Por" },
          { key: "effective_unit_cost", label: "Costo efectivo", format: "cost" },
          { key: "line_tax", label: "Impuesto", format: "money" },
          { key: "allocated_freight", label: "Flete asignado", format: "money" },
        ],
        rows: data.map((r) => {
          const p = r.products as { name: string; inventory_unit: string } | null;
          return { ...r, product: p?.name, inventory_unit: p?.inventory_unit, supplier: (r.suppliers as { trade_name: string } | null)?.trade_name };
        }),
      };
    }
    case "cost_increases":
    case "cost_decreases": {
      const q = supabase
        .from("product_cost_changes")
        .select("sku, name, inventory_unit, previous_cost, previous_date, last_cost, last_date, diff, pct")
        .gte("last_date", f.from)
        .lte("last_date", f.to);
      const data = check<R[]>(await (key === "cost_increases" ? q.gt("diff", 0).order("pct", { ascending: false }) : q.lt("diff", 0).order("pct", { ascending: true })));
      return {
        title,
        columns: [
          { key: "sku", label: "SKU" },
          { key: "name", label: "Producto" },
          { key: "inventory_unit", label: "Unidad" },
          { key: "previous_cost", label: "Costo anterior", format: "cost" },
          { key: "previous_date", label: "Fecha anterior", format: "date" },
          { key: "last_cost", label: "Último costo", format: "cost" },
          { key: "last_date", label: "Fecha", format: "date" },
          { key: "diff", label: "Diferencia", format: "cost" },
          { key: "pct", label: "Variación", format: "pct" },
        ],
        rows: data,
      };
    }
    case "pending_invoices": {
      let q = supabase
        .from("invoices")
        .select("invoice_number, supplier_name_raw, status, issue_date, total, created_at, suppliers(trade_name)")
        .in("status", ["uploaded", "processing", "ocr_failed", "needs_review"])
        .order("created_at");
      if (f.supplier) q = q.eq("supplier_id", f.supplier);
      const data = check<R[]>(await q);
      return {
        title,
        columns: [
          { key: "invoice_number", label: "Número" },
          { key: "supplier", label: "Proveedor" },
          { key: "status_label", label: "Estado" },
          { key: "issue_date", label: "Emisión", format: "date" },
          { key: "total", label: "Total", format: "money" },
          { key: "created_at", label: "Registrada", format: "datetime" },
        ],
        rows: data.map((r) => ({
          ...r,
          supplier: (r.suppliers as { trade_name: string } | null)?.trade_name ?? r.supplier_name_raw,
          status_label: INVOICE_STATUS_LABELS[r.status as InvoiceStatus],
        })),
      };
    }
    case "open_pos": {
      let q = supabase
        .from("purchase_orders")
        .select("po_number, status, order_date, expected_date, total, suppliers(trade_name)")
        .in("status", ["draft", "pending_approval", "approved", "sent", "partially_received"])
        .order("order_date");
      if (f.supplier) q = q.eq("supplier_id", f.supplier);
      const data = check<R[]>(await q);
      return {
        title,
        columns: [
          { key: "po_number", label: "Orden" },
          { key: "supplier", label: "Proveedor" },
          { key: "status_label", label: "Estado" },
          { key: "order_date", label: "Fecha", format: "date" },
          { key: "expected_date", label: "Entrega", format: "date" },
          { key: "total", label: "Total", format: "money" },
        ],
        rows: data.map((r) => ({ ...r, supplier: (r.suppliers as { trade_name: string } | null)?.trade_name, status_label: PO_STATUS_LABELS[r.status as PoStatus] })),
        totals: { total: data.reduce((a, r) => a + Number(r.total), 0) },
      };
    }
    case "po_invoice_diff": {
      const data = check<R[]>(await supabase.rpc("po_invoice_differences", { p_from: f.from, p_to: f.to }));
      return {
        title,
        columns: [
          { key: "invoice_number", label: "Factura" },
          { key: "po_number", label: "Orden" },
          { key: "supplier", label: "Proveedor" },
          { key: "product", label: "Producto" },
          { key: "ordered_qty", label: "Pedido (u. inv.)", format: "number" },
          { key: "invoiced_qty", label: "Facturado (u. inv.)", format: "number" },
          { key: "qty_diff", label: "Dif. cantidad", format: "number" },
          { key: "ordered_unit_cost", label: "Costo pedido", format: "cost" },
          { key: "invoiced_unit_cost", label: "Costo facturado", format: "cost" },
          { key: "cost_diff", label: "Dif. costo", format: "cost" },
        ],
        rows: data,
      };
    }
    case "inventory_current": {
      const data = check<R[]>(
        await supabase
          .from("products")
          .select("sku, name, inventory_unit, current_stock, min_stock, effective_unit_cost, normalized_unit_cost, categories(name)")
          .eq("active", true)
          .order("name")
          .limit(10000),
      );
      const rows = data.map((r) => {
        const cost = Number(r.effective_unit_cost ?? r.normalized_unit_cost ?? 0);
        return { ...r, category: (r.categories as { name: string } | null)?.name, unit_cost: cost, value: Math.max(Number(r.current_stock), 0) * cost };
      });
      return {
        title,
        columns: [
          { key: "sku", label: "SKU" },
          { key: "name", label: "Producto" },
          { key: "category", label: "Categoría" },
          { key: "current_stock", label: "Existencias", format: "number" },
          { key: "inventory_unit", label: "Unidad" },
          { key: "min_stock", label: "Mínimo", format: "number" },
          { key: "unit_cost", label: "Costo unitario", format: "cost" },
          { key: "value", label: "Valor", format: "money" },
        ],
        rows,
        totals: { value: rows.reduce((a, r) => a + r.value, 0) },
      };
    }
    case "inventory_movements": {
      let q = supabase
        .from("inventory_movements")
        .select("created_at, movement_type, quantity, unit_cost, source_type, reason, products(name, sku, inventory_unit)")
        .gte("created_at", `${f.from}T00:00:00Z`)
        .lte("created_at", `${f.to}T23:59:59Z`)
        .order("created_at", { ascending: false })
        .limit(10000);
      if (f.product) q = q.eq("product_id", f.product);
      const data = check<R[]>(await q);
      return {
        title,
        columns: [
          { key: "created_at", label: "Fecha", format: "datetime" },
          { key: "sku", label: "SKU" },
          { key: "product", label: "Producto" },
          { key: "type", label: "Tipo" },
          { key: "quantity", label: "Cantidad", format: "number" },
          { key: "inventory_unit", label: "Unidad" },
          { key: "source_type", label: "Origen" },
          { key: "reason", label: "Motivo" },
        ],
        rows: data.map((r) => {
          const p = r.products as { name: string; sku: string; inventory_unit: string } | null;
          return { ...r, product: p?.name, sku: p?.sku, inventory_unit: p?.inventory_unit, type: MOVEMENT_LABELS[r.movement_type as MovementType] };
        }),
      };
    }
    case "product_rotation": {
      const data = check<R[]>(await supabase.rpc("product_rotation", { p_from: f.from, p_to: f.to }));
      return {
        title,
        columns: [
          { key: "sku", label: "SKU" },
          { key: "name", label: "Producto" },
          { key: "out_qty", label: "Salidas (ventas + consumo)", format: "number" },
          { key: "sales_qty", label: "Ventas", format: "number" },
          { key: "in_qty", label: "Entradas por compra", format: "number" },
          { key: "current_stock", label: "Existencias", format: "number" },
          { key: "inventory_unit", label: "Unidad" },
        ],
        rows: data,
      };
    }
    case "supplier_debts": {
      let q = supabase.from("supplier_balances").select("*").neq("balance", 0).order("balance", { ascending: false });
      if (f.supplier) q = q.eq("supplier_id", f.supplier);
      const data = check<R[]>(await q);
      return {
        title,
        columns: [
          { key: "trade_name", label: "Proveedor" },
          { key: "invoiced", label: "Facturado", format: "money" },
          { key: "paid", label: "Pagado", format: "money" },
          { key: "balance", label: "Saldo", format: "money" },
          { key: "overdue_invoices", label: "Facturas vencidas", format: "number" },
        ],
        rows: data,
        totals: { balance: data.reduce((a, r) => a + Number(r.balance), 0) },
      };
    }
    case "payments": {
      let q = supabase
        .from("payments")
        .select("paid_at, amount, method, reference, voided, suppliers(trade_name), invoices(invoice_number)")
        .gte("paid_at", f.from)
        .lte("paid_at", f.to)
        .order("paid_at", { ascending: false });
      if (f.supplier) q = q.eq("supplier_id", f.supplier);
      const data = check<R[]>(await q);
      const rows = data.map((r) => ({
        ...r,
        supplier: (r.suppliers as { trade_name: string } | null)?.trade_name,
        invoice: (r.invoices as { invoice_number: string } | null)?.invoice_number ?? "A cuenta",
        state: r.voided ? "Anulado" : "Vigente",
      }));
      return {
        title,
        columns: [
          { key: "paid_at", label: "Fecha", format: "date" },
          { key: "supplier", label: "Proveedor" },
          { key: "invoice", label: "Factura" },
          { key: "method", label: "Método" },
          { key: "reference", label: "Referencia" },
          { key: "amount", label: "Monto", format: "money" },
          { key: "state", label: "Estado" },
        ],
        rows,
        totals: { amount: data.filter((r) => !r.voided).reduce((a, r) => a + Number(r.amount), 0) },
      };
    }
  }
  throw new Error("Reporte no implementado");
}

/** CSV compatible con Excel (BOM UTF-8, comillas escapadas). */
export function toCsv(result: ReportResult): string {
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? String(v) : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [result.columns.map((c) => esc(c.label)).join(",")];
  for (const r of result.rows) lines.push(result.columns.map((c) => esc(r[c.key])).join(","));
  return "﻿" + lines.join("\r\n");
}
