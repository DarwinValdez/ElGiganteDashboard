"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, CheckCircle2, Download, Mail, PackageCheck, Pencil, Printer, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { setPurchaseOrderStatus, voidGoodsReceipt } from "@/app/(app)/purchase-orders/actions";
import { ConfirmAction } from "@/components/common/confirm-action";
import { Button } from "@/components/ui/button";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { PO_STATUS_LABELS } from "@/lib/labels";
import { downloadTablePdf } from "@/lib/pdf";
import type { PoStatus } from "@/lib/types";

export interface PoPdfData {
  po_number: string;
  status: PoStatus;
  order_date: string;
  expected_date: string | null;
  supplier: string;
  supplier_email: string | null;
  currency: string;
  notes: string | null;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  items: { name: string; sku: string; quantity: number; unit: string; units_per_package: number; unit_price: number; discount: number; tax_rate: number; line_total: number }[];
}

export function downloadPoPdf(po: PoPdfData) {
  downloadTablePdf({
    filename: `${po.po_number}.pdf`,
    title: `Orden de compra ${po.po_number}`,
    subtitle: PO_STATUS_LABELS[po.status],
    meta: [
      ["Proveedor", po.supplier],
      ["Fecha", formatDate(po.order_date)],
      ["Entrega esperada", formatDate(po.expected_date)],
    ],
    head: ["SKU", "Producto", "Cantidad", "Unidad", "Precio", "Desc.", "Imp. %", "Importe"],
    body: po.items.map((i) => [
      i.sku,
      i.name,
      formatNumber(i.quantity),
      `${i.unit}${i.units_per_package !== 1 ? ` (x${formatNumber(i.units_per_package)})` : ""}`,
      formatMoney(i.unit_price, po.currency),
      formatMoney(i.discount, po.currency),
      formatNumber(i.tax_rate),
      formatMoney(i.line_total, po.currency),
    ]),
    foot: [
      ["", "", "", "", "", "", "Subtotal", formatMoney(po.subtotal, po.currency)],
      ["", "", "", "", "", "", "Descuento", formatMoney(po.discount_total, po.currency)],
      ["", "", "", "", "", "", "Impuestos", formatMoney(po.tax_total, po.currency)],
      ["", "", "", "", "", "", "TOTAL", formatMoney(po.total, po.currency)],
    ],
    notes: po.notes ?? undefined,
  });
}

export function PoActions({ id, po, isAdmin }: { id: string; po: PoPdfData; isAdmin: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const change = (status: PoStatus) =>
    start(async () => {
      const res = await setPurchaseOrderStatus(id, status);
      if (res.ok) {
        toast.success(`Orden: ${PO_STATUS_LABELS[status]}`);
        router.refresh();
      } else toast.error(res.error);
    });
  const s = po.status;
  const mailto = po.supplier_email
    ? `mailto:${po.supplier_email}?subject=${encodeURIComponent(`Orden de compra ${po.po_number} - EL GIGANTE SUPERMARKET`)}&body=${encodeURIComponent(
        `Estimados ${po.supplier}:\n\nAdjuntamos la orden de compra ${po.po_number} por un total de ${formatMoney(po.total, po.currency)}.\n\n` +
          po.items.map((i) => `- ${formatNumber(i.quantity)} ${i.unit} ${i.name}`).join("\n") +
          `\n\nSaludos,\nEL GIGANTE SUPERMARKET`,
      )}`
    : null;

  return (
    <>
      {["draft", "pending_approval"].includes(s) ? (
        <Button variant="outline" asChild>
          <Link href={`/purchase-orders/${id}/edit`}>
            <Pencil /> Editar
          </Link>
        </Button>
      ) : null}
      {s === "draft" ? (
        <Button variant="outline" disabled={pending} onClick={() => change("pending_approval")}>
          <Send /> Solicitar aprobación
        </Button>
      ) : null}
      {isAdmin && ["draft", "pending_approval"].includes(s) ? (
        <Button disabled={pending} onClick={() => change("approved")}>
          <CheckCircle2 /> Aprobar
        </Button>
      ) : null}
      {s === "pending_approval" || s === "approved" ? (
        <Button variant="ghost" disabled={pending} onClick={() => change("draft")}>
          <Undo2 /> Volver a borrador
        </Button>
      ) : null}
      {s === "approved" ? (
        <Button disabled={pending} onClick={() => change("sent")}>
          <Send /> Marcar como enviada
        </Button>
      ) : null}
      {["approved", "sent", "partially_received"].includes(s) ? (
        <Button asChild>
          <Link href={`/purchase-orders/${id}/receive`}>
            <PackageCheck /> Registrar recepción
          </Link>
        </Button>
      ) : null}
      <Button variant="outline" onClick={() => downloadPoPdf(po)}>
        <Download /> PDF
      </Button>
      <Button variant="outline" asChild>
        <Link href={`/purchase-orders/${id}/print`} target="_blank">
          <Printer /> Imprimir
        </Link>
      </Button>
      {mailto ? (
        <Button variant="outline" asChild>
          <a href={mailto}>
            <Mail /> Correo
          </a>
        </Button>
      ) : null}
      {["draft", "pending_approval", "approved", "sent"].includes(s) ? (
        <ConfirmAction
          trigger={
            <Button variant="destructive">
              <Ban /> Cancelar
            </Button>
          }
          title="Cancelar orden de compra"
          reasonLabel="Motivo de la cancelación"
          confirmLabel="Cancelar orden"
          destructive
          action={(reason) => setPurchaseOrderStatus(id, "cancelled", reason)}
        />
      ) : null}
    </>
  );
}

export function VoidReceiptButton({ id, poId }: { id: string; poId: string }) {
  return (
    <ConfirmAction
      trigger={
        <Button variant="ghost" size="sm" className="text-destructive">
          Anular
        </Button>
      }
      title="Anular recepción"
      description="Se revierten los movimientos de inventario y las cantidades recibidas de la orden. El registro se conserva."
      reasonLabel="Motivo"
      destructive
      confirmLabel="Anular recepción"
      action={(reason) => voidGoodsReceipt(id, reason, poId)}
    />
  );
}
