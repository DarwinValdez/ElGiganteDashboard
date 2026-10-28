import Link from "next/link";
import { notFound } from "next/navigation";

import { PoActions, VoidReceiptButton, type PoPdfData } from "@/app/(app)/purchase-orders/[id]/po-actions";
import { PageHeader } from "@/components/common/page-header";
import { InvoiceStatusBadge, PoStatusBadge } from "@/components/common/status-badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePage } from "@/lib/auth";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import type { InvoiceStatus, PoStatus } from "@/lib/types";

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requirePage("po.read");
  const { data: po } = await supabase
    .from("purchase_orders")
    .select("*, suppliers(trade_name, email), purchase_order_items(*, products(name, sku, inventory_unit))")
    .eq("id", id)
    .order("line_no", { referencedTable: "purchase_order_items" })
    .maybeSingle();
  if (!po) notFound();
  const [{ data: receipts }, { data: invoices }] = await Promise.all([
    supabase
      .from("goods_receipts")
      .select("id, receipt_number, status, received_at, notes, void_reason, goods_receipt_items(id, received_quantity, ordered_quantity, unit, is_extra, difference_reason, unit_price, ordered_unit_price, products(name))")
      .eq("purchase_order_id", id)
      .order("created_at", { ascending: false }),
    supabase.from("invoices").select("id, invoice_number, status, issue_date, total").eq("purchase_order_id", id),
  ]);

  type Item = { id: string; line_no: number; quantity: number; unit: string; units_per_package: number; unit_price: number; discount: number; tax_rate: number; line_total: number; received_quantity: number; products: { name: string; sku: string; inventory_unit: string } };
  const items = po.purchase_order_items as Item[];
  const cur = po.currency as string;
  const pdf: PoPdfData = {
    po_number: po.po_number,
    status: po.status,
    order_date: po.order_date,
    expected_date: po.expected_date,
    supplier: po.suppliers?.trade_name ?? "",
    supplier_email: po.suppliers?.email ?? null,
    currency: cur,
    notes: po.notes,
    subtotal: po.subtotal,
    discount_total: po.discount_total,
    tax_total: po.tax_total,
    total: po.total,
    items: items.map((i) => ({ ...i, name: i.products.name, sku: i.products.sku })),
  };
  type RItem = { id: string; received_quantity: number; ordered_quantity: number; unit: string; is_extra: boolean; difference_reason: string | null; unit_price: number | null; ordered_unit_price: number | null; products: { name: string } };

  return (
    <>
      <PageHeader
        title={`Orden ${po.po_number}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/suppliers/${po.supplier_id}`} className="hover:underline">
              {po.suppliers?.trade_name}
            </Link>
            · {formatDate(po.order_date)} <PoStatusBadge status={po.status as PoStatus} />
          </span>
        }
        actions={<PoActions id={id} po={pdf} isAdmin={profile.role === "admin"} />}
      />
      {po.status === "cancelled" ? (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Cancelada: {po.cancel_reason}</p>
      ) : null}

      <Card className="gap-0 pb-0">
        <CardHeader className="pb-3">
          <CardTitle>Productos solicitados</CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Producto</TableHead>
              <TableHead className="text-right">Cantidad</TableHead>
              <TableHead className="text-right">Recibido</TableHead>
              <TableHead className="text-right">Precio est.</TableHead>
              <TableHead className="text-right">Desc.</TableHead>
              <TableHead className="text-right">Imp. %</TableHead>
              <TableHead className="text-right">Importe</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => {
              const pending = Number(i.quantity) - Number(i.received_quantity);
              return (
                <TableRow key={i.id}>
                  <TableCell>{i.line_no}</TableCell>
                  <TableCell>
                    {i.products.name} <span className="font-mono text-xs text-muted-foreground">{i.products.sku}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    {formatNumber(i.quantity)} {i.unit}
                    {Number(i.units_per_package) !== 1 ? <span className="text-xs text-muted-foreground"> ×{formatNumber(i.units_per_package)}</span> : null}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatNumber(i.received_quantity)}
                    {pending > 0 && Number(i.received_quantity) > 0 ? <Badge variant="warning" className="ml-1">Faltan {formatNumber(pending)}</Badge> : null}
                    {pending < 0 ? <Badge variant="secondary" className="ml-1">+{formatNumber(-pending)}</Badge> : null}
                  </TableCell>
                  <TableCell className="text-right">{formatMoney(i.unit_price, cur)}</TableCell>
                  <TableCell className="text-right">{formatMoney(i.discount, cur)}</TableCell>
                  <TableCell className="text-right">{formatNumber(i.tax_rate)}</TableCell>
                  <TableCell className="text-right">{formatMoney(i.line_total, cur)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={7} className="text-right">Subtotal</TableCell>
              <TableCell className="text-right">{formatMoney(po.subtotal, cur)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell colSpan={7} className="text-right">Descuento</TableCell>
              <TableCell className="text-right">−{formatMoney(po.discount_total, cur)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell colSpan={7} className="text-right">Impuestos</TableCell>
              <TableCell className="text-right">{formatMoney(po.tax_total, cur)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell colSpan={7} className="text-right font-bold">Total</TableCell>
              <TableCell className="text-right font-bold">{formatMoney(po.total, cur)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </Card>

      {po.notes ? (
        <Card className="mt-4">
          <CardContent className="text-sm">
            <span className="font-medium">Notas: </span>
            {po.notes}
          </CardContent>
        </Card>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recepciones</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {(receipts ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Sin recepciones registradas.</p> : null}
            {(receipts ?? []).map((r) => (
              <div key={r.id} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium">
                    {r.receipt_number} · {formatDate(r.received_at)}{" "}
                    <Badge variant={r.status === "confirmed" ? "success" : r.status === "voided" ? "outline" : "muted"}>
                      {r.status === "confirmed" ? "Confirmada" : r.status === "voided" ? "Anulada" : "Borrador"}
                    </Badge>
                  </div>
                  {r.status === "confirmed" && profile.role === "admin" ? <VoidReceiptButton id={r.id} poId={id} /> : null}
                </div>
                <ul className="mt-2 space-y-1">
                  {(r.goods_receipt_items as unknown as RItem[]).map((ri) => {
                    const diff = Number(ri.received_quantity) - Number(ri.ordered_quantity);
                    const priceChanged = ri.unit_price !== null && ri.ordered_unit_price !== null && Number(ri.unit_price) !== Number(ri.ordered_unit_price);
                    return (
                      <li key={ri.id} className="flex flex-wrap items-center gap-1">
                        {ri.products.name}: {formatNumber(ri.received_quantity)} {ri.unit}
                        {ri.is_extra ? <Badge variant="secondary">Adicional</Badge> : null}
                        {!ri.is_extra && diff !== 0 ? <Badge variant="warning">{diff > 0 ? "+" : ""}{formatNumber(diff)} vs. pedido</Badge> : null}
                        {priceChanged ? <Badge variant="warning">Precio {formatMoney(ri.ordered_unit_price, cur)} → {formatMoney(ri.unit_price, cur)}</Badge> : null}
                        {ri.difference_reason ? <span className="text-xs text-muted-foreground">({ri.difference_reason})</span> : null}
                      </li>
                    );
                  })}
                </ul>
                {r.void_reason ? <p className="mt-1 text-xs text-destructive">Anulada: {r.void_reason}</p> : null}
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Facturas vinculadas</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {(invoices ?? []).length === 0 ? <p className="text-muted-foreground">Ninguna factura vinculada todavía.</p> : null}
            {(invoices ?? []).map((inv) => (
              <Link key={inv.id} href={`/invoices/${inv.id}`} className="flex items-center justify-between rounded-md border p-2 hover:bg-muted">
                <span>
                  {inv.invoice_number ?? "(sin número)"} · {formatDate(inv.issue_date)}
                </span>
                <span className="flex items-center gap-2">
                  {formatMoney(inv.total, cur)} <InvoiceStatusBadge status={inv.status as InvoiceStatus} />
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Creada {formatDateTime(po.created_at)}
        {po.approved_at ? ` · Aprobada ${formatDateTime(po.approved_at)}` : ""}
        {po.sent_at ? ` · Enviada ${formatDateTime(po.sent_at)}` : ""}
      </p>
    </>
  );
}
