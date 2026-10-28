import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";

import { DeleteLinkButton, ToggleActiveButton } from "@/app/(app)/products/[id]/product-actions";
import { PriceHistoryChart } from "@/components/charts/charts";
import { PageHeader } from "@/components/common/page-header";
import { StatCard } from "@/components/common/stat-card";
import { ActiveBadge, CostChangeBadge } from "@/components/common/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getSettings, requirePage } from "@/lib/auth";
import { formatCost, formatDate, formatDateTime, formatMoney, formatNumber, formatPct } from "@/lib/format";
import { MOVEMENT_LABELS } from "@/lib/labels";
import { can } from "@/lib/permissions";
import type { MovementType, Product } from "@/lib/types";

type Stats = {
  count: number;
  last?: { cost: number; effective: number; package_price: number; unit: string; date: string; supplier: string };
  previous?: { cost: number; effective: number; package_price: number; unit: string; date: string; supplier: string };
  min?: { cost: number; date: string; supplier: string };
  max?: { cost: number; date: string; supplier: string };
  avg?: number;
  cheapest_supplier?: { supplier: string; cost: number; date: string };
  suppliers: { supplier_id: string; supplier: string; cost: number; date: string }[];
};

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requirePage();
  const settings = await getSettings();
  const cur = settings.currency;
  const { data: product } = await supabase
    .from("products")
    .select("*, categories(name), default_supplier:suppliers!products_default_supplier_id_fkey(trade_name)")
    .eq("id", id)
    .maybeSingle<Product & { categories: { name: string } | null; default_supplier: { trade_name: string } | null }>();
  if (!product) notFound();

  const showCosts = can(profile.role, "prices.read");
  const [statsRes, historyRes, codesRes, aliasesRes, movementsRes] = await Promise.all([
    showCosts ? supabase.rpc("product_price_stats", { p_product_id: id }) : Promise.resolve({ data: null }),
    showCosts
      ? supabase
          .from("product_cost_history")
          .select("id, purchase_date, document_number, invoice_id, quantity, unit, conversion_factor, package_price, normalized_unit_cost, effective_unit_cost, line_tax, allocated_freight, allocated_discount, voided, suppliers(trade_name)")
          .eq("product_id", id)
          .order("purchase_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [] }),
    showCosts
      ? supabase.from("product_supplier_codes").select("id, supplier_code, supplier_description, units_per_package, suppliers(trade_name)").eq("product_id", id)
      : Promise.resolve({ data: [] }),
    showCosts
      ? supabase.from("product_aliases").select("id, description, times_confirmed, suppliers(trade_name)").eq("product_id", id).order("times_confirmed", { ascending: false })
      : Promise.resolve({ data: [] }),
    supabase
      .from("inventory_movements")
      .select("id, movement_type, quantity, reason, created_at")
      .eq("product_id", id)
      .order("created_at", { ascending: false })
      .limit(15),
  ]);

  const stats = statsRes.data as Stats | null;
  type HistoryRow = {
    id: string;
    purchase_date: string;
    document_number: string | null;
    invoice_id: string | null;
    quantity: number;
    unit: string | null;
    conversion_factor: number;
    package_price: number;
    normalized_unit_cost: number;
    effective_unit_cost: number;
    line_tax: number;
    allocated_freight: number;
    allocated_discount: number;
    voided: boolean;
    suppliers: { trade_name: string } | null;
  };
  const history = (historyRes.data ?? []) as unknown as HistoryRow[];
  const codes = (codesRes.data ?? []) as unknown as { id: string; supplier_code: string; supplier_description: string | null; units_per_package: number | null; suppliers: { trade_name: string } | null }[];
  const aliases = (aliasesRes.data ?? []) as unknown as { id: string; description: string; times_confirmed: number; suppliers: { trade_name: string } | null }[];
  const movements = (movementsRes.data ?? []) as { id: number; movement_type: MovementType; quantity: number; reason: string | null; created_at: string }[];

  const diff = stats?.last && stats.previous ? stats.last.cost - stats.previous.cost : null;
  const pct = diff !== null && stats?.previous?.cost ? (diff / stats.previous.cost) * 100 : null;
  const points = history.filter((h) => !h.voided).map((h) => ({ date: h.purchase_date, supplier: h.suppliers?.trade_name ?? "—", cost: Number(h.normalized_unit_cost) }));
  const canWrite = can(profile.role, "products.write");

  return (
    <>
      <PageHeader
        title={product.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{product.sku}</span>
            {product.barcode ? <span>· {product.barcode}</span> : null}
            <ActiveBadge active={product.active} />
          </span>
        }
        actions={
          canWrite ? (
            <>
              <ToggleActiveButton id={product.id} active={product.active} />
              <Button asChild>
                <Link href={`/products/${product.id}/edit`}>
                  <Pencil /> Editar
                </Link>
              </Button>
            </>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Existencias"
          value={`${formatNumber(product.current_stock)} ${product.inventory_unit}`}
          hint={product.min_stock > 0 ? `Mínimo: ${formatNumber(product.min_stock)}` : "Sin stock mínimo"}
          tone={Number(product.current_stock) <= Number(product.min_stock) && product.min_stock > 0 ? "warning" : "default"}
        />
        {showCosts ? (
          <>
            <StatCard
              label={`Último costo / ${product.inventory_unit}`}
              value={formatCost(stats?.last?.cost ?? null, cur)}
              hint={stats?.last ? `${formatDate(stats.last.date)} · ${stats.last.supplier}` : "Sin compras confirmadas"}
            />
            <StatCard
              label="Variación vs. compra anterior"
              value={<span className="flex items-center gap-2">{diff !== null ? formatCost(diff, cur) : "—"} <CostChangeBadge pct={pct} /></span>}
              hint={stats?.previous ? `Anterior: ${formatCost(stats.previous.cost, cur)} (${formatDate(stats.previous.date)})` : "Se necesita más de una compra"}
            />
            <StatCard
              label="Costo más bajo registrado"
              value={formatCost(stats?.min?.cost ?? null, cur)}
              hint={stats?.min ? `${stats.min.supplier} · ${formatDate(stats.min.date)}` : "—"}
            />
          </>
        ) : (
          <StatCard label="Precio de venta" value={formatMoney(product.sale_price, cur)} />
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Ficha del producto</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <dt className="text-muted-foreground">Categoría</dt>
              <dd>{product.categories?.name ?? "—"}</dd>
              <dt className="text-muted-foreground">Marca</dt>
              <dd>{product.brand ?? "—"}</dd>
              <dt className="text-muted-foreground">Presentación</dt>
              <dd>
                1 {product.purchase_unit} = {formatNumber(product.units_per_package)} {product.inventory_unit}
                {product.size_value ? ` de ${formatNumber(product.size_value)} ${product.size_unit ?? ""}` : ""}
              </dd>
              <dt className="text-muted-foreground">Proveedor habitual</dt>
              <dd>{product.default_supplier?.trade_name ?? "—"}</dd>
              {showCosts ? (
                <>
                  <dt className="text-muted-foreground">Último precio de compra</dt>
                  <dd>
                    {formatMoney(product.last_purchase_price, cur)} / {product.purchase_unit}
                  </dd>
                  <dt className="text-muted-foreground">Costo efectivo</dt>
                  <dd>
                    {formatCost(product.effective_unit_cost, cur)} / {product.inventory_unit}
                  </dd>
                  <dt className="text-muted-foreground">Proveedor más económico</dt>
                  <dd>
                    {stats?.cheapest_supplier ? `${stats.cheapest_supplier.supplier} (${formatCost(stats.cheapest_supplier.cost, cur)})` : "—"}
                  </dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">Precio de venta</dt>
              <dd>{formatMoney(product.sale_price, cur)}</dd>
              <dt className="text-muted-foreground">Fecha última compra</dt>
              <dd>{formatDate(product.last_purchase_date)}</dd>
            </dl>
            {product.notes ? <p className="mt-4 rounded-md bg-muted p-3 text-sm">{product.notes}</p> : null}
          </CardContent>
        </Card>

        {showCosts ? (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Evolución del costo por {product.inventory_unit}</CardTitle>
            </CardHeader>
            <CardContent>
              {points.length ? (
                <PriceHistoryChart points={points} currency={cur} unit={product.inventory_unit} />
              ) : (
                <p className="py-12 text-center text-sm text-muted-foreground">Aún no hay compras confirmadas para este producto.</p>
              )}
              {stats?.suppliers?.length ? (
                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  {stats.suppliers.map((s) => (
                    <Badge key={s.supplier_id} variant="outline">
                      {s.supplier}: {formatCost(s.cost, cur)} ({formatDate(s.date)})
                    </Badge>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>

      {showCosts ? (
        <Card className="mt-4 gap-0 pb-0">
          <CardHeader className="pb-3">
            <CardTitle>Historial de precios de compra</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead className="text-right">Precio / unidad facturada</TableHead>
                <TableHead className="text-right">Costo / {product.inventory_unit}</TableHead>
                <TableHead className="text-right">Costo efectivo</TableHead>
                <TableHead className="text-right">Imp. / flete / desc.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
                    Sin registros.
                  </TableCell>
                </TableRow>
              ) : (
                history.map((h, i) => {
                  const next = history.slice(i + 1).find((x) => !x.voided);
                  const change = !h.voided && next ? ((h.normalized_unit_cost - next.normalized_unit_cost) / next.normalized_unit_cost) * 100 : null;
                  return (
                    <TableRow key={h.id} className={h.voided ? "text-muted-foreground line-through" : undefined}>
                      <TableCell>{formatDate(h.purchase_date)}</TableCell>
                      <TableCell>{h.suppliers?.trade_name}</TableCell>
                      <TableCell>
                        {h.invoice_id ? (
                          <Link href={`/invoices/${h.invoice_id}`} className="hover:underline">
                            {h.document_number}
                          </Link>
                        ) : (
                          h.document_number
                        )}
                        {h.voided ? <Badge variant="outline" className="ml-1 no-underline">Anulada</Badge> : null}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatNumber(h.quantity)} {h.unit} <span className="text-xs text-muted-foreground">(×{formatNumber(h.conversion_factor)})</span>
                      </TableCell>
                      <TableCell className="text-right">{formatMoney(h.package_price, cur)}</TableCell>
                      <TableCell className="text-right">
                        {formatCost(h.normalized_unit_cost, cur)}
                        {change !== null && Math.abs(change) > 0.005 ? (
                          <span className={change > 0 ? "ml-1 text-xs text-destructive" : "ml-1 text-xs text-success"}>{formatPct(change)}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">{formatCost(h.effective_unit_cost, cur)}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {formatMoney(h.line_tax, cur)} / {formatMoney(h.allocated_freight, cur)} / {formatMoney(h.allocated_discount, cur)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Card>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {showCosts ? (
          <Card className="gap-0 pb-0">
            <CardHeader className="pb-3">
              <CardTitle>Códigos de proveedor y asociaciones confirmadas</CardTitle>
            </CardHeader>
            <Table>
              <TableBody>
                {codes.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Badge variant="secondary">Código</Badge>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <span className="font-mono">{c.supplier_code}</span> · {c.supplier_description}
                      <div className="text-xs text-muted-foreground">{c.suppliers?.trade_name}</div>
                    </TableCell>
                    <TableCell className="w-10">{canWrite ? <DeleteLinkButton kind="code" id={c.id} productId={product.id} /> : null}</TableCell>
                  </TableRow>
                ))}
                {aliases.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Badge variant="muted">Alias ×{a.times_confirmed}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {a.description}
                      <div className="text-xs text-muted-foreground">{a.suppliers?.trade_name ?? "Cualquier proveedor"}</div>
                    </TableCell>
                    <TableCell className="w-10">{canWrite ? <DeleteLinkButton kind="alias" id={a.id} productId={product.id} /> : null}</TableCell>
                  </TableRow>
                ))}
                {codes.length + aliases.length === 0 ? (
                  <TableRow>
                    <TableCell className="py-6 text-center text-muted-foreground">
                      Se crean al confirmar facturas con líneas vinculadas a este producto.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </Card>
        ) : null}
        <Card className="gap-0 pb-0">
          <CardHeader className="pb-3">
            <CardTitle>Últimos movimientos de inventario</CardTitle>
          </CardHeader>
          <Table>
            <TableBody>
              {movements.length === 0 ? (
                <TableRow>
                  <TableCell className="py-6 text-center text-muted-foreground">Sin movimientos.</TableCell>
                </TableRow>
              ) : (
                movements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="text-xs">{formatDateTime(m.created_at)}</TableCell>
                    <TableCell>{MOVEMENT_LABELS[m.movement_type]}</TableCell>
                    <TableCell className={Number(m.quantity) < 0 ? "text-right text-destructive" : "text-right text-success"}>
                      {Number(m.quantity) > 0 ? "+" : ""}
                      {formatNumber(m.quantity)}
                    </TableCell>
                    <TableCell className="max-w-48 truncate text-xs text-muted-foreground">{m.reason}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>
    </>
  );
}
