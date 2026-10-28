"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { createCategory, createProduct, updateProduct } from "@/app/(app)/products/actions";
import { Field } from "@/components/common/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { Lookups } from "@/lib/data";
import type { Product } from "@/lib/types";
import { productSchema, type ProductInput, type ProductValues } from "@/lib/validations";

export type CreatedProduct = { id: string; name: string; sku: string; purchase_unit: string; inventory_unit: string; units_per_package: number };

export function productDefaults(p?: Partial<Product>): ProductInput {
  return {
    name: p?.name ?? "",
    sku: p?.sku ?? "",
    barcode: p?.barcode ?? "",
    category_id: p?.category_id ?? "",
    brand: p?.brand ?? "",
    purchase_unit: p?.purchase_unit ?? "unidad",
    inventory_unit: p?.inventory_unit ?? "unidad",
    units_per_package: p?.units_per_package ?? 1,
    size_value: p?.size_value ?? "",
    size_unit: p?.size_unit ?? "",
    default_supplier_id: p?.default_supplier_id ?? "",
    sale_price: p?.sale_price ?? "",
    min_stock: p?.min_stock ?? 0,
    active: p?.active ?? true,
    notes: p?.notes ?? "",
  };
}

export function ProductForm({
  lookups,
  product,
  initial,
  onCreated,
  compact,
}: {
  lookups: Lookups;
  product?: Product;
  initial?: Partial<Product>;
  onCreated?: (p: CreatedProduct) => void;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [categories, setCategories] = useState(lookups.categories);
  const form = useForm<ProductInput, unknown, ProductValues>({
    resolver: zodResolver(productSchema),
    defaultValues: productDefaults(product ?? initial),
  });
  const { register, handleSubmit, formState, watch, setValue } = form;
  const errors = formState.errors;
  const purchaseUnit = watch("purchase_unit");
  const inventoryUnit = watch("inventory_unit");
  const upp = watch("units_per_package");

  const onSubmit = (values: ProductValues) =>
    start(async () => {
      const res = product ? await updateProduct(product.id, values) : await createProduct(values);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      if (onCreated && !product && res.data && "sku" in res.data) {
        onCreated(res.data as CreatedProduct);
        return;
      }
      router.push(`/products/${product?.id ?? (res.data as { id: string }).id}`);
      router.refresh();
    });

  const addCategory = () => {
    const name = window.prompt("Nombre de la nueva categoría");
    if (!name) return;
    start(async () => {
      const res = await createCategory(name);
      if (res.ok && res.data) {
        setCategories((c) => [...c, res.data!].sort((a, b) => a.name.localeCompare(b.name)));
        setValue("category_id", res.data.id);
        toast.success(res.message);
      } else if (!res.ok) toast.error(res.error);
    });
  };

  const unitOptions = lookups.units.map((u) => (
    <option key={u.code} value={u.code}>
      {u.name} ({u.code})
    </option>
  ));

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-5" noValidate>
      <div className={compact ? "grid gap-4 sm:grid-cols-2" : "grid gap-4 sm:grid-cols-2 lg:grid-cols-3"}>
        <Field label="Nombre" htmlFor="name" error={errors.name?.message} required className="sm:col-span-2">
          <Input id="name" {...register("name")} placeholder="Ej. Aceite vegetal 1 L" />
        </Field>
        <Field label="SKU / código interno" htmlFor="sku" hint={product ? undefined : "Vacío = se genera automáticamente"} error={errors.sku?.message}>
          <Input id="sku" {...register("sku")} className="uppercase" />
        </Field>
        <Field label="Código de barras" htmlFor="barcode" error={errors.barcode?.message}>
          <Input id="barcode" inputMode="numeric" {...register("barcode")} />
        </Field>
        <Field label="Marca" htmlFor="brand" error={errors.brand?.message}>
          <Input id="brand" {...register("brand")} />
        </Field>
        <Field label="Categoría" htmlFor="category_id">
          <div className="flex gap-2">
            <NativeSelect id="category_id" {...register("category_id")}>
              <option value="">Sin categoría</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            <Button type="button" variant="outline" size="icon" onClick={addCategory} aria-label="Nueva categoría">
              <Plus />
            </Button>
          </div>
        </Field>
      </div>

      <fieldset className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="px-1 text-sm font-semibold">Unidades y presentación</legend>
        <Field label="Unidad de compra" htmlFor="purchase_unit" error={errors.purchase_unit?.message} required>
          <NativeSelect id="purchase_unit" {...register("purchase_unit")}>
            {unitOptions}
          </NativeSelect>
        </Field>
        <Field label="Unidad de inventario" htmlFor="inventory_unit" error={errors.inventory_unit?.message} required>
          <NativeSelect id="inventory_unit" {...register("inventory_unit")}>
            {unitOptions}
          </NativeSelect>
        </Field>
        <Field
          label="Contenido por empaque"
          htmlFor="units_per_package"
          error={errors.units_per_package?.message}
          hint={`1 ${purchaseUnit} = ${upp || "?"} ${inventoryUnit}`}
          required
        >
          <Input id="units_per_package" inputMode="decimal" {...register("units_per_package")} />
        </Field>
        <Field label="Tamaño de cada unidad" htmlFor="size_value" hint="Ej. 1 L, 15 oz, 20 lb" error={errors.size_value?.message}>
          <div className="flex gap-2">
            <Input id="size_value" inputMode="decimal" {...register("size_value")} className="w-24" />
            <NativeSelect {...register("size_unit")} aria-label="Unidad de tamaño">
              <option value="">—</option>
              {lookups.units
                .filter((u) => u.base_factor !== null && u.kind !== "count")
                .map((u) => (
                  <option key={u.code} value={u.code}>
                    {u.code}
                  </option>
                ))}
            </NativeSelect>
          </div>
        </Field>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {lookups.suppliers.length > 0 ? (
          <Field label="Proveedor habitual" htmlFor="default_supplier_id">
            <NativeSelect id="default_supplier_id" {...register("default_supplier_id")}>
              <option value="">—</option>
              {lookups.suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.trade_name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
        <Field label="Precio de venta" htmlFor="sale_price" hint="Independiente del costo de compra" error={errors.sale_price?.message}>
          <Input id="sale_price" inputMode="decimal" {...register("sale_price")} />
        </Field>
        <Field label={`Stock mínimo (${inventoryUnit})`} htmlFor="min_stock" error={errors.min_stock?.message}>
          <Input id="min_stock" inputMode="decimal" {...register("min_stock")} />
        </Field>
      </div>

      {!compact ? (
        <Field label="Notas" htmlFor="notes">
          <Textarea id="notes" rows={3} {...register("notes")} />
        </Field>
      ) : null}

      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={!!watch("active")} onCheckedChange={(v) => setValue("active", v === true)} />
        Producto activo
      </label>

      <div className="flex justify-end gap-2">
        {!compact ? (
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancelar
          </Button>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {product ? "Guardar cambios" : "Crear producto"}
        </Button>
      </div>
    </form>
  );
}
