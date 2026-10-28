import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TableHead } from "@/components/ui/table";
import { buildHref, type ListParams, type SearchParams } from "@/lib/list-params";
import { cn } from "@/lib/utils";

export function SortableHead({
  label,
  column,
  base,
  params,
  list,
  className,
}: {
  label: string;
  column: string;
  base: string;
  params: SearchParams;
  list: ListParams;
  className?: string;
}) {
  const active = list.sort === column;
  const nextDir = active && list.dir === "asc" ? "desc" : "asc";
  const Icon = !active ? ArrowUpDown : list.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={className}>
      <Link
        href={buildHref(base, params, { sort: column, dir: nextDir, page: null })}
        className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground")}
        scroll={false}
      >
        {label}
        <Icon className="size-3" />
      </Link>
    </TableHead>
  );
}

export function Pagination({
  base,
  params,
  list,
  total,
}: {
  base: string;
  params: SearchParams;
  list: ListParams;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / list.pageSize));
  const start = total === 0 ? 0 : list.from + 1;
  const end = Math.min(total, list.to + 1);
  return (
    <div className="no-print flex flex-col items-center justify-between gap-2 border-t px-3 py-3 text-sm text-muted-foreground sm:flex-row">
      <span>
        {start}–{end} de {total} registros
      </span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" asChild={list.page > 1} disabled={list.page <= 1}>
          {list.page > 1 ? (
            <Link href={buildHref(base, params, { page: list.page - 1 })} scroll={false}>
              <ChevronLeft /> Anterior
            </Link>
          ) : (
            <span>
              <ChevronLeft /> Anterior
            </span>
          )}
        </Button>
        <span>
          Página {list.page} de {pages}
        </span>
        <Button variant="outline" size="sm" asChild={list.page < pages} disabled={list.page >= pages}>
          {list.page < pages ? (
            <Link href={buildHref(base, params, { page: list.page + 1 })} scroll={false}>
              Siguiente <ChevronRight />
            </Link>
          ) : (
            <span>
              Siguiente <ChevronRight />
            </span>
          )}
        </Button>
      </div>
    </div>
  );
}
