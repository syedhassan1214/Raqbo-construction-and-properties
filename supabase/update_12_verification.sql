-- =====================================================================
-- 19. RAQBO Verified listings
--     Free listings show "Unverified". An owner who pays the RAQBO
--     verification fee and whose documents pass RAQBO's check gets the
--     "RAQBO Verified" badge. Fee and on/off are in Admin → Growth.
-- Run after update_11_growth.sql. Safe to run more than once.
-- =====================================================================
alter table public.growth_settings add column if not exists verification_enabled boolean not null default true;
alter table public.growth_settings add column if not exists verification_fee int not null default 2000;
do $$ begin
  alter table public.growth_settings add constraint growth_settings_verification_fee_check check (verification_fee between 0 and 1000000);
exception when duplicate_object then null; end $$;

-- Private storage for ownership documents and fee screenshots (10 MB, images or PDF)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('verification-docs', 'verification-docs', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
-- Owners upload only into their own folder: <user id>/<listing id>/<file>; only the owner and admins can open them
drop policy if exists "verification-docs: upload own folder" on storage.objects;
create policy "verification-docs: upload own folder" on storage.objects
  for insert to authenticated with check (bucket_id = 'verification-docs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "verification-docs: owner or admin reads" on storage.objects;
create policy "verification-docs: owner or admin reads" on storage.objects
  for select using (bucket_id = 'verification-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
drop policy if exists "verification-docs: owner or admin deletes" on storage.objects;
create policy "verification-docs: owner or admin deletes" on storage.objects
  for delete using (bucket_id = 'verification-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

create table if not exists public.listing_verifications (
  listing_id     uuid primary key references public.listings (id) on delete cascade,
  owner_id       uuid not null references public.profiles (id) on delete cascade,
  status         text not null default 'submitted' check (status in ('submitted','verified','rejected','expired')),
  fee            int not null default 0,
  payment_method text not null default '' check (char_length(payment_method) <= 40),
  txn_id         text not null default '' check (char_length(txn_id) <= 80),
  payment_proof  text not null default '' check (char_length(payment_proof) <= 300),
  documents      jsonb not null default '[]'::jsonb,       -- [{"path": "...", "name": "...", "type": "..."}]
  owner_note     text not null default '' check (char_length(owner_note) <= 600),
  admin_note     text not null default '' check (char_length(admin_note) <= 600),
  submitted_at   timestamptz not null default now(),
  decided_at     timestamptz,
  decided_by     uuid references public.profiles (id) on delete set null
);
create index if not exists listing_verifications_status_idx on public.listing_verifications (status, submitted_at);
alter table public.listing_verifications enable row level security;
drop policy if exists "listing_verifications: own or admin" on public.listing_verifications;
create policy "listing_verifications: own or admin" on public.listing_verifications for select using (owner_id = auth.uid() or public.is_admin());
revoke insert, update, delete on public.listing_verifications from anon, authenticated;
grant select on public.listing_verifications to authenticated;

-- Owner applies (or re-applies) for the badge
create or replace function public.request_listing_verification(p_listing uuid, p_method text, p_txn text, p_proof text, p_docs jsonb, p_note text)
returns void language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); l public.listings; s public.growth_settings; v public.listing_verifications; d jsonb; nm text;
begin
  if me is null or not public.is_verified_user() then raise exception 'Please sign in first.'; end if;
  select * into s from public.growth_settings where id = 1;
  if not s.verification_enabled then raise exception 'RAQBO verification is not available right now.'; end if;
  select * into l from public.listings where id = p_listing;
  if l.id is null or l.owner_id is distinct from me or l.is_sample then raise exception 'You can verify only your own property.'; end if;
  if l.status = 'rejected' then raise exception 'This listing was rejected. Edit it and get it approved first.'; end if;
  select * into v from public.listing_verifications where listing_id = p_listing;
  if v.status = 'submitted' then raise exception 'Your documents are already with RAQBO for checking.'; end if;
  if v.status = 'verified' then raise exception 'This property is already RAQBO Verified.'; end if;
  if jsonb_typeof(p_docs) <> 'array' or jsonb_array_length(p_docs) = 0 then raise exception 'Please upload at least one ownership document.'; end if;
  if jsonb_array_length(p_docs) > 12 then raise exception 'Upload up to 12 documents.'; end if;
  for d in select * from jsonb_array_elements(p_docs) loop
    if coalesce(d->>'path', '') not like me::text || '/%' then raise exception 'Document upload not recognised. Please upload again.'; end if;
  end loop;
  if s.verification_fee > 0 then
    if coalesce(p_proof, '') not like me::text || '/%' then raise exception 'Please upload the screenshot of the verification fee payment.'; end if;
    if char_length(btrim(coalesce(p_method, ''))) = 0 then raise exception 'Choose how you paid the fee.'; end if;
  end if;
  insert into public.listing_verifications (listing_id, owner_id, status, fee, payment_method, txn_id, payment_proof, documents, owner_note, admin_note, submitted_at, decided_at, decided_by)
  values (l.id, me, 'submitted', s.verification_fee, left(btrim(coalesce(p_method, '')), 40), left(btrim(coalesce(p_txn, '')), 80), coalesce(p_proof, ''), p_docs, left(btrim(coalesce(p_note, '')), 600), '', now(), null, null)
  on conflict (listing_id) do update set status = 'submitted', fee = excluded.fee, payment_method = excluded.payment_method, txn_id = excluded.txn_id,
     payment_proof = excluded.payment_proof, documents = excluded.documents, owner_note = excluded.owner_note, admin_note = '', submitted_at = now(), decided_at = null, decided_by = null;
  select coalesce(nullif(full_name, ''), 'A member') into nm from public.profiles where id = me;
  perform public.notify_admins('listing', 'Verification request: ' || left(l.title, 100), nm || ' · ' || l.ref || ' · fee Rs ' || s.verification_fee || ' · ' || jsonb_array_length(p_docs) || ' document(s)', '#admin/verify');
end $$;
grant execute on function public.request_listing_verification(uuid, text, text, text, jsonb, text) to authenticated;

-- Admin decides
create or replace function public.admin_decide_verification(p_listing uuid, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = public
as $$
declare v public.listing_verifications; l public.listings;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  update public.listing_verifications set status = case when p_approve then 'verified' else 'rejected' end,
         admin_note = left(btrim(coalesce(p_note, '')), 600), decided_at = now(), decided_by = auth.uid()
   where listing_id = p_listing and status = 'submitted' returning * into v;
  if v.listing_id is null then raise exception 'This request was already handled.'; end if;
  select * into l from public.listings where id = p_listing;
  perform public.notify(v.owner_id, 'listing',
    case when p_approve then '✓ Your property is RAQBO Verified' else 'Verification not approved' end,
    left(l.title, 100) || ' · ' || coalesce(nullif(btrim(p_note), ''), case when p_approve then 'The RAQBO Verified badge now shows on your listing.' else 'Open My account to see the reason and apply again.' end),
    case when p_approve then '#property/' || l.id else '#account' end);
end $$;
grant execute on function public.admin_decide_verification(uuid, boolean, text) to authenticated;

-- Requests for the admin panel (with owner contact details)
create or replace function public.admin_verifications()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('listing_id', v.listing_id, 'status', v.status, 'fee', v.fee, 'payment_method', v.payment_method, 'txn_id', v.txn_id,
           'payment_proof', v.payment_proof, 'documents', v.documents, 'owner_note', v.owner_note, 'admin_note', v.admin_note, 'submitted_at', v.submitted_at, 'decided_at', v.decided_at,
           'title', l.title, 'ref', l.ref, 'city', l.city, 'area', l.area, 'listing_status', l.status, 'advertiser_role', l.advertiser_role,
           'owner', coalesce(nullif(p.full_name, ''), p.email), 'phone', p.phone, 'email', p.email)
           order by (v.status = 'submitted') desc, v.submitted_at desc)
         from public.listing_verifications v join public.listings l on l.id = v.listing_id left join public.profiles p on p.id = v.owner_id), '[]'::jsonb);
end $$;
grant execute on function public.admin_verifications() to authenticated;

-- If the owner changes what was checked (type, city, area, size), the badge comes off until checked again
create or replace function public.listings_verification_reset()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if (new.property_type, new.city, new.area, new.size, new.size_unit) is distinct from (old.property_type, old.city, old.area, old.size, old.size_unit) then
    update public.listing_verifications set status = 'expired', admin_note = 'Property details changed — please apply again.' where listing_id = new.id and status in ('verified', 'submitted');
    if found and new.owner_id is not null then
      perform public.notify(new.owner_id, 'listing', 'RAQBO Verified badge removed', left(new.title, 100) || ': the property details changed, so RAQBO needs to check the documents again.', '#account');
    end if;
  end if;
  return null;
end $$;
drop trigger if exists listings_verification_reset on public.listings;
create trigger listings_verification_reset after update on public.listings for each row execute function public.listings_verification_reset();

-- Public campaign data now includes verified listings and the fee
create or replace function public.growth_public()
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'campaign_on', s.campaign_on, 'title', s.campaign_title, 'tagline', s.campaign_tagline, 'cta', s.campaign_cta,
    'founding_enabled', s.founding_enabled, 'founding_cap', s.founding_cap, 'founding_taken', (select count(*) from public.profiles where founding_no is not null),
    'founding_discount_pct', s.founding_discount_pct, 'founding_discount_max', s.founding_discount_max,
    'referral_enabled', s.referral_enabled, 'referral_member_credit', s.referral_member_credit, 'referral_owner_credit', s.referral_owner_credit,
    'featured_trial_enabled', s.featured_trial_enabled, 'featured_trial_days', s.featured_trial_days, 'pilot_cities', to_jsonb(s.pilot_cities), 'credit_expiry_days', s.credit_expiry_days,
    'verification_enabled', s.verification_enabled, 'verification_fee', s.verification_fee,
    'verified', coalesce((select jsonb_agg(v.listing_id) from public.listing_verifications v join public.listings l on l.id = v.listing_id and l.status = 'published' where v.status = 'verified'), '[]'::jsonb),
    'featured', coalesce((select jsonb_agg(f.listing_id) from public.listing_features f join public.listings l on l.id = f.listing_id and l.status = 'published' where f.until > now()), '[]'::jsonb))
  from public.growth_settings s where s.id = 1
$$;
grant execute on function public.growth_public() to anon, authenticated;

-- Admin settings now include verification on/off and fee
create or replace function public.admin_save_growth(p jsonb)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  update public.growth_settings set
    campaign_on = coalesce((p->>'campaign_on')::boolean, campaign_on),
    campaign_title = coalesce(nullif(btrim(p->>'campaign_title'), ''), campaign_title),
    campaign_tagline = coalesce(p->>'campaign_tagline', campaign_tagline),
    campaign_cta = coalesce(p->>'campaign_cta', campaign_cta),
    founding_enabled = coalesce((p->>'founding_enabled')::boolean, founding_enabled),
    founding_cap = coalesce((p->>'founding_cap')::int, founding_cap),
    founding_discount_pct = coalesce((p->>'founding_discount_pct')::int, founding_discount_pct),
    founding_discount_max = coalesce((p->>'founding_discount_max')::int, founding_discount_max),
    referral_enabled = coalesce((p->>'referral_enabled')::boolean, referral_enabled),
    referral_member_credit = coalesce((p->>'referral_member_credit')::int, referral_member_credit),
    referral_owner_credit = coalesce((p->>'referral_owner_credit')::int, referral_owner_credit),
    referral_review = coalesce((p->>'referral_review')::boolean, referral_review),
    referral_monthly_cap = coalesce((p->>'referral_monthly_cap')::int, referral_monthly_cap),
    credit_expiry_days = coalesce((p->>'credit_expiry_days')::int, credit_expiry_days),
    featured_trial_enabled = coalesce((p->>'featured_trial_enabled')::boolean, featured_trial_enabled),
    featured_trial_days = coalesce((p->>'featured_trial_days')::int, featured_trial_days),
    pilot_cities = case when p ? 'pilot_cities' then array(select btrim(x) from jsonb_array_elements_text(p->'pilot_cities') x where btrim(x) <> '') else pilot_cities end,
    budget_total = coalesce((p->>'budget_total')::bigint, budget_total),
    verification_enabled = coalesce((p->>'verification_enabled')::boolean, verification_enabled),
    verification_fee = coalesce((p->>'verification_fee')::int, verification_fee),
    updated_at = now()
  where id = 1;
end $$;
grant execute on function public.admin_save_growth(jsonb) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'listing_verifications') then
    alter publication supabase_realtime add table public.listing_verifications;
  end if;
end $$;
