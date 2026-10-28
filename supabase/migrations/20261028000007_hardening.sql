-- =====================================================================
-- Migración 7: endurecimiento según el asesor de seguridad de Supabase.
-- * search_path fijo en funciones de trigger.
-- * Las funciones de trigger no se exponen como RPC.
-- Las RPC de negocio siguen ejecutables por usuarios autenticados a
-- propósito: cada una valida el rol con require_role().
-- =====================================================================

alter function public.set_updated_at() set search_path = public;
alter function public.block_mutation() set search_path = public;
alter function public.protect_product_stock() set search_path = public;
alter function public.protect_invoice_changes() set search_path = public;
alter function public.protect_invoice_items() set search_path = public;

revoke execute on function public.apply_inventory_movement() from public, anon, authenticated;
revoke execute on function public.audit_trigger() from public, anon, authenticated;
revoke execute on function public.protect_profile_changes() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.block_mutation() from public, anon, authenticated;
revoke execute on function public.protect_product_stock() from public, anon, authenticated;
revoke execute on function public.protect_invoice_changes() from public, anon, authenticated;
revoke execute on function public.protect_invoice_items() from public, anon, authenticated;
