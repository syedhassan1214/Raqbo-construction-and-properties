-- =====================================================================
-- 25. QuickSell (formerly Urgent Sale): 9-stage workflow and "Assisted sale"
-- Run after update_16_location.sql. Safe to run more than once.
-- =====================================================================
alter table public.urgent_requests drop constraint if exists urgent_requests_stage_check;
alter table public.urgent_requests add constraint urgent_requests_stage_check check (stage in ('submitted','under_review','documents_checked','market_assessment','matching','offer_received','negotiation','agreement','sold','closed','rejected'));

create or replace function public.urgent_stage_label(p text)
returns text language sql immutable as $$
  select case p when 'submitted' then 'Submitted' when 'under_review' then 'Initial review' when 'documents_checked' then 'Document check' when 'market_assessment' then 'Market assessment' when 'matching' then 'Buyer & investor matching'
    when 'offer_received' then 'Purchase offers' when 'negotiation' then 'Negotiation' when 'agreement' then 'Agreement' when 'sold' then 'Completed'
    when 'closed' then 'Closed' when 'rejected' then 'Not accepted' else p end $$;

create or replace function public.submit_urgent_sale(p_listing uuid, p jsonb)
returns void language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); l public.listings; opts text[]; ch text; nm text;
begin
  if not (select urgent_enabled from public.platform_settings where id = 1) then raise exception 'QuickSell is not open right now.'; end if;
  select * into l from public.listings where id = p_listing;
  if l.id is null or l.owner_id is distinct from me then raise exception 'You can only submit your own property.'; end if;
  if l.purpose <> 'sale' then raise exception 'QuickSell is for properties for sale.'; end if;
  opts := array(select distinct x from jsonb_array_elements_text(coalesce(p->'options', '[]')) x where x in ('raqbo','investors','public','assisted'));
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
  perform public.deal_event(l.id, 'stage', 'submitted', 'QuickSell request submitted', 'owner');
  select coalesce(nullif(full_name, ''), 'A member') into nm from public.profiles where id = me;
  perform public.notify_admins('deal', 'QuickSell request: ' || left(l.title, 90), nm || ' · ' || l.ref || ' · Rs ' || to_char(l.price, 'FM999,999,999,999') || ' · options: ' || array_to_string(opts, ', '), '#admin/urgent');
end $$;
grant execute on function public.submit_urgent_sale(uuid, jsonb) to authenticated;

create or replace function public.make_offer(p_listing uuid, p_amount bigint, p_conditions text)
returns text language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); l public.listings; src text; no int; o public.offers_deal; days int;
begin
  if me is null or not public.is_verified_user() then raise exception 'Please sign in to make an offer.'; end if;
  select * into l from public.listings where id = p_listing and status = 'published';
  if l.id is null or l.sale_mode <> 'urgent' then raise exception 'Offers can be made on QuickSell properties.'; end if;
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
  update public.urgent_requests set stage = 'offer_received', updated_at = now() where listing_id = l.id and stage in ('submitted','under_review','documents_checked','market_assessment','matching');
  perform public.deal_event(l.id, 'offer', null, 'Offer of Rs ' || to_char(p_amount, 'FM999,999,999,999') || ' from ' || case src when 'investor' then 'Investor ' else 'Buyer ' end || no, 'buyer');
  perform public.notify(l.owner_id, 'deal', 'New offer: Rs ' || to_char(p_amount, 'FM999,999,999,999'), left(l.title, 100) || ' · ' || case src when 'investor' then 'RAQBO investor ' else 'Buyer ' end || no || '. Review it in My RAQBO → Offers.', '#my/offers');
  perform public.notify_admins('deal', 'Offer on ' || l.ref, 'Rs ' || to_char(p_amount, 'FM999,999,999,999') || ' · ' || src || ' · ' || left(l.title, 80), '#admin/urgent');
  return o.ref;
end $$;
grant execute on function public.make_offer(uuid, bigint, text) to authenticated;

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
  update public.urgent_requests set stage = 'offer_received', updated_at = now() where listing_id = l.id and stage in ('submitted','under_review','documents_checked','market_assessment','matching');
  perform public.deal_event(l.id, 'offer', null, 'RAQBO made a conditional purchase offer of Rs ' || to_char(p_amount, 'FM999,999,999,999'), 'raqbo');
  perform public.notify(l.owner_id, 'deal', 'RAQBO made an offer on your property', 'Rs ' || to_char(p_amount, 'FM999,999,999,999') || ' (conditional). Review it in My RAQBO → Offers.', '#my/offers');
  perform public.audit('urgent.raqbo_offer', 'listing', l.ref, p_reason, jsonb_build_object('amount', p_amount, 'conditions', p_conditions));
  return o.ref;
end $$;
grant execute on function public.admin_raqbo_offer(uuid, bigint, text, text) to authenticated;

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
