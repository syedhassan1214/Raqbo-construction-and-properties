-- Apply after update 38. Scope sensitive rental, legal, tax and identity access.

drop policy if exists "identity_checks: own or admin" on public.identity_checks;
create policy "identity_checks: own or admin" on public.identity_checks for select
  using (user_id = auth.uid() or public.has_perm('verification'));
drop policy if exists "identity-docs: owner or admin reads" on storage.objects;
create policy "identity-docs: owner or admin reads" on storage.objects for select
  using (bucket_id = 'identity-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.has_perm('verification')));

drop policy if exists "rm_properties: own or admin" on public.rm_properties;
create policy "rm_properties: own or admin" on public.rm_properties for select
  using (owner_id = auth.uid() or public.has_perm('services'));
drop policy if exists "rm_tenants: own, linked or admin" on public.rm_tenants;
create policy "rm_tenants: own, linked or admin" on public.rm_tenants for select
  using (owner_id = auth.uid() or user_id = auth.uid() or public.has_perm('services'));
drop policy if exists "rm_tenancies: parties or admin" on public.rm_tenancies;
create policy "rm_tenancies: parties or admin" on public.rm_tenancies for select using (
  owner_id = auth.uid() or public.has_perm('services') or exists
    (select 1 from public.rm_tenants t where t.id = tenant_id and t.user_id = auth.uid()));
drop policy if exists "rm_rent: parties or admin" on public.rm_rent;
create policy "rm_rent: parties or admin" on public.rm_rent for select using (
  owner_id = auth.uid() or public.has_perm('services') or exists
    (select 1 from public.rm_tenancies y join public.rm_tenants t on t.id = y.tenant_id where y.id = tenancy_id and t.user_id = auth.uid()));
drop policy if exists "rm_expenses: own or admin" on public.rm_expenses;
create policy "rm_expenses: own or admin" on public.rm_expenses for select
  using (owner_id = auth.uid() or public.has_perm('services'));
drop policy if exists "rm_maintenance: parties or admin" on public.rm_maintenance;
create policy "rm_maintenance: parties or admin" on public.rm_maintenance for select using (
  owner_id = auth.uid() or raised_by = auth.uid() or public.has_perm('services') or exists
    (select 1 from public.rm_tenancies y join public.rm_tenants t on t.id = y.tenant_id where y.id = tenancy_id and t.user_id = auth.uid()));
drop policy if exists "rm_documents: own or admin" on public.rm_documents;
create policy "rm_documents: own or admin" on public.rm_documents for select
  using (owner_id = auth.uid() or public.has_perm('services'));
drop policy if exists "rental-docs: owner or admin reads" on storage.objects;
create policy "rental-docs: owner or admin reads" on storage.objects for select
  using (bucket_id = 'rental-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.has_perm('services')));

drop policy if exists "ts_checks: parties or admin" on public.ts_checks;
create policy "ts_checks: parties or admin" on public.ts_checks for select
  using (owner_id = auth.uid() or tenant_user = auth.uid() or public.has_perm('verification'));
drop policy if exists "lawyers: public verified, own, admin" on public.lawyers;
create policy "lawyers: public verified, own, admin" on public.lawyers for select
  using ((status = 'verified' and active) or user_id = auth.uid() or public.is_full_admin());
revoke select on public.lawyers from public, anon, authenticated;
grant select (id, name, qualification, enrolment_no, bar_council, years, city, languages,
  specialities, profile, fee, modes, photo, status, active) on public.lawyers to anon;
grant select (id, user_id, name, qualification, enrolment_no, bar_council, years, city, languages,
  specialities, profile, fee, modes, photo, status, active, verified_at, created_at, updated_at)
  on public.lawyers to authenticated;
drop policy if exists "legal_appointments: parties or admin" on public.legal_appointments;
create policy "legal_appointments: parties or admin" on public.legal_appointments for select using (
  user_id = auth.uid() or public.is_full_admin() or exists
    (select 1 from public.lawyers l where l.id = lawyer_id and l.user_id = auth.uid()));

drop policy if exists "tax_rates: read active" on public.tax_rates;
create policy "tax_rates: read active" on public.tax_rates for select using (active or public.has_perm('settings'));
drop policy if exists "tax_rate_history: admin" on public.tax_rate_history;
create policy "tax_rate_history: admin" on public.tax_rate_history for select using (public.has_perm('settings'));

create or replace function public.ts_admin_update(p_ref text, p_status text, p_verified jsonb, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.ts_checks;
begin
  if not public.has_perm('verification') then raise exception 'You do not have permission to update a screening.'; end if;
  select * into c from public.ts_checks where ref = p_ref for update;
  if c.id is null then raise exception 'Screening request not found.'; end if;
  if p_status in ('in_progress','completed') and not c.consent then raise exception 'The tenant has not given consent. Nothing may be verified without it.'; end if;
  update public.ts_checks set status = p_status, verified = coalesce(p_verified, verified), report_note = left(coalesce(p_note, ''), 3000),
    completed_at = case when p_status = 'completed' then now() else completed_at end, updated_at = now() where id = c.id;
  perform public.audit('tenant_screening.' || p_status, 'ts_check', c.ref, p_note, null);
  if p_status = 'completed' then perform public.notify(c.owner_id, 'system', 'Tenant verification report ready', left(c.tenant_name, 200), '#my/landlord'); end if;
end $$;

create or replace function public.admin_set_lawyer(p_id uuid, p_status text, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare l public.lawyers;
begin
  if not public.is_full_admin() then raise exception 'Only a full admin can verify a legal professional.'; end if;
  if p_status not in ('verified','rejected','suspended','pending') then raise exception 'Unknown status.'; end if;
  if p_status in ('rejected','suspended') and char_length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'Give the reason.'; end if;
  select * into l from public.lawyers where id = p_id for update;
  if l.id is null then raise exception 'Not found.'; end if;
  if p_status = 'verified' and (l.enrolment_no = '' or l.bar_council = '') then raise exception 'Record the bar council and enrolment number before verifying.'; end if;
  update public.lawyers set status = p_status, admin_note = coalesce(p_note, ''), verified_at = case when p_status = 'verified' then now() else verified_at end, updated_at = now() where id = p_id;
  perform public.audit('lawyer.' || p_status, 'lawyer', l.name, p_note, null);
  if l.user_id is not null then perform public.notify(l.user_id, 'system', case p_status when 'verified' then 'Your legal profile is approved' when 'rejected' then 'Legal profile not approved' else 'Legal profile updated' end, left(coalesce(p_note, ''), 400), '#my/lawyer'); end if;
end $$;

create or replace function public.legal_update(p_ref text, p_status text, p_confirmed timestamptz, p_note text, p_fee_status text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a public.legal_appointments; is_lawyer boolean;
begin
  select * into a from public.legal_appointments where ref = p_ref for update;
  if a.id is null then raise exception 'Appointment not found.'; end if;
  is_lawyer := exists (select 1 from public.lawyers l where l.id = a.lawyer_id and l.user_id = auth.uid());
  if not (is_lawyer or public.is_full_admin()) then raise exception 'Only a full admin or the legal professional can update this appointment.'; end if;
  if p_status not in ('requested','confirmed','completed','cancelled','no_show') then raise exception 'Unknown status.'; end if;
  update public.legal_appointments set status = p_status, confirmed_at = coalesce(p_confirmed, confirmed_at),
    admin_note = left(coalesce(p_note, admin_note), 600), fee_status = coalesce(nullif(p_fee_status, ''), fee_status), updated_at = now() where id = a.id;
  perform public.notify(a.user_id, 'system', 'Legal consultation ' || p_status, left(a.ref || case when p_confirmed is not null then ' · ' || to_char(p_confirmed at time zone 'Asia/Karachi', 'DD Mon YYYY HH24:MI') else '' end, 400), '#my/legal');
end $$;

create or replace function public.admin_save_tax_rate(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  if not public.has_perm('settings') then raise exception 'You do not have permission to change tax rates.'; end if;
  if nullif(p->>'id', '') is null then
    insert into public.tax_rates (province, district, prop_category, effective_from, effective_to, stamp_duty_pct, registration_pct, registration_flat, local_fee_pct,
      buyer_tax_filer_pct, buyer_tax_nonfiler_pct, seller_tax_filer_pct, seller_tax_nonfiler_pct, other_pct, basis, source_note, created_by)
    values (coalesce(nullif(p->>'province', ''), 'Punjab'), coalesce(p->>'district', ''), coalesce(nullif(p->>'prop_category', ''), 'any'),
      coalesce(nullif(p->>'effective_from', '')::date, (now() at time zone 'Asia/Karachi')::date), nullif(p->>'effective_to', '')::date,
      coalesce(nullif(p->>'stamp_duty_pct', '')::numeric, 0), coalesce(nullif(p->>'registration_pct', '')::numeric, 0), coalesce(nullif(p->>'registration_flat', '')::bigint, 0),
      coalesce(nullif(p->>'local_fee_pct', '')::numeric, 0), coalesce(nullif(p->>'buyer_tax_filer_pct', '')::numeric, 0), coalesce(nullif(p->>'buyer_tax_nonfiler_pct', '')::numeric, 0),
      coalesce(nullif(p->>'seller_tax_filer_pct', '')::numeric, 0), coalesce(nullif(p->>'seller_tax_nonfiler_pct', '')::numeric, 0), coalesce(nullif(p->>'other_pct', '')::numeric, 0),
      coalesce(nullif(p->>'basis', ''), 'higher'), coalesce(p->>'source_note', ''), auth.uid())
    returning id into v;
  else
    update public.tax_rates set province = coalesce(nullif(p->>'province', ''), province), district = coalesce(p->>'district', district),
      prop_category = coalesce(nullif(p->>'prop_category', ''), prop_category), effective_from = coalesce(nullif(p->>'effective_from', '')::date, effective_from),
      effective_to = nullif(p->>'effective_to', '')::date, stamp_duty_pct = coalesce(nullif(p->>'stamp_duty_pct', '')::numeric, stamp_duty_pct),
      registration_pct = coalesce(nullif(p->>'registration_pct', '')::numeric, registration_pct), registration_flat = coalesce(nullif(p->>'registration_flat', '')::bigint, registration_flat),
      local_fee_pct = coalesce(nullif(p->>'local_fee_pct', '')::numeric, local_fee_pct), buyer_tax_filer_pct = coalesce(nullif(p->>'buyer_tax_filer_pct', '')::numeric, buyer_tax_filer_pct),
      buyer_tax_nonfiler_pct = coalesce(nullif(p->>'buyer_tax_nonfiler_pct', '')::numeric, buyer_tax_nonfiler_pct), seller_tax_filer_pct = coalesce(nullif(p->>'seller_tax_filer_pct', '')::numeric, seller_tax_filer_pct),
      seller_tax_nonfiler_pct = coalesce(nullif(p->>'seller_tax_nonfiler_pct', '')::numeric, seller_tax_nonfiler_pct), other_pct = coalesce(nullif(p->>'other_pct', '')::numeric, other_pct),
      basis = coalesce(nullif(p->>'basis', ''), basis), source_note = coalesce(p->>'source_note', source_note), active = coalesce((p->>'active')::boolean, active)
    where id = (p->>'id')::bigint returning id into v;
    if v is null then raise exception 'Rate row not found.'; end if;
  end if;
  insert into public.tax_rate_history (actor_name, action, data)
    values (coalesce((select coalesce(nullif(full_name, ''), email) from public.profiles where id = auth.uid()), 'system'), case when nullif(p->>'id', '') is null then 'added' else 'changed' end, p);
  perform public.audit('tax_rate.save', 'tax_rate', v::text, coalesce(p->>'source_note', ''), p);
  return v;
end $$;

create or replace function public.rm_admin(p_what text default 'summary')
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if p_what = 'properties' and not public.has_perm('services')
    or p_what = 'screening' and not public.has_perm('verification')
    or p_what = 'legal' and not public.is_full_admin()
    or p_what = 'commercial' and not public.has_perm('listings')
    or p_what = 'tax' and not public.has_perm('settings')
    or p_what = 'summary' and not (public.has_perm('services') or public.has_perm('verification') or public.has_perm('listings') or public.has_perm('settings'))
    or p_what is null or p_what not in ('properties','screening','legal','commercial','tax','summary') then
    raise exception 'You do not have permission to see this section.';
  end if;
  if p_what = 'properties' then
    return coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object('owner', (select coalesce(nullif(full_name, ''), email) from public.profiles where id = p.owner_id),
      'tenancies', (select count(*) from public.rm_tenancies y where y.property_id = p.id and y.status = 'active')) order by p.created_at desc)
      from public.rm_properties p where p.managed_by = 'raqbo' or p.mgmt_status <> 'none'), '[]'::jsonb);
  elsif p_what = 'screening' then
    return coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object('owner', (select coalesce(nullif(full_name, ''), email) from public.profiles where id = c.owner_id)) order by c.created_at desc)
      from public.ts_checks c limit 300), '[]'::jsonb);
  elsif p_what = 'legal' then
    return jsonb_build_object(
      'lawyers', coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at desc) from public.lawyers l), '[]'::jsonb),
      'appointments', coalesce((select jsonb_agg(to_jsonb(a) || jsonb_build_object('who', (select coalesce(nullif(full_name, ''), email) from public.profiles where id = a.user_id),
         'lawyer', (select name from public.lawyers where id = a.lawyer_id)) order by a.created_at desc) from public.legal_appointments a limit 300), '[]'::jsonb));
  elsif p_what = 'commercial' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'ref', l.ref, 'title', l.title, 'kind', l.commercial_kind, 'purpose', l.purpose,
        'city', l.city, 'area', l.area, 'price', l.price, 'status', l.status, 'created_at', l.created_at,
        'enquiries', (select count(*) from public.enquiries e where e.property_ref = l.ref),
        'visits', (select count(*) from public.inspections v where v.listing_id = l.id)) order by l.created_at desc)
      from public.listings l where l.commercial_kind is not null or l.property_type = 'Commercial'), '[]'::jsonb);
  elsif p_what = 'tax' then
    return jsonb_build_object('rates', coalesce((select jsonb_agg(to_jsonb(t) order by t.province, t.district, t.effective_from desc) from public.tax_rates t), '[]'::jsonb),
      'history', coalesce((select jsonb_agg(to_jsonb(h) order by h.at desc) from public.tax_rate_history h limit 100), '[]'::jsonb));
  end if;
  return jsonb_build_object(
    'rm_properties', case when public.has_perm('services') then (select count(*) from public.rm_properties) end,
    'rm_managed', case when public.has_perm('services') then (select count(*) from public.rm_properties where managed_by = 'raqbo' and mgmt_status = 'active') end,
    'rm_requested', case when public.has_perm('services') then (select count(*) from public.rm_properties where mgmt_status = 'requested') end,
    'tenancies_active', case when public.has_perm('services') then (select count(*) from public.rm_tenancies where status = 'active') end,
    'rent_overdue_n', case when public.has_perm('services') then (select count(*) from public.rm_rent where status = 'overdue') end,
    'screening_open', case when public.has_perm('verification') then (select count(*) from public.ts_checks where status in ('awaiting_consent','consented','in_progress')) end,
    'lawyers_pending', case when public.is_full_admin() then (select count(*) from public.lawyers where status = 'pending') end,
    'appointments_open', case when public.is_full_admin() then (select count(*) from public.legal_appointments where status in ('requested','confirmed')) end,
    'commercial_live', case when public.has_perm('listings') then (select count(*) from public.listings where status = 'published' and (commercial_kind is not null or property_type = 'Commercial')) end,
    'maintenance_open', case when public.has_perm('services') then (select count(*) from public.rm_maintenance where status in ('open','in_progress')) end);
end $$;

create or replace function public.admin_set_managed(p_id uuid, p_status text, p_fee numeric default null)
returns void language plpgsql security definer set search_path = public as $$
declare p public.rm_properties;
begin
  if not public.has_perm('services') then raise exception 'You do not have permission to manage rental properties.'; end if;
  if p_status not in ('none','requested','active','ended') then raise exception 'Unknown status.'; end if;
  update public.rm_properties set mgmt_status = p_status, managed_by = case when p_status in ('active','requested') then 'raqbo' else 'self' end,
    mgmt_fee_pct = coalesce(p_fee, mgmt_fee_pct), updated_at = now() where id = p_id returning * into p;
  if p.id is null then raise exception 'Property not found.'; end if;
  perform public.audit('rm.managed_' || p_status, 'rm_property', p.ref, '', null);
  perform public.notify(p.owner_id, 'system', 'RAQBO property management ' || p_status, left(p.title, 200), '#my/landlord');
end $$;

revoke all on function public.ts_admin_update(text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.admin_set_lawyer(uuid, text, text) from public, anon, authenticated;
revoke all on function public.legal_update(text, text, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.admin_save_tax_rate(jsonb) from public, anon, authenticated;
revoke all on function public.rm_admin(text) from public, anon, authenticated;
revoke all on function public.admin_set_managed(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.ts_admin_update(text, text, jsonb, text) to authenticated;
grant execute on function public.admin_set_lawyer(uuid, text, text) to authenticated;
grant execute on function public.legal_update(text, text, timestamptz, text, text) to authenticated;
grant execute on function public.admin_save_tax_rate(jsonb) to authenticated;
grant execute on function public.rm_admin(text) to authenticated;
grant execute on function public.admin_set_managed(uuid, text, numeric) to authenticated;
