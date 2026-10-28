import { notFound, redirect } from "next/navigation";

import { PurchaseOrderForm } from "@/app/(app)/purchase-orders/po-form";
import { PageHeader } from "@/components/common/page-header";
import { getSettings, requirePage } from "@/lib/auth";
import { getLookups } from "@/lib/data";

export const metadata = { title: "Editar orden de compra" };

export default async function EditPoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requirePage("po.write");
  const { data: po } = await supabase
    .from("purchase_orders")
    .select("*, purchase_order_items(*, products(name, sku))")
    .eq("id", id)
    .order("line_no", { referencedTable: "purchase_order_items" })
    .maybeSingle();
  if (!po) notFound();
  if (!["draft", "pending_approval"].includes(po.status)) redirect(`/purchase-orders/${id}`);
  const [lookups, settings] = await Promise.all([getLookups(supabase, profile), getSettings()]);
  type Item = { product_id: string; description: string | null; quantity: number; unit: string; units_per_package: number; unit_price: number; discount: number; tax_rate: number; products: { name: string; sku: string } };
  const items = po.purchase_order_items as Item[];
  return (
    <>
      <PageHeader title={`Editar ${po.po_number}`} />
      <PurchaseOrderForm
        suppliers={lookups.suppliers}
        units={lookups.units}
        currency={settings.currency}
        defaultTaxRate={Number(settings.default_tax_rate)}
        productNames={Object.fromEntries(items.map((i) => [i.product_id, i.products]))}
        initial={{
          id: po.id,
          supplier_id: po.supplier_id,
          order_date: po.order_date,
          expected_date: po.expected_date ?? "",
          currency: po.currency,
          notes: po.notes ?? "",
          discount_total: po.discount_total,
          items: items.map((i) => ({
            product_id: i.product_id,
            description: i.description ?? "",
            quantity: i.quantity,
            unit: i.unit,
            units_per_package: i.units_per_package,
            unit_price: i.unit_price,
            discount: i.discount,
            tax_rate: i.tax_rate,
          })),
        }}
      />
    </>
  );
}
