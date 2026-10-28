"use client";

import { Ban } from "lucide-react";

import { voidInvoice } from "@/app/(app)/invoices/actions";
import { ConfirmAction } from "@/components/common/confirm-action";
import { Button } from "@/components/ui/button";

export function VoidInvoiceButton({ id }: { id: string }) {
  return (
    <ConfirmAction
      trigger={
        <Button variant="destructive">
          <Ban /> Anular factura
        </Button>
      }
      title="Anular factura confirmada"
      description={
        <div className="space-y-2">
          <p>Se revertirán las entradas de inventario y el historial de costos de esta factura. Los registros originales se conservan marcados como anulados.</p>
          <p>Si la factura tiene pagos, anúlelos primero.</p>
        </div>
      }
      reasonLabel="Motivo de la anulación"
      confirmLabel="Anular factura"
      destructive
      action={(reason) => voidInvoice(id, reason)}
    />
  );
}
