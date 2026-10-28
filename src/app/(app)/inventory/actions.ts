"use server";

import { revalidatePath } from "next/cache";

import { runAction, unwrap } from "@/lib/actions";
import { requireAction } from "@/lib/auth";
import { movementSchema, type MovementInput } from "@/lib/validations";

export async function recordMovement(input: MovementInput) {
  return runAction(async () => {
    const { supabase } = await requireAction("inventory.basic");
    const v = movementSchema.parse(input);
    // La función valida el rol, el signo, el motivo y las existencias.
    unwrap(
      await supabase.rpc("record_inventory_movement", {
        p_product_id: v.product_id,
        p_type: v.movement_type,
        p_quantity: v.quantity,
        p_reason: v.reason ?? null,
      }),
    );
    revalidatePath("/inventory");
    revalidatePath(`/products/${v.product_id}`);
  }, "Movimiento registrado");
}
