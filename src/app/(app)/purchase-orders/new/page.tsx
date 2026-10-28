import { PurchaseOrderForm } from "@/app/(app)/purchase-orders/po-form";
import { PageHeader } from "@/components/common/page-header";
import { getSettings, requirePage } from "@/lib/auth";
import { getLookups } from "@/lib/data";

export const metadata = { title: "Nueva orden de compra" };

export default async function NewPoPage() {
  const { supabase, profile } = await requirePage("po.write");
  const [lookups, settings] = await Promise.all([getLookups(supabase, profile), getSettings()]);
  return (
    <>
      <PageHeader title="Nueva orden de compra" />
      <PurchaseOrderForm suppliers={lookups.suppliers} units={lookups.units} currency={settings.currency} defaultTaxRate={Number(settings.default_tax_rate)} />
    </>
  );
}
