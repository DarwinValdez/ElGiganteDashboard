-- =====================================================================
-- Prueba de integración de la base de datos (Postgres local + stub).
-- Ejecutar: ver supabase/tests/run.sh
-- Cada bloque cambia de usuario con set_config('request.jwt.claim.sub')
-- y role authenticated, igual que PostgREST en Supabase.
-- =====================================================================
\set ON_ERROR_STOP 1

-- Usuarios: el primero es admin automáticamente.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'admin@gigante.test');
insert into auth.users (id, email, raw_app_meta_data) values
  ('00000000-0000-0000-0000-00000000000b', 'compras@gigante.test', '{"role":"purchasing"}'),
  ('00000000-0000-0000-0000-00000000000c', 'empleado@gigante.test', '{}');

do $$ begin
  assert (select role from public.profiles where email = 'admin@gigante.test') = 'admin', 'primer usuario debe ser admin';
  assert (select role from public.profiles where email = 'compras@gigante.test') = 'purchasing';
  assert (select role from public.profiles where email = 'empleado@gigante.test') = 'employee';
end $$;

create or replace function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm not ilike '%' || p_like || '%' then
      raise exception 'Error inesperado: % (esperado: %)', sqlerrm, p_like;
    end if;
    raise notice 'OK error esperado: %', sqlerrm;
    return;
  end;
  raise exception 'Se esperaba un error "%" al ejecutar: %', p_like, p_sql;
end $$;
grant execute on function pg_temp.expect_error(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Encargado de compras: catálogo, proveedor, orden de compra
-- ---------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);

insert into public.suppliers (id, trade_name, legal_name, payment_terms, created_by)
values ('10000000-0000-0000-0000-000000000001', 'Distribuidora ABC', 'Distribuidora ABC SRL', '30 días', auth.uid()),
       ('10000000-0000-0000-0000-000000000002', 'Proveedor B', null, 'Contado', auth.uid());

insert into public.categories (id, name) values ('20000000-0000-0000-0000-000000000001', 'Abarrotes');

insert into public.products (id, name, barcode, category_id, brand, purchase_unit, inventory_unit, units_per_package, size_value, size_unit, default_supplier_id, min_stock)
values
 ('30000000-0000-0000-0000-000000000001', 'Arroz grano largo, saco de 20 libras', '7400000000011', '20000000-0000-0000-0000-000000000001', 'Gigante', 'saco', 'saco', 1, 20, 'lb', '10000000-0000-0000-0000-000000000001', 5),
 ('30000000-0000-0000-0000-000000000002', 'Aceite vegetal 1 L', null, '20000000-0000-0000-0000-000000000001', 'Crisol', 'caja', 'botella', 12, 1, 'l', '10000000-0000-0000-0000-000000000001', 24),
 ('30000000-0000-0000-0000-000000000003', 'Habichuelas rojas 15 oz', null, '20000000-0000-0000-0000-000000000001', 'Goya', 'caja', 'lata', 24, 15, 'oz', '10000000-0000-0000-0000-000000000001', 0);

select pg_temp.expect_error($q$update public.products set current_stock = 100 where id = '30000000-0000-0000-0000-000000000001'$q$, 'stock sólo se modifica');

select public.save_purchase_order(
  '{"supplier_id":"10000000-0000-0000-0000-000000000001","notes":"Pedido semanal"}',
  '[{"product_id":"30000000-0000-0000-0000-000000000001","quantity":10,"unit":"saco","units_per_package":1,"unit_price":18},
    {"product_id":"30000000-0000-0000-0000-000000000002","quantity":5,"unit":"caja","units_per_package":12,"unit_price":24,"tax_rate":10}]') as po_id \gset

do $$ begin
  assert (select total from public.purchase_orders where po_number = 'OC-000001') = 312.00, 'total OC (180+120+12 imp)';
end $$;

select public.set_purchase_order_status(:'po_id', 'pending_approval');
select pg_temp.expect_error(format($q$select public.set_purchase_order_status(%L, 'approved')$q$, :'po_id'), 'administrador puede aprobar');
select pg_temp.expect_error(format($q$select public.set_purchase_order_status(%L, 'received')$q$, :'po_id'), 'Transición no permitida');

-- Admin aprueba
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select public.set_purchase_order_status(:'po_id', 'approved');
select public.set_purchase_order_status(:'po_id', 'sent');

-- ---------------------------------------------------------------------
-- Factura: subida → revisión → validación → confirmación
-- ---------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
insert into public.invoices (id, status, file_path, file_name, file_mime, file_size, file_sha256, uploaded_by)
values ('40000000-0000-0000-0000-000000000001', 'uploaded', 'x/f.jpg', 'f.jpg', 'image/jpeg', 1000, 'abc', auth.uid());

select public.save_invoice_review('40000000-0000-0000-0000-000000000001',
  format('{"supplier_id":"10000000-0000-0000-0000-000000000001","invoice_number":"F-10582","issue_date":"2026-10-28","subtotal":420,"total":420,"purchase_order_id":"%s"}', :'po_id')::jsonb,
  '[{"original_description":"RICE LONG GRAIN 20LB","quantity":10,"unit":"saco","conversion_factor":1,"unit_price":18,"line_total":180},
    {"original_description":"Aceite vegetal 12/1","supplier_code":"ACE-12","quantity":5,"unit":"caja","conversion_factor":12,"unit_price":24,"line_total":120},
    {"original_description":"Habichuelas 24/15 oz","quantity":4,"unit":"caja","conversion_factor":24,"unit_price":30,"line_total":120}]');

-- Sin productos vinculados no se puede confirmar
select pg_temp.expect_error($q$select public.confirm_invoice('40000000-0000-0000-0000-000000000001')$q$, 'sin producto del catálogo');

-- Candidatos de coincidencia
select * from public.match_product_candidates('10000000-0000-0000-0000-000000000001', null, 'Aceite vegetal 12/1', null);
select * from public.match_product_candidates(null, '7400000000011', 'x', null);

-- Vincula las líneas (como lo haría la pantalla de revisión) con un total impreso erróneo
select public.save_invoice_review('40000000-0000-0000-0000-000000000001',
  format('{"supplier_id":"10000000-0000-0000-0000-000000000001","invoice_number":"F-10582","issue_date":"2026-10-28","subtotal":420,"total":430,"freight_total":0,"purchase_order_id":"%s"}', :'po_id')::jsonb,
  '[{"original_description":"RICE LONG GRAIN 20LB","product_id":"30000000-0000-0000-0000-000000000001","match_confirmed":true,"match_method":"fuzzy","quantity":10,"unit":"saco","conversion_factor":1,"unit_price":18,"line_total":180},
    {"original_description":"Aceite vegetal 12/1","supplier_code":"ACE-12","product_id":"30000000-0000-0000-0000-000000000002","match_confirmed":true,"quantity":5,"unit":"caja","conversion_factor":12,"unit_price":24,"line_total":120},
    {"original_description":"Habichuelas 24/15 oz","product_id":"30000000-0000-0000-0000-000000000003","match_confirmed":true,"quantity":4,"unit":"caja","conversion_factor":24,"unit_price":30,"line_total":120}]');

select public.validate_invoice('40000000-0000-0000-0000-000000000001') ->> 'total_diff' as total_diff;
select pg_temp.expect_error($q$select public.confirm_invoice('40000000-0000-0000-0000-000000000001')$q$, 'totales no cuadran');
-- Compras no puede documentar excepción; sólo admin
select pg_temp.expect_error($q$select public.confirm_invoice('40000000-0000-0000-0000-000000000001', 'Cargo de flete no desglosado')$q$, 'Sólo un administrador');

-- Corrige el total y confirma
update public.invoices set total = 420 where id = '40000000-0000-0000-0000-000000000001';
select public.confirm_invoice('40000000-0000-0000-0000-000000000001');

do $$ begin
  assert (select status from public.invoices where id = '40000000-0000-0000-0000-000000000001') = 'confirmed';
  assert (select count(*) from public.product_cost_history where invoice_id = '40000000-0000-0000-0000-000000000001') = 3, 'historial 3 líneas';
  assert (select normalized_unit_cost from public.products where id = '30000000-0000-0000-0000-000000000002') = 2, 'costo por botella = 24/12 = 2';
  assert (select last_purchase_price from public.products where id = '30000000-0000-0000-0000-000000000002') = 24, 'precio por caja = 24';
  assert (select current_stock from public.products where id = '30000000-0000-0000-0000-000000000002') = 60, 'stock 5 cajas x 12 = 60';
  assert (select current_stock from public.products where id = '30000000-0000-0000-0000-000000000003') = 96, 'stock 4 x 24 = 96';
  assert (select count(*) from public.product_aliases) = 3, 'alias aprendidos';
  assert (select count(*) from public.product_supplier_codes where supplier_code = 'ACE-12') = 1;
end $$;

-- Re-confirmar o editar no duplica nada
select pg_temp.expect_error($q$select public.confirm_invoice('40000000-0000-0000-0000-000000000001')$q$, 'ya fue confirmada');
select pg_temp.expect_error($q$select public.save_invoice_review('40000000-0000-0000-0000-000000000001', '{}', '[]')$q$, 'no puede editarse');
-- RLS filtra la fila: la actualización directa no afecta a facturas confirmadas
update public.invoices set total = 1 where id = '40000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select total from public.invoices where id = '40000000-0000-0000-0000-000000000001') = 420, 'confirmada inmutable';
end $$;

-- Factura duplicada (mismo proveedor y número, formato distinto)
insert into public.invoices (id, status, uploaded_by) values ('40000000-0000-0000-0000-000000000002', 'needs_review', auth.uid());
select public.save_invoice_review('40000000-0000-0000-0000-000000000002',
  '{"supplier_id":"10000000-0000-0000-0000-000000000001","invoice_number":"f 10582","issue_date":"2026-10-28","total":180}',
  '[{"original_description":"RICE LONG GRAIN 20LB","product_id":"30000000-0000-0000-0000-000000000001","match_confirmed":true,"quantity":10,"unit":"saco","conversion_factor":1,"unit_price":18,"line_total":180}]');
select pg_temp.expect_error($q$select public.confirm_invoice('40000000-0000-0000-0000-000000000002')$q$, 'mismo número');

-- Segunda compra con precio más alto (Proveedor B) → detecta aumento
insert into public.invoices (id, status, uploaded_by) values ('40000000-0000-0000-0000-000000000003', 'needs_review', auth.uid());
select public.save_invoice_review('40000000-0000-0000-0000-000000000003',
  '{"supplier_id":"10000000-0000-0000-0000-000000000002","invoice_number":"B-77","issue_date":"2026-10-29","subtotal":130,"tax_total":13,"freight_total":7,"total":150}',
  '[{"original_description":"ACEITE VEG 12X1L","product_id":"30000000-0000-0000-0000-000000000002","match_confirmed":true,"quantity":5,"unit":"caja","conversion_factor":12,"unit_price":26,"tax":13,"line_total":130}]');
select public.confirm_invoice('40000000-0000-0000-0000-000000000003');

select product_id, last_cost, previous_cost, diff, pct from public.product_cost_changes;
select public.product_price_stats('30000000-0000-0000-0000-000000000002');
do $$ begin
  assert (select pct from public.product_cost_changes where product_id = '30000000-0000-0000-0000-000000000002') = 8.33, 'aumento 8.33%';
  -- costo efectivo = (130 + 7 flete) / 60 (impuesto recuperable excluido)
  assert (select effective_unit_cost from public.products where id = '30000000-0000-0000-0000-000000000002') = round(137/60.0, 6);
  assert (select current_stock from public.products where id = '30000000-0000-0000-0000-000000000002') = 120;
end $$;

-- ---------------------------------------------------------------------
-- Recepción parcial de la OC (inventario por factura → la recepción no duplica stock)
-- ---------------------------------------------------------------------
select public.create_goods_receipt(
  format('{"purchase_order_id":"%s"}', :'po_id')::jsonb,
  (select jsonb_agg(jsonb_build_object('purchase_order_item_id', id, 'product_id', product_id, 'ordered_quantity', quantity,
                                       'received_quantity', case when line_no = 1 then 10 else 3 end, 'unit', unit,
                                       'conversion_factor', units_per_package, 'unit_price', unit_price,
                                       'difference_reason', case when line_no = 2 then 'Faltan 2 cajas' end))
     from public.purchase_order_items where purchase_order_id = :'po_id'));
do $$ begin
  assert (select status from public.purchase_orders where po_number = 'OC-000001') = 'partially_received';
  assert (select current_stock from public.products where id = '30000000-0000-0000-0000-000000000002') = 120, 'recepción no duplica stock';
end $$;

-- ---------------------------------------------------------------------
-- Pagos y saldo
-- ---------------------------------------------------------------------
insert into public.payments (supplier_id, invoice_id, amount, created_by)
values ('10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 100, auth.uid());
do $$ begin
  assert (select balance from public.supplier_balances where supplier_id = '10000000-0000-0000-0000-000000000001') = 320;
end $$;
select public.dashboard_kpis('2026-10-01', '2026-10-31');

-- ---------------------------------------------------------------------
-- Empleado: sin acceso a proveedores, facturas ni costos
-- ---------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
do $$ begin
  assert (select count(*) from public.suppliers) = 0, 'empleado no ve proveedores';
  assert (select count(*) from public.invoices) = 0, 'empleado no ve facturas';
  assert (select count(*) from public.product_cost_history) = 0, 'empleado no ve historial de costos';
  assert (select count(*) from public.payments) = 0, 'empleado no ve pagos';
  assert (select count(*) from public.products) = 3, 'empleado ve productos';
end $$;
select pg_temp.expect_error($q$insert into public.suppliers (trade_name) values ('X')$q$, 'row-level security');
select pg_temp.expect_error($q$select public.confirm_invoice('40000000-0000-0000-0000-000000000002')$q$, 'Permiso denegado');
select pg_temp.expect_error($q$update public.profiles set role = 'admin' where id = auth.uid()$q$, 'Sólo un administrador');
select pg_temp.expect_error($q$insert into public.inventory_movements (product_id, movement_type, quantity) values ('30000000-0000-0000-0000-000000000001', 'adjustment_in', 5)$q$, 'permission denied');
select pg_temp.expect_error($q$select public.record_inventory_movement('30000000-0000-0000-0000-000000000001', 'adjustment_in', 5, 'conteo')$q$, 'Su rol');
select public.record_inventory_movement('30000000-0000-0000-0000-000000000001', 'sale', 2, null);
select pg_temp.expect_error($q$select public.record_inventory_movement('30000000-0000-0000-0000-000000000001', 'sale', 999, null)$q$, 'Existencias insuficientes');
do $$ begin
  assert (select current_stock from public.products where id = '30000000-0000-0000-0000-000000000001') = 8, 'venta descuenta stock';
end $$;

-- ---------------------------------------------------------------------
-- Anulación auditada (admin): revierte stock y costo, conserva historial
-- ---------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.expect_error($q$select public.void_invoice('40000000-0000-0000-0000-000000000003', 'x')$q$, 'motivo');
select public.void_invoice('40000000-0000-0000-0000-000000000003', 'Factura registrada por error');
do $$ begin
  assert (select status from public.invoices where id = '40000000-0000-0000-0000-000000000003') = 'voided';
  assert (select current_stock from public.products where id = '30000000-0000-0000-0000-000000000002') = 60, 'stock revertido';
  assert (select normalized_unit_cost from public.products where id = '30000000-0000-0000-0000-000000000002') = 2, 'costo vuelve al anterior';
  assert (select count(*) from public.product_cost_history where invoice_id = '40000000-0000-0000-0000-000000000003' and voided) = 1, 'historial conservado y marcado';
  assert (select count(*) from public.audit_logs where entity = 'invoices' and action = 'status:voided') = 1, 'auditoría';
end $$;
select pg_temp.expect_error($q$select public.void_invoice('40000000-0000-0000-0000-000000000003', 'otra vez')$q$, 'ya está anulada');
select pg_temp.expect_error($q$select public.void_invoice('40000000-0000-0000-0000-000000000001', 'Factura con error')$q$, 'pagos registrados');
select pg_temp.expect_error($q$delete from public.audit_logs$q$, 'permission denied');

-- Mismo número tras anular sí puede registrarse (la anulada no bloquea)
select count(*) as reportes_ok from public.po_invoice_differences('2026-01-01', '2026-12-31');
select * from public.purchases_by_month('2026-01-01', '2026-12-31');
select * from public.purchases_by_category('2026-01-01', '2026-12-31');
select * from public.product_rotation('2026-01-01', '2026-12-31');

reset role;
\echo 'TODAS LAS PRUEBAS DE BASE DE DATOS PASARON'
