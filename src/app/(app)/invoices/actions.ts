"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { runAction, unwrap } from "@/lib/actions";
import { requireAction } from "@/lib/auth";
import { matchLines, type LineMatch, type LineToMatch } from "@/lib/matching";
import type { Unit } from "@/lib/types";
import { invoiceReviewSchema, uploadRequestSchema, type InvoiceReviewInput } from "@/lib/validations";

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

/**
 * Paso 1 de la subida: valida metadatos, registra la factura y devuelve una URL
 * firmada de un solo uso para subir el archivo directamente al bucket privado.
 */
export async function requestInvoiceUpload(input: z.input<typeof uploadRequestSchema>) {
  return runAction(async () => {
    const { supabase, user } = await requireAction("invoices.write");
    const v = uploadRequestSchema.parse(input);

    const { data: sameFile } = await supabase
      .from("invoices")
      .select("id, invoice_number, status")
      .eq("file_sha256", v.file_sha256)
      .neq("status", "voided")
      .limit(1);

    const id = crypto.randomUUID();
    const now = new Date();
    const path = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${id}.${EXT[v.file_mime]}`;
    unwrap(
      await supabase.from("invoices").insert({
        id,
        status: "uploaded",
        supplier_id: v.supplier_id ?? null,
        file_path: path,
        file_name: v.file_name.replace(/[^\w.\- ()]/g, "_").slice(0, 200),
        file_mime: v.file_mime,
        file_size: v.file_size,
        file_sha256: v.file_sha256,
        uploaded_by: user.id,
      }),
    );
    const signed = unwrap(await supabase.storage.from("invoices").createSignedUploadUrl(path));
    await supabase.from("invoice_processing_logs").insert({
      invoice_id: id,
      level: sameFile?.length ? "warning" : "info",
      event: "upload_requested",
      detail: { file_name: v.file_name, size: v.file_size, duplicate_file_of: sameFile?.[0]?.id ?? null },
      created_by: user.id,
    });
    return { id, path, token: signed.token, duplicateOf: sameFile?.[0] ?? null };
  });
}

/** Registra la confirmación del cliente de que el archivo se subió correctamente. */
export async function markUploadComplete(id: string) {
  return runAction(async () => {
    const { supabase, user } = await requireAction("invoices.write");
    const { data: inv } = await supabase.from("invoices").select("file_path").eq("id", id).single();
    if (!inv?.file_path) throw new Error("Factura sin archivo");
    const folder = inv.file_path.split("/").slice(0, -1).join("/");
    const name = inv.file_path.split("/").pop();
    const { data: files } = await supabase.storage.from("invoices").list(folder, { search: name });
    if (!files?.some((f) => f.name === name)) throw new Error("El archivo no se encuentra en el almacenamiento. Vuelva a subirlo.");
    await supabase.from("invoice_processing_logs").insert({ invoice_id: id, level: "info", event: "uploaded", created_by: user.id });
  });
}

/** Factura sin archivo (captura manual completa). */
export async function createManualInvoice() {
  return runAction(async () => {
    const { supabase, user } = await requireAction("invoices.write");
    const { data: s } = await supabase.from("app_settings").select("currency").eq("id", 1).single();
    const row = unwrap(
      await supabase.from("invoices").insert({ status: "needs_review", uploaded_by: user.id, currency: s?.currency ?? "USD" }).select("id").single(),
    );
    await supabase.from("invoice_processing_logs").insert({ invoice_id: row.id, level: "info", event: "manual_entry", created_by: user.id });
    return row;
  });
}

function toRpcPayload(v: z.output<typeof invoiceReviewSchema>) {
  const { items, ...header } = v;
  return { header, items };
}

export async function saveInvoiceReview(id: string, input: InvoiceReviewInput) {
  return runAction(async () => {
    const { supabase } = await requireAction("invoices.write");
    const v = invoiceReviewSchema.parse(input);
    const { header, items } = toRpcPayload(v);
    unwrap(await supabase.rpc("save_invoice_review", { p_invoice_id: id, p_header: header, p_items: items }));
    revalidatePath(`/invoices/${id}`);
  }, "Cambios guardados");
}

export async function confirmInvoice(id: string, input: InvoiceReviewInput, exceptionNote?: string) {
  return runAction(async () => {
    const { supabase } = await requireAction("invoices.write");
    const v = invoiceReviewSchema.parse(input);
    const { header, items } = toRpcPayload(v);
    // Guarda la última versión y confirma; la RPC valida todo de nuevo en una transacción.
    unwrap(await supabase.rpc("save_invoice_review", { p_invoice_id: id, p_header: header, p_items: items }));
    const res = unwrap(await supabase.rpc("confirm_invoice", { p_invoice_id: id, p_exception_note: exceptionNote?.trim() || null }));
    revalidatePath(`/invoices/${id}`);
    revalidatePath("/invoices");
    revalidatePath("/");
    return res as { cost_rows: number; movement_rows: number };
  }, "Factura confirmada: historial de costos e inventario actualizados");
}

export async function voidInvoice(id: string, reason: string) {
  return runAction(async () => {
    const { supabase } = await requireAction("invoices.write");
    unwrap(await supabase.rpc("void_invoice", { p_invoice_id: id, p_reason: reason }));
    revalidatePath(`/invoices/${id}`);
    revalidatePath("/invoices");
  }, "Factura anulada");
}

/** Recalcula sugerencias de productos (p. ej. tras cambiar el proveedor). */
export async function suggestLineMatches(supplierId: string | null, lines: LineToMatch[]): Promise<LineMatch[]> {
  const { supabase } = await requireAction("invoices.write");
  const { data: units } = await supabase.from("units").select("*");
  return matchLines(supabase, supplierId, lines.slice(0, 200), (units ?? []) as Unit[]);
}
