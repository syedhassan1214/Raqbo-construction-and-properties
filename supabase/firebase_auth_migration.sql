-- One-time migration from Supabase Auth UUIDs to Firebase UID strings.
-- Existing rows and their current ownership values are preserved as text.
-- Run this file first, then run schema.sql to recreate functions and RLS policies.
begin;

drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists listings_before_insert on public.listings;
drop trigger if exists listings_before_update on public.listings;
drop trigger if exists enquiries_before_insert on public.enquiries;
drop trigger if exists reports_before_insert on public.reports;

drop policy if exists "profiles: read own or admin" on public.profiles;
drop policy if exists "profiles: update own" on public.profiles;
drop policy if exists "listings: read" on public.listings;
drop policy if exists "listings: owner inserts pending" on public.listings;
drop policy if exists "listings: admin updates" on public.listings;
drop policy if exists "listings: owner edits own" on public.listings;
drop policy if exists "listings: owner withdraws pending, admin deletes" on public.listings;
drop policy if exists "listings: owner or admin deletes" on public.listings;
drop policy if exists "media: read with listing" on public.listing_media;
drop policy if exists "media: owner adds to pending listing" on public.listing_media;
drop policy if exists "media: admin deletes" on public.listing_media;
drop policy if exists "media: owner or admin deletes" on public.listing_media;
drop policy if exists "enquiries: anyone submits" on public.enquiries;
drop policy if exists "enquiries: verified users submit" on public.enquiries;
drop policy if exists "enquiries: admin reads" on public.enquiries;
drop policy if exists "enquiries: admin updates" on public.enquiries;
drop policy if exists "reports: anyone reports a published listing" on public.reports;
drop policy if exists "reports: verified users report a published listing" on public.reports;
drop policy if exists "reports: admin reads" on public.reports;
drop policy if exists "reports: admin updates" on public.reports;
drop policy if exists "favorites: own" on public.favorites;
drop policy if exists "listing-media: upload own folder" on storage.objects;
drop policy if exists "listing-media: read visible" on storage.objects;
drop policy if exists "listing-media: owner or admin deletes" on storage.objects;

drop function if exists public.listings_before_insert() cascade;
drop function if exists public.listings_before_update() cascade;
drop function if exists public.submissions_before_insert() cascade;
drop function if exists public.complete_profile(text, text) cascade;
drop function if exists public.is_admin() cascade;
drop function if exists public.current_user_id() cascade;
drop function if exists public.handle_new_user() cascade;

alter table public.listings drop constraint if exists listings_owner_id_fkey;
alter table public.listings drop constraint if exists listings_reviewed_by_fkey;
alter table public.enquiries drop constraint if exists enquiries_user_id_fkey;
alter table public.reports drop constraint if exists reports_user_id_fkey;
alter table public.favorites drop constraint if exists favorites_user_id_fkey;
alter table public.profiles drop constraint if exists profiles_id_fkey;

alter table public.profiles alter column id type text using id::text;
alter table public.listings alter column owner_id type text using owner_id::text;
alter table public.listings alter column reviewed_by type text using reviewed_by::text;
alter table public.enquiries alter column user_id type text using user_id::text;
alter table public.reports alter column user_id type text using user_id::text;
alter table public.favorites alter column user_id type text using user_id::text;
alter table public.favorites alter column user_id drop default;

alter table public.listings
  add constraint listings_owner_id_fkey foreign key (owner_id) references public.profiles (id) on delete set null,
  add constraint listings_reviewed_by_fkey foreign key (reviewed_by) references public.profiles (id) on delete set null;
alter table public.enquiries
  add constraint enquiries_user_id_fkey foreign key (user_id) references public.profiles (id) on delete set null;
alter table public.reports
  add constraint reports_user_id_fkey foreign key (user_id) references public.profiles (id) on delete set null;
alter table public.favorites
  add constraint favorites_user_id_fkey foreign key (user_id) references public.profiles (id) on delete cascade;

commit;
