import Link from "next/link";
import { Upload } from "lucide-react";

import { ManualInvoiceButton } from "@/app/(app)/invoices/manual-button";
import { Pagination, SortableHead } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { DateRangeFilter, FilterSelect, SearchInput } from "@/components/common/list-controls";
import { PageHeader } from "@/components/common/page-header";
import { InvoiceStatusBadge } from "@/components/common/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePage } from "@/lib/auth";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { INVOICE_STATUS_LABELS } from "@/lib/labels";
import { ilikePattern, parseListParams, sp, type SearchParams } from "@/lib/list-params";
import type { InvoiceStatus } from "@/lib/types";

export const metadata = { title: "Facturas" };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { supabase } = await requirePage("invoices.read");
  const list = parseListParams(params, { sortable: ["issue_date", "created_at", "total", "invoice_number"], defaultSort: "created_at", defaultDir: "desc" });

  let query = supabase
    .from("invoices")
    .select("id, invoice_number, supplier_name_raw, status, issue_date, due_date, total, currency, created_at, ocr_confidence, warnings, file_path, suppliers(trade_name)", { count: "exact" });
  if (list.q) query = query.or(`invoice_number.ilike.${ilikePattern(list.q)},supplier_name_raw.ilike.${ilikePattern(list.q)}`);
  const status = sp(params, "status");
  if (status === "pending") query = query.in("status", ["uploaded", "processing", "ocr_failed", "needs_review"]);
  else if (status) query = query.eq("status", status);
  const supplier = sp(params, "supplier");
  if (supplier) query = query.eq("supplier_id", supplier);
  const from = sp(params, "from");
  const to = sp(params, "to");
  if (from) query = query.gte("issue_date", from);
  if (to) query = query.lte("issue_date", to);

  const [{ data, count, error }, { data: suppliers }] = await Promise.all([
    query.order(list.sort, { ascending: list.dir === "asc", nullsFirst: false }).range(list.from, list.to),
    supabase.from("suppliers").select("id, trade_name").order("trade_name"),
  ]);
  if (error) throw new Error(error.message);
  type Row = { id: string; invoice_number: string | null; supplier_name_raw: string | null; status: InvoiceStatus; issue_date: string | null; due_date: string | null; total: number | null; currency: string; created_at: string; ocr_confidence: number | null; warnings: unknown[]; file_path: string | null; suppliers: { trade_name: string } | null };
  const rows = (data ?? []) as unknown as Row[];

  return (
    <>
      <PageHeader
        title="Facturas de proveedores"
        description="Registro inteligente: subida, OCR, revisión, validación y confirmación."
        actions={
          <>
            <ManualInvoiceButton />
            <Button asChild>
              <Link href="/invoices/upload">
                <Upload /> Subir factura
              </Link>
            </Button>
          </>
        }
      />
      <div className="mb-3 flex flex-col flex-wrap gap-2 lg:flex-row">
        <SearchInput placeholder="Número o proveedor…" />
        <FilterSelect
          name="status"
          placeholder="Todos los estados"
          options={[{ value: "pending", label: "Pendientes de revisión" }, ...Object.entries(INVOICE_STATUS_LABELS).map(([value, label]) => ({ value, label }))]}
        />
        <FilterSelect name="supplier" placeholder="Todos los proveedores" options={(suppliers ?? []).map((s) => ({ value: s.id, label: s.trade_name }))} />
        <DateRangeFilter defaultFrom="" defaultTo="" />
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No hay facturas" description="Suba la fotografía o el PDF de una factura para comenzar." />
      ) : (
        <Card className="gap-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead label="Número" column="invoice_number" base="/invoices" params={params} list={list} />
                <TableHead>Proveedor</TableHead>
                <SortableHead label="Emisión" column="issue_date" base="/invoices" params={params} list={list} />
                <TableHead>Vence</TableHead>
                <TableHead>Estado</TableHead>
                <SortableHead label="Total" column="total" base="/invoices" params={params} list={list} className="text-right" />
                <SortableHead label="Registrada" column="created_at" base="/invoices" params={params} list={list} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    <Link href={`/invoices/${i.id}`} className="font-medium hover:underline">
                      {i.invoice_number ?? "(sin número)"}
                    </Link>
                    {i.warnings?.length && ["needs_review", "ocr_failed"].includes(i.status) ? (
                      <Badge variant="warning" className="ml-1">{i.warnings.length} aviso(s)</Badge>
                    ) : null}
                    {!i.file_path ? <Badge variant="muted" className="ml-1">Manual</Badge> : null}
                  </TableCell>
                  <TableCell>{i.suppliers?.trade_name ?? <span className="text-muted-foreground">{i.supplier_name_raw ?? "—"}</span>}</TableCell>
                  <TableCell>{formatDate(i.issue_date)}</TableCell>
                  <TableCell>{formatDate(i.due_date)}</TableCell>
                  <TableCell>
                    <InvoiceStatusBadge status={i.status} />
                  </TableCell>
                  <TableCell className="text-right">{formatMoney(i.total, i.currency)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDateTime(i.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination base="/invoices" params={params} list={list} total={count ?? 0} />
        </Card>
      )}
    </>
  );
}
