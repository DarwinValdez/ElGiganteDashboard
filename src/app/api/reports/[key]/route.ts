import { NextResponse } from "next/server";

import { AuthError, requireAction } from "@/lib/auth";
import { dateRange } from "@/lib/list-params";
import { REPORTS, runReport, toCsv } from "@/lib/reports";

export async function GET(request: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  if (!REPORTS.some((r) => r.key === key)) return NextResponse.json({ error: "Reporte no encontrado" }, { status: 404 });
  try {
    const { supabase } = await requireAction("reports.read");
    const sp = Object.fromEntries(new URL(request.url).searchParams);
    const range = dateRange(sp, 30);
    const result = await runReport(supabase, key, { ...range, supplier: sp.supplier || null, product: sp.product || null });
    return new NextResponse(toCsv(result), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${key}_${range.from}_${range.to}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error" }, { status: 500 });
  }
}
