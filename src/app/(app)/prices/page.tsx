import Link from "next/link";
import { TrendingDown, TrendingUp } from "lucide-react";

import { Pagination, SortableHead } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { FilterSelect, SearchInput } from "@/components/common/list-controls";
import { PageHeader } from "@/components/common/page-header";
import { StatCard } from "@/components/common/stat-card";
import { CostChangeBadge } from "@/components/common/status-badges";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getSettings, requirePage } from "@/lib/auth";
import { formatCost, formatDate } from "@/lib/format";
import { ilikePattern, parseListParams, sp, type SearchParams } from "@/lib/list-params";

export const metadata = { title: "Costos y precios" };

export default async function PricesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { supabase } = await requirePage("prices.read");
  const settings = await getSettings();
  const cur = settings.currency;
  const list = parseListParams(params, { sortable: ["name", "pct", "diff", "last_date", "last_cost"], defaultSort: "last_date", defaultDir: "desc" });

  let query = supabase.from("product_cost_changes").select("*", { count: "exact" });
  const dir = sp(params, "change");
  if (dir === "up") query = query.gt("diff", 0);
  if (dir === "down") query = query.lt("diff", 0);
  if (dir === "same") query = query.eq("diff", 0);
  if (list.q) query = query.or(`name.ilike.${ilikePattern(list.q)},sku.ilike.${ilikePattern(list.q)}`);
  const category = sp(params, "category");
  if (category) query = query.eq("category_id", category);

  const [{ data, count, error }, up, down, { data: suppliers }, { data: categories }] = await Promise.all([
    query.order(list.sort, { ascending: list.dir === "asc", nullsFirst: false }).range(list.from, list.to),
    supabase.from("product_cost_changes").select("product_id", { count: "exact", head: true }).gt("diff", 0),
    supabase.from("product_cost_changes").select("product_id", { count: "exact", head: true }).lt("diff", 0),
    supabase.from("suppliers").select("id, trade_name"),
    supabase.from("categories").select("id, name").order("name"),
  ]);
  if (error) throw new Error(error.message);
  const smap = new Map((suppliers ?? []).map((s) => [s.id, s.trade_name]));
  type Row = { product_id: string; sku: string; name: string; inventory_unit: string; last_cost: number; last_date: string; last_supplier_id: string; previous_cost: number | null; previous_date: string | null; previous_supplier_id: string | null; diff: number | null; pct: number | null };
  const rows = (data ?? []) as Row[];

  return (
    <>
      <PageHeader title="Costos y precios" description="Último costo de compra frente a la compra anterior, normalizado por unidad de inventario." />
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="Productos con aumento" value={up.count ?? 0} icon={TrendingUp} tone="danger" href="/prices?change=up&sort=pct&dir=desc" />
        <StatCard label="Productos con disminución" value={down.count ?? 0} icon={TrendingDown} href="/prices?change=down&sort=pct&dir=asc" />
        <StatCard label="Productos con historial" value={count ?? 0} hint="Según filtros actuales" />
      </div>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <SearchInput placeholder="Producto o SKU…" />
        <FilterSelect
          name="change"
          placeholder="Todas las variaciones"
          options={[
            { value: "up", label: "Aumentos" },
            { value: "down", label: "Disminuciones" },
            { value: "same", label: "Sin cambio" },
          ]}
        />
        <FilterSelect name="category" placeholder="Todas las categorías" options={(categories ?? []).map((c) => ({ value: c.id, label: c.name }))} />
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Sin historial de costos" description="El historial se genera al confirmar facturas (o recepciones, según la configuración)." />
      ) : (
        <Card className="gap-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead label="Producto" column="name" base="/prices" params={params} list={list} />
                <SortableHead label="Último costo" column="last_cost" base="/prices" params={params} list={list} className="text-right" />
                <TableHead className="text-right">Costo anterior</TableHead>
                <SortableHead label="Diferencia" column="diff" base="/prices" params={params} list={list} className="text-right" />
                <SortableHead label="Variación" column="pct" base="/prices" params={params} list={list} />
                <SortableHead label="Última compra" column="last_date" base="/prices" params={params} list={list} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.product_id}>
                  <TableCell className="whitespace-normal">
                    <Link href={`/products/${r.product_id}`} className="font-medium hover:underline">
                      {r.name}
                    </Link>
                    <div className="font-mono text-xs text-muted-foreground">{r.sku}</div>
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCost(r.last_cost, cur)}/{r.inventory_unit}
                    <div className="text-xs text-muted-foreground">{smap.get(r.last_supplier_id)}</div>
                  </TableCell>
                  <TableCell className="text-right">
                    {r.previous_cost !== null ? `${formatCost(r.previous_cost, cur)}/${r.inventory_unit}` : "—"}
                    <div className="text-xs text-muted-foreground">
                      {r.previous_supplier_id ? `${smap.get(r.previous_supplier_id)} · ${formatDate(r.previous_date)}` : ""}
                    </div>
                  </TableCell>
                  <TableCell className={`text-right ${Number(r.diff) > 0 ? "text-destructive" : Number(r.diff) < 0 ? "text-success" : ""}`}>
                    {r.diff !== null ? formatCost(r.diff, cur) : "—"}
                  </TableCell>
                  <TableCell>
                    <CostChangeBadge pct={r.pct} />
                  </TableCell>
                  <TableCell>{formatDate(r.last_date)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination base="/prices" params={params} list={list} total={count ?? 0} />
        </Card>
      )}
    </>
  );
}
