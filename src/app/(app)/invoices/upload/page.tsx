import { UploadForm } from "@/app/(app)/invoices/upload/upload-form";
import { PageHeader } from "@/components/common/page-header";
import { requirePage } from "@/lib/auth";
import { isOcrConfigured } from "@/lib/ocr";

export const metadata = { title: "Subir factura" };

export default async function UploadInvoicePage() {
  const { supabase } = await requirePage("invoices.write");
  const { data: suppliers } = await supabase.from("suppliers").select("id, trade_name").eq("active", true).order("trade_name");
  return (
    <>
      <PageHeader title="Subir factura" description="Fotografíe la factura o seleccione una imagen/PDF. El original se guarda en almacenamiento privado." />
      <UploadForm suppliers={suppliers ?? []} ocrConfigured={isOcrConfigured()} />
    </>
  );
}
