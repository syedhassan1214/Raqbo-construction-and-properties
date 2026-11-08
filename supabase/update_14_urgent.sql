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
