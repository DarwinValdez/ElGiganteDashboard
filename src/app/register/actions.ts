"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const registerSchema = z
  .object({
    full_name: z.string().trim().min(2, "Escriba su nombre").max(120),
    email: z.email("Correo inválido"),
    password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres").max(72),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Las contraseñas no coinciden", path: ["confirm"] });

export type RegisterState = { error?: string; done?: "confirm_email" | "pending" } | undefined;

export async function register(_prev: RegisterState, formData: FormData): Promise<RegisterState> {
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const v = parsed.data;

  const h = await headers();
  const origin = h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;

  let supabase;
  let result;
  try {
    supabase = await createClient();
    result = await supabase.auth.signUp({
      email: v.email,
      password: v.password,
      options: { data: { full_name: v.full_name }, emailRedirectTo: `${origin}/auth/confirm` },
    });
  } catch (e) {
    console.error("[register]", e);
    return { error: "No se pudo conectar con Supabase. Revise la configuración en /setup." };
  }
  const { data, error } = result;
  if (error) {
    if (/already registered|already exists/i.test(error.message)) return { error: "Ya existe una cuenta con ese correo. Inicie sesión." };
    if (/signups not allowed|signup is disabled/i.test(error.message)) {
      return { error: "El registro está desactivado. Pida a un administrador que le cree la cuenta." };
    }
    if (/password/i.test(error.message)) return { error: "La contraseña no cumple los requisitos de seguridad." };
    console.error("[register]", error.status, error.message);
    return { error: "No se pudo crear la cuenta. Intente de nuevo." };
  }

  // Sin sesión: Supabase exige confirmar el correo primero.
  if (!data.session) return { done: "confirm_email" };

  const { data: profile } = await supabase.from("profiles").select("active").eq("id", data.user!.id).maybeSingle();
  if (profile?.active) redirect("/");
  await supabase.auth.signOut();
  return { done: "pending" };
}
