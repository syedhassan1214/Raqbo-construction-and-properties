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
