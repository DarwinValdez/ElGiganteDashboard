"use server";

import { revalidatePath } from "next/cache";

import { runAction, unwrap } from "@/lib/actions";
import { requireAction } from "@/lib/auth";
import type { PoStatus } from "@/lib/types";
import { purchaseOrderSchema, receiptSchema, type PurchaseOrderInput, type ReceiptInput } from "@/lib/validations";

export async function savePurchaseOrder(input: PurchaseOrderInput) {
  return runAction(async () => {
    const { supabase } = await requireAction("po.write");
    const v = purchaseOrderSchema.parse(input);
    const { items, ...order } = v;
    const id = unwrap(
      await supabase.rpc("save_purchase_order", {
        p_order: { ...order, id: order.id ?? null },
        p_items: items,
      }),
    ) as string;
    revalidatePath("/purchase-orders");
    revalidatePath(`/purchase-orders/${id}`);
    return { id };
  }, "Orden guardada");
}

export async function setPurchaseOrderStatus(id: string, status: PoStatus, reason?: string) {
  return runAction(async () => {
    const { supabase } = await requireAction("po.write");
    unwrap(await supabase.rpc("set_purchase_order_status", { p_id: id, p_status: status, p_reason: reason ?? null }));
    revalidatePath(`/purchase-orders/${id}`);
    revalidatePath("/purchase-orders");
  }, "Estado actualizado");
}

export async function createGoodsReceipt(input: ReceiptInput) {
  return runAction(async () => {
    const { supabase } = await requireAction("receipts.write");
    const v = receiptSchema.parse(input);
    if (!v.purchase_order_id && !v.supplier_id) throw new Error("Indique la orden o el proveedor");
    const { items, ...receipt } = v;
    const id = unwrap(await supabase.rpc("create_goods_receipt", { p_receipt: receipt, p_items: items, p_confirm: true })) as string;
    if (v.purchase_order_id) revalidatePath(`/purchase-orders/${v.purchase_order_id}`);
    revalidatePath("/inventory");
    return { id };
  }, "Recepción registrada");
}

export async function voidGoodsReceipt(id: string, reason: string, poId?: string) {
  return runAction(async () => {
    const { supabase } = await requireAction("receipts.void");
    unwrap(await supabase.rpc("void_goods_receipt", { p_receipt_id: id, p_reason: reason }));
    if (poId) revalidatePath(`/purchase-orders/${poId}`);
  }, "Recepción anulada");
}
