import Link from "next/link";
import { AlertTriangle, History, PackageX } from "lucide-react";

import { MovementDialog } from "@/app/(app)/inventory/movement-dialog";
import { Pagination, SortableHead } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { FilterSelect, SearchInput } from "@/components/common/list-controls";
import { PageHeader } from "@/components/common/page-header";
import { StatCard } from "@/components/common/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getSettings, requirePage } from "@/lib/auth";
import { formatMoney, formatNumber } from "@/lib/format";
import { ilikePattern, parseListParams, sp, type SearchParams } from "@/lib/list-params";
import { can } from "@/lib/permissions";

export const metadata = { title: "Inventario" };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { supabase, profile } = await requirePage("inventory.read");
  const settings = await getSettings();
  const list = parseListParams(params, { sortable: ["name", "current_stock", "min_stock"], defaultSort: "name" });
  const showCost = can(profile.role, "prices.read");

  let query = supabase.from("products").select("id, sku, name, inventory_unit, current_stock, min_stock, effective_unit_cost, normalized_unit_cost, categories(name)", { count: "exact" }).eq("active", true);
  if (list.q) query = query.or(`name.ilike.${ilikePattern(list.q)},sku.ilike.${ilikePattern(list.q)},barcode.ilike.${ilikePattern(list.q)}`);
  const level = sp(params, "level");
  if (level === "out") query = query.lte("current_stock", 0);
  if (level === "low") query = query.eq("below_min", true);
  const category = sp(params, "category");
  if (category) query = query.eq("category_id", category);

  const [{ data, count, error }, { data: kpi }, { data: categories }, { data: allStock }] = await Promise.all([
    query.order(list.sort, { ascending: list.dir === "asc" }).range(list.from, list.to),
    supabase.rpc("dashboard_kpis", { p_from: "2000-01-01", p_to: "2000-01-01" }),
    supabase.from("categories").select("id, name").order("name"),
    showCost ? supabase.from("products").select("current_stock, effective_unit_cost, normalized_unit_cost").eq("active", true).gt("current_stock", 0) : Promise.resolve({ data: [] }),
  ]);
  if (error) throw new Error(error.message);
  type Row = { id: string; sku: string; name: string; inventory_unit: string; current_stock: number; min_stock: number; effective_unit_cost: number | null; normalized_unit_cost: number | null; categories: { name: string } | null };
  const rows = (data ?? []) as unknown as Row[];
  const k = (kpi ?? {}) as { low_stock?: number; out_of_stock?: number };
  const value = (allStock ?? []).reduce((a, p) => a + Number(p.current_stock) * Number(p.effective_unit_cost ?? p.normalized_unit_cost ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Inventario"
        description="Existencias calculadas exclusivamente a partir de movimientos registrados."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/inventory/movements">
                <History /> Movimientos
              </Link>
            </Button>
            <MovementDialog canAdjust={can(profile.role, "inventory.adjust")} />
          </>
        }
      />
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="Productos agotados" value={k.out_of_stock ?? 0} icon={PackageX} tone="danger" href="/inventory?level=out" />
        <StatCard label="Bajo stock mínimo" value={k.low_stock ?? 0} icon={AlertTriangle} tone="warning" href="/inventory?level=low" />
        {showCost ? <StatCard label="Valor del inventario (costo)" value={formatMoney(value, settings.currency)} /> : null}
      </div>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <SearchInput placeholder="Producto, SKU o código de barras…" />
        <FilterSelect
          name="level"
          placeholder="Todas las existencias"
          options={[
            { value: "low", label: "Bajo mínimo" },
            { value: "out", label: "Agotados" },
          ]}
        />
        <FilterSelect name="category" placeholder="Todas las categorías" options={(categories ?? []).map((c) => ({ value: c.id, label: c.name }))} />
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Sin productos para mostrar" />
      ) : (
        <Card className="gap-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead label="Producto" column="name" base="/inventory" params={params} list={list} />
                <TableHead>Categoría</TableHead>
                <SortableHead label="Existencias" column="current_stock" base="/inventory" params={params} list={list} className="text-right" />
                <SortableHead label="Mínimo" column="min_stock" base="/inventory" params={params} list={list} className="text-right" />
                <TableHead>Alerta</TableHead>
                {showCost ? <TableHead className="text-right">Valor</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const stock = Number(p.current_stock);
                const out = stock <= 0;
                const low = !out && Number(p.min_stock) > 0 && stock <= Number(p.min_stock);
                return (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link href={`/products/${p.id}`} className="font-medium hover:underline">
                        {p.name}
                      </Link>
                      <div className="font-mono text-xs text-muted-foreground">{p.sku}</div>
                    </TableCell>
                    <TableCell>{p.categories?.name ?? "—"}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatNumber(stock)} <span className="text-xs text-muted-foreground">{p.inventory_unit}</span>
                    </TableCell>
                    <TableCell className="text-right">{formatNumber(p.min_stock)}</TableCell>
                    <TableCell>{out ? <Badge variant="destructive">Agotado</Badge> : low ? <Badge variant="warning">Bajo mínimo</Badge> : <Badge variant="success">OK</Badge>}</TableCell>
                    {showCost ? <TableCell className="text-right">{formatMoney(Math.max(stock, 0) * Number(p.effective_unit_cost ?? p.normalized_unit_cost ?? 0), settings.currency)}</TableCell> : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <Pagination base="/inventory" params={params} list={list} total={count ?? 0} />
        </Card>
      )}
    </>
  );
}
