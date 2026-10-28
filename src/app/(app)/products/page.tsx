import Link from "next/link";
import { Plus } from "lucide-react";

import { Pagination, SortableHead } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { FilterSelect, SearchInput } from "@/components/common/list-controls";
import { PageHeader } from "@/components/common/page-header";
import { ActiveBadge } from "@/components/common/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getSettings, requirePage } from "@/lib/auth";
import { formatCost, formatDate, formatNumber } from "@/lib/format";
import { ilikePattern, parseListParams, sp, type SearchParams } from "@/lib/list-params";
import { can } from "@/lib/permissions";
import type { Product } from "@/lib/types";

export const metadata = { title: "Productos" };

type Row = Product & { categories: { name: string } | null };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { supabase, profile } = await requirePage();
  const settings = await getSettings();
  const list = parseListParams(params, {
    sortable: ["name", "sku", "current_stock", "normalized_unit_cost", "last_purchase_date"],
    defaultSort: "name",
  });
  const showCosts = can(profile.role, "prices.read");

  let query = supabase.from("products").select("*, categories(name)", { count: "exact" });
  if (list.q) {
    const p = ilikePattern(list.q);
    query = query.or(`name.ilike.${p},sku.ilike.${p},barcode.ilike.${p},brand.ilike.${p}`);
  }
  const category = sp(params, "category");
  if (category) query = query.eq("category_id", category);
  const status = sp(params, "status") ?? "active";
  if (status === "active") query = query.eq("active", true);
  if (status === "inactive") query = query.eq("active", false);
  const { data, count, error } = await query
    .order(list.sort, { ascending: list.dir === "asc", nullsFirst: false })
    .range(list.from, list.to);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];

  const { data: categories } = await supabase.from("categories").select("id, name").order("name");

  return (
    <>
      <PageHeader
        title="Productos"
        description="Catálogo centralizado con unidades, presentaciones y costos normalizados."
        actions={
          can(profile.role, "products.write") ? (
            <Button asChild>
              <Link href="/products/new">
                <Plus /> Nuevo producto
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <SearchInput placeholder="Nombre, SKU, código de barras, marca…" />
        <FilterSelect name="category" placeholder="Todas las categorías" options={(categories ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <FilterSelect
          name="status"
          placeholder="Activos"
          options={[
            { value: "all", label: "Todos" },
            { value: "inactive", label: "Inactivos" },
          ]}
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No hay productos" description="Cree productos o ajuste los filtros de búsqueda." />
      ) : (
        <Card className="gap-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead label="SKU" column="sku" base="/products" params={params} list={list} />
                <SortableHead label="Producto" column="name" base="/products" params={params} list={list} />
                <TableHead>Presentación</TableHead>
                <SortableHead label="Existencias" column="current_stock" base="/products" params={params} list={list} className="text-right" />
                {showCosts ? (
                  <>
                    <SortableHead label="Costo unit." column="normalized_unit_cost" base="/products" params={params} list={list} className="text-right" />
                    <SortableHead label="Últ. compra" column="last_purchase_date" base="/products" params={params} list={list} />
                  </>
                ) : null}
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const low = p.min_stock > 0 && Number(p.current_stock) <= Number(p.min_stock);
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                    <TableCell className="max-w-80 whitespace-normal">
                      <Link href={`/products/${p.id}`} className="font-medium hover:underline">
                        {p.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {[p.brand, p.categories?.name, p.barcode].filter(Boolean).join(" · ")}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      1 {p.purchase_unit} = {formatNumber(p.units_per_package)} {p.inventory_unit}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={Number(p.current_stock) <= 0 ? "font-semibold text-destructive" : low ? "font-semibold text-[oklch(0.5_0.12_70)]" : ""}>
                        {formatNumber(p.current_stock)}
                      </span>{" "}
                      <span className="text-xs text-muted-foreground">{p.inventory_unit}</span>
                      {low ? <Badge variant="warning" className="ml-1">Bajo</Badge> : null}
                    </TableCell>
                    {showCosts ? (
                      <>
                        <TableCell className="text-right">
                          {formatCost(p.normalized_unit_cost, settings.currency)}
                          <span className="text-xs text-muted-foreground">/{p.inventory_unit}</span>
                        </TableCell>
                        <TableCell>{formatDate(p.last_purchase_date)}</TableCell>
                      </>
                    ) : null}
                    <TableCell>
                      <ActiveBadge active={p.active} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <Pagination base="/products" params={params} list={list} total={count ?? 0} />
        </Card>
      )}
    </>
  );
}
