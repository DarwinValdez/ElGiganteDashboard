import { notFound, redirect } from "next/navigation";

import { ReceiveForm, type ReceiveLine } from "@/app/(app)/purchase-orders/[id]/receive/receive-form";
import { PageHeader } from "@/components/common/page-header";
import { getSettings, requirePage } from "@/lib/auth";

export const metadata = { title: "Registrar recepción" };

export default async function ReceivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requirePage("receipts.write");
  const settings = await getSettings();
  const { data: po } = await supabase
    .from("purchase_orders")
    .select("id, po_number, status, currency, suppliers(trade_name), purchase_order_items(*, products(name))")
    .eq("id", id)
    .order("line_no", { referencedTable: "purchase_order_items" })
    .maybeSingle();
  if (!po) notFound();
  if (!["approved", "sent", "partially_received"].includes(po.status)) redirect(`/purchase-orders/${id}`);
  type Item = { id: string; product_id: string; quantity: number; received_quantity: number; unit: string; units_per_package: number; unit_price: number; products: { name: string } };
  const lines: ReceiveLine[] = (po.purchase_order_items as Item[]).map((i) => {
    const pending = Math.max(Number(i.quantity) - Number(i.received_quantity), 0);
    return {
      key: i.id,
      purchase_order_item_id: i.id,
      product_id: i.product_id,
      product_name: i.products.name,
      ordered_quantity: Number(i.quantity),
      already_received: Number(i.received_quantity),
      received_quantity: String(pending),
      unit: i.unit,
      conversion_factor: Number(i.units_per_package),
      ordered_unit_price: Number(i.unit_price),
      unit_price: String(i.unit_price),
      is_extra: false,
      difference_reason: "",
    };
  });
  const supplier = (po.suppliers as unknown as { trade_name: string } | null)?.trade_name;
  return (
    <>
      <PageHeader title={`Recepción de ${po.po_number}`} description={supplier} />
      <ReceiveForm poId={id} lines={lines} currency={po.currency} inventorySource={settings.inventory_entry_source} />
    </>
  );
}
