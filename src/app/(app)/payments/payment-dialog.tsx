"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";

import { createPayment } from "@/app/(app)/suppliers/actions";
import { Field } from "@/components/common/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatMoney } from "@/lib/format";
import { PAYMENT_METHODS } from "@/lib/labels";
import { paymentSchema, type PaymentInput } from "@/lib/validations";

export interface OpenInvoice {
  invoice_id: string;
  supplier_id: string;
  invoice_number: string;
  balance: number;
  due_date: string | null;
}

export function PaymentDialog({
  suppliers,
  openInvoices,
  supplierId,
  currency,
}: {
  suppliers: { id: string; trade_name: string }[];
  openInvoices: OpenInvoice[];
  supplierId?: string;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const { register, handleSubmit, watch, setValue, formState, reset } = useForm<PaymentInput, unknown, z.output<typeof paymentSchema>>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      supplier_id: supplierId ?? "",
      invoice_id: "",
      amount: "",
      paid_at: new Date().toISOString().slice(0, 10),
      method: "transferencia",
      reference: "",
      notes: "",
    },
  });
  const sid = watch("supplier_id") as string;
  const invoices = openInvoices.filter((i) => i.supplier_id === sid);
  const e = formState.errors;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Registrar pago
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar pago a proveedor</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={handleSubmit((v) =>
            start(async () => {
              const res = await createPayment(v);
              if (!res.ok) return void toast.error(res.error);
              toast.success(res.message);
              reset();
              setOpen(false);
              router.refresh();
            }),
          )}
        >
          <Field label="Proveedor" error={e.supplier_id?.message} required>
            <NativeSelect {...register("supplier_id")} disabled={!!supplierId}>
              <option value="">Seleccione…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.trade_name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Factura (opcional)" hint="Si no se indica, el pago se aplica a cuenta del proveedor">
            <NativeSelect
              {...register("invoice_id", {
                onChange: (ev) => {
                  const inv = invoices.find((i) => i.invoice_id === ev.target.value);
                  if (inv) setValue("amount", String(inv.balance));
                },
              })}
            >
              <option value="">A cuenta</option>
              {invoices.map((i) => (
                <option key={i.invoice_id} value={i.invoice_id}>
                  {i.invoice_number} — saldo {formatMoney(i.balance, currency)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Monto" error={e.amount?.message} required>
              <Input inputMode="decimal" {...register("amount")} />
            </Field>
            <Field label="Fecha" error={e.paid_at?.message} required>
              <Input type="date" {...register("paid_at")} />
            </Field>
            <Field label="Método">
              <NativeSelect {...register("method")}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Referencia">
              <Input {...register("reference")} />
            </Field>
          </div>
          <Field label="Notas">
            <Input {...register("notes")} />
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Guardar pago
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
