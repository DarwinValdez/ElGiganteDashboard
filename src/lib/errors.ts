/** Convierte errores de Supabase/Postgres en mensajes claros en español. */
export function errorMessage(err: unknown): string {
  if (!err) return "Error desconocido";
  const e = err as { message?: string; code?: string; details?: string; hint?: string };
  const msg = e.message ?? String(err);
  switch (e.code) {
    case "23505":
      if (msg.includes("invoices_supplier_number_uq")) return "Ya existe una factura confirmada con ese proveedor y número.";
      if (msg.includes("products_sku_uq")) return "Ya existe un producto con ese SKU.";
      if (msg.includes("products_barcode_uq")) return "Ya existe un producto con ese código de barras.";
      if (msg.includes("suppliers_tax_id_uq")) return "Ya existe un proveedor con esa identificación fiscal.";
      if (msg.includes("categories_name_uq")) return "Ya existe una categoría con ese nombre.";
      return "Registro duplicado: ya existe un registro con esos datos.";
    case "23503":
      return "El registro está relacionado con otros datos y no puede modificarse así.";
    case "42501":
      return msg.includes("row-level security") ? "No tiene permiso para realizar esta operación." : msg;
    case "PGRST116":
      return "Registro no encontrado o sin permiso de acceso.";
  }
  return msg;
}
