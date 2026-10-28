"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FileDown, Sheet, X } from "lucide-react";

import { ProductPicker } from "@/components/common/product-picker";
import { Button } from "@/components/ui/button";
import { downloadTablePdf } from "@/lib/pdf";

export function ReportExport({ csvHref, title, subtitle, head, body, foot }: { csvHref: string; title: string; subtitle: string; head: string[]; body: string[][]; foot?: string[][] }) {
  return (
    <>
      <Button variant="outline" asChild>
        <a href={csvHref}>
          <Sheet /> CSV
        </a>
      </Button>
      <Button
        variant="outline"
        onClick={() => downloadTablePdf({ filename: `${title.replace(/\s+/g, "_")}.pdf`, title, subtitle, head, body, foot, landscape: head.length > 6 })}
      >
        <FileDown /> PDF
      </Button>
    </>
  );
}

export function ProductFilter({ selected }: { selected: { id: string; name: string } | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(selected);
  const set = (id: string | null) => {
    const usp = new URLSearchParams(params.toString());
    if (id) usp.set("product", id);
    else usp.delete("product");
    router.replace(`${pathname}?${usp.toString()}`);
  };
  return (
    <div className="flex w-full items-center gap-1 sm:w-72">
      <ProductPicker
        value={value}
        placeholder="Todos los productos"
        onSelect={(p) => {
          setValue({ id: p.id, name: p.name });
          set(p.id);
        }}
        className="flex-1"
      />
      {value ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Quitar filtro"
          onClick={() => {
            setValue(null);
            set(null);
          }}
        >
          <X />
        </Button>
      ) : null}
    </div>
  );
}
