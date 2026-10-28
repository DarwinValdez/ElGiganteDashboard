import Link from "next/link";

import { Pagination } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { DateRangeFilter, FilterSelect } from "@/components/common/list-controls";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePage } from "@/lib/auth";
import { formatDateTime, formatNumber } from "@/lib/format";
import { MOVEMENT_LABELS } from "@/lib/labels";
import { dateRange, parseListParams, sp, type SearchParams } from "@/lib/list-params";
import type { MovementType } from "@/lib/types";

export const metadata = { title: "Movimientos de inventario" };

export default async function MovementsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { supabase } = await requirePage("inventory.read");
  const list = parseListParams(params, { sortable: ["created_at"], defaultSort: "created_at", defaultDir: "desc", pageSize: 30 });
  const range = dateRange(params, 30);

  let q = supabase
    .from("inventory_movements")
    .select("id, movement_type, quantity, unit_cost, source_type, source_id, reason, created_at, products(id, name, sku, inventory_unit)", { count: "exact" })
    .gte("created_at", `${range.from}T00:00:00Z`)
    .lte("created_at", `${range.to}T23:59:59Z`);
  const type = sp(params, "type");
  if (type) q = q.eq("movement_type", type);
  const { data, count, error } = await q.order("created_at", { ascending: false }).order("id", { ascending: false }).range(list.from, list.to);
  if (error) throw new Error(error.message);
  type Row = { id: number; movement_type: MovementType; quantity: number; source_type: string; source_id: string | null; reason: string | null; created_at: string; products: { id: string; name: string; sku: string; inventory_unit: string } | null };
  const rows = (data ?? []) as unknown as Row[];

  return (
    <>
      <PageHeader title="Movimientos de inventario" description="Historial inmutable: las correcciones se registran como reversos o ajustes." />
      <div className="mb-3 flex flex-col flex-wrap gap-2 lg:flex-row">
        <FilterSelect name="type" placeholder="Todos los tipos" options={Object.entries(MOVEMENT_LABELS).map(([value, label]) => ({ value, label }))} />
        <DateRangeFilter defaultFrom={range.from} defaultTo={range.to} />
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Sin movimientos en el período" />
      ) : (
        <Card className="gap-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead>Origen</TableHead>
                <TableHead>Motivo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-xs">{formatDateTime(m.created_at)}</TableCell>
                  <TableCell>
                    {m.products ? (
                      <Link href={`/products/${m.products.id}`} className="hover:underline">
                        {m.products.name}
                      </Link>
                    ) : null}
                  </TableCell>
                  <TableCell>{MOVEMENT_LABELS[m.movement_type]}</TableCell>
                  <TableCell className={`text-right font-medium ${Number(m.quantity) < 0 ? "text-destructive" : "text-success"}`}>
                    {Number(m.quantity) > 0 ? "+" : ""}
                    {formatNumber(m.quantity)} <span className="text-xs text-muted-foreground">{m.products?.inventory_unit}</span>
                  </TableCell>
                  <TableCell className="text-xs">
                    {m.source_type === "invoice" && m.source_id ? (
                      <Link className="underline" href={`/invoices/${m.source_id}`}>Factura</Link>
                    ) : m.source_type === "goods_receipt" ? (
                      "Recepción"
                    ) : m.source_type === "void" ? (
                      "Anulación"
                    ) : (
                      "Manual"
                    )}
                  </TableCell>
                  <TableCell className="max-w-64 truncate text-xs text-muted-foreground">{m.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination base="/inventory/movements" params={params} list={list} total={count ?? 0} />
        </Card>
      )}
    </>
  );
}
