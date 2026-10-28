"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { runAction, unwrap } from "@/lib/actions";
import { requireAction } from "@/lib/auth";
import { categorySchema, settingsSchema, unitSchema, type SettingsInput } from "@/lib/validations";

export async function saveSettings(input: SettingsInput) {
  return runAction(async () => {
    const { supabase, user } = await requireAction("settings.manage");
    const v = settingsSchema.parse(input);
    unwrap(await supabase.from("app_settings").update({ ...v, updated_by: user.id }).eq("id", 1).select("id").single());
    revalidatePath("/", "layout");
  }, "Configuración guardada");
}

export async function createUnit(input: z.input<typeof unitSchema>) {
  return runAction(async () => {
    const { supabase } = await requireAction("settings.manage");
    const v = unitSchema.parse(input);
    unwrap(await supabase.from("units").insert({ ...v, base_factor: v.base_factor ?? null }));
    revalidatePath("/settings");
  }, "Unidad creada");
}

export async function toggleUnit(code: string, active: boolean) {
  return runAction(async () => {
    const { supabase } = await requireAction("settings.manage");
    unwrap(await supabase.from("units").update({ active }).eq("code", code).select("code").single());
    revalidatePath("/settings");
  }, "Unidad actualizada");
}

export async function saveCategory(id: string | null, name: string, active = true) {
  return runAction(async () => {
    const { supabase } = await requireAction("products.write");
    const v = categorySchema.parse({ name });
    if (id) unwrap(await supabase.from("categories").update({ name: v.name, active }).eq("id", id).select("id").single());
    else unwrap(await supabase.from("categories").insert({ name: v.name }));
    revalidatePath("/settings");
  }, "Categoría guardada");
}
