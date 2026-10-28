"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { runAction, unwrap } from "@/lib/actions";
import { requireAction } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { newUserSchema } from "@/lib/validations";

export async function createUser(input: z.input<typeof newUserSchema>) {
  return runAction(async () => {
    const { supabase } = await requireAction("users.manage");
    const v = newUserSchema.parse(input);
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.createUser({
      email: v.email,
      password: v.password,
      email_confirm: true,
      user_metadata: { full_name: v.full_name },
      app_metadata: { role: v.role },
    });
    if (error) throw new Error(error.message.includes("already") ? "Ya existe un usuario con ese correo" : error.message);
    // El trigger crea el perfil; se asegura el rol por si el perfil ya existía.
    await supabase.from("profiles").update({ role: v.role, full_name: v.full_name }).eq("id", data.user.id);
    revalidatePath("/users");
  }, "Usuario creado");
}

export async function updateUserRole(id: string, role: "admin" | "purchasing" | "employee") {
  return runAction(async () => {
    const { supabase } = await requireAction("users.manage");
    unwrap(await supabase.from("profiles").update({ role }).eq("id", id).select("id").single());
    revalidatePath("/users");
  }, "Rol actualizado");
}

export async function setUserActive(id: string, active: boolean) {
  return runAction(async () => {
    const { supabase, user } = await requireAction("users.manage");
    if (id === user.id && !active) throw new Error("No puede desactivar su propio usuario");
    unwrap(await supabase.from("profiles").update({ active }).eq("id", id).select("id").single());
    // Bloquea también el inicio de sesión en Supabase Auth
    try {
      await createAdminClient().auth.admin.updateUserById(id, { ban_duration: active ? "none" : "876000h" });
    } catch {
      // Sin service role: el perfil inactivo ya impide el acceso (RLS + aplicación).
    }
    revalidatePath("/users");
  }, active ? "Usuario activado" : "Usuario desactivado");
}

export async function resetUserPassword(id: string, password: string) {
  return runAction(async () => {
    await requireAction("users.manage");
    if (password.length < 8) throw new Error("Mínimo 8 caracteres");
    const { error } = await createAdminClient().auth.admin.updateUserById(id, { password });
    if (error) throw new Error(error.message);
  }, "Contraseña actualizada");
}
