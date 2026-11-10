-- =====================================================================
-- 27. RAQBO Property Verification Report (unique number + QR check)
--     and the extended Property Passport (land-record references,
--     location and photo history, transactions through RAQBO).
-- Run after update_18_listings.sql. Safe to run more than once.
-- =====================================================================
create sequence if not exists public.verification_report_seq;
alter table public.listing_verifications add column if not exists report_no text;
alter table public.listing_verifications add column if not exists not_examined text not null default '';
alter table public.listing_verifications add column if not exists concerns text not null default '';
alter table public.listing_verifications add column if not exists limitations text not null default '';
create unique index if not exists listing_verifications_report_no on public.listing_verifications (report_no) where report_no is not null;
do $$ begin alter table public.listing_verifications add constraint lv_report_text_len check (char_length(not_examined) <= 2000 and char_length(concerns) <= 2000 and char_length(limitations) <= 2000); exception when duplicate_object then null; end $$;

-- Each approval gets a fresh report number (a re-check is a new report)
create or replace function public.lv_report_no()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'verified' and (tg_op = 'INSERT' or old.status is distinct from 'verified' or new.report_no is null) then
    new.report_no := 'RQ-VR-' || to_char(now() at time zone 'Asia/Karachi', 'YYYY') || '-' || lpad(nextval('public.verification_report_seq')::text, 6, '0');
  end if;
  return new;
end $$;
drop trigger if exists lv_report_no on public.listing_verifications;
create trigger lv_report_no before insert or update on public.listing_verifications for each row execute function public.lv_report_no();
update public.listing_verifications set report_no = 'RQ-VR-' || to_char(coalesce(decided_at, now()) at time zone 'Asia/Karachi', 'YYYY') || '-' || lpad(nextval('public.verification_report_seq')::text, 6, '0')
  where status = 'verified' and report_no is null;

-- Old report numbers stay checkable after a re-check or badge removal
create table if not exists public.verification_reports (
  report_no    text primary key,
  listing_id   uuid not null references public.listings (id) on delete cascade,
  level        text not null,
  checks       jsonb not null default '[]'::jsonb,
  not_examined text not null default '',
  concerns     text not null default '',
  limitations  text not null default '',
  issued_at    timestamptz not null default now(),
  withdrawn_at timestamptz,
  withdrawn_reason text not null default ''
);
alter table public.verification_reports enable row level security;
revoke insert, update, delete on public.verification_reports from anon, authenticated;

create or replace function public.lv_report_archive()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'verified' and new.report_no is not null then
    insert into public.verification_reports (report_no, listing_id, level, checks, not_examined, concerns, limitations, issued_at)
    values (new.report_no, new.listing_id, new.level, new.checks, new.not_examined, new.concerns, new.limitations, coalesce(new.decided_at, now()))
    on conflict (report_no) do update set checks = excluded.checks, not_examined = excluded.not_examined, concerns = excluded.concerns, limitations = excluded.limitations, level = excluded.level;
  end if;
  if tg_op = 'UPDATE' and old.status = 'verified' and new.status <> 'verified' and old.report_no is not null then
    update public.verification_reports set withdrawn_at = now(), withdrawn_reason = case when new.status = 'expired' then 'Key property details changed after the check' else 'Verification withdrawn' end where report_no = old.report_no and withdrawn_at is null;
  end if;
  return null;
end $$;
drop trigger if exists lv_report_archive on public.listing_verifications;
create trigger lv_report_archive after insert or update on public.listing_verifications for each row execute function public.lv_report_archive();
insert into public.verification_reports (report_no, listing_id, level, checks, issued_at)
  select report_no, listing_id, level, checks, coalesce(decided_at, now()) from public.listing_verifications where report_no is not null on conflict do nothing;

-- Admin writes what could not be examined, concerns and limitations
create or replace function public.admin_set_verification_report(p_listing uuid, p_not_examined text, p_concerns text, p_limitations text)
returns text language plpgsql security definer set search_path = public as $$
declare r text;
begin
  if not public.has_perm('verification') then raise exception 'You do not have permission to manage verification.'; end if;
  update public.listing_verifications set not_examined = left(coalesce(p_not_examined, ''), 2000), concerns = left(coalesce(p_concerns, ''), 2000), limitations = left(coalesce(p_limitations, ''), 2000)
   where listing_id = p_listing returning report_no into r;
  return r;
end $$;
grant execute on function public.admin_set_verification_report(uuid, text, text, text) to authenticated;

-- Public check of a report number (no personal data)
create or replace function public.verify_report(p_no text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('report_no', r.report_no, 'level', r.level, 'issued_at', r.issued_at, 'withdrawn_at', r.withdrawn_at, 'withdrawn_reason', r.withdrawn_reason,
    'current', r.withdrawn_at is null and exists (select 1 from public.listing_verifications v where v.listing_id = r.listing_id and v.report_no = r.report_no and v.status = 'verified'),
    'checks', r.checks, 'not_examined', r.not_examined, 'concerns', r.concerns, 'limitations', r.limitations,
    'listing', jsonb_build_object('id', l.id, 'ref', l.ref, 'title', l.title, 'city', l.city, 'area', l.area, 'size', l.size, 'size_unit', l.size_unit, 'type', l.property_type, 'published', l.status = 'published'))
  from public.verification_reports r join public.listings l on l.id = r.listing_id where r.report_no = upper(btrim(p_no)) $$;
grant execute on function public.verify_report(text) to anon, authenticated;

-- ---------- Property Passport ----------
create table if not exists public.property_private (
  listing_id      uuid primary key references public.listings (id) on delete cascade,
  land_refs       text not null default '' check (char_length(land_refs) <= 600),   -- khasra / khewat / khatoni / fard / plot numbers
  ownership_note  text not null default '' check (char_length(ownership_note) <= 600),
  updated_at      timestamptz not null default now()
);
alter table public.property_private enable row level security;
drop policy if exists "property_private: owner or admin" on public.property_private;
create policy "property_private: owner or admin" on public.property_private for select using (public.is_admin() or exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = auth.uid()));
revoke insert, update, delete on public.property_private from anon, authenticated;

create or replace function public.set_property_private(p_listing uuid, p_land_refs text, p_ownership_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.listings where id = p_listing and (owner_id = auth.uid() or public.is_admin())) then raise exception 'You can only update your own property.'; end if;
  insert into public.property_private (listing_id, land_refs, ownership_note) values (p_listing, left(btrim(coalesce(p_land_refs, '')), 600), left(btrim(coalesce(p_ownership_note, '')), 600))
  on conflict (listing_id) do update set land_refs = excluded.land_refs, ownership_note = excluded.ownership_note, updated_at = now();
end $$;
grant execute on function public.set_property_private(uuid, text, text) to authenticated;

create table if not exists public.listing_changes (
  id          bigserial primary key,
  listing_id  uuid not null references public.listings (id) on delete cascade,
  field       text not null,
  old_value   text,
  new_value   text,
  at          timestamptz not null default now()
);
create index if not exists listing_changes_idx on public.listing_changes (listing_id, at);
alter table public.listing_changes enable row level security;
revoke insert, update, delete on public.listing_changes from anon, authenticated;
create or replace function public.listings_log_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.city is distinct from old.city then insert into public.listing_changes (listing_id, field, old_value, new_value) values (new.id, 'city', old.city, new.city); end if;
  if new.area is distinct from old.area then insert into public.listing_changes (listing_id, field, old_value, new_value) values (new.id, 'area', old.area, new.area); end if;
  if new.size is distinct from old.size or new.size_unit is distinct from old.size_unit then insert into public.listing_changes (listing_id, field, old_value, new_value) values (new.id, 'size', old.size || ' ' || old.size_unit, new.size || ' ' || new.size_unit); end if;
  if new.property_type is distinct from old.property_type then insert into public.listing_changes (listing_id, field, old_value, new_value) values (new.id, 'type', old.property_type, new.property_type); end if;
  return null;
end $$;
drop trigger if exists listings_log_changes on public.listings;
create trigger listings_log_changes after update on public.listings for each row execute function public.listings_log_changes();

create or replace function public.passport_data(p_listing uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l public.listings; allowed boolean;
begin
  select * into l from public.listings where id = p_listing;
  if l.id is null then return null; end if;
  allowed := l.owner_id = auth.uid() or public.is_admin();
  if l.status <> 'published' and not allowed then return null; end if;
  return jsonb_build_object(
    'property_id', l.ref, 'listed_at', coalesce(l.published_at, l.created_at),
    'location_history', coalesce((select jsonb_agg(jsonb_build_object('field', c.field, 'from', c.old_value, 'to', c.new_value, 'at', c.at) order by c.at) from public.listing_changes c where c.listing_id = l.id), '[]'::jsonb),
    'photo_history', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'photos', n) order by d) from (select date_trunc('day', m.created_at) d, count(*) n from public.listing_media m where m.listing_id = l.id and m.kind = 'photo' group by 1) x), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(jsonb_build_object('report_no', r.report_no, 'level', r.level, 'issued_at', r.issued_at, 'withdrawn_at', r.withdrawn_at) order by r.issued_at desc) from public.verification_reports r where r.listing_id = l.id), '[]'::jsonb),
    'transactions', coalesce((select jsonb_agg(t order by t->>'at') from (
        select jsonb_build_object('kind', 'auction', 'at', a.finalized_at, 'text', case a.status when 'sold' then 'Sold through a RAQBO auction' when 'provisional' then 'Auction ended — provisional winning bidder' when 'reserve_not_met' then 'Auctioned — reserve not met' when 'cancelled' then 'Auction cancelled' else 'Auction closed' end, 'amount', case when a.status in ('sold','provisional') then a.high_amount end) t
          from public.auctions a where a.listing_id = l.id and a.finalized_at is not null
        union all
        select jsonb_build_object('kind', 'quicksell', 'at', u.updated_at, 'text', case u.stage when 'sold' then 'Sold through RAQBO QuickSell' when 'closed' then 'QuickSell request closed' else 'QuickSell request not accepted' end, 'amount', null)
          from public.urgent_requests u where u.listing_id = l.id and u.stage in ('sold','closed','rejected')) z), '[]'::jsonb),
    'report', (select jsonb_build_object('report_no', v.report_no, 'level', v.level, 'checks', v.checks, 'not_examined', v.not_examined, 'concerns', v.concerns, 'limitations', v.limitations, 'issued_at', v.decided_at)
                 from public.listing_verifications v where v.listing_id = l.id and v.status = 'verified'),
    'land_refs_on_file', exists (select 1 from public.property_private p where p.listing_id = l.id and p.land_refs <> ''),
    'private', case when allowed then (select jsonb_build_object('land_refs', p.land_refs, 'ownership_note', p.ownership_note) from public.property_private p where p.listing_id = l.id) end,
    'documents', case when allowed then (select v.documents from public.listing_verifications v where v.listing_id = l.id) end,
    'can_see_private', allowed);
end $$;
grant execute on function public.passport_data(uuid) to anon, authenticated;
