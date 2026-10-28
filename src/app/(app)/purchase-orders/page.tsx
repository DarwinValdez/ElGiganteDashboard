import Link from "next/link";
import { Plus } from "lucide-react";

import { Pagination, SortableHead } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { FilterSelect, SearchInput } from "@/components/common/list-controls";
import { PageHeader } from "@/components/common/page-header";
import { PoStatusBadge } from "@/components/common/status-badges";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getSettings, requirePage } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/format";
import { PO_STATUS_LABELS } from "@/lib/labels";
import { ilikePattern, parseListParams, sp, type SearchParams } from "@/lib/list-params";
import type { PoStatus } from "@/lib/types";

export const metadata = { title: "Órdenes de compra" };

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { supabase } = await requirePage("po.read");
  const settings = await getSettings();
  const list = parseListParams(params, { sortable: ["po_number", "order_date", "total", "status"], defaultSort: "order_date", defaultDir: "desc" });

  let query = supabase.from("purchase_orders").select("id, po_number, status, order_date, expected_date, total, currency, suppliers(trade_name)", { count: "exact" });
  if (list.q) query = query.ilike("po_number", ilikePattern(list.q));
  const status = sp(params, "status");
  if (status === "open") query = query.in("status", ["draft", "pending_approval", "approved", "sent", "partially_received"]);
  else if (status) query = query.eq("status", status);
  const supplier = sp(params, "supplier");
  if (supplier) query = query.eq("supplier_id", supplier);
  const [{ data, count, error }, { data: suppliers }] = await Promise.all([
    query.order(list.sort, { ascending: list.dir === "asc" }).order("created_at", { ascending: false }).range(list.from, list.to),
    supabase.from("suppliers").select("id, trade_name").order("trade_name"),
  ]);
  if (error) throw new Error(error.message);
  type Row = { id: string; po_number: string; status: PoStatus; order_date: string; expected_date: string | null; total: number; currency: string; suppliers: { trade_name: string } | null };
  const rows = (data ?? []) as unknown as Row[];

  return (
    <>
      <PageHeader
        title="Órdenes de compra"
        description="Pedidos a proveedores, aprobación, envío y recepción."
        actions={
          <Button asChild>
            <Link href="/purchase-orders/new">
              <Plus /> Nueva orden
            </Link>
          </Button>
        }
      />
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <SearchInput placeholder="Número de orden…" />
        <FilterSelect
          name="status"
          placeholder="Todos los estados"
          options={[{ value: "open", label: "Abiertas" }, ...Object.entries(PO_STATUS_LABELS).map(([value, label]) => ({ value, label }))]}
        />
        <FilterSelect name="supplier" placeholder="Todos los proveedores" options={(suppliers ?? []).map((s) => ({ value: s.id, label: s.trade_name }))} />
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No hay órdenes de compra" />
      ) : (
        <Card className="gap-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead label="Orden" column="po_number" base="/purchase-orders" params={params} list={list} />
                <TableHead>Proveedor</TableHead>
                <SortableHead label="Fecha" column="order_date" base="/purchase-orders" params={params} list={list} />
                <TableHead>Entrega</TableHead>
                <SortableHead label="Estado" column="status" base="/purchase-orders" params={params} list={list} />
                <SortableHead label="Total" column="total" base="/purchase-orders" params={params} list={list} className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>
                    <Link href={`/purchase-orders/${o.id}`} className="font-medium hover:underline">
                      {o.po_number}
                    </Link>
                  </TableCell>
                  <TableCell>{o.suppliers?.trade_name}</TableCell>
                  <TableCell>{formatDate(o.order_date)}</TableCell>
                  <TableCell>{formatDate(o.expected_date)}</TableCell>
                  <TableCell>
                    <PoStatusBadge status={o.status} />
                  </TableCell>
                  <TableCell className="text-right">{formatMoney(o.total, o.currency ?? settings.currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination base="/purchase-orders" params={params} list={list} total={count ?? 0} />
        </Card>
      )}
    </>
  );
}
