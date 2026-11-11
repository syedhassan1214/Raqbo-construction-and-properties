-- =====================================================================
-- RAQBO update 26 — ONLINE PAYMENTS (Safepay)
-- Members pay online by card or wallet instead of a manual bank transfer.
-- Bank transfer stays available on every flow as a backup.
--
-- SECURITY NOTES
--  * The amount is ALWAYS worked out by the database from the thing being
--    paid for. The browser can never choose or change what it pays.
--  * A payment is only marked paid by the RAQBO server after it has asked
--    Safepay directly. pay_settle() is not available to website visitors.
--  * No Safepay key is stored here. Keys live in Vercel environment
--    variables only. Everything in platform_settings is public.
-- Safe to run more than once.
-- =====================================================================

-- ---------- Public settings (no secrets — platform_settings is public) ----------
alter table public.platform_settings add column if not exists online_payments_enabled boolean not null default false;
alter table public.platform_settings add column if not exists payments_mode text not null default 'sandbox';
alter table public.platform_settings add column if not exists payments_gateway text not null default 'safepay';
alter table public.platform_settings add column if not exists featured_price bigint not null default 0;
alter table public.platform_settings add column if not exists payments_note text not null default '';
do $$ begin alter table public.platform_settings add constraint platform_settings_pay_mode_check check (payments_mode in ('sandbox','production')); exception when duplicate_object then null; end $$;
do $$ begin alter table public.platform_settings add constraint platform_settings_featured_price_check check (featured_price between 0 and 10000000); exception when duplicate_object then null; end $$;

create or replace function public.admin_save_payments(p_on boolean, p_mode text, p_featured bigint, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('finance') then raise exception 'Only RAQBO staff with finance permission can change payment settings.'; end if;
  if p_mode not in ('sandbox','production') then raise exception 'Mode must be sandbox or production.'; end if;
  update public.platform_settings set online_payments_enabled = coalesce(p_on, online_payments_enabled), payments_mode = coalesce(p_mode, payments_mode),
    featured_price = coalesce(p_featured, featured_price), payments_note = left(coalesce(p_note, ''), 300), updated_at = now() where id = 1;
  perform public.audit(case when p_on then 'payments.on' else 'payments.off' end, 'settings', 'payments', '', jsonb_build_object('mode', p_mode, 'featured_price', p_featured));
end $$;
grant execute on function public.admin_save_payments(boolean, text, bigint, text) to authenticated;

alter table public.listing_verifications add column if not exists paid_at timestamptz;

-- ---------- Payments ----------
create table if not exists public.payments (
  id            uuid primary key default gen_random_uuid(),
  ref           text not null unique default ('RQ-PAY-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  purpose       text not null check (purpose in ('verification','auction_deposit','order','service','agent_plan','featured','oa_promotion','quicksell','other')),
  subject_ref   text not null default '' check (char_length(subject_ref) <= 120),
  subject_id    uuid,
  description   text not null default '' check (char_length(description) <= 200),
  amount        bigint not null check (amount > 0 and amount <= 100000000),   -- whole PKR
  currency      text not null default 'PKR' check (currency = 'PKR'),
  status        text not null default 'created' check (status in ('created','pending','paid','failed','cancelled','expired','refunded')),
  gateway       text not null default 'safepay',
  tracker       text unique,                      -- Safepay tracker (track_…)
  gateway_state text not null default '',
  method        text not null default '' check (char_length(method) <= 60),
  gateway_data  jsonb not null default '{}'::jsonb,
  applied       boolean not null default false,   -- the effect (badge, deposit, order…) has been applied
  applied_note  text not null default '',
  fail_reason   text not null default '' check (char_length(fail_reason) <= 300),
  requested_by  uuid references public.profiles (id) on delete set null,  -- admin, for a payment request
  paid_at       timestamptz,
  expires_at    timestamptz not null default (now() + interval '2 hours'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists payments_user_idx on public.payments (user_id, created_at desc);
create index if not exists payments_status_idx on public.payments (status, created_at desc);
create index if not exists payments_subject_idx on public.payments (purpose, subject_ref);
alter table public.payments enable row level security;
drop policy if exists "payments: own or admin" on public.payments;
create policy "payments: own or admin" on public.payments for select using (user_id = auth.uid() or public.has_perm('finance') or public.is_admin());
revoke insert, update, delete on public.payments from anon, authenticated;
grant select on public.payments to authenticated;

-- ---------- What is actually owed (the browser never decides this) ----------
-- Returns {amount, description, subject_id, ok, why}
create or replace function public.pay_quote(p_purpose text, p_subject text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); amt bigint; des text; sid uuid; r record;
begin
  if me is null then return jsonb_build_object('ok', false, 'why', 'Please sign in first.'); end if;
  if p_purpose = 'verification' then
    select v.*, l.title into r from public.listing_verifications v join public.listings l on l.id = v.listing_id where v.listing_id = p_subject::uuid and v.owner_id = me;
    if r.listing_id is null then return jsonb_build_object('ok', false, 'why', 'Verification request not found.'); end if;
    if r.status = 'verified' then return jsonb_build_object('ok', false, 'why', 'This property is already verified.'); end if;
    if coalesce(r.fee, 0) <= 0 then return jsonb_build_object('ok', false, 'why', 'No fee is due for this request.'); end if;
    if r.paid_at is not null then return jsonb_build_object('ok', false, 'why', 'This verification fee is already paid.'); end if;
    amt := r.fee; sid := r.listing_id; des := 'RAQBO Verified — ' || left(coalesce(r.title, ''), 80);
  elsif p_purpose = 'auction_deposit' then
    select b.*, a.deposit, a.ref as aref into r from public.auction_bidders b join public.auctions a on a.id = b.auction_id where b.auction_id = p_subject::uuid and b.user_id = me;
    if r.id is null then return jsonb_build_object('ok', false, 'why', 'Register for this auction first.'); end if;
    if r.deposit_status in ('paid','refunded','forfeited') then return jsonb_build_object('ok', false, 'why', 'The deposit is already recorded.'); end if;
    if coalesce(r.deposit, 0) <= 0 then return jsonb_build_object('ok', false, 'why', 'This auction has no deposit.'); end if;
    amt := r.deposit; sid := r.auction_id; des := 'Auction bidding deposit — ' || coalesce(r.aref, '');
  elsif p_purpose = 'order' then
    select * into r from public.orders where ref = p_subject and buyer_id = me;
    if r.id is null then return jsonb_build_object('ok', false, 'why', 'Order not found.'); end if;
    if r.status not in ('quoted','awaiting_payment') then return jsonb_build_object('ok', false, 'why', 'This order is not waiting for payment.'); end if;
    if coalesce(r.total, 0) <= 0 then return jsonb_build_object('ok', false, 'why', 'This order has no total yet.'); end if;
    amt := r.total::bigint; sid := r.id; des := 'Construction materials — order ' || r.ref;
  elsif p_purpose = 'service' then
    select * into r from public.enquiries where ref = p_subject and user_id = me;
    if r.id is null then return jsonb_build_object('ok', false, 'why', 'Service request not found.'); end if;
    if r.quote_status not in ('sent','accepted') or coalesce(r.quote_amount, 0) <= 0 then return jsonb_build_object('ok', false, 'why', 'There is no quotation to pay on this request.'); end if;
    amt := r.quote_amount; sid := r.id; des := 'RAQBO service — ' || r.ref;
  elsif p_purpose = 'agent_plan' then
    select * into r from public.agent_subscriptions where ref = p_subject and user_id = me;
    if r.id is null then return jsonb_build_object('ok', false, 'why', 'Package request not found.'); end if;
    if r.status <> 'pending' then return jsonb_build_object('ok', false, 'why', 'This package is not waiting for payment.'); end if;
    if coalesce(r.amount, 0) <= 0 then return jsonb_build_object('ok', false, 'why', 'This package is free.'); end if;
    amt := r.amount; sid := r.id; des := 'Agent package — ' || r.ref;
  elsif p_purpose = 'featured' then
    select l.* into r from public.listings l where l.id = p_subject::uuid and l.owner_id = me and l.status = 'published';
    if r.id is null then return jsonb_build_object('ok', false, 'why', 'Published property not found.'); end if;
    if exists (select 1 from public.listing_features f where f.listing_id = r.id and f.until > now()) then return jsonb_build_object('ok', false, 'why', 'This property is already featured.'); end if;
    select featured_price into amt from public.platform_settings where id = 1;
    if coalesce(amt, 0) <= 0 then return jsonb_build_object('ok', false, 'why', 'Featured listings are not on sale right now.'); end if;
    sid := r.id; des := 'Featured listing (30 days) — ' || left(coalesce(r.title, ''), 70);
  elsif p_purpose = 'oa_promotion' then
    select p.* into r from public.oa_promotions p where p.ref = p_subject and p.institution_id in (select public.oa_my_institutions());
    if r.id is null then return jsonb_build_object('ok', false, 'why', 'Advertising invoice not found.'); end if;
    if r.status in ('paid','active','ended','cancelled') then return jsonb_build_object('ok', false, 'why', 'This invoice is already settled.'); end if;
    if coalesce(r.amount, 0) <= 0 then return jsonb_build_object('ok', false, 'why', 'This advertisement is free.'); end if;
    amt := r.amount; des := 'Official auction advertising — ' || coalesce(r.invoice_no, r.ref);
  else
    return jsonb_build_object('ok', false, 'why', 'This payment is created by RAQBO. Open the payment link RAQBO sent you.');
  end if;
  return jsonb_build_object('ok', true, 'amount', amt, 'description', des, 'subject_id', sid);
exception when others then return jsonb_build_object('ok', false, 'why', 'This item could not be found.');
end $$;
grant execute on function public.pay_quote(text, text) to authenticated;

-- ---------- Member starts a payment ----------
drop function if exists public.pay_start(text, text);
create or replace function public.pay_start(p_purpose text, p_subject text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); q jsonb; p public.payments; s record;
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  select online_payments_enabled, payments_mode into s from public.platform_settings where id = 1;
  if not coalesce(s.online_payments_enabled, false) then raise exception 'Online payment is not switched on yet. Please pay by bank transfer — the details are on the payment screen.'; end if;
  if (select count(*) from public.payments where user_id = me and created_at > now() - interval '1 hour') >= 20 then raise exception 'Too many payment attempts in the last hour. Please try again later.'; end if;
  q := public.pay_quote(p_purpose, p_subject);
  if not (q ->> 'ok')::boolean then raise exception '%', q ->> 'why'; end if;
  -- never let the same thing be paid for twice
  if exists (select 1 from public.payments where user_id = me and purpose = p_purpose and subject_ref = p_subject and status = 'paid') then
    raise exception 'You have already paid for this. Open My RAQBO → Payments to see the receipt.';
  end if;
  -- reuse an unfinished payment for the same thing instead of making a new one
  select * into p from public.payments where user_id = me and purpose = p_purpose and subject_ref = p_subject
    and status in ('created','pending') and expires_at > now() and amount = (q ->> 'amount')::bigint order by created_at desc limit 1;
  if p.id is not null then
    update public.payments set updated_at = now(), expires_at = now() + interval '2 hours' where id = p.id returning * into p;
    return jsonb_build_object('ref', p.ref, 'amount', p.amount, 'description', p.description, 'status', p.status, 'tracker', p.tracker);
  end if;
  insert into public.payments (user_id, purpose, subject_ref, subject_id, description, amount)
  values (me, p_purpose, p_subject, nullif(q ->> 'subject_id', '')::uuid, q ->> 'description', (q ->> 'amount')::bigint)
  returning * into p;
  return jsonb_build_object('ref', p.ref, 'amount', p.amount, 'description', p.description, 'status', p.status, 'tracker', null);
end $$;
grant execute on function public.pay_start(text, text) to authenticated;

-- ---------- Admin asks a member to pay (QuickSell commission, anything else) ----------
create or replace function public.pay_request(p_user uuid, p_purpose text, p_subject text, p_amount bigint, p_description text)
returns text language plpgsql security definer set search_path = public as $$
declare p public.payments;
begin
  if not public.has_perm('finance') then raise exception 'Only RAQBO staff with finance permission can request a payment.'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter the amount.'; end if;
  if char_length(btrim(coalesce(p_description, ''))) < 3 then raise exception 'Say what the payment is for.'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Member not found.'; end if;
  insert into public.payments (user_id, purpose, subject_ref, description, amount, requested_by, expires_at)
  values (p_user, coalesce(nullif(p_purpose, ''), 'other'), coalesce(p_subject, ''), btrim(p_description), p_amount, auth.uid(), now() + interval '14 days')
  returning * into p;
  perform public.notify(p_user, 'system', 'Payment requested: ' || left(p.description, 100), 'RAQBO has asked for a payment of Rs ' || p.amount || '. Open My RAQBO → Payments to pay online or by bank transfer.', '#my/payments');
  perform public.audit('payment.request', 'payment', p.ref, p.description, jsonb_build_object('amount', p.amount));
  return p.ref;
end $$;
grant execute on function public.pay_request(uuid, text, text, bigint, text) to authenticated;

create or replace function public.pay_cancel(p_ref text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.payments set status = 'cancelled', updated_at = now()
   where ref = p_ref and (user_id = auth.uid() or public.has_perm('finance')) and status in ('created','pending');
  if not found then raise exception 'This payment cannot be cancelled.'; end if;
end $$;
grant execute on function public.pay_cancel(text) to authenticated;

-- ---------- Apply the effect of a successful payment (idempotent) ----------
create or replace function public.pay_apply(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare p public.payments; note text := ''; r record;
begin
  select * into p from public.payments where id = p_id for update;
  if p.id is null then return 'not found'; end if;
  if p.status <> 'paid' then return 'not paid'; end if;
  if p.applied then return 'already applied'; end if;

  if p.purpose = 'verification' then
    update public.listing_verifications set payment_method = 'online', txn_id = p.ref, paid_at = coalesce(paid_at, p.paid_at)
     where listing_id = p.subject_id and status = 'submitted';
    note := 'Verification fee received — waiting for the document check.';
  elsif p.purpose = 'auction_deposit' then
    update public.auction_bidders set deposit_status = 'paid', deposit_ref = p.ref, deposit_at = p.paid_at, status = case when status = 'pending' then 'approved' else status end
     where auction_id = p.subject_id and user_id = p.user_id;
    note := 'Deposit received — you can bid in this auction.';
  elsif p.purpose = 'order' then
    update public.orders set status = 'paid_escrow', payment_ref = p.ref where id = p.subject_id and status in ('quoted','awaiting_payment','payment_review');
    note := 'Payment received and held by RAQBO until delivery.';
  elsif p.purpose = 'service' then
    update public.enquiries set quote_status = 'accepted', status = 'in_progress', updated_at = now() where id = p.subject_id;
    note := 'Payment received — RAQBO will start the work.';
  elsif p.purpose = 'agent_plan' then
    update public.agent_subscriptions set status = 'active', txn_id = p.ref,
      starts_at = coalesce(starts_at, now()), ends_at = coalesce(ends_at, now() + (coalesce(months, 1) || ' months')::interval)
     where id = p.subject_id and status = 'pending';
    note := 'Package activated.';
  elsif p.purpose = 'featured' then
    insert into public.listing_features (listing_id, until, source, created_by) values (p.subject_id, now() + interval '30 days', 'paid', p.user_id)
      on conflict (listing_id) do update set until = greatest(public.listing_features.until, now()) + interval '30 days', source = 'paid';
    note := 'Property featured for 30 days.';
  elsif p.purpose = 'oa_promotion' then
    update public.oa_promotions set status = 'paid', paid_at = coalesce(paid_at, p.paid_at),
      invoice_no = coalesce(invoice_no, 'RQ-INV-OA-' || to_char(now() at time zone 'Asia/Karachi', 'YYMM') || '-' || lpad(id::text, 4, '0')), updated_at = now()
     where ref = p.subject_ref and status in ('quoted','invoiced');
    note := 'Advertising invoice paid.';
  else
    note := 'Payment received.';
  end if;

  -- every online payment is income in Revenue & expenses (refunds are recorded separately)
  if not exists (select 1 from public.finance_entries where ref = p.ref) then
    insert into public.finance_entries (kind, category, amount, note, ref, created_by)
    values ('income', case p.purpose when 'verification' then 'Verification fees' when 'auction_deposit' then 'Auction deposits (refundable)' when 'order' then 'Construction material orders'
      when 'service' then 'Service fees' when 'agent_plan' then 'Agent packages' when 'featured' then 'Featured listings'
      when 'oa_promotion' then 'Official auction advertising' when 'quicksell' then 'QuickSell commission' else 'Other online payments' end,
      p.amount, left(p.description, 300), p.ref, p.user_id);
  end if;

  update public.payments set applied = true, applied_note = note, updated_at = now() where id = p.id;
  perform public.notify(p.user_id, 'system', 'Payment received — Rs ' || p.amount, left(p.description || ' · ' || note, 400), '#my/payments');
  perform public.audit('payment.paid', 'payment', p.ref, p.description, jsonb_build_object('amount', p.amount, 'purpose', p.purpose, 'tracker', p.tracker));
  return note;
end $$;
revoke all on function public.pay_apply(uuid) from public, anon, authenticated;

-- ---------- The RAQBO server settles a payment (never the browser) ----------
-- Called only by the Vercel function after it has asked Safepay directly.
create or replace function public.pay_settle(p_ref text, p_tracker text, p_paid boolean, p_state text, p_method text, p_data jsonb, p_reason text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.payments; note text;
begin
  select * into p from public.payments where ref = p_ref or (p_tracker is not null and tracker = p_tracker) for update;
  if p.id is null then return jsonb_build_object('ok', false, 'why', 'Payment not found.'); end if;
  if p.status = 'paid' then
    if not p.applied then note := public.pay_apply(p.id); end if;
    return jsonb_build_object('ok', true, 'ref', p.ref, 'status', 'paid', 'already', true);
  end if;
  if p.status = 'refunded' then return jsonb_build_object('ok', true, 'ref', p.ref, 'status', 'refunded'); end if;
  update public.payments set
    tracker = coalesce(p_tracker, tracker), gateway_state = left(coalesce(p_state, ''), 60), method = left(coalesce(p_method, ''), 60),
    gateway_data = coalesce(p_data, gateway_data),
    status = case when p_paid then 'paid' else 'failed' end,
    paid_at = case when p_paid then now() else paid_at end,
    fail_reason = case when p_paid then '' else left(coalesce(p_reason, 'The payment was not completed.'), 300) end,
    updated_at = now()
  where id = p.id returning * into p;
  if p_paid then note := public.pay_apply(p.id); end if;
  return jsonb_build_object('ok', true, 'ref', p.ref, 'status', p.status, 'note', coalesce(note, ''));
end $$;
revoke all on function public.pay_settle(text, text, boolean, text, text, jsonb, text) from public, anon, authenticated;

-- The server records the Safepay tracker as soon as the checkout is created
create or replace function public.pay_set_tracker(p_ref text, p_tracker text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.payments set tracker = p_tracker, status = case when status = 'created' then 'pending' else status end, updated_at = now()
   where ref = p_ref and status in ('created','pending');
  if not found then raise exception 'Payment not found or already finished.'; end if;
end $$;
revoke all on function public.pay_set_tracker(text, text) from public, anon, authenticated;

-- ---------- Members ----------
create or replace function public.pay_mine()
returns setof public.payments language sql stable security definer set search_path = public as $$
  select * from public.payments where user_id = auth.uid() order by created_at desc limit 200 $$;
grant execute on function public.pay_mine() to authenticated;

-- What the member still owes, in one list
create or replace function public.pay_due()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select 'verification' as purpose, v.listing_id::text as subject_ref, v.fee as amount, 'RAQBO Verified — ' || left(l.title, 60) as description
      from public.listing_verifications v join public.listings l on l.id = v.listing_id
     where v.owner_id = auth.uid() and v.status = 'submitted' and v.fee > 0 and v.paid_at is null
    union all
    select 'auction_deposit', b.auction_id::text, a.deposit, 'Auction deposit — ' || a.ref
      from public.auction_bidders b join public.auctions a on a.id = b.auction_id
     where b.user_id = auth.uid() and b.deposit_status in ('awaiting','submitted') and a.deposit > 0
    union all
    select 'order', o.ref, o.total::bigint, 'Materials order ' || o.ref from public.orders o
     where o.buyer_id = auth.uid() and o.status in ('quoted','awaiting_payment') and coalesce(o.total, 0) > 0
    union all
    select 'service', e.ref, e.quote_amount, 'Service quotation ' || e.ref from public.enquiries e
     where e.user_id = auth.uid() and e.quote_status = 'sent' and coalesce(e.quote_amount, 0) > 0
    union all
    select 'agent_plan', s.ref, s.amount, 'Agent package ' || s.ref from public.agent_subscriptions s
     where s.user_id = auth.uid() and s.status = 'pending' and s.amount > 0
    union all
    select p.purpose, p.ref, p.amount, p.description from public.payments p
     where p.user_id = auth.uid() and p.requested_by is not null and p.status in ('created','pending') and p.expires_at > now()
  ) x $$;
grant execute on function public.pay_due() to authenticated;

-- ---------- Admin ----------
create or replace function public.pay_admin_list(p_status text default '', p_days int default 90)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_perm('finance') or public.is_admin()) then raise exception 'Only RAQBO staff can see payments.'; end if;
  return coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object('who', (select coalesce(nullif(full_name, ''), email) from public.profiles where id = p.user_id)) order by p.created_at desc)
    from public.payments p where p.created_at > now() - make_interval(days => greatest(1, p_days)) and (p_status = '' or p.status = p_status)), '[]'::jsonb);
end $$;
grant execute on function public.pay_admin_list(text, int) to authenticated;

create or replace function public.pay_admin_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m0 date := date_trunc('month', (now() at time zone 'Asia/Karachi'))::date;
begin
  if not (public.has_perm('finance') or public.is_admin()) then raise exception 'Only RAQBO staff can see payments.'; end if;
  return jsonb_build_object(
    'paid_month', (select coalesce(sum(amount), 0) from public.payments where status = 'paid' and paid_at >= m0),
    'paid_month_n', (select count(*) from public.payments where status = 'paid' and paid_at >= m0),
    'pending_n', (select count(*) from public.payments where status in ('created','pending') and expires_at > now()),
    'failed_7d', (select count(*) from public.payments where status = 'failed' and created_at > now() - interval '7 days'),
    'unapplied', (select count(*) from public.payments where status = 'paid' and not applied),
    'by_purpose', coalesce((select jsonb_agg(x) from (select purpose as k, count(*) as n, sum(amount) as total from public.payments where status = 'paid' group by 1 order by 3 desc) x), '[]'::jsonb));
end $$;
grant execute on function public.pay_admin_stats() to authenticated;

-- Admin repairs a payment that Safepay confirmed but the website missed
create or replace function public.pay_admin_reapply(p_ref text)
returns text language plpgsql security definer set search_path = public as $$
declare p public.payments;
begin
  if not public.has_perm('finance') then raise exception 'Only RAQBO staff with finance permission can do this.'; end if;
  select * into p from public.payments where ref = p_ref;
  if p.id is null then raise exception 'Payment not found.'; end if;
  if p.status <> 'paid' then raise exception 'Only a paid payment can be applied.'; end if;
  return public.pay_apply(p.id);
end $$;
grant execute on function public.pay_admin_reapply(text) to authenticated;

-- Refund an online payment: records it in the existing refunds register
create or replace function public.pay_admin_refund(p_ref text, p_reason text)
returns text language plpgsql security definer set search_path = public as $$
declare p public.payments; r text;
begin
  if not public.has_perm('finance') then raise exception 'Only RAQBO staff with finance permission can refund.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Give the reason for the refund.'; end if;
  select * into p from public.payments where ref = p_ref for update;
  if p.id is null then raise exception 'Payment not found.'; end if;
  if p.status <> 'paid' then raise exception 'Only a paid payment can be refunded.'; end if;
  r := public.admin_add_refund(case p.purpose when 'order' then 'order' when 'auction_deposit' then 'auction' when 'service' then 'service' when 'quicksell' then 'quicksell' else 'payment' end,
    p.ref, coalesce((select coalesce(nullif(full_name, ''), email) from public.profiles where id = p.user_id), 'Member'), p.amount, 'online', p_reason, null);
  update public.payments set status = 'refunded', updated_at = now() where id = p.id;
  perform public.notify(p.user_id, 'system', 'Refund started — Rs ' || p.amount, left(p.description || ' · ' || p_reason, 400), '#my/payments');
  perform public.audit('payment.refund', 'payment', p.ref, p_reason, jsonb_build_object('amount', p.amount, 'refund_ref', r));
  return r;
end $$;
grant execute on function public.pay_admin_refund(text, text) to authenticated;

-- Payments nobody finished are tidied up so they do not sit as "pending" for ever
create or replace function public.pay_expire()
returns int language sql security definer set search_path = public as $$
  with x as (update public.payments set status = 'expired', updated_at = now()
    where status in ('created','pending') and expires_at < now() - interval '1 hour' returning 1) select count(*)::int from x $$;
grant execute on function public.pay_expire() to anon, authenticated;

-- Dashboard figure
create or replace function public.admin_kpis_v5()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare base jsonb; m0 date := date_trunc('month', (now() at time zone 'Asia/Karachi'))::date;
begin
  base := public.admin_kpis_v4();
  return base || jsonb_build_object(
    'online_paid_month', (select coalesce(sum(amount), 0) from public.payments where status = 'paid' and paid_at >= m0),
    'online_pending', (select count(*) from public.payments where status in ('created','pending') and expires_at > now()));
end $$;
grant execute on function public.admin_kpis_v5() to authenticated;
