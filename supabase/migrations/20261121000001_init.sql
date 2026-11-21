-- =====================================================================
-- Rectingeniería · Esquema de base de datos v1
-- Destino: Supabase (PostgreSQL 15+). Moneda: COP en enteros (sin decimales).
-- Medidas en milímetros con 3 decimales. Fechas en timestamptz (zona America/Bogota en la UI).
--
-- Principio: el navegador NUNCA cambia estados, totales ni saldos directamente.
-- Todo cambio de una OT pasa por funciones (RPC) que validan las reglas del negocio
-- y escriben el historial. Así ninguna pantalla puede saltarse el flujo.
--
-- Marcado "PENDIENTE": decisiones del brief (sección 11) aún sin confirmar.
-- =====================================================================

-- ---------- Tipos ----------
create type user_role         as enum ('admin', 'technician');
create type customer_type     as enum ('individual', 'company');            -- particular / empresa
create type id_type           as enum ('CC', 'NIT', 'CE', 'PP', 'other');   -- cédula, NIT, cédula extranjería, pasaporte
create type fuel_type         as enum ('diesel', 'gasoline', 'gas', 'other', 'unspecified');
create type wo_status         as enum (
  'reception',          -- Recepción
  'diagnosis',          -- Diagnóstico
  'awaiting_approval',  -- Cotización enviada / esperando aprobación (PENDIENTE: el brief lista 2 estados; aquí se unen)
  'in_progress',        -- En proceso
  'quality_control',    -- En control de calidad
  'ready',              -- Listo para entregar
  'delivered',          -- Entregado / cerrado          (terminal)
  'rejected'            -- Rechazado / devolución        (terminal)
);
create type payment_terms     as enum ('cash', 'credit');                   -- contado / crédito
create type quote_kind        as enum ('quote', 'rejection_settlement');    -- cotización / liquidación por rechazo
create type quote_status      as enum ('draft', 'sent', 'approved', 'rejected', 'superseded');
create type approval_channel  as enum ('whatsapp', 'in_person', 'phone_call', 'other');
create type approval_decision as enum ('approved', 'rejected');
create type qc_result         as enum ('passed', 'failed');
create type payment_method    as enum ('cash', 'transfer');                 -- efectivo / transferencia
create type attachment_kind   as enum ('part_photo', 'approval_evidence', 'payment_receipt', 'delivery_photo', 'other');
create type measurement_section as enum ('block', 'crankshaft', 'cylinder_head', 'guides_valves',
  'connecting_rods', 'camshaft', 'flywheel', 'pistons', 'other');
create type handover_kind     as enum ('delivery', 'return');               -- entrega / devolución
create type invoice_sync      as enum ('manual', 'pending', 'synced', 'error');

-- ---------- Usuarios ----------
create table profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null check (length(trim(full_name)) > 0),
  email       text,
  role        user_role not null default 'technician',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create function app_uid() returns uuid language sql stable as $$ select auth.uid() $$;

create function app_is_active() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active)
$$;

create function app_is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active and role = 'admin')
$$;

create function app_require(p_admin boolean default false) returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not app_is_active() then raise exception 'Usuario no autorizado' using errcode = '42501'; end if;
  if p_admin and not app_is_admin() then raise exception 'Solo el administrador puede hacer esto' using errcode = '42501'; end if;
end $$;

-- ---------- Clientes, mecánicos y motores ----------
create table customers (
  id                uuid primary key default gen_random_uuid(),
  customer_type     customer_type not null default 'individual',
  name              text not null check (length(trim(name)) > 0),   -- nombre o razón social (único obligatorio)
  id_type           id_type,
  id_number         text,
  phone             text,
  address           text,
  email             text,
  -- Crédito: solo empresas autorizadas. Se cambia únicamente con customer_set_credit() (admin).
  credit_authorized boolean not null default false,
  credit_days       int not null default 30 check (credit_days > 0),
  credit_limit      bigint check (credit_limit >= 0),               -- PENDIENTE: si se usará límite de cupo
  created_by        uuid references profiles (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (not credit_authorized or customer_type = 'company'),
  check ((id_type is null) = (id_number is null))
);
create unique index customers_doc_uq on customers (id_type, id_number) where id_number is not null;  -- evita duplicados
create index customers_phone_idx on customers (phone);
create index customers_name_idx  on customers (lower(name));

create table mechanics (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  phone       text,                         -- quien suele autorizar por WhatsApp
  created_at  timestamptz not null default now()
);

create table engines (
  id             uuid primary key default gen_random_uuid(),
  brand          text not null check (length(trim(brand)) > 0),      -- obligatorio
  reference      text not null check (length(trim(reference)) > 0),  -- obligatorio
  serial_number  text,
  plate          text,
  fuel           fuel_type not null default 'unspecified',
  created_at     timestamptz not null default now()
);

-- ---------- Orden de trabajo ----------
create sequence work_order_number_seq start 1;  -- PENDIENTE: número inicial / formato que use la empresa

create table work_orders (
  id                     uuid primary key default gen_random_uuid(),
  number                 bigint not null unique default nextval('work_order_number_seq'),  -- único entre dispositivos
  customer_id            uuid not null references customers (id),
  engine_id              uuid not null unique references engines (id),
  mechanic_id            uuid not null references mechanics (id),
  status                 wo_status not null default 'reception',
  received_at            timestamptz not null default now(),
  received_by            uuid references profiles (id),
  general_notes          text,
  term_days              numeric(4,1) not null default 2 check (term_days > 0),   -- plazo tras aprobación, editable
  estimated_delivery_at  timestamptz,
  payment_terms          payment_terms not null default 'cash',
  credit_due_on          date,
  closed_at              timestamptz,
  updated_at             timestamptz not null default now(),
  check (credit_due_on is null or payment_terms = 'credit'),
  check ((status in ('delivered', 'rejected')) = (closed_at is not null))
);
create index work_orders_status_idx on work_orders (status);
create index work_orders_customer_idx on work_orders (customer_id);

-- Piezas recibidas (catálogo ampliable sin cambiar el esquema)
create table part_types (
  code    text primary key,
  name    text not null,
  sort    int not null default 0,
  active  boolean not null default true
);
insert into part_types (code, name, sort) values
  ('block', 'Bloque', 1), ('crankshaft', 'Cigüeñal', 2), ('cylinder_head', 'Culata', 3),
  ('connecting_rods', 'Bielas', 4), ('camshaft', 'Árbol de levas', 5), ('flywheel', 'Volante', 6), ('pistons', 'Pistones', 7);

create table received_parts (
  id               uuid primary key default gen_random_uuid(),
  work_order_id    uuid not null references work_orders (id) on delete cascade,
  part_type        text not null references part_types (code),
  received         boolean not null,
  condition_notes  text,
  unique (work_order_id, part_type)
);

-- Archivos: fotos, capturas de WhatsApp, comprobantes. El archivo vive en Supabase Storage (bucket privado);
-- aquí solo la ruta y metadatos. Nunca Base64 en la base de datos.
create table attachments (
  id                uuid primary key default gen_random_uuid(),
  work_order_id     uuid not null references work_orders (id) on delete cascade,
  received_part_id  uuid references received_parts (id) on delete cascade,
  kind              attachment_kind not null,
  storage_path      text not null unique,
  mime_type         text,
  size_bytes        bigint check (size_bytes >= 0),
  uploaded_by       uuid references profiles (id),
  created_at        timestamptz not null default now(),
  check (kind <> 'part_photo' or received_part_id is not null)
);

-- ---------- Diagnóstico ----------
create table diagnoses (
  work_order_id   uuid primary key references work_orders (id) on delete cascade,
  block_notes     text,
  crankshaft_notes text,
  head_notes      text,
  guides_notes    text,
  updated_by      uuid references profiles (id),
  updated_at      timestamptz not null default now()
);

-- Una fila por punto medido: cilindros, muñones, planitud... la cantidad depende del motor.
-- No se guardan tolerancias ni veredictos automáticos (el brief lo prohíbe sin especificaciones).
create table diagnostic_measurements (
  id             uuid primary key default gen_random_uuid(),
  work_order_id  uuid not null references work_orders (id) on delete cascade,
  section        measurement_section not null,
  point          text not null check (length(trim(point)) > 0),   -- p. ej. 'cilindro_1', 'bancada_3', 'biela_2', 'planitud'
  value_mm       numeric(9,3) check (value_mm >= 0),
  notes          text,
  unique (work_order_id, section, point)
);

-- ---------- Cotización ----------
create table service_concepts (
  code                     text primary key,
  name                     text not null,
  chargeable_on_rejection  boolean not null default false,
  allowed_in_quote         boolean not null default true,   -- false = solo se cobra en un rechazo
  sort                     int not null default 0,
  active                   boolean not null default true
);
insert into service_concepts (code, name, chargeable_on_rejection, allowed_in_quote, sort) values
  ('block',          'Rectificación de bloque',   false, true,  1),
  ('crankshaft',     'Rectificación de cigüeñal', false, true,  2),
  ('cylinder_head',  'Rectificación de culata',   false, true,  3),
  ('guides_valves',  'Guías / válvulas',          false, true,  4),
  ('washing',        'Lavado de piezas',          true,  true,  5),
  -- Diagnóstico: si se aprueba, va incluido en el total (no es línea aparte).
  -- Si se rechaza, se cobra solo si se decide en ese momento y por el valor que se indique.
  ('diagnosis',      'Diagnóstico',               true,  false, 6),
  ('connecting_rods','Bielas',                    false, true,  7),
  ('camshaft',       'Árbol de levas',            false, true,  8),
  ('flywheel',       'Volante',                   false, true,  9),
  ('pistons',        'Pistones',                  false, true,  10),
  ('parts_materials','Repuestos y materiales',    false, true,  11),
  ('other',          'Otro trabajo',              false, true,  12);   -- requiere descripción
-- Precios con IVA incluido: no hay línea de impuestos.
-- Sin concepto de "mano de obra": va incluida en cada precio.

create table quotes (
  id                  uuid primary key default gen_random_uuid(),
  work_order_id       uuid not null references work_orders (id) on delete cascade,
  version             int not null check (version > 0),
  kind                quote_kind not null default 'quote',
  status              quote_status not null default 'draft',
  total               bigint not null default 0 check (total >= 0),  -- lo mantiene un trigger
  notes_for_customer  text,
  valid_until         date,
  sent_at             timestamptz,
  sent_by             uuid references profiles (id),
  decided_at          timestamptz,
  created_by          uuid references profiles (id),
  created_at          timestamptz not null default now(),
  unique (work_order_id, version)
);
-- Solo una cotización "aprobada" por OT: es el documento que define cuánto se cobra.
create unique index quotes_one_approved_uq on quotes (work_order_id) where status = 'approved';
-- Solo un borrador abierto por OT.
create unique index quotes_one_draft_uq on quotes (work_order_id) where status = 'draft';

create table quote_items (
  id            uuid primary key default gen_random_uuid(),
  quote_id      uuid not null references quotes (id) on delete cascade,
  concept_code  text not null references service_concepts (code),
  description   text,
  amount        bigint not null check (amount >= 0),
  sort          int not null default 0
);

create table customer_approvals (
  id                      uuid primary key default gen_random_uuid(),
  work_order_id           uuid not null references work_orders (id) on delete cascade,
  quote_id                uuid not null unique references quotes (id),
  decision                approval_decision not null,
  authorized_by_name      text not null check (length(trim(authorized_by_name)) > 0),
  channel                 approval_channel not null,
  note                    text,
  evidence_attachment_id  uuid references attachments (id),   -- PENDIENTE: si la captura es obligatoria
  recorded_by             uuid references profiles (id),
  recorded_at             timestamptz not null default now()
);

-- ---------- Producción y calidad ----------
create table work_logs (            -- Fase 3: operaciones y responsables
  id             uuid primary key default gen_random_uuid(),
  work_order_id  uuid not null references work_orders (id) on delete cascade,
  operation      text not null,
  assignee_name  text,
  notes          text,
  started_at     timestamptz,
  finished_at    timestamptz,
  recorded_by    uuid references profiles (id),
  created_at     timestamptz not null default now()
);

create table quality_checks (
  id             uuid primary key default gen_random_uuid(),
  work_order_id  uuid not null references work_orders (id) on delete cascade,
  result         qc_result not null,
  notes          text,
  checked_by     uuid references profiles (id),
  checked_at     timestamptz not null default now()
);

-- ---------- Dinero ----------
-- Los pagos no se borran ni se editan: se anulan con motivo.
create table payments (
  id             uuid primary key default gen_random_uuid(),
  work_order_id  uuid not null references work_orders (id),
  amount         bigint not null check (amount > 0),
  method         payment_method not null,
  reference      text,
  receipt_attachment_id uuid references attachments (id),
  received_at    timestamptz not null default now(),
  recorded_by    uuid references profiles (id),
  voided_at      timestamptz,
  voided_by      uuid references profiles (id),
  void_reason    text,
  check ((voided_at is null) = (void_reason is null))
);
create index payments_wo_idx on payments (work_order_id);

create table invoices (
  id             uuid primary key default gen_random_uuid(),
  work_order_id  uuid not null references work_orders (id),
  provider       text not null default 'siigo',
  reference      text not null check (length(trim(reference)) > 0),  -- consecutivo SIIGO
  external_id    text,                                              -- para la integración (fase 5)
  sync_status    invoice_sync not null default 'manual',
  voided_at      timestamptz,
  created_by     uuid references profiles (id),
  created_at     timestamptz not null default now()
);
create unique index invoices_one_active_uq on invoices (work_order_id) where voided_at is null;
create unique index invoices_external_uq on invoices (provider, external_id) where external_id is not null;

create table handovers (            -- entrega (trabajo terminado) o devolución (rechazo)
  id                     uuid primary key default gen_random_uuid(),
  work_order_id          uuid not null unique references work_orders (id),
  kind                   handover_kind not null,
  received_by_name       text not null check (length(trim(received_by_name)) > 0),
  received_by_id_number  text,
  notes                  text,
  handed_over_at         timestamptz not null default now(),
  recorded_by            uuid references profiles (id)
);

-- ---------- Historial (solo lo escriben las funciones) ----------
create table work_order_events (
  id             bigint generated always as identity primary key,
  work_order_id  uuid not null references work_orders (id) on delete cascade,
  event_type     text not null,
  from_status    wo_status,
  to_status      wo_status,
  details        jsonb not null default '{}',
  actor          uuid references profiles (id),
  created_at     timestamptz not null default now()
);
create index wo_events_wo_idx on work_order_events (work_order_id, created_at);


-- =====================================================================
-- Calendario: festivos de Colombia y días hábiles (lunes a sábado)
-- Ley 51 de 1983 (Emiliani): ciertos festivos se trasladan al lunes siguiente.
-- 9 de julio (Virgen de Chiquinquirá) es festivo desde 2026 y también se traslada.
-- =====================================================================
create function app_today() returns date language sql stable as $$
  select (now() at time zone 'America/Bogota')::date
$$;

create function easter_sunday(p_year int) returns date language plpgsql immutable as $$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int; mo int; dy int;
begin
  a := p_year % 19; b := p_year / 100; c := p_year % 100; d := b / 4; e := b % 4;
  f := (b + 8) / 25; g := (b - f + 1) / 3; h := (19*a + b - d - g + 15) % 30;
  i := c / 4; k := c % 4; l := (32 + 2*e + 2*i - h - k) % 7; m := (a + 11*h + 22*l) / 451;
  mo := (h + l - 7*m + 114) / 31; dy := ((h + l - 7*m + 114) % 31) + 1;
  return make_date(p_year, mo, dy);
end $$;

create function next_monday(p date) returns date language sql immutable as $$
  select p + ((8 - extract(isodow from p)::int) % 7)
$$;

create function co_holidays(p_year int) returns table (day date, name text) language sql immutable as $$
  with e as (select easter_sunday(p_year) as es)
  select * from (values
    (make_date(p_year,1,1),  'Año Nuevo'),
    (make_date(p_year,5,1),  'Día del Trabajo'),
    (make_date(p_year,7,20), 'Día de la Independencia'),
    (make_date(p_year,8,7),  'Batalla de Boyacá'),
    (make_date(p_year,12,8), 'Inmaculada Concepción'),
    (make_date(p_year,12,25),'Navidad'),
    (next_monday(make_date(p_year,1,6)),   'Reyes Magos'),
    (next_monday(make_date(p_year,3,19)),  'San José'),
    (next_monday(make_date(p_year,6,29)),  'San Pedro y San Pablo'),
    (next_monday(make_date(p_year,8,15)),  'Asunción de la Virgen'),
    (next_monday(make_date(p_year,10,12)), 'Día de la Diversidad Étnica y Cultural'),
    (next_monday(make_date(p_year,11,1)),  'Todos los Santos'),
    (next_monday(make_date(p_year,11,11)), 'Independencia de Cartagena'),
    ((select es from e) - 3,  'Jueves Santo'),
    ((select es from e) - 2,  'Viernes Santo'),
    ((select es from e) + 43, 'Ascensión del Señor'),
    ((select es from e) + 64, 'Corpus Christi'),
    ((select es from e) + 71, 'Sagrado Corazón de Jesús')
  ) v(day, name)
  union all
  select next_monday(make_date(p_year,7,9)), 'Virgen del Rosario de Chiquinquirá' where p_year >= 2026
$$;

create function is_business_day(p date) returns boolean language sql immutable as $$
  select extract(isodow from p) <> 7
     and not exists (select 1 from co_holidays(extract(year from p)::int) h where h.day = p)
$$;

-- Suma días hábiles (acepta medios días: 1.5 = un día hábil y 12 horas). Se calcula en hora de Bogotá.
create function add_business_days(p_from timestamptz, p_days numeric) returns timestamptz language plpgsql stable as $$
declare v_local timestamp := p_from at time zone 'America/Bogota'; v_whole int := floor(p_days); v_n int := 0;
begin
  while v_n < v_whole loop
    v_local := v_local + interval '1 day';
    if is_business_day(v_local::date) then v_n := v_n + 1; end if;
  end loop;
  v_local := v_local + make_interval(secs => ((p_days - v_whole) * 86400)::double precision);
  while not is_business_day(v_local::date) loop v_local := v_local + interval '1 day'; end loop;
  return v_local at time zone 'America/Bogota';
end $$;

-- =====================================================================
-- Triggers de integridad
-- =====================================================================

-- Total de la cotización = suma de ítems. Una cotización que ya no es borrador no se puede tocar.
create function trg_quote_items_guard() returns trigger language plpgsql as $$
declare v_quote uuid := coalesce(new.quote_id, old.quote_id);
begin
  if (select status from quotes where id = v_quote) <> 'draft' then
    raise exception 'La cotización ya fue enviada o decidida: crea una nueva versión';
  end if;
  return coalesce(new, old);
end $$;
create trigger quote_items_guard before insert or update or delete on quote_items
  for each row execute function trg_quote_items_guard();

create function trg_quote_items_total() returns trigger language plpgsql as $$
declare v_quote uuid := coalesce(new.quote_id, old.quote_id);
begin
  update quotes set total = coalesce((select sum(amount) from quote_items where quote_id = v_quote), 0) where id = v_quote;
  return null;
end $$;
create trigger quote_items_total after insert or update or delete on quote_items
  for each row execute function trg_quote_items_total();

create function trg_touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger work_orders_touch before update on work_orders for each row execute function trg_touch_updated_at();
create trigger customers_touch   before update on customers   for each row execute function trg_touch_updated_at();

-- =====================================================================
-- Vista para tablero, listados y cartera
-- =====================================================================
create view v_work_orders with (security_invoker = true) as
with money as (
  select wo.id,
         (select q.total from quotes q where q.work_order_id = wo.id and q.status = 'approved') as billable,
         coalesce((select sum(p.amount) from payments p where p.work_order_id = wo.id and p.voided_at is null), 0) as paid
  from work_orders wo
)
select wo.id, wo.number, 'OT-' || lpad(wo.number::text, 4, '0') as code,
       wo.status, wo.received_at, wo.estimated_delivery_at, wo.closed_at,
       wo.payment_terms, wo.credit_due_on, wo.term_days,
       c.id as customer_id, c.name as customer_name, c.customer_type, c.id_type, c.id_number,
       c.phone as customer_phone, c.credit_authorized,
       (select i.reference from invoices i where i.work_order_id = wo.id and i.voided_at is null) as invoice_reference,
       m.id as mechanic_id, m.name as mechanic_name, m.phone as mechanic_phone,
       e.brand, e.reference, e.plate, e.serial_number,
       m2.billable, m2.paid,
       case when m2.billable is null then null else m2.billable - m2.paid end as balance,
       wo.status not in ('delivered', 'rejected') as is_open,
       (wo.status not in ('delivered', 'rejected') and wo.estimated_delivery_at < now()) as is_overdue,
       (wo.status = 'rejected' and not exists (select 1 from handovers h where h.work_order_id = wo.id)) as pending_return,
       case
         when m2.billable is null                    then 'no_amount'       -- aún no hay valor aprobado
         when m2.billable - m2.paid < 0              then 'credit_balance'  -- saldo a favor del cliente
         when m2.billable - m2.paid = 0              then 'settled'         -- paz y salvo
         when wo.status = 'delivered' and wo.payment_terms = 'credit' and wo.credit_due_on < current_date
                                                     then 'credit_overdue'  -- crédito vencido
         when wo.status = 'delivered' and wo.payment_terms = 'credit'
                                                     then 'credit_current'  -- entregado con crédito al día
         else 'pending'                                                     -- saldo por cobrar
       end as financial_status
from work_orders wo
join money m2      on m2.id = wo.id
join customers c   on c.id = wo.customer_id
join mechanics m   on m.id = wo.mechanic_id
join engines e     on e.id = wo.engine_id;

-- =====================================================================
-- Máquina de estados
-- =====================================================================
create function _log(p_wo uuid, p_type text, p_from wo_status, p_to wo_status, p_details jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into work_order_events (work_order_id, event_type, from_status, to_status, details, actor)
  values (p_wo, p_type, p_from, p_to, coalesce(p_details, '{}'), auth.uid());
$$;

create function _lock_wo(p_wo uuid) returns work_orders language plpgsql security definer set search_path = public as $$
declare r work_orders;
begin
  select * into r from work_orders where id = p_wo for update;
  if not found then raise exception 'OT no encontrada'; end if;
  return r;
end $$;

-- Transiciones permitidas. Cualquier otra se rechaza.
create function _allowed(p_from wo_status, p_to wo_status) returns boolean language sql immutable as $$
  select (p_from, p_to) in (
    ('reception','diagnosis'),
    ('diagnosis','awaiting_approval'),
    ('awaiting_approval','diagnosis'),         -- se retira la cotización para rehacerla
    ('awaiting_approval','in_progress'),       -- solo vía quote_approve
    ('awaiting_approval','rejected'),          -- solo vía quote_reject
    ('in_progress','quality_control'),
    ('quality_control','in_progress'),         -- calidad no aprobada
    ('quality_control','ready'),               -- solo con calidad aprobada
    ('ready','delivered')                      -- solo vía work_order_deliver
  )
$$;

create function _set_status(p_wo uuid, p_to wo_status, p_details jsonb default '{}') returns void
language plpgsql security definer set search_path = public as $$
declare v_from wo_status;
begin
  select status into v_from from work_orders where id = p_wo;
  if not _allowed(v_from, p_to) then
    raise exception 'Cambio de estado no permitido: % → %', v_from, p_to;
  end if;
  update work_orders
     set status = p_to,
         closed_at = case when p_to in ('delivered','rejected') then now() else null end
   where id = p_wo;
  perform _log(p_wo, 'status_change', v_from, p_to, p_details);
end $$;

-- =====================================================================
-- Funciones que usa la aplicación (RPC)
-- =====================================================================

-- 1. Recepción: crea motor, OT, piezas. Obligatorios: marca, referencia, mecánico, ≥1 pieza recibida.
create function work_order_create(
  p_customer_id uuid, p_mechanic_id uuid,
  p_brand text, p_reference text, p_serial text default null, p_plate text default null,
  p_fuel fuel_type default 'unspecified',
  p_parts jsonb default '[]',        -- [{"part_type":"block","received":true,"condition_notes":"..."}]
  p_general_notes text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_engine uuid; v_wo uuid; v_part jsonb;
begin
  perform app_require();
  if p_customer_id is null then raise exception 'Selecciona o crea el cliente'; end if;
  if coalesce(trim(p_brand),'') = '' or coalesce(trim(p_reference),'') = '' or p_mechanic_id is null then
    raise exception 'Marca, referencia y mecánico son obligatorios';
  end if;
  if not exists (select 1 from jsonb_array_elements(p_parts) x where (x->>'received')::boolean) then
    raise exception 'Marca al menos una pieza recibida';
  end if;
  insert into engines (brand, reference, serial_number, plate, fuel)
  values (trim(p_brand), trim(p_reference), nullif(trim(p_serial),''), nullif(upper(trim(p_plate)),''), p_fuel)
  returning id into v_engine;
  insert into work_orders (customer_id, engine_id, mechanic_id, received_by, general_notes)
  values (p_customer_id, v_engine, p_mechanic_id, auth.uid(), p_general_notes)
  returning id into v_wo;
  for v_part in select * from jsonb_array_elements(p_parts) loop
    insert into received_parts (work_order_id, part_type, received, condition_notes)
    values (v_wo, v_part->>'part_type', (v_part->>'received')::boolean, v_part->>'condition_notes');
  end loop;
  perform _log(v_wo, 'created', null, 'reception', jsonb_build_object('parts', p_parts));
  return v_wo;
end $$;

-- 1b. Corregir datos de recepción mientras la OT esté abierta
create function work_order_update_reception(
  p_wo uuid, p_mechanic_id uuid, p_brand text, p_reference text, p_serial text default null,
  p_plate text default null, p_fuel fuel_type default 'unspecified', p_parts jsonb default '[]', p_general_notes text default null
) returns void language plpgsql security definer set search_path = public as $$
declare r work_orders; v_part jsonb;
begin
  perform app_require();
  r := _lock_wo(p_wo);
  if r.status in ('delivered','rejected') then raise exception 'La OT ya está cerrada'; end if;
  if coalesce(trim(p_brand),'') = '' or coalesce(trim(p_reference),'') = '' or p_mechanic_id is null then
    raise exception 'Marca, referencia y mecánico son obligatorios';
  end if;
  update engines set brand = trim(p_brand), reference = trim(p_reference), serial_number = nullif(trim(p_serial),''),
         plate = nullif(upper(trim(p_plate)),''), fuel = p_fuel where id = r.engine_id;
  update work_orders set mechanic_id = p_mechanic_id, general_notes = p_general_notes where id = p_wo;
  for v_part in select * from jsonb_array_elements(p_parts) loop
    insert into received_parts (work_order_id, part_type, received, condition_notes)
    values (p_wo, v_part->>'part_type', (v_part->>'received')::boolean, v_part->>'condition_notes')
    on conflict (work_order_id, part_type) do update set received = excluded.received, condition_notes = excluded.condition_notes;
  end loop;
  if not exists (select 1 from received_parts where work_order_id = p_wo and received) then
    raise exception 'Marca al menos una pieza recibida';
  end if;
  perform _log(p_wo, 'reception_updated', r.status, r.status, '{}');
end $$;

-- 2. Diagnóstico: guarda observaciones y mediciones; la primera vez pasa a "Diagnóstico".
create function diagnosis_save(
  p_wo uuid, p_notes jsonb default '{}',          -- {"block_notes":"..", "crankshaft_notes":"..", ...}
  p_measurements jsonb default '[]'               -- [{"section":"block","point":"cilindro_1","value_mm":82.012}]
) returns void language plpgsql security definer set search_path = public as $$
declare r work_orders; v_m jsonb;
begin
  perform app_require();
  r := _lock_wo(p_wo);
  if r.status not in ('reception','diagnosis') then
    raise exception 'El diagnóstico solo se edita antes de enviar la cotización';
  end if;
  insert into diagnoses (work_order_id, block_notes, crankshaft_notes, head_notes, guides_notes, updated_by)
  values (p_wo, p_notes->>'block_notes', p_notes->>'crankshaft_notes', p_notes->>'head_notes', p_notes->>'guides_notes', auth.uid())
  on conflict (work_order_id) do update set
    block_notes = excluded.block_notes, crankshaft_notes = excluded.crankshaft_notes,
    head_notes = excluded.head_notes, guides_notes = excluded.guides_notes,
    updated_by = excluded.updated_by, updated_at = now();
  for v_m in select * from jsonb_array_elements(p_measurements) loop
    insert into diagnostic_measurements (work_order_id, section, point, value_mm, notes)
    values (p_wo, (v_m->>'section')::measurement_section, v_m->>'point', nullif(v_m->>'value_mm','')::numeric, v_m->>'notes')
    on conflict (work_order_id, section, point) do update set value_mm = excluded.value_mm, notes = excluded.notes;
  end loop;
  if r.status = 'reception' then
    perform _set_status(p_wo, 'diagnosis', '{}');
  else
    perform _log(p_wo, 'diagnosis_updated', r.status, r.status, '{}');
  end if;
end $$;

-- 3. Cotización en borrador (crea o reemplaza los ítems del borrador abierto).
create function quote_save_draft(
  p_wo uuid, p_items jsonb,                       -- [{"concept_code":"block","amount":450000,"description":null}]
  p_notes text default null, p_valid_until date default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare r work_orders; v_q uuid; v_i jsonb; v_n int := 0;
begin
  perform app_require();
  r := _lock_wo(p_wo);
  if r.status not in ('diagnosis','in_progress','quality_control') then
    raise exception 'No se puede cotizar en el estado actual (%)', r.status;
  end if;
  select id into v_q from quotes where work_order_id = p_wo and status = 'draft';
  if v_q is null then
    insert into quotes (work_order_id, version, created_by)
    values (p_wo, coalesce((select max(version) from quotes where work_order_id = p_wo), 0) + 1, auth.uid())
    returning id into v_q;
  end if;
  update quotes set notes_for_customer = p_notes,
                    valid_until = coalesce(p_valid_until, app_today() + 8)   -- vigencia por defecto: 8 días
   where id = v_q;
  delete from quote_items where quote_id = v_q;
  for v_i in select * from jsonb_array_elements(p_items) loop
    if not coalesce((select allowed_in_quote from service_concepts where code = v_i->>'concept_code'), false) then
      raise exception 'El concepto % no va como línea en la cotización', v_i->>'concept_code';
    end if;
    if v_i->>'concept_code' = 'other' and coalesce(trim(v_i->>'description'),'') = '' then
      raise exception 'Describe el "Otro trabajo"';
    end if;
    v_n := v_n + 1;
    insert into quote_items (quote_id, concept_code, description, amount, sort)
    values (v_q, v_i->>'concept_code', v_i->>'description', (v_i->>'amount')::bigint, v_n);
  end loop;
  return v_q;
end $$;

-- 4. Enviar cotización. "Enviada" NO es "aprobada".
--    Si la OT ya está en producción (adicional encontrado), queda enviada sin cambiar el estado de la OT.
create function quote_send(p_quote uuid) returns void language plpgsql security definer set search_path = public as $$
declare q quotes; r work_orders;
begin
  perform app_require();
  select * into q from quotes where id = p_quote for update;
  if q.status <> 'draft' then raise exception 'Solo se envía un borrador'; end if;
  if not exists (select 1 from quote_items where quote_id = p_quote) or q.total <= 0 then
    raise exception 'La cotización no tiene valores';
  end if;
  r := _lock_wo(q.work_order_id);
  update quotes set status = 'superseded' where work_order_id = q.work_order_id and status = 'sent';
  update quotes set status = 'sent', sent_at = now(), sent_by = auth.uid() where id = p_quote;
  if r.status = 'diagnosis' then
    perform _set_status(q.work_order_id, 'awaiting_approval', jsonb_build_object('quote_version', q.version, 'total', q.total));
  else
    perform _log(q.work_order_id, 'quote_sent', r.status, r.status, jsonb_build_object('quote_version', q.version, 'total', q.total));
  end if;
end $$;

-- 5. Aprobación del cliente. Fija el valor a cobrar y la fecha estimada (ahora + plazo).
create function quote_approve(
  p_quote uuid, p_authorized_by text, p_channel approval_channel,
  p_note text default null, p_evidence uuid default null
) returns void language plpgsql security definer set search_path = public as $$
declare q quotes; r work_orders;
begin
  perform app_require();
  if coalesce(trim(p_authorized_by),'') = '' then raise exception 'Indica quién autorizó'; end if;
  select * into q from quotes where id = p_quote for update;
  if q.status <> 'sent' then raise exception 'Solo se aprueba una cotización enviada'; end if;
  r := _lock_wo(q.work_order_id);
  if r.status not in ('awaiting_approval','in_progress','quality_control') then
    raise exception 'La OT no está esperando aprobación';
  end if;
  insert into customer_approvals (work_order_id, quote_id, decision, authorized_by_name, channel, note, evidence_attachment_id, recorded_by)
  values (q.work_order_id, p_quote, 'approved', p_authorized_by, p_channel, p_note, p_evidence, auth.uid());
  update quotes set status = 'superseded' where work_order_id = q.work_order_id and status = 'approved';  -- adicional reemplaza la anterior
  update quotes set status = 'approved', decided_at = now() where id = p_quote;
  if r.status = 'awaiting_approval' then
    update work_orders set estimated_delivery_at = add_business_days(now(), term_days)
     where id = q.work_order_id and estimated_delivery_at is null;
    perform _set_status(q.work_order_id, 'in_progress',
      jsonb_build_object('quote_version', q.version, 'total', q.total, 'authorized_by', p_authorized_by, 'channel', p_channel));
  else
    perform _log(q.work_order_id, 'additional_approved', r.status, r.status, jsonb_build_object('quote_version', q.version, 'total', q.total));
  end if;
end $$;

-- 6. Rechazo: la cotización original queda intacta; se crea una "liquidación" solo con lo cobrable
--    (p. ej. lavado y diagnóstico). Puede ser $0. Las piezas quedan pendientes de devolución.
create function quote_reject(
  p_quote uuid, p_authorized_by text, p_channel approval_channel,
  p_settlement_items jsonb default '[]',          -- [{"concept_code":"washing","amount":80000}]
  p_note text default null, p_evidence uuid default null
) returns void language plpgsql security definer set search_path = public as $$
declare q quotes; r work_orders; v_s uuid; v_i jsonb; v_n int := 0;
begin
  perform app_require();
  if coalesce(trim(p_authorized_by),'') = '' then raise exception 'Indica quién rechazó'; end if;
  select * into q from quotes where id = p_quote for update;
  if q.status <> 'sent' then raise exception 'Solo se rechaza una cotización enviada'; end if;
  r := _lock_wo(q.work_order_id);
  if r.status <> 'awaiting_approval' then
    raise exception 'Un adicional rechazado no cierra la OT: retira esa versión y continúa';
  end if;
  insert into customer_approvals (work_order_id, quote_id, decision, authorized_by_name, channel, note, evidence_attachment_id, recorded_by)
  values (q.work_order_id, p_quote, 'rejected', p_authorized_by, p_channel, p_note, p_evidence, auth.uid());
  update quotes set status = 'rejected', decided_at = now() where id = p_quote;
  delete from quotes where work_order_id = q.work_order_id and status = 'draft';
  insert into quotes (work_order_id, version, kind, created_by)
  values (q.work_order_id, (select max(version) from quotes where work_order_id = q.work_order_id) + 1, 'rejection_settlement', auth.uid())
  returning id into v_s;
  for v_i in select * from jsonb_array_elements(p_settlement_items) loop
    if not coalesce((select chargeable_on_rejection from service_concepts where code = v_i->>'concept_code'), false) then
      raise exception 'El concepto % no se cobra en un rechazo', v_i->>'concept_code';
    end if;
    v_n := v_n + 1;
    insert into quote_items (quote_id, concept_code, amount, sort) values (v_s, v_i->>'concept_code', (v_i->>'amount')::bigint, v_n);
  end loop;
  update quotes set status = 'approved', decided_at = now() where id = v_s;
  perform _set_status(q.work_order_id, 'rejected',
    jsonb_build_object('quote_version', q.version, 'settlement_total', (select total from quotes where id = v_s), 'authorized_by', p_authorized_by));
end $$;

-- 6b. Retirar una cotización enviada (para corregirla o porque el adicional no se hará).
--     Si la OT esperaba aprobación, vuelve a Diagnóstico.
create function quote_withdraw(p_quote uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare q quotes; r work_orders;
begin
  perform app_require();
  if coalesce(trim(p_reason),'') = '' then raise exception 'Indica el motivo'; end if;
  select * into q from quotes where id = p_quote for update;
  if q.status <> 'sent' then raise exception 'Solo se retira una cotización enviada sin decidir'; end if;
  r := _lock_wo(q.work_order_id);
  update quotes set status = 'superseded' where id = p_quote;
  if r.status = 'awaiting_approval' then
    perform _set_status(q.work_order_id, 'diagnosis', jsonb_build_object('withdrawn_version', q.version, 'reason', p_reason));
  else
    perform _log(q.work_order_id, 'quote_withdrawn', r.status, r.status, jsonb_build_object('version', q.version, 'reason', p_reason));
  end if;
end $$;

-- 7. Producción → control de calidad
create function work_order_send_to_qc(p_wo uuid) returns void language plpgsql security definer set search_path = public as $$
declare r work_orders;
begin
  perform app_require();
  r := _lock_wo(p_wo);
  perform _set_status(p_wo, 'quality_control', '{}');
end $$;

-- 8. Resultado de calidad: aprobado → Listo; no aprobado → vuelve a proceso. Siempre queda registrado.
create function quality_check_record(p_wo uuid, p_result qc_result, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r work_orders;
begin
  perform app_require();
  r := _lock_wo(p_wo);
  if r.status <> 'quality_control' then raise exception 'La OT no está en control de calidad'; end if;
  if p_result = 'failed' and coalesce(trim(p_notes),'') = '' then
    raise exception 'Describe qué falló en el control de calidad';
  end if;
  insert into quality_checks (work_order_id, result, notes, checked_by) values (p_wo, p_result, p_notes, auth.uid());
  perform _set_status(p_wo, case when p_result = 'passed' then 'ready'::wo_status else 'in_progress'::wo_status end,
                      jsonb_build_object('qc_result', p_result, 'notes', p_notes));
end $$;

-- 9. Pagos (anticipos y abonos). Si ya hay valor aprobado, no se acepta más que el saldo.
create function payment_record(p_wo uuid, p_amount bigint, p_method payment_method,
                               p_reference text default null, p_receipt uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare r work_orders; v_billable bigint; v_paid bigint; v_id uuid;
begin
  perform app_require();
  r := _lock_wo(p_wo);
  if p_amount is null or p_amount <= 0 then raise exception 'El valor debe ser mayor que cero'; end if;
  select billable, paid into v_billable, v_paid from v_work_orders where id = p_wo;
  if v_billable is not null and v_paid + p_amount > v_billable then
    raise exception 'El pago supera el saldo pendiente (%)', v_billable - v_paid;
  end if;
  insert into payments (work_order_id, amount, method, reference, receipt_attachment_id, recorded_by)
  values (p_wo, p_amount, p_method, p_reference, p_receipt, auth.uid()) returning id into v_id;
  perform _log(p_wo, 'payment', r.status, r.status,
               jsonb_build_object('amount', p_amount, 'method', p_method, 'reference', p_reference,
                                  'kind', case when v_billable is null then 'advance' else 'installment' end));
  if r.status in ('delivered','rejected') and v_billable is not null and v_paid + p_amount = v_billable then
    perform _log(p_wo, 'settled', r.status, r.status, '{}');   -- quedó a paz y salvo
  end if;
  return v_id;
end $$;

create function payment_void(p_payment uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare p payments;
begin
  perform app_require(true);
  if coalesce(trim(p_reason),'') = '' then raise exception 'Indica el motivo de la anulación'; end if;
  select * into p from payments where id = p_payment for update;
  if p.voided_at is not null then raise exception 'El pago ya estaba anulado'; end if;
  update payments set voided_at = now(), voided_by = auth.uid(), void_reason = p_reason where id = p_payment;
  perform _log(p.work_order_id, 'payment_voided', null, null, jsonb_build_object('amount', p.amount, 'reason', p_reason));
end $$;

-- 10. Factura SIIGO (por ahora referencia manual)
create function invoice_record(p_wo uuid, p_reference text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform app_require();
  perform _lock_wo(p_wo);
  update invoices set voided_at = now() where work_order_id = p_wo and voided_at is null;
  insert into invoices (work_order_id, reference, created_by) values (p_wo, trim(p_reference), auth.uid()) returning id into v_id;
  perform _log(p_wo, 'invoice', null, null, jsonb_build_object('reference', p_reference));
  return v_id;
end $$;

-- 11. Entrega y cierre.
--     Sin saldo → paz y salvo. Con saldo → solo si se pide crédito y el cliente es empresa con crédito autorizado.
create function work_order_deliver(
  p_wo uuid, p_received_by text, p_received_by_id text default null,
  p_use_credit boolean default false, p_notes text default null
) returns text language plpgsql security definer set search_path = public as $$
declare r work_orders; v_balance bigint; c customers; v_result text;
begin
  perform app_require();
  r := _lock_wo(p_wo);
  if r.status <> 'ready' then raise exception 'Solo se entrega una OT lista para entregar'; end if;
  select balance into v_balance from v_work_orders where id = p_wo;
  select * into c from customers where id = r.customer_id;
  if c.customer_type = 'company' and not exists (select 1 from invoices where work_order_id = p_wo and voided_at is null) then
    raise exception 'Registra la factura SIIGO antes de entregar (cliente empresa)';
  end if;
  if v_balance > 0 then
    if not p_use_credit then
      raise exception 'Hay un saldo de % pendiente. Registra el pago o aplica crédito autorizado', v_balance;
    end if;
    if not c.credit_authorized then
      raise exception 'El cliente no tiene crédito autorizado';
    end if;
    if c.credit_limit is not null and v_balance + coalesce((
         select sum(balance) from v_work_orders
          where customer_id = c.id and financial_status in ('credit_current','credit_overdue')), 0) > c.credit_limit then
      raise exception 'Se supera el cupo de crédito del cliente';
    end if;
    update work_orders set payment_terms = 'credit', credit_due_on = current_date + c.credit_days where id = p_wo;
    v_result := 'credit_pending';
  else
    v_result := 'settled';
  end if;
  insert into handovers (work_order_id, kind, received_by_name, received_by_id_number, notes, recorded_by)
  values (p_wo, 'delivery', p_received_by, p_received_by_id, p_notes, auth.uid());
  perform _set_status(p_wo, 'delivered', jsonb_build_object('result', v_result, 'balance', v_balance, 'received_by', p_received_by));
  return v_result;   -- 'settled' = paz y salvo · 'credit_pending' = entregado con crédito pendiente
end $$;

-- 12. Devolución de piezas tras un rechazo
create function work_order_return_parts(p_wo uuid, p_received_by text, p_received_by_id text default null, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r work_orders;
begin
  perform app_require();
  r := _lock_wo(p_wo);
  if r.status <> 'rejected' then raise exception 'Solo se devuelven piezas de una OT rechazada'; end if;
  insert into handovers (work_order_id, kind, received_by_name, received_by_id_number, notes, recorded_by)
  values (p_wo, 'return', p_received_by, p_received_by_id, p_notes, auth.uid());
  perform _log(p_wo, 'parts_returned', r.status, r.status, jsonb_build_object('received_by', p_received_by));
end $$;

-- 13. Cambiar fecha estimada de entrega (queda en el historial)
create function work_order_set_estimate(p_wo uuid, p_at timestamptz, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r work_orders;
begin
  perform app_require();
  r := _lock_wo(p_wo);
  if r.status in ('delivered','rejected') then raise exception 'La OT ya está cerrada'; end if;
  update work_orders set estimated_delivery_at = p_at where id = p_wo;
  perform _log(p_wo, 'estimate_changed', r.status, r.status,
               jsonb_build_object('from', r.estimated_delivery_at, 'to', p_at, 'reason', p_reason));
end $$;

-- 14. Corrección de errores (solo admin, con motivo, queda en el historial)
create function work_order_revert_status(p_wo uuid, p_to wo_status, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare r work_orders;
begin
  perform app_require(true);
  if coalesce(trim(p_reason),'') = '' then raise exception 'Indica el motivo de la corrección'; end if;
  r := _lock_wo(p_wo);
  if r.status in ('delivered','rejected') then raise exception 'La OT está cerrada: no se puede reabrir'; end if;
  if p_to in ('delivered','rejected') then raise exception 'Para cerrar usa entrega o rechazo'; end if;
  update work_orders set status = p_to, closed_at = null where id = p_wo;
  perform _log(p_wo, 'status_reverted', r.status, p_to, jsonb_build_object('reason', p_reason));
end $$;

-- 15. Crédito del cliente (solo admin)
create function customer_set_credit(p_customer uuid, p_authorized boolean, p_days int default 30, p_limit bigint default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform app_require(true);
  update customers set credit_authorized = p_authorized, credit_days = p_days, credit_limit = p_limit where id = p_customer;
end $$;

-- =====================================================================
-- Seguridad (RLS). Una sola empresa: todo usuario activo lee todo.
-- Escrituras de OT solo por las funciones anteriores.
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['profiles','customers','mechanics','engines','work_orders','part_types','received_parts',
    'attachments','diagnoses','diagnostic_measurements','service_concepts','quotes','quote_items','customer_approvals',
    'work_logs','quality_checks','payments','invoices','handovers','work_order_events']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (app_is_active())', t || '_read', t);
    execute format('revoke insert, update, delete, truncate on %I from authenticated, anon', t);
    execute format('revoke select on %I from anon', t);
  end loop;
end $$;

-- Clientes y mecánicos sí se crean/editan directo desde la app (sin tocar crédito).
grant insert on customers, mechanics to authenticated;
grant update (customer_type, name, id_type, id_number, phone, address, email) on customers to authenticated;
grant update (name, phone) on mechanics to authenticated;
create policy customers_write  on customers for insert to authenticated with check (app_is_active() and not credit_authorized);
create policy customers_update on customers for update to authenticated using (app_is_active()) with check (app_is_active());
create policy mechanics_write  on mechanics for insert to authenticated with check (app_is_active());
create policy mechanics_update on mechanics for update to authenticated using (app_is_active()) with check (app_is_active());

-- Adjuntos: se registran después de subir el archivo al bucket privado.
grant insert on attachments to authenticated;
create policy attachments_write on attachments for insert to authenticated with check (app_is_active() and uploaded_by = auth.uid());

revoke select on v_work_orders from anon;

-- Tiempo real: el tablero se actualiza cuando otro dispositivo cambia una OT.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table work_order_events;
  end if;
end $$;

-- Funciones: nadie sin sesión las ejecuta; las internas tampoco desde la app.
-- (Las de admin validan el rol por dentro con app_require(true).)
revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated;
revoke execute on function _log(uuid, text, wo_status, wo_status, jsonb), _lock_wo(uuid),
  _set_status(uuid, wo_status, jsonb) from authenticated;
