"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";

import { createUnit, saveCategory, saveSettings, toggleUnit } from "@/app/(app)/settings/actions";
import { Field } from "@/components/common/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AppSettings, Category, Unit } from "@/lib/types";
import { settingsSchema, unitSchema, type SettingsInput } from "@/lib/validations";

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" />
      <span>
        <span className="font-medium">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}

export function SettingsForm({ settings }: { settings: AppSettings }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const { register, handleSubmit, watch, setValue, formState } = useForm<SettingsInput, unknown, z.output<typeof settingsSchema>>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      company_name: settings.company_name,
      currency: settings.currency,
      cost_include_freight: settings.cost_include_freight,
      cost_include_discounts: settings.cost_include_discounts,
      cost_include_nonrecoverable_tax: settings.cost_include_nonrecoverable_tax,
      cost_include_other_charges: settings.cost_include_other_charges,
      cost_update_source: settings.cost_update_source,
      inventory_entry_source: settings.inventory_entry_source,
      total_tolerance: settings.total_tolerance,
      payments_enabled: settings.payments_enabled,
      default_tax_rate: settings.default_tax_rate,
    },
  });
  const e = formState.errors;
  const bool = (k: "cost_include_freight" | "cost_include_discounts" | "cost_include_nonrecoverable_tax" | "cost_include_other_charges" | "payments_enabled") => ({
    checked: !!watch(k),
    onChange: (v: boolean) => setValue(k, v, { shouldDirty: true }),
  });
  return (
    <form
      className="grid gap-4"
      onSubmit={handleSubmit((v) =>
        start(async () => {
          const res = await saveSettings(v);
          if (res.ok) {
            toast.success(res.message);
            router.refresh();
          } else toast.error(res.error);
        }),
      )}
    >
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Empresa" error={e.company_name?.message} className="sm:col-span-2">
            <Input {...register("company_name")} />
          </Field>
          <Field label="Moneda (ISO)" error={e.currency?.message} hint="USD por defecto">
            <Input {...register("currency")} maxLength={3} className="uppercase" />
          </Field>
          <Field label="Impuesto predeterminado OC (%)" error={e.default_tax_rate?.message}>
            <Input inputMode="decimal" {...register("default_tax_rate")} />
          </Field>
          <Field label="Tolerancia de totales" error={e.total_tolerance?.message} hint="Diferencia máxima aceptada entre total calculado e impreso">
            <Input inputMode="decimal" {...register("total_tolerance")} />
          </Field>
          <div className="sm:col-span-2 lg:col-span-3">
            <Toggle label="Módulo de pagos habilitado" hint="Controla saldos y deudas con proveedores" {...bool("payments_enabled")} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Política de costos</CardTitle>
          <CardDescription>Define el costo efectivo que se guarda en el historial. El precio antes de impuestos siempre se conserva por separado. Los cambios aplican a facturas confirmadas a partir de ahora.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Toggle label="Incluir transporte / flete" hint="Se reparte proporcionalmente al importe de cada línea" {...bool("cost_include_freight")} />
          <Toggle label="Restar descuentos generales de factura" {...bool("cost_include_discounts")} />
          <Toggle label="Incluir impuestos no recuperables" hint="Active si el impuesto no se recupera como crédito fiscal" {...bool("cost_include_nonrecoverable_tax")} />
          <Toggle label="Incluir otros cargos" {...bool("cost_include_other_charges")} />
          <Field label="El costo del producto se actualiza con">
            <NativeSelect {...register("cost_update_source")}>
              <option value="invoice">Factura confirmada</option>
              <option value="receipt">Recepción confirmada</option>
            </NativeSelect>
          </Field>
          <Field label="Las entradas de inventario se generan con">
            <NativeSelect {...register("inventory_entry_source")}>
              <option value="invoice">Factura confirmada</option>
              <option value="receipt">Recepción confirmada</option>
            </NativeSelect>
          </Field>
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null} Guardar configuración
        </Button>
      </div>
    </form>
  );
}

const KIND_LABEL: Record<Unit["kind"], string> = { count: "Conteo", weight: "Peso", volume: "Volumen", length: "Longitud", other: "Otro" };

export function UnitsManager({ units }: { units: Unit[] }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const { register, handleSubmit, reset, watch, setValue } = useForm<z.input<typeof unitSchema>>({
    resolver: zodResolver(unitSchema),
    defaultValues: { code: "", name: "", kind: "count", base_factor: "", is_package: false },
  });
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(res.message);
        router.refresh();
      } else toast.error(res.error);
    });
  return (
    <Card className="gap-0 pb-0">
      <CardHeader className="pb-3">
        <CardTitle>Unidades de medida</CardTitle>
        <CardDescription>Factor base: kg para peso, litro para volumen, unidad para conteo. Los empaques (caja, saco…) no tienen factor fijo.</CardDescription>
      </CardHeader>
      <form className="grid gap-2 border-y bg-muted/40 p-3 sm:grid-cols-6" onSubmit={handleSubmit((v) => run(async () => { const r = await createUnit(v); if (r.ok) reset(); return r; }))}>
        <Input placeholder="código" {...register("code")} />
        <Input placeholder="Nombre" {...register("name")} className="sm:col-span-2" />
        <NativeSelect {...register("kind")}>
          {Object.entries(KIND_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </NativeSelect>
        <Input placeholder="Factor base" inputMode="decimal" {...register("base_factor")} />
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs">
            <Checkbox checked={!!watch("is_package")} onCheckedChange={(v) => setValue("is_package", v === true)} /> Empaque
          </label>
          <Button type="submit" size="icon" disabled={pending} aria-label="Agregar unidad">
            <Plus />
          </Button>
        </div>
      </form>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Código</TableHead>
            <TableHead>Nombre</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead className="text-right">Factor base</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {units.map((u) => (
            <TableRow key={u.code} className={!u.active ? "text-muted-foreground" : undefined}>
              <TableCell className="font-mono">{u.code}</TableCell>
              <TableCell>
                {u.name} {u.is_package ? <Badge variant="muted">Empaque</Badge> : null}
              </TableCell>
              <TableCell>{KIND_LABEL[u.kind]}</TableCell>
              <TableCell className="text-right">{u.base_factor ?? "—"}</TableCell>
              <TableCell className="text-right">
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => toggleUnit(u.code, !u.active))}>
                  {u.active ? "Desactivar" : "Activar"}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

export function CategoriesManager({ categories }: { categories: Category[] }) {
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(res.message);
        router.refresh();
      } else toast.error(res.error);
    });
  return (
    <Card className="gap-0 pb-0">
      <CardHeader className="pb-3">
        <CardTitle>Categorías de productos</CardTitle>
      </CardHeader>
      <div className="flex gap-2 border-y bg-muted/40 p-3">
        <Input placeholder="Nueva categoría" value={name} onChange={(e) => setName(e.target.value)} />
        <Button disabled={pending || name.trim().length < 2} onClick={() => run(async () => { const r = await saveCategory(null, name); if (r.ok) setName(""); return r; })}>
          <Plus /> Agregar
        </Button>
      </div>
      <Table>
        <TableBody>
          {categories.map((c) => (
            <TableRow key={c.id} className={!c.active ? "text-muted-foreground" : undefined}>
              <TableCell>{c.name}</TableCell>
              <TableCell className="text-right">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    const n = window.prompt("Nuevo nombre", c.name);
                    if (n) run(() => saveCategory(c.id, n, c.active));
                  }}
                >
                  Renombrar
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => saveCategory(c.id, c.name, !c.active))}>
                  {c.active ? "Desactivar" : "Activar"}
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {categories.length === 0 ? (
            <TableRow>
              <TableCell className="py-6 text-center text-muted-foreground">Sin categorías.</TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </Card>
  );
}
