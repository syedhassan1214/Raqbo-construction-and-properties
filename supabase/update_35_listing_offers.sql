-- Normal property offers and authorised buyer/seller conversations.
-- Run after the existing updates. Auction bids remain in the auction workflow.

create or replace function public.make_offer(p_listing uuid, p_amount bigint, p_conditions text)
returns text language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); l public.listings; src text; no int; o public.offers_deal; days int;
begin
  if me is null or not public.is_verified_user() then raise exception 'Please sign in to make an offer.'; end if;
  select * into l from public.listings where id = p_listing and status = 'published' for update;
  if l.id is null or l.sale_mode not in ('normal', 'urgent') or l.availability in ('sold', 'rented') then raise exception 'This property is not available for offers.'; end if;
  if l.owner_id is null then raise exception 'This property cannot receive offers until an advertiser is assigned.'; end if;
  if l.owner_id = me then raise exception 'You cannot make an offer on your own property.'; end if;
  if l.channel = 'private' or (l.channel = 'investors' and not public.is_approved_investor()) then raise exception 'This opportunity is only open to approved RAQBO investors.'; end if;
  if l.sale_mode = 'urgent' and not exists (
    select 1 from public.urgent_requests where listing_id = l.id and stage not in ('sold', 'closed', 'rejected')
  ) then raise exception 'This QuickSell request is no longer open.'; end if;
  if coalesce(p_amount, 0) < 1000 then raise exception 'Enter your offer in rupees.'; end if;
  if (select count(*) from public.offers_deal where buyer_id = me and created_at > now() - interval '1 day') >= 10 then raise exception 'You can make up to 10 offers a day.'; end if;
  if exists (select 1 from public.offers_deal where listing_id = l.id and buyer_id = me and status in ('submitted','countered') and (expires_at is null or expires_at > now())) then raise exception 'You already have an open offer on this property. Revise or withdraw it in My RAQBO → Offers.'; end if;
  src := case when public.is_approved_investor() then 'investor' else 'public' end;
  select coalesce(max(buyer_no), 0) into no from public.offers_deal where listing_id = l.id and buyer_id = me;
  if no = 0 then select coalesce(max(buyer_no), 0) + 1 into no from public.offers_deal where listing_id = l.id; end if;
  select offer_valid_days into days from public.platform_settings where id = 1;
  if days is null then raise exception 'Offer settings are not configured. Please contact RAQBO.'; end if;
  insert into public.offers_deal (listing_id, buyer_id, buyer_no, source, amount, conditions, expires_at)
  values (l.id, me, no, src, p_amount, left(btrim(coalesce(p_conditions, '')), 1000), now() + make_interval(days => days)) returning * into o;
  if l.sale_mode = 'urgent' then
    update public.urgent_requests set stage = 'offer_received', updated_at = now() where listing_id = l.id and stage in ('submitted','under_review','documents_checked','market_assessment','matching');
    perform public.deal_event(l.id, 'offer', null, 'Offer of Rs ' || to_char(p_amount, 'FM999,999,999,999') || ' from ' || case src when 'investor' then 'Investor ' else 'Buyer ' end || no, 'buyer');
    perform public.notify_admins('deal', 'Offer on ' || l.ref, 'Rs ' || to_char(p_amount, 'FM999,999,999,999') || ' · ' || src || ' · ' || left(l.title, 80), '#admin/urgent');
  end if;
  perform public.notify(l.owner_id, 'deal', 'New offer: Rs ' || to_char(p_amount, 'FM999,999,999,999'), left(l.title, 100) || ' · ' || case src when 'investor' then 'RAQBO investor ' else 'Buyer ' end || no || '. Review it in My RAQBO → Offers.', '#my/offers');
  return o.ref;
end $$;
grant execute on function public.make_offer(uuid, bigint, text) to authenticated;

-- Serialise offer decisions per listing, including buyer acceptance of a counter.
create or replace function public.respond_offer(p_offer uuid, p_action text, p_amount bigint, p_note text)
returns void language plpgsql security definer set search_path = public
as $$
declare o public.offers_deal; l public.listings; by_admin boolean;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  select * into o from public.offers_deal where id = p_offer;
  if o.id is null then raise exception 'Offer not found.'; end if;
  select * into l from public.listings where id = o.listing_id for update;
  select * into o from public.offers_deal where id = p_offer;
  by_admin := l.sale_mode = 'urgent' and coalesce(public.has_perm('urgent'), false) and l.owner_id is distinct from auth.uid();
  if l.owner_id is distinct from auth.uid() and not by_admin then raise exception 'Only the seller can respond to this offer.'; end if;
  if o.status not in ('submitted','countered') then raise exception 'This offer is already closed.'; end if;
  if o.expires_at is not null and o.expires_at <= now() then raise exception 'This offer has expired.'; end if;
  if p_action in ('accept','counter') and (l.status <> 'published' or l.sale_mode not in ('normal','urgent') or l.availability in ('sold','rented')) then raise exception 'This property is not available for offers.'; end if;
  if p_action = 'accept' then
    update public.offers_deal set status = 'accepted', response_note = left(coalesce(p_note, ''), 600), updated_at = now() where id = o.id;
    update public.offers_deal set status = 'rejected', response_note = 'The seller accepted another offer.', updated_at = now() where listing_id = o.listing_id and id <> o.id and status in ('submitted','countered');
    update public.urgent_requests set stage = 'agreement', stage_note = 'Offer accepted subject to documents, payment and the final agreement.', updated_at = now() where listing_id = o.listing_id;
    perform public.deal_event(o.listing_id, 'stage', 'agreement', 'Offer ' || o.ref || ' accepted — subject to the final agreement', case when by_admin then 'raqbo' else 'owner' end);
    if l.sale_mode = 'urgent' then perform public.notify_admins('deal', 'Offer accepted: ' || l.ref, 'Rs ' || to_char(o.amount, 'FM999,999,999,999') || ' · arrange the agreement', '#admin/urgent'); end if;
  elsif p_action = 'reject' then
    update public.offers_deal set status = 'rejected', response_note = left(coalesce(p_note, ''), 600), updated_at = now() where id = o.id;
    perform public.deal_event(o.listing_id, 'offer', null, 'Offer ' || o.ref || ' declined', case when by_admin then 'raqbo' else 'owner' end);
  elsif p_action = 'counter' then
    if coalesce(p_amount, 0) <= o.amount then raise exception 'A counter-offer should be higher than the offer.'; end if;
    update public.offers_deal set status = 'countered', counter_amount = p_amount, response_note = left(coalesce(p_note, ''), 600), updated_at = now() where id = o.id;
    update public.urgent_requests set stage = 'negotiation', updated_at = now() where listing_id = o.listing_id and stage in ('submitted','under_review','documents_checked','market_assessment','matching','offer_received');
    perform public.deal_event(o.listing_id, 'stage', 'negotiation', 'Counter-offer of Rs ' || to_char(p_amount, 'FM999,999,999,999') || ' on ' || o.ref, case when by_admin then 'raqbo' else 'owner' end);
  else raise exception 'Unknown action.'; end if;
  if o.buyer_id is not null then
    perform public.notify(o.buyer_id, 'deal', case p_action when 'accept' then 'Your offer was accepted' when 'reject' then 'Your offer was declined' else 'The seller made a counter-offer' end,
      left(l.title, 100) || case when p_action = 'counter' then ' · Rs ' || to_char(p_amount, 'FM999,999,999,999') else '' end || case when coalesce(p_note, '') <> '' then ' · ' || left(p_note, 120) else '' end, '#my/offers');
  end if;
  if by_admin then perform public.audit('offer.' || p_action, 'offer', o.ref, p_note, jsonb_build_object('amount', p_amount)); end if;
end $$;
grant execute on function public.respond_offer(uuid, text, bigint, text) to authenticated;

create or replace function public.buyer_offer_action(p_offer uuid, p_action text, p_amount bigint)
returns void language plpgsql security definer set search_path = public
as $$
declare o public.offers_deal; l public.listings;
begin
  select * into o from public.offers_deal where id = p_offer and buyer_id = auth.uid();
  if o.id is null then raise exception 'Offer not found.'; end if;
  select * into l from public.listings where id = o.listing_id for update;
  select * into o from public.offers_deal where id = p_offer and buyer_id = auth.uid();
  if o.id is null or o.status not in ('submitted','countered') then raise exception 'This offer is already closed.'; end if;
  if o.expires_at is not null and o.expires_at <= now() then raise exception 'This offer has expired.'; end if;
  if p_action in ('accept_counter','revise') and (l.status <> 'published' or l.sale_mode not in ('normal','urgent') or l.availability in ('sold','rented')) then raise exception 'This property is not available for offers.'; end if;
  if p_action = 'withdraw' then
    update public.offers_deal set status = 'withdrawn', updated_at = now() where id = o.id;
  elsif p_action = 'accept_counter' then
    if o.status <> 'countered' then raise exception 'There is no counter-offer to accept.'; end if;
    update public.offers_deal set status = 'accepted', amount = o.counter_amount, updated_at = now() where id = o.id;
    update public.offers_deal set status = 'rejected', response_note = 'The seller accepted another offer.', updated_at = now() where listing_id = o.listing_id and id <> o.id and status in ('submitted','countered');
    update public.urgent_requests set stage = 'agreement', stage_note = 'Offer accepted subject to documents, payment and the final agreement.', updated_at = now() where listing_id = o.listing_id;
    perform public.deal_event(o.listing_id, 'stage', 'agreement', 'Buyer ' || o.buyer_no || ' accepted the counter-offer of Rs ' || to_char(o.counter_amount, 'FM999,999,999,999'), 'buyer');
    if l.sale_mode = 'urgent' then perform public.notify_admins('deal', 'Counter-offer accepted: ' || l.ref, 'Rs ' || to_char(o.counter_amount, 'FM999,999,999,999') || ' · arrange the agreement', '#admin/urgent'); end if;
  elsif p_action = 'revise' then
    if coalesce(p_amount, 0) <= o.amount then raise exception 'A revised offer should be higher than your last offer.'; end if;
    update public.offers_deal set status = 'submitted', amount = p_amount, counter_amount = null, updated_at = now() where id = o.id;
  else raise exception 'Unknown action.'; end if;
  perform public.notify(l.owner_id, 'deal', case p_action when 'withdraw' then 'An offer was withdrawn' when 'accept_counter' then 'Your counter-offer was accepted' else 'A buyer revised their offer' end,
    left(l.title, 100) || ' · Buyer ' || o.buyer_no || case when p_action = 'revise' then ' · Rs ' || to_char(p_amount, 'FM999,999,999,999') else '' end, '#my/offers');
  perform public.deal_event(o.listing_id, 'offer', null, 'Buyer ' || o.buyer_no || ' ' || replace(p_action, '_', ' '), 'buyer');
end $$;
grant execute on function public.buyer_offer_action(uuid, text, bigint) to authenticated;

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
    'received', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'ref', o.ref, 'listing_id', o.listing_id, 'title', l.title, 'listing_ref', l.ref, 'price', l.price, 'channel', l.channel,
        'who', case o.source when 'raqbo' then 'RAQBO' when 'investor' then 'RAQBO investor ' || o.buyer_no else 'Buyer ' || o.buyer_no end, 'source', o.source,
        'amount', o.amount, 'counter_amount', o.counter_amount, 'conditions', o.conditions, 'status', case when o.status in ('submitted','countered') and o.expires_at <= now() then 'expired' else o.status end,
        'response_note', o.response_note, 'expires_at', o.expires_at, 'created_at', o.created_at) order by o.created_at desc)
      from public.offers_deal o join public.listings l on l.id = o.listing_id where l.owner_id = me), '[]'::jsonb),
    'made', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'ref', o.ref, 'listing_id', o.listing_id, 'title', l.title, 'listing_ref', l.ref, 'price', l.price, 'channel', l.channel, 'amount', o.amount, 'counter_amount', o.counter_amount,
        'conditions', o.conditions, 'status', case when o.status in ('submitted','countered') and o.expires_at <= now() then 'expired' else o.status end, 'response_note', o.response_note, 'expires_at', o.expires_at, 'created_at', o.created_at) order by o.created_at desc)
      from public.offers_deal o join public.listings l on l.id = o.listing_id where o.buyer_id = me), '[]'::jsonb),
    'visits', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'listing_id', i.listing_id, 'title', l.title, 'status', i.status, 'preferred_at', i.preferred_at, 'confirmed_at', i.confirmed_at, 'admin_note', i.admin_note) order by i.created_at desc)
      from public.inspections i join public.listings l on l.id = i.listing_id where i.user_id = me), '[]'::jsonb),
    'investor', (select to_jsonb(i) - 'capacity_docs' - 'approved_by' from public.investor_profiles i where i.user_id = me));
end $$;
grant execute on function public.my_deals() to authenticated;

-- The general listing-chat entry point must respect the same confidentiality rule.
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
    if l.channel <> 'public' then raise exception 'Private opportunities are coordinated through RAQBO.'; end if;
    other := l.owner_id; subj := l.title || ' · ' || l.ref;
    if other = me then raise exception 'This is your own listing.'; end if;
  elsif p_vendor is not null then
    select * into v from public.vendors where id = p_vendor and (status = 'approved' or owner_id = me);
    if v.id is null then raise exception 'This shop is not available.'; end if;
    other := v.owner_id; subj := v.shop_name;
    if other = me then raise exception 'This is your own shop.'; end if;
  elsif p_order is not null then
    select * into o from public.orders where id = p_order;
    if o.id is null then raise exception 'Order not found.'; end if;
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
    select id into cid from public.conversations where order_id = p_order and p_order is not null and starter_id = other and other_id = me;
  end if;
  if cid is null then
    insert into public.conversations (starter_id, other_id, listing_id, vendor_id, order_id, subject, starter_name, other_name)
    values (me, other, p_listing, p_vendor, p_order, left(subj, 160), my_name, coalesce(other_name, 'RAQBO team')) returning id into cid;
  end if;
  return cid;
end $$;
grant execute on function public.start_conversation(uuid, uuid, uuid) to authenticated;

create or replace function public.start_offer_chat(p_offer uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); o public.offers_deal; l public.listings; cid uuid; buyer_name text; owner_name text;
begin
  if me is null or not public.is_verified_user() then raise exception 'Please sign in to send messages.'; end if;
  select * into o from public.offers_deal where id = p_offer;
  if o.id is null then raise exception 'Offer not found.'; end if;
  select * into l from public.listings where id = o.listing_id;
  if o.buyer_id is null or l.owner_id is null or (me <> o.buyer_id and me <> l.owner_id) then raise exception 'This conversation is not available.'; end if;
  if l.channel <> 'public' then raise exception 'Private opportunities are coordinated through RAQBO.'; end if;
  if o.status not in ('submitted', 'countered', 'accepted') or (o.status <> 'accepted' and o.expires_at is not null and o.expires_at <= now()) then
    raise exception 'This offer is no longer open for a new conversation.';
  end if;
  select coalesce(nullif(full_name, ''), 'RAQBO member') into buyer_name from public.profiles where id = o.buyer_id;
  select coalesce(nullif(full_name, ''), 'Advertiser') into owner_name from public.profiles where id = l.owner_id;
  select id into cid from public.conversations where starter_id = o.buyer_id and other_id = l.owner_id and listing_id = l.id;
  if cid is null then
    insert into public.conversations (starter_id, other_id, listing_id, subject, starter_name, other_name)
    values (o.buyer_id, l.owner_id, l.id, left(l.title || ' · ' || l.ref, 160), buyer_name, owner_name)
    on conflict do nothing returning id into cid;
    if cid is null then
      select id into cid from public.conversations where starter_id = o.buyer_id and other_id = l.owner_id and listing_id = l.id;
    end if;
  end if;
  if cid is null then raise exception 'Could not open the conversation.'; end if;
  return cid;
end $$;
revoke all on function public.start_offer_chat(uuid) from public, anon;
grant execute on function public.start_offer_chat(uuid) to authenticated;
