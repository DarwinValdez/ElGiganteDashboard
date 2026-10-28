-- =====================================================================
-- Migración 4: vistas y funciones de reportes.
-- Todas usan security_invoker / security invoker, por lo que respetan
-- las políticas RLS del usuario que consulta.
-- =====================================================================

create view public.invoice_balances with (security_invoker = true) as
select i.id as invoice_id, i.supplier_id, i.invoice_number, i.issue_date, i.due_date, i.currency, i.total,
       coalesce(p.paid, 0) as paid,
       i.total - coalesce(p.paid, 0) as balance,
       (i.due_date is not null and i.due_date < current_date and i.total - coalesce(p.paid, 0) > 0) as overdue
  from public.invoices i
  left join (select invoice_id, sum(amount) as paid from public.payments where not voided and invoice_id is not null group by invoice_id) p
    on p.invoice_id = i.id
 where i.status = 'confirmed';

create view public.supplier_balances with (security_invoker = true) as
select s.id as supplier_id, s.trade_name,
       coalesce(inv.invoiced, 0) as invoiced,
       coalesce(pay.paid, 0) as paid,
       coalesce(inv.invoiced, 0) - coalesce(pay.paid, 0) as balance,
       coalesce(inv.overdue, 0) as overdue_invoices
  from public.suppliers s
  left join (select supplier_id, sum(total) as invoiced,
                    count(*) filter (where due_date < current_date) as overdue
               from public.invoices where status = 'confirmed' group by supplier_id) inv on inv.supplier_id = s.id
  left join (select supplier_id, sum(amount) as paid from public.payments where not voided group by supplier_id) pay
    on pay.supplier_id = s.id;

-- Último costo vs. costo anterior (normalizado por unidad de inventario).
create view public.product_cost_changes with (security_invoker = true) as
with ranked as (
  select h.*, row_number() over (partition by h.product_id order by h.purchase_date desc, h.created_at desc) as rn
    from public.product_cost_history h
   where not h.voided
)
select p.id as product_id, p.sku, p.name, p.inventory_unit, p.category_id,
       l.normalized_unit_cost as last_cost, l.purchase_date as last_date, l.supplier_id as last_supplier_id,
       pr.normalized_unit_cost as previous_cost, pr.purchase_date as previous_date, pr.supplier_id as previous_supplier_id,
       l.normalized_unit_cost - pr.normalized_unit_cost as diff,
       case when pr.normalized_unit_cost > 0
            then round((l.normalized_unit_cost - pr.normalized_unit_cost) / pr.normalized_unit_cost * 100, 2) end as pct
  from public.products p
  join ranked l on l.product_id = p.id and l.rn = 1
  left join ranked pr on pr.product_id = p.id and pr.rn = 2;

create or replace function public.product_price_stats(p_product_id uuid)
returns jsonb
language sql stable security invoker
set search_path = public as $$
  with h as (
    select h.*, s.trade_name,
           row_number() over (order by h.purchase_date desc, h.created_at desc) as rn
      from public.product_cost_history h
      join public.suppliers s on s.id = h.supplier_id
     where h.product_id = p_product_id and not h.voided
  ),
  latest_by_supplier as (
    select distinct on (supplier_id) supplier_id, trade_name, normalized_unit_cost, purchase_date
      from h order by supplier_id, purchase_date desc, created_at desc
  )
  select jsonb_build_object(
    'count', (select count(*) from h),
    'last', (select jsonb_build_object('cost', normalized_unit_cost, 'effective', effective_unit_cost, 'package_price', package_price,
                                       'unit', unit, 'date', purchase_date, 'supplier', trade_name) from h where rn = 1),
    'previous', (select jsonb_build_object('cost', normalized_unit_cost, 'effective', effective_unit_cost, 'package_price', package_price,
                                           'unit', unit, 'date', purchase_date, 'supplier', trade_name) from h where rn = 2),
    'min', (select jsonb_build_object('cost', normalized_unit_cost, 'date', purchase_date, 'supplier', trade_name)
              from h order by normalized_unit_cost asc, purchase_date desc limit 1),
    'max', (select jsonb_build_object('cost', normalized_unit_cost, 'date', purchase_date, 'supplier', trade_name)
              from h order by normalized_unit_cost desc, purchase_date desc limit 1),
    'avg', (select round(avg(normalized_unit_cost), 6) from h),
    'cheapest_supplier', (select jsonb_build_object('supplier_id', supplier_id, 'supplier', trade_name, 'cost', normalized_unit_cost, 'date', purchase_date)
                            from latest_by_supplier order by normalized_unit_cost asc limit 1),
    'suppliers', (select coalesce(jsonb_agg(jsonb_build_object('supplier_id', supplier_id, 'supplier', trade_name,
                                                               'cost', normalized_unit_cost, 'date', purchase_date)
                                            order by normalized_unit_cost), '[]'::jsonb)
                    from latest_by_supplier)
  )
$$;

create or replace function public.dashboard_kpis(p_from date, p_to date)
returns jsonb
language sql stable security invoker
set search_path = public as $$
  select jsonb_build_object(
    'purchases_total', (select coalesce(sum(total), 0) from public.invoices
                         where status = 'confirmed' and issue_date between p_from and p_to),
    'invoices_count', (select count(*) from public.invoices
                        where status = 'confirmed' and issue_date between p_from and p_to),
    'invoices_registered', (select count(*) from public.invoices
                             where status <> 'voided' and created_at::date between p_from and p_to),
    'pending_review', (select count(*) from public.invoices where status in ('uploaded', 'processing', 'ocr_failed', 'needs_review')),
    'open_pos', (select count(*) from public.purchase_orders
                  where status in ('draft', 'pending_approval', 'approved', 'sent', 'partially_received')),
    'pending_approval_pos', (select count(*) from public.purchase_orders where status = 'pending_approval'),
    'payable_total', (select coalesce(sum(balance), 0) from public.supplier_balances),
    'overdue_total', (select coalesce(sum(balance), 0) from public.invoice_balances where overdue),
    'low_stock', (select count(*) from public.products where active and min_stock > 0 and current_stock <= min_stock),
    'out_of_stock', (select count(*) from public.products where active and current_stock <= 0)
  )
$$;

create or replace function public.purchases_by_month(p_from date, p_to date, p_supplier_id uuid default null)
returns table (month date, total numeric, invoices bigint)
language sql stable security invoker
set search_path = public as $$
  select date_trunc('month', issue_date)::date as month, sum(total), count(*)
    from public.invoices
   where status = 'confirmed' and issue_date between p_from and p_to
     and (p_supplier_id is null or supplier_id = p_supplier_id)
   group by 1 order by 1
$$;

create or replace function public.purchases_by_supplier(p_from date, p_to date)
returns table (supplier_id uuid, trade_name text, total numeric, invoices bigint)
language sql stable security invoker
set search_path = public as $$
  select s.id, s.trade_name, sum(i.total), count(*)
    from public.invoices i join public.suppliers s on s.id = i.supplier_id
   where i.status = 'confirmed' and i.issue_date between p_from and p_to
   group by s.id, s.trade_name order by 3 desc
$$;

create or replace function public.purchases_by_category(p_from date, p_to date, p_supplier_id uuid default null)
returns table (category_id uuid, category text, total numeric, lines bigint)
language sql stable security invoker
set search_path = public as $$
  select c.id, coalesce(c.name, 'Sin categoría'), sum(ii.line_total), count(*)
    from public.invoice_items ii
    join public.invoices i on i.id = ii.invoice_id
    join public.products p on p.id = ii.product_id
    left join public.categories c on c.id = p.category_id
   where i.status = 'confirmed' and i.issue_date between p_from and p_to
     and (p_supplier_id is null or i.supplier_id = p_supplier_id)
   group by c.id, c.name order by 3 desc
$$;

-- Diferencias entre lo pedido (OC) y lo facturado, por producto, en unidades de inventario.
create or replace function public.po_invoice_differences(p_from date, p_to date)
returns table (
  invoice_id uuid, invoice_number text, issue_date date, purchase_order_id uuid, po_number text,
  supplier text, product_id uuid, product text,
  ordered_qty numeric, invoiced_qty numeric, qty_diff numeric,
  ordered_unit_cost numeric, invoiced_unit_cost numeric, cost_diff numeric)
language sql stable security invoker
set search_path = public as $$
  with po as (
    select poi.purchase_order_id, poi.product_id,
           sum(poi.quantity * poi.units_per_package) as qty,
           sum(poi.line_total) / nullif(sum(poi.quantity * poi.units_per_package), 0) as unit_cost
      from public.purchase_order_items poi group by 1, 2
  ),
  inv as (
    select ii.invoice_id, ii.product_id,
           sum(ii.quantity * ii.conversion_factor) as qty,
           sum(ii.line_total) / nullif(sum(ii.quantity * ii.conversion_factor), 0) as unit_cost
      from public.invoice_items ii where ii.product_id is not null group by 1, 2
  )
  select i.id, i.invoice_number, i.issue_date, o.id, o.po_number, s.trade_name,
         x.product_id, p.name,
         round(coalesce(x.po_qty, 0), 4), round(coalesce(x.inv_qty, 0), 4), round(coalesce(x.inv_qty, 0) - coalesce(x.po_qty, 0), 4),
         round(x.po_cost, 6), round(x.inv_cost, 6), round(x.inv_cost - x.po_cost, 6)
    from public.invoices i
    join public.purchase_orders o on o.id = i.purchase_order_id
    join public.suppliers s on s.id = i.supplier_id
    join lateral (
      select coalesce(a.product_id, b.product_id) as product_id,
             a.qty as po_qty, a.unit_cost as po_cost, b.qty as inv_qty, b.unit_cost as inv_cost
        from (select * from po where po.purchase_order_id = o.id) a
        full join (select * from inv where inv.invoice_id = i.id) b on a.product_id = b.product_id
    ) x on true
    join public.products p on p.id = x.product_id
   where i.status = 'confirmed' and i.issue_date between p_from and p_to
     and (coalesce(x.po_qty, 0) <> coalesce(x.inv_qty, 0)
          or abs(coalesce(x.inv_cost, 0) - coalesce(x.po_cost, 0)) > 0.0001)
   order by 3 desc, 2
$$;

create or replace function public.product_rotation(p_from date, p_to date)
returns table (product_id uuid, sku text, name text, inventory_unit text, out_qty numeric, sales_qty numeric, in_qty numeric, current_stock numeric)
language sql stable security invoker
set search_path = public as $$
  select p.id, p.sku, p.name, p.inventory_unit,
         coalesce(-sum(m.quantity) filter (where m.movement_type in ('sale', 'issue')), 0),
         coalesce(-sum(m.quantity) filter (where m.movement_type = 'sale'), 0),
         coalesce(sum(m.quantity) filter (where m.movement_type = 'receipt'), 0),
         p.current_stock
    from public.products p
    join public.inventory_movements m on m.product_id = p.id
   where m.created_at::date between p_from and p_to
   group by p.id
   order by 5 desc
$$;
