-- =====================================================================
-- RAQBO — FRESH INSTALL (fixes "operator does not exist: text = uuid")
-- Removes any older RAQBO tables (including the Firebase version) and installs
-- the current database. WARNING: deletes existing RAQBO listings, enquiries,
-- reports, favorites and profiles (test data). Login accounts are kept.
-- Paste ALL of this into Supabase → SQL Editor → New query → Run.
-- =====================================================================

drop trigger if exists on_auth_user_created on auth.users;
drop view if exists public.vendor_rating_summary;
drop table if exists public.vendor_reviews, public.order_events, public.orders, public.buyer_profiles, public.vendor_products, public.vendor_private, public.vendors cascade;
drop view if exists public.listing_rating_summary;
drop table if exists public.reviews, public.favorites, public.reports, public.enquiries, public.listing_media, public.listings, public.profiles cascade;
drop function if exists public.complete_profile(text, text) cascade;
drop function if exists public.requesting_user_id() cascade;
drop function if exists public.profiles_before_write() cascade;
drop function if exists public.listings_before_insert() cascade;
drop function if exists public.listings_before_update() cascade;
drop function if exists public.submissions_before_insert() cascade;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.is_admin() cascade;
drop policy if exists "listing-media: upload own folder" on storage.objects;
drop policy if exists "listing-media: read visible" on storage.objects;
drop policy if exists "listing-media: owner or admin deletes" on storage.objects;

-- =====================================================================
-- RAQBO — Supabase database setup (email + password and Google sign-in)
-- Run this whole file once in: Supabase Dashboard → SQL Editor → New query → Run
-- If you ran an OLDER RAQBO schema before, run reset_old_setup.sql first (one time only).
-- Safe to re-run: objects are created with IF NOT EXISTS / OR REPLACE where possible.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Profiles (one row per signed-in user; created automatically)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text check (char_length(full_name) <= 120),
  email       text,
  phone       text check (phone ~ '^\+923[0-9]{9}$'),
  verified    boolean not null default false,   -- true after the user confirmed an email OTP and completed name + phone
  verified_at timestamptz,
  role        text not null default 'user' check (role in ('user', 'admin')),
  created_at  timestamptz not null default now()
);

-- Upgrade a profiles table left over from an older RAQBO setup.
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists verified boolean not null default false;
alter table public.profiles add column if not exists verified_at timestamptz;

-- Is the current user a RAQBO admin? (security definer avoids RLS recursion)
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Create a profile whenever a new auth user is created (phone OTP or staff email)
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
-- (trigger is created just below)
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Called by the website to save the user's name and mobile number after sign-up / Google sign-in.
create or replace function public.complete_profile(p_full_name text, p_phone text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if char_length(trim(coalesce(p_full_name, ''))) not between 2 and 120 then raise exception 'Please enter your full name.'; end if;
  if p_phone !~ '^\+923[0-9]{9}$' then raise exception 'Please enter a valid Pakistani mobile number.'; end if;
  update public.profiles
     set full_name = trim(p_full_name), phone = p_phone, email = coalesce(auth.jwt() ->> 'email', email),
         verified = true, verified_at = coalesce(verified_at, now())
   where id = auth.uid();
end;
$$;
revoke execute on function public.complete_profile(text, text) from public, anon;
grant execute on function public.complete_profile(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Listings
-- ---------------------------------------------------------------------
create table if not exists public.listings (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique default ('RQ-LST-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  owner_id         uuid references public.profiles (id) on delete set null,
  advertiser_name  text check (char_length(advertiser_name) <= 120),
  title            text not null check (char_length(title) between 5 and 80),
  description      text not null check (char_length(description) between 20 and 2000),
  purpose          text not null check (purpose in ('sale', 'rent')),
  property_type    text not null check (property_type in ('House', 'Apartment', 'Plot', 'Commercial')),
  advertiser_role  text not null check (advertiser_role in ('Owner', 'Authorized representative', 'Agent')),
  city             text not null check (char_length(city) <= 60),
  area             text not null check (char_length(area) between 1 and 120),
  size             numeric not null check (size > 0),
  size_unit        text not null check (size_unit in ('Marla', 'Kanal', 'sq ft', 'sq yd', 'Acre')),
  price            bigint not null check (price > 0),
  bedrooms         int not null default 0 check (bedrooms between 0 and 50),
  bathrooms        int not null default 0 check (bathrooms between 0 and 50),
  status           text not null default 'pending' check (status in ('pending', 'published', 'rejected')),
  review_note      text check (char_length(review_note) <= 1000),
  is_sample        boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  published_at     timestamptz,
  reviewed_by      uuid references public.profiles (id) on delete set null,
  reviewed_at      timestamptz
);
create index if not exists listings_status_idx on public.listings (status, published_at desc);
create index if not exists listings_owner_idx on public.listings (owner_id);

-- Non-admins can only ever create a *pending* listing owned by themselves.
create or replace function public.listings_before_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- auth.uid() is null only for trusted server-side runs (SQL editor / service role).
  if auth.uid() is not null and not public.is_admin() then
    if (select count(*) from public.listings where owner_id = auth.uid() and created_at > now() - interval '1 day') >= 10 then
      raise exception 'You can submit up to 10 listings per day. Please try again tomorrow.';
    end if;
    new.owner_id     := auth.uid();
    new.status       := 'pending';
    new.is_sample    := false;
    new.review_note  := null;
    new.published_at := null;
    new.reviewed_by  := null;
    new.reviewed_at  := null;
    new.advertiser_name := coalesce((select full_name from public.profiles where id = auth.uid()), new.advertiser_name);
  end if;
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists listings_before_insert on public.listings;
create trigger listings_before_insert before insert on public.listings
  for each row execute function public.listings_before_insert();

-- Keep review/publish timestamps consistent when an admin changes status.
create or replace function public.listings_before_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.updated_at := now();
  if auth.uid() is not null and not public.is_admin() then
    -- Advertiser editing their own listing: system fields stay as they were,
    -- and the listing goes back to the review queue (hidden until approved again).
    new.id := old.id; new.ref := old.ref; new.owner_id := old.owner_id; new.is_sample := old.is_sample;
    new.advertiser_name := old.advertiser_name; new.created_at := old.created_at;
    new.review_note := old.review_note; new.reviewed_by := old.reviewed_by; new.reviewed_at := old.reviewed_at;
    new.published_at := old.published_at;
    new.status := 'pending';
    return new;
  end if;
  if new.status is distinct from old.status then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
    if new.status = 'published' then new.published_at := now(); end if;
  end if;
  return new;
end;
$$;
drop trigger if exists listings_before_update on public.listings;
create trigger listings_before_update before update on public.listings
  for each row execute function public.listings_before_update();

-- ---------------------------------------------------------------------
-- 3. Listing media (photos and MP4 videos)
-- ---------------------------------------------------------------------
create table if not exists public.listing_media (
  id            uuid primary key default gen_random_uuid(),
  listing_id    uuid not null references public.listings (id) on delete cascade,
  kind          text not null check (kind in ('photo', 'video')),
  path          text unique,          -- object path in the 'listing-media' storage bucket
  external_url  text,                 -- used only by sample listings
  file_name     text check (char_length(file_name) <= 255),
  mime_type     text,
  size_bytes    bigint,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  constraint listing_media_source check (path is not null or external_url is not null)
);
create index if not exists listing_media_listing_idx on public.listing_media (listing_id, sort_order);

-- ---------------------------------------------------------------------
-- 4. Service enquiries
-- ---------------------------------------------------------------------
create table if not exists public.enquiries (
  id                 uuid primary key default gen_random_uuid(),
  ref                text not null unique,
  service            text not null check (service in ('verification', 'legal', 'documents', 'registry', 'general')),
  name               text not null check (char_length(name) between 1 and 120),
  phone              text not null check (char_length(phone) between 10 and 20),
  email              text check (char_length(email) <= 200),
  city               text check (char_length(city) <= 60),
  property_ref       text check (char_length(property_ref) <= 300),
  message            text not null check (char_length(message) between 10 and 3000),
  preferred_contact  text check (preferred_contact in ('Phone call', 'WhatsApp', 'Email')),
  status             text not null default 'new' check (status in ('new', 'handled')),
  user_id            uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5. Property reports
-- ---------------------------------------------------------------------
create table if not exists public.reports (
  id              uuid primary key default gen_random_uuid(),
  ref             text not null unique,
  listing_id      uuid not null references public.listings (id) on delete cascade,
  reason          text not null check (reason in ('Incorrect information', 'Suspicious activity', 'Duplicate listing', 'Other concern')),
  details         text check (char_length(details) <= 3000),
  reporter_name   text check (char_length(reporter_name) <= 120),
  reporter_phone  text check (char_length(reporter_phone) <= 20),
  status          text not null default 'open' check (status in ('open', 'reviewed')),
  user_id         uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);

-- Public submissions always start as new/open and are linked to the signed-in user (if any).
create or replace function public.submissions_before_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare recent int;
begin
  new.user_id := auth.uid();
  new.created_at := now();
  if tg_table_name = 'enquiries' then new.status := 'new'; else new.status := 'open'; end if;
  -- Spam limit: 10 enquiries and 10 reports per user per hour (admins exempt).
  if auth.uid() is not null and not public.is_admin() then
    if tg_table_name = 'enquiries' then
      select count(*) into recent from public.enquiries where user_id = auth.uid() and created_at > now() - interval '1 hour';
    else
      select count(*) into recent from public.reports where user_id = auth.uid() and created_at > now() - interval '1 hour';
    end if;
    if recent >= 10 then raise exception 'Too many requests. Please try again in an hour.'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists enquiries_before_insert on public.enquiries;
create trigger enquiries_before_insert before insert on public.enquiries
  for each row execute function public.submissions_before_insert();
drop trigger if exists reports_before_insert on public.reports;
create trigger reports_before_insert before insert on public.reports
  for each row execute function public.submissions_before_insert();

-- ---------------------------------------------------------------------
-- 6. Favorites (for signed-in users)
-- ---------------------------------------------------------------------
create table if not exists public.favorites (
  user_id     uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  listing_id  uuid not null references public.listings (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, listing_id)
);

-- =====================================================================
-- 7. Row Level Security
-- =====================================================================
alter table public.profiles      enable row level security;
alter table public.listings      enable row level security;
alter table public.listing_media enable row level security;
alter table public.enquiries     enable row level security;
alter table public.reports       enable row level security;
alter table public.favorites     enable row level security;

-- Profiles: users see/edit their own name; admins see everyone. Role cannot be changed from the website.
drop policy if exists "profiles: read own or admin" on public.profiles;
create policy "profiles: read own or admin" on public.profiles
  for select using (id = auth.uid() or public.is_admin());
-- Profiles are changed only through complete_profile() (and by admins in the SQL editor).
drop policy if exists "profiles: update own" on public.profiles;
revoke insert, update, delete on public.profiles from anon, authenticated;

-- Listings: everyone sees published; owners see their own; admins see all.
drop policy if exists "listings: read" on public.listings;
create policy "listings: read" on public.listings
  for select using (status = 'published' or owner_id = auth.uid() or public.is_admin());
drop policy if exists "listings: owner inserts pending" on public.listings;
create policy "listings: owner inserts pending" on public.listings
  for insert to authenticated with check (
    owner_id = auth.uid() and status = 'pending'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.verified or p.role = 'admin'))
  );
drop policy if exists "listings: admin updates" on public.listings;
create policy "listings: admin updates" on public.listings
  for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "listings: owner edits own" on public.listings;
create policy "listings: owner edits own" on public.listings
  for update to authenticated using (owner_id = auth.uid() and not is_sample) with check (owner_id = auth.uid());
drop policy if exists "listings: owner withdraws pending, admin deletes" on public.listings;
drop policy if exists "listings: owner or admin deletes" on public.listings;
create policy "listings: owner or admin deletes" on public.listings
  for delete using (owner_id = auth.uid() or public.is_admin());

-- Listing media: visible whenever its listing is visible; owners add media to their own pending listings.
drop policy if exists "media: read with listing" on public.listing_media;
create policy "media: read with listing" on public.listing_media
  for select using (exists (select 1 from public.listings l where l.id = listing_id));
drop policy if exists "media: owner adds to pending listing" on public.listing_media;
create policy "media: owner adds to pending listing" on public.listing_media
  for insert to authenticated with check (
    exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = auth.uid() and l.status = 'pending')
    and path like auth.uid()::text || '/%'
  );
drop policy if exists "media: admin deletes" on public.listing_media;
drop policy if exists "media: owner or admin deletes" on public.listing_media;
create policy "media: owner or admin deletes" on public.listing_media
  for delete using (public.is_admin() or exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = auth.uid()));

-- Enquiries & reports: only signed-in, verified users may submit (spam protection); only admins read and update.
drop policy if exists "enquiries: anyone submits" on public.enquiries;
drop policy if exists "enquiries: verified users submit" on public.enquiries;
create policy "enquiries: verified users submit" on public.enquiries
  for insert to authenticated with check (
    status = 'new' and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.verified or p.role = 'admin'))
  );
drop policy if exists "enquiries: admin reads" on public.enquiries;
create policy "enquiries: admin reads" on public.enquiries
  for select using (public.is_admin());
drop policy if exists "enquiries: admin updates" on public.enquiries;
create policy "enquiries: admin updates" on public.enquiries
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "reports: anyone reports a published listing" on public.reports;
drop policy if exists "reports: verified users report a published listing" on public.reports;
create policy "reports: verified users report a published listing" on public.reports
  for insert to authenticated with check (
    status = 'open'
    and exists (select 1 from public.listings l where l.id = listing_id and l.status = 'published')
    and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.verified or p.role = 'admin'))
  );
drop policy if exists "reports: admin reads" on public.reports;
create policy "reports: admin reads" on public.reports
  for select using (public.is_admin());
drop policy if exists "reports: admin updates" on public.reports;
create policy "reports: admin updates" on public.reports
  for update using (public.is_admin()) with check (public.is_admin());

-- Favorites: each user manages only their own.
drop policy if exists "favorites: own" on public.favorites;
create policy "favorites: own" on public.favorites
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =====================================================================
-- 8. Storage bucket for photos and videos (private — served via signed URLs)
--    50 MB per file matches the Supabase Free plan upload limit.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-media', 'listing-media', false, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Signed-in users upload only into their own folder:  <user id>/<listing id>/<file>
drop policy if exists "listing-media: upload own folder" on storage.objects;
create policy "listing-media: upload own folder" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'listing-media' and (storage.foldername(name))[1] = auth.uid()::text
  );
-- Files are readable only when their listing is readable (published, own, or admin).
drop policy if exists "listing-media: read visible" on storage.objects;
create policy "listing-media: read visible" on storage.objects
  for select using (
    bucket_id = 'listing-media' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (select 1 from public.listing_media m join public.listings l on l.id = m.listing_id where m.path = storage.objects.name)
    )
  );
drop policy if exists "listing-media: owner or admin deletes" on storage.objects;
create policy "listing-media: owner or admin deletes" on storage.objects
  for delete using (
    bucket_id = 'listing-media' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- =====================================================================
-- 9. Sample listings (illustrative; delete any time from the admin panel or SQL)
-- =====================================================================
do $$
declare lid uuid;
begin
  if exists (select 1 from public.listings where is_sample) then return; end if;

  insert into public.listings (advertiser_name, title, description, purpose, property_type, advertiser_role, city, area, size, size_unit, price, bedrooms, bathrooms, status, is_sample, published_at)
  values ('Hamza R.', 'Contemporary family home', E'A light-filled 1 Kanal home on a quiet, wide street. Double-height entrance, open kitchen with family lounge, five en-suite bedrooms and a basement with a home theatre.\nServant quarter, solar back-up and covered parking for three cars.', 'sale', 'House', 'Owner', 'Lahore', 'DHA Phase 6', 1, 'Kanal', 78500000, 5, 6, 'published', true, now() - interval '1 day') returning id into lid;
  insert into public.listing_media (listing_id, kind, external_url, file_name, sort_order) values
    (lid, 'photo', 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1400&q=80', 'Sample photo', 0),
    (lid, 'photo', 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1400&q=80', 'Sample photo', 1);

  insert into public.listings (advertiser_name, title, description, purpose, property_type, advertiser_role, city, area, size, size_unit, price, bedrooms, bathrooms, status, is_sample, published_at)
  values ('Sana M.', 'Sunlit apartment with a view', 'Twelfth-floor corner apartment with floor-to-ceiling windows facing the city. Three bedrooms, fitted kitchen, back-up generator, lift and 24/7 security.', 'sale', 'Apartment', 'Owner', 'Lahore', 'Gulberg III', 1650, 'sq ft', 32500000, 3, 3, 'published', true, now() - interval '2 days') returning id into lid;
  insert into public.listing_media (listing_id, kind, external_url, file_name, sort_order) values
    (lid, 'photo', 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1400&q=80', 'Sample photo', 0);

  insert into public.listings (advertiser_name, title, description, purpose, property_type, advertiser_role, city, area, size, size_unit, price, bedrooms, bathrooms, status, is_sample, published_at)
  values ('Capital Realty (agent)', 'A calm corner to call home', 'Corner 10 Marla house with Margalla views, a front lawn and a rooftop terrace. Four bedrooms, drawing and dining, and a separate TV lounge.', 'sale', 'House', 'Agent', 'Islamabad', 'Bahria Enclave', 10, 'Marla', 42500000, 4, 4, 'published', true, now() - interval '3 days') returning id into lid;
  insert into public.listing_media (listing_id, kind, external_url, file_name, sort_order) values
    (lid, 'photo', 'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?auto=format&fit=crop&w=1400&q=80', 'Sample photo', 0);

  insert into public.listings (advertiser_name, title, description, purpose, property_type, advertiser_role, city, area, size, size_unit, price, bedrooms, bathrooms, status, is_sample, published_at)
  values ('Usman K.', 'Furnished two-bed apartment', 'Fully furnished apartment close to Emporium Mall and the Expo Centre. Air-conditioned, fibre internet ready, lift and parking.', 'rent', 'Apartment', 'Owner', 'Lahore', 'Johar Town', 1100, 'sq ft', 85000, 2, 2, 'published', true, now() - interval '4 days') returning id into lid;
  insert into public.listing_media (listing_id, kind, external_url, file_name, sort_order) values
    (lid, 'photo', 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1400&q=80', 'Sample photo', 0);

  insert into public.listings (advertiser_name, title, description, purpose, property_type, advertiser_role, city, area, size, size_unit, price, bedrooms, bathrooms, status, is_sample, published_at)
  values ('Faisal T.', 'Residential plot in a developed block', 'Possession-ready 1 Kanal plot near the main boulevard. Utilities available in the block. Ideal for building a family home.', 'sale', 'Plot', 'Owner', 'Lahore', 'DHA Phase 9 Prism', 1, 'Kanal', 39000000, 0, 0, 'published', true, now() - interval '5 days') returning id into lid;
  insert into public.listing_media (listing_id, kind, external_url, file_name, sort_order) values
    (lid, 'photo', 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1400&q=80', 'Sample photo', 0);

  insert into public.listings (advertiser_name, title, description, purpose, property_type, advertiser_role, city, area, size, size_unit, price, bedrooms, bathrooms, status, is_sample, published_at)
  values ('Capital Realty (agent)', 'Open-plan office floor', 'Full office floor in a well-managed building on Jinnah Avenue. Central air-conditioning, generator back-up, pantry and basement parking.', 'rent', 'Commercial', 'Agent', 'Islamabad', 'Blue Area', 3200, 'sq ft', 650000, 0, 2, 'published', true, now() - interval '6 days') returning id into lid;
  insert into public.listing_media (listing_id, kind, external_url, file_name, sort_order) values
    (lid, 'photo', 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1400&q=80', 'Sample photo', 0);
end $$;

-- =====================================================================
-- 10. Make yourself an admin (run AFTER creating the staff user in
--     Supabase → Authentication → Users → Add user, with email + password):
--
--   update public.profiles set role = 'admin', full_name = 'RAQBO Admin'
--   where email = 'admin@yourdomain.com';
-- =====================================================================


-- Re-create profiles for login accounts that already exist (so they can sign in again).
insert into public.profiles (id, email, full_name)
select u.id, u.email, nullif(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'), '')
from auth.users u
on conflict (id) do nothing;


-- =====================================================================
-- 11. Property reviews & star ratings (real-time)
-- =====================================================================
-- 1. Reviews table: one review per user per property (they can edit it)
create table if not exists public.reviews (
  id             uuid primary key default gen_random_uuid(),
  listing_id     uuid not null references public.listings (id) on delete cascade,
  user_id        uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  rating         smallint not null check (rating between 1 and 5),
  comment        text not null check (char_length(btrim(comment)) between 3 and 1000),
  reviewer_name  text not null default '' check (char_length(reviewer_name) <= 120),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (listing_id, user_id)
);
create index if not exists reviews_listing_idx on public.reviews (listing_id, created_at desc);

-- 2. Server-side rules: name comes from the profile, no reviewing your own
--    listing, only published listings, spam limit 20 reviews per day.
create or replace function public.reviews_before_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare recent int; owner uuid; st text; nm text;
begin
  if tg_op = 'INSERT' then
    new.user_id := auth.uid();
    new.created_at := now();
    select owner_id, status into owner, st from public.listings where id = new.listing_id;
    if st is distinct from 'published' then raise exception 'You can only review published properties.'; end if;
    if owner is not null and owner = auth.uid() then raise exception 'You cannot review your own property.'; end if;
    if not public.is_admin() then
      select count(*) into recent from public.reviews where user_id = auth.uid() and created_at > now() - interval '1 day';
      if recent >= 20 then raise exception 'Too many reviews today. Please try again tomorrow.'; end if;
    end if;
  else
    -- owners may change only rating and comment
    new.id := old.id; new.listing_id := old.listing_id; new.user_id := old.user_id; new.created_at := old.created_at;
  end if;
  select coalesce(nullif(btrim(full_name), ''), 'RAQBO user') into nm from public.profiles where id = new.user_id;
  new.reviewer_name := coalesce(nm, 'RAQBO user');
  new.comment := btrim(new.comment);
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists reviews_before_write on public.reviews;
create trigger reviews_before_write before insert or update on public.reviews
  for each row execute function public.reviews_before_write();

-- 3. Security (Row Level Security)
alter table public.reviews enable row level security;

drop policy if exists "reviews: anyone reads published" on public.reviews;
create policy "reviews: anyone reads published" on public.reviews
  for select using (
    public.is_admin() or user_id = auth.uid()
    or exists (select 1 from public.listings l where l.id = listing_id and l.status = 'published')
  );

drop policy if exists "reviews: verified users write" on public.reviews;
create policy "reviews: verified users write" on public.reviews
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.verified or p.role = 'admin'))
  );

drop policy if exists "reviews: edit own" on public.reviews;
create policy "reviews: edit own" on public.reviews
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "reviews: delete own or admin" on public.reviews;
create policy "reviews: delete own or admin" on public.reviews
  for delete to authenticated using (user_id = auth.uid() or public.is_admin());

-- 4. Average rating per property (used on the property cards)
create or replace view public.listing_rating_summary
with (security_invoker = true) as
  select listing_id, round(avg(rating)::numeric, 1) as avg_rating, count(*)::int as review_count
  from public.reviews group by listing_id;
grant select on public.listing_rating_summary to anon, authenticated;

-- 5. Real-time: send new / edited / deleted reviews to open property pages
alter table public.reviews replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reviews') then
    execute 'alter publication supabase_realtime add table public.reviews';
  end if;
end $$;


-- =====================================================================
-- 12. Sell With Us & Order Online (vendors, buyers, escrow orders)
-- =====================================================================
-- ---------- 1. Vendors (public shop profile) ----------
create table if not exists public.vendors (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid unique references public.profiles (id) on delete cascade,  -- null = RAQBO sample shop (managed by admin)
  shop_name       text not null check (char_length(btrim(shop_name)) between 2 and 120),
  owner_name      text not null check (char_length(btrim(owner_name)) between 2 and 120),
  phone           text not null check (phone ~ '^\+923[0-9]{9}$'),
  whatsapp        text check (whatsapp is null or whatsapp ~ '^\+923[0-9]{9}$'),
  city            text not null check (char_length(city) between 2 and 60),
  area            text not null default '' check (char_length(area) <= 160),
  materials       text[] not null default '{}' check (cardinality(materials) between 1 and 20),
  radius_km       int not null default 25 check (radius_km between 1 and 2000),
  delivery_fee    int not null default 0 check (delivery_fee between 0 and 1000000),
  delivery_note   text not null default '' check (char_length(delivery_note) <= 200),
  bulk_discount   numeric(4,1) not null default 0 check (bulk_discount between 0 and 30),  -- % for Registered Commercial Buyers
  about           text not null default '' check (char_length(about) <= 600),
  status          text not null default 'pending' check (status in ('pending','approved','rejected','suspended')),
  verified        boolean not null default false,
  escrow_enabled  boolean not null default false,
  admin_note      text not null default '' check (char_length(admin_note) <= 300),
  is_sample       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists vendors_status_idx on public.vendors (status, city);

-- Private vendor details: only the vendor and admins can read
create table if not exists public.vendor_private (
  vendor_id          uuid primary key references public.vendors (id) on delete cascade,
  registration_no    text not null default '' check (char_length(registration_no) <= 40),   -- NTN or CNIC for verification
  warehouse_address  text not null default '' check (char_length(warehouse_address) <= 300),
  payout_method      text not null default '' check (payout_method in ('', 'bank', 'jazzcash', 'easypaisa', 'sadapay', 'nayapay')),
  payout_title       text not null default '' check (char_length(payout_title) <= 120),
  payout_account     text not null default '' check (char_length(payout_account) <= 40),
  updated_at         timestamptz not null default now()
);

-- ---------- 2. Products / catalog ----------
create table if not exists public.vendor_products (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid not null references public.vendors (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 2 and 120),
  code        text not null default '' check (char_length(code) <= 40),
  category    text not null check (char_length(category) between 2 and 40),
  unit        text not null default 'unit' check (char_length(unit) between 1 and 20),
  price       numeric(12,0) check (price is null or price between 1 and 1000000000),     -- null = price on request
  prev_price  numeric(12,0),
  min_qty     int not null default 1 check (min_qty between 1 and 1000000),
  stock       text not null default 'in_stock' check (stock in ('in_stock','low','out')),
  active      boolean not null default true,
  price_updated_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index if not exists vendor_products_vendor_idx on public.vendor_products (vendor_id);

-- ---------- 3. Buyer profiles ----------
create table if not exists public.buyer_profiles (
  user_id        uuid primary key references public.profiles (id) on delete cascade,
  display_name   text not null check (char_length(btrim(display_name)) between 2 and 120),
  company_name   text not null default '' check (char_length(company_name) <= 120),
  buyer_type     text not null default 'homeowner' check (buyer_type in ('homeowner','contractor','commercial','dealer')),
  addresses      jsonb not null default '[]'::jsonb check (jsonb_typeof(addresses) = 'array' and jsonb_array_length(addresses) <= 10),
  registered_commercial boolean not null default false,   -- set by admin: unlocks vendor bulk discounts
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------- 4. Orders + timeline ----------
create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  ref             text not null unique default ('RQ-ORD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  buyer_id        uuid not null references public.profiles (id) on delete cascade,
  vendor_id       uuid not null references public.vendors (id) on delete restrict,
  mode            text not null check (mode in ('order','quote')),
  status          text not null check (status in ('quote_requested','quoted','awaiting_payment','payment_review','paid_escrow','dispatched','delivered','completed','released','disputed','refunded','cancelled')),
  items           jsonb not null,           -- [{product_id, name, code, unit, qty, price}]
  subtotal        numeric(14,0),
  delivery_fee    numeric(12,0) not null default 0,
  discount        numeric(12,0) not null default 0,
  total           numeric(14,0),
  buyer_name      text not null default '',
  buyer_phone     text not null default '',
  delivery_address text not null check (char_length(btrim(delivery_address)) between 5 and 300),
  delivery_city   text not null check (char_length(delivery_city) between 2 and 60),
  buyer_note      text not null default '' check (char_length(buyer_note) <= 600),
  vendor_note     text not null default '' check (char_length(vendor_note) <= 600),
  payment_method  text not null default '' check (payment_method in ('', 'bank', 'jazzcash', 'easypaisa', 'sadapay', 'nayapay')),
  payment_ref     text not null default '' check (char_length(payment_ref) <= 80),
  dispatch_info   jsonb not null default '{}'::jsonb,
  dispute_reason  text not null default '' check (char_length(dispute_reason) <= 600),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists orders_buyer_idx on public.orders (buyer_id, created_at desc);
create index if not exists orders_vendor_idx on public.orders (vendor_id, created_at desc);

create table if not exists public.order_events (
  id         bigint generated always as identity primary key,
  order_id   uuid not null references public.orders (id) on delete cascade,
  status     text not null,
  actor      text not null check (actor in ('buyer','vendor','admin','system')),
  note       text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists order_events_order_idx on public.order_events (order_id, id);

-- ---------- 5. Vendor reviews (only from completed orders) ----------
create table if not exists public.vendor_reviews (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid not null references public.vendors (id) on delete cascade,
  order_id    uuid not null unique references public.orders (id) on delete cascade,
  buyer_id    uuid not null references public.profiles (id) on delete cascade,
  buyer_name  text not null default '',
  rating      smallint not null check (rating between 1 and 5),
  comment     text not null check (char_length(btrim(comment)) between 3 and 1000),
  created_at  timestamptz not null default now()
);
create index if not exists vendor_reviews_vendor_idx on public.vendor_reviews (vendor_id, created_at desc);

-- ---------- 6. Helpers ----------
create or replace function public.my_vendor_id()
returns uuid language sql stable security definer set search_path = public
as $$ select id from public.vendors where owner_id = auth.uid() $$;

create or replace function public.is_verified_user()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and (verified or role = 'admin')) $$;

-- Vendors: owners cannot change admin-controlled fields; edits keep approval unless shop was rejected
create or replace function public.vendors_before_write()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  new.updated_at := now();
  if public.is_admin() or auth.uid() is null then return new; end if;   -- admins and the SQL editor manage everything
  if tg_op = 'INSERT' then
    new.owner_id := auth.uid(); new.status := 'pending'; new.verified := false; new.escrow_enabled := false; new.admin_note := ''; new.is_sample := false;
  else
    new.id := old.id; new.owner_id := old.owner_id; new.verified := old.verified; new.escrow_enabled := old.escrow_enabled;
    new.admin_note := old.admin_note; new.is_sample := old.is_sample; new.created_at := old.created_at;
    new.status := case when old.status = 'rejected' then 'pending' else old.status end;
  end if;
  return new;
end $$;
drop trigger if exists vendors_before_write on public.vendors;
create trigger vendors_before_write before insert or update on public.vendors for each row execute function public.vendors_before_write();

create or replace function public.vendor_products_before_write()
returns trigger language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    new.id := old.id; new.vendor_id := old.vendor_id; new.created_at := old.created_at;
    if new.price is distinct from old.price then new.prev_price := old.price; new.price_updated_at := now();
    else new.prev_price := old.prev_price; new.price_updated_at := old.price_updated_at; end if;
  else
    new.prev_price := null; new.price_updated_at := now();
  end if;
  return new;
end $$;
drop trigger if exists vendor_products_before_write on public.vendor_products;
create trigger vendor_products_before_write before insert or update on public.vendor_products for each row execute function public.vendor_products_before_write();

create or replace function public.buyer_profiles_before_write()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  new.updated_at := now();
  if not public.is_admin() and auth.uid() is not null then
    if tg_op = 'INSERT' then new.user_id := auth.uid(); new.registered_commercial := false;
    else new.user_id := old.user_id; new.registered_commercial := old.registered_commercial; new.created_at := old.created_at; end if;
  end if;
  return new;
end $$;
drop trigger if exists buyer_profiles_before_write on public.buyer_profiles;
create trigger buyer_profiles_before_write before insert or update on public.buyer_profiles for each row execute function public.buyer_profiles_before_write();

-- ---------- 7. Place an order / request a quote (prices are taken from the catalog, never from the browser) ----------
create or replace function public.place_order(p_vendor_id uuid, p_items jsonb, p_mode text, p_address text, p_city text, p_note text default '', p_payment_method text default '')
returns uuid language plpgsql security definer set search_path = public
as $$
declare v public.vendors; b public.buyer_profiles; pr public.profiles; it jsonb; p public.vendor_products;
        qty int; lines jsonb := '[]'::jsonb; sub numeric := 0; has_unpriced boolean := false; disc numeric := 0;
        st text; oid uuid; recent int;
begin
  if auth.uid() is null or not public.is_verified_user() then raise exception 'Please sign in and complete your account first.'; end if;
  select * into pr from public.profiles where id = auth.uid();
  select * into b from public.buyer_profiles where user_id = auth.uid();
  if b.user_id is null then raise exception 'Please complete your buyer profile first.'; end if;
  select * into v from public.vendors where id = p_vendor_id;
  if v.id is null or v.status <> 'approved' then raise exception 'This vendor is not accepting orders right now.'; end if;
  if v.owner_id = auth.uid() then raise exception 'You cannot order from your own shop.'; end if;
  if p_mode not in ('order','quote') then raise exception 'Invalid order type.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 50 then raise exception 'Add at least one item.'; end if;
  select count(*) into recent from public.orders where buyer_id = auth.uid() and created_at > now() - interval '1 hour';
  if recent >= 15 and not public.is_admin() then raise exception 'Too many orders in a short time. Please try again later.'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into p from public.vendor_products where id = (it->>'product_id')::uuid and vendor_id = v.id and active;
    if p.id is null then raise exception 'An item is no longer available.'; end if;
    if p.stock = 'out' then raise exception '% is out of stock.', p.name; end if;
    qty := greatest(coalesce((it->>'qty')::int, 0), 0);
    if qty < p.min_qty then raise exception 'Minimum order for % is % %.', p.name, p.min_qty, p.unit; end if;
    if p.price is null then has_unpriced := true; else sub := sub + p.price * qty; end if;
    lines := lines || jsonb_build_object('product_id', p.id, 'name', p.name, 'code', p.code, 'unit', p.unit, 'qty', qty, 'price', p.price);
  end loop;
  if p_mode = 'order' and (has_unpriced or not v.escrow_enabled) then p_mode := 'quote'; end if;
  if b.registered_commercial and v.bulk_discount > 0 then disc := round(sub * v.bulk_discount / 100); end if;
  st := case when p_mode = 'order' then 'awaiting_payment' else 'quote_requested' end;
  insert into public.orders (buyer_id, vendor_id, mode, status, items, subtotal, delivery_fee, discount, total, buyer_name, buyer_phone,
                             delivery_address, delivery_city, buyer_note, payment_method)
  values (auth.uid(), v.id, p_mode, st, lines,
          case when has_unpriced then null else sub end, v.delivery_fee, disc,
          case when has_unpriced then null else sub + v.delivery_fee - disc end,
          coalesce(nullif(btrim(b.company_name), ''), b.display_name), coalesce(pr.phone, ''),
          btrim(p_address), p_city, btrim(coalesce(p_note, '')),
          case when p_payment_method in ('bank','jazzcash','easypaisa','sadapay','nayapay') then p_payment_method else '' end)
  returning id into oid;
  insert into public.order_events (order_id, status, actor, note)
  values (oid, st, 'buyer', case when st = 'quote_requested' then 'Quote requested' else 'Order placed — waiting for escrow payment' end);
  return oid;
end $$;

-- ---------- 8. Order actions (the escrow workflow) ----------
create or replace function public.order_action(p_order_id uuid, p_action text, p_payload jsonb default '{}'::jsonb)
returns text language plpgsql security definer set search_path = public
as $$
declare o public.orders; v public.vendors; is_buyer boolean; is_vendor boolean; adm boolean;
        nxt text; actor text; note text := ''; it jsonb; lines jsonb := '[]'::jsonb; sub numeric := 0; pr numeric; b public.buyer_profiles; disc numeric := 0;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  select * into v from public.vendors where id = o.vendor_id;
  adm := public.is_admin(); is_buyer := o.buyer_id = auth.uid(); is_vendor := v.owner_id = auth.uid() or (v.owner_id is null and adm);
  p_payload := coalesce(p_payload, '{}'::jsonb);

  if p_action = 'send_quote' and is_vendor and o.status = 'quote_requested' then
    for it in select * from jsonb_array_elements(o.items) loop
      pr := coalesce((select (x->>'price')::numeric from jsonb_array_elements(p_payload->'prices') x where x->>'product_id' = it->>'product_id' limit 1), (it->>'price')::numeric);
      if pr is null or pr <= 0 then raise exception 'Enter a price for every item.'; end if;
      sub := sub + pr * (it->>'qty')::int; lines := lines || (it || jsonb_build_object('price', pr));
    end loop;
    select * into b from public.buyer_profiles where user_id = o.buyer_id;
    if coalesce(b.registered_commercial, false) and v.bulk_discount > 0 then disc := round(sub * v.bulk_discount / 100); end if;
    update public.orders set items = lines, subtotal = sub, discount = disc,
      delivery_fee = coalesce((p_payload->>'delivery_fee')::numeric, o.delivery_fee),
      total = sub + coalesce((p_payload->>'delivery_fee')::numeric, o.delivery_fee) - disc,
      vendor_note = left(coalesce(p_payload->>'note', ''), 600) where id = o.id;
    nxt := 'quoted'; actor := 'vendor'; note := 'Quote sent' || coalesce(': ' || nullif(p_payload->>'note', ''), '');
  elsif p_action = 'decline' and is_vendor and o.status in ('quote_requested','awaiting_payment') then
    nxt := 'cancelled'; actor := 'vendor'; note := 'Declined by vendor' || coalesce(': ' || nullif(p_payload->>'note', ''), '');
  elsif p_action = 'accept_quote' and is_buyer and o.status = 'quoted' then
    if not v.escrow_enabled then raise exception 'This vendor does not accept escrow payments yet — contact them on WhatsApp or call.'; end if;
    nxt := 'awaiting_payment'; actor := 'buyer'; note := 'Quote accepted — waiting for escrow payment';
  elsif p_action = 'submit_payment' and is_buyer and o.status = 'awaiting_payment' then
    if coalesce(p_payload->>'method', '') not in ('bank','jazzcash','easypaisa','sadapay','nayapay') then raise exception 'Choose how you paid.'; end if;
    if char_length(btrim(coalesce(p_payload->>'reference', ''))) < 4 then raise exception 'Enter the transaction ID / reference of your payment.'; end if;
    update public.orders set payment_method = p_payload->>'method', payment_ref = left(btrim(p_payload->>'reference'), 80) where id = o.id;
    nxt := 'payment_review'; actor := 'buyer'; note := 'Payment submitted (' || (p_payload->>'method') || ') — RAQBO is verifying it';
  elsif p_action = 'payment_received' and adm and o.status = 'payment_review' then
    nxt := 'paid_escrow'; actor := 'admin'; note := 'Payment received and held in RAQBO escrow — vendor can dispatch';
  elsif p_action = 'payment_rejected' and adm and o.status = 'payment_review' then
    nxt := 'awaiting_payment'; actor := 'admin'; note := 'Payment could not be verified' || coalesce(': ' || nullif(p_payload->>'note', ''), '');
  elsif p_action = 'dispatch' and is_vendor and o.status = 'paid_escrow' then
    update public.orders set dispatch_info = jsonb_build_object('vehicle', left(coalesce(p_payload->>'vehicle', ''), 40), 'driver', left(coalesce(p_payload->>'driver', ''), 80),
      'phone', left(coalesce(p_payload->>'phone', ''), 20), 'eta', left(coalesce(p_payload->>'eta', ''), 60)) where id = o.id;
    nxt := 'dispatched'; actor := 'vendor'; note := 'Dispatched' || coalesce(' · vehicle ' || nullif(p_payload->>'vehicle', ''), '') || coalesce(' · ETA ' || nullif(p_payload->>'eta', ''), '');
  elsif p_action = 'delivered' and is_vendor and o.status = 'dispatched' then
    nxt := 'delivered'; actor := 'vendor'; note := 'Marked as delivered by vendor — buyer to inspect and confirm';
  elsif p_action = 'confirm_delivery' and is_buyer and o.status in ('dispatched','delivered') then
    nxt := 'completed'; actor := 'buyer'; note := 'Buyer confirmed delivery — payout will be released to the vendor';
  elsif p_action = 'dispute' and is_buyer and o.status in ('paid_escrow','dispatched','delivered') then
    if char_length(btrim(coalesce(p_payload->>'reason', ''))) < 5 then raise exception 'Describe the problem (at least 5 characters).'; end if;
    update public.orders set dispute_reason = left(btrim(p_payload->>'reason'), 600) where id = o.id;
    nxt := 'disputed'; actor := 'buyer'; note := 'Dispute opened: ' || left(btrim(p_payload->>'reason'), 200);
  elsif p_action = 'cancel' and is_buyer and o.status in ('quote_requested','quoted','awaiting_payment') then
    nxt := 'cancelled'; actor := 'buyer'; note := 'Cancelled by buyer';
  elsif p_action = 'release_payout' and adm and o.status = 'completed' then
    nxt := 'released'; actor := 'admin'; note := 'Payout released to vendor' || coalesce(': ' || nullif(p_payload->>'note', ''), '');
  elsif p_action = 'resolve_release' and adm and o.status = 'disputed' then
    nxt := 'released'; actor := 'admin'; note := 'Dispute resolved — payout released to vendor' || coalesce(': ' || nullif(p_payload->>'note', ''), '');
  elsif p_action = 'resolve_refund' and adm and o.status = 'disputed' then
    nxt := 'refunded'; actor := 'admin'; note := 'Dispute resolved — buyer refunded' || coalesce(': ' || nullif(p_payload->>'note', ''), '');
  else
    raise exception 'This action is not allowed for this order right now.';
  end if;

  update public.orders set status = nxt, updated_at = now() where id = o.id;
  insert into public.order_events (order_id, status, actor, note) values (o.id, nxt, actor, note);
  return nxt;
end $$;

-- Vendor reviews: only the buyer of a completed / released order, once per order
create or replace function public.vendor_reviews_before_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
declare o public.orders; nm text;
begin
  select * into o from public.orders where id = new.order_id;
  if o.id is null or o.buyer_id <> auth.uid() or o.status not in ('completed','released') then
    raise exception 'Only buyers who completed an order through RAQBO can review this vendor.';
  end if;
  select coalesce(nullif(btrim(full_name), ''), 'RAQBO buyer') into nm from public.profiles where id = auth.uid();
  new.vendor_id := o.vendor_id; new.buyer_id := auth.uid(); new.buyer_name := nm; new.created_at := now(); new.comment := btrim(new.comment);
  return new;
end $$;
drop trigger if exists vendor_reviews_before_insert on public.vendor_reviews;
create trigger vendor_reviews_before_insert before insert on public.vendor_reviews for each row execute function public.vendor_reviews_before_insert();

-- Vendor rating summary
create or replace view public.vendor_rating_summary with (security_invoker = true) as
  select vendor_id, round(avg(rating)::numeric, 1) as avg_rating, count(*)::int as review_count
  from public.vendor_reviews group by vendor_id;
grant select on public.vendor_rating_summary to anon, authenticated;

-- ---------- 9. Row Level Security ----------
alter table public.vendors enable row level security;
alter table public.vendor_private enable row level security;
alter table public.vendor_products enable row level security;
alter table public.buyer_profiles enable row level security;
alter table public.orders enable row level security;
alter table public.order_events enable row level security;
alter table public.vendor_reviews enable row level security;

drop policy if exists "vendors: public reads approved" on public.vendors;
create policy "vendors: public reads approved" on public.vendors for select
  using (status = 'approved' or owner_id = auth.uid() or public.is_admin()
         or exists (select 1 from public.orders o where o.vendor_id = vendors.id and o.buyer_id = auth.uid()));
drop policy if exists "vendors: verified users create own" on public.vendors;
create policy "vendors: verified users create own" on public.vendors for insert to authenticated
  with check ((owner_id = auth.uid() and public.is_verified_user()) or public.is_admin());
drop policy if exists "vendors: owner or admin updates" on public.vendors;
create policy "vendors: owner or admin updates" on public.vendors for update to authenticated
  using (owner_id = auth.uid() or public.is_admin()) with check (owner_id = auth.uid() or public.is_admin());
drop policy if exists "vendors: admin deletes" on public.vendors;
create policy "vendors: admin deletes" on public.vendors for delete to authenticated using (public.is_admin());

drop policy if exists "vendor_private: owner or admin" on public.vendor_private;
create policy "vendor_private: owner or admin" on public.vendor_private for all to authenticated
  using (vendor_id = public.my_vendor_id() or public.is_admin()) with check (vendor_id = public.my_vendor_id() or public.is_admin());

drop policy if exists "products: public reads approved shops" on public.vendor_products;
create policy "products: public reads approved shops" on public.vendor_products for select
  using (exists (select 1 from public.vendors v where v.id = vendor_id and (v.status = 'approved' or v.owner_id = auth.uid())) or public.is_admin());
drop policy if exists "products: owner or admin writes" on public.vendor_products;
create policy "products: owner or admin writes" on public.vendor_products for all to authenticated
  using (vendor_id = public.my_vendor_id() or public.is_admin()) with check (vendor_id = public.my_vendor_id() or public.is_admin());

drop policy if exists "buyers: own or admin" on public.buyer_profiles;
create policy "buyers: own or admin" on public.buyer_profiles for select to authenticated
  using (user_id = auth.uid() or public.is_admin()
         or exists (select 1 from public.orders o join public.vendors v on v.id = o.vendor_id where o.buyer_id = buyer_profiles.user_id and v.owner_id = auth.uid()));
drop policy if exists "buyers: create own" on public.buyer_profiles;
create policy "buyers: create own" on public.buyer_profiles for insert to authenticated with check (user_id = auth.uid() and public.is_verified_user());
drop policy if exists "buyers: update own or admin" on public.buyer_profiles;
create policy "buyers: update own or admin" on public.buyer_profiles for update to authenticated
  using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());

-- Orders: read-only from the browser; all changes go through place_order / order_action
drop policy if exists "orders: parties read" on public.orders;
create policy "orders: parties read" on public.orders for select to authenticated
  using (buyer_id = auth.uid() or vendor_id = public.my_vendor_id() or public.is_admin());
drop policy if exists "order_events: parties read" on public.order_events;
create policy "order_events: parties read" on public.order_events for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and (o.buyer_id = auth.uid() or o.vendor_id = public.my_vendor_id() or public.is_admin())));

drop policy if exists "vendor_reviews: public read" on public.vendor_reviews;
create policy "vendor_reviews: public read" on public.vendor_reviews for select using (true);
drop policy if exists "vendor_reviews: buyers of completed orders" on public.vendor_reviews;
create policy "vendor_reviews: buyers of completed orders" on public.vendor_reviews for insert to authenticated with check (buyer_id = auth.uid());
drop policy if exists "vendor_reviews: admin deletes" on public.vendor_reviews;
create policy "vendor_reviews: admin deletes" on public.vendor_reviews for delete to authenticated using (public.is_admin());

revoke execute on function public.place_order(uuid, jsonb, text, text, text, text, text) from anon;
revoke execute on function public.order_action(uuid, text, jsonb) from anon;
grant execute on function public.place_order(uuid, jsonb, text, text, text, text, text) to authenticated;
grant execute on function public.order_action(uuid, text, jsonb) to authenticated;

-- ---------- 10. Real-time: live rates and order tracking ----------
alter table public.vendor_products replica identity full;
alter table public.orders replica identity full;
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['vendor_products','orders','order_events','vendors'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------- 11. Sample shops (clearly marked as samples; admin can delete them) ----------
do $$
declare v1 uuid; v2 uuid; v3 uuid; v4 uuid; v5 uuid; v6 uuid;
begin
  if not exists (select 1 from public.vendors where is_sample) then
    insert into public.vendors (shop_name, owner_name, phone, whatsapp, city, area, materials, radius_km, delivery_fee, delivery_note, bulk_discount, about, status, verified, escrow_enabled, is_sample)
    values ('Al-Noor Building Materials', 'Muhammad Imran', '+923001234501', '+923001234501', 'Lahore', 'Raiwind Road', '{Cement,Bricks,"Sand & Crush"}', 25, 3000, 'Same-day delivery across Lahore', 3, 'Wholesale cement, first-class bricks and crush. Same-day delivery across Lahore.', 'approved', true, true, true)
    returning id into v1;
    insert into public.vendors (shop_name, owner_name, phone, whatsapp, city, area, materials, radius_km, delivery_fee, delivery_note, bulk_discount, about, status, verified, escrow_enabled, is_sample)
    values ('Pak Steel Traders', 'Asif Mehmood', '+923211234502', '+923211234502', 'Karachi', 'SITE Area', '{Steel}', 60, 8000, 'Truck delivery within Karachi', 5, 'Grade 60 steel bars, girders and binding wire. Bulk rates for registered buyers and contractors.', 'approved', true, false, true)
    returning id into v2;
    insert into public.vendors (shop_name, owner_name, phone, whatsapp, city, area, materials, radius_km, delivery_fee, delivery_note, bulk_discount, about, status, verified, escrow_enabled, is_sample)
    values ('Royal Tiles & Sanitary', 'Bilal Ahmed', '+923331234503', '+923331234503', 'Islamabad', 'I-9 Markaz', '{Tiles,Plumbing}', 40, 2500, 'Delivery in Islamabad & Rawalpindi', 0, 'Porcelain and ceramic tiles, bathroom fittings and sanitary ware.', 'approved', true, true, true)
    returning id into v3;
    insert into public.vendor_products (vendor_id, name, code, category, unit, price, min_qty, stock) values
      (v1, 'OPC Cement 50 kg', 'CEM-OPC50', 'Cement', 'bag', 1450, 50, 'in_stock'),
      (v1, 'First-class bricks', 'BRK-A1', 'Bricks', '1000 bricks', 17500, 1, 'in_stock'),
      (v1, 'Ravi sand', 'SND-RAVI', 'Sand & Crush', 'truck', 18000, 1, 'low'),
      (v1, 'Margalla crush', 'CRS-MRG', 'Sand & Crush', 'truck', null, 1, 'in_stock'),
      (v2, 'Steel bar Grade 60 (12 mm)', 'STL-G60-12', 'Steel', 'ton', 268000, 1, 'in_stock'),
      (v2, 'Binding wire', 'STL-BW', 'Steel', 'kg', null, 50, 'in_stock'),
      (v3, 'Porcelain floor tile 60×60', 'TIL-P6060', 'Tiles', 'box', 3200, 10, 'in_stock'),
      (v3, 'Wall-hung commode set', 'PLB-WHC', 'Plumbing', 'set', 38500, 1, 'low');
    insert into public.vendors (shop_name, owner_name, phone, whatsapp, city, area, materials, radius_km, delivery_fee, delivery_note, bulk_discount, about, status, verified, escrow_enabled, is_sample)
    values ('Colour House Paints', 'Usman Tariq', '+923451234504', '+923451234504', 'Rawalpindi', 'Saddar', '{Paint}', 20, 1000, 'Free delivery above PKR 50,000', 4, 'Interior and exterior paints, primers and weather coats from leading brands.', 'approved', false, true, true)
    returning id into v4;
    insert into public.vendors (shop_name, owner_name, phone, whatsapp, city, area, materials, radius_km, delivery_fee, delivery_note, bulk_discount, about, status, verified, escrow_enabled, is_sample)
    values ('Bright Electric Store', 'Kamran Ali', '+923121234505', '+923121234505', 'Faisalabad', 'D Ground', '{Electrical}', 15, 800, 'Pickup or local delivery', 0, 'Wiring, switches, DB boxes and LED lighting for homes and commercial projects.', 'approved', false, false, true)
    returning id into v5;
    insert into public.vendors (shop_name, owner_name, phone, whatsapp, city, area, materials, radius_km, delivery_fee, delivery_note, bulk_discount, about, status, verified, escrow_enabled, is_sample)
    values ('Chenab Timber & Glass', 'Haroon Rashid', '+923061234506', '+923061234506', 'Multan', 'Vehari Road', '{Wood,Glass}', 35, 2000, 'Delivery and fitting available', 0, 'Doors, frames, kitchen wood work and tempered glass cut to size.', 'approved', true, false, true)
    returning id into v6;
    insert into public.vendor_products (vendor_id, name, code, category, unit, price, min_qty, stock) values
      (v4, 'Weather coat 16 L', 'PNT-WC16', 'Paint', 'drum', 21500, 1, 'in_stock'),
      (v4, 'Wall primer 16 L', 'PNT-PR16', 'Paint', 'drum', 9800, 1, 'in_stock'),
      (v5, 'Copper wire 7/29 (90 m)', 'ELC-CW729', 'Electrical', 'coil', null, 1, 'in_stock'),
      (v6, 'Deodar door frame', 'WD-DFR', 'Wood', 'piece', 14500, 1, 'in_stock'),
      (v6, 'Tempered glass 10 mm', 'GLS-T10', 'Glass', 'sq ft', 650, 20, 'in_stock');
  end if;
end $$;

-- ---------- 13. Payment screenshots (escrow proof) ----------
alter table public.orders add column if not exists payment_proof text not null default '' check (char_length(payment_proof) <= 300);

-- Private storage bucket for payment screenshots (5 MB, images only)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Buyers upload only into their own folder:  <user id>/<order id>/<file>
drop policy if exists "payment-proofs: upload own folder" on storage.objects;
create policy "payment-proofs: upload own folder" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text
  );
-- Only the buyer who uploaded it and RAQBO admins can view a screenshot
drop policy if exists "payment-proofs: owner or admin reads" on storage.objects;
create policy "payment-proofs: owner or admin reads" on storage.objects
  for select using (
    bucket_id = 'payment-proofs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );
drop policy if exists "payment-proofs: owner or admin deletes" on storage.objects;
create policy "payment-proofs: owner or admin deletes" on storage.objects
  for delete using (
    bucket_id = 'payment-proofs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- Order workflow: payment now needs a screenshot (transaction ID optional)
create or replace function public.order_action(p_order_id uuid, p_action text, p_payload jsonb default '{}'::jsonb)
returns text language plpgsql security definer set search_path = public
as $$
declare o public.orders; v public.vendors; is_buyer boolean; is_vendor boolean; adm boolean;
        nxt text; actor text; note text := ''; it jsonb; lines jsonb := '[]'::jsonb; sub numeric := 0; pr numeric; b public.buyer_profiles; disc numeric := 0;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  select * into v from public.vendors where id = o.vendor_id;
  adm := public.is_admin(); is_buyer := o.buyer_id = auth.uid(); is_vendor := v.owner_id = auth.uid() or (v.owner_id is null and adm);
  p_payload := coalesce(p_payload, '{}'::jsonb);

  if p_action = 'send_quote' and is_vendor and o.status = 'quote_requested' then
    for it in select * from jsonb_array_elements(o.items) loop
      pr := coalesce((select (x->>'price')::numeric from jsonb_array_elements(p_payload->'prices') x where x->>'product_id' = it->>'product_id' limit 1), (it->>'price')::numeric);
      if pr is null or pr <= 0 then raise exception 'Enter a price for every item.'; end if;
      sub := sub + pr * (it->>'qty')::int; lines := lines || (it || jsonb_build_object('price', pr));
    end loop;
    select * into b from public.buyer_profiles where user_id = o.buyer_id;
    if coalesce(b.registered_commercial, false) and v.bulk_discount > 0 then disc := round(sub * v.bulk_discount / 100); end if;
    update public.orders set items = lines, subtotal = sub, discount = disc,
      delivery_fee = coalesce((p_payload->>'delivery_fee')::numeric, o.delivery_fee),
      total = sub + coalesce((p_payload->>'delivery_fee')::numeric, o.delivery_fee) - disc,
      vendor_note = left(coalesce(p_payload->>'note', ''), 600) where id = o.id;
    nxt := 'quoted'; actor := 'vendor'; note := 'Quote sent' || coalesce(': ' || nullif(p_payload->>'note', ''), '');
  elsif p_action = 'decline' and is_vendor and o.status in ('quote_requested','awaiting_payment') then
    nxt := 'cancelled'; actor := 'vendor'; note := 'Declined by vendor' || coalesce(': ' || nullif(p_payload->>'note', ''), '');
  elsif p_action = 'accept_quote' and is_buyer and o.status = 'quoted' then
    if not v.escrow_enabled then raise exception 'This vendor does not accept escrow payments yet — contact them on WhatsApp or call.'; end if;
    nxt := 'awaiting_payment'; actor := 'buyer'; note := 'Quote accepted — waiting for escrow payment';
  elsif p_action = 'submit_payment' and is_buyer and o.status = 'awaiting_payment' then
    if coalesce(p_payload->>'method', '') not in ('bank','jazzcash','easypaisa','sadapay','nayapay') then raise exception 'Choose how you paid.'; end if;
    if char_length(coalesce(p_payload->>'proof', '')) < 5 or split_part(p_payload->>'proof', '/', 1) <> auth.uid()::text then raise exception 'Upload a screenshot of your payment.'; end if;
    update public.orders set payment_method = p_payload->>'method', payment_ref = left(btrim(coalesce(p_payload->>'reference', '')), 80),
      payment_proof = left(p_payload->>'proof', 300) where id = o.id;
    nxt := 'payment_review'; actor := 'buyer'; note := 'Payment submitted with screenshot (' || (p_payload->>'method') || coalesce(', ref ' || nullif(btrim(p_payload->>'reference'), ''), '') || ') — RAQBO is verifying it';
  elsif p_action = 'payment_received' and adm and o.status = 'payment_review' then
    nxt := 'paid_escrow'; actor := 'admin'; note := 'Payment received and held in RAQBO escrow — vendor can dispatch';
  elsif p_action = 'payment_rejected' and adm and o.status = 'payment_review' then
    nxt := 'awaiting_payment'; actor := 'admin'; note := 'Payment could not be verified' || coalesce(': ' || nullif(p_payload->>'note', ''), '');
  elsif p_action = 'dispatch' and is_vendor and o.status = 'paid_escrow' then
    update public.orders set dispatch_info = jsonb_build_object('vehicle', left(coalesce(p_payload->>'vehicle', ''), 40), 'driver', left(coalesce(p_payload->>'driver', ''), 80),
      'phone', left(coalesce(p_payload->>'phone', ''), 20), 'eta', left(coalesce(p_payload->>'eta', ''), 60)) where id = o.id;
    nxt := 'dispatched'; actor := 'vendor'; note := 'Dispatched' || coalesce(' · vehicle ' || nullif(p_payload->>'vehicle', ''), '') || coalesce(' · ETA ' || nullif(p_payload->>'eta', ''), '');
  elsif p_action = 'delivered' and is_vendor and o.status = 'dispatched' then
    nxt := 'delivered'; actor := 'vendor'; note := 'Marked as delivered by vendor — buyer to inspect and confirm';
  elsif p_action = 'confirm_delivery' and is_buyer and o.status in ('dispatched','delivered') then
    nxt := 'completed'; actor := 'buyer'; note := 'Buyer confirmed delivery — payout will be released to the vendor';
  elsif p_action = 'dispute' and is_buyer and o.status in ('paid_escrow','dispatched','delivered') then
    if char_length(btrim(coalesce(p_payload->>'reason', ''))) < 5 then raise exception 'Describe the problem (at least 5 characters).'; end if;
    update public.orders set dispute_reason = left(btrim(p_payload->>'reason'), 600) where id = o.id;
    nxt := 'disputed'; actor := 'buyer'; note := 'Dispute opened: ' || left(btrim(p_payload->>'reason'), 200);
  elsif p_action = 'cancel' and is_buyer and o.status in ('quote_requested','quoted','awaiting_payment') then
    nxt := 'cancelled'; actor := 'buyer'; note := 'Cancelled by buyer';
  elsif p_action = 'release_payout' and adm and o.status = 'completed' then
    nxt := 'released'; actor := 'admin'; note := 'Payout released to vendor' || coalesce(': ' || nullif(p_payload->>'note', ''), '');
  elsif p_action = 'resolve_release' and adm and o.status = 'disputed' then
    nxt := 'released'; actor := 'admin'; note := 'Dispute resolved — payout released to vendor' || coalesce(': ' || nullif(p_payload->>'note', ''), '');
  elsif p_action = 'resolve_refund' and adm and o.status = 'disputed' then
    nxt := 'refunded'; actor := 'admin'; note := 'Dispute resolved — buyer refunded' || coalesce(': ' || nullif(p_payload->>'note', ''), '');
  else
    raise exception 'This action is not allowed for this order right now.';
  end if;

  update public.orders set status = nxt, updated_at = now() where id = o.id;
  insert into public.order_events (order_id, status, actor, note) values (o.id, nxt, actor, note);
  return nxt;
end $$;

