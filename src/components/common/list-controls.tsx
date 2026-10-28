"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

function useParamUpdater() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const update = (patch: Record<string, string | undefined>) => {
    const usp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) usp.set(k, v);
      else usp.delete(k);
    }
    usp.delete("page");
    startTransition(() => router.replace(`${pathname}?${usp.toString()}`, { scroll: false }));
  };
  return { params, update, pending };
}

export function SearchInput({ placeholder = "Buscar…", className }: { placeholder?: string; className?: string }) {
  const { params, update, pending } = useParamUpdater();
  const [value, setValue] = useState(params.get("q") ?? "");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => update({ q: value.trim() || undefined }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className={cn("relative w-full sm:w-72", className)}>
      {pending ? (
        <Loader2 className="absolute top-2.5 left-2.5 size-4 animate-spin text-muted-foreground" />
      ) : (
        <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
      )}
      <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} className="pl-8" type="search" />
    </div>
  );
}

export function FilterSelect({
  name,
  options,
  placeholder,
  className,
}: {
  name: string;
  options: { value: string; label: string }[];
  placeholder: string;
  className?: string;
}) {
  const { params, update } = useParamUpdater();
  return (
    <NativeSelect
      value={params.get(name) ?? ""}
      onChange={(e) => update({ [name]: e.target.value || undefined })}
      className={cn("w-full sm:w-52", className)}
      aria-label={placeholder}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </NativeSelect>
  );
}

export function DateRangeFilter({ defaultFrom, defaultTo }: { defaultFrom: string; defaultTo: string }) {
  const { params, update } = useParamUpdater();
  const presets: { label: string; days?: number; month?: "this" | "last"; year?: boolean }[] = [
    { label: "Este mes", month: "this" },
    { label: "Mes anterior", month: "last" },
    { label: "90 días", days: 90 },
    { label: "Este año", year: true },
  ];
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const apply = (p: (typeof presets)[number]) => {
    const now = new Date();
    let from: Date;
    let to = now;
    if (p.month === "this") from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    else if (p.month === "last") {
      from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    } else if (p.year) from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    else {
      from = new Date(now);
      from.setUTCDate(from.getUTCDate() - (p.days ?? 30));
    }
    update({ from: iso(from), to: iso(to) });
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        type="date"
        aria-label="Desde"
        className="w-auto"
        value={params.get("from") ?? defaultFrom}
        onChange={(e) => update({ from: e.target.value || undefined })}
      />
      <span className="text-sm text-muted-foreground">a</span>
      <Input
        type="date"
        aria-label="Hasta"
        className="w-auto"
        value={params.get("to") ?? defaultTo}
        onChange={(e) => update({ to: e.target.value || undefined })}
      />
      <div className="flex flex-wrap gap-1">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => apply(p)}
            className="rounded-md border bg-card px-2 py-1 text-xs font-medium hover:bg-accent"
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
