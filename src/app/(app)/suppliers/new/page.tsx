import { SupplierForm } from "@/app/(app)/suppliers/supplier-form";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requirePage } from "@/lib/auth";

export const metadata = { title: "Nuevo proveedor" };

export default async function NewSupplierPage() {
  await requirePage("suppliers.write");
  return (
    <>
      <PageHeader title="Nuevo proveedor" />
      <Card>
        <CardContent>
          <SupplierForm />
        </CardContent>
      </Card>
    </>
  );
}
