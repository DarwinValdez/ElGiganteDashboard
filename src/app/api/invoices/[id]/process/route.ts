import { NextResponse } from "next/server";

import { AuthError, requireAction } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { detectMime, prepareImageForOcr, sha256 } from "@/lib/files";
import { matchLines, suggestSupplier } from "@/lib/matching";
import { getOcrProvider } from "@/lib/ocr";
import { OcrNotConfiguredError } from "@/lib/ocr/provider";
import type { Unit } from "@/lib/types";
import { MAX_INVOICE_BYTES } from "@/lib/validations";

// El OCR puede tardar: se ejecuta en el servidor sin bloquear la interfaz.
export const maxDuration = 120;

const STALE_MS = 3 * 60 * 1000;
const isDate = (s: string | null | undefined) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const clamp01 = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null);
const money = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) / 100 : null);

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let auth;
  try {
    auth = await requireAction("invoices.write");
  } catch (e) {
    return NextResponse.json({ error: e instanceof AuthError ? e.message : "No autorizado" }, { status: 401 });
  }
  const { supabase, user } = auth;
  const body = (await request.json().catch(() => ({}))) as { force?: boolean };

  const { data: inv } = await supabase.from("invoices").select("*").eq("id", id).maybeSingle();
  if (!inv) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  if (!inv.file_path) return NextResponse.json({ error: "La factura no tiene archivo para procesar" }, { status: 400 });

  const allowed = ["uploaded", "ocr_failed", ...(body.force ? ["needs_review"] : [])];
  const stale = inv.status === "processing" && Date.now() - new Date(inv.updated_at).getTime() > STALE_MS;
  if (!allowed.includes(inv.status) && !stale) {
    return NextResponse.json({ error: `La factura está en estado "${inv.status}" y no puede procesarse ahora` }, { status: 409 });
  }

  // Bloqueo optimista: sólo una petición pasa a "processing".
  const { data: locked } = await supabase
    .from("invoices")
    .update({ status: "processing", ocr_attempts: (inv.ocr_attempts ?? 0) + 1, ocr_error: null })
    .eq("id", id)
    .eq("status", inv.status)
    .select("id")
    .maybeSingle();
  if (!locked) return NextResponse.json({ error: "La factura ya se está procesando" }, { status: 409 });

  const log = (level: "info" | "warning" | "error", event: string, detail?: unknown) =>
    supabase.from("invoice_processing_logs").insert({ invoice_id: id, level, event, detail: detail ?? null, created_by: user.id });
  const fail = async (message: string, status = 422, detail?: unknown) => {
    await supabase.from("invoices").update({ status: "ocr_failed", ocr_error: message }).eq("id", id);
    await log("error", "ocr_failed", { message, ...(detail ? { detail } : {}) });
    return NextResponse.json({ error: message }, { status });
  };

  try {
    await log("info", "ocr_started", { attempt: (inv.ocr_attempts ?? 0) + 1 });

    const { data: blob, error: dlErr } = await supabase.storage.from("invoices").download(inv.file_path);
    if (dlErr || !blob) return await fail("No se pudo leer el archivo almacenado. Vuelva a subirlo.", 500, errorMessage(dlErr));
    const buf = Buffer.from(await blob.arrayBuffer());
    if (buf.length > MAX_INVOICE_BYTES) return await fail("El archivo supera el tamaño máximo permitido (15 MB).");
    const realMime = detectMime(buf);
    if (!realMime) return await fail("El archivo no es una imagen JPG/PNG/WEBP ni un PDF válido.");
    if (realMime !== inv.file_mime) await log("warning", "mime_mismatch", { declared: inv.file_mime, detected: realMime });
    const hash = sha256(buf);
    if (inv.file_sha256 && hash !== inv.file_sha256) await log("warning", "hash_mismatch", { declared: inv.file_sha256, actual: hash });
    await supabase.from("invoices").update({ file_sha256: hash, file_mime: realMime, file_size: buf.length }).eq("id", id);

    let provider;
    try {
      provider = getOcrProvider();
    } catch (e) {
      if (e instanceof OcrNotConfiguredError) return await fail(e.message, 503);
      throw e;
    }

    const [{ data: units }, { data: hintSupplier }] = await Promise.all([
      supabase.from("units").select("*").eq("active", true),
      inv.supplier_id ? supabase.from("suppliers").select("trade_name").eq("id", inv.supplier_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const unitList = (units ?? []) as Unit[];
    const prepared = await prepareImageForOcr(buf, realMime);
    const started = Date.now();
    const result = await provider.extract({ bytes: prepared.bytes, mime: prepared.mime, unitCodes: unitList, supplierHint: hintSupplier?.trade_name });
    const d = result.data;
    await log("info", "ocr_completed", { provider: result.provider, model: result.model, ms: Date.now() - started, lines: d.line_items.length, usage: result.usage });

    // Advertencias: las del modelo + validaciones propias
    const warnings: { field: string; message: string }[] = [...d.warnings];
    if (!d.is_invoice) warnings.unshift({ field: "documento", message: `El documento no parece una factura (${d.document_type}). Verifique antes de continuar.` });
    const lowConf: [string, number][] = [
      ["proveedor", d.confidence_supplier],
      ["número de factura", d.confidence_invoice_number],
      ["fechas", d.confidence_dates],
      ["totales", d.confidence_totals],
    ];
    for (const [f, c] of lowConf) if (c < 0.75) warnings.push({ field: f, message: `Lectura dudosa (confianza ${(c * 100).toFixed(0)} %): verifique ${f}.` });
    if (d.issue_date && !isDate(d.issue_date)) warnings.push({ field: "fecha", message: `Fecha de emisión ilegible: "${d.issue_date}"` });

    // Proveedor: el seleccionado por el usuario manda; si no, sugerencia de la IA
    let supplierId: string | null = inv.supplier_id;
    if (!supplierId) {
      const s = await suggestSupplier(supabase, d.supplier_name, d.supplier_tax_id);
      if (s) {
        supplierId = s.id;
        warnings.push({
          field: "proveedor",
          message: `Proveedor sugerido automáticamente: ${s.trade_name} (${s.by === "tax_id" ? "por identificación fiscal" : `similitud ${(s.score * 100).toFixed(0)} %`}). Confírmelo.`,
        });
      } else if (d.supplier_name) {
        warnings.push({ field: "proveedor", message: `"${d.supplier_name}" no está registrado. Regístrelo o selecciónelo.` });
      }
    }

    // Orden de compra por número impreso
    let poId: string | null = inv.purchase_order_id;
    if (!poId && d.purchase_order_number) {
      const digits = d.purchase_order_number.replace(/\D/g, "");
      if (digits) {
        const { data: po } = await supabase.from("purchase_orders").select("id, supplier_id").ilike("po_number", `%${digits.slice(-6)}`).limit(1).maybeSingle();
        if (po && (!supplierId || po.supplier_id === supplierId)) poId = po.id;
      }
    }

    const unitCodes = new Set(unitList.map((u) => u.code));
    const lines = d.line_items.filter((l) => l.description?.trim());
    const matches = await matchLines(
      supabase,
      supplierId,
      lines.map((l) => ({
        supplier_code: l.supplier_code,
        description: l.description,
        generic_description: l.generic_description_es,
        brand: l.brand,
        unit: l.unit_code && unitCodes.has(l.unit_code) ? l.unit_code : null,
        package_description: l.package_description,
        units_per_package: l.units_per_package,
      })),
      unitList,
    );

    const items = lines.map((l, i) => {
      const m = matches[i];
      const notes: string[] = [];
      if (l.confidence < 0.75) notes.push(`Lectura dudosa (${(l.confidence * 100).toFixed(0)} %)`);
      if (l.quantity === null) notes.push("Cantidad no legible");
      if (l.unit_price === null) notes.push("Precio no legible");
      if (l.line_total === null) notes.push("Importe no legible");
      if (m.conversion_reason && !m.confirmed && m.product_id) notes.push(m.conversion_reason);
      return {
        supplier_code: l.supplier_code,
        original_description: l.description.trim(),
        product_id: m.product_id,
        match_method: m.method,
        match_score: m.score,
        match_confirmed: m.confirmed,
        brand: l.brand,
        quantity: l.quantity ?? 0,
        unit: l.unit_code && unitCodes.has(l.unit_code) ? l.unit_code : null,
        unit_raw: l.unit_raw,
        package_description: l.package_description,
        conversion_factor: m.conversion_factor > 0 ? m.conversion_factor : 1,
        unit_price: l.unit_price ?? 0,
        discount: Math.abs(money(l.discount) ?? 0),
        tax: Math.abs(money(l.tax) ?? 0),
        line_total: money(l.line_total) ?? 0,
        ocr_confidence: clamp01(l.confidence),
        review_note: notes.join(". ") || null,
      };
    });

    const header = {
      supplier_id: supplierId,
      supplier_name_raw: d.supplier_name,
      invoice_number: d.invoice_number,
      issue_date: isDate(d.issue_date) ? d.issue_date : null,
      due_date: isDate(d.due_date) ? d.due_date : null,
      po_number_raw: d.purchase_order_number,
      purchase_order_id: poId,
      currency: d.currency && /^[A-Z]{3}$/.test(d.currency) ? d.currency : inv.currency,
      subtotal: money(d.subtotal),
      discount_total: Math.abs(money(d.discount_total) ?? 0),
      tax_total: Math.abs(money(d.tax_total) ?? 0),
      freight_total: Math.abs(money(d.freight_total) ?? 0),
      other_charges: Math.abs(money(d.other_charges) ?? 0),
      total: money(d.total),
      payment_terms: d.payment_terms,
      notes: inv.notes,
    };

    const { error: saveErr } = await supabase.rpc("save_invoice_review", { p_invoice_id: id, p_header: header, p_items: items });
    if (saveErr) return await fail(`No se pudieron guardar los datos extraídos: ${errorMessage(saveErr)}`, 500);

    await supabase
      .from("invoices")
      .update({
        ocr_provider: result.provider,
        ocr_model: result.model,
        ocr_raw: d,
        ocr_confidence: clamp01(d.confidence_overall),
        ocr_processed_at: new Date().toISOString(),
        warnings,
      })
      .eq("id", id);

    return NextResponse.json({ ok: true, lines: items.length, warnings: warnings.length });
  } catch (e) {
    console.error("[ocr]", e);
    return await fail(`Error al procesar la factura: ${errorMessage(e)}. Puede reintentar o capturar los datos manualmente.`, 500);
  }
}
