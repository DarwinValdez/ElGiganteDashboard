import Link from "next/link";
import { AlertTriangle, ClipboardList, DollarSign, FileClock, FileText, PackageX, Upload, Wallet } from "lucide-react";

import { MonthlyPurchasesChart, SupplierPurchasesChart } from "@/components/charts/charts";
import { DateRangeFilter, FilterSelect } from "@/components/common/list-controls";
import { PageHeader } from "@/components/common/page-header";
import { StatCard } from "@/components/common/stat-card";
import { CostChangeBadge } from "@/components/common/status-badges";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { getSettings, requirePage } from "@/lib/auth";
import { describeAudit, entityHref, type AuditLog } from "@/lib/audit";
import { formatCost, formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { sp, type SearchParams } from "@/lib/list-params";
import { can } from "@/lib/permissions";

export const metadata = { title: "Panel principal" };

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { supabase, profile } = await requirePage();
  const settings = await getSettings();
  const cur = settings.currency;
  const now = new Date();
  const defFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const defTo = now.toISOString().slice(0, 10);
  const from = sp(params, "from") ?? defFrom;
  const to = sp(params, "to") ?? defTo;
  const supplier = sp(params, "supplier") ?? null;
  const full = can(profile.role, "invoices.read");

  const toDate = new Date(`${to}T00:00:00Z`);
  const chartFrom = new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth() - 11, 1)).toISOString().slice(0, 10);

  const [{ data: kpiData }, monthly, bySupplier, increases, latest, activity, suppliers] = await Promise.all([
    supabase.rpc("dashboard_kpis", { p_from: from, p_to: to }),
    full ? supabase.rpc("purchases_by_month", { p_from: chartFrom, p_to: to, p_supplier_id: supplier }) : Promise.resolve({ data: [] }),
    full ? supabase.rpc("purchases_by_supplier", { p_from: from, p_to: to }) : Promise.resolve({ data: [] }),
    full
      ? supabase.from("product_cost_changes").select("product_id, name, inventory_unit, last_cost, previous_cost, pct, last_date").gt("diff", 0).gte("last_date", from).lte("last_date", to).order("pct", { ascending: false }).limit(8)
      : Promise.resolve({ data: [] }),
    full
      ? supabase.from("invoices").select("id, invoice_number, issue_date, total, currency, suppliers(trade_name)").eq("status", "confirmed").order("issue_date", { ascending: false }).order("confirmed_at", { ascending: false }).limit(8)
      : Promise.resolve({ data: [] }),
    can(profile.role, "audit.read") ? supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(10) : Promise.resolve({ data: [] }),
    full ? supabase.from("suppliers").select("id, trade_name").order("trade_name") : Promise.resolve({ data: [] }),
  ]);
  const k = (kpiData ?? {}) as Record<string, number>;

  // Serie mensual completa (meses sin compras = 0)
  const monthMap = new Map(((monthly.data ?? []) as { month: string; total: number; invoices: number }[]).map((m) => [m.month.slice(0, 7), m]));
  const monthSeries = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth() - 11 + i, 1));
    const key = d.toISOString().slice(0, 7);
    const m = monthMap.get(key);
    return { label: `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`, total: Number(m?.total ?? 0), invoices: Number(m?.invoices ?? 0) };
  });
  const supplierSeries = ((bySupplier.data ?? []) as { trade_name: string; total: number }[]).slice(0, 8).map((s) => ({ name: s.trade_name, total: Number(s.total) }));
  type Inc = { product_id: string; name: string; inventory_unit: string; last_cost: number; previous_cost: number; pct: number; last_date: string };
  type Latest = { id: string; invoice_number: string; issue_date: string; total: number; currency: string; suppliers: { trade_name: string } | null };

  return (
    <>
      <PageHeader
        title="Panel principal"
        description={`${settings.company_name} · datos calculados desde los registros confirmados`}
        actions={
          full ? (
            <Button asChild>
              <Link href="/invoices/upload">
                <Upload /> Subir factura
              </Link>
            </Button>
          ) : null
        }
      />
      {params.denied ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>No tiene permiso para acceder a esa sección.</AlertDescription>
        </Alert>
      ) : null}
      <div className="no-print mb-4 flex flex-col flex-wrap gap-2 lg:flex-row lg:items-center">
        <DateRangeFilter defaultFrom={defFrom} defaultTo={defTo} />
        {full ? <FilterSelect name="supplier" placeholder="Todos los proveedores" options={(suppliers.data ?? []).map((s) => ({ value: s.id, label: s.trade_name }))} /> : null}
      </div>

      {full ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Compras del período" value={formatMoney(k.purchases_total, cur)} hint={`${formatDate(from)} – ${formatDate(to)}`} icon={DollarSign} />
          <StatCard label="Facturas confirmadas" value={k.invoices_count ?? 0} hint={`${k.invoices_registered ?? 0} registradas en el período`} icon={FileText} href="/invoices?status=confirmed" />
          <StatCard label="Pendientes de revisión" value={k.pending_review ?? 0} icon={FileClock} tone={k.pending_review ? "warning" : "default"} href="/invoices?status=pending" />
          <StatCard
            label="Órdenes de compra abiertas"
            value={k.open_pos ?? 0}
            hint={k.pending_approval_pos ? `${k.pending_approval_pos} por aprobar` : undefined}
            icon={ClipboardList}
            href="/purchase-orders?status=open"
          />
          {settings.payments_enabled ? (
            <StatCard
              label="Total adeudado a proveedores"
              value={formatMoney(k.payable_total, cur)}
              hint={k.overdue_total ? `Vencido: ${formatMoney(k.overdue_total, cur)}` : "Sin saldos vencidos"}
              icon={Wallet}
              tone={k.overdue_total ? "danger" : "default"}
              href="/payments"
            />
          ) : null}
          <StatCard label="Productos agotados" value={k.out_of_stock ?? 0} icon={PackageX} tone={k.out_of_stock ? "danger" : "default"} href="/inventory?level=out" />
          <StatCard label="Bajo stock mínimo" value={k.low_stock ?? 0} icon={AlertTriangle} tone={k.low_stock ? "warning" : "default"} href="/inventory?level=low" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard label="Productos agotados" value={k.out_of_stock ?? 0} icon={PackageX} tone="danger" href="/inventory?level=out" />
          <StatCard label="Bajo stock mínimo" value={k.low_stock ?? 0} icon={AlertTriangle} tone="warning" href="/inventory?level=low" />
        </div>
      )}

      {full ? (
        <>
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Compras por mes</CardTitle>
                <CardDescription>Últimos 12 meses hasta {formatDate(to)} · facturas confirmadas</CardDescription>
              </CardHeader>
              <CardContent>
                <MonthlyPurchasesChart data={monthSeries} currency={cur} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Compras por proveedor</CardTitle>
                <CardDescription>Período seleccionado</CardDescription>
              </CardHeader>
              <CardContent>
                {supplierSeries.length ? (
                  <SupplierPurchasesChart data={supplierSeries} currency={cur} />
                ) : (
                  <p className="py-16 text-center text-sm text-muted-foreground">Sin compras confirmadas en el período.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <Card className="gap-2 pb-0">
              <CardHeader>
                <CardTitle>Aumentos recientes de costo</CardTitle>
                <CardDescription>Compras del período vs. compra anterior</CardDescription>
              </CardHeader>
              <Table>
                <TableBody>
                  {((increases.data ?? []) as Inc[]).map((r) => (
                    <TableRow key={r.product_id}>
                      <TableCell className="max-w-48 truncate whitespace-normal">
                        <Link href={`/products/${r.product_id}`} className="hover:underline">
                          {r.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {formatCost(r.previous_cost, cur)} → {formatCost(r.last_cost, cur)} /{r.inventory_unit}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <CostChangeBadge pct={r.pct} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {!increases.data?.length ? (
                    <TableRow>
                      <TableCell className="py-6 text-center text-muted-foreground">Sin aumentos en el período.</TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </Card>
            <Card className="gap-2 pb-0">
              <CardHeader>
                <CardTitle>Últimas compras</CardTitle>
              </CardHeader>
              <Table>
                <TableBody>
                  {((latest.data ?? []) as unknown as Latest[]).map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>
                        <Link href={`/invoices/${i.id}`} className="font-medium hover:underline">
                          {i.invoice_number}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {i.suppliers?.trade_name} · {formatDate(i.issue_date)}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatMoney(i.total, i.currency)}</TableCell>
                    </TableRow>
                  ))}
                  {!latest.data?.length ? (
                    <TableRow>
                      <TableCell className="py-6 text-center text-muted-foreground">Aún no hay facturas confirmadas.</TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </Card>
            <Card className="gap-2">
              <CardHeader>
                <CardTitle>Actividad reciente</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {((activity.data ?? []) as AuditLog[]).map((a) => {
                    const href = entityHref(a);
                    return (
                      <li key={a.id} className="border-b pb-2 last:border-0">
                        {href ? (
                          <Link href={href} className="hover:underline">
                            {describeAudit(a)}
                          </Link>
                        ) : (
                          describeAudit(a)
                        )}
                        <div className="text-xs text-muted-foreground">{formatDateTime(a.created_at)}</div>
                      </li>
                    );
                  })}
                  {!activity.data?.length ? <li className="text-muted-foreground">Sin actividad registrada.</li> : null}
                </ul>
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </>
  );
}
