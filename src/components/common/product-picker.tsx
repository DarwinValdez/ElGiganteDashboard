"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronsUpDown, Loader2, Search } from "lucide-react";

import { searchProducts, type ProductOption } from "@/app/(app)/products/search-action";
import { Input } from "@/components/ui/input";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Selector de productos del catálogo con búsqueda en el servidor (nombre, SKU, código de barras, marca). */
export function ProductPicker({
  value,
  onSelect,
  placeholder = "Buscar producto…",
  className,
  invalid,
  initialQuery,
}: {
  value?: { id: string; name: string; sku?: string } | null;
  onSelect: (p: ProductOption) => void;
  placeholder?: string;
  className?: string;
  invalid?: boolean;
  initialQuery?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchProducts(q);
        if (!cancelled) setResults(r);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={ref} className={cn("relative min-w-0", className)}>
      <button
        type="button"
        aria-invalid={invalid}
        onClick={() => {
          setOpen((o) => !o);
          if (!q && initialQuery) setQ(initialQuery);
        }}
        className="border-input flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-card px-3 text-left text-sm shadow-xs aria-invalid:border-destructive"
      >
        <span className={cn("truncate", !value && "text-muted-foreground")}>
          {value ? `${value.name}${value.sku ? ` · ${value.sku}` : ""}` : placeholder}
        </span>
        <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
      </button>
      {open ? (
        <div className="absolute z-50 mt-1 w-full min-w-72 rounded-md border bg-popover p-1 shadow-lg">
          <div className="relative">
            <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, SKU o código de barras" className="pl-8" />
          </div>
          <ul className="mt-1 max-h-64 overflow-y-auto">
            {loading ? (
              <li className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Buscando…
              </li>
            ) : results.length === 0 ? (
              <li className="px-2 py-3 text-sm text-muted-foreground">Sin resultados</li>
            ) : (
              results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                    onClick={() => {
                      onSelect(p);
                      setOpen(false);
                    }}
                  >
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.sku} · 1 {p.purchase_unit} = {formatNumber(p.units_per_package)} {p.inventory_unit}
                      {p.brand ? ` · ${p.brand}` : ""}
                    </div>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
