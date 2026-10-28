"use client";

import { Ban } from "lucide-react";

import { voidPayment } from "@/app/(app)/suppliers/actions";
import { ConfirmAction } from "@/components/common/confirm-action";
import { Button } from "@/components/ui/button";

export function VoidPaymentButton({ id }: { id: string }) {
  return (
    <ConfirmAction
      trigger={
        <Button variant="ghost" size="icon" aria-label="Anular pago">
          <Ban className="text-destructive" />
        </Button>
      }
      title="Anular pago"
      description="El pago se conserva en el historial marcado como anulado y deja de contar para el saldo."
      reasonLabel="Motivo de la anulación"
      confirmLabel="Anular pago"
      destructive
      action={(reason) => voidPayment(id, reason)}
    />
  );
}
