-- =====================================================================
-- 20. Core upgrades (client review, first priority)
--     Business settings · admin permissions + audit log · Property Passport
--     fields · RAQBO Direct roles · identity checks · verification levels
--     with "what was checked and when" · service request tracking ·
--     bank statement reconciliation
-- Run after update_12_verification.sql. Safe to run more than once.
-- =====================================================================

-- ---------- Business settings (one row, edited in Admin → Business settings) ----------
create table if not exists public.platform_settings (
  id                             int primary key default 1 check (id = 1),
  legal_verification_fee         int not null default 10000 check (legal_verification_fee between 0 and 10000000),
  identity_checks_enabled        boolean not null default true,
  urgent_enabled                 boolean not null default true,
  urgent_commission_pct          numeric(5,2) not null default 2 check (urgent_commission_pct between 0 and 50),
  investors_enabled              boolean not null default true,
  offer_valid_days               int not null default 14 check (offer_valid_days between 1 and 180),
  auctions_enabled               boolean not null default true,
  auction_buyer_premium_pct      numeric(5,2) not null default 1 check (auction_buyer_premium_pct between 0 and 50),
  auction_seller_commission_pct  numeric(5,2) not null default 2 check (auction_seller_commission_pct between 0 and 50),
  auction_default_increment      bigint not null default 100000 check (auction_default_increment > 0),
  auction_deposit_default        bigint not null default 200000 check (auction_deposit_default >= 0),
  auction_extension_window_min   int not null default 5 check (auction_extension_window_min between 0 and 120),
  auction_extension_min          int not null default 5 check (auction_extension_min between 0 and 120),
  auction_max_extensions         int not null default 12 check (auction_max_extensions between 0 and 500),
  bidder_auto_approve            boolean not null default false,
  updated_at                     timestamptz not null default now()
);
insert into public.platform_settings (id) values (1) on conflict (id) do nothing;
alter table public.platform_settings enable row level security;
drop policy if exists "platform_settings: read" on public.platform_settings;
create policy "platform_settings: read" on public.platform_settings for select using (true);
grant select on public.platform_settings to anon, authenticated;

-- ---------- Admin permissions and audit log ----------
alter table public.profiles add column if not exists admin_perms text[];   -- null = full admin; otherwise only these areas
create or replace function public.has_perm(p text)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and (admin_perms is null or p = any(admin_perms))) $$;
create or replace function public.is_full_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and admin_perms is null) $$;

create table if not exists public.admin_audit (
  id         bigint generated always as identity primary key,
  actor_id   uuid references public.profiles (id) on delete set null,
  actor_name text not null default '',
  action     text not null,
  entity     text not null default '',
  entity_ref text not null default '',
  reason     text not null default '',
  data       jsonb not null default '{}'::jsonb,
  at         timestamptz not null default now()
);
create index if not exists admin_audit_at_idx on public.admin_audit (at desc);
alter table public.admin_audit enable row level security;
drop policy if exists "admin_audit: admins read" on public.admin_audit;
create policy "admin_audit: admins read" on public.admin_audit for select using (public.is_admin());
revoke insert, update, delete on public.admin_audit from anon, authenticated;
grant select on public.admin_audit to authenticated;
-- the log can only grow: no one may edit or delete a line
create or replace function public.admin_audit_lock() returns trigger language plpgsql as $$ begin raise exception 'The audit log cannot be changed.'; end $$;
drop trigger if exists admin_audit_lock on public.admin_audit;
create trigger admin_audit_lock before update or delete on public.admin_audit for each row execute function public.admin_audit_lock();

create or replace function public.audit(p_action text, p_entity text, p_ref text, p_reason text, p_data jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public
as $$
begin
  insert into public.admin_audit (actor_id, actor_name, action, entity, entity_ref, reason, data)
  values (auth.uid(), coalesce((select coalesce(nullif(full_name, ''), email) from public.profiles where id = auth.uid()), 'system'), p_action, coalesce(p_entity, ''), coalesce(p_ref, ''), left(coalesce(p_reason, ''), 600), coalesce(p_data, '{}'::jsonb));
end $$;
revoke all on function public.audit(text, text, text, text, jsonb) from public, anon, authenticated;

create or replace function public.admin_team()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', full_name, 'email', email, 'perms', to_jsonb(admin_perms), 'me', id = auth.uid()) order by full_name) from public.profiles where role = 'admin'), '[]'::jsonb);
end $$;
grant execute on function public.admin_team() to authenticated;

create or replace function public.admin_set_admin(p_email text, p_admin boolean, p_perms text[], p_reason text)
returns void language plpgsql security definer set search_path = public
as $$
declare u public.profiles;
begin
  if not public.is_full_admin() then raise exception 'Only a full admin can change the admin team.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Please give a reason (it is kept in the audit log).'; end if;
  select * into u from public.profiles where lower(email) = lower(btrim(p_email));
  if u.id is null then raise exception 'No member with that email. They must create an account first.'; end if;
  if u.id = auth.uid() and (not p_admin or p_perms is not null) then raise exception 'You cannot remove or limit your own admin access.'; end if;
  if p_perms is not null and exists (select 1 from unnest(p_perms) x where x not in ('listings','verification','finance','urgent','auctions','investors','growth','settings','services')) then raise exception 'Unknown permission.'; end if;
  update public.profiles set role = case when p_admin then 'admin' else 'user' end, admin_perms = case when p_admin then p_perms end where id = u.id;
  perform public.audit(case when p_admin then 'admin.grant' else 'admin.revoke' end, 'member', u.email, p_reason, jsonb_build_object('perms', to_jsonb(p_perms)));
end $$;
grant execute on function public.admin_set_admin(text, boolean, text[], text) to authenticated;

-- ---------- Generic settings save (whitelisted columns) ----------
create or replace function public.admin_save_platform(p jsonb, p_reason text default '')
returns void language plpgsql security definer set search_path = public
as $$
declare k text; allowed text[] := array['legal_verification_fee','identity_checks_enabled','urgent_enabled','urgent_commission_pct','investors_enabled','offer_valid_days','auctions_enabled','auction_buyer_premium_pct','auction_seller_commission_pct','auction_default_increment','auction_deposit_default','auction_extension_window_min','auction_extension_min','auction_max_extensions','bidder_auto_approve'];
begin
  if not public.has_perm('settings') then raise exception 'You do not have permission to change business settings.'; end if;
  for k in select jsonb_object_keys(p) loop
    if k = any(allowed) then execute format('update public.platform_settings set %I = $1::text::%s, updated_at = now() where id = 1', k,
        (select format_type(a.atttypid, a.atttypmod) from pg_attribute a where a.attrelid = 'public.platform_settings'::regclass and a.attname = k)) using (p ->> k); end if;
  end loop;
  perform public.audit('settings.business', 'settings', 'platform', p_reason, p);
end $$;
grant execute on function public.admin_save_platform(jsonb, text) to authenticated;

-- ---------- Listings: sale type, visibility, RAQBO role, Property Passport fields ----------
alter table public.listings add column if not exists sale_mode text not null default 'normal';
alter table public.listings add column if not exists channel text not null default 'public';
alter table public.listings add column if not exists raqbo_role text;
alter table public.listings add column if not exists raqbo_role_note text not null default '';
alter table public.listings add column if not exists covered_area numeric;
alter table public.listings add column if not exists covered_unit text;
alter table public.listings add column if not exists possession text;
alter table public.listings add column if not exists utilities text[] not null default '{}';
alter table public.listings add column if not exists approved_plan text;
alter table public.listings add column if not exists encumbrance text;
do $$ begin alter table public.listings add constraint listings_sale_mode_check check (sale_mode in ('normal','urgent','auction')); exception when duplicate_object then null; end $$;
do $$ begin alter table public.listings add constraint listings_channel_check check (channel in ('public','investors','private')); exception when duplicate_object then null; end $$;
do $$ begin alter table public.listings add constraint listings_raqbo_role_check check (raqbo_role is null or raqbo_role in ('owner','purchaser','agent','facilitator')); exception when duplicate_object then null; end $$;
do $$ begin alter table public.listings add constraint listings_possession_check check (possession is null or possession in ('vacant','owner_occupied','tenanted','under_construction')); exception when duplicate_object then null; end $$;
do $$ begin alter table public.listings add constraint listings_approved_plan_check check (approved_plan is null or approved_plan in ('yes','no','not_applicable','unknown')); exception when duplicate_object then null; end $$;
do $$ begin alter table public.listings add constraint listings_encumbrance_check check (encumbrance is null or encumbrance in ('none','mortgage','dispute','dues','other','unknown')); exception when duplicate_object then null; end $$;
do $$ begin alter table public.listings add constraint listings_covered_unit_check check (covered_unit is null or covered_unit in ('sq ft','sq yd','Marla','Kanal')); exception when duplicate_object then null; end $$;
create index if not exists listings_sale_mode_idx on public.listings (sale_mode, status);

-- Members cannot set RAQBO's role or turn a listing into an auction themselves
create or replace function public.listings_zz_protect()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  new.utilities := coalesce(array(select distinct x from unnest(new.utilities) x where x in ('electricity','gas','water','sewerage','internet','phone')), '{}');
  if auth.uid() is not null and not public.is_admin() and coalesce(current_setting('raqbo.sys', true), '') <> '1' then
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
drop trigger if exists listings_zz_protect on public.listings;
create trigger listings_zz_protect before insert or update on public.listings for each row execute function public.listings_zz_protect();

-- Investors (full facility in update_14). Defined here so listing visibility can refer to it.
create table if not exists public.investor_profiles (
  user_id         uuid primary key references public.profiles (id) on delete cascade,
  status          text not null default 'pending' check (status in ('pending','approved','rejected','suspended')),
  investor_name   text not null default '' check (char_length(investor_name) <= 120),
  company         text not null default '' check (char_length(company) <= 120),
  budget_min      bigint check (budget_min >= 0),
  budget_max      bigint check (budget_max >= 0),
  cities          text[] not null default '{}',
  categories      text[] not null default '{}',     -- residential, commercial
  property_types  text[] not null default '{}',     -- House, Apartment, Plot, Commercial
  objectives      text not null default '' check (char_length(objectives) <= 600),
  capacity_docs   jsonb not null default '[]'::jsonb,
  admin_note      text not null default '' check (char_length(admin_note) <= 600),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  approved_at     timestamptz,
  approved_by     uuid references public.profiles (id) on delete set null
);
alter table public.investor_profiles enable row level security;
drop policy if exists "investor_profiles: own or admin" on public.investor_profiles;
create policy "investor_profiles: own or admin" on public.investor_profiles for select using (user_id = auth.uid() or public.is_admin());
revoke insert, update, delete on public.investor_profiles from anon, authenticated;
grant select on public.investor_profiles to authenticated;
create or replace function public.is_approved_investor()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.investor_profiles where user_id = auth.uid() and status = 'approved') $$;

-- Visibility: public listings for everyone; investor-only listings for approved investors; private ones for the owner and RAQBO
drop policy if exists "listings: read" on public.listings;
create policy "listings: read" on public.listings
  for select using (
    (status = 'published' and (channel = 'public' or (channel = 'investors' and public.is_approved_investor())))
    or owner_id = auth.uid() or public.is_admin());

create or replace function public.admin_set_raqbo_role(p_listing uuid, p_role text, p_note text, p_reason text)
returns void language plpgsql security definer set search_path = public
as $$
declare l public.listings;
begin
  if not public.has_perm('listings') then raise exception 'You do not have permission to change listings.'; end if;
  if nullif(p_role, '') is not null and p_role not in ('owner','purchaser','agent','facilitator') then raise exception 'Unknown RAQBO role.'; end if;
  perform set_config('raqbo.sys', '1', true);
  update public.listings set raqbo_role = nullif(p_role, ''), raqbo_role_note = left(btrim(coalesce(p_note, '')), 300) where id = p_listing returning * into l;
  perform set_config('raqbo.sys', '', true);
  if l.id is null then raise exception 'Listing not found.'; end if;
  perform public.audit('listing.raqbo_role', 'listing', l.ref, p_reason, jsonb_build_object('role', p_role, 'note', p_note));
end $$;
grant execute on function public.admin_set_raqbo_role(uuid, text, text, text) to authenticated;

-- ---------- Identity checks (CNIC) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('identity-docs', 'identity-docs', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "identity-docs: upload own folder" on storage.objects;
create policy "identity-docs: upload own folder" on storage.objects for insert to authenticated with check (bucket_id = 'identity-docs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "identity-docs: owner or admin reads" on storage.objects;
create policy "identity-docs: owner or admin reads" on storage.objects for select using (bucket_id = 'identity-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

create table if not exists public.identity_checks (
  user_id       uuid primary key references public.profiles (id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending','verified','rejected')),
  name_on_cnic  text not null default '' check (char_length(name_on_cnic) <= 120),
  files         jsonb not null default '[]'::jsonb,
  admin_note    text not null default '' check (char_length(admin_note) <= 600),
  submitted_at  timestamptz not null default now(),
  checked_at    timestamptz,
  checked_by    uuid references public.profiles (id) on delete set null
);
alter table public.identity_checks enable row level security;
drop policy if exists "identity_checks: own or admin" on public.identity_checks;
create policy "identity_checks: own or admin" on public.identity_checks for select using (user_id = auth.uid() or public.is_admin());
revoke insert, update, delete on public.identity_checks from anon, authenticated;
grant select on public.identity_checks to authenticated;
create or replace function public.is_identity_verified(p_user uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.identity_checks where user_id = p_user and status = 'verified') $$;

create or replace function public.request_identity_check(p_name text, p_files jsonb)
returns void language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); f jsonb; cur public.identity_checks;
begin
  if me is null or not public.is_verified_user() then raise exception 'Please sign in first.'; end if;
  if not (select identity_checks_enabled from public.platform_settings where id = 1) then raise exception 'Identity checks are not available right now.'; end if;
  select * into cur from public.identity_checks where user_id = me;
  if cur.status = 'verified' then raise exception 'Your identity is already verified.'; end if;
  if cur.status = 'pending' then raise exception 'Your CNIC is already with RAQBO for checking.'; end if;
  if char_length(btrim(coalesce(p_name, ''))) < 3 then raise exception 'Enter your name exactly as it is on your CNIC.'; end if;
  if jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) < 2 then raise exception 'Upload the front and back of your CNIC.'; end if;
  for f in select * from jsonb_array_elements(p_files) loop
    if coalesce(f->>'path', '') not like me::text || '/%' then raise exception 'Upload not recognised. Please upload again.'; end if;
  end loop;
  insert into public.identity_checks (user_id, status, name_on_cnic, files, admin_note, submitted_at, checked_at, checked_by)
  values (me, 'pending', btrim(p_name), p_files, '', now(), null, null)
  on conflict (user_id) do update set status = 'pending', name_on_cnic = excluded.name_on_cnic, files = excluded.files, admin_note = '', submitted_at = now(), checked_at = null, checked_by = null;
  perform public.notify_admins('system', 'Identity check request', btrim(p_name) || ' sent CNIC photos for checking.', '#admin/verify');
end $$;
grant execute on function public.request_identity_check(text, jsonb) to authenticated;

create or replace function public.admin_decide_identity(p_user uuid, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = public
as $$
declare c public.identity_checks;
begin
  if not public.has_perm('verification') then raise exception 'You do not have permission to verify identities.'; end if;
  if not p_approve and char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Write a short reason for the member.'; end if;
  update public.identity_checks set status = case when p_approve then 'verified' else 'rejected' end, admin_note = left(btrim(coalesce(p_note, '')), 600), checked_at = now(), checked_by = auth.uid()
   where user_id = p_user and status = 'pending' returning * into c;
  if c.user_id is null then raise exception 'This request was already handled.'; end if;
  perform public.notify(p_user, 'system', case when p_approve then '✓ Your identity is verified' else 'Identity check not approved' end,
    coalesce(nullif(btrim(p_note), ''), 'Your ID-verified badge now shows on your listings.'), '#my');
  perform public.audit(case when p_approve then 'identity.approve' else 'identity.reject' end, 'member', c.name_on_cnic, p_note, '{}'::jsonb);
end $$;
grant execute on function public.admin_decide_identity(uuid, boolean, text) to authenticated;

-- ---------- Listing verification levels: what was checked and when ----------
alter table public.listing_verifications add column if not exists level text not null default 'documents';
alter table public.listing_verifications add column if not exists checks jsonb not null default '[]'::jsonb;
do $$ begin alter table public.listing_verifications add constraint listing_verifications_level_check check (level in ('documents','legal')); exception when duplicate_object then null; end $$;

create table if not exists public.verification_history (
  id          bigint generated always as identity primary key,
  listing_id  uuid not null references public.listings (id) on delete cascade,
  event       text not null check (event in ('submitted','verified','rejected','expired')),
  level       text not null default 'documents',
  note        text not null default '',
  at          timestamptz not null default now()
);
create index if not exists verification_history_listing_idx on public.verification_history (listing_id, at);
alter table public.verification_history enable row level security;
drop policy if exists "verification_history: read" on public.verification_history;
create policy "verification_history: read" on public.verification_history for select using (
  public.is_admin() or exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = auth.uid()));
revoke insert, update, delete on public.verification_history from anon, authenticated;
grant select on public.verification_history to authenticated;

create or replace function public.listing_verifications_history()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status or new.submitted_at is distinct from old.submitted_at then
    insert into public.verification_history (listing_id, event, level, note) values (new.listing_id, new.status::text, new.level,
      case when new.status in ('rejected','expired') then new.admin_note else '' end);
  end if;
  return null;
end $$;
drop trigger if exists listing_verifications_history on public.listing_verifications;
create trigger listing_verifications_history after insert or update on public.listing_verifications for each row execute function public.listing_verifications_history();

-- Apply with a level (documents or the fuller legal check)
create or replace function public.request_listing_verification2(p_listing uuid, p_level text, p_method text, p_txn text, p_proof text, p_docs jsonb, p_note text)
returns void language plpgsql security definer set search_path = public
as $$
declare me uuid := auth.uid(); l public.listings; s public.growth_settings; v public.listing_verifications; d jsonb; nm text; fee int;
begin
  if me is null or not public.is_verified_user() then raise exception 'Please sign in first.'; end if;
  select * into s from public.growth_settings where id = 1;
  if not s.verification_enabled then raise exception 'RAQBO verification is not available right now.'; end if;
  if p_level not in ('documents','legal') then raise exception 'Choose a verification level.'; end if;
  fee := case when p_level = 'legal' then (select legal_verification_fee from public.platform_settings where id = 1) else s.verification_fee end;
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
  if fee > 0 then
    if coalesce(p_proof, '') not like me::text || '/%' then raise exception 'Please upload the screenshot of the verification fee payment.'; end if;
    if char_length(btrim(coalesce(p_method, ''))) = 0 then raise exception 'Choose how you paid the fee.'; end if;
  end if;
  insert into public.listing_verifications (listing_id, owner_id, status, level, checks, fee, payment_method, txn_id, payment_proof, documents, owner_note, admin_note, submitted_at, decided_at, decided_by)
  values (l.id, me, 'submitted', p_level, '[]'::jsonb, fee, left(btrim(coalesce(p_method, '')), 40), left(btrim(coalesce(p_txn, '')), 80), coalesce(p_proof, ''), p_docs, left(btrim(coalesce(p_note, '')), 600), '', now(), null, null)
  on conflict (listing_id) do update set status = 'submitted', level = excluded.level, checks = '[]'::jsonb, fee = excluded.fee, payment_method = excluded.payment_method, txn_id = excluded.txn_id,
     payment_proof = excluded.payment_proof, documents = excluded.documents, owner_note = excluded.owner_note, admin_note = '', submitted_at = now(), decided_at = null, decided_by = null;
  select coalesce(nullif(full_name, ''), 'A member') into nm from public.profiles where id = me;
  perform public.notify_admins('listing', 'Verification request: ' || left(l.title, 100), nm || ' · ' || l.ref || ' · ' || case when p_level = 'legal' then 'legal check' else 'documents' end || ' · fee Rs ' || fee || ' · ' || jsonb_array_length(p_docs) || ' document(s)', '#admin/verify');
end $$;
grant execute on function public.request_listing_verification2(uuid, text, text, text, text, jsonb, text) to authenticated;
-- the earlier call keeps working as a "documents" request
create or replace function public.request_listing_verification(p_listing uuid, p_method text, p_txn text, p_proof text, p_docs jsonb, p_note text)
returns void language sql security definer set search_path = public
as $$ select public.request_listing_verification2(p_listing, 'documents', p_method, p_txn, p_proof, p_docs, p_note) $$;

-- ---------- Bank statement reconciliation ----------
create table if not exists public.bank_lines (
  id           bigint generated always as identity primary key,
  txn_date     date not null,
  description  text not null default '',
  amount       numeric(14,2) not null,
  reference    text not null default '',
  imported_by  uuid references public.profiles (id) on delete set null,
  imported_at  timestamptz not null default now(),
  matched_kind text,                -- order | verification | deposit
  matched_ref  text,
  matched_at   timestamptz,
  matched_by   uuid references public.profiles (id) on delete set null,
  unique (txn_date, amount, reference, description)
);
alter table public.bank_lines enable row level security;
drop policy if exists "bank_lines: finance" on public.bank_lines;
create policy "bank_lines: finance" on public.bank_lines for select using (public.has_perm('finance'));
revoke insert, update, delete on public.bank_lines from anon, authenticated;
grant select on public.bank_lines to authenticated;

-- What RAQBO is waiting to receive (payment proofs uploaded by members)
create or replace function public.expected_payments()
returns table (kind text, ref text, amount numeric, txn text, who text, at timestamptz, label text)
language sql stable security definer set search_path = public
as $$
  select 'order', o.ref, o.total, o.payment_ref, coalesce(nullif(p.full_name, ''), p.email), o.updated_at, 'Material order ' || o.ref
    from public.orders o left join public.profiles p on p.id = o.buyer_id where o.status = 'payment_review'
  union all
  select 'verification', l.ref, v.fee, v.txn_id, coalesce(nullif(p.full_name, ''), p.email), v.submitted_at, 'Verification fee ' || l.ref
    from public.listing_verifications v join public.listings l on l.id = v.listing_id left join public.profiles p on p.id = v.owner_id where v.status = 'submitted' and v.fee > 0
$$;
revoke all on function public.expected_payments() from public, anon, authenticated;

create or replace function public.payment_matched(p_kind text, p_ref text)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.bank_lines where matched_kind = p_kind and matched_ref = p_ref) $$;
grant execute on function public.payment_matched(text, text) to authenticated;

-- Link bank lines to payments: same amount, and the transaction ID appears in the bank reference or description
create or replace function public.reconcile_auto()
returns int language plpgsql security definer set search_path = public
as $$
declare e record; b public.bank_lines; n int := 0;
begin
  for e in select * from public.expected_payments() where not public.payment_matched(kind, ref) loop
    select * into b from public.bank_lines bl where bl.matched_ref is null and abs(bl.amount - e.amount) < 1
       and char_length(btrim(coalesce(e.txn, ''))) >= 4 and (bl.reference ilike '%' || btrim(e.txn) || '%' or bl.description ilike '%' || btrim(e.txn) || '%')
       order by bl.txn_date desc limit 1;
    if b.id is not null then
      update public.bank_lines set matched_kind = e.kind, matched_ref = e.ref, matched_at = now(), matched_by = auth.uid() where id = b.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.reconcile_auto() from public, anon, authenticated;

create or replace function public.admin_import_bank_lines(p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare r jsonb; added int := 0; matched int;
begin
  if not public.has_perm('finance') then raise exception 'You do not have permission to import bank statements.'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 5000 then raise exception 'Send up to 5000 lines at a time.'; end if;
  for r in select * from jsonb_array_elements(p_lines) loop
    begin
      insert into public.bank_lines (txn_date, description, amount, reference, imported_by)
      values ((r->>'date')::date, left(coalesce(r->>'description', ''), 500), (r->>'amount')::numeric, left(coalesce(r->>'reference', ''), 200), auth.uid())
      on conflict do nothing;
      if found then added := added + 1; end if;
    exception when others then null;   -- skip lines that cannot be read
    end;
  end loop;
  matched := public.reconcile_auto();
  perform public.audit('bank.import', 'bank', '', '', jsonb_build_object('added', added, 'matched', matched));
  return jsonb_build_object('added', added, 'matched', matched);
end $$;
grant execute on function public.admin_import_bank_lines(jsonb) to authenticated;

create or replace function public.admin_reconciliation()
returns jsonb language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_perm('finance') then raise exception 'You do not have permission to see bank records.'; end if;
  perform public.reconcile_auto();
  return jsonb_build_object(
    'expected', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'ref', e.ref, 'amount', e.amount, 'txn', e.txn, 'who', e.who, 'at', e.at, 'label', e.label,
                 'matched', public.payment_matched(e.kind, e.ref),
                 'candidates', (select count(*) from public.bank_lines b where b.matched_ref is null and abs(b.amount - e.amount) < 1 and b.txn_date >= (e.at - interval '7 days')::date))
                 order by e.at) from public.expected_payments() e), '[]'::jsonb),
    'lines', coalesce((select jsonb_agg(to_jsonb(b) order by b.txn_date desc, b.id desc) from (select * from public.bank_lines order by txn_date desc, id desc limit 300) b), '[]'::jsonb),
    'unmatched', (select count(*) from public.bank_lines where matched_ref is null and amount > 0));
end $$;
grant execute on function public.admin_reconciliation() to authenticated;

create or replace function public.admin_match_line(p_line bigint, p_kind text, p_ref text, p_reason text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_perm('finance') then raise exception 'You do not have permission to match payments.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Please give a reason (it is kept in the audit log).'; end if;
  if nullif(p_kind, '') is null then
    update public.bank_lines set matched_kind = null, matched_ref = null, matched_at = null, matched_by = null where id = p_line;
  else
    if public.payment_matched(p_kind, p_ref) then raise exception 'That payment is already matched to a bank line.'; end if;
    update public.bank_lines set matched_kind = p_kind, matched_ref = p_ref, matched_at = now(), matched_by = auth.uid() where id = p_line and matched_ref is null;
    if not found then raise exception 'That bank line is already matched.'; end if;
  end if;
  perform public.audit(case when nullif(p_kind, '') is null then 'bank.unmatch' else 'bank.match' end, 'bank', p_line::text, p_reason, jsonb_build_object('kind', p_kind, 'ref', p_ref));
end $$;
grant execute on function public.admin_match_line(bigint, text, text, text) to authenticated;

-- Admin decides a listing verification: records exactly what was checked; a paid request needs a bank match or a reason
create or replace function public.admin_decide_verification2(p_listing uuid, p_approve boolean, p_note text, p_checks jsonb, p_reason text)
returns void language plpgsql security definer set search_path = public
as $$
declare v public.listing_verifications; l public.listings;
begin
  if not public.has_perm('verification') then raise exception 'You do not have permission to verify listings.'; end if;
  select * into v from public.listing_verifications where listing_id = p_listing;
  select * into l from public.listings where id = p_listing;
  if v.listing_id is null or v.status <> 'submitted' then raise exception 'This request was already handled.'; end if;
  if not p_approve and char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Write a short reason for the owner.'; end if;
  if p_approve and v.fee > 0 and not public.payment_matched('verification', l.ref) and char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'No bank record matches this fee yet. Import the bank statement first, or give a reason to approve anyway (kept in the audit log).';
  end if;
  if p_approve and (jsonb_typeof(p_checks) <> 'array' or not exists (select 1 from jsonb_array_elements(p_checks) c where c->>'result' = 'ok')) then
    raise exception 'Tick at least one check that was completed.';
  end if;
  update public.listing_verifications set checks = case when p_approve then p_checks else checks end where listing_id = p_listing;
  perform public.admin_decide_verification(p_listing, p_approve, p_note);
  perform public.audit(case when p_approve then 'verification.approve' else 'verification.reject' end, 'listing', l.ref, coalesce(nullif(p_reason, ''), p_note),
    jsonb_build_object('level', v.level, 'checks', p_checks, 'bank_matched', public.payment_matched('verification', l.ref)));
end $$;
grant execute on function public.admin_decide_verification2(uuid, boolean, text, jsonb, text) to authenticated;

-- Public trust information for one property (Property Passport and the verification box)
create or replace function public.listing_trust(p_listing uuid)
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'verification', (select jsonb_build_object('status', v.status, 'level', v.level, 'checks', case when v.status = 'verified' then v.checks else '[]'::jsonb end, 'checked_at', v.decided_at)
                      from public.listing_verifications v where v.listing_id = l.id and v.status in ('verified','expired')),
    'history', coalesce((select jsonb_agg(jsonb_build_object('event', h.event, 'level', h.level, 'at', h.at) order by h.at)
                      from public.verification_history h where h.listing_id = l.id and h.event in ('verified','expired')), '[]'::jsonb),
    'owner_id_verified', public.is_identity_verified(l.owner_id),
    'raqbo_role', l.raqbo_role, 'raqbo_role_note', l.raqbo_role_note)
  from public.listings l where l.id = p_listing and (l.status = 'published' or l.owner_id = auth.uid() or public.is_admin())
$$;
grant execute on function public.listing_trust(uuid) to anon, authenticated;

-- Badges for advertisers (Founding number + ID verified)
create or replace function public.member_trust(p_ids uuid[])
returns table (id uuid, founding_no int, id_verified boolean) language sql stable security definer set search_path = public
as $$ select p.id, p.founding_no, public.is_identity_verified(p.id) from public.profiles p where p.id = any(p_ids[1:500]) $$;
grant execute on function public.member_trust(uuid[]) to anon, authenticated;

-- Admin view of verification requests now includes level, bank match and identity
create or replace function public.admin_verifications()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return jsonb_build_object(
    'listings', coalesce((select jsonb_agg(jsonb_build_object('listing_id', v.listing_id, 'status', v.status, 'level', v.level, 'checks', v.checks, 'fee', v.fee, 'payment_method', v.payment_method, 'txn_id', v.txn_id,
           'payment_proof', v.payment_proof, 'documents', v.documents, 'owner_note', v.owner_note, 'admin_note', v.admin_note, 'submitted_at', v.submitted_at, 'decided_at', v.decided_at,
           'title', l.title, 'ref', l.ref, 'city', l.city, 'area', l.area, 'listing_status', l.status, 'advertiser_role', l.advertiser_role,
           'owner', coalesce(nullif(p.full_name, ''), p.email), 'phone', p.phone, 'email', p.email,
           'owner_id_verified', public.is_identity_verified(v.owner_id), 'bank_matched', public.payment_matched('verification', l.ref))
           order by (v.status = 'submitted') desc, v.submitted_at desc)
         from public.listing_verifications v join public.listings l on l.id = v.listing_id left join public.profiles p on p.id = v.owner_id), '[]'::jsonb),
    'identity', coalesce((select jsonb_agg(jsonb_build_object('user_id', c.user_id, 'status', c.status, 'name_on_cnic', c.name_on_cnic, 'files', c.files, 'admin_note', c.admin_note,
           'submitted_at', c.submitted_at, 'checked_at', c.checked_at, 'member', coalesce(nullif(p.full_name, ''), p.email), 'phone', p.phone, 'email', p.email)
           order by (c.status = 'pending') desc, c.submitted_at desc)
         from public.identity_checks c left join public.profiles p on p.id = c.user_id), '[]'::jsonb));
end $$;
grant execute on function public.admin_verifications() to authenticated;

-- ---------- Service requests: tracking for members ----------
alter table public.enquiries add column if not exists client_note text not null default '';
alter table public.enquiries add column if not exists updated_at timestamptz not null default now();
alter table public.enquiries drop constraint if exists enquiries_status_check;
alter table public.enquiries add constraint enquiries_status_check check (status in ('new','in_progress','awaiting_client','completed','cancelled','handled'));
create or replace function public.enquiries_before_insert()
returns trigger language plpgsql security definer set search_path = public
as $$ begin new.user_id := auth.uid(); new.status := 'new'; new.updated_at := now(); return new; end $$;
drop trigger if exists enquiries_before_insert on public.enquiries;
create trigger enquiries_before_insert before insert on public.enquiries for each row execute function public.enquiries_before_insert();

create or replace function public.my_service_requests()
returns jsonb language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('ref', ref, 'service', service, 'message', message, 'property_ref', property_ref, 'status', status, 'client_note', client_note, 'created_at', created_at, 'updated_at', updated_at) order by created_at desc), '[]'::jsonb)
  from public.enquiries where user_id = auth.uid()
$$;
grant execute on function public.my_service_requests() to authenticated;

create or replace function public.admin_update_service_request(p_id uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public
as $$
declare e public.enquiries; label text;
begin
  if not public.has_perm('services') then raise exception 'You do not have permission to update service requests.'; end if;
  if p_status not in ('new','in_progress','awaiting_client','completed','cancelled','handled') then raise exception 'Unknown status.'; end if;
  update public.enquiries set status = p_status, client_note = left(btrim(coalesce(p_note, '')), 600), updated_at = now() where id = p_id returning * into e;
  if e.id is null then raise exception 'Request not found.'; end if;
  label := case p_status when 'in_progress' then 'is in progress' when 'awaiting_client' then 'needs something from you' when 'completed' then 'is complete' when 'cancelled' then 'was cancelled' else 'was updated' end;
  if e.user_id is not null then perform public.notify(e.user_id, 'service', 'Your service request ' || e.ref || ' ' || label, coalesce(nullif(btrim(p_note), ''), 'See My RAQBO → Service requests.'), '#my/services'); end if;
end $$;
grant execute on function public.admin_update_service_request(uuid, text, text) to authenticated;

-- ---------- Notification types for the new modules ----------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('order','listing','review','message','system','alert','reward','deal','auction','service'));

-- ---------- Public data: verified listings by level ----------
create or replace function public.platform_public()
returns jsonb language sql stable security definer set search_path = public
as $$
  select to_jsonb(s) - 'id' - 'updated_at' || jsonb_build_object(
    'verified_legal', coalesce((select jsonb_agg(v.listing_id) from public.listing_verifications v join public.listings l on l.id = v.listing_id and l.status = 'published' where v.status = 'verified' and v.level = 'legal'), '[]'::jsonb),
    'id_verified_owners', coalesce((select jsonb_agg(distinct l.owner_id) from public.listings l join public.identity_checks c on c.user_id = l.owner_id and c.status = 'verified' where l.status = 'published'), '[]'::jsonb),
    'is_investor', public.is_approved_investor())
  from public.platform_settings s where s.id = 1
$$;
grant execute on function public.platform_public() to anon, authenticated;

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['identity_checks', 'admin_audit', 'bank_lines', 'platform_settings'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
