import { notFound } from "next/navigation";

import { ProductForm } from "@/app/(app)/products/product-form";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requirePage } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import type { Product } from "@/lib/types";

export const metadata = { title: "Editar producto" };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requirePage("products.write");
  const { data: product } = await supabase.from("products").select("*").eq("id", id).maybeSingle<Product>();
  if (!product) notFound();
  const lookups = await getLookups(supabase, profile);
  return (
    <>
      <PageHeader title="Editar producto" description={`${product.sku} · ${product.name}`} />
      <Card>
        <CardContent>
          <ProductForm lookups={lookups} product={product} />
        </CardContent>
      </Card>
    </>
  );
}
