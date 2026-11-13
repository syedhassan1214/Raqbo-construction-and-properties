-- Listing moderation and scoped listing permissions. Run after update_35.
-- Safe to run again. This does not delete existing data.

drop policy if exists "profiles: read own or admin" on public.profiles;
create policy "profiles: read own or admin" on public.profiles
  for select using (id = auth.uid() or public.has_perm('listings'));

drop policy if exists "listings: read" on public.listings;
create policy "listings: read" on public.listings
  for select using (
    (status = 'published' and (channel = 'public' or (channel = 'investors' and public.is_approved_investor())))
    or owner_id = auth.uid() or public.has_perm('listings'));
drop policy if exists "listings: admin updates" on public.listings;
create policy "listings: admin updates" on public.listings
  for update using (public.has_perm('listings')) with check (public.has_perm('listings'));
drop policy if exists "listings: owner or admin deletes" on public.listings;
create policy "listings: owner or admin deletes" on public.listings
  for delete using (owner_id = auth.uid() or public.has_perm('listings'));

drop policy if exists "media: owner or admin deletes" on public.listing_media;
create policy "media: owner or admin deletes" on public.listing_media
  for delete using (public.has_perm('listings') or exists
    (select 1 from public.listings l where l.id = listing_id and l.owner_id = auth.uid()));
-- Listing staff can also clean up objects after their listing row is deleted.
drop policy if exists "listing-media: read visible" on storage.objects;
create policy "listing-media: read visible" on storage.objects
  for select using (
    bucket_id = 'listing-media' and (
      (storage.foldername(name))[1] = auth.uid()::text or public.has_perm('listings')
      or exists (select 1 from public.listing_media m join public.listings l on l.id = m.listing_id where m.path = storage.objects.name)
    ));
drop policy if exists "listing-media: owner or admin deletes" on storage.objects;
create policy "listing-media: owner or admin deletes" on storage.objects
  for delete using (bucket_id = 'listing-media' and
    ((storage.foldername(name))[1] = auth.uid()::text or public.has_perm('listings')));

-- A limited admin editing their own listing must be treated like an owner.
create or replace function public.listings_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.has_perm('listings') then
    if (select count(*) from public.listings where owner_id = auth.uid() and created_at > now() - interval '1 day') >= 10 then
      raise exception 'You can submit up to 10 listings per day. Please try again tomorrow.';
    end if;
    new.owner_id := auth.uid(); new.status := 'pending'; new.is_sample := false;
    new.review_note := null; new.published_at := null; new.reviewed_by := null; new.reviewed_at := null;
    new.advertiser_name := coalesce((select full_name from public.profiles where id = auth.uid()), new.advertiser_name);
  end if;
  new.created_at := now(); new.updated_at := now();
  return new;
end $$;

create or replace function public.listings_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if auth.uid() is not null and not public.has_perm('listings') and coalesce(current_setting('raqbo.sys', true), '') <> '1' then
    new.id := old.id; new.ref := old.ref; new.owner_id := old.owner_id; new.is_sample := old.is_sample;
    new.advertiser_name := old.advertiser_name; new.created_at := old.created_at;
    new.review_note := old.review_note; new.reviewed_by := old.reviewed_by; new.reviewed_at := old.reviewed_at;
    new.published_at := old.published_at; new.status := 'pending';
    return new;
  end if;
  if new.status is distinct from old.status then
    new.reviewed_by := auth.uid(); new.reviewed_at := now();
    if new.status = 'published' then new.published_at := now(); end if;
  end if;
  return new;
end $$;

create or replace function public.listings_zz_protect()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.utilities := coalesce(array(select distinct x from unnest(new.utilities) x where x in ('electricity','gas','water','sewerage','internet','phone')), '{}');
  if auth.uid() is not null and not public.has_perm('listings') and coalesce(current_setting('raqbo.sys', true), '') <> '1' then
    if tg_op = 'INSERT' then
      new.raqbo_role := null; new.raqbo_role_note := '';
      if new.sale_mode = 'auction' then new.sale_mode := 'normal'; end if;
    else
      new.raqbo_role := old.raqbo_role; new.raqbo_role_note := old.raqbo_role_note;
      if new.sale_mode = 'auction' or old.sale_mode = 'auction' then new.sale_mode := old.sale_mode; end if;
    end if;
  end if;
  return new;
end $$;

create or replace function public.listings_zz_v3()
returns trigger language plpgsql security definer set search_path = public as $$
declare sys boolean := coalesce(current_setting('raqbo.sys', true), '') = '1' or auth.uid() is null or public.has_perm('listings');
begin
  if tg_op = 'INSERT' then
    if not sys then new.confirmed_at := now(); new.prev_price := null; new.price_changed_at := null; new.confirm_reminded_at := null; if new.status = 'expired' then new.status := 'pending'; end if; end if;
    return new;
  end if;
  if not sys then
    new.confirmed_at := old.confirmed_at; new.confirm_reminded_at := old.confirm_reminded_at;
    if new.status = 'expired' and old.status <> 'expired' then new.status := old.status; end if;
  end if;
  if new.price is distinct from old.price then
    new.prev_price := old.price; new.price_changed_at := now(); new.confirmed_at := now();
  elsif not sys then
    new.prev_price := old.prev_price; new.price_changed_at := old.price_changed_at;
  end if;
  return new;
end $$;

create or replace function public.listings_zz_v20()
returns trigger language plpgsql security definer set search_path = public as $$
declare sys boolean := coalesce(current_setting('raqbo.sys', true), '') = '1' or auth.uid() is null or public.has_perm('listings');
begin
  if not sys then new.payment_plan := case when tg_op = 'INSERT' then '[]'::jsonb else old.payment_plan end; end if;
  return new;
end $$;

create or replace function public.listings_zz_v22()
returns trigger language plpgsql security definer set search_path = public as $$
declare sys boolean := coalesce(current_setting('raqbo.sys', true), '') = '1' or auth.uid() is null or public.has_perm('listings');
begin
  if not sys then new.project_info := case when tg_op = 'INSERT' then '{}'::jsonb else old.project_info end; end if;
  return new;
end $$;

-- Partner takedowns remain authorized without granting general listing access.
create or replace function public.pn_takedown_listing(p_listing uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_partner uuid;
begin
  if not public.has_perm('listings') and not public.has_perm('partners') then
    raise exception 'You do not have permission to remove a listing.';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why the listing is being removed.'; end if;
  select partner_id into v_partner from public.listings where id = p_listing;
  perform set_config('raqbo.sys', '1', true);
  update public.listings set status = 'rejected', review_note = left(trim(p_reason), 300),
    takedown_reason = left(trim(p_reason), 300), takedown_at = now(), updated_at = now() where id = p_listing;
  if not found then raise exception 'That listing no longer exists.'; end if;
  perform set_config('raqbo.sys', '', true);
  perform public.audit('pn_takedown', 'listing', p_listing::text, left(trim(p_reason), 300), jsonb_build_object('partner', v_partner));
  if v_partner is not null then perform public.pn_log(v_partner, 'listing_removed', 'listing', p_listing::text, left(trim(p_reason), 300)); end if;
end $$;

create or replace function public.admin_moderate_listing(p_listing uuid, p_action text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.listings; paths jsonb; note text; v_title text; v_description text; v_city text; v_area text; size_value numeric; price_value bigint; v_size_unit text;
begin
  if not public.has_perm('listings') then raise exception 'You do not have permission to moderate listings.'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'Invalid moderation data.'; end if;
  select * into l from public.listings where id = p_listing for update;
  if not found then raise exception 'This listing is no longer available.'; end if;

  if p_action = 'edit' then
    if not (p_data ?& array['title','description','city','area','size','sizeUnit','price'])
       or (select count(*) from jsonb_object_keys(p_data)) <> 7 then raise exception 'Invalid listing details.'; end if;
    if jsonb_typeof(p_data->'title') <> 'string' or jsonb_typeof(p_data->'description') <> 'string'
      or jsonb_typeof(p_data->'city') <> 'string' or jsonb_typeof(p_data->'area') <> 'string'
      or jsonb_typeof(p_data->'sizeUnit') <> 'string' or jsonb_typeof(p_data->'size') <> 'number'
      or jsonb_typeof(p_data->'price') <> 'number' then raise exception 'Invalid listing details.'; end if;
    v_title := btrim(p_data->>'title'); v_description := btrim(p_data->>'description');
    v_city := btrim(p_data->>'city'); v_area := btrim(p_data->>'area'); v_size_unit := p_data->>'sizeUnit';
    if coalesce(char_length(v_title), 0) not between 5 and 80 or coalesce(char_length(v_description), 0) not between 20 and 2000
      or coalesce(char_length(v_city), 0) not between 1 and 60 or coalesce(char_length(v_area), 0) not between 1 and 120
      or v_size_unit is null or v_size_unit not in ('Marla','Kanal','sq ft','sq yd','Acre')
      or length(p_data->>'size') > 30 or length(p_data->>'price') > 19
      or coalesce(p_data->>'size', '') !~ '^[0-9]+([.][0-9]+)?$'
      or coalesce(p_data->>'price', '') !~ '^[0-9]+$' then raise exception 'Invalid listing details.'; end if;
    size_value := (p_data->>'size')::numeric; price_value := (p_data->>'price')::bigint;
    if size_value <= 0 or price_value <= 0 then raise exception 'Size and price must be greater than zero.'; end if;
    update public.listings set title = v_title, description = v_description, city = v_city, area = v_area,
      size = size_value, size_unit = v_size_unit, price = price_value where id = p_listing;
    perform public.audit('listing.moderation_edit', 'listing', l.ref, '', jsonb_build_object('listing_id', l.id));
    return '{}'::jsonb;
  elsif p_action = 'note' then
    if not (p_data ? 'note') or jsonb_typeof(p_data->'note') <> 'string'
      or (select count(*) from jsonb_object_keys(p_data)) <> 1 then raise exception 'Invalid note.'; end if;
    note := btrim(p_data->>'note');
    if coalesce(char_length(note), 0) not between 1 and 1000 then raise exception 'Note must be between 1 and 1000 characters.'; end if;
    if l.owner_id is null then raise exception 'This listing has no advertiser account to notify.'; end if;
    update public.listings set review_note = note where id = p_listing;
    perform public.notify(l.owner_id, 'listing', 'A note about your listing: ' || left(l.title, 130), left(note, 400), '#my/properties');
    perform public.audit('listing.moderation_note', 'listing', l.ref, '', jsonb_build_object('listing_id', l.id));
    return '{}'::jsonb;
  elsif p_action = 'delete' then
    if p_data <> '{}'::jsonb then raise exception 'Invalid deletion data.'; end if;
    select coalesce(jsonb_agg(path), '[]'::jsonb) into paths from public.listing_media where listing_id = p_listing and path is not null;
    perform public.audit('listing.moderation_delete', 'listing', l.ref, '', jsonb_build_object('listing_id', l.id));
    delete from public.listings where id = p_listing;
    return jsonb_build_object('paths', paths);
  end if;
  raise exception 'Unknown moderation action.';
end $$;
revoke all on function public.admin_moderate_listing(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.admin_moderate_listing(uuid, text, jsonb) to authenticated;
