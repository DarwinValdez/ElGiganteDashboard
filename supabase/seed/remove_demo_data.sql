-- Elimina (o desactiva, si ya tienen movimientos) los datos de demostración.
-- Ejecutar desde el SQL Editor de Supabase (rol postgres).
begin;

delete from public.product_supplier_codes where supplier_code like 'DEMO-%';
delete from public.product_aliases where product_id in (select id from public.products where sku like 'DEMO-%');

-- Productos sin historial: se eliminan; con historial: se desactivan
delete from public.products p
 where p.sku like 'DEMO-%'
   and not exists (select 1 from public.invoice_items i where i.product_id = p.id)
   and not exists (select 1 from public.purchase_order_items i where i.product_id = p.id)
   and not exists (select 1 from public.inventory_movements m where m.product_id = p.id)
   and not exists (select 1 from public.goods_receipt_items g where g.product_id = p.id);
update public.products set active = false where sku like 'DEMO-%';

delete from public.suppliers s
 where s.trade_name like '[DEMO]%'
   and not exists (select 1 from public.invoices i where i.supplier_id = s.id)
   and not exists (select 1 from public.purchase_orders o where o.supplier_id = s.id)
   and not exists (select 1 from public.products p where p.default_supplier_id = s.id);
update public.suppliers set active = false where trade_name like '[DEMO]%';

delete from public.categories c
 where c.name like '[DEMO]%' and not exists (select 1 from public.products p where p.category_id = c.id);
update public.categories set active = false where name like '[DEMO]%';

commit;
