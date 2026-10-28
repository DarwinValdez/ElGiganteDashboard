import Link from "next/link";
import { Plus } from "lucide-react";

import { Pagination, SortableHead } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { FilterSelect, SearchInput } from "@/components/common/list-controls";
import { PageHeader } from "@/components/common/page-header";
import { ActiveBadge } from "@/components/common/status-badges";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getSettings, requirePage } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { ilikePattern, parseListParams, sp, type SearchParams } from "@/lib/list-params";
import type { Supplier } from "@/lib/types";

export const metadata = { title: "Proveedores" };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { supabase } = await requirePage("suppliers.read");
  const settings = await getSettings();
  const list = parseListParams(params, { sortable: ["trade_name", "created_at"], defaultSort: "trade_name" });

  let query = supabase.from("suppliers").select("*", { count: "exact" });
  if (list.q) {
    const p = ilikePattern(list.q);
    query = query.or(`trade_name.ilike.${p},legal_name.ilike.${p},tax_id.ilike.${p},contact_name.ilike.${p}`);
  }
  const status = sp(params, "status") ?? "active";
  if (status !== "all") query = query.eq("active", status === "active");
  const { data, count, error } = await query.order(list.sort, { ascending: list.dir === "asc" }).range(list.from, list.to);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Supplier[];
  const { data: balances } = rows.length
    ? await supabase.from("supplier_balances").select("supplier_id, balance").in("supplier_id", rows.map((r) => r.id))
    : { data: [] };
  const balanceMap = new Map((balances ?? []).map((b) => [b.supplier_id, Number(b.balance)]));

  return (
    <>
      <PageHeader
        title="Proveedores"
        description="Datos comerciales, condiciones de pago e historial de compras."
        actions={
          <Button asChild>
            <Link href="/suppliers/new">
              <Plus /> Nuevo proveedor
            </Link>
          </Button>
        }
      />
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <SearchInput placeholder="Nombre, RNC/NIF, contacto…" />
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
        <EmptyState title="No hay proveedores" description="Registre el primer proveedor para crear órdenes y facturas." />
      ) : (
        <Card className="gap-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead label="Proveedor" column="trade_name" base="/suppliers" params={params} list={list} />
                <TableHead>Contacto</TableHead>
                <TableHead>Términos</TableHead>
                <TableHead className="text-right">Saldo pendiente</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <Link href={`/suppliers/${s.id}`} className="font-medium hover:underline">
                      {s.trade_name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{[s.legal_name, s.tax_id].filter(Boolean).join(" · ")}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {s.contact_name ?? "—"}
                    <div className="text-xs text-muted-foreground">{[s.phone, s.email].filter(Boolean).join(" · ")}</div>
                  </TableCell>
                  <TableCell className="text-sm">{s.payment_terms ?? "—"}</TableCell>
                  <TableCell className="text-right font-medium">{formatMoney(balanceMap.get(s.id) ?? 0, settings.currency)}</TableCell>
                  <TableCell>
                    <ActiveBadge active={s.active} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination base="/suppliers" params={params} list={list} total={count ?? 0} />
        </Card>
      )}
    </>
  );
}
