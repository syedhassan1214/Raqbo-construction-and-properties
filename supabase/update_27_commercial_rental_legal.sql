-- =====================================================================
-- RAQBO update 27 — COMMERCIAL, RENTAL MANAGEMENT & LEGAL SERVICES
--   1  Commercial & investment property fields and filters
--   2  Property management for landlords (properties, tenants, agreements,
--      rent, expenses, maintenance, statements)
--   3  Tenant screening & verification, with consent
--   4  Rent collection: schedule, reminders, receipts — rent goes to the
--      LANDLORD'S own bank account, never to RAQBO
--   5  Lease & rental agreement generator
--   6  Legal consultation booking (verified lawyers, appointments)
--   7  Stamp duty & property tax: admin-controlled, date-effective rates
--   8  Rental yield & investment return (worked out in the browser)
--   9  Landlord / tenant / commercial-owner / legal-professional dashboards
--  10  Admin controls for all of the above
-- Safe to run more than once.
-- =====================================================================

-- ---------- 1. Commercial & investment property ----------
alter table public.listings add column if not exists commercial_kind text;
do $$ begin alter table public.listings add constraint listings_commercial_kind_check check (commercial_kind is null or commercial_kind in
  ('office','office_floor','shop','showroom','warehouse','industrial_unit','building','coworking','income_property','other')); exception when duplicate_object then null; end $$;
alter table public.listings add column if not exists covered_area numeric check (covered_area is null or covered_area > 0);
alter table public.listings add column if not exists floor_no text not null default '' check (char_length(floor_no) <= 40);
alter table public.listings add column if not exists building_name text not null default '' check (char_length(building_name) <= 120);
alter table public.listings add column if not exists rent_period text not null default 'month' check (rent_period in ('month','year'));
alter table public.listings add column if not exists security_deposit bigint check (security_deposit is null or security_deposit >= 0);
alter table public.listings add column if not exists advance_rent_months int check (advance_rent_months is null or advance_rent_months between 0 and 36);
alter table public.listings add column if not exists lease_months int check (lease_months is null or lease_months between 1 and 240);
alter table public.listings add column if not exists escalation_pct numeric(5,2) check (escalation_pct is null or escalation_pct between 0 and 100);
alter table public.listings add column if not exists available_from date;
alter table public.listings add column if not exists maintenance_charges bigint check (maintenance_charges is null or maintenance_charges >= 0);
alter table public.listings add column if not exists parking_spaces int check (parking_spaces is null or parking_spaces between 0 and 2000);
alter table public.listings add column if not exists utilities_note text not null default '' check (char_length(utilities_note) <= 300);
alter table public.listings add column if not exists access_notes text not null default '' check (char_length(access_notes) <= 300);
alter table public.listings add column if not exists monthly_income bigint check (monthly_income is null or monthly_income >= 0);  -- for income-generating properties
create index if not exists listings_commercial_idx on public.listings (commercial_kind) where commercial_kind is not null;

-- ---------- 2. Property management: properties ----------
create table if not exists public.rm_properties (
  id          uuid primary key default gen_random_uuid(),
  ref         text not null unique default ('RQ-PM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  listing_id  uuid references public.listings (id) on delete set null,     -- optional link to an advert
  title       text not null check (char_length(btrim(title)) between 3 and 150),
  kind        text not null default 'residential' check (kind in ('residential','commercial')),
  address     text not null default '' check (char_length(address) <= 300),
  city        text not null default '' check (char_length(city) <= 60),
  area        text not null default '' check (char_length(area) <= 120),
  size        numeric check (size is null or size > 0),
  size_unit   text not null default 'Marla' check (size_unit in ('Marla','Kanal','sq ft','sq yd','Acre')),
  managed_by  text not null default 'self' check (managed_by in ('self','raqbo')),   -- RAQBO-managed needs an agreement
  mgmt_status text not null default 'none' check (mgmt_status in ('none','requested','active','ended')),
  mgmt_fee_pct numeric(5,2) check (mgmt_fee_pct is null or mgmt_fee_pct between 0 and 50),
  notes       text not null default '' check (char_length(notes) <= 1000),
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists rm_properties_owner_idx on public.rm_properties (owner_id, created_at desc);
alter table public.rm_properties enable row level security;
drop policy if exists "rm_properties: own or admin" on public.rm_properties;
create policy "rm_properties: own or admin" on public.rm_properties for select using (owner_id = auth.uid() or public.has_perm('listings') or public.is_admin());
drop policy if exists "rm_properties: owner writes" on public.rm_properties;
create policy "rm_properties: owner writes" on public.rm_properties for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant select, insert, update, delete on public.rm_properties to authenticated;

-- ---------- Tenants ----------
create table if not exists public.rm_tenants (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  user_id     uuid references public.profiles (id) on delete set null,   -- set when the tenant has a RAQBO account
  name        text not null check (char_length(btrim(name)) between 2 and 120),
  phone       text not null default '' check (char_length(phone) <= 40),
  email       text not null default '' check (char_length(email) <= 160),
  cnic_last4  text not null default '' check (char_length(cnic_last4) <= 4),  -- only the last 4 digits are kept
  address     text not null default '' check (char_length(address) <= 300),
  employer    text not null default '' check (char_length(employer) <= 150),
  notes       text not null default '' check (char_length(notes) <= 1000),
  created_at  timestamptz not null default now()
);
create index if not exists rm_tenants_owner_idx on public.rm_tenants (owner_id);
alter table public.rm_tenants enable row level security;
drop policy if exists "rm_tenants: own, linked or admin" on public.rm_tenants;
create policy "rm_tenants: own, linked or admin" on public.rm_tenants for select using (owner_id = auth.uid() or user_id = auth.uid() or public.is_admin());
drop policy if exists "rm_tenants: owner writes" on public.rm_tenants;
create policy "rm_tenants: owner writes" on public.rm_tenants for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant select, insert, update, delete on public.rm_tenants to authenticated;

-- ---------- Tenancy (the agreement) ----------
create table if not exists public.rm_tenancies (
  id            uuid primary key default gen_random_uuid(),
  ref           text not null unique default ('RQ-LSE-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  property_id   uuid not null references public.rm_properties (id) on delete cascade,
  tenant_id     uuid not null references public.rm_tenants (id) on delete cascade,
  owner_id      uuid not null references public.profiles (id) on delete cascade,
  rent          bigint not null check (rent > 0),
  rent_period   text not null default 'month' check (rent_period in ('month','year')),
  due_day       int not null default 1 check (due_day between 1 and 28),
  deposit       bigint not null default 0 check (deposit >= 0),
  deposit_held  boolean not null default true,
  advance_months int not null default 0 check (advance_months between 0 and 36),
  starts_on     date not null,
  ends_on       date,
  escalation_pct numeric(5,2) not null default 0 check (escalation_pct between 0 and 100),
  escalation_months int not null default 12 check (escalation_months between 1 and 60),
  next_increase_on date,
  maintenance_by text not null default 'tenant' check (maintenance_by in ('tenant','landlord','shared')),
  utilities_by   text not null default 'tenant' check (utilities_by in ('tenant','landlord','shared')),
  renewal_terms  text not null default '' check (char_length(renewal_terms) <= 1000),
  termination_terms text not null default '' check (char_length(termination_terms) <= 1000),
  other_terms    text not null default '' check (char_length(other_terms) <= 3000),
  status        text not null default 'draft' check (status in ('draft','active','ending','ended','cancelled')),
  agreement_doc text not null default '',     -- stored file path, if uploaded or generated
  signed_at     timestamptz,
  sign_method   text not null default '' check (sign_method in ('','manual','uploaded')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists rm_tenancies_prop_idx on public.rm_tenancies (property_id, status);
alter table public.rm_tenancies enable row level security;
drop policy if exists "rm_tenancies: parties or admin" on public.rm_tenancies;
create policy "rm_tenancies: parties or admin" on public.rm_tenancies for select using (
  owner_id = auth.uid() or public.is_admin() or exists (select 1 from public.rm_tenants t where t.id = tenant_id and t.user_id = auth.uid()));
drop policy if exists "rm_tenancies: owner writes" on public.rm_tenancies;
create policy "rm_tenancies: owner writes" on public.rm_tenancies for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant select, insert, update, delete on public.rm_tenancies to authenticated;

-- ---------- 4. Rent schedule and payments ----------
-- RAQBO records and reminds. The money goes to the landlord's own account.
create table if not exists public.rm_rent (
  id           uuid primary key default gen_random_uuid(),
  tenancy_id   uuid not null references public.rm_tenancies (id) on delete cascade,
  owner_id     uuid not null references public.profiles (id) on delete cascade,
  period       date not null,                          -- first day of the rent month
  due_on       date not null,
  amount       bigint not null check (amount > 0),
  paid_amount  bigint not null default 0 check (paid_amount >= 0),
  paid_on      date,
  method       text not null default '' check (char_length(method) <= 40),
  reference    text not null default '' check (char_length(reference) <= 80),
  status       text not null default 'due' check (status in ('due','part_paid','paid','overdue','waived')),
  note         text not null default '' check (char_length(note) <= 300),
  receipt_no   text unique,
  reminded_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (tenancy_id, period)
);
create index if not exists rm_rent_owner_idx on public.rm_rent (owner_id, due_on desc);
alter table public.rm_rent enable row level security;
drop policy if exists "rm_rent: parties or admin" on public.rm_rent;
create policy "rm_rent: parties or admin" on public.rm_rent for select using (
  owner_id = auth.uid() or public.is_admin() or exists (select 1 from public.rm_tenancies y join public.rm_tenants t on t.id = y.tenant_id where y.id = tenancy_id and t.user_id = auth.uid()));
drop policy if exists "rm_rent: owner writes" on public.rm_rent;
create policy "rm_rent: owner writes" on public.rm_rent for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant select, insert, update, delete on public.rm_rent to authenticated;

-- ---------- Expenses & maintenance ----------
create table if not exists public.rm_expenses (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.rm_properties (id) on delete cascade,
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  spent_on    date not null default (now() at time zone 'Asia/Karachi')::date,
  category    text not null check (char_length(btrim(category)) between 2 and 60),
  amount      bigint not null check (amount > 0),
  note        text not null default '' check (char_length(note) <= 300),
  doc         text not null default '',
  created_at  timestamptz not null default now()
);
alter table public.rm_expenses enable row level security;
drop policy if exists "rm_expenses: own or admin" on public.rm_expenses;
create policy "rm_expenses: own or admin" on public.rm_expenses for select using (owner_id = auth.uid() or public.is_admin());
drop policy if exists "rm_expenses: owner writes" on public.rm_expenses;
create policy "rm_expenses: owner writes" on public.rm_expenses for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant select, insert, update, delete on public.rm_expenses to authenticated;

create table if not exists public.rm_maintenance (
  id          uuid primary key default gen_random_uuid(),
  ref         text not null unique default ('RQ-MNT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  property_id uuid not null references public.rm_properties (id) on delete cascade,
  tenancy_id  uuid references public.rm_tenancies (id) on delete set null,
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  raised_by   uuid references public.profiles (id) on delete set null,     -- the tenant, when they report it
  title       text not null check (char_length(btrim(title)) between 3 and 150),
  details     text not null default '' check (char_length(details) <= 2000),
  urgency     text not null default 'normal' check (urgency in ('low','normal','urgent')),
  status      text not null default 'open' check (status in ('open','in_progress','done','rejected')),
  cost        bigint check (cost is null or cost >= 0),
  resolution  text not null default '' check (char_length(resolution) <= 1000),
  photos      jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  closed_at   timestamptz
);
alter table public.rm_maintenance enable row level security;
drop policy if exists "rm_maintenance: parties or admin" on public.rm_maintenance;
create policy "rm_maintenance: parties or admin" on public.rm_maintenance for select using (
  owner_id = auth.uid() or raised_by = auth.uid() or public.is_admin()
  or exists (select 1 from public.rm_tenancies y join public.rm_tenants t on t.id = y.tenant_id where y.id = tenancy_id and t.user_id = auth.uid()));
drop policy if exists "rm_maintenance: owner writes" on public.rm_maintenance;
create policy "rm_maintenance: owner writes" on public.rm_maintenance for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant select, insert, update, delete on public.rm_maintenance to authenticated;

-- Documents kept against a property
create table if not exists public.rm_documents (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.rm_properties (id) on delete cascade,
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 2 and 150),
  kind        text not null default 'other' check (kind in ('agreement','ownership','utility','tax','receipt','other')),
  path        text not null,
  created_at  timestamptz not null default now()
);
alter table public.rm_documents enable row level security;
drop policy if exists "rm_documents: own or admin" on public.rm_documents;
create policy "rm_documents: own or admin" on public.rm_documents for select using (owner_id = auth.uid() or public.is_admin());
drop policy if exists "rm_documents: owner writes" on public.rm_documents;
create policy "rm_documents: owner writes" on public.rm_documents for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant select, insert, update, delete on public.rm_documents to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rental-docs', 'rental-docs', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "rental-docs: upload own folder" on storage.objects;
create policy "rental-docs: upload own folder" on storage.objects for insert to authenticated with check (bucket_id = 'rental-docs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "rental-docs: owner or admin reads" on storage.objects;
create policy "rental-docs: owner or admin reads" on storage.objects for select using (bucket_id = 'rental-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ---------- Build the rent schedule for a tenancy ----------
create or replace function public.rm_build_rent(p_tenancy uuid, p_months int default 12)
returns int language plpgsql security definer set search_path = public as $$
declare y public.rm_tenancies; d date; n int := 0; amt bigint; i int; step int;
begin
  select * into y from public.rm_tenancies where id = p_tenancy;
  if y.id is null or y.owner_id <> auth.uid() then raise exception 'Tenancy not found.'; end if;
  step := case y.rent_period when 'year' then 12 else 1 end;
  d := date_trunc('month', y.starts_on)::date;
  amt := y.rent;
  for i in 0 .. greatest(0, least(coalesce(p_months, 12), 60)) - 1 loop
    exit when y.ends_on is not null and d > y.ends_on;
    -- yearly increase
    if y.escalation_pct > 0 and i > 0 and (i * step) % greatest(1, y.escalation_months) = 0 then
      amt := round(amt * (1 + y.escalation_pct / 100.0));
    end if;
    insert into public.rm_rent (tenancy_id, owner_id, period, due_on, amount)
    values (y.id, y.owner_id, d, (d + make_interval(days => y.due_day - 1))::date, amt)
    on conflict (tenancy_id, period) do nothing;
    if found then n := n + 1; end if;
    d := (d + make_interval(months => step))::date;
  end loop;
  update public.rm_tenancies set status = case when status = 'draft' then 'active' else status end, updated_at = now() where id = y.id;
  return n;
end $$;
grant execute on function public.rm_build_rent(uuid, int) to authenticated;

-- Record a rent payment and issue a receipt number
create or replace function public.rm_pay_rent(p_rent uuid, p_amount bigint, p_paid_on date, p_method text, p_reference text, p_note text default '')
returns text language plpgsql security definer set search_path = public as $$
declare r public.rm_rent; total bigint; rc text;
begin
  select * into r from public.rm_rent where id = p_rent for update;
  if r.id is null or r.owner_id <> auth.uid() then raise exception 'Rent record not found.'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter the amount received.'; end if;
  total := r.paid_amount + p_amount;
  if total > r.amount * 2 then raise exception 'That is far more than the rent due. Check the amount.'; end if;
  rc := coalesce(r.receipt_no, 'RQ-RCT-' || to_char(now() at time zone 'Asia/Karachi', 'YYMM') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)));
  update public.rm_rent set paid_amount = total, paid_on = coalesce(p_paid_on, (now() at time zone 'Asia/Karachi')::date),
    method = left(coalesce(p_method, ''), 40), reference = left(coalesce(p_reference, ''), 80), note = left(coalesce(p_note, ''), 300),
    status = case when total >= r.amount then 'paid' else 'part_paid' end, receipt_no = rc
  where id = r.id;
  return rc;
end $$;
grant execute on function public.rm_pay_rent(uuid, bigint, date, text, text, text) to authenticated;

-- Mark overdue rent (runs when a landlord opens the dashboard)
create or replace function public.rm_mark_overdue()
returns int language sql security definer set search_path = public as $$
  with x as (update public.rm_rent set status = 'overdue'
    where owner_id = auth.uid() and status = 'due' and due_on < (now() at time zone 'Asia/Karachi')::date returning 1)
  select count(*)::int from x $$;
grant execute on function public.rm_mark_overdue() to authenticated;

-- Landlord summary: income, expenses, who owes what
create or replace function public.rm_summary(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f date := coalesce(p_from, date_trunc('year', (now() at time zone 'Asia/Karachi'))::date);
        t date := coalesce(p_to, (now() at time zone 'Asia/Karachi')::date);
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  return jsonb_build_object('from', f, 'to', t,
    'properties', (select count(*) from public.rm_properties where owner_id = auth.uid() and not archived),
    'tenants', (select count(*) from public.rm_tenancies where owner_id = auth.uid() and status = 'active'),
    'rent_due_total', (select coalesce(sum(amount - paid_amount), 0) from public.rm_rent where owner_id = auth.uid() and status in ('due','part_paid','overdue')),
    'overdue_total', (select coalesce(sum(amount - paid_amount), 0) from public.rm_rent where owner_id = auth.uid() and status = 'overdue'),
    'overdue_n', (select count(*) from public.rm_rent where owner_id = auth.uid() and status = 'overdue'),
    'collected', (select coalesce(sum(paid_amount), 0) from public.rm_rent where owner_id = auth.uid() and paid_on between f and t),
    'expenses', (select coalesce(sum(amount), 0) from public.rm_expenses where owner_id = auth.uid() and spent_on between f and t),
    'deposits_held', (select coalesce(sum(deposit), 0) from public.rm_tenancies where owner_id = auth.uid() and status = 'active' and deposit_held),
    'maintenance_open', (select count(*) from public.rm_maintenance where owner_id = auth.uid() and status in ('open','in_progress')),
    'leases_ending', (select count(*) from public.rm_tenancies where owner_id = auth.uid() and status = 'active' and ends_on is not null and ends_on <= t + 60),
    'by_property', coalesce((select jsonb_agg(x) from (
       select p.ref, p.title,
              (select coalesce(sum(r.paid_amount), 0) from public.rm_rent r join public.rm_tenancies y on y.id = r.tenancy_id where y.property_id = p.id and r.paid_on between f and t) as income,
              (select coalesce(sum(e.amount), 0) from public.rm_expenses e where e.property_id = p.id and e.spent_on between f and t) as expenses,
              (select coalesce(sum(r.amount - r.paid_amount), 0) from public.rm_rent r join public.rm_tenancies y on y.id = r.tenancy_id where y.property_id = p.id and r.status in ('due','part_paid','overdue')) as outstanding
         from public.rm_properties p where p.owner_id = auth.uid() and not p.archived order by p.created_at) x), '[]'::jsonb));
end $$;
grant execute on function public.rm_summary(date, date) to authenticated;

-- What a tenant sees
create or replace function public.rm_tenant_view()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'tenancy_ref', y.ref, 'tenancy_id', y.id, 'property', p.title, 'address', p.address, 'city', p.city,
      'rent', y.rent, 'rent_period', y.rent_period, 'due_day', y.due_day, 'deposit', y.deposit,
      'starts_on', y.starts_on, 'ends_on', y.ends_on, 'status', y.status,
      'landlord', (select coalesce(nullif(full_name, ''), 'Landlord') from public.profiles where id = y.owner_id),
      'rent_rows', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'period', r.period, 'due_on', r.due_on, 'amount', r.amount, 'paid', r.paid_amount, 'status', r.status, 'receipt_no', r.receipt_no, 'paid_on', r.paid_on) order by r.period desc)
          from public.rm_rent r where r.tenancy_id = y.id), '[]'::jsonb),
      'maintenance', coalesce((select jsonb_agg(jsonb_build_object('ref', m.ref, 'title', m.title, 'status', m.status, 'created_at', m.created_at) order by m.created_at desc)
          from public.rm_maintenance m where m.tenancy_id = y.id), '[]'::jsonb)))
    from public.rm_tenancies y join public.rm_properties p on p.id = y.property_id
    join public.rm_tenants t on t.id = y.tenant_id
   where t.user_id = auth.uid() and y.status in ('active','ending','ended')), '[]'::jsonb);
end $$;
grant execute on function public.rm_tenant_view() to authenticated;

-- A tenant reports a maintenance problem
create or replace function public.rm_tenant_maintenance(p_tenancy uuid, p_title text, p_details text, p_urgency text default 'normal')
returns text language plpgsql security definer set search_path = public as $$
declare y public.rm_tenancies; r text;
begin
  select y2.* into y from public.rm_tenancies y2 join public.rm_tenants t on t.id = y2.tenant_id where y2.id = p_tenancy and t.user_id = auth.uid();
  if y.id is null then raise exception 'You are not the tenant of this property.'; end if;
  if char_length(btrim(coalesce(p_title, ''))) < 3 then raise exception 'Say briefly what the problem is.'; end if;
  insert into public.rm_maintenance (property_id, tenancy_id, owner_id, raised_by, title, details, urgency)
  values (y.property_id, y.id, y.owner_id, auth.uid(), btrim(p_title), coalesce(p_details, ''), coalesce(nullif(p_urgency, ''), 'normal'))
  returning ref into r;
  perform public.notify(y.owner_id, 'system', 'Maintenance reported: ' || left(p_title, 100), left(coalesce(p_details, ''), 300), '#my/landlord');
  return r;
end $$;
grant execute on function public.rm_tenant_maintenance(uuid, text, text, text) to authenticated;

-- ---------- 3. Tenant screening & verification ----------
create table if not exists public.ts_checks (
  id            uuid primary key default gen_random_uuid(),
  ref           text not null unique default ('RQ-TSV-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  owner_id      uuid not null references public.profiles (id) on delete cascade,     -- the landlord who asked
  tenant_id     uuid references public.rm_tenants (id) on delete set null,
  tenant_user   uuid references public.profiles (id) on delete set null,             -- when the tenant has an account
  tenant_name   text not null check (char_length(btrim(tenant_name)) between 2 and 120),
  tenant_phone  text not null default '' check (char_length(tenant_phone) <= 40),
  tenant_email  text not null default '' check (char_length(tenant_email) <= 160),
  -- what the TENANT supplied (never treated as verified)
  supplied      jsonb not null default '{}'::jsonb,
  -- what RAQBO independently checked
  verified      jsonb not null default '{}'::jsonb,
  consent       boolean not null default false,
  consent_at    timestamptz,
  consent_text  text not null default '',
  consent_ip    text not null default '',
  status        text not null default 'awaiting_consent' check (status in ('awaiting_consent','consented','in_progress','completed','rejected','withdrawn')),
  report_note   text not null default '' check (char_length(report_note) <= 3000),
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists ts_checks_owner_idx on public.ts_checks (owner_id, created_at desc);
alter table public.ts_checks enable row level security;
drop policy if exists "ts_checks: parties or admin" on public.ts_checks;
create policy "ts_checks: parties or admin" on public.ts_checks for select using (owner_id = auth.uid() or tenant_user = auth.uid() or public.has_perm('verification') or public.is_admin());
revoke insert, update, delete on public.ts_checks from anon, authenticated;
grant select on public.ts_checks to authenticated;

create or replace function public.ts_request(p_tenant uuid, p_name text, p_phone text, p_email text, p_supplied jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare r text; u uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Enter the tenant''s name.'; end if;
  if (select count(*) from public.ts_checks where owner_id = auth.uid() and created_at > now() - interval '1 day') >= 10 then raise exception 'You have sent several screening requests today.'; end if;
  select id into u from public.profiles where lower(email) = lower(btrim(coalesce(p_email, ''))) and coalesce(p_email, '') <> '';
  insert into public.ts_checks (owner_id, tenant_id, tenant_user, tenant_name, tenant_phone, tenant_email, supplied)
  values (auth.uid(), p_tenant, u, btrim(p_name), coalesce(p_phone, ''), coalesce(p_email, ''), coalesce(p_supplied, '{}'::jsonb))
  returning ref into r;
  if u is not null then perform public.notify(u, 'system', 'A landlord has asked to verify your details', 'Open My RAQBO → Tenant checks to read what is asked and give or refuse your consent.', '#my/tenant'); end if;
  return r;
end $$;
grant execute on function public.ts_request(uuid, text, text, text, jsonb) to authenticated;

-- The tenant gives or refuses consent. Nothing is checked without this.
create or replace function public.ts_consent(p_ref text, p_agree boolean, p_text text default '')
returns void language plpgsql security definer set search_path = public as $$
declare c public.ts_checks;
begin
  select * into c from public.ts_checks where ref = p_ref and tenant_user = auth.uid() for update;
  if c.id is null then raise exception 'Screening request not found.'; end if;
  if c.status not in ('awaiting_consent','consented') then raise exception 'This request is already being processed.'; end if;
  update public.ts_checks set consent = p_agree, consent_at = now(), consent_text = left(coalesce(p_text, ''), 1000),
    status = case when p_agree then 'consented' else 'withdrawn' end, updated_at = now() where id = c.id;
  perform public.notify(c.owner_id, 'system', case when p_agree then 'Tenant gave consent for verification' else 'Tenant refused verification' end, left(c.tenant_name, 200), '#my/landlord');
end $$;
grant execute on function public.ts_consent(text, boolean, text) to authenticated;

create or replace function public.ts_admin_update(p_ref text, p_status text, p_verified jsonb, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.ts_checks;
begin
  if not (public.has_perm('verification') or public.is_admin()) then raise exception 'Only RAQBO staff can update a screening.'; end if;
  select * into c from public.ts_checks where ref = p_ref for update;
  if c.id is null then raise exception 'Screening request not found.'; end if;
  if p_status in ('in_progress','completed') and not c.consent then raise exception 'The tenant has not given consent. Nothing may be verified without it.'; end if;
  update public.ts_checks set status = p_status, verified = coalesce(p_verified, verified), report_note = left(coalesce(p_note, ''), 3000),
    completed_at = case when p_status = 'completed' then now() else completed_at end, updated_at = now() where id = c.id;
  perform public.audit('tenant_screening.' || p_status, 'ts_check', c.ref, p_note, null);
  if p_status = 'completed' then perform public.notify(c.owner_id, 'system', 'Tenant verification report ready', left(c.tenant_name, 200), '#my/landlord'); end if;
end $$;
grant execute on function public.ts_admin_update(text, text, jsonb, text) to authenticated;

-- ---------- 6. Legal consultation ----------
create table if not exists public.lawyers (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid unique references public.profiles (id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 2 and 120),
  qualification text not null default '' check (char_length(qualification) <= 200),
  enrolment_no  text not null default '' check (char_length(enrolment_no) <= 80),   -- bar council enrolment
  bar_council   text not null default '' check (char_length(bar_council) <= 120),
  years         int check (years is null or years between 0 and 70),
  city          text not null default '' check (char_length(city) <= 60),
  languages     text not null default '' check (char_length(languages) <= 120),
  specialities  text[] not null default '{}',
  profile       text not null default '' check (char_length(profile) <= 2000),
  fee           bigint not null default 0 check (fee >= 0),
  modes         text[] not null default '{physical,phone,video}',
  photo         text not null default '',
  docs          jsonb not null default '[]'::jsonb,            -- private: licence, CNIC
  status        text not null default 'pending' check (status in ('pending','verified','rejected','suspended')),
  admin_note    text not null default '' check (char_length(admin_note) <= 600),
  verified_at   timestamptz,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.lawyers enable row level security;
drop policy if exists "lawyers: public verified, own, admin" on public.lawyers;
create policy "lawyers: public verified, own, admin" on public.lawyers for select using ((status = 'verified' and active) or user_id = auth.uid() or public.is_admin());
revoke insert, update, delete on public.lawyers from anon, authenticated;
grant select on public.lawyers to anon, authenticated;

create table if not exists public.legal_appointments (
  id          uuid primary key default gen_random_uuid(),
  ref         text not null unique default ('RQ-LGL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  lawyer_id   uuid references public.lawyers (id) on delete set null,
  matter      text not null check (matter in ('sale_purchase','lease_tenancy','title_review','documentation','disputes','landlord_tenant','inheritance','mutation_transfer','tax_stamp','notice_review','other')),
  mode        text not null default 'phone' check (mode in ('physical','phone','video')),
  summary     text not null check (char_length(btrim(summary)) between 10 and 3000),
  preferred_at timestamptz,
  confirmed_at timestamptz,
  duration_min int not null default 30 check (duration_min between 15 and 180),
  fee         bigint not null default 0 check (fee >= 0),
  fee_status  text not null default 'unpaid' check (fee_status in ('unpaid','paid','waived')),
  fee_ref     text not null default '' check (char_length(fee_ref) <= 80),
  docs        jsonb not null default '[]'::jsonb,         -- confidential, parties only
  status      text not null default 'requested' check (status in ('requested','confirmed','completed','cancelled','no_show')),
  admin_note  text not null default '' check (char_length(admin_note) <= 600),
  outcome     text not null default '' check (char_length(outcome) <= 2000),
  rating      int check (rating is null or rating between 1 and 5),
  feedback    text not null default '' check (char_length(feedback) <= 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists legal_appt_user_idx on public.legal_appointments (user_id, created_at desc);
alter table public.legal_appointments enable row level security;
drop policy if exists "legal_appointments: parties or admin" on public.legal_appointments;
create policy "legal_appointments: parties or admin" on public.legal_appointments for select using (
  user_id = auth.uid() or public.is_admin() or exists (select 1 from public.lawyers l where l.id = lawyer_id and l.user_id = auth.uid()));
revoke insert, update, delete on public.legal_appointments from anon, authenticated;
grant select on public.legal_appointments to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('legal-docs', 'legal-docs', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "legal-docs: upload own folder" on storage.objects;
create policy "legal-docs: upload own folder" on storage.objects for insert to authenticated with check (bucket_id = 'legal-docs' and (storage.foldername(name))[1] = auth.uid()::text);
-- Only the client, the lawyer on the appointment, and a full admin may open a legal document
drop policy if exists "legal-docs: parties only" on storage.objects;
create policy "legal-docs: parties only" on storage.objects for select using (bucket_id = 'legal-docs' and (
  (storage.foldername(name))[1] = auth.uid()::text or public.is_full_admin()
  or exists (select 1 from public.legal_appointments a join public.lawyers l on l.id = a.lawyer_id
             where l.user_id = auth.uid() and a.docs @> jsonb_build_array(jsonb_build_object('path', name)))));

create or replace function public.lawyer_apply(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  insert into public.lawyers (user_id, name, qualification, enrolment_no, bar_council, years, city, languages, specialities, profile, fee, modes, docs)
  values (auth.uid(), btrim(coalesce(p->>'name', '')), coalesce(p->>'qualification', ''), coalesce(p->>'enrolment_no', ''), coalesce(p->>'bar_council', ''),
    nullif(p->>'years', '')::int, coalesce(p->>'city', ''), coalesce(p->>'languages', ''),
    coalesce(array(select jsonb_array_elements_text(p->'specialities')), '{}'), coalesce(p->>'profile', ''), coalesce(nullif(p->>'fee', '')::bigint, 0),
    coalesce(array(select jsonb_array_elements_text(p->'modes')), '{phone}'), coalesce(p->'docs', '[]'::jsonb))
  on conflict (user_id) do update set name = excluded.name, qualification = excluded.qualification, enrolment_no = excluded.enrolment_no,
    bar_council = excluded.bar_council, years = excluded.years, city = excluded.city, languages = excluded.languages, specialities = excluded.specialities,
    profile = excluded.profile, fee = excluded.fee, modes = excluded.modes, docs = excluded.docs,
    status = case when public.lawyers.status = 'verified' then 'verified' else 'pending' end, updated_at = now()
  returning id into v;
  insert into public.notifications (user_id, kind, title, body, link)
    select id, 'system', 'Legal professional application', left(btrim(coalesce(p->>'name', '')) || ' · ' || coalesce(p->>'bar_council', ''), 400), '#admin' from public.profiles where role = 'admin';
  return v;
end $$;
grant execute on function public.lawyer_apply(jsonb) to authenticated;

create or replace function public.admin_set_lawyer(p_id uuid, p_status text, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare l public.lawyers;
begin
  if not public.is_admin() then raise exception 'Only RAQBO staff can verify a legal professional.'; end if;
  if p_status not in ('verified','rejected','suspended','pending') then raise exception 'Unknown status.'; end if;
  if p_status in ('rejected','suspended') and char_length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'Give the reason.'; end if;
  select * into l from public.lawyers where id = p_id for update;
  if l.id is null then raise exception 'Not found.'; end if;
  if p_status = 'verified' and (l.enrolment_no = '' or l.bar_council = '') then raise exception 'Record the bar council and enrolment number before verifying.'; end if;
  update public.lawyers set status = p_status, admin_note = coalesce(p_note, ''), verified_at = case when p_status = 'verified' then now() else verified_at end, updated_at = now() where id = p_id;
  perform public.audit('lawyer.' || p_status, 'lawyer', l.name, p_note, null);
  if l.user_id is not null then perform public.notify(l.user_id, 'system', case p_status when 'verified' then 'Your legal profile is approved' when 'rejected' then 'Legal profile not approved' else 'Legal profile updated' end, left(coalesce(p_note, ''), 400), '#my/lawyer'); end if;
end $$;
grant execute on function public.admin_set_lawyer(uuid, text, text) to authenticated;

create or replace function public.legal_book(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare r text; f bigint := 0; l public.lawyers;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if (select count(*) from public.legal_appointments where user_id = auth.uid() and created_at > now() - interval '1 day') >= 5 then raise exception 'You have booked several consultations today.'; end if;
  if nullif(p->>'lawyer_id', '') is not null then
    select * into l from public.lawyers where id = (p->>'lawyer_id')::uuid and status = 'verified' and active;
    if l.id is null then raise exception 'That legal professional is not available.'; end if;
    if not (coalesce(p->>'mode', 'phone') = any(l.modes)) then raise exception 'That consultation type is not offered by this professional.'; end if;
    f := l.fee;
  end if;
  insert into public.legal_appointments (user_id, lawyer_id, matter, mode, summary, preferred_at, duration_min, fee, docs)
  values (auth.uid(), nullif(p->>'lawyer_id', '')::uuid, coalesce(nullif(p->>'matter', ''), 'other'), coalesce(nullif(p->>'mode', ''), 'phone'),
    coalesce(p->>'summary', ''), nullif(p->>'preferred_at', '')::timestamptz, coalesce(nullif(p->>'duration_min', '')::int, 30), f, coalesce(p->'docs', '[]'::jsonb))
  returning ref into r;
  insert into public.notifications (user_id, kind, title, body, link)
    select id, 'system', 'Legal consultation requested', left(r || ' · ' || coalesce(p->>'matter', ''), 400), '#admin' from public.profiles where role = 'admin';
  if l.user_id is not null then perform public.notify(l.user_id, 'system', 'New consultation request', left(r, 200), '#my/lawyer'); end if;
  return r;
end $$;
grant execute on function public.legal_book(jsonb) to authenticated;

create or replace function public.legal_update(p_ref text, p_status text, p_confirmed timestamptz, p_note text, p_fee_status text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a public.legal_appointments; is_lawyer boolean;
begin
  select * into a from public.legal_appointments where ref = p_ref for update;
  if a.id is null then raise exception 'Appointment not found.'; end if;
  is_lawyer := exists (select 1 from public.lawyers l where l.id = a.lawyer_id and l.user_id = auth.uid());
  if not (is_lawyer or public.is_admin()) then raise exception 'Only RAQBO or the legal professional can update this appointment.'; end if;
  if p_status not in ('requested','confirmed','completed','cancelled','no_show') then raise exception 'Unknown status.'; end if;
  update public.legal_appointments set status = p_status, confirmed_at = coalesce(p_confirmed, confirmed_at),
    admin_note = left(coalesce(p_note, admin_note), 600), fee_status = coalesce(nullif(p_fee_status, ''), fee_status), updated_at = now() where id = a.id;
  perform public.notify(a.user_id, 'system', 'Legal consultation ' || p_status, left(a.ref || case when p_confirmed is not null then ' · ' || to_char(p_confirmed at time zone 'Asia/Karachi', 'DD Mon YYYY HH24:MI') else '' end, 400), '#my/legal');
end $$;
grant execute on function public.legal_update(text, text, timestamptz, text, text) to authenticated;

create or replace function public.legal_feedback(p_ref text, p_rating int, p_text text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.legal_appointments set rating = p_rating, feedback = left(coalesce(p_text, ''), 1000), updated_at = now()
   where ref = p_ref and user_id = auth.uid() and status = 'completed';
  if not found then raise exception 'You can only rate a consultation you had.'; end if;
end $$;
grant execute on function public.legal_feedback(text, int, text) to authenticated;

create or replace function public.lawyer_view()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l public.lawyers;
begin
  select * into l from public.lawyers where user_id = auth.uid();
  if l.id is null then return jsonb_build_object('profile', null, 'appointments', '[]'::jsonb); end if;
  return jsonb_build_object('profile', to_jsonb(l) - 'docs',
    'appointments', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from public.legal_appointments a where a.lawyer_id = l.id), '[]'::jsonb));
end $$;
grant execute on function public.lawyer_view() to authenticated;

-- ---------- 7. Stamp duty & property tax: admin-controlled, date-effective ----------
create table if not exists public.tax_rates (
  id            bigint generated always as identity primary key,
  province      text not null default 'Punjab' check (char_length(province) <= 40),
  district      text not null default '' check (char_length(district) <= 60),     -- '' means the whole province
  prop_category text not null default 'any' check (prop_category in ('any','residential','commercial','industrial','agricultural')),
  effective_from date not null,
  effective_to   date,
  stamp_duty_pct    numeric(6,3) not null default 0 check (stamp_duty_pct between 0 and 100),
  registration_pct  numeric(6,3) not null default 0 check (registration_pct between 0 and 100),
  registration_flat bigint not null default 0 check (registration_flat >= 0),
  local_fee_pct     numeric(6,3) not null default 0 check (local_fee_pct between 0 and 100),
  buyer_tax_filer_pct     numeric(6,3) not null default 0 check (buyer_tax_filer_pct between 0 and 100),
  buyer_tax_nonfiler_pct  numeric(6,3) not null default 0 check (buyer_tax_nonfiler_pct between 0 and 100),
  seller_tax_filer_pct    numeric(6,3) not null default 0 check (seller_tax_filer_pct between 0 and 100),
  seller_tax_nonfiler_pct numeric(6,3) not null default 0 check (seller_tax_nonfiler_pct between 0 and 100),
  other_pct         numeric(6,3) not null default 0 check (other_pct between 0 and 100),
  basis             text not null default 'higher' check (basis in ('price','valuation','higher')),
  source_note       text not null default '' check (char_length(source_note) <= 300),
  active            boolean not null default true,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists tax_rates_lookup_idx on public.tax_rates (province, district, prop_category, effective_from desc);
alter table public.tax_rates enable row level security;
drop policy if exists "tax_rates: read active" on public.tax_rates;
create policy "tax_rates: read active" on public.tax_rates for select using (active or public.is_admin());
revoke insert, update, delete on public.tax_rates from anon, authenticated;
grant select on public.tax_rates to anon, authenticated;

create table if not exists public.tax_rate_history (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor_name text not null default '',
  action     text not null,
  data       jsonb not null default '{}'::jsonb
);
alter table public.tax_rate_history enable row level security;
drop policy if exists "tax_rate_history: admin" on public.tax_rate_history;
create policy "tax_rate_history: admin" on public.tax_rate_history for select using (public.is_admin());
grant select on public.tax_rate_history to authenticated;

create or replace function public.admin_save_tax_rate(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  if not (public.has_perm('settings') or public.is_admin()) then raise exception 'Only RAQBO staff can change tax rates.'; end if;
  if nullif(p->>'id', '') is null then
    insert into public.tax_rates (province, district, prop_category, effective_from, effective_to, stamp_duty_pct, registration_pct, registration_flat, local_fee_pct,
      buyer_tax_filer_pct, buyer_tax_nonfiler_pct, seller_tax_filer_pct, seller_tax_nonfiler_pct, other_pct, basis, source_note, created_by)
    values (coalesce(nullif(p->>'province', ''), 'Punjab'), coalesce(p->>'district', ''), coalesce(nullif(p->>'prop_category', ''), 'any'),
      coalesce(nullif(p->>'effective_from', '')::date, (now() at time zone 'Asia/Karachi')::date), nullif(p->>'effective_to', '')::date,
      coalesce(nullif(p->>'stamp_duty_pct', '')::numeric, 0), coalesce(nullif(p->>'registration_pct', '')::numeric, 0), coalesce(nullif(p->>'registration_flat', '')::bigint, 0),
      coalesce(nullif(p->>'local_fee_pct', '')::numeric, 0), coalesce(nullif(p->>'buyer_tax_filer_pct', '')::numeric, 0), coalesce(nullif(p->>'buyer_tax_nonfiler_pct', '')::numeric, 0),
      coalesce(nullif(p->>'seller_tax_filer_pct', '')::numeric, 0), coalesce(nullif(p->>'seller_tax_nonfiler_pct', '')::numeric, 0), coalesce(nullif(p->>'other_pct', '')::numeric, 0),
      coalesce(nullif(p->>'basis', ''), 'higher'), coalesce(p->>'source_note', ''), auth.uid())
    returning id into v;
  else
    update public.tax_rates set province = coalesce(nullif(p->>'province', ''), province), district = coalesce(p->>'district', district),
      prop_category = coalesce(nullif(p->>'prop_category', ''), prop_category), effective_from = coalesce(nullif(p->>'effective_from', '')::date, effective_from),
      effective_to = nullif(p->>'effective_to', '')::date, stamp_duty_pct = coalesce(nullif(p->>'stamp_duty_pct', '')::numeric, stamp_duty_pct),
      registration_pct = coalesce(nullif(p->>'registration_pct', '')::numeric, registration_pct), registration_flat = coalesce(nullif(p->>'registration_flat', '')::bigint, registration_flat),
      local_fee_pct = coalesce(nullif(p->>'local_fee_pct', '')::numeric, local_fee_pct), buyer_tax_filer_pct = coalesce(nullif(p->>'buyer_tax_filer_pct', '')::numeric, buyer_tax_filer_pct),
      buyer_tax_nonfiler_pct = coalesce(nullif(p->>'buyer_tax_nonfiler_pct', '')::numeric, buyer_tax_nonfiler_pct), seller_tax_filer_pct = coalesce(nullif(p->>'seller_tax_filer_pct', '')::numeric, seller_tax_filer_pct),
      seller_tax_nonfiler_pct = coalesce(nullif(p->>'seller_tax_nonfiler_pct', '')::numeric, seller_tax_nonfiler_pct), other_pct = coalesce(nullif(p->>'other_pct', '')::numeric, other_pct),
      basis = coalesce(nullif(p->>'basis', ''), basis), source_note = coalesce(p->>'source_note', source_note), active = coalesce((p->>'active')::boolean, active)
    where id = (p->>'id')::bigint returning id into v;
    if v is null then raise exception 'Rate row not found.'; end if;
  end if;
  insert into public.tax_rate_history (actor_name, action, data)
    values (coalesce((select coalesce(nullif(full_name, ''), email) from public.profiles where id = auth.uid()), 'system'), case when nullif(p->>'id', '') is null then 'added' else 'changed' end, p);
  perform public.audit('tax_rate.save', 'tax_rate', v::text, coalesce(p->>'source_note', ''), p);
  return v;
end $$;
grant execute on function public.admin_save_tax_rate(jsonb) to authenticated;

-- Estimate the cost of a property transaction. Indicative only.
create or replace function public.tax_estimate(p_province text, p_district text, p_category text, p_price bigint, p_valuation bigint, p_filer boolean, p_on date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.tax_rates; d date := coalesce(p_on, (now() at time zone 'Asia/Karachi')::date); base bigint; sd bigint; reg bigint; loc bigint; bt bigint; st bigint; oth bigint;
begin
  select * into r from public.tax_rates
   where active and province = coalesce(nullif(p_province, ''), 'Punjab')
     and (district = coalesce(p_district, '') or district = '')
     and (prop_category = coalesce(nullif(p_category, ''), 'any') or prop_category = 'any')
     and effective_from <= d and (effective_to is null or effective_to >= d)
   order by (district <> '') desc, (prop_category <> 'any') desc, effective_from desc limit 1;
  if r.id is null then
    return jsonb_build_object('ok', false, 'why', 'RAQBO has not published rates for this province, district and date yet. Use the official government links instead.');
  end if;
  base := case r.basis when 'price' then coalesce(p_price, 0) when 'valuation' then coalesce(p_valuation, 0) else greatest(coalesce(p_price, 0), coalesce(p_valuation, 0)) end;
  if base <= 0 then return jsonb_build_object('ok', false, 'why', 'Enter the price or the official valuation.'); end if;
  sd  := round(base * r.stamp_duty_pct / 100.0);
  reg := round(base * r.registration_pct / 100.0) + r.registration_flat;
  loc := round(base * r.local_fee_pct / 100.0);
  bt  := round(base * (case when p_filer then r.buyer_tax_filer_pct else r.buyer_tax_nonfiler_pct end) / 100.0);
  st  := round(base * (case when p_filer then r.seller_tax_filer_pct else r.seller_tax_nonfiler_pct end) / 100.0);
  oth := round(base * r.other_pct / 100.0);
  return jsonb_build_object('ok', true, 'basis_amount', base, 'basis', r.basis, 'effective_from', r.effective_from, 'source_note', r.source_note,
    'stamp_duty', sd, 'registration', reg, 'local_fee', loc, 'other', oth,
    'buyer_tax', bt, 'seller_tax', st,
    'buyer_total', sd + reg + loc + oth + bt,     -- buyer normally pays stamp duty and registration
    'seller_total', st,
    'total', sd + reg + loc + oth + bt + st);
end $$;
grant execute on function public.tax_estimate(text, text, text, bigint, bigint, boolean, date) to anon, authenticated;

-- ---------- 10. Admin views ----------
create or replace function public.rm_admin(p_what text default 'summary')
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_perm('listings') or public.is_admin()) then raise exception 'Only RAQBO staff can see this.'; end if;
  if p_what = 'properties' then
    return coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object('owner', (select coalesce(nullif(full_name, ''), email) from public.profiles where id = p.owner_id),
      'tenancies', (select count(*) from public.rm_tenancies y where y.property_id = p.id and y.status = 'active')) order by p.created_at desc)
      from public.rm_properties p where p.managed_by = 'raqbo' or p.mgmt_status <> 'none'), '[]'::jsonb);
  elsif p_what = 'screening' then
    return coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object('owner', (select coalesce(nullif(full_name, ''), email) from public.profiles where id = c.owner_id)) order by c.created_at desc)
      from public.ts_checks c limit 300), '[]'::jsonb);
  elsif p_what = 'legal' then
    return jsonb_build_object(
      'lawyers', coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at desc) from public.lawyers l), '[]'::jsonb),
      'appointments', coalesce((select jsonb_agg(to_jsonb(a) || jsonb_build_object('who', (select coalesce(nullif(full_name, ''), email) from public.profiles where id = a.user_id),
         'lawyer', (select name from public.lawyers where id = a.lawyer_id)) order by a.created_at desc) from public.legal_appointments a limit 300), '[]'::jsonb));
  elsif p_what = 'commercial' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'ref', l.ref, 'title', l.title, 'kind', l.commercial_kind, 'purpose', l.purpose,
        'city', l.city, 'area', l.area, 'price', l.price, 'status', l.status, 'created_at', l.created_at,
        'enquiries', (select count(*) from public.enquiries e where e.property_ref = l.ref),
        'visits', (select count(*) from public.inspections v where v.listing_id = l.id)) order by l.created_at desc)
      from public.listings l where l.commercial_kind is not null or l.property_type = 'Commercial'), '[]'::jsonb);
  elsif p_what = 'tax' then
    return jsonb_build_object('rates', coalesce((select jsonb_agg(to_jsonb(t) order by t.province, t.district, t.effective_from desc) from public.tax_rates t), '[]'::jsonb),
      'history', coalesce((select jsonb_agg(to_jsonb(h) order by h.at desc) from public.tax_rate_history h limit 100), '[]'::jsonb));
  end if;
  return jsonb_build_object(
    'rm_properties', (select count(*) from public.rm_properties),
    'rm_managed', (select count(*) from public.rm_properties where managed_by = 'raqbo' and mgmt_status = 'active'),
    'rm_requested', (select count(*) from public.rm_properties where mgmt_status = 'requested'),
    'tenancies_active', (select count(*) from public.rm_tenancies where status = 'active'),
    'rent_overdue_n', (select count(*) from public.rm_rent where status = 'overdue'),
    'screening_open', (select count(*) from public.ts_checks where status in ('awaiting_consent','consented','in_progress')),
    'lawyers_pending', (select count(*) from public.lawyers where status = 'pending'),
    'appointments_open', (select count(*) from public.legal_appointments where status in ('requested','confirmed')),
    'commercial_live', (select count(*) from public.listings where status = 'published' and (commercial_kind is not null or property_type = 'Commercial')),
    'maintenance_open', (select count(*) from public.rm_maintenance where status in ('open','in_progress')));
end $$;
grant execute on function public.rm_admin(text) to authenticated;

create or replace function public.admin_set_managed(p_id uuid, p_status text, p_fee numeric default null)
returns void language plpgsql security definer set search_path = public as $$
declare p public.rm_properties;
begin
  if not (public.has_perm('listings') or public.is_admin()) then raise exception 'Only RAQBO staff can do this.'; end if;
  if p_status not in ('none','requested','active','ended') then raise exception 'Unknown status.'; end if;
  update public.rm_properties set mgmt_status = p_status, managed_by = case when p_status in ('active','requested') then 'raqbo' else 'self' end,
    mgmt_fee_pct = coalesce(p_fee, mgmt_fee_pct), updated_at = now() where id = p_id returning * into p;
  if p.id is null then raise exception 'Property not found.'; end if;
  perform public.audit('rm.managed_' || p_status, 'rm_property', p.ref, '', null);
  perform public.notify(p.owner_id, 'system', 'RAQBO property management ' || p_status, left(p.title, 200), '#my/landlord');
end $$;
grant execute on function public.admin_set_managed(uuid, text, numeric) to authenticated;

-- Member roles get landlord / tenant / lawyer
alter table public.profiles add column if not exists member_roles text[] not null default '{}';
create or replace function public.set_member_roles(p_roles text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if exists (select 1 from unnest(coalesce(p_roles, '{}')) r where r not in ('landlord','tenant','commercial','lawyer')) then raise exception 'Unknown role.'; end if;
  update public.profiles set member_roles = coalesce(p_roles, '{}') where id = auth.uid();
end $$;
grant execute on function public.set_member_roles(text[]) to authenticated;

-- =====================================================================
-- Speed on busy days
-- These are look-up shortcuts. They do not change any data; they only
-- let the database find rows without reading whole tables, which keeps
-- the site quick when many people are using it at once.
-- =====================================================================
create index if not exists listings_commercial_live_idx on public.listings (commercial_kind, city, purpose) where status = 'published' and commercial_kind is not null;
create index if not exists rm_rent_tenancy_idx on public.rm_rent (tenancy_id, due_on);
create index if not exists rm_rent_status_idx on public.rm_rent (status, due_on) where status in ('due', 'overdue');
create index if not exists rm_maintenance_prop_idx on public.rm_maintenance (property_id, status, created_at desc);
create index if not exists rm_expenses_prop_idx on public.rm_expenses (property_id, spent_on desc);
create index if not exists rm_tenancies_tenant_idx on public.rm_tenancies (tenant_id, status);
create index if not exists ts_checks_status_idx on public.ts_checks (status, created_at desc);
create index if not exists legal_appt_lawyer_idx on public.legal_appointments (lawyer_id, status, preferred_at desc);
create index if not exists lawyers_live_idx on public.lawyers (status, city) where status = 'approved';
