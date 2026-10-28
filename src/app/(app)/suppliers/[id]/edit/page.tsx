import { notFound } from "next/navigation";

import { SupplierForm } from "@/app/(app)/suppliers/supplier-form";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requirePage } from "@/lib/auth";
import type { Supplier } from "@/lib/types";

export const metadata = { title: "Editar proveedor" };

export default async function EditSupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requirePage("suppliers.write");
  const { data } = await supabase.from("suppliers").select("*").eq("id", id).maybeSingle<Supplier>();
  if (!data) notFound();
  return (
    <>
      <PageHeader title="Editar proveedor" description={data.trade_name} />
      <Card>
        <CardContent>
          <SupplierForm supplier={data} />
        </CardContent>
      </Card>
    </>
  );
}
