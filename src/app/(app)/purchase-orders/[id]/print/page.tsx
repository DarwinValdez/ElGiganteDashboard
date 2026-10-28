import { notFound } from "next/navigation";

import { PrintButton } from "@/components/common/print-button";
import { requirePage } from "@/lib/auth";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { PO_STATUS_LABELS } from "@/lib/labels";
import type { PoStatus } from "@/lib/types";

export const metadata = { title: "Imprimir orden" };

export default async function PrintPoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requirePage("po.read");
  const { data: po } = await supabase
    .from("purchase_orders")
    .select("*, suppliers(*), purchase_order_items(*, products(name, sku))")
    .eq("id", id)
    .order("line_no", { referencedTable: "purchase_order_items" })
    .maybeSingle();
  if (!po) notFound();
  type Item = { id: string; line_no: number; quantity: number; unit: string; units_per_package: number; unit_price: number; discount: number; tax_rate: number; line_total: number; products: { name: string; sku: string } };
  const cur = po.currency;
  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-sm text-black">
      <div className="no-print mb-4 flex justify-end">
        <PrintButton />
      </div>
      <div className="flex items-start justify-between border-b-4 border-[#14532d] pb-4">
        <div>
          <div className="text-2xl font-black text-[#14532d]">EL GIGANTE SUPERMARKET</div>
          <div className="text-xs text-gray-600">Orden de compra</div>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold">{po.po_number}</div>
          <div>{PO_STATUS_LABELS[po.status as PoStatus]}</div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs font-semibold uppercase text-gray-500">Proveedor</div>
          <div className="font-semibold">{po.suppliers?.trade_name}</div>
          <div>{po.suppliers?.legal_name}</div>
          <div>{po.suppliers?.tax_id}</div>
          <div>{po.suppliers?.address}</div>
          <div>{[po.suppliers?.phone, po.suppliers?.email].filter(Boolean).join(" · ")}</div>
        </div>
        <div className="text-right">
          <div>Fecha: {formatDate(po.order_date)}</div>
          <div>Entrega esperada: {formatDate(po.expected_date)}</div>
          <div>Términos: {po.suppliers?.payment_terms ?? "—"}</div>
        </div>
      </div>
      <table className="mt-6 w-full border-collapse text-xs">
        <thead>
          <tr className="bg-[#14532d] text-white">
            <th className="p-2 text-left">SKU</th>
            <th className="p-2 text-left">Producto</th>
            <th className="p-2 text-right">Cant.</th>
            <th className="p-2 text-left">Unidad</th>
            <th className="p-2 text-right">Precio</th>
            <th className="p-2 text-right">Importe</th>
          </tr>
        </thead>
        <tbody>
          {(po.purchase_order_items as Item[]).map((i) => (
            <tr key={i.id} className="border-b">
              <td className="p-2 font-mono">{i.products.sku}</td>
              <td className="p-2">{i.products.name}</td>
              <td className="p-2 text-right">{formatNumber(i.quantity)}</td>
              <td className="p-2">
                {i.unit}
                {Number(i.units_per_package) !== 1 ? ` ×${formatNumber(i.units_per_package)}` : ""}
              </td>
              <td className="p-2 text-right">{formatMoney(i.unit_price, cur)}</td>
              <td className="p-2 text-right">{formatMoney(i.line_total, cur)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 ml-auto w-64 space-y-1">
        <div className="flex justify-between"><span>Subtotal</span><span>{formatMoney(po.subtotal, cur)}</span></div>
        <div className="flex justify-between"><span>Descuento</span><span>−{formatMoney(po.discount_total, cur)}</span></div>
        <div className="flex justify-between"><span>Impuestos</span><span>{formatMoney(po.tax_total, cur)}</span></div>
        <div className="flex justify-between border-t pt-1 text-base font-bold"><span>Total</span><span>{formatMoney(po.total, cur)}</span></div>
      </div>
      {po.notes ? <p className="mt-6 text-xs"><strong>Notas:</strong> {po.notes}</p> : null}
      <div className="mt-16 grid grid-cols-2 gap-12 text-center text-xs">
        <div className="border-t pt-1">Autorizado por</div>
        <div className="border-t pt-1">Recibido por el proveedor</div>
      </div>
    </div>
  );
}
