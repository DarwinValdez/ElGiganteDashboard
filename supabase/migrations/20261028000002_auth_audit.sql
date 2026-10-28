-- =====================================================================
-- Migración 2: perfiles/roles, auditoría y triggers de integridad.
-- =====================================================================

-- Rol del usuario autenticado (null si no tiene perfil activo).
create or replace function public.current_app_role()
returns public.app_role
language sql stable security definer
set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.has_role(variadic p_roles public.app_role[])
returns boolean
language sql stable security definer
set search_path = public as $$
  select coalesce(public.current_app_role() = any (p_roles), false)
$$;

create or replace function public.require_role(variadic p_roles public.app_role[])
returns public.app_role
language plpgsql stable security definer
set search_path = public as $$
declare v_role public.app_role;
begin
  v_role := public.current_app_role();
  if v_role is null then
    raise exception 'No autenticado o usuario inactivo' using errcode = '42501';
  end if;
  if not (v_role = any (p_roles)) then
    raise exception 'Permiso denegado para el rol %', v_role using errcode = '42501';
  end if;
  return v_role;
end $$;

-- ---------------------------------------------------------------------
-- Alta automática de perfil. El primer usuario es administrador.
-- El rol de los siguientes lo asigna un administrador (app_metadata.role),
-- nunca el propio usuario (user_metadata no se usa para el rol).
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public as $$
declare
  v_role public.app_role := 'employee';
  v_meta text := new.raw_app_meta_data ->> 'role';
begin
  if not exists (select 1 from public.profiles) then
    v_role := 'admin';
  elsif v_meta in ('admin', 'purchasing', 'employee') then
    v_role := v_meta::public.app_role;
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)), v_role)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Sólo un administrador cambia rol/estado; siempre debe quedar un admin activo.
create or replace function public.protect_profile_changes()
returns trigger
language plpgsql security definer
set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.active is distinct from old.active or new.email is distinct from old.email) then
    -- auth.uid() nulo = llamada de servicio (service role / SQL) → permitido
    if auth.uid() is not null and not public.has_role('admin') then
      raise exception 'Sólo un administrador puede cambiar roles o estados' using errcode = '42501';
    end if;
    if old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active) then
      if not exists (select 1 from public.profiles where role = 'admin' and active and id <> old.id) then
        raise exception 'Debe existir al menos un administrador activo';
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_changes();

-- ---------------------------------------------------------------------
-- Auditoría genérica
-- ---------------------------------------------------------------------
create or replace function public.audit_trigger()
returns trigger
language plpgsql security definer
set search_path = public as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_id text;
  v_action text := lower(tg_op);
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_before := to_jsonb(old) - 'ocr_raw' - 'updated_at';
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_after := to_jsonb(new) - 'ocr_raw' - 'updated_at';
  end if;
  if tg_op = 'UPDATE' and v_before = v_after then
    return new;
  end if;
  v_id := coalesce(v_after ->> 'id', v_before ->> 'id');
  if tg_op = 'UPDATE' and (v_before ->> 'status') is distinct from (v_after ->> 'status') then
    v_action := 'status:' || coalesce(v_after ->> 'status', '');
  end if;

  insert into public.audit_logs (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), v_action, tg_table_name, v_id, v_before, v_after);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'app_settings', 'categories', 'suppliers', 'products', 'product_supplier_codes',
    'purchase_orders', 'invoices', 'goods_receipts', 'payments'
  ] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_trigger()',
                   t || '_audit', t);
  end loop;
end $$;

create or replace function public.log_audit(p_action text, p_entity text, p_entity_id text, p_summary text, p_after jsonb default null)
returns void
language sql security definer
set search_path = public as $$
  insert into public.audit_logs (actor_id, action, entity, entity_id, summary, after)
  values (auth.uid(), p_action, p_entity, p_entity_id, p_summary, p_after);
$$;
revoke all on function public.log_audit(text, text, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Inventario: el stock se deriva exclusivamente de los movimientos.
-- ---------------------------------------------------------------------
create or replace function public.apply_inventory_movement()
returns trigger
language plpgsql security definer
set search_path = public as $$
begin
  update public.products set current_stock = current_stock + new.quantity where id = new.product_id;
  return new;
end $$;

create trigger inventory_movements_apply after insert on public.inventory_movements
  for each row execute function public.apply_inventory_movement();

create or replace function public.block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Los registros de % son inmutables; use un movimiento de reverso', tg_table_name;
end $$;

create trigger inventory_movements_immutable before update or delete on public.inventory_movements
  for each row execute function public.block_mutation();
create trigger audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function public.block_mutation();

-- El stock sólo cambia vía movimientos (bloquea edición directa por la API).
create or replace function public.protect_product_stock()
returns trigger language plpgsql as $$
begin
  if new.current_stock is distinct from old.current_stock and pg_trigger_depth() <= 1 then
    raise exception 'El stock sólo se modifica mediante movimientos de inventario';
  end if;
  return new;
end $$;
create trigger products_protect_stock before update on public.products
  for each row execute function public.protect_product_stock();

-- Las facturas confirmadas/anuladas no se editan directamente.
create or replace function public.protect_invoice_changes()
returns trigger language plpgsql as $$
begin
  if old.status in ('confirmed', 'voided') and pg_trigger_depth() <= 1
     and current_setting('app.invoice_rpc', true) is distinct from 'on' then
    raise exception 'La factura % está % y no puede modificarse', coalesce(old.invoice_number, old.id::text), old.status;
  end if;
  return new;
end $$;
create trigger invoices_protect before update on public.invoices
  for each row execute function public.protect_invoice_changes();

create or replace function public.protect_invoice_items()
returns trigger language plpgsql as $$
declare v_status public.invoice_status;
begin
  select status into v_status from public.invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if v_status in ('confirmed', 'voided') then
    raise exception 'No se pueden modificar líneas de una factura %', v_status;
  end if;
  return coalesce(new, old);
end $$;
create trigger invoice_items_protect before insert or update or delete on public.invoice_items
  for each row execute function public.protect_invoice_items();
