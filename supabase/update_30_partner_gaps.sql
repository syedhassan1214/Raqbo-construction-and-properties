-- =====================================================================
-- RAQBO — update 30: the last pieces of the Partner Network
--
-- Adds the four things the Partner Network document asks for that were
-- not yet in place:
--   1. A partner's photograph, shown on the public partner directory.
--   2. Customer feedback on a partner, and the rating it produces.
--   3. Franchise terms on a franchise agreement (fee, royalty, standards).
--   4. A recorded reason when a misleading listing is taken down.
--
-- Safe to run more than once. It deletes nothing.
-- =====================================================================

-- ---------- 1. The partner's photograph ----------
-- Photographs go in their own public bucket, because the partner directory
-- is open to visitors who are not signed in and cannot sign a private link.
insert into storage.buckets (id, name, public) values ('partner-photos', 'partner-photos', true)
  on conflict (id) do nothing;

drop policy if exists "partner photo read" on storage.objects;
create policy "partner photo read" on storage.objects for select to public
  using (bucket_id = 'partner-photos');

drop policy if exists "partner photo write" on storage.objects;
create policy "partner photo write" on storage.objects for insert to authenticated
  with check (bucket_id = 'partner-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "partner photo replace" on storage.objects;
create policy "partner photo replace" on storage.objects for update to authenticated
  using (bucket_id = 'partner-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "partner photo remove" on storage.objects;
create policy "partner photo remove" on storage.objects for delete to authenticated
  using (bucket_id = 'partner-photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.has_perm('partners')));

-- A partner sets their own photograph; an admin may set anyone's.
create or replace function public.pn_set_photo(p_partner uuid, p_path text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := public.pn_me(); target uuid := coalesce(p_partner, me);
begin
  if target is null then raise exception 'No partner account.'; end if;
  if target <> me and not public.has_perm('partners') then
    raise exception 'Only the partner, or RAQBO staff, may change this photograph.';
  end if;
  if coalesce(p_path, '') <> '' and (char_length(p_path) < 3 or char_length(p_path) > 400 or p_path !~ '^[A-Za-z0-9/._-]+$') then
    raise exception 'That does not look like a stored file.';
  end if;
  update public.pn_partners set photo_path = coalesce(p_path, ''), updated_at = now() where id = target;
  perform public.audit('pn_photo', 'pn_partner', target::text, '', jsonb_build_object('set', coalesce(p_path, '') <> ''));
end $$;
grant execute on function public.pn_set_photo(uuid, text) to authenticated;

-- ---------- 2. Customer feedback and the partner's rating ----------
create table if not exists public.pn_feedback (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references public.pn_partners (id) on delete cascade,
  lead_id     uuid references public.pn_leads (id) on delete set null,
  rating      int  not null check (rating between 1 and 5),
  comment     text not null default '' check (char_length(comment) <= 1000),
  customer    text not null default '' check (char_length(customer) <= 120),
  -- who recorded it: RAQBO staff after speaking to the customer, or the
  -- customer themselves through a completed service request.
  recorded_by uuid references auth.users (id) on delete set null,
  source      text not null default 'raqbo' check (source in ('raqbo', 'customer')),
  published   boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists pn_feedback_partner_idx on public.pn_feedback (partner_id, created_at desc);
create unique index if not exists pn_feedback_lead_idx on public.pn_feedback (lead_id) where lead_id is not null;

alter table public.pn_feedback enable row level security;

drop policy if exists "feedback read" on public.pn_feedback;
create policy "feedback read" on public.pn_feedback for select to authenticated
  using (public.has_perm('partners') or partner_id = public.pn_me());

drop policy if exists "feedback staff write" on public.pn_feedback;
create policy "feedback staff write" on public.pn_feedback for all to authenticated
  using (public.has_perm('partners')) with check (public.has_perm('partners'));

-- Record a piece of feedback. A partner can never record their own.
create or replace function public.pn_add_feedback(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_partner uuid := (p->>'partner_id')::uuid; v_rating int := (p->>'rating')::int;
begin
  if not public.has_perm('partners') then raise exception 'Only RAQBO staff may record customer feedback.'; end if;
  if v_partner is null then raise exception 'Which partner is this feedback about?'; end if;
  if v_partner = public.pn_me() then raise exception 'A partner cannot record feedback about themselves.'; end if;
  if v_rating is null or v_rating < 1 or v_rating > 5 then raise exception 'Give a rating from 1 to 5.'; end if;
  insert into public.pn_feedback (partner_id, lead_id, rating, comment, customer, recorded_by, source, published)
  values (v_partner, nullif(p->>'lead_id', '')::uuid, v_rating, left(coalesce(p->>'comment', ''), 1000),
          left(coalesce(p->>'customer', ''), 120), auth.uid(),
          case when coalesce(p->>'source', 'raqbo') = 'customer' then 'customer' else 'raqbo' end,
          coalesce((p->>'published')::boolean, false))
  returning id into v_id;
  perform public.audit('pn_feedback', 'pn_partner', v_partner::text, '', jsonb_build_object('rating', v_rating));
  return v_id;
end $$;
grant execute on function public.pn_add_feedback(jsonb) to authenticated;

-- The rating a partner has earned, from real recorded feedback only.
create or replace function public.pn_rating(p_partner uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'count', count(*),
    'average', case when count(*) = 0 then null else round(avg(rating)::numeric, 1) end,
    'five', count(*) filter (where rating = 5),
    'low', count(*) filter (where rating <= 2)
  ) from public.pn_feedback where partner_id = p_partner
$$;
grant execute on function public.pn_rating(uuid) to authenticated, anon;

-- Performance now includes the rating, so "customer satisfaction" is a
-- measured figure rather than an opinion.
create or replace function public.pn_performance(p_partner uuid, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'listings', (select count(*) from public.listings where partner_id = p_partner and created_at::date between p_from and p_to),
    'listings_live', (select count(*) from public.listings where partner_id = p_partner and status = 'published'),
    'leads_total', (select count(*) from public.pn_leads where partner_id = p_partner and created_at::date between p_from and p_to),
    'leads_generated', (select count(*) from public.pn_leads where origin_partner = p_partner and created_at::date between p_from and p_to),
    'leads_accepted', (select count(*) from public.pn_leads where partner_id = p_partner and accepted_at is not null and created_at::date between p_from and p_to),
    'leads_lost', (select count(*) from public.pn_leads where partner_id = p_partner and stage = 'lost' and created_at::date between p_from and p_to),
    'leads_returned', (select count(*) from public.pn_leads where partner_id = p_partner and stage = 'returned' and created_at::date between p_from and p_to),
    'visits', (select count(*) from public.pn_leads where partner_id = p_partner and visit_at is not null and created_at::date between p_from and p_to),
    'completed', (select count(*) from public.pn_leads where partner_id = p_partner and stage = 'completed' and created_at::date between p_from and p_to),
    'revenue', (select coalesce(sum(fee_received), 0) from public.pn_transactions where partner_id = p_partner and created_at::date between p_from and p_to),
    'response_hours', (select round(avg(extract(epoch from (accepted_at - assigned_at)) / 3600.0)::numeric, 1)
                         from public.pn_leads where partner_id = p_partner and accepted_at is not null and assigned_at is not null
                          and created_at::date between p_from and p_to),
    'complaints', (select count(*) from public.complaints c where c.created_at::date between p_from and p_to
                     and c.subject_ref = (select partner_id from public.pn_partners where id = p_partner)),
    'rating', public.pn_rating(p_partner)
  )
$$;

-- ---------- 3. Franchise terms on a franchise agreement ----------
alter table public.pn_agreements add column if not exists franchise_fee bigint not null default 0 check (franchise_fee >= 0);
alter table public.pn_agreements add column if not exists royalty_pct numeric(5,2) not null default 0 check (royalty_pct >= 0 and royalty_pct <= 100);
alter table public.pn_agreements add column if not exists royalty_monthly bigint not null default 0 check (royalty_monthly >= 0);
alter table public.pn_agreements add column if not exists office_standards text not null default '' check (char_length(office_standards) <= 2000);
alter table public.pn_agreements add column if not exists marketing_commitment text not null default '' check (char_length(marketing_commitment) <= 2000);
alter table public.pn_agreements add column if not exists technology_access text not null default '' check (char_length(technology_access) <= 2000);
alter table public.pn_agreements add column if not exists staff_training text not null default '' check (char_length(staff_training) <= 2000);
alter table public.pn_agreements add column if not exists min_performance text not null default '' check (char_length(min_performance) <= 2000);

-- A franchise agreement cannot be executed with nothing agreed about money.
create or replace function public.pn_agreement_franchise_guard()
returns trigger language plpgsql as $$
begin
  if new.status = 'executed' and new.category = 'franchise'
     and new.franchise_fee = 0 and new.royalty_pct = 0 and new.royalty_monthly = 0
     and coalesce(new.commission_text, '') = '' then
    raise exception 'A franchise agreement needs its money terms first: an initial fee, a royalty, or a written commission arrangement.';
  end if;
  return new;
end $$;

drop trigger if exists pn_agreement_franchise_guard on public.pn_agreements;
create trigger pn_agreement_franchise_guard before insert or update on public.pn_agreements
  for each row execute function public.pn_agreement_franchise_guard();

-- ---------- 4. A reason when a misleading listing is taken down ----------
alter table public.listings add column if not exists takedown_reason text not null default '' check (char_length(takedown_reason) <= 300);
alter table public.listings add column if not exists takedown_at timestamptz;

create or replace function public.pn_takedown_listing(p_listing uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_partner uuid;
begin
  if not public.has_perm('listings') and not public.has_perm('partners') then
    raise exception 'You do not have permission to remove a listing.';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why the listing is being removed.'; end if;
  select partner_id into v_partner from public.listings where id = p_listing;
  update public.listings
     set status = 'rejected', review_note = left(trim(p_reason), 300),
         takedown_reason = left(trim(p_reason), 300), takedown_at = now(), updated_at = now()
   where id = p_listing;
  if not found then raise exception 'That listing no longer exists.'; end if;
  perform public.audit('pn_takedown', 'listing', p_listing::text, left(trim(p_reason), 300), jsonb_build_object('partner', v_partner));
  if v_partner is not null then
    perform public.pn_log(v_partner, 'listing_removed', 'listing', p_listing::text, left(trim(p_reason), 300));
  end if;
end $$;
grant execute on function public.pn_takedown_listing(uuid, text) to authenticated;

-- The agreement form now carries the franchise terms as well, so a
-- franchise agreement can be recorded in one go.
create or replace function public.pn_agreement_save(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_ref text; v_p uuid; v_status text := coalesce(nullif(p->>'status', ''), 'draft');
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  select id into v_p from public.pn_partners where partner_id = (p->>'partner_id');
  if v_p is null then raise exception 'Partner not found.'; end if;
  if v_status = 'executed' and not coalesce((p->>'legal_reviewed')::boolean, false) then
    raise exception 'Mark the agreement as legally reviewed before recording it as executed.';
  end if;
  if (p->>'id') is not null and (p->>'id') <> '' then
    update public.pn_agreements set
      category = coalesce(nullif(p->>'category', ''), category),
      parties = coalesce(p->>'parties', parties), relationship = coalesce(p->>'relationship', relationship),
      services = coalesce(p->>'services', services), territory_text = coalesce(p->>'territory_text', territory_text),
      exclusivity = coalesce(nullif(p->>'exclusivity', ''), exclusivity),
      starts_on = coalesce(nullif(p->>'starts_on', '')::date, starts_on),
      ends_on = coalesce(nullif(p->>'ends_on', '')::date, ends_on),
      renewal = coalesce(p->>'renewal', renewal), commission_text = coalesce(p->>'commission_text', commission_text),
      lead_allocation = coalesce(p->>'lead_allocation', lead_allocation), local_expenses = coalesce(p->>'local_expenses', local_expenses),
      brand_use = coalesce(p->>'brand_use', brand_use), data_protection = coalesce(p->>'data_protection', data_protection),
      reporting = coalesce(p->>'reporting', reporting), restrictions = coalesce(p->>'restrictions', restrictions),
      disputes = coalesce(p->>'disputes', disputes), termination = coalesce(p->>'termination', termination),
      after_termination = coalesce(p->>'after_termination', after_termination),
      territory_entitlement = coalesce((p->>'territory_entitlement')::boolean, territory_entitlement),
      legal_reviewed = coalesce((p->>'legal_reviewed')::boolean, legal_reviewed),
      franchise_fee = coalesce((p->>'franchise_fee')::bigint, franchise_fee),
      royalty_pct = coalesce((p->>'royalty_pct')::numeric, royalty_pct),
      royalty_monthly = coalesce((p->>'royalty_monthly')::bigint, royalty_monthly),
      office_standards = coalesce(p->>'office_standards', office_standards),
      marketing_commitment = coalesce(p->>'marketing_commitment', marketing_commitment),
      technology_access = coalesce(p->>'technology_access', technology_access),
      staff_training = coalesce(p->>'staff_training', staff_training),
      min_performance = coalesce(p->>'min_performance', min_performance),
      status = v_status,
      executed_on = case when v_status = 'executed' then coalesce(nullif(p->>'executed_on', '')::date, current_date) else executed_on end,
      file_path = coalesce(p->>'file_path', file_path), note = left(coalesce(p->>'note', note), 600), updated_at = now()
    where id = (p->>'id')::uuid returning ref into v_ref;
  else
    insert into public.pn_agreements (partner_id, category, parties, relationship, services, territory_text, exclusivity,
      starts_on, ends_on, renewal, commission_text, lead_allocation, local_expenses, brand_use, data_protection,
      reporting, restrictions, disputes, termination, after_termination, territory_entitlement, legal_reviewed, status, executed_on, file_path, note,
      franchise_fee, royalty_pct, royalty_monthly, office_standards, marketing_commitment, technology_access, staff_training, min_performance)
    values (v_p, coalesce(nullif(p->>'category', ''), (select category from public.pn_partners where id = v_p)),
      coalesce(p->>'parties', ''), coalesce(p->>'relationship', ''), coalesce(p->>'services', ''), coalesce(p->>'territory_text', ''),
      coalesce(nullif(p->>'exclusivity', ''), 'non_exclusive'),
      nullif(p->>'starts_on', '')::date, nullif(p->>'ends_on', '')::date, coalesce(p->>'renewal', ''),
      coalesce(p->>'commission_text', ''), coalesce(p->>'lead_allocation', ''), coalesce(p->>'local_expenses', ''),
      coalesce(p->>'brand_use', ''), coalesce(p->>'data_protection', ''), coalesce(p->>'reporting', ''),
      coalesce(p->>'restrictions', ''), coalesce(p->>'disputes', ''), coalesce(p->>'termination', ''),
      coalesce(p->>'after_termination', ''), coalesce((p->>'territory_entitlement')::boolean, false),
      coalesce((p->>'legal_reviewed')::boolean, false), v_status,
      case when v_status = 'executed' then coalesce(nullif(p->>'executed_on', '')::date, current_date) end,
      coalesce(p->>'file_path', ''), left(coalesce(p->>'note', ''), 600),
      coalesce((p->>'franchise_fee')::bigint, 0), coalesce((p->>'royalty_pct')::numeric, 0), coalesce((p->>'royalty_monthly')::bigint, 0),
      left(coalesce(p->>'office_standards', ''), 2000), left(coalesce(p->>'marketing_commitment', ''), 2000),
      left(coalesce(p->>'technology_access', ''), 2000), left(coalesce(p->>'staff_training', ''), 2000),
      left(coalesce(p->>'min_performance', ''), 2000))
    returning ref into v_ref;
  end if;
  perform public.audit('pn_agreement_save', 'pn_agreement', v_ref, v_status, null);
  return v_ref;
end $$;
grant execute on function public.pn_agreement_save(jsonb) to authenticated;

-- The public directory now shows the partner's photograph and the rating
-- their customers have actually given them.
drop function if exists public.pn_directory(text, text, text, text, text);
create or replace function public.pn_directory(p_province text default '', p_city text default '', p_area text default '',
                                               p_service text default '', p_q text default '')
returns table (partner_id text, display_name text, category text, business_type text, city text, province text,
               office_address text, phone text, whatsapp text, email text, services text[], designation text,
               status text, verified boolean, qr_token text, territories jsonb, since date, photo_path text, rating jsonb)
language sql stable security definer set search_path = public as $$
  select p.partner_id, p.display_name, p.category, p.business_type,
         coalesce(nullif((select string_agg(distinct t.city, ', ') from public.pn_partner_territories pt
                            join public.pn_territories t on t.id = pt.territory_id where pt.partner_id = p.id and t.city <> ''), ''), '') as city,
         coalesce(nullif((select string_agg(distinct t.province, ', ') from public.pn_partner_territories pt
                            join public.pn_territories t on t.id = pt.territory_id where pt.partner_id = p.id and t.province <> ''), ''), '') as province,
         p.office_address, p.phone, p.whatsapp, p.email, p.services, p.designation,
         p.status, (p.agreement_ok and p.status = 'active') as verified, p.qr_token,
         (select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'level', t.level, 'city', t.city) order by t.name), '[]'::jsonb)
            from public.pn_partner_territories pt join public.pn_territories t on t.id = pt.territory_id where pt.partner_id = p.id) as territories,
         p.joined_on, p.photo_path, public.pn_rating(p.id) as rating
    from public.pn_partners p
   where p.listed and p.status in ('active','probation')
     and (select directory_public from public.pn_settings where id)
     and (p_service = '' or p_service = any (p.services))
     and (p_q = '' or p.display_name ilike '%' || p_q || '%' or p.partner_id ilike '%' || p_q || '%')
     and (p_province = '' or exists (select 1 from public.pn_partner_territories pt join public.pn_territories t on t.id = pt.territory_id
                                      where pt.partner_id = p.id and lower(t.province) = lower(p_province)))
     and (p_city = '' or exists (select 1 from public.pn_partner_territories pt join public.pn_territories t on t.id = pt.territory_id
                                  where pt.partner_id = p.id and lower(t.city) = lower(p_city)))
     and (p_area = '' or exists (select 1 from public.pn_partner_territories pt join public.pn_territories t on t.id = pt.territory_id
                                  where pt.partner_id = p.id and t.name ilike '%' || p_area || '%'))
   order by (p.status = 'active') desc, p.display_name
$$;
grant execute on function public.pn_directory(text, text, text, text, text) to authenticated, anon;

-- ---------- 5. Supporting documents an applicant or partner uploads ----------
-- Section G of the application form: identification, business registration,
-- licence and anything else RAQBO asks for. The file itself goes into the
-- private partner-docs bucket; this records what it is.
create or replace function public.pn_doc_add(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_app uuid := nullif(p->>'application_id', '')::uuid;
        v_partner uuid := nullif(p->>'partner_id', '')::uuid; v_me uuid := auth.uid(); v_own boolean := false;
begin
  if v_me is null then raise exception 'Please sign in first.'; end if;
  if coalesce(p->>'path', '') = '' then raise exception 'No file was given.'; end if;
  if char_length(p->>'path') > 400 then raise exception 'That file name is too long.'; end if;
  -- the file must sit in the uploader's own folder, or belong to staff
  if (storage.foldername(p->>'path'))[1] <> v_me::text and not public.has_perm('partners') then
    raise exception 'You may only attach a file you uploaded yourself.';
  end if;

  if v_app is null and v_partner is null then
    select id into v_app from public.pn_applications where user_id = v_me order by created_at desc limit 1;
    if v_app is null then select id into v_partner from public.pn_partners where user_id = v_me; end if;
  end if;
  if v_app is null and v_partner is null then raise exception 'There is no application or partner account to attach this to.'; end if;

  if v_app is not null then
    select (user_id = v_me) into v_own from public.pn_applications where id = v_app;
  else
    select (user_id = v_me) into v_own from public.pn_partners where id = v_partner;
  end if;
  if not coalesce(v_own, false) and not public.has_perm('partners') then
    raise exception 'This is not your application.';
  end if;

  insert into public.pn_documents (partner_id, application_id, kind, title, path, expires_on, uploaded_by)
  values (v_partner, v_app,
    case when coalesce(p->>'kind', '') in ('cnic','ntn','registration','licence','agreement','office_proof','photo','other')
         then p->>'kind' else 'other' end,
    left(coalesce(p->>'title', ''), 160), p->>'path', nullif(p->>'expires_on', '')::date, v_me)
  returning id into v_id;
  return v_id;
end $$;
grant execute on function public.pn_doc_add(jsonb) to authenticated;

-- ---------- 6. The admin Partners screen also shows the rating and the
-- listings that partner has put up, so a misleading one can be taken down. ----
create or replace function public.pn_admin(p_what text default 'summary')
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  if p_what = 'applications' then
    return (select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb) from public.pn_applications a);
  elsif p_what = 'partners' then
    return (select coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object(
        'territories', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'city', t.city, 'exclusive', pt.exclusive) order by t.name), '[]'::jsonb)
                          from public.pn_partner_territories pt join public.pn_territories t on t.id = pt.territory_id where pt.partner_id = p.id),
        'agreement', (select a.status from public.pn_agreements a where a.partner_id = p.id order by a.created_at desc limit 1),
        'leads_open', (select count(*) from public.pn_leads l where l.partner_id = p.id and l.stage not in ('completed','lost','returned')),
        'owed', (select coalesce(sum(c.amount), 0) from public.pn_commissions c where c.partner_id = p.id and c.status = 'approved'),
        'rating', public.pn_rating(p.id),
        'feedback', (select coalesce(jsonb_agg(jsonb_build_object('rating', fb.rating, 'comment', fb.comment, 'customer', fb.customer, 'at', fb.created_at) order by fb.created_at desc), '[]'::jsonb)
                       from (select * from public.pn_feedback where partner_id = p.id order by created_at desc limit 10) fb),
        'listings', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'ref', l.ref, 'title', l.title, 'city', l.city, 'area', l.area,
                                                                  'status', l.status, 'owner_authorised', l.owner_authorised,
                                                                  'advert_expires_on', l.advert_expires_on, 'takedown_reason', l.takedown_reason)
                                               order by l.created_at desc), '[]'::jsonb)
                       from public.listings l where l.partner_id = p.id and l.status in ('published','pending'))
      ) order by p.created_at desc), '[]'::jsonb) from public.pn_partners p);
  elsif p_what = 'territories' then
    return (select coalesce(jsonb_agg(to_jsonb(t) || jsonb_build_object(
        'partners', (select coalesce(jsonb_agg(jsonb_build_object('partner_id', p.partner_id, 'name', p.display_name, 'status', p.status, 'exclusive', pt.exclusive)), '[]'::jsonb)
                       from public.pn_partner_territories pt join public.pn_partners p on p.id = pt.partner_id where pt.territory_id = t.id)
      ) order by t.province, t.city, t.name), '[]'::jsonb) from public.pn_territories t);
  elsif p_what = 'leads' then
    return (select coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object(
        'partner_name', (select display_name from public.pn_partners where id = l.partner_id),
        'events', (select coalesce(jsonb_agg(jsonb_build_object('stage', e.stage, 'at', e.at, 'note', e.note) order by e.at), '[]'::jsonb)
                     from public.pn_lead_events e where e.lead_id = l.id)
      ) order by l.created_at desc), '[]'::jsonb) from public.pn_leads l);
  elsif p_what = 'money' then
    return jsonb_build_object(
      'transactions', (select coalesce(jsonb_agg(to_jsonb(x) || jsonb_build_object(
            'partner_name', (select display_name from public.pn_partners where id = x.partner_id),
            'commission', (select to_jsonb(c) from public.pn_commissions c where c.transaction_id = x.id)
          ) order by x.created_at desc), '[]'::jsonb) from public.pn_transactions x),
      'payouts', (select coalesce(jsonb_agg(to_jsonb(o) || jsonb_build_object(
            'partner_name', (select display_name from public.pn_partners where id = o.partner_id)) order by o.created_at desc), '[]'::jsonb) from public.pn_payouts o),
      'rates', (select coalesce(jsonb_agg(to_jsonb(r) order by r.category, r.service, r.lead_source, r.effective_from desc), '[]'::jsonb) from public.pn_rates r),
      'disputed', (select count(*) from public.pn_commissions where status = 'disputed'));
  elsif p_what = 'agreements' then
    return (select coalesce(jsonb_agg(to_jsonb(a) || jsonb_build_object(
        'partner_name', (select display_name from public.pn_partners where id = a.partner_id),
        'partner_ref', (select partner_id from public.pn_partners where id = a.partner_id)) order by a.created_at desc), '[]'::jsonb) from public.pn_agreements a);
  elsif p_what = 'documents' then
    return (select coalesce(jsonb_agg(to_jsonb(d) || jsonb_build_object(
        'partner_name', (select display_name from public.pn_partners where id = d.partner_id)) order by d.expires_on nulls last), '[]'::jsonb)
        from public.pn_documents d where d.expires_on is not null);
  elsif p_what = 'activity' then
    return (select coalesce(jsonb_agg(to_jsonb(a) || jsonb_build_object(
        'partner_name', (select display_name from public.pn_partners where id = a.partner_id)) order by a.at desc), '[]'::jsonb)
        from (select * from public.pn_activity order by at desc limit 400) a);
  end if;
  -- summary
  return jsonb_build_object(
    'applications_new',  (select count(*) from public.pn_applications where stage in ('submitted','preliminary_review')),
    'applications_open', (select count(*) from public.pn_applications where stage not in ('activated','rejected','withdrawn')),
    'partners_active',   (select count(*) from public.pn_partners where status = 'active'),
    'partners_review',   (select count(*) from public.pn_partners where status in ('under_review','probation')),
    'partners_suspended',(select count(*) from public.pn_partners where status in ('suspended','terminated')),
    'territories_total', (select count(*) from public.pn_territories),
    'territories_open',  (select count(*) from public.pn_territories where status in ('available','additional_allowed')),
    'leads_waiting',     (select count(*) from public.pn_leads where stage in ('new','raqbo_review','returned')),
    'leads_assigned',    (select count(*) from public.pn_leads where stage = 'assigned'),
    'leads_overdue',     (select count(*) from public.pn_leads where stage = 'assigned' and accept_by < now()),
    'leads_open',        (select count(*) from public.pn_leads where stage not in ('completed','lost')),
    'commission_pending',(select coalesce(sum(amount), 0) from public.pn_commissions where status = 'pending'),
    'commission_approved',(select coalesce(sum(amount), 0) from public.pn_commissions where status = 'approved'),
    'commission_disputed',(select count(*) from public.pn_commissions where status = 'disputed'),
    'agreements_expiring',(select count(*) from public.pn_agreements where status = 'executed' and ends_on is not null and ends_on <= current_date + 60),
    'documents_expiring', (select count(*) from public.pn_documents where expires_on is not null and expires_on <= current_date + 30),
    'partner_listings',   (select count(*) from public.listings where partner_id is not null),
    'partner_listings_pending', (select count(*) from public.listings where partner_id is not null and status = 'pending')
  );
end $$;
grant execute on function public.pn_admin(text) to authenticated;

do $$ begin raise notice 'Update 30 applied. Partner photographs, customer feedback, franchise terms and listing takedown are in place.'; end $$;
