import { NextResponse } from "next/server";

import { runSetupChecks } from "@/lib/setup-check";

export const dynamic = "force-dynamic";

/** Estado de configuración (sin exponer valores secretos). */
export async function GET() {
  const { ready, checks } = await runSetupChecks();
  return NextResponse.json(
    { ready, checks: checks.map(({ key, state, detail }) => ({ key, state, detail: key === "url" && state === "ok" ? "Definida." : detail })) },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
