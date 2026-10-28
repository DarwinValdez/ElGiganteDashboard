import "server-only";

import { AuthError } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import type { ActionResult } from "@/lib/types";
import { ZodError } from "zod";

/** Envuelve una Server Action para devolver siempre un resultado serializable. */
export async function runAction<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message };
  } catch (err) {
    if (err instanceof AuthError) return { ok: false, error: err.message };
    if (err instanceof ZodError) {
      return { ok: false, error: err.issues.map((i) => `${i.path.join(".") || "dato"}: ${i.message}`).join("; ") };
    }
    // Errores de redirección de Next deben propagarse
    if (err && typeof err === "object" && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_")) {
      throw err;
    }
    console.error("[action]", err);
    return { ok: false, error: errorMessage(err) };
  }
}

/** Lanza el error de Supabase si existe; devuelve los datos en caso contrario. */
export function unwrap<T>(res: { data: T; error: unknown }): NonNullable<T> {
  if (res.error) throw res.error;
  return res.data as NonNullable<T>;
}
