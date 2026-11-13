-- =====================================================================
-- RAQBO update 34
--   1. Area / society boundaries on the map (admin draws or imports GeoJSON)
--   2. Home services directory — verified architects, contractors, renovation,
--      movers, electricians & plumbers, surveyors (providers apply, admin approves)
-- Safe to run more than once. Run after update_33_admin_chats.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Area boundaries
--    shape = [[lat, lng], [lat, lng], ...]  (one outer ring, at least 3 points)
-- ---------------------------------------------------------------------
create table if not exists public.area_boundaries (
  id         bigint generated always as identity primary key,
  name       text not null check (char_length(btrim(name)) between 2 and 120),
  city       text not null default '' check (char_length(city) <= 80),
  kind       text not null default 'society' check (kind in ('society','area','phase','block','city')),
  shape      jsonb not null check (jsonb_typeof(shape) = 'array' and jsonb_array_length(shape) between 3 and 5000),
  active     boolean not null default true,
  source     text not null default '' check (char_length(source) <= 300),       -- where the outline came from (e.g. drawn by admin, file name)
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists area_boundaries_city_idx on public.area_boundaries (city, name);
alter table public.area_boundaries enable row level security;
drop policy if exists "area_boundaries: public reads active" on public.area_boundaries;
create policy "area_boundaries: public reads active" on public.area_boundaries for select using (active or public.is_admin());
drop policy if exists "area_boundaries: admin adds" on public.area_boundaries;
create policy "area_boundaries: admin adds" on public.area_boundaries for insert with check (public.is_admin());
drop policy if exists "area_boundaries: admin edits" on public.area_boundaries;
create policy "area_boundaries: admin edits" on public.area_boundaries for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "area_boundaries: admin deletes" on public.area_boundaries;
create policy "area_boundaries: admin deletes" on public.area_boundaries for delete using (public.is_admin());
grant select on public.area_boundaries to anon, authenticated;
grant insert, update, delete on public.area_boundaries to authenticated;

-- ---------------------------------------------------------------------
-- 2. Home services directory
-- ---------------------------------------------------------------------
create table if not exists public.service_providers (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  business     text not null check (char_length(btrim(business)) between 2 and 120),
  contact_name text not null default '' check (char_length(contact_name) <= 120),
  category     text not null check (category in ('architect','contractor','renovation','movers','electrician_plumber','surveyor')),
  city         text not null check (char_length(btrim(city)) between 2 and 80),
  areas        text not null default '' check (char_length(areas) <= 300),
  phone        text not null check (phone ~ '^\+?[0-9 ()-]{10,20}$'),
  whatsapp     text not null default '' check (char_length(whatsapp) <= 20),
  years        int check (years is null or years between 0 and 80),
  about        text not null default '' check (char_length(about) <= 1200),
  licence      text not null default '' check (char_length(licence) <= 120),       -- PEC / PCATP / council no., if any
  website      text not null default '' check (char_length(website) <= 200),
  status       text not null default 'pending' check (status in ('pending','approved','rejected','suspended')),
  admin_note   text not null default '' check (char_length(admin_note) <= 600),
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid references public.profiles (id) on delete set null
);
create index if not exists service_providers_list_idx on public.service_providers (status, category, city);
alter table public.service_providers enable row level security;
drop policy if exists "service_providers: public reads approved" on public.service_providers;
create policy "service_providers: public reads approved" on public.service_providers for select
  using (status = 'approved' or owner_id = auth.uid() or public.is_admin());
drop policy if exists "service_providers: member applies" on public.service_providers;
create policy "service_providers: member applies" on public.service_providers for insert
  with check (owner_id = auth.uid() and status = 'pending' and public.is_verified_user());
drop policy if exists "service_providers: owner edits while pending" on public.service_providers;
create policy "service_providers: owner edits while pending" on public.service_providers for update
  using (owner_id = auth.uid() and status in ('pending','rejected'))
  with check (owner_id = auth.uid() and status = 'pending');
grant select on public.service_providers to anon, authenticated;
grant insert, update on public.service_providers to authenticated;

-- One application per member per category
create unique index if not exists service_providers_one_per_cat on public.service_providers (owner_id, category);

create or replace function public.admin_decide_provider(p_id uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public
as $$
declare r public.service_providers;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_status not in ('approved','rejected','suspended','pending') then raise exception 'Choose an outcome.'; end if;
  if p_status in ('rejected','suspended') and char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Give a reason (the business is told).'; end if;
  select * into r from public.service_providers where id = p_id;
  if r.id is null then raise exception 'Not found.'; end if;
  update public.service_providers set status = p_status, admin_note = left(btrim(coalesce(p_note, '')), 600), decided_at = now(), decided_by = auth.uid() where id = p_id;
  perform public.notify(r.owner_id, 'service',
    case p_status when 'approved' then 'Your business is listed in RAQBO Home Services' when 'rejected' then 'Your Home Services application was not approved'
                  when 'suspended' then 'Your Home Services listing is suspended' else 'Your Home Services application is back under review' end,
    left(r.business || case when p_note <> '' then ' · ' || p_note else '' end, 400), '#home-services');
  begin perform public.audit('provider_' || p_status, 'service_provider', r.business, coalesce(p_note, ''), jsonb_build_object('id', p_id)); exception when others then null; end;
end $$;
grant execute on function public.admin_decide_provider(uuid, text, text) to authenticated;

create or replace function public.service_providers_notify_new()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.notify_admins('service', 'New Home Services application', left(new.business || ' · ' || new.category || ' · ' || new.city, 300), '#admin/homeservices');
  return new;
end $$;
drop trigger if exists service_providers_new on public.service_providers;
create trigger service_providers_new after insert on public.service_providers
  for each row execute function public.service_providers_notify_new();

do $$ begin raise notice 'Update 34 applied: area boundaries on the map, and the Home Services directory.'; end $$;
