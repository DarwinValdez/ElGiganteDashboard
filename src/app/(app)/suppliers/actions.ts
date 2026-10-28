"use server";

import { revalidatePath } from "next/cache";

import { runAction, unwrap } from "@/lib/actions";
import { requireAction } from "@/lib/auth";
import { paymentSchema, supplierSchema, type PaymentInput, type SupplierInput } from "@/lib/validations";

function toRow(v: ReturnType<typeof supplierSchema.parse>) {
  return {
    trade_name: v.trade_name,
    legal_name: v.legal_name ?? null,
    tax_id: v.tax_id ?? null,
    contact_name: v.contact_name ?? null,
    phone: v.phone ?? null,
    email: v.email ?? null,
    address: v.address ?? null,
    payment_terms: v.payment_terms ?? null,
    payment_days: v.payment_days ?? null,
    notes: v.notes ?? null,
    active: v.active,
  };
}

export async function createSupplier(input: SupplierInput) {
  return runAction(async () => {
    const { supabase, user } = await requireAction("suppliers.write");
    const v = supplierSchema.parse(input);
    const row = unwrap(await supabase.from("suppliers").insert({ ...toRow(v), created_by: user.id }).select("id, trade_name").single());
    revalidatePath("/suppliers");
    return row;
  }, "Proveedor registrado");
}

export async function updateSupplier(id: string, input: SupplierInput) {
  return runAction(async () => {
    const { supabase } = await requireAction("suppliers.write");
    const v = supplierSchema.parse(input);
    unwrap(await supabase.from("suppliers").update(toRow(v)).eq("id", id).select("id").single());
    revalidatePath("/suppliers");
    revalidatePath(`/suppliers/${id}`);
    return { id };
  }, "Proveedor actualizado");
}

export async function createPayment(input: PaymentInput) {
  return runAction(async () => {
    const { supabase, user } = await requireAction("payments.write");
    const v = paymentSchema.parse(input);
    if (v.invoice_id) {
      const { data: bal } = await supabase.from("invoice_balances").select("balance, supplier_id").eq("invoice_id", v.invoice_id).maybeSingle();
      if (!bal) throw new Error("La factura no está confirmada o no existe");
      if (bal.supplier_id !== v.supplier_id) throw new Error("La factura no pertenece a este proveedor");
      if (v.amount > Number(bal.balance) + 0.005) throw new Error(`El monto supera el saldo pendiente de la factura (${bal.balance})`);
    }
    const { data: settings } = await supabase.from("app_settings").select("currency").eq("id", 1).single();
    unwrap(
      await supabase.from("payments").insert({
        supplier_id: v.supplier_id,
        invoice_id: v.invoice_id ?? null,
        amount: v.amount,
        paid_at: v.paid_at,
        method: v.method,
        reference: v.reference ?? null,
        notes: v.notes ?? null,
        currency: settings?.currency ?? "USD",
        created_by: user.id,
      }),
    );
    revalidatePath(`/suppliers/${v.supplier_id}`);
    revalidatePath("/payments");
  }, "Pago registrado");
}

export async function voidPayment(id: string, reason: string) {
  return runAction(async () => {
    const { supabase } = await requireAction("payments.void");
    unwrap(await supabase.rpc("void_payment", { p_payment_id: id, p_reason: reason }));
    revalidatePath("/payments");
  }, "Pago anulado");
}
