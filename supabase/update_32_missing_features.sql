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
