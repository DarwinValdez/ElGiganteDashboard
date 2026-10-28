import Link from "next/link";

import { ProductFilter, ReportExport } from "@/app/(app)/reports/report-client";
import { DateRangeFilter, FilterSelect } from "@/components/common/list-controls";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getSettings, requirePage } from "@/lib/auth";
import { formatCost, formatDate, formatDateTime, formatMoney, formatNumber, formatPct } from "@/lib/format";
import { buildHref, dateRange, sp, type SearchParams } from "@/lib/list-params";
import { REPORTS, runReport, type ColFormat } from "@/lib/reports";
import { cn } from "@/lib/utils";

export const metadata = { title: "Reportes" };

function fmt(v: unknown, f: ColFormat | undefined, cur: string): string {
  if (v === null || v === undefined || v === "") return "—";
  switch (f) {
    case "money":
      return formatMoney(Number(v), cur);
    case "cost":
      return formatCost(Number(v), cur);
    case "number":
      return formatNumber(Number(v), 4);
    case "date":
      return formatDate(String(v).slice(0, 10));
    case "datetime":
      return formatDateTime(String(v));
    case "pct":
      return formatPct(Number(v));
    default:
      return String(v);
  }
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { supabase } = await requirePage("reports.read");
  const settings = await getSettings();
  const cur = settings.currency;
  const key = sp(params, "r") ?? "purchases_period";
  const def = REPORTS.find((r) => r.key === key) ?? REPORTS[0];
  const now = new Date();
  const defFrom = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString().slice(0, 10);
  const range = { from: sp(params, "from") ?? defFrom, to: sp(params, "to") ?? now.toISOString().slice(0, 10) };
  const valid = dateRange({ from: range.from, to: range.to });
  const supplier = sp(params, "supplier") ?? null;
  const productId = sp(params, "product") ?? null;

  const [result, { data: suppliers }, product] = await Promise.all([
    runReport(supabase, def.key, { ...valid, supplier, product: productId }),
    supabase.from("suppliers").select("id, trade_name").order("trade_name"),
    productId ? supabase.from("products").select("id, name").eq("id", productId).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const csvParams = new URLSearchParams({ from: valid.from, to: valid.to, ...(supplier ? { supplier } : {}), ...(productId ? { product: productId } : {}) });
  const head = result.columns.map((c) => c.label);
  const body = result.rows.map((r) => result.columns.map((c) => fmt(r[c.key], c.format, cur)));
  const foot = result.totals ? [result.columns.map((c, i) => (c.key in result.totals! ? fmt(result.totals![c.key], c.format, cur) : i === 0 ? "Total" : ""))] : undefined;
  const subtitle = [
    def.filters.includes("date") ? `Período: ${formatDate(valid.from)} – ${formatDate(valid.to)}` : null,
    supplier ? `Proveedor: ${suppliers?.find((s) => s.id === supplier)?.trade_name}` : null,
    product.data ? `Producto: ${product.data.name}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <PageHeader
        title="Reportes"
        description="Datos filtrables con exportación a CSV y PDF."
        actions={<ReportExport csvHref={`/api/reports/${def.key}?${csvParams}`} title={def.label} subtitle={subtitle} head={head} body={body} foot={foot} />}
      />
      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav className="no-print flex gap-1 overflow-x-auto lg:flex-col">
          {REPORTS.map((r) => (
            <Link
              key={r.key}
              href={buildHref("/reports", params, { r: r.key })}
              className={cn(
                "shrink-0 rounded-md px-3 py-2 text-sm hover:bg-accent",
                r.key === def.key ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-card",
              )}
            >
              {r.label}
            </Link>
          ))}
        </nav>
        <div className="min-w-0">
          <div className="no-print mb-3 flex flex-col flex-wrap gap-2 lg:flex-row lg:items-center">
            {def.filters.includes("date") ? <DateRangeFilter defaultFrom={defFrom} defaultTo={range.to} /> : null}
            {def.filters.includes("supplier") ? (
              <FilterSelect name="supplier" placeholder="Todos los proveedores" options={(suppliers ?? []).map((s) => ({ value: s.id, label: s.trade_name }))} />
            ) : null}
            {def.filters.includes("product") ? <ProductFilter selected={product.data ?? null} /> : null}
          </div>
          <Card className="gap-0 py-0">
            <div className="border-b px-4 py-3">
              <div className="font-semibold">{def.label}</div>
              <div className="text-xs text-muted-foreground">{subtitle || "Sin filtros"} · {result.rows.length} fila(s)</div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  {result.columns.map((c) => (
                    <TableHead key={c.key} className={c.format && c.format !== "text" && c.format !== "date" && c.format !== "datetime" ? "text-right" : undefined}>
                      {c.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {body.slice(0, 500).map((row, i) => (
                  <TableRow key={i}>
                    {row.map((cell, j) => {
                      const f = result.columns[j].format;
                      return (
                        <TableCell key={j} className={f && f !== "text" && f !== "date" && f !== "datetime" ? "text-right tabular-nums" : undefined}>
                          {cell}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
                {body.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={head.length} className="py-8 text-center text-muted-foreground">
                      Sin datos para los filtros seleccionados.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
              {foot ? (
                <TableFooter>
                  <TableRow>
                    {foot[0].map((c, i) => (
                      <TableCell key={i} className={i > 0 ? "text-right" : undefined}>
                        {c}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableFooter>
              ) : null}
            </Table>
            {body.length > 500 ? <p className="p-3 text-xs text-muted-foreground">Se muestran 500 filas; exporte a CSV para ver todas.</p> : null}
          </Card>
        </div>
      </div>
    </>
  );
}
