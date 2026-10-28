import Link from "next/link";

import { Pagination } from "@/components/common/data-table";
import { DateRangeFilter, FilterSelect } from "@/components/common/list-controls";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePage } from "@/lib/auth";
import { describeAudit, entityHref, entityLabel, type AuditLog } from "@/lib/audit";
import { formatDateTime } from "@/lib/format";
import { dateRange, parseListParams, sp, type SearchParams } from "@/lib/list-params";

export const metadata = { title: "Auditoría" };

const ENTITIES = ["invoices", "purchase_orders", "goods_receipts", "products", "suppliers", "payments", "profiles", "app_settings", "categories"];

export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { supabase } = await requirePage("audit.read");
  const list = parseListParams(params, { sortable: ["created_at"], defaultSort: "created_at", defaultDir: "desc", pageSize: 40 });
  const range = dateRange(params, 30);
  let q = supabase
    .from("audit_logs")
    .select("*", { count: "exact" })
    .gte("created_at", `${range.from}T00:00:00Z`)
    .lte("created_at", `${range.to}T23:59:59Z`);
  const entity = sp(params, "entity");
  if (entity) q = q.eq("entity", entity);
  const [{ data, count }, { data: profiles }] = await Promise.all([
    q.order("created_at", { ascending: false }).range(list.from, list.to),
    supabase.from("profiles").select("id, full_name, email"),
  ]);
  const people = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? p.email]));
  const rows = (data ?? []) as AuditLog[];
  return (
    <>
      <PageHeader title="Auditoría" description="Registro inmutable de cambios importantes: quién, qué y cuándo." />
      <div className="mb-3 flex flex-col flex-wrap gap-2 lg:flex-row">
        <FilterSelect name="entity" placeholder="Todas las entidades" options={ENTITIES.map((e) => ({ value: e, label: entityLabel(e) }))} />
        <DateRangeFilter defaultFrom={range.from} defaultTo={range.to} />
      </div>
      <Card className="gap-0 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Usuario</TableHead>
              <TableHead>Entidad</TableHead>
              <TableHead>Cambio</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a) => {
              const href = entityHref(a);
              return (
                <TableRow key={a.id}>
                  <TableCell className="text-xs">{formatDateTime(a.created_at)}</TableCell>
                  <TableCell className="text-sm">{a.actor_id ? people.get(a.actor_id) ?? "Usuario" : "Sistema"}</TableCell>
                  <TableCell>
                    <Badge variant="muted">{entityLabel(a.entity)}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-normal text-sm">
                    {href ? (
                      <Link className="hover:underline" href={href}>
                        {describeAudit(a)}
                      </Link>
                    ) : (
                      describeAudit(a)
                    )}
                    {a.after && "void_reason" in a.after && a.after.void_reason ? (
                      <div className="text-xs text-destructive">Motivo: {String(a.after.void_reason)}</div>
                    ) : null}
                    {a.after && "total_exception_note" in a.after && a.after.total_exception_note ? (
                      <div className="text-xs text-[oklch(0.45_0.1_70)]">Excepción: {String(a.after.total_exception_note)}</div>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  Sin registros en el período.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
        <Pagination base="/audit" params={params} list={list} total={count ?? 0} />
      </Card>
    </>
  );
}
