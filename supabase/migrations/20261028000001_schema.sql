-- =====================================================================
-- EL GIGANTE SUPERMARKET — Esquema principal
-- Migración 1: extensiones, tipos, tablas, índices y triggers básicos.
-- Todas las cantidades monetarias usan numeric(14,4) (costos unitarios
-- con 4 decimales) o numeric(14,2) (totales de documentos).
-- =====================================================================

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type public.app_role as enum ('admin', 'purchasing', 'employee');

create type public.unit_kind as enum ('count', 'weight', 'volume', 'length', 'other');

create type public.po_status as enum (
  'draft', 'pending_approval', 'approved', 'sent',
  'partially_received', 'received', 'cancelled'
);

create type public.invoice_status as enum (
  'uploaded',      -- archivo almacenado, sin procesar
  'processing',    -- OCR en curso
  'ocr_failed',    -- OCR falló; se puede reintentar o capturar manualmente
  'needs_review',  -- datos extraídos/capturados pendientes de revisión
  'confirmed',     -- confirmada: genera historial de costos e inventario
  'voided'         -- anulada con auditoría
);

create type public.receipt_status as enum ('draft', 'confirmed', 'voided');

create type public.movement_type as enum (
  'receipt',         -- entrada por recepción/factura
  'sale',            -- salida por venta
  'issue',           -- salida interna / consumo
  'adjustment_in',   -- ajuste positivo
  'adjustment_out',  -- ajuste negativo
  'damage',          -- daño
  'loss',            -- pérdida / merma
  'return_supplier', -- devolución a proveedor
  'reversal'         -- reverso por anulación de documento
);

create type public.match_method as enum (
  'barcode', 'sku', 'supplier_code', 'alias', 'brand_presentation',
  'name_unit', 'fuzzy', 'manual', 'created'
);

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Normaliza texto para búsquedas: minúsculas, sin acentos, sin signos.
create or replace function public.normalize_text(p text)
returns text language sql immutable parallel safe
set search_path = public, extensions as $$
  select nullif(
    trim(regexp_replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p, ''))),
                        '[^a-z0-9]+', ' ', 'g')),
    '')
$$;

-- ---------------------------------------------------------------------
-- Perfiles y configuración
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  role        public.app_role not null default 'employee',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.app_settings (
  id                         smallint primary key default 1 check (id = 1),
  company_name               text not null default 'EL GIGANTE SUPERMARKET',
  currency                   char(3) not null default 'USD',
  -- Política de costo efectivo
  cost_include_freight       boolean not null default true,   -- transporte / cargos
  cost_include_discounts     boolean not null default true,   -- descuentos de factura
  cost_include_nonrecoverable_tax boolean not null default false, -- impuestos no recuperables
  cost_include_other_charges boolean not null default true,
  -- Qué documento actualiza el costo y qué documento genera la entrada de inventario
  cost_update_source         text not null default 'invoice' check (cost_update_source in ('invoice', 'receipt')),
  inventory_entry_source     text not null default 'invoice' check (inventory_entry_source in ('invoice', 'receipt')),
  -- Tolerancia de diferencia entre total calculado e impreso
  total_tolerance            numeric(14,2) not null default 0.05 check (total_tolerance >= 0),
  payments_enabled           boolean not null default true,
  default_tax_rate           numeric(7,4) not null default 0 check (default_tax_rate >= 0),
  updated_at                 timestamptz not null default now(),
  updated_by                 uuid references public.profiles (id)
);
insert into public.app_settings (id) values (1);

-- ---------------------------------------------------------------------
-- Catálogos base
-- ---------------------------------------------------------------------
create table public.units (
  code        text primary key check (code ~ '^[a-z0-9_]+$'),
  name        text not null,
  kind        public.unit_kind not null,
  -- factor a la unidad base de su tipo (count: unidad, weight: kg, volume: litro)
  -- null = unidad de empaque sin conversión fija (caja, paquete, saco...)
  base_factor numeric(18,8) check (base_factor is null or base_factor > 0),
  is_package  boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

insert into public.units (code, name, kind, base_factor, is_package) values
  ('unidad',  'Unidad',     'count',  1,          false),
  ('botella', 'Botella',    'count',  1,          false),
  ('lata',    'Lata',       'count',  1,          false),
  ('docena',  'Docena',     'count',  12,         false),
  ('caja',    'Caja',       'count',  null,       true),
  ('paquete', 'Paquete',    'count',  null,       true),
  ('saco',    'Saco',       'count',  null,       true),
  ('fardo',   'Fardo',      'count',  null,       true),
  ('bandeja', 'Bandeja',    'count',  null,       true),
  ('lb',      'Libra',      'weight', 0.45359237, false),
  ('kg',      'Kilogramo',  'weight', 1,          false),
  ('oz',      'Onza',       'weight', 0.02834952, false),
  ('g',       'Gramo',      'weight', 0.001,      false),
  ('gal',     'Galón',      'volume', 3.78541178, false),
  ('l',       'Litro',      'volume', 1,          false),
  ('ml',      'Mililitro',  'volume', 0.001,      false),
  ('floz',    'Onza fluida','volume', 0.02957353, false);

create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  parent_id   uuid references public.categories (id) on delete set null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index categories_name_uq on public.categories (lower(name));

-- ---------------------------------------------------------------------
-- Proveedores
-- ---------------------------------------------------------------------
create table public.suppliers (
  id              uuid primary key default gen_random_uuid(),
  trade_name      text not null,
  legal_name      text,
  tax_id          text,
  contact_name    text,
  phone           text,
  email           text,
  address         text,
  payment_terms   text,
  payment_days    integer check (payment_days is null or payment_days >= 0),
  notes           text,
  active          boolean not null default true,
  normalized_name text generated always as (public.normalize_text(trade_name)) stored,
  created_by      uuid references public.profiles (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index suppliers_tax_id_uq on public.suppliers (lower(tax_id)) where tax_id is not null and tax_id <> '';
create index suppliers_name_trgm on public.suppliers using gin (normalized_name extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------
-- Productos
-- ---------------------------------------------------------------------
create sequence public.product_sku_seq start 1000;

create table public.products (
  id                    uuid primary key default gen_random_uuid(),
  sku                   text not null default ('P' || lpad(nextval('public.product_sku_seq')::text, 6, '0')),
  barcode               text,
  name                  text not null,
  category_id           uuid references public.categories (id) on delete set null,
  brand                 text,
  purchase_unit         text not null references public.units (code),
  inventory_unit        text not null references public.units (code),
  -- unidades de inventario contenidas en una unidad de compra (ej. caja de 12 botellas = 12)
  units_per_package     numeric(14,4) not null default 1 check (units_per_package > 0),
  -- presentación de cada unidad de inventario (ej. botella de 1 L → 1, 'l')
  size_value            numeric(14,4) check (size_value is null or size_value > 0),
  size_unit             text references public.units (code),
  default_supplier_id   uuid references public.suppliers (id) on delete set null,
  last_purchase_price   numeric(14,4),          -- precio por unidad de compra (antes de impuestos)
  normalized_unit_cost  numeric(14,6),          -- costo por unidad de inventario (antes de impuestos)
  effective_unit_cost   numeric(14,6),          -- costo efectivo según política
  last_purchase_date    date,
  last_supplier_id      uuid references public.suppliers (id) on delete set null,
  sale_price            numeric(14,4) check (sale_price is null or sale_price >= 0), -- independiente del costo
  min_stock             numeric(14,4) not null default 0 check (min_stock >= 0),
  current_stock         numeric(14,4) not null default 0,
  below_min             boolean generated always as (min_stock > 0 and current_stock <= min_stock) stored,
  active                boolean not null default true,
  notes                 text,
  normalized_name       text generated always as (public.normalize_text(name)) stored,
  created_by            uuid references public.profiles (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index products_sku_uq on public.products (upper(sku));
create unique index products_barcode_uq on public.products (barcode) where barcode is not null and barcode <> '';
create index products_category_idx on public.products (category_id);
create index products_supplier_idx on public.products (default_supplier_id);
create index products_name_trgm on public.products using gin (normalized_name extensions.gin_trgm_ops);
create index products_active_idx on public.products (active);
create index products_below_min_idx on public.products (below_min) where below_min;

-- Código y descripción que un proveedor usa para un producto del catálogo.
create table public.product_supplier_codes (
  id                    uuid primary key default gen_random_uuid(),
  product_id            uuid not null references public.products (id) on delete cascade,
  supplier_id           uuid not null references public.suppliers (id) on delete cascade,
  supplier_code         text,
  supplier_description  text,
  purchase_unit         text references public.units (code),
  units_per_package     numeric(14,4) check (units_per_package is null or units_per_package > 0),
  created_by            uuid references public.profiles (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index psc_supplier_code_uq on public.product_supplier_codes (supplier_id, upper(supplier_code))
  where supplier_code is not null and supplier_code <> '';
create index psc_product_idx on public.product_supplier_codes (product_id);

-- Asociaciones confirmadas "descripción de factura → producto" (aprendizaje).
create table public.product_aliases (
  id                      uuid primary key default gen_random_uuid(),
  product_id              uuid not null references public.products (id) on delete cascade,
  supplier_id             uuid references public.suppliers (id) on delete cascade,
  description             text not null,
  normalized_description  text generated always as (public.normalize_text(description)) stored,
  units_per_package       numeric(14,4),
  times_confirmed         integer not null default 1,
  last_confirmed_by       uuid references public.profiles (id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create unique index product_aliases_uq
  on public.product_aliases (coalesce(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid), normalized_description);
create index product_aliases_trgm on public.product_aliases using gin (normalized_description extensions.gin_trgm_ops);
create index product_aliases_product_idx on public.product_aliases (product_id);

-- ---------------------------------------------------------------------
-- Órdenes de compra
-- ---------------------------------------------------------------------
create sequence public.po_number_seq start 1;

create table public.purchase_orders (
  id              uuid primary key default gen_random_uuid(),
  po_number       text not null unique default ('OC-' || lpad(nextval('public.po_number_seq')::text, 6, '0')),
  supplier_id     uuid not null references public.suppliers (id),
  status          public.po_status not null default 'draft',
  order_date      date not null default current_date,
  expected_date   date,
  currency        char(3) not null default 'USD',
  subtotal        numeric(14,2) not null default 0,
  discount_total  numeric(14,2) not null default 0,
  tax_total       numeric(14,2) not null default 0,
  total           numeric(14,2) not null default 0,
  notes           text,
  created_by      uuid references public.profiles (id),
  approved_by     uuid references public.profiles (id),
  approved_at     timestamptz,
  sent_at         timestamptz,
  cancelled_at    timestamptz,
  cancel_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index po_supplier_idx on public.purchase_orders (supplier_id);
create index po_status_idx on public.purchase_orders (status);
create index po_date_idx on public.purchase_orders (order_date desc);

create table public.purchase_order_items (
  id                  uuid primary key default gen_random_uuid(),
  purchase_order_id   uuid not null references public.purchase_orders (id) on delete cascade,
  line_no             integer not null,
  product_id          uuid not null references public.products (id),
  description         text,
  quantity            numeric(14,4) not null check (quantity > 0),
  unit                text not null references public.units (code),
  units_per_package   numeric(14,4) not null default 1 check (units_per_package > 0),
  unit_price          numeric(14,4) not null default 0 check (unit_price >= 0),
  discount            numeric(14,2) not null default 0 check (discount >= 0),
  tax_rate            numeric(7,4) not null default 0 check (tax_rate >= 0),
  line_total          numeric(14,2) not null default 0,
  received_quantity   numeric(14,4) not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (purchase_order_id, line_no)
);
create index poi_product_idx on public.purchase_order_items (product_id);

-- ---------------------------------------------------------------------
-- Facturas de proveedores
-- ---------------------------------------------------------------------
create table public.invoices (
  id                    uuid primary key default gen_random_uuid(),
  supplier_id           uuid references public.suppliers (id),
  supplier_name_raw     text,                         -- nombre tal como aparece en la factura
  invoice_number        text,
  normalized_number     text generated always as (upper(regexp_replace(coalesce(invoice_number, ''), '[^A-Za-z0-9]', '', 'g'))) stored,
  issue_date            date,
  due_date              date,
  po_number_raw         text,
  purchase_order_id     uuid references public.purchase_orders (id) on delete set null,
  currency              char(3) not null default 'USD',
  subtotal              numeric(14,2),
  discount_total        numeric(14,2) not null default 0 check (discount_total >= 0),
  tax_total             numeric(14,2) not null default 0 check (tax_total >= 0),
  freight_total         numeric(14,2) not null default 0 check (freight_total >= 0),
  other_charges         numeric(14,2) not null default 0 check (other_charges >= 0),
  total                 numeric(14,2),
  payment_terms         text,
  status                public.invoice_status not null default 'uploaded',
  -- Documento original (bucket privado 'invoices')
  file_path             text,
  file_name             text,
  file_mime             text,
  file_size             bigint check (file_size is null or file_size > 0),
  file_sha256           text,
  -- Resultado del OCR
  ocr_provider          text,
  ocr_model             text,
  ocr_raw               jsonb,
  ocr_confidence        numeric(5,4),
  ocr_error             text,
  ocr_attempts          integer not null default 0,
  ocr_processed_at      timestamptz,
  warnings              jsonb not null default '[]'::jsonb,
  -- Excepción documentada cuando los totales no cuadran
  total_exception_note  text,
  total_exception_by    uuid references public.profiles (id),
  notes                 text,
  uploaded_by           uuid references public.profiles (id),
  confirmed_by          uuid references public.profiles (id),
  confirmed_at          timestamptz,
  voided_by             uuid references public.profiles (id),
  voided_at             timestamptz,
  void_reason           text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint invoices_void_reason_chk check (status <> 'voided' or (void_reason is not null and length(trim(void_reason)) >= 5)),
  constraint invoices_confirmed_chk check (status not in ('confirmed') or (supplier_id is not null and invoice_number is not null and issue_date is not null and total is not null))
);
-- Una factura confirmada por proveedor + número (las anuladas no bloquean).
create unique index invoices_supplier_number_uq on public.invoices (supplier_id, normalized_number)
  where status = 'confirmed';
create index invoices_status_idx on public.invoices (status);
create index invoices_supplier_idx on public.invoices (supplier_id);
create index invoices_issue_date_idx on public.invoices (issue_date desc);
create index invoices_sha_idx on public.invoices (file_sha256);
create index invoices_po_idx on public.invoices (purchase_order_id);

create table public.invoice_items (
  id                    uuid primary key default gen_random_uuid(),
  invoice_id            uuid not null references public.invoices (id) on delete cascade,
  line_no               integer not null,
  supplier_code         text,
  original_description  text not null,              -- se conserva siempre
  product_id            uuid references public.products (id),
  match_method          public.match_method,
  match_score           numeric(5,4),
  match_confirmed       boolean not null default false,
  brand                 text,
  quantity              numeric(14,4) not null default 0,
  unit                  text references public.units (code),
  unit_raw              text,
  package_description   text,
  -- unidades de inventario por cada unidad facturada (ej. caja 12/1 → 12)
  conversion_factor     numeric(14,6) not null default 1 check (conversion_factor > 0),
  unit_price            numeric(14,4) not null default 0,
  discount              numeric(14,2) not null default 0 check (discount >= 0),
  tax                   numeric(14,2) not null default 0 check (tax >= 0),
  line_total            numeric(14,2) not null default 0,
  ocr_confidence        numeric(5,4),
  review_note           text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (invoice_id, line_no)
);
create index invoice_items_product_idx on public.invoice_items (product_id);

create table public.invoice_processing_logs (
  id          bigint generated always as identity primary key,
  invoice_id  uuid not null references public.invoices (id) on delete cascade,
  level       text not null check (level in ('info', 'warning', 'error')),
  event       text not null,
  detail      jsonb,
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now()
);
create index ipl_invoice_idx on public.invoice_processing_logs (invoice_id, created_at desc);

-- ---------------------------------------------------------------------
-- Recepciones de mercancía
-- ---------------------------------------------------------------------
create sequence public.receipt_number_seq start 1;

create table public.goods_receipts (
  id                  uuid primary key default gen_random_uuid(),
  receipt_number      text not null unique default ('REC-' || lpad(nextval('public.receipt_number_seq')::text, 6, '0')),
  purchase_order_id   uuid references public.purchase_orders (id),
  invoice_id          uuid references public.invoices (id),
  supplier_id         uuid not null references public.suppliers (id),
  status              public.receipt_status not null default 'draft',
  received_at         date not null default current_date,
  notes               text,
  created_by          uuid references public.profiles (id),
  confirmed_by        uuid references public.profiles (id),
  confirmed_at        timestamptz,
  voided_by           uuid references public.profiles (id),
  voided_at           timestamptz,
  void_reason         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index gr_po_idx on public.goods_receipts (purchase_order_id);
create index gr_supplier_idx on public.goods_receipts (supplier_id);

create table public.goods_receipt_items (
  id                      uuid primary key default gen_random_uuid(),
  goods_receipt_id        uuid not null references public.goods_receipts (id) on delete cascade,
  purchase_order_item_id  uuid references public.purchase_order_items (id),
  product_id              uuid not null references public.products (id),
  ordered_quantity        numeric(14,4) not null default 0,
  received_quantity       numeric(14,4) not null check (received_quantity >= 0),
  unit                    text not null references public.units (code),
  conversion_factor       numeric(14,6) not null default 1 check (conversion_factor > 0),
  ordered_unit_price      numeric(14,4),
  unit_price              numeric(14,4) check (unit_price is null or unit_price >= 0),
  is_extra                boolean not null default false, -- producto no solicitado
  difference_reason       text,
  created_at              timestamptz not null default now()
);
create index gri_receipt_idx on public.goods_receipt_items (goods_receipt_id);
create index gri_product_idx on public.goods_receipt_items (product_id);

-- ---------------------------------------------------------------------
-- Historial de costos (alimentado sólo por documentos confirmados)
-- ---------------------------------------------------------------------
create table public.product_cost_history (
  id                    uuid primary key default gen_random_uuid(),
  product_id            uuid not null references public.products (id),
  supplier_id           uuid not null references public.suppliers (id),
  invoice_id            uuid references public.invoices (id),
  invoice_item_id       uuid unique references public.invoice_items (id),
  goods_receipt_id      uuid references public.goods_receipts (id),
  goods_receipt_item_id uuid unique references public.goods_receipt_items (id),
  purchase_date         date not null,
  document_number       text,
  quantity              numeric(14,4) not null,
  unit                  text references public.units (code),
  conversion_factor     numeric(14,6) not null,
  inventory_quantity    numeric(14,4) not null,
  package_price         numeric(14,4) not null,   -- precio por unidad facturada, antes de impuestos
  normalized_unit_cost  numeric(14,6) not null,   -- precio neto de línea / unidades de inventario
  line_discount         numeric(14,2) not null default 0,
  line_tax              numeric(14,2) not null default 0,
  allocated_discount    numeric(14,2) not null default 0,
  allocated_freight     numeric(14,2) not null default 0,
  allocated_other       numeric(14,2) not null default 0,
  allocated_tax         numeric(14,2) not null default 0,
  effective_unit_cost   numeric(14,6) not null,   -- según política configurada
  cost_policy           jsonb not null,
  currency              char(3) not null default 'USD',
  voided                boolean not null default false,
  voided_at             timestamptz,
  created_at            timestamptz not null default now(),
  constraint pch_source_chk check (invoice_item_id is not null or goods_receipt_item_id is not null)
);
create index pch_product_date_idx on public.product_cost_history (product_id, purchase_date desc, created_at desc) where not voided;
create index pch_supplier_idx on public.product_cost_history (supplier_id);

-- ---------------------------------------------------------------------
-- Inventario
-- ---------------------------------------------------------------------
create table public.inventory_movements (
  id                    bigint generated always as identity primary key,
  product_id            uuid not null references public.products (id),
  movement_type         public.movement_type not null,
  quantity              numeric(14,4) not null check (quantity <> 0), -- con signo, en unidad de inventario
  unit_cost             numeric(14,6),
  source_type           text not null default 'manual' check (source_type in ('manual', 'invoice', 'goods_receipt', 'void')),
  source_id             uuid,
  source_line_id        uuid,
  reverses_movement_id  bigint references public.inventory_movements (id),
  reason                text,
  created_by            uuid references public.profiles (id),
  created_at            timestamptz not null default now(),
  constraint im_sign_chk check (
    (movement_type in ('receipt', 'adjustment_in') and quantity > 0) or
    (movement_type in ('sale', 'issue', 'adjustment_out', 'damage', 'loss', 'return_supplier') and quantity < 0) or
    (movement_type = 'reversal')
  )
);
-- Evita duplicar entradas de un mismo documento/línea.
create unique index im_source_line_uq on public.inventory_movements (source_type, source_line_id)
  where source_line_id is not null and movement_type <> 'reversal';
-- Cada movimiento se revierte una sola vez.
create unique index im_reverses_uq on public.inventory_movements (reverses_movement_id) where reverses_movement_id is not null;
create index im_product_date_idx on public.inventory_movements (product_id, created_at desc);
create index im_created_idx on public.inventory_movements (created_at desc);

-- ---------------------------------------------------------------------
-- Pagos a proveedores
-- ---------------------------------------------------------------------
create table public.payments (
  id            uuid primary key default gen_random_uuid(),
  supplier_id   uuid not null references public.suppliers (id),
  invoice_id    uuid references public.invoices (id),
  amount        numeric(14,2) not null check (amount > 0),
  currency      char(3) not null default 'USD',
  paid_at       date not null default current_date,
  method        text not null default 'transferencia',
  reference     text,
  notes         text,
  voided        boolean not null default false,
  voided_at     timestamptz,
  voided_by     uuid references public.profiles (id),
  void_reason   text,
  created_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index payments_supplier_idx on public.payments (supplier_id, paid_at desc);
create index payments_invoice_idx on public.payments (invoice_id);

-- ---------------------------------------------------------------------
-- Auditoría
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles (id) on delete set null,
  action      text not null,
  entity      text not null,
  entity_id   text,
  summary     text,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz not null default now()
);
create index audit_logs_entity_idx on public.audit_logs (entity, entity_id);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

-- ---------------------------------------------------------------------
-- Triggers updated_at
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'categories', 'suppliers', 'products', 'product_supplier_codes',
    'product_aliases', 'purchase_orders', 'purchase_order_items', 'invoices',
    'invoice_items', 'goods_receipts', 'payments'
  ] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   t || '_updated_at', t);
  end loop;
end $$;
