-- =====================================================================
-- RAQBO — Update 7: payment screenshots for escrow orders
-- Buyers upload a screenshot of their payment; admins check it before
-- holding the money in escrow. Screenshots are private (buyer + admins only).
-- Run once in: Supabase Dashboard → SQL Editor → New query → paste → Run. Safe to run again.
-- (Requires update_5_marketplace.sql to have been run first.)
-- =====================================================================
alter table public.orders add column if not exists payment_proof text not null default '' check (char_length(payment_proof) <= 300);

-- Private storage bucket for payment screenshots (5 MB, images only)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Buyers upload only into their own folder:  <user id>/<order id>/<file>
drop policy if exists "payment-proofs: upload own folder" on storage.objects;
create policy "payment-proofs: upload own folder" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text
  );
-- Only the buyer who uploaded it and RAQBO admins can view a screenshot
drop policy if exists "payment-proofs: owner or admin reads" on storage.objects;
create policy "payment-proofs: owner or admin reads" on storage.objects
  for select using (
    bucket_id = 'payment-proofs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );
drop policy if exists "payment-proofs: owner or admin deletes" on storage.objects;
create policy "payment-proofs: owner or admin deletes" on storage.objects
  for delete using (
    bucket_id = 'payment-proofs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- Order workflow: payment now needs a screenshot (transaction ID optional)
create or replace function public.order_action(p_order_id uuid, p_action text, p_payload jsonb default '{}'::jsonb)
returns text language plpgsql security definer set search_path = public
as $$
declare o public.orders; v public.vendors; is_buyer boolean; is_vendor boolean; adm boolean;
        nxt text; actor text; note text := ''; it jsonb; lines jsonb := '[]'::jsonb; sub numeric := 0; pr numeric; b public.buyer_profiles; disc numeric := 0;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  select * into v from public.vendors where id = o.vendor_id;
  adm := public.is_admin(); is_buyer := o.buyer_id = auth.uid(); is_vendor := v.owner_id = auth.uid() or (v.owner_id is null and adm);
  p_payload := coalesce(p_payload, '{}'::jsonb);

  if p_action = 'send_quote' and is_vendor and o.status = 'quote_requested' then
    for it in select * from jsonb_array_elements(o.items) loop
      pr := coalesce((select (x->>'price')::numeric from jsonb_array_elements(p_payload->'prices') x where x->>'product_id' = it->>'product_id' limit 1), (it->>'price')::numeric);
      if pr is null or pr <= 0 then raise exception 'Enter a price for every item.'; end if;
      sub := sub + pr * (it->>'qty')::int; lines := lines || (it || jsonb_build_object('price', pr));
    end loop;
    select * into b from public.buyer_profiles where user_id = o.buyer_id;
    if coalesce(b.registered_commercial, false) and v.bulk_discount > 0 then disc := round(sub * v.bulk_discount / 100); end if;
    update public.orders set items = lines, subtotal = sub, discount = disc,
      delivery_fee = coalesce((p_payload->>'delivery_fee')::numeric, o.delivery_fee),
      total = sub + coalesce((p_payload->>'delivery_fee')::numeric, o.delivery_fee) - disc,
      vendor_note = left(coalesce(p_payload->>'note', ''), 600) where id = o.id;
    nxt := 'quoted'; actor := 'vendor'; note := 'Quote sent' || coalesce(': ' || nullif(p_payload->>'note', ''), '');
  elsif p_action = 'decline' and is_vendor and o.status in ('quote_requested','awaiting_payment') then
    nxt := 'cancelled'; actor := 'vendor'; note := 'Declined by vendor' || coalesce(': ' || nullif(p_payload->>'note', ''), '');
  elsif p_action = 'accept_quote' and is_buyer and o.status = 'quoted' then
    if not v.escrow_enabled then raise exception 'This vendor does not accept escrow payments yet — contact them on WhatsApp or call.'; end if;
    nxt := 'awaiting_payment'; actor := 'buyer'; note := 'Quote accepted — waiting for escrow payment';
  elsif p_action = 'submit_payment' and is_buyer and o.status = 'awaiting_payment' then
    if coalesce(p_payload->>'method', '') not in ('bank','jazzcash','easypaisa','sadapay','nayapay') then raise exception 'Choose how you paid.'; end if;
    if char_length(coalesce(p_payload->>'proof', '')) < 5 or split_part(p_payload->>'proof', '/', 1) <> auth.uid()::text then raise exception 'Upload a screenshot of your payment.'; end if;
    update public.orders set payment_method = p_payload->>'method', payment_ref = left(btrim(coalesce(p_payload->>'reference', '')), 80),
      payment_proof = left(p_payload->>'proof', 300) where id = o.id;
    nxt := 'payment_review'; actor := 'buyer'; note := 'Payment submitted with screenshot (' || (p_payload->>'method') || coalesce(', ref ' || nullif(btrim(p_payload->>'reference'), ''), '') || ') — RAQBO is verifying it';
  elsif p_action = 'payment_received' and adm and o.status = 'payment_review' then
    nxt := 'paid_escrow'; actor := 'admin'; note := 'Payment received and held in RAQBO escrow — vendor can dispatch';
  elsif p_action = 'payment_rejected' and adm and o.status = 'payment_review' then
    nxt := 'awaiting_payment'; actor := 'admin'; note := 'Payment could not be verified' || coalesce(': ' || nullif(p_payload->>'note', ''), '');
  elsif p_action = 'dispatch' and is_vendor and o.status = 'paid_escrow' then
    update public.orders set dispatch_info = jsonb_build_object('vehicle', left(coalesce(p_payload->>'vehicle', ''), 40), 'driver', left(coalesce(p_payload->>'driver', ''), 80),
      'phone', left(coalesce(p_payload->>'phone', ''), 20), 'eta', left(coalesce(p_payload->>'eta', ''), 60)) where id = o.id;
    nxt := 'dispatched'; actor := 'vendor'; note := 'Dispatched' || coalesce(' · vehicle ' || nullif(p_payload->>'vehicle', ''), '') || coalesce(' · ETA ' || nullif(p_payload->>'eta', ''), '');
  elsif p_action = 'delivered' and is_vendor and o.status = 'dispatched' then
    nxt := 'delivered'; actor := 'vendor'; note := 'Marked as delivered by vendor — buyer to inspect and confirm';
  elsif p_action = 'confirm_delivery' and is_buyer and o.status in ('dispatched','delivered') then
    nxt := 'completed'; actor := 'buyer'; note := 'Buyer confirmed delivery — payout will be released to the vendor';
  elsif p_action = 'dispute' and is_buyer and o.status in ('paid_escrow','dispatched','delivered') then
    if char_length(btrim(coalesce(p_payload->>'reason', ''))) < 5 then raise exception 'Describe the problem (at least 5 characters).'; end if;
    update public.orders set dispute_reason = left(btrim(p_payload->>'reason'), 600) where id = o.id;
    nxt := 'disputed'; actor := 'buyer'; note := 'Dispute opened: ' || left(btrim(p_payload->>'reason'), 200);
  elsif p_action = 'cancel' and is_buyer and o.status in ('quote_requested','quoted','awaiting_payment') then
    nxt := 'cancelled'; actor := 'buyer'; note := 'Cancelled by buyer';
  elsif p_action = 'release_payout' and adm and o.status = 'completed' then
    nxt := 'released'; actor := 'admin'; note := 'Payout released to vendor' || coalesce(': ' || nullif(p_payload->>'note', ''), '');
  elsif p_action = 'resolve_release' and adm and o.status = 'disputed' then
    nxt := 'released'; actor := 'admin'; note := 'Dispute resolved — payout released to vendor' || coalesce(': ' || nullif(p_payload->>'note', ''), '');
  elsif p_action = 'resolve_refund' and adm and o.status = 'disputed' then
    nxt := 'refunded'; actor := 'admin'; note := 'Dispute resolved — buyer refunded' || coalesce(': ' || nullif(p_payload->>'note', ''), '');
  else
    raise exception 'This action is not allowed for this order right now.';
  end if;

  update public.orders set status = nxt, updated_at = now() where id = o.id;
  insert into public.order_events (order_id, status, actor, note) values (o.id, nxt, actor, note);
  return nxt;
end $$;

