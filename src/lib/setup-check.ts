import "server-only";
import { createClient } from "@supabase/supabase-js";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

export type CheckState = "ok" | "error" | "warning";
export interface SetupCheck {
  key: string;
  label: string;
  state: CheckState;
  detail: string;
}

/**
 * Diagnóstico de configuración. Nunca devuelve valores de claves, sólo si existen.
 */
export async function runSetupChecks(): Promise<{ ready: boolean; checks: SetupCheck[] }> {
  const checks: SetupCheck[] = [];
  const urlOk = /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/.test(SUPABASE_URL) || /^https?:\/\//.test(SUPABASE_URL);
  checks.push({
    key: "url",
    label: "NEXT_PUBLIC_SUPABASE_URL",
    state: SUPABASE_URL && urlOk ? "ok" : "error",
    detail: !SUPABASE_URL ? "No está definida en las variables de entorno." : urlOk ? SUPABASE_URL : "No parece una URL válida (debe empezar con https://).",
  });
  checks.push({
    key: "anon",
    label: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (o NEXT_PUBLIC_SUPABASE_ANON_KEY)",
    state: SUPABASE_ANON_KEY ? "ok" : "error",
    detail: SUPABASE_ANON_KEY ? "Definida." : "No está definida.",
  });
  const service = !!(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY);
  checks.push({
    key: "service",
    label: "SUPABASE_SERVICE_ROLE_KEY",
    state: service ? "ok" : "warning",
    detail: service ? "Definida." : "Opcional: necesaria sólo para crear usuarios desde /users.",
  });
  checks.push({
    key: "ocr",
    label: "ANTHROPIC_API_KEY (OCR)",
    state: process.env.ANTHROPIC_API_KEY ? "ok" : "warning",
    detail: process.env.ANTHROPIC_API_KEY ? "Definida." : "Opcional: sin ella las facturas se capturan manualmente.",
  });

  if (SUPABASE_URL && SUPABASE_ANON_KEY && urlOk) {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
      // Como anónimo la tabla existe pero no es accesible (sin permisos): eso confirma que las migraciones están aplicadas.
      const { error } = await supabase.from("app_settings").select("id").limit(1);
      if (!error || error.code === "42501" || /permission denied/i.test(error.message)) {
        checks.push({ key: "db", label: "Base de datos y migraciones", state: "ok", detail: "Conexión correcta y esquema instalado." });
      } else if (error.code === "PGRST205" || error.code === "42P01" || /could not find the table|does not exist/i.test(error.message)) {
        checks.push({
          key: "db",
          label: "Base de datos y migraciones",
          state: "error",
          detail: "Conecta, pero faltan las tablas: ejecute las migraciones de supabase/migrations/ en orden (SQL Editor o `supabase db push`).",
        });
      } else if (/fetch failed|network|ENOTFOUND|ECONNREFUSED/i.test(error.message)) {
        checks.push({ key: "db", label: "Base de datos y migraciones", state: "error", detail: "No se pudo conectar con Supabase: revise la URL y que el proyecto no esté pausado." });
      } else if (/invalid api key|jwt|apikey/i.test(error.message)) {
        checks.push({ key: "db", label: "Base de datos y migraciones", state: "error", detail: "La clave pública no corresponde a este proyecto de Supabase." });
      } else {
        checks.push({ key: "db", label: "Base de datos y migraciones", state: "error", detail: `Respuesta inesperada: ${error.message}` });
      }
    } catch (e) {
      checks.push({
        key: "db",
        label: "Base de datos y migraciones",
        state: "error",
        detail: `No se pudo conectar con Supabase (${e instanceof Error ? e.message : "error de red"}). ¿El proyecto está pausado?`,
      });
    }
  } else {
    checks.push({ key: "db", label: "Base de datos y migraciones", state: "error", detail: "Configure primero la URL y la clave de Supabase." });
  }

  return { ready: checks.every((c) => c.state !== "error"), checks };
}
