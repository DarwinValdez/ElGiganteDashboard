import Link from "next/link";

import { PaymentDialog, type OpenInvoice } from "@/app/(app)/payments/payment-dialog";
import { VoidPaymentButton } from "@/app/(app)/payments/void-payment-button";
import { Pagination } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { FilterSelect } from "@/components/common/list-controls";
import { PageHeader } from "@/components/common/page-header";
import { StatCard } from "@/components/common/stat-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getSettings, requirePage } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/format";
import { parseListParams, sp, type SearchParams } from "@/lib/list-params";
import { can } from "@/lib/permissions";

export const metadata = { title: "Pagos" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { supabase, profile } = await requirePage("payments.read");
  const settings = await getSettings();
  const cur = settings.currency;
  const list = parseListParams(params, { sortable: ["paid_at"], defaultSort: "paid_at", defaultDir: "desc" });

  let q = supabase.from("payments").select("*, suppliers(trade_name), invoices(invoice_number)", { count: "exact" });
  const supplier = sp(params, "supplier");
  if (supplier) q = q.eq("supplier_id", supplier);
  const [{ data, count }, { data: suppliers }, { data: openInv }, { data: balances }] = await Promise.all([
    q.order("paid_at", { ascending: false }).order("created_at", { ascending: false }).range(list.from, list.to),
    supabase.from("suppliers").select("id, trade_name").eq("active", true).order("trade_name"),
    supabase.from("invoice_balances").select("invoice_id, supplier_id, invoice_number, balance, due_date").gt("balance", 0).order("due_date"),
    supabase.from("supplier_balances").select("*").gt("balance", 0).order("balance", { ascending: false }),
  ]);
  type Row = {
    id: string;
    paid_at: string;
    amount: number;
    method: string;
    reference: string | null;
    voided: boolean;
    void_reason: string | null;
    supplier_id: string;
    invoice_id: string | null;
    suppliers: { trade_name: string } | null;
    invoices: { invoice_number: string } | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  const totalDebt = (balances ?? []).reduce((a, b) => a + Number(b.balance), 0);
  const overdue = (openInv ?? []).filter((i) => i.due_date && i.due_date < new Date().toISOString().slice(0, 10));

  return (
    <>
      <PageHeader
        title="Pagos a proveedores"
        description="Cuentas por pagar calculadas con facturas confirmadas y pagos registrados."
        actions={
          settings.payments_enabled && can(profile.role, "payments.write") ? (
            <PaymentDialog suppliers={suppliers ?? []} openInvoices={(openInv ?? []) as OpenInvoice[]} currency={cur} />
          ) : null
        }
      />
      {!settings.payments_enabled ? (
        <Alert variant="warning" className="mb-4">
          <AlertDescription>El módulo de pagos está deshabilitado en la configuración.</AlertDescription>
        </Alert>
      ) : null}
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="Total adeudado" value={formatMoney(totalDebt, cur)} hint={`${balances?.length ?? 0} proveedor(es) con saldo`} />
        <StatCard
          label="Facturas vencidas"
          value={overdue.length}
          hint={formatMoney(overdue.reduce((a, b) => a + Number(b.balance), 0), cur)}
          tone={overdue.length ? "danger" : "default"}
        />
        <StatCard label="Facturas con saldo" value={openInv?.length ?? 0} />
      </div>
      {balances?.length ? (
        <Card className="mb-4 gap-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Proveedor</TableHead>
                <TableHead className="text-right">Facturado</TableHead>
                <TableHead className="text-right">Pagado</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {balances.map((b) => (
                <TableRow key={b.supplier_id}>
                  <TableCell>
                    <Link href={`/suppliers/${b.supplier_id}`} className="font-medium hover:underline">
                      {b.trade_name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">{formatMoney(b.invoiced, cur)}</TableCell>
                  <TableCell className="text-right">{formatMoney(b.paid, cur)}</TableCell>
                  <TableCell className="text-right font-semibold">{formatMoney(b.balance, cur)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : null}
      <div className="mb-3">
        <FilterSelect name="supplier" placeholder="Todos los proveedores" options={(suppliers ?? []).map((s) => ({ value: s.id, label: s.trade_name }))} />
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Sin pagos registrados" />
      ) : (
        <Card className="gap-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead>Factura</TableHead>
                <TableHead>Método</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id} className={p.voided ? "text-muted-foreground" : undefined}>
                  <TableCell>{formatDate(p.paid_at)}</TableCell>
                  <TableCell>{p.suppliers?.trade_name}</TableCell>
                  <TableCell>
                    {p.invoice_id ? (
                      <Link href={`/invoices/${p.invoice_id}`} className="hover:underline">
                        {p.invoices?.invoice_number}
                      </Link>
                    ) : (
                      "A cuenta"
                    )}
                  </TableCell>
                  <TableCell>
                    {p.method}
                    {p.reference ? <span className="text-xs text-muted-foreground"> · {p.reference}</span> : null}
                  </TableCell>
                  <TableCell className={p.voided ? "text-right line-through" : "text-right font-medium"}>{formatMoney(p.amount, cur)}</TableCell>
                  <TableCell className="w-10">
                    {p.voided ? (
                      <Badge variant="outline" title={p.void_reason ?? undefined}>
                        Anulado
                      </Badge>
                    ) : can(profile.role, "payments.void") ? (
                      <VoidPaymentButton id={p.id} />
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination base="/payments" params={params} list={list} total={count ?? 0} />
        </Card>
      )}
    </>
  );
}
