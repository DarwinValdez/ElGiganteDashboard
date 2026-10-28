import { ProductForm } from "@/app/(app)/products/product-form";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requirePage } from "@/lib/auth";
import { getLookups } from "@/lib/data";

export const metadata = { title: "Nuevo producto" };

export default async function NewProductPage() {
  const { supabase, profile } = await requirePage("products.write");
  const lookups = await getLookups(supabase, profile);
  return (
    <>
      <PageHeader title="Nuevo producto" />
      <Card>
        <CardContent>
          <ProductForm lookups={lookups} />
        </CardContent>
      </Card>
    </>
  );
}
