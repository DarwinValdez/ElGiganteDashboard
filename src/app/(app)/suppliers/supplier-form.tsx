"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { createSupplier, updateSupplier } from "@/app/(app)/suppliers/actions";
import { Field } from "@/components/common/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Supplier } from "@/lib/types";
import { supplierSchema, type SupplierInput } from "@/lib/validations";
import type { z } from "zod";

export function SupplierForm({
  supplier,
  initialName,
  onCreated,
}: {
  supplier?: Supplier;
  initialName?: string;
  onCreated?: (s: { id: string; trade_name: string }) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { register, handleSubmit, formState, watch, setValue } = useForm<SupplierInput, unknown, z.output<typeof supplierSchema>>({
    resolver: zodResolver(supplierSchema),
    defaultValues: {
      trade_name: supplier?.trade_name ?? initialName ?? "",
      legal_name: supplier?.legal_name ?? "",
      tax_id: supplier?.tax_id ?? "",
      contact_name: supplier?.contact_name ?? "",
      phone: supplier?.phone ?? "",
      email: supplier?.email ?? "",
      address: supplier?.address ?? "",
      payment_terms: supplier?.payment_terms ?? "",
      payment_days: supplier?.payment_days ?? "",
      notes: supplier?.notes ?? "",
      active: supplier?.active ?? true,
    },
  });
  const e = formState.errors;

  const onSubmit = (values: z.output<typeof supplierSchema>) =>
    start(async () => {
      const res = supplier ? await updateSupplier(supplier.id, values) : await createSupplier(values);
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.message);
      if (onCreated && !supplier && res.data && "trade_name" in res.data) return onCreated(res.data);
      router.push(`/suppliers/${supplier?.id ?? res.data!.id}`);
      router.refresh();
    });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre comercial" htmlFor="trade_name" error={e.trade_name?.message} required>
          <Input id="trade_name" {...register("trade_name")} />
        </Field>
        <Field label="Nombre legal" htmlFor="legal_name">
          <Input id="legal_name" {...register("legal_name")} />
        </Field>
        <Field label="Identificación fiscal" htmlFor="tax_id" error={e.tax_id?.message}>
          <Input id="tax_id" {...register("tax_id")} />
        </Field>
        <Field label="Persona de contacto" htmlFor="contact_name">
          <Input id="contact_name" {...register("contact_name")} />
        </Field>
        <Field label="Teléfono" htmlFor="phone">
          <Input id="phone" type="tel" {...register("phone")} />
        </Field>
        <Field label="Correo electrónico" htmlFor="email" error={e.email?.message}>
          <Input id="email" type="email" {...register("email")} />
        </Field>
        <Field label="Términos de pago" htmlFor="payment_terms" hint="Ej. Crédito 30 días">
          <Input id="payment_terms" {...register("payment_terms")} />
        </Field>
        <Field label="Días de crédito" htmlFor="payment_days" error={e.payment_days?.message} hint="Se usa para sugerir el vencimiento">
          <Input id="payment_days" inputMode="numeric" {...register("payment_days")} />
        </Field>
      </div>
      <Field label="Dirección" htmlFor="address">
        <Textarea id="address" rows={2} {...register("address")} />
      </Field>
      <Field label="Notas" htmlFor="notes">
        <Textarea id="notes" rows={3} {...register("notes")} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={!!watch("active")} onCheckedChange={(v) => setValue("active", v === true)} />
        Proveedor activo
      </label>
      <div className="flex justify-end gap-2">
        {!onCreated ? (
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancelar
          </Button>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {supplier ? "Guardar cambios" : "Registrar proveedor"}
        </Button>
      </div>
    </form>
  );
}
