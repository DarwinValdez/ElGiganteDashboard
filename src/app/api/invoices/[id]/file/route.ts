import { NextResponse } from "next/server";

import { AuthError, requireAction } from "@/lib/auth";

/**
 * Entrega el documento original mediante una URL firmada de 5 minutos.
 * El bucket es privado: no existen enlaces públicos permanentes.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const { supabase } = await requireAction("invoices.read");
    const { data: inv } = await supabase.from("invoices").select("file_path, file_name").eq("id", id).maybeSingle();
    if (!inv?.file_path) return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });
    const download = new URL(request.url).searchParams.has("download");
    const { data, error } = await supabase.storage
      .from("invoices")
      .createSignedUrl(inv.file_path, 300, download ? { download: inv.file_name ?? true } : undefined);
    if (error || !data) return NextResponse.json({ error: "No se pudo generar el enlace" }, { status: 500 });
    const res = NextResponse.redirect(data.signedUrl, 302);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (e) {
    return NextResponse.json({ error: e instanceof AuthError ? e.message : "No autorizado" }, { status: 401 });
  }
}
