-- =====================================================================
-- 28. RAQBO Connect catalogue (5 groups, fees, tracking numbers),
--     Overseas services, a stronger Property Wanted, RAQBO projects
--     (progress updates and payment plans) and construction-material
--     specifications and bulk enquiries.
-- Run after update_19_reports.sql. Safe to run more than once.
-- =====================================================================

-- ---------- Service requests: any catalogue service, with extra form details ----------
alter table public.enquiries drop constraint if exists enquiries_service_check;
alter table public.enquiries add constraint enquiries_service_check check (service ~ '^[a-z][a-z0-9_]{1,39}$');
alter table public.enquiries add column if not exists details jsonb not null default '{}'::jsonb;
do $$ begin alter table public.enquiries add constraint enquiries_details_len check (char_length(details::text) <= 4000); exception when duplicate_object then null; end $$;

-- Fees shown on each service (admin-editable; text such as "From Rs 5,000" or "Quoted after review")
alter table public.platform_settings add column if not exists service_fees jsonb not null default '{}'::jsonb;
alter table public.platform_settings add column if not exists services_off jsonb not null default '[]'::jsonb;   -- service keys hidden from the public
create or replace function public.admin_save_services(p_fees jsonb, p_off jsonb, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.has_perm('services') or public.has_perm('settings')) then raise exception 'You do not have permission to change services.'; end if;
  if jsonb_typeof(coalesce(p_fees, '{}'::jsonb)) <> 'object' or jsonb_typeof(coalesce(p_off, '[]'::jsonb)) <> 'array' then raise exception 'Invalid services data.'; end if;
  if char_length(coalesce(p_fees, '{}'::jsonb)::text) > 8000 then raise exception 'Too much fee text.'; end if;
  update public.platform_settings set service_fees = coalesce(p_fees, '{}'::jsonb), services_off = coalesce(p_off, '[]'::jsonb), updated_at = now() where id = 1;
  perform public.audit('settings.services', 'settings', 'services', p_reason, jsonb_build_object('fees', p_fees, 'off', p_off));
end $$;
grant execute on function public.admin_save_services(jsonb, jsonb, text) to authenticated;

create or replace function public.my_service_requests()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('ref', ref, 'service', service, 'message', message, 'property_ref', property_ref, 'status', status, 'client_note', client_note, 'details', details, 'created_at', created_at, 'updated_at', updated_at) order by created_at desc), '[]'::jsonb)
  from public.enquiries where user_id = auth.uid() $$;
grant execute on function public.my_service_requests() to authenticated;

-- ---------- Property Wanted: possession, budget range, bedrooms, preferences ----------
alter table public.wanted_posts add column if not exists possession text not null default 'any';
alter table public.wanted_posts add column if not exists min_budget bigint;
alter table public.wanted_posts add column if not exists min_beds int;
alter table public.wanted_posts add column if not exists prefs text[] not null default '{}';
do $$ begin alter table public.wanted_posts add constraint wanted_v20_check check (possession in ('any','vacant','tenanted','under_construction') and (min_budget is null or min_budget > 0) and (min_beds is null or min_beds between 0 and 20) and cardinality(prefs) <= 12); exception when duplicate_object then null; end $$;

create or replace function public.wanted_posts_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select distinct on (l.owner_id) l.owner_id, l.id, l.title from public.listings l
            where l.status = 'published' and not l.is_sample and l.owner_id is not null and l.owner_id <> new.user_id
              and l.purpose = case new.purpose when 'buy' then 'sale' else 'rent' end and l.property_type = new.property_type
              and lower(l.city) = lower(new.city) and (new.area = '' or l.area ilike '%' || new.area || '%')
              and (new.max_budget is null or l.price <= new.max_budget) and (new.min_budget is null or l.price >= new.min_budget)
              and (new.possession = 'any' or l.possession is null or l.possession = new.possession or (new.possession = 'vacant' and l.possession = 'owner_occupied'))
              and (new.min_beds is null or l.property_type in ('Plot','Commercial') or coalesce(l.bedrooms, 0) >= new.min_beds)
            order by l.owner_id, l.published_at desc limit 100 loop
    perform public.notify(r.owner_id, 'alert', 'Someone wants a property like yours',
      new.property_type || ' to ' || new.purpose || ' in ' || coalesce(nullif(new.area, '') || ', ', '') || new.city || coalesce(' · up to Rs ' || to_char(new.max_budget, 'FM999,999,999,999'), '') || '. Reply privately through RAQBO messages — your number stays hidden.',
      '#wanted/' || new.id);
  end loop;
  return new;
end $$;

-- ---------- RAQBO projects: progress updates and payment plans ----------
alter table public.listings add column if not exists payment_plan jsonb not null default '[]'::jsonb;
do $$ begin alter table public.listings add constraint listings_payment_plan_check check (jsonb_typeof(payment_plan) = 'array' and char_length(payment_plan::text) <= 4000); exception when duplicate_object then null; end $$;
create or replace function public.listings_zz_v20()
returns trigger language plpgsql security definer set search_path = public as $$
declare sys boolean := coalesce(current_setting('raqbo.sys', true), '') = '1' or auth.uid() is null or public.is_admin();
begin
  if not sys then new.payment_plan := case when tg_op = 'INSERT' then '[]'::jsonb else old.payment_plan end; end if;
  return new;
end $$;
drop trigger if exists listings_zz_v20 on public.listings;
create trigger listings_zz_v20 before insert or update on public.listings for each row execute function public.listings_zz_v20();
create table if not exists public.project_updates (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references public.listings (id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 2 and 140),
  body        text not null default '' check (char_length(body) <= 2000),
  progress    int check (progress between 0 and 100),
  created_at  timestamptz not null default now()
);
create index if not exists project_updates_idx on public.project_updates (listing_id, created_at desc);
alter table public.project_updates enable row level security;
drop policy if exists "project_updates: read" on public.project_updates;
create policy "project_updates: read" on public.project_updates for select using (exists (select 1 from public.listings l where l.id = listing_id and (l.status = 'published' or public.is_admin())));
grant select on public.project_updates to anon, authenticated;
revoke insert, update, delete on public.project_updates from anon, authenticated;

create or replace function public.admin_project_update(p_listing uuid, p_title text, p_body text, p_progress int)
returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid; l public.listings; r record;
begin
  if not public.has_perm('listings') then raise exception 'You do not have permission to manage projects.'; end if;
  select * into l from public.listings where id = p_listing; if l.id is null then raise exception 'Listing not found.'; end if;
  if l.raqbo_role is null then raise exception 'Progress updates are for RAQBO Direct properties only.'; end if;
  insert into public.project_updates (listing_id, title, body, progress) values (p_listing, btrim(p_title), left(btrim(coalesce(p_body, '')), 2000), p_progress) returning id into nid;
  for r in select f.user_id from public.favorites f where f.listing_id = p_listing limit 2000 loop
    perform public.notify(r.user_id, 'listing', 'Project update: ' || left(l.title, 100), btrim(p_title), '#property/' || l.id);
  end loop;
  perform public.audit('project.update', 'listing', l.ref, null, jsonb_build_object('title', p_title, 'progress', p_progress));
  return nid;
end $$;
grant execute on function public.admin_project_update(uuid, text, text, int) to authenticated;
create or replace function public.admin_project_delete_update(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('listings') then raise exception 'You do not have permission to manage projects.'; end if;
  delete from public.project_updates where id = p_id;
end $$;
grant execute on function public.admin_project_delete_update(uuid) to authenticated;
create or replace function public.admin_set_payment_plan(p_listing uuid, p_plan jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('listings') then raise exception 'You do not have permission to manage projects.'; end if;
  if jsonb_typeof(p_plan) <> 'array' then raise exception 'The payment plan must be a list.'; end if;
  perform set_config('raqbo.sys', '1', true);
  update public.listings set payment_plan = p_plan where id = p_listing;
  perform set_config('raqbo.sys', '', true);
end $$;
grant execute on function public.admin_set_payment_plan(uuid, jsonb) to authenticated;

-- ---------- Construction materials: product specifications ----------
alter table public.vendor_products add column if not exists brand text not null default '';
alter table public.vendor_products add column if not exists specs text not null default '';
do $$ begin alter table public.vendor_products add constraint vendor_products_specs_len check (char_length(brand) <= 60 and char_length(specs) <= 600); exception when duplicate_object then null; end $$;
