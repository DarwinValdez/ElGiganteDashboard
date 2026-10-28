import { notFound } from "next/navigation";

import { DocumentViewer } from "@/app/(app)/invoices/[id]/document-viewer";
import { InvoiceReview, type ProductInfo } from "@/app/(app)/invoices/[id]/invoice-review";
import { InvoiceView } from "@/app/(app)/invoices/[id]/invoice-view";
import { ProcessingPanel } from "@/app/(app)/invoices/[id]/processing-panel";
import { VoidInvoiceButton } from "@/app/(app)/invoices/[id]/void-button";
import { PageHeader } from "@/components/common/page-header";
import { InvoiceStatusBadge } from "@/components/common/status-badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSettings, requirePage } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { matchLines, type MatchCandidate } from "@/lib/matching";
import { isOcrConfigured } from "@/lib/ocr";
import type { Invoice, InvoiceItem, InvoiceValidation } from "@/lib/types";

export const metadata = { title: "Factura" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requirePage("invoices.read");
  const { data: invoice } = await supabase.from("invoices").select("*").eq("id", id).maybeSingle<Invoice>();
  if (!invoice) notFound();

  const [{ data: itemsData }, { data: logs }, settings] = await Promise.all([
    supabase.from("invoice_items").select("*, products(id, name, sku, purchase_unit, inventory_unit, units_per_package)").eq("invoice_id", id).order("line_no"),
    supabase.from("invoice_processing_logs").select("id, level, event, detail, created_at").eq("invoice_id", id).order("created_at", { ascending: false }).limit(20),
    getSettings(),
  ]);
  type Row = InvoiceItem & { products: ProductInfo | null };
  const items = (itemsData ?? []) as Row[];
  const editable = ["ocr_failed", "needs_review"].includes(invoice.status);
  const waiting = invoice.status === "uploaded" || invoice.status === "processing";
  const supplierName = invoice.supplier_id
    ? (await supabase.from("suppliers").select("trade_name").eq("id", invoice.supplier_id).maybeSingle()).data?.trade_name ?? null
    : null;

  let content: React.ReactNode;
  if (waiting) {
    content = <ProcessingPanel invoiceId={id} status={invoice.status as "uploaded" | "processing"} autoStart={isOcrConfigured()} />;
  } else if (editable) {
    const [lookups, { data: validation }, { data: pos }] = await Promise.all([
      getLookups(supabase, profile),
      supabase.rpc("validate_invoice", { p_invoice_id: id }),
      supabase.from("purchase_orders").select("id, po_number, supplier_id, order_date, total").in("status", ["approved", "sent", "partially_received", "received"]).order("order_date", { ascending: false }).limit(200),
    ]);
    const { data: terms } = await supabase.from("suppliers").select("id, payment_days");
    // Sugerencias para líneas no confirmadas
    const pending = items.map((i, idx) => ({ i, idx })).filter(({ i }) => !i.match_confirmed);
    const matches = pending.length
      ? await matchLines(
          supabase,
          invoice.supplier_id,
          pending.map(({ i }) => ({ supplier_code: i.supplier_code, description: i.original_description, brand: i.brand, unit: i.unit, package_description: i.package_description })),
          lookups.units,
        )
      : [];
    const candidates: MatchCandidate[][] = items.map(() => []);
    pending.forEach(({ idx }, k) => (candidates[idx] = matches[k].candidates));
    const products: Record<string, ProductInfo> = {};
    for (const i of items) if (i.products) products[i.products.id] = { ...i.products, units_per_package: Number(i.products.units_per_package) };

    content = (
      <InvoiceReview
        invoice={invoice}
        items={items}
        products={products}
        candidates={candidates}
        validation={validation as InvoiceValidation | null}
        lookups={lookups}
        purchaseOrders={pos ?? []}
        supplierTerms={Object.fromEntries((terms ?? []).map((t) => [t.id, t.payment_days]))}
        tolerance={Number(settings.total_tolerance)}
        isAdmin={profile.role === "admin"}
        ocrConfigured={isOcrConfigured()}
      />
    );
  } else {
    const [{ data: payments }, { data: bal }, po] = await Promise.all([
      supabase.from("payments").select("id, paid_at, amount, method, voided").eq("invoice_id", id).order("paid_at"),
      supabase.from("invoice_balances").select("balance").eq("invoice_id", id).maybeSingle(),
      invoice.purchase_order_id ? supabase.from("purchase_orders").select("po_number").eq("id", invoice.purchase_order_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    content = (
      <InvoiceView
        invoice={invoice}
        items={items as unknown as (InvoiceItem & { products: { name: string; sku: string; inventory_unit: string } | null })[]}
        supplierName={supplierName}
        poNumber={po.data?.po_number ?? null}
        payments={payments ?? []}
        balance={bal ? Number(bal.balance) : null}
      />
    );
  }

  return (
    <>
      <PageHeader
        title={`Factura ${invoice.invoice_number ?? "(sin número)"}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {supplierName ?? invoice.supplier_name_raw ?? "Proveedor sin asignar"} <InvoiceStatusBadge status={invoice.status} />
            <span className="text-xs">Registrada {formatDateTime(invoice.created_at)}</span>
          </span>
        }
        actions={invoice.status === "confirmed" && profile.role === "admin" ? <VoidInvoiceButton id={id} /> : null}
      />
      <div className={invoice.file_path ? "grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]" : "grid gap-4"}>
        {invoice.file_path ? (
          <div className="lg:sticky lg:top-18 lg:h-[calc(100dvh-6rem)]">
            <DocumentViewer invoiceId={id} mime={invoice.file_mime} fileName={invoice.file_name} />
          </div>
        ) : null}
        <div className="grid min-w-0 content-start gap-4">
          {content}
          <Card className="gap-2">
            <CardHeader>
              <CardTitle className="text-sm">Registro de procesamiento</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-xs">
                {(logs ?? []).map((l) => (
                  <li key={l.id} className={l.level === "error" ? "text-destructive" : l.level === "warning" ? "text-[oklch(0.45_0.1_70)]" : "text-muted-foreground"}>
                    {formatDateTime(l.created_at)} · {l.event}
                    {l.detail && typeof l.detail === "object" && "message" in (l.detail as object) ? `: ${(l.detail as { message: string }).message}` : ""}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
