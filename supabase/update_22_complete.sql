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
returns jsonb language plpgsql stable security definer set search_path = public as $$
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
