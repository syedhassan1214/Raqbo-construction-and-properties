-- =====================================================================
-- 26. Listing accuracy: landmarks, availability, marla standard, price
--     history, periodic availability confirmation and expiry, RAQBO
--     Direct "partner development" role, site visits for every listing.
-- Run after update_17_quicksell.sql. Safe to run more than once.
-- =====================================================================
alter table public.listings add column if not exists landmarks text not null default '';
alter table public.listings add column if not exists availability text not null default 'available';
alter table public.listings add column if not exists marla_sqft smallint;
alter table public.listings add column if not exists confirmed_at timestamptz not null default now();
alter table public.listings add column if not exists confirm_reminded_at timestamptz;
alter table public.listings add column if not exists prev_price bigint;
alter table public.listings add column if not exists price_changed_at timestamptz;
do $$ begin alter table public.listings add constraint listings_landmarks_len check (char_length(landmarks) <= 300); exception when duplicate_object then null; end $$;
do $$ begin alter table public.listings add constraint listings_availability_check check (availability in ('available','under_offer','sold','rented')); exception when duplicate_object then null; end $$;
do $$ begin alter table public.listings add constraint listings_marla_sqft_check check (marla_sqft is null or marla_sqft in (225, 250, 272)); exception when duplicate_object then null; end $$;
-- Listings that were not re-confirmed become "expired" (hidden until the owner confirms again)
alter table public.listings drop constraint if exists listings_status_check;
alter table public.listings add constraint listings_status_check check (status in ('pending', 'published', 'rejected', 'expired'));
alter table public.listings drop constraint if exists listings_raqbo_role_check;
alter table public.listings add constraint listings_raqbo_role_check check (raqbo_role is null or raqbo_role in ('owner','purchaser','agent','facilitator','partner'));

alter table public.platform_settings add column if not exists listing_confirm_days int not null default 60;
alter table public.platform_settings add column if not exists listing_grace_days int not null default 15;
alter table public.platform_settings add column if not exists expiry_last_run timestamptz;

-- Price history (public for published listings)
create table if not exists public.listing_price_history (
  id          bigserial primary key,
  listing_id  uuid not null references public.listings (id) on delete cascade,
  price       bigint not null,
  at          timestamptz not null default now()
);
create index if not exists listing_price_history_idx on public.listing_price_history (listing_id, at);
alter table public.listing_price_history enable row level security;
revoke insert, update, delete on public.listing_price_history from anon, authenticated;

-- System fields: owners cannot set them; price changes are recorded automatically
create or replace function public.listings_zz_v3()
returns trigger language plpgsql security definer set search_path = public
as $$
declare sys boolean := coalesce(current_setting('raqbo.sys', true), '') = '1' or auth.uid() is null or public.is_admin();
begin
  if tg_op = 'INSERT' then
    if not sys then new.confirmed_at := now(); new.prev_price := null; new.price_changed_at := null; new.confirm_reminded_at := null; if new.status = 'expired' then new.status := 'pending'; end if; end if;
    return new;
  end if;
  if not sys then
    new.confirmed_at := old.confirmed_at; new.confirm_reminded_at := old.confirm_reminded_at;
    if new.status = 'expired' and old.status <> 'expired' then new.status := old.status; end if;
  end if;
  if new.price is distinct from old.price then
    new.prev_price := old.price; new.price_changed_at := now();
    new.confirmed_at := now();                      -- changing the price confirms the listing is current
  elsif not sys then
    new.prev_price := old.prev_price; new.price_changed_at := old.price_changed_at;
  end if;
  return new;
end $$;
drop trigger if exists listings_zz_v3 on public.listings;
create trigger listings_zz_v3 before insert or update on public.listings for each row execute function public.listings_zz_v3();

create or replace function public.listings_price_log()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.price is distinct from old.price then insert into public.listing_price_history (listing_id, price) values (new.id, new.price); end if;
  return null;
end $$;
drop trigger if exists listings_price_log on public.listings;
create trigger listings_price_log after insert or update of price on public.listings for each row execute function public.listings_price_log();
insert into public.listing_price_history (listing_id, price, at)
  select l.id, l.price, coalesce(l.published_at, l.created_at) from public.listings l where not exists (select 1 from public.listing_price_history h where h.listing_id = l.id);

create or replace function public.listing_price_history(p_listing uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('price', h.price, 'at', h.at) order by h.at), '[]'::jsonb)
  from public.listing_price_history h join public.listings l on l.id = h.listing_id
  where h.listing_id = p_listing and (l.status = 'published' or l.owner_id = auth.uid() or public.is_admin()) $$;
grant execute on function public.listing_price_history(uuid) to anon, authenticated;

-- Owner confirms the property is still available (also re-publishes an expired listing)
create or replace function public.confirm_listing(p_listing uuid, p_availability text default null)
returns text language plpgsql security definer set search_path = public
as $$
declare l public.listings;
begin
  select * into l from public.listings where id = p_listing;
  if l.id is null or l.owner_id is distinct from auth.uid() then raise exception 'You can only confirm your own property.'; end if;
  if p_availability is not null and p_availability not in ('available','under_offer','sold','rented') then raise exception 'Unknown availability.'; end if;
  perform set_config('raqbo.sys', '1', true);
  update public.listings set confirmed_at = now(), confirm_reminded_at = null, availability = coalesce(p_availability, availability),
    status = case when status = 'expired' then 'published' else status end where id = l.id;
  perform set_config('raqbo.sys', '', true);
  return (select status from public.listings where id = l.id);
end $$;
grant execute on function public.confirm_listing(uuid, text) to authenticated;

-- Reminders and expiry (runs at most once an hour; called from page loads and from pg_cron when enabled)
create or replace function public.listings_expire_tick(p_force boolean default false)
returns int language plpgsql security definer set search_path = public
as $$
declare s public.platform_settings; r record; n int := 0;
begin
  select * into s from public.platform_settings where id = 1;
  if s.id is null or (not p_force and s.expiry_last_run is not null and s.expiry_last_run > now() - interval '1 hour') then return 0; end if;
  update public.platform_settings set expiry_last_run = now() where id = 1;
  perform set_config('raqbo.sys', '1', true);
  for r in select id, owner_id, title from public.listings where status = 'published' and not is_sample and owner_id is not null
             and confirmed_at < now() - make_interval(days => s.listing_confirm_days) and (confirm_reminded_at is null or confirm_reminded_at < confirmed_at) loop
    update public.listings set confirm_reminded_at = now() where id = r.id;
    perform public.notify(r.owner_id, 'listing', 'Is your property still available?', left(r.title, 90) || ' · confirm within ' || s.listing_grace_days || ' days to keep it live.', '#my/properties');
  end loop;
  for r in select id, owner_id, title from public.listings where status = 'published' and not is_sample and owner_id is not null and raqbo_role is null
             and confirmed_at < now() - make_interval(days => s.listing_confirm_days + s.listing_grace_days) loop
    update public.listings set status = 'expired' where id = r.id; n := n + 1;
    perform public.notify(r.owner_id, 'listing', 'Listing paused — not confirmed', left(r.title, 90) || ' · confirm it is still available to show it again.', '#my/properties');
  end loop;
  perform set_config('raqbo.sys', '', true);
  return n;
end $$;
revoke all on function public.listings_expire_tick(boolean) from public, anon, authenticated;

-- Run the expiry check from the auction tick that every visit already calls
create or replace function public.auction_tick_v3() returns void language plpgsql security definer set search_path = public as $$ begin perform public.listings_expire_tick(false); end $$;
revoke all on function public.auction_tick_v3() from public, anon, authenticated;
create or replace function public.auctions_public()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.auction_tick();
  begin perform public.auction_tick_v3(); exception when others then null; end;
  return jsonb_build_object('now', now(), 'auctions', coalesce((select jsonb_agg(public.auction_card(a, l) order by a.end_at)
    from public.auctions a join public.listings l on l.id = a.listing_id
    where l.status = 'published' and (a.status in ('scheduled','provisional','sold') or (a.status in ('reserve_not_met','ended') and a.finalized_at > now() - interval '30 days'))
      and (a.status not in ('sold') or a.finalized_at > now() - interval '60 days')), '[]'::jsonb));
end $$;
grant execute on function public.auctions_public() to anon, authenticated;

-- Admin: every site visit (all listings), and visits to my properties
create or replace function public.admin_visits()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (public.has_perm('urgent') or public.has_perm('auctions') or public.has_perm('listings')) then raise exception 'You do not have permission to manage visits.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'listing_id', i.listing_id, 'title', l.title, 'ref', l.ref, 'area', l.area, 'city', l.city, 'status', i.status, 'preferred_at', i.preferred_at, 'confirmed_at', i.confirmed_at, 'note', i.note, 'admin_note', i.admin_note, 'created_at', i.created_at,
      'who', coalesce(nullif(p.full_name, ''), p.email), 'phone', p.phone, 'owner', coalesce(nullif(o.full_name, ''), o.email), 'owner_phone', o.phone) order by (i.status in ('requested','confirmed')) desc, coalesce(i.confirmed_at, i.preferred_at, i.created_at))
    from public.inspections i join public.listings l on l.id = i.listing_id join public.profiles p on p.id = i.user_id left join public.profiles o on o.id = l.owner_id where i.created_at > now() - interval '180 days'), '[]'::jsonb);
end $$;
grant execute on function public.admin_visits() to authenticated;

create or replace function public.my_property_visits()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'title', l.title, 'status', i.status, 'at', coalesce(i.confirmed_at, i.preferred_at), 'note', i.admin_note) order by coalesce(i.confirmed_at, i.preferred_at) desc), '[]'::jsonb)
  from public.inspections i join public.listings l on l.id = i.listing_id where l.owner_id = auth.uid() and i.created_at > now() - interval '180 days' $$;
grant execute on function public.my_property_visits() to authenticated;

-- Allow visit management by staff with listing permission too
create or replace function public.admin_set_inspection(p_id uuid, p_status text, p_when timestamptz, p_note text)
returns void language plpgsql security definer set search_path = public
as $$
declare i public.inspections; l public.listings;
begin
  if not (public.has_perm('urgent') or public.has_perm('auctions') or public.has_perm('listings')) then raise exception 'You do not have permission to manage visits.'; end if;
  if p_status not in ('requested','confirmed','completed','cancelled') then raise exception 'Unknown status.'; end if;
  update public.inspections set status = p_status, confirmed_at = coalesce(p_when, confirmed_at, preferred_at), admin_note = left(coalesce(p_note, ''), 600) where id = p_id returning * into i;
  if i.id is null then raise exception 'Visit not found.'; end if;
  select * into l from public.listings where id = i.listing_id;
  perform public.notify(i.user_id, 'deal', case p_status when 'confirmed' then 'Visit confirmed' when 'cancelled' then 'Visit cancelled' when 'completed' then 'Visit completed' else 'Visit updated' end,
    left(l.title, 100) || coalesce(' · ' || to_char(i.confirmed_at at time zone 'Asia/Karachi', 'DD Mon HH24:MI'), '') || case when coalesce(p_note, '') <> '' then ' · ' || left(p_note, 120) else '' end, '#my/offers');
  if p_status = 'confirmed' and l.owner_id is not null then
    perform public.notify(l.owner_id, 'deal', 'Visit booked for your property', left(l.title, 100) || coalesce(' · ' || to_char(i.confirmed_at at time zone 'Asia/Karachi', 'DD Mon HH24:MI'), ''), '#my/offers');
  end if;
  perform public.deal_event(i.listing_id, 'inspection', null, 'Visit ' || p_status || coalesce(' for ' || to_char(i.confirmed_at at time zone 'Asia/Karachi', 'DD Mon HH24:MI'), ''), 'raqbo');
end $$;
grant execute on function public.admin_set_inspection(uuid, text, timestamptz, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'raqbo-listing-expiry';
    perform cron.schedule('raqbo-listing-expiry', '17 * * * *', 'select public.listings_expire_tick(true)');
  end if;
exception when others then null;
end $$;
