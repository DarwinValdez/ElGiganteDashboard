"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";

import { savePurchaseOrder } from "@/app/(app)/purchase-orders/actions";
import { Field } from "@/components/common/field";
import { ProductPicker } from "@/components/common/product-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/format";
import type { Unit } from "@/lib/types";
import { purchaseOrderSchema, type PurchaseOrderInput } from "@/lib/validations";

type Values = z.output<typeof purchaseOrderSchema>;
const n = (v: unknown) => {
  const x = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(x) ? x : 0;
};

export function PurchaseOrderForm({
  suppliers,
  units,
  currency,
  defaultTaxRate,
  initial,
  productNames,
}: {
  suppliers: { id: string; trade_name: string }[];
  units: Unit[];
  currency: string;
  defaultTaxRate: number;
  initial?: PurchaseOrderInput;
  productNames?: Record<string, { name: string; sku: string }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const names = { ...(productNames ?? {}) };
  const form = useForm<PurchaseOrderInput, unknown, Values>({
    resolver: zodResolver(purchaseOrderSchema),
    defaultValues: initial ?? {
      supplier_id: "",
      order_date: new Date().toISOString().slice(0, 10),
      expected_date: "",
      currency,
      notes: "",
      discount_total: 0,
      items: [],
    },
  });
  const { register, control, handleSubmit, watch, setValue, formState } = form;
  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const items = watch("items");
  const e = formState.errors;

  let subtotal = 0;
  let tax = 0;
  for (const it of items) {
    const net = n(it.quantity) * n(it.unit_price) - n(it.discount);
    subtotal += net;
    tax += (net * n(it.tax_rate)) / 100;
  }
  const discount = n(watch("discount_total"));
  const total = subtotal - discount + tax;

  const onSubmit = (v: Values) =>
    start(async () => {
      const res = await savePurchaseOrder(v);
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.message);
      router.push(`/purchase-orders/${res.data!.id}`);
      router.refresh();
    });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Proveedor" error={e.supplier_id?.message} required className="sm:col-span-2">
            <NativeSelect {...register("supplier_id")}>
              <option value="">Seleccione…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.trade_name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Fecha de la orden" error={e.order_date?.message} required>
            <Input type="date" {...register("order_date")} />
          </Field>
          <Field label="Entrega esperada">
            <Input type="date" {...register("expected_date")} />
          </Field>
        </CardContent>
      </Card>

      <Card className="gap-3">
        <CardHeader>
          <CardTitle>Productos</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {fields.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Agregue productos del catálogo. {e.items?.message ?? e.items?.root?.message}
            </p>
          ) : null}
          {fields.map((f, i) => {
            const it = items[i];
            const net = n(it?.quantity) * n(it?.unit_price) - n(it?.discount);
            const pid = it?.product_id as string;
            return (
              <div key={f.id} className="grid gap-2 rounded-lg border p-3 md:grid-cols-12 md:items-end">
                <div className="md:col-span-4">
                  <label className="text-xs text-muted-foreground">Producto</label>
                  <ProductPicker
                    invalid={!!e.items?.[i]?.product_id}
                    value={pid ? { id: pid, ...(names[pid] ?? { name: "Producto seleccionado" }) } : null}
                    onSelect={(p) => {
                      names[p.id] = { name: p.name, sku: p.sku };
                      setValue(`items.${i}.product_id`, p.id, { shouldValidate: true });
                      setValue(`items.${i}.unit`, p.purchase_unit);
                      setValue(`items.${i}.units_per_package`, p.units_per_package);
                      if (p.last_purchase_price !== null) setValue(`items.${i}.unit_price`, p.last_purchase_price);
                    }}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2 md:col-span-4">
                  <div>
                    <label className="text-xs text-muted-foreground">Cantidad</label>
                    <Input inputMode="decimal" {...register(`items.${i}.quantity`)} aria-invalid={!!e.items?.[i]?.quantity} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Unidad</label>
                    <NativeSelect {...register(`items.${i}.unit`)}>
                      {units.map((u) => (
                        <option key={u.code} value={u.code}>
                          {u.code}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Contenido</label>
                    <Input inputMode="decimal" {...register(`items.${i}.units_per_package`)} title="Unidades de inventario por unidad pedida" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 md:col-span-3">
                  <div>
                    <label className="text-xs text-muted-foreground">Precio est.</label>
                    <Input inputMode="decimal" {...register(`items.${i}.unit_price`)} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Desc. $</label>
                    <Input inputMode="decimal" {...register(`items.${i}.discount`)} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Imp. %</label>
                    <Input inputMode="decimal" {...register(`items.${i}.tax_rate`)} />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 md:col-span-1 md:flex-col md:items-end">
                  <span className="text-sm font-semibold tabular-nums">{formatMoney(net, currency)}</span>
                  <Button type="button" variant="ghost" size="icon" onClick={() => remove(i)} aria-label="Quitar línea">
                    <Trash2 className="text-destructive" />
                  </Button>
                </div>
              </div>
            );
          })}
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() =>
              append({ product_id: "", description: "", quantity: 1, unit: "unidad", units_per_package: 1, unit_price: 0, discount: 0, tax_rate: defaultTaxRate })
            }
          >
            <Plus /> Agregar producto
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent>
            <Field label="Notas para el proveedor">
              <Textarea rows={4} {...register("notes")} />
            </Field>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span className="tabular-nums">{formatMoney(subtotal, currency)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Descuento general</span>
              <Input inputMode="decimal" className="h-8 w-28 text-right" {...register("discount_total")} />
            </div>
            <div className="flex justify-between">
              <span>Impuestos</span>
              <span className="tabular-nums">{formatMoney(tax, currency)}</span>
            </div>
            <div className="flex justify-between border-t pt-2 text-base font-bold">
              <span>Total estimado</span>
              <span className="tabular-nums">{formatMoney(total, currency)}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Los precios son estimados: el costo de los productos se actualiza sólo con facturas o recepciones confirmadas.
            </p>
            <Button type="submit" disabled={pending} className="mt-2">
              {pending ? <Loader2 className="animate-spin" /> : null}
              Guardar como borrador
            </Button>
          </CardContent>
        </Card>
      </div>
    </form>
  );
}
