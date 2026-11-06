-- =====================================================================
-- RAQBO — remove an OLDER RAQBO database setup (run ONE time, BEFORE schema.sql)
-- Use this only if you already ran a previous RAQBO schema.sql.
-- WARNING: deletes all RAQBO listings, enquiries, reports and favorites.
-- Uploaded files in Storage are not deleted.
-- =====================================================================
drop trigger if exists on_auth_user_created on auth.users;
drop view if exists public.vendor_rating_summary;
drop table if exists public.messages, public.conversations, public.notifications, public.email_outbox, public.raqbo_settings, public.vendor_reviews, public.order_events, public.orders, public.buyer_profiles, public.vendor_products, public.vendor_private, public.vendors cascade;
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
