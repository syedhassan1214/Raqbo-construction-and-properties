-- =====================================================================
-- 18. Growth: Founding Members, Refer & Earn, RAQBO Rewards, offers,
--     property alerts, price-drop alerts, Property Wanted, featured trial
-- Run once in Supabase → SQL Editor. Safe to run more than once.
-- Every amount and limit is a setting the admin changes in Admin → Growth.
-- =====================================================================

-- ---------- Campaign settings (one row) ----------
create table if not exists public.growth_settings (
  id                      int primary key default 1 check (id = 1),
  campaign_on             boolean not null default true,
  campaign_title          text not null default 'RAQBO – Pakistan''s Property World in Your Pocket' check (char_length(campaign_title) <= 120),
  campaign_tagline        text not null default 'Join Free. Connect Directly. Discover More.' check (char_length(campaign_tagline) <= 160),
  campaign_cta            text not null default 'Become a RAQBO Founding Member and Enjoy Exclusive Benefits.' check (char_length(campaign_cta) <= 160),
  founding_enabled        boolean not null default true,
  founding_cap            int not null default 10000 check (founding_cap between 0 and 10000000),
  founding_discount_pct   int not null default 20 check (founding_discount_pct between 0 and 100),
  founding_discount_max   int not null default 500 check (founding_discount_max between 0 and 1000000),
  referral_enabled        boolean not null default true,
  referral_member_credit  int not null default 100 check (referral_member_credit between 0 and 100000),
  referral_owner_credit   int not null default 300 check (referral_owner_credit between 0 and 100000),
  referral_review         boolean not null default true,          -- an admin approves each reward before it can be used
  referral_monthly_cap    int not null default 20 check (referral_monthly_cap between 0 and 10000),
  credit_expiry_days      int not null default 180 check (credit_expiry_days between 0 and 3650),   -- 0 = never expires
  featured_trial_enabled  boolean not null default true,
  featured_trial_days     int not null default 7 check (featured_trial_days between 1 and 60),
  pilot_cities            text[] not null default '{Lahore}',     -- rewards and trials only in these cities; empty = all of Pakistan
  budget_total            bigint not null default 500000 check (budget_total >= 0),   -- PKR of reward credit; new rewards wait for review once reached
  updated_at              timestamptz not null default now()
);
insert into public.growth_settings (id) values (1) on conflict (id) do nothing;
alter table public.growth_settings enable row level security;
drop policy if exists "growth_settings: read" on public.growth_settings;
create policy "growth_settings: read" on public.growth_settings for select using (true);
grant select on public.growth_settings to anon, authenticated;

-- ---------- Profile additions ----------
alter table public.profiles add column if not exists ref_code text;
alter table public.profiles add column if not exists referred_by uuid references public.profiles (id) on delete set null;
alter table public.profiles add column if not exists founding_no int;
alter table public.profiles add column if not exists member_type text;
alter table public.profiles add column if not exists city text;
alter table public.profiles add column if not exists featured_trial_at timestamptz;
create unique index if not exists profiles_ref_code_key on public.profiles (ref_code);
create unique index if not exists profiles_founding_no_key on public.profiles (founding_no);
create index if not exists profiles_referred_by_idx on public.profiles (referred_by);
do $$ begin
  alter table public.profiles add constraint profiles_member_type_check
    check (member_type is null or member_type in ('owner','buyer','tenant','developer','agent','legal','service','overseas'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.profiles add constraint profiles_city_check check (city is null or char_length(city) <= 60);
exception when duplicate_object then null; end $$;

create or replace function public.new_ref_code()
returns text language plpgsql volatile set search_path = public
as $$
declare c text;
begin
  loop
    c := 'RQ' || upper(substr(translate(replace(gen_random_uuid()::text, '-', ''), '01', ''), 1, 6));
    exit when char_length(c) = 8 and not exists (select 1 from public.profiles where ref_code = c);
  end loop;
  return c;
end $$;

-- Founding Members: the first N verified members get a number. Runs whenever a profile becomes verified.
create or replace function public.profiles_growth_before()
returns trigger language plpgsql security definer set search_path = public
as $$
declare s public.growth_settings; n int;
begin
  if new.ref_code is null then new.ref_code := public.new_ref_code(); end if;
  if tg_op = 'UPDATE' and auth.uid() is not null and not public.is_admin() then
    new.founding_no := old.founding_no; new.ref_code := old.ref_code;   -- belt and braces: members cannot change these
  end if;
  if new.verified and new.founding_no is null then
    select * into s from public.growth_settings where id = 1;
    if s.founding_enabled then
      perform pg_advisory_xact_lock(4242001);
      select coalesce(max(founding_no), 0) into n from public.profiles;
      if n < s.founding_cap then new.founding_no := n + 1; end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_growth_before on public.profiles;
create trigger profiles_growth_before before insert or update on public.profiles
  for each row execute function public.profiles_growth_before();

-- Give every existing member a referral code; number existing verified members in the order they joined.
update public.profiles set ref_code = public.new_ref_code() where ref_code is null;
do $$
declare r record; n int; cap int;
begin
  select founding_cap into cap from public.growth_settings where id = 1;
  select coalesce(max(founding_no), 0) into n from public.profiles;
  for r in select id from public.profiles where verified and founding_no is null order by coalesce(verified_at, created_at), created_at loop
    exit when n >= cap;
    n := n + 1; update public.profiles set founding_no = n where id = r.id;
  end loop;
end $$;

-- ---------- Rewards ledger (credits earned and used) ----------
create table if not exists public.credit_ledger (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  kind         text not null check (kind in ('referral_member','referral_owner','bonus','redemption','founding_discount')),
  amount       int not null default 0,                       -- + earned, − used (PKR of RAQBO service credit, not cash)
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  source_user  uuid references public.profiles (id) on delete set null,   -- the referred member
  listing_id   uuid references public.listings (id) on delete set null,
  note         text not null default '' check (char_length(note) <= 300),   -- member's note (which service, order ref)
  admin_note   text not null default '' check (char_length(admin_note) <= 300),
  expires_at   timestamptz,
  created_at   timestamptz not null default now(),
  decided_by   uuid references public.profiles (id) on delete set null,
  decided_at   timestamptz
);
create index if not exists credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);
create index if not exists credit_ledger_status_idx on public.credit_ledger (status, created_at desc);
create unique index if not exists credit_ledger_one_reward on public.credit_ledger (kind, source_user) where kind in ('referral_member','referral_owner');
create unique index if not exists credit_ledger_one_founding on public.credit_ledger (user_id) where kind = 'founding_discount' and status <> 'rejected';
alter table public.credit_ledger enable row level security;
drop policy if exists "credit_ledger: read own or admin" on public.credit_ledger;
create policy "credit_ledger: read own or admin" on public.credit_ledger for select using (user_id = auth.uid() or public.is_admin());
revoke insert, update, delete on public.credit_ledger from anon, authenticated;
grant select on public.credit_ledger to authenticated;

-- Credit a member can still use: approved, unexpired credits minus approved or waiting redemptions
create or replace function public.credit_available(p_user uuid)
returns int language sql stable security definer set search_path = public
as $$
  select greatest(0,
    coalesce((select sum(amount) from public.credit_ledger where user_id = p_user and amount > 0 and status = 'approved' and (expires_at is null or expires_at > now())), 0)
  + coalesce((select sum(amount) from public.credit_ledger where user_id = p_user and kind = 'redemption' and status in ('approved','pending')), 0))::int
$$;
revoke all on function public.credit_available(uuid) from public, anon, authenticated;

create or replace function public.growth_in_pilot(p_city text)
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce(array_length(s.pilot_cities, 1), 0) = 0
      or exists (select 1 from unnest(s.pilot_cities) c where lower(btrim(c)) = lower(btrim(coalesce(p_city, ''))))
  from public.growth_settings s where s.id = 1
$$;

-- Add a referral reward (pending or approved by the settings), respecting budget and the monthly limit
create or replace function public.growth_reward(p_referrer uuid, p_kind text, p_source uuid, p_listing uuid, p_amount int, p_what text)
returns void language plpgsql security definer set search_path = public
as $$
declare s public.growth_settings; used bigint; month_n int; st text := 'approved'; why text := ''; nm text;
begin
  if p_referrer is null or p_amount <= 0 then return; end if;
  if exists (select 1 from public.credit_ledger where kind = p_kind and source_user = p_source) then return; end if;
  select * into s from public.growth_settings where id = 1;
  select coalesce(sum(amount), 0) into used from public.credit_ledger where amount > 0 and status in ('approved','pending');
  select count(*) into month_n from public.credit_ledger where user_id = p_referrer and kind in ('referral_member','referral_owner')
     and created_at >= date_trunc('month', now() at time zone 'Asia/Karachi') at time zone 'Asia/Karachi';
  if s.referral_review then st := 'pending'; why := 'Waiting for RAQBO verification'; end if;
  if used + p_amount > s.budget_total then st := 'pending'; why := 'Campaign budget reached — admin review'; end if;
  if month_n >= s.referral_monthly_cap then st := 'pending'; why := 'Monthly referral limit reached — admin review'; end if;
  insert into public.credit_ledger (user_id, kind, amount, status, source_user, listing_id, admin_note, expires_at, decided_at)
  values (p_referrer, p_kind, p_amount, st, p_source, p_listing, why,
          case when s.credit_expiry_days > 0 then now() + make_interval(days => s.credit_expiry_days) end,
          case when st = 'approved' then now() end)
  on conflict do nothing;
  select coalesce(nullif(split_part(full_name, ' ', 1), ''), 'A member') into nm from public.profiles where id = p_source;
  perform public.notify(p_referrer, 'reward',
    case when st = 'approved' then 'You earned Rs ' || p_amount || ' RAQBO credit' else 'Rs ' || p_amount || ' credit on the way' end,
    nm || ' ' || p_what || '. ' || case when st = 'approved' then 'Use it on RAQBO services.' else 'It becomes usable once RAQBO verifies it.' end,
    '#rewards');
end $$;
revoke all on function public.growth_reward(uuid, text, uuid, uuid, int, text) from public, anon, authenticated;

-- A referred member counts as "active" once verified and they do something real on RAQBO
create or replace function public.growth_check_member(p_user uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare p public.profiles; s public.growth_settings;
begin
  select * into p from public.profiles where id = p_user;
  if p.id is null or p.referred_by is null or not p.verified then return; end if;
  if exists (select 1 from public.credit_ledger where kind = 'referral_member' and source_user = p_user) then return; end if;
  select * into s from public.growth_settings where id = 1;
  if not s.referral_enabled or not public.growth_in_pilot(p.city) then return; end if;
  if not (exists (select 1 from public.favorites where user_id = p_user)
       or exists (select 1 from public.listings where owner_id = p_user)
       or exists (select 1 from public.messages where sender_id = p_user)
       or exists (select 1 from public.saved_searches where user_id = p_user)
       or exists (select 1 from public.wanted_posts where user_id = p_user)
       or exists (select 1 from public.orders where buyer_id = p_user)) then return; end if;
  perform public.growth_reward(p.referred_by, 'referral_member', p_user, null, s.referral_member_credit, 'joined RAQBO with your link');
end $$;
revoke all on function public.growth_check_member(uuid) from public, anon, authenticated;

-- ---------- Offers (managed in Admin → Growth) ----------
create table if not exists public.offers (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (char_length(title) between 3 and 100),
  body       text not null default '' check (char_length(body) <= 500),
  badge      text not null default '' check (char_length(badge) <= 30),     -- e.g. "20% off"
  audience   text[] not null default '{}',                                 -- member types; empty = everyone
  cities     text[] not null default '{}',                                 -- empty = all cities
  starts_at  timestamptz,
  ends_at    timestamptz,
  active     boolean not null default true,
  sort       int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.offers enable row level security;
drop policy if exists "offers: read live" on public.offers;
create policy "offers: read live" on public.offers for select using ((active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())) or public.is_admin());
grant select on public.offers to anon, authenticated;

-- ---------- Saved searches = personalised property alerts ----------
create table if not exists public.saved_searches (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  label         text not null default '' check (char_length(label) <= 120),
  purpose       text check (purpose in ('sale','rent')),
  property_type text check (property_type in ('House','Apartment','Plot','Commercial')),
  city          text check (char_length(city) <= 60),
  area          text check (char_length(area) <= 120),
  min_price     bigint check (min_price >= 0),
  max_price     bigint check (max_price >= 0),
  created_at    timestamptz not null default now(),
  last_hit_at   timestamptz
);
create index if not exists saved_searches_user_idx on public.saved_searches (user_id);
alter table public.saved_searches enable row level security;
drop policy if exists "saved_searches: own" on public.saved_searches;
create policy "saved_searches: own" on public.saved_searches for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, delete on public.saved_searches to authenticated;
create or replace function public.saved_searches_before_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  new.user_id := auth.uid(); new.created_at := now(); new.last_hit_at := null;
  if new.user_id is null then raise exception 'Please sign in to save alerts.'; end if;
  if (select count(*) from public.saved_searches where user_id = new.user_id) >= 10 then raise exception 'You can keep up to 10 property alerts. Remove one first.'; end if;
  return new;
end $$;
drop trigger if exists saved_searches_before_insert on public.saved_searches;
create trigger saved_searches_before_insert before insert on public.saved_searches for each row execute function public.saved_searches_before_insert();

-- ---------- Property Wanted posts ----------
create table if not exists public.wanted_posts (
  id            uuid primary key default gen_random_uuid(),
  ref           text not null unique default ('RQ-WNT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))),
  user_id       uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  poster_name   text not null default '',
  purpose       text not null check (purpose in ('buy','rent')),
  property_type text not null check (property_type in ('House','Apartment','Plot','Commercial')),
  city          text not null check (char_length(city) between 2 and 60),
  area          text not null default '' check (char_length(area) <= 120),
  max_budget    bigint check (max_budget > 0),
  min_size      numeric check (min_size > 0),
  size_unit     text check (size_unit in ('Marla','Kanal','sq ft','sq yd','Acre')),
  details       text not null default '' check (char_length(details) <= 600),
  status        text not null default 'published' check (status in ('published','hidden','closed')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists wanted_posts_status_idx on public.wanted_posts (status, created_at desc);
alter table public.wanted_posts enable row level security;
drop policy if exists "wanted_posts: read" on public.wanted_posts;
create policy "wanted_posts: read" on public.wanted_posts for select using (status = 'published' or user_id = auth.uid() or public.is_admin());
drop policy if exists "wanted_posts: insert own" on public.wanted_posts;
create policy "wanted_posts: insert own" on public.wanted_posts for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "wanted_posts: update own or admin" on public.wanted_posts;
create policy "wanted_posts: update own or admin" on public.wanted_posts for update using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
drop policy if exists "wanted_posts: delete own or admin" on public.wanted_posts;
create policy "wanted_posts: delete own or admin" on public.wanted_posts for delete using (user_id = auth.uid() or public.is_admin());
grant select on public.wanted_posts to anon, authenticated;
grant insert, update, delete on public.wanted_posts to authenticated;

create or replace function public.wanted_posts_before()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.user_id := auth.uid(); new.created_at := now(); new.status := 'published';
    if not public.is_verified_user() then raise exception 'Please sign in and complete your profile to post.'; end if;
    if (select count(*) from public.wanted_posts where user_id = new.user_id and created_at > now() - interval '1 day') >= 5 then
      raise exception 'You can post up to 5 requests a day. Please try again tomorrow.';
    end if;
    select coalesce(nullif(full_name, ''), 'RAQBO member') into new.poster_name from public.profiles where id = new.user_id;
  elsif auth.uid() is not null and not public.is_admin() then
    -- the poster may edit text or close the post; only RAQBO can hide it
    new.id := old.id; new.ref := old.ref; new.user_id := old.user_id; new.poster_name := old.poster_name; new.created_at := old.created_at;
    if new.status = 'hidden' or old.status = 'hidden' then new.status := old.status; end if;
  end if;
  return new;
end $$;
drop trigger if exists wanted_posts_before on public.wanted_posts;
create trigger wanted_posts_before before insert or update on public.wanted_posts for each row execute function public.wanted_posts_before();

-- A new request tells owners whose published property matches it
create or replace function public.wanted_posts_after_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
declare r record; n int := 0;
begin
  for r in select distinct on (l.owner_id) l.owner_id, l.id, l.title from public.listings l
            where l.status = 'published' and not l.is_sample and l.owner_id is not null and l.owner_id <> new.user_id
              and l.purpose = case new.purpose when 'buy' then 'sale' else 'rent' end and l.property_type = new.property_type
              and lower(l.city) = lower(new.city) and (new.area = '' or l.area ilike '%' || new.area || '%')
              and (new.max_budget is null or l.price <= new.max_budget)
            order by l.owner_id, l.published_at desc limit 100 loop
    perform public.notify(r.owner_id, 'alert', 'Someone wants a property like yours',
      new.property_type || ' to ' || new.purpose || ' in ' || coalesce(nullif(new.area, '') || ', ', '') || new.city || coalesce(' · up to Rs ' || to_char(new.max_budget, 'FM999,999,999,999'), '') || '. Reply to them directly.',
      '#wanted/' || new.id);
    n := n + 1;
  end loop;
  return new;
end $$;
drop trigger if exists wanted_posts_after_insert on public.wanted_posts;
create trigger wanted_posts_after_insert after insert on public.wanted_posts for each row execute function public.wanted_posts_after_insert();

-- Chat with the person who posted a request
alter table public.conversations add column if not exists wanted_id uuid references public.wanted_posts (id) on delete set null;
create or replace function public.start_wanted_chat(p_wanted uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); w public.wanted_posts; cid uuid; my_name text;
begin
  if me is null or not public.is_verified_user() then raise exception 'Please sign in to send messages.'; end if;
  select * into w from public.wanted_posts where id = p_wanted and status = 'published';
  if w.id is null then raise exception 'This request is no longer open.'; end if;
  if w.user_id = me then raise exception 'This is your own request.'; end if;
  select coalesce(nullif(full_name, ''), 'RAQBO member') into my_name from public.profiles where id = me;
  select id into cid from public.conversations
   where starter_id = me and other_id = w.user_id and listing_id is null and vendor_id is null and order_id is null;
  if cid is null then
    insert into public.conversations (starter_id, other_id, wanted_id, subject, starter_name, other_name)
    values (me, w.user_id, w.id, left('Property wanted: ' || w.property_type || ' in ' || w.city || ' · ' || w.ref, 160), my_name, w.poster_name)
    returning id into cid;
  end if;
  return cid;
end $$;
grant execute on function public.start_wanted_chat(uuid) to authenticated;

-- ---------- Featured listings (7-day free trial; admins can feature too) ----------
create table if not exists public.listing_features (
  listing_id uuid primary key references public.listings (id) on delete cascade,
  until      timestamptz not null,
  source     text not null default 'trial' check (source in ('trial','admin','paid')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.listing_features enable row level security;
drop policy if exists "listing_features: read" on public.listing_features;
create policy "listing_features: read" on public.listing_features for select using (true);
grant select on public.listing_features to anon, authenticated;

create or replace function public.start_featured_trial(p_listing uuid)
returns timestamptz language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); l public.listings; s public.growth_settings; p public.profiles; t timestamptz;
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  select * into s from public.growth_settings where id = 1;
  if not s.featured_trial_enabled then raise exception 'The free featured trial is not available right now.'; end if;
  select * into p from public.profiles where id = me;
  if p.featured_trial_at is not null then raise exception 'You have already used your free featured trial.'; end if;
  select * into l from public.listings where id = p_listing;
  if l.id is null or l.owner_id is distinct from me then raise exception 'You can feature only your own property.'; end if;
  if l.status <> 'published' then raise exception 'Your property must be approved before it can be featured.'; end if;
  if not public.growth_in_pilot(l.city) then raise exception 'The free trial is available in % for now.', array_to_string(s.pilot_cities, ', '); end if;
  t := now() + make_interval(days => s.featured_trial_days);
  insert into public.listing_features (listing_id, until, source, created_by) values (l.id, t, 'trial', me)
  on conflict (listing_id) do update set until = greatest(public.listing_features.until, excluded.until);
  update public.profiles set featured_trial_at = now() where id = me;
  return t;
end $$;
grant execute on function public.start_featured_trial(uuid) to authenticated;

create or replace function public.admin_feature_listing(p_listing uuid, p_days int)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if coalesce(p_days, 0) <= 0 then delete from public.listing_features where listing_id = p_listing; return; end if;
  insert into public.listing_features (listing_id, until, source, created_by) values (p_listing, now() + make_interval(days => least(p_days, 365)), 'admin', auth.uid())
  on conflict (listing_id) do update set until = excluded.until, source = 'admin', created_by = auth.uid();
end $$;
grant execute on function public.admin_feature_listing(uuid, int) to authenticated;

-- ---------- Listing alerts: new matches, price drops, owner referral reward ----------
alter table public.listings add column if not exists notified_price bigint;
create or replace function public.listings_zz_growth()
returns trigger language plpgsql security definer set search_path = public
as $$
declare r record; s public.growth_settings; owner public.profiles; first_time boolean;
begin
  if auth.uid() is not null and not public.is_admin() then new.notified_price := old.notified_price; end if;
  if new.status <> 'published' or new.is_sample then return new; end if;
  if old.status = 'published' and new.price = old.price then return new; end if;
  first_time := new.notified_price is null;
  if first_time then
    -- people with a matching property alert
    for r in select ss.id, ss.user_id, ss.label from public.saved_searches ss
              where ss.user_id <> coalesce(new.owner_id, '00000000-0000-0000-0000-000000000000'::uuid)
                and (ss.purpose is null or ss.purpose = new.purpose) and (ss.property_type is null or ss.property_type = new.property_type)
                and (ss.city is null or lower(ss.city) = lower(new.city)) and (ss.area is null or new.area ilike '%' || ss.area || '%')
                and (ss.min_price is null or new.price >= ss.min_price) and (ss.max_price is null or new.price <= ss.max_price)
              limit 1000 loop
      perform public.notify(r.user_id, 'alert', 'New match: ' || left(new.title, 120),
        new.area || ', ' || new.city || ' · Rs ' || to_char(new.price, 'FM999,999,999,999') || case when new.purpose = 'rent' then '/month' else '' end || coalesce(' · alert: ' || nullif(r.label, ''), ''),
        '#property/' || new.id);
      update public.saved_searches set last_hit_at = now() where id = r.id;
    end loop;
    -- people who posted a matching Property Wanted request
    for r in select w.user_id from public.wanted_posts w
              where w.status = 'published' and w.user_id <> coalesce(new.owner_id, '00000000-0000-0000-0000-000000000000'::uuid)
                and new.purpose = case w.purpose when 'buy' then 'sale' else 'rent' end and w.property_type = new.property_type
                and lower(w.city) = lower(new.city) and (w.area = '' or new.area ilike '%' || w.area || '%')
                and (w.max_budget is null or new.price <= w.max_budget)
              limit 500 loop
      perform public.notify(r.user_id, 'alert', 'A property matching your request', left(new.title, 120) || ' · ' || new.area || ', ' || new.city, '#property/' || new.id);
    end loop;
    -- the owner was referred: reward the referrer for a real, approved listing
    select * into owner from public.profiles where id = new.owner_id;
    select * into s from public.growth_settings where id = 1;
    if owner.referred_by is not null and s.referral_enabled and public.growth_in_pilot(new.city) then
      perform public.growth_reward(owner.referred_by, 'referral_owner', owner.id, new.id, s.referral_owner_credit, 'published an approved property');
    end if;
  elsif new.price < new.notified_price then
    for r in select f.user_id from public.favorites f where f.listing_id = new.id and f.user_id <> coalesce(new.owner_id, '00000000-0000-0000-0000-000000000000'::uuid) limit 2000 loop
      perform public.notify(r.user_id, 'alert', 'Price dropped: ' || left(new.title, 120),
        'Now Rs ' || to_char(new.price, 'FM999,999,999,999') || ' (was Rs ' || to_char(new.notified_price, 'FM999,999,999,999') || ') · ' || new.area || ', ' || new.city,
        '#property/' || new.id);
    end loop;
  end if;
  new.notified_price := new.price;
  return new;
end $$;
drop trigger if exists listings_zz_growth on public.listings;
create trigger listings_zz_growth before update on public.listings for each row execute function public.listings_zz_growth();
-- listings already live don't send "new match" alerts again
update public.listings set notified_price = price where status = 'published' and notified_price is null;

-- ---------- "Active member" checks for referral rewards ----------
create or replace function public.growth_activity()
returns trigger language plpgsql security definer set search_path = public
as $$
declare u uuid;
begin
  u := nullif(to_jsonb(new) ->> tg_argv[0], '')::uuid;
  if u is not null then perform public.growth_check_member(u); end if;
  return null;
end $$;
drop trigger if exists growth_activity on public.favorites;
create trigger growth_activity after insert on public.favorites for each row execute function public.growth_activity('user_id');
drop trigger if exists growth_activity on public.listings;
create trigger growth_activity after insert on public.listings for each row execute function public.growth_activity('owner_id');
drop trigger if exists growth_activity on public.messages;
create trigger growth_activity after insert on public.messages for each row execute function public.growth_activity('sender_id');
drop trigger if exists growth_activity on public.saved_searches;
create trigger growth_activity after insert on public.saved_searches for each row execute function public.growth_activity('user_id');
drop trigger if exists growth_activity on public.wanted_posts;
create trigger growth_activity after insert on public.wanted_posts for each row execute function public.growth_activity('user_id');
drop trigger if exists growth_activity on public.orders;
create trigger growth_activity after insert on public.orders for each row execute function public.growth_activity('buyer_id');
drop trigger if exists growth_activity on public.profiles;
create trigger growth_activity after update of verified, city on public.profiles for each row execute function public.growth_activity('id');

-- notification types for alerts and rewards
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('order','listing','review','message','system','alert','reward'));

-- ---------- Website calls ----------
-- Public campaign numbers for the home page banner (no personal data)
create or replace function public.growth_public()
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'campaign_on', s.campaign_on, 'title', s.campaign_title, 'tagline', s.campaign_tagline, 'cta', s.campaign_cta,
    'founding_enabled', s.founding_enabled, 'founding_cap', s.founding_cap, 'founding_taken', (select count(*) from public.profiles where founding_no is not null),
    'founding_discount_pct', s.founding_discount_pct, 'founding_discount_max', s.founding_discount_max,
    'referral_enabled', s.referral_enabled, 'referral_member_credit', s.referral_member_credit, 'referral_owner_credit', s.referral_owner_credit,
    'featured_trial_enabled', s.featured_trial_enabled, 'featured_trial_days', s.featured_trial_days, 'pilot_cities', to_jsonb(s.pilot_cities), 'credit_expiry_days', s.credit_expiry_days,
    'featured', coalesce((select jsonb_agg(f.listing_id) from public.listing_features f join public.listings l on l.id = f.listing_id and l.status = 'published' where f.until > now()), '[]'::jsonb))
  from public.growth_settings s where s.id = 1
$$;
grant execute on function public.growth_public() to anon, authenticated;

-- Founding badges for advertisers shown on property pages (number only)
create or replace function public.member_badges(p_ids uuid[])
returns table (id uuid, founding_no int) language sql stable security definer set search_path = public
as $$ select p.id, p.founding_no from public.profiles p where p.id = any(p_ids[1:500]) and p.founding_no is not null $$;
grant execute on function public.member_badges(uuid[]) to anon, authenticated;

-- Everything for the "My RAQBO Rewards" page
create or replace function public.my_growth()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare me uuid := auth.uid(); p public.profiles; out jsonb;
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  select * into p from public.profiles where id = me;
  select jsonb_build_object(
    'ref_code', p.ref_code, 'founding_no', p.founding_no, 'member_type', p.member_type, 'city', p.city,
    'referred_by', (select coalesce(nullif(full_name, ''), 'a RAQBO member') from public.profiles where id = p.referred_by),
    'can_claim_referral', p.referred_by is null and p.created_at > now() - interval '14 days',
    'featured_trial_used', p.featured_trial_at is not null,
    'available', public.credit_available(me),
    'pending', coalesce((select sum(amount) from public.credit_ledger where user_id = me and amount > 0 and status = 'pending'), 0),
    'earned', coalesce((select sum(amount) from public.credit_ledger where user_id = me and amount > 0 and status = 'approved'), 0),
    'founding_discount', (select jsonb_build_object('status', status, 'note', note, 'admin_note', admin_note, 'at', created_at) from public.credit_ledger where user_id = me and kind = 'founding_discount' and status <> 'rejected' limit 1),
    'invited', (select count(*) from public.profiles where referred_by = me),
    'invited_active', (select count(*) from public.credit_ledger where user_id = me and kind = 'referral_member' and status <> 'rejected'),
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'amount', c.amount, 'status', c.status, 'note', c.note, 'admin_note', c.admin_note,
                         'at', c.created_at, 'expires_at', c.expires_at, 'who', (select coalesce(nullif(split_part(full_name, ' ', 1), ''), 'A member') from public.profiles where id = c.source_user)) order by c.created_at desc)
                         from (select * from public.credit_ledger where user_id = me order by created_at desc limit 60) c), '[]'::jsonb),
    'alerts', coalesce((select jsonb_agg(to_jsonb(ss) order by ss.created_at desc) from public.saved_searches ss where ss.user_id = me), '[]'::jsonb)
  ) into out;
  return out;
end $$;
grant execute on function public.my_growth() to authenticated;

-- Link a new member to the person who invited them (from a ?ref= link)
create or replace function public.claim_referral(p_code text)
returns text language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); p public.profiles; r public.profiles;
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  select * into p from public.profiles where id = me;
  if p.referred_by is not null then return 'already'; end if;
  if p.created_at < now() - interval '14 days' then return 'too_late'; end if;
  select * into r from public.profiles where ref_code = upper(btrim(p_code));
  if r.id is null then raise exception 'That invite code is not valid.'; end if;
  if r.id = me then raise exception 'You cannot use your own invite code.'; end if;
  if r.referred_by = me then raise exception 'You invited this member, so you cannot use their code.'; end if;
  update public.profiles set referred_by = r.id where id = me;
  perform public.notify(r.id, 'reward', 'Someone joined with your invite',
    coalesce(nullif(split_part(p.full_name, ' ', 1), ''), 'A new member') || ' signed up with your link. You earn credit when they start using RAQBO.', '#rewards');
  perform public.growth_check_member(me);
  return 'ok';
end $$;
grant execute on function public.claim_referral(text) to authenticated;

-- "I am a…" and city (for offers and the pilot)
create or replace function public.set_member_details(p_type text, p_city text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  update public.profiles set member_type = nullif(p_type, ''), city = nullif(left(btrim(coalesce(p_city, '')), 60), '') where id = auth.uid();
end $$;
grant execute on function public.set_member_details(text, text) to authenticated;

-- Ask RAQBO to apply credit, or the Founding Member discount, to a service
create or replace function public.request_redemption(p_kind text, p_amount int, p_note text)
returns void language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); p public.profiles; s public.growth_settings; nm text;
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  select * into p from public.profiles where id = me; select * into s from public.growth_settings where id = 1;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Tell us which service or order this is for.'; end if;
  nm := coalesce(nullif(p.full_name, ''), 'A member');
  if p_kind = 'founding' then
    if p.founding_no is null then raise exception 'This benefit is for Founding Members.'; end if;
    if exists (select 1 from public.credit_ledger where user_id = me and kind = 'founding_discount' and status <> 'rejected') then raise exception 'You have already used your Founding Member discount.'; end if;
    insert into public.credit_ledger (user_id, kind, amount, status, note) values (me, 'founding_discount', 0, 'pending', left(btrim(p_note), 300));
    perform public.notify_admins('system', 'Founding discount request', nm || ' (Founding Member #' || p.founding_no || '): ' || left(btrim(p_note), 200), '#admin/growth');
  else
    if coalesce(p_amount, 0) <= 0 then raise exception 'Enter the amount of credit to use.'; end if;
    if p_amount > public.credit_available(me) then raise exception 'You have Rs % credit available.', public.credit_available(me); end if;
    insert into public.credit_ledger (user_id, kind, amount, status, note) values (me, 'redemption', -p_amount, 'pending', left(btrim(p_note), 300));
    perform public.notify_admins('system', 'Credit redemption request', nm || ' wants to use Rs ' || p_amount || ' credit: ' || left(btrim(p_note), 200), '#admin/growth');
  end if;
end $$;
grant execute on function public.request_redemption(text, int, text) to authenticated;

-- ---------- Admin ----------
create or replace function public.admin_growth()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare out jsonb;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  select jsonb_build_object(
    'settings', (select to_jsonb(s) from public.growth_settings s where id = 1),
    'stats', jsonb_build_object(
      'founding', (select count(*) from public.profiles where founding_no is not null),
      'referred', (select count(*) from public.profiles where referred_by is not null),
      'referred_active', (select count(*) from public.credit_ledger where kind = 'referral_member' and status <> 'rejected'),
      'owner_rewards', (select count(*) from public.credit_ledger where kind = 'referral_owner' and status <> 'rejected'),
      'credit_issued', coalesce((select sum(amount) from public.credit_ledger where amount > 0 and status = 'approved'), 0),
      'credit_pending', coalesce((select sum(amount) from public.credit_ledger where amount > 0 and status = 'pending'), 0),
      'credit_used', -coalesce((select sum(amount) from public.credit_ledger where kind = 'redemption' and status = 'approved'), 0),
      'founding_discounts', (select count(*) from public.credit_ledger where kind = 'founding_discount' and status = 'approved'),
      'alerts', (select count(*) from public.saved_searches),
      'wanted', (select count(*) from public.wanted_posts where status = 'published'),
      'featured', (select count(*) from public.listing_features where until > now()),
      'types', coalesce((select jsonb_object_agg(coalesce(member_type, 'not set'), n) from (select member_type, count(*) n from public.profiles group by member_type) t), '{}'::jsonb)),
    'queue', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'amount', c.amount, 'note', c.note, 'admin_note', c.admin_note, 'at', c.created_at,
              'user', (select coalesce(nullif(full_name, ''), email) from public.profiles where id = c.user_id), 'user_email', (select email from public.profiles where id = c.user_id),
              'founding_no', (select founding_no from public.profiles where id = c.user_id),
              'who', (select coalesce(nullif(full_name, ''), email) from public.profiles where id = c.source_user),
              'who_verified', (select verified from public.profiles where id = c.source_user),
              'who_phone', (select phone from public.profiles where id = c.source_user),
              'listing', (select ref from public.listings where id = c.listing_id), 'available', public.credit_available(c.user_id)) order by c.created_at)
              from public.credit_ledger c where c.status = 'pending'), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(x order by (x->>'at') desc) from (select jsonb_build_object('id', c.id, 'kind', c.kind, 'amount', c.amount, 'status', c.status, 'at', coalesce(c.decided_at, c.created_at),
              'user', (select coalesce(nullif(full_name, ''), email) from public.profiles where id = c.user_id)) x
              from public.credit_ledger c where c.status <> 'pending' order by coalesce(c.decided_at, c.created_at) desc limit 30) r), '[]'::jsonb),
    'top', coalesce((select jsonb_agg(t) from (select coalesce(nullif(p.full_name, ''), p.email) as name, count(*) as invited,
              (select count(*) from public.credit_ledger c where c.user_id = p.id and c.kind like 'referral%' and c.status <> 'rejected') as rewarded
              from public.profiles p join public.profiles q on q.referred_by = p.id group by p.id order by count(*) desc limit 10) t), '[]'::jsonb),
    'offers', coalesce((select jsonb_agg(to_jsonb(o) order by o.sort, o.created_at desc) from public.offers o), '[]'::jsonb),
    'wanted', coalesce((select jsonb_agg(to_jsonb(w) order by w.created_at desc) from (select * from public.wanted_posts order by created_at desc limit 50) w), '[]'::jsonb)
  ) into out;
  return out;
end $$;
grant execute on function public.admin_growth() to authenticated;

create or replace function public.admin_save_growth(p jsonb)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  update public.growth_settings set
    campaign_on = coalesce((p->>'campaign_on')::boolean, campaign_on),
    campaign_title = coalesce(nullif(btrim(p->>'campaign_title'), ''), campaign_title),
    campaign_tagline = coalesce(p->>'campaign_tagline', campaign_tagline),
    campaign_cta = coalesce(p->>'campaign_cta', campaign_cta),
    founding_enabled = coalesce((p->>'founding_enabled')::boolean, founding_enabled),
    founding_cap = coalesce((p->>'founding_cap')::int, founding_cap),
    founding_discount_pct = coalesce((p->>'founding_discount_pct')::int, founding_discount_pct),
    founding_discount_max = coalesce((p->>'founding_discount_max')::int, founding_discount_max),
    referral_enabled = coalesce((p->>'referral_enabled')::boolean, referral_enabled),
    referral_member_credit = coalesce((p->>'referral_member_credit')::int, referral_member_credit),
    referral_owner_credit = coalesce((p->>'referral_owner_credit')::int, referral_owner_credit),
    referral_review = coalesce((p->>'referral_review')::boolean, referral_review),
    referral_monthly_cap = coalesce((p->>'referral_monthly_cap')::int, referral_monthly_cap),
    credit_expiry_days = coalesce((p->>'credit_expiry_days')::int, credit_expiry_days),
    featured_trial_enabled = coalesce((p->>'featured_trial_enabled')::boolean, featured_trial_enabled),
    featured_trial_days = coalesce((p->>'featured_trial_days')::int, featured_trial_days),
    pilot_cities = case when p ? 'pilot_cities' then array(select btrim(x) from jsonb_array_elements_text(p->'pilot_cities') x where btrim(x) <> '') else pilot_cities end,
    budget_total = coalesce((p->>'budget_total')::bigint, budget_total),
    updated_at = now()
  where id = 1;
end $$;
grant execute on function public.admin_save_growth(jsonb) to authenticated;

create or replace function public.admin_decide_credit(p_id bigint, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = public
as $$
declare c public.credit_ledger;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  update public.credit_ledger set status = case when p_approve then 'approved' else 'rejected' end,
         admin_note = left(coalesce(nullif(btrim(p_note), ''), case when p_approve then '' else admin_note end), 300), decided_by = auth.uid(), decided_at = now()
   where id = p_id and status = 'pending' returning * into c;
  if c.id is null then raise exception 'This request was already handled.'; end if;
  perform public.notify(c.user_id, 'reward',
    case c.kind
      when 'redemption' then case when p_approve then 'Rs ' || (-c.amount) || ' credit applied' else 'Credit request not approved' end
      when 'founding_discount' then case when p_approve then 'Founding Member discount applied' else 'Founding discount request not approved' end
      else case when p_approve then 'Rs ' || c.amount || ' credit is ready to use' else 'Referral reward not approved' end end,
    coalesce(nullif(btrim(p_note), ''), case when p_approve then 'See My RAQBO Rewards for details.' else 'Contact RAQBO support if you have questions.' end),
    '#rewards');
end $$;
grant execute on function public.admin_decide_credit(bigint, boolean, text) to authenticated;

create or replace function public.admin_save_offer(p jsonb)
returns uuid language plpgsql security definer set search_path = public
as $$
declare oid uuid := nullif(p->>'id', '')::uuid;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if oid is null then
    insert into public.offers (title, body, badge, audience, cities, starts_at, ends_at, active, sort)
    values (btrim(p->>'title'), coalesce(p->>'body', ''), coalesce(p->>'badge', ''),
            array(select x from jsonb_array_elements_text(coalesce(p->'audience', '[]')) x), array(select btrim(x) from jsonb_array_elements_text(coalesce(p->'cities', '[]')) x where btrim(x) <> ''),
            nullif(p->>'starts_at', '')::timestamptz, nullif(p->>'ends_at', '')::timestamptz, coalesce((p->>'active')::boolean, true), coalesce((p->>'sort')::int, 0))
    returning id into oid;
  else
    update public.offers set title = btrim(p->>'title'), body = coalesce(p->>'body', ''), badge = coalesce(p->>'badge', ''),
      audience = array(select x from jsonb_array_elements_text(coalesce(p->'audience', '[]')) x), cities = array(select btrim(x) from jsonb_array_elements_text(coalesce(p->'cities', '[]')) x where btrim(x) <> ''),
      starts_at = nullif(p->>'starts_at', '')::timestamptz, ends_at = nullif(p->>'ends_at', '')::timestamptz, active = coalesce((p->>'active')::boolean, true), sort = coalesce((p->>'sort')::int, 0)
    where id = oid;
  end if;
  return oid;
end $$;
grant execute on function public.admin_save_offer(jsonb) to authenticated;

create or replace function public.admin_delete_offer(p_id uuid)
returns void language plpgsql security definer set search_path = public
as $$ begin if not public.is_admin() then raise exception 'Admins only.'; end if; delete from public.offers where id = p_id; end $$;
grant execute on function public.admin_delete_offer(uuid) to authenticated;

-- Starter offers (sample wording for the admin to edit or switch off)
insert into public.offers (title, body, badge, audience, sort)
select * from (values
  ('Free property advertising', 'List your property free and talk to buyers and tenants directly. RAQBO takes no commission on direct deals.', 'Free', array['owner']::text[], 1),
  ('Overseas Pakistanis: property help at home', 'Tell us what you are looking for and the RAQBO team will help you search, verify documents and arrange visits.', 'Overseas', array['overseas']::text[], 2),
  ('Agents and developers: list your projects', 'Publish your projects and listings on RAQBO and reach serious buyers. Talk to our team about bulk listings.', 'Partners', array['agent','developer']::text[], 3)
) v(title, body, badge, audience, sort)
where not exists (select 1 from public.offers);

-- Live updates
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['credit_ledger', 'wanted_posts', 'growth_settings', 'listing_features'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
