-- =====================================================================
-- Migración 5: Row Level Security y privilegios.
-- Roles de la aplicación:
--   admin       → acceso completo
--   purchasing  → compras, facturas, proveedores, precios, recepciones
--   employee    → consulta de productos e inventario, movimientos autorizados
-- Las operaciones críticas sólo se ejecutan mediante funciones RPC que
-- validan el rol; las tablas derivadas (historial, movimientos, auditoría)
-- no admiten escritura directa desde la API.
-- =====================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'app_settings', 'units', 'categories', 'suppliers', 'products',
    'product_supplier_codes', 'product_aliases', 'purchase_orders', 'purchase_order_items',
    'invoices', 'invoice_items', 'invoice_processing_logs', 'goods_receipts', 'goods_receipt_items',
    'product_cost_history', 'inventory_movements', 'payments', 'audit_logs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Nada para usuarios anónimos.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- Funciones internas que no deben llamarse desde la API.
revoke execute on function public.refresh_product_cost(uuid) from authenticated;
revoke execute on function public.refresh_po_status(uuid) from authenticated;
revoke execute on function public.log_audit(text, text, text, text, jsonb) from authenticated;
revoke execute on function public.handle_new_user() from authenticated;

-- Tablas derivadas: sin escritura directa.
revoke insert, update, delete on public.product_cost_history, public.inventory_movements, public.audit_logs from authenticated;
revoke insert, update, delete on public.invoice_processing_logs from authenticated;
grant insert on public.invoice_processing_logs to authenticated;
revoke delete on public.invoices, public.goods_receipts, public.goods_receipt_items, public.payments,
                 public.purchase_orders, public.suppliers, public.products, public.units from authenticated;

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_role('admin'));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

-- ---------------------------------------------------------------------
-- app_settings: lectura para usuarios activos, escritura sólo admin
-- ---------------------------------------------------------------------
create policy settings_select on public.app_settings for select to authenticated
  using (public.current_app_role() is not null);
create policy settings_update on public.app_settings for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

-- ---------------------------------------------------------------------
-- Catálogo: lectura para todos los usuarios activos
-- ---------------------------------------------------------------------
create policy units_select on public.units for select to authenticated using (public.current_app_role() is not null);
create policy units_write on public.units for insert to authenticated with check (public.has_role('admin'));
create policy units_update on public.units for update to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));

create policy categories_select on public.categories for select to authenticated using (public.current_app_role() is not null);
create policy categories_insert on public.categories for insert to authenticated with check (public.has_role('admin', 'purchasing'));
create policy categories_update on public.categories for update to authenticated
  using (public.has_role('admin', 'purchasing')) with check (public.has_role('admin', 'purchasing'));
create policy categories_delete on public.categories for delete to authenticated using (public.has_role('admin'));

create policy products_select on public.products for select to authenticated using (public.current_app_role() is not null);
create policy products_insert on public.products for insert to authenticated with check (public.has_role('admin', 'purchasing'));
create policy products_update on public.products for update to authenticated
  using (public.has_role('admin', 'purchasing')) with check (public.has_role('admin', 'purchasing'));

create policy psc_select on public.product_supplier_codes for select to authenticated using (public.has_role('admin', 'purchasing'));
create policy psc_insert on public.product_supplier_codes for insert to authenticated with check (public.has_role('admin', 'purchasing'));
create policy psc_update on public.product_supplier_codes for update to authenticated
  using (public.has_role('admin', 'purchasing')) with check (public.has_role('admin', 'purchasing'));
create policy psc_delete on public.product_supplier_codes for delete to authenticated using (public.has_role('admin', 'purchasing'));

create policy aliases_select on public.product_aliases for select to authenticated using (public.has_role('admin', 'purchasing'));
create policy aliases_delete on public.product_aliases for delete to authenticated using (public.has_role('admin', 'purchasing'));
revoke insert, update on public.product_aliases from authenticated;

-- ---------------------------------------------------------------------
-- Proveedores (información comercial: sólo admin y compras)
-- ---------------------------------------------------------------------
create policy suppliers_select on public.suppliers for select to authenticated using (public.has_role('admin', 'purchasing'));
create policy suppliers_insert on public.suppliers for insert to authenticated with check (public.has_role('admin', 'purchasing'));
create policy suppliers_update on public.suppliers for update to authenticated
  using (public.has_role('admin', 'purchasing')) with check (public.has_role('admin', 'purchasing'));

-- ---------------------------------------------------------------------
-- Órdenes de compra: escritura vía save_purchase_order / set_purchase_order_status
-- ---------------------------------------------------------------------
create policy po_select on public.purchase_orders for select to authenticated using (public.has_role('admin', 'purchasing'));
create policy poi_select on public.purchase_order_items for select to authenticated using (public.has_role('admin', 'purchasing'));
revoke insert, update, delete on public.purchase_orders, public.purchase_order_items from authenticated;

-- ---------------------------------------------------------------------
-- Facturas: alta directa (subida); edición vía save_invoice_review;
-- confirmación/anulación vía RPC.
-- ---------------------------------------------------------------------
create policy invoices_select on public.invoices for select to authenticated using (public.has_role('admin', 'purchasing'));
create policy invoices_insert on public.invoices for insert to authenticated
  with check (public.has_role('admin', 'purchasing') and status in ('uploaded', 'needs_review') and uploaded_by = auth.uid());
-- Actualización directa sólo de estados previos a la confirmación (el trigger protege las confirmadas).
create policy invoices_update on public.invoices for update to authenticated
  using (public.has_role('admin', 'purchasing') and status in ('uploaded', 'processing', 'ocr_failed', 'needs_review'))
  with check (public.has_role('admin', 'purchasing') and status in ('uploaded', 'processing', 'ocr_failed', 'needs_review'));

create policy invoice_items_select on public.invoice_items for select to authenticated using (public.has_role('admin', 'purchasing'));
revoke insert, update, delete on public.invoice_items from authenticated;

create policy ipl_select on public.invoice_processing_logs for select to authenticated using (public.has_role('admin', 'purchasing'));
create policy ipl_insert on public.invoice_processing_logs for insert to authenticated
  with check (public.has_role('admin', 'purchasing') and created_by = auth.uid());

-- ---------------------------------------------------------------------
-- Recepciones (escritura vía RPC)
-- ---------------------------------------------------------------------
create policy gr_select on public.goods_receipts for select to authenticated using (public.has_role('admin', 'purchasing'));
create policy gri_select on public.goods_receipt_items for select to authenticated using (public.has_role('admin', 'purchasing'));
revoke insert, update on public.goods_receipts, public.goods_receipt_items from authenticated;

-- ---------------------------------------------------------------------
-- Historial de costos: sólo lectura para admin y compras
-- ---------------------------------------------------------------------
create policy pch_select on public.product_cost_history for select to authenticated using (public.has_role('admin', 'purchasing'));

-- ---------------------------------------------------------------------
-- Inventario: lectura para todos; escritura vía record_inventory_movement
-- ---------------------------------------------------------------------
create policy im_select on public.inventory_movements for select to authenticated using (public.current_app_role() is not null);

-- ---------------------------------------------------------------------
-- Pagos: admin y compras registran; sólo admin anula (RPC)
-- ---------------------------------------------------------------------
create policy payments_select on public.payments for select to authenticated using (public.has_role('admin', 'purchasing'));
create policy payments_insert on public.payments for insert to authenticated
  with check (public.has_role('admin', 'purchasing') and created_by = auth.uid() and not voided
              and exists (select 1 from public.app_settings where id = 1 and payments_enabled));
revoke update on public.payments from authenticated;

-- ---------------------------------------------------------------------
-- Auditoría: lectura admin y compras
-- ---------------------------------------------------------------------
create policy audit_select on public.audit_logs for select to authenticated using (public.has_role('admin', 'purchasing'));

-- Vistas
grant select on public.invoice_balances, public.supplier_balances, public.product_cost_changes to authenticated;
revoke all on public.invoice_balances, public.supplier_balances, public.product_cost_changes from anon;
