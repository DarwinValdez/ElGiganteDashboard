-- =====================================================================
-- DATOS DE DEMOSTRACIÓN — EL GIGANTE SUPERMARKET
-- ---------------------------------------------------------------------
-- * Opcional. NO se ejecuta automáticamente con las migraciones.
-- * Todos los registros están marcados con el prefijo "[DEMO]" y los SKU
--   comienzan con "DEMO-", para distinguirlos de los datos reales.
-- * Para eliminarlos: supabase/seed/remove_demo_data.sql
-- * Ejecutar desde el SQL Editor de Supabase (rol postgres).
-- * Sólo contiene catálogo (proveedores, categorías y productos). Las
--   compras, facturas y costos deben registrarse desde la aplicación para
--   que pasen por las validaciones y la auditoría.
-- =====================================================================

insert into public.categories (id, name) values
  ('d0000000-0000-0000-0000-000000000001', '[DEMO] Granos y cereales'),
  ('d0000000-0000-0000-0000-000000000002', '[DEMO] Aceites'),
  ('d0000000-0000-0000-0000-000000000003', '[DEMO] Enlatados')
on conflict do nothing;

insert into public.suppliers (id, trade_name, legal_name, tax_id, contact_name, phone, email, payment_terms, payment_days, notes) values
  ('d1000000-0000-0000-0000-000000000001', '[DEMO] Distribuidora ABC', '[DEMO] Distribuidora ABC SRL', 'DEMO-101', 'Ana Pérez', '809-555-0101', 'ventas@demo-abc.example', 'Crédito 30 días', 30, 'Proveedor ficticio de demostración'),
  ('d1000000-0000-0000-0000-000000000002', '[DEMO] Comercial del Norte', '[DEMO] Comercial del Norte SA', 'DEMO-202', 'Luis Gómez', '809-555-0202', 'pedidos@demo-norte.example', 'Contado', 0, 'Proveedor ficticio de demostración')
on conflict do nothing;

insert into public.products (id, sku, name, barcode, category_id, brand, purchase_unit, inventory_unit, units_per_package, size_value, size_unit, default_supplier_id, min_stock, notes) values
  ('d2000000-0000-0000-0000-000000000001', 'DEMO-001', '[DEMO] Arroz grano largo, saco de 20 libras', null, 'd0000000-0000-0000-0000-000000000001', null, 'saco', 'saco', 1, 20, 'lb', 'd1000000-0000-0000-0000-000000000001', 10, 'Producto de demostración'),
  ('d2000000-0000-0000-0000-000000000002', 'DEMO-002', '[DEMO] Aceite vegetal 1 L', null, 'd0000000-0000-0000-0000-000000000002', null, 'caja', 'botella', 12, 1, 'l', 'd1000000-0000-0000-0000-000000000001', 24, 'Caja de 12 botellas'),
  ('d2000000-0000-0000-0000-000000000003', 'DEMO-003', '[DEMO] Habichuelas rojas 15 oz', null, 'd0000000-0000-0000-0000-000000000003', null, 'caja', 'lata', 24, 15, 'oz', 'd1000000-0000-0000-0000-000000000001', 48, 'Caja de 24 latas'),
  ('d2000000-0000-0000-0000-000000000004', 'DEMO-004', '[DEMO] Azúcar crema 5 lb', null, 'd0000000-0000-0000-0000-000000000001', null, 'fardo', 'unidad', 10, 5, 'lb', 'd1000000-0000-0000-0000-000000000002', 20, 'Fardo de 10 fundas')
on conflict do nothing;

-- Código del proveedor conocido para el aceite (ilustra la coincidencia por código)
insert into public.product_supplier_codes (product_id, supplier_id, supplier_code, supplier_description, purchase_unit, units_per_package)
values ('d2000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000001', 'DEMO-ACE12', 'Aceite vegetal 12/1', 'caja', 12)
on conflict do nothing;
