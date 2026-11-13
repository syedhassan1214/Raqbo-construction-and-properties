-- =====================================================================
-- RAQBO — update 41
-- The auction completion file.
--
-- Winning a bid used to be where RAQBO stopped: the auction ended, the
-- highest bidder became the provisional winner, and everything after
-- that — the papers, the money, the agreement, the registry — happened
-- on the phone with no record of it anywhere.
--
-- This gives that stretch a home:
--   * a completion row per auction, with four steps RAQBO ticks
--   * the papers, ticked by the owner or by RAQBO
--   * payments the winner records and RAQBO confirms against the bank
--   * a deal room between the owner and the winning bidder
--   * confirm_auction_sale, which refuses until all four steps are done
--
-- Only RAQBO ticks a step, and every tick carries a note that both
-- sides can read. Nothing here transfers ownership: that still happens
-- at the registry, outside RAQBO.
--
-- Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------- 1
create table if not exists public.auction_completions (
  auction_id  uuid primary key references public.auctions(id) on delete cascade,
  docs        jsonb       not null default '{}'::jsonb,
  steps       jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.auction_payments (
  id          uuid primary key default gen_random_uuid(),
  auction_id  uuid not null references public.auctions(id) on delete cascade,
  payer_id    uuid not null references public.profiles(id) on delete cascade,
  amount      bigint not null check (amount >= 1000),
  ref         text not null,
  status      text not null default 'submitted' check (status in ('submitted','received','rejected')),
  note        text not null default '',
  decided_by  uuid references public.profiles(id),
  decided_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists auction_payments_auction_idx on public.auction_payments (auction_id, created_at);

alter table public.auction_completions enable row level security;
alter table public.auction_payments    enable row level security;
-- everything goes through the functions below
revoke all on public.auction_completions from anon, authenticated;
revoke all on public.auction_payments    from anon, authenticated;

-- ---------------------------------------------------------------- 2
-- Who may open a completion file: the owner, the winning bidder, RAQBO.
create or replace function public.auction_party(p_auction uuid)
returns text language plpgsql security definer set search_path = public stable
as $$
declare me uuid := auth.uid(); a public.auctions; wb uuid;
begin
  if me is null then return 'none'; end if;
  select * into a from public.auctions where id = p_auction;
  if a.id is null then return 'none'; end if;
  select user_id into wb from public.auction_bidders where id = a.high_bidder;
  if a.seller_id = me then return 'seller'; end if;
  if wb = me then return 'winner'; end if;
  if public.has_perm('auctions') then return 'admin'; end if;
  return 'none';
end $$;
grant execute on function public.auction_party(uuid) to authenticated;

-- ---------------------------------------------------------------- 3
create or replace function public.auction_completion(p_auction uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare role text := public.auction_party(p_auction); c public.auction_completions;
begin
  if role = 'none' then raise exception 'This completion file is open to the owner, the winning bidder and RAQBO only.'; end if;
  select * into c from public.auction_completions where auction_id = p_auction;
  if c.auction_id is null then
    insert into public.auction_completions (auction_id) values (p_auction)
      on conflict (auction_id) do nothing;
    select * into c from public.auction_completions where auction_id = p_auction;
  end if;
  return jsonb_build_object(
    'docs',  coalesce(c.docs,  '{}'::jsonb),
    'steps', coalesce(c.steps, '{}'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'amount', p.amount, 'ref', p.ref,
               'status', p.status, 'note', p.note, 'at', p.created_at)
             order by p.created_at)
        from public.auction_payments p where p.auction_id = p_auction), '[]'::jsonb)
  );
end $$;
grant execute on function public.auction_completion(uuid) to authenticated;

-- ---------------------------------------------------------------- 4
-- A step is ticked by RAQBO only, in order, with a note both sides read.
create or replace function public.auction_completion_step(p_auction uuid, p_step text, p_done boolean, p_note text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  a public.auctions; l public.listings; wb uuid;
  v_steps jsonb; order_of int; n int; prev text;
  labels text[] := array['documents','payment','agreement','transfer'];
begin
  if not public.has_perm('auctions') then raise exception 'You do not have permission to manage auctions.'; end if;
  if p_step is null or not (p_step = any (labels)) then raise exception 'Unknown step.'; end if;
  select * into a from public.auctions where id = p_auction;
  if a.id is null then raise exception 'Auction not found.'; end if;
  if a.status not in ('provisional','sold','failed') then raise exception 'This auction has not produced a winner yet.'; end if;

  insert into public.auction_completions (auction_id) values (p_auction) on conflict (auction_id) do nothing;
  select coalesce(c.steps, '{}'::jsonb) into v_steps from public.auction_completions c where c.auction_id = p_auction;

  select array_position(labels, p_step) into order_of;
  if p_done then
    if coalesce(btrim(p_note), '') = '' then raise exception 'Please write a short note — it stays on the file.'; end if;
    -- the steps run in order; no jumping ahead
    for n in 1 .. order_of - 1 loop
      prev := labels[n];
      if not coalesce((v_steps -> prev ->> 'done')::boolean, false) then
        raise exception 'Tick the earlier steps first (% is still open).', prev;
      end if;
    end loop;
    v_steps := v_steps || jsonb_build_object(p_step, jsonb_build_object(
      'done', true, 'at', now(), 'note', left(btrim(p_note), 600)));
  else
    -- reopening a step reopens everything after it, so the file cannot lie
    for n in order_of .. array_length(labels, 1) loop
      v_steps := v_steps - labels[n];
    end loop;
  end if;

  update public.auction_completions set steps = v_steps, updated_at = now() where auction_id = p_auction;

  select * into l from public.listings where id = a.listing_id;
  select user_id into wb from public.auction_bidders where id = a.high_bidder;
  perform public.deal_event(a.listing_id, 'stage', p_step,
    case when p_done then 'Completion step done: ' || p_step || ' — ' || left(btrim(p_note), 200)
         else 'Completion step reopened: ' || p_step end, 'raqbo');
  if p_done then
    perform public.notify(a.seller_id, 'auction', 'Completion step done: ' || p_step,
      left(coalesce(l.title, ''), 90) || ' · ' || left(btrim(p_note), 120), '#deal/' || p_auction::text);
    if wb is not null then
      perform public.notify(wb, 'auction', 'Completion step done: ' || p_step,
        left(coalesce(l.title, ''), 90) || ' · ' || left(btrim(p_note), 120), '#deal/' || p_auction::text);
    end if;
  end if;
  perform public.audit('auction.step.' || p_step, 'auction', a.ref, coalesce(btrim(p_note), 'reopened'), jsonb_build_object('step', p_step, 'done', p_done));
end $$;
grant execute on function public.auction_completion_step(uuid, text, boolean, text) to authenticated;

-- ---------------------------------------------------------------- 5
-- The papers. The owner ticks what they hold; RAQBO can correct it.
create or replace function public.auction_completion_docs(p_auction uuid, p_docs jsonb)
returns void language plpgsql security definer set search_path = public
as $$
declare role text := public.auction_party(p_auction); a public.auctions;
begin
  if role not in ('seller','admin') then raise exception 'The owner or RAQBO keeps this list.'; end if;
  if p_docs is null or jsonb_typeof(p_docs) <> 'object' then raise exception 'Nothing to save.'; end if;
  if (select count(*) from jsonb_object_keys(p_docs)) > 40 then raise exception 'Too many entries.'; end if;
  select * into a from public.auctions where id = p_auction;
  if a.id is null then raise exception 'Auction not found.'; end if;
  insert into public.auction_completions (auction_id, docs) values (p_auction, p_docs)
    on conflict (auction_id) do update set docs = p_docs, updated_at = now();
  perform public.audit('auction.docs', 'auction', a.ref, (select count(*)::text from jsonb_object_keys(p_docs)) || ' papers held', p_docs);
end $$;
grant execute on function public.auction_completion_docs(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- 6
-- The winner records what they paid; RAQBO matches it to the statement.
create or replace function public.auction_completion_payment(p_auction uuid, p_amount bigint, p_ref text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare role text := public.auction_party(p_auction); a public.auctions; l public.listings; pid uuid;
begin
  if role <> 'winner' then raise exception 'Only the winning bidder records a payment here.'; end if;
  if coalesce(p_amount, 0) < 1000 then raise exception 'Enter the amount in rupees.'; end if;
  if length(coalesce(btrim(p_ref), '')) < 4 then raise exception 'Enter the bank transaction ID from your receipt.'; end if;
  select * into a from public.auctions where id = p_auction;
  if a.status <> 'provisional' then raise exception 'This auction is already closed.'; end if;
  if (select count(*) from public.auction_payments
       where auction_id = p_auction and payer_id = auth.uid()
         and created_at > now() - interval '1 day') >= 10 then
    raise exception 'You can record up to 10 payments a day. Message RAQBO if something is wrong.';
  end if;
  insert into public.auction_payments (auction_id, payer_id, amount, ref)
  values (p_auction, auth.uid(), p_amount, left(btrim(p_ref), 120)) returning id into pid;
  select * into l from public.listings where id = a.listing_id;
  perform public.notify_admins('auction', 'Auction payment sent: ' || a.ref,
    'Rs ' || to_char(p_amount, 'FM999,999,999,999') || ' · ref ' || left(btrim(p_ref), 60) || ' · ' || left(coalesce(l.title, ''), 60),
    '#deal/' || p_auction::text);
  perform public.notify(a.seller_id, 'auction', 'The buyer has sent a payment',
    'Rs ' || to_char(p_amount, 'FM999,999,999,999') || ' · RAQBO is checking it against the bank statement.',
    '#deal/' || p_auction::text);
  return pid;
end $$;
grant execute on function public.auction_completion_payment(uuid, bigint, text) to authenticated;

-- ---------------------------------------------------------------- 7
create or replace function public.auction_completion_payment_decide(p_payment uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public
as $$
declare p public.auction_payments; a public.auctions;
begin
  if not public.has_perm('auctions') then raise exception 'You do not have permission to manage auctions.'; end if;
  if p_status not in ('received','rejected') then raise exception 'Unknown decision.'; end if;
  select * into p from public.auction_payments where id = p_payment;
  if p.id is null then raise exception 'Payment not found.'; end if;
  if p.status <> 'submitted' then raise exception 'This payment has already been decided.'; end if;
  if p_status = 'rejected' and coalesce(btrim(p_note), '') = '' then raise exception 'Write a short reason — the payer will see it.'; end if;
  update public.auction_payments
     set status = p_status, note = left(btrim(coalesce(p_note, '')), 600), decided_by = auth.uid(), decided_at = now()
   where id = p_payment;
  select * into a from public.auctions where id = p.auction_id;
  perform public.notify(p.payer_id, 'auction',
    case p_status when 'received' then 'Payment received' else 'Payment not matched' end,
    'Rs ' || to_char(p.amount, 'FM999,999,999,999') || case when coalesce(btrim(p_note), '') = '' then '' else ' · ' || left(btrim(p_note), 140) end,
    '#deal/' || p.auction_id::text);
  perform public.audit('auction.payment.' || p_status, 'auction', a.ref,
    'Rs ' || to_char(p.amount, 'FM999,999,999,999') || ' ref ' || p.ref || ' ' || coalesce(btrim(p_note), ''),
    jsonb_build_object('amount', p.amount, 'ref', p.ref));
end $$;
grant execute on function public.auction_completion_payment_decide(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- 8
-- The deal room. The owner and the winning bidder, nobody else. The
-- bidder stays a number, so RAQBO still makes the real introduction.
create or replace function public.start_auction_chat(p_auction uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid(); a public.auctions; l public.listings;
  wb public.auction_bidders; other uuid; cid uuid;
  seller_name text; bidder_label text; subj text;
begin
  if me is null then raise exception 'Please sign in.'; end if;
  select * into a from public.auctions where id = p_auction;
  if a.id is null then raise exception 'Auction not found.'; end if;
  select * into wb from public.auction_bidders where id = a.high_bidder;
  if wb.id is null then raise exception 'This auction has no winning bidder yet.'; end if;
  select * into l from public.listings where id = a.listing_id;
  if l.id is null then raise exception 'That property is no longer listed.'; end if;

  if me = a.seller_id then other := wb.user_id;
  elsif me = wb.user_id then other := a.seller_id;
  else raise exception 'This deal room is open to the owner and the winning bidder only.'; end if;

  select c.id into cid from public.conversations c
   where c.listing_id = l.id
     and ((c.starter_id = me and c.other_id = other) or (c.starter_id = other and c.other_id = me))
   order by c.created_at limit 1;

  if cid is null then
    select coalesce(full_name, 'Owner') into seller_name from public.profiles where id = a.seller_id;
    bidder_label := 'Bidder ' || wb.bidder_no;
    seller_name := coalesce(nullif(btrim(seller_name), ''), 'Owner');
    subj := 'Auction ' || a.ref || ' · ' || left(l.title, 70);
    insert into public.conversations (starter_id, other_id, listing_id, subject, starter_name, other_name)
    values (me, other, l.id, subj,
            case when me = a.seller_id then seller_name else bidder_label end,
            case when me = a.seller_id then bidder_label else seller_name end)
    returning id into cid;
  end if;

  perform public.notify(other, 'message', 'A message about the auction',
    left(l.title, 90) || ' · ' || a.ref, '#messages/' || cid::text);
  return cid;
end $$;
grant execute on function public.start_auction_chat(uuid) to authenticated;

-- ---------------------------------------------------------------- 9
-- The gate. admin_auction_result already records the outcome; this makes
-- 'sold' impossible until the four steps are ticked, so a sale cannot be
-- confirmed on a file that has no papers, no payment and no transfer.
create or replace function public.admin_auction_result(p_id uuid, p_result text, p_reason text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  a public.auctions; l public.listings; wb public.auction_bidders;
  v_steps jsonb; missing text[] := '{}';
  labels text[] := array['documents','payment','agreement','transfer'];
  k text;
begin
  if not public.has_perm('auctions') then raise exception 'You do not have permission to manage auctions.'; end if;
  if coalesce(btrim(p_reason), '') = '' or length(btrim(p_reason)) < 3 then raise exception 'Please give a reason (it is kept in the audit log).'; end if;
  if p_result not in ('sold','failed','ended') then raise exception 'Unknown result.'; end if;
  select * into a from public.auctions where id = p_id for update;
  if a.id is null or a.status not in ('provisional','reserve_not_met') then raise exception 'Only a finished auction can be completed.'; end if;
  if p_result = 'sold' and a.status <> 'provisional' then raise exception 'There is no provisional winner to confirm.'; end if;

  if p_result = 'sold' then
    select coalesce(c.steps, '{}'::jsonb) into v_steps from public.auction_completions c where c.auction_id = p_id;
    v_steps := coalesce(v_steps, '{}'::jsonb);
    foreach k in array labels loop
      if not coalesce((v_steps -> k ->> 'done')::boolean, false) then missing := missing || k; end if;
    end loop;
    if array_length(missing, 1) > 0 then
      raise exception 'The completion file is not finished: % still open. Tick every step before confirming the sale.',
        array_to_string(missing, ', ');
    end if;
  end if;

  select * into l from public.listings where id = a.listing_id;
  select * into wb from public.auction_bidders where id = a.high_bidder;

  update public.auctions set status = p_result, result_note = left(btrim(p_reason), 500), updated_at = now() where id = p_id;

  perform set_config('raqbo.sys', '1', true);
  if p_result = 'sold' then
    update public.listings set channel = 'private' where id = a.listing_id;
  else
    update public.listings set sale_mode = 'normal' where id = a.listing_id;
  end if;
  perform set_config('raqbo.sys', '', true);

  -- the winner's deposit is forfeited only where they failed to complete
  if p_result = 'failed' and wb.id is not null and wb.deposit_status = 'paid' then
    update public.auction_bidders set deposit_status = 'forfeited' where id = wb.id;
  end if;

  perform public.deal_event(a.listing_id, 'stage', p_result,
    case p_result when 'sold' then 'Sale completed' when 'failed' then 'Winning bidder did not complete' else 'Auction closed without a sale' end
    || ' — ' || left(btrim(p_reason), 200), 'raqbo');
  perform public.notify(a.seller_id, 'auction',
    case p_result when 'sold' then 'Auction sale completed' when 'failed' then 'Winning bidder did not complete' else 'Auction closed' end,
    left(coalesce(l.title, ''), 90) || ' · ' || left(btrim(p_reason), 120), '#deal/' || p_id::text);
  if wb.user_id is not null then
    perform public.notify(wb.user_id, 'auction',
      case p_result when 'sold' then 'Purchase completed' else 'Auction closed' end,
      left(coalesce(l.title, ''), 90) || ' · ' || left(btrim(p_reason), 120), '#deal/' || p_id::text);
  end if;
  perform public.audit('auction.' || p_result, 'auction', a.ref, btrim(p_reason), jsonb_build_object('high', a.high_amount));
end $$;
grant execute on function public.admin_auction_result(uuid, text, text) to authenticated;

do $$ begin raise notice 'update_41 applied: every auction that finds a winner now has a completion file, and a sale cannot be confirmed until all four steps are ticked.'; end $$;
