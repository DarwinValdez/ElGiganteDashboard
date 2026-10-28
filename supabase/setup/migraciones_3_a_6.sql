-- =============================================================
-- EL GIGANTE: migraciones 3 a 6 en un solo archivo.
-- Para el proyecto donde ya se aplicaron las migraciones 1 y 2.
-- Pegue TODO este archivo en Supabase -> SQL Editor -> Run.
-- =============================================================

-- >>> supabase/migrations/20261028000003_business_logic.sql
-- =====================================================================
-- Migración 3: lógica de negocio transaccional (RPC).
-- Cada función se ejecuta en una sola transacción: o se aplican todos
-- los efectos (historial de costos, inventario, estados) o ninguno.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Costo vigente del producto = última compra no anulada.
-- ---------------------------------------------------------------------
create or replace function public.refresh_product_cost(p_product_id uuid)
returns void
language plpgsql security definer
set search_path = public as $$
declare h record;
begin
  select pch.* into h
  from public.product_cost_history pch
  where pch.product_id = p_product_id and not pch.voided
  order by pch.purchase_date desc, pch.created_at desc
  limit 1;

  if not found then
    update public.products
       set last_purchase_price = null, normalized_unit_cost = null, effective_unit_cost = null,
           last_purchase_date = null, last_supplier_id = null
     where id = p_product_id;
  else
    update public.products p
       set last_purchase_price  = round(h.normalized_unit_cost * p.units_per_package, 4),
           normalized_unit_cost = h.normalized_unit_cost,
           effective_unit_cost  = h.effective_unit_cost,
           last_purchase_date   = h.purchase_date,
           last_supplier_id     = h.supplier_id
     where p.id = p_product_id;
  end if;
end $$;
revoke all on function public.refresh_product_cost(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Órdenes de compra
-- ---------------------------------------------------------------------
-- p_order: {id?, supplier_id, order_date, expected_date, currency, notes, discount_total}
-- p_items: [{product_id, description, quantity, unit, units_per_package, unit_price, discount, tax_rate}]
create or replace function public.save_purchase_order(p_order jsonb, p_items jsonb)
returns uuid
language plpgsql security definer
set search_path = public as $$
declare
  v_id uuid := nullif(p_order ->> 'id', '')::uuid;
  v_status public.po_status;
  v_item jsonb;
  v_line int := 0;
  v_qty numeric; v_price numeric; v_disc numeric; v_rate numeric; v_net numeric;
  v_subtotal numeric := 0; v_tax numeric := 0; v_line_disc numeric := 0;
  v_hdr_disc numeric := coalesce(nullif(p_order ->> 'discount_total', '')::numeric, 0);
begin
  perform public.require_role('admin', 'purchasing');

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La orden debe tener al menos un producto';
  end if;
  if v_hdr_disc < 0 then raise exception 'Descuento inválido'; end if;
  if not exists (select 1 from public.suppliers where id = (p_order ->> 'supplier_id')::uuid and active) then
    raise exception 'Proveedor inválido o inactivo';
  end if;

  if v_id is null then
    insert into public.purchase_orders (supplier_id, order_date, expected_date, currency, notes, created_by)
    values ((p_order ->> 'supplier_id')::uuid,
            coalesce(nullif(p_order ->> 'order_date', '')::date, current_date),
            nullif(p_order ->> 'expected_date', '')::date,
            coalesce(nullif(p_order ->> 'currency', ''), (select currency from public.app_settings where id = 1)),
            nullif(p_order ->> 'notes', ''),
            auth.uid())
    returning id into v_id;
  else
    select status into v_status from public.purchase_orders where id = v_id for update;
    if not found then raise exception 'Orden no encontrada'; end if;
    if v_status not in ('draft', 'pending_approval') then
      raise exception 'Sólo se pueden editar órdenes en borrador o pendientes de aprobación';
    end if;
    update public.purchase_orders
       set supplier_id = (p_order ->> 'supplier_id')::uuid,
           order_date = coalesce(nullif(p_order ->> 'order_date', '')::date, order_date),
           expected_date = nullif(p_order ->> 'expected_date', '')::date,
           currency = coalesce(nullif(p_order ->> 'currency', ''), currency),
           notes = nullif(p_order ->> 'notes', '')
     where id = v_id;
    delete from public.purchase_order_items where purchase_order_id = v_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_line := v_line + 1;
    v_qty := (v_item ->> 'quantity')::numeric;
    v_price := coalesce(nullif(v_item ->> 'unit_price', '')::numeric, 0);
    v_disc := coalesce(nullif(v_item ->> 'discount', '')::numeric, 0);
    v_rate := coalesce(nullif(v_item ->> 'tax_rate', '')::numeric, 0);
    if v_qty is null or v_qty <= 0 then raise exception 'Línea %: cantidad inválida', v_line; end if;
    if v_price < 0 or v_disc < 0 or v_rate < 0 then raise exception 'Línea %: valores negativos', v_line; end if;
    v_net := round(v_qty * v_price - v_disc, 2);
    if v_net < 0 then raise exception 'Línea %: el descuento supera el importe', v_line; end if;

    insert into public.purchase_order_items
      (purchase_order_id, line_no, product_id, description, quantity, unit, units_per_package,
       unit_price, discount, tax_rate, line_total)
    values (v_id, v_line, (v_item ->> 'product_id')::uuid, nullif(v_item ->> 'description', ''), v_qty,
            v_item ->> 'unit', coalesce(nullif(v_item ->> 'units_per_package', '')::numeric, 1),
            v_price, v_disc, v_rate, v_net);

    v_subtotal := v_subtotal + v_net;
    v_line_disc := v_line_disc + v_disc;
    v_tax := v_tax + round(v_net * v_rate / 100, 2);
  end loop;

  update public.purchase_orders
     set subtotal = v_subtotal,
         discount_total = v_hdr_disc,
         tax_total = v_tax,
         total = v_subtotal - v_hdr_disc + v_tax
   where id = v_id;

  return v_id;
end $$;

create or replace function public.set_purchase_order_status(p_id uuid, p_status public.po_status, p_reason text default null)
returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_role public.app_role;
  v_cur public.po_status;
begin
  v_role := public.require_role('admin', 'purchasing');
  select status into v_cur from public.purchase_orders where id = p_id for update;
  if not found then raise exception 'Orden no encontrada'; end if;
  if v_cur = p_status then return; end if;

  if not (
    (v_cur = 'draft' and p_status in ('pending_approval', 'approved', 'cancelled')) or
    (v_cur = 'pending_approval' and p_status in ('draft', 'approved', 'cancelled')) or
    (v_cur = 'approved' and p_status in ('sent', 'cancelled', 'draft')) or
    (v_cur = 'sent' and p_status in ('cancelled'))
  ) then
    raise exception 'Transición no permitida: % → %', v_cur, p_status;
  end if;
  if p_status = 'approved' and v_role <> 'admin' then
    raise exception 'Sólo un administrador puede aprobar órdenes' using errcode = '42501';
  end if;
  if p_status = 'cancelled' then
    if coalesce(trim(p_reason), '') = '' then raise exception 'Indique el motivo de cancelación'; end if;
    if exists (select 1 from public.goods_receipts where purchase_order_id = p_id and status = 'confirmed') then
      raise exception 'La orden tiene recepciones confirmadas; anúlelas antes de cancelar';
    end if;
  end if;

  update public.purchase_orders
     set status = p_status,
         approved_by = case when p_status = 'approved' then auth.uid() when p_status = 'draft' then null else approved_by end,
         approved_at = case when p_status = 'approved' then now() when p_status = 'draft' then null else approved_at end,
         sent_at = case when p_status = 'sent' then now() else sent_at end,
         cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end,
         cancel_reason = case when p_status = 'cancelled' then p_reason else cancel_reason end
   where id = p_id;
end $$;

create or replace function public.refresh_po_status(p_po_id uuid)
returns void
language plpgsql security definer
set search_path = public as $$
declare v_all boolean; v_any boolean; v_cur public.po_status;
begin
  select status into v_cur from public.purchase_orders where id = p_po_id;
  if v_cur in ('draft', 'pending_approval', 'cancelled') then return; end if;
  select bool_and(received_quantity >= quantity), bool_or(received_quantity > 0)
    into v_all, v_any
    from public.purchase_order_items where purchase_order_id = p_po_id;
  update public.purchase_orders
     set status = case when v_all then 'received'
                       when v_any then 'partially_received'
                       when sent_at is not null then 'sent'
                       else 'approved' end::public.po_status
   where id = p_po_id;
end $$;
revoke all on function public.refresh_po_status(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Facturas: guardar revisión (cabecera + líneas) de forma atómica.
-- ---------------------------------------------------------------------
create or replace function public.save_invoice_review(p_invoice_id uuid, p_header jsonb, p_items jsonb)
returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_status public.invoice_status;
  v_item jsonb;
  v_line int := 0;
begin
  perform public.require_role('admin', 'purchasing');
  select status into v_status from public.invoices where id = p_invoice_id for update;
  if not found then raise exception 'Factura no encontrada'; end if;
  if v_status not in ('uploaded', 'processing', 'ocr_failed', 'needs_review') then
    raise exception 'La factura está % y no puede editarse', v_status;
  end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'Líneas inválidas'; end if;

  update public.invoices set
    supplier_id       = nullif(p_header ->> 'supplier_id', '')::uuid,
    supplier_name_raw = coalesce(nullif(p_header ->> 'supplier_name_raw', ''), supplier_name_raw),
    invoice_number    = nullif(trim(p_header ->> 'invoice_number'), ''),
    issue_date        = nullif(p_header ->> 'issue_date', '')::date,
    due_date          = nullif(p_header ->> 'due_date', '')::date,
    po_number_raw     = nullif(p_header ->> 'po_number_raw', ''),
    purchase_order_id = nullif(p_header ->> 'purchase_order_id', '')::uuid,
    currency          = coalesce(nullif(p_header ->> 'currency', ''), currency),
    subtotal          = nullif(p_header ->> 'subtotal', '')::numeric,
    discount_total    = coalesce(nullif(p_header ->> 'discount_total', '')::numeric, 0),
    tax_total         = coalesce(nullif(p_header ->> 'tax_total', '')::numeric, 0),
    freight_total     = coalesce(nullif(p_header ->> 'freight_total', '')::numeric, 0),
    other_charges     = coalesce(nullif(p_header ->> 'other_charges', '')::numeric, 0),
    total             = nullif(p_header ->> 'total', '')::numeric,
    payment_terms     = nullif(p_header ->> 'payment_terms', ''),
    notes             = nullif(p_header ->> 'notes', ''),
    status            = 'needs_review'
  where id = p_invoice_id;

  delete from public.invoice_items where invoice_id = p_invoice_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_line := v_line + 1;
    if coalesce(trim(v_item ->> 'original_description'), '') = '' then
      raise exception 'Línea %: la descripción original es obligatoria', v_line;
    end if;
    insert into public.invoice_items (
      invoice_id, line_no, supplier_code, original_description, product_id, match_method, match_score,
      match_confirmed, brand, quantity, unit, unit_raw, package_description, conversion_factor,
      unit_price, discount, tax, line_total, ocr_confidence, review_note)
    values (
      p_invoice_id, v_line,
      nullif(v_item ->> 'supplier_code', ''),
      v_item ->> 'original_description',
      nullif(v_item ->> 'product_id', '')::uuid,
      nullif(v_item ->> 'match_method', '')::public.match_method,
      nullif(v_item ->> 'match_score', '')::numeric,
      coalesce((v_item ->> 'match_confirmed')::boolean, false) and nullif(v_item ->> 'product_id', '') is not null,
      nullif(v_item ->> 'brand', ''),
      coalesce(nullif(v_item ->> 'quantity', '')::numeric, 0),
      nullif(v_item ->> 'unit', ''),
      nullif(v_item ->> 'unit_raw', ''),
      nullif(v_item ->> 'package_description', ''),
      coalesce(nullif(v_item ->> 'conversion_factor', '')::numeric, 1),
      coalesce(nullif(v_item ->> 'unit_price', '')::numeric, 0),
      coalesce(nullif(v_item ->> 'discount', '')::numeric, 0),
      coalesce(nullif(v_item ->> 'tax', '')::numeric, 0),
      coalesce(nullif(v_item ->> 'line_total', '')::numeric, 0),
      nullif(v_item ->> 'ocr_confidence', '')::numeric,
      nullif(v_item ->> 'review_note', ''));
  end loop;
end $$;

-- Validación compartida por la pantalla de revisión y la confirmación.
create or replace function public.validate_invoice(p_invoice_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public as $$
declare
  inv public.invoices;
  s public.app_settings;
  v_lines_sum numeric;
  v_items int;
  v_unmatched int;
  v_invalid int;
  v_line_mismatch int;
  v_computed numeric;
  v_issues jsonb := '[]'::jsonb;
  v_blocking jsonb := '[]'::jsonb;
  v_dups jsonb;
  v_total_diff numeric;
  v_subtotal_diff numeric;
begin
  perform public.require_role('admin', 'purchasing');
  select * into inv from public.invoices where id = p_invoice_id;
  if not found then raise exception 'Factura no encontrada'; end if;
  select * into s from public.app_settings where id = 1;

  select count(*), coalesce(sum(line_total), 0),
         count(*) filter (where product_id is null or not match_confirmed),
         count(*) filter (where quantity <= 0 or unit_price < 0 or line_total < 0),
         count(*) filter (where abs(round(quantity * unit_price - discount, 2) - line_total) > greatest(s.total_tolerance, 0.01))
    into v_items, v_lines_sum, v_unmatched, v_invalid, v_line_mismatch
    from public.invoice_items where invoice_id = p_invoice_id;

  if inv.supplier_id is null then v_blocking := v_blocking || jsonb_build_object('code', 'supplier', 'message', 'Seleccione el proveedor'); end if;
  if inv.invoice_number is null then v_blocking := v_blocking || jsonb_build_object('code', 'number', 'message', 'Falta el número de factura'); end if;
  if inv.issue_date is null then v_blocking := v_blocking || jsonb_build_object('code', 'date', 'message', 'Falta la fecha de emisión'); end if;
  if inv.total is null then v_blocking := v_blocking || jsonb_build_object('code', 'total', 'message', 'Falta el total de la factura'); end if;
  if v_items = 0 then v_blocking := v_blocking || jsonb_build_object('code', 'items', 'message', 'La factura no tiene líneas'); end if;
  if v_unmatched > 0 then
    v_blocking := v_blocking || jsonb_build_object('code', 'unmatched', 'message',
      format('%s línea(s) sin producto del catálogo confirmado', v_unmatched));
  end if;
  if v_invalid > 0 then
    v_blocking := v_blocking || jsonb_build_object('code', 'invalid_lines', 'message',
      format('%s línea(s) con cantidad, precio o importe inválido', v_invalid));
  end if;
  if inv.due_date is not null and inv.issue_date is not null and inv.due_date < inv.issue_date then
    v_issues := v_issues || jsonb_build_object('code', 'due_date', 'message', 'La fecha de vencimiento es anterior a la emisión');
  end if;
  if inv.issue_date is not null and inv.issue_date > current_date + 1 then
    v_issues := v_issues || jsonb_build_object('code', 'future_date', 'message', 'La fecha de emisión está en el futuro');
  end if;

  -- Totales
  v_computed := v_lines_sum - inv.discount_total + inv.tax_total + inv.freight_total + inv.other_charges;
  v_total_diff := case when inv.total is null then null else round(inv.total - v_computed, 2) end;
  v_subtotal_diff := case when inv.subtotal is null then null else round(inv.subtotal - v_lines_sum, 2) end;

  -- Duplicados (mismo proveedor + número, o mismo archivo)
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'invoice_number', d.invoice_number,
                                               'issue_date', d.issue_date, 'total', d.total, 'status', d.status,
                                               'reason', d.reason)), '[]'::jsonb)
    into v_dups
    from (
      select i.id, i.invoice_number, i.issue_date, i.total, i.status, 'Mismo proveedor y número' as reason
        from public.invoices i
       where i.id <> inv.id and i.status <> 'voided' and inv.supplier_id is not null
         and i.supplier_id = inv.supplier_id and i.normalized_number = inv.normalized_number
         and inv.normalized_number <> ''
      union
      select i.id, i.invoice_number, i.issue_date, i.total, i.status, 'Mismo archivo' as reason
        from public.invoices i
       where i.id <> inv.id and i.status <> 'voided' and inv.file_sha256 is not null and i.file_sha256 = inv.file_sha256
      union
      select i.id, i.invoice_number, i.issue_date, i.total, i.status, 'Mismo proveedor, fecha y total' as reason
        from public.invoices i
       where i.id <> inv.id and i.status <> 'voided' and inv.supplier_id is not null
         and i.supplier_id = inv.supplier_id and i.issue_date = inv.issue_date and i.total = inv.total
    ) d;

  if exists (select 1 from jsonb_array_elements(v_dups) e
              where e ->> 'status' = 'confirmed' and e ->> 'reason' = 'Mismo proveedor y número') then
    v_blocking := v_blocking || jsonb_build_object('code', 'duplicate', 'message',
      'Ya existe una factura confirmada de este proveedor con el mismo número');
  elsif jsonb_array_length(v_dups) > 0 then
    v_issues := v_issues || jsonb_build_object('code', 'possible_duplicate', 'message', 'Posible factura duplicada; verifique antes de confirmar');
  end if;

  return jsonb_build_object(
    'lines_count', v_items,
    'lines_sum', v_lines_sum,
    'computed_total', v_computed,
    'total_diff', v_total_diff,
    'subtotal_diff', v_subtotal_diff,
    'line_mismatch_count', v_line_mismatch,
    'totals_ok', coalesce(abs(v_total_diff) <= s.total_tolerance, false)
                 and coalesce(abs(v_subtotal_diff) <= s.total_tolerance, true)
                 and v_line_mismatch = 0,
    'tolerance', s.total_tolerance,
    'unmatched_count', v_unmatched,
    'blocking', v_blocking,
    'warnings', v_issues,
    'duplicates', v_dups
  );
end $$;

-- ---------------------------------------------------------------------
-- Confirmar factura: historial de costos + inventario + aprendizaje.
-- Idempotente: las restricciones únicas por línea impiden duplicados.
-- ---------------------------------------------------------------------
create or replace function public.confirm_invoice(p_invoice_id uuid, p_exception_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  v_role public.app_role;
  inv public.invoices;
  s public.app_settings;
  v_check jsonb;
  it record;
  v_lines_sum numeric;
  v_line_tax_sum numeric;
  v_count int;
  w numeric;
  v_inv_qty numeric;
  v_norm numeric;
  a_disc numeric; a_freight numeric; a_other numeric; a_tax numeric;
  v_eff numeric;
  v_cost_rows int := 0;
  v_mov_rows int := 0;
  v_rc int;
  v_policy jsonb;
begin
  v_role := public.require_role('admin', 'purchasing');

  select * into inv from public.invoices where id = p_invoice_id for update;
  if not found then raise exception 'Factura no encontrada'; end if;
  if inv.status = 'confirmed' then raise exception 'La factura ya fue confirmada'; end if;
  if inv.status <> 'needs_review' then
    raise exception 'La factura debe estar en revisión para confirmarse (estado actual: %)', inv.status;
  end if;
  select * into s from public.app_settings where id = 1;

  v_check := public.validate_invoice(p_invoice_id);
  if jsonb_array_length(v_check -> 'blocking') > 0 then
    raise exception 'No se puede confirmar: %',
      (select string_agg(e ->> 'message', '; ') from jsonb_array_elements(v_check -> 'blocking') e);
  end if;

  if not (v_check ->> 'totals_ok')::boolean then
    if coalesce(trim(p_exception_note), '') = '' then
      raise exception 'Los totales no cuadran (diferencia total: %, subtotal: %, líneas inconsistentes: %). Corrija los datos o documente una excepción.',
        v_check ->> 'total_diff', coalesce(v_check ->> 'subtotal_diff', 'n/d'), v_check ->> 'line_mismatch_count';
    end if;
    if v_role <> 'admin' then
      raise exception 'Sólo un administrador puede confirmar con diferencias en los totales' using errcode = '42501';
    end if;
    if length(trim(p_exception_note)) < 10 then
      raise exception 'La justificación de la excepción debe ser descriptiva (mínimo 10 caracteres)';
    end if;
  end if;

  v_policy := jsonb_build_object(
    'include_freight', s.cost_include_freight,
    'include_discounts', s.cost_include_discounts,
    'include_nonrecoverable_tax', s.cost_include_nonrecoverable_tax,
    'include_other_charges', s.cost_include_other_charges);

  select coalesce(sum(line_total), 0), coalesce(sum(tax), 0), count(*)
    into v_lines_sum, v_line_tax_sum, v_count
    from public.invoice_items where invoice_id = p_invoice_id;

  for it in select * from public.invoice_items where invoice_id = p_invoice_id order by line_no loop
    w := case when v_lines_sum > 0 then it.line_total / v_lines_sum else 1.0 / v_count end;
    v_inv_qty := round(it.quantity * it.conversion_factor, 4);
    v_norm := round(it.line_total / v_inv_qty, 6);
    a_disc := round(inv.discount_total * w, 2);
    a_freight := round(inv.freight_total * w, 2);
    a_other := round(inv.other_charges * w, 2);
    a_tax := case when v_line_tax_sum > 0 then it.tax else round(inv.tax_total * w, 2) end;
    v_eff := round((it.line_total
                    - case when s.cost_include_discounts then a_disc else 0 end
                    + case when s.cost_include_freight then a_freight else 0 end
                    + case when s.cost_include_other_charges then a_other else 0 end
                    + case when s.cost_include_nonrecoverable_tax then a_tax else 0 end) / v_inv_qty, 6);

    if s.cost_update_source = 'invoice' then
      insert into public.product_cost_history (
        product_id, supplier_id, invoice_id, invoice_item_id, purchase_date, document_number,
        quantity, unit, conversion_factor, inventory_quantity, package_price, normalized_unit_cost,
        line_discount, line_tax, allocated_discount, allocated_freight, allocated_other, allocated_tax,
        effective_unit_cost, cost_policy, currency)
      values (
        it.product_id, inv.supplier_id, inv.id, it.id, inv.issue_date, inv.invoice_number,
        it.quantity, it.unit, it.conversion_factor, v_inv_qty, it.unit_price, v_norm,
        it.discount, it.tax, a_disc, a_freight, a_other, a_tax,
        v_eff, v_policy, inv.currency)
      on conflict (invoice_item_id) do nothing;
      get diagnostics v_rc = row_count;
      v_cost_rows := v_cost_rows + v_rc;
    end if;

    if s.inventory_entry_source = 'invoice' then
      insert into public.inventory_movements (product_id, movement_type, quantity, unit_cost, source_type, source_id, source_line_id, reason, created_by)
      values (it.product_id, 'receipt', v_inv_qty, v_eff, 'invoice', inv.id, it.id,
              'Factura ' || inv.invoice_number, auth.uid())
      on conflict (source_type, source_line_id) where source_line_id is not null and movement_type <> 'reversal' do nothing;
      get diagnostics v_rc = row_count;
      v_mov_rows := v_mov_rows + v_rc;
    end if;

    -- Aprendizaje: asociación confirmada descripción → producto
    insert into public.product_aliases (product_id, supplier_id, description, units_per_package, last_confirmed_by)
    values (it.product_id, inv.supplier_id, it.original_description, it.conversion_factor, auth.uid())
    on conflict (coalesce(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid), normalized_description)
    do update set product_id = excluded.product_id,
                  units_per_package = excluded.units_per_package,
                  times_confirmed = public.product_aliases.times_confirmed + 1,
                  last_confirmed_by = excluded.last_confirmed_by;

    if it.supplier_code is not null and trim(it.supplier_code) <> '' then
      insert into public.product_supplier_codes (product_id, supplier_id, supplier_code, supplier_description, purchase_unit, units_per_package, created_by)
      values (it.product_id, inv.supplier_id, trim(it.supplier_code), it.original_description, it.unit, it.conversion_factor, auth.uid())
      on conflict (supplier_id, upper(supplier_code)) where supplier_code is not null and supplier_code <> ''
      do update set product_id = excluded.product_id,
                    supplier_description = excluded.supplier_description,
                    purchase_unit = excluded.purchase_unit,
                    units_per_package = excluded.units_per_package;
    end if;
  end loop;

  perform public.refresh_product_cost(pid)
    from (select distinct product_id as pid from public.invoice_items where invoice_id = p_invoice_id) x;

  update public.invoices
     set status = 'confirmed',
         confirmed_by = auth.uid(),
         confirmed_at = now(),
         total_exception_note = case when (v_check ->> 'totals_ok')::boolean then null else trim(p_exception_note) end,
         total_exception_by = case when (v_check ->> 'totals_ok')::boolean then null else auth.uid() end
   where id = p_invoice_id;

  insert into public.invoice_processing_logs (invoice_id, level, event, detail, created_by)
  values (p_invoice_id, 'info', 'confirmed',
          jsonb_build_object('cost_rows', v_cost_rows, 'movement_rows', v_mov_rows,
                             'totals_ok', v_check -> 'totals_ok', 'total_diff', v_check -> 'total_diff'),
          auth.uid());

  return jsonb_build_object('cost_rows', v_cost_rows, 'movement_rows', v_mov_rows);
end $$;

-- ---------------------------------------------------------------------
-- Anular factura: revierte inventario y costos sin borrar el historial.
-- ---------------------------------------------------------------------
create or replace function public.void_invoice(p_invoice_id uuid, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  v_role public.app_role;
  inv public.invoices;
  v_rev int := 0;
begin
  v_role := public.require_role('admin', 'purchasing');
  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'Indique el motivo de la anulación (mínimo 5 caracteres)';
  end if;

  select * into inv from public.invoices where id = p_invoice_id for update;
  if not found then raise exception 'Factura no encontrada'; end if;
  if inv.status = 'voided' then raise exception 'La factura ya está anulada'; end if;
  if inv.status = 'confirmed' and v_role <> 'admin' then
    raise exception 'Sólo un administrador puede anular facturas confirmadas' using errcode = '42501';
  end if;
  if exists (select 1 from public.payments where invoice_id = p_invoice_id and not voided) then
    raise exception 'La factura tiene pagos registrados; anule primero los pagos';
  end if;

  if inv.status = 'confirmed' then
    insert into public.inventory_movements (product_id, movement_type, quantity, unit_cost, source_type, source_id, source_line_id, reverses_movement_id, reason, created_by)
    select m.product_id, 'reversal', -m.quantity, m.unit_cost, 'void', inv.id, m.source_line_id, m.id,
           'Anulación factura ' || inv.invoice_number || ': ' || p_reason, auth.uid()
      from public.inventory_movements m
     where m.source_type = 'invoice' and m.source_id = inv.id and m.movement_type <> 'reversal'
       and not exists (select 1 from public.inventory_movements r where r.reverses_movement_id = m.id);
    get diagnostics v_rev = row_count;

    update public.product_cost_history set voided = true, voided_at = now()
     where invoice_id = inv.id and not voided;

    perform public.refresh_product_cost(pid)
      from (select distinct product_id as pid from public.invoice_items where invoice_id = inv.id) x;
  end if;

  perform set_config('app.invoice_rpc', 'on', true);
  update public.invoices
     set status = 'voided', voided_by = auth.uid(), voided_at = now(), void_reason = trim(p_reason)
   where id = p_invoice_id;
  perform set_config('app.invoice_rpc', 'off', true);

  insert into public.invoice_processing_logs (invoice_id, level, event, detail, created_by)
  values (p_invoice_id, 'warning', 'voided', jsonb_build_object('reason', p_reason, 'previous_status', inv.status, 'reversed_movements', v_rev), auth.uid());

  return jsonb_build_object('reversed_movements', v_rev, 'previous_status', inv.status);
end $$;

-- ---------------------------------------------------------------------
-- Recepciones de mercancía
-- p_receipt: {purchase_order_id?, invoice_id?, supplier_id, received_at, notes}
-- p_items: [{purchase_order_item_id?, product_id, ordered_quantity, received_quantity, unit,
--            conversion_factor, ordered_unit_price, unit_price, is_extra, difference_reason}]
-- ---------------------------------------------------------------------
create or replace function public.create_goods_receipt(p_receipt jsonb, p_items jsonb, p_confirm boolean default true)
returns uuid
language plpgsql security definer
set search_path = public as $$
declare
  v_id uuid;
  v_item jsonb;
  v_po public.purchase_orders;
  v_supplier uuid := nullif(p_receipt ->> 'supplier_id', '')::uuid;
begin
  perform public.require_role('admin', 'purchasing');
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La recepción no tiene líneas';
  end if;

  if nullif(p_receipt ->> 'purchase_order_id', '') is not null then
    select * into v_po from public.purchase_orders where id = (p_receipt ->> 'purchase_order_id')::uuid for update;
    if not found then raise exception 'Orden no encontrada'; end if;
    if v_po.status not in ('approved', 'sent', 'partially_received') then
      raise exception 'Sólo se reciben órdenes aprobadas, enviadas o parcialmente recibidas (estado: %)', v_po.status;
    end if;
    v_supplier := v_po.supplier_id;
  end if;
  if v_supplier is null then raise exception 'Indique el proveedor'; end if;

  insert into public.goods_receipts (purchase_order_id, invoice_id, supplier_id, received_at, notes, created_by)
  values (v_po.id, nullif(p_receipt ->> 'invoice_id', '')::uuid, v_supplier,
          coalesce(nullif(p_receipt ->> 'received_at', '')::date, current_date),
          nullif(p_receipt ->> 'notes', ''), auth.uid())
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if (v_item ->> 'received_quantity')::numeric < 0 then raise exception 'Cantidad recibida negativa'; end if;
    if nullif(v_item ->> 'purchase_order_item_id', '') is not null and not exists (
      select 1 from public.purchase_order_items
       where id = (v_item ->> 'purchase_order_item_id')::uuid and purchase_order_id = v_po.id) then
      raise exception 'Línea de orden inválida';
    end if;
    insert into public.goods_receipt_items (
      goods_receipt_id, purchase_order_item_id, product_id, ordered_quantity, received_quantity, unit,
      conversion_factor, ordered_unit_price, unit_price, is_extra, difference_reason)
    values (
      v_id, nullif(v_item ->> 'purchase_order_item_id', '')::uuid, (v_item ->> 'product_id')::uuid,
      coalesce(nullif(v_item ->> 'ordered_quantity', '')::numeric, 0),
      coalesce(nullif(v_item ->> 'received_quantity', '')::numeric, 0),
      v_item ->> 'unit',
      coalesce(nullif(v_item ->> 'conversion_factor', '')::numeric, 1),
      nullif(v_item ->> 'ordered_unit_price', '')::numeric,
      nullif(v_item ->> 'unit_price', '')::numeric,
      coalesce((v_item ->> 'is_extra')::boolean, false),
      nullif(v_item ->> 'difference_reason', ''));
  end loop;

  if p_confirm then
    perform public.confirm_goods_receipt(v_id);
  end if;
  return v_id;
end $$;

create or replace function public.confirm_goods_receipt(p_receipt_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  r public.goods_receipts;
  s public.app_settings;
  it record;
  v_inv_qty numeric;
  v_cost numeric;
  v_mov int := 0;
  v_cost_rows int := 0;
  v_rc int;
begin
  perform public.require_role('admin', 'purchasing');
  select * into r from public.goods_receipts where id = p_receipt_id for update;
  if not found then raise exception 'Recepción no encontrada'; end if;
  if r.status <> 'draft' then raise exception 'La recepción ya está %', r.status; end if;
  select * into s from public.app_settings where id = 1;

  for it in select * from public.goods_receipt_items where goods_receipt_id = p_receipt_id loop
    continue when it.received_quantity <= 0;
    v_inv_qty := round(it.received_quantity * it.conversion_factor, 4);
    v_cost := case when it.unit_price is null then null else round(it.unit_price / it.conversion_factor, 6) end;

    if s.inventory_entry_source = 'receipt' then
      insert into public.inventory_movements (product_id, movement_type, quantity, unit_cost, source_type, source_id, source_line_id, reason, created_by)
      values (it.product_id, 'receipt', v_inv_qty, v_cost, 'goods_receipt', r.id, it.id, 'Recepción ' || r.receipt_number, auth.uid())
      on conflict (source_type, source_line_id) where source_line_id is not null and movement_type <> 'reversal' do nothing;
      get diagnostics v_rc = row_count;
      v_mov := v_mov + v_rc;
    end if;

    if s.cost_update_source = 'receipt' and it.unit_price is not null then
      insert into public.product_cost_history (
        product_id, supplier_id, goods_receipt_id, goods_receipt_item_id, purchase_date, document_number,
        quantity, unit, conversion_factor, inventory_quantity, package_price, normalized_unit_cost,
        effective_unit_cost, cost_policy, currency)
      values (it.product_id, r.supplier_id, r.id, it.id, r.received_at, r.receipt_number,
              it.received_quantity, it.unit, it.conversion_factor, v_inv_qty, it.unit_price, v_cost,
              v_cost, jsonb_build_object('source', 'receipt'), (select currency from public.app_settings where id = 1))
      on conflict (goods_receipt_item_id) do nothing;
      get diagnostics v_rc = row_count;
      v_cost_rows := v_cost_rows + v_rc;
    end if;

    if it.purchase_order_item_id is not null then
      update public.purchase_order_items
         set received_quantity = received_quantity + it.received_quantity
       where id = it.purchase_order_item_id;
    end if;
  end loop;

  update public.goods_receipts set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now()
   where id = p_receipt_id;

  if r.purchase_order_id is not null then
    perform public.refresh_po_status(r.purchase_order_id);
  end if;
  perform public.refresh_product_cost(pid)
     from (select distinct product_id as pid from public.goods_receipt_items where goods_receipt_id = p_receipt_id) x
    where s.cost_update_source = 'receipt';

  return jsonb_build_object('movement_rows', v_mov, 'cost_rows', v_cost_rows);
end $$;

create or replace function public.void_goods_receipt(p_receipt_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public as $$
declare r public.goods_receipts; it record;
begin
  perform public.require_role('admin');
  if coalesce(length(trim(p_reason)), 0) < 5 then raise exception 'Indique el motivo de la anulación'; end if;
  select * into r from public.goods_receipts where id = p_receipt_id for update;
  if not found then raise exception 'Recepción no encontrada'; end if;
  if r.status = 'voided' then raise exception 'La recepción ya está anulada'; end if;

  if r.status = 'confirmed' then
    insert into public.inventory_movements (product_id, movement_type, quantity, unit_cost, source_type, source_id, source_line_id, reverses_movement_id, reason, created_by)
    select m.product_id, 'reversal', -m.quantity, m.unit_cost, 'void', r.id, m.source_line_id, m.id,
           'Anulación ' || r.receipt_number || ': ' || p_reason, auth.uid()
      from public.inventory_movements m
     where m.source_type = 'goods_receipt' and m.source_id = r.id and m.movement_type <> 'reversal'
       and not exists (select 1 from public.inventory_movements x where x.reverses_movement_id = m.id);

    update public.product_cost_history set voided = true, voided_at = now()
     where goods_receipt_id = r.id and not voided;

    for it in select * from public.goods_receipt_items where goods_receipt_id = r.id and purchase_order_item_id is not null loop
      update public.purchase_order_items
         set received_quantity = greatest(received_quantity - it.received_quantity, 0)
       where id = it.purchase_order_item_id;
    end loop;
    if r.purchase_order_id is not null then perform public.refresh_po_status(r.purchase_order_id); end if;
    perform public.refresh_product_cost(pid)
       from (select distinct product_id as pid from public.goods_receipt_items where goods_receipt_id = r.id) x;
  end if;

  update public.goods_receipts set status = 'voided', voided_by = auth.uid(), voided_at = now(), void_reason = trim(p_reason)
   where id = p_receipt_id;
end $$;

-- ---------------------------------------------------------------------
-- Movimientos manuales de inventario
-- ---------------------------------------------------------------------
create or replace function public.record_inventory_movement(
  p_product_id uuid, p_type public.movement_type, p_quantity numeric, p_reason text default null)
returns bigint
language plpgsql security definer
set search_path = public as $$
declare
  v_role public.app_role;
  v_qty numeric;
  v_stock numeric;
  v_id bigint;
begin
  v_role := public.require_role('admin', 'purchasing', 'employee');
  if p_quantity is null or p_quantity <= 0 then raise exception 'La cantidad debe ser mayor que cero'; end if;
  if p_type in ('receipt', 'reversal') then
    raise exception 'Las entradas por compra y los reversos se generan desde facturas o recepciones';
  end if;
  if v_role = 'employee' and p_type not in ('sale', 'issue', 'damage', 'loss') then
    raise exception 'Su rol sólo puede registrar ventas, consumos, daños o pérdidas' using errcode = '42501';
  end if;
  if p_type in ('adjustment_in', 'adjustment_out', 'damage', 'loss', 'return_supplier') and coalesce(length(trim(p_reason)), 0) < 3 then
    raise exception 'Indique el motivo del movimiento';
  end if;

  select current_stock into v_stock from public.products where id = p_product_id and active for update;
  if not found then raise exception 'Producto no encontrado o inactivo'; end if;

  v_qty := case when p_type = 'adjustment_in' then p_quantity else -p_quantity end;
  if v_stock + v_qty < 0 and v_role <> 'admin' then
    raise exception 'Existencias insuficientes (disponible: %)', v_stock;
  end if;

  insert into public.inventory_movements (product_id, movement_type, quantity, unit_cost, source_type, reason, created_by)
  values (p_product_id, p_type, v_qty,
          (select coalesce(effective_unit_cost, normalized_unit_cost) from public.products where id = p_product_id),
          'manual', nullif(trim(p_reason), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Pagos
-- ---------------------------------------------------------------------
create or replace function public.void_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public as $$
begin
  perform public.require_role('admin');
  if coalesce(length(trim(p_reason)), 0) < 5 then raise exception 'Indique el motivo'; end if;
  update public.payments set voided = true, voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
   where id = p_payment_id and not voided;
  if not found then raise exception 'Pago no encontrado o ya anulado'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Búsqueda de candidatos para vincular líneas de factura con productos.
-- Devuelve coincidencias por prioridad: código de barras/SKU, código del
-- proveedor, alias confirmados y similitud de nombre (trigramas).
-- ---------------------------------------------------------------------
create or replace function public.match_product_candidates(
  p_supplier_id uuid, p_code text, p_description text, p_alt_description text default null, p_limit int default 5)
returns table (product_id uuid, method public.match_method, score numeric, matched_text text)
language plpgsql stable security invoker
set search_path = public, extensions as $$
declare
  v_code text := nullif(upper(trim(coalesce(p_code, ''))), '');
  v_desc text := public.normalize_text(p_description);
  v_alt text := public.normalize_text(p_alt_description);
begin
  return query
  with c as (
    select p.id, 'barcode'::public.match_method as m, 1.0::numeric as sc, p.barcode as t
      from public.products p where v_code is not null and p.barcode = v_code and p.active
    union all
    select p.id, 'sku', 1.0, p.sku from public.products p where v_code is not null and upper(p.sku) = v_code and p.active
    union all
    select psc.product_id, 'supplier_code', 0.99, psc.supplier_code
      from public.product_supplier_codes psc
     where v_code is not null and p_supplier_id is not null and psc.supplier_id = p_supplier_id and upper(psc.supplier_code) = v_code
    union all
    select a.product_id, 'alias', case when a.supplier_id = p_supplier_id then 0.97 else 0.9 end, a.description
      from public.product_aliases a
     where v_desc is not null and a.normalized_description = v_desc
       and (a.supplier_id = p_supplier_id or a.supplier_id is null or p_supplier_id is null)
    union all
    select a.product_id, 'alias', round((similarity(a.normalized_description, v_desc) * 0.85)::numeric, 4), a.description
      from public.product_aliases a
     where v_desc is not null and a.normalized_description % v_desc and a.normalized_description <> v_desc
    union all
    select p.id, 'fuzzy', round(greatest(similarity(p.normalized_name, v_desc), coalesce(similarity(p.normalized_name, v_alt), 0))::numeric * 0.8, 4), p.name
      from public.products p
     where p.active and (
       (v_desc is not null and p.normalized_name % v_desc) or
       (v_alt is not null and p.normalized_name % v_alt))
  )
  select b.id, b.m, b.sc, b.t
    from (select distinct on (c.id) c.id, c.m, c.sc, c.t from c order by c.id, c.sc desc) b
   order by b.sc desc
   limit p_limit;
end $$;

-- >>> supabase/migrations/20261028000004_reporting.sql
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

-- >>> supabase/migrations/20261028000005_rls.sql
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

-- Pantalla pública de registro: sólo necesita saber si ya hay usuarios.
grant execute on function public.has_any_user() to anon, authenticated;

-- >>> supabase/migrations/20261028000006_storage.sql
-- =====================================================================
-- Migración 6: almacenamiento privado de facturas.
-- Bucket privado (public = false): los archivos sólo se consultan con
-- URLs firmadas de corta duración generadas en el servidor.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoices', 'invoices', false, 15728640,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy invoices_files_select on storage.objects for select to authenticated
  using (bucket_id = 'invoices' and public.has_role('admin', 'purchasing'));

create policy invoices_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'invoices' and public.has_role('admin', 'purchasing'));

-- Los documentos originales no se reemplazan ni se borran desde la API.
