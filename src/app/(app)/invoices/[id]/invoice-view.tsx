import Link from "next/link";
import { Ban } from "lucide-react";

import { InvoiceStatusBadge } from "@/components/common/status-badges";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCost, formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { MATCH_METHOD_LABELS } from "@/lib/labels";
import type { Invoice, InvoiceItem } from "@/lib/types";

type Item = InvoiceItem & { products: { name: string; sku: string; inventory_unit: string } | null };

export function InvoiceView({
  invoice,
  items,
  supplierName,
  poNumber,
  payments,
  balance,
}: {
  invoice: Invoice & { confirmed_by_name?: string | null };
  items: Item[];
  supplierName: string | null;
  poNumber: string | null;
  payments: { id: string; paid_at: string; amount: number; method: string; voided: boolean }[];
  balance: number | null;
}) {
  const cur = invoice.currency;
  const linesSum = items.reduce((a, i) => a + Number(i.line_total), 0);
  return (
    <div className="grid gap-4">
      {invoice.status === "voided" ? (
        <Alert variant="destructive">
          <Ban />
          <AlertTitle>Factura anulada {formatDateTime(invoice.voided_at)}</AlertTitle>
          <AlertDescription>Motivo: {invoice.void_reason}. Sus efectos en costos e inventario fueron revertidos; el historial se conserva.</AlertDescription>
        </Alert>
      ) : null}
      {invoice.total_exception_note ? (
        <Alert variant="warning">
          <AlertTitle>Confirmada con excepción en los totales</AlertTitle>
          <AlertDescription>{invoice.total_exception_note}</AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardContent className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div><span className="text-muted-foreground">Proveedor: </span>{supplierName}</div>
          <div><span className="text-muted-foreground">Estado: </span><InvoiceStatusBadge status={invoice.status} /></div>
          <div><span className="text-muted-foreground">Emisión: </span>{formatDate(invoice.issue_date)}</div>
          <div><span className="text-muted-foreground">Vencimiento: </span>{formatDate(invoice.due_date)}</div>
          <div>
            <span className="text-muted-foreground">Orden de compra: </span>
            {invoice.purchase_order_id ? <Link className="underline" href={`/purchase-orders/${invoice.purchase_order_id}`}>{poNumber}</Link> : invoice.po_number_raw ?? "—"}
          </div>
          <div><span className="text-muted-foreground">Condiciones: </span>{invoice.payment_terms ?? "—"}</div>
          <div><span className="text-muted-foreground">Confirmada: </span>{formatDateTime(invoice.confirmed_at)}</div>
          {balance !== null ? <div><span className="text-muted-foreground">Saldo pendiente: </span><strong>{formatMoney(balance, cur)}</strong></div> : null}
        </CardContent>
      </Card>
      <Card className="gap-0 pb-0">
        <CardHeader className="pb-3">
          <CardTitle>Líneas</CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Descripción del proveedor / Producto</TableHead>
              <TableHead className="text-right">Cantidad</TableHead>
              <TableHead className="text-right">Precio</TableHead>
              <TableHead className="text-right">Desc.</TableHead>
              <TableHead className="text-right">Imp.</TableHead>
              <TableHead className="text-right">Importe</TableHead>
              <TableHead className="text-right">Costo normalizado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => {
              const invQty = Number(i.quantity) * Number(i.conversion_factor);
              return (
                <TableRow key={i.id}>
                  <TableCell>{i.line_no}</TableCell>
                  <TableCell className="whitespace-normal">
                    <div className="font-medium">{i.original_description}</div>
                    <div className="text-xs text-muted-foreground">
                      → {i.products ? <Link className="underline" href={`/products/${i.product_id}`}>{i.products.name}</Link> : "—"}
                      {i.match_method ? <Badge variant="muted" className="ml-1">{MATCH_METHOD_LABELS[i.match_method]}</Badge> : null}
                      {i.supplier_code ? ` · Cód. ${i.supplier_code}` : ""}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {formatNumber(i.quantity)} {i.unit}
                    <div className="text-xs text-muted-foreground">= {formatNumber(invQty)} {i.products?.inventory_unit}</div>
                  </TableCell>
                  <TableCell className="text-right">{formatMoney(i.unit_price, cur)}</TableCell>
                  <TableCell className="text-right">{formatMoney(i.discount, cur)}</TableCell>
                  <TableCell className="text-right">{formatMoney(i.tax, cur)}</TableCell>
                  <TableCell className="text-right">{formatMoney(i.line_total, cur)}</TableCell>
                  <TableCell className="text-right">{formatCost(invQty ? Number(i.line_total) / invQty : null, cur)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow><TableCell colSpan={7} className="text-right">Suma de líneas</TableCell><TableCell className="text-right">{formatMoney(linesSum, cur)}</TableCell></TableRow>
            <TableRow><TableCell colSpan={7} className="text-right">Descuentos</TableCell><TableCell className="text-right">−{formatMoney(invoice.discount_total, cur)}</TableCell></TableRow>
            <TableRow><TableCell colSpan={7} className="text-right">Impuestos</TableCell><TableCell className="text-right">{formatMoney(invoice.tax_total, cur)}</TableCell></TableRow>
            <TableRow><TableCell colSpan={7} className="text-right">Flete y otros cargos</TableCell><TableCell className="text-right">{formatMoney(Number(invoice.freight_total) + Number(invoice.other_charges), cur)}</TableCell></TableRow>
            <TableRow><TableCell colSpan={7} className="text-right font-bold">Total</TableCell><TableCell className="text-right font-bold">{formatMoney(invoice.total, cur)}</TableCell></TableRow>
          </TableFooter>
        </Table>
      </Card>
      {payments.length ? (
        <Card>
          <CardHeader><CardTitle>Pagos aplicados</CardTitle></CardHeader>
          <CardContent className="grid gap-1 text-sm">
            {payments.map((p) => (
              <div key={p.id} className={`flex justify-between ${p.voided ? "text-muted-foreground line-through" : ""}`}>
                <span>{formatDate(p.paid_at)} · {p.method}</span>
                <span>{formatMoney(p.amount, cur)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
