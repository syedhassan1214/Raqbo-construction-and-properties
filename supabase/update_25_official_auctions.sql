-- =====================================================================
-- RAQBO update 25 — RAQBO OFFICIAL AUCTIONS
-- Government, court, bank & institutional property auction notices.
-- RAQBO publishes information only: the issuing authority runs the auction.
--   * institutions directory (admin-expandable) and institution types
--   * auction notices with source, authenticity label, auction type, status
--   * two-stage review (prepare → approve by a second admin), traceable
--     changes (source reference required), full change history
--   * corrigenda, postponements, cancellations, archive
--   * saved auctions, reminders (1/3/7 days), alert preferences,
--     website notifications + outbox for email / WhatsApp / app push
--   * institutional partners (several officers per institution),
--     submissions, drafts, change requests, statistics
--   * paid promotions with invoice numbers (finance entry when paid)
--   * performance reporting
-- Safe to run more than once.
-- =====================================================================

-- ---------- Settings ----------
create table if not exists public.oa_settings (
  id         int primary key default 1 check (id = 1),
  two_stage  boolean not null default true,       -- a second admin must approve publication
  tick_at    timestamptz not null default 'epoch', -- last automatic status / reminder run
  updated_at timestamptz not null default now()
);
insert into public.oa_settings (id) values (1) on conflict (id) do nothing;
alter table public.oa_settings enable row level security;
drop policy if exists "oa_settings: read" on public.oa_settings;
create policy "oa_settings: read" on public.oa_settings for select using (true);
grant select on public.oa_settings to anon, authenticated;

-- ---------- Institution types (section 3 — expandable) ----------
create table if not exists public.oa_institution_types (
  id       bigint generated always as identity primary key,
  category text not null check (category in ('court','bank','accountability','government','development','public')),
  label    text not null check (char_length(btrim(label)) between 2 and 120),
  sort     int not null default 100,
  unique (category, label)
);
alter table public.oa_institution_types enable row level security;
drop policy if exists "oa_types: read" on public.oa_institution_types;
create policy "oa_types: read" on public.oa_institution_types for select using (true);
grant select on public.oa_institution_types to anon, authenticated;
insert into public.oa_institution_types (category, label, sort) values
 ('court','Banking Courts',1),('court','Civil Courts',2),('court','District Courts',3),('court','Court-appointed auction officers / auctioneers',4),('court','Accountability Courts (authorised public notice)',5),('court','Other courts and judicial authorities',6),
 ('bank','Scheduled commercial banks',1),('bank','Islamic banks',2),('bank','Development financial institutions',3),('bank','Microfinance banks and other authorised financial institutions',4),('bank','Bank recovery / special-assets departments',5),('bank','Other financial institutions',6),
 ('accountability','National Accountability Bureau (NAB)',1),('accountability','Other asset-recovery bodies',2),('accountability','Confiscated / recovered property disposal authorities',3),
 ('government','Federal Government departments',1),('government','Punjab and other provincial departments',2),('government','Board of Revenue and revenue authorities',3),('government','Deputy Commissioner and revenue offices',4),('government','Local-government institutions',5),('government','Other government property-disposal authorities',6),
 ('development','Lahore Development Authority and other development authorities',1),('development','Housing and urban-development authorities',2),('development','Industrial-estate and development corporations',3),('development','Municipal authorities',4),('development','Other statutory and autonomous organisations',5),
 ('public','Public-sector corporations',1),('public','Government-owned companies',2),('public','Universities and educational institutions',3),('public','Trusts and endowments',4),('public','Auqaf and estate-management institutions',5),('public','Other legally authorised organisations',6)
on conflict (category, label) do nothing;

-- ---------- Institutions directory ----------
create table if not exists public.oa_institutions (
  id          bigint generated always as identity primary key,
  name        text not null unique check (char_length(btrim(name)) between 2 and 160),
  category    text not null check (category in ('court','bank','accountability','government','development','public')),
  type_label  text not null default '' check (char_length(type_label) <= 120),
  province    text not null default '' check (char_length(province) <= 40),
  city        text not null default '' check (char_length(city) <= 60),
  website     text not null default '' check (char_length(website) <= 300),
  email       text not null default '' check (char_length(email) <= 160),
  phone       text not null default '' check (char_length(phone) <= 40),
  address     text not null default '' check (char_length(address) <= 300),
  verified    boolean not null default false,   -- identity of the institution confirmed by RAQBO
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.oa_institutions enable row level security;
drop policy if exists "oa_institutions: read active" on public.oa_institutions;
create policy "oa_institutions: read active" on public.oa_institutions for select using (active or public.is_admin());
revoke insert, update, delete on public.oa_institutions from anon, authenticated;
grant select on public.oa_institutions to anon, authenticated;

-- ---------- Official auction notices ----------
create table if not exists public.official_auctions (
  id                 uuid primary key default gen_random_uuid(),
  ref                text not null unique default ('RQ-OA-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  method             text not null default 'research' check (method in ('research','institution')),
  institution_id     bigint references public.oa_institutions (id) on delete set null,
  institution_name   text not null check (char_length(btrim(institution_name)) between 2 and 160),
  institution_category text not null check (institution_category in ('court','bank','accountability','government','development','public')),
  conducted_by       text not null default 'institution' check (conducted_by in ('institution','banking_court','court','auction_officer','other')),
  conducting_authority text not null default '' check (char_length(conducting_authority) <= 200),
  bank_sale_type     text not null default '' check (bank_sale_type in ('','mortgaged','recovery','bank_owned','banking_court_execution','other')),
  title              text not null check (char_length(btrim(title)) between 5 and 200),
  property_category  text not null check (property_category in ('residential_plot','house','commercial_plot','shop_building','office','apartment','agricultural','industrial_plot','factory_warehouse','mixed_use','other')),
  address            text not null default '' check (char_length(address) <= 300),
  city               text not null default '' check (char_length(city) <= 60),
  district           text not null default '' check (char_length(district) <= 60),
  province           text not null default '' check (province in ('','Punjab','Sindh','Khyber Pakhtunkhwa','Balochistan','Islamabad','Gilgit-Baltistan','Azad Kashmir')),
  lat                double precision check (lat is null or lat between 23 and 38),
  lng                double precision check (lng is null or lng between 60 and 78),
  area_value         numeric(12,2) check (area_value is null or area_value > 0),
  area_unit          text not null default 'marla' check (area_unit in ('marla','kanal','sqft','sqyd','acre')),
  dimensions         text not null default '' check (char_length(dimensions) <= 120),
  description        text not null default '' check (char_length(description) <= 4000),
  reserve_price      bigint check (reserve_price is null or reserve_price > 0),
  possession         text not null default '' check (char_length(possession) <= 300),
  encumbrances       text not null default '' check (char_length(encumbrances) <= 1000),
  auction_type       text not null default 'open' check (auction_type in ('open','sealed','online','hybrid')),
  auction_at         timestamptz,
  venue              text not null default '' check (char_length(venue) <= 300),
  online_url         text not null default '' check (char_length(online_url) <= 300),
  last_date          timestamptz,
  registration       text not null default '' check (char_length(registration) <= 1500),
  bid_security       text not null default '' check (char_length(bid_security) <= 300),
  payment_recipient  text not null default '' check (char_length(payment_recipient) <= 300),
  inspection         text not null default '' check (char_length(inspection) <= 300),
  inspection_from    date,
  inspection_to      date,
  required_docs      text not null default '' check (char_length(required_docs) <= 1500),
  terms              text not null default '' check (char_length(terms) <= 6000),
  contact_name       text not null default '' check (char_length(contact_name) <= 120),
  contact_designation text not null default '' check (char_length(contact_designation) <= 120),
  contact_phone      text not null default '' check (char_length(contact_phone) <= 60),
  contact_email      text not null default '' check (char_length(contact_email) <= 160),
  contact_address    text not null default '' check (char_length(contact_address) <= 300),
  source_name        text not null default '' check (char_length(source_name) <= 200),   -- e.g. "Daily Jang, Lahore, p. 9"
  source_url         text not null default '' check (char_length(source_url) <= 400),
  notice_ref         text not null default '' check (char_length(notice_ref) <= 120),
  published_on       date,
  authority_note     text not null default '' check (char_length(authority_note) <= 500),  -- publication approval / authorisation
  files              jsonb not null default '[]'::jsonb,   -- [{path,name,kind,public}]
  public_paths       text[] not null default '{}',          -- files that may be shown publicly
  auth_label         text not null default 'pending' check (auth_label in ('source_verified','institution_submitted','pending')),
  status             text not null default 'upcoming' check (status in ('upcoming','open','closing','postponed','suspended','cancelled','completed','result_awaited','unconfirmed')),
  status_note        text not null default '' check (char_length(status_note) <= 500),
  review_state       text not null default 'draft' check (review_state in ('draft','submitted','prepared','published','rejected','archived')),
  reject_reason      text not null default '' check (char_length(reject_reason) <= 500),
  prepared_by        uuid references public.profiles (id) on delete set null,
  approved_by        uuid references public.profiles (id) on delete set null,
  submitted_by       uuid references public.profiles (id) on delete set null,
  last_verified_at   timestamptz,
  featured_until     timestamptz,
  sponsored          boolean not null default false,
  approaching_sent   boolean not null default false,
  deadline_sent      boolean not null default false,
  views              int not null default 0,
  notice_clicks      int not null default 0,
  contact_clicks     int not null default 0,
  share_clicks       int not null default 0,
  map_clicks         int not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  published_at       timestamptz
);
create index if not exists official_auctions_pub_idx on public.official_auctions (review_state, auction_at);
create index if not exists official_auctions_inst_idx on public.official_auctions (institution_id);
alter table public.official_auctions enable row level security;
revoke insert, update, delete on public.official_auctions from anon, authenticated;
grant select on public.official_auctions to anon, authenticated;

-- ---------- Institutional partners (section 15) ----------
create table if not exists public.oa_partners (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  institution_id   bigint references public.oa_institutions (id) on delete set null,
  institution_name text not null check (char_length(btrim(institution_name)) between 2 and 160),
  category         text not null check (category in ('court','bank','accountability','government','development','public')),
  type_label       text not null default '' check (char_length(type_label) <= 120),
  office_address   text not null check (char_length(btrim(office_address)) between 5 and 300),
  official_email   text not null check (official_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  official_phone   text not null check (char_length(btrim(official_phone)) between 7 and 40),
  officer_name     text not null check (char_length(btrim(officer_name)) between 2 and 120),
  designation      text not null check (char_length(btrim(designation)) between 2 and 120),
  channel          text not null default 'officer' check (channel in ('officer','official_email','representative','agency','other')),
  authority_note   text not null default '' check (char_length(authority_note) <= 600),
  files            jsonb not null default '[]'::jsonb,
  status           text not null default 'pending' check (status in ('pending','approved','rejected','suspended')),
  admin_note       text not null default '' check (char_length(admin_note) <= 600),
  checked_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, institution_name)
);
alter table public.oa_partners enable row level security;
drop policy if exists "oa_partners: own or admin" on public.oa_partners;
create policy "oa_partners: own or admin" on public.oa_partners for select using (user_id = auth.uid() or public.is_admin());
revoke insert, update, delete on public.oa_partners from anon, authenticated;
grant select on public.oa_partners to authenticated;

create or replace function public.oa_my_institutions()
returns setof bigint language sql stable security definer set search_path = public as $$
  select institution_id from public.oa_partners where user_id = auth.uid() and status = 'approved' and institution_id is not null $$;
grant execute on function public.oa_my_institutions() to authenticated;

drop policy if exists "official_auctions: public, own or admin" on public.official_auctions;
create policy "official_auctions: public, own or admin" on public.official_auctions for select using (
  review_state = 'published' or public.has_perm('auctions') or submitted_by = auth.uid()
  or (institution_id is not null and institution_id in (select public.oa_my_institutions())));

-- ---------- History of every change (sections 11, 21) ----------
create table if not exists public.oa_history (
  id          bigint generated always as identity primary key,
  auction_id  uuid not null references public.official_auctions (id) on delete cascade,
  at          timestamptz not null default now(),
  actor_id    uuid references public.profiles (id) on delete set null,
  actor_name  text not null default 'system',
  action      text not null,
  changes     jsonb not null default '{}'::jsonb,
  source_ref  text not null default '',
  note        text not null default '',
  public      boolean not null default true    -- shown on the notice page as "previous notices and amendments"
);
create index if not exists oa_history_auction_idx on public.oa_history (auction_id, at desc);
alter table public.oa_history enable row level security;
drop policy if exists "oa_history: read" on public.oa_history;
create policy "oa_history: read" on public.oa_history for select using (
  (public and exists (select 1 from public.official_auctions o where o.id = auction_id and o.review_state in ('published','archived')))
  or public.has_perm('auctions')
  or exists (select 1 from public.official_auctions o where o.id = auction_id and (o.submitted_by = auth.uid() or o.institution_id in (select public.oa_my_institutions()))));
revoke insert, update, delete on public.oa_history from anon, authenticated;
grant select on public.oa_history to anon, authenticated;

create or replace function public.oa_log(p_id uuid, p_action text, p_changes jsonb, p_source text, p_note text, p_public boolean default true)
returns void language sql security definer set search_path = public as $$
  insert into public.oa_history (auction_id, actor_id, actor_name, action, changes, source_ref, note, public)
  values (p_id, auth.uid(), coalesce((select coalesce(nullif(full_name, ''), email) from public.profiles where id = auth.uid()), 'system'), p_action, coalesce(p_changes, '{}'::jsonb), left(coalesce(p_source, ''), 300), left(coalesce(p_note, ''), 600), p_public) $$;
revoke all on function public.oa_log(uuid, text, jsonb, text, text, boolean) from public, anon, authenticated;

-- ---------- Saved, reminders, alerts, change requests ----------
create table if not exists public.oa_saved (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  auction_id uuid not null references public.official_auctions (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, auction_id)
);
alter table public.oa_saved enable row level security;
drop policy if exists "oa_saved: own" on public.oa_saved;
create policy "oa_saved: own" on public.oa_saved for all using (user_id = auth.uid()) with check (user_id = auth.uid() and exists (select 1 from public.official_auctions o where o.id = auction_id and o.review_state = 'published'));
grant select, insert, delete on public.oa_saved to authenticated;

create table if not exists public.oa_reminders (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  auction_id uuid not null references public.official_auctions (id) on delete cascade,
  target     text not null check (target in ('auction','deadline')),
  days       int not null check (days in (1,3,7)),
  remind_at  timestamptz,
  sent_at    timestamptz,
  cancelled  boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, auction_id, target, days)
);
alter table public.oa_reminders enable row level security;
drop policy if exists "oa_reminders: own" on public.oa_reminders;
create policy "oa_reminders: own" on public.oa_reminders for select using (user_id = auth.uid());
revoke insert, update, delete on public.oa_reminders from anon, authenticated;
grant select on public.oa_reminders to authenticated;

create table if not exists public.oa_alerts (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  name            text not null default 'My auction alert' check (char_length(name) <= 80),
  provinces       text[] not null default '{}',
  cities          text[] not null default '{}',
  inst_categories text[] not null default '{}',
  institutions    text[] not null default '{}',
  prop_categories text[] not null default '{}',
  special         text not null default '' check (special in ('','bank','nab')),
  price_min       bigint,
  price_max       bigint,
  events          text[] not null default '{new,approaching,deadline,postponed,cancelled,amended}',
  channels        text[] not null default '{site}',
  whatsapp_consent boolean not null default false,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
alter table public.oa_alerts enable row level security;
drop policy if exists "oa_alerts: own" on public.oa_alerts;
create policy "oa_alerts: own" on public.oa_alerts for select using (user_id = auth.uid());
revoke insert, update, delete on public.oa_alerts from anon, authenticated;
grant select on public.oa_alerts to authenticated;

create table if not exists public.oa_requests (
  id          bigint generated always as identity primary key,
  auction_id  uuid not null references public.official_auctions (id) on delete cascade,
  user_id     uuid references public.profiles (id) on delete set null,
  kind        text not null check (kind in ('amend','postpone','cancel','other')),
  details     text not null check (char_length(btrim(details)) between 10 and 2000),
  files       jsonb not null default '[]'::jsonb,
  status      text not null default 'open' check (status in ('open','done','rejected')),
  admin_note  text not null default '' check (char_length(admin_note) <= 600),
  created_at  timestamptz not null default now(),
  closed_at   timestamptz
);
alter table public.oa_requests enable row level security;
drop policy if exists "oa_requests: own or admin" on public.oa_requests;
create policy "oa_requests: own or admin" on public.oa_requests for select using (user_id = auth.uid() or public.has_perm('auctions'));
revoke insert, update, delete on public.oa_requests from anon, authenticated;
grant select on public.oa_requests to authenticated;

-- Outbox for e-mail, WhatsApp and app push — sent by n8n / the mobile app (service role only)
create table if not exists public.oa_outbox (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.profiles (id) on delete cascade,
  channel     text not null check (channel in ('email','whatsapp','push')),
  to_addr     text not null default '',
  event       text not null,
  auction_ref text not null default '',
  title       text not null,
  body        text not null default '',
  link        text not null default '',
  status      text not null default 'queued' check (status in ('queued','sent','failed')),
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
alter table public.oa_outbox enable row level security;   -- no policies: only the server reads it

-- ---------- Paid promotions & invoices (sections 17, 18) ----------
create table if not exists public.oa_promotions (
  id             bigint generated always as identity primary key,
  ref            text not null unique default ('RQ-OAP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  invoice_no     text unique,
  institution_id bigint references public.oa_institutions (id) on delete set null,
  institution_name text not null check (char_length(btrim(institution_name)) between 2 and 160),
  auction_id     uuid references public.official_auctions (id) on delete set null,
  package        text not null check (package in ('basic','featured','location','awareness','package')),
  target         text not null default '' check (char_length(target) <= 200),
  amount         bigint not null default 0 check (amount >= 0),
  starts_on      date,
  ends_on        date,
  status         text not null default 'quoted' check (status in ('quoted','invoiced','paid','active','ended','cancelled')),
  note           text not null default '' check (char_length(note) <= 500),
  paid_at        timestamptz,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.oa_promotions enable row level security;
drop policy if exists "oa_promotions: partner or admin" on public.oa_promotions;
create policy "oa_promotions: partner or admin" on public.oa_promotions for select using (public.has_perm('auctions') or public.has_perm('finance') or institution_id in (select public.oa_my_institutions()));
revoke insert, update, delete on public.oa_promotions from anon, authenticated;
grant select on public.oa_promotions to authenticated;

-- Daily counters for reports
create table if not exists public.oa_daily (
  day        date not null,
  auction_id uuid references public.official_auctions (id) on delete cascade,
  kind       text not null check (kind in ('page','view','notice','contact','share','map')),
  n          int not null default 0,
  unique (day, auction_id, kind)
);
create unique index if not exists oa_daily_page_idx on public.oa_daily (day, kind) where auction_id is null;
alter table public.oa_daily enable row level security;  -- read through oa_stats only

-- Complaints can be about an official auction notice
alter table public.complaints drop constraint if exists complaints_kind_check;
alter table public.complaints add constraint complaints_kind_check check (kind in ('listing','order','service','auction','quicksell','payment','advertiser','official_auction','other'));

-- ---------- Storage for notices, advertisements, plans and photos ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('official-notices', 'official-notices', false, 15728640, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "official-notices: upload own folder" on storage.objects;
create policy "official-notices: upload own folder" on storage.objects for insert to authenticated with check (bucket_id = 'official-notices' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "official-notices: read permitted" on storage.objects;
create policy "official-notices: read permitted" on storage.objects for select using (bucket_id = 'official-notices' and (
  (storage.foldername(name))[1] = auth.uid()::text or public.has_perm('auctions')
  or exists (select 1 from public.official_auctions o where o.review_state in ('published','archived') and name = any(o.public_paths))));

-- ---------- Helpers ----------
-- Status shown to visitors: never "active" after the date has passed without a fresh check (section 11)
create or replace function public.oa_display_status(p_status text, p_auction_at timestamptz, p_last_date timestamptz, p_verified timestamptz)
returns text language sql stable as $$
  select case
    when p_status in ('upcoming','open','closing') and p_auction_at is not null and p_auction_at < now() then 'result_awaited'
    when p_status in ('upcoming','open','closing') and p_last_date is not null and p_last_date < now() and (p_verified is null or p_verified < p_last_date) then 'unconfirmed'
    when p_status in ('upcoming','open') and p_last_date is not null and p_last_date >= now() and p_last_date < now() + interval '3 days' then 'closing'
    else p_status end $$;
grant execute on function public.oa_display_status(text, timestamptz, timestamptz, timestamptz) to anon, authenticated;

create or replace function public.oa_is_partner_of(p_inst bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select p_inst is not null and exists (select 1 from public.oa_partners where user_id = auth.uid() and status = 'approved' and institution_id = p_inst) $$;
grant execute on function public.oa_is_partner_of(bigint) to authenticated;

-- Send a notice event to the right people: website notification + outbox rows
-- events: new, approaching, deadline, postponed, suspended, cancelled, amended, reminder, completed
create or replace function public.oa_notify(p_id uuid, p_event text, p_note text default '', p_only uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare o public.official_auctions; r record; n int := 0; t text; b text; lnk text;
begin
  select * into o from public.official_auctions where id = p_id;
  if o.id is null or o.review_state <> 'published' then return 0; end if;
  lnk := '#official-auction/' || o.ref;
  t := left(case p_event
    when 'new' then 'New official auction: ' when 'approaching' then 'Auction approaching: ' when 'deadline' then 'Registration deadline approaching: '
    when 'postponed' then 'Auction postponed: ' when 'suspended' then 'Auction suspended: ' when 'cancelled' then 'Auction cancelled: '
    when 'amended' then 'Auction terms amended: ' when 'completed' then 'Auction completed: ' else 'Auction reminder: ' end || o.title, 160);
  b := left(o.institution_name || coalesce(' · ' || to_char(o.auction_at at time zone 'Asia/Karachi', 'DD Mon YYYY HH24:MI'), '') || case when coalesce(p_note, '') <> '' then ' · ' || p_note else '' end || ' · Check the latest official notice before acting.', 400);
  for r in
    with people as (
      select s.user_id, array['site']::text[] as ch, false as wa from public.oa_saved s where s.auction_id = o.id and p_event <> 'new'
      union all
      select m.user_id, array['site']::text[], false from public.oa_reminders m where m.auction_id = o.id and not m.cancelled and p_event in ('postponed','suspended','cancelled','amended','completed')
      union all
      select a.user_id, a.channels, a.whatsapp_consent from public.oa_alerts a
       where a.active and p_event = any(a.events)
         and (cardinality(a.provinces) = 0 or o.province = any(a.provinces))
         and (cardinality(a.cities) = 0 or lower(o.city) = any(select lower(x) from unnest(a.cities) x) or lower(o.district) = any(select lower(x) from unnest(a.cities) x))
         and (cardinality(a.inst_categories) = 0 or o.institution_category = any(a.inst_categories))
         and (cardinality(a.institutions) = 0 or o.institution_name = any(a.institutions))
         and (cardinality(a.prop_categories) = 0 or o.property_category = any(a.prop_categories))
         and (a.special = '' or (a.special = 'bank' and (o.institution_category = 'bank' or o.conducted_by = 'banking_court')) or (a.special = 'nab' and o.institution_category = 'accountability'))
         and (a.price_min is null or o.reserve_price >= a.price_min) and (a.price_max is null or o.reserve_price <= a.price_max))
    select p.user_id, array(select distinct c from unnest(string_to_array(string_agg(array_to_string(p.ch, ','), ','), ',')) c) as chans, bool_or(p.wa) as wa
      from people p where p_only is null or p.user_id = p_only
     group by p.user_id
  loop
    perform public.notify(r.user_id, 'auction', t, b, lnk); n := n + 1;
    if 'email' = any(r.chans) then insert into public.oa_outbox (user_id, channel, to_addr, event, auction_ref, title, body, link) select r.user_id, 'email', coalesce(email, ''), p_event, o.ref, t, b, lnk from public.profiles where id = r.user_id and coalesce(email, '') <> ''; end if;
    if 'whatsapp' = any(r.chans) and r.wa then insert into public.oa_outbox (user_id, channel, to_addr, event, auction_ref, title, body, link) select r.user_id, 'whatsapp', coalesce(phone, ''), p_event, o.ref, t, b, lnk from public.profiles where id = r.user_id and coalesce(phone, '') <> ''; end if;
    if 'push' = any(r.chans) then insert into public.oa_outbox (user_id, channel, event, auction_ref, title, body, link) values (r.user_id, 'push', p_event, o.ref, t, b, lnk); end if;
  end loop;
  return n;
end $$;
revoke all on function public.oa_notify(uuid, text, text, uuid) from public, anon, authenticated;

create or replace function public.oa_recalc_reminders(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.oa_reminders m set
    remind_at = (case m.target when 'auction' then o.auction_at else o.last_date end) - make_interval(days => m.days),
    sent_at = case when (case m.target when 'auction' then o.auction_at else o.last_date end) - make_interval(days => m.days) is distinct from m.remind_at then null else m.sent_at end,
    cancelled = o.status in ('cancelled','suspended','completed')
  from public.official_auctions o where o.id = m.auction_id and m.auction_id = p_id $$;
revoke all on function public.oa_recalc_reminders(uuid) from public, anon, authenticated;

-- ---------- Admin: add / edit a notice (stage 1 — prepare) ----------
create or replace function public.oa_admin_save(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare o public.official_auctions; v_id uuid; crit text[] := array['auction_at','last_date','reserve_price','venue','terms','auction_type','online_url','bid_security','registration','required_docs','payment_recipient']; k text; ch jsonb := '{}'::jsonb; old jsonb; src text := btrim(coalesce(p->>'source_ref', ''));
  pub_paths text[];
begin
  if not public.has_perm('auctions') then raise exception 'Only RAQBO staff with auction permission can do this.'; end if;
  pub_paths := coalesce(array(select f->>'path' from jsonb_array_elements(coalesce(p->'files', '[]'::jsonb)) f where coalesce((f->>'public')::boolean, false) and coalesce(f->>'path', '') <> ''), '{}');
  if nullif(p->>'id', '') is not null then
    select * into o from public.official_auctions where id = (p->>'id')::uuid for update;
    if o.id is null then raise exception 'Notice not found.'; end if;
    old := to_jsonb(o);
    foreach k in array crit loop
      if p ? k and coalesce(p->>k, '') is distinct from coalesce(old->>k, '') and not (k in ('auction_at','last_date') and nullif(p->>k, '') is not null and old->>k is not null and (p->>k)::timestamptz = (old->>k)::timestamptz) then ch := ch || jsonb_build_object(k, jsonb_build_object('from', old->k, 'to', p->k)); end if;
    end loop;
    if o.review_state in ('published','archived') and ch <> '{}'::jsonb and char_length(src) < 3 then
      raise exception 'Changes to dates, reserve price, venue or official terms need a traceable source (corrigendum number, newspaper and date, or official link).';
    end if;
    v_id := o.id;
  else
    insert into public.official_auctions (institution_name, institution_category, title, property_category, prepared_by, review_state)
    values (coalesce(p->>'institution_name', ''), coalesce(nullif(p->>'institution_category', ''), 'government'), coalesce(p->>'title', ''), coalesce(nullif(p->>'property_category', ''), 'other'), auth.uid(), 'prepared') returning id into v_id;
  end if;
  update public.official_auctions set
    method = coalesce(nullif(p->>'method', ''), method),
    institution_id = case when p ? 'institution_id' then nullif(p->>'institution_id', '')::bigint else institution_id end,
    institution_name = coalesce(nullif(btrim(p->>'institution_name'), ''), institution_name),
    institution_category = coalesce(nullif(p->>'institution_category', ''), institution_category),
    conducted_by = coalesce(nullif(p->>'conducted_by', ''), conducted_by),
    conducting_authority = coalesce(p->>'conducting_authority', conducting_authority),
    bank_sale_type = coalesce(p->>'bank_sale_type', bank_sale_type),
    title = coalesce(nullif(btrim(p->>'title'), ''), title),
    property_category = coalesce(nullif(p->>'property_category', ''), property_category),
    address = coalesce(p->>'address', address), city = coalesce(p->>'city', city), district = coalesce(p->>'district', district), province = coalesce(p->>'province', province),
    lat = case when p ? 'lat' then nullif(p->>'lat', '')::double precision else lat end, lng = case when p ? 'lng' then nullif(p->>'lng', '')::double precision else lng end,
    area_value = case when p ? 'area_value' then nullif(p->>'area_value', '')::numeric else area_value end, area_unit = coalesce(nullif(p->>'area_unit', ''), area_unit),
    dimensions = coalesce(p->>'dimensions', dimensions), description = coalesce(p->>'description', description),
    reserve_price = case when p ? 'reserve_price' then nullif(p->>'reserve_price', '')::bigint else reserve_price end,
    possession = coalesce(p->>'possession', possession), encumbrances = coalesce(p->>'encumbrances', encumbrances),
    auction_type = coalesce(nullif(p->>'auction_type', ''), auction_type),
    auction_at = case when p ? 'auction_at' then nullif(p->>'auction_at', '')::timestamptz else auction_at end,
    venue = coalesce(p->>'venue', venue), online_url = coalesce(p->>'online_url', online_url),
    last_date = case when p ? 'last_date' then nullif(p->>'last_date', '')::timestamptz else last_date end,
    registration = coalesce(p->>'registration', registration), bid_security = coalesce(p->>'bid_security', bid_security), payment_recipient = coalesce(p->>'payment_recipient', payment_recipient),
    inspection = coalesce(p->>'inspection', inspection),
    inspection_from = case when p ? 'inspection_from' then nullif(p->>'inspection_from', '')::date else inspection_from end,
    inspection_to = case when p ? 'inspection_to' then nullif(p->>'inspection_to', '')::date else inspection_to end,
    required_docs = coalesce(p->>'required_docs', required_docs), terms = coalesce(p->>'terms', terms),
    contact_name = coalesce(p->>'contact_name', contact_name), contact_designation = coalesce(p->>'contact_designation', contact_designation),
    contact_phone = coalesce(p->>'contact_phone', contact_phone), contact_email = coalesce(p->>'contact_email', contact_email), contact_address = coalesce(p->>'contact_address', contact_address),
    source_name = coalesce(p->>'source_name', source_name), source_url = coalesce(p->>'source_url', source_url), notice_ref = coalesce(p->>'notice_ref', notice_ref),
    published_on = case when p ? 'published_on' then nullif(p->>'published_on', '')::date else published_on end,
    authority_note = coalesce(p->>'authority_note', authority_note),
    files = case when p ? 'files' then p->'files' else files end,
    public_paths = case when p ? 'files' then pub_paths else public_paths end,
    auth_label = coalesce(nullif(p->>'auth_label', ''), auth_label),
    review_state = case when review_state in ('draft','submitted','rejected') then 'prepared' else review_state end,
    prepared_by = case when review_state in ('draft','submitted','rejected','prepared') then auth.uid() else prepared_by end,
    last_verified_at = case when ch <> '{}'::jsonb then now() else last_verified_at end,
    updated_at = now()
  where id = v_id returning * into o;
  perform public.oa_log(v_id, case when old is null then 'notice.prepared' else 'notice.edited' end, ch, src, coalesce(p->>'note', ''), ch <> '{}'::jsonb);
  perform public.audit(case when old is null then 'official_auction.add' else 'official_auction.edit' end, 'official_auction', o.ref, coalesce(p->>'note', ''), jsonb_build_object('changes', ch, 'source', src));
  if old is not null and o.review_state = 'published' and ch <> '{}'::jsonb then
    perform public.oa_recalc_reminders(v_id); perform public.oa_notify(v_id, 'amended', src);
  end if;
  return o.ref;
end $$;
grant execute on function public.oa_admin_save(jsonb) to authenticated;

-- ---------- Admin: approve (stage 2), reject, archive ----------
create or replace function public.oa_admin_approve(p_id uuid, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare o public.official_auctions; two boolean;
begin
  if not public.has_perm('auctions') then raise exception 'Only RAQBO staff with auction permission can do this.'; end if;
  select * into o from public.official_auctions where id = p_id for update;
  if o.id is null then raise exception 'Notice not found.'; end if;
  if o.review_state <> 'prepared' then raise exception 'Only a prepared notice can be approved. Review and save it first.'; end if;
  select two_stage into two from public.oa_settings where id = 1;
  if coalesce(two, true) and o.prepared_by = auth.uid() then raise exception 'Two-stage review: a different authorised staff member must approve the notice you prepared.'; end if;
  if o.auth_label = 'pending' then raise exception 'Set the authenticity label first: a notice with "Source confirmation pending" cannot be published as a confirmed auction.'; end if;
  if o.source_url = '' and o.notice_ref = '' and o.source_name = '' and cardinality(o.public_paths) = 0 and jsonb_array_length(o.files) = 0 then raise exception 'Record the original source (newspaper, official link, notice number or the notice file) before publishing.'; end if;
  if o.auction_at is null then raise exception 'Enter the auction date and time.'; end if;
  if o.auction_type in ('online','hybrid') and o.online_url = '' and o.venue = '' then raise exception 'Enter the official online-auction platform or the venue.'; end if;
  if o.contact_phone = '' and o.contact_email = '' and o.contact_address = '' and o.source_url = '' then raise exception 'Enter at least one way to contact the issuing authority.'; end if;
  update public.official_auctions set review_state = 'published', approved_by = auth.uid(), published_at = coalesce(published_at, now()), last_verified_at = now(), updated_at = now() where id = p_id;
  perform public.oa_log(p_id, 'notice.published', '{}'::jsonb, '', p_note, true);
  perform public.audit('official_auction.approve', 'official_auction', o.ref, p_note, null);
  perform public.oa_notify(p_id, 'new', '');
  if o.submitted_by is not null then perform public.notify(o.submitted_by, 'auction', 'Your auction notice is published', left(o.title, 300), '#official-auction/' || o.ref); end if;
end $$;
grant execute on function public.oa_admin_approve(uuid, text) to authenticated;

create or replace function public.oa_admin_reject(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.official_auctions;
begin
  if not public.has_perm('auctions') then raise exception 'Only RAQBO staff with auction permission can do this.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Give the reason (at least 5 characters).'; end if;
  select * into o from public.official_auctions where id = p_id for update;
  if o.id is null then raise exception 'Notice not found.'; end if;
  if o.review_state = 'published' then raise exception 'This notice is published. Withdraw it with the status "Cancelled / withdrawn" and a source instead.'; end if;
  update public.official_auctions set review_state = 'rejected', reject_reason = p_reason, updated_at = now() where id = p_id;
  perform public.oa_log(p_id, 'notice.rejected', '{}'::jsonb, '', p_reason, false);
  perform public.audit('official_auction.reject', 'official_auction', o.ref, p_reason, null);
  if o.submitted_by is not null then perform public.notify(o.submitted_by, 'auction', 'Auction notice not published', left(p_reason, 400), '#my/oa-partner'); end if;
end $$;
grant execute on function public.oa_admin_reject(uuid, text) to authenticated;

create or replace function public.oa_admin_archive(p_id uuid, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare o public.official_auctions;
begin
  if not public.has_perm('auctions') then raise exception 'Only RAQBO staff with auction permission can do this.'; end if;
  select * into o from public.official_auctions where id = p_id for update;
  if o.id is null then raise exception 'Notice not found.'; end if;
  if o.review_state <> 'published' or public.oa_display_status(o.status, o.auction_at, o.last_date, o.last_verified_at) not in ('completed','cancelled','result_awaited') then raise exception 'Only completed, cancelled or past auctions can be archived.'; end if;
  update public.official_auctions set review_state = 'archived', updated_at = now() where id = p_id;
  update public.oa_reminders set cancelled = true where auction_id = p_id;
  perform public.oa_log(p_id, 'notice.archived', '{}'::jsonb, '', p_note, false);
  perform public.audit('official_auction.archive', 'official_auction', o.ref, p_note, null);
end $$;
grant execute on function public.oa_admin_archive(uuid, text) to authenticated;

-- ---------- Admin: status change (postponed, cancelled …) with a traceable source ----------
create or replace function public.oa_admin_set_status(p_id uuid, p_status text, p_source text, p_note text default '', p_new_auction_at timestamptz default null, p_new_last_date timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
declare o public.official_auctions; ev text;
begin
  if not public.has_perm('auctions') then raise exception 'Only RAQBO staff with auction permission can do this.'; end if;
  if p_status not in ('upcoming','open','closing','postponed','suspended','cancelled','completed','result_awaited','unconfirmed') then raise exception 'Unknown status.'; end if;
  if p_status not in ('result_awaited','unconfirmed') and char_length(btrim(coalesce(p_source, ''))) < 3 then raise exception 'Record the source of this status (official notice, corrigendum, newspaper and date, or official link).'; end if;
  select * into o from public.official_auctions where id = p_id for update;
  if o.id is null then raise exception 'Notice not found.'; end if;
  if p_status = 'postponed' and p_new_auction_at is null then raise exception 'Enter the new auction date announced by the authority (or use "Suspended" if no new date is given).'; end if;
  update public.official_auctions set status = p_status, status_note = left(coalesce(p_note, ''), 500),
    auction_at = coalesce(p_new_auction_at, auction_at), last_date = coalesce(p_new_last_date, last_date),
    approaching_sent = case when p_new_auction_at is not null then false else approaching_sent end,
    deadline_sent = case when p_new_last_date is not null then false else deadline_sent end,
    last_verified_at = now(), updated_at = now() where id = p_id;
  perform public.oa_log(p_id, 'status.' || p_status, jsonb_build_object('status', jsonb_build_object('from', o.status, 'to', p_status))
      || case when p_new_auction_at is not null then jsonb_build_object('auction_at', jsonb_build_object('from', o.auction_at, 'to', p_new_auction_at)) else '{}'::jsonb end
      || case when p_new_last_date is not null then jsonb_build_object('last_date', jsonb_build_object('from', o.last_date, 'to', p_new_last_date)) else '{}'::jsonb end, p_source, p_note, true);
  perform public.audit('official_auction.status', 'official_auction', o.ref, p_note, jsonb_build_object('status', p_status, 'source', p_source));
  perform public.oa_recalc_reminders(p_id);
  ev := case p_status when 'postponed' then 'postponed' when 'suspended' then 'suspended' when 'cancelled' then 'cancelled' when 'completed' then 'completed' else null end;
  if ev is null and (p_new_auction_at is not null or p_new_last_date is not null) then ev := 'amended'; end if;
  if ev is not null then perform public.oa_notify(p_id, ev, coalesce(nullif(p_note, ''), p_source)); end if;
end $$;
grant execute on function public.oa_admin_set_status(uuid, text, text, text, timestamptz, timestamptz) to authenticated;

-- Fresh status check without a change (keeps the notice from showing "Status unconfirmed")
create or replace function public.oa_admin_verify_now(p_id uuid, p_source text)
returns void language plpgsql security definer set search_path = public as $$
declare r text;
begin
  if not public.has_perm('auctions') then raise exception 'Only RAQBO staff with auction permission can do this.'; end if;
  if char_length(btrim(coalesce(p_source, ''))) < 3 then raise exception 'Say how the status was checked (e.g. "Called LDA estate office 12 Nov", or the official link).'; end if;
  update public.official_auctions set last_verified_at = now(), updated_at = now() where id = p_id returning ref into r;
  if r is null then raise exception 'Notice not found.'; end if;
  perform public.oa_log(p_id, 'status.checked', '{}'::jsonb, p_source, '', true);
  perform public.audit('official_auction.checked', 'official_auction', r, p_source, null);
end $$;
grant execute on function public.oa_admin_verify_now(uuid, text) to authenticated;

-- Corrigendum / amendment document
create or replace function public.oa_admin_corrigendum(p_id uuid, p_file jsonb, p_source text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.official_auctions; f jsonb;
begin
  if not public.has_perm('auctions') then raise exception 'Only RAQBO staff with auction permission can do this.'; end if;
  if char_length(btrim(coalesce(p_source, ''))) < 3 then raise exception 'Enter the corrigendum reference or source.'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'Summarise what the corrigendum changes.'; end if;
  select * into o from public.official_auctions where id = p_id for update;
  if o.id is null then raise exception 'Notice not found.'; end if;
  f := case when p_file is null or coalesce(p_file->>'path', '') = '' then null else jsonb_build_object('path', p_file->>'path', 'name', coalesce(p_file->>'name', 'Corrigendum'), 'kind', 'corrigendum', 'public', coalesce((p_file->>'public')::boolean, false), 'at', now()) end;
  update public.official_auctions set files = case when f is null then files else files || jsonb_build_array(f) end,
    public_paths = case when f is not null and (f->>'public')::boolean then public_paths || array[f->>'path'] else public_paths end,
    last_verified_at = now(), updated_at = now() where id = p_id;
  perform public.oa_log(p_id, 'notice.corrigendum', coalesce(jsonb_build_object('file', f->>'name'), '{}'::jsonb), p_source, p_note, true);
  perform public.audit('official_auction.corrigendum', 'official_auction', o.ref, p_note, jsonb_build_object('source', p_source));
  perform public.oa_notify(p_id, 'amended', p_note);
end $$;
grant execute on function public.oa_admin_corrigendum(uuid, jsonb, text, text) to authenticated;

-- Send reminders and process statuses now (also runs automatically, see oa_tick)
create or replace function public.oa_run(p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; nrem int := 0; nst int := 0; nev int := 0; last timestamptz;
begin
  select tick_at into last from public.oa_settings where id = 1 for update;
  if not p_force and last > now() - interval '10 minutes' then return jsonb_build_object('skipped', true); end if;
  update public.oa_settings set tick_at = now() where id = 1;
  -- reminders that are due
  for r in select m.*, o.ref, o.title, o.status, o.auction_at, o.last_date, o.last_verified_at, o.institution_name from public.oa_reminders m join public.official_auctions o on o.id = m.auction_id
           where not m.cancelled and m.sent_at is null and m.remind_at is not null and m.remind_at <= now() and o.review_state = 'published' loop
    if public.oa_display_status(r.status, r.auction_at, r.last_date, r.last_verified_at) in ('upcoming','open','closing','postponed') then
      perform public.notify(r.user_id, 'auction', left((case r.target when 'auction' then 'Auction in ' else 'Registration closes in ' end) || r.days || case when r.days = 1 then ' day: ' else ' days: ' end || r.title, 160),
        left(r.institution_name || ' · Check the latest official notice — dates can change.', 400), '#official-auction/' || r.ref);
      nrem := nrem + 1;
    end if;
    update public.oa_reminders set sent_at = now() where id = r.id;
  end loop;
  -- auctions whose date has passed → result awaited (never shown as active)
  for r in select id, status from public.official_auctions where review_state = 'published' and status in ('upcoming','open','closing') and auction_at < now() loop
    update public.official_auctions set status = 'result_awaited', updated_at = now() where id = r.id;
    perform public.oa_log(r.id, 'status.result_awaited', jsonb_build_object('status', jsonb_build_object('from', r.status, 'to', 'result_awaited')), 'automatic: auction date passed', '', true);
    nst := nst + 1;
  end loop;
  -- auction approaching (3 days) and registration deadline approaching (3 days) — once each
  for r in select id from public.official_auctions where review_state = 'published' and status in ('upcoming','open','closing') and not approaching_sent and auction_at between now() and now() + interval '3 days' loop
    perform public.oa_notify(r.id, 'approaching', ''); update public.official_auctions set approaching_sent = true where id = r.id; nev := nev + 1;
  end loop;
  for r in select id from public.official_auctions where review_state = 'published' and status in ('upcoming','open','closing') and not deadline_sent and last_date between now() and now() + interval '3 days' loop
    perform public.oa_notify(r.id, 'deadline', ''); update public.official_auctions set deadline_sent = true where id = r.id; nev := nev + 1;
  end loop;
  return jsonb_build_object('reminders', nrem, 'statuses', nst, 'events', nev);
end $$;
revoke all on function public.oa_run(boolean) from public, anon, authenticated;

create or replace function public.oa_tick()       -- anyone may call; runs at most every 10 minutes
returns jsonb language sql security definer set search_path = public as $$ select public.oa_run(false) $$;
grant execute on function public.oa_tick() to anon, authenticated;

create or replace function public.oa_admin_run()  -- "Send reminders now"
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('auctions') then raise exception 'Only RAQBO staff with auction permission can do this.'; end if;
  return public.oa_run(true);
end $$;
grant execute on function public.oa_admin_run() to authenticated;

create or replace function public.oa_admin_settings(p_two_stage boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_full_admin() then raise exception 'Only a full admin can change the review rule.'; end if;
  update public.oa_settings set two_stage = p_two_stage, updated_at = now() where id = 1;
  perform public.audit('official_auction.two_stage', 'settings', 'oa', '', jsonb_build_object('two_stage', p_two_stage));
end $$;
grant execute on function public.oa_admin_settings(boolean) to authenticated;

-- ---------- Admin: institutions & types ----------
create or replace function public.oa_admin_save_institution(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  if not public.has_perm('auctions') then raise exception 'Only RAQBO staff with auction permission can do this.'; end if;
  if nullif(p->>'id', '') is null then
    insert into public.oa_institutions (name, category, type_label, province, city, website, email, phone, address, verified, active)
    values (btrim(p->>'name'), p->>'category', coalesce(p->>'type_label', ''), coalesce(p->>'province', ''), coalesce(p->>'city', ''), coalesce(p->>'website', ''), coalesce(p->>'email', ''), coalesce(p->>'phone', ''), coalesce(p->>'address', ''), coalesce((p->>'verified')::boolean, false), coalesce((p->>'active')::boolean, true))
    returning id into v;
  else
    update public.oa_institutions set name = coalesce(nullif(btrim(p->>'name'), ''), name), category = coalesce(nullif(p->>'category', ''), category), type_label = coalesce(p->>'type_label', type_label),
      province = coalesce(p->>'province', province), city = coalesce(p->>'city', city), website = coalesce(p->>'website', website), email = coalesce(p->>'email', email), phone = coalesce(p->>'phone', phone), address = coalesce(p->>'address', address),
      verified = coalesce((p->>'verified')::boolean, verified), active = coalesce((p->>'active')::boolean, active), updated_at = now()
    where id = (p->>'id')::bigint returning id into v;
    if v is null then raise exception 'Institution not found.'; end if;
  end if;
  perform public.audit('official_auction.institution', 'oa_institution', v::text, '', p);
  return v;
end $$;
grant execute on function public.oa_admin_save_institution(jsonb) to authenticated;

create or replace function public.oa_admin_add_type(p_category text, p_label text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('auctions') then raise exception 'Only RAQBO staff with auction permission can do this.'; end if;
  insert into public.oa_institution_types (category, label) values (p_category, btrim(p_label)) on conflict do nothing;
  perform public.audit('official_auction.type', 'oa_type', p_category, p_label, null);
end $$;
grant execute on function public.oa_admin_add_type(text, text) to authenticated;

-- ---------- Institutional partners ----------
create or replace function public.oa_partner_apply(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if (select count(*) from public.oa_partners where user_id = auth.uid()) >= 5 then raise exception 'You already have several applications. RAQBO will review them first.'; end if;
  insert into public.oa_partners (user_id, institution_name, category, type_label, office_address, official_email, official_phone, officer_name, designation, channel, authority_note, files)
  values (auth.uid(), btrim(p->>'institution_name'), p->>'category', coalesce(p->>'type_label', ''), coalesce(p->>'office_address', ''), btrim(coalesce(p->>'official_email', '')), coalesce(p->>'official_phone', ''), coalesce(p->>'officer_name', ''), coalesce(p->>'designation', ''), coalesce(nullif(p->>'channel', ''), 'officer'), coalesce(p->>'authority_note', ''), coalesce(p->'files', '[]'::jsonb))
  on conflict (user_id, institution_name) do update set category = excluded.category, type_label = excluded.type_label, office_address = excluded.office_address, official_email = excluded.official_email, official_phone = excluded.official_phone,
    officer_name = excluded.officer_name, designation = excluded.designation, channel = excluded.channel, authority_note = excluded.authority_note, files = excluded.files, status = 'pending', updated_at = now()
  returning id into v;
  insert into public.notifications (user_id, kind, title, body, link)
    select id, 'auction', 'Institutional partner application', left(btrim(p->>'institution_name') || ' · ' || coalesce(p->>'officer_name', ''), 400), '#admin' from public.profiles where role = 'admin';
  return v;
end $$;
grant execute on function public.oa_partner_apply(jsonb) to authenticated;

create or replace function public.oa_admin_partner(p_id bigint, p_status text, p_note text default '', p_institution bigint default null)
returns void language plpgsql security definer set search_path = public as $$
declare a public.oa_partners; inst bigint;
begin
  if not public.has_perm('auctions') then raise exception 'Only RAQBO staff with auction permission can do this.'; end if;
  if p_status not in ('approved','rejected','suspended','pending') then raise exception 'Unknown status.'; end if;
  select * into a from public.oa_partners where id = p_id for update;
  if a.id is null then raise exception 'Application not found.'; end if;
  if p_status in ('rejected','suspended') and char_length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'Give the reason (at least 5 characters).'; end if;
  inst := coalesce(p_institution, a.institution_id, (select id from public.oa_institutions where lower(name) = lower(a.institution_name)));
  if p_status = 'approved' and inst is null then
    insert into public.oa_institutions (name, category, type_label, address, email, phone, verified) values (a.institution_name, a.category, a.type_label, a.office_address, a.official_email, a.official_phone, true) returning id into inst;
  elsif p_status = 'approved' then update public.oa_institutions set verified = true, updated_at = now() where id = inst;
  end if;
  update public.oa_partners set status = p_status, admin_note = coalesce(p_note, ''), institution_id = coalesce(inst, institution_id), checked_by = auth.uid(), updated_at = now() where id = p_id;
  perform public.audit('official_auction.partner_' || p_status, 'oa_partner', a.institution_name, p_note, jsonb_build_object('officer', a.officer_name));
  perform public.notify(a.user_id, 'auction', case p_status when 'approved' then 'Institutional partner account approved' when 'rejected' then 'Institutional partner application not approved' when 'suspended' then 'Institutional partner account suspended' else 'Partner application under review' end,
    left(a.institution_name || case when coalesce(p_note, '') <> '' then ' · ' || p_note else '' end, 400), '#my/oa-partner');
end $$;
grant execute on function public.oa_admin_partner(bigint, text, text, bigint) to authenticated;

-- Partner: save a draft or submit a notice for verification (method B)
create or replace function public.oa_partner_submit(p jsonb, p_submit boolean)
returns text language plpgsql security definer set search_path = public as $$
declare a public.oa_partners; o public.official_auctions; v uuid; pub_paths text[];
begin
  select * into a from public.oa_partners where user_id = auth.uid() and status = 'approved' and institution_id = nullif(p->>'institution_id', '')::bigint;
  if a.id is null then raise exception 'Only an approved institutional partner can submit notices for this institution.'; end if;
  if nullif(p->>'id', '') is not null then
    select * into o from public.official_auctions where id = (p->>'id')::uuid for update;
    if o.id is null or o.institution_id <> a.institution_id then raise exception 'Notice not found.'; end if;
    if o.review_state not in ('draft','submitted','rejected') then raise exception 'This notice is already under RAQBO review or published. Send a change request instead.'; end if;
    v := o.id;
  else
    insert into public.official_auctions (institution_name, institution_category, title, property_category, method, institution_id, submitted_by, review_state, auth_label)
    values (a.institution_name, a.category, coalesce(p->>'title', ''), coalesce(nullif(p->>'property_category', ''), 'other'), 'institution', a.institution_id, auth.uid(), 'draft', 'institution_submitted') returning id into v;
  end if;
  pub_paths := coalesce(array(select f->>'path' from jsonb_array_elements(coalesce(p->'files', '[]'::jsonb)) f where coalesce((f->>'public')::boolean, false)), '{}');
  update public.official_auctions set
    title = coalesce(nullif(btrim(p->>'title'), ''), title), property_category = coalesce(nullif(p->>'property_category', ''), property_category),
    conducted_by = coalesce(nullif(p->>'conducted_by', ''), conducted_by), conducting_authority = coalesce(p->>'conducting_authority', conducting_authority), bank_sale_type = coalesce(p->>'bank_sale_type', bank_sale_type),
    address = coalesce(p->>'address', address), city = coalesce(p->>'city', city), district = coalesce(p->>'district', district), province = coalesce(p->>'province', province),
    area_value = case when p ? 'area_value' then nullif(p->>'area_value', '')::numeric else area_value end, area_unit = coalesce(nullif(p->>'area_unit', ''), area_unit),
    dimensions = coalesce(p->>'dimensions', dimensions), description = coalesce(p->>'description', description),
    reserve_price = case when p ? 'reserve_price' then nullif(p->>'reserve_price', '')::bigint else reserve_price end,
    possession = coalesce(p->>'possession', possession), encumbrances = coalesce(p->>'encumbrances', encumbrances),
    auction_type = coalesce(nullif(p->>'auction_type', ''), auction_type),
    auction_at = case when p ? 'auction_at' then nullif(p->>'auction_at', '')::timestamptz else auction_at end,
    venue = coalesce(p->>'venue', venue), online_url = coalesce(p->>'online_url', online_url),
    last_date = case when p ? 'last_date' then nullif(p->>'last_date', '')::timestamptz else last_date end,
    registration = coalesce(p->>'registration', registration), bid_security = coalesce(p->>'bid_security', bid_security), payment_recipient = coalesce(p->>'payment_recipient', payment_recipient),
    inspection = coalesce(p->>'inspection', inspection),
    inspection_from = case when p ? 'inspection_from' then nullif(p->>'inspection_from', '')::date else inspection_from end,
    inspection_to = case when p ? 'inspection_to' then nullif(p->>'inspection_to', '')::date else inspection_to end,
    required_docs = coalesce(p->>'required_docs', required_docs), terms = coalesce(p->>'terms', terms),
    contact_name = coalesce(nullif(p->>'contact_name', ''), a.officer_name), contact_designation = coalesce(nullif(p->>'contact_designation', ''), a.designation),
    contact_phone = coalesce(nullif(p->>'contact_phone', ''), a.official_phone), contact_email = coalesce(nullif(p->>'contact_email', ''), a.official_email), contact_address = coalesce(nullif(p->>'contact_address', ''), a.office_address),
    source_name = coalesce(p->>'source_name', source_name), source_url = coalesce(p->>'source_url', source_url), notice_ref = coalesce(p->>'notice_ref', notice_ref),
    published_on = case when p ? 'published_on' then nullif(p->>'published_on', '')::date else published_on end, authority_note = coalesce(p->>'authority_note', authority_note),
    files = case when p ? 'files' then p->'files' else files end, public_paths = case when p ? 'files' then pub_paths else public_paths end,
    review_state = case when p_submit then 'submitted' else 'draft' end, reject_reason = '', updated_at = now()
  where id = v returning * into o;
  if p_submit then
    if o.notice_ref = '' then raise exception 'Enter the official advertisement / reference number.'; end if;
    if o.auction_at is null then raise exception 'Enter the auction date and time.'; end if;
    if jsonb_array_length(o.files) = 0 then raise exception 'Attach the original auction notice (PDF or image).'; end if;
    insert into public.notifications (user_id, kind, title, body, link)
      select id, 'auction', 'Official auction notice submitted', left(o.institution_name || ' · ' || o.title, 400), '#admin' from public.profiles where role = 'admin';
  end if;
  perform public.oa_log(v, case when p_submit then 'notice.submitted' else 'notice.draft' end, '{}'::jsonb, '', '', false);
  return o.ref;
end $$;
grant execute on function public.oa_partner_submit(jsonb, boolean) to authenticated;

create or replace function public.oa_partner_request(p_id uuid, p_kind text, p_details text, p_files jsonb default '[]'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare o public.official_auctions;
begin
  select * into o from public.official_auctions where id = p_id;
  if o.id is null or not public.oa_is_partner_of(o.institution_id) then raise exception 'Only the issuing institution''s approved officers can request changes.'; end if;
  insert into public.oa_requests (auction_id, user_id, kind, details, files) values (p_id, auth.uid(), p_kind, p_details, coalesce(p_files, '[]'::jsonb));
  perform public.oa_log(p_id, 'request.' || p_kind, '{}'::jsonb, '', p_details, false);
  insert into public.notifications (user_id, kind, title, body, link)
    select id, 'auction', 'Change request: ' || p_kind, left(o.ref || ' · ' || p_details, 400), '#admin' from public.profiles where role = 'admin';
end $$;
grant execute on function public.oa_partner_request(uuid, text, text, jsonb) to authenticated;

create or replace function public.oa_admin_request(p_id bigint, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare q public.oa_requests;
begin
  if not public.has_perm('auctions') then raise exception 'Only RAQBO staff with auction permission can do this.'; end if;
  update public.oa_requests set status = p_status, admin_note = coalesce(p_note, ''), closed_at = now() where id = p_id returning * into q;
  if q.id is null then raise exception 'Request not found.'; end if;
  perform public.audit('official_auction.request_' || p_status, 'oa_request', p_id::text, p_note, null);
  if q.user_id is not null then perform public.notify(q.user_id, 'auction', case p_status when 'done' then 'Change request completed' else 'Change request declined' end, left(coalesce(p_note, ''), 400), '#my/oa-partner'); end if;
end $$;
grant execute on function public.oa_admin_request(bigint, text, text) to authenticated;

-- ---------- Members: reminders & alerts ----------
create or replace function public.oa_set_reminders(p_id uuid, p_target text, p_days int[])
returns int language plpgsql security definer set search_path = public as $$
declare o public.official_auctions; d int; n int := 0;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  select * into o from public.official_auctions where id = p_id and review_state = 'published';
  if o.id is null then raise exception 'Auction not found.'; end if;
  if p_target not in ('auction','deadline') then raise exception 'Choose the auction date or the registration deadline.'; end if;
  if p_target = 'deadline' and o.last_date is null then raise exception 'This notice has no registration deadline.'; end if;
  if public.oa_display_status(o.status, o.auction_at, o.last_date, o.last_verified_at) in ('cancelled','suspended','completed','result_awaited') then raise exception 'This auction is not active, so reminders cannot be set.'; end if;
  delete from public.oa_reminders where user_id = auth.uid() and auction_id = p_id and target = p_target and not (days = any(coalesce(p_days, '{}')));
  foreach d in array coalesce(p_days, '{}') loop
    if d not in (1,3,7) then raise exception 'Reminders can be 1, 3 or 7 days before.'; end if;
    insert into public.oa_reminders (user_id, auction_id, target, days) values (auth.uid(), p_id, p_target, d) on conflict do nothing; n := n + 1;
  end loop;
  perform public.oa_recalc_reminders(p_id);
  insert into public.oa_saved (user_id, auction_id) values (auth.uid(), p_id) on conflict do nothing;
  return n;
end $$;
grant execute on function public.oa_set_reminders(uuid, text, int[]) to authenticated;

create or replace function public.oa_save_alert(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare v bigint; ch text[];
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  ch := coalesce(array(select jsonb_array_elements_text(p->'channels')), '{site}');
  if 'whatsapp' = any(ch) and not coalesce((p->>'whatsapp_consent')::boolean, false) then raise exception 'Tick the WhatsApp consent box to receive WhatsApp alerts.'; end if;
  if nullif(p->>'id', '') is null then
    if (select count(*) from public.oa_alerts where user_id = auth.uid()) >= 10 then raise exception 'You can keep up to 10 auction alerts.'; end if;
    insert into public.oa_alerts (user_id) values (auth.uid()) returning id into v;
  else v := (p->>'id')::bigint; end if;
  update public.oa_alerts set name = left(coalesce(nullif(btrim(p->>'name'), ''), 'My auction alert'), 80),
    provinces = coalesce(array(select jsonb_array_elements_text(p->'provinces')), '{}'), cities = coalesce(array(select btrim(x) from jsonb_array_elements_text(p->'cities') x where btrim(x) <> ''), '{}'),
    inst_categories = coalesce(array(select jsonb_array_elements_text(p->'inst_categories')), '{}'), institutions = coalesce(array(select jsonb_array_elements_text(p->'institutions')), '{}'),
    prop_categories = coalesce(array(select jsonb_array_elements_text(p->'prop_categories')), '{}'), special = coalesce(p->>'special', ''),
    price_min = nullif(p->>'price_min', '')::bigint, price_max = nullif(p->>'price_max', '')::bigint,
    events = coalesce(array(select jsonb_array_elements_text(p->'events')), '{new}'), channels = ch, whatsapp_consent = coalesce((p->>'whatsapp_consent')::boolean, false),
    active = coalesce((p->>'active')::boolean, true)
  where id = v and user_id = auth.uid();
  if not found then raise exception 'Alert not found.'; end if;
  return v;
end $$;
grant execute on function public.oa_save_alert(jsonb) to authenticated;

create or replace function public.oa_delete_alert(p_id bigint)
returns void language sql security definer set search_path = public as $$ delete from public.oa_alerts where id = p_id and user_id = auth.uid() $$;
grant execute on function public.oa_delete_alert(bigint) to authenticated;

-- ---------- Counters ----------
create or replace function public.oa_track(p_ref text, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
declare v uuid; d date := (now() at time zone 'Asia/Karachi')::date;
begin
  if p_kind not in ('page','view','notice','contact','share','map') then return; end if;
  if p_kind = 'page' then
    insert into public.oa_daily (day, auction_id, kind, n) values (d, null, 'page', 1) on conflict (day, kind) where auction_id is null do update set n = public.oa_daily.n + 1; return;
  end if;
  select id into v from public.official_auctions where ref = p_ref and review_state in ('published','archived');
  if v is null then return; end if;
  update public.official_auctions set views = views + (p_kind = 'view')::int, notice_clicks = notice_clicks + (p_kind = 'notice')::int, contact_clicks = contact_clicks + (p_kind = 'contact')::int,
    share_clicks = share_clicks + (p_kind = 'share')::int, map_clicks = map_clicks + (p_kind = 'map')::int where id = v;
  insert into public.oa_daily (day, auction_id, kind, n) values (d, v, p_kind, 1) on conflict (day, auction_id, kind) do update set n = public.oa_daily.n + 1;
end $$;
grant execute on function public.oa_track(text, text) to anon, authenticated;

-- ---------- Promotions ----------
create or replace function public.oa_admin_promotion(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare r public.oa_promotions; st text := coalesce(p->>'status', '');
begin
  if not (public.has_perm('auctions') or public.has_perm('finance')) then raise exception 'Only RAQBO staff can manage promotions.'; end if;
  if nullif(p->>'id', '') is null then
    insert into public.oa_promotions (institution_id, institution_name, auction_id, package, target, amount, starts_on, ends_on, note, created_by)
    values (nullif(p->>'institution_id', '')::bigint, btrim(coalesce(p->>'institution_name', '')), nullif(p->>'auction_id', '')::uuid, p->>'package', coalesce(p->>'target', ''), coalesce(nullif(p->>'amount', '')::bigint, 0), nullif(p->>'starts_on', '')::date, nullif(p->>'ends_on', '')::date, coalesce(p->>'note', ''), auth.uid())
    returning * into r;
    perform public.audit('official_auction.promotion_add', 'oa_promotion', r.ref, r.note, p);
    return r.ref;
  end if;
  select * into r from public.oa_promotions where id = (p->>'id')::bigint for update;
  if r.id is null then raise exception 'Promotion not found.'; end if;
  if st not in ('quoted','invoiced','paid','active','ended','cancelled') then raise exception 'Unknown status.'; end if;
  if st = 'invoiced' and r.invoice_no is null then
    update public.oa_promotions set invoice_no = 'RQ-INV-OA-' || to_char(now() at time zone 'Asia/Karachi', 'YYMM') || '-' || lpad(r.id::text, 4, '0') where id = r.id;
  end if;
  if st = 'paid' and r.paid_at is null then
    update public.oa_promotions set paid_at = now(), invoice_no = coalesce(invoice_no, 'RQ-INV-OA-' || to_char(now() at time zone 'Asia/Karachi', 'YYMM') || '-' || lpad(r.id::text, 4, '0')) where id = r.id;
    if r.amount > 0 then insert into public.finance_entries (kind, category, amount, note, ref, created_by) values ('income', 'Official auction advertising', r.amount, left(r.institution_name || ' · ' || r.package, 300), r.ref, auth.uid()); end if;
  end if;
  update public.oa_promotions set status = st, updated_at = now() where id = r.id;
  if r.auction_id is not null and r.package in ('featured','location','awareness','package') then
    update public.official_auctions set featured_until = case when st = 'active' then coalesce(r.ends_on::timestamptz + interval '1 day', now() + interval '30 days') when st in ('ended','cancelled') then null else featured_until end,
      sponsored = case when st = 'active' then true when st in ('ended','cancelled') then false else sponsored end where id = r.auction_id;
  end if;
  perform public.audit('official_auction.promotion_' || st, 'oa_promotion', r.ref, '', null);
  return r.ref;
end $$;
grant execute on function public.oa_admin_promotion(jsonb) to authenticated;

-- ---------- Reports (section 28) ----------
create or replace function public.oa_stats(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f date := coalesce(p_from, (now() at time zone 'Asia/Karachi')::date - 30); t date := coalesce(p_to, (now() at time zone 'Asia/Karachi')::date);
begin
  if not (public.has_perm('auctions') or public.has_perm('finance')) then raise exception 'Only RAQBO staff can see these reports.'; end if;
  return jsonb_build_object(
    'from', f, 'to', t,
    'total', (select count(*) from public.official_auctions where review_state in ('published','archived')),
    'active', (select count(*) from public.official_auctions where review_state = 'published' and public.oa_display_status(status, auction_at, last_date, last_verified_at) in ('upcoming','open','closing','postponed')),
    'upcoming', (select count(*) from public.official_auctions where review_state = 'published' and auction_at > now() and status not in ('cancelled','suspended')),
    'awaiting_review', (select count(*) from public.official_auctions where review_state in ('submitted','prepared')),
    'by_institution', coalesce((select jsonb_agg(x) from (select institution_name as k, count(*) as n from public.official_auctions where review_state in ('published','archived') group by 1 order by 2 desc limit 30) x), '[]'::jsonb),
    'by_district', coalesce((select jsonb_agg(x) from (select coalesce(nullif(district, ''), nullif(city, ''), 'Not given') as k, count(*) as n from public.official_auctions where review_state in ('published','archived') group by 1 order by 2 desc limit 30) x), '[]'::jsonb),
    'page_views', (select coalesce(sum(n), 0) from public.oa_daily where kind = 'page' and day between f and t),
    'detail_views', (select coalesce(sum(n), 0) from public.oa_daily where kind = 'view' and day between f and t),
    'notice_clicks', (select coalesce(sum(n), 0) from public.oa_daily where kind = 'notice' and day between f and t),
    'contact_clicks', (select coalesce(sum(n), 0) from public.oa_daily where kind = 'contact' and day between f and t),
    'saved', (select count(*) from public.oa_saved), 'reminders', (select count(*) from public.oa_reminders where not cancelled), 'alerts', (select count(*) from public.oa_alerts where active),
    'advertisers', (select count(distinct institution_id) from public.oa_partners where status = 'approved'),
    'campaigns', (select count(*) from public.oa_promotions where status in ('paid','active')),
    'revenue', (select coalesce(sum(amount), 0) from public.oa_promotions where paid_at::date between f and t),
    'corrections', (select count(*) from public.oa_history where action in ('notice.corrigendum','notice.edited') and changes <> '{}'::jsonb and at::date between f and t),
    'status_changes', (select count(*) from public.oa_history where action like 'status.%' and at::date between f and t),
    'complaints', (select count(*) from public.complaints where kind = 'official_auction' and created_at::date between f and t),
    'open_requests', (select count(*) from public.oa_requests where status = 'open'),
    'outbox_queued', (select count(*) from public.oa_outbox where status = 'queued'));
end $$;
grant execute on function public.oa_stats(date, date) to authenticated;

-- Partner report: reach of their own notices only, no visitor details
create or replace function public.oa_partner_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('ref', o.ref, 'title', o.title, 'state', o.review_state, 'status', public.oa_display_status(o.status, o.auction_at, o.last_date, o.last_verified_at), 'auction_at', o.auction_at, 'published_at', o.published_at,
    'views', o.views, 'notice_clicks', o.notice_clicks, 'contact_clicks', o.contact_clicks, 'shares', o.share_clicks,
    'saved', (select count(*) from public.oa_saved s where s.auction_id = o.id), 'reminders', (select count(*) from public.oa_reminders m where m.auction_id = o.id and not m.cancelled)) order by o.created_at desc), '[]'::jsonb)
  from public.official_auctions o where o.institution_id in (select public.oa_my_institutions()) $$;
grant execute on function public.oa_partner_stats() to authenticated;

-- Admin backup includes the module
create or replace function public.oa_admin_export()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_full_admin() then raise exception 'Only a full admin can export.'; end if;
  return jsonb_build_object('official_auctions', coalesce((select jsonb_agg(to_jsonb(o)) from public.official_auctions o), '[]'::jsonb), 'oa_history', coalesce((select jsonb_agg(to_jsonb(h)) from public.oa_history h), '[]'::jsonb),
    'oa_institutions', coalesce((select jsonb_agg(to_jsonb(i)) from public.oa_institutions i), '[]'::jsonb), 'oa_partners', coalesce((select jsonb_agg(to_jsonb(p)) from public.oa_partners p), '[]'::jsonb), 'oa_promotions', coalesce((select jsonb_agg(to_jsonb(p)) from public.oa_promotions p), '[]'::jsonb));
end $$;
grant execute on function public.oa_admin_export() to authenticated;

-- Optional: if the pg_cron extension is enabled in Supabase, run reminders every 15 minutes:
--   select cron.schedule('raqbo-official-auctions', '*/15 * * * *', $$select public.oa_run(true)$$);
-- Without it, the website runs the same job at most every 10 minutes when visitors open the Official Auctions pages.
