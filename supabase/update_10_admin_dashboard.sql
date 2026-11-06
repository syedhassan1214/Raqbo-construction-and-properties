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
        'messages_week', (select count(*) from public.messages where created_at > now() - interval '7 days')),
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
    foreach t in array array['profiles', 'listings', 'enquiries', 'reports', 'buyer_profiles'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
