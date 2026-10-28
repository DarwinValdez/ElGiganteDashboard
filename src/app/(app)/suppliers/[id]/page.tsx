import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";

import { PaymentDialog, type OpenInvoice } from "@/app/(app)/payments/payment-dialog";
import { VoidPaymentButton } from "@/app/(app)/payments/void-payment-button";
import { PageHeader } from "@/components/common/page-header";
import { StatCard } from "@/components/common/stat-card";
import { ActiveBadge, InvoiceStatusBadge, PoStatusBadge } from "@/components/common/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getSettings, requirePage } from "@/lib/auth";
import { formatCost, formatDate, formatMoney, formatNumber } from "@/lib/format";
import { can } from "@/lib/permissions";
import type { InvoiceStatus, PoStatus, Supplier } from "@/lib/types";

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requirePage("suppliers.read");
  const settings = await getSettings();
  const cur = settings.currency;
  const { data: supplier } = await supabase.from("suppliers").select("*").eq("id", id).maybeSingle<Supplier>();
  if (!supplier) notFound();

  const [pos, invoices, history, payments, balance, openInv] = await Promise.all([
    supabase.from("purchase_orders").select("id, po_number, status, order_date, total").eq("supplier_id", id).order("order_date", { ascending: false }).limit(50),
    supabase.from("invoices").select("id, invoice_number, status, issue_date, due_date, total").eq("supplier_id", id).order("issue_date", { ascending: false, nullsFirst: false }).limit(50),
    supabase
      .from("product_cost_history")
      .select("id, product_id, purchase_date, document_number, quantity, unit, package_price, normalized_unit_cost, products(name, sku, inventory_unit)")
      .eq("supplier_id", id)
      .eq("voided", false)
      .order("purchase_date", { ascending: false })
      .limit(300),
    supabase.from("payments").select("*, invoices(invoice_number)").eq("supplier_id", id).order("paid_at", { ascending: false }).limit(50),
    supabase.from("supplier_balances").select("*").eq("supplier_id", id).maybeSingle(),
    supabase.from("invoice_balances").select("invoice_id, supplier_id, invoice_number, balance, due_date").eq("supplier_id", id).gt("balance", 0),
  ]);

  type H = { id: string; product_id: string; purchase_date: string; document_number: string; quantity: number; unit: string; package_price: number; normalized_unit_cost: number; products: { name: string; sku: string; inventory_unit: string } | null };
  const hist = (history.data ?? []) as unknown as H[];
  // Productos comprados: última compra por producto
  const products = new Map<string, H & { purchases: number }>();
  for (const h of hist) {
    const p = products.get(h.product_id);
    if (!p) products.set(h.product_id, { ...h, purchases: 1 });
    else p.purchases += 1;
  }

  return (
    <>
      <PageHeader
        title={supplier.trade_name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {[supplier.legal_name, supplier.tax_id].filter(Boolean).join(" · ")} <ActiveBadge active={supplier.active} />
          </span>
        }
        actions={
          <>
            {settings.payments_enabled && can(profile.role, "payments.write") ? (
              <PaymentDialog suppliers={[{ id: supplier.id, trade_name: supplier.trade_name }]} supplierId={supplier.id} openInvoices={(openInv.data ?? []) as OpenInvoice[]} currency={cur} />
            ) : null}
            <Button variant="outline" asChild>
              <Link href={`/suppliers/${id}/edit`}>
                <Pencil /> Editar
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total facturado" value={formatMoney(balance.data?.invoiced ?? 0, cur)} />
        <StatCard label="Pagado" value={formatMoney(balance.data?.paid ?? 0, cur)} />
        <StatCard label="Saldo pendiente" value={formatMoney(balance.data?.balance ?? 0, cur)} tone={Number(balance.data?.balance ?? 0) > 0 ? "warning" : "default"} />
        <StatCard label="Productos comprados" value={products.size} />
      </div>

      <Card className="mt-4">
        <CardContent className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><span className="text-muted-foreground">Contacto: </span>{supplier.contact_name ?? "—"}</div>
          <div><span className="text-muted-foreground">Teléfono: </span>{supplier.phone ?? "—"}</div>
          <div><span className="text-muted-foreground">Correo: </span>{supplier.email ?? "—"}</div>
          <div><span className="text-muted-foreground">Términos: </span>{supplier.payment_terms ?? "—"}</div>
          <div className="sm:col-span-2 lg:col-span-4"><span className="text-muted-foreground">Dirección: </span>{supplier.address ?? "—"}</div>
          {supplier.notes ? <div className="sm:col-span-2 lg:col-span-4 text-muted-foreground">{supplier.notes}</div> : null}
        </CardContent>
      </Card>

      <Tabs defaultValue="invoices" className="mt-4">
        <TabsList>
          <TabsTrigger value="invoices">Facturas</TabsTrigger>
          <TabsTrigger value="pos">Órdenes</TabsTrigger>
          <TabsTrigger value="products">Productos</TabsTrigger>
          <TabsTrigger value="prices">Precios históricos</TabsTrigger>
          <TabsTrigger value="payments">Pagos</TabsTrigger>
        </TabsList>
        <TabsContent value="invoices">
          <Card className="gap-0 py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Número</TableHead>
                  <TableHead>Emisión</TableHead>
                  <TableHead>Vence</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(invoices.data ?? []).map((i) => (
                  <TableRow key={i.id}>
                    <TableCell><Link className="font-medium hover:underline" href={`/invoices/${i.id}`}>{i.invoice_number ?? "(sin número)"}</Link></TableCell>
                    <TableCell>{formatDate(i.issue_date)}</TableCell>
                    <TableCell>{formatDate(i.due_date)}</TableCell>
                    <TableCell><InvoiceStatusBadge status={i.status as InvoiceStatus} /></TableCell>
                    <TableCell className="text-right">{formatMoney(i.total, cur)}</TableCell>
                  </TableRow>
                ))}
                {!invoices.data?.length ? <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">Sin facturas.</TableCell></TableRow> : null}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
        <TabsContent value="pos">
          <Card className="gap-0 py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Orden</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(pos.data ?? []).map((o) => (
                  <TableRow key={o.id}>
                    <TableCell><Link className="font-medium hover:underline" href={`/purchase-orders/${o.id}`}>{o.po_number}</Link></TableCell>
                    <TableCell>{formatDate(o.order_date)}</TableCell>
                    <TableCell><PoStatusBadge status={o.status as PoStatus} /></TableCell>
                    <TableCell className="text-right">{formatMoney(o.total, cur)}</TableCell>
                  </TableRow>
                ))}
                {!pos.data?.length ? <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">Sin órdenes.</TableCell></TableRow> : null}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
        <TabsContent value="products">
          <Card className="gap-0 py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Compras</TableHead>
                  <TableHead>Última compra</TableHead>
                  <TableHead className="text-right">Último costo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from(products.values()).map((p) => (
                  <TableRow key={p.product_id}>
                    <TableCell><Link className="hover:underline" href={`/products/${p.product_id}`}>{p.products?.name}</Link> <span className="font-mono text-xs text-muted-foreground">{p.products?.sku}</span></TableCell>
                    <TableCell className="text-right">{p.purchases}</TableCell>
                    <TableCell>{formatDate(p.purchase_date)}</TableCell>
                    <TableCell className="text-right">{formatCost(p.normalized_unit_cost, cur)} / {p.products?.inventory_unit}</TableCell>
                  </TableRow>
                ))}
                {products.size === 0 ? <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">Sin compras confirmadas.</TableCell></TableRow> : null}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
        <TabsContent value="prices">
          <Card className="gap-0 py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Documento</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead className="text-right">Precio</TableHead>
                  <TableHead className="text-right">Costo normalizado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hist.slice(0, 100).map((h) => (
                  <TableRow key={h.id}>
                    <TableCell>{formatDate(h.purchase_date)}</TableCell>
                    <TableCell>{h.document_number}</TableCell>
                    <TableCell>{h.products?.name}</TableCell>
                    <TableCell className="text-right">{formatNumber(h.quantity)} {h.unit}</TableCell>
                    <TableCell className="text-right">{formatMoney(h.package_price, cur)}</TableCell>
                    <TableCell className="text-right">{formatCost(h.normalized_unit_cost, cur)} / {h.products?.inventory_unit}</TableCell>
                  </TableRow>
                ))}
                {hist.length === 0 ? <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">Sin historial.</TableCell></TableRow> : null}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
        <TabsContent value="payments">
          <Card className="gap-0 py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Factura</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(payments.data ?? []).map((p) => (
                  <TableRow key={p.id} className={p.voided ? "text-muted-foreground" : undefined}>
                    <TableCell>{formatDate(p.paid_at)}</TableCell>
                    <TableCell>{(p.invoices as { invoice_number: string } | null)?.invoice_number ?? "A cuenta"}</TableCell>
                    <TableCell>{p.method}{p.reference ? ` · ${p.reference}` : ""}</TableCell>
                    <TableCell className={p.voided ? "text-right line-through" : "text-right"}>{formatMoney(p.amount, cur)}</TableCell>
                    <TableCell className="w-10">
                      {p.voided ? <Badge variant="outline">Anulado</Badge> : can(profile.role, "payments.void") ? <VoidPaymentButton id={p.id} /> : null}
                    </TableCell>
                  </TableRow>
                ))}
                {!payments.data?.length ? <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">Sin pagos.</TableCell></TableRow> : null}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
