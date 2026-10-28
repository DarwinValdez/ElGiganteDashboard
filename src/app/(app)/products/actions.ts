"use server";

import { revalidatePath } from "next/cache";

import { runAction, unwrap } from "@/lib/actions";
import { requireAction } from "@/lib/auth";
import { categorySchema, productSchema, type ProductInput } from "@/lib/validations";

function toRow(v: ReturnType<typeof productSchema.parse>) {
  return {
    name: v.name,
    barcode: v.barcode ?? null,
    category_id: v.category_id ?? null,
    brand: v.brand ?? null,
    purchase_unit: v.purchase_unit,
    inventory_unit: v.inventory_unit,
    units_per_package: v.units_per_package,
    size_value: v.size_value ?? null,
    size_unit: v.size_unit ?? null,
    default_supplier_id: v.default_supplier_id ?? null,
    sale_price: v.sale_price ?? null,
    min_stock: v.min_stock,
    active: v.active,
    notes: v.notes ?? null,
  };
}

export async function createProduct(input: ProductInput) {
  return runAction(async () => {
    const { supabase, user } = await requireAction("products.write");
    const v = productSchema.parse(input);
    const row = { ...toRow(v), created_by: user.id, ...(v.sku ? { sku: v.sku.toUpperCase() } : {}) };
    const created = unwrap(await supabase.from("products").insert(row).select("id, name, sku, purchase_unit, inventory_unit, units_per_package").single());
    revalidatePath("/products");
    return created;
  }, "Producto creado");
}

export async function updateProduct(id: string, input: ProductInput) {
  return runAction(async () => {
    const { supabase } = await requireAction("products.write");
    const v = productSchema.parse(input);
    const row = { ...toRow(v), ...(v.sku ? { sku: v.sku.toUpperCase() } : {}) };
    unwrap(await supabase.from("products").update(row).eq("id", id).select("id").single());
    revalidatePath("/products");
    revalidatePath(`/products/${id}`);
    return { id };
  }, "Producto actualizado");
}

export async function setProductActive(id: string, active: boolean) {
  return runAction(async () => {
    const { supabase } = await requireAction("products.write");
    unwrap(await supabase.from("products").update({ active }).eq("id", id).select("id").single());
    revalidatePath(`/products/${id}`);
  }, active ? "Producto activado" : "Producto desactivado");
}

export async function createCategory(name: string) {
  return runAction(async () => {
    const { supabase } = await requireAction("products.write");
    const v = categorySchema.parse({ name });
    return unwrap(await supabase.from("categories").insert(v).select("id, name").single());
  }, "Categoría creada");
}

export async function deleteSupplierCode(id: string, productId: string) {
  return runAction(async () => {
    const { supabase } = await requireAction("products.write");
    unwrap(await supabase.from("product_supplier_codes").delete().eq("id", id));
    revalidatePath(`/products/${productId}`);
  }, "Código eliminado");
}

export async function deleteAlias(id: string, productId: string) {
  return runAction(async () => {
    const { supabase } = await requireAction("products.write");
    unwrap(await supabase.from("product_aliases").delete().eq("id", id));
    revalidatePath(`/products/${productId}`);
  }, "Asociación eliminada");
}
