-- ---------- 15. Notifications (bell), chat, WhatsApp order updates ----------
-- Safe to run more than once. Needs update_5 (marketplace) and update_8 (order emails) first.

-- ===== Notifications =====
create table if not exists public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null check (kind in ('order','listing','review','message','system')),
  title      text not null check (char_length(title) <= 160),
  body       text not null default '' check (char_length(body) <= 400),
  link       text not null default '' check (char_length(link) <= 300),
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index if not exists notifications_user_idx on public.notifications (user_id, id desc);
alter table public.notifications enable row level security;
drop policy if exists "notifications: read own" on public.notifications;
create policy "notifications: read own" on public.notifications for select using (user_id = auth.uid());
drop policy if exists "notifications: mark own read" on public.notifications;
create policy "notifications: mark own read" on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.notifications from authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create or replace function public.notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public
as $$ insert into public.notifications (user_id, kind, title, body, link)
      select p_user, p_kind, left(p_title, 160), left(coalesce(p_body, ''), 400), left(coalesce(p_link, ''), 300) where p_user is not null $$;
revoke all on function public.notify(uuid, text, text, text, text) from public, anon, authenticated;

-- Admins (for RAQBO-team items)
create or replace function public.notify_admins(p_kind text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public
as $$ select public.notify(id, p_kind, p_title, p_body, p_link) from public.profiles where role = 'admin' $$;
revoke all on function public.notify_admins(text, text, text, text) from public, anon, authenticated;

-- Order status → buyer (every step) and vendor (steps they act on)
create or replace function public.notify_order_event()
returns trigger language plpgsql security definer set search_path = public
as $$
declare o public.orders; v public.vendors; first_event boolean; t_buyer text; t_vendor text; link text;
begin
  select * into o from public.orders where id = new.order_id; if o.id is null then return new; end if;
  select * into v from public.vendors where id = o.vendor_id;
  first_event := not exists (select 1 from public.order_events where order_id = o.id and id < new.id);
  link := '#marketplace/order/' || o.id;
  t_buyer := case
    when first_event and new.status = 'quote_requested' then 'Quote request sent to ' || v.shop_name
    when first_event then 'Order placed — pay into RAQBO escrow'
    when new.status = 'quoted' then 'Quote received from ' || v.shop_name
    when new.status = 'awaiting_payment' and new.actor = 'admin' then 'Payment could not be verified — upload again'
    when new.status = 'awaiting_payment' then 'Quote accepted — pay into RAQBO escrow'
    when new.status = 'payment_review' then 'Payment received — RAQBO is verifying it'
    when new.status = 'paid_escrow' then 'Payment confirmed and held in escrow'
    when new.status = 'dispatched' then 'Your order is on the way'
    when new.status = 'delivered' then 'Delivered — please confirm receipt'
    when new.status = 'completed' then 'Order completed — thank you'
    when new.status = 'released' then 'Order closed — vendor paid'
    when new.status = 'disputed' then 'Dispute opened'
    when new.status = 'refunded' then 'Refund issued'
    when new.status = 'cancelled' and new.actor = 'vendor' then v.shop_name || ' declined your order'
    when new.status = 'cancelled' then 'Order cancelled'
    else 'Order update' end;
  perform public.notify(o.buyer_id, 'order', t_buyer || ' · ' || o.ref, new.note, link);
  t_vendor := case
    when first_event and new.status = 'quote_requested' then 'New quote request from ' || o.buyer_name
    when first_event then 'New order from ' || o.buyer_name
    when new.status = 'awaiting_payment' and new.actor = 'buyer' then 'Your quote was accepted'
    when new.status = 'paid_escrow' then 'Payment secured — dispatch now'
    when new.status = 'completed' then 'Buyer confirmed delivery — payout pending'
    when new.status = 'released' then 'Payout released'
    when new.status = 'disputed' then 'Buyer opened a dispute'
    when new.status = 'refunded' then 'Order refunded to buyer'
    when new.status = 'cancelled' and new.actor = 'buyer' then 'Buyer cancelled the order'
    else null end;
  if t_vendor is not null and v.owner_id is not null then perform public.notify(v.owner_id, 'order', t_vendor || ' · ' || o.ref, new.note, link); end if;
  if new.status in ('payment_review', 'disputed') or (new.status = 'completed') then
    perform public.notify_admins('order', case new.status when 'payment_review' then 'Payment screenshot to verify' when 'disputed' then 'Dispute to resolve' else 'Payout to release' end || ' · ' || o.ref, v.shop_name || ' · ' || o.buyer_name, '#admin');
  end if;
  return new;
exception when others then raise warning 'notify_order_event: %', sqlerrm; return new;
end $$;
revoke all on function public.notify_order_event() from public, anon, authenticated;
drop trigger if exists order_events_notify on public.order_events;
create trigger order_events_notify after insert on public.order_events for each row execute function public.notify_order_event();

-- Listing approved / rejected → owner
create or replace function public.notify_listing_status()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.status is distinct from old.status and new.owner_id is not null then
    if new.status = 'published' then perform public.notify(new.owner_id, 'listing', 'Your listing is live: ' || new.title, 'Approved by the RAQBO team · ' || new.ref, '#property/' || new.id);
    elsif new.status = 'rejected' then perform public.notify(new.owner_id, 'listing', 'Your listing needs changes: ' || new.title, coalesce(nullif(new.review_note, ''), 'See the note in My account'), '#account');
    end if;
  end if;
  return new;
exception when others then raise warning 'notify_listing_status: %', sqlerrm; return new;
end $$;
revoke all on function public.notify_listing_status() from public, anon, authenticated;
drop trigger if exists listings_notify_status on public.listings;
create trigger listings_notify_status after update of status on public.listings for each row execute function public.notify_listing_status();

-- New review → listing owner
create or replace function public.notify_new_review()
returns trigger language plpgsql security definer set search_path = public
as $$
declare l public.listings;
begin
  select * into l from public.listings where id = new.listing_id;
  if l.owner_id is not null and l.owner_id <> new.user_id then
    perform public.notify(l.owner_id, 'review', repeat('★', new.rating) || ' New review on ' || l.title, left(new.comment, 200), '#property/' || l.id);
  end if;
  return new;
exception when others then raise warning 'notify_new_review: %', sqlerrm; return new;
end $$;
revoke all on function public.notify_new_review() from public, anon, authenticated;
drop trigger if exists reviews_notify_owner on public.reviews;
create trigger reviews_notify_owner after insert on public.reviews for each row execute function public.notify_new_review();

-- ===== Chat (buyer ↔ advertiser / shop / RAQBO team) =====
create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  starter_id      uuid not null references public.profiles (id) on delete cascade,
  other_id        uuid references public.profiles (id) on delete cascade,      -- null = RAQBO team (admins answer)
  listing_id      uuid references public.listings (id) on delete set null,
  vendor_id       uuid references public.vendors (id) on delete set null,
  order_id        uuid references public.orders (id) on delete set null,
  subject         text not null default '' check (char_length(subject) <= 160),
  starter_name    text not null default '',
  other_name      text not null default '',
  last_message_at timestamptz not null default now(),
  last_preview    text not null default '',
  last_sender     uuid,
  created_at      timestamptz not null default now()
);
create unique index if not exists conversations_unique_topic on public.conversations (starter_id, coalesce(other_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(listing_id, vendor_id, order_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists conversations_starter_idx on public.conversations (starter_id, last_message_at desc);
create index if not exists conversations_other_idx on public.conversations (other_id, last_message_at desc);

create table if not exists public.messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body            text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at      timestamptz not null default now(),
  read_at         timestamptz
);
create index if not exists messages_conversation_idx on public.messages (conversation_id, id);

create or replace function public.is_participant(p_conv uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.conversations c where c.id = p_conv
        and (c.starter_id = auth.uid() or c.other_id = auth.uid() or (c.other_id is null and public.is_admin()))) $$;

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
drop policy if exists "conversations: participants read" on public.conversations;
create policy "conversations: participants read" on public.conversations for select
  using (starter_id = auth.uid() or other_id = auth.uid() or (other_id is null and public.is_admin()));
drop policy if exists "messages: participants read" on public.messages;
create policy "messages: participants read" on public.messages for select using (public.is_participant(conversation_id));
drop policy if exists "messages: participants send" on public.messages;
create policy "messages: participants send" on public.messages for insert
  with check (sender_id = auth.uid() and public.is_participant(conversation_id) and public.is_verified_user());
grant select on public.conversations to authenticated;
grant select, insert on public.messages to authenticated;
grant usage on all sequences in schema public to authenticated;

-- Start (or re-open) a conversation about a property, a shop or an order
create or replace function public.start_conversation(p_listing uuid default null, p_vendor uuid default null, p_order uuid default null)
returns uuid language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); other uuid; subj text; cid uuid; l public.listings; v public.vendors; o public.orders; my_name text; other_name text;
begin
  if me is null or not public.is_verified_user() then raise exception 'Please sign in to send messages.'; end if;
  select coalesce(nullif(full_name, ''), 'RAQBO member') into my_name from public.profiles where id = me;
  if p_listing is not null then
    select * into l from public.listings where id = p_listing and (status = 'published' or owner_id = me);
    if l.id is null then raise exception 'This property is not available.'; end if;
    other := l.owner_id; subj := l.title || ' · ' || l.ref;
    if other = me then raise exception 'This is your own listing.'; end if;
  elsif p_vendor is not null then
    select * into v from public.vendors where id = p_vendor and (status = 'approved' or owner_id = me);
    if v.id is null then raise exception 'This shop is not available.'; end if;
    other := v.owner_id; subj := v.shop_name;
    if other = me then raise exception 'This is your own shop.'; end if;
  elsif p_order is not null then
    select * into o from public.orders where id = p_order; if o.id is null then raise exception 'Order not found.'; end if;
    select * into v from public.vendors where id = o.vendor_id;
    if o.buyer_id = me then other := v.owner_id; elsif v.owner_id = me then other := o.buyer_id; elsif public.is_admin() then other := o.buyer_id; else raise exception 'This is not your order.'; end if;
    subj := 'Order ' || o.ref || ' · ' || v.shop_name;
  else
    other := null; subj := 'RAQBO support';
  end if;
  select coalesce(nullif(full_name, ''), 'RAQBO member') into other_name from public.profiles where id = other;
  select id into cid from public.conversations
   where starter_id = me and other_id is not distinct from other
     and coalesce(listing_id, vendor_id, order_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_listing, p_vendor, p_order, '00000000-0000-0000-0000-000000000000'::uuid);
  if cid is null then
    -- the other side may have started the same thread (e.g. vendor ↔ buyer on an order)
    select id into cid from public.conversations where order_id = p_order and p_order is not null and starter_id = other and other_id = me;
  end if;
  if cid is null then
    insert into public.conversations (starter_id, other_id, listing_id, vendor_id, order_id, subject, starter_name, other_name)
    values (me, other, p_listing, p_vendor, p_order, left(subj, 160), my_name, coalesce(other_name, 'RAQBO team')) returning id into cid;
  end if;
  return cid;
end $$;
grant execute on function public.start_conversation(uuid, uuid, uuid) to authenticated;

-- Mark messages from the other side as read
create or replace function public.mark_conversation_read(p_conv uuid)
returns void language sql security definer set search_path = public
as $$ update public.messages set read_at = now() where conversation_id = p_conv and sender_id <> auth.uid() and read_at is null and public.is_participant(p_conv) $$;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- New message: spam guard, update the thread, notify the other side
create or replace function public.messages_before_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  new.sender_id := auth.uid(); new.created_at := now(); new.read_at := null; new.body := btrim(new.body);
  if (select count(*) from public.messages where sender_id = auth.uid() and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'You are sending messages too quickly. Please wait a minute.';
  end if;
  return new;
end $$;
drop trigger if exists messages_before_insert on public.messages;
create trigger messages_before_insert before insert on public.messages for each row execute function public.messages_before_insert();

create or replace function public.messages_after_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
declare c public.conversations; sender_name text; target uuid;
begin
  update public.conversations set last_message_at = new.created_at, last_preview = left(new.body, 120), last_sender = new.sender_id
   where id = new.conversation_id returning * into c;
  select coalesce(nullif(full_name, ''), 'RAQBO member') into sender_name from public.profiles where id = new.sender_id;
  if public.is_admin() and c.other_id is null and new.sender_id <> c.starter_id then sender_name := 'RAQBO team'; end if;
  target := case when new.sender_id = c.starter_id then c.other_id else c.starter_id end;
  -- one unread "message" notification per thread is enough
  if target is null then
    if not exists (select 1 from public.notifications n join public.profiles p on p.id = n.user_id and p.role = 'admin'
                   where n.kind = 'message' and n.link = '#messages/' || c.id and n.read_at is null) then
      perform public.notify_admins('message', 'New message from ' || sender_name, left(new.body, 160), '#messages/' || c.id);
    end if;
  elsif not exists (select 1 from public.notifications where user_id = target and kind = 'message' and link = '#messages/' || c.id and read_at is null) then
    perform public.notify(target, 'message', 'New message from ' || sender_name, c.subject || ' — ' || left(new.body, 140), '#messages/' || c.id);
  end if;
  return new;
end $$;
drop trigger if exists messages_after_insert on public.messages;
create trigger messages_after_insert after insert on public.messages for each row execute function public.messages_after_insert();

-- ===== WhatsApp order updates: the phone number goes along with each queued order email =====
alter table public.email_outbox add column if not exists to_phone text not null default '';
create or replace function public.email_outbox_add_phone()
returns trigger language plpgsql security definer set search_path = public
as $$
declare ph text;
begin
  if new.audience = 'buyer' then select p.phone into ph from public.orders o join public.profiles p on p.id = o.buyer_id where o.id = new.order_id;
  elsif new.audience = 'vendor' then select coalesce(v.whatsapp, v.phone) into ph from public.orders o join public.vendors v on v.id = o.vendor_id where o.id = new.order_id and v.owner_id is not null;
  end if;
  new.to_phone := coalesce(regexp_replace(coalesce(ph, ''), '[^0-9]', '', 'g'), '');
  if new.to_phone like '03%' then new.to_phone := '92' || substr(new.to_phone, 2); end if;
  return new;
exception when others then new.to_phone := ''; return new;
end $$;
revoke all on function public.email_outbox_add_phone() from public, anon, authenticated;
drop trigger if exists email_outbox_add_phone on public.email_outbox;
create trigger email_outbox_add_phone before insert on public.email_outbox for each row execute function public.email_outbox_add_phone();

-- Real-time: bell + chat update live
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['notifications', 'messages', 'conversations'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------- 16. Map pins for properties ----------
-- Optional exact location chosen by the advertiser on the map (inside Pakistan only).
alter table public.listings add column if not exists lat numeric(9,6);
alter table public.listings add column if not exists lng numeric(9,6);
alter table public.listings drop constraint if exists listings_latlng_pk;
alter table public.listings add constraint listings_latlng_pk check (
  (lat is null and lng is null) or (lat between 23.5 and 37.2 and lng between 60.8 and 77.9));
