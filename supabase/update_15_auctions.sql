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
