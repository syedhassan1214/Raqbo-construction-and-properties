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


-- ---------- 14. Order status emails (buyer, vendor, RAQBO admin) ----------
-- Every order status change queues one email per person in public.email_outbox.
-- A Supabase Database Webhook on email_outbox INSERT sends each row to n8n, which emails it with Gmail.
-- Safe to run more than once.

-- Settings used in the emails (change them here or in Table Editor → raqbo_settings)
create table if not exists public.raqbo_settings (
  key   text primary key,
  value text not null default ''
);
alter table public.raqbo_settings enable row level security;   -- no policies: not readable from the website
insert into public.raqbo_settings (key, value) values
  ('admin_email', 'raqbo.official@gmail.com'),
  ('site_url', 'https://raqbo-construction-and-properties.vercel.app')
on conflict (key) do nothing;

create table if not exists public.email_outbox (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  event_id      bigint references public.order_events (id) on delete set null,
  order_id      uuid references public.orders (id) on delete set null,
  audience      text not null check (audience in ('buyer','vendor','admin')),
  to_email      text not null,
  to_name       text not null default '',
  event         text not null,          -- order_placed, quote_requested, quoted, quote_accepted, payment_review, payment_rejected, paid_escrow, dispatched, delivered, completed, released, disputed, refunded, cancelled, declined
  status        text not null,
  actor         text not null default '',
  note          text not null default '',
  order_ref     text not null default '',
  mode          text not null default '',
  total         numeric(14,0),
  payment_method text not null default '',
  vendor_name   text not null default '',
  buyer_name    text not null default '',
  items_summary text not null default '',
  dispatch_info jsonb not null default '{}'::jsonb,
  order_url     text not null default '',
  sent_at       timestamptz,
  error         text not null default '',
  unique (event_id, to_email)
);
create index if not exists email_outbox_order_idx on public.email_outbox (order_id, id);
alter table public.email_outbox enable row level security;      -- no policies: only the server (webhook / service role) can read it

create or replace function public.queue_order_emails()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  o public.orders; v public.vendors;
  buyer_email text; vendor_email text; admin_email text; site text;
  ev text; first_event boolean; items text; url text;
begin
  select * into o from public.orders where id = new.order_id;
  if o.id is null then return new; end if;
  select * into v from public.vendors where id = o.vendor_id;
  select nullif(btrim(email), '') into buyer_email from public.profiles where id = o.buyer_id;
  if v.owner_id is not null then select nullif(btrim(email), '') into vendor_email from public.profiles where id = v.owner_id; end if;
  select nullif(btrim(value), '') into admin_email from public.raqbo_settings where key = 'admin_email';
  select coalesce(nullif(btrim(value), ''), 'https://raqbo.pk') into site from public.raqbo_settings where key = 'site_url';
  site := coalesce(site, 'https://raqbo.pk');
  url := rtrim(site, '/') || '/#marketplace/order/' || o.id;

  first_event := not exists (select 1 from public.order_events where order_id = o.id and id < new.id);
  ev := case
    when first_event and new.status = 'quote_requested' then 'quote_requested'
    when first_event then 'order_placed'
    when new.status = 'awaiting_payment' and new.actor = 'admin' then 'payment_rejected'
    when new.status = 'awaiting_payment' then 'quote_accepted'
    when new.status = 'cancelled' and new.actor = 'vendor' then 'declined'
    else new.status end;

  select coalesce(string_agg(format('%s × %s %s', coalesce(it->>'name', 'Item'), coalesce(it->>'qty', '1'), coalesce(it->>'unit', '')), E'\n'), '')
    into items from jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) it;

  -- Buyer: every status
  if buyer_email is not null then
    insert into public.email_outbox (event_id, order_id, audience, to_email, to_name, event, status, actor, note, order_ref, mode, total, payment_method, vendor_name, buyer_name, items_summary, dispatch_info, order_url)
    values (new.id, o.id, 'buyer', buyer_email, o.buyer_name, ev, new.status, new.actor, new.note, o.ref, o.mode, o.total, o.payment_method, v.shop_name, o.buyer_name, items, o.dispatch_info, url)
    on conflict do nothing;
  end if;

  -- RAQBO admin: payment screenshot to verify, disputes, payouts to release
  if admin_email is not null and ev in ('payment_review', 'disputed', 'completed') then
    insert into public.email_outbox (event_id, order_id, audience, to_email, to_name, event, status, actor, note, order_ref, mode, total, payment_method, vendor_name, buyer_name, items_summary, dispatch_info, order_url)
    values (new.id, o.id, 'admin', admin_email, 'RAQBO admin', ev, new.status, new.actor, new.note, o.ref, o.mode, o.total, o.payment_method, v.shop_name, o.buyer_name, items, o.dispatch_info, url)
    on conflict do nothing;
  end if;

  -- Vendor: new orders / quote requests, quote accepted, payment verified (dispatch now), completed, payout, disputes, refunds, buyer cancellations.
  -- RAQBO sample shops have no owner, so their vendor emails go to the admin address.
  if ev in ('order_placed', 'quote_requested', 'quote_accepted', 'paid_escrow', 'completed', 'released', 'disputed', 'refunded', 'cancelled') then
    if coalesce(vendor_email, case when v.owner_id is null then admin_email end) is not null then
      insert into public.email_outbox (event_id, order_id, audience, to_email, to_name, event, status, actor, note, order_ref, mode, total, payment_method, vendor_name, buyer_name, items_summary, dispatch_info, order_url)
      values (new.id, o.id, 'vendor', coalesce(vendor_email, admin_email), coalesce(v.owner_name, v.shop_name), ev, new.status, new.actor, new.note, o.ref, o.mode, o.total, o.payment_method, v.shop_name, o.buyer_name, items, o.dispatch_info, url)
      on conflict do nothing;
    end if;
  end if;
  return new;
exception when others then
  raise warning 'queue_order_emails: %', sqlerrm;   -- an email problem must never block the order
  return new;
end $$;

revoke all on function public.queue_order_emails() from public, anon, authenticated;
drop trigger if exists order_events_queue_emails on public.order_events;
create trigger order_events_queue_emails after insert on public.order_events
  for each row execute function public.queue_order_emails();

-- ---------- 15. Notifications (bell), chat, WhatsApp order updates ----------
-- Safe to run more than once. Needs update_5 (marketplace) and update_8 (order emails) first.

-- ===== Notifications =====
create table if not exists public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null check (kind in ('order','listing','review','message','system')),
  title      text not null check (char_length(title) <= 160),
  body       text not null default '' check (char_length(body) <= 400),
  link       text not null default '' check (char_length(link) <= 300),
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index if not exists notifications_user_idx on public.notifications (user_id, id desc);
alter table public.notifications enable row level security;
drop policy if exists "notifications: read own" on public.notifications;
create policy "notifications: read own" on public.notifications for select using (user_id = auth.uid());
drop policy if exists "notifications: mark own read" on public.notifications;
create policy "notifications: mark own read" on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.notifications from authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create or replace function public.notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public
as $$ insert into public.notifications (user_id, kind, title, body, link)
      select p_user, p_kind, left(p_title, 160), left(coalesce(p_body, ''), 400), left(coalesce(p_link, ''), 300) where p_user is not null $$;
revoke all on function public.notify(uuid, text, text, text, text) from public, anon, authenticated;

-- Admins (for RAQBO-team items)
create or replace function public.notify_admins(p_kind text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public
as $$ select public.notify(id, p_kind, p_title, p_body, p_link) from public.profiles where role = 'admin' $$;
revoke all on function public.notify_admins(text, text, text, text) from public, anon, authenticated;

-- Order status → buyer (every step) and vendor (steps they act on)
create or replace function public.notify_order_event()
returns trigger language plpgsql security definer set search_path = public
as $$
declare o public.orders; v public.vendors; first_event boolean; t_buyer text; t_vendor text; link text;
begin
  select * into o from public.orders where id = new.order_id; if o.id is null then return new; end if;
  select * into v from public.vendors where id = o.vendor_id;
  first_event := not exists (select 1 from public.order_events where order_id = o.id and id < new.id);
  link := '#marketplace/order/' || o.id;
  t_buyer := case
    when first_event and new.status = 'quote_requested' then 'Quote request sent to ' || v.shop_name
    when first_event then 'Order placed — pay into RAQBO escrow'
    when new.status = 'quoted' then 'Quote received from ' || v.shop_name
    when new.status = 'awaiting_payment' and new.actor = 'admin' then 'Payment could not be verified — upload again'
    when new.status = 'awaiting_payment' then 'Quote accepted — pay into RAQBO escrow'
    when new.status = 'payment_review' then 'Payment received — RAQBO is verifying it'
    when new.status = 'paid_escrow' then 'Payment confirmed and held in escrow'
    when new.status = 'dispatched' then 'Your order is on the way'
    when new.status = 'delivered' then 'Delivered — please confirm receipt'
    when new.status = 'completed' then 'Order completed — thank you'
    when new.status = 'released' then 'Order closed — vendor paid'
    when new.status = 'disputed' then 'Dispute opened'
    when new.status = 'refunded' then 'Refund issued'
    when new.status = 'cancelled' and new.actor = 'vendor' then v.shop_name || ' declined your order'
    when new.status = 'cancelled' then 'Order cancelled'
    else 'Order update' end;
  perform public.notify(o.buyer_id, 'order', t_buyer || ' · ' || o.ref, new.note, link);
  t_vendor := case
    when first_event and new.status = 'quote_requested' then 'New quote request from ' || o.buyer_name
    when first_event then 'New order from ' || o.buyer_name
    when new.status = 'awaiting_payment' and new.actor = 'buyer' then 'Your quote was accepted'
    when new.status = 'paid_escrow' then 'Payment secured — dispatch now'
    when new.status = 'completed' then 'Buyer confirmed delivery — payout pending'
    when new.status = 'released' then 'Payout released'
    when new.status = 'disputed' then 'Buyer opened a dispute'
    when new.status = 'refunded' then 'Order refunded to buyer'
    when new.status = 'cancelled' and new.actor = 'buyer' then 'Buyer cancelled the order'
    else null end;
  if t_vendor is not null and v.owner_id is not null then perform public.notify(v.owner_id, 'order', t_vendor || ' · ' || o.ref, new.note, link); end if;
  if new.status in ('payment_review', 'disputed') or (new.status = 'completed') then
    perform public.notify_admins('order', case new.status when 'payment_review' then 'Payment screenshot to verify' when 'disputed' then 'Dispute to resolve' else 'Payout to release' end || ' · ' || o.ref, v.shop_name || ' · ' || o.buyer_name, '#admin');
  end if;
  return new;
exception when others then raise warning 'notify_order_event: %', sqlerrm; return new;
end $$;
revoke all on function public.notify_order_event() from public, anon, authenticated;
drop trigger if exists order_events_notify on public.order_events;
create trigger order_events_notify after insert on public.order_events for each row execute function public.notify_order_event();

-- Listing approved / rejected → owner
create or replace function public.notify_listing_status()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.status is distinct from old.status and new.owner_id is not null then
    if new.status = 'published' then perform public.notify(new.owner_id, 'listing', 'Your listing is live: ' || new.title, 'Approved by the RAQBO team · ' || new.ref, '#property/' || new.id);
    elsif new.status = 'rejected' then perform public.notify(new.owner_id, 'listing', 'Your listing needs changes: ' || new.title, coalesce(nullif(new.review_note, ''), 'See the note in My account'), '#account');
    end if;
  end if;
  return new;
exception when others then raise warning 'notify_listing_status: %', sqlerrm; return new;
end $$;
revoke all on function public.notify_listing_status() from public, anon, authenticated;
drop trigger if exists listings_notify_status on public.listings;
create trigger listings_notify_status after update of status on public.listings for each row execute function public.notify_listing_status();

-- New review → listing owner
create or replace function public.notify_new_review()
returns trigger language plpgsql security definer set search_path = public
as $$
declare l public.listings;
begin
  select * into l from public.listings where id = new.listing_id;
  if l.owner_id is not null and l.owner_id <> new.user_id then
    perform public.notify(l.owner_id, 'review', repeat('★', new.rating) || ' New review on ' || l.title, left(new.comment, 200), '#property/' || l.id);
  end if;
  return new;
exception when others then raise warning 'notify_new_review: %', sqlerrm; return new;
end $$;
revoke all on function public.notify_new_review() from public, anon, authenticated;
drop trigger if exists reviews_notify_owner on public.reviews;
create trigger reviews_notify_owner after insert on public.reviews for each row execute function public.notify_new_review();

-- ===== Chat (buyer ↔ advertiser / shop / RAQBO team) =====
create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  starter_id      uuid not null references public.profiles (id) on delete cascade,
  other_id        uuid references public.profiles (id) on delete cascade,      -- null = RAQBO team (admins answer)
  listing_id      uuid references public.listings (id) on delete set null,
  vendor_id       uuid references public.vendors (id) on delete set null,
  order_id        uuid references public.orders (id) on delete set null,
  subject         text not null default '' check (char_length(subject) <= 160),
  starter_name    text not null default '',
  other_name      text not null default '',
  last_message_at timestamptz not null default now(),
  last_preview    text not null default '',
  last_sender     uuid,
  created_at      timestamptz not null default now()
);
create unique index if not exists conversations_unique_topic on public.conversations (starter_id, coalesce(other_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(listing_id, vendor_id, order_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists conversations_starter_idx on public.conversations (starter_id, last_message_at desc);
create index if not exists conversations_other_idx on public.conversations (other_id, last_message_at desc);

create table if not exists public.messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body            text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at      timestamptz not null default now(),
  read_at         timestamptz
);
create index if not exists messages_conversation_idx on public.messages (conversation_id, id);

create or replace function public.is_participant(p_conv uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.conversations c where c.id = p_conv
        and (c.starter_id = auth.uid() or c.other_id = auth.uid() or (c.other_id is null and public.is_admin()))) $$;

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
drop policy if exists "conversations: participants read" on public.conversations;
create policy "conversations: participants read" on public.conversations for select
  using (starter_id = auth.uid() or other_id = auth.uid() or (other_id is null and public.is_admin()));
drop policy if exists "messages: participants read" on public.messages;
create policy "messages: participants read" on public.messages for select using (public.is_participant(conversation_id));
drop policy if exists "messages: participants send" on public.messages;
create policy "messages: participants send" on public.messages for insert
  with check (sender_id = auth.uid() and public.is_participant(conversation_id) and public.is_verified_user());
grant select on public.conversations to authenticated;
grant select, insert on public.messages to authenticated;
grant usage on all sequences in schema public to authenticated;

-- Start (or re-open) a conversation about a property, a shop or an order
create or replace function public.start_conversation(p_listing uuid default null, p_vendor uuid default null, p_order uuid default null)
returns uuid language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); other uuid; subj text; cid uuid; l public.listings; v public.vendors; o public.orders; my_name text; other_name text;
begin
  if me is null or not public.is_verified_user() then raise exception 'Please sign in to send messages.'; end if;
  select coalesce(nullif(full_name, ''), 'RAQBO member') into my_name from public.profiles where id = me;
  if p_listing is not null then
    select * into l from public.listings where id = p_listing and (status = 'published' or owner_id = me);
    if l.id is null then raise exception 'This property is not available.'; end if;
    other := l.owner_id; subj := l.title || ' · ' || l.ref;
    if other = me then raise exception 'This is your own listing.'; end if;
  elsif p_vendor is not null then
    select * into v from public.vendors where id = p_vendor and (status = 'approved' or owner_id = me);
    if v.id is null then raise exception 'This shop is not available.'; end if;
    other := v.owner_id; subj := v.shop_name;
    if other = me then raise exception 'This is your own shop.'; end if;
  elsif p_order is not null then
    select * into o from public.orders where id = p_order; if o.id is null then raise exception 'Order not found.'; end if;
    select * into v from public.vendors where id = o.vendor_id;
    if o.buyer_id = me then other := v.owner_id; elsif v.owner_id = me then other := o.buyer_id; elsif public.is_admin() then other := o.buyer_id; else raise exception 'This is not your order.'; end if;
    subj := 'Order ' || o.ref || ' · ' || v.shop_name;
  else
    other := null; subj := 'RAQBO support';
  end if;
  select coalesce(nullif(full_name, ''), 'RAQBO member') into other_name from public.profiles where id = other;
  select id into cid from public.conversations
   where starter_id = me and other_id is not distinct from other
     and coalesce(listing_id, vendor_id, order_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_listing, p_vendor, p_order, '00000000-0000-0000-0000-000000000000'::uuid);
  if cid is null then
    -- the other side may have started the same thread (e.g. vendor ↔ buyer on an order)
    select id into cid from public.conversations where order_id = p_order and p_order is not null and starter_id = other and other_id = me;
  end if;
  if cid is null then
    insert into public.conversations (starter_id, other_id, listing_id, vendor_id, order_id, subject, starter_name, other_name)
    values (me, other, p_listing, p_vendor, p_order, left(subj, 160), my_name, coalesce(other_name, 'RAQBO team')) returning id into cid;
  end if;
  return cid;
end $$;
grant execute on function public.start_conversation(uuid, uuid, uuid) to authenticated;

-- Mark messages from the other side as read
create or replace function public.mark_conversation_read(p_conv uuid)
returns void language sql security definer set search_path = public
as $$ update public.messages set read_at = now() where conversation_id = p_conv and sender_id <> auth.uid() and read_at is null and public.is_participant(p_conv) $$;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- New message: spam guard, update the thread, notify the other side
create or replace function public.messages_before_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  new.sender_id := auth.uid(); new.created_at := now(); new.read_at := null; new.body := btrim(new.body);
  if (select count(*) from public.messages where sender_id = auth.uid() and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'You are sending messages too quickly. Please wait a minute.';
  end if;
  return new;
end $$;
drop trigger if exists messages_before_insert on public.messages;
create trigger messages_before_insert before insert on public.messages for each row execute function public.messages_before_insert();

create or replace function public.messages_after_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
declare c public.conversations; sender_name text; target uuid;
begin
  update public.conversations set last_message_at = new.created_at, last_preview = left(new.body, 120), last_sender = new.sender_id
   where id = new.conversation_id returning * into c;
  select coalesce(nullif(full_name, ''), 'RAQBO member') into sender_name from public.profiles where id = new.sender_id;
  if public.is_admin() and c.other_id is null and new.sender_id <> c.starter_id then sender_name := 'RAQBO team'; end if;
  target := case when new.sender_id = c.starter_id then c.other_id else c.starter_id end;
  -- one unread "message" notification per thread is enough
  if target is null then
    if not exists (select 1 from public.notifications n join public.profiles p on p.id = n.user_id and p.role = 'admin'
                   where n.kind = 'message' and n.link = '#messages/' || c.id and n.read_at is null) then
      perform public.notify_admins('message', 'New message from ' || sender_name, left(new.body, 160), '#messages/' || c.id);
    end if;
  elsif not exists (select 1 from public.notifications where user_id = target and kind = 'message' and link = '#messages/' || c.id and read_at is null) then
    perform public.notify(target, 'message', 'New message from ' || sender_name, c.subject || ' — ' || left(new.body, 140), '#messages/' || c.id);
  end if;
  return new;
end $$;
drop trigger if exists messages_after_insert on public.messages;
create trigger messages_after_insert after insert on public.messages for each row execute function public.messages_after_insert();

-- ===== WhatsApp order updates: the phone number goes along with each queued order email =====
alter table public.email_outbox add column if not exists to_phone text not null default '';
create or replace function public.email_outbox_add_phone()
returns trigger language plpgsql security definer set search_path = public
as $$
declare ph text;
begin
  if new.audience = 'buyer' then select p.phone into ph from public.orders o join public.profiles p on p.id = o.buyer_id where o.id = new.order_id;
  elsif new.audience = 'vendor' then select coalesce(v.whatsapp, v.phone) into ph from public.orders o join public.vendors v on v.id = o.vendor_id where o.id = new.order_id and v.owner_id is not null;
  end if;
  new.to_phone := coalesce(regexp_replace(coalesce(ph, ''), '[^0-9]', '', 'g'), '');
  if new.to_phone like '03%' then new.to_phone := '92' || substr(new.to_phone, 2); end if;
  return new;
exception when others then new.to_phone := ''; return new;
end $$;
revoke all on function public.email_outbox_add_phone() from public, anon, authenticated;
drop trigger if exists email_outbox_add_phone on public.email_outbox;
create trigger email_outbox_add_phone before insert on public.email_outbox for each row execute function public.email_outbox_add_phone();

-- Real-time: bell + chat update live
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['notifications', 'messages', 'conversations'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------- 16. Map pins for properties ----------
-- Optional exact location chosen by the advertiser on the map (inside Pakistan only).
alter table public.listings add column if not exists lat numeric(9,6);
alter table public.listings add column if not exists lng numeric(9,6);
alter table public.listings drop constraint if exists listings_latlng_pk;
alter table public.listings add constraint listings_latlng_pk check (
  (lat is null and lng is null) or (lat between 23.5 and 37.2 and lng between 60.8 and 77.9));

-- ---------- 17. Admin dashboard (live numbers for the admin panel) ----------
-- One call returns every count, money total, 30-day trend and the latest activity. Admins only.
-- Safe to run more than once.

create or replace function public.admin_dashboard(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  d int := greatest(7, least(coalesce(p_days, 30), 90));
  since date := (now() at time zone 'Asia/Karachi')::date - (d - 1);
  today date := (now() at time zone 'Asia/Karachi')::date;
  out jsonb;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  select jsonb_build_object(
    'generated_at', now(),
    'users', (select jsonb_build_object(
        'total', count(*),
        'verified', count(*) filter (where verified),
        'admins', count(*) filter (where role = 'admin'),
        'today', count(*) filter (where (created_at at time zone 'Asia/Karachi')::date = today),
        'week', count(*) filter (where created_at > now() - interval '7 days'),
        'month', count(*) filter (where created_at > now() - interval '30 days'),
        'prev_month', count(*) filter (where created_at <= now() - interval '30 days' and created_at > now() - interval '60 days'))
      from public.profiles),
    'listings', (select jsonb_build_object(
        'total', count(*) filter (where not coalesce(is_sample, false)),
        'pending', count(*) filter (where status = 'pending'),
        'published', count(*) filter (where status = 'published'),
        'rejected', count(*) filter (where status = 'rejected'),
        'sale', count(*) filter (where status = 'published' and purpose = 'sale'),
        'rent', count(*) filter (where status = 'published' and purpose = 'rent'),
        'week', count(*) filter (where created_at > now() - interval '7 days' and not coalesce(is_sample, false)),
        'pinned', count(*) filter (where status = 'published' and lat is not null))
      from public.listings),
    'cities', coalesce((select jsonb_agg(jsonb_build_object('city', city, 'n', n) order by n desc) from (
        select city, count(*) n from public.listings where status = 'published' group by city order by n desc limit 8) c), '[]'::jsonb),
    'types', coalesce((select jsonb_agg(jsonb_build_object('type', property_type, 'n', n) order by n desc) from (
        select property_type, count(*) n from public.listings where status = 'published' group by property_type) t), '[]'::jsonb),
    'suppliers', (select jsonb_build_object(
        'total', count(*) filter (where owner_id is not null),
        'approved', count(*) filter (where owner_id is not null and status = 'approved'),
        'pending', count(*) filter (where status = 'pending'),
        'verified', count(*) filter (where owner_id is not null and verified),
        'escrow', count(*) filter (where owner_id is not null and escrow_enabled),
        'samples', count(*) filter (where owner_id is null),
        'week', count(*) filter (where owner_id is not null and created_at > now() - interval '7 days'))
      from public.vendors),
    'products', (select count(*) from public.vendor_products where active),
    'buyers', (select count(*) from public.buyer_profiles),
    'orders', (select jsonb_build_object(
        'total', count(*),
        'today', count(*) filter (where (created_at at time zone 'Asia/Karachi')::date = today),
        'week', count(*) filter (where created_at > now() - interval '7 days'),
        'to_verify', count(*) filter (where status = 'payment_review'),
        'disputes', count(*) filter (where status = 'disputed'),
        'payouts_due', count(*) filter (where status = 'completed'),
        'active', count(*) filter (where status in ('quote_requested','quoted','awaiting_payment','payment_review','paid_escrow','dispatched','delivered')),
        'escrow_held', coalesce(sum(total) filter (where status in ('paid_escrow','dispatched','delivered','completed','disputed')), 0),
        'sales', coalesce(sum(total) filter (where status in ('completed','released')), 0),
        'released', coalesce(sum(total) filter (where status = 'released'), 0))
      from public.orders),
    'pipeline', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.orders group by status) s), '{}'::jsonb),
    'engagement', jsonb_build_object(
        'reviews', (select count(*) from public.reviews),
        'avg_rating', (select round(avg(rating)::numeric, 2) from public.reviews),
        'favorites', (select count(*) from public.favorites),
        'enquiries_new', (select count(*) from public.enquiries where status = 'new'),
        'enquiries', (select count(*) from public.enquiries),
        'reports_open', (select count(*) from public.reports where status = 'open'),
        'conversations', (select count(*) from public.conversations),
        'messages_week', (select count(*) from public.messages where created_at > now() - interval '7 days'),
        'support_waiting', (select count(*) from public.conversations c where c.other_id is null and c.last_sender = c.starter_id
                            and not exists (select 1 from public.profiles p where p.id = c.starter_id and p.role = 'admin'))),
    'series', (select jsonb_agg(jsonb_build_object(
          'day', g::date,
          'users', (select count(*) from public.profiles p where (p.created_at at time zone 'Asia/Karachi')::date = g::date),
          'listings', (select count(*) from public.listings l where (l.created_at at time zone 'Asia/Karachi')::date = g::date and not coalesce(l.is_sample, false)),
          'orders', (select count(*) from public.orders o where (o.created_at at time zone 'Asia/Karachi')::date = g::date)) order by g)
        from generate_series(since, today, interval '1 day') g),
    'activity', coalesce((select jsonb_agg(a order by (a->>'at') desc) from (
        (select jsonb_build_object('kind', 'user', 'at', created_at, 'text', coalesce(nullif(full_name, ''), 'New member') || ' joined', 'link', '') a from public.profiles order by created_at desc limit 8)
        union all
        (select jsonb_build_object('kind', 'listing', 'at', created_at, 'text', 'Listing ' || status || ': ' || title, 'link', 'listing:' || id) from public.listings where not coalesce(is_sample, false) order by created_at desc limit 8)
        union all
        (select jsonb_build_object('kind', 'order', 'at', e.created_at, 'text', o.ref || ' · ' || replace(e.status, '_', ' ') || ' (' || e.actor || ')', 'link', 'order:' || o.id) from public.order_events e join public.orders o on o.id = e.order_id order by e.created_at desc limit 10)
        union all
        (select jsonb_build_object('kind', 'supplier', 'at', created_at, 'text', 'Supplier ' || status || ': ' || shop_name, 'link', 'vendor:' || id) from public.vendors where owner_id is not null order by created_at desc limit 6)
        union all
        (select jsonb_build_object('kind', 'enquiry', 'at', created_at, 'text', 'Service enquiry from ' || name, 'link', 'tab:enquiries') from public.enquiries order by created_at desc limit 6)
        union all
        (select jsonb_build_object('kind', 'report', 'at', created_at, 'text', 'Property reported: ' || reason, 'link', 'tab:reports') from public.reports order by created_at desc limit 4)
        union all
        (select jsonb_build_object('kind', 'review', 'at', r.created_at, 'text', repeat('★', r.rating) || ' review on ' || coalesce(l.title, 'a property'), 'link', 'listing:' || r.listing_id) from public.reviews r left join public.listings l on l.id = r.listing_id order by r.created_at desc limit 6)
      ) x limit 40), '[]'::jsonb)
  ) into out;
  return out;
end $$;
revoke all on function public.admin_dashboard(int) from public, anon;
grant execute on function public.admin_dashboard(int) to authenticated;

-- Live updates for the dashboard (admins can read all of these tables)
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['profiles', 'listings', 'enquiries', 'reports', 'buyer_profiles', 'conversations'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

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

-- =====================================================================
-- 19. RAQBO Verified listings
--     Free listings show "Unverified". An owner who pays the RAQBO
--     verification fee and whose documents pass RAQBO's check gets the
--     "RAQBO Verified" badge. Fee and on/off are in Admin → Growth.
-- Run after update_11_growth.sql. Safe to run more than once.
-- =====================================================================
alter table public.growth_settings add column if not exists verification_enabled boolean not null default true;
alter table public.growth_settings add column if not exists verification_fee int not null default 2000;
do $$ begin
  alter table public.growth_settings add constraint growth_settings_verification_fee_check check (verification_fee between 0 and 1000000);
exception when duplicate_object then null; end $$;

-- Private storage for ownership documents and fee screenshots (10 MB, images or PDF)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('verification-docs', 'verification-docs', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
-- Owners upload only into their own folder: <user id>/<listing id>/<file>; only the owner and admins can open them
drop policy if exists "verification-docs: upload own folder" on storage.objects;
create policy "verification-docs: upload own folder" on storage.objects
  for insert to authenticated with check (bucket_id = 'verification-docs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "verification-docs: owner or admin reads" on storage.objects;
create policy "verification-docs: owner or admin reads" on storage.objects
  for select using (bucket_id = 'verification-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
drop policy if exists "verification-docs: owner or admin deletes" on storage.objects;
create policy "verification-docs: owner or admin deletes" on storage.objects
  for delete using (bucket_id = 'verification-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

create table if not exists public.listing_verifications (
  listing_id     uuid primary key references public.listings (id) on delete cascade,
  owner_id       uuid not null references public.profiles (id) on delete cascade,
  status         text not null default 'submitted' check (status in ('submitted','verified','rejected','expired')),
  fee            int not null default 0,
  payment_method text not null default '' check (char_length(payment_method) <= 40),
  txn_id         text not null default '' check (char_length(txn_id) <= 80),
  payment_proof  text not null default '' check (char_length(payment_proof) <= 300),
  documents      jsonb not null default '[]'::jsonb,       -- [{"path": "...", "name": "...", "type": "..."}]
  owner_note     text not null default '' check (char_length(owner_note) <= 600),
  admin_note     text not null default '' check (char_length(admin_note) <= 600),
  submitted_at   timestamptz not null default now(),
  decided_at     timestamptz,
  decided_by     uuid references public.profiles (id) on delete set null
);
create index if not exists listing_verifications_status_idx on public.listing_verifications (status, submitted_at);
alter table public.listing_verifications enable row level security;
drop policy if exists "listing_verifications: own or admin" on public.listing_verifications;
create policy "listing_verifications: own or admin" on public.listing_verifications for select using (owner_id = auth.uid() or public.is_admin());
revoke insert, update, delete on public.listing_verifications from anon, authenticated;
grant select on public.listing_verifications to authenticated;

-- Owner applies (or re-applies) for the badge
create or replace function public.request_listing_verification(p_listing uuid, p_method text, p_txn text, p_proof text, p_docs jsonb, p_note text)
returns void language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); l public.listings; s public.growth_settings; v public.listing_verifications; d jsonb; nm text;
begin
  if me is null or not public.is_verified_user() then raise exception 'Please sign in first.'; end if;
  select * into s from public.growth_settings where id = 1;
  if not s.verification_enabled then raise exception 'RAQBO verification is not available right now.'; end if;
  select * into l from public.listings where id = p_listing;
  if l.id is null or l.owner_id is distinct from me or l.is_sample then raise exception 'You can verify only your own property.'; end if;
  if l.status = 'rejected' then raise exception 'This listing was rejected. Edit it and get it approved first.'; end if;
  select * into v from public.listing_verifications where listing_id = p_listing;
  if v.status = 'submitted' then raise exception 'Your documents are already with RAQBO for checking.'; end if;
  if v.status = 'verified' then raise exception 'This property is already RAQBO Verified.'; end if;
  if jsonb_typeof(p_docs) <> 'array' or jsonb_array_length(p_docs) = 0 then raise exception 'Please upload at least one ownership document.'; end if;
  if jsonb_array_length(p_docs) > 12 then raise exception 'Upload up to 12 documents.'; end if;
  for d in select * from jsonb_array_elements(p_docs) loop
    if coalesce(d->>'path', '') not like me::text || '/%' then raise exception 'Document upload not recognised. Please upload again.'; end if;
  end loop;
  if s.verification_fee > 0 then
    if coalesce(p_proof, '') not like me::text || '/%' then raise exception 'Please upload the screenshot of the verification fee payment.'; end if;
    if char_length(btrim(coalesce(p_method, ''))) = 0 then raise exception 'Choose how you paid the fee.'; end if;
  end if;
  insert into public.listing_verifications (listing_id, owner_id, status, fee, payment_method, txn_id, payment_proof, documents, owner_note, admin_note, submitted_at, decided_at, decided_by)
  values (l.id, me, 'submitted', s.verification_fee, left(btrim(coalesce(p_method, '')), 40), left(btrim(coalesce(p_txn, '')), 80), coalesce(p_proof, ''), p_docs, left(btrim(coalesce(p_note, '')), 600), '', now(), null, null)
  on conflict (listing_id) do update set status = 'submitted', fee = excluded.fee, payment_method = excluded.payment_method, txn_id = excluded.txn_id,
     payment_proof = excluded.payment_proof, documents = excluded.documents, owner_note = excluded.owner_note, admin_note = '', submitted_at = now(), decided_at = null, decided_by = null;
  select coalesce(nullif(full_name, ''), 'A member') into nm from public.profiles where id = me;
  perform public.notify_admins('listing', 'Verification request: ' || left(l.title, 100), nm || ' · ' || l.ref || ' · fee Rs ' || s.verification_fee || ' · ' || jsonb_array_length(p_docs) || ' document(s)', '#admin/verify');
end $$;
grant execute on function public.request_listing_verification(uuid, text, text, text, jsonb, text) to authenticated;

-- Admin decides
create or replace function public.admin_decide_verification(p_listing uuid, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = public
as $$
declare v public.listing_verifications; l public.listings;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  update public.listing_verifications set status = case when p_approve then 'verified' else 'rejected' end,
         admin_note = left(btrim(coalesce(p_note, '')), 600), decided_at = now(), decided_by = auth.uid()
   where listing_id = p_listing and status = 'submitted' returning * into v;
  if v.listing_id is null then raise exception 'This request was already handled.'; end if;
  select * into l from public.listings where id = p_listing;
  perform public.notify(v.owner_id, 'listing',
    case when p_approve then '✓ Your property is RAQBO Verified' else 'Verification not approved' end,
    left(l.title, 100) || ' · ' || coalesce(nullif(btrim(p_note), ''), case when p_approve then 'The RAQBO Verified badge now shows on your listing.' else 'Open My account to see the reason and apply again.' end),
    case when p_approve then '#property/' || l.id else '#account' end);
end $$;
grant execute on function public.admin_decide_verification(uuid, boolean, text) to authenticated;

-- Requests for the admin panel (with owner contact details)
create or replace function public.admin_verifications()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('listing_id', v.listing_id, 'status', v.status, 'fee', v.fee, 'payment_method', v.payment_method, 'txn_id', v.txn_id,
           'payment_proof', v.payment_proof, 'documents', v.documents, 'owner_note', v.owner_note, 'admin_note', v.admin_note, 'submitted_at', v.submitted_at, 'decided_at', v.decided_at,
           'title', l.title, 'ref', l.ref, 'city', l.city, 'area', l.area, 'listing_status', l.status, 'advertiser_role', l.advertiser_role,
           'owner', coalesce(nullif(p.full_name, ''), p.email), 'phone', p.phone, 'email', p.email)
           order by (v.status = 'submitted') desc, v.submitted_at desc)
         from public.listing_verifications v join public.listings l on l.id = v.listing_id left join public.profiles p on p.id = v.owner_id), '[]'::jsonb);
end $$;
grant execute on function public.admin_verifications() to authenticated;

-- If the owner changes what was checked (type, city, area, size), the badge comes off until checked again
create or replace function public.listings_verification_reset()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if (new.property_type, new.city, new.area, new.size, new.size_unit) is distinct from (old.property_type, old.city, old.area, old.size, old.size_unit) then
    update public.listing_verifications set status = 'expired', admin_note = 'Property details changed — please apply again.' where listing_id = new.id and status in ('verified', 'submitted');
    if found and new.owner_id is not null then
      perform public.notify(new.owner_id, 'listing', 'RAQBO Verified badge removed', left(new.title, 100) || ': the property details changed, so RAQBO needs to check the documents again.', '#account');
    end if;
  end if;
  return null;
end $$;
drop trigger if exists listings_verification_reset on public.listings;
create trigger listings_verification_reset after update on public.listings for each row execute function public.listings_verification_reset();

-- Public campaign data now includes verified listings and the fee
create or replace function public.growth_public()
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'campaign_on', s.campaign_on, 'title', s.campaign_title, 'tagline', s.campaign_tagline, 'cta', s.campaign_cta,
    'founding_enabled', s.founding_enabled, 'founding_cap', s.founding_cap, 'founding_taken', (select count(*) from public.profiles where founding_no is not null),
    'founding_discount_pct', s.founding_discount_pct, 'founding_discount_max', s.founding_discount_max,
    'referral_enabled', s.referral_enabled, 'referral_member_credit', s.referral_member_credit, 'referral_owner_credit', s.referral_owner_credit,
    'featured_trial_enabled', s.featured_trial_enabled, 'featured_trial_days', s.featured_trial_days, 'pilot_cities', to_jsonb(s.pilot_cities), 'credit_expiry_days', s.credit_expiry_days,
    'verification_enabled', s.verification_enabled, 'verification_fee', s.verification_fee,
    'verified', coalesce((select jsonb_agg(v.listing_id) from public.listing_verifications v join public.listings l on l.id = v.listing_id and l.status = 'published' where v.status = 'verified'), '[]'::jsonb),
    'featured', coalesce((select jsonb_agg(f.listing_id) from public.listing_features f join public.listings l on l.id = f.listing_id and l.status = 'published' where f.until > now()), '[]'::jsonb))
  from public.growth_settings s where s.id = 1
$$;
grant execute on function public.growth_public() to anon, authenticated;

-- Admin settings now include verification on/off and fee
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
    verification_enabled = coalesce((p->>'verification_enabled')::boolean, verification_enabled),
    verification_fee = coalesce((p->>'verification_fee')::int, verification_fee),
    updated_at = now()
  where id = 1;
end $$;
grant execute on function public.admin_save_growth(jsonb) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'listing_verifications') then
    alter publication supabase_realtime add table public.listing_verifications;
  end if;
end $$;

-- =====================================================================
-- 20. Core upgrades (client review, first priority)
--     Business settings · admin permissions + audit log · Property Passport
--     fields · RAQBO Direct roles · identity checks · verification levels
--     with "what was checked and when" · service request tracking ·
--     bank statement reconciliation
-- Run after update_12_verification.sql. Safe to run more than once.
-- =====================================================================

-- ---------- Business settings (one row, edited in Admin → Business settings) ----------
create table if not exists public.platform_settings (
  id                             int primary key default 1 check (id = 1),
  legal_verification_fee         int not null default 10000 check (legal_verification_fee between 0 and 10000000),
  identity_checks_enabled        boolean not null default true,
  urgent_enabled                 boolean not null default true,
  urgent_commission_pct          numeric(5,2) not null default 2 check (urgent_commission_pct between 0 and 50),
  investors_enabled              boolean not null default true,
  offer_valid_days               int not null default 14 check (offer_valid_days between 1 and 180),
  auctions_enabled               boolean not null default true,
  auction_buyer_premium_pct      numeric(5,2) not null default 1 check (auction_buyer_premium_pct between 0 and 50),
  auction_seller_commission_pct  numeric(5,2) not null default 2 check (auction_seller_commission_pct between 0 and 50),
  auction_default_increment      bigint not null default 100000 check (auction_default_increment > 0),
  auction_deposit_default        bigint not null default 200000 check (auction_deposit_default >= 0),
  auction_extension_window_min   int not null default 5 check (auction_extension_window_min between 0 and 120),
  auction_extension_min          int not null default 5 check (auction_extension_min between 0 and 120),
  auction_max_extensions         int not null default 12 check (auction_max_extensions between 0 and 500),
  bidder_auto_approve            boolean not null default false,
  updated_at                     timestamptz not null default now()
);
insert into public.platform_settings (id) values (1) on conflict (id) do nothing;
alter table public.platform_settings enable row level security;
drop policy if exists "platform_settings: read" on public.platform_settings;
create policy "platform_settings: read" on public.platform_settings for select using (true);
grant select on public.platform_settings to anon, authenticated;

-- ---------- Admin permissions and audit log ----------
alter table public.profiles add column if not exists admin_perms text[];   -- null = full admin; otherwise only these areas
create or replace function public.has_perm(p text)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and (admin_perms is null or p = any(admin_perms))) $$;
create or replace function public.is_full_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and admin_perms is null) $$;

create table if not exists public.admin_audit (
  id         bigint generated always as identity primary key,
  actor_id   uuid references public.profiles (id) on delete set null,
  actor_name text not null default '',
  action     text not null,
  entity     text not null default '',
  entity_ref text not null default '',
  reason     text not null default '',
  data       jsonb not null default '{}'::jsonb,
  at         timestamptz not null default now()
);
create index if not exists admin_audit_at_idx on public.admin_audit (at desc);
alter table public.admin_audit enable row level security;
drop policy if exists "admin_audit: admins read" on public.admin_audit;
create policy "admin_audit: admins read" on public.admin_audit for select using (public.is_admin());
revoke insert, update, delete on public.admin_audit from anon, authenticated;
grant select on public.admin_audit to authenticated;
-- the log can only grow: no one may edit or delete a line
create or replace function public.admin_audit_lock() returns trigger language plpgsql as $$ begin raise exception 'The audit log cannot be changed.'; end $$;
drop trigger if exists admin_audit_lock on public.admin_audit;
create trigger admin_audit_lock before update or delete on public.admin_audit for each row execute function public.admin_audit_lock();

create or replace function public.audit(p_action text, p_entity text, p_ref text, p_reason text, p_data jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public
as $$
begin
  insert into public.admin_audit (actor_id, actor_name, action, entity, entity_ref, reason, data)
  values (auth.uid(), coalesce((select coalesce(nullif(full_name, ''), email) from public.profiles where id = auth.uid()), 'system'), p_action, coalesce(p_entity, ''), coalesce(p_ref, ''), left(coalesce(p_reason, ''), 600), coalesce(p_data, '{}'::jsonb));
end $$;
revoke all on function public.audit(text, text, text, text, jsonb) from public, anon, authenticated;

create or replace function public.admin_team()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', full_name, 'email', email, 'perms', to_jsonb(admin_perms), 'me', id = auth.uid()) order by full_name) from public.profiles where role = 'admin'), '[]'::jsonb);
end $$;
grant execute on function public.admin_team() to authenticated;

create or replace function public.admin_set_admin(p_email text, p_admin boolean, p_perms text[], p_reason text)
returns void language plpgsql security definer set search_path = public
as $$
declare u public.profiles;
begin
  if not public.is_full_admin() then raise exception 'Only a full admin can change the admin team.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Please give a reason (it is kept in the audit log).'; end if;
  select * into u from public.profiles where lower(email) = lower(btrim(p_email));
  if u.id is null then raise exception 'No member with that email. They must create an account first.'; end if;
  if u.id = auth.uid() and (not p_admin or p_perms is not null) then raise exception 'You cannot remove or limit your own admin access.'; end if;
  if p_perms is not null and exists (select 1 from unnest(p_perms) x where x not in ('listings','verification','finance','urgent','auctions','investors','growth','settings','services')) then raise exception 'Unknown permission.'; end if;
  update public.profiles set role = case when p_admin then 'admin' else 'user' end, admin_perms = case when p_admin then p_perms end where id = u.id;
  perform public.audit(case when p_admin then 'admin.grant' else 'admin.revoke' end, 'member', u.email, p_reason, jsonb_build_object('perms', to_jsonb(p_perms)));
end $$;
grant execute on function public.admin_set_admin(text, boolean, text[], text) to authenticated;

-- ---------- Generic settings save (whitelisted columns) ----------
create or replace function public.admin_save_platform(p jsonb, p_reason text default '')
returns void language plpgsql security definer set search_path = public
as $$
declare k text; allowed text[] := array['legal_verification_fee','identity_checks_enabled','urgent_enabled','urgent_commission_pct','investors_enabled','offer_valid_days','auctions_enabled','auction_buyer_premium_pct','auction_seller_commission_pct','auction_default_increment','auction_deposit_default','auction_extension_window_min','auction_extension_min','auction_max_extensions','bidder_auto_approve'];
begin
  if not public.has_perm('settings') then raise exception 'You do not have permission to change business settings.'; end if;
  for k in select jsonb_object_keys(p) loop
    if k = any(allowed) then execute format('update public.platform_settings set %I = $1::text::%s, updated_at = now() where id = 1', k,
        (select format_type(a.atttypid, a.atttypmod) from pg_attribute a where a.attrelid = 'public.platform_settings'::regclass and a.attname = k)) using (p ->> k); end if;
  end loop;
  perform public.audit('settings.business', 'settings', 'platform', p_reason, p);
end $$;
grant execute on function public.admin_save_platform(jsonb, text) to authenticated;

-- ---------- Listings: sale type, visibility, RAQBO role, Property Passport fields ----------
alter table public.listings add column if not exists sale_mode text not null default 'normal';
alter table public.listings add column if not exists channel text not null default 'public';
alter table public.listings add column if not exists raqbo_role text;
alter table public.listings add column if not exists raqbo_role_note text not null default '';
alter table public.listings add column if not exists covered_area numeric;
alter table public.listings add column if not exists covered_unit text;
alter table public.listings add column if not exists possession text;
alter table public.listings add column if not exists utilities text[] not null default '{}';
alter table public.listings add column if not exists approved_plan text;
alter table public.listings add column if not exists encumbrance text;
do $$ begin alter table public.listings add constraint listings_sale_mode_check check (sale_mode in ('normal','urgent','auction')); exception when duplicate_object then null; end $$;
do $$ begin alter table public.listings add constraint listings_channel_check check (channel in ('public','investors','private')); exception when duplicate_object then null; end $$;
do $$ begin alter table public.listings add constraint listings_raqbo_role_check check (raqbo_role is null or raqbo_role in ('owner','purchaser','agent','facilitator')); exception when duplicate_object then null; end $$;
do $$ begin alter table public.listings add constraint listings_possession_check check (possession is null or possession in ('vacant','owner_occupied','tenanted','under_construction')); exception when duplicate_object then null; end $$;
do $$ begin alter table public.listings add constraint listings_approved_plan_check check (approved_plan is null or approved_plan in ('yes','no','not_applicable','unknown')); exception when duplicate_object then null; end $$;
do $$ begin alter table public.listings add constraint listings_encumbrance_check check (encumbrance is null or encumbrance in ('none','mortgage','dispute','dues','other','unknown')); exception when duplicate_object then null; end $$;
do $$ begin alter table public.listings add constraint listings_covered_unit_check check (covered_unit is null or covered_unit in ('sq ft','sq yd','Marla','Kanal')); exception when duplicate_object then null; end $$;
create index if not exists listings_sale_mode_idx on public.listings (sale_mode, status);

-- Members cannot set RAQBO's role or turn a listing into an auction themselves
create or replace function public.listings_zz_protect()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  new.utilities := coalesce(array(select distinct x from unnest(new.utilities) x where x in ('electricity','gas','water','sewerage','internet','phone')), '{}');
  if auth.uid() is not null and not public.is_admin() and coalesce(current_setting('raqbo.sys', true), '') <> '1' then
    if tg_op = 'INSERT' then
      new.raqbo_role := null; new.raqbo_role_note := '';
      if new.sale_mode = 'auction' then new.sale_mode := 'normal'; end if;
    else
      new.raqbo_role := old.raqbo_role; new.raqbo_role_note := old.raqbo_role_note;
      if new.sale_mode = 'auction' or old.sale_mode = 'auction' then new.sale_mode := old.sale_mode; end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists listings_zz_protect on public.listings;
create trigger listings_zz_protect before insert or update on public.listings for each row execute function public.listings_zz_protect();

-- Investors (full facility in update_14). Defined here so listing visibility can refer to it.
create table if not exists public.investor_profiles (
  user_id         uuid primary key references public.profiles (id) on delete cascade,
  status          text not null default 'pending' check (status in ('pending','approved','rejected','suspended')),
  investor_name   text not null default '' check (char_length(investor_name) <= 120),
  company         text not null default '' check (char_length(company) <= 120),
  budget_min      bigint check (budget_min >= 0),
  budget_max      bigint check (budget_max >= 0),
  cities          text[] not null default '{}',
  categories      text[] not null default '{}',     -- residential, commercial
  property_types  text[] not null default '{}',     -- House, Apartment, Plot, Commercial
  objectives      text not null default '' check (char_length(objectives) <= 600),
  capacity_docs   jsonb not null default '[]'::jsonb,
  admin_note      text not null default '' check (char_length(admin_note) <= 600),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  approved_at     timestamptz,
  approved_by     uuid references public.profiles (id) on delete set null
);
alter table public.investor_profiles enable row level security;
drop policy if exists "investor_profiles: own or admin" on public.investor_profiles;
create policy "investor_profiles: own or admin" on public.investor_profiles for select using (user_id = auth.uid() or public.is_admin());
revoke insert, update, delete on public.investor_profiles from anon, authenticated;
grant select on public.investor_profiles to authenticated;
create or replace function public.is_approved_investor()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.investor_profiles where user_id = auth.uid() and status = 'approved') $$;

-- Visibility: public listings for everyone; investor-only listings for approved investors; private ones for the owner and RAQBO
drop policy if exists "listings: read" on public.listings;
create policy "listings: read" on public.listings
  for select using (
    (status = 'published' and (channel = 'public' or (channel = 'investors' and public.is_approved_investor())))
    or owner_id = auth.uid() or public.is_admin());

create or replace function public.admin_set_raqbo_role(p_listing uuid, p_role text, p_note text, p_reason text)
returns void language plpgsql security definer set search_path = public
as $$
declare l public.listings;
begin
  if not public.has_perm('listings') then raise exception 'You do not have permission to change listings.'; end if;
  if nullif(p_role, '') is not null and p_role not in ('owner','purchaser','agent','facilitator') then raise exception 'Unknown RAQBO role.'; end if;
  perform set_config('raqbo.sys', '1', true);
  update public.listings set raqbo_role = nullif(p_role, ''), raqbo_role_note = left(btrim(coalesce(p_note, '')), 300) where id = p_listing returning * into l;
  perform set_config('raqbo.sys', '', true);
  if l.id is null then raise exception 'Listing not found.'; end if;
  perform public.audit('listing.raqbo_role', 'listing', l.ref, p_reason, jsonb_build_object('role', p_role, 'note', p_note));
end $$;
grant execute on function public.admin_set_raqbo_role(uuid, text, text, text) to authenticated;

-- ---------- Identity checks (CNIC) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('identity-docs', 'identity-docs', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "identity-docs: upload own folder" on storage.objects;
create policy "identity-docs: upload own folder" on storage.objects for insert to authenticated with check (bucket_id = 'identity-docs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "identity-docs: owner or admin reads" on storage.objects;
create policy "identity-docs: owner or admin reads" on storage.objects for select using (bucket_id = 'identity-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

create table if not exists public.identity_checks (
  user_id       uuid primary key references public.profiles (id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending','verified','rejected')),
  name_on_cnic  text not null default '' check (char_length(name_on_cnic) <= 120),
  files         jsonb not null default '[]'::jsonb,
  admin_note    text not null default '' check (char_length(admin_note) <= 600),
  submitted_at  timestamptz not null default now(),
  checked_at    timestamptz,
  checked_by    uuid references public.profiles (id) on delete set null
);
alter table public.identity_checks enable row level security;
drop policy if exists "identity_checks: own or admin" on public.identity_checks;
create policy "identity_checks: own or admin" on public.identity_checks for select using (user_id = auth.uid() or public.is_admin());
revoke insert, update, delete on public.identity_checks from anon, authenticated;
grant select on public.identity_checks to authenticated;
create or replace function public.is_identity_verified(p_user uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.identity_checks where user_id = p_user and status = 'verified') $$;

create or replace function public.request_identity_check(p_name text, p_files jsonb)
returns void language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); f jsonb; cur public.identity_checks;
begin
  if me is null or not public.is_verified_user() then raise exception 'Please sign in first.'; end if;
  if not (select identity_checks_enabled from public.platform_settings where id = 1) then raise exception 'Identity checks are not available right now.'; end if;
  select * into cur from public.identity_checks where user_id = me;
  if cur.status = 'verified' then raise exception 'Your identity is already verified.'; end if;
  if cur.status = 'pending' then raise exception 'Your CNIC is already with RAQBO for checking.'; end if;
  if char_length(btrim(coalesce(p_name, ''))) < 3 then raise exception 'Enter your name exactly as it is on your CNIC.'; end if;
  if jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) < 2 then raise exception 'Upload the front and back of your CNIC.'; end if;
  for f in select * from jsonb_array_elements(p_files) loop
    if coalesce(f->>'path', '') not like me::text || '/%' then raise exception 'Upload not recognised. Please upload again.'; end if;
  end loop;
  insert into public.identity_checks (user_id, status, name_on_cnic, files, admin_note, submitted_at, checked_at, checked_by)
  values (me, 'pending', btrim(p_name), p_files, '', now(), null, null)
  on conflict (user_id) do update set status = 'pending', name_on_cnic = excluded.name_on_cnic, files = excluded.files, admin_note = '', submitted_at = now(), checked_at = null, checked_by = null;
  perform public.notify_admins('system', 'Identity check request', btrim(p_name) || ' sent CNIC photos for checking.', '#admin/verify');
end $$;
grant execute on function public.request_identity_check(text, jsonb) to authenticated;

create or replace function public.admin_decide_identity(p_user uuid, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = public
as $$
declare c public.identity_checks;
begin
  if not public.has_perm('verification') then raise exception 'You do not have permission to verify identities.'; end if;
  if not p_approve and char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Write a short reason for the member.'; end if;
  update public.identity_checks set status = case when p_approve then 'verified' else 'rejected' end, admin_note = left(btrim(coalesce(p_note, '')), 600), checked_at = now(), checked_by = auth.uid()
   where user_id = p_user and status = 'pending' returning * into c;
  if c.user_id is null then raise exception 'This request was already handled.'; end if;
  perform public.notify(p_user, 'system', case when p_approve then '✓ Your identity is verified' else 'Identity check not approved' end,
    coalesce(nullif(btrim(p_note), ''), 'Your ID-verified badge now shows on your listings.'), '#my');
  perform public.audit(case when p_approve then 'identity.approve' else 'identity.reject' end, 'member', c.name_on_cnic, p_note, '{}'::jsonb);
end $$;
grant execute on function public.admin_decide_identity(uuid, boolean, text) to authenticated;

-- ---------- Listing verification levels: what was checked and when ----------
alter table public.listing_verifications add column if not exists level text not null default 'documents';
alter table public.listing_verifications add column if not exists checks jsonb not null default '[]'::jsonb;
do $$ begin alter table public.listing_verifications add constraint listing_verifications_level_check check (level in ('documents','legal')); exception when duplicate_object then null; end $$;

create table if not exists public.verification_history (
  id          bigint generated always as identity primary key,
  listing_id  uuid not null references public.listings (id) on delete cascade,
  event       text not null check (event in ('submitted','verified','rejected','expired')),
  level       text not null default 'documents',
  note        text not null default '',
  at          timestamptz not null default now()
);
create index if not exists verification_history_listing_idx on public.verification_history (listing_id, at);
alter table public.verification_history enable row level security;
drop policy if exists "verification_history: read" on public.verification_history;
create policy "verification_history: read" on public.verification_history for select using (
  public.is_admin() or exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = auth.uid()));
revoke insert, update, delete on public.verification_history from anon, authenticated;
grant select on public.verification_history to authenticated;

create or replace function public.listing_verifications_history()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status or new.submitted_at is distinct from old.submitted_at then
    insert into public.verification_history (listing_id, event, level, note) values (new.listing_id, new.status::text, new.level,
      case when new.status in ('rejected','expired') then new.admin_note else '' end);
  end if;
  return null;
end $$;
drop trigger if exists listing_verifications_history on public.listing_verifications;
create trigger listing_verifications_history after insert or update on public.listing_verifications for each row execute function public.listing_verifications_history();

-- Apply with a level (documents or the fuller legal check)
create or replace function public.request_listing_verification2(p_listing uuid, p_level text, p_method text, p_txn text, p_proof text, p_docs jsonb, p_note text)
returns void language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); l public.listings; s public.growth_settings; v public.listing_verifications; d jsonb; nm text; fee int;
begin
  if me is null or not public.is_verified_user() then raise exception 'Please sign in first.'; end if;
  select * into s from public.growth_settings where id = 1;
  if not s.verification_enabled then raise exception 'RAQBO verification is not available right now.'; end if;
  if p_level not in ('documents','legal') then raise exception 'Choose a verification level.'; end if;
  fee := case when p_level = 'legal' then (select legal_verification_fee from public.platform_settings where id = 1) else s.verification_fee end;
  select * into l from public.listings where id = p_listing;
  if l.id is null or l.owner_id is distinct from me or l.is_sample then raise exception 'You can verify only your own property.'; end if;
  if l.status = 'rejected' then raise exception 'This listing was rejected. Edit it and get it approved first.'; end if;
  select * into v from public.listing_verifications where listing_id = p_listing;
  if v.status = 'submitted' then raise exception 'Your documents are already with RAQBO for checking.'; end if;
  if v.status = 'verified' then raise exception 'This property is already RAQBO Verified.'; end if;
  if jsonb_typeof(p_docs) <> 'array' or jsonb_array_length(p_docs) = 0 then raise exception 'Please upload at least one ownership document.'; end if;
  if jsonb_array_length(p_docs) > 12 then raise exception 'Upload up to 12 documents.'; end if;
  for d in select * from jsonb_array_elements(p_docs) loop
    if coalesce(d->>'path', '') not like me::text || '/%' then raise exception 'Document upload not recognised. Please upload again.'; end if;
  end loop;
  if fee > 0 then
    if coalesce(p_proof, '') not like me::text || '/%' then raise exception 'Please upload the screenshot of the verification fee payment.'; end if;
    if char_length(btrim(coalesce(p_method, ''))) = 0 then raise exception 'Choose how you paid the fee.'; end if;
  end if;
  insert into public.listing_verifications (listing_id, owner_id, status, level, checks, fee, payment_method, txn_id, payment_proof, documents, owner_note, admin_note, submitted_at, decided_at, decided_by)
  values (l.id, me, 'submitted', p_level, '[]'::jsonb, fee, left(btrim(coalesce(p_method, '')), 40), left(btrim(coalesce(p_txn, '')), 80), coalesce(p_proof, ''), p_docs, left(btrim(coalesce(p_note, '')), 600), '', now(), null, null)
  on conflict (listing_id) do update set status = 'submitted', level = excluded.level, checks = '[]'::jsonb, fee = excluded.fee, payment_method = excluded.payment_method, txn_id = excluded.txn_id,
     payment_proof = excluded.payment_proof, documents = excluded.documents, owner_note = excluded.owner_note, admin_note = '', submitted_at = now(), decided_at = null, decided_by = null;
  select coalesce(nullif(full_name, ''), 'A member') into nm from public.profiles where id = me;
  perform public.notify_admins('listing', 'Verification request: ' || left(l.title, 100), nm || ' · ' || l.ref || ' · ' || case when p_level = 'legal' then 'legal check' else 'documents' end || ' · fee Rs ' || fee || ' · ' || jsonb_array_length(p_docs) || ' document(s)', '#admin/verify');
end $$;
grant execute on function public.request_listing_verification2(uuid, text, text, text, text, jsonb, text) to authenticated;
-- the earlier call keeps working as a "documents" request
create or replace function public.request_listing_verification(p_listing uuid, p_method text, p_txn text, p_proof text, p_docs jsonb, p_note text)
returns void language sql security definer set search_path = public
as $$ select public.request_listing_verification2(p_listing, 'documents', p_method, p_txn, p_proof, p_docs, p_note) $$;

-- ---------- Bank statement reconciliation ----------
create table if not exists public.bank_lines (
  id           bigint generated always as identity primary key,
  txn_date     date not null,
  description  text not null default '',
  amount       numeric(14,2) not null,
  reference    text not null default '',
  imported_by  uuid references public.profiles (id) on delete set null,
  imported_at  timestamptz not null default now(),
  matched_kind text,                -- order | verification | deposit
  matched_ref  text,
  matched_at   timestamptz,
  matched_by   uuid references public.profiles (id) on delete set null,
  unique (txn_date, amount, reference, description)
);
alter table public.bank_lines enable row level security;
drop policy if exists "bank_lines: finance" on public.bank_lines;
create policy "bank_lines: finance" on public.bank_lines for select using (public.has_perm('finance'));
revoke insert, update, delete on public.bank_lines from anon, authenticated;
grant select on public.bank_lines to authenticated;

-- What RAQBO is waiting to receive (payment proofs uploaded by members)
create or replace function public.expected_payments()
returns table (kind text, ref text, amount numeric, txn text, who text, at timestamptz, label text)
language sql stable security definer set search_path = public
as $$
  select 'order', o.ref, o.total, o.payment_ref, coalesce(nullif(p.full_name, ''), p.email), o.updated_at, 'Material order ' || o.ref
    from public.orders o left join public.profiles p on p.id = o.buyer_id where o.status = 'payment_review'
  union all
  select 'verification', l.ref, v.fee, v.txn_id, coalesce(nullif(p.full_name, ''), p.email), v.submitted_at, 'Verification fee ' || l.ref
    from public.listing_verifications v join public.listings l on l.id = v.listing_id left join public.profiles p on p.id = v.owner_id where v.status = 'submitted' and v.fee > 0
$$;
revoke all on function public.expected_payments() from public, anon, authenticated;

create or replace function public.payment_matched(p_kind text, p_ref text)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.bank_lines where matched_kind = p_kind and matched_ref = p_ref) $$;
grant execute on function public.payment_matched(text, text) to authenticated;

-- Link bank lines to payments: same amount, and the transaction ID appears in the bank reference or description
create or replace function public.reconcile_auto()
returns int language plpgsql security definer set search_path = public
as $$
declare e record; b public.bank_lines; n int := 0;
begin
  for e in select * from public.expected_payments() where not public.payment_matched(kind, ref) loop
    select * into b from public.bank_lines bl where bl.matched_ref is null and abs(bl.amount - e.amount) < 1
       and char_length(btrim(coalesce(e.txn, ''))) >= 4 and (bl.reference ilike '%' || btrim(e.txn) || '%' or bl.description ilike '%' || btrim(e.txn) || '%')
       order by bl.txn_date desc limit 1;
    if b.id is not null then
      update public.bank_lines set matched_kind = e.kind, matched_ref = e.ref, matched_at = now(), matched_by = auth.uid() where id = b.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.reconcile_auto() from public, anon, authenticated;

create or replace function public.admin_import_bank_lines(p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare r jsonb; added int := 0; matched int;
begin
  if not public.has_perm('finance') then raise exception 'You do not have permission to import bank statements.'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 5000 then raise exception 'Send up to 5000 lines at a time.'; end if;
  for r in select * from jsonb_array_elements(p_lines) loop
    begin
      insert into public.bank_lines (txn_date, description, amount, reference, imported_by)
      values ((r->>'date')::date, left(coalesce(r->>'description', ''), 500), (r->>'amount')::numeric, left(coalesce(r->>'reference', ''), 200), auth.uid())
      on conflict do nothing;
      if found then added := added + 1; end if;
    exception when others then null;   -- skip lines that cannot be read
    end;
  end loop;
  matched := public.reconcile_auto();
  perform public.audit('bank.import', 'bank', '', '', jsonb_build_object('added', added, 'matched', matched));
  return jsonb_build_object('added', added, 'matched', matched);
end $$;
grant execute on function public.admin_import_bank_lines(jsonb) to authenticated;

create or replace function public.admin_reconciliation()
returns jsonb language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_perm('finance') then raise exception 'You do not have permission to see bank records.'; end if;
  perform public.reconcile_auto();
  return jsonb_build_object(
    'expected', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'ref', e.ref, 'amount', e.amount, 'txn', e.txn, 'who', e.who, 'at', e.at, 'label', e.label,
                 'matched', public.payment_matched(e.kind, e.ref),
                 'candidates', (select count(*) from public.bank_lines b where b.matched_ref is null and abs(b.amount - e.amount) < 1 and b.txn_date >= (e.at - interval '7 days')::date))
                 order by e.at) from public.expected_payments() e), '[]'::jsonb),
    'lines', coalesce((select jsonb_agg(to_jsonb(b) order by b.txn_date desc, b.id desc) from (select * from public.bank_lines order by txn_date desc, id desc limit 300) b), '[]'::jsonb),
    'unmatched', (select count(*) from public.bank_lines where matched_ref is null and amount > 0));
end $$;
grant execute on function public.admin_reconciliation() to authenticated;

create or replace function public.admin_match_line(p_line bigint, p_kind text, p_ref text, p_reason text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_perm('finance') then raise exception 'You do not have permission to match payments.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Please give a reason (it is kept in the audit log).'; end if;
  if nullif(p_kind, '') is null then
    update public.bank_lines set matched_kind = null, matched_ref = null, matched_at = null, matched_by = null where id = p_line;
  else
    if public.payment_matched(p_kind, p_ref) then raise exception 'That payment is already matched to a bank line.'; end if;
    update public.bank_lines set matched_kind = p_kind, matched_ref = p_ref, matched_at = now(), matched_by = auth.uid() where id = p_line and matched_ref is null;
    if not found then raise exception 'That bank line is already matched.'; end if;
  end if;
  perform public.audit(case when nullif(p_kind, '') is null then 'bank.unmatch' else 'bank.match' end, 'bank', p_line::text, p_reason, jsonb_build_object('kind', p_kind, 'ref', p_ref));
end $$;
grant execute on function public.admin_match_line(bigint, text, text, text) to authenticated;

-- Admin decides a listing verification: records exactly what was checked; a paid request needs a bank match or a reason
create or replace function public.admin_decide_verification2(p_listing uuid, p_approve boolean, p_note text, p_checks jsonb, p_reason text)
returns void language plpgsql security definer set search_path = public
as $$
declare v public.listing_verifications; l public.listings;
begin
  if not public.has_perm('verification') then raise exception 'You do not have permission to verify listings.'; end if;
  select * into v from public.listing_verifications where listing_id = p_listing;
  select * into l from public.listings where id = p_listing;
  if v.listing_id is null or v.status <> 'submitted' then raise exception 'This request was already handled.'; end if;
  if not p_approve and char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Write a short reason for the owner.'; end if;
  if p_approve and v.fee > 0 and not public.payment_matched('verification', l.ref) and char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'No bank record matches this fee yet. Import the bank statement first, or give a reason to approve anyway (kept in the audit log).';
  end if;
  if p_approve and (jsonb_typeof(p_checks) <> 'array' or not exists (select 1 from jsonb_array_elements(p_checks) c where c->>'result' = 'ok')) then
    raise exception 'Tick at least one check that was completed.';
  end if;
  update public.listing_verifications set checks = case when p_approve then p_checks else checks end where listing_id = p_listing;
  perform public.admin_decide_verification(p_listing, p_approve, p_note);
  perform public.audit(case when p_approve then 'verification.approve' else 'verification.reject' end, 'listing', l.ref, coalesce(nullif(p_reason, ''), p_note),
    jsonb_build_object('level', v.level, 'checks', p_checks, 'bank_matched', public.payment_matched('verification', l.ref)));
end $$;
grant execute on function public.admin_decide_verification2(uuid, boolean, text, jsonb, text) to authenticated;

-- Public trust information for one property (Property Passport and the verification box)
create or replace function public.listing_trust(p_listing uuid)
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'verification', (select jsonb_build_object('status', v.status, 'level', v.level, 'checks', case when v.status = 'verified' then v.checks else '[]'::jsonb end, 'checked_at', v.decided_at)
                      from public.listing_verifications v where v.listing_id = l.id and v.status in ('verified','expired')),
    'history', coalesce((select jsonb_agg(jsonb_build_object('event', h.event, 'level', h.level, 'at', h.at) order by h.at)
                      from public.verification_history h where h.listing_id = l.id and h.event in ('verified','expired')), '[]'::jsonb),
    'owner_id_verified', public.is_identity_verified(l.owner_id),
    'raqbo_role', l.raqbo_role, 'raqbo_role_note', l.raqbo_role_note)
  from public.listings l where l.id = p_listing and (l.status = 'published' or l.owner_id = auth.uid() or public.is_admin())
$$;
grant execute on function public.listing_trust(uuid) to anon, authenticated;

-- Badges for advertisers (Founding number + ID verified)
create or replace function public.member_trust(p_ids uuid[])
returns table (id uuid, founding_no int, id_verified boolean) language sql stable security definer set search_path = public
as $$ select p.id, p.founding_no, public.is_identity_verified(p.id) from public.profiles p where p.id = any(p_ids[1:500]) $$;
grant execute on function public.member_trust(uuid[]) to anon, authenticated;

-- Admin view of verification requests now includes level, bank match and identity
create or replace function public.admin_verifications()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return jsonb_build_object(
    'listings', coalesce((select jsonb_agg(jsonb_build_object('listing_id', v.listing_id, 'status', v.status, 'level', v.level, 'checks', v.checks, 'fee', v.fee, 'payment_method', v.payment_method, 'txn_id', v.txn_id,
           'payment_proof', v.payment_proof, 'documents', v.documents, 'owner_note', v.owner_note, 'admin_note', v.admin_note, 'submitted_at', v.submitted_at, 'decided_at', v.decided_at,
           'title', l.title, 'ref', l.ref, 'city', l.city, 'area', l.area, 'listing_status', l.status, 'advertiser_role', l.advertiser_role,
           'owner', coalesce(nullif(p.full_name, ''), p.email), 'phone', p.phone, 'email', p.email,
           'owner_id_verified', public.is_identity_verified(v.owner_id), 'bank_matched', public.payment_matched('verification', l.ref))
           order by (v.status = 'submitted') desc, v.submitted_at desc)
         from public.listing_verifications v join public.listings l on l.id = v.listing_id left join public.profiles p on p.id = v.owner_id), '[]'::jsonb),
    'identity', coalesce((select jsonb_agg(jsonb_build_object('user_id', c.user_id, 'status', c.status, 'name_on_cnic', c.name_on_cnic, 'files', c.files, 'admin_note', c.admin_note,
           'submitted_at', c.submitted_at, 'checked_at', c.checked_at, 'member', coalesce(nullif(p.full_name, ''), p.email), 'phone', p.phone, 'email', p.email)
           order by (c.status = 'pending') desc, c.submitted_at desc)
         from public.identity_checks c left join public.profiles p on p.id = c.user_id), '[]'::jsonb));
end $$;
grant execute on function public.admin_verifications() to authenticated;

-- ---------- Service requests: tracking for members ----------
alter table public.enquiries add column if not exists client_note text not null default '';
alter table public.enquiries add column if not exists updated_at timestamptz not null default now();
alter table public.enquiries drop constraint if exists enquiries_status_check;
alter table public.enquiries add constraint enquiries_status_check check (status in ('new','in_progress','awaiting_client','completed','cancelled','handled'));
create or replace function public.enquiries_before_insert()
returns trigger language plpgsql security definer set search_path = public
as $$ begin new.user_id := auth.uid(); new.status := 'new'; new.updated_at := now(); return new; end $$;
drop trigger if exists enquiries_before_insert on public.enquiries;
create trigger enquiries_before_insert before insert on public.enquiries for each row execute function public.enquiries_before_insert();

create or replace function public.my_service_requests()
returns jsonb language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('ref', ref, 'service', service, 'message', message, 'property_ref', property_ref, 'status', status, 'client_note', client_note, 'created_at', created_at, 'updated_at', updated_at) order by created_at desc), '[]'::jsonb)
  from public.enquiries where user_id = auth.uid()
$$;
grant execute on function public.my_service_requests() to authenticated;

create or replace function public.admin_update_service_request(p_id uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public
as $$
declare e public.enquiries; label text;
begin
  if not public.has_perm('services') then raise exception 'You do not have permission to update service requests.'; end if;
  if p_status not in ('new','in_progress','awaiting_client','completed','cancelled','handled') then raise exception 'Unknown status.'; end if;
  update public.enquiries set status = p_status, client_note = left(btrim(coalesce(p_note, '')), 600), updated_at = now() where id = p_id returning * into e;
  if e.id is null then raise exception 'Request not found.'; end if;
  label := case p_status when 'in_progress' then 'is in progress' when 'awaiting_client' then 'needs something from you' when 'completed' then 'is complete' when 'cancelled' then 'was cancelled' else 'was updated' end;
  if e.user_id is not null then perform public.notify(e.user_id, 'service', 'Your service request ' || e.ref || ' ' || label, coalesce(nullif(btrim(p_note), ''), 'See My RAQBO → Service requests.'), '#my/services'); end if;
end $$;
grant execute on function public.admin_update_service_request(uuid, text, text) to authenticated;

-- ---------- Notification types for the new modules ----------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('order','listing','review','message','system','alert','reward','deal','auction','service'));

-- ---------- Public data: verified listings by level ----------
create or replace function public.platform_public()
returns jsonb language sql stable security definer set search_path = public
as $$
  select to_jsonb(s) - 'id' - 'updated_at' || jsonb_build_object(
    'verified_legal', coalesce((select jsonb_agg(v.listing_id) from public.listing_verifications v join public.listings l on l.id = v.listing_id and l.status = 'published' where v.status = 'verified' and v.level = 'legal'), '[]'::jsonb),
    'id_verified_owners', coalesce((select jsonb_agg(distinct l.owner_id) from public.listings l join public.identity_checks c on c.user_id = l.owner_id and c.status = 'verified' where l.status = 'published'), '[]'::jsonb),
    'is_investor', public.is_approved_investor())
  from public.platform_settings s where s.id = 1
$$;
grant execute on function public.platform_public() to anon, authenticated;

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['identity_checks', 'admin_audit', 'bank_lines', 'platform_settings'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;


-- =====================================================================
-- update_14_urgent.sql (Urgent Sale + Investors Network)
-- =====================================================================
-- =====================================================================
-- 21. RAQBO Urgent Sale + Investors Network + offers + inspections
-- Run after update_13_core.sql. Safe to run more than once.
-- =====================================================================

-- ---------- Urgent-sale requests (one per listing) ----------
create table if not exists public.urgent_requests (
  listing_id            uuid primary key references public.listings (id) on delete cascade,
  owner_id              uuid not null references public.profiles (id) on delete cascade,
  options               text[] not null default '{}',          -- raqbo | investors | public
  min_price             bigint check (min_price > 0),          -- private: only the owner and RAQBO see it
  timeframe             text not null default 'flexible' check (timeframe in ('7_days','30_days','90_days','flexible')),
  encumbrance_details   text not null default '' check (char_length(encumbrance_details) <= 600),
  advertised_elsewhere  boolean not null default false,
  documents_available   text[] not null default '{}',
  urgency_reason        text not null default '' check (char_length(urgency_reason) <= 1000),   -- private
  contact_phone         text not null default '' check (char_length(contact_phone) <= 20),
  stage                 text not null default 'submitted' check (stage in ('submitted','under_review','documents_checked','offer_received','negotiation','agreement','sold','closed','rejected')),
  stage_note            text not null default '' check (char_length(stage_note) <= 600),         -- shown to the owner
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists urgent_requests_stage_idx on public.urgent_requests (stage, created_at desc);
alter table public.urgent_requests enable row level security;
drop policy if exists "urgent_requests: own or admin" on public.urgent_requests;
create policy "urgent_requests: own or admin" on public.urgent_requests for select using (owner_id = auth.uid() or public.is_admin());
revoke insert, update, delete on public.urgent_requests from anon, authenticated;
grant select on public.urgent_requests to authenticated;

-- RAQBO's internal review (never shown to the owner or investors)
create table if not exists public.urgent_review (
  listing_id      uuid primary key references public.listings (id) on delete cascade,
  valuation_low   bigint, valuation_high bigint,
  raqbo_interest  text not null default 'not_reviewed' check (raqbo_interest in ('not_reviewed','not_interested','considering','offer_made','purchased')),
  internal_notes  text not null default '' check (char_length(internal_notes) <= 3000),
  updated_by      uuid references public.profiles (id) on delete set null,
  updated_at      timestamptz not null default now()
);
alter table public.urgent_review enable row level security;
drop policy if exists "urgent_review: admins" on public.urgent_review;
create policy "urgent_review: admins" on public.urgent_review for select using (public.has_perm('urgent'));
revoke insert, update, delete on public.urgent_review from anon, authenticated;
grant select on public.urgent_review to authenticated;

create table if not exists public.deal_events (
  id          bigint generated always as identity primary key,
  listing_id  uuid not null references public.listings (id) on delete cascade,
  kind        text not null default 'stage',      -- stage | offer | inspection | note
  stage       text,
  note        text not null default '',
  actor       text not null default 'system',     -- owner | raqbo | buyer | system
  at          timestamptz not null default now()
);
create index if not exists deal_events_listing_idx on public.deal_events (listing_id, at);
alter table public.deal_events enable row level security;
drop policy if exists "deal_events: owner or admin" on public.deal_events;
create policy "deal_events: owner or admin" on public.deal_events for select using (public.is_admin() or exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = auth.uid()));
revoke insert, update, delete on public.deal_events from anon, authenticated;
grant select on public.deal_events to authenticated;

-- ---------- Offers ----------
create table if not exists public.offers_deal (
  id             uuid primary key default gen_random_uuid(),
  ref            text not null unique default ('RQ-OFR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))),
  listing_id     uuid not null references public.listings (id) on delete cascade,
  buyer_id       uuid references public.profiles (id) on delete set null,   -- null when RAQBO itself makes the offer
  buyer_no       int not null default 0,            -- "Buyer 3": shown to the seller instead of a name
  source         text not null check (source in ('public','investor','raqbo')),
  amount         bigint not null check (amount > 0),
  conditions     text not null default '' check (char_length(conditions) <= 1000),
  status         text not null default 'submitted' check (status in ('submitted','countered','accepted','rejected','withdrawn','expired')),
  counter_amount bigint check (counter_amount > 0),
  response_note  text not null default '' check (char_length(response_note) <= 600),
  expires_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists offers_deal_listing_idx on public.offers_deal (listing_id, created_at desc);
create index if not exists offers_deal_buyer_idx on public.offers_deal (buyer_id, created_at desc);
alter table public.offers_deal enable row level security;
drop policy if exists "offers_deal: buyer or admin" on public.offers_deal;
create policy "offers_deal: buyer or admin" on public.offers_deal for select using (buyer_id = auth.uid() or public.is_admin());
revoke insert, update, delete on public.offers_deal from anon, authenticated;
grant select on public.offers_deal to authenticated;

-- ---------- Inspection (visit) requests — used by Urgent Sale and Auctions ----------
create table if not exists public.inspections (
  id            uuid primary key default gen_random_uuid(),
  listing_id    uuid not null references public.listings (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  preferred_at  timestamptz,
  note          text not null default '' check (char_length(note) <= 600),
  status        text not null default 'requested' check (status in ('requested','confirmed','completed','cancelled')),
  confirmed_at  timestamptz,
  admin_note    text not null default '' check (char_length(admin_note) <= 600),
  created_at    timestamptz not null default now()
);
alter table public.inspections enable row level security;
drop policy if exists "inspections: own or admin" on public.inspections;
create policy "inspections: own or admin" on public.inspections for select using (user_id = auth.uid() or public.is_admin());
revoke insert, update, delete on public.inspections from anon, authenticated;
grant select on public.inspections to authenticated;

-- ---------- Helpers ----------
create or replace function public.deal_event(p_listing uuid, p_kind text, p_stage text, p_note text, p_actor text)
returns void language sql security definer set search_path = public
as $$ insert into public.deal_events (listing_id, kind, stage, note, actor) values (p_listing, p_kind, p_stage, coalesce(p_note, ''), p_actor) $$;
revoke all on function public.deal_event(uuid, text, text, text, text) from public, anon, authenticated;

create or replace function public.urgent_stage_label(p text)
returns text language sql immutable as $$
  select case p when 'submitted' then 'Submitted' when 'under_review' then 'Under review' when 'documents_checked' then 'Documents checked'
    when 'offer_received' then 'Offer received' when 'negotiation' then 'Negotiation' when 'agreement' then 'Agreement' when 'sold' then 'Sold'
    when 'closed' then 'Closed' when 'rejected' then 'Not accepted' else p end $$;

-- Tell matching approved investors about an urgent-sale opportunity
create or replace function public.urgent_notify_investors(p_listing uuid)
returns int language plpgsql security definer set search_path = public
as $$
declare l public.listings; r record; n int := 0;
begin
  select * into l from public.listings where id = p_listing;
  if l.id is null or l.status <> 'published' then return 0; end if;
  for r in select i.user_id from public.investor_profiles i
            where i.status = 'approved' and i.user_id <> l.owner_id
              and (i.budget_max is null or l.price <= i.budget_max) and (i.budget_min is null or l.price >= i.budget_min)
              and (coalesce(array_length(i.cities, 1), 0) = 0 or exists (select 1 from unnest(i.cities) c where lower(c) = lower(l.city)))
              and (coalesce(array_length(i.property_types, 1), 0) = 0 or l.property_type = any(i.property_types))
              and (coalesce(array_length(i.categories, 1), 0) = 0 or (case when l.property_type = 'Commercial' then 'commercial' else 'residential' end) = any(i.categories)) loop
    perform public.notify(r.user_id, 'deal', 'New urgent-sale opportunity', left(l.title, 100) || ' · ' || l.area || ', ' || l.city || ' · Rs ' || to_char(l.price, 'FM999,999,999,999'), '#my/investor');
    n := n + 1;
  end loop;
  perform public.deal_event(p_listing, 'note', null, 'Shared with ' || n || ' matching investor(s)', 'raqbo');
  return n;
end $$;
revoke all on function public.urgent_notify_investors(uuid) from public, anon, authenticated;

-- When RAQBO approves an urgent listing, matching investors are told automatically
create or replace function public.listings_urgent_after()
returns trigger language plpgsql security definer set search_path = public
as $$
declare u public.urgent_requests;
begin
  if new.sale_mode = 'urgent' and new.status = 'published' and old.status is distinct from 'published' then
    select * into u from public.urgent_requests where listing_id = new.id;
    if u.listing_id is not null then
      if u.stage = 'submitted' then update public.urgent_requests set stage = 'under_review', updated_at = now() where listing_id = new.id; perform public.deal_event(new.id, 'stage', 'under_review', 'Listing approved — RAQBO is reviewing the request', 'raqbo'); end if;
      if 'investors' = any(u.options) and (select investors_enabled from public.platform_settings where id = 1) then perform public.urgent_notify_investors(new.id); end if;
    end if;
  end if;
  return null;
end $$;
drop trigger if exists listings_urgent_after on public.listings;
create trigger listings_urgent_after after update on public.listings for each row execute function public.listings_urgent_after();

-- ---------- Owner: submit an urgent sale (called right after the listing is created) ----------
create or replace function public.submit_urgent_sale(p_listing uuid, p jsonb)
returns void language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); l public.listings; opts text[]; ch text; nm text;
begin
  if not (select urgent_enabled from public.platform_settings where id = 1) then raise exception 'Urgent Sale is not open right now.'; end if;
  select * into l from public.listings where id = p_listing;
  if l.id is null or l.owner_id is distinct from me then raise exception 'You can only submit your own property.'; end if;
  if l.purpose <> 'sale' then raise exception 'Urgent Sale is for properties for sale.'; end if;
  opts := array(select distinct x from jsonb_array_elements_text(coalesce(p->'options', '[]')) x where x in ('raqbo','investors','public'));
  if coalesce(array_length(opts, 1), 0) = 0 then raise exception 'Choose at least one way to sell.'; end if;
  if (p->>'min_price') is not null and (p->>'min_price')::bigint > l.price then raise exception 'The minimum price cannot be higher than the expected price.'; end if;
  ch := case when 'public' = any(opts) then 'public' when 'investors' = any(opts) then 'investors' else 'private' end;
  perform set_config('raqbo.sys', '1', true);
  update public.listings set sale_mode = 'urgent', channel = ch where id = l.id;
  perform set_config('raqbo.sys', '', true);
  insert into public.urgent_requests (listing_id, owner_id, options, min_price, timeframe, encumbrance_details, advertised_elsewhere, documents_available, urgency_reason, contact_phone)
  values (l.id, me, opts, nullif(p->>'min_price', '')::bigint, coalesce(nullif(p->>'timeframe', ''), 'flexible'), left(coalesce(p->>'encumbrance_details', ''), 600),
          coalesce((p->>'advertised_elsewhere')::boolean, false), array(select x from jsonb_array_elements_text(coalesce(p->'documents_available', '[]')) x), left(coalesce(p->>'urgency_reason', ''), 1000), left(coalesce(p->>'contact_phone', ''), 20))
  on conflict (listing_id) do update set options = excluded.options, min_price = excluded.min_price, timeframe = excluded.timeframe, encumbrance_details = excluded.encumbrance_details,
     advertised_elsewhere = excluded.advertised_elsewhere, documents_available = excluded.documents_available, urgency_reason = excluded.urgency_reason, contact_phone = excluded.contact_phone, updated_at = now();
  insert into public.urgent_review (listing_id) values (l.id) on conflict do nothing;
  perform public.deal_event(l.id, 'stage', 'submitted', 'Urgent sale request submitted', 'owner');
  select coalesce(nullif(full_name, ''), 'A member') into nm from public.profiles where id = me;
  perform public.notify_admins('deal', 'Urgent sale request: ' || left(l.title, 90), nm || ' · ' || l.ref || ' · Rs ' || to_char(l.price, 'FM999,999,999,999') || ' · options: ' || array_to_string(opts, ', '), '#admin/urgent');
end $$;
grant execute on function public.submit_urgent_sale(uuid, jsonb) to authenticated;

-- ---------- Offers ----------
create or replace function public.make_offer(p_listing uuid, p_amount bigint, p_conditions text)
returns text language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); l public.listings; src text; no int; o public.offers_deal; days int;
begin
  if me is null or not public.is_verified_user() then raise exception 'Please sign in to make an offer.'; end if;
  select * into l from public.listings where id = p_listing and status = 'published';
  if l.id is null or l.sale_mode <> 'urgent' then raise exception 'Offers can be made on Urgent Sale properties.'; end if;
  if l.owner_id = me then raise exception 'You cannot make an offer on your own property.'; end if;
  if l.channel = 'private' or (l.channel = 'investors' and not public.is_approved_investor()) then raise exception 'This opportunity is only open to approved RAQBO investors.'; end if;
  if coalesce(p_amount, 0) < 1000 then raise exception 'Enter your offer in rupees.'; end if;
  if (select count(*) from public.offers_deal where buyer_id = me and created_at > now() - interval '1 day') >= 10 then raise exception 'You can make up to 10 offers a day.'; end if;
  if exists (select 1 from public.offers_deal where listing_id = l.id and buyer_id = me and status in ('submitted','countered')) then raise exception 'You already have an open offer on this property. Revise or withdraw it in My RAQBO → Offers.'; end if;
  src := case when public.is_approved_investor() then 'investor' else 'public' end;
  select coalesce(max(buyer_no), 0) into no from public.offers_deal where listing_id = l.id and buyer_id = me;
  if no = 0 then select coalesce(max(buyer_no), 0) + 1 into no from public.offers_deal where listing_id = l.id; end if;
  select offer_valid_days into days from public.platform_settings where id = 1;
  insert into public.offers_deal (listing_id, buyer_id, buyer_no, source, amount, conditions, expires_at)
  values (l.id, me, no, src, p_amount, left(btrim(coalesce(p_conditions, '')), 1000), now() + make_interval(days => days)) returning * into o;
  update public.urgent_requests set stage = 'offer_received', updated_at = now() where listing_id = l.id and stage in ('submitted','under_review','documents_checked');
  perform public.deal_event(l.id, 'offer', null, 'Offer of Rs ' || to_char(p_amount, 'FM999,999,999,999') || ' from ' || case src when 'investor' then 'Investor ' else 'Buyer ' end || no, 'buyer');
  perform public.notify(l.owner_id, 'deal', 'New offer: Rs ' || to_char(p_amount, 'FM999,999,999,999'), left(l.title, 100) || ' · ' || case src when 'investor' then 'RAQBO investor ' else 'Buyer ' end || no || '. Review it in My RAQBO → Offers.', '#my/offers');
  perform public.notify_admins('deal', 'Offer on ' || l.ref, 'Rs ' || to_char(p_amount, 'FM999,999,999,999') || ' · ' || src || ' · ' || left(l.title, 80), '#admin/urgent');
  return o.ref;
end $$;
grant execute on function public.make_offer(uuid, bigint, text) to authenticated;

-- RAQBO makes a conditional purchase offer itself
create or replace function public.admin_raqbo_offer(p_listing uuid, p_amount bigint, p_conditions text, p_reason text)
returns text language plpgsql security definer set search_path = public
as $$
declare l public.listings; o public.offers_deal; days int;
begin
  if not public.has_perm('urgent') then raise exception 'You do not have permission to make RAQBO offers.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Please give a reason (it is kept in the audit log).'; end if;
  select * into l from public.listings where id = p_listing;
  if l.id is null then raise exception 'Listing not found.'; end if;
  select offer_valid_days into days from public.platform_settings where id = 1;
  insert into public.offers_deal (listing_id, buyer_id, buyer_no, source, amount, conditions, expires_at)
  values (l.id, null, 0, 'raqbo', p_amount, left(btrim(coalesce(p_conditions, '')), 1000), now() + make_interval(days => days)) returning * into o;
  insert into public.urgent_review (listing_id, raqbo_interest, updated_by) values (l.id, 'offer_made', auth.uid())
  on conflict (listing_id) do update set raqbo_interest = 'offer_made', updated_by = auth.uid(), updated_at = now();
  update public.urgent_requests set stage = 'offer_received', updated_at = now() where listing_id = l.id and stage in ('submitted','under_review','documents_checked');
  perform public.deal_event(l.id, 'offer', null, 'RAQBO made a conditional purchase offer of Rs ' || to_char(p_amount, 'FM999,999,999,999'), 'raqbo');
  perform public.notify(l.owner_id, 'deal', 'RAQBO made an offer on your property', 'Rs ' || to_char(p_amount, 'FM999,999,999,999') || ' (conditional). Review it in My RAQBO → Offers.', '#my/offers');
  perform public.audit('urgent.raqbo_offer', 'listing', l.ref, p_reason, jsonb_build_object('amount', p_amount, 'conditions', p_conditions));
  return o.ref;
end $$;
grant execute on function public.admin_raqbo_offer(uuid, bigint, text, text) to authenticated;

-- Seller (or RAQBO on the seller's behalf) responds: accept / reject / counter
create or replace function public.respond_offer(p_offer uuid, p_action text, p_amount bigint, p_note text)
returns void language plpgsql security definer set search_path = public
as $$
declare o public.offers_deal; l public.listings; by_admin boolean;
begin
  select * into o from public.offers_deal where id = p_offer;
  select * into l from public.listings where id = o.listing_id;
  if o.id is null then raise exception 'Offer not found.'; end if;
  by_admin := public.has_perm('urgent') and l.owner_id is distinct from auth.uid();
  if l.owner_id is distinct from auth.uid() and not by_admin then raise exception 'Only the seller can respond to this offer.'; end if;
  if o.status not in ('submitted','countered') then raise exception 'This offer is already closed.'; end if;
  if o.expires_at is not null and o.expires_at < now() then update public.offers_deal set status = 'expired', updated_at = now() where id = o.id; raise exception 'This offer has expired.'; end if;
  if p_action = 'accept' then
    update public.offers_deal set status = 'accepted', response_note = left(coalesce(p_note, ''), 600), updated_at = now() where id = o.id;
    update public.offers_deal set status = 'rejected', response_note = 'The seller accepted another offer.', updated_at = now() where listing_id = o.listing_id and id <> o.id and status in ('submitted','countered');
    update public.urgent_requests set stage = 'agreement', stage_note = 'Offer accepted subject to documents, payment and the final agreement.', updated_at = now() where listing_id = o.listing_id;
    perform public.deal_event(o.listing_id, 'stage', 'agreement', 'Offer ' || o.ref || ' accepted — RAQBO will arrange the agreement', case when by_admin then 'raqbo' else 'owner' end);
    perform public.notify_admins('deal', 'Offer accepted: ' || l.ref, 'Rs ' || to_char(o.amount, 'FM999,999,999,999') || ' · arrange the agreement', '#admin/urgent');
  elsif p_action = 'reject' then
    update public.offers_deal set status = 'rejected', response_note = left(coalesce(p_note, ''), 600), updated_at = now() where id = o.id;
    perform public.deal_event(o.listing_id, 'offer', null, 'Offer ' || o.ref || ' declined', case when by_admin then 'raqbo' else 'owner' end);
  elsif p_action = 'counter' then
    if coalesce(p_amount, 0) <= o.amount then raise exception 'A counter-offer should be higher than the offer.'; end if;
    update public.offers_deal set status = 'countered', counter_amount = p_amount, response_note = left(coalesce(p_note, ''), 600), updated_at = now() where id = o.id;
    update public.urgent_requests set stage = 'negotiation', updated_at = now() where listing_id = o.listing_id and stage in ('submitted','under_review','documents_checked','offer_received');
    perform public.deal_event(o.listing_id, 'stage', 'negotiation', 'Counter-offer of Rs ' || to_char(p_amount, 'FM999,999,999,999') || ' on ' || o.ref, case when by_admin then 'raqbo' else 'owner' end);
  else raise exception 'Unknown action.'; end if;
  if o.buyer_id is not null then
    perform public.notify(o.buyer_id, 'deal', case p_action when 'accept' then 'Your offer was accepted' when 'reject' then 'Your offer was declined' else 'The seller made a counter-offer' end,
      left(l.title, 100) || case when p_action = 'counter' then ' · Rs ' || to_char(p_amount, 'FM999,999,999,999') else '' end || case when coalesce(p_note, '') <> '' then ' · ' || left(p_note, 120) else '' end, '#my/offers');
  end if;
  if by_admin then perform public.audit('offer.' || p_action, 'offer', o.ref, p_note, jsonb_build_object('amount', p_amount)); end if;
end $$;
grant execute on function public.respond_offer(uuid, text, bigint, text) to authenticated;

-- Buyer: accept a counter-offer, revise, or withdraw
create or replace function public.buyer_offer_action(p_offer uuid, p_action text, p_amount bigint)
returns void language plpgsql security definer set search_path = public
as $$
declare o public.offers_deal; l public.listings;
begin
  select * into o from public.offers_deal where id = p_offer and buyer_id = auth.uid();
  if o.id is null then raise exception 'Offer not found.'; end if;
  select * into l from public.listings where id = o.listing_id;
  if o.status not in ('submitted','countered') then raise exception 'This offer is already closed.'; end if;
  if p_action = 'withdraw' then update public.offers_deal set status = 'withdrawn', updated_at = now() where id = o.id;
  elsif p_action = 'accept_counter' then
    if o.status <> 'countered' then raise exception 'There is no counter-offer to accept.'; end if;
    update public.offers_deal set status = 'accepted', amount = o.counter_amount, updated_at = now() where id = o.id;
    update public.offers_deal set status = 'rejected', response_note = 'The seller accepted another offer.', updated_at = now() where listing_id = o.listing_id and id <> o.id and status in ('submitted','countered');
    update public.urgent_requests set stage = 'agreement', stage_note = 'Offer accepted subject to documents, payment and the final agreement.', updated_at = now() where listing_id = o.listing_id;
    perform public.deal_event(o.listing_id, 'stage', 'agreement', 'Buyer ' || o.buyer_no || ' accepted the counter-offer of Rs ' || to_char(o.counter_amount, 'FM999,999,999,999'), 'buyer');
    perform public.notify_admins('deal', 'Counter-offer accepted: ' || l.ref, 'Rs ' || to_char(o.counter_amount, 'FM999,999,999,999') || ' · arrange the agreement', '#admin/urgent');
  elsif p_action = 'revise' then
    if coalesce(p_amount, 0) <= o.amount then raise exception 'A revised offer should be higher than your last offer.'; end if;
    update public.offers_deal set status = 'submitted', amount = p_amount, counter_amount = null, updated_at = now() where id = o.id;
  else raise exception 'Unknown action.'; end if;
  perform public.notify(l.owner_id, 'deal', case p_action when 'withdraw' then 'An offer was withdrawn' when 'accept_counter' then 'Your counter-offer was accepted' else 'A buyer revised their offer' end,
    left(l.title, 100) || ' · Buyer ' || o.buyer_no || case when p_action = 'revise' then ' · Rs ' || to_char(p_amount, 'FM999,999,999,999') else '' end, '#my/offers');
  perform public.deal_event(o.listing_id, 'offer', null, 'Buyer ' || o.buyer_no || ' ' || replace(p_action, '_', ' '), 'buyer');
end $$;
grant execute on function public.buyer_offer_action(uuid, text, bigint) to authenticated;

-- ---------- Inspections ----------
create or replace function public.request_inspection(p_listing uuid, p_when timestamptz, p_note text)
returns void language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); l public.listings;
begin
  if me is null or not public.is_verified_user() then raise exception 'Please sign in first.'; end if;
  select * into l from public.listings where id = p_listing and status = 'published';
  if l.id is null then raise exception 'This property is not available.'; end if;
  if l.owner_id = me then raise exception 'This is your own property.'; end if;
  if l.channel = 'private' or (l.channel = 'investors' and not public.is_approved_investor()) then raise exception 'Only approved RAQBO investors can book a visit.'; end if;
  if p_when is not null and p_when < now() then raise exception 'Choose a future date and time.'; end if;
  if exists (select 1 from public.inspections where listing_id = l.id and user_id = me and status in ('requested','confirmed')) then raise exception 'You already have a visit booked for this property.'; end if;
  insert into public.inspections (listing_id, user_id, preferred_at, note) values (l.id, me, p_when, left(btrim(coalesce(p_note, '')), 600));
  perform public.deal_event(l.id, 'inspection', null, 'Visit requested' || coalesce(' for ' || to_char(p_when at time zone 'Asia/Karachi', 'DD Mon HH24:MI'), ''), 'buyer');
  perform public.notify_admins('deal', 'Visit request: ' || l.ref, coalesce(to_char(p_when at time zone 'Asia/Karachi', 'DD Mon YYYY HH24:MI'), 'any time') || ' · ' || left(l.title, 80), '#admin/urgent');
  if l.owner_id is not null then perform public.notify(l.owner_id, 'deal', 'Someone wants to visit your property', left(l.title, 100) || ' · RAQBO will confirm the time with you.', '#my/urgent'); end if;
end $$;
grant execute on function public.request_inspection(uuid, timestamptz, text) to authenticated;

create or replace function public.admin_set_inspection(p_id uuid, p_status text, p_when timestamptz, p_note text)
returns void language plpgsql security definer set search_path = public
as $$
declare i public.inspections; l public.listings;
begin
  if not (public.has_perm('urgent') or public.has_perm('auctions')) then raise exception 'You do not have permission to manage visits.'; end if;
  if p_status not in ('requested','confirmed','completed','cancelled') then raise exception 'Unknown status.'; end if;
  update public.inspections set status = p_status, confirmed_at = coalesce(p_when, confirmed_at, preferred_at), admin_note = left(coalesce(p_note, ''), 600) where id = p_id returning * into i;
  if i.id is null then raise exception 'Visit not found.'; end if;
  select * into l from public.listings where id = i.listing_id;
  perform public.notify(i.user_id, 'deal', case p_status when 'confirmed' then 'Visit confirmed' when 'cancelled' then 'Visit cancelled' when 'completed' then 'Visit completed' else 'Visit updated' end,
    left(l.title, 100) || coalesce(' · ' || to_char(i.confirmed_at at time zone 'Asia/Karachi', 'DD Mon HH24:MI'), '') || case when coalesce(p_note, '') <> '' then ' · ' || left(p_note, 120) else '' end, '#my/offers');
  perform public.deal_event(i.listing_id, 'inspection', null, 'Visit ' || p_status || coalesce(' for ' || to_char(i.confirmed_at at time zone 'Asia/Karachi', 'DD Mon HH24:MI'), ''), 'raqbo');
end $$;
grant execute on function public.admin_set_inspection(uuid, text, timestamptz, text) to authenticated;

-- ---------- Member views ----------
create or replace function public.my_deals()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  return jsonb_build_object(
    'urgent', coalesce((select jsonb_agg(jsonb_build_object('listing_id', u.listing_id, 'title', l.title, 'ref', l.ref, 'price', l.price, 'city', l.city, 'area', l.area, 'status', l.status, 'channel', l.channel,
        'options', to_jsonb(u.options), 'min_price', u.min_price, 'timeframe', u.timeframe, 'stage', u.stage, 'stage_note', u.stage_note, 'created_at', u.created_at,
        'events', coalesce((select jsonb_agg(jsonb_build_object('stage', e.stage, 'kind', e.kind, 'note', e.note, 'actor', e.actor, 'at', e.at) order by e.at) from public.deal_events e where e.listing_id = u.listing_id), '[]'::jsonb),
        'visits', coalesce((select jsonb_agg(jsonb_build_object('status', i.status, 'at', coalesce(i.confirmed_at, i.preferred_at))) from public.inspections i where i.listing_id = u.listing_id), '[]'::jsonb)) order by u.created_at desc)
      from public.urgent_requests u join public.listings l on l.id = u.listing_id where u.owner_id = me), '[]'::jsonb),
    'received', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'ref', o.ref, 'listing_id', o.listing_id, 'title', l.title, 'listing_ref', l.ref, 'price', l.price,
        'who', case o.source when 'raqbo' then 'RAQBO' when 'investor' then 'RAQBO investor ' || o.buyer_no else 'Buyer ' || o.buyer_no end, 'source', o.source,
        'amount', o.amount, 'counter_amount', o.counter_amount, 'conditions', o.conditions, 'status', case when o.status in ('submitted','countered') and o.expires_at < now() then 'expired' else o.status end,
        'response_note', o.response_note, 'expires_at', o.expires_at, 'created_at', o.created_at) order by o.created_at desc)
      from public.offers_deal o join public.listings l on l.id = o.listing_id where l.owner_id = me), '[]'::jsonb),
    'made', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'ref', o.ref, 'listing_id', o.listing_id, 'title', l.title, 'listing_ref', l.ref, 'price', l.price, 'amount', o.amount, 'counter_amount', o.counter_amount,
        'conditions', o.conditions, 'status', case when o.status in ('submitted','countered') and o.expires_at < now() then 'expired' else o.status end, 'response_note', o.response_note, 'expires_at', o.expires_at, 'created_at', o.created_at) order by o.created_at desc)
      from public.offers_deal o join public.listings l on l.id = o.listing_id where o.buyer_id = me), '[]'::jsonb),
    'visits', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'listing_id', i.listing_id, 'title', l.title, 'status', i.status, 'preferred_at', i.preferred_at, 'confirmed_at', i.confirmed_at, 'admin_note', i.admin_note) order by i.created_at desc)
      from public.inspections i join public.listings l on l.id = i.listing_id where i.user_id = me), '[]'::jsonb),
    'investor', (select to_jsonb(i) - 'capacity_docs' - 'approved_by' from public.investor_profiles i where i.user_id = me));
end $$;
grant execute on function public.my_deals() to authenticated;

-- Public facts for an urgent-sale property (no private fields)
create or replace function public.urgent_public(p_listing uuid)
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object('timeframe', u.timeframe, 'options', to_jsonb(u.options), 'stage', u.stage, 'advertised_elsewhere', u.advertised_elsewhere,
         'documents_available', to_jsonb(u.documents_available), 'encumbrance_details', u.encumbrance_details,
         'my_offer', (select jsonb_build_object('status', o.status, 'amount', o.amount, 'counter_amount', o.counter_amount) from public.offers_deal o where o.listing_id = u.listing_id and o.buyer_id = auth.uid() order by o.created_at desc limit 1),
         'offers', (select count(*) from public.offers_deal o where o.listing_id = u.listing_id and o.status in ('submitted','countered')))
  from public.urgent_requests u join public.listings l on l.id = u.listing_id
  where u.listing_id = p_listing and l.status = 'published' and (l.channel = 'public' or (l.channel = 'investors' and public.is_approved_investor()) or l.owner_id = auth.uid() or public.is_admin())
$$;
grant execute on function public.urgent_public(uuid) to anon, authenticated;

-- ---------- Investors ----------
create or replace function public.apply_investor(p jsonb)
returns void language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); d jsonb; cur public.investor_profiles;
begin
  if me is null or not public.is_verified_user() then raise exception 'Please sign in first.'; end if;
  if not (select investors_enabled from public.platform_settings where id = 1) then raise exception 'The Investors Network is not open right now.'; end if;
  select * into cur from public.investor_profiles where user_id = me;
  if cur.status = 'approved' then raise exception 'You are already an approved investor. Update your preferences instead.'; end if;
  for d in select * from jsonb_array_elements(coalesce(p->'capacity_docs', '[]')) loop
    if coalesce(d->>'path', '') not like me::text || '/%' then raise exception 'Upload not recognised. Please upload again.'; end if;
  end loop;
  insert into public.investor_profiles (user_id, status, investor_name, company, budget_min, budget_max, cities, categories, property_types, objectives, capacity_docs, admin_note, updated_at)
  values (me, 'pending', left(btrim(coalesce(p->>'investor_name', '')), 120), left(btrim(coalesce(p->>'company', '')), 120), nullif(p->>'budget_min', '')::bigint, nullif(p->>'budget_max', '')::bigint,
          array(select btrim(x) from jsonb_array_elements_text(coalesce(p->'cities', '[]')) x where btrim(x) <> ''), array(select x from jsonb_array_elements_text(coalesce(p->'categories', '[]')) x where x in ('residential','commercial')),
          array(select x from jsonb_array_elements_text(coalesce(p->'property_types', '[]')) x where x in ('House','Apartment','Plot','Commercial')), left(coalesce(p->>'objectives', ''), 600), coalesce(p->'capacity_docs', '[]'), '', now())
  on conflict (user_id) do update set status = 'pending', investor_name = excluded.investor_name, company = excluded.company, budget_min = excluded.budget_min, budget_max = excluded.budget_max, cities = excluded.cities,
     categories = excluded.categories, property_types = excluded.property_types, objectives = excluded.objectives, capacity_docs = case when jsonb_array_length(excluded.capacity_docs) > 0 then excluded.capacity_docs else public.investor_profiles.capacity_docs end, admin_note = '', updated_at = now();
  perform public.notify_admins('deal', 'Investor application', coalesce(nullif(btrim(p->>'investor_name'), ''), 'A member') || ' applied to the Investors Network.', '#admin/investors');
end $$;
grant execute on function public.apply_investor(jsonb) to authenticated;

-- Approved investors update their preferences without losing approval
create or replace function public.update_investor_prefs(p jsonb)
returns void language plpgsql security definer set search_path = public
as $$
begin
  update public.investor_profiles set budget_min = nullif(p->>'budget_min', '')::bigint, budget_max = nullif(p->>'budget_max', '')::bigint,
    cities = array(select btrim(x) from jsonb_array_elements_text(coalesce(p->'cities', '[]')) x where btrim(x) <> ''), categories = array(select x from jsonb_array_elements_text(coalesce(p->'categories', '[]')) x where x in ('residential','commercial')),
    property_types = array(select x from jsonb_array_elements_text(coalesce(p->'property_types', '[]')) x where x in ('House','Apartment','Plot','Commercial')), objectives = left(coalesce(p->>'objectives', ''), 600), updated_at = now()
  where user_id = auth.uid() and status = 'approved';
  if not found then raise exception 'Only approved investors can update preferences.'; end if;
end $$;
grant execute on function public.update_investor_prefs(jsonb) to authenticated;

create or replace function public.admin_decide_investor(p_user uuid, p_status text, p_note text, p_reason text)
returns void language plpgsql security definer set search_path = public
as $$
declare i public.investor_profiles;
begin
  if not public.has_perm('investors') then raise exception 'You do not have permission to manage investors.'; end if;
  if p_status not in ('approved','rejected','suspended','pending') then raise exception 'Unknown status.'; end if;
  if p_status = 'approved' and not public.is_identity_verified(p_user) then raise exception 'Verify the investor''s identity (CNIC) first — Verification requests.'; end if;
  if p_status <> 'approved' and char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Write a short reason for the member.'; end if;
  update public.investor_profiles set status = p_status, admin_note = left(coalesce(p_note, ''), 600), approved_at = case when p_status = 'approved' then now() else approved_at end, approved_by = case when p_status = 'approved' then auth.uid() else approved_by end, updated_at = now()
   where user_id = p_user returning * into i;
  if i.user_id is null then raise exception 'Application not found.'; end if;
  perform public.notify(p_user, 'deal', case p_status when 'approved' then 'Welcome to the RAQBO Investors Network' when 'suspended' then 'Investor access paused' else 'Investor application update' end,
    case when p_status = 'approved' then 'You will now receive matching urgent-sale opportunities.' else coalesce(nullif(p_note, ''), '') end, '#my/investor');
  perform public.audit('investor.' || p_status, 'investor', i.investor_name, coalesce(nullif(p_reason, ''), p_note), '{}'::jsonb);
end $$;
grant execute on function public.admin_decide_investor(uuid, text, text, text) to authenticated;

create or replace function public.investor_opportunities()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare i public.investor_profiles;
begin
  select * into i from public.investor_profiles where user_id = auth.uid() and status = 'approved';
  if i.user_id is null then raise exception 'Only approved RAQBO investors can see opportunities.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('listing_id', l.id, 'ref', l.ref, 'title', l.title, 'city', l.city, 'area', l.area, 'price', l.price, 'type', l.property_type, 'size', l.size, 'size_unit', l.size_unit,
      'timeframe', u.timeframe, 'stage', u.stage, 'channel', l.channel, 'published_at', l.published_at,
      'match', (i.budget_max is null or l.price <= i.budget_max) and (i.budget_min is null or l.price >= i.budget_min) and (coalesce(array_length(i.cities, 1), 0) = 0 or exists (select 1 from unnest(i.cities) c where lower(c) = lower(l.city))) and (coalesce(array_length(i.property_types, 1), 0) = 0 or l.property_type = any(i.property_types)),
      'my_offer', (select jsonb_build_object('status', o.status, 'amount', o.amount, 'counter_amount', o.counter_amount) from public.offers_deal o where o.listing_id = l.id and o.buyer_id = auth.uid() order by o.created_at desc limit 1))
      order by l.published_at desc)
    from public.urgent_requests u join public.listings l on l.id = u.listing_id
    where l.status = 'published' and l.sale_mode = 'urgent' and 'investors' = any(u.options) and u.stage not in ('sold','closed','rejected') and l.owner_id <> auth.uid()), '[]'::jsonb);
end $$;
grant execute on function public.investor_opportunities() to authenticated;

-- ---------- Admin screens ----------
create or replace function public.admin_urgent()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.has_perm('urgent') then raise exception 'You do not have permission to manage Urgent Sale.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('listing_id', u.listing_id, 'title', l.title, 'ref', l.ref, 'price', l.price, 'city', l.city, 'area', l.area, 'type', l.property_type, 'size', l.size, 'size_unit', l.size_unit,
      'listing_status', l.status, 'channel', l.channel, 'options', to_jsonb(u.options), 'min_price', u.min_price, 'timeframe', u.timeframe, 'encumbrance_details', u.encumbrance_details,
      'advertised_elsewhere', u.advertised_elsewhere, 'documents_available', to_jsonb(u.documents_available), 'urgency_reason', u.urgency_reason, 'contact_phone', u.contact_phone,
      'stage', u.stage, 'stage_note', u.stage_note, 'created_at', u.created_at, 'updated_at', u.updated_at,
      'owner', coalesce(nullif(p.full_name, ''), p.email), 'phone', p.phone, 'email', p.email, 'owner_id_verified', public.is_identity_verified(u.owner_id),
      'verified', exists (select 1 from public.listing_verifications v where v.listing_id = l.id and v.status = 'verified'),
      'review', (select to_jsonb(r) - 'listing_id' from public.urgent_review r where r.listing_id = u.listing_id),
      'offers', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'ref', o.ref, 'source', o.source, 'buyer_no', o.buyer_no, 'amount', o.amount, 'counter_amount', o.counter_amount, 'conditions', o.conditions,
           'status', o.status, 'response_note', o.response_note, 'created_at', o.created_at, 'expires_at', o.expires_at,
           'buyer', (select coalesce(nullif(b.full_name, ''), b.email) || coalesce(' · ' || b.phone, '') from public.profiles b where b.id = o.buyer_id)) order by o.created_at desc) from public.offers_deal o where o.listing_id = u.listing_id), '[]'::jsonb),
      'visits', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'status', i.status, 'preferred_at', i.preferred_at, 'confirmed_at', i.confirmed_at, 'note', i.note,
           'who', (select coalesce(nullif(b.full_name, ''), b.email) || coalesce(' · ' || b.phone, '') from public.profiles b where b.id = i.user_id)) order by i.created_at desc) from public.inspections i where i.listing_id = u.listing_id), '[]'::jsonb),
      'events', coalesce((select jsonb_agg(jsonb_build_object('stage', e.stage, 'kind', e.kind, 'note', e.note, 'actor', e.actor, 'at', e.at) order by e.at) from public.deal_events e where e.listing_id = u.listing_id), '[]'::jsonb),
      'matching_investors', (select count(*) from public.investor_profiles i where i.status = 'approved' and (i.budget_max is null or l.price <= i.budget_max) and (i.budget_min is null or l.price >= i.budget_min)
           and (coalesce(array_length(i.cities, 1), 0) = 0 or exists (select 1 from unnest(i.cities) c where lower(c) = lower(l.city))) and (coalesce(array_length(i.property_types, 1), 0) = 0 or l.property_type = any(i.property_types))))
      order by (u.stage in ('sold','closed','rejected')), u.updated_at desc)
    from public.urgent_requests u join public.listings l on l.id = u.listing_id left join public.profiles p on p.id = u.owner_id), '[]'::jsonb);
end $$;
grant execute on function public.admin_urgent() to authenticated;

create or replace function public.admin_urgent_update(p_listing uuid, p_stage text, p_note text, p_review jsonb, p_reason text)
returns void language plpgsql security definer set search_path = public
as $$
declare u public.urgent_requests; l public.listings;
begin
  if not public.has_perm('urgent') then raise exception 'You do not have permission to manage Urgent Sale.'; end if;
  select * into u from public.urgent_requests where listing_id = p_listing; select * into l from public.listings where id = p_listing;
  if u.listing_id is null then raise exception 'Request not found.'; end if;
  if p_review is not null then
    insert into public.urgent_review (listing_id, valuation_low, valuation_high, raqbo_interest, internal_notes, updated_by, updated_at)
    values (p_listing, nullif(p_review->>'valuation_low', '')::bigint, nullif(p_review->>'valuation_high', '')::bigint, coalesce(nullif(p_review->>'raqbo_interest', ''), 'not_reviewed'), left(coalesce(p_review->>'internal_notes', ''), 3000), auth.uid(), now())
    on conflict (listing_id) do update set valuation_low = excluded.valuation_low, valuation_high = excluded.valuation_high, raqbo_interest = excluded.raqbo_interest, internal_notes = excluded.internal_notes, updated_by = auth.uid(), updated_at = now();
  end if;
  if nullif(p_stage, '') is not null and p_stage is distinct from u.stage then
    if p_stage in ('sold','closed','rejected') and char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Please give a reason to close the request (kept in the audit log).'; end if;
    update public.urgent_requests set stage = p_stage, stage_note = left(coalesce(p_note, ''), 600), updated_at = now() where listing_id = p_listing;
    perform public.deal_event(p_listing, 'stage', p_stage, coalesce(nullif(p_note, ''), public.urgent_stage_label(p_stage)), 'raqbo');
    perform public.notify(u.owner_id, 'deal', 'Urgent sale: ' || public.urgent_stage_label(p_stage), left(l.title, 100) || case when coalesce(p_note, '') <> '' then ' · ' || left(p_note, 140) else '' end, '#my/urgent');
    perform public.audit('urgent.stage', 'listing', l.ref, p_reason, jsonb_build_object('from', u.stage, 'to', p_stage));
    if p_stage = 'sold' then perform set_config('raqbo.sys', '1', true); update public.listings set channel = 'private' where id = p_listing; perform set_config('raqbo.sys', '', true); end if;
  elsif coalesce(p_note, '') <> '' and p_note is distinct from u.stage_note then
    update public.urgent_requests set stage_note = left(p_note, 600), updated_at = now() where listing_id = p_listing;
  end if;
end $$;
grant execute on function public.admin_urgent_update(uuid, text, text, jsonb, text) to authenticated;

create or replace function public.admin_urgent_circulate(p_listing uuid)
returns int language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_perm('urgent') then raise exception 'You do not have permission to manage Urgent Sale.'; end if;
  if not exists (select 1 from public.urgent_requests where listing_id = p_listing and 'investors' = any(options)) then raise exception 'The owner did not choose to offer this property to investors.'; end if;
  if not exists (select 1 from public.listings where id = p_listing and status = 'published') then raise exception 'Approve the listing first (Pending review).'; end if;
  return public.urgent_notify_investors(p_listing);
end $$;
grant execute on function public.admin_urgent_circulate(uuid) to authenticated;

create or replace function public.admin_investors()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.has_perm('investors') then raise exception 'You do not have permission to manage investors.'; end if;
  return coalesce((select jsonb_agg(to_jsonb(i) || jsonb_build_object('member', coalesce(nullif(p.full_name, ''), p.email), 'phone', p.phone, 'email', p.email,
        'id_verified', public.is_identity_verified(i.user_id), 'id_status', (select c.status from public.identity_checks c where c.user_id = i.user_id),
        'offers', (select count(*) from public.offers_deal o where o.buyer_id = i.user_id), 'accepted', (select count(*) from public.offers_deal o where o.buyer_id = i.user_id and o.status = 'accepted'))
      order by (i.status = 'pending') desc, i.updated_at desc)
    from public.investor_profiles i left join public.profiles p on p.id = i.user_id), '[]'::jsonb);
end $$;
grant execute on function public.admin_investors() to authenticated;

create or replace function public.admin_investor_file_paths(p_user uuid)
returns jsonb language sql stable security definer set search_path = public
as $$ select case when public.has_perm('investors') then (select capacity_docs from public.investor_profiles where user_id = p_user) else '[]'::jsonb end $$;
grant execute on function public.admin_investor_file_paths(uuid) to authenticated;

-- Public: urgent listings shown with the URGENT SALE label
create or replace function public.urgent_listing_ids()
returns jsonb language sql stable security definer set search_path = public
as $$ select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'timeframe', u.timeframe)), '[]'::jsonb) from public.listings l join public.urgent_requests u on u.listing_id = l.id
      where l.status = 'published' and l.sale_mode = 'urgent' and l.channel = 'public' and u.stage not in ('sold','closed','rejected') $$;
grant execute on function public.urgent_listing_ids() to anon, authenticated;

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['urgent_requests', 'offers_deal', 'inspections', 'investor_profiles', 'deal_events'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;


-- =====================================================================
-- update_15_auctions.sql (Property Auctions)
-- =====================================================================
-- =====================================================================
-- 22. RAQBO Property Auctions
-- Run after update_14_urgent.sql. Safe to run more than once.
-- Every bid rule is enforced here on the server — never in the browser.
-- =====================================================================

-- ---------- Auctions (one row per auction; a listing can be re-auctioned) ----------
create table if not exists public.auctions (
  id                     uuid primary key default gen_random_uuid(),
  ref                    text unique,
  listing_id             uuid not null references public.listings (id) on delete cascade,
  seller_id              uuid not null references public.profiles (id) on delete cascade,
  status                 text not null default 'requested' check (status in ('requested','scheduled','provisional','reserve_not_met','ended','sold','failed','cancelled','rejected')),
  starting_price         bigint not null check (starting_price > 0),
  reserve_price          bigint check (reserve_price > 0),                  -- private: only the seller and RAQBO
  increment              bigint not null default 100000 check (increment > 0),
  deposit                bigint not null default 0 check (deposit >= 0),
  start_at               timestamptz,
  end_at                 timestamptz,
  original_end_at        timestamptz,
  extensions             int not null default 0,
  max_extensions         int not null default 12,
  ext_window_min         int not null default 5,
  ext_min                int not null default 5,
  buyer_premium_pct      numeric(5,2) not null default 1,
  seller_commission_pct  numeric(5,2) not null default 2,
  preferred_start        date,
  duration_days          int not null default 7 check (duration_days between 1 and 30),
  inspection_info        text not null default '' check (char_length(inspection_info) <= 1000),
  seller_note            text not null default '' check (char_length(seller_note) <= 1000),
  terms                  text not null default '' check (char_length(terms) <= 6000),
  admin_note             text not null default '' check (char_length(admin_note) <= 1000),   -- shown to the seller
  high_amount            bigint,
  high_bidder            uuid,                                               -- auction_bidders.id
  bid_count              int not null default 0,
  reserve_met            boolean not null default false,
  result_note            text not null default '',
  reminded_start         boolean not null default false,
  reminded_end           boolean not null default false,
  created_at             timestamptz not null default now(),
  approved_at            timestamptz,
  finalized_at           timestamptz,
  updated_at             timestamptz not null default now()
);
create index if not exists auctions_status_idx on public.auctions (status, end_at);
create index if not exists auctions_listing_idx on public.auctions (listing_id);
create unique index if not exists auctions_one_open_per_listing on public.auctions (listing_id) where status in ('requested','scheduled','provisional');
alter table public.auctions enable row level security;
drop policy if exists "auctions: seller or admin" on public.auctions;
create policy "auctions: seller or admin" on public.auctions for select using (seller_id = auth.uid() or public.has_perm('auctions'));
revoke insert, update, delete on public.auctions from anon, authenticated;
grant select on public.auctions to authenticated;

create or replace function public.auctions_ref() returns trigger language plpgsql as $$
begin if new.ref is null then new.ref := 'RQ-AUC-' || upper(substr(replace(new.id::text, '-', ''), 1, 7)); end if; return new; end $$;
drop trigger if exists auctions_ref on public.auctions;
create trigger auctions_ref before insert on public.auctions for each row execute function public.auctions_ref();

-- ---------- Registered bidders (anonymous public number per auction) ----------
create table if not exists public.auction_bidders (
  id                 uuid primary key default gen_random_uuid(),
  auction_id         uuid not null references public.auctions (id) on delete cascade,
  user_id            uuid not null references public.profiles (id) on delete cascade,
  bidder_no          int not null,
  status             text not null default 'pending' check (status in ('pending','approved','rejected','suspended')),
  deposit_status     text not null default 'not_required' check (deposit_status in ('not_required','awaiting','submitted','paid','refunded','forfeited')),
  deposit_ref        text not null default '' check (char_length(deposit_ref) <= 80),
  deposit_proof      text not null default '',
  deposit_at         timestamptz,
  terms_accepted_at  timestamptz not null default now(),
  admin_note         text not null default '' check (char_length(admin_note) <= 600),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (auction_id, user_id),
  unique (auction_id, bidder_no)
);
alter table public.auction_bidders enable row level security;
drop policy if exists "auction_bidders: own or admin" on public.auction_bidders;
create policy "auction_bidders: own or admin" on public.auction_bidders for select using (user_id = auth.uid() or public.has_perm('auctions'));
revoke insert, update, delete on public.auction_bidders from anon, authenticated;
grant select on public.auction_bidders to authenticated;

-- ---------- Bids (append-only; only an admin can void one, with a reason) ----------
create table if not exists public.auction_bids (
  id            bigserial primary key,
  auction_id    uuid not null references public.auctions (id) on delete cascade,
  bidder_id     uuid not null references public.auction_bidders (id) on delete cascade,
  amount        bigint not null check (amount > 0),
  created_at    timestamptz not null default now(),
  extended      boolean not null default false,
  voided        boolean not null default false,
  void_reason   text not null default '',
  voided_by     uuid,
  voided_at     timestamptz
);
create index if not exists auction_bids_auction_idx on public.auction_bids (auction_id, amount desc, created_at);
alter table public.auction_bids enable row level security;
drop policy if exists "auction_bids: admin" on public.auction_bids;
create policy "auction_bids: admin" on public.auction_bids for select using (public.has_perm('auctions'));
revoke insert, update, delete on public.auction_bids from anon, authenticated;
grant select on public.auction_bids to authenticated;

create or replace function public.auction_bids_lock() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Bids cannot be deleted.'; end if;
  if new.amount <> old.amount or new.bidder_id <> old.bidder_id or new.created_at <> old.created_at or new.auction_id <> old.auction_id then raise exception 'Bids cannot be changed.'; end if;
  if old.voided and not new.voided then raise exception 'A voided bid cannot be restored.'; end if;
  return new;
end $$;
drop trigger if exists auction_bids_lock on public.auction_bids;
create trigger auction_bids_lock before update or delete on public.auction_bids for each row execute function public.auction_bids_lock();

-- ---------- Watchlist (reminders) ----------
create table if not exists public.auction_watch (
  auction_id  uuid not null references public.auctions (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (auction_id, user_id)
);
alter table public.auction_watch enable row level security;
drop policy if exists "auction_watch: own" on public.auction_watch;
create policy "auction_watch: own" on public.auction_watch for select using (user_id = auth.uid());
revoke insert, update, delete on public.auction_watch from anon, authenticated;
grant select on public.auction_watch to authenticated;

-- ---------- Helpers ----------
create or replace function public.auction_phase(a public.auctions)
returns text language sql stable as $$
  select case
    when a.status = 'scheduled' and now() < a.start_at then 'upcoming'
    when a.status = 'scheduled' and now() < a.end_at then case when a.end_at - now() <= interval '1 hour' then 'closing' else 'live' end
    when a.status = 'scheduled' then 'ended'
    else a.status end $$;

create or replace function public.auction_min_bid(a public.auctions)
returns bigint language sql stable as $$ select case when a.high_amount is null then a.starting_price else a.high_amount + a.increment end $$;

create or replace function public.rs_fmt(n bigint) returns text language sql immutable as $$ select 'Rs ' || to_char(coalesce(n, 0), 'FM999,999,999,999') $$;

-- Recalculate the leading bid from valid bids (after a void)
create or replace function public.auction_recalc(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare b record;
begin
  select bid.amount, bid.bidder_id into b from public.auction_bids bid where bid.auction_id = p_id and not bid.voided order by bid.amount desc, bid.created_at asc limit 1;
  update public.auctions a set high_amount = b.amount, high_bidder = b.bidder_id,
    bid_count = (select count(*) from public.auction_bids x where x.auction_id = p_id and not x.voided),
    reserve_met = b.amount is not null and (a.reserve_price is null or b.amount >= a.reserve_price), updated_at = now() where a.id = p_id;
end $$;
revoke all on function public.auction_recalc(uuid) from public, anon, authenticated;

-- Close one auction whose time is up: Provisional Winning Bidder, or Reserve Not Met
create or replace function public.auction_finalize(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a public.auctions; l public.listings; w record; r record;
begin
  select * into a from public.auctions where id = p_id for update;
  if a.id is null or a.status <> 'scheduled' or now() < a.end_at then return; end if;
  select * into l from public.listings where id = a.listing_id;
  if a.high_amount is not null and (a.reserve_price is null or a.high_amount >= a.reserve_price) then
    update public.auctions set status = 'provisional', reserve_met = true, finalized_at = now(), updated_at = now(),
      result_note = 'Highest bid ' || public.rs_fmt(a.high_amount) || '. Provisional — subject to deposit, documents, payment and the final agreement.' where id = a.id;
    select bd.user_id, bd.bidder_no into w from public.auction_bidders bd where bd.id = a.high_bidder;
    perform public.notify(w.user_id, 'auction', 'You are the Provisional Winning Bidder', left(l.title, 80) || ' · ' || public.rs_fmt(a.high_amount) || '. RAQBO will contact you about the next steps.', '#my/bids');
    perform public.notify(a.seller_id, 'auction', 'Auction ended — reserve met', left(l.title, 80) || ' · highest bid ' || public.rs_fmt(a.high_amount) || ' (Bidder ' || w.bidder_no || ')', '#my/auctions');
  else
    update public.auctions set status = 'reserve_not_met', reserve_met = false, finalized_at = now(), updated_at = now(),
      result_note = case when a.high_amount is null then 'No bids were placed.' else 'Highest bid ' || public.rs_fmt(a.high_amount) || ' did not reach the reserve price.' end where id = a.id;
    perform public.notify(a.seller_id, 'auction', 'Auction ended — reserve not met', left(l.title, 80) || case when a.high_amount is null then ' · no bids' else ' · highest bid ' || public.rs_fmt(a.high_amount) end || '. RAQBO will discuss the options with you.', '#my/auctions');
  end if;
  for r in select bd.user_id from public.auction_bidders bd where bd.auction_id = a.id and bd.status = 'approved' and bd.id is distinct from a.high_bidder loop
    perform public.notify(r.user_id, 'auction', 'Auction ended', left(l.title, 80) || ' · the auction has closed.', '#my/bids');
  end loop;
  perform public.notify_admins('auction', 'Auction ended: ' || a.ref, case when a.high_amount is not null and (a.reserve_price is null or a.high_amount >= a.reserve_price) then 'Provisional winner at ' || public.rs_fmt(a.high_amount) else 'Reserve not met' end, '#admin/auctions');
end $$;
revoke all on function public.auction_finalize(uuid) from public, anon, authenticated;

-- Close due auctions and send reminders. Called by every auction read, and by pg_cron every minute when available.
create or replace function public.auction_tick()
returns int language plpgsql security definer set search_path = public as $$
declare a record; r record; n int := 0;
begin
  for a in select id from public.auctions where status = 'scheduled' and end_at <= now() loop perform public.auction_finalize(a.id); n := n + 1; end loop;
  for a in select x.*, l.title from public.auctions x join public.listings l on l.id = x.listing_id where x.status = 'scheduled' and not x.reminded_start and x.start_at <= now() + interval '1 hour' and x.end_at > now() loop
    update public.auctions set reminded_start = true where id = a.id;
    for r in select user_id from public.auction_watch where auction_id = a.id union select user_id from public.auction_bidders where auction_id = a.id and status = 'approved' loop
      perform public.notify(r.user_id, 'auction', case when a.start_at <= now() then 'Auction is live' else 'Auction starts soon' end, left(a.title, 80) || ' · starting bid ' || public.rs_fmt(a.starting_price), '#auction/' || a.id);
    end loop;
  end loop;
  for a in select x.*, l.title from public.auctions x join public.listings l on l.id = x.listing_id where x.status = 'scheduled' and not x.reminded_end and x.start_at <= now() and x.end_at <= now() + interval '1 hour' and x.end_at > now() loop
    update public.auctions set reminded_end = true where id = a.id;
    for r in select user_id from public.auction_watch where auction_id = a.id union select user_id from public.auction_bidders where auction_id = a.id and status = 'approved' loop
      perform public.notify(r.user_id, 'auction', 'Auction closing within the hour', left(a.title, 80) || ' · current bid ' || coalesce(public.rs_fmt(a.high_amount), 'none yet'), '#auction/' || a.id);
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.auction_tick() from public, anon, authenticated;

-- ---------- Seller: request an auction ----------
create or replace function public.request_auction(p_listing uuid, p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare l public.listings; s public.platform_settings; v_start bigint; v_res bigint; a_id uuid; v_ref text;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  select * into s from public.platform_settings limit 1;
  if not coalesce(s.auctions_enabled, true) then raise exception 'Auctions are not open right now.'; end if;
  select * into l from public.listings where id = p_listing;
  if l.id is null or l.owner_id is distinct from auth.uid() then raise exception 'You can only auction your own property.'; end if;
  if l.purpose <> 'sale' then raise exception 'Auctions are for properties for sale.'; end if;
  if not public.is_identity_verified(auth.uid()) then raise exception 'Verify your identity (CNIC) first — My RAQBO → Identity check.'; end if;
  if exists (select 1 from public.auctions where listing_id = l.id and status in ('requested','scheduled','provisional')) then raise exception 'This property already has an auction in progress.'; end if;
  if exists (select 1 from public.urgent_requests where listing_id = l.id and stage not in ('sold','closed','rejected')) then raise exception 'This property has an open Urgent Sale request. Close it before choosing an auction.'; end if;
  v_start := nullif(p->>'starting_price', '')::bigint; v_res := nullif(p->>'reserve_price', '')::bigint;
  if coalesce(v_start, 0) < 100000 then raise exception 'Enter a starting price (at least Rs 100,000).'; end if;
  if v_res is not null and v_res < v_start then raise exception 'The reserve price cannot be lower than the starting price.'; end if;
  insert into public.auctions (listing_id, seller_id, starting_price, reserve_price, increment, deposit, preferred_start, duration_days, inspection_info, seller_note,
      max_extensions, ext_window_min, ext_min, buyer_premium_pct, seller_commission_pct)
  values (l.id, auth.uid(), v_start, v_res, coalesce(s.auction_default_increment, 100000), coalesce(s.auction_deposit_default, 0),
      nullif(p->>'preferred_start', '')::date, least(30, greatest(1, coalesce(nullif(p->>'duration_days', '')::int, 7))),
      left(coalesce(p->>'inspection_info', ''), 1000), left(coalesce(p->>'seller_note', ''), 1000),
      coalesce(s.auction_max_extensions, 12), coalesce(s.auction_extension_window_min, 5), coalesce(s.auction_extension_min, 5),
      coalesce(s.auction_buyer_premium_pct, 1), coalesce(s.auction_seller_commission_pct, 2))
  returning id, ref into a_id, v_ref;
  perform public.notify_admins('auction', 'Auction request: ' || left(l.title, 80), coalesce(l.ref, '') || ' · starting ' || public.rs_fmt(v_start), '#admin/auctions');
  return v_ref;
end $$;
grant execute on function public.request_auction(uuid, jsonb) to authenticated;

create or replace function public.seller_withdraw_auction(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a public.auctions;
begin
  select * into a from public.auctions where id = p_id and seller_id = auth.uid() for update;
  if a.id is null then raise exception 'Auction not found.'; end if;
  if a.status = 'requested' or (a.status = 'scheduled' and now() < a.start_at and a.bid_count = 0) then
    update public.auctions set status = 'cancelled', result_note = 'Withdrawn by the seller before bidding started.', updated_at = now() where id = a.id;
    perform set_config('raqbo.sys', '1', true); update public.listings set sale_mode = 'normal' where id = a.listing_id and sale_mode = 'auction'; perform set_config('raqbo.sys', '', true);
    perform public.notify_admins('auction', 'Auction withdrawn by seller: ' || a.ref, '', '#admin/auctions');
  else raise exception 'Once bidding has started, only RAQBO can cancel an auction. Message RAQBO.'; end if;
end $$;
grant execute on function public.seller_withdraw_auction(uuid) to authenticated;

-- ---------- Admin: approve / schedule / change terms ----------
create or replace function public.admin_auction_save(p_id uuid, p jsonb, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.auctions; l public.listings; v_start timestamptz; v_end timestamptz; act text;
begin
  if not public.has_perm('auctions') then raise exception 'You do not have permission to manage auctions.'; end if;
  select * into a from public.auctions where id = p_id for update;
  if a.id is null then raise exception 'Auction not found.'; end if;
  select * into l from public.listings where id = a.listing_id;
  act := coalesce(nullif(p->>'action', ''), 'save');
  if act = 'reject' then
    if a.status <> 'requested' then raise exception 'Only a new request can be rejected.'; end if;
    if char_length(btrim(coalesce(p->>'admin_note', ''))) < 3 then raise exception 'Write a short reason for the seller.'; end if;
    update public.auctions set status = 'rejected', admin_note = left(p->>'admin_note', 1000), updated_at = now() where id = a.id;
    perform public.notify(a.seller_id, 'auction', 'Auction request not approved', p->>'admin_note', '#my/auctions');
    perform public.audit('auction.reject', 'auction', a.ref, coalesce(p_reason, p->>'admin_note'), '{}'::jsonb);
    return;
  end if;
  if a.status not in ('requested','scheduled') then raise exception 'This auction can no longer be edited.'; end if;
  if a.status = 'scheduled' and (a.bid_count > 0 or now() >= a.start_at) then raise exception 'Bidding has started — the rules cannot change now. Cancel the auction with a reason if needed.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Please give a reason (it is kept in the audit log).'; end if;
  v_start := coalesce(nullif(p->>'start_at', '')::timestamptz, a.start_at);
  v_end := coalesce(nullif(p->>'end_at', '')::timestamptz, a.end_at);
  if act = 'approve' then
    if l.status <> 'published' then raise exception 'Approve the property listing first (Pending review).'; end if;
    if v_start is null or v_end is null then raise exception 'Set the start and end time.'; end if;
  end if;
  if v_start is not null and v_end is not null and v_end <= v_start + interval '10 minutes' then raise exception 'The auction must run for at least 10 minutes.'; end if;
  if act = 'approve' and v_end <= now() then raise exception 'The end time must be in the future.'; end if;
  update public.auctions set
    starting_price = coalesce(nullif(p->>'starting_price', '')::bigint, starting_price),
    reserve_price = case when p ? 'reserve_price' then nullif(p->>'reserve_price', '')::bigint else reserve_price end,
    increment = coalesce(nullif(p->>'increment', '')::bigint, increment),
    deposit = coalesce(nullif(p->>'deposit', '')::bigint, deposit),
    start_at = v_start, end_at = v_end, original_end_at = v_end,
    max_extensions = coalesce(nullif(p->>'max_extensions', '')::int, max_extensions),
    ext_window_min = coalesce(nullif(p->>'ext_window_min', '')::int, ext_window_min),
    ext_min = coalesce(nullif(p->>'ext_min', '')::int, ext_min),
    buyer_premium_pct = coalesce(nullif(p->>'buyer_premium_pct', '')::numeric, buyer_premium_pct),
    seller_commission_pct = coalesce(nullif(p->>'seller_commission_pct', '')::numeric, seller_commission_pct),
    inspection_info = coalesce(p->>'inspection_info', inspection_info),
    terms = coalesce(p->>'terms', terms),
    admin_note = coalesce(p->>'admin_note', admin_note),
    status = case when act = 'approve' then 'scheduled' else status end,
    approved_at = case when act = 'approve' then now() else approved_at end,
    reminded_start = false, reminded_end = false, updated_at = now()
  where id = a.id;
  select * into a from public.auctions where id = p_id;
  if a.reserve_price is not null and a.reserve_price < a.starting_price then raise exception 'The reserve price cannot be lower than the starting price.'; end if;
  if a.status = 'scheduled' then
    perform set_config('raqbo.sys', '1', true); update public.listings set sale_mode = 'auction', channel = 'public' where id = a.listing_id; perform set_config('raqbo.sys', '', true);
    -- deposit rule changed: bidders who now need a deposit must pay it
    update public.auction_bidders set deposit_status = 'awaiting' where auction_id = a.id and a.deposit > 0 and deposit_status = 'not_required';
    update public.auction_bidders set deposit_status = 'not_required' where auction_id = a.id and a.deposit = 0 and deposit_status in ('awaiting');
  end if;
  if act = 'approve' then
    perform public.notify(a.seller_id, 'auction', 'Your auction is approved', left(l.title, 80) || ' · bidding opens ' || to_char(a.start_at at time zone 'Asia/Karachi', 'DD Mon HH24:MI'), '#my/auctions');
  end if;
  perform public.audit(case when act = 'approve' then 'auction.approve' else 'auction.edit' end, 'auction', a.ref, p_reason,
    jsonb_build_object('starting', a.starting_price, 'reserve', a.reserve_price, 'increment', a.increment, 'deposit', a.deposit, 'start', a.start_at, 'end', a.end_at));
end $$;
grant execute on function public.admin_auction_save(uuid, jsonb, text) to authenticated;

create or replace function public.admin_auction_cancel(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.auctions; r record; l public.listings;
begin
  if not public.has_perm('auctions') then raise exception 'You do not have permission to manage auctions.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Please give the reason for cancelling (shown to bidders and kept in the audit log).'; end if;
  select * into a from public.auctions where id = p_id for update;
  if a.id is null or a.status not in ('requested','scheduled','provisional') then raise exception 'This auction cannot be cancelled.'; end if;
  select * into l from public.listings where id = a.listing_id;
  update public.auctions set status = 'cancelled', result_note = 'Cancelled by RAQBO: ' || left(p_reason, 300), updated_at = now() where id = a.id;
  perform set_config('raqbo.sys', '1', true); update public.listings set sale_mode = 'normal' where id = a.listing_id and sale_mode = 'auction'; perform set_config('raqbo.sys', '', true);
  for r in select user_id from public.auction_bidders where auction_id = a.id union select a.seller_id loop
    perform public.notify(r.user_id, 'auction', 'Auction cancelled', left(l.title, 80) || ' · ' || left(p_reason, 200), '#my/bids');
  end loop;
  perform public.audit('auction.cancel', 'auction', a.ref, p_reason, jsonb_build_object('bids', a.bid_count, 'high', a.high_amount));
end $$;
grant execute on function public.admin_auction_cancel(uuid, text) to authenticated;

-- After the auction: confirm the sale, or record that the winner did not complete
create or replace function public.admin_auction_result(p_id uuid, p_result text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.auctions; w record; l public.listings;
begin
  if not public.has_perm('auctions') then raise exception 'You do not have permission to manage auctions.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Please give a reason (it is kept in the audit log).'; end if;
  select * into a from public.auctions where id = p_id for update;
  if a.id is null or a.status not in ('provisional','reserve_not_met') then raise exception 'Only a finished auction can be completed.'; end if;
  if p_result not in ('sold','failed','ended') then raise exception 'Unknown result.'; end if;
  if p_result = 'sold' and a.status <> 'provisional' then raise exception 'There is no provisional winner to confirm.'; end if;
  select * into l from public.listings where id = a.listing_id;
  update public.auctions set status = p_result, result_note = left(p_reason, 500), updated_at = now() where id = a.id;
  select bd.user_id into w from public.auction_bidders bd where bd.id = a.high_bidder;
  perform set_config('raqbo.sys', '1', true);
  if p_result = 'sold' then update public.listings set channel = 'private' where id = a.listing_id;
  else update public.listings set sale_mode = 'normal' where id = a.listing_id; end if;
  perform set_config('raqbo.sys', '', true);
  if p_result = 'failed' and w.user_id is not null then update public.auction_bidders set deposit_status = case when deposit_status = 'paid' then 'forfeited' else deposit_status end where id = a.high_bidder; end if;
  perform public.notify(a.seller_id, 'auction', case p_result when 'sold' then 'Auction sale completed' when 'failed' then 'Winning bidder did not complete' else 'Auction closed' end, left(l.title, 80) || ' · ' || left(p_reason, 200), '#my/auctions');
  if w.user_id is not null then perform public.notify(w.user_id, 'auction', case p_result when 'sold' then 'Purchase completed' when 'failed' then 'Auction purchase not completed' else 'Auction closed' end, left(l.title, 80) || ' · ' || left(p_reason, 200), '#my/bids'); end if;
  perform public.audit('auction.' || p_result, 'auction', a.ref, p_reason, jsonb_build_object('high', a.high_amount));
end $$;
grant execute on function public.admin_auction_result(uuid, text, text) to authenticated;

-- ---------- Bidders ----------
create or replace function public.register_bidder(p_auction uuid, p_accept_terms boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.auctions; s public.platform_settings; b public.auction_bidders; v_no int; auto boolean;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  perform public.auction_tick();
  select * into a from public.auctions where id = p_auction for update;
  if a.id is null or a.status <> 'scheduled' or now() >= a.end_at then raise exception 'Registration is closed for this auction.'; end if;
  if a.seller_id = auth.uid() then raise exception 'You cannot bid on your own property.'; end if;
  if not coalesce(p_accept_terms, false) then raise exception 'Please accept the auction terms.'; end if;
  if not public.is_identity_verified(auth.uid()) then raise exception 'Verify your identity (CNIC) first — My RAQBO → Identity check. Only verified members can bid.'; end if;
  select * into b from public.auction_bidders where auction_id = a.id and user_id = auth.uid();
  if b.id is not null then return to_jsonb(b) - 'deposit_proof'; end if;
  select * into s from public.platform_settings limit 1; auto := coalesce(s.bidder_auto_approve, false);
  select coalesce(max(bidder_no), 0) + 1 into v_no from public.auction_bidders where auction_id = a.id;
  insert into public.auction_bidders (auction_id, user_id, bidder_no, status, deposit_status)
  values (a.id, auth.uid(), v_no, case when auto and a.deposit = 0 then 'approved' else 'pending' end, case when a.deposit > 0 then 'awaiting' else 'not_required' end)
  returning * into b;
  insert into public.auction_watch (auction_id, user_id) values (a.id, auth.uid()) on conflict do nothing;
  if b.status = 'pending' then perform public.notify_admins('auction', 'Bidder registration: ' || a.ref, 'Bidder ' || v_no || case when a.deposit > 0 then ' · deposit ' || public.rs_fmt(a.deposit) || ' to receive' else '' end, '#admin/auctions'); end if;
  return to_jsonb(b) - 'deposit_proof';
end $$;
grant execute on function public.register_bidder(uuid, boolean) to authenticated;

create or replace function public.submit_bidder_deposit(p_auction uuid, p_ref text, p_proof text)
returns void language plpgsql security definer set search_path = public as $$
declare b public.auction_bidders; a public.auctions;
begin
  select * into b from public.auction_bidders where auction_id = p_auction and user_id = auth.uid() for update;
  if b.id is null then raise exception 'Register for this auction first.'; end if;
  if b.deposit_status not in ('awaiting','submitted') then raise exception 'No deposit is due for this registration.'; end if;
  if char_length(btrim(coalesce(p_ref, ''))) < 4 then raise exception 'Enter the bank transaction ID.'; end if;
  if nullif(p_proof, '') is not null and p_proof not like auth.uid()::text || '/%' then raise exception 'Upload the receipt again.'; end if;
  select * into a from public.auctions where id = p_auction;
  update public.auction_bidders set deposit_status = 'submitted', deposit_ref = left(btrim(p_ref), 80), deposit_proof = coalesce(p_proof, ''), deposit_at = now(), updated_at = now() where id = b.id;
  perform public.notify_admins('auction', 'Auction deposit sent: ' || a.ref, 'Bidder ' || b.bidder_no || ' · ' || public.rs_fmt(a.deposit) || ' · ' || left(p_ref, 40), '#admin/auctions');
end $$;
grant execute on function public.submit_bidder_deposit(uuid, text, text) to authenticated;

create or replace function public.admin_decide_bidder(p_bidder uuid, p_status text, p_deposit text, p_note text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare b public.auction_bidders; a public.auctions; l public.listings;
begin
  if not public.has_perm('auctions') then raise exception 'You do not have permission to manage bidders.'; end if;
  select * into b from public.auction_bidders where id = p_bidder for update;
  if b.id is null then raise exception 'Bidder not found.'; end if;
  select * into a from public.auctions where id = b.auction_id; select * into l from public.listings where id = a.listing_id;
  if p_status not in ('pending','approved','rejected','suspended') then raise exception 'Unknown status.'; end if;
  if nullif(p_deposit, '') is not null and p_deposit not in ('not_required','awaiting','submitted','paid','refunded','forfeited') then raise exception 'Unknown deposit status.'; end if;
  if p_status = 'approved' and a.deposit > 0 and coalesce(nullif(p_deposit, ''), b.deposit_status) not in ('paid') then raise exception 'Mark the deposit as received before approving this bidder.'; end if;
  if p_status in ('rejected','suspended') and char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Write a short reason for the bidder.'; end if;
  if coalesce(nullif(p_deposit, ''), b.deposit_status) in ('refunded','forfeited') and char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Please give a reason for the deposit decision (kept in the audit log).'; end if;
  update public.auction_bidders set status = p_status, deposit_status = coalesce(nullif(p_deposit, ''), deposit_status), admin_note = left(coalesce(p_note, ''), 600), updated_at = now() where id = b.id;
  perform public.notify(b.user_id, 'auction', case p_status when 'approved' then 'You are approved to bid — Bidder ' || b.bidder_no when 'suspended' then 'Your bidding is paused' when 'rejected' then 'Bidder registration not approved' else 'Bidder registration updated' end,
    left(l.title, 80) || case when coalesce(p_note, '') <> '' then ' · ' || left(p_note, 200) else '' end, '#auction/' || a.id);
  perform public.audit('auction.bidder_' || p_status, 'auction', a.ref, coalesce(nullif(p_reason, ''), p_note), jsonb_build_object('bidder_no', b.bidder_no, 'deposit', coalesce(nullif(p_deposit, ''), b.deposit_status)));
end $$;
grant execute on function public.admin_decide_bidder(uuid, text, text, text, text) to authenticated;

-- ---------- Place a bid (row lock, increments, anti-sniping) ----------
create or replace function public.place_bid(p_auction uuid, p_amount bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.auctions; b public.auction_bidders; prev uuid; prev_user uuid; l public.listings; ext boolean := false; v_min bigint; new_end timestamptz;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  select * into a from public.auctions where id = p_auction for update;      -- one bid at a time per auction
  if a.id is null then raise exception 'Auction not found.'; end if;
  if a.status = 'scheduled' and now() >= a.end_at then raise exception 'This auction has ended.'; end if;
  if a.status <> 'scheduled' then raise exception 'This auction is not open for bidding.'; end if;
  if now() < a.start_at then raise exception 'Bidding has not started yet.'; end if;
  if a.seller_id = auth.uid() then raise exception 'You cannot bid on your own property.'; end if;
  select * into b from public.auction_bidders where auction_id = a.id and user_id = auth.uid();
  if b.id is null then raise exception 'Register to bid first.'; end if;
  if b.status <> 'approved' then raise exception '%', case b.status when 'pending' then 'RAQBO has not approved your registration yet.' when 'suspended' then 'Your bidding on this auction is paused.' else 'You are not approved to bid on this auction.' end; end if;
  if a.deposit > 0 and b.deposit_status <> 'paid' then raise exception 'Your deposit has not been confirmed yet.'; end if;
  if a.high_bidder = b.id then raise exception 'You already have the highest bid.'; end if;
  v_min := public.auction_min_bid(a);
  if p_amount is null or p_amount < v_min then raise exception 'The minimum bid is %.', public.rs_fmt(v_min); end if;
  if a.high_amount is not null and (p_amount - a.high_amount) % a.increment <> 0 then raise exception 'Bids go up in steps of %. Try % or %.', public.rs_fmt(a.increment), public.rs_fmt(v_min), public.rs_fmt(v_min + a.increment); end if;
  if p_amount > greatest(v_min, a.starting_price) * 3 then raise exception 'That bid looks too high. Check the amount (max %).', public.rs_fmt(greatest(v_min, a.starting_price) * 3); end if;
  prev := a.high_bidder;
  if a.end_at - now() <= make_interval(mins => a.ext_window_min) and a.extensions < a.max_extensions and a.ext_min > 0 then
    new_end := greatest(a.end_at, now() + make_interval(mins => a.ext_min)); ext := new_end > a.end_at;
  end if;
  insert into public.auction_bids (auction_id, bidder_id, amount, extended) values (a.id, b.id, p_amount, ext);
  update public.auctions set high_amount = p_amount, high_bidder = b.id, bid_count = bid_count + 1,
    reserve_met = reserve_price is null or p_amount >= reserve_price,
    end_at = case when ext then new_end else end_at end, extensions = extensions + case when ext then 1 else 0 end,
    reminded_end = case when ext then false else reminded_end end, updated_at = now()
  where id = a.id;
  select * into l from public.listings where id = a.listing_id;
  if prev is not null and prev <> b.id then
    select user_id into prev_user from public.auction_bidders where id = prev;
    perform public.notify(prev_user, 'auction', 'You have been outbid', left(l.title, 80) || ' · new highest bid ' || public.rs_fmt(p_amount), '#auction/' || a.id);
  end if;
  perform public.notify(a.seller_id, 'auction', 'New bid: ' || public.rs_fmt(p_amount), left(l.title, 80) || ' · Bidder ' || b.bidder_no || case when ext then ' · time extended' else '' end, '#my/auctions');
  return jsonb_build_object('amount', p_amount, 'bidder_no', b.bidder_no, 'extended', ext, 'end_at', (select end_at from public.auctions where id = a.id));
end $$;
grant execute on function public.place_bid(uuid, bigint) to authenticated;

create or replace function public.admin_void_bid(p_bid bigint, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare x public.auction_bids; a public.auctions; was text;
begin
  if not public.has_perm('auctions') then raise exception 'You do not have permission to void bids.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Please give the reason for voiding this bid (kept in the audit log).'; end if;
  select * into x from public.auction_bids where id = p_bid;
  if x.id is null or x.voided then raise exception 'Bid not found or already voided.'; end if;
  select * into a from public.auctions where id = x.auction_id for update; was := a.status;
  if a.status not in ('scheduled','provisional','reserve_not_met') then raise exception 'Bids can no longer be changed on this auction.'; end if;
  update public.auction_bids set voided = true, void_reason = left(p_reason, 300), voided_by = auth.uid(), voided_at = now() where id = x.id;
  perform public.auction_recalc(a.id);
  if was in ('provisional','reserve_not_met') then        -- re-decide the result from the remaining valid bids
    update public.auctions set status = 'scheduled', end_at = least(end_at, now()) where id = a.id;
    perform public.auction_finalize(a.id);
  end if;
  perform public.audit('auction.void_bid', 'auction', a.ref, p_reason, jsonb_build_object('bid', x.id, 'amount', x.amount));
end $$;
grant execute on function public.admin_void_bid(bigint, text) to authenticated;

create or replace function public.toggle_auction_watch(p_auction uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Please sign in to get reminders.'; end if;
  if exists (select 1 from public.auction_watch where auction_id = p_auction and user_id = auth.uid()) then
    delete from public.auction_watch where auction_id = p_auction and user_id = auth.uid(); return false;
  end if;
  insert into public.auction_watch (auction_id, user_id) values (p_auction, auth.uid()); return true;
end $$;
grant execute on function public.toggle_auction_watch(uuid) to authenticated;

-- ---------- Public reads ----------
create or replace function public.auction_card(a public.auctions, l public.listings)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', a.id, 'ref', a.ref, 'listing_id', a.listing_id, 'title', l.title, 'city', l.city, 'area', l.area, 'type', l.property_type,
    'size', l.size, 'size_unit', l.size_unit, 'listing_ref', l.ref, 'phase', public.auction_phase(a), 'status', a.status,
    'starting_price', a.starting_price, 'high_amount', a.high_amount, 'bid_count', a.bid_count, 'min_bid', public.auction_min_bid(a), 'increment', a.increment,
    'deposit', a.deposit, 'start_at', a.start_at, 'end_at', a.end_at, 'extensions', a.extensions, 'has_reserve', a.reserve_price is not null, 'reserve_met', a.reserve_met,
    'bidders', (select count(*) from public.auction_bidders bd where bd.auction_id = a.id and bd.status = 'approved'),
    'watching', exists (select 1 from public.auction_watch w where w.auction_id = a.id and w.user_id = auth.uid()))
$$;
revoke all on function public.auction_card(public.auctions, public.listings) from public, anon, authenticated;

create or replace function public.auctions_public()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.auction_tick();
  return jsonb_build_object('now', now(), 'auctions', coalesce((select jsonb_agg(public.auction_card(a, l) order by a.end_at)
    from public.auctions a join public.listings l on l.id = a.listing_id
    where l.status = 'published' and (a.status in ('scheduled','provisional','sold') or (a.status in ('reserve_not_met','ended') and a.finalized_at > now() - interval '30 days'))
      and (a.status not in ('sold') or a.finalized_at > now() - interval '60 days')), '[]'::jsonb));
end $$;
grant execute on function public.auctions_public() to anon, authenticated;

create or replace function public.auction_state(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.auctions; l public.listings; me public.auction_bidders; s public.platform_settings;
begin
  perform public.auction_tick();
  select * into a from public.auctions where id = p_id;
  if a.id is null then return null; end if;
  if a.status in ('requested','rejected') then
    if not coalesce(a.seller_id = auth.uid(), false) and not public.has_perm('auctions') then return null; end if;
  end if;
  select * into l from public.listings where id = a.listing_id;
  select * into me from public.auction_bidders where auction_id = a.id and user_id = auth.uid();
  select * into s from public.platform_settings limit 1;
  return public.auction_card(a, l) || jsonb_build_object('now', now(), 'inspection_info', a.inspection_info, 'terms', a.terms, 'result_note', a.result_note,
    'buyer_premium_pct', a.buyer_premium_pct, 'seller_commission_pct', a.seller_commission_pct, 'ext_window_min', a.ext_window_min, 'ext_min', a.ext_min, 'max_extensions', a.max_extensions,
    'original_end_at', a.original_end_at, 'is_seller', a.seller_id = auth.uid(),
    'reserve_price', case when a.seller_id = auth.uid() then a.reserve_price end,
    'leader_no', (select bidder_no from public.auction_bidders where id = a.high_bidder),
    'bids', coalesce((select jsonb_agg(jsonb_build_object('no', bd.bidder_no, 'amount', x.amount, 'at', x.created_at, 'extended', x.extended, 'mine', bd.user_id = auth.uid()) order by x.amount desc, x.created_at)
       from (select * from public.auction_bids where auction_id = a.id and not voided order by amount desc limit 50) x join public.auction_bidders bd on bd.id = x.bidder_id), '[]'::jsonb),
    'me', case when me.id is null then null else jsonb_build_object('bidder_no', me.bidder_no, 'status', me.status, 'deposit_status', me.deposit_status, 'admin_note', me.admin_note, 'leading', a.high_bidder = me.id,
       'my_high', (select max(amount) from public.auction_bids where bidder_id = me.id and not voided)) end,
    'identity_verified', public.is_identity_verified(auth.uid()));
end $$;
grant execute on function public.auction_state(uuid) to anon, authenticated;

-- ---------- Member dashboards ----------
create or replace function public.my_auctions()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  perform public.auction_tick();
  return jsonb_build_object(
    'selling', coalesce((select jsonb_agg(public.auction_card(a, l) || jsonb_build_object('reserve_price', a.reserve_price, 'admin_note', a.admin_note, 'result_note', a.result_note,
        'preferred_start', a.preferred_start, 'duration_days', a.duration_days, 'buyer_premium_pct', a.buyer_premium_pct, 'seller_commission_pct', a.seller_commission_pct,
        'registered', (select count(*) from public.auction_bidders bd where bd.auction_id = a.id), 'watchers', (select count(*) from public.auction_watch w where w.auction_id = a.id),
        'leader_no', (select bidder_no from public.auction_bidders where id = a.high_bidder)) order by a.created_at desc)
      from public.auctions a join public.listings l on l.id = a.listing_id where a.seller_id = auth.uid()), '[]'::jsonb),
    'bidding', coalesce((select jsonb_agg(public.auction_card(a, l) || jsonb_build_object('bidder_no', bd.bidder_no, 'reg_status', bd.status, 'deposit_status', bd.deposit_status, 'admin_note', bd.admin_note,
        'leading', a.high_bidder = bd.id, 'result_note', case when a.high_bidder = bd.id then a.result_note else '' end,
        'my_bids', coalesce((select jsonb_agg(jsonb_build_object('amount', x.amount, 'at', x.created_at, 'voided', x.voided) order by x.created_at desc) from public.auction_bids x where x.bidder_id = bd.id), '[]'::jsonb)) order by a.end_at desc)
      from public.auction_bidders bd join public.auctions a on a.id = bd.auction_id join public.listings l on l.id = a.listing_id where bd.user_id = auth.uid()), '[]'::jsonb),
    'watching', coalesce((select jsonb_agg(public.auction_card(a, l) order by a.end_at)
      from public.auction_watch w join public.auctions a on a.id = w.auction_id join public.listings l on l.id = a.listing_id
      where w.user_id = auth.uid() and a.status = 'scheduled' and not exists (select 1 from public.auction_bidders bd where bd.auction_id = a.id and bd.user_id = auth.uid())), '[]'::jsonb));
end $$;
grant execute on function public.my_auctions() to authenticated;

-- ---------- Admin ----------
create or replace function public.admin_auctions()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('auctions') then raise exception 'You do not have permission to see auctions.'; end if;
  perform public.auction_tick();
  return coalesce((select jsonb_agg(public.auction_card(a, l) || jsonb_build_object('reserve_price', a.reserve_price, 'seller', coalesce(nullif(p.full_name, ''), p.email), 'seller_phone', p.phone, 'seller_email', p.email,
      'seller_id_verified', public.is_identity_verified(a.seller_id), 'listing_status', l.status, 'listing_price', l.price, 'preferred_start', a.preferred_start, 'duration_days', a.duration_days,
      'inspection_info', a.inspection_info, 'seller_note', a.seller_note, 'terms', a.terms, 'admin_note', a.admin_note, 'result_note', a.result_note, 'original_end_at', a.original_end_at,
      'max_extensions', a.max_extensions, 'ext_window_min', a.ext_window_min, 'ext_min', a.ext_min, 'buyer_premium_pct', a.buyer_premium_pct, 'seller_commission_pct', a.seller_commission_pct, 'created_at', a.created_at,
      'verified', exists (select 1 from public.listing_verifications v where v.listing_id = l.id and v.status = 'verified'),
      'bidder_list', coalesce((select jsonb_agg(jsonb_build_object('id', bd.id, 'no', bd.bidder_no, 'status', bd.status, 'deposit_status', bd.deposit_status, 'deposit_ref', bd.deposit_ref, 'deposit_proof', bd.deposit_proof, 'deposit_at', bd.deposit_at,
          'name', coalesce(nullif(q.full_name, ''), q.email), 'phone', q.phone, 'email', q.email, 'id_verified', public.is_identity_verified(bd.user_id), 'note', bd.admin_note,
          'deposit_matched', public.payment_matched('auction_deposit', a.ref || '-B' || bd.bidder_no)) order by bd.bidder_no)
        from public.auction_bidders bd join public.profiles q on q.id = bd.user_id where bd.auction_id = a.id), '[]'::jsonb),
      'bid_list', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'no', bd.bidder_no, 'name', coalesce(nullif(q.full_name, ''), q.email), 'amount', x.amount, 'at', x.created_at, 'extended', x.extended, 'voided', x.voided, 'void_reason', x.void_reason) order by x.created_at desc)
        from public.auction_bids x join public.auction_bidders bd on bd.id = x.bidder_id join public.profiles q on q.id = bd.user_id where x.auction_id = a.id), '[]'::jsonb))
    order by case a.status when 'requested' then 0 when 'scheduled' then 1 when 'provisional' then 2 else 3 end, a.end_at nulls first, a.created_at desc)
    from public.auctions a join public.listings l on l.id = a.listing_id join public.profiles p on p.id = a.seller_id), '[]'::jsonb);
end $$;
grant execute on function public.admin_auctions() to authenticated;

-- Admin opens a deposit receipt (stored in the identity-docs bucket under the bidder's folder)
create or replace function public.admin_auction_file_ok(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_perm('auctions') and exists (select 1 from public.auction_bidders where deposit_proof = p_path) $$;
grant execute on function public.admin_auction_file_ok(text) to authenticated;

-- ---------- Bank reconciliation: auction deposits are expected payments too ----------
create or replace function public.expected_payments()
returns table (kind text, ref text, amount numeric, txn text, who text, at timestamptz, label text)
language sql stable security definer set search_path = public
as $$
  select 'order', o.ref, o.total, o.payment_ref, coalesce(nullif(p.full_name, ''), p.email), o.updated_at, 'Material order ' || o.ref
    from public.orders o left join public.profiles p on p.id = o.buyer_id where o.status = 'payment_review'
  union all
  select 'verification', l.ref, v.fee, v.txn_id, coalesce(nullif(p.full_name, ''), p.email), v.submitted_at, 'Verification fee ' || l.ref
    from public.listing_verifications v join public.listings l on l.id = v.listing_id left join public.profiles p on p.id = v.owner_id where v.status = 'submitted' and v.fee > 0
  union all
  select 'auction_deposit', a.ref || '-B' || bd.bidder_no, a.deposit, bd.deposit_ref, coalesce(nullif(p.full_name, ''), p.email), bd.deposit_at, 'Auction deposit ' || a.ref || ' · Bidder ' || bd.bidder_no
    from public.auction_bidders bd join public.auctions a on a.id = bd.auction_id left join public.profiles p on p.id = bd.user_id where bd.deposit_status in ('submitted','paid') and a.deposit > 0
$$;
revoke all on function public.expected_payments() from public, anon, authenticated;

-- ---------- Visibility: auction listings are public; private channel after a sale ----------
-- (listing visibility by channel is already defined in update_13; nothing to change)

-- ---------- Realtime + optional schedule ----------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['auctions','auction_bidders'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- If pg_cron is enabled (Database → Extensions → pg_cron), close auctions and send reminders every minute.
-- Without it, auctions still close correctly: every page that shows an auction runs the same check first.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'raqbo-auction-tick';
    perform cron.schedule('raqbo-auction-tick', '* * * * *', 'select public.auction_tick()');
  end if;
exception when others then null;
end $$;


-- update_16_location.sql
-- =====================================================================
-- 24. Member location (city + area) asked on the sign-up screen
-- Run after update_15_auctions.sql. Safe to run more than once.
-- =====================================================================
alter table public.profiles add column if not exists city text;
alter table public.profiles add column if not exists area text;
alter table public.profiles drop constraint if exists profiles_area_len;
alter table public.profiles add constraint profiles_area_len check (area is null or char_length(area) <= 80);

create or replace function public.set_my_location(p_city text, p_area text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  update public.profiles
     set city = nullif(left(btrim(coalesce(p_city, '')), 60), ''),
         area = nullif(left(btrim(coalesce(p_area, '')), 80), '')
   where id = auth.uid();
end $$;
grant execute on function public.set_my_location(text, text) to authenticated;


-- update_17_quicksell.sql
-- =====================================================================
-- 25. QuickSell (formerly Urgent Sale): 9-stage workflow and "Assisted sale"
-- Run after update_16_location.sql. Safe to run more than once.
-- =====================================================================
alter table public.urgent_requests drop constraint if exists urgent_requests_stage_check;
alter table public.urgent_requests add constraint urgent_requests_stage_check check (stage in ('submitted','under_review','documents_checked','market_assessment','matching','offer_received','negotiation','agreement','sold','closed','rejected'));

create or replace function public.urgent_stage_label(p text)
returns text language sql immutable as $$
  select case p when 'submitted' then 'Submitted' when 'under_review' then 'Initial review' when 'documents_checked' then 'Document check' when 'market_assessment' then 'Market assessment' when 'matching' then 'Buyer & investor matching'
    when 'offer_received' then 'Purchase offers' when 'negotiation' then 'Negotiation' when 'agreement' then 'Agreement' when 'sold' then 'Completed'
    when 'closed' then 'Closed' when 'rejected' then 'Not accepted' else p end $$;

create or replace function public.submit_urgent_sale(p_listing uuid, p jsonb)
returns void language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); l public.listings; opts text[]; ch text; nm text;
begin
  if not (select urgent_enabled from public.platform_settings where id = 1) then raise exception 'QuickSell is not open right now.'; end if;
  select * into l from public.listings where id = p_listing;
  if l.id is null or l.owner_id is distinct from me then raise exception 'You can only submit your own property.'; end if;
  if l.purpose <> 'sale' then raise exception 'QuickSell is for properties for sale.'; end if;
  opts := array(select distinct x from jsonb_array_elements_text(coalesce(p->'options', '[]')) x where x in ('raqbo','investors','public','assisted'));
  if coalesce(array_length(opts, 1), 0) = 0 then raise exception 'Choose at least one way to sell.'; end if;
  if (p->>'min_price') is not null and (p->>'min_price')::bigint > l.price then raise exception 'The minimum price cannot be higher than the expected price.'; end if;
  ch := case when 'public' = any(opts) then 'public' when 'investors' = any(opts) then 'investors' else 'private' end;
  perform set_config('raqbo.sys', '1', true);
  update public.listings set sale_mode = 'urgent', channel = ch where id = l.id;
  perform set_config('raqbo.sys', '', true);
  insert into public.urgent_requests (listing_id, owner_id, options, min_price, timeframe, encumbrance_details, advertised_elsewhere, documents_available, urgency_reason, contact_phone)
  values (l.id, me, opts, nullif(p->>'min_price', '')::bigint, coalesce(nullif(p->>'timeframe', ''), 'flexible'), left(coalesce(p->>'encumbrance_details', ''), 600),
          coalesce((p->>'advertised_elsewhere')::boolean, false), array(select x from jsonb_array_elements_text(coalesce(p->'documents_available', '[]')) x), left(coalesce(p->>'urgency_reason', ''), 1000), left(coalesce(p->>'contact_phone', ''), 20))
  on conflict (listing_id) do update set options = excluded.options, min_price = excluded.min_price, timeframe = excluded.timeframe, encumbrance_details = excluded.encumbrance_details,
     advertised_elsewhere = excluded.advertised_elsewhere, documents_available = excluded.documents_available, urgency_reason = excluded.urgency_reason, contact_phone = excluded.contact_phone, updated_at = now();
  insert into public.urgent_review (listing_id) values (l.id) on conflict do nothing;
  perform public.deal_event(l.id, 'stage', 'submitted', 'QuickSell request submitted', 'owner');
  select coalesce(nullif(full_name, ''), 'A member') into nm from public.profiles where id = me;
  perform public.notify_admins('deal', 'QuickSell request: ' || left(l.title, 90), nm || ' · ' || l.ref || ' · Rs ' || to_char(l.price, 'FM999,999,999,999') || ' · options: ' || array_to_string(opts, ', '), '#admin/urgent');
end $$;
grant execute on function public.submit_urgent_sale(uuid, jsonb) to authenticated;

create or replace function public.make_offer(p_listing uuid, p_amount bigint, p_conditions text)
returns text language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); l public.listings; src text; no int; o public.offers_deal; days int;
begin
  if me is null or not public.is_verified_user() then raise exception 'Please sign in to make an offer.'; end if;
  select * into l from public.listings where id = p_listing and status = 'published';
  if l.id is null or l.sale_mode <> 'urgent' then raise exception 'Offers can be made on QuickSell properties.'; end if;
  if l.owner_id = me then raise exception 'You cannot make an offer on your own property.'; end if;
  if l.channel = 'private' or (l.channel = 'investors' and not public.is_approved_investor()) then raise exception 'This opportunity is only open to approved RAQBO investors.'; end if;
  if coalesce(p_amount, 0) < 1000 then raise exception 'Enter your offer in rupees.'; end if;
  if (select count(*) from public.offers_deal where buyer_id = me and created_at > now() - interval '1 day') >= 10 then raise exception 'You can make up to 10 offers a day.'; end if;
  if exists (select 1 from public.offers_deal where listing_id = l.id and buyer_id = me and status in ('submitted','countered')) then raise exception 'You already have an open offer on this property. Revise or withdraw it in My RAQBO → Offers.'; end if;
  src := case when public.is_approved_investor() then 'investor' else 'public' end;
  select coalesce(max(buyer_no), 0) into no from public.offers_deal where listing_id = l.id and buyer_id = me;
  if no = 0 then select coalesce(max(buyer_no), 0) + 1 into no from public.offers_deal where listing_id = l.id; end if;
  select offer_valid_days into days from public.platform_settings where id = 1;
  insert into public.offers_deal (listing_id, buyer_id, buyer_no, source, amount, conditions, expires_at)
  values (l.id, me, no, src, p_amount, left(btrim(coalesce(p_conditions, '')), 1000), now() + make_interval(days => days)) returning * into o;
  update public.urgent_requests set stage = 'offer_received', updated_at = now() where listing_id = l.id and stage in ('submitted','under_review','documents_checked','market_assessment','matching');
  perform public.deal_event(l.id, 'offer', null, 'Offer of Rs ' || to_char(p_amount, 'FM999,999,999,999') || ' from ' || case src when 'investor' then 'Investor ' else 'Buyer ' end || no, 'buyer');
  perform public.notify(l.owner_id, 'deal', 'New offer: Rs ' || to_char(p_amount, 'FM999,999,999,999'), left(l.title, 100) || ' · ' || case src when 'investor' then 'RAQBO investor ' else 'Buyer ' end || no || '. Review it in My RAQBO → Offers.', '#my/offers');
  perform public.notify_admins('deal', 'Offer on ' || l.ref, 'Rs ' || to_char(p_amount, 'FM999,999,999,999') || ' · ' || src || ' · ' || left(l.title, 80), '#admin/urgent');
  return o.ref;
end $$;
grant execute on function public.make_offer(uuid, bigint, text) to authenticated;

create or replace function public.admin_raqbo_offer(p_listing uuid, p_amount bigint, p_conditions text, p_reason text)
returns text language plpgsql security definer set search_path = public
as $$
declare l public.listings; o public.offers_deal; days int;
begin
  if not public.has_perm('urgent') then raise exception 'You do not have permission to make RAQBO offers.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Please give a reason (it is kept in the audit log).'; end if;
  select * into l from public.listings where id = p_listing;
  if l.id is null then raise exception 'Listing not found.'; end if;
  select offer_valid_days into days from public.platform_settings where id = 1;
  insert into public.offers_deal (listing_id, buyer_id, buyer_no, source, amount, conditions, expires_at)
  values (l.id, null, 0, 'raqbo', p_amount, left(btrim(coalesce(p_conditions, '')), 1000), now() + make_interval(days => days)) returning * into o;
  insert into public.urgent_review (listing_id, raqbo_interest, updated_by) values (l.id, 'offer_made', auth.uid())
  on conflict (listing_id) do update set raqbo_interest = 'offer_made', updated_by = auth.uid(), updated_at = now();
  update public.urgent_requests set stage = 'offer_received', updated_at = now() where listing_id = l.id and stage in ('submitted','under_review','documents_checked','market_assessment','matching');
  perform public.deal_event(l.id, 'offer', null, 'RAQBO made a conditional purchase offer of Rs ' || to_char(p_amount, 'FM999,999,999,999'), 'raqbo');
  perform public.notify(l.owner_id, 'deal', 'RAQBO made an offer on your property', 'Rs ' || to_char(p_amount, 'FM999,999,999,999') || ' (conditional). Review it in My RAQBO → Offers.', '#my/offers');
  perform public.audit('urgent.raqbo_offer', 'listing', l.ref, p_reason, jsonb_build_object('amount', p_amount, 'conditions', p_conditions));
  return o.ref;
end $$;
grant execute on function public.admin_raqbo_offer(uuid, bigint, text, text) to authenticated;

create or replace function public.respond_offer(p_offer uuid, p_action text, p_amount bigint, p_note text)
returns void language plpgsql security definer set search_path = public
as $$
declare o public.offers_deal; l public.listings; by_admin boolean;
begin
  select * into o from public.offers_deal where id = p_offer;
  select * into l from public.listings where id = o.listing_id;
  if o.id is null then raise exception 'Offer not found.'; end if;
  by_admin := public.has_perm('urgent') and l.owner_id is distinct from auth.uid();
  if l.owner_id is distinct from auth.uid() and not by_admin then raise exception 'Only the seller can respond to this offer.'; end if;
  if o.status not in ('submitted','countered') then raise exception 'This offer is already closed.'; end if;
  if o.expires_at is not null and o.expires_at < now() then update public.offers_deal set status = 'expired', updated_at = now() where id = o.id; raise exception 'This offer has expired.'; end if;
  if p_action = 'accept' then
    update public.offers_deal set status = 'accepted', response_note = left(coalesce(p_note, ''), 600), updated_at = now() where id = o.id;
    update public.offers_deal set status = 'rejected', response_note = 'The seller accepted another offer.', updated_at = now() where listing_id = o.listing_id and id <> o.id and status in ('submitted','countered');
    update public.urgent_requests set stage = 'agreement', stage_note = 'Offer accepted subject to documents, payment and the final agreement.', updated_at = now() where listing_id = o.listing_id;
    perform public.deal_event(o.listing_id, 'stage', 'agreement', 'Offer ' || o.ref || ' accepted — RAQBO will arrange the agreement', case when by_admin then 'raqbo' else 'owner' end);
    perform public.notify_admins('deal', 'Offer accepted: ' || l.ref, 'Rs ' || to_char(o.amount, 'FM999,999,999,999') || ' · arrange the agreement', '#admin/urgent');
  elsif p_action = 'reject' then
    update public.offers_deal set status = 'rejected', response_note = left(coalesce(p_note, ''), 600), updated_at = now() where id = o.id;
    perform public.deal_event(o.listing_id, 'offer', null, 'Offer ' || o.ref || ' declined', case when by_admin then 'raqbo' else 'owner' end);
  elsif p_action = 'counter' then
    if coalesce(p_amount, 0) <= o.amount then raise exception 'A counter-offer should be higher than the offer.'; end if;
    update public.offers_deal set status = 'countered', counter_amount = p_amount, response_note = left(coalesce(p_note, ''), 600), updated_at = now() where id = o.id;
    update public.urgent_requests set stage = 'negotiation', updated_at = now() where listing_id = o.listing_id and stage in ('submitted','under_review','documents_checked','market_assessment','matching','offer_received');
    perform public.deal_event(o.listing_id, 'stage', 'negotiation', 'Counter-offer of Rs ' || to_char(p_amount, 'FM999,999,999,999') || ' on ' || o.ref, case when by_admin then 'raqbo' else 'owner' end);
  else raise exception 'Unknown action.'; end if;
  if o.buyer_id is not null then
    perform public.notify(o.buyer_id, 'deal', case p_action when 'accept' then 'Your offer was accepted' when 'reject' then 'Your offer was declined' else 'The seller made a counter-offer' end,
      left(l.title, 100) || case when p_action = 'counter' then ' · Rs ' || to_char(p_amount, 'FM999,999,999,999') else '' end || case when coalesce(p_note, '') <> '' then ' · ' || left(p_note, 120) else '' end, '#my/offers');
  end if;
  if by_admin then perform public.audit('offer.' || p_action, 'offer', o.ref, p_note, jsonb_build_object('amount', p_amount)); end if;
end $$;
grant execute on function public.respond_offer(uuid, text, bigint, text) to authenticated;


-- update_18_listings.sql
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


-- update_19_reports.sql
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


-- update_20_services.sql
-- =====================================================================
-- 28. RAQBO Services catalogue (5 groups, fees, tracking numbers),
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


-- update_21_admin.sql
-- =====================================================================
-- 29. Business control: complaints & disputes centre, refunds register,
--     revenue & expense reporting, new dashboard KPIs, WhatsApp click
--     tracking, construction-cost rates, and optional admin two-factor
--     sign-in (Supabase TOTP; switched OFF until an admin turns it on).
-- Run after update_20_services.sql. Safe to run more than once.
-- =====================================================================

-- ---------- Admin two-factor sign-in (optional) ----------
alter table public.platform_settings add column if not exists admin_mfa_required boolean not null default false;
create or replace function public.mfa_ok()
returns boolean language sql stable security definer set search_path = public as $$
  select not coalesce((select admin_mfa_required from public.platform_settings where id = 1), false) or coalesce(auth.jwt() ->> 'aal', '') = 'aal2' $$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') and public.mfa_ok() $$;
create or replace function public.has_perm(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and (admin_perms is null or p = any(admin_perms))) and public.mfa_ok() $$;
create or replace function public.is_full_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and admin_perms is null) and public.mfa_ok() $$;
create or replace function public.admin_set_mfa_required(p_on boolean, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_full_admin() then raise exception 'Only a full admin can change two-factor sign-in.'; end if;
  if p_on and coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then raise exception 'Set up two-factor sign-in on your own account and sign in with it first — otherwise you would lock yourself out.'; end if;
  update public.platform_settings set admin_mfa_required = p_on, updated_at = now() where id = 1;
  perform public.audit(case when p_on then 'security.mfa_on' else 'security.mfa_off' end, 'settings', 'admin_mfa', p_reason, null);
end $$;
grant execute on function public.admin_set_mfa_required(boolean, text) to authenticated;

-- ---------- Complaints & disputes ----------
create table if not exists public.complaints (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique default ('RQ-CMP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  user_id          uuid references public.profiles (id) on delete set null,
  name             text not null default '',
  kind             text not null check (kind in ('listing','order','service','auction','quicksell','payment','advertiser','other')),
  subject_ref      text not null default '' check (char_length(subject_ref) <= 80),
  details          text not null check (char_length(btrim(details)) between 10 and 3000),
  refund_requested bigint check (refund_requested is null or refund_requested > 0),
  status           text not null default 'open' check (status in ('open','investigating','resolved','rejected')),
  resolution       text not null default '' check (char_length(resolution) <= 2000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists complaints_status_idx on public.complaints (status, created_at desc);
alter table public.complaints enable row level security;
drop policy if exists "complaints: own or admin" on public.complaints;
create policy "complaints: own or admin" on public.complaints for select using (user_id = auth.uid() or public.is_admin());
revoke insert, update, delete on public.complaints from anon, authenticated;
grant select on public.complaints to authenticated;

create or replace function public.submit_complaint(p_kind text, p_subject_ref text, p_details text, p_refund bigint)
returns text language plpgsql security definer set search_path = public as $$
declare r text; nm text;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if (select count(*) from public.complaints where user_id = auth.uid() and created_at > now() - interval '1 day') >= 5 then raise exception 'You have sent several complaints today. RAQBO will reply to those first.'; end if;
  select coalesce(nullif(full_name, ''), 'Member') into nm from public.profiles where id = auth.uid();
  insert into public.complaints (user_id, name, kind, subject_ref, details, refund_requested) values (auth.uid(), nm, p_kind, left(btrim(coalesce(p_subject_ref, '')), 80), btrim(p_details), nullif(p_refund, 0)) returning ref into r;
  perform public.notify_admins('system', 'New complaint ' || r, left(btrim(p_details), 140), 'tab:complaints');
  return r;
end $$;
grant execute on function public.submit_complaint(text, text, text, bigint) to authenticated;

create or replace function public.admin_update_complaint(p_id uuid, p_status text, p_resolution text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.complaints;
begin
  if not (public.has_perm('services') or public.has_perm('finance')) then raise exception 'You do not have permission to handle complaints.'; end if;
  if p_status not in ('open','investigating','resolved','rejected') then raise exception 'Unknown status.'; end if;
  if p_status in ('resolved','rejected') and char_length(btrim(coalesce(p_resolution, ''))) < 5 then raise exception 'Write the outcome for the member (at least 5 characters).'; end if;
  update public.complaints set status = p_status, resolution = left(btrim(coalesce(p_resolution, '')), 2000), updated_at = now() where id = p_id returning * into c;
  if c.id is null then raise exception 'Complaint not found.'; end if;
  if c.user_id is not null then perform public.notify(c.user_id, 'service', 'Your complaint ' || c.ref || ' — ' || case p_status when 'investigating' then 'being investigated' when 'resolved' then 'resolved' when 'rejected' then 'closed' else 'updated' end, coalesce(nullif(btrim(p_resolution), ''), 'See My RAQBO → Complaints.'), '#my/complaints'); end if;
  perform public.audit('complaint.' || p_status, 'complaint', c.ref, p_resolution, null);
end $$;
grant execute on function public.admin_update_complaint(uuid, text, text) to authenticated;

-- ---------- Refunds register ----------
create table if not exists public.refunds (
  id            uuid primary key default gen_random_uuid(),
  ref           text not null unique default ('RQ-RFD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  complaint_id  uuid references public.complaints (id) on delete set null,
  kind          text not null default 'other' check (kind in ('verification','service','order','auction_deposit','quicksell','featured','other')),
  related_ref   text not null default '' check (char_length(related_ref) <= 80),
  payee         text not null check (char_length(btrim(payee)) between 2 and 120),
  amount        bigint not null check (amount > 0),
  method        text not null default '' check (char_length(method) <= 40),
  reason        text not null check (char_length(btrim(reason)) between 3 and 600),
  status        text not null default 'requested' check (status in ('requested','approved','paid','rejected')),
  txn_id        text not null default '' check (char_length(txn_id) <= 80),
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  paid_at       timestamptz
);
create index if not exists refunds_status_idx on public.refunds (status, created_at desc);
alter table public.refunds enable row level security;
drop policy if exists "refunds: finance" on public.refunds;
create policy "refunds: finance" on public.refunds for select using (public.has_perm('finance'));
revoke insert, update, delete on public.refunds from anon, authenticated;
grant select on public.refunds to authenticated;

create or replace function public.admin_add_refund(p_kind text, p_related_ref text, p_payee text, p_amount bigint, p_method text, p_reason text, p_complaint uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare r text;
begin
  if not public.has_perm('finance') then raise exception 'You do not have permission to manage refunds.'; end if;
  insert into public.refunds (kind, related_ref, payee, amount, method, reason, complaint_id, created_by)
  values (p_kind, left(btrim(coalesce(p_related_ref, '')), 80), btrim(p_payee), p_amount, left(btrim(coalesce(p_method, '')), 40), btrim(p_reason), p_complaint, auth.uid()) returning ref into r;
  perform public.audit('refund.request', 'refund', r, p_reason, jsonb_build_object('amount', p_amount, 'payee', p_payee));
  return r;
end $$;
grant execute on function public.admin_add_refund(text, text, text, bigint, text, text, uuid) to authenticated;

create or replace function public.admin_set_refund(p_id uuid, p_status text, p_txn text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare f public.refunds;
begin
  if not public.has_perm('finance') then raise exception 'You do not have permission to manage refunds.'; end if;
  select * into f from public.refunds where id = p_id; if f.id is null then raise exception 'Refund not found.'; end if;
  if p_status not in ('approved','paid','rejected') then raise exception 'Unknown status.'; end if;
  if f.status in ('paid','rejected') then raise exception 'This refund is already closed.'; end if;
  if p_status = 'paid' and char_length(btrim(coalesce(p_txn, ''))) < 3 then raise exception 'Enter the bank transaction ID of the refund payment.'; end if;
  if f.created_by = auth.uid() and p_status in ('approved','paid') and exists (select 1 from public.profiles where role = 'admin' and id <> auth.uid() and admin_perms is null or (role = 'admin' and id <> auth.uid() and 'finance' = any(admin_perms))) and char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Another finance admin should approve a refund you created — or give a reason (kept in the audit log).';
  end if;
  update public.refunds set status = p_status, txn_id = case when p_status = 'paid' then btrim(p_txn) else txn_id end, decided_at = coalesce(decided_at, now()), paid_at = case when p_status = 'paid' then now() else paid_at end where id = p_id;
  perform public.audit('refund.' || p_status, 'refund', f.ref, p_reason, jsonb_build_object('amount', f.amount, 'txn', p_txn));
end $$;
grant execute on function public.admin_set_refund(uuid, text, text, text) to authenticated;

-- ---------- Revenue & expenses ----------
create table if not exists public.finance_entries (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('income','expense')),
  category    text not null check (char_length(btrim(category)) between 2 and 60),
  amount      bigint not null check (amount > 0),
  entry_date  date not null default (now() at time zone 'Asia/Karachi')::date,
  note        text not null default '' check (char_length(note) <= 300),
  ref         text not null default '' check (char_length(ref) <= 80),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists finance_entries_date_idx on public.finance_entries (entry_date desc);
alter table public.finance_entries enable row level security;
drop policy if exists "finance_entries: finance" on public.finance_entries;
create policy "finance_entries: finance" on public.finance_entries for select using (public.has_perm('finance'));
revoke insert, update, delete on public.finance_entries from anon, authenticated;
grant select on public.finance_entries to authenticated;
create or replace function public.admin_add_finance(p_kind text, p_category text, p_amount bigint, p_date date, p_note text, p_ref text)
returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  if not public.has_perm('finance') then raise exception 'You do not have permission to record finances.'; end if;
  insert into public.finance_entries (kind, category, amount, entry_date, note, ref, created_by) values (p_kind, btrim(p_category), p_amount, coalesce(p_date, (now() at time zone 'Asia/Karachi')::date), left(btrim(coalesce(p_note, '')), 300), left(btrim(coalesce(p_ref, '')), 80), auth.uid()) returning id into nid;
  perform public.audit('finance.' || p_kind, 'finance', coalesce(nullif(p_ref, ''), p_category), p_note, jsonb_build_object('amount', p_amount, 'category', p_category));
  return nid;
end $$;
grant execute on function public.admin_add_finance(text, text, bigint, date, text, text) to authenticated;
create or replace function public.admin_delete_finance(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare f public.finance_entries;
begin
  if not public.has_perm('finance') then raise exception 'You do not have permission to record finances.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Give a reason for deleting this entry.'; end if;
  delete from public.finance_entries where id = p_id returning * into f;
  if f.id is not null then perform public.audit('finance.delete', 'finance', coalesce(nullif(f.ref, ''), f.category), p_reason, to_jsonb(f)); end if;
end $$;
grant execute on function public.admin_delete_finance(uuid, text) to authenticated;

-- Monthly report: recorded income and expenses plus refunds paid
create or replace function public.admin_finance_report(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm('finance') then raise exception 'You do not have permission to see finances.'; end if;
  return jsonb_build_object(
    'entries', coalesce((select jsonb_agg(to_jsonb(e) order by e.entry_date desc, e.created_at desc) from public.finance_entries e where e.entry_date between p_from and p_to), '[]'::jsonb),
    'refunds_paid', coalesce((select jsonb_agg(jsonb_build_object('ref', r.ref, 'amount', r.amount, 'paid_at', r.paid_at, 'payee', r.payee, 'kind', r.kind) order by r.paid_at desc) from public.refunds r where r.status = 'paid' and (r.paid_at at time zone 'Asia/Karachi')::date between p_from and p_to), '[]'::jsonb));
end $$;
grant execute on function public.admin_finance_report(date, date) to authenticated;

-- ---------- WhatsApp click tracking (anonymous counts only) ----------
create table if not exists public.wa_clicks (
  id          bigint generated always as identity primary key,
  listing_id  uuid references public.listings (id) on delete cascade,
  source      text not null default '' check (char_length(source) <= 40),
  at          timestamptz not null default now()
);
create index if not exists wa_clicks_at_idx on public.wa_clicks (at desc);
alter table public.wa_clicks enable row level security;
revoke all on public.wa_clicks from anon, authenticated;
create or replace function public.track_whatsapp(p_listing uuid, p_source text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.wa_clicks where at > now() - interval '1 minute') > 600 then return; end if;   -- simple flood guard
  insert into public.wa_clicks (listing_id, source) values ((select id from public.listings where id = p_listing), left(coalesce(p_source, ''), 40));
end $$;
grant execute on function public.track_whatsapp(uuid, text) to anon, authenticated;

-- ---------- Construction cost calculator rates (admin-editable, per sq ft) ----------
alter table public.platform_settings add column if not exists cost_rates jsonb not null default '{"grey":3150,"economy":5200,"standard":6800,"premium":10000}'::jsonb;
alter table public.platform_settings add column if not exists refund_rules text not null default '';
alter table public.platform_settings add column if not exists analytics_id text not null default '';
do $$ begin alter table public.platform_settings add constraint platform_analytics_id_check check (analytics_id = '' or analytics_id ~ '^G-[A-Z0-9]{4,14}$'); exception when duplicate_object then null; end $$;
create or replace function public.admin_save_analytics(p_id text, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('settings') then raise exception 'You do not have permission to change business settings.'; end if;
  update public.platform_settings set analytics_id = upper(btrim(coalesce(p_id, ''))), updated_at = now() where id = 1;
  perform public.audit('settings.analytics', 'settings', 'platform', p_reason, jsonb_build_object('id', p_id));
end $$;
grant execute on function public.admin_save_analytics(text, text) to authenticated;
create or replace function public.admin_save_misc(p_cost_rates jsonb, p_refund_rules text, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('settings') then raise exception 'You do not have permission to change business settings.'; end if;
  if jsonb_typeof(p_cost_rates) <> 'object' then raise exception 'Invalid rates.'; end if;
  update public.platform_settings set cost_rates = p_cost_rates, refund_rules = left(coalesce(p_refund_rules, ''), 4000), updated_at = now() where id = 1;
  perform public.audit('settings.misc', 'settings', 'platform', p_reason, jsonb_build_object('cost_rates', p_cost_rates));
end $$;
grant execute on function public.admin_save_misc(jsonb, text, text) to authenticated;

-- ---------- Extra dashboard numbers ----------
create or replace function public.admin_kpis_v3()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m0 date := date_trunc('month', now() at time zone 'Asia/Karachi')::date;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return jsonb_build_object(
    'complaints_open', (select count(*) from public.complaints where status in ('open','investigating')),
    'refunds_pending', (select coalesce(sum(amount), 0) from public.refunds where status in ('requested','approved')),
    'refunds_pending_n', (select count(*) from public.refunds where status in ('requested','approved')),
    'income_month', (select coalesce(sum(amount), 0) from public.finance_entries where kind = 'income' and entry_date >= m0),
    'expense_month', (select coalesce(sum(amount), 0) from public.finance_entries where kind = 'expense' and entry_date >= m0) + (select coalesce(sum(amount), 0) from public.refunds where status = 'paid' and paid_at >= m0),
    'wa_clicks_7d', (select count(*) from public.wa_clicks where at > now() - interval '7 days'),
    'wa_top', coalesce((select jsonb_agg(x) from (select l.ref, l.title, count(*) n from public.wa_clicks w join public.listings l on l.id = w.listing_id where w.at > now() - interval '30 days' group by l.ref, l.title order by n desc limit 5) x), '[]'::jsonb),
    'services_open', (select count(*) from public.enquiries where status in ('new','in_progress','awaiting_client')),
    'wanted_active', (select count(*) from public.wanted_posts where status = 'published'),
    'verified_live', (select count(*) from public.listing_verifications v join public.listings l on l.id = v.listing_id where v.status = 'verified' and l.status = 'published'),
    'published', (select count(*) from public.listings where status = 'published' and not is_sample),
    'visits_open', (select count(*) from public.inspections where status = 'requested'));
end $$;
grant execute on function public.admin_kpis_v3() to authenticated;


-- update_22_complete.sql
-- =====================================================================
-- 30. Closing the remaining review points: business identity, service
--     quotations, agent subscription packages, advertiser reviews and
--     performance, listing performance for owners, project showcase
--     details, duplicate-account checks, completed-transaction KPI and
--     an admin data backup export.
-- Run after update_21_admin.sql. Safe to run more than once.
-- =====================================================================

-- ---------- Business identity (shown in footer, receipts, reports) ----------
alter table public.platform_settings add column if not exists legal_name text not null default '';
alter table public.platform_settings add column if not exists legal_type text not null default '';
alter table public.platform_settings add column if not exists legal_reg_no text not null default '';
alter table public.platform_settings add column if not exists legal_ntn text not null default '';
alter table public.platform_settings add column if not exists legal_address text not null default '';
create or replace function public.admin_save_identity(p jsonb, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_full_admin() then raise exception 'Only a full admin can change the business identity.'; end if;
  update public.platform_settings set legal_name = left(btrim(coalesce(p->>'legal_name', '')), 160), legal_type = left(btrim(coalesce(p->>'legal_type', '')), 60),
    legal_reg_no = left(btrim(coalesce(p->>'legal_reg_no', '')), 60), legal_ntn = left(btrim(coalesce(p->>'legal_ntn', '')), 40), legal_address = left(btrim(coalesce(p->>'legal_address', '')), 300), updated_at = now() where id = 1;
  perform public.audit('settings.identity', 'settings', 'platform', p_reason, p);
end $$;
grant execute on function public.admin_save_identity(jsonb, text) to authenticated;

-- ---------- Service quotations ----------
alter table public.enquiries add column if not exists quote_amount bigint;
alter table public.enquiries add column if not exists quote_note text not null default '';
alter table public.enquiries add column if not exists quote_valid_until date;
alter table public.enquiries add column if not exists quote_status text not null default '';
do $$ begin alter table public.enquiries add constraint enquiries_quote_check check (quote_status in ('','sent','accepted','declined') and (quote_amount is null or quote_amount > 0) and char_length(quote_note) <= 1000); exception when duplicate_object then null; end $$;
create or replace function public.admin_send_quote(p_id uuid, p_amount bigint, p_valid_until date, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare e public.enquiries;
begin
  if not public.has_perm('services') then raise exception 'You do not have permission to send quotations.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the quoted amount.'; end if;
  update public.enquiries set quote_amount = p_amount, quote_valid_until = coalesce(p_valid_until, (now() + interval '14 days')::date), quote_note = left(btrim(coalesce(p_note, '')), 1000), quote_status = 'sent', status = 'awaiting_client', updated_at = now()
   where id = p_id returning * into e;
  if e.id is null then raise exception 'Request not found.'; end if;
  if e.user_id is not null then perform public.notify(e.user_id, 'service', 'Quotation for ' || e.ref || ': Rs ' || to_char(p_amount, 'FM999,999,999,999'), 'Open My RAQBO → Service requests to accept or decline.', '#my/services'); end if;
  perform public.audit('service.quote', 'enquiry', e.ref, p_note, jsonb_build_object('amount', p_amount, 'valid_until', p_valid_until));
end $$;
grant execute on function public.admin_send_quote(uuid, bigint, date, text) to authenticated;
create or replace function public.respond_quote(p_ref text, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare e public.enquiries;
begin
  select * into e from public.enquiries where ref = p_ref and user_id = auth.uid();
  if e.id is null then raise exception 'Request not found.'; end if;
  if e.quote_status <> 'sent' then raise exception 'There is no open quotation on this request.'; end if;
  if e.quote_valid_until is not null and e.quote_valid_until < (now() at time zone 'Asia/Karachi')::date then raise exception 'This quotation has expired. Ask RAQBO for a new one.'; end if;
  update public.enquiries set quote_status = case when p_accept then 'accepted' else 'declined' end, status = case when p_accept then 'in_progress' else 'cancelled' end, updated_at = now() where id = e.id;
  perform public.notify_admins('service', 'Quotation ' || case when p_accept then 'accepted' else 'declined' end || ': ' || e.ref, 'Rs ' || to_char(e.quote_amount, 'FM999,999,999,999'), 'tab:enquiries');
end $$;
grant execute on function public.respond_quote(text, boolean) to authenticated;
create or replace function public.my_service_requests()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('ref', ref, 'service', service, 'message', message, 'property_ref', property_ref, 'status', status, 'client_note', client_note, 'details', details,
    'quote_amount', quote_amount, 'quote_note', quote_note, 'quote_valid_until', quote_valid_until, 'quote_status', quote_status, 'created_at', created_at, 'updated_at', updated_at) order by created_at desc), '[]'::jsonb)
  from public.enquiries where user_id = auth.uid() $$;
grant execute on function public.my_service_requests() to authenticated;

-- ---------- Agent subscription packages ----------
alter table public.platform_settings add column if not exists agent_plans jsonb not null default
  '[{"key":"starter","name":"Agent Starter","price":3000,"listings":15,"featured":1,"perks":"Agent profile badge, 15 live listings, 1 sponsored listing a month"},{"key":"pro","name":"Agent Pro","price":7500,"listings":50,"featured":4,"perks":"Pro badge, 50 live listings, 4 sponsored listings a month, performance report"},{"key":"developer","name":"Developer","price":20000,"listings":200,"featured":10,"perks":"Project showcase pages, 200 live listings, 10 sponsored listings a month"}]'::jsonb;
create table if not exists public.agent_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  ref         text not null unique default ('RQ-SUB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  plan_key    text not null check (char_length(plan_key) between 2 and 30),
  plan_name   text not null default '',
  months      int not null default 1 check (months between 1 and 12),
  amount      bigint not null check (amount >= 0),
  txn_id      text not null default '' check (char_length(txn_id) <= 80),
  status      text not null default 'pending' check (status in ('pending','active','expired','rejected','cancelled')),
  starts_at   timestamptz,
  ends_at     timestamptz,
  admin_note  text not null default '' check (char_length(admin_note) <= 300),
  created_at  timestamptz not null default now()
);
create index if not exists agent_subscriptions_user_idx on public.agent_subscriptions (user_id, created_at desc);
alter table public.agent_subscriptions enable row level security;
drop policy if exists "agent_subscriptions: own or admin" on public.agent_subscriptions;
create policy "agent_subscriptions: own or admin" on public.agent_subscriptions for select using (user_id = auth.uid() or public.is_admin());
revoke insert, update, delete on public.agent_subscriptions from anon, authenticated;
grant select on public.agent_subscriptions to authenticated;
create or replace function public.request_agent_plan(p_plan text, p_months int, p_txn text)
returns text language plpgsql security definer set search_path = public as $$
declare pl jsonb; r text;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  select x into pl from public.platform_settings s, jsonb_array_elements(s.agent_plans) x where s.id = 1 and x->>'key' = p_plan;
  if pl is null then raise exception 'Unknown package.'; end if;
  if exists (select 1 from public.agent_subscriptions where user_id = auth.uid() and status = 'pending') then raise exception 'You already have a request waiting for RAQBO.'; end if;
  if char_length(btrim(coalesce(p_txn, ''))) < 3 then raise exception 'Enter the bank transaction ID of your payment.'; end if;
  insert into public.agent_subscriptions (user_id, plan_key, plan_name, months, amount, txn_id)
  values (auth.uid(), p_plan, pl->>'name', greatest(1, least(12, coalesce(p_months, 1))), (pl->>'price')::bigint * greatest(1, least(12, coalesce(p_months, 1))), btrim(p_txn)) returning ref into r;
  perform public.notify_admins('system', 'Agent package request ' || r, (pl->>'name') || ' · txn ' || btrim(p_txn), 'tab:agents');
  return r;
end $$;
grant execute on function public.request_agent_plan(text, int, text) to authenticated;
create or replace function public.admin_set_agent_plan(p_id uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare s public.agent_subscriptions;
begin
  if not public.has_perm('finance') then raise exception 'You do not have permission to manage agent packages.'; end if;
  if p_status not in ('active','rejected','cancelled','expired') then raise exception 'Unknown status.'; end if;
  if p_status = 'rejected' and char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Give a reason for the agent.'; end if;
  update public.agent_subscriptions set status = p_status, admin_note = left(btrim(coalesce(p_note, '')), 300),
    starts_at = case when p_status = 'active' then now() else starts_at end, ends_at = case when p_status = 'active' then now() + make_interval(months => months) else ends_at end
   where id = p_id returning * into s;
  if s.id is null then raise exception 'Request not found.'; end if;
  perform public.notify(s.user_id, 'system', s.plan_name || ': ' || case p_status when 'active' then 'active until ' || to_char(s.ends_at at time zone 'Asia/Karachi', 'DD Mon YYYY') when 'rejected' then 'not approved' else p_status end, coalesce(nullif(btrim(p_note), ''), 'See My RAQBO → Agent package.'), '#my/agent');
  perform public.audit('agent_plan.' || p_status, 'subscription', s.ref, p_note, jsonb_build_object('amount', s.amount, 'txn', s.txn_id));
end $$;
grant execute on function public.admin_set_agent_plan(uuid, text, text) to authenticated;
create or replace function public.admin_save_agent_plans(p_plans jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('settings') then raise exception 'You do not have permission to change business settings.'; end if;
  if jsonb_typeof(p_plans) <> 'array' or jsonb_array_length(p_plans) = 0 or char_length(p_plans::text) > 6000 then raise exception 'Add at least one package.'; end if;
  update public.platform_settings set agent_plans = p_plans, updated_at = now() where id = 1;
  perform public.audit('settings.agent_plans', 'settings', 'platform', null, p_plans);
end $$;
grant execute on function public.admin_save_agent_plans(jsonb) to authenticated;
create or replace function public.agent_badges()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(user_id, plan_name), '{}'::jsonb) from (select distinct on (user_id) user_id, plan_name from public.agent_subscriptions where status = 'active' and ends_at > now() order by user_id, ends_at desc) x $$;
grant execute on function public.agent_badges() to anon, authenticated;

-- ---------- Advertiser reviews (genuine only) and performance ----------
create table if not exists public.advertiser_reviews (
  id             uuid primary key default gen_random_uuid(),
  advertiser_id  uuid not null references public.profiles (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  reviewer_name  text not null default '',
  rating         smallint not null check (rating between 1 and 5),
  comment        text not null check (char_length(btrim(comment)) between 3 and 1000),
  basis          text not null check (basis in ('visit','offer')),
  created_at     timestamptz not null default now(),
  unique (advertiser_id, user_id)
);
alter table public.advertiser_reviews enable row level security;
drop policy if exists "advertiser_reviews: read" on public.advertiser_reviews;
create policy "advertiser_reviews: read" on public.advertiser_reviews for select using (true);
grant select on public.advertiser_reviews to anon, authenticated;
revoke insert, update, delete on public.advertiser_reviews from anon, authenticated;
create or replace function public.add_advertiser_review(p_advertiser uuid, p_rating int, p_comment text)
returns void language plpgsql security definer set search_path = public as $$
declare b text; nm text;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if p_advertiser = auth.uid() then raise exception 'You cannot review yourself.'; end if;
  if exists (select 1 from public.inspections i join public.listings l on l.id = i.listing_id where i.user_id = auth.uid() and l.owner_id = p_advertiser and i.status in ('confirmed','completed') and coalesce(i.confirmed_at, i.preferred_at, i.created_at) < now()) then b := 'visit';
  elsif exists (select 1 from public.offers_deal o join public.listings l on l.id = o.listing_id where o.buyer_id = auth.uid() and l.owner_id = p_advertiser) then b := 'offer';
  else raise exception 'Only people who visited one of this advertiser''s properties or made an offer through RAQBO can review them.'; end if;
  select coalesce(nullif(full_name, ''), 'Member') into nm from public.profiles where id = auth.uid();
  insert into public.advertiser_reviews (advertiser_id, user_id, reviewer_name, rating, comment, basis) values (p_advertiser, auth.uid(), split_part(nm, ' ', 1), greatest(1, least(5, p_rating)), btrim(p_comment), b)
  on conflict (advertiser_id, user_id) do update set rating = excluded.rating, comment = excluded.comment, created_at = now();
end $$;
grant execute on function public.add_advertiser_review(uuid, int, text) to authenticated;
create or replace function public.advertiser_stats(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'live', (select count(*) from public.listings where owner_id = p_user and status = 'published'),
    'sold', (select count(*) from public.listings where owner_id = p_user and availability = 'sold'),
    'rented', (select count(*) from public.listings where owner_id = p_user and availability = 'rented'),
    'since', (select min(created_at) from public.listings where owner_id = p_user),
    'rating', (select round(avg(rating)::numeric, 1) from public.advertiser_reviews where advertiser_id = p_user),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('name', reviewer_name, 'rating', rating, 'comment', comment, 'basis', basis, 'at', created_at) order by created_at desc) from (select * from public.advertiser_reviews where advertiser_id = p_user order by created_at desc limit 30) r), '[]'::jsonb),
    'plan', (select plan_name from public.agent_subscriptions where user_id = p_user and status = 'active' and ends_at > now() order by ends_at desc limit 1)) $$;
grant execute on function public.advertiser_stats(uuid) to anon, authenticated;

-- ---------- Listing performance for owners and agents ----------
create or replace function public.my_listing_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(l.id, jsonb_build_object(
    'saves', (select count(*) from public.favorites f where f.listing_id = l.id),
    'enquiries', (select count(*) from public.conversations c where c.listing_id = l.id),
    'visits', (select count(*) from public.inspections i where i.listing_id = l.id),
    'offers', (select count(*) from public.offers_deal o where o.listing_id = l.id),
    'whatsapp', (select count(*) from public.wa_clicks w where w.listing_id = l.id and w.at > now() - interval '30 days'))), '{}'::jsonb)
  from public.listings l where l.owner_id = auth.uid() $$;
grant execute on function public.my_listing_stats() to authenticated;

-- ---------- Project showcase details (RAQBO Direct / partner developments) ----------
alter table public.listings add column if not exists project_info jsonb not null default '{}'::jsonb;
do $$ begin alter table public.listings add constraint listings_project_info_check check (jsonb_typeof(project_info) = 'object' and char_length(project_info::text) <= 4000); exception when duplicate_object then null; end $$;
create or replace function public.listings_zz_v22()
returns trigger language plpgsql security definer set search_path = public as $$
declare sys boolean := coalesce(current_setting('raqbo.sys', true), '') = '1' or auth.uid() is null or public.is_admin();
begin
  if not sys then new.project_info := case when tg_op = 'INSERT' then '{}'::jsonb else old.project_info end; end if;
  return new;
end $$;
drop trigger if exists listings_zz_v22 on public.listings;
create trigger listings_zz_v22 before insert or update on public.listings for each row execute function public.listings_zz_v22();
create or replace function public.admin_set_project_info(p_listing uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('listings') then raise exception 'You do not have permission to manage projects.'; end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'Invalid project details.'; end if;
  perform set_config('raqbo.sys', '1', true);
  update public.listings set project_info = p where id = p_listing;
  perform set_config('raqbo.sys', '', true);
end $$;
grant execute on function public.admin_set_project_info(uuid, jsonb) to authenticated;

-- ---------- Possible duplicate accounts ----------
create or replace function public.admin_account_checks()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm('growth') then raise exception 'You do not have permission to review accounts.'; end if;
  return jsonb_build_object(
    'same_phone', coalesce((select jsonb_agg(x) from (select right(regexp_replace(phone, '\D', '', 'g'), 10) k, jsonb_agg(jsonb_build_object('id', id, 'name', full_name, 'email', email, 'joined', created_at, 'referred_by', referred_by)) members, count(*) n
      from public.profiles where coalesce(phone, '') <> '' group by 1 having count(*) > 1 order by count(*) desc limit 100) x), '[]'::jsonb),
    'same_cnic_name', coalesce((select jsonb_agg(x) from (select lower(regexp_replace(c.name_on_cnic, '\s+', ' ', 'g')) k, jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email, 'joined', p.created_at, 'status', c.status)) members, count(*) n
      from public.identity_checks c join public.profiles p on p.id = c.user_id where btrim(c.name_on_cnic) <> '' group by 1 having count(*) > 1 order by count(*) desc limit 100) x), '[]'::jsonb),
    'referral_bursts', coalesce((select jsonb_agg(x) from (select r.id, r.full_name name, r.email, count(*) n from public.profiles p join public.profiles r on r.id = p.referred_by where p.created_at > now() - interval '1 day' group by r.id, r.full_name, r.email having count(*) >= 5 order by count(*) desc limit 50) x), '[]'::jsonb));
end $$;
grant execute on function public.admin_account_checks() to authenticated;

-- ---------- KPIs: completed transactions and active agent packages ----------
create or replace function public.admin_kpis_v4()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m0 date := date_trunc('month', now() at time zone 'Asia/Karachi')::date;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return public.admin_kpis_v3() || jsonb_build_object(
    'completed_month', (select count(*) from public.listings where availability in ('sold','rented') and updated_at >= m0)
      + (select count(*) from public.auctions where status = 'sold' and finalized_at >= m0),
    'completed_total', (select count(*) from public.listings where availability in ('sold','rented')) + (select count(*) from public.auctions where status = 'sold'),
    'agents_active', (select count(distinct user_id) from public.agent_subscriptions where status = 'active' and ends_at > now()),
    'agents_pending', (select count(*) from public.agent_subscriptions where status = 'pending'),
    'quotes_open', (select count(*) from public.enquiries where quote_status = 'sent'),
    'enquiries_month', (select count(*) from public.conversations where created_at >= m0),
    'quicksell_open', (select count(*) from public.urgent_requests where stage not in ('sold','closed','rejected')),
    'offers_month', (select count(*) from public.offers_deal where created_at >= m0),
    'auction_bidders', (select count(*) from public.auction_bidders where status = 'approved'),
    'auction_bids_month', (select count(*) from public.auction_bids where created_at >= m0),
    'registrations_today', (select count(*) from public.profiles where created_at >= (now() at time zone 'Asia/Karachi')::date));
end $$;
grant execute on function public.admin_kpis_v4() to authenticated;

-- ---------- Data backup export (full admin) ----------
create or replace function public.admin_export_backup()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_full_admin() then raise exception 'Only a full admin can export a backup.'; end if;
  perform public.audit('backup.export', 'settings', 'backup', null, null);
  return jsonb_build_object('exported_at', now(),
    'listings', coalesce((select jsonb_agg(to_jsonb(l)) from public.listings l), '[]'::jsonb),
    'profiles', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'email', p.email, 'phone', p.phone, 'role', p.role, 'created_at', p.created_at)) from public.profiles p), '[]'::jsonb),
    'listing_verifications', coalesce((select jsonb_agg(to_jsonb(v)) from public.listing_verifications v), '[]'::jsonb),
    'verification_reports', coalesce((select jsonb_agg(to_jsonb(v)) from public.verification_reports v), '[]'::jsonb),
    'enquiries', coalesce((select jsonb_agg(to_jsonb(e)) from public.enquiries e), '[]'::jsonb),
    'complaints', coalesce((select jsonb_agg(to_jsonb(c)) from public.complaints c), '[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(to_jsonb(r)) from public.refunds r), '[]'::jsonb),
    'finance_entries', coalesce((select jsonb_agg(to_jsonb(f)) from public.finance_entries f), '[]'::jsonb),
    'auctions', coalesce((select jsonb_agg(to_jsonb(a)) from public.auctions a), '[]'::jsonb),
    'agent_subscriptions', coalesce((select jsonb_agg(to_jsonb(s)) from public.agent_subscriptions s), '[]'::jsonb),
    'platform_settings', (select to_jsonb(s) from public.platform_settings s where id = 1));
end $$;
grant execute on function public.admin_export_backup() to authenticated;


-- update_23_hardening.sql
-- =====================================================================
-- 31. Hardening found during the full acceptance test:
--     - restore the spam limit on service requests (10 per member per
--       hour), which update_13 dropped when it replaced the trigger;
--     - members can no longer pre-fill quotation, status or staff-note
--       fields when they send a request.
-- Run after update_22_complete.sql. Safe to run more than once.
-- =====================================================================
create or replace function public.enquiries_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare recent int;
begin
  new.user_id := auth.uid(); new.status := 'new'; new.created_at := now(); new.updated_at := now(); new.client_note := '';
  new.quote_amount := null; new.quote_note := ''; new.quote_valid_until := null; new.quote_status := '';
  if auth.uid() is not null and not public.is_admin() then
    select count(*) into recent from public.enquiries where user_id = auth.uid() and created_at > now() - interval '1 hour';
    if recent >= 10 then raise exception 'Too many requests. Please try again in an hour.'; end if;
  end if;
  return new;
end $$;
drop trigger if exists enquiries_before_insert on public.enquiries;
create trigger enquiries_before_insert before insert on public.enquiries for each row execute function public.enquiries_before_insert();

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


-- =====================================================================
-- update 27: commercial, rental management and legal services
-- =====================================================================
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


-- =====================================================================
-- update 28: speed for busy days
-- =====================================================================
-- =====================================================================
-- RAQBO — update 28: speed for busy days
--
-- Nothing on the website changes. This only adds the "contents pages"
-- (indexes) the database uses to find rows quickly, so the site stays
-- fast when many people are using it at the same time.
--
-- Safe to run more than once. It changes no data and deletes nothing.
-- =====================================================================

-- The listings the website loads on every visit, newest first.
create index if not exists listings_created_idx on public.listings (created_at desc);
create index if not exists listings_pub_created_idx on public.listings (created_at desc) where status = 'published';

-- The filters people use most on the search page.
create index if not exists listings_city_idx on public.listings (city, purpose, status);
create index if not exists listings_price_idx on public.listings (price) where status = 'published';

-- A member opening "My RAQBO".
create index if not exists favorites_user_idx on public.favorites (user_id, created_at desc);
create index if not exists enquiries_user_idx on public.enquiries (user_id, created_at desc);
create index if not exists enquiries_status_idx on public.enquiries (status, created_at desc);
create index if not exists inspections_listing_idx on public.inspections (listing_id, created_at desc);

-- Notifications: the bell is read on every page view.
create index if not exists notifications_unread_idx on public.notifications (user_id, created_at desc) where read_at is null;

-- Rental management: the landlord and tenant screens.
create index if not exists rm_rent_due_idx on public.rm_rent (tenancy_id, due_on desc);
create index if not exists rm_rent_status_idx on public.rm_rent (status, due_on) where status in ('due', 'overdue');
create index if not exists rm_maint_open_idx on public.rm_maintenance (property_id, created_at desc) where status <> 'closed';

-- Official auctions: the public notice list.
create index if not exists oa_live_idx on public.official_auctions (auction_at) where review_state = 'published';

do $$ begin raise notice 'Update 28 applied. The database can now answer the busy screens faster.'; end $$;


-- =====================================================================
-- update 29: the RAQBO Partner Network
-- =====================================================================
-- =====================================================================
-- RAQBO update 29 — PARTNER NETWORK
--   1  Settings and commission rates (by category, service and lead source)
--   2  Territories (province → division → district → tehsil → city → town →
--      society → commercial area → locality) with status and exclusivity
--   3  Partner applications (sections A–H of the requirement document)
--   4  Selection and verification: the nine-step appointment process
--   5  Partners, partner IDs, QR status token, branding designation
--   6  Agreements: the sixteen matters, executed before activation
--   7  Documents with expiry reminders
--   8  Central lead distribution: territory routing, acceptance window,
--      return to RAQBO on no response, full step history
--   9  Transactions and commission: on eligible SERVICE FEES, never on the
--      property value; no automatic entitlement by territory alone
--  10  Payouts, statements and approval
--  11  Training modules and completion
--  12  Performance review and partner status
--  13  Public partner directory and QR verification
--  14  Activity log and controlled exports
--
-- Principles enforced by the database, not left to the screens:
--   · An application never grants partnership rights.
--   · A partner cannot be made active until an agreement is executed.
--   · A suspended or terminated partner disappears from the directory.
--   · Commission is a share of the fee RAQBO actually received.
--   · A partner sees only their own territory, leads and customers.
--   · No partner can collect deposits or purchase money through RAQBO.
--
-- Safe to run more than once.
-- =====================================================================

-- ---------- 0. Housekeeping ----------
-- The bell needs to know about the new kinds of message.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in
  ('order','listing','review','message','system','alert','reward','deal','auction','service',
   'partner','partner_application','partner_lead','partner_money','partner_quicksell'));

-- ---------- 0. Permission for staff who run the network ----------
-- (admin_perms is an array on profiles; 'partners' is a new entry)

-- ---------- 1. Settings and commission rates ----------
create table if not exists public.pn_settings (
  id                   boolean primary key default true check (id),
  network_open         boolean not null default true,            -- accepting applications
  lead_accept_hours    int not null default 24 check (lead_accept_hours between 1 and 168),
  lead_contact_hours   int not null default 48 check (lead_contact_hours between 1 and 336),
  pilot_note           text not null default '' check (char_length(pilot_note) <= 600),
  directory_public     boolean not null default true,
  franchise_open       boolean not null default false,           -- full franchises only after the pilot
  intro_note           text not null default '' check (char_length(intro_note) <= 1200),
  updated_at           timestamptz not null default now()
);
insert into public.pn_settings (id) values (true) on conflict (id) do nothing;
alter table public.pn_settings enable row level security;
drop policy if exists "pn_settings: read" on public.pn_settings;
create policy "pn_settings: read" on public.pn_settings for select using (true);
revoke insert, update, delete on public.pn_settings from anon, authenticated;

-- Commission percentages are configurable by category, service and lead source.
create table if not exists public.pn_rates (
  id            uuid primary key default gen_random_uuid(),
  category      text not null check (category in ('associate','area','franchise')),
  service       text not null default 'any' check (char_length(service) <= 60),      -- 'any' or a service key
  lead_source   text not null default 'any' check (lead_source in ('any','partner','raqbo')),
  partner_pct   numeric(5,2) not null check (partner_pct >= 0 and partner_pct <= 100),
  note          text not null default '' check (char_length(note) <= 300),
  effective_from date not null default current_date,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (category, service, lead_source, effective_from)
);
create index if not exists pn_rates_lookup_idx on public.pn_rates (category, service, lead_source, effective_from desc) where active;
alter table public.pn_rates enable row level security;
drop policy if exists "pn_rates: read" on public.pn_rates;
create policy "pn_rates: read" on public.pn_rates for select using (true);
revoke insert, update, delete on public.pn_rates from anon, authenticated;

-- Illustrative starting figures from the requirement document. They are
-- placeholders: an admin sets the real ones before any partner is appointed.
insert into public.pn_rates (category, service, lead_source, partner_pct, effective_from, note) values
  ('associate', 'any', 'any',     17.50, date '2020-01-01', 'Referral commission on a qualifying transaction — illustrative, to be set by RAQBO'),
  ('area',      'any', 'partner', 40.00, date '2020-01-01', 'Transaction originated and substantially handled by the partner — illustrative'),
  ('area',      'any', 'raqbo',   25.00, date '2020-01-01', 'Lead originated by RAQBO and assigned to the partner — illustrative'),
  ('franchise', 'any', 'any',     50.00, date '2020-01-01', 'Individually negotiated — illustrative only')
on conflict do nothing;

create table if not exists public.pn_rate_history (
  id         bigserial primary key,
  rate_id    uuid,
  changed_by uuid references public.profiles (id) on delete set null,
  before_val jsonb,
  after_val  jsonb,
  at         timestamptz not null default now()
);
alter table public.pn_rate_history enable row level security;
drop policy if exists "pn_rate_history: admin" on public.pn_rate_history;
create policy "pn_rate_history: admin" on public.pn_rate_history for select using (public.has_perm('partners'));
revoke insert, update, delete on public.pn_rate_history from anon, authenticated;

-- ---------- 2. Territories ----------
create table if not exists public.pn_territories (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique default ('RQ-TR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))),
  level          text not null default 'city' check (level in ('province','division','district','tehsil','city','town','society','commercial_area','locality')),
  name           text not null check (char_length(btrim(name)) between 2 and 120),
  province       text not null default '' check (char_length(province) <= 60),
  division       text not null default '' check (char_length(division) <= 60),
  district       text not null default '' check (char_length(district) <= 60),
  tehsil         text not null default '' check (char_length(tehsil) <= 60),
  city           text not null default '' check (char_length(city) <= 60),
  parent_id      uuid references public.pn_territories (id) on delete set null,
  boundary_note  text not null default '' check (char_length(boundary_note) <= 600),
  status         text not null default 'available' check (status in ('available','under_review','appointed','additional_allowed','suspended','reserved')),
  max_partners   int not null default 1 check (max_partners between 1 and 50),
  exclusive      boolean not null default false,       -- limited exclusivity is granted, never automatic
  exclusive_until date,
  min_monthly_deals int not null default 0 check (min_monthly_deals between 0 and 500),   -- condition of exclusivity
  note           text not null default '' check (char_length(note) <= 600),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists pn_territories_place_idx on public.pn_territories (province, city, status);
create index if not exists pn_territories_status_idx on public.pn_territories (status, name);
alter table public.pn_territories enable row level security;
drop policy if exists "pn_territories: read" on public.pn_territories;
create policy "pn_territories: read" on public.pn_territories for select using (true);
revoke insert, update, delete on public.pn_territories from anon, authenticated;

-- ---------- 3. Applications ----------
create table if not exists public.pn_applications (
  id              uuid primary key default gen_random_uuid(),
  ref             text not null unique default ('RQ-PA-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  user_id         uuid references public.profiles (id) on delete set null,
  -- Section A: applicant
  full_name       text not null check (char_length(btrim(full_name)) between 3 and 120),
  cnic_last4      text not null default '' check (cnic_last4 = '' or cnic_last4 ~ '^[0-9]{4}$'),   -- only the last four are kept
  cnic_seen       boolean not null default false,                                                  -- the full card was shown to RAQBO
  phone           text not null check (char_length(phone) between 7 and 20),
  whatsapp        text not null default '' check (char_length(whatsapp) <= 20),
  email           text not null default '' check (char_length(email) <= 160),
  home_address    text not null default '' check (char_length(home_address) <= 300),
  office_address  text not null default '' check (char_length(office_address) <= 300),
  photo_path      text not null default '' check (char_length(photo_path) <= 400),
  background      text not null default '' check (char_length(background) <= 1500),
  -- Section B: business status
  business_type   text not null default 'individual' check (business_type in ('individual','sole_proprietor','aop','private_limited','agency','other_registered')),
  business_name   text not null default '' check (char_length(business_name) <= 160),
  ntn             text not null default '' check (char_length(ntn) <= 30),
  registration_no text not null default '' check (char_length(registration_no) <= 60),
  dealer_licence  text not null default '' check (char_length(dealer_licence) <= 80),
  business_years  int check (business_years is null or business_years between 0 and 80),
  office_details  text not null default '' check (char_length(office_details) <= 600),
  affiliations    text not null default '' check (char_length(affiliations) <= 400),
  -- Section C: preferred territory
  province        text not null default '' check (char_length(province) <= 60),
  city            text not null default '' check (char_length(city) <= 60),
  district        text not null default '' check (char_length(district) <= 60),
  tehsil          text not null default '' check (char_length(tehsil) <= 60),
  area_wanted     text not null default '' check (char_length(area_wanted) <= 200),
  territory_id    uuid references public.pn_territories (id) on delete set null,
  has_office      boolean not null default false,
  -- Section D: preference
  want_category   text not null default 'area' check (want_category in ('associate','area','franchise','open')),
  -- Section E: experience and resources
  exp_years       int check (exp_years is null or exp_years between 0 and 80),
  customer_network text not null default '' check (char_length(customer_network) <= 600),
  staff_count     int check (staff_count is null or staff_count between 0 and 5000),
  categories_handled text[] not null default '{}',
  marketing       text not null default '' check (char_length(marketing) <= 600),
  skills          text not null default '' check (char_length(skills) <= 600),
  inventory_note  text not null default '' check (char_length(inventory_note) <= 600),
  -- Section F: services the applicant can handle
  services        text[] not null default '{}',
  -- Section G: documents (paths in the partner-docs bucket)
  doc_paths       text[] not null default '{}',
  -- Section H: declaration — an application grants no rights
  declared        boolean not null default false,
  -- Selection and verification
  stage           text not null default 'submitted' check (stage in
                  ('submitted','preliminary_review','verification','interview','territory_assessment','commercial_terms','agreement','training','activated','rejected','withdrawn')),
  stage_note      text not null default '' check (char_length(stage_note) <= 1000),
  score_reputation   int check (score_reputation between 1 and 5),
  score_experience   int check (score_experience between 1 and 5),
  score_competence   int check (score_competence between 1 and 5),
  score_customers    int check (score_customers between 1 and 5),
  score_compliance   int check (score_compliance between 1 and 5),
  score_capacity     int check (score_capacity between 1 and 5),
  score_communication int check (score_communication between 1 and 5),
  score_premises     int check (score_premises between 1 and 5),
  score_standards    int check (score_standards between 1 and 5),
  identity_verified  boolean not null default false,
  business_verified  boolean not null default false,
  interview_at    timestamptz,
  interview_note  text not null default '' check (char_length(interview_note) <= 1500),
  reject_reason   text not null default '' check (char_length(reject_reason) <= 600),
  reviewed_by     uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists pn_applications_stage_idx on public.pn_applications (stage, created_at desc);
create index if not exists pn_applications_user_idx on public.pn_applications (user_id, created_at desc);
alter table public.pn_applications enable row level security;
drop policy if exists "pn_applications: own or staff" on public.pn_applications;
create policy "pn_applications: own or staff" on public.pn_applications for select
  using (user_id = auth.uid() or public.has_perm('partners'));
revoke insert, update, delete on public.pn_applications from anon, authenticated;

-- ---------- 4. Partners ----------
create table if not exists public.pn_partners (
  id              uuid primary key default gen_random_uuid(),
  partner_id      text not null unique default ('RQ-P-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 7))),
  user_id         uuid not null unique references public.profiles (id) on delete cascade,
  application_id  uuid references public.pn_applications (id) on delete set null,
  category        text not null check (category in ('associate','area','franchise')),
  display_name    text not null check (char_length(btrim(display_name)) between 2 and 160),
  business_type   text not null default 'individual' check (business_type in ('individual','sole_proprietor','aop','private_limited','agency','other_registered')),
  ntn             text not null default '' check (char_length(ntn) <= 30),
  registration_no text not null default '' check (char_length(registration_no) <= 60),
  phone           text not null default '' check (char_length(phone) <= 20),
  whatsapp        text not null default '' check (char_length(whatsapp) <= 20),
  email           text not null default '' check (char_length(email) <= 160),
  office_address  text not null default '' check (char_length(office_address) <= 300),
  photo_path      text not null default '' check (char_length(photo_path) <= 400),
  about           text not null default '' check (char_length(about) <= 1200),
  services        text[] not null default '{}',               -- only what RAQBO has authorised
  -- Branding: the designation must reflect the real contractual status
  designation     text not null default '' check (char_length(designation) <= 120),
  branding_approved boolean not null default false,
  office_branding boolean not null default false,             -- full office branding: franchise only
  -- Status and performance
  status          text not null default 'under_review' check (status in ('under_review','probation','active','suspended','terminated')),
  status_note     text not null default '' check (char_length(status_note) <= 600),
  status_at       timestamptz not null default now(),
  training_done   boolean not null default false,
  agreement_ok    boolean not null default false,             -- set by the agreement, never by hand
  -- Public directory
  listed          boolean not null default true,              -- partner may ask not to be listed
  qr_token        text not null unique default (substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  -- What a partner may NOT do, recorded so it is never assumed
  may_collect_money boolean not null default false,           -- requires express written authority
  may_run_auction   boolean not null default false,           -- a RAQBO-branded auction
  joined_on       date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists pn_partners_status_idx on public.pn_partners (status, category);
create index if not exists pn_partners_user_idx on public.pn_partners (user_id);
alter table public.pn_partners enable row level security;
drop policy if exists "pn_partners: own or staff" on public.pn_partners;
create policy "pn_partners: own or staff" on public.pn_partners for select
  using (user_id = auth.uid() or public.has_perm('partners'));
revoke insert, update, delete on public.pn_partners from anon, authenticated;

-- An office-branding or auction right belongs only to a franchise
do $$ begin
  alter table public.pn_partners add constraint pn_partners_branding_check
    check (not office_branding or category = 'franchise');
exception when duplicate_object then null; end $$;

-- Which territories a partner works in
create table if not exists public.pn_partner_territories (
  partner_id    uuid not null references public.pn_partners (id) on delete cascade,
  territory_id  uuid not null references public.pn_territories (id) on delete cascade,
  exclusive     boolean not null default false,
  from_date     date not null default current_date,
  to_date       date,
  primary key (partner_id, territory_id)
);
create index if not exists pn_pt_territory_idx on public.pn_partner_territories (territory_id);
alter table public.pn_partner_territories enable row level security;
drop policy if exists "pn_partner_territories: read" on public.pn_partner_territories;
create policy "pn_partner_territories: read" on public.pn_partner_territories for select using (true);
revoke insert, update, delete on public.pn_partner_territories from anon, authenticated;

-- ---------- 5. Agreements ----------
create table if not exists public.pn_agreements (
  id             uuid primary key default gen_random_uuid(),
  ref            text not null unique default ('RQ-AG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  partner_id     uuid not null references public.pn_partners (id) on delete cascade,
  category       text not null check (category in ('associate','area','franchise')),
  -- The sixteen matters the agreement must define
  parties        text not null default '' check (char_length(parties) <= 600),
  relationship   text not null default '' check (char_length(relationship) <= 600),
  services       text not null default '' check (char_length(services) <= 1200),
  territory_text text not null default '' check (char_length(territory_text) <= 600),
  exclusivity    text not null default 'non_exclusive' check (exclusivity in ('exclusive','non_exclusive')),
  starts_on      date,
  ends_on        date,
  renewal        text not null default '' check (char_length(renewal) <= 400),
  commission_text text not null default '' check (char_length(commission_text) <= 1200),
  lead_allocation text not null default '' check (char_length(lead_allocation) <= 800),
  local_expenses text not null default '' check (char_length(local_expenses) <= 600),
  brand_use      text not null default '' check (char_length(brand_use) <= 800),
  data_protection text not null default '' check (char_length(data_protection) <= 800),
  reporting      text not null default '' check (char_length(reporting) <= 600),
  restrictions   text not null default '' check (char_length(restrictions) <= 800),
  disputes       text not null default '' check (char_length(disputes) <= 600),
  termination    text not null default '' check (char_length(termination) <= 800),
  after_termination text not null default '' check (char_length(after_termination) <= 600),
  -- Territory-based entitlement is never automatic
  territory_entitlement boolean not null default false,
  -- Execution
  status         text not null default 'draft' check (status in ('draft','sent','executed','expired','terminated')),
  executed_on    date,
  file_path      text not null default '' check (char_length(file_path) <= 400),
  legal_reviewed boolean not null default false,
  note           text not null default '' check (char_length(note) <= 600),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists pn_agreements_partner_idx on public.pn_agreements (partner_id, created_at desc);
create index if not exists pn_agreements_expiry_idx on public.pn_agreements (ends_on) where status = 'executed';
alter table public.pn_agreements enable row level security;
drop policy if exists "pn_agreements: own or staff" on public.pn_agreements;
create policy "pn_agreements: own or staff" on public.pn_agreements for select
  using (public.has_perm('partners') or exists (select 1 from public.pn_partners p where p.id = pn_agreements.partner_id and p.user_id = auth.uid()));
revoke insert, update, delete on public.pn_agreements from anon, authenticated;

-- A partner is only marked as having an agreement when one is executed.
create or replace function public.pn_agreement_sync() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.pn_partners p
     set agreement_ok = exists (select 1 from public.pn_agreements a
                                 where a.partner_id = p.id and a.status = 'executed'
                                   and (a.ends_on is null or a.ends_on >= current_date)),
         updated_at = now()
   where p.id = coalesce(new.partner_id, old.partner_id);
  -- An active partner whose agreement has gone loses active status.
  update public.pn_partners
     set status = 'under_review', status_note = 'No agreement in force.', status_at = now()
   where id = coalesce(new.partner_id, old.partner_id) and status = 'active' and not agreement_ok;
  return null;
end $$;
drop trigger if exists pn_agreement_sync_t on public.pn_agreements;
create trigger pn_agreement_sync_t after insert or update or delete on public.pn_agreements
  for each row execute function public.pn_agreement_sync();

-- ---------- 6. Documents, with expiry reminders ----------
create table if not exists public.pn_documents (
  id           uuid primary key default gen_random_uuid(),
  partner_id   uuid references public.pn_partners (id) on delete cascade,
  application_id uuid references public.pn_applications (id) on delete cascade,
  kind         text not null default 'other' check (kind in ('cnic','ntn','registration','licence','agreement','office_proof','photo','other')),
  title        text not null default '' check (char_length(title) <= 160),
  path         text not null check (char_length(path) between 1 and 400),
  expires_on   date,
  reminded_at  timestamptz,
  uploaded_by  uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  check (partner_id is not null or application_id is not null)
);
create index if not exists pn_documents_expiry_idx on public.pn_documents (expires_on) where expires_on is not null;
alter table public.pn_documents enable row level security;
drop policy if exists "pn_documents: own or staff" on public.pn_documents;
create policy "pn_documents: own or staff" on public.pn_documents for select using (
  public.has_perm('partners')
  or exists (select 1 from public.pn_partners p where p.id = pn_documents.partner_id and p.user_id = auth.uid())
  or exists (select 1 from public.pn_applications a where a.id = pn_documents.application_id and a.user_id = auth.uid())
);
revoke insert, update, delete on public.pn_documents from anon, authenticated;

insert into storage.buckets (id, name, public) values ('partner-docs', 'partner-docs', false) on conflict (id) do nothing;
drop policy if exists "partner-docs: owner upload" on storage.objects;
create policy "partner-docs: owner upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'partner-docs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "partner-docs: owner or staff read" on storage.objects;
create policy "partner-docs: owner or staff read" on storage.objects for select to authenticated
  using (bucket_id = 'partner-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.has_perm('partners')));
drop policy if exists "partner-docs: owner remove" on storage.objects;
create policy "partner-docs: owner remove" on storage.objects for delete to authenticated
  using (bucket_id = 'partner-docs' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- 7. Leads ----------
create table if not exists public.pn_leads (
  id            uuid primary key default gen_random_uuid(),
  ref           text not null unique default ('RQ-LD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  source        text not null default 'raqbo' check (source in ('raqbo','partner','website','referral')),
  origin_partner uuid references public.pn_partners (id) on delete set null,   -- who generated it, recorded always
  kind          text not null default 'buyer' check (kind in ('buyer','seller','landlord','tenant','service','commercial','quicksell','auction','other')),
  service       text not null default '' check (char_length(service) <= 60),
  listing_id    uuid references public.listings (id) on delete set null,
  enquiry_id    uuid references public.enquiries (id) on delete set null,
  customer_name text not null default '' check (char_length(customer_name) <= 120),
  customer_phone text not null default '' check (char_length(customer_phone) <= 20),
  customer_note text not null default '' check (char_length(customer_note) <= 1000),
  province      text not null default '' check (char_length(province) <= 60),
  city          text not null default '' check (char_length(city) <= 60),
  area          text not null default '' check (char_length(area) <= 120),
  territory_id  uuid references public.pn_territories (id) on delete set null,
  -- Assignment
  partner_id    uuid references public.pn_partners (id) on delete set null,
  assigned_at   timestamptz,
  accept_by     timestamptz,                                  -- after this it returns to RAQBO
  accepted_at   timestamptz,
  declined_at   timestamptz,
  decline_reason text not null default '' check (char_length(decline_reason) <= 400),
  reassigned    int not null default 0 check (reassigned >= 0),
  handled_by_raqbo boolean not null default false,            -- RAQBO may always handle a customer directly
  -- Workflow
  stage         text not null default 'new' check (stage in
                ('new','raqbo_review','assigned','accepted','contacted','site_visit','negotiation','completed','lost','returned')),
  stage_note    text not null default '' check (char_length(stage_note) <= 600),
  contacted_at  timestamptz,
  visit_at      timestamptz,
  completed_at  timestamptz,
  lost_reason   text not null default '' check (char_length(lost_reason) <= 400),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists pn_leads_partner_idx on public.pn_leads (partner_id, created_at desc);
create index if not exists pn_leads_stage_idx on public.pn_leads (stage, created_at desc);
create index if not exists pn_leads_waiting_idx on public.pn_leads (accept_by) where stage = 'assigned';
create index if not exists pn_leads_territory_idx on public.pn_leads (territory_id, created_at desc);
alter table public.pn_leads enable row level security;
-- A partner sees only the leads assigned to them or that they generated.
drop policy if exists "pn_leads: mine or staff" on public.pn_leads;
create policy "pn_leads: mine or staff" on public.pn_leads for select using (
  public.has_perm('partners')
  or exists (select 1 from public.pn_partners p where p.user_id = auth.uid() and p.id in (pn_leads.partner_id, pn_leads.origin_partner))
);
revoke insert, update, delete on public.pn_leads from anon, authenticated;

create table if not exists public.pn_lead_events (
  id         bigserial primary key,
  lead_id    uuid not null references public.pn_leads (id) on delete cascade,
  stage      text not null,
  by_user    uuid references public.profiles (id) on delete set null,
  note       text not null default '' check (char_length(note) <= 600),
  at         timestamptz not null default now()
);
create index if not exists pn_lead_events_lead_idx on public.pn_lead_events (lead_id, at);
alter table public.pn_lead_events enable row level security;
drop policy if exists "pn_lead_events: follow lead" on public.pn_lead_events;
create policy "pn_lead_events: follow lead" on public.pn_lead_events for select using (
  exists (select 1 from public.pn_leads l where l.id = lead_id)
);
revoke insert, update, delete on public.pn_lead_events from anon, authenticated;

-- ---------- 8. Transactions and commission ----------
create table if not exists public.pn_transactions (
  id             uuid primary key default gen_random_uuid(),
  ref            text not null unique default ('RQ-TX-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  lead_id        uuid references public.pn_leads (id) on delete set null,
  partner_id     uuid not null references public.pn_partners (id) on delete cascade,
  listing_id     uuid references public.listings (id) on delete set null,
  service        text not null default '' check (char_length(service) <= 60),
  description    text not null default '' check (char_length(description) <= 600),
  lead_source    text not null default 'raqbo' check (lead_source in ('partner','raqbo')),
  -- Money. The commission is a share of the FEE, never of the property value.
  property_value bigint check (property_value is null or property_value >= 0),   -- recorded for the file only
  gross_fee      bigint not null default 0 check (gross_fee >= 0),               -- the service fee charged
  fee_received   bigint not null default 0 check (fee_received >= 0),            -- what RAQBO actually received
  tax_deduction  bigint not null default 0 check (tax_deduction >= 0),
  third_party    bigint not null default 0 check (third_party >= 0),
  refunded       bigint not null default 0 check (refunded >= 0),
  other_deduction bigint not null default 0 check (other_deduction >= 0),
  deduction_note text not null default '' check (char_length(deduction_note) <= 400),
  stage          text not null default 'open' check (stage in ('open','fee_received','settled','cancelled')),
  completed_on   date,
  documents      text[] not null default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists pn_transactions_partner_idx on public.pn_transactions (partner_id, created_at desc);
create index if not exists pn_transactions_stage_idx on public.pn_transactions (stage, created_at desc);
alter table public.pn_transactions enable row level security;
drop policy if exists "pn_transactions: mine or staff" on public.pn_transactions;
create policy "pn_transactions: mine or staff" on public.pn_transactions for select using (
  public.has_perm('partners') or exists (select 1 from public.pn_partners p where p.id = pn_transactions.partner_id and p.user_id = auth.uid())
);
revoke insert, update, delete on public.pn_transactions from anon, authenticated;

create table if not exists public.pn_commissions (
  id             uuid primary key default gen_random_uuid(),
  ref            text not null unique default ('RQ-CM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  transaction_id uuid not null unique references public.pn_transactions (id) on delete cascade,
  partner_id     uuid not null references public.pn_partners (id) on delete cascade,
  rate_pct       numeric(5,2) not null check (rate_pct >= 0 and rate_pct <= 100),
  rate_source    text not null default '' check (char_length(rate_source) <= 160),   -- which rule was used
  distributable  bigint not null default 0 check (distributable >= 0),               -- fee received less deductions
  amount         bigint not null default 0 check (amount >= 0),
  status         text not null default 'pending' check (status in ('pending','approved','paid','disputed','rejected','cancelled')),
  dispute_note   text not null default '' check (char_length(dispute_note) <= 800),
  dispute_outcome text not null default '' check (char_length(dispute_outcome) <= 800),
  approved_by    uuid references public.profiles (id) on delete set null,
  approved_at    timestamptz,
  payout_id      uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists pn_commissions_partner_idx on public.pn_commissions (partner_id, created_at desc);
create index if not exists pn_commissions_status_idx on public.pn_commissions (status, created_at desc);
alter table public.pn_commissions enable row level security;
drop policy if exists "pn_commissions: mine or staff" on public.pn_commissions;
create policy "pn_commissions: mine or staff" on public.pn_commissions for select using (
  public.has_perm('partners') or exists (select 1 from public.pn_partners p where p.id = pn_commissions.partner_id and p.user_id = auth.uid())
);
revoke insert, update, delete on public.pn_commissions from anon, authenticated;

create table if not exists public.pn_payouts (
  id           uuid primary key default gen_random_uuid(),
  ref          text not null unique default ('RQ-PO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  partner_id   uuid not null references public.pn_partners (id) on delete cascade,
  period_from  date not null,
  period_to    date not null,
  amount       bigint not null default 0 check (amount >= 0),
  status       text not null default 'draft' check (status in ('draft','approved','paid','cancelled')),
  method       text not null default 'bank' check (method in ('bank','cheque','other')),
  reference    text not null default '' check (char_length(reference) <= 120),   -- traceable banking reference
  approved_by  uuid references public.profiles (id) on delete set null,
  approved_at  timestamptz,
  paid_on      date,
  note         text not null default '' check (char_length(note) <= 600),
  created_at   timestamptz not null default now(),
  check (period_to >= period_from)
);
create index if not exists pn_payouts_partner_idx on public.pn_payouts (partner_id, created_at desc);
alter table public.pn_payouts enable row level security;
drop policy if exists "pn_payouts: mine or staff" on public.pn_payouts;
create policy "pn_payouts: mine or staff" on public.pn_payouts for select using (
  public.has_perm('partners') or exists (select 1 from public.pn_partners p where p.id = pn_payouts.partner_id and p.user_id = auth.uid())
);
revoke insert, update, delete on public.pn_payouts from anon, authenticated;

-- ---------- 9. Training ----------
create table if not exists public.pn_training (
  id        uuid primary key default gen_random_uuid(),
  code      text not null unique check (char_length(code) between 2 and 40),
  title     text not null check (char_length(btrim(title)) between 3 and 160),
  body      text not null default '' check (char_length(body) <= 8000),
  video_url text not null default '' check (char_length(video_url) <= 400),
  required  boolean not null default true,
  sort      int not null default 0,
  active    boolean not null default true
);
alter table public.pn_training enable row level security;
drop policy if exists "pn_training: read" on public.pn_training;
create policy "pn_training: read" on public.pn_training for select using (true);
revoke insert, update, delete on public.pn_training from anon, authenticated;

insert into public.pn_training (code, title, sort, body) values
  ('intro',      'Introduction to RAQBO services', 1,  'What RAQBO offers, how a property moves through the website, and where a partner fits in.'),
  ('listing',    'Property listing standards', 2,      'What a genuine listing must contain, photographs, measurements, and what may never be claimed.'),
  ('customer',   'Customer communication', 3,          'How to speak with buyers, sellers, landlords and tenants, and what may not be promised.'),
  ('verify',     'Buyer and seller verification', 4,   'Identity and ownership checks, and why RAQBO verifies rather than guarantees.'),
  ('documents',  'Document handling', 5,               'Collecting, viewing and returning ownership documents, and what may never be forwarded.'),
  ('quicksell',  'The QuickSell process', 6,           'How an urgent sale is handled, and why pricing and investor information stays confidential.'),
  ('auctions',   'Property auction procedures', 7,     'What a partner may and may not do for a RAQBO auction or an official auction notice.'),
  ('leads',      'The lead management system', 8,      'Accepting a lead, the response window, and what happens if a lead is not answered.'),
  ('commission', 'Commission structure', 9,            'How a share is worked out from the fee RAQBO receives, and when it becomes payable.'),
  ('privacy',    'Customer privacy', 10,               'What a partner may see, what may never be exported, and how activity is logged.'),
  ('fraud',      'Fraud prevention', 11,               'Warning signs, forged documents, and never taking money on RAQBO''s behalf.'),
  ('complaints', 'Complaint handling', 12,             'How a complaint is raised, answered and recorded.'),
  ('conduct',    'Professional conduct', 13,           'The standard expected of anyone carrying the RAQBO name.')
on conflict (code) do nothing;

create table if not exists public.pn_training_done (
  partner_id uuid not null references public.pn_partners (id) on delete cascade,
  code       text not null references public.pn_training (code) on delete cascade,
  done_at    timestamptz not null default now(),
  primary key (partner_id, code)
);
alter table public.pn_training_done enable row level security;
drop policy if exists "pn_training_done: mine or staff" on public.pn_training_done;
create policy "pn_training_done: mine or staff" on public.pn_training_done for select using (
  public.has_perm('partners') or exists (select 1 from public.pn_partners p where p.id = pn_training_done.partner_id and p.user_id = auth.uid())
);
revoke insert, update, delete on public.pn_training_done from anon, authenticated;

-- ---------- 10. Activity log (controlled exports, logged account activity) ----------
create table if not exists public.pn_activity (
  id         bigserial primary key,
  partner_id uuid references public.pn_partners (id) on delete cascade,
  user_id    uuid references public.profiles (id) on delete set null,
  action     text not null check (char_length(action) <= 60),
  entity     text not null default '' check (char_length(entity) <= 60),
  ref        text not null default '' check (char_length(ref) <= 60),
  detail     text not null default '' check (char_length(detail) <= 400),
  at         timestamptz not null default now()
);
create index if not exists pn_activity_partner_idx on public.pn_activity (partner_id, at desc);
alter table public.pn_activity enable row level security;
drop policy if exists "pn_activity: staff" on public.pn_activity;
create policy "pn_activity: staff" on public.pn_activity for select using (public.has_perm('partners'));
revoke insert, update, delete on public.pn_activity from anon, authenticated;

create or replace function public.pn_log(p_partner uuid, p_action text, p_entity text, p_ref text, p_detail text)
returns void language sql security definer set search_path = public as $$
  insert into public.pn_activity (partner_id, user_id, action, entity, ref, detail)
  values (p_partner, auth.uid(), left(p_action, 60), left(coalesce(p_entity, ''), 60), left(coalesce(p_ref, ''), 60), left(coalesce(p_detail, ''), 400));
$$;

-- ---------- 11. Partner listings: never verified just because a partner sent them ----------
alter table public.listings add column if not exists partner_id uuid references public.pn_partners (id) on delete set null;
alter table public.listings add column if not exists owner_authorised boolean not null default false;
alter table public.listings add column if not exists owner_auth_note text not null default '' check (char_length(owner_auth_note) <= 300);
alter table public.listings add column if not exists advert_expires_on date;
create index if not exists listings_partner_idx on public.listings (partner_id, created_at desc) where partner_id is not null;

-- ---------- 12. Helpers ----------
create or replace function public.pn_me() returns uuid language sql stable security definer set search_path = public as $$
  select id from public.pn_partners where user_id = auth.uid()
$$;

create or replace function public.pn_is_partner() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pn_partners where user_id = auth.uid() and status in ('active','probation'))
$$;

-- The commission percentage that applies to a transaction, newest effective rule first.
create or replace function public.pn_rate_for(p_category text, p_service text, p_source text, p_on date)
returns table (pct numeric, src text) language sql stable security definer set search_path = public as $$
  select r.partner_pct,
         'category ' || r.category || ', service ' || r.service || ', lead ' || r.lead_source || ', from ' || r.effective_from
    from public.pn_rates r
   where r.active and r.category = p_category and r.effective_from <= coalesce(p_on, current_date)
     and r.service in (p_service, 'any') and r.lead_source in (p_source, 'any')
   order by (r.service <> 'any') desc, (r.lead_source <> 'any') desc, r.effective_from desc
   limit 1
$$;

-- Find the territory a place belongs to, most specific first.
create or replace function public.pn_territory_for(p_province text, p_city text, p_area text)
returns uuid language sql stable security definer set search_path = public as $$
  select t.id from public.pn_territories t
   where t.status in ('appointed','additional_allowed','available','under_review')
     and (p_city = '' or t.city = '' or lower(t.city) = lower(p_city))
     and (p_province = '' or t.province = '' or lower(t.province) = lower(p_province))
     and (t.level not in ('society','commercial_area','locality') or (p_area <> '' and lower(t.name) = lower(p_area)))
   order by case t.level when 'locality' then 1 when 'society' then 2 when 'commercial_area' then 3
                         when 'town' then 4 when 'city' then 5 when 'tehsil' then 6
                         when 'district' then 7 when 'division' then 8 else 9 end,
            (lower(t.name) = lower(coalesce(nullif(p_area, ''), p_city))) desc
   limit 1
$$;

do $$ begin raise notice 'Update 29 part 1 of 2 applied (tables). Run the rest of the file.'; end $$;

-- =====================================================================
-- PART 2 — what the website and the admin panel actually call
-- =====================================================================

-- ---------- Public: the Become a Partner page ----------
create or replace function public.pn_public()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'settings', (select to_jsonb(s) - 'id' from public.pn_settings s),
    'rates', (select coalesce(jsonb_agg(jsonb_build_object('category', category, 'service', service, 'lead_source', lead_source, 'partner_pct', partner_pct, 'note', note) order by category), '[]'::jsonb)
                from public.pn_rates where active and effective_from <= current_date),
    'training', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'title', title, 'body', body, 'required', required) order by sort), '[]'::jsonb)
                   from public.pn_training where active),
    'partners_live', (select count(*) from public.pn_partners where status in ('active','probation') and listed),
    'cities', (select coalesce(jsonb_agg(distinct city) filter (where city <> ''), '[]'::jsonb) from public.pn_territories where status in ('available','additional_allowed')),
    'territories_open', (select count(*) from public.pn_territories where status in ('available','additional_allowed'))
  )
$$;

-- Territories a visitor may apply for
create or replace function public.pn_territories_open(p_province text default '', p_city text default '')
returns table (id uuid, code text, level text, name text, province text, district text, city text, status text, max_partners int, taken bigint)
language sql stable security definer set search_path = public as $$
  select t.id, t.code, t.level, t.name, t.province, t.district, t.city, t.status, t.max_partners,
         (select count(*) from public.pn_partner_territories pt join public.pn_partners p on p.id = pt.partner_id
           where pt.territory_id = t.id and p.status in ('active','probation'))
    from public.pn_territories t
   where (p_province = '' or lower(t.province) = lower(p_province))
     and (p_city = '' or lower(t.city) = lower(p_city))
   order by t.province, t.city, t.name
$$;

-- ---------- Applying ----------
create or replace function public.pn_apply(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_ref text; v_open boolean; v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Please sign in before applying.'; end if;
  select network_open into v_open from public.pn_settings where id;
  if not coalesce(v_open, false) then raise exception 'RAQBO is not accepting partner applications at the moment.'; end if;
  if not coalesce((p->>'declared')::boolean, false) then
    raise exception 'Please confirm the declaration. An application does not by itself grant any partnership right.';
  end if;
  if exists (select 1 from public.pn_applications where user_id = v_user and stage not in ('rejected','withdrawn')) then
    raise exception 'You already have an application with RAQBO. Please follow it in My RAQBO instead of sending another.';
  end if;
  if exists (select 1 from public.pn_partners where user_id = v_user and status <> 'terminated') then
    raise exception 'You are already a RAQBO partner.';
  end if;

  insert into public.pn_applications (
    user_id, full_name, cnic_last4, phone, whatsapp, email, home_address, office_address, photo_path, background,
    business_type, business_name, ntn, registration_no, dealer_licence, business_years, office_details, affiliations,
    province, city, district, tehsil, area_wanted, territory_id, has_office,
    want_category, exp_years, customer_network, staff_count, categories_handled, marketing, skills, inventory_note,
    services, doc_paths, declared
  ) values (
    v_user,
    btrim(coalesce(p->>'full_name', '')),
    coalesce(nullif(right(regexp_replace(coalesce(p->>'cnic', ''), '[^0-9]', '', 'g'), 4), ''), ''),
    btrim(coalesce(p->>'phone', '')), btrim(coalesce(p->>'whatsapp', '')), btrim(coalesce(p->>'email', '')),
    left(coalesce(p->>'home_address', ''), 300), left(coalesce(p->>'office_address', ''), 300),
    left(coalesce(p->>'photo_path', ''), 400), left(coalesce(p->>'background', ''), 1500),
    coalesce(nullif(p->>'business_type', ''), 'individual'), left(coalesce(p->>'business_name', ''), 160),
    left(coalesce(p->>'ntn', ''), 30), left(coalesce(p->>'registration_no', ''), 60), left(coalesce(p->>'dealer_licence', ''), 80),
    nullif(p->>'business_years', '')::int, left(coalesce(p->>'office_details', ''), 600), left(coalesce(p->>'affiliations', ''), 400),
    left(coalesce(p->>'province', ''), 60), left(coalesce(p->>'city', ''), 60), left(coalesce(p->>'district', ''), 60),
    left(coalesce(p->>'tehsil', ''), 60), left(coalesce(p->>'area_wanted', ''), 200),
    nullif(p->>'territory_id', '')::uuid, coalesce((p->>'has_office')::boolean, false),
    coalesce(nullif(p->>'want_category', ''), 'area'),
    nullif(p->>'exp_years', '')::int, left(coalesce(p->>'customer_network', ''), 600), nullif(p->>'staff_count', '')::int,
    coalesce(array(select jsonb_array_elements_text(coalesce(p->'categories_handled', '[]'::jsonb))), '{}'),
    left(coalesce(p->>'marketing', ''), 600), left(coalesce(p->>'skills', ''), 600), left(coalesce(p->>'inventory_note', ''), 600),
    coalesce(array(select jsonb_array_elements_text(coalesce(p->'services', '[]'::jsonb))), '{}'),
    coalesce(array(select jsonb_array_elements_text(coalesce(p->'doc_paths', '[]'::jsonb))), '{}'),
    true
  ) returning ref into v_ref;

  perform public.notify_admins('partner_application', 'New partner application ' || v_ref,
    btrim(coalesce(p->>'full_name', '')) || ' — ' || coalesce(nullif(p->>'city', ''), 'city not given'), '#admin');
  return v_ref;
end $$;

create or replace function public.pn_my_application()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select to_jsonb(a) from public.pn_applications a where a.user_id = auth.uid()
                    order by a.created_at desc limit 1), 'null'::jsonb)
$$;

-- ---------- The public directory ----------
-- Only approved, active, listed partners, and only the contact details RAQBO approved.
-- Dropped first so that re-running this file after a later update, which
-- adds columns to what the directory returns, cannot fail on the change.
drop function if exists public.pn_directory(text, text, text, text, text);
create function public.pn_directory(p_province text default '', p_city text default '', p_area text default '',
                                               p_service text default '', p_q text default '')
returns table (partner_id text, display_name text, category text, business_type text, city text, province text,
               office_address text, phone text, whatsapp text, email text, services text[], designation text,
               status text, verified boolean, qr_token text, territories jsonb, since date)
language sql stable security definer set search_path = public as $$
  select p.partner_id, p.display_name, p.category, p.business_type,
         coalesce(nullif((select string_agg(distinct t.city, ', ') from public.pn_partner_territories pt
                            join public.pn_territories t on t.id = pt.territory_id where pt.partner_id = p.id and t.city <> ''), ''), '') as city,
         coalesce(nullif((select string_agg(distinct t.province, ', ') from public.pn_partner_territories pt
                            join public.pn_territories t on t.id = pt.territory_id where pt.partner_id = p.id and t.province <> ''), ''), '') as province,
         p.office_address, p.phone, p.whatsapp, p.email, p.services, p.designation,
         p.status, (p.agreement_ok and p.status = 'active') as verified, p.qr_token,
         (select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'level', t.level, 'city', t.city) order by t.name), '[]'::jsonb)
            from public.pn_partner_territories pt join public.pn_territories t on t.id = pt.territory_id where pt.partner_id = p.id) as territories,
         p.joined_on
    from public.pn_partners p
   where p.listed and p.status in ('active','probation')
     and (select directory_public from public.pn_settings where id)
     and (p_service = '' or p_service = any (p.services))
     and (p_q = '' or p.display_name ilike '%' || p_q || '%' or p.partner_id ilike '%' || p_q || '%')
     and (p_province = '' or exists (select 1 from public.pn_partner_territories pt join public.pn_territories t on t.id = pt.territory_id
                                      where pt.partner_id = p.id and lower(t.province) = lower(p_province)))
     and (p_city = '' or exists (select 1 from public.pn_partner_territories pt join public.pn_territories t on t.id = pt.territory_id
                                  where pt.partner_id = p.id and lower(t.city) = lower(p_city)))
     and (p_area = '' or exists (select 1 from public.pn_partner_territories pt join public.pn_territories t on t.id = pt.territory_id
                                  where pt.partner_id = p.id and t.name ilike '%' || p_area || '%'))
   order by (p.status = 'active') desc, p.display_name
$$;

-- The QR code on a signboard or business card points here.
create or replace function public.pn_verify_qr(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object(
      'found', true,
      'partner_id', p.partner_id,
      'name', p.display_name,
      'category', p.category,
      'designation', p.designation,
      'status', p.status,
      'active', (p.status = 'active' and p.agreement_ok),
      'office_branding', p.office_branding,
      'may_collect_money', p.may_collect_money,
      'services', to_jsonb(p.services),
      'since', p.joined_on,
      'checked_at', now(),
      'territories', (select coalesce(jsonb_agg(t.name order by t.name), '[]'::jsonb) from public.pn_partner_territories pt
                        join public.pn_territories t on t.id = pt.territory_id where pt.partner_id = p.id)
    ) from public.pn_partners p where p.qr_token = p_token
  ), jsonb_build_object('found', false));
$$;

-- ---------- The partner's own dashboard ----------
create or replace function public.pn_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.pn_me();
begin
  if me is null then return jsonb_build_object('partner', null); end if;
  return jsonb_build_object(
    'partner', (select to_jsonb(p) - 'qr_token' || jsonb_build_object('qr_token', p.qr_token) from public.pn_partners p where p.id = me),
    'territories', (select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'level', t.level, 'city', t.city,
                      'province', t.province, 'status', t.status, 'exclusive', pt.exclusive, 'from', pt.from_date) order by t.name), '[]'::jsonb)
                      from public.pn_partner_territories pt join public.pn_territories t on t.id = pt.territory_id where pt.partner_id = me),
    'agreement', (select to_jsonb(a) from public.pn_agreements a where a.partner_id = me and a.status = 'executed'
                   order by a.executed_on desc nulls last limit 1),
    'listings', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'ref', l.ref, 'title', l.title, 'status', l.status,
                      'city', l.city, 'area', l.area, 'price', l.price, 'purpose', l.purpose,
                      'owner_authorised', l.owner_authorised, 'expires', l.advert_expires_on, 'created', l.created_at)
                      order by l.created_at desc), '[]'::jsonb) from public.listings l where l.partner_id = me),
    'leads', (select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at desc), '[]'::jsonb)
                from public.pn_leads l where l.partner_id = me or l.origin_partner = me),
    'transactions', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
                       from public.pn_transactions x where x.partner_id = me),
    'commissions', (select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc), '[]'::jsonb)
                      from public.pn_commissions c where c.partner_id = me),
    'payouts', (select coalesce(jsonb_agg(to_jsonb(o) order by o.created_at desc), '[]'::jsonb)
                  from public.pn_payouts o where o.partner_id = me),
    'training', (select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'title', t.title, 'body', t.body,
                      'video_url', t.video_url, 'required', t.required,
                      'done', exists (select 1 from public.pn_training_done d where d.partner_id = me and d.code = t.code)) order by t.sort), '[]'::jsonb)
                      from public.pn_training t where t.active),
    'documents', (select coalesce(jsonb_agg(jsonb_build_object('kind', d.kind, 'title', d.title, 'path', d.path, 'expires', d.expires_on) order by d.created_at desc), '[]'::jsonb)
                    from public.pn_documents d where d.partner_id = me),
    'performance', public.pn_performance(me, (current_date - 90), current_date),
    'earnings', (select jsonb_build_object(
          'earned', coalesce(sum(amount) filter (where status in ('approved','paid')), 0),
          'pending', coalesce(sum(amount) filter (where status = 'pending'), 0),
          'paid', coalesce(sum(amount) filter (where status = 'paid'), 0),
          'disputed', coalesce(sum(amount) filter (where status = 'disputed'), 0))
        from public.pn_commissions where partner_id = me)
  );
end $$;

-- Performance figures, worked out from real records only.
create or replace function public.pn_performance(p_partner uuid, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'listings', (select count(*) from public.listings where partner_id = p_partner and created_at::date between p_from and p_to),
    'listings_live', (select count(*) from public.listings where partner_id = p_partner and status = 'published'),
    'leads_total', (select count(*) from public.pn_leads where partner_id = p_partner and created_at::date between p_from and p_to),
    'leads_generated', (select count(*) from public.pn_leads where origin_partner = p_partner and created_at::date between p_from and p_to),
    'leads_accepted', (select count(*) from public.pn_leads where partner_id = p_partner and accepted_at is not null and created_at::date between p_from and p_to),
    'leads_lost', (select count(*) from public.pn_leads where partner_id = p_partner and stage = 'lost' and created_at::date between p_from and p_to),
    'leads_returned', (select count(*) from public.pn_leads where partner_id = p_partner and stage = 'returned' and created_at::date between p_from and p_to),
    'visits', (select count(*) from public.pn_leads where partner_id = p_partner and visit_at is not null and created_at::date between p_from and p_to),
    'completed', (select count(*) from public.pn_leads where partner_id = p_partner and stage = 'completed' and created_at::date between p_from and p_to),
    'revenue', (select coalesce(sum(fee_received), 0) from public.pn_transactions where partner_id = p_partner and created_at::date between p_from and p_to),
    'response_hours', (select round(avg(extract(epoch from (accepted_at - assigned_at)) / 3600.0)::numeric, 1)
                         from public.pn_leads where partner_id = p_partner and accepted_at is not null and assigned_at is not null
                          and created_at::date between p_from and p_to),
    'complaints', (select count(*) from public.complaints c where c.created_at::date between p_from and p_to
                     and c.subject_ref = (select partner_id from public.pn_partners where id = p_partner))
  )
$$;

create or replace function public.pn_statement(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.pn_me();
begin
  if me is null then raise exception 'Only a RAQBO partner can download a statement.'; end if;
  return jsonb_build_object(
    'partner', (select jsonb_build_object('partner_id', partner_id, 'name', display_name, 'category', category) from public.pn_partners where id = me),
    'from', p_from, 'to', p_to, 'issued_at', now(),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
        'date', x.completed_on, 'ref', x.ref, 'service', x.service, 'description', x.description,
        'gross_fee', x.gross_fee, 'fee_received', x.fee_received,
        'deductions', (x.tax_deduction + x.third_party + x.refunded + x.other_deduction),
        'deduction_note', x.deduction_note,
        'distributable', c.distributable, 'rate_pct', c.rate_pct, 'amount', c.amount,
        'status', c.status, 'commission_ref', c.ref) order by x.created_at), '[]'::jsonb)
      from public.pn_transactions x join public.pn_commissions c on c.transaction_id = x.id
      where x.partner_id = me and coalesce(x.completed_on, x.created_at::date) between p_from and p_to),
    'total', (select coalesce(sum(c.amount), 0) from public.pn_transactions x join public.pn_commissions c on c.transaction_id = x.id
                where x.partner_id = me and coalesce(x.completed_on, x.created_at::date) between p_from and p_to),
    'note', 'Commission is a share of the service fee RAQBO actually received. It is never a share of the property price.'
  );
end $$;

-- ---------- The partner answering a lead ----------
create or replace function public.pn_lead_accept(p_ref text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := public.pn_me(); l public.pn_leads;
begin
  select * into l from public.pn_leads where ref = p_ref;
  if not found or l.partner_id is distinct from me then raise exception 'That lead is not assigned to you.'; end if;
  if l.stage <> 'assigned' then raise exception 'That lead can no longer be accepted.'; end if;
  if l.accept_by is not null and now() > l.accept_by then
    raise exception 'The time to accept this lead has passed and it has gone back to RAQBO.';
  end if;
  update public.pn_leads set stage = 'accepted', accepted_at = now(), updated_at = now() where id = l.id;
  insert into public.pn_lead_events (lead_id, stage, by_user, note) values (l.id, 'accepted', auth.uid(), '');
  perform public.pn_log(me, 'lead_accept', 'lead', p_ref, '');
end $$;

create or replace function public.pn_lead_decline(p_ref text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := public.pn_me(); l public.pn_leads;
begin
  select * into l from public.pn_leads where ref = p_ref;
  if not found or l.partner_id is distinct from me then raise exception 'That lead is not assigned to you.'; end if;
  update public.pn_leads set stage = 'returned', partner_id = null, declined_at = now(),
         decline_reason = left(coalesce(p_reason, ''), 400), updated_at = now() where id = l.id;
  insert into public.pn_lead_events (lead_id, stage, by_user, note) values (l.id, 'returned', auth.uid(), left(coalesce(p_reason, ''), 600));
  perform public.notify_admins('partner_lead', 'Lead ' || p_ref || ' returned to RAQBO', coalesce(p_reason, 'Declined by the partner.'), '#admin');
  perform public.pn_log(me, 'lead_decline', 'lead', p_ref, left(coalesce(p_reason, ''), 400));
end $$;

create or replace function public.pn_lead_stage(p_ref text, p_stage text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := public.pn_me(); l public.pn_leads;
begin
  select * into l from public.pn_leads where ref = p_ref;
  if not found then raise exception 'Lead not found.'; end if;
  if not public.has_perm('partners') and l.partner_id is distinct from me then
    raise exception 'That lead is not yours.';
  end if;
  if p_stage not in ('contacted','site_visit','negotiation','completed','lost') then
    raise exception 'That is not a step a partner can set.';
  end if;
  if l.accepted_at is null and not public.has_perm('partners') then
    raise exception 'Accept the lead before moving it forward.';
  end if;
  update public.pn_leads set
    stage = p_stage,
    stage_note = left(coalesce(p_note, ''), 600),
    contacted_at = case when p_stage = 'contacted' and contacted_at is null then now() else contacted_at end,
    visit_at     = case when p_stage = 'site_visit' and visit_at is null then now() else visit_at end,
    completed_at = case when p_stage = 'completed' then now() else completed_at end,
    lost_reason  = case when p_stage = 'lost' then left(coalesce(p_note, ''), 400) else lost_reason end,
    updated_at = now()
  where id = l.id;
  insert into public.pn_lead_events (lead_id, stage, by_user, note) values (l.id, p_stage, auth.uid(), left(coalesce(p_note, ''), 600));
  perform public.pn_log(coalesce(me, l.partner_id), 'lead_' || p_stage, 'lead', p_ref, left(coalesce(p_note, ''), 400));
end $$;

create or replace function public.pn_training_complete(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := public.pn_me(); need int; done int;
begin
  if me is null then raise exception 'Only a RAQBO partner can record training.'; end if;
  insert into public.pn_training_done (partner_id, code) values (me, p_code) on conflict do nothing;
  select count(*) into need from public.pn_training where active and required;
  select count(*) into done from public.pn_training_done d join public.pn_training t on t.code = d.code
    where d.partner_id = me and t.active and t.required;
  update public.pn_partners set training_done = (done >= need), updated_at = now() where id = me;
  perform public.pn_log(me, 'training', 'module', p_code, '');
end $$;

create or replace function public.pn_profile_save(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := public.pn_me();
begin
  if me is null then raise exception 'Only a RAQBO partner can change a partner profile.'; end if;
  -- A partner may change how they are reached and described, never their
  -- category, territory, designation or any permission.
  update public.pn_partners set
    phone = left(coalesce(p->>'phone', phone), 20),
    whatsapp = left(coalesce(p->>'whatsapp', whatsapp), 20),
    email = left(coalesce(p->>'email', email), 160),
    office_address = left(coalesce(p->>'office_address', office_address), 300),
    about = left(coalesce(p->>'about', about), 1200),
    photo_path = left(coalesce(p->>'photo_path', photo_path), 400),
    listed = coalesce((p->>'listed')::boolean, listed),
    updated_at = now()
  where id = me;
  perform public.pn_log(me, 'profile_save', 'partner', '', '');
end $$;

-- A partner sending an urgent-sale opportunity. Pricing and investor
-- information stays with RAQBO; the partner only reports the opportunity.
create or replace function public.pn_quicksell(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := public.pn_me(); v_ref text;
begin
  if me is null or not public.pn_is_partner() then raise exception 'Only an active RAQBO partner can send an opportunity.'; end if;
  insert into public.pn_leads (source, origin_partner, kind, service, customer_name, customer_phone, customer_note,
                               province, city, area, territory_id, stage)
  values ('partner', me, 'quicksell', 'quicksell',
          left(coalesce(p->>'owner_name', ''), 120), left(coalesce(p->>'phone', ''), 20),
          left(coalesce(p->>'detail', ''), 1000),
          left(coalesce(p->>'province', ''), 60), left(coalesce(p->>'city', ''), 60), left(coalesce(p->>'area', ''), 120),
          public.pn_territory_for(coalesce(p->>'province', ''), coalesce(p->>'city', ''), coalesce(p->>'area', '')),
          'raqbo_review')
  returning ref into v_ref;
  insert into public.pn_lead_events (lead_id, stage, by_user, note)
    select id, 'raqbo_review', auth.uid(), 'Urgent-sale opportunity sent by a partner.' from public.pn_leads where ref = v_ref;
  perform public.notify_admins('partner_quicksell', 'QuickSell opportunity ' || v_ref || ' from a partner',
    left(coalesce(p->>'detail', ''), 200), '#admin');
  perform public.pn_log(me, 'quicksell', 'lead', v_ref, '');
  return v_ref;
end $$;

-- =====================================================================
-- PART 3 — RAQBO Partner Network Management (admin)
-- =====================================================================

create or replace function public.pn_admin(p_what text default 'summary')
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  if p_what = 'applications' then
    return (select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb) from public.pn_applications a);
  elsif p_what = 'partners' then
    return (select coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object(
        'territories', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'city', t.city, 'exclusive', pt.exclusive) order by t.name), '[]'::jsonb)
                          from public.pn_partner_territories pt join public.pn_territories t on t.id = pt.territory_id where pt.partner_id = p.id),
        'agreement', (select a.status from public.pn_agreements a where a.partner_id = p.id order by a.created_at desc limit 1),
        'leads_open', (select count(*) from public.pn_leads l where l.partner_id = p.id and l.stage not in ('completed','lost','returned')),
        'owed', (select coalesce(sum(c.amount), 0) from public.pn_commissions c where c.partner_id = p.id and c.status = 'approved')
      ) order by p.created_at desc), '[]'::jsonb) from public.pn_partners p);
  elsif p_what = 'territories' then
    return (select coalesce(jsonb_agg(to_jsonb(t) || jsonb_build_object(
        'partners', (select coalesce(jsonb_agg(jsonb_build_object('partner_id', p.partner_id, 'name', p.display_name, 'status', p.status, 'exclusive', pt.exclusive)), '[]'::jsonb)
                       from public.pn_partner_territories pt join public.pn_partners p on p.id = pt.partner_id where pt.territory_id = t.id)
      ) order by t.province, t.city, t.name), '[]'::jsonb) from public.pn_territories t);
  elsif p_what = 'leads' then
    return (select coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object(
        'partner_name', (select display_name from public.pn_partners where id = l.partner_id),
        'events', (select coalesce(jsonb_agg(jsonb_build_object('stage', e.stage, 'at', e.at, 'note', e.note) order by e.at), '[]'::jsonb)
                     from public.pn_lead_events e where e.lead_id = l.id)
      ) order by l.created_at desc), '[]'::jsonb) from public.pn_leads l);
  elsif p_what = 'money' then
    return jsonb_build_object(
      'transactions', (select coalesce(jsonb_agg(to_jsonb(x) || jsonb_build_object(
            'partner_name', (select display_name from public.pn_partners where id = x.partner_id),
            'commission', (select to_jsonb(c) from public.pn_commissions c where c.transaction_id = x.id)
          ) order by x.created_at desc), '[]'::jsonb) from public.pn_transactions x),
      'payouts', (select coalesce(jsonb_agg(to_jsonb(o) || jsonb_build_object(
            'partner_name', (select display_name from public.pn_partners where id = o.partner_id)) order by o.created_at desc), '[]'::jsonb) from public.pn_payouts o),
      'rates', (select coalesce(jsonb_agg(to_jsonb(r) order by r.category, r.service, r.lead_source, r.effective_from desc), '[]'::jsonb) from public.pn_rates r),
      'disputed', (select count(*) from public.pn_commissions where status = 'disputed'));
  elsif p_what = 'agreements' then
    return (select coalesce(jsonb_agg(to_jsonb(a) || jsonb_build_object(
        'partner_name', (select display_name from public.pn_partners where id = a.partner_id),
        'partner_ref', (select partner_id from public.pn_partners where id = a.partner_id)) order by a.created_at desc), '[]'::jsonb) from public.pn_agreements a);
  elsif p_what = 'documents' then
    return (select coalesce(jsonb_agg(to_jsonb(d) || jsonb_build_object(
        'partner_name', (select display_name from public.pn_partners where id = d.partner_id)) order by d.expires_on nulls last), '[]'::jsonb)
        from public.pn_documents d where d.expires_on is not null);
  elsif p_what = 'activity' then
    return (select coalesce(jsonb_agg(to_jsonb(a) || jsonb_build_object(
        'partner_name', (select display_name from public.pn_partners where id = a.partner_id)) order by a.at desc), '[]'::jsonb)
        from (select * from public.pn_activity order by at desc limit 400) a);
  end if;
  -- summary
  return jsonb_build_object(
    'applications_new',  (select count(*) from public.pn_applications where stage in ('submitted','preliminary_review')),
    'applications_open', (select count(*) from public.pn_applications where stage not in ('activated','rejected','withdrawn')),
    'partners_active',   (select count(*) from public.pn_partners where status = 'active'),
    'partners_review',   (select count(*) from public.pn_partners where status in ('under_review','probation')),
    'partners_suspended',(select count(*) from public.pn_partners where status in ('suspended','terminated')),
    'territories_total', (select count(*) from public.pn_territories),
    'territories_open',  (select count(*) from public.pn_territories where status in ('available','additional_allowed')),
    'leads_waiting',     (select count(*) from public.pn_leads where stage in ('new','raqbo_review','returned')),
    'leads_assigned',    (select count(*) from public.pn_leads where stage = 'assigned'),
    'leads_overdue',     (select count(*) from public.pn_leads where stage = 'assigned' and accept_by < now()),
    'leads_open',        (select count(*) from public.pn_leads where stage not in ('completed','lost')),
    'commission_pending',(select coalesce(sum(amount), 0) from public.pn_commissions where status = 'pending'),
    'commission_approved',(select coalesce(sum(amount), 0) from public.pn_commissions where status = 'approved'),
    'commission_disputed',(select count(*) from public.pn_commissions where status = 'disputed'),
    'agreements_expiring',(select count(*) from public.pn_agreements where status = 'executed' and ends_on is not null and ends_on <= current_date + 60),
    'documents_expiring', (select count(*) from public.pn_documents where expires_on is not null and expires_on <= current_date + 30),
    'partner_listings',   (select count(*) from public.listings where partner_id is not null),
    'partner_listings_pending', (select count(*) from public.listings where partner_id is not null and status = 'pending')
  );
end $$;

-- ---------- Applications: the nine-step process ----------
create or replace function public.pn_app_stage(p_id uuid, p_stage text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.pn_applications;
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  select * into a from public.pn_applications where id = p_id;
  if not found then raise exception 'Application not found.'; end if;
  if p_stage = 'interview' and not (a.identity_verified and a.business_verified) then
    raise exception 'Verify identity and business details before the interview stage.';
  end if;
  update public.pn_applications set stage = p_stage, stage_note = left(coalesce(p_note, ''), 1000),
         reject_reason = case when p_stage = 'rejected' then left(coalesce(p_note, ''), 600) else reject_reason end,
         reviewed_by = auth.uid(), updated_at = now()
   where id = p_id;
  if a.user_id is not null then
    perform public.notify(a.user_id, 'partner_application', 'Your partner application: ' || replace(p_stage, '_', ' '),
      coalesce(nullif(p_note, ''), 'Your application has moved forward.'), '#my-raqbo');
  end if;
  perform public.audit('pn_app_stage', 'pn_application', a.ref, p_stage, null);
end $$;

create or replace function public.pn_app_review(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  update public.pn_applications set
    score_reputation = coalesce((p->>'score_reputation')::int, score_reputation),
    score_experience = coalesce((p->>'score_experience')::int, score_experience),
    score_competence = coalesce((p->>'score_competence')::int, score_competence),
    score_customers = coalesce((p->>'score_customers')::int, score_customers),
    score_compliance = coalesce((p->>'score_compliance')::int, score_compliance),
    score_capacity = coalesce((p->>'score_capacity')::int, score_capacity),
    score_communication = coalesce((p->>'score_communication')::int, score_communication),
    score_premises = coalesce((p->>'score_premises')::int, score_premises),
    score_standards = coalesce((p->>'score_standards')::int, score_standards),
    identity_verified = coalesce((p->>'identity_verified')::boolean, identity_verified),
    business_verified = coalesce((p->>'business_verified')::boolean, business_verified),
    interview_at = coalesce(nullif(p->>'interview_at', '')::timestamptz, interview_at),
    interview_note = left(coalesce(p->>'interview_note', interview_note), 1500),
    reviewed_by = auth.uid(), updated_at = now()
  where id = (p->>'id')::uuid;
end $$;

-- Approving an application creates the partner record. It does NOT make
-- the partner active: that needs an executed agreement and training.
create or replace function public.pn_app_approve(p_id uuid, p_category text, p_designation text)
returns text language plpgsql security definer set search_path = public as $$
declare a public.pn_applications; v_pid text; v_new uuid;
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  select * into a from public.pn_applications where id = p_id;
  if not found then raise exception 'Application not found.'; end if;
  if a.user_id is null then raise exception 'This application has no RAQBO account attached, so no partner account can be created.'; end if;
  if not (a.identity_verified and a.business_verified) then
    raise exception 'Identity and business details must be verified before a partner is appointed.';
  end if;
  if p_category = 'franchise' and not (select franchise_open from public.pn_settings where id) then
    raise exception 'Full franchises are not open yet. Appoint as an Area Partner, or open franchising in the settings first.';
  end if;
  if exists (select 1 from public.pn_partners where user_id = a.user_id and status <> 'terminated') then
    raise exception 'This person is already a RAQBO partner.';
  end if;

  insert into public.pn_partners (user_id, application_id, category, display_name, business_type, ntn, registration_no,
                                  phone, whatsapp, email, office_address, photo_path, services, designation, status)
  values (a.user_id, a.id, p_category,
          coalesce(nullif(a.business_name, ''), a.full_name), a.business_type, a.ntn, a.registration_no,
          a.phone, a.whatsapp, a.email, a.office_address, a.photo_path, a.services,
          left(coalesce(nullif(p_designation, ''),
            case p_category when 'franchise' then 'RAQBO Franchise Partner'
                            when 'area' then 'RAQBO Authorised Area Partner' || case when a.area_wanted <> '' then ' — ' || a.area_wanted when a.city <> '' then ' — ' || a.city else '' end
                            else 'RAQBO Associate Partner' end), 120),
          'under_review')
  returning id, partner_id into v_new, v_pid;

  if a.territory_id is not null then
    insert into public.pn_partner_territories (partner_id, territory_id) values (v_new, a.territory_id) on conflict do nothing;
    update public.pn_territories set status = 'appointed', updated_at = now()
      where id = a.territory_id and status in ('available','under_review');
  end if;

  update public.pn_applications set stage = 'agreement', stage_note = 'Approved. Waiting for the agreement to be executed.',
         reviewed_by = auth.uid(), updated_at = now() where id = p_id;
  perform public.notify(a.user_id, 'partner', 'You have been approved as a RAQBO partner',
    'Your partner number is ' || v_pid || '. Your account becomes active once the agreement is signed and training is complete.', '#my-raqbo');
  perform public.audit('pn_app_approve', 'pn_partner', v_pid, p_category, null);
  return v_pid;
end $$;

-- ---------- Partner status, territory, permissions ----------
create or replace function public.pn_partner_status(p_partner_id text, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare p public.pn_partners;
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  select * into p from public.pn_partners where partner_id = p_partner_id;
  if not found then raise exception 'Partner not found.'; end if;
  if p_status = 'active' then
    if not p.agreement_ok then raise exception 'This partner cannot be made active until an agreement has been executed.'; end if;
    if not p.training_done then raise exception 'This partner cannot be made active until the required training is complete.'; end if;
  end if;
  update public.pn_partners set status = p_status, status_note = left(coalesce(p_note, ''), 600), status_at = now(),
         joined_on = coalesce(joined_on, case when p_status = 'active' then current_date end),
         updated_at = now()
   where id = p.id;
  -- A suspended or terminated partner keeps no open leads.
  if p_status in ('suspended','terminated') then
    update public.pn_leads set partner_id = null, stage = 'returned', updated_at = now()
      where partner_id = p.id and stage in ('assigned','accepted','contacted','site_visit','negotiation');
  end if;
  perform public.notify(p.user_id, 'partner', 'Your RAQBO partner status: ' || p_status, coalesce(nullif(p_note, ''), ''), '#my-raqbo');
  perform public.audit('pn_partner_status', 'pn_partner', p_partner_id, p_status, null);
end $$;

create or replace function public.pn_partner_powers(p_partner_id text, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  update public.pn_partners set
    services = coalesce(array(select jsonb_array_elements_text(p->'services')), services),
    designation = left(coalesce(p->>'designation', designation), 120),
    branding_approved = coalesce((p->>'branding_approved')::boolean, branding_approved),
    office_branding = coalesce((p->>'office_branding')::boolean, office_branding),
    may_collect_money = coalesce((p->>'may_collect_money')::boolean, may_collect_money),
    may_run_auction = coalesce((p->>'may_run_auction')::boolean, may_run_auction),
    listed = coalesce((p->>'listed')::boolean, listed),
    updated_at = now()
  where partner_id = p_partner_id;
  perform public.audit('pn_partner_powers', 'pn_partner', p_partner_id, '', p);
end $$;

create or replace function public.pn_territory_save(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  if (p->>'id') is not null and (p->>'id') <> '' then
    update public.pn_territories set
      level = coalesce(nullif(p->>'level', ''), level),
      name = coalesce(nullif(btrim(p->>'name'), ''), name),
      province = coalesce(p->>'province', province), division = coalesce(p->>'division', division),
      district = coalesce(p->>'district', district), tehsil = coalesce(p->>'tehsil', tehsil),
      city = coalesce(p->>'city', city), boundary_note = left(coalesce(p->>'boundary_note', boundary_note), 600),
      status = coalesce(nullif(p->>'status', ''), status),
      max_partners = coalesce((p->>'max_partners')::int, max_partners),
      exclusive = coalesce((p->>'exclusive')::boolean, exclusive),
      exclusive_until = coalesce(nullif(p->>'exclusive_until', '')::date, exclusive_until),
      min_monthly_deals = coalesce((p->>'min_monthly_deals')::int, min_monthly_deals),
      note = left(coalesce(p->>'note', note), 600), updated_at = now()
    where id = (p->>'id')::uuid returning id into v_id;
  else
    insert into public.pn_territories (level, name, province, division, district, tehsil, city, boundary_note, status, max_partners, note)
    values (coalesce(nullif(p->>'level', ''), 'city'), btrim(coalesce(p->>'name', '')),
            coalesce(p->>'province', ''), coalesce(p->>'division', ''), coalesce(p->>'district', ''),
            coalesce(p->>'tehsil', ''), coalesce(p->>'city', ''), left(coalesce(p->>'boundary_note', ''), 600),
            coalesce(nullif(p->>'status', ''), 'available'), coalesce((p->>'max_partners')::int, 1),
            left(coalesce(p->>'note', ''), 600))
    returning id into v_id;
  end if;
  perform public.audit('pn_territory_save', 'pn_territory', coalesce(p->>'name', ''), '', null);
  return v_id;
end $$;

create or replace function public.pn_territory_assign(p_partner_id text, p_territory uuid, p_exclusive boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_p uuid; v_t public.pn_territories; v_count int;
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  select id into v_p from public.pn_partners where partner_id = p_partner_id;
  if v_p is null then raise exception 'Partner not found.'; end if;
  select * into v_t from public.pn_territories where id = p_territory;
  if not found then raise exception 'Territory not found.'; end if;
  if v_t.status in ('suspended','reserved') then raise exception 'That territory is % and cannot be given to a partner.', v_t.status; end if;
  select count(*) into v_count from public.pn_partner_territories pt join public.pn_partners p on p.id = pt.partner_id
   where pt.territory_id = p_territory and p.status in ('active','probation','under_review') and pt.partner_id <> v_p;
  if exists (select 1 from public.pn_partner_territories pt where pt.territory_id = p_territory and pt.exclusive and pt.partner_id <> v_p) then
    raise exception 'Another partner already holds this territory exclusively.';
  end if;
  if v_count >= v_t.max_partners then
    raise exception 'This territory already has the number of partners it allows (%). Raise the limit first if that is intended.', v_t.max_partners;
  end if;
  insert into public.pn_partner_territories (partner_id, territory_id, exclusive)
  values (v_p, p_territory, coalesce(p_exclusive, false))
  on conflict (partner_id, territory_id) do update set exclusive = coalesce(p_exclusive, false);
  update public.pn_territories set status = case when status in ('available','under_review') then 'appointed' else status end,
         exclusive = coalesce(p_exclusive, exclusive), updated_at = now() where id = p_territory;
  perform public.audit('pn_territory_assign', 'pn_partner', p_partner_id, v_t.name, null);
end $$;

create or replace function public.pn_territory_remove(p_partner_id text, p_territory uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  delete from public.pn_partner_territories
   where territory_id = p_territory and partner_id = (select id from public.pn_partners where partner_id = p_partner_id);
  update public.pn_territories t set status = 'available', exclusive = false, updated_at = now()
   where t.id = p_territory and not exists (select 1 from public.pn_partner_territories pt where pt.territory_id = t.id);
end $$;

-- ---------- Agreements ----------
create or replace function public.pn_agreement_save(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_ref text; v_p uuid; v_status text := coalesce(nullif(p->>'status', ''), 'draft');
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  select id into v_p from public.pn_partners where partner_id = (p->>'partner_id');
  if v_p is null then raise exception 'Partner not found.'; end if;
  if v_status = 'executed' and not coalesce((p->>'legal_reviewed')::boolean, false) then
    raise exception 'Mark the agreement as legally reviewed before recording it as executed.';
  end if;
  if (p->>'id') is not null and (p->>'id') <> '' then
    update public.pn_agreements set
      category = coalesce(nullif(p->>'category', ''), category),
      parties = coalesce(p->>'parties', parties), relationship = coalesce(p->>'relationship', relationship),
      services = coalesce(p->>'services', services), territory_text = coalesce(p->>'territory_text', territory_text),
      exclusivity = coalesce(nullif(p->>'exclusivity', ''), exclusivity),
      starts_on = coalesce(nullif(p->>'starts_on', '')::date, starts_on),
      ends_on = coalesce(nullif(p->>'ends_on', '')::date, ends_on),
      renewal = coalesce(p->>'renewal', renewal), commission_text = coalesce(p->>'commission_text', commission_text),
      lead_allocation = coalesce(p->>'lead_allocation', lead_allocation), local_expenses = coalesce(p->>'local_expenses', local_expenses),
      brand_use = coalesce(p->>'brand_use', brand_use), data_protection = coalesce(p->>'data_protection', data_protection),
      reporting = coalesce(p->>'reporting', reporting), restrictions = coalesce(p->>'restrictions', restrictions),
      disputes = coalesce(p->>'disputes', disputes), termination = coalesce(p->>'termination', termination),
      after_termination = coalesce(p->>'after_termination', after_termination),
      territory_entitlement = coalesce((p->>'territory_entitlement')::boolean, territory_entitlement),
      legal_reviewed = coalesce((p->>'legal_reviewed')::boolean, legal_reviewed),
      status = v_status,
      executed_on = case when v_status = 'executed' then coalesce(nullif(p->>'executed_on', '')::date, current_date) else executed_on end,
      file_path = coalesce(p->>'file_path', file_path), note = left(coalesce(p->>'note', note), 600), updated_at = now()
    where id = (p->>'id')::uuid returning ref into v_ref;
  else
    insert into public.pn_agreements (partner_id, category, parties, relationship, services, territory_text, exclusivity,
      starts_on, ends_on, renewal, commission_text, lead_allocation, local_expenses, brand_use, data_protection,
      reporting, restrictions, disputes, termination, after_termination, territory_entitlement, legal_reviewed, status, executed_on, file_path, note)
    values (v_p, coalesce(nullif(p->>'category', ''), (select category from public.pn_partners where id = v_p)),
      coalesce(p->>'parties', ''), coalesce(p->>'relationship', ''), coalesce(p->>'services', ''), coalesce(p->>'territory_text', ''),
      coalesce(nullif(p->>'exclusivity', ''), 'non_exclusive'),
      nullif(p->>'starts_on', '')::date, nullif(p->>'ends_on', '')::date, coalesce(p->>'renewal', ''),
      coalesce(p->>'commission_text', ''), coalesce(p->>'lead_allocation', ''), coalesce(p->>'local_expenses', ''),
      coalesce(p->>'brand_use', ''), coalesce(p->>'data_protection', ''), coalesce(p->>'reporting', ''),
      coalesce(p->>'restrictions', ''), coalesce(p->>'disputes', ''), coalesce(p->>'termination', ''),
      coalesce(p->>'after_termination', ''), coalesce((p->>'territory_entitlement')::boolean, false),
      coalesce((p->>'legal_reviewed')::boolean, false), v_status,
      case when v_status = 'executed' then coalesce(nullif(p->>'executed_on', '')::date, current_date) end,
      coalesce(p->>'file_path', ''), left(coalesce(p->>'note', ''), 600))
    returning ref into v_ref;
  end if;
  perform public.audit('pn_agreement_save', 'pn_agreement', v_ref, v_status, null);
  return v_ref;
end $$;

-- ---------- Leads: creation, routing, return ----------
create or replace function public.pn_lead_create(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_ref text; v_terr uuid;
begin
  if not public.has_perm('partners') and not public.pn_is_partner() then
    raise exception 'Only RAQBO staff or an active partner can record a lead.';
  end if;
  v_terr := public.pn_territory_for(coalesce(p->>'province', ''), coalesce(p->>'city', ''), coalesce(p->>'area', ''));
  insert into public.pn_leads (source, origin_partner, kind, service, listing_id, enquiry_id,
                               customer_name, customer_phone, customer_note, province, city, area, territory_id, stage)
  values (coalesce(nullif(p->>'source', ''), case when public.pn_is_partner() then 'partner' else 'raqbo' end),
          case when public.pn_is_partner() then public.pn_me() else nullif(p->>'origin_partner', '')::uuid end,
          coalesce(nullif(p->>'kind', ''), 'buyer'), left(coalesce(p->>'service', ''), 60),
          nullif(p->>'listing_id', '')::uuid, nullif(p->>'enquiry_id', '')::uuid,
          left(coalesce(p->>'customer_name', ''), 120), left(coalesce(p->>'customer_phone', ''), 20),
          left(coalesce(p->>'customer_note', ''), 1000),
          left(coalesce(p->>'province', ''), 60), left(coalesce(p->>'city', ''), 60), left(coalesce(p->>'area', ''), 120),
          v_terr, 'raqbo_review')
  returning ref into v_ref;
  insert into public.pn_lead_events (lead_id, stage, by_user, note)
    select id, 'new', auth.uid(), '' from public.pn_leads where ref = v_ref;
  return v_ref;
end $$;

-- RAQBO assigns a lead. Territory, authorisation, workload and conflict are checked.
create or replace function public.pn_lead_assign(p_ref text, p_partner_id text)
returns void language plpgsql security definer set search_path = public as $$
declare l public.pn_leads; p public.pn_partners; v_hours int; v_load int;
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  select * into l from public.pn_leads where ref = p_ref;
  if not found then raise exception 'Lead not found.'; end if;
  select * into p from public.pn_partners where partner_id = p_partner_id;
  if not found then raise exception 'Partner not found.'; end if;
  if p.status not in ('active','probation') then
    raise exception 'A lead can only go to an active partner. This partner is %.', p.status;
  end if;
  if l.service <> '' and array_length(p.services, 1) is not null and not (l.service = any (p.services)) then
    raise exception 'This partner is not authorised for %.', l.service;
  end if;
  if l.territory_id is not null and not exists (
       select 1 from public.pn_partner_territories pt where pt.partner_id = p.id and pt.territory_id = l.territory_id) then
    -- allowed, but recorded, because RAQBO may assign outside a territory deliberately
    insert into public.pn_lead_events (lead_id, stage, by_user, note)
      values (l.id, 'assigned', auth.uid(), 'Assigned outside the partner''s own territory.');
  end if;
  select count(*) into v_load from public.pn_leads where partner_id = p.id and stage in ('assigned','accepted','contacted','site_visit','negotiation');
  select lead_accept_hours into v_hours from public.pn_settings where id;
  update public.pn_leads set partner_id = p.id, stage = 'assigned', assigned_at = now(),
         accept_by = now() + make_interval(hours => coalesce(v_hours, 24)),
         accepted_at = null, declined_at = null, handled_by_raqbo = false, updated_at = now()
   where id = l.id;
  insert into public.pn_lead_events (lead_id, stage, by_user, note)
    values (l.id, 'assigned', auth.uid(), 'Assigned to ' || p.display_name || ' (' || v_load || ' already open)');
  perform public.notify(p.user_id, 'partner_lead', 'New lead ' || p_ref,
    'Please accept it within ' || coalesce(v_hours, 24) || ' hours or it returns to RAQBO.', '#my-raqbo');
  perform public.audit('pn_lead_assign', 'pn_lead', p_ref, p_partner_id, null);
end $$;

create or replace function public.pn_lead_return(p_ref text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare l public.pn_leads;
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  select * into l from public.pn_leads where ref = p_ref;
  if not found then raise exception 'Lead not found.'; end if;
  update public.pn_leads set partner_id = null, stage = 'returned', reassigned = reassigned + 1,
         stage_note = left(coalesce(p_note, ''), 600), updated_at = now() where id = l.id;
  insert into public.pn_lead_events (lead_id, stage, by_user, note) values (l.id, 'returned', auth.uid(), left(coalesce(p_note, ''), 600));
end $$;

-- RAQBO may always deal with a customer itself.
create or replace function public.pn_lead_take(p_ref text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  update public.pn_leads set handled_by_raqbo = true, partner_id = null, stage = 'raqbo_review', updated_at = now() where ref = p_ref;
  insert into public.pn_lead_events (lead_id, stage, by_user, note)
    select id, 'raqbo_review', auth.uid(), 'RAQBO is handling this customer directly.' from public.pn_leads where ref = p_ref;
end $$;

-- Leads nobody answered in time go back to RAQBO. Run by the website or a schedule.
create or replace function public.pn_lead_sweep()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with gone as (
    update public.pn_leads set stage = 'returned', partner_id = null, reassigned = reassigned + 1,
           stage_note = 'The partner did not accept in time, so it came back to RAQBO.', updated_at = now()
     where stage = 'assigned' and accept_by is not null and accept_by < now()
    returning id
  )
  insert into public.pn_lead_events (lead_id, stage, note) select id, 'returned', 'No answer within the agreed time.' from gone;
  get diagnostics n = row_count;
  if n > 0 then perform public.notify_admins('partner_lead', n || ' lead(s) came back to RAQBO', 'A partner did not answer in time.', '#admin'); end if;
  return n;
end $$;

-- ---------- Transactions and commission ----------
-- The commission is worked out from the fee RAQBO actually received, less
-- agreed deductions. It is never a share of the property price.
create or replace function public.pn_tx_save(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_ref text; v_tx public.pn_transactions; v_p public.pn_partners; v_pct numeric; v_src text; v_dist bigint; v_amount bigint;
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  select * into v_p from public.pn_partners where partner_id = (p->>'partner_id');
  if v_p is null then raise exception 'Partner not found.'; end if;

  if (p->>'id') is not null and (p->>'id') <> '' then
    update public.pn_transactions set
      service = left(coalesce(p->>'service', service), 60), description = left(coalesce(p->>'description', description), 600),
      lead_source = coalesce(nullif(p->>'lead_source', ''), lead_source),
      property_value = coalesce((p->>'property_value')::bigint, property_value),
      gross_fee = coalesce((p->>'gross_fee')::bigint, gross_fee),
      fee_received = coalesce((p->>'fee_received')::bigint, fee_received),
      tax_deduction = coalesce((p->>'tax_deduction')::bigint, tax_deduction),
      third_party = coalesce((p->>'third_party')::bigint, third_party),
      refunded = coalesce((p->>'refunded')::bigint, refunded),
      other_deduction = coalesce((p->>'other_deduction')::bigint, other_deduction),
      deduction_note = left(coalesce(p->>'deduction_note', deduction_note), 400),
      stage = coalesce(nullif(p->>'stage', ''), stage),
      completed_on = coalesce(nullif(p->>'completed_on', '')::date, completed_on),
      updated_at = now()
    where id = (p->>'id')::uuid returning * into v_tx;
  else
    insert into public.pn_transactions (lead_id, partner_id, listing_id, service, description, lead_source,
        property_value, gross_fee, fee_received, tax_deduction, third_party, refunded, other_deduction, deduction_note, stage, completed_on)
    values (nullif(p->>'lead_id', '')::uuid, v_p.id, nullif(p->>'listing_id', '')::uuid,
        left(coalesce(p->>'service', ''), 60), left(coalesce(p->>'description', ''), 600),
        coalesce(nullif(p->>'lead_source', ''), 'raqbo'),
        nullif(p->>'property_value', '')::bigint, coalesce((p->>'gross_fee')::bigint, 0), coalesce((p->>'fee_received')::bigint, 0),
        coalesce((p->>'tax_deduction')::bigint, 0), coalesce((p->>'third_party')::bigint, 0),
        coalesce((p->>'refunded')::bigint, 0), coalesce((p->>'other_deduction')::bigint, 0),
        left(coalesce(p->>'deduction_note', ''), 400), coalesce(nullif(p->>'stage', ''), 'open'),
        nullif(p->>'completed_on', '')::date)
    returning * into v_tx;
  end if;
  v_ref := v_tx.ref;

  -- No commission until RAQBO has actually received the fee.
  if v_tx.fee_received <= 0 then
    delete from public.pn_commissions where transaction_id = v_tx.id and status = 'pending';
    return v_ref;
  end if;

  v_dist := greatest(v_tx.fee_received - v_tx.tax_deduction - v_tx.third_party - v_tx.refunded - v_tx.other_deduction, 0);
  select pct, src into v_pct, v_src from public.pn_rate_for(v_p.category, nullif(v_tx.service, ''), v_tx.lead_source, v_tx.completed_on);
  if v_pct is null then
    raise exception 'No commission rule applies to a % partner on a % lead dated %. Add or back-date a rule under Property partners → Commission rates.',
      v_p.category, v_tx.lead_source, coalesce(v_tx.completed_on, current_date);
  end if;
  v_amount := round(v_dist * v_pct / 100.0);

  insert into public.pn_commissions (transaction_id, partner_id, rate_pct, rate_source, distributable, amount)
  values (v_tx.id, v_p.id, v_pct, coalesce(v_src, ''), v_dist, v_amount)
  on conflict (transaction_id) do update set
    rate_pct = excluded.rate_pct, rate_source = excluded.rate_source,
    distributable = excluded.distributable,
    amount = case when public.pn_commissions.status in ('paid','approved') then public.pn_commissions.amount else excluded.amount end,
    updated_at = now()
  where public.pn_commissions.status not in ('paid');

  perform public.audit('pn_tx_save', 'pn_transaction', v_ref, v_tx.stage, null);
  return v_ref;
end $$;

create or replace function public.pn_commission_status(p_ref text, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.pn_commissions;
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  select * into c from public.pn_commissions where ref = p_ref;
  if not found then raise exception 'Commission not found.'; end if;
  if p_status = 'paid' and c.status <> 'approved' then raise exception 'Approve the commission before marking it paid.'; end if;
  update public.pn_commissions set status = p_status,
         dispute_note = case when p_status = 'disputed' then left(coalesce(p_note, ''), 800) else dispute_note end,
         dispute_outcome = case when c.status = 'disputed' and p_status <> 'disputed' then left(coalesce(p_note, ''), 800) else dispute_outcome end,
         approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
         approved_at = case when p_status = 'approved' then now() else approved_at end,
         updated_at = now()
   where id = c.id;
  perform public.notify((select user_id from public.pn_partners where id = c.partner_id), 'partner_money',
    'Commission ' || p_ref || ': ' || p_status, coalesce(nullif(p_note, ''), ''), '#my-raqbo');
  perform public.audit('pn_commission_status', 'pn_commission', p_ref, p_status, null);
end $$;

-- A partner may query a commission. It is reviewed, never silently changed.
create or replace function public.pn_commission_dispute(p_ref text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := public.pn_me(); c public.pn_commissions;
begin
  select * into c from public.pn_commissions where ref = p_ref;
  if not found or c.partner_id is distinct from me then raise exception 'That commission is not yours.'; end if;
  if c.status = 'paid' then raise exception 'This commission has already been paid. Please raise a complaint instead.'; end if;
  update public.pn_commissions set status = 'disputed', dispute_note = left(coalesce(p_reason, ''), 800), updated_at = now() where id = c.id;
  perform public.notify_admins('partner_money', 'Commission ' || p_ref || ' queried by a partner', left(coalesce(p_reason, ''), 200), '#admin');
  perform public.pn_log(me, 'commission_dispute', 'commission', p_ref, left(coalesce(p_reason, ''), 400));
end $$;

-- ---------- Payouts ----------
create or replace function public.pn_payout_build(p_partner_id text, p_from date, p_to date)
returns text language plpgsql security definer set search_path = public as $$
declare v_p uuid; v_ref text; v_total bigint; v_new uuid;
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  select id into v_p from public.pn_partners where partner_id = p_partner_id;
  if v_p is null then raise exception 'Partner not found.'; end if;
  select coalesce(sum(amount), 0) into v_total from public.pn_commissions
   where partner_id = v_p and status = 'approved' and payout_id is null
     and created_at::date between p_from and p_to;
  if v_total <= 0 then raise exception 'There is no approved commission for this partner in that period.'; end if;
  insert into public.pn_payouts (partner_id, period_from, period_to, amount) values (v_p, p_from, p_to, v_total)
    returning id, ref into v_new, v_ref;
  update public.pn_commissions set payout_id = v_new, updated_at = now()
   where partner_id = v_p and status = 'approved' and payout_id is null and created_at::date between p_from and p_to;
  perform public.audit('pn_payout_build', 'pn_payout', v_ref, v_total::text, null);
  return v_ref;
end $$;

create or replace function public.pn_payout_status(p_ref text, p_status text, p_method text, p_reference text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.pn_payouts;
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  select * into o from public.pn_payouts where ref = p_ref;
  if not found then raise exception 'Payout not found.'; end if;
  if p_status = 'paid' then
    if o.status <> 'approved' then raise exception 'A payout must be approved before it is marked paid.'; end if;
    if coalesce(btrim(p_reference), '') = '' then
      raise exception 'Record the bank reference. Partner payments must go through a traceable banking channel.';
    end if;
  end if;
  if p_status = 'approved' and not public.is_full_admin() then
    raise exception 'Only a full admin can approve a partner payment.';
  end if;
  update public.pn_payouts set status = p_status,
         method = coalesce(nullif(p_method, ''), method), reference = left(coalesce(p_reference, reference), 120),
         approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
         approved_at = case when p_status = 'approved' then now() else approved_at end,
         paid_on = case when p_status = 'paid' then current_date else paid_on end
   where id = o.id;
  if p_status = 'paid' then
    update public.pn_commissions set status = 'paid', updated_at = now() where payout_id = o.id and status = 'approved';
    perform public.notify((select user_id from public.pn_partners where id = o.partner_id), 'partner_money',
      'Payment sent: ' || p_ref, 'Reference ' || coalesce(p_reference, ''), '#my-raqbo');
  elsif p_status = 'cancelled' then
    update public.pn_commissions set payout_id = null, updated_at = now() where payout_id = o.id;
  end if;
  perform public.audit('pn_payout_status', 'pn_payout', p_ref, p_status, null);
end $$;

-- ---------- Settings and rates ----------
create or replace function public.pn_save_settings(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  update public.pn_settings set
    network_open = coalesce((p->>'network_open')::boolean, network_open),
    lead_accept_hours = coalesce((p->>'lead_accept_hours')::int, lead_accept_hours),
    lead_contact_hours = coalesce((p->>'lead_contact_hours')::int, lead_contact_hours),
    pilot_note = left(coalesce(p->>'pilot_note', pilot_note), 600),
    directory_public = coalesce((p->>'directory_public')::boolean, directory_public),
    franchise_open = coalesce((p->>'franchise_open')::boolean, franchise_open),
    intro_note = left(coalesce(p->>'intro_note', intro_note), 1200),
    updated_at = now()
  where id;
  perform public.audit('pn_save_settings', 'pn_settings', '', '', p);
end $$;

create or replace function public.pn_save_rate(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_before jsonb;
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  if (p->>'id') is not null and (p->>'id') <> '' then
    select to_jsonb(r) into v_before from public.pn_rates r where r.id = (p->>'id')::uuid;
    update public.pn_rates set
      partner_pct = coalesce((p->>'partner_pct')::numeric, partner_pct),
      note = left(coalesce(p->>'note', note), 300),
      active = coalesce((p->>'active')::boolean, active)
    where id = (p->>'id')::uuid returning id into v_id;
  else
    insert into public.pn_rates (category, service, lead_source, partner_pct, note, effective_from)
    values (p->>'category', coalesce(nullif(p->>'service', ''), 'any'), coalesce(nullif(p->>'lead_source', ''), 'any'),
            (p->>'partner_pct')::numeric, left(coalesce(p->>'note', ''), 300),
            coalesce(nullif(p->>'effective_from', '')::date, current_date))
    on conflict (category, service, lead_source, effective_from) do update
      set partner_pct = excluded.partner_pct, note = excluded.note, active = true
    returning id into v_id;
  end if;
  insert into public.pn_rate_history (rate_id, changed_by, before_val, after_val)
    values (v_id, auth.uid(), v_before, (select to_jsonb(r) from public.pn_rates r where r.id = v_id));
  perform public.audit('pn_save_rate', 'pn_rate', coalesce(p->>'category', ''), coalesce(p->>'partner_pct', ''), null);
  return v_id;
end $$;

-- ---------- Document expiry reminders ----------
create or replace function public.pn_doc_remind()
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  for r in select d.id, d.title, d.kind, d.expires_on, p.user_id, p.display_name, p.partner_id
             from public.pn_documents d join public.pn_partners p on p.id = d.partner_id
            where d.expires_on is not null and d.expires_on <= current_date + 30
              and (d.reminded_at is null or d.reminded_at < now() - interval '14 days')
  loop
    perform public.notify(r.user_id, 'partner', 'A document on your RAQBO partner file expires soon',
      coalesce(nullif(r.title, ''), r.kind) || ' expires on ' || r.expires_on || '. Please send an up-to-date copy.', '#my-raqbo');
    update public.pn_documents set reminded_at = now() where id = r.id;
    n := n + 1;
  end loop;
  if n > 0 then perform public.notify_admins('partner', n || ' partner document(s) expiring', 'See Property partners → Documents.', '#admin'); end if;
  return n;
end $$;

-- ---------- Partner-submitted listings ----------
-- A listing from a partner is never verified merely because a partner sent it.
create or replace function public.pn_claim_listing(p_listing uuid, p_authorised boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := public.pn_me();
begin
  if me is null or not public.pn_is_partner() then raise exception 'Only an active RAQBO partner can do this.'; end if;
  if not coalesce(p_authorised, false) then
    raise exception 'Confirm that the owner has authorised this advertisement before sending it.';
  end if;
  if exists (select 1 from public.listings where id = p_listing and partner_id is not null and partner_id <> me) then
    raise exception 'Another partner has already submitted this property.';
  end if;
  update public.listings set partner_id = me, owner_authorised = true,
         owner_auth_note = left(coalesce(p_note, ''), 300),
         advert_expires_on = coalesce(advert_expires_on, current_date + 90)
   where id = p_listing;
  perform public.pn_log(me, 'listing_claim', 'listing', p_listing::text, left(coalesce(p_note, ''), 400));
end $$;

-- Duplicate check before a partner sends a property
create or replace function public.pn_duplicate_check(p_city text, p_area text, p_size numeric, p_price bigint)
returns table (ref text, title text, status text, city text, area text, price bigint)
language sql stable security definer set search_path = public as $$
  select l.ref, l.title, l.status, l.city, l.area, l.price
    from public.listings l
   where l.status in ('published','pending')
     and lower(l.city) = lower(coalesce(p_city, ''))
     and (p_area = '' or lower(l.area) = lower(p_area))
     and (p_size is null or l.size between p_size * 0.95 and p_size * 1.05)
     and (p_price is null or l.price between p_price * 0.9 and p_price * 1.1)
   limit 10
$$;

-- Adverts that have run their course
create or replace function public.pn_expire_adverts()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.listings set status = 'expired'
   where partner_id is not null and status = 'published'
     and advert_expires_on is not null and advert_expires_on < current_date;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- The jobs the website nudges along ----------
create or replace function public.pn_run()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return jsonb_build_object(
    'leads_returned', public.pn_lead_sweep(),
    'documents_reminded', public.pn_doc_remind());
end $$;

grant execute on function public.pn_public(), public.pn_territories_open(text, text), public.pn_directory(text, text, text, text, text),
  public.pn_verify_qr(text) to anon, authenticated;

do $$ begin raise notice 'Update 29 applied. RAQBO Partner Network is installed.'; end $$;


-- =====================================================================
-- update 30: partner photographs, customer feedback, franchise terms
-- =====================================================================
-- =====================================================================
-- RAQBO — update 30: the last pieces of the Partner Network
--
-- Adds the four things the Partner Network document asks for that were
-- not yet in place:
--   1. A partner's photograph, shown on the public partner directory.
--   2. Customer feedback on a partner, and the rating it produces.
--   3. Franchise terms on a franchise agreement (fee, royalty, standards).
--   4. A recorded reason when a misleading listing is taken down.
--
-- Safe to run more than once. It deletes nothing.
-- =====================================================================

-- ---------- 1. The partner's photograph ----------
-- Photographs go in their own public bucket, because the partner directory
-- is open to visitors who are not signed in and cannot sign a private link.
insert into storage.buckets (id, name, public) values ('partner-photos', 'partner-photos', true)
  on conflict (id) do nothing;

drop policy if exists "partner photo read" on storage.objects;
create policy "partner photo read" on storage.objects for select to public
  using (bucket_id = 'partner-photos');

drop policy if exists "partner photo write" on storage.objects;
create policy "partner photo write" on storage.objects for insert to authenticated
  with check (bucket_id = 'partner-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "partner photo replace" on storage.objects;
create policy "partner photo replace" on storage.objects for update to authenticated
  using (bucket_id = 'partner-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "partner photo remove" on storage.objects;
create policy "partner photo remove" on storage.objects for delete to authenticated
  using (bucket_id = 'partner-photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.has_perm('partners')));

-- A partner sets their own photograph; an admin may set anyone's.
create or replace function public.pn_set_photo(p_partner uuid, p_path text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := public.pn_me(); target uuid := coalesce(p_partner, me);
begin
  if target is null then raise exception 'No partner account.'; end if;
  if target <> me and not public.has_perm('partners') then
    raise exception 'Only the partner, or RAQBO staff, may change this photograph.';
  end if;
  if coalesce(p_path, '') <> '' and (char_length(p_path) < 3 or char_length(p_path) > 400 or p_path !~ '^[A-Za-z0-9/._-]+$') then
    raise exception 'That does not look like a stored file.';
  end if;
  update public.pn_partners set photo_path = coalesce(p_path, ''), updated_at = now() where id = target;
  perform public.audit('pn_photo', 'pn_partner', target::text, '', jsonb_build_object('set', coalesce(p_path, '') <> ''));
end $$;
grant execute on function public.pn_set_photo(uuid, text) to authenticated;

-- ---------- 2. Customer feedback and the partner's rating ----------
create table if not exists public.pn_feedback (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references public.pn_partners (id) on delete cascade,
  lead_id     uuid references public.pn_leads (id) on delete set null,
  rating      int  not null check (rating between 1 and 5),
  comment     text not null default '' check (char_length(comment) <= 1000),
  customer    text not null default '' check (char_length(customer) <= 120),
  -- who recorded it: RAQBO staff after speaking to the customer, or the
  -- customer themselves through a completed service request.
  recorded_by uuid references auth.users (id) on delete set null,
  source      text not null default 'raqbo' check (source in ('raqbo', 'customer')),
  published   boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists pn_feedback_partner_idx on public.pn_feedback (partner_id, created_at desc);
create unique index if not exists pn_feedback_lead_idx on public.pn_feedback (lead_id) where lead_id is not null;

alter table public.pn_feedback enable row level security;

drop policy if exists "feedback read" on public.pn_feedback;
create policy "feedback read" on public.pn_feedback for select to authenticated
  using (public.has_perm('partners') or partner_id = public.pn_me());

drop policy if exists "feedback staff write" on public.pn_feedback;
create policy "feedback staff write" on public.pn_feedback for all to authenticated
  using (public.has_perm('partners')) with check (public.has_perm('partners'));

-- Record a piece of feedback. A partner can never record their own.
create or replace function public.pn_add_feedback(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_partner uuid := (p->>'partner_id')::uuid; v_rating int := (p->>'rating')::int;
begin
  if not public.has_perm('partners') then raise exception 'Only RAQBO staff may record customer feedback.'; end if;
  if v_partner is null then raise exception 'Which partner is this feedback about?'; end if;
  if v_partner = public.pn_me() then raise exception 'A partner cannot record feedback about themselves.'; end if;
  if v_rating is null or v_rating < 1 or v_rating > 5 then raise exception 'Give a rating from 1 to 5.'; end if;
  insert into public.pn_feedback (partner_id, lead_id, rating, comment, customer, recorded_by, source, published)
  values (v_partner, nullif(p->>'lead_id', '')::uuid, v_rating, left(coalesce(p->>'comment', ''), 1000),
          left(coalesce(p->>'customer', ''), 120), auth.uid(),
          case when coalesce(p->>'source', 'raqbo') = 'customer' then 'customer' else 'raqbo' end,
          coalesce((p->>'published')::boolean, false))
  returning id into v_id;
  perform public.audit('pn_feedback', 'pn_partner', v_partner::text, '', jsonb_build_object('rating', v_rating));
  return v_id;
end $$;
grant execute on function public.pn_add_feedback(jsonb) to authenticated;

-- The rating a partner has earned, from real recorded feedback only.
create or replace function public.pn_rating(p_partner uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'count', count(*),
    'average', case when count(*) = 0 then null else round(avg(rating)::numeric, 1) end,
    'five', count(*) filter (where rating = 5),
    'low', count(*) filter (where rating <= 2)
  ) from public.pn_feedback where partner_id = p_partner
$$;
grant execute on function public.pn_rating(uuid) to authenticated, anon;

-- Performance now includes the rating, so "customer satisfaction" is a
-- measured figure rather than an opinion.
create or replace function public.pn_performance(p_partner uuid, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'listings', (select count(*) from public.listings where partner_id = p_partner and created_at::date between p_from and p_to),
    'listings_live', (select count(*) from public.listings where partner_id = p_partner and status = 'published'),
    'leads_total', (select count(*) from public.pn_leads where partner_id = p_partner and created_at::date between p_from and p_to),
    'leads_generated', (select count(*) from public.pn_leads where origin_partner = p_partner and created_at::date between p_from and p_to),
    'leads_accepted', (select count(*) from public.pn_leads where partner_id = p_partner and accepted_at is not null and created_at::date between p_from and p_to),
    'leads_lost', (select count(*) from public.pn_leads where partner_id = p_partner and stage = 'lost' and created_at::date between p_from and p_to),
    'leads_returned', (select count(*) from public.pn_leads where partner_id = p_partner and stage = 'returned' and created_at::date between p_from and p_to),
    'visits', (select count(*) from public.pn_leads where partner_id = p_partner and visit_at is not null and created_at::date between p_from and p_to),
    'completed', (select count(*) from public.pn_leads where partner_id = p_partner and stage = 'completed' and created_at::date between p_from and p_to),
    'revenue', (select coalesce(sum(fee_received), 0) from public.pn_transactions where partner_id = p_partner and created_at::date between p_from and p_to),
    'response_hours', (select round(avg(extract(epoch from (accepted_at - assigned_at)) / 3600.0)::numeric, 1)
                         from public.pn_leads where partner_id = p_partner and accepted_at is not null and assigned_at is not null
                          and created_at::date between p_from and p_to),
    'complaints', (select count(*) from public.complaints c where c.created_at::date between p_from and p_to
                     and c.subject_ref = (select partner_id from public.pn_partners where id = p_partner)),
    'rating', public.pn_rating(p_partner)
  )
$$;

-- ---------- 3. Franchise terms on a franchise agreement ----------
alter table public.pn_agreements add column if not exists franchise_fee bigint not null default 0 check (franchise_fee >= 0);
alter table public.pn_agreements add column if not exists royalty_pct numeric(5,2) not null default 0 check (royalty_pct >= 0 and royalty_pct <= 100);
alter table public.pn_agreements add column if not exists royalty_monthly bigint not null default 0 check (royalty_monthly >= 0);
alter table public.pn_agreements add column if not exists office_standards text not null default '' check (char_length(office_standards) <= 2000);
alter table public.pn_agreements add column if not exists marketing_commitment text not null default '' check (char_length(marketing_commitment) <= 2000);
alter table public.pn_agreements add column if not exists technology_access text not null default '' check (char_length(technology_access) <= 2000);
alter table public.pn_agreements add column if not exists staff_training text not null default '' check (char_length(staff_training) <= 2000);
alter table public.pn_agreements add column if not exists min_performance text not null default '' check (char_length(min_performance) <= 2000);

-- A franchise agreement cannot be executed with nothing agreed about money.
create or replace function public.pn_agreement_franchise_guard()
returns trigger language plpgsql as $$
begin
  if new.status = 'executed' and new.category = 'franchise'
     and new.franchise_fee = 0 and new.royalty_pct = 0 and new.royalty_monthly = 0
     and coalesce(new.commission_text, '') = '' then
    raise exception 'A franchise agreement needs its money terms first: an initial fee, a royalty, or a written commission arrangement.';
  end if;
  return new;
end $$;

drop trigger if exists pn_agreement_franchise_guard on public.pn_agreements;
create trigger pn_agreement_franchise_guard before insert or update on public.pn_agreements
  for each row execute function public.pn_agreement_franchise_guard();

-- ---------- 4. A reason when a misleading listing is taken down ----------
alter table public.listings add column if not exists takedown_reason text not null default '' check (char_length(takedown_reason) <= 300);
alter table public.listings add column if not exists takedown_at timestamptz;

create or replace function public.pn_takedown_listing(p_listing uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_partner uuid;
begin
  if not public.has_perm('listings') and not public.has_perm('partners') then
    raise exception 'You do not have permission to remove a listing.';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why the listing is being removed.'; end if;
  select partner_id into v_partner from public.listings where id = p_listing;
  update public.listings
     set status = 'rejected', review_note = left(trim(p_reason), 300),
         takedown_reason = left(trim(p_reason), 300), takedown_at = now(), updated_at = now()
   where id = p_listing;
  if not found then raise exception 'That listing no longer exists.'; end if;
  perform public.audit('pn_takedown', 'listing', p_listing::text, left(trim(p_reason), 300), jsonb_build_object('partner', v_partner));
  if v_partner is not null then
    perform public.pn_log(v_partner, 'listing_removed', 'listing', p_listing::text, left(trim(p_reason), 300));
  end if;
end $$;
grant execute on function public.pn_takedown_listing(uuid, text) to authenticated;

-- The agreement form now carries the franchise terms as well, so a
-- franchise agreement can be recorded in one go.
create or replace function public.pn_agreement_save(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_ref text; v_p uuid; v_status text := coalesce(nullif(p->>'status', ''), 'draft');
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  select id into v_p from public.pn_partners where partner_id = (p->>'partner_id');
  if v_p is null then raise exception 'Partner not found.'; end if;
  if v_status = 'executed' and not coalesce((p->>'legal_reviewed')::boolean, false) then
    raise exception 'Mark the agreement as legally reviewed before recording it as executed.';
  end if;
  if (p->>'id') is not null and (p->>'id') <> '' then
    update public.pn_agreements set
      category = coalesce(nullif(p->>'category', ''), category),
      parties = coalesce(p->>'parties', parties), relationship = coalesce(p->>'relationship', relationship),
      services = coalesce(p->>'services', services), territory_text = coalesce(p->>'territory_text', territory_text),
      exclusivity = coalesce(nullif(p->>'exclusivity', ''), exclusivity),
      starts_on = coalesce(nullif(p->>'starts_on', '')::date, starts_on),
      ends_on = coalesce(nullif(p->>'ends_on', '')::date, ends_on),
      renewal = coalesce(p->>'renewal', renewal), commission_text = coalesce(p->>'commission_text', commission_text),
      lead_allocation = coalesce(p->>'lead_allocation', lead_allocation), local_expenses = coalesce(p->>'local_expenses', local_expenses),
      brand_use = coalesce(p->>'brand_use', brand_use), data_protection = coalesce(p->>'data_protection', data_protection),
      reporting = coalesce(p->>'reporting', reporting), restrictions = coalesce(p->>'restrictions', restrictions),
      disputes = coalesce(p->>'disputes', disputes), termination = coalesce(p->>'termination', termination),
      after_termination = coalesce(p->>'after_termination', after_termination),
      territory_entitlement = coalesce((p->>'territory_entitlement')::boolean, territory_entitlement),
      legal_reviewed = coalesce((p->>'legal_reviewed')::boolean, legal_reviewed),
      franchise_fee = coalesce((p->>'franchise_fee')::bigint, franchise_fee),
      royalty_pct = coalesce((p->>'royalty_pct')::numeric, royalty_pct),
      royalty_monthly = coalesce((p->>'royalty_monthly')::bigint, royalty_monthly),
      office_standards = coalesce(p->>'office_standards', office_standards),
      marketing_commitment = coalesce(p->>'marketing_commitment', marketing_commitment),
      technology_access = coalesce(p->>'technology_access', technology_access),
      staff_training = coalesce(p->>'staff_training', staff_training),
      min_performance = coalesce(p->>'min_performance', min_performance),
      status = v_status,
      executed_on = case when v_status = 'executed' then coalesce(nullif(p->>'executed_on', '')::date, current_date) else executed_on end,
      file_path = coalesce(p->>'file_path', file_path), note = left(coalesce(p->>'note', note), 600), updated_at = now()
    where id = (p->>'id')::uuid returning ref into v_ref;
  else
    insert into public.pn_agreements (partner_id, category, parties, relationship, services, territory_text, exclusivity,
      starts_on, ends_on, renewal, commission_text, lead_allocation, local_expenses, brand_use, data_protection,
      reporting, restrictions, disputes, termination, after_termination, territory_entitlement, legal_reviewed, status, executed_on, file_path, note,
      franchise_fee, royalty_pct, royalty_monthly, office_standards, marketing_commitment, technology_access, staff_training, min_performance)
    values (v_p, coalesce(nullif(p->>'category', ''), (select category from public.pn_partners where id = v_p)),
      coalesce(p->>'parties', ''), coalesce(p->>'relationship', ''), coalesce(p->>'services', ''), coalesce(p->>'territory_text', ''),
      coalesce(nullif(p->>'exclusivity', ''), 'non_exclusive'),
      nullif(p->>'starts_on', '')::date, nullif(p->>'ends_on', '')::date, coalesce(p->>'renewal', ''),
      coalesce(p->>'commission_text', ''), coalesce(p->>'lead_allocation', ''), coalesce(p->>'local_expenses', ''),
      coalesce(p->>'brand_use', ''), coalesce(p->>'data_protection', ''), coalesce(p->>'reporting', ''),
      coalesce(p->>'restrictions', ''), coalesce(p->>'disputes', ''), coalesce(p->>'termination', ''),
      coalesce(p->>'after_termination', ''), coalesce((p->>'territory_entitlement')::boolean, false),
      coalesce((p->>'legal_reviewed')::boolean, false), v_status,
      case when v_status = 'executed' then coalesce(nullif(p->>'executed_on', '')::date, current_date) end,
      coalesce(p->>'file_path', ''), left(coalesce(p->>'note', ''), 600),
      coalesce((p->>'franchise_fee')::bigint, 0), coalesce((p->>'royalty_pct')::numeric, 0), coalesce((p->>'royalty_monthly')::bigint, 0),
      left(coalesce(p->>'office_standards', ''), 2000), left(coalesce(p->>'marketing_commitment', ''), 2000),
      left(coalesce(p->>'technology_access', ''), 2000), left(coalesce(p->>'staff_training', ''), 2000),
      left(coalesce(p->>'min_performance', ''), 2000))
    returning ref into v_ref;
  end if;
  perform public.audit('pn_agreement_save', 'pn_agreement', v_ref, v_status, null);
  return v_ref;
end $$;
grant execute on function public.pn_agreement_save(jsonb) to authenticated;

-- The public directory now shows the partner's photograph and the rating
-- their customers have actually given them.
drop function if exists public.pn_directory(text, text, text, text, text);
-- Dropped first so that re-running this file after a later update, which
-- adds columns to what the directory returns, cannot fail on the change.
drop function if exists public.pn_directory(text, text, text, text, text);
create function public.pn_directory(p_province text default '', p_city text default '', p_area text default '',
                                               p_service text default '', p_q text default '')
returns table (partner_id text, display_name text, category text, business_type text, city text, province text,
               office_address text, phone text, whatsapp text, email text, services text[], designation text,
               status text, verified boolean, qr_token text, territories jsonb, since date, photo_path text, rating jsonb)
language sql stable security definer set search_path = public as $$
  select p.partner_id, p.display_name, p.category, p.business_type,
         coalesce(nullif((select string_agg(distinct t.city, ', ') from public.pn_partner_territories pt
                            join public.pn_territories t on t.id = pt.territory_id where pt.partner_id = p.id and t.city <> ''), ''), '') as city,
         coalesce(nullif((select string_agg(distinct t.province, ', ') from public.pn_partner_territories pt
                            join public.pn_territories t on t.id = pt.territory_id where pt.partner_id = p.id and t.province <> ''), ''), '') as province,
         p.office_address, p.phone, p.whatsapp, p.email, p.services, p.designation,
         p.status, (p.agreement_ok and p.status = 'active') as verified, p.qr_token,
         (select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'level', t.level, 'city', t.city) order by t.name), '[]'::jsonb)
            from public.pn_partner_territories pt join public.pn_territories t on t.id = pt.territory_id where pt.partner_id = p.id) as territories,
         p.joined_on, p.photo_path, public.pn_rating(p.id) as rating
    from public.pn_partners p
   where p.listed and p.status in ('active','probation')
     and (select directory_public from public.pn_settings where id)
     and (p_service = '' or p_service = any (p.services))
     and (p_q = '' or p.display_name ilike '%' || p_q || '%' or p.partner_id ilike '%' || p_q || '%')
     and (p_province = '' or exists (select 1 from public.pn_partner_territories pt join public.pn_territories t on t.id = pt.territory_id
                                      where pt.partner_id = p.id and lower(t.province) = lower(p_province)))
     and (p_city = '' or exists (select 1 from public.pn_partner_territories pt join public.pn_territories t on t.id = pt.territory_id
                                  where pt.partner_id = p.id and lower(t.city) = lower(p_city)))
     and (p_area = '' or exists (select 1 from public.pn_partner_territories pt join public.pn_territories t on t.id = pt.territory_id
                                  where pt.partner_id = p.id and t.name ilike '%' || p_area || '%'))
   order by (p.status = 'active') desc, p.display_name
$$;
grant execute on function public.pn_directory(text, text, text, text, text) to authenticated, anon;

-- ---------- 5. Supporting documents an applicant or partner uploads ----------
-- Section G of the application form: identification, business registration,
-- licence and anything else RAQBO asks for. The file itself goes into the
-- private partner-docs bucket; this records what it is.
create or replace function public.pn_doc_add(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_app uuid := nullif(p->>'application_id', '')::uuid;
        v_partner uuid := nullif(p->>'partner_id', '')::uuid; v_me uuid := auth.uid(); v_own boolean := false;
begin
  if v_me is null then raise exception 'Please sign in first.'; end if;
  if coalesce(p->>'path', '') = '' then raise exception 'No file was given.'; end if;
  if char_length(p->>'path') > 400 then raise exception 'That file name is too long.'; end if;
  -- the file must sit in the uploader's own folder, or belong to staff
  if (storage.foldername(p->>'path'))[1] <> v_me::text and not public.has_perm('partners') then
    raise exception 'You may only attach a file you uploaded yourself.';
  end if;

  if v_app is null and v_partner is null then
    select id into v_app from public.pn_applications where user_id = v_me order by created_at desc limit 1;
    if v_app is null then select id into v_partner from public.pn_partners where user_id = v_me; end if;
  end if;
  if v_app is null and v_partner is null then raise exception 'There is no application or partner account to attach this to.'; end if;

  if v_app is not null then
    select (user_id = v_me) into v_own from public.pn_applications where id = v_app;
  else
    select (user_id = v_me) into v_own from public.pn_partners where id = v_partner;
  end if;
  if not coalesce(v_own, false) and not public.has_perm('partners') then
    raise exception 'This is not your application.';
  end if;

  insert into public.pn_documents (partner_id, application_id, kind, title, path, expires_on, uploaded_by)
  values (v_partner, v_app,
    case when coalesce(p->>'kind', '') in ('cnic','ntn','registration','licence','agreement','office_proof','photo','other')
         then p->>'kind' else 'other' end,
    left(coalesce(p->>'title', ''), 160), p->>'path', nullif(p->>'expires_on', '')::date, v_me)
  returning id into v_id;
  return v_id;
end $$;
grant execute on function public.pn_doc_add(jsonb) to authenticated;

-- ---------- 6. The admin Partners screen also shows the rating and the
-- listings that partner has put up, so a misleading one can be taken down. ----
create or replace function public.pn_admin(p_what text default 'summary')
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  if p_what = 'applications' then
    return (select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb) from public.pn_applications a);
  elsif p_what = 'partners' then
    return (select coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object(
        'territories', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'city', t.city, 'exclusive', pt.exclusive) order by t.name), '[]'::jsonb)
                          from public.pn_partner_territories pt join public.pn_territories t on t.id = pt.territory_id where pt.partner_id = p.id),
        'agreement', (select a.status from public.pn_agreements a where a.partner_id = p.id order by a.created_at desc limit 1),
        'leads_open', (select count(*) from public.pn_leads l where l.partner_id = p.id and l.stage not in ('completed','lost','returned')),
        'owed', (select coalesce(sum(c.amount), 0) from public.pn_commissions c where c.partner_id = p.id and c.status = 'approved'),
        'rating', public.pn_rating(p.id),
        'feedback', (select coalesce(jsonb_agg(jsonb_build_object('rating', fb.rating, 'comment', fb.comment, 'customer', fb.customer, 'at', fb.created_at) order by fb.created_at desc), '[]'::jsonb)
                       from (select * from public.pn_feedback where partner_id = p.id order by created_at desc limit 10) fb),
        'listings', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'ref', l.ref, 'title', l.title, 'city', l.city, 'area', l.area,
                                                                  'status', l.status, 'owner_authorised', l.owner_authorised,
                                                                  'advert_expires_on', l.advert_expires_on, 'takedown_reason', l.takedown_reason)
                                               order by l.created_at desc), '[]'::jsonb)
                       from public.listings l where l.partner_id = p.id and l.status in ('published','pending'))
      ) order by p.created_at desc), '[]'::jsonb) from public.pn_partners p);
  elsif p_what = 'territories' then
    return (select coalesce(jsonb_agg(to_jsonb(t) || jsonb_build_object(
        'partners', (select coalesce(jsonb_agg(jsonb_build_object('partner_id', p.partner_id, 'name', p.display_name, 'status', p.status, 'exclusive', pt.exclusive)), '[]'::jsonb)
                       from public.pn_partner_territories pt join public.pn_partners p on p.id = pt.partner_id where pt.territory_id = t.id)
      ) order by t.province, t.city, t.name), '[]'::jsonb) from public.pn_territories t);
  elsif p_what = 'leads' then
    return (select coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object(
        'partner_name', (select display_name from public.pn_partners where id = l.partner_id),
        'events', (select coalesce(jsonb_agg(jsonb_build_object('stage', e.stage, 'at', e.at, 'note', e.note) order by e.at), '[]'::jsonb)
                     from public.pn_lead_events e where e.lead_id = l.id)
      ) order by l.created_at desc), '[]'::jsonb) from public.pn_leads l);
  elsif p_what = 'money' then
    return jsonb_build_object(
      'transactions', (select coalesce(jsonb_agg(to_jsonb(x) || jsonb_build_object(
            'partner_name', (select display_name from public.pn_partners where id = x.partner_id),
            'commission', (select to_jsonb(c) from public.pn_commissions c where c.transaction_id = x.id)
          ) order by x.created_at desc), '[]'::jsonb) from public.pn_transactions x),
      'payouts', (select coalesce(jsonb_agg(to_jsonb(o) || jsonb_build_object(
            'partner_name', (select display_name from public.pn_partners where id = o.partner_id)) order by o.created_at desc), '[]'::jsonb) from public.pn_payouts o),
      'rates', (select coalesce(jsonb_agg(to_jsonb(r) order by r.category, r.service, r.lead_source, r.effective_from desc), '[]'::jsonb) from public.pn_rates r),
      'disputed', (select count(*) from public.pn_commissions where status = 'disputed'));
  elsif p_what = 'agreements' then
    return (select coalesce(jsonb_agg(to_jsonb(a) || jsonb_build_object(
        'partner_name', (select display_name from public.pn_partners where id = a.partner_id),
        'partner_ref', (select partner_id from public.pn_partners where id = a.partner_id)) order by a.created_at desc), '[]'::jsonb) from public.pn_agreements a);
  elsif p_what = 'documents' then
    return (select coalesce(jsonb_agg(to_jsonb(d) || jsonb_build_object(
        'partner_name', (select display_name from public.pn_partners where id = d.partner_id)) order by d.expires_on nulls last), '[]'::jsonb)
        from public.pn_documents d where d.expires_on is not null);
  elsif p_what = 'activity' then
    return (select coalesce(jsonb_agg(to_jsonb(a) || jsonb_build_object(
        'partner_name', (select display_name from public.pn_partners where id = a.partner_id)) order by a.at desc), '[]'::jsonb)
        from (select * from public.pn_activity order by at desc limit 400) a);
  end if;
  -- summary
  return jsonb_build_object(
    'applications_new',  (select count(*) from public.pn_applications where stage in ('submitted','preliminary_review')),
    'applications_open', (select count(*) from public.pn_applications where stage not in ('activated','rejected','withdrawn')),
    'partners_active',   (select count(*) from public.pn_partners where status = 'active'),
    'partners_review',   (select count(*) from public.pn_partners where status in ('under_review','probation')),
    'partners_suspended',(select count(*) from public.pn_partners where status in ('suspended','terminated')),
    'territories_total', (select count(*) from public.pn_territories),
    'territories_open',  (select count(*) from public.pn_territories where status in ('available','additional_allowed')),
    'leads_waiting',     (select count(*) from public.pn_leads where stage in ('new','raqbo_review','returned')),
    'leads_assigned',    (select count(*) from public.pn_leads where stage = 'assigned'),
    'leads_overdue',     (select count(*) from public.pn_leads where stage = 'assigned' and accept_by < now()),
    'leads_open',        (select count(*) from public.pn_leads where stage not in ('completed','lost')),
    'commission_pending',(select coalesce(sum(amount), 0) from public.pn_commissions where status = 'pending'),
    'commission_approved',(select coalesce(sum(amount), 0) from public.pn_commissions where status = 'approved'),
    'commission_disputed',(select count(*) from public.pn_commissions where status = 'disputed'),
    'agreements_expiring',(select count(*) from public.pn_agreements where status = 'executed' and ends_on is not null and ends_on <= current_date + 60),
    'documents_expiring', (select count(*) from public.pn_documents where expires_on is not null and expires_on <= current_date + 30),
    'partner_listings',   (select count(*) from public.listings where partner_id is not null),
    'partner_listings_pending', (select count(*) from public.listings where partner_id is not null and status = 'pending')
  );
end $$;
grant execute on function public.pn_admin(text) to authenticated;

do $$ begin raise notice 'Update 30 applied. Partner photographs, customer feedback, franchise terms and listing takedown are in place.'; end $$;


-- update 31: security review follow-up
-- =====================================================================
-- RAQBO — update 31: closing what a security review found
--
-- The review found no way in and no way to change anything that is not
-- yours. What it did find is information being handed out that nobody
-- outside RAQBO needs. The website key is public by design — anyone can
-- read it out of the page — so anything a policy allows "everyone" to
-- read is effectively published. This tightens three of those.
--
-- Nothing the website shows changes: it already reads these through
-- functions that return only the parts the public pages use.
--
-- Safe to run more than once. It deletes nothing.
-- =====================================================================

-- ---------- 1. Platform settings ----------
-- The whole row was readable by anyone: the business name, registration
-- number, NTN and registered address, every service fee, the auction and
-- commission settings, and the analytics ID. The public pages do not read
-- this table — they call public.platform_public(), which returns the same
-- public-facing values. So the table itself goes back to staff only.
do $$ declare r record; begin
  for r in select polname from pg_policy p join pg_class c on c.oid = p.polrelid
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = 'platform_settings' and p.polcmd in ('r', '*')
  loop execute format('drop policy if exists %I on public.platform_settings', r.polname); end loop;
end $$;
drop policy if exists "platform_settings read" on public.platform_settings;
create policy "platform_settings read" on public.platform_settings for select to authenticated
  using (public.is_admin());

-- ---------- 2. Growth settings ----------
-- This holds the marketing budget, the founding-member cap and the
-- referral credit rules — commercial information, not public information.
do $$ declare r record; begin
  for r in select polname from pg_policy p join pg_class c on c.oid = p.polrelid
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = 'growth_settings' and p.polcmd in ('r', '*')
  loop execute format('drop policy if exists %I on public.growth_settings', r.polname); end loop;
end $$;
drop policy if exists "growth_settings read" on public.growth_settings;
create policy "growth_settings read" on public.growth_settings for select to authenticated
  using (public.is_admin());

-- The public pages already read what they need through public.growth_public(),
-- which returns only the campaign and referral details a visitor is shown.

-- ---------- 3. Partner commission rates ----------
-- The indicative percentages are shown on the Become a Partner page on
-- purpose, so they stay readable. What does not need to be public is a
-- rate that has been switched off or dated for the future, because that
-- shows RAQBO's hand before a change is announced.
do $$ declare r record; begin
  for r in select polname from pg_policy p join pg_class c on c.oid = p.polrelid
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = 'pn_rates' and p.polcmd in ('r', '*')
  loop execute format('drop policy if exists %I on public.pn_rates', r.polname); end loop;
end $$;
drop policy if exists "pn_rates read" on public.pn_rates;
create policy "pn_rates read" on public.pn_rates for select to authenticated, anon
  using (active and effective_from <= current_date);

drop policy if exists "pn_rates staff read" on public.pn_rates;
create policy "pn_rates staff read" on public.pn_rates for select to authenticated
  using (public.has_perm('partners'));

-- ---------- 4. A record of who looked at what ----------
-- Reading a partner's status by its code is meant to be open to anyone,
-- but a code is short, so someone could try codes one after another to
-- map out the partner network. Checks are counted per code so an admin
-- can see it happening.
create table if not exists public.pn_check_log (
  id         bigserial primary key,
  token_hint text not null default '',
  found      boolean not null default false,
  at         timestamptz not null default now()
);
create index if not exists pn_check_log_at_idx on public.pn_check_log (at desc);
alter table public.pn_check_log enable row level security;

drop policy if exists "check log staff" on public.pn_check_log;
create policy "check log staff" on public.pn_check_log for select to authenticated
  using (public.has_perm('partners'));

-- The check itself records the attempt and refuses to answer more than
-- thirty wrong guesses in five minutes, which stops a code being found by
-- trying. A genuine scan is one check and is never affected.
create or replace function public.pn_verify_qr(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_misses int; v_hint text := left(coalesce(p_token, ''), 3);
begin
  select count(*) into v_misses from public.pn_check_log l
   where l.found = false and l.at > now() - interval '5 minutes';
  if v_misses > 30 then
    insert into public.pn_check_log (token_hint, found) values (v_hint, false);
    raise exception 'Too many checks have been tried just now. Please wait a few minutes and scan again.';
  end if;

  select jsonb_build_object(
    'found', true, 'name', p.display_name, 'partner_id', p.partner_id, 'category', p.category,
    'designation', p.designation, 'status', p.status,
    'active', p.status = 'active',
    'territories', coalesce((select jsonb_agg(t.name order by t.name) from public.pn_partner_territories pt
                               join public.pn_territories t on t.id = pt.territory_id where pt.partner_id = p.id), '[]'::jsonb),
    'may_collect_money', p.may_collect_money, 'office_branding', p.office_branding,
    'checked_at', now())
    into v
  from public.pn_partners p
  where p.qr_token = p_token and coalesce(p_token, '') <> '';

  insert into public.pn_check_log (token_hint, found) values (v_hint, v is not null);
  return coalesce(v, jsonb_build_object('found', false, 'checked_at', now()));
end $$;
grant execute on function public.pn_verify_qr(text) to authenticated, anon;

-- Old check records are not worth keeping.
create or replace function public.pn_check_log_trim()
returns void language sql security definer set search_path = public as $$
  delete from public.pn_check_log where at < now() - interval '30 days'
$$;

do $$ begin raise notice 'Update 31 applied. Settings are staff-only, partner codes cannot be guessed in bulk.'; end $$;


-- =====================================================================
-- update_32_missing_features.sql
-- =====================================================================
-- =====================================================================
-- RAQBO update 32 — features listed in the RAQBO documents that were missing
--   1. Joint ownership / power of attorney on a listing
--   2. Block a member in Messages, and report a chat to RAQBO
--   3. Property Passport levels D (independent legal opinion) and E (physical inspection)
--   4. Construction materials: price and stock alerts for buyers
-- Safe to run more than once. Run after update_31_security.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Ownership on a listing (sole, joint, power of attorney, company)
-- ---------------------------------------------------------------------
alter table public.listings add column if not exists ownership_type text not null default 'sole';
alter table public.listings add column if not exists co_owners jsonb not null default '[]'::jsonb;
alter table public.listings add column if not exists all_owners_consent boolean not null default false;
do $$ begin
  alter table public.listings add constraint listings_ownership_type_check check (ownership_type in ('sole','joint','attorney','company'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.listings add constraint listings_co_owners_check check (jsonb_typeof(co_owners) = 'array' and jsonb_array_length(co_owners) <= 10);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2a. Blocking a member in Messages
-- ---------------------------------------------------------------------
create table if not exists public.user_blocks (
  blocker_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table public.user_blocks enable row level security;
drop policy if exists "user_blocks: own" on public.user_blocks;
create policy "user_blocks: own" on public.user_blocks for select using (blocker_id = auth.uid());
grant select on public.user_blocks to authenticated;

-- True when either side of a member-to-member conversation has blocked the other.
-- Chats with the RAQBO team (other_id is null) can never be blocked.
create or replace function public.chat_blocked(p_conv uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (
  select 1 from public.conversations c
    join public.user_blocks b
      on (b.blocker_id = c.starter_id and b.blocked_id = c.other_id)
      or (b.blocker_id = c.other_id and b.blocked_id = c.starter_id)
   where c.id = p_conv and c.other_id is not null) $$;
grant execute on function public.chat_blocked(uuid) to authenticated;

-- Sending now also refuses a blocked conversation (the database decides, not the page)
drop policy if exists "messages: participants send" on public.messages;
create policy "messages: participants send" on public.messages for insert
  with check (sender_id = auth.uid() and public.is_participant(conversation_id) and public.is_verified_user()
              and not public.chat_blocked(conversation_id));

-- Block or unblock the other person in a conversation
create or replace function public.block_chat_user(p_conv uuid, p_block boolean)
returns boolean language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); c public.conversations; other uuid;
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  select * into c from public.conversations where id = p_conv;
  if c.id is null or (c.starter_id is distinct from me and c.other_id is distinct from me) then raise exception 'Conversation not found.'; end if;
  if c.other_id is null then raise exception 'The RAQBO team cannot be blocked. Use Report instead.'; end if;
  other := case when c.starter_id = me then c.other_id else c.starter_id end;
  if p_block then
    insert into public.user_blocks (blocker_id, blocked_id) values (me, other) on conflict do nothing;
  else
    delete from public.user_blocks where blocker_id = me and blocked_id = other;
  end if;
  return p_block;
end $$;
grant execute on function public.block_chat_user(uuid, boolean) to authenticated;

-- Which of my conversations are blocked, and by whom (so the page can explain it)
create or replace function public.my_blocked_chats()
returns table (conversation_id uuid, by_me boolean)
language sql stable security definer set search_path = public
as $$
  select c.id, bool_or(b.blocker_id = auth.uid())
    from public.conversations c
    join public.user_blocks b
      on (b.blocker_id = c.starter_id and b.blocked_id = c.other_id)
      or (b.blocker_id = c.other_id and b.blocked_id = c.starter_id)
   where c.other_id is not null and (c.starter_id = auth.uid() or c.other_id = auth.uid())
   group by c.id $$;
grant execute on function public.my_blocked_chats() to authenticated;

-- ---------------------------------------------------------------------
-- 2b. Reporting a chat to RAQBO
-- ---------------------------------------------------------------------
create table if not exists public.chat_reports (
  id              bigint generated always as identity primary key,
  conversation_id uuid references public.conversations (id) on delete set null,
  reporter_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  reported_id     uuid references public.profiles (id) on delete set null,
  reason          text not null check (reason in ('scam','abuse','spam','fake_listing','other')),
  details         text not null default '' check (char_length(details) <= 1000),
  snapshot        jsonb not null default '[]'::jsonb,      -- the last messages, kept so RAQBO can review them
  status          text not null default 'open' check (status in ('open','actioned','dismissed')),
  admin_note      text not null default '' check (char_length(admin_note) <= 1000),
  created_at      timestamptz not null default now(),
  decided_at      timestamptz,
  decided_by      uuid references public.profiles (id) on delete set null
);
create index if not exists chat_reports_status_idx on public.chat_reports (status, created_at desc);
alter table public.chat_reports enable row level security;
drop policy if exists "chat_reports: reporter or admin reads" on public.chat_reports;
create policy "chat_reports: reporter or admin reads" on public.chat_reports for select
  using (reporter_id = auth.uid() or public.is_admin());
grant select on public.chat_reports to authenticated;

create or replace function public.report_chat(p_conv uuid, p_reason text, p_details text)
returns bigint language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); c public.conversations; other uuid; snap jsonb; n int; rid bigint; nm text;
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  select * into c from public.conversations where id = p_conv;
  if c.id is null or (c.starter_id is distinct from me and c.other_id is distinct from me) then raise exception 'Conversation not found.'; end if;
  if p_reason not in ('scam','abuse','spam','fake_listing','other') then raise exception 'Choose a reason.'; end if;
  if p_reason = 'other' and char_length(btrim(coalesce(p_details, ''))) < 5 then raise exception 'Tell RAQBO briefly what happened.'; end if;
  select count(*) into n from public.chat_reports where reporter_id = me and created_at > now() - interval '1 day';
  if n >= 5 then raise exception 'You have sent several reports today. RAQBO will review them first.'; end if;
  other := case when c.starter_id = me then c.other_id else c.starter_id end;
  select coalesce(jsonb_agg(jsonb_build_object('from', case when x.sender_id = me then 'reporter' else 'other' end, 'at', x.created_at, 'body', x.body) order by x.id), '[]'::jsonb)
    into snap from (select * from public.messages where conversation_id = p_conv order by id desc limit 30) x;
  insert into public.chat_reports (conversation_id, reporter_id, reported_id, reason, details, snapshot)
  values (p_conv, me, other, p_reason, left(btrim(coalesce(p_details, '')), 1000), snap) returning id into rid;
  select coalesce(nullif(full_name, ''), 'A member') into nm from public.profiles where id = me;
  perform public.notify_admins('message', 'Chat reported: ' || replace(p_reason, '_', ' '), nm || ' · ' || left(c.subject, 120), '#admin/chatreports');
  return rid;
end $$;
grant execute on function public.report_chat(uuid, text, text) to authenticated;

create or replace function public.admin_decide_chat_report(p_id bigint, p_status text, p_note text, p_block boolean default false)
returns void language plpgsql security definer set search_path = public
as $$
declare r public.chat_reports;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_status not in ('actioned','dismissed','open') then raise exception 'Choose an outcome.'; end if;
  select * into r from public.chat_reports where id = p_id;
  if r.id is null then raise exception 'Report not found.'; end if;
  update public.chat_reports set status = p_status, admin_note = left(btrim(coalesce(p_note, '')), 1000),
         decided_at = case when p_status = 'open' then null else now() end,
         decided_by = case when p_status = 'open' then null else auth.uid() end
   where id = p_id;
  -- An actioned report can also stop the reported member messaging the reporter
  if p_status = 'actioned' and p_block and r.reported_id is not null then
    insert into public.user_blocks (blocker_id, blocked_id) values (r.reporter_id, r.reported_id) on conflict do nothing;
  end if;
  perform public.notify(r.reporter_id, 'message', 'Your chat report was reviewed',
    case p_status when 'actioned' then 'RAQBO took action. Thank you for reporting.' when 'dismissed' then 'RAQBO reviewed it and found no breach of the rules.' else 'Your report is open again.' end, '#messages');
  begin perform public.audit('chat_report_' || p_status, 'chat_report', p_id::text, coalesce(p_note, ''), jsonb_build_object('block', p_block)); exception when others then null; end;
end $$;
grant execute on function public.admin_decide_chat_report(bigint, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Property Passport levels D and E
--    D = independent legal opinion from an enrolled advocate
--    E = physical inspection by a named inspector
-- ---------------------------------------------------------------------
create table if not exists public.listing_assessments (
  id            bigint generated always as identity primary key,
  listing_id    uuid not null references public.listings (id) on delete cascade,
  kind          text not null check (kind in ('legal_opinion','inspection')),
  reviewer_name text not null check (char_length(btrim(reviewer_name)) between 3 and 120),
  reviewer_reg  text not null default '' check (char_length(reviewer_reg) <= 80),     -- advocate enrolment / licence number
  assessed_on   date not null,
  outcome       text not null check (outcome in ('confirmed','issue_identified','unconfirmed')),
  findings      text not null check (char_length(btrim(findings)) between 10 and 3000),
  limitations   text not null default '' check (char_length(limitations) <= 1500),
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  withdrawn_at  timestamptz,
  withdrawn_reason text not null default '',
  check (kind <> 'legal_opinion' or char_length(btrim(reviewer_reg)) >= 3),
  check (assessed_on <= current_date)
);
create index if not exists listing_assessments_listing_idx on public.listing_assessments (listing_id, kind, assessed_on desc);
alter table public.listing_assessments enable row level security;
drop policy if exists "listing_assessments: read" on public.listing_assessments;
create policy "listing_assessments: read" on public.listing_assessments for select
  using (
    (withdrawn_at is null and exists (select 1 from public.listings l where l.id = listing_id and l.status = 'published'))
    or exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = auth.uid())
    or public.is_admin() or public.has_perm('verification'));
grant select on public.listing_assessments to anon, authenticated;

create or replace function public.admin_add_assessment(p_listing uuid, p_kind text, p_name text, p_reg text, p_on date, p_outcome text, p_findings text, p_limits text)
returns bigint language plpgsql security definer set search_path = public
as $$
declare rid bigint; l public.listings;
begin
  if not (public.is_admin() or public.has_perm('verification')) then raise exception 'Only the verification team can record this.'; end if;
  select * into l from public.listings where id = p_listing;
  if l.id is null then raise exception 'Listing not found.'; end if;
  insert into public.listing_assessments (listing_id, kind, reviewer_name, reviewer_reg, assessed_on, outcome, findings, limitations)
  values (p_listing, p_kind, btrim(coalesce(p_name, '')), btrim(coalesce(p_reg, '')), p_on, p_outcome, btrim(coalesce(p_findings, '')), btrim(coalesce(p_limits, '')))
  returning id into rid;
  if l.owner_id is not null then
    perform public.notify(l.owner_id, 'listing', case p_kind when 'legal_opinion' then 'Legal opinion added to your Property Passport' else 'Physical inspection added to your Property Passport' end, left(l.title, 160), '#property/' || l.id);
  end if;
  begin perform public.audit('assessment_add', 'listing', l.ref, p_kind, jsonb_build_object('id', rid, 'outcome', p_outcome)); exception when others then null; end;
  return rid;
end $$;
grant execute on function public.admin_add_assessment(uuid, text, text, text, date, text, text, text) to authenticated;

create or replace function public.admin_withdraw_assessment(p_id bigint, p_reason text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not (public.is_admin() or public.has_perm('verification')) then raise exception 'Only the verification team can withdraw this.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Give a reason for withdrawing it.'; end if;
  update public.listing_assessments set withdrawn_at = now(), withdrawn_reason = left(btrim(p_reason), 500) where id = p_id and withdrawn_at is null;
  begin perform public.audit('assessment_withdraw', 'assessment', p_id::text, p_reason, '{}'::jsonb); exception when others then null; end;
end $$;
grant execute on function public.admin_withdraw_assessment(bigint, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Price and stock alerts on construction materials
-- ---------------------------------------------------------------------
create table if not exists public.product_watch (
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  product_id uuid not null references public.vendor_products (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);
alter table public.product_watch enable row level security;
drop policy if exists "product_watch: own read" on public.product_watch;
create policy "product_watch: own read" on public.product_watch for select using (user_id = auth.uid());
drop policy if exists "product_watch: own add" on public.product_watch;
create policy "product_watch: own add" on public.product_watch for insert with check (user_id = auth.uid() and public.is_verified_user());
drop policy if exists "product_watch: own remove" on public.product_watch;
create policy "product_watch: own remove" on public.product_watch for delete using (user_id = auth.uid());
grant select, insert, delete on public.product_watch to authenticated;

create or replace function public.product_watch_notify()
returns trigger language plpgsql security definer set search_path = public
as $$
declare w record; v_shop text; t text; b text;
begin
  if not new.active then return new; end if;
  if new.price is not null and old.price is not null and new.price < old.price then
    t := 'Price down: ' || left(new.name, 120);
    b := 'Now Rs ' || to_char(new.price, 'FM999,999,999') || ' / ' || new.unit || ' (was Rs ' || to_char(old.price, 'FM999,999,999') || ')';
  elsif new.price is not null and old.price is not null and new.price > old.price then
    t := 'Price up: ' || left(new.name, 120);
    b := 'Now Rs ' || to_char(new.price, 'FM999,999,999') || ' / ' || new.unit || ' (was Rs ' || to_char(old.price, 'FM999,999,999') || ')';
  elsif coalesce(old.stock, '') = 'out' and coalesce(new.stock, '') <> 'out' then
    t := 'Back in stock: ' || left(new.name, 120);
    b := 'Order now while it lasts.';
  else
    return new;
  end if;
  select shop_name into v_shop from public.vendors where id = new.vendor_id;
  for w in select user_id from public.product_watch where product_id = new.id loop
    perform public.notify(w.user_id, 'deal', left(t, 160), left(coalesce(v_shop, 'Supplier') || ' · ' || b, 400), '#marketplace/vendor/' || new.vendor_id);
  end loop;
  return new;
end $$;
drop trigger if exists vendor_products_watch on public.vendor_products;
create trigger vendor_products_watch after update on public.vendor_products
  for each row execute function public.product_watch_notify();

do $$ begin raise notice 'Update 32 applied: joint ownership, chat block & report, Passport levels D/E, material price & stock alerts.'; end $$;


-- =====================================================================
-- update_33_admin_chats.sql
-- =====================================================================
-- =====================================================================
-- RAQBO update 33 — Admin: read every member conversation (All chats)
-- Admins only. Every conversation an admin opens is written to the audit log.
-- Safe to run more than once. Run after update_32_missing_features.sql.
-- =====================================================================

create or replace function public.admin_conversations(p_q text default '', p_limit int default 50, p_offset int default 0)
returns table (id uuid, subject text, starter_name text, other_name text, is_support boolean,
               last_message_at timestamptz, last_preview text, messages bigint, reports bigint, blocked boolean)
language plpgsql stable security definer set search_path = public
as $$
declare q text := '%' || lower(btrim(coalesce(p_q, ''))) || '%';
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return query
  select c.id, c.subject,
         coalesce(nullif(ps.full_name, ''), nullif(c.starter_name, ''), 'Member'),
         case when c.other_id is null then 'RAQBO team' else coalesce(nullif(po.full_name, ''), nullif(c.other_name, ''), 'Member') end,
         c.other_id is null,
         c.last_message_at, c.last_preview,
         (select count(*) from public.messages m where m.conversation_id = c.id),
         (select count(*) from public.chat_reports r where r.conversation_id = c.id),
         public.chat_blocked(c.id)
    from public.conversations c
    left join public.profiles ps on ps.id = c.starter_id
    left join public.profiles po on po.id = c.other_id
   where q = '%%' or lower(c.subject) like q or lower(coalesce(ps.full_name, c.starter_name, '')) like q
      or lower(coalesce(po.full_name, c.other_name, '')) like q or lower(c.last_preview) like q
   order by c.last_message_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end $$;
grant execute on function public.admin_conversations(text, int, int) to authenticated;

create or replace function public.admin_conversation_messages(p_conv uuid)
returns table (id bigint, sender_id uuid, sender_name text, body text, created_at timestamptz, read_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare c public.conversations;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  select * into c from public.conversations where conversations.id = p_conv;
  if c.id is null then raise exception 'Conversation not found.'; end if;
  -- Reading a private conversation is always recorded
  begin perform public.audit('chat_viewed', 'conversation', p_conv::text, left(c.subject, 160), '{}'::jsonb); exception when others then null; end;
  return query
  select m.id, m.sender_id,
         case when c.other_id is null and m.sender_id <> c.starter_id then 'RAQBO team'
              else coalesce(nullif(p.full_name, ''), 'Member') end,
         m.body, m.created_at, m.read_at
    from public.messages m left join public.profiles p on p.id = m.sender_id
   where m.conversation_id = p_conv
   order by m.id
   limit 500;
end $$;
grant execute on function public.admin_conversation_messages(uuid) to authenticated;

do $$ begin raise notice 'Update 33 applied: admins can read every conversation (each one opened is audit-logged).'; end $$;


-- =====================================================================
-- update_34_boundaries_home_services.sql
-- =====================================================================
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


-- Normal property offers and authorised buyer/seller conversations.
-- Run after the existing updates. Auction bids remain in the auction workflow.

create or replace function public.make_offer(p_listing uuid, p_amount bigint, p_conditions text)
returns text language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); l public.listings; src text; no int; o public.offers_deal; days int;
begin
  if me is null or not public.is_verified_user() then raise exception 'Please sign in to make an offer.'; end if;
  select * into l from public.listings where id = p_listing and status = 'published' for update;
  if l.id is null or l.sale_mode not in ('normal', 'urgent') or l.availability in ('sold', 'rented') then raise exception 'This property is not available for offers.'; end if;
  if l.owner_id is null then raise exception 'This property cannot receive offers until an advertiser is assigned.'; end if;
  if l.owner_id = me then raise exception 'You cannot make an offer on your own property.'; end if;
  if l.channel = 'private' or (l.channel = 'investors' and not public.is_approved_investor()) then raise exception 'This opportunity is only open to approved RAQBO investors.'; end if;
  if l.sale_mode = 'urgent' and not exists (
    select 1 from public.urgent_requests where listing_id = l.id and stage not in ('sold', 'closed', 'rejected')
  ) then raise exception 'This QuickSell request is no longer open.'; end if;
  if coalesce(p_amount, 0) < 1000 then raise exception 'Enter your offer in rupees.'; end if;
  if (select count(*) from public.offers_deal where buyer_id = me and created_at > now() - interval '1 day') >= 10 then raise exception 'You can make up to 10 offers a day.'; end if;
  if exists (select 1 from public.offers_deal where listing_id = l.id and buyer_id = me and status in ('submitted','countered') and (expires_at is null or expires_at > now())) then raise exception 'You already have an open offer on this property. Revise or withdraw it in My RAQBO → Offers.'; end if;
  src := case when public.is_approved_investor() then 'investor' else 'public' end;
  select coalesce(max(buyer_no), 0) into no from public.offers_deal where listing_id = l.id and buyer_id = me;
  if no = 0 then select coalesce(max(buyer_no), 0) + 1 into no from public.offers_deal where listing_id = l.id; end if;
  select offer_valid_days into days from public.platform_settings where id = 1;
  if days is null then raise exception 'Offer settings are not configured. Please contact RAQBO.'; end if;
  insert into public.offers_deal (listing_id, buyer_id, buyer_no, source, amount, conditions, expires_at)
  values (l.id, me, no, src, p_amount, left(btrim(coalesce(p_conditions, '')), 1000), now() + make_interval(days => days)) returning * into o;
  if l.sale_mode = 'urgent' then
    update public.urgent_requests set stage = 'offer_received', updated_at = now() where listing_id = l.id and stage in ('submitted','under_review','documents_checked','market_assessment','matching');
    perform public.deal_event(l.id, 'offer', null, 'Offer of Rs ' || to_char(p_amount, 'FM999,999,999,999') || ' from ' || case src when 'investor' then 'Investor ' else 'Buyer ' end || no, 'buyer');
    perform public.notify_admins('deal', 'Offer on ' || l.ref, 'Rs ' || to_char(p_amount, 'FM999,999,999,999') || ' · ' || src || ' · ' || left(l.title, 80), '#admin/urgent');
  end if;
  perform public.notify(l.owner_id, 'deal', 'New offer: Rs ' || to_char(p_amount, 'FM999,999,999,999'), left(l.title, 100) || ' · ' || case src when 'investor' then 'RAQBO investor ' else 'Buyer ' end || no || '. Review it in My RAQBO → Offers.', '#my/offers');
  return o.ref;
end $$;
grant execute on function public.make_offer(uuid, bigint, text) to authenticated;

-- Serialise offer decisions per listing, including buyer acceptance of a counter.
create or replace function public.respond_offer(p_offer uuid, p_action text, p_amount bigint, p_note text)
returns void language plpgsql security definer set search_path = public
as $$
declare o public.offers_deal; l public.listings; by_admin boolean;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  select * into o from public.offers_deal where id = p_offer;
  if o.id is null then raise exception 'Offer not found.'; end if;
  select * into l from public.listings where id = o.listing_id for update;
  select * into o from public.offers_deal where id = p_offer;
  by_admin := l.sale_mode = 'urgent' and coalesce(public.has_perm('urgent'), false) and l.owner_id is distinct from auth.uid();
  if l.owner_id is distinct from auth.uid() and not by_admin then raise exception 'Only the seller can respond to this offer.'; end if;
  if o.status not in ('submitted','countered') then raise exception 'This offer is already closed.'; end if;
  if o.expires_at is not null and o.expires_at <= now() then raise exception 'This offer has expired.'; end if;
  if p_action in ('accept','counter') and (l.status <> 'published' or l.sale_mode not in ('normal','urgent') or l.availability in ('sold','rented')) then raise exception 'This property is not available for offers.'; end if;
  if p_action = 'accept' then
    update public.offers_deal set status = 'accepted', response_note = left(coalesce(p_note, ''), 600), updated_at = now() where id = o.id;
    update public.offers_deal set status = 'rejected', response_note = 'The seller accepted another offer.', updated_at = now() where listing_id = o.listing_id and id <> o.id and status in ('submitted','countered');
    update public.urgent_requests set stage = 'agreement', stage_note = 'Offer accepted subject to documents, payment and the final agreement.', updated_at = now() where listing_id = o.listing_id;
    perform public.deal_event(o.listing_id, 'stage', 'agreement', 'Offer ' || o.ref || ' accepted — subject to the final agreement', case when by_admin then 'raqbo' else 'owner' end);
    if l.sale_mode = 'urgent' then perform public.notify_admins('deal', 'Offer accepted: ' || l.ref, 'Rs ' || to_char(o.amount, 'FM999,999,999,999') || ' · arrange the agreement', '#admin/urgent'); end if;
  elsif p_action = 'reject' then
    update public.offers_deal set status = 'rejected', response_note = left(coalesce(p_note, ''), 600), updated_at = now() where id = o.id;
    perform public.deal_event(o.listing_id, 'offer', null, 'Offer ' || o.ref || ' declined', case when by_admin then 'raqbo' else 'owner' end);
  elsif p_action = 'counter' then
    if coalesce(p_amount, 0) <= o.amount then raise exception 'A counter-offer should be higher than the offer.'; end if;
    update public.offers_deal set status = 'countered', counter_amount = p_amount, response_note = left(coalesce(p_note, ''), 600), updated_at = now() where id = o.id;
    update public.urgent_requests set stage = 'negotiation', updated_at = now() where listing_id = o.listing_id and stage in ('submitted','under_review','documents_checked','market_assessment','matching','offer_received');
    perform public.deal_event(o.listing_id, 'stage', 'negotiation', 'Counter-offer of Rs ' || to_char(p_amount, 'FM999,999,999,999') || ' on ' || o.ref, case when by_admin then 'raqbo' else 'owner' end);
  else raise exception 'Unknown action.'; end if;
  if o.buyer_id is not null then
    perform public.notify(o.buyer_id, 'deal', case p_action when 'accept' then 'Your offer was accepted' when 'reject' then 'Your offer was declined' else 'The seller made a counter-offer' end,
      left(l.title, 100) || case when p_action = 'counter' then ' · Rs ' || to_char(p_amount, 'FM999,999,999,999') else '' end || case when coalesce(p_note, '') <> '' then ' · ' || left(p_note, 120) else '' end, '#my/offers');
  end if;
  if by_admin then perform public.audit('offer.' || p_action, 'offer', o.ref, p_note, jsonb_build_object('amount', p_amount)); end if;
end $$;
grant execute on function public.respond_offer(uuid, text, bigint, text) to authenticated;

create or replace function public.buyer_offer_action(p_offer uuid, p_action text, p_amount bigint)
returns void language plpgsql security definer set search_path = public
as $$
declare o public.offers_deal; l public.listings;
begin
  select * into o from public.offers_deal where id = p_offer and buyer_id = auth.uid();
  if o.id is null then raise exception 'Offer not found.'; end if;
  select * into l from public.listings where id = o.listing_id for update;
  select * into o from public.offers_deal where id = p_offer and buyer_id = auth.uid();
  if o.id is null or o.status not in ('submitted','countered') then raise exception 'This offer is already closed.'; end if;
  if o.expires_at is not null and o.expires_at <= now() then raise exception 'This offer has expired.'; end if;
  if p_action in ('accept_counter','revise') and (l.status <> 'published' or l.sale_mode not in ('normal','urgent') or l.availability in ('sold','rented')) then raise exception 'This property is not available for offers.'; end if;
  if p_action = 'withdraw' then
    update public.offers_deal set status = 'withdrawn', updated_at = now() where id = o.id;
  elsif p_action = 'accept_counter' then
    if o.status <> 'countered' then raise exception 'There is no counter-offer to accept.'; end if;
    update public.offers_deal set status = 'accepted', amount = o.counter_amount, updated_at = now() where id = o.id;
    update public.offers_deal set status = 'rejected', response_note = 'The seller accepted another offer.', updated_at = now() where listing_id = o.listing_id and id <> o.id and status in ('submitted','countered');
    update public.urgent_requests set stage = 'agreement', stage_note = 'Offer accepted subject to documents, payment and the final agreement.', updated_at = now() where listing_id = o.listing_id;
    perform public.deal_event(o.listing_id, 'stage', 'agreement', 'Buyer ' || o.buyer_no || ' accepted the counter-offer of Rs ' || to_char(o.counter_amount, 'FM999,999,999,999'), 'buyer');
    if l.sale_mode = 'urgent' then perform public.notify_admins('deal', 'Counter-offer accepted: ' || l.ref, 'Rs ' || to_char(o.counter_amount, 'FM999,999,999,999') || ' · arrange the agreement', '#admin/urgent'); end if;
  elsif p_action = 'revise' then
    if coalesce(p_amount, 0) <= o.amount then raise exception 'A revised offer should be higher than your last offer.'; end if;
    update public.offers_deal set status = 'submitted', amount = p_amount, counter_amount = null, updated_at = now() where id = o.id;
  else raise exception 'Unknown action.'; end if;
  perform public.notify(l.owner_id, 'deal', case p_action when 'withdraw' then 'An offer was withdrawn' when 'accept_counter' then 'Your counter-offer was accepted' else 'A buyer revised their offer' end,
    left(l.title, 100) || ' · Buyer ' || o.buyer_no || case when p_action = 'revise' then ' · Rs ' || to_char(p_amount, 'FM999,999,999,999') else '' end, '#my/offers');
  perform public.deal_event(o.listing_id, 'offer', null, 'Buyer ' || o.buyer_no || ' ' || replace(p_action, '_', ' '), 'buyer');
end $$;
grant execute on function public.buyer_offer_action(uuid, text, bigint) to authenticated;

create or replace function public.my_deals()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  return jsonb_build_object(
    'urgent', coalesce((select jsonb_agg(jsonb_build_object('listing_id', u.listing_id, 'title', l.title, 'ref', l.ref, 'price', l.price, 'city', l.city, 'area', l.area, 'status', l.status, 'channel', l.channel,
        'options', to_jsonb(u.options), 'min_price', u.min_price, 'timeframe', u.timeframe, 'stage', u.stage, 'stage_note', u.stage_note, 'created_at', u.created_at,
        'events', coalesce((select jsonb_agg(jsonb_build_object('stage', e.stage, 'kind', e.kind, 'note', e.note, 'actor', e.actor, 'at', e.at) order by e.at) from public.deal_events e where e.listing_id = u.listing_id), '[]'::jsonb),
        'visits', coalesce((select jsonb_agg(jsonb_build_object('status', i.status, 'at', coalesce(i.confirmed_at, i.preferred_at))) from public.inspections i where i.listing_id = u.listing_id), '[]'::jsonb)) order by u.created_at desc)
      from public.urgent_requests u join public.listings l on l.id = u.listing_id where u.owner_id = me), '[]'::jsonb),
    'received', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'ref', o.ref, 'listing_id', o.listing_id, 'title', l.title, 'listing_ref', l.ref, 'price', l.price, 'channel', l.channel,
        'who', case o.source when 'raqbo' then 'RAQBO' when 'investor' then 'RAQBO investor ' || o.buyer_no else 'Buyer ' || o.buyer_no end, 'source', o.source,
        'amount', o.amount, 'counter_amount', o.counter_amount, 'conditions', o.conditions, 'status', case when o.status in ('submitted','countered') and o.expires_at <= now() then 'expired' else o.status end,
        'response_note', o.response_note, 'expires_at', o.expires_at, 'created_at', o.created_at) order by o.created_at desc)
      from public.offers_deal o join public.listings l on l.id = o.listing_id where l.owner_id = me), '[]'::jsonb),
    'made', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'ref', o.ref, 'listing_id', o.listing_id, 'title', l.title, 'listing_ref', l.ref, 'price', l.price, 'channel', l.channel, 'amount', o.amount, 'counter_amount', o.counter_amount,
        'conditions', o.conditions, 'status', case when o.status in ('submitted','countered') and o.expires_at <= now() then 'expired' else o.status end, 'response_note', o.response_note, 'expires_at', o.expires_at, 'created_at', o.created_at) order by o.created_at desc)
      from public.offers_deal o join public.listings l on l.id = o.listing_id where o.buyer_id = me), '[]'::jsonb),
    'visits', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'listing_id', i.listing_id, 'title', l.title, 'status', i.status, 'preferred_at', i.preferred_at, 'confirmed_at', i.confirmed_at, 'admin_note', i.admin_note) order by i.created_at desc)
      from public.inspections i join public.listings l on l.id = i.listing_id where i.user_id = me), '[]'::jsonb),
    'investor', (select to_jsonb(i) - 'capacity_docs' - 'approved_by' from public.investor_profiles i where i.user_id = me));
end $$;
grant execute on function public.my_deals() to authenticated;

-- The general listing-chat entry point must respect the same confidentiality rule.
create or replace function public.start_conversation(p_listing uuid default null, p_vendor uuid default null, p_order uuid default null)
returns uuid language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); other uuid; subj text; cid uuid; l public.listings; v public.vendors; o public.orders; my_name text; other_name text;
begin
  if me is null or not public.is_verified_user() then raise exception 'Please sign in to send messages.'; end if;
  select coalesce(nullif(full_name, ''), 'RAQBO member') into my_name from public.profiles where id = me;
  if p_listing is not null then
    select * into l from public.listings where id = p_listing and (status = 'published' or owner_id = me);
    if l.id is null then raise exception 'This property is not available.'; end if;
    if l.channel <> 'public' then raise exception 'Private opportunities are coordinated through RAQBO.'; end if;
    other := l.owner_id; subj := l.title || ' · ' || l.ref;
    if other = me then raise exception 'This is your own listing.'; end if;
  elsif p_vendor is not null then
    select * into v from public.vendors where id = p_vendor and (status = 'approved' or owner_id = me);
    if v.id is null then raise exception 'This shop is not available.'; end if;
    other := v.owner_id; subj := v.shop_name;
    if other = me then raise exception 'This is your own shop.'; end if;
  elsif p_order is not null then
    select * into o from public.orders where id = p_order;
    if o.id is null then raise exception 'Order not found.'; end if;
    select * into v from public.vendors where id = o.vendor_id;
    if o.buyer_id = me then other := v.owner_id; elsif v.owner_id = me then other := o.buyer_id; elsif public.is_admin() then other := o.buyer_id; else raise exception 'This is not your order.'; end if;
    subj := 'Order ' || o.ref || ' · ' || v.shop_name;
  else
    other := null; subj := 'RAQBO support';
  end if;
  select coalesce(nullif(full_name, ''), 'RAQBO member') into other_name from public.profiles where id = other;
  select id into cid from public.conversations
   where starter_id = me and other_id is not distinct from other
     and coalesce(listing_id, vendor_id, order_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_listing, p_vendor, p_order, '00000000-0000-0000-0000-000000000000'::uuid);
  if cid is null then
    select id into cid from public.conversations where order_id = p_order and p_order is not null and starter_id = other and other_id = me;
  end if;
  if cid is null then
    insert into public.conversations (starter_id, other_id, listing_id, vendor_id, order_id, subject, starter_name, other_name)
    values (me, other, p_listing, p_vendor, p_order, left(subj, 160), my_name, coalesce(other_name, 'RAQBO team')) returning id into cid;
  end if;
  return cid;
end $$;
grant execute on function public.start_conversation(uuid, uuid, uuid) to authenticated;

create or replace function public.start_offer_chat(p_offer uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); o public.offers_deal; l public.listings; cid uuid; buyer_name text; owner_name text;
begin
  if me is null or not public.is_verified_user() then raise exception 'Please sign in to send messages.'; end if;
  select * into o from public.offers_deal where id = p_offer;
  if o.id is null then raise exception 'Offer not found.'; end if;
  select * into l from public.listings where id = o.listing_id;
  if o.buyer_id is null or l.owner_id is null or (me <> o.buyer_id and me <> l.owner_id) then raise exception 'This conversation is not available.'; end if;
  if l.channel <> 'public' then raise exception 'Private opportunities are coordinated through RAQBO.'; end if;
  if o.status not in ('submitted', 'countered', 'accepted') or (o.status <> 'accepted' and o.expires_at is not null and o.expires_at <= now()) then
    raise exception 'This offer is no longer open for a new conversation.';
  end if;
  select coalesce(nullif(full_name, ''), 'RAQBO member') into buyer_name from public.profiles where id = o.buyer_id;
  select coalesce(nullif(full_name, ''), 'Advertiser') into owner_name from public.profiles where id = l.owner_id;
  select id into cid from public.conversations where starter_id = o.buyer_id and other_id = l.owner_id and listing_id = l.id;
  if cid is null then
    insert into public.conversations (starter_id, other_id, listing_id, subject, starter_name, other_name)
    values (o.buyer_id, l.owner_id, l.id, left(l.title || ' · ' || l.ref, 160), buyer_name, owner_name)
    on conflict do nothing returning id into cid;
    if cid is null then
      select id into cid from public.conversations where starter_id = o.buyer_id and other_id = l.owner_id and listing_id = l.id;
    end if;
  end if;
  if cid is null then raise exception 'Could not open the conversation.'; end if;
  return cid;
end $$;
revoke all on function public.start_offer_chat(uuid) from public, anon;
grant execute on function public.start_offer_chat(uuid) to authenticated;
