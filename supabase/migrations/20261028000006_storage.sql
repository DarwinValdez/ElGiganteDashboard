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
