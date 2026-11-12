-- =====================================================================
-- RAQBO update 29 — PARTNER NETWORK
--   1  Settings and commission rates (by category, service and lead source)
--   2  Territories (province → division → district → tehsil → city → town →
--      society → commercial area → locality) with status and exclusivity
--   3  Partner applications (sections A–H of the requirement document)
--   4  Selection and verification: the nine-step appointment process
--   5  Partners, partner IDs, QR status token, branding designation
--   6  Agreements: the sixteen matters, executed before activation
--   7  Documents with expiry reminders
--   8  Central lead distribution: territory routing, acceptance window,
--      return to RAQBO on no response, full step history
--   9  Transactions and commission: on eligible SERVICE FEES, never on the
--      property value; no automatic entitlement by territory alone
--  10  Payouts, statements and approval
--  11  Training modules and completion
--  12  Performance review and partner status
--  13  Public partner directory and QR verification
--  14  Activity log and controlled exports
--
-- Principles enforced by the database, not left to the screens:
--   · An application never grants partnership rights.
--   · A partner cannot be made active until an agreement is executed.
--   · A suspended or terminated partner disappears from the directory.
--   · Commission is a share of the fee RAQBO actually received.
--   · A partner sees only their own territory, leads and customers.
--   · No partner can collect deposits or purchase money through RAQBO.
--
-- Safe to run more than once.
-- =====================================================================

-- ---------- 0. Housekeeping ----------
-- The bell needs to know about the new kinds of message.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in
  ('order','listing','review','message','system','alert','reward','deal','auction','service',
   'partner','partner_application','partner_lead','partner_money','partner_quicksell'));

-- ---------- 0. Permission for staff who run the network ----------
-- (admin_perms is an array on profiles; 'partners' is a new entry)

-- ---------- 1. Settings and commission rates ----------
create table if not exists public.pn_settings (
  id                   boolean primary key default true check (id),
  network_open         boolean not null default true,            -- accepting applications
  lead_accept_hours    int not null default 24 check (lead_accept_hours between 1 and 168),
  lead_contact_hours   int not null default 48 check (lead_contact_hours between 1 and 336),
  pilot_note           text not null default '' check (char_length(pilot_note) <= 600),
  directory_public     boolean not null default true,
  franchise_open       boolean not null default false,           -- full franchises only after the pilot
  intro_note           text not null default '' check (char_length(intro_note) <= 1200),
  updated_at           timestamptz not null default now()
);
insert into public.pn_settings (id) values (true) on conflict (id) do nothing;
alter table public.pn_settings enable row level security;
drop policy if exists "pn_settings: read" on public.pn_settings;
create policy "pn_settings: read" on public.pn_settings for select using (true);
revoke insert, update, delete on public.pn_settings from anon, authenticated;

-- Commission percentages are configurable by category, service and lead source.
create table if not exists public.pn_rates (
  id            uuid primary key default gen_random_uuid(),
  category      text not null check (category in ('associate','area','franchise')),
  service       text not null default 'any' check (char_length(service) <= 60),      -- 'any' or a service key
  lead_source   text not null default 'any' check (lead_source in ('any','partner','raqbo')),
  partner_pct   numeric(5,2) not null check (partner_pct >= 0 and partner_pct <= 100),
  note          text not null default '' check (char_length(note) <= 300),
  effective_from date not null default current_date,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (category, service, lead_source, effective_from)
);
create index if not exists pn_rates_lookup_idx on public.pn_rates (category, service, lead_source, effective_from desc) where active;
alter table public.pn_rates enable row level security;
drop policy if exists "pn_rates: read" on public.pn_rates;
create policy "pn_rates: read" on public.pn_rates for select using (true);
revoke insert, update, delete on public.pn_rates from anon, authenticated;

-- Illustrative starting figures from the requirement document. They are
-- placeholders: an admin sets the real ones before any partner is appointed.
insert into public.pn_rates (category, service, lead_source, partner_pct, effective_from, note) values
  ('associate', 'any', 'any',     17.50, date '2020-01-01', 'Referral commission on a qualifying transaction — illustrative, to be set by RAQBO'),
  ('area',      'any', 'partner', 40.00, date '2020-01-01', 'Transaction originated and substantially handled by the partner — illustrative'),
  ('area',      'any', 'raqbo',   25.00, date '2020-01-01', 'Lead originated by RAQBO and assigned to the partner — illustrative'),
  ('franchise', 'any', 'any',     50.00, date '2020-01-01', 'Individually negotiated — illustrative only')
on conflict do nothing;

create table if not exists public.pn_rate_history (
  id         bigserial primary key,
  rate_id    uuid,
  changed_by uuid references public.profiles (id) on delete set null,
  before_val jsonb,
  after_val  jsonb,
  at         timestamptz not null default now()
);
alter table public.pn_rate_history enable row level security;
drop policy if exists "pn_rate_history: admin" on public.pn_rate_history;
create policy "pn_rate_history: admin" on public.pn_rate_history for select using (public.has_perm('partners'));
revoke insert, update, delete on public.pn_rate_history from anon, authenticated;

-- ---------- 2. Territories ----------
create table if not exists public.pn_territories (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique default ('RQ-TR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))),
  level          text not null default 'city' check (level in ('province','division','district','tehsil','city','town','society','commercial_area','locality')),
  name           text not null check (char_length(btrim(name)) between 2 and 120),
  province       text not null default '' check (char_length(province) <= 60),
  division       text not null default '' check (char_length(division) <= 60),
  district       text not null default '' check (char_length(district) <= 60),
  tehsil         text not null default '' check (char_length(tehsil) <= 60),
  city           text not null default '' check (char_length(city) <= 60),
  parent_id      uuid references public.pn_territories (id) on delete set null,
  boundary_note  text not null default '' check (char_length(boundary_note) <= 600),
  status         text not null default 'available' check (status in ('available','under_review','appointed','additional_allowed','suspended','reserved')),
  max_partners   int not null default 1 check (max_partners between 1 and 50),
  exclusive      boolean not null default false,       -- limited exclusivity is granted, never automatic
  exclusive_until date,
  min_monthly_deals int not null default 0 check (min_monthly_deals between 0 and 500),   -- condition of exclusivity
  note           text not null default '' check (char_length(note) <= 600),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists pn_territories_place_idx on public.pn_territories (province, city, status);
create index if not exists pn_territories_status_idx on public.pn_territories (status, name);
alter table public.pn_territories enable row level security;
drop policy if exists "pn_territories: read" on public.pn_territories;
create policy "pn_territories: read" on public.pn_territories for select using (true);
revoke insert, update, delete on public.pn_territories from anon, authenticated;

-- ---------- 3. Applications ----------
create table if not exists public.pn_applications (
  id              uuid primary key default gen_random_uuid(),
  ref             text not null unique default ('RQ-PA-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  user_id         uuid references public.profiles (id) on delete set null,
  -- Section A: applicant
  full_name       text not null check (char_length(btrim(full_name)) between 3 and 120),
  cnic_last4      text not null default '' check (cnic_last4 = '' or cnic_last4 ~ '^[0-9]{4}$'),   -- only the last four are kept
  cnic_seen       boolean not null default false,                                                  -- the full card was shown to RAQBO
  phone           text not null check (char_length(phone) between 7 and 20),
  whatsapp        text not null default '' check (char_length(whatsapp) <= 20),
  email           text not null default '' check (char_length(email) <= 160),
  home_address    text not null default '' check (char_length(home_address) <= 300),
  office_address  text not null default '' check (char_length(office_address) <= 300),
  photo_path      text not null default '' check (char_length(photo_path) <= 400),
  background      text not null default '' check (char_length(background) <= 1500),
  -- Section B: business status
  business_type   text not null default 'individual' check (business_type in ('individual','sole_proprietor','aop','private_limited','agency','other_registered')),
  business_name   text not null default '' check (char_length(business_name) <= 160),
  ntn             text not null default '' check (char_length(ntn) <= 30),
  registration_no text not null default '' check (char_length(registration_no) <= 60),
  dealer_licence  text not null default '' check (char_length(dealer_licence) <= 80),
  business_years  int check (business_years is null or business_years between 0 and 80),
  office_details  text not null default '' check (char_length(office_details) <= 600),
  affiliations    text not null default '' check (char_length(affiliations) <= 400),
  -- Section C: preferred territory
  province        text not null default '' check (char_length(province) <= 60),
  city            text not null default '' check (char_length(city) <= 60),
  district        text not null default '' check (char_length(district) <= 60),
  tehsil          text not null default '' check (char_length(tehsil) <= 60),
  area_wanted     text not null default '' check (char_length(area_wanted) <= 200),
  territory_id    uuid references public.pn_territories (id) on delete set null,
  has_office      boolean not null default false,
  -- Section D: preference
  want_category   text not null default 'area' check (want_category in ('associate','area','franchise','open')),
  -- Section E: experience and resources
  exp_years       int check (exp_years is null or exp_years between 0 and 80),
  customer_network text not null default '' check (char_length(customer_network) <= 600),
  staff_count     int check (staff_count is null or staff_count between 0 and 5000),
  categories_handled text[] not null default '{}',
  marketing       text not null default '' check (char_length(marketing) <= 600),
  skills          text not null default '' check (char_length(skills) <= 600),
  inventory_note  text not null default '' check (char_length(inventory_note) <= 600),
  -- Section F: services the applicant can handle
  services        text[] not null default '{}',
  -- Section G: documents (paths in the partner-docs bucket)
  doc_paths       text[] not null default '{}',
  -- Section H: declaration — an application grants no rights
  declared        boolean not null default false,
  -- Selection and verification
  stage           text not null default 'submitted' check (stage in
                  ('submitted','preliminary_review','verification','interview','territory_assessment','commercial_terms','agreement','training','activated','rejected','withdrawn')),
  stage_note      text not null default '' check (char_length(stage_note) <= 1000),
  score_reputation   int check (score_reputation between 1 and 5),
  score_experience   int check (score_experience between 1 and 5),
  score_competence   int check (score_competence between 1 and 5),
  score_customers    int check (score_customers between 1 and 5),
  score_compliance   int check (score_compliance between 1 and 5),
  score_capacity     int check (score_capacity between 1 and 5),
  score_communication int check (score_communication between 1 and 5),
  score_premises     int check (score_premises between 1 and 5),
  score_standards    int check (score_standards between 1 and 5),
  identity_verified  boolean not null default false,
  business_verified  boolean not null default false,
  interview_at    timestamptz,
  interview_note  text not null default '' check (char_length(interview_note) <= 1500),
  reject_reason   text not null default '' check (char_length(reject_reason) <= 600),
  reviewed_by     uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists pn_applications_stage_idx on public.pn_applications (stage, created_at desc);
create index if not exists pn_applications_user_idx on public.pn_applications (user_id, created_at desc);
alter table public.pn_applications enable row level security;
drop policy if exists "pn_applications: own or staff" on public.pn_applications;
create policy "pn_applications: own or staff" on public.pn_applications for select
  using (user_id = auth.uid() or public.has_perm('partners'));
revoke insert, update, delete on public.pn_applications from anon, authenticated;

-- ---------- 4. Partners ----------
create table if not exists public.pn_partners (
  id              uuid primary key default gen_random_uuid(),
  partner_id      text not null unique default ('RQ-P-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 7))),
  user_id         uuid not null unique references public.profiles (id) on delete cascade,
  application_id  uuid references public.pn_applications (id) on delete set null,
  category        text not null check (category in ('associate','area','franchise')),
  display_name    text not null check (char_length(btrim(display_name)) between 2 and 160),
  business_type   text not null default 'individual' check (business_type in ('individual','sole_proprietor','aop','private_limited','agency','other_registered')),
  ntn             text not null default '' check (char_length(ntn) <= 30),
  registration_no text not null default '' check (char_length(registration_no) <= 60),
  phone           text not null default '' check (char_length(phone) <= 20),
  whatsapp        text not null default '' check (char_length(whatsapp) <= 20),
  email           text not null default '' check (char_length(email) <= 160),
  office_address  text not null default '' check (char_length(office_address) <= 300),
  photo_path      text not null default '' check (char_length(photo_path) <= 400),
  about           text not null default '' check (char_length(about) <= 1200),
  services        text[] not null default '{}',               -- only what RAQBO has authorised
  -- Branding: the designation must reflect the real contractual status
  designation     text not null default '' check (char_length(designation) <= 120),
  branding_approved boolean not null default false,
  office_branding boolean not null default false,             -- full office branding: franchise only
  -- Status and performance
  status          text not null default 'under_review' check (status in ('under_review','probation','active','suspended','terminated')),
  status_note     text not null default '' check (char_length(status_note) <= 600),
  status_at       timestamptz not null default now(),
  training_done   boolean not null default false,
  agreement_ok    boolean not null default false,             -- set by the agreement, never by hand
  -- Public directory
  listed          boolean not null default true,              -- partner may ask not to be listed
  qr_token        text not null unique default (substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  -- What a partner may NOT do, recorded so it is never assumed
  may_collect_money boolean not null default false,           -- requires express written authority
  may_run_auction   boolean not null default false,           -- a RAQBO-branded auction
  joined_on       date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists pn_partners_status_idx on public.pn_partners (status, category);
create index if not exists pn_partners_user_idx on public.pn_partners (user_id);
alter table public.pn_partners enable row level security;
drop policy if exists "pn_partners: own or staff" on public.pn_partners;
create policy "pn_partners: own or staff" on public.pn_partners for select
  using (user_id = auth.uid() or public.has_perm('partners'));
revoke insert, update, delete on public.pn_partners from anon, authenticated;

-- An office-branding or auction right belongs only to a franchise
do $$ begin
  alter table public.pn_partners add constraint pn_partners_branding_check
    check (not office_branding or category = 'franchise');
exception when duplicate_object then null; end $$;

-- Which territories a partner works in
create table if not exists public.pn_partner_territories (
  partner_id    uuid not null references public.pn_partners (id) on delete cascade,
  territory_id  uuid not null references public.pn_territories (id) on delete cascade,
  exclusive     boolean not null default false,
  from_date     date not null default current_date,
  to_date       date,
  primary key (partner_id, territory_id)
);
create index if not exists pn_pt_territory_idx on public.pn_partner_territories (territory_id);
alter table public.pn_partner_territories enable row level security;
drop policy if exists "pn_partner_territories: read" on public.pn_partner_territories;
create policy "pn_partner_territories: read" on public.pn_partner_territories for select using (true);
revoke insert, update, delete on public.pn_partner_territories from anon, authenticated;

-- ---------- 5. Agreements ----------
create table if not exists public.pn_agreements (
  id             uuid primary key default gen_random_uuid(),
  ref            text not null unique default ('RQ-AG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  partner_id     uuid not null references public.pn_partners (id) on delete cascade,
  category       text not null check (category in ('associate','area','franchise')),
  -- The sixteen matters the agreement must define
  parties        text not null default '' check (char_length(parties) <= 600),
  relationship   text not null default '' check (char_length(relationship) <= 600),
  services       text not null default '' check (char_length(services) <= 1200),
  territory_text text not null default '' check (char_length(territory_text) <= 600),
  exclusivity    text not null default 'non_exclusive' check (exclusivity in ('exclusive','non_exclusive')),
  starts_on      date,
  ends_on        date,
  renewal        text not null default '' check (char_length(renewal) <= 400),
  commission_text text not null default '' check (char_length(commission_text) <= 1200),
  lead_allocation text not null default '' check (char_length(lead_allocation) <= 800),
  local_expenses text not null default '' check (char_length(local_expenses) <= 600),
  brand_use      text not null default '' check (char_length(brand_use) <= 800),
  data_protection text not null default '' check (char_length(data_protection) <= 800),
  reporting      text not null default '' check (char_length(reporting) <= 600),
  restrictions   text not null default '' check (char_length(restrictions) <= 800),
  disputes       text not null default '' check (char_length(disputes) <= 600),
  termination    text not null default '' check (char_length(termination) <= 800),
  after_termination text not null default '' check (char_length(after_termination) <= 600),
  -- Territory-based entitlement is never automatic
  territory_entitlement boolean not null default false,
  -- Execution
  status         text not null default 'draft' check (status in ('draft','sent','executed','expired','terminated')),
  executed_on    date,
  file_path      text not null default '' check (char_length(file_path) <= 400),
  legal_reviewed boolean not null default false,
  note           text not null default '' check (char_length(note) <= 600),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists pn_agreements_partner_idx on public.pn_agreements (partner_id, created_at desc);
create index if not exists pn_agreements_expiry_idx on public.pn_agreements (ends_on) where status = 'executed';
alter table public.pn_agreements enable row level security;
drop policy if exists "pn_agreements: own or staff" on public.pn_agreements;
create policy "pn_agreements: own or staff" on public.pn_agreements for select
  using (public.has_perm('partners') or exists (select 1 from public.pn_partners p where p.id = pn_agreements.partner_id and p.user_id = auth.uid()));
revoke insert, update, delete on public.pn_agreements from anon, authenticated;

-- A partner is only marked as having an agreement when one is executed.
create or replace function public.pn_agreement_sync() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.pn_partners p
     set agreement_ok = exists (select 1 from public.pn_agreements a
                                 where a.partner_id = p.id and a.status = 'executed'
                                   and (a.ends_on is null or a.ends_on >= current_date)),
         updated_at = now()
   where p.id = coalesce(new.partner_id, old.partner_id);
  -- An active partner whose agreement has gone loses active status.
  update public.pn_partners
     set status = 'under_review', status_note = 'No agreement in force.', status_at = now()
   where id = coalesce(new.partner_id, old.partner_id) and status = 'active' and not agreement_ok;
  return null;
end $$;
drop trigger if exists pn_agreement_sync_t on public.pn_agreements;
create trigger pn_agreement_sync_t after insert or update or delete on public.pn_agreements
  for each row execute function public.pn_agreement_sync();

-- ---------- 6. Documents, with expiry reminders ----------
create table if not exists public.pn_documents (
  id           uuid primary key default gen_random_uuid(),
  partner_id   uuid references public.pn_partners (id) on delete cascade,
  application_id uuid references public.pn_applications (id) on delete cascade,
  kind         text not null default 'other' check (kind in ('cnic','ntn','registration','licence','agreement','office_proof','photo','other')),
  title        text not null default '' check (char_length(title) <= 160),
  path         text not null check (char_length(path) between 1 and 400),
  expires_on   date,
  reminded_at  timestamptz,
  uploaded_by  uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  check (partner_id is not null or application_id is not null)
);
create index if not exists pn_documents_expiry_idx on public.pn_documents (expires_on) where expires_on is not null;
alter table public.pn_documents enable row level security;
drop policy if exists "pn_documents: own or staff" on public.pn_documents;
create policy "pn_documents: own or staff" on public.pn_documents for select using (
  public.has_perm('partners')
  or exists (select 1 from public.pn_partners p where p.id = pn_documents.partner_id and p.user_id = auth.uid())
  or exists (select 1 from public.pn_applications a where a.id = pn_documents.application_id and a.user_id = auth.uid())
);
revoke insert, update, delete on public.pn_documents from anon, authenticated;

insert into storage.buckets (id, name, public) values ('partner-docs', 'partner-docs', false) on conflict (id) do nothing;
drop policy if exists "partner-docs: owner upload" on storage.objects;
create policy "partner-docs: owner upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'partner-docs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "partner-docs: owner or staff read" on storage.objects;
create policy "partner-docs: owner or staff read" on storage.objects for select to authenticated
  using (bucket_id = 'partner-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.has_perm('partners')));
drop policy if exists "partner-docs: owner remove" on storage.objects;
create policy "partner-docs: owner remove" on storage.objects for delete to authenticated
  using (bucket_id = 'partner-docs' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- 7. Leads ----------
create table if not exists public.pn_leads (
  id            uuid primary key default gen_random_uuid(),
  ref           text not null unique default ('RQ-LD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  source        text not null default 'raqbo' check (source in ('raqbo','partner','website','referral')),
  origin_partner uuid references public.pn_partners (id) on delete set null,   -- who generated it, recorded always
  kind          text not null default 'buyer' check (kind in ('buyer','seller','landlord','tenant','service','commercial','quicksell','auction','other')),
  service       text not null default '' check (char_length(service) <= 60),
  listing_id    uuid references public.listings (id) on delete set null,
  enquiry_id    uuid references public.enquiries (id) on delete set null,
  customer_name text not null default '' check (char_length(customer_name) <= 120),
  customer_phone text not null default '' check (char_length(customer_phone) <= 20),
  customer_note text not null default '' check (char_length(customer_note) <= 1000),
  province      text not null default '' check (char_length(province) <= 60),
  city          text not null default '' check (char_length(city) <= 60),
  area          text not null default '' check (char_length(area) <= 120),
  territory_id  uuid references public.pn_territories (id) on delete set null,
  -- Assignment
  partner_id    uuid references public.pn_partners (id) on delete set null,
  assigned_at   timestamptz,
  accept_by     timestamptz,                                  -- after this it returns to RAQBO
  accepted_at   timestamptz,
  declined_at   timestamptz,
  decline_reason text not null default '' check (char_length(decline_reason) <= 400),
  reassigned    int not null default 0 check (reassigned >= 0),
  handled_by_raqbo boolean not null default false,            -- RAQBO may always handle a customer directly
  -- Workflow
  stage         text not null default 'new' check (stage in
                ('new','raqbo_review','assigned','accepted','contacted','site_visit','negotiation','completed','lost','returned')),
  stage_note    text not null default '' check (char_length(stage_note) <= 600),
  contacted_at  timestamptz,
  visit_at      timestamptz,
  completed_at  timestamptz,
  lost_reason   text not null default '' check (char_length(lost_reason) <= 400),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists pn_leads_partner_idx on public.pn_leads (partner_id, created_at desc);
create index if not exists pn_leads_stage_idx on public.pn_leads (stage, created_at desc);
create index if not exists pn_leads_waiting_idx on public.pn_leads (accept_by) where stage = 'assigned';
create index if not exists pn_leads_territory_idx on public.pn_leads (territory_id, created_at desc);
alter table public.pn_leads enable row level security;
-- A partner sees only the leads assigned to them or that they generated.
drop policy if exists "pn_leads: mine or staff" on public.pn_leads;
create policy "pn_leads: mine or staff" on public.pn_leads for select using (
  public.has_perm('partners')
  or exists (select 1 from public.pn_partners p where p.user_id = auth.uid() and p.id in (pn_leads.partner_id, pn_leads.origin_partner))
);
revoke insert, update, delete on public.pn_leads from anon, authenticated;

create table if not exists public.pn_lead_events (
  id         bigserial primary key,
  lead_id    uuid not null references public.pn_leads (id) on delete cascade,
  stage      text not null,
  by_user    uuid references public.profiles (id) on delete set null,
  note       text not null default '' check (char_length(note) <= 600),
  at         timestamptz not null default now()
);
create index if not exists pn_lead_events_lead_idx on public.pn_lead_events (lead_id, at);
alter table public.pn_lead_events enable row level security;
drop policy if exists "pn_lead_events: follow lead" on public.pn_lead_events;
create policy "pn_lead_events: follow lead" on public.pn_lead_events for select using (
  exists (select 1 from public.pn_leads l where l.id = lead_id)
);
revoke insert, update, delete on public.pn_lead_events from anon, authenticated;

-- ---------- 8. Transactions and commission ----------
create table if not exists public.pn_transactions (
  id             uuid primary key default gen_random_uuid(),
  ref            text not null unique default ('RQ-TX-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  lead_id        uuid references public.pn_leads (id) on delete set null,
  partner_id     uuid not null references public.pn_partners (id) on delete cascade,
  listing_id     uuid references public.listings (id) on delete set null,
  service        text not null default '' check (char_length(service) <= 60),
  description    text not null default '' check (char_length(description) <= 600),
  lead_source    text not null default 'raqbo' check (lead_source in ('partner','raqbo')),
  -- Money. The commission is a share of the FEE, never of the property value.
  property_value bigint check (property_value is null or property_value >= 0),   -- recorded for the file only
  gross_fee      bigint not null default 0 check (gross_fee >= 0),               -- the service fee charged
  fee_received   bigint not null default 0 check (fee_received >= 0),            -- what RAQBO actually received
  tax_deduction  bigint not null default 0 check (tax_deduction >= 0),
  third_party    bigint not null default 0 check (third_party >= 0),
  refunded       bigint not null default 0 check (refunded >= 0),
  other_deduction bigint not null default 0 check (other_deduction >= 0),
  deduction_note text not null default '' check (char_length(deduction_note) <= 400),
  stage          text not null default 'open' check (stage in ('open','fee_received','settled','cancelled')),
  completed_on   date,
  documents      text[] not null default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists pn_transactions_partner_idx on public.pn_transactions (partner_id, created_at desc);
create index if not exists pn_transactions_stage_idx on public.pn_transactions (stage, created_at desc);
alter table public.pn_transactions enable row level security;
drop policy if exists "pn_transactions: mine or staff" on public.pn_transactions;
create policy "pn_transactions: mine or staff" on public.pn_transactions for select using (
  public.has_perm('partners') or exists (select 1 from public.pn_partners p where p.id = pn_transactions.partner_id and p.user_id = auth.uid())
);
revoke insert, update, delete on public.pn_transactions from anon, authenticated;

create table if not exists public.pn_commissions (
  id             uuid primary key default gen_random_uuid(),
  ref            text not null unique default ('RQ-CM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  transaction_id uuid not null unique references public.pn_transactions (id) on delete cascade,
  partner_id     uuid not null references public.pn_partners (id) on delete cascade,
  rate_pct       numeric(5,2) not null check (rate_pct >= 0 and rate_pct <= 100),
  rate_source    text not null default '' check (char_length(rate_source) <= 160),   -- which rule was used
  distributable  bigint not null default 0 check (distributable >= 0),               -- fee received less deductions
  amount         bigint not null default 0 check (amount >= 0),
  status         text not null default 'pending' check (status in ('pending','approved','paid','disputed','rejected','cancelled')),
  dispute_note   text not null default '' check (char_length(dispute_note) <= 800),
  dispute_outcome text not null default '' check (char_length(dispute_outcome) <= 800),
  approved_by    uuid references public.profiles (id) on delete set null,
  approved_at    timestamptz,
  payout_id      uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists pn_commissions_partner_idx on public.pn_commissions (partner_id, created_at desc);
create index if not exists pn_commissions_status_idx on public.pn_commissions (status, created_at desc);
alter table public.pn_commissions enable row level security;
drop policy if exists "pn_commissions: mine or staff" on public.pn_commissions;
create policy "pn_commissions: mine or staff" on public.pn_commissions for select using (
  public.has_perm('partners') or exists (select 1 from public.pn_partners p where p.id = pn_commissions.partner_id and p.user_id = auth.uid())
);
revoke insert, update, delete on public.pn_commissions from anon, authenticated;

create table if not exists public.pn_payouts (
  id           uuid primary key default gen_random_uuid(),
  ref          text not null unique default ('RQ-PO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  partner_id   uuid not null references public.pn_partners (id) on delete cascade,
  period_from  date not null,
  period_to    date not null,
  amount       bigint not null default 0 check (amount >= 0),
  status       text not null default 'draft' check (status in ('draft','approved','paid','cancelled')),
  method       text not null default 'bank' check (method in ('bank','cheque','other')),
  reference    text not null default '' check (char_length(reference) <= 120),   -- traceable banking reference
  approved_by  uuid references public.profiles (id) on delete set null,
  approved_at  timestamptz,
  paid_on      date,
  note         text not null default '' check (char_length(note) <= 600),
  created_at   timestamptz not null default now(),
  check (period_to >= period_from)
);
create index if not exists pn_payouts_partner_idx on public.pn_payouts (partner_id, created_at desc);
alter table public.pn_payouts enable row level security;
drop policy if exists "pn_payouts: mine or staff" on public.pn_payouts;
create policy "pn_payouts: mine or staff" on public.pn_payouts for select using (
  public.has_perm('partners') or exists (select 1 from public.pn_partners p where p.id = pn_payouts.partner_id and p.user_id = auth.uid())
);
revoke insert, update, delete on public.pn_payouts from anon, authenticated;

-- ---------- 9. Training ----------
create table if not exists public.pn_training (
  id        uuid primary key default gen_random_uuid(),
  code      text not null unique check (char_length(code) between 2 and 40),
  title     text not null check (char_length(btrim(title)) between 3 and 160),
  body      text not null default '' check (char_length(body) <= 8000),
  video_url text not null default '' check (char_length(video_url) <= 400),
  required  boolean not null default true,
  sort      int not null default 0,
  active    boolean not null default true
);
alter table public.pn_training enable row level security;
drop policy if exists "pn_training: read" on public.pn_training;
create policy "pn_training: read" on public.pn_training for select using (true);
revoke insert, update, delete on public.pn_training from anon, authenticated;

insert into public.pn_training (code, title, sort, body) values
  ('intro',      'Introduction to RAQBO services', 1,  'What RAQBO offers, how a property moves through the website, and where a partner fits in.'),
  ('listing',    'Property listing standards', 2,      'What a genuine listing must contain, photographs, measurements, and what may never be claimed.'),
  ('customer',   'Customer communication', 3,          'How to speak with buyers, sellers, landlords and tenants, and what may not be promised.'),
  ('verify',     'Buyer and seller verification', 4,   'Identity and ownership checks, and why RAQBO verifies rather than guarantees.'),
  ('documents',  'Document handling', 5,               'Collecting, viewing and returning ownership documents, and what may never be forwarded.'),
  ('quicksell',  'The QuickSell process', 6,           'How an urgent sale is handled, and why pricing and investor information stays confidential.'),
  ('auctions',   'Property auction procedures', 7,     'What a partner may and may not do for a RAQBO auction or an official auction notice.'),
  ('leads',      'The lead management system', 8,      'Accepting a lead, the response window, and what happens if a lead is not answered.'),
  ('commission', 'Commission structure', 9,            'How a share is worked out from the fee RAQBO receives, and when it becomes payable.'),
  ('privacy',    'Customer privacy', 10,               'What a partner may see, what may never be exported, and how activity is logged.'),
  ('fraud',      'Fraud prevention', 11,               'Warning signs, forged documents, and never taking money on RAQBO''s behalf.'),
  ('complaints', 'Complaint handling', 12,             'How a complaint is raised, answered and recorded.'),
  ('conduct',    'Professional conduct', 13,           'The standard expected of anyone carrying the RAQBO name.')
on conflict (code) do nothing;

create table if not exists public.pn_training_done (
  partner_id uuid not null references public.pn_partners (id) on delete cascade,
  code       text not null references public.pn_training (code) on delete cascade,
  done_at    timestamptz not null default now(),
  primary key (partner_id, code)
);
alter table public.pn_training_done enable row level security;
drop policy if exists "pn_training_done: mine or staff" on public.pn_training_done;
create policy "pn_training_done: mine or staff" on public.pn_training_done for select using (
  public.has_perm('partners') or exists (select 1 from public.pn_partners p where p.id = pn_training_done.partner_id and p.user_id = auth.uid())
);
revoke insert, update, delete on public.pn_training_done from anon, authenticated;

-- ---------- 10. Activity log (controlled exports, logged account activity) ----------
create table if not exists public.pn_activity (
  id         bigserial primary key,
  partner_id uuid references public.pn_partners (id) on delete cascade,
  user_id    uuid references public.profiles (id) on delete set null,
  action     text not null check (char_length(action) <= 60),
  entity     text not null default '' check (char_length(entity) <= 60),
  ref        text not null default '' check (char_length(ref) <= 60),
  detail     text not null default '' check (char_length(detail) <= 400),
  at         timestamptz not null default now()
);
create index if not exists pn_activity_partner_idx on public.pn_activity (partner_id, at desc);
alter table public.pn_activity enable row level security;
drop policy if exists "pn_activity: staff" on public.pn_activity;
create policy "pn_activity: staff" on public.pn_activity for select using (public.has_perm('partners'));
revoke insert, update, delete on public.pn_activity from anon, authenticated;

create or replace function public.pn_log(p_partner uuid, p_action text, p_entity text, p_ref text, p_detail text)
returns void language sql security definer set search_path = public as $$
  insert into public.pn_activity (partner_id, user_id, action, entity, ref, detail)
  values (p_partner, auth.uid(), left(p_action, 60), left(coalesce(p_entity, ''), 60), left(coalesce(p_ref, ''), 60), left(coalesce(p_detail, ''), 400));
$$;

-- ---------- 11. Partner listings: never verified just because a partner sent them ----------
alter table public.listings add column if not exists partner_id uuid references public.pn_partners (id) on delete set null;
alter table public.listings add column if not exists owner_authorised boolean not null default false;
alter table public.listings add column if not exists owner_auth_note text not null default '' check (char_length(owner_auth_note) <= 300);
alter table public.listings add column if not exists advert_expires_on date;
create index if not exists listings_partner_idx on public.listings (partner_id, created_at desc) where partner_id is not null;

-- ---------- 12. Helpers ----------
create or replace function public.pn_me() returns uuid language sql stable security definer set search_path = public as $$
  select id from public.pn_partners where user_id = auth.uid()
$$;

create or replace function public.pn_is_partner() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pn_partners where user_id = auth.uid() and status in ('active','probation'))
$$;

-- The commission percentage that applies to a transaction, newest effective rule first.
create or replace function public.pn_rate_for(p_category text, p_service text, p_source text, p_on date)
returns table (pct numeric, src text) language sql stable security definer set search_path = public as $$
  select r.partner_pct,
         'category ' || r.category || ', service ' || r.service || ', lead ' || r.lead_source || ', from ' || r.effective_from
    from public.pn_rates r
   where r.active and r.category = p_category and r.effective_from <= coalesce(p_on, current_date)
     and r.service in (p_service, 'any') and r.lead_source in (p_source, 'any')
   order by (r.service <> 'any') desc, (r.lead_source <> 'any') desc, r.effective_from desc
   limit 1
$$;

-- Find the territory a place belongs to, most specific first.
create or replace function public.pn_territory_for(p_province text, p_city text, p_area text)
returns uuid language sql stable security definer set search_path = public as $$
  select t.id from public.pn_territories t
   where t.status in ('appointed','additional_allowed','available','under_review')
     and (p_city = '' or t.city = '' or lower(t.city) = lower(p_city))
     and (p_province = '' or t.province = '' or lower(t.province) = lower(p_province))
     and (t.level not in ('society','commercial_area','locality') or (p_area <> '' and lower(t.name) = lower(p_area)))
   order by case t.level when 'locality' then 1 when 'society' then 2 when 'commercial_area' then 3
                         when 'town' then 4 when 'city' then 5 when 'tehsil' then 6
                         when 'district' then 7 when 'division' then 8 else 9 end,
            (lower(t.name) = lower(coalesce(nullif(p_area, ''), p_city))) desc
   limit 1
$$;

do $$ begin raise notice 'Update 29 part 1 of 2 applied (tables). Run the rest of the file.'; end $$;

-- =====================================================================
-- PART 2 — what the website and the admin panel actually call
-- =====================================================================

-- ---------- Public: the Become a Partner page ----------
create or replace function public.pn_public()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'settings', (select to_jsonb(s) - 'id' from public.pn_settings s),
    'rates', (select coalesce(jsonb_agg(jsonb_build_object('category', category, 'service', service, 'lead_source', lead_source, 'partner_pct', partner_pct, 'note', note) order by category), '[]'::jsonb)
                from public.pn_rates where active and effective_from <= current_date),
    'training', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'title', title, 'body', body, 'required', required) order by sort), '[]'::jsonb)
                   from public.pn_training where active),
    'partners_live', (select count(*) from public.pn_partners where status in ('active','probation') and listed),
    'cities', (select coalesce(jsonb_agg(distinct city) filter (where city <> ''), '[]'::jsonb) from public.pn_territories where status in ('available','additional_allowed')),
    'territories_open', (select count(*) from public.pn_territories where status in ('available','additional_allowed'))
  )
$$;

-- Territories a visitor may apply for
create or replace function public.pn_territories_open(p_province text default '', p_city text default '')
returns table (id uuid, code text, level text, name text, province text, district text, city text, status text, max_partners int, taken bigint)
language sql stable security definer set search_path = public as $$
  select t.id, t.code, t.level, t.name, t.province, t.district, t.city, t.status, t.max_partners,
         (select count(*) from public.pn_partner_territories pt join public.pn_partners p on p.id = pt.partner_id
           where pt.territory_id = t.id and p.status in ('active','probation'))
    from public.pn_territories t
   where (p_province = '' or lower(t.province) = lower(p_province))
     and (p_city = '' or lower(t.city) = lower(p_city))
   order by t.province, t.city, t.name
$$;

-- ---------- Applying ----------
create or replace function public.pn_apply(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_ref text; v_open boolean; v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Please sign in before applying.'; end if;
  select network_open into v_open from public.pn_settings where id;
  if not coalesce(v_open, false) then raise exception 'RAQBO is not accepting partner applications at the moment.'; end if;
  if not coalesce((p->>'declared')::boolean, false) then
    raise exception 'Please confirm the declaration. An application does not by itself grant any partnership right.';
  end if;
  if exists (select 1 from public.pn_applications where user_id = v_user and stage not in ('rejected','withdrawn')) then
    raise exception 'You already have an application with RAQBO. Please follow it in My RAQBO instead of sending another.';
  end if;
  if exists (select 1 from public.pn_partners where user_id = v_user and status <> 'terminated') then
    raise exception 'You are already a RAQBO partner.';
  end if;

  insert into public.pn_applications (
    user_id, full_name, cnic_last4, phone, whatsapp, email, home_address, office_address, photo_path, background,
    business_type, business_name, ntn, registration_no, dealer_licence, business_years, office_details, affiliations,
    province, city, district, tehsil, area_wanted, territory_id, has_office,
    want_category, exp_years, customer_network, staff_count, categories_handled, marketing, skills, inventory_note,
    services, doc_paths, declared
  ) values (
    v_user,
    btrim(coalesce(p->>'full_name', '')),
    coalesce(nullif(right(regexp_replace(coalesce(p->>'cnic', ''), '[^0-9]', '', 'g'), 4), ''), ''),
    btrim(coalesce(p->>'phone', '')), btrim(coalesce(p->>'whatsapp', '')), btrim(coalesce(p->>'email', '')),
    left(coalesce(p->>'home_address', ''), 300), left(coalesce(p->>'office_address', ''), 300),
    left(coalesce(p->>'photo_path', ''), 400), left(coalesce(p->>'background', ''), 1500),
    coalesce(nullif(p->>'business_type', ''), 'individual'), left(coalesce(p->>'business_name', ''), 160),
    left(coalesce(p->>'ntn', ''), 30), left(coalesce(p->>'registration_no', ''), 60), left(coalesce(p->>'dealer_licence', ''), 80),
    nullif(p->>'business_years', '')::int, left(coalesce(p->>'office_details', ''), 600), left(coalesce(p->>'affiliations', ''), 400),
    left(coalesce(p->>'province', ''), 60), left(coalesce(p->>'city', ''), 60), left(coalesce(p->>'district', ''), 60),
    left(coalesce(p->>'tehsil', ''), 60), left(coalesce(p->>'area_wanted', ''), 200),
    nullif(p->>'territory_id', '')::uuid, coalesce((p->>'has_office')::boolean, false),
    coalesce(nullif(p->>'want_category', ''), 'area'),
    nullif(p->>'exp_years', '')::int, left(coalesce(p->>'customer_network', ''), 600), nullif(p->>'staff_count', '')::int,
    coalesce(array(select jsonb_array_elements_text(coalesce(p->'categories_handled', '[]'::jsonb))), '{}'),
    left(coalesce(p->>'marketing', ''), 600), left(coalesce(p->>'skills', ''), 600), left(coalesce(p->>'inventory_note', ''), 600),
    coalesce(array(select jsonb_array_elements_text(coalesce(p->'services', '[]'::jsonb))), '{}'),
    coalesce(array(select jsonb_array_elements_text(coalesce(p->'doc_paths', '[]'::jsonb))), '{}'),
    true
  ) returning ref into v_ref;

  perform public.notify_admins('partner_application', 'New partner application ' || v_ref,
    btrim(coalesce(p->>'full_name', '')) || ' — ' || coalesce(nullif(p->>'city', ''), 'city not given'), '#admin');
  return v_ref;
end $$;

create or replace function public.pn_my_application()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select to_jsonb(a) from public.pn_applications a where a.user_id = auth.uid()
                    order by a.created_at desc limit 1), 'null'::jsonb)
$$;

-- ---------- The public directory ----------
-- Only approved, active, listed partners, and only the contact details RAQBO approved.
-- Dropped first so that re-running this file after a later update, which
-- adds columns to what the directory returns, cannot fail on the change.
drop function if exists public.pn_directory(text, text, text, text, text);
create function public.pn_directory(p_province text default '', p_city text default '', p_area text default '',
                                               p_service text default '', p_q text default '')
returns table (partner_id text, display_name text, category text, business_type text, city text, province text,
               office_address text, phone text, whatsapp text, email text, services text[], designation text,
               status text, verified boolean, qr_token text, territories jsonb, since date)
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
         p.joined_on
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

-- The QR code on a signboard or business card points here.
create or replace function public.pn_verify_qr(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object(
      'found', true,
      'partner_id', p.partner_id,
      'name', p.display_name,
      'category', p.category,
      'designation', p.designation,
      'status', p.status,
      'active', (p.status = 'active' and p.agreement_ok),
      'office_branding', p.office_branding,
      'may_collect_money', p.may_collect_money,
      'services', to_jsonb(p.services),
      'since', p.joined_on,
      'checked_at', now(),
      'territories', (select coalesce(jsonb_agg(t.name order by t.name), '[]'::jsonb) from public.pn_partner_territories pt
                        join public.pn_territories t on t.id = pt.territory_id where pt.partner_id = p.id)
    ) from public.pn_partners p where p.qr_token = p_token
  ), jsonb_build_object('found', false));
$$;

-- ---------- The partner's own dashboard ----------
create or replace function public.pn_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.pn_me();
begin
  if me is null then return jsonb_build_object('partner', null); end if;
  return jsonb_build_object(
    'partner', (select to_jsonb(p) - 'qr_token' || jsonb_build_object('qr_token', p.qr_token) from public.pn_partners p where p.id = me),
    'territories', (select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'level', t.level, 'city', t.city,
                      'province', t.province, 'status', t.status, 'exclusive', pt.exclusive, 'from', pt.from_date) order by t.name), '[]'::jsonb)
                      from public.pn_partner_territories pt join public.pn_territories t on t.id = pt.territory_id where pt.partner_id = me),
    'agreement', (select to_jsonb(a) from public.pn_agreements a where a.partner_id = me and a.status = 'executed'
                   order by a.executed_on desc nulls last limit 1),
    'listings', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'ref', l.ref, 'title', l.title, 'status', l.status,
                      'city', l.city, 'area', l.area, 'price', l.price, 'purpose', l.purpose,
                      'owner_authorised', l.owner_authorised, 'expires', l.advert_expires_on, 'created', l.created_at)
                      order by l.created_at desc), '[]'::jsonb) from public.listings l where l.partner_id = me),
    'leads', (select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at desc), '[]'::jsonb)
                from public.pn_leads l where l.partner_id = me or l.origin_partner = me),
    'transactions', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
                       from public.pn_transactions x where x.partner_id = me),
    'commissions', (select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc), '[]'::jsonb)
                      from public.pn_commissions c where c.partner_id = me),
    'payouts', (select coalesce(jsonb_agg(to_jsonb(o) order by o.created_at desc), '[]'::jsonb)
                  from public.pn_payouts o where o.partner_id = me),
    'training', (select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'title', t.title, 'body', t.body,
                      'video_url', t.video_url, 'required', t.required,
                      'done', exists (select 1 from public.pn_training_done d where d.partner_id = me and d.code = t.code)) order by t.sort), '[]'::jsonb)
                      from public.pn_training t where t.active),
    'documents', (select coalesce(jsonb_agg(jsonb_build_object('kind', d.kind, 'title', d.title, 'path', d.path, 'expires', d.expires_on) order by d.created_at desc), '[]'::jsonb)
                    from public.pn_documents d where d.partner_id = me),
    'performance', public.pn_performance(me, (current_date - 90), current_date),
    'earnings', (select jsonb_build_object(
          'earned', coalesce(sum(amount) filter (where status in ('approved','paid')), 0),
          'pending', coalesce(sum(amount) filter (where status = 'pending'), 0),
          'paid', coalesce(sum(amount) filter (where status = 'paid'), 0),
          'disputed', coalesce(sum(amount) filter (where status = 'disputed'), 0))
        from public.pn_commissions where partner_id = me)
  );
end $$;

-- Performance figures, worked out from real records only.
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
                     and c.subject_ref = (select partner_id from public.pn_partners where id = p_partner))
  )
$$;

create or replace function public.pn_statement(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.pn_me();
begin
  if me is null then raise exception 'Only a RAQBO partner can download a statement.'; end if;
  return jsonb_build_object(
    'partner', (select jsonb_build_object('partner_id', partner_id, 'name', display_name, 'category', category) from public.pn_partners where id = me),
    'from', p_from, 'to', p_to, 'issued_at', now(),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
        'date', x.completed_on, 'ref', x.ref, 'service', x.service, 'description', x.description,
        'gross_fee', x.gross_fee, 'fee_received', x.fee_received,
        'deductions', (x.tax_deduction + x.third_party + x.refunded + x.other_deduction),
        'deduction_note', x.deduction_note,
        'distributable', c.distributable, 'rate_pct', c.rate_pct, 'amount', c.amount,
        'status', c.status, 'commission_ref', c.ref) order by x.created_at), '[]'::jsonb)
      from public.pn_transactions x join public.pn_commissions c on c.transaction_id = x.id
      where x.partner_id = me and coalesce(x.completed_on, x.created_at::date) between p_from and p_to),
    'total', (select coalesce(sum(c.amount), 0) from public.pn_transactions x join public.pn_commissions c on c.transaction_id = x.id
                where x.partner_id = me and coalesce(x.completed_on, x.created_at::date) between p_from and p_to),
    'note', 'Commission is a share of the service fee RAQBO actually received. It is never a share of the property price.'
  );
end $$;

-- ---------- The partner answering a lead ----------
create or replace function public.pn_lead_accept(p_ref text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := public.pn_me(); l public.pn_leads;
begin
  select * into l from public.pn_leads where ref = p_ref;
  if not found or l.partner_id is distinct from me then raise exception 'That lead is not assigned to you.'; end if;
  if l.stage <> 'assigned' then raise exception 'That lead can no longer be accepted.'; end if;
  if l.accept_by is not null and now() > l.accept_by then
    raise exception 'The time to accept this lead has passed and it has gone back to RAQBO.';
  end if;
  update public.pn_leads set stage = 'accepted', accepted_at = now(), updated_at = now() where id = l.id;
  insert into public.pn_lead_events (lead_id, stage, by_user, note) values (l.id, 'accepted', auth.uid(), '');
  perform public.pn_log(me, 'lead_accept', 'lead', p_ref, '');
end $$;

create or replace function public.pn_lead_decline(p_ref text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := public.pn_me(); l public.pn_leads;
begin
  select * into l from public.pn_leads where ref = p_ref;
  if not found or l.partner_id is distinct from me then raise exception 'That lead is not assigned to you.'; end if;
  update public.pn_leads set stage = 'returned', partner_id = null, declined_at = now(),
         decline_reason = left(coalesce(p_reason, ''), 400), updated_at = now() where id = l.id;
  insert into public.pn_lead_events (lead_id, stage, by_user, note) values (l.id, 'returned', auth.uid(), left(coalesce(p_reason, ''), 600));
  perform public.notify_admins('partner_lead', 'Lead ' || p_ref || ' returned to RAQBO', coalesce(p_reason, 'Declined by the partner.'), '#admin');
  perform public.pn_log(me, 'lead_decline', 'lead', p_ref, left(coalesce(p_reason, ''), 400));
end $$;

create or replace function public.pn_lead_stage(p_ref text, p_stage text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := public.pn_me(); l public.pn_leads;
begin
  select * into l from public.pn_leads where ref = p_ref;
  if not found then raise exception 'Lead not found.'; end if;
  if not public.has_perm('partners') and l.partner_id is distinct from me then
    raise exception 'That lead is not yours.';
  end if;
  if p_stage not in ('contacted','site_visit','negotiation','completed','lost') then
    raise exception 'That is not a step a partner can set.';
  end if;
  if l.accepted_at is null and not public.has_perm('partners') then
    raise exception 'Accept the lead before moving it forward.';
  end if;
  update public.pn_leads set
    stage = p_stage,
    stage_note = left(coalesce(p_note, ''), 600),
    contacted_at = case when p_stage = 'contacted' and contacted_at is null then now() else contacted_at end,
    visit_at     = case when p_stage = 'site_visit' and visit_at is null then now() else visit_at end,
    completed_at = case when p_stage = 'completed' then now() else completed_at end,
    lost_reason  = case when p_stage = 'lost' then left(coalesce(p_note, ''), 400) else lost_reason end,
    updated_at = now()
  where id = l.id;
  insert into public.pn_lead_events (lead_id, stage, by_user, note) values (l.id, p_stage, auth.uid(), left(coalesce(p_note, ''), 600));
  perform public.pn_log(coalesce(me, l.partner_id), 'lead_' || p_stage, 'lead', p_ref, left(coalesce(p_note, ''), 400));
end $$;

create or replace function public.pn_training_complete(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := public.pn_me(); need int; done int;
begin
  if me is null then raise exception 'Only a RAQBO partner can record training.'; end if;
  insert into public.pn_training_done (partner_id, code) values (me, p_code) on conflict do nothing;
  select count(*) into need from public.pn_training where active and required;
  select count(*) into done from public.pn_training_done d join public.pn_training t on t.code = d.code
    where d.partner_id = me and t.active and t.required;
  update public.pn_partners set training_done = (done >= need), updated_at = now() where id = me;
  perform public.pn_log(me, 'training', 'module', p_code, '');
end $$;

create or replace function public.pn_profile_save(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := public.pn_me();
begin
  if me is null then raise exception 'Only a RAQBO partner can change a partner profile.'; end if;
  -- A partner may change how they are reached and described, never their
  -- category, territory, designation or any permission.
  update public.pn_partners set
    phone = left(coalesce(p->>'phone', phone), 20),
    whatsapp = left(coalesce(p->>'whatsapp', whatsapp), 20),
    email = left(coalesce(p->>'email', email), 160),
    office_address = left(coalesce(p->>'office_address', office_address), 300),
    about = left(coalesce(p->>'about', about), 1200),
    photo_path = left(coalesce(p->>'photo_path', photo_path), 400),
    listed = coalesce((p->>'listed')::boolean, listed),
    updated_at = now()
  where id = me;
  perform public.pn_log(me, 'profile_save', 'partner', '', '');
end $$;

-- A partner sending an urgent-sale opportunity. Pricing and investor
-- information stays with RAQBO; the partner only reports the opportunity.
create or replace function public.pn_quicksell(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := public.pn_me(); v_ref text;
begin
  if me is null or not public.pn_is_partner() then raise exception 'Only an active RAQBO partner can send an opportunity.'; end if;
  insert into public.pn_leads (source, origin_partner, kind, service, customer_name, customer_phone, customer_note,
                               province, city, area, territory_id, stage)
  values ('partner', me, 'quicksell', 'quicksell',
          left(coalesce(p->>'owner_name', ''), 120), left(coalesce(p->>'phone', ''), 20),
          left(coalesce(p->>'detail', ''), 1000),
          left(coalesce(p->>'province', ''), 60), left(coalesce(p->>'city', ''), 60), left(coalesce(p->>'area', ''), 120),
          public.pn_territory_for(coalesce(p->>'province', ''), coalesce(p->>'city', ''), coalesce(p->>'area', '')),
          'raqbo_review')
  returning ref into v_ref;
  insert into public.pn_lead_events (lead_id, stage, by_user, note)
    select id, 'raqbo_review', auth.uid(), 'Urgent-sale opportunity sent by a partner.' from public.pn_leads where ref = v_ref;
  perform public.notify_admins('partner_quicksell', 'QuickSell opportunity ' || v_ref || ' from a partner',
    left(coalesce(p->>'detail', ''), 200), '#admin');
  perform public.pn_log(me, 'quicksell', 'lead', v_ref, '');
  return v_ref;
end $$;

-- =====================================================================
-- PART 3 — RAQBO Partner Network Management (admin)
-- =====================================================================

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
        'owed', (select coalesce(sum(c.amount), 0) from public.pn_commissions c where c.partner_id = p.id and c.status = 'approved')
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

-- ---------- Applications: the nine-step process ----------
create or replace function public.pn_app_stage(p_id uuid, p_stage text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.pn_applications;
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  select * into a from public.pn_applications where id = p_id;
  if not found then raise exception 'Application not found.'; end if;
  if p_stage = 'interview' and not (a.identity_verified and a.business_verified) then
    raise exception 'Verify identity and business details before the interview stage.';
  end if;
  update public.pn_applications set stage = p_stage, stage_note = left(coalesce(p_note, ''), 1000),
         reject_reason = case when p_stage = 'rejected' then left(coalesce(p_note, ''), 600) else reject_reason end,
         reviewed_by = auth.uid(), updated_at = now()
   where id = p_id;
  if a.user_id is not null then
    perform public.notify(a.user_id, 'partner_application', 'Your partner application: ' || replace(p_stage, '_', ' '),
      coalesce(nullif(p_note, ''), 'Your application has moved forward.'), '#my-raqbo');
  end if;
  perform public.audit('pn_app_stage', 'pn_application', a.ref, p_stage, null);
end $$;

create or replace function public.pn_app_review(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  update public.pn_applications set
    score_reputation = coalesce((p->>'score_reputation')::int, score_reputation),
    score_experience = coalesce((p->>'score_experience')::int, score_experience),
    score_competence = coalesce((p->>'score_competence')::int, score_competence),
    score_customers = coalesce((p->>'score_customers')::int, score_customers),
    score_compliance = coalesce((p->>'score_compliance')::int, score_compliance),
    score_capacity = coalesce((p->>'score_capacity')::int, score_capacity),
    score_communication = coalesce((p->>'score_communication')::int, score_communication),
    score_premises = coalesce((p->>'score_premises')::int, score_premises),
    score_standards = coalesce((p->>'score_standards')::int, score_standards),
    identity_verified = coalesce((p->>'identity_verified')::boolean, identity_verified),
    business_verified = coalesce((p->>'business_verified')::boolean, business_verified),
    interview_at = coalesce(nullif(p->>'interview_at', '')::timestamptz, interview_at),
    interview_note = left(coalesce(p->>'interview_note', interview_note), 1500),
    reviewed_by = auth.uid(), updated_at = now()
  where id = (p->>'id')::uuid;
end $$;

-- Approving an application creates the partner record. It does NOT make
-- the partner active: that needs an executed agreement and training.
create or replace function public.pn_app_approve(p_id uuid, p_category text, p_designation text)
returns text language plpgsql security definer set search_path = public as $$
declare a public.pn_applications; v_pid text; v_new uuid;
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  select * into a from public.pn_applications where id = p_id;
  if not found then raise exception 'Application not found.'; end if;
  if a.user_id is null then raise exception 'This application has no RAQBO account attached, so no partner account can be created.'; end if;
  if not (a.identity_verified and a.business_verified) then
    raise exception 'Identity and business details must be verified before a partner is appointed.';
  end if;
  if p_category = 'franchise' and not (select franchise_open from public.pn_settings where id) then
    raise exception 'Full franchises are not open yet. Appoint as an Area Partner, or open franchising in the settings first.';
  end if;
  if exists (select 1 from public.pn_partners where user_id = a.user_id and status <> 'terminated') then
    raise exception 'This person is already a RAQBO partner.';
  end if;

  insert into public.pn_partners (user_id, application_id, category, display_name, business_type, ntn, registration_no,
                                  phone, whatsapp, email, office_address, photo_path, services, designation, status)
  values (a.user_id, a.id, p_category,
          coalesce(nullif(a.business_name, ''), a.full_name), a.business_type, a.ntn, a.registration_no,
          a.phone, a.whatsapp, a.email, a.office_address, a.photo_path, a.services,
          left(coalesce(nullif(p_designation, ''),
            case p_category when 'franchise' then 'RAQBO Franchise Partner'
                            when 'area' then 'RAQBO Authorised Area Partner' || case when a.area_wanted <> '' then ' — ' || a.area_wanted when a.city <> '' then ' — ' || a.city else '' end
                            else 'RAQBO Associate Partner' end), 120),
          'under_review')
  returning id, partner_id into v_new, v_pid;

  if a.territory_id is not null then
    insert into public.pn_partner_territories (partner_id, territory_id) values (v_new, a.territory_id) on conflict do nothing;
    update public.pn_territories set status = 'appointed', updated_at = now()
      where id = a.territory_id and status in ('available','under_review');
  end if;

  update public.pn_applications set stage = 'agreement', stage_note = 'Approved. Waiting for the agreement to be executed.',
         reviewed_by = auth.uid(), updated_at = now() where id = p_id;
  perform public.notify(a.user_id, 'partner', 'You have been approved as a RAQBO partner',
    'Your partner number is ' || v_pid || '. Your account becomes active once the agreement is signed and training is complete.', '#my-raqbo');
  perform public.audit('pn_app_approve', 'pn_partner', v_pid, p_category, null);
  return v_pid;
end $$;

-- ---------- Partner status, territory, permissions ----------
create or replace function public.pn_partner_status(p_partner_id text, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare p public.pn_partners;
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  select * into p from public.pn_partners where partner_id = p_partner_id;
  if not found then raise exception 'Partner not found.'; end if;
  if p_status = 'active' then
    if not p.agreement_ok then raise exception 'This partner cannot be made active until an agreement has been executed.'; end if;
    if not p.training_done then raise exception 'This partner cannot be made active until the required training is complete.'; end if;
  end if;
  update public.pn_partners set status = p_status, status_note = left(coalesce(p_note, ''), 600), status_at = now(),
         joined_on = coalesce(joined_on, case when p_status = 'active' then current_date end),
         updated_at = now()
   where id = p.id;
  -- A suspended or terminated partner keeps no open leads.
  if p_status in ('suspended','terminated') then
    update public.pn_leads set partner_id = null, stage = 'returned', updated_at = now()
      where partner_id = p.id and stage in ('assigned','accepted','contacted','site_visit','negotiation');
  end if;
  perform public.notify(p.user_id, 'partner', 'Your RAQBO partner status: ' || p_status, coalesce(nullif(p_note, ''), ''), '#my-raqbo');
  perform public.audit('pn_partner_status', 'pn_partner', p_partner_id, p_status, null);
end $$;

create or replace function public.pn_partner_powers(p_partner_id text, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  update public.pn_partners set
    services = coalesce(array(select jsonb_array_elements_text(p->'services')), services),
    designation = left(coalesce(p->>'designation', designation), 120),
    branding_approved = coalesce((p->>'branding_approved')::boolean, branding_approved),
    office_branding = coalesce((p->>'office_branding')::boolean, office_branding),
    may_collect_money = coalesce((p->>'may_collect_money')::boolean, may_collect_money),
    may_run_auction = coalesce((p->>'may_run_auction')::boolean, may_run_auction),
    listed = coalesce((p->>'listed')::boolean, listed),
    updated_at = now()
  where partner_id = p_partner_id;
  perform public.audit('pn_partner_powers', 'pn_partner', p_partner_id, '', p);
end $$;

create or replace function public.pn_territory_save(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  if (p->>'id') is not null and (p->>'id') <> '' then
    update public.pn_territories set
      level = coalesce(nullif(p->>'level', ''), level),
      name = coalesce(nullif(btrim(p->>'name'), ''), name),
      province = coalesce(p->>'province', province), division = coalesce(p->>'division', division),
      district = coalesce(p->>'district', district), tehsil = coalesce(p->>'tehsil', tehsil),
      city = coalesce(p->>'city', city), boundary_note = left(coalesce(p->>'boundary_note', boundary_note), 600),
      status = coalesce(nullif(p->>'status', ''), status),
      max_partners = coalesce((p->>'max_partners')::int, max_partners),
      exclusive = coalesce((p->>'exclusive')::boolean, exclusive),
      exclusive_until = coalesce(nullif(p->>'exclusive_until', '')::date, exclusive_until),
      min_monthly_deals = coalesce((p->>'min_monthly_deals')::int, min_monthly_deals),
      note = left(coalesce(p->>'note', note), 600), updated_at = now()
    where id = (p->>'id')::uuid returning id into v_id;
  else
    insert into public.pn_territories (level, name, province, division, district, tehsil, city, boundary_note, status, max_partners, note)
    values (coalesce(nullif(p->>'level', ''), 'city'), btrim(coalesce(p->>'name', '')),
            coalesce(p->>'province', ''), coalesce(p->>'division', ''), coalesce(p->>'district', ''),
            coalesce(p->>'tehsil', ''), coalesce(p->>'city', ''), left(coalesce(p->>'boundary_note', ''), 600),
            coalesce(nullif(p->>'status', ''), 'available'), coalesce((p->>'max_partners')::int, 1),
            left(coalesce(p->>'note', ''), 600))
    returning id into v_id;
  end if;
  perform public.audit('pn_territory_save', 'pn_territory', coalesce(p->>'name', ''), '', null);
  return v_id;
end $$;

create or replace function public.pn_territory_assign(p_partner_id text, p_territory uuid, p_exclusive boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_p uuid; v_t public.pn_territories; v_count int;
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  select id into v_p from public.pn_partners where partner_id = p_partner_id;
  if v_p is null then raise exception 'Partner not found.'; end if;
  select * into v_t from public.pn_territories where id = p_territory;
  if not found then raise exception 'Territory not found.'; end if;
  if v_t.status in ('suspended','reserved') then raise exception 'That territory is % and cannot be given to a partner.', v_t.status; end if;
  select count(*) into v_count from public.pn_partner_territories pt join public.pn_partners p on p.id = pt.partner_id
   where pt.territory_id = p_territory and p.status in ('active','probation','under_review') and pt.partner_id <> v_p;
  if exists (select 1 from public.pn_partner_territories pt where pt.territory_id = p_territory and pt.exclusive and pt.partner_id <> v_p) then
    raise exception 'Another partner already holds this territory exclusively.';
  end if;
  if v_count >= v_t.max_partners then
    raise exception 'This territory already has the number of partners it allows (%). Raise the limit first if that is intended.', v_t.max_partners;
  end if;
  insert into public.pn_partner_territories (partner_id, territory_id, exclusive)
  values (v_p, p_territory, coalesce(p_exclusive, false))
  on conflict (partner_id, territory_id) do update set exclusive = coalesce(p_exclusive, false);
  update public.pn_territories set status = case when status in ('available','under_review') then 'appointed' else status end,
         exclusive = coalesce(p_exclusive, exclusive), updated_at = now() where id = p_territory;
  perform public.audit('pn_territory_assign', 'pn_partner', p_partner_id, v_t.name, null);
end $$;

create or replace function public.pn_territory_remove(p_partner_id text, p_territory uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  delete from public.pn_partner_territories
   where territory_id = p_territory and partner_id = (select id from public.pn_partners where partner_id = p_partner_id);
  update public.pn_territories t set status = 'available', exclusive = false, updated_at = now()
   where t.id = p_territory and not exists (select 1 from public.pn_partner_territories pt where pt.territory_id = t.id);
end $$;

-- ---------- Agreements ----------
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
      status = v_status,
      executed_on = case when v_status = 'executed' then coalesce(nullif(p->>'executed_on', '')::date, current_date) else executed_on end,
      file_path = coalesce(p->>'file_path', file_path), note = left(coalesce(p->>'note', note), 600), updated_at = now()
    where id = (p->>'id')::uuid returning ref into v_ref;
  else
    insert into public.pn_agreements (partner_id, category, parties, relationship, services, territory_text, exclusivity,
      starts_on, ends_on, renewal, commission_text, lead_allocation, local_expenses, brand_use, data_protection,
      reporting, restrictions, disputes, termination, after_termination, territory_entitlement, legal_reviewed, status, executed_on, file_path, note)
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
      coalesce(p->>'file_path', ''), left(coalesce(p->>'note', ''), 600))
    returning ref into v_ref;
  end if;
  perform public.audit('pn_agreement_save', 'pn_agreement', v_ref, v_status, null);
  return v_ref;
end $$;

-- ---------- Leads: creation, routing, return ----------
create or replace function public.pn_lead_create(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_ref text; v_terr uuid;
begin
  if not public.has_perm('partners') and not public.pn_is_partner() then
    raise exception 'Only RAQBO staff or an active partner can record a lead.';
  end if;
  v_terr := public.pn_territory_for(coalesce(p->>'province', ''), coalesce(p->>'city', ''), coalesce(p->>'area', ''));
  insert into public.pn_leads (source, origin_partner, kind, service, listing_id, enquiry_id,
                               customer_name, customer_phone, customer_note, province, city, area, territory_id, stage)
  values (coalesce(nullif(p->>'source', ''), case when public.pn_is_partner() then 'partner' else 'raqbo' end),
          case when public.pn_is_partner() then public.pn_me() else nullif(p->>'origin_partner', '')::uuid end,
          coalesce(nullif(p->>'kind', ''), 'buyer'), left(coalesce(p->>'service', ''), 60),
          nullif(p->>'listing_id', '')::uuid, nullif(p->>'enquiry_id', '')::uuid,
          left(coalesce(p->>'customer_name', ''), 120), left(coalesce(p->>'customer_phone', ''), 20),
          left(coalesce(p->>'customer_note', ''), 1000),
          left(coalesce(p->>'province', ''), 60), left(coalesce(p->>'city', ''), 60), left(coalesce(p->>'area', ''), 120),
          v_terr, 'raqbo_review')
  returning ref into v_ref;
  insert into public.pn_lead_events (lead_id, stage, by_user, note)
    select id, 'new', auth.uid(), '' from public.pn_leads where ref = v_ref;
  return v_ref;
end $$;

-- RAQBO assigns a lead. Territory, authorisation, workload and conflict are checked.
create or replace function public.pn_lead_assign(p_ref text, p_partner_id text)
returns void language plpgsql security definer set search_path = public as $$
declare l public.pn_leads; p public.pn_partners; v_hours int; v_load int;
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  select * into l from public.pn_leads where ref = p_ref;
  if not found then raise exception 'Lead not found.'; end if;
  select * into p from public.pn_partners where partner_id = p_partner_id;
  if not found then raise exception 'Partner not found.'; end if;
  if p.status not in ('active','probation') then
    raise exception 'A lead can only go to an active partner. This partner is %.', p.status;
  end if;
  if l.service <> '' and array_length(p.services, 1) is not null and not (l.service = any (p.services)) then
    raise exception 'This partner is not authorised for %.', l.service;
  end if;
  if l.territory_id is not null and not exists (
       select 1 from public.pn_partner_territories pt where pt.partner_id = p.id and pt.territory_id = l.territory_id) then
    -- allowed, but recorded, because RAQBO may assign outside a territory deliberately
    insert into public.pn_lead_events (lead_id, stage, by_user, note)
      values (l.id, 'assigned', auth.uid(), 'Assigned outside the partner''s own territory.');
  end if;
  select count(*) into v_load from public.pn_leads where partner_id = p.id and stage in ('assigned','accepted','contacted','site_visit','negotiation');
  select lead_accept_hours into v_hours from public.pn_settings where id;
  update public.pn_leads set partner_id = p.id, stage = 'assigned', assigned_at = now(),
         accept_by = now() + make_interval(hours => coalesce(v_hours, 24)),
         accepted_at = null, declined_at = null, handled_by_raqbo = false, updated_at = now()
   where id = l.id;
  insert into public.pn_lead_events (lead_id, stage, by_user, note)
    values (l.id, 'assigned', auth.uid(), 'Assigned to ' || p.display_name || ' (' || v_load || ' already open)');
  perform public.notify(p.user_id, 'partner_lead', 'New lead ' || p_ref,
    'Please accept it within ' || coalesce(v_hours, 24) || ' hours or it returns to RAQBO.', '#my-raqbo');
  perform public.audit('pn_lead_assign', 'pn_lead', p_ref, p_partner_id, null);
end $$;

create or replace function public.pn_lead_return(p_ref text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare l public.pn_leads;
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  select * into l from public.pn_leads where ref = p_ref;
  if not found then raise exception 'Lead not found.'; end if;
  update public.pn_leads set partner_id = null, stage = 'returned', reassigned = reassigned + 1,
         stage_note = left(coalesce(p_note, ''), 600), updated_at = now() where id = l.id;
  insert into public.pn_lead_events (lead_id, stage, by_user, note) values (l.id, 'returned', auth.uid(), left(coalesce(p_note, ''), 600));
end $$;

-- RAQBO may always deal with a customer itself.
create or replace function public.pn_lead_take(p_ref text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  update public.pn_leads set handled_by_raqbo = true, partner_id = null, stage = 'raqbo_review', updated_at = now() where ref = p_ref;
  insert into public.pn_lead_events (lead_id, stage, by_user, note)
    select id, 'raqbo_review', auth.uid(), 'RAQBO is handling this customer directly.' from public.pn_leads where ref = p_ref;
end $$;

-- Leads nobody answered in time go back to RAQBO. Run by the website or a schedule.
create or replace function public.pn_lead_sweep()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with gone as (
    update public.pn_leads set stage = 'returned', partner_id = null, reassigned = reassigned + 1,
           stage_note = 'The partner did not accept in time, so it came back to RAQBO.', updated_at = now()
     where stage = 'assigned' and accept_by is not null and accept_by < now()
    returning id
  )
  insert into public.pn_lead_events (lead_id, stage, note) select id, 'returned', 'No answer within the agreed time.' from gone;
  get diagnostics n = row_count;
  if n > 0 then perform public.notify_admins('partner_lead', n || ' lead(s) came back to RAQBO', 'A partner did not answer in time.', '#admin'); end if;
  return n;
end $$;

-- ---------- Transactions and commission ----------
-- The commission is worked out from the fee RAQBO actually received, less
-- agreed deductions. It is never a share of the property price.
create or replace function public.pn_tx_save(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_ref text; v_tx public.pn_transactions; v_p public.pn_partners; v_pct numeric; v_src text; v_dist bigint; v_amount bigint;
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  select * into v_p from public.pn_partners where partner_id = (p->>'partner_id');
  if v_p is null then raise exception 'Partner not found.'; end if;

  if (p->>'id') is not null and (p->>'id') <> '' then
    update public.pn_transactions set
      service = left(coalesce(p->>'service', service), 60), description = left(coalesce(p->>'description', description), 600),
      lead_source = coalesce(nullif(p->>'lead_source', ''), lead_source),
      property_value = coalesce((p->>'property_value')::bigint, property_value),
      gross_fee = coalesce((p->>'gross_fee')::bigint, gross_fee),
      fee_received = coalesce((p->>'fee_received')::bigint, fee_received),
      tax_deduction = coalesce((p->>'tax_deduction')::bigint, tax_deduction),
      third_party = coalesce((p->>'third_party')::bigint, third_party),
      refunded = coalesce((p->>'refunded')::bigint, refunded),
      other_deduction = coalesce((p->>'other_deduction')::bigint, other_deduction),
      deduction_note = left(coalesce(p->>'deduction_note', deduction_note), 400),
      stage = coalesce(nullif(p->>'stage', ''), stage),
      completed_on = coalesce(nullif(p->>'completed_on', '')::date, completed_on),
      updated_at = now()
    where id = (p->>'id')::uuid returning * into v_tx;
  else
    insert into public.pn_transactions (lead_id, partner_id, listing_id, service, description, lead_source,
        property_value, gross_fee, fee_received, tax_deduction, third_party, refunded, other_deduction, deduction_note, stage, completed_on)
    values (nullif(p->>'lead_id', '')::uuid, v_p.id, nullif(p->>'listing_id', '')::uuid,
        left(coalesce(p->>'service', ''), 60), left(coalesce(p->>'description', ''), 600),
        coalesce(nullif(p->>'lead_source', ''), 'raqbo'),
        nullif(p->>'property_value', '')::bigint, coalesce((p->>'gross_fee')::bigint, 0), coalesce((p->>'fee_received')::bigint, 0),
        coalesce((p->>'tax_deduction')::bigint, 0), coalesce((p->>'third_party')::bigint, 0),
        coalesce((p->>'refunded')::bigint, 0), coalesce((p->>'other_deduction')::bigint, 0),
        left(coalesce(p->>'deduction_note', ''), 400), coalesce(nullif(p->>'stage', ''), 'open'),
        nullif(p->>'completed_on', '')::date)
    returning * into v_tx;
  end if;
  v_ref := v_tx.ref;

  -- No commission until RAQBO has actually received the fee.
  if v_tx.fee_received <= 0 then
    delete from public.pn_commissions where transaction_id = v_tx.id and status = 'pending';
    return v_ref;
  end if;

  v_dist := greatest(v_tx.fee_received - v_tx.tax_deduction - v_tx.third_party - v_tx.refunded - v_tx.other_deduction, 0);
  select pct, src into v_pct, v_src from public.pn_rate_for(v_p.category, nullif(v_tx.service, ''), v_tx.lead_source, v_tx.completed_on);
  if v_pct is null then
    raise exception 'No commission rule applies to a % partner on a % lead dated %. Add or back-date a rule under Property partners → Commission rates.',
      v_p.category, v_tx.lead_source, coalesce(v_tx.completed_on, current_date);
  end if;
  v_amount := round(v_dist * v_pct / 100.0);

  insert into public.pn_commissions (transaction_id, partner_id, rate_pct, rate_source, distributable, amount)
  values (v_tx.id, v_p.id, v_pct, coalesce(v_src, ''), v_dist, v_amount)
  on conflict (transaction_id) do update set
    rate_pct = excluded.rate_pct, rate_source = excluded.rate_source,
    distributable = excluded.distributable,
    amount = case when public.pn_commissions.status in ('paid','approved') then public.pn_commissions.amount else excluded.amount end,
    updated_at = now()
  where public.pn_commissions.status not in ('paid');

  perform public.audit('pn_tx_save', 'pn_transaction', v_ref, v_tx.stage, null);
  return v_ref;
end $$;

create or replace function public.pn_commission_status(p_ref text, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.pn_commissions;
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  select * into c from public.pn_commissions where ref = p_ref;
  if not found then raise exception 'Commission not found.'; end if;
  if p_status = 'paid' and c.status <> 'approved' then raise exception 'Approve the commission before marking it paid.'; end if;
  update public.pn_commissions set status = p_status,
         dispute_note = case when p_status = 'disputed' then left(coalesce(p_note, ''), 800) else dispute_note end,
         dispute_outcome = case when c.status = 'disputed' and p_status <> 'disputed' then left(coalesce(p_note, ''), 800) else dispute_outcome end,
         approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
         approved_at = case when p_status = 'approved' then now() else approved_at end,
         updated_at = now()
   where id = c.id;
  perform public.notify((select user_id from public.pn_partners where id = c.partner_id), 'partner_money',
    'Commission ' || p_ref || ': ' || p_status, coalesce(nullif(p_note, ''), ''), '#my-raqbo');
  perform public.audit('pn_commission_status', 'pn_commission', p_ref, p_status, null);
end $$;

-- A partner may query a commission. It is reviewed, never silently changed.
create or replace function public.pn_commission_dispute(p_ref text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := public.pn_me(); c public.pn_commissions;
begin
  select * into c from public.pn_commissions where ref = p_ref;
  if not found or c.partner_id is distinct from me then raise exception 'That commission is not yours.'; end if;
  if c.status = 'paid' then raise exception 'This commission has already been paid. Please raise a complaint instead.'; end if;
  update public.pn_commissions set status = 'disputed', dispute_note = left(coalesce(p_reason, ''), 800), updated_at = now() where id = c.id;
  perform public.notify_admins('partner_money', 'Commission ' || p_ref || ' queried by a partner', left(coalesce(p_reason, ''), 200), '#admin');
  perform public.pn_log(me, 'commission_dispute', 'commission', p_ref, left(coalesce(p_reason, ''), 400));
end $$;

-- ---------- Payouts ----------
create or replace function public.pn_payout_build(p_partner_id text, p_from date, p_to date)
returns text language plpgsql security definer set search_path = public as $$
declare v_p uuid; v_ref text; v_total bigint; v_new uuid;
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  select id into v_p from public.pn_partners where partner_id = p_partner_id;
  if v_p is null then raise exception 'Partner not found.'; end if;
  select coalesce(sum(amount), 0) into v_total from public.pn_commissions
   where partner_id = v_p and status = 'approved' and payout_id is null
     and created_at::date between p_from and p_to;
  if v_total <= 0 then raise exception 'There is no approved commission for this partner in that period.'; end if;
  insert into public.pn_payouts (partner_id, period_from, period_to, amount) values (v_p, p_from, p_to, v_total)
    returning id, ref into v_new, v_ref;
  update public.pn_commissions set payout_id = v_new, updated_at = now()
   where partner_id = v_p and status = 'approved' and payout_id is null and created_at::date between p_from and p_to;
  perform public.audit('pn_payout_build', 'pn_payout', v_ref, v_total::text, null);
  return v_ref;
end $$;

create or replace function public.pn_payout_status(p_ref text, p_status text, p_method text, p_reference text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.pn_payouts;
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  select * into o from public.pn_payouts where ref = p_ref;
  if not found then raise exception 'Payout not found.'; end if;
  if p_status = 'paid' then
    if o.status <> 'approved' then raise exception 'A payout must be approved before it is marked paid.'; end if;
    if coalesce(btrim(p_reference), '') = '' then
      raise exception 'Record the bank reference. Partner payments must go through a traceable banking channel.';
    end if;
  end if;
  if p_status = 'approved' and not public.is_full_admin() then
    raise exception 'Only a full admin can approve a partner payment.';
  end if;
  update public.pn_payouts set status = p_status,
         method = coalesce(nullif(p_method, ''), method), reference = left(coalesce(p_reference, reference), 120),
         approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
         approved_at = case when p_status = 'approved' then now() else approved_at end,
         paid_on = case when p_status = 'paid' then current_date else paid_on end
   where id = o.id;
  if p_status = 'paid' then
    update public.pn_commissions set status = 'paid', updated_at = now() where payout_id = o.id and status = 'approved';
    perform public.notify((select user_id from public.pn_partners where id = o.partner_id), 'partner_money',
      'Payment sent: ' || p_ref, 'Reference ' || coalesce(p_reference, ''), '#my-raqbo');
  elsif p_status = 'cancelled' then
    update public.pn_commissions set payout_id = null, updated_at = now() where payout_id = o.id;
  end if;
  perform public.audit('pn_payout_status', 'pn_payout', p_ref, p_status, null);
end $$;

-- ---------- Settings and rates ----------
create or replace function public.pn_save_settings(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  update public.pn_settings set
    network_open = coalesce((p->>'network_open')::boolean, network_open),
    lead_accept_hours = coalesce((p->>'lead_accept_hours')::int, lead_accept_hours),
    lead_contact_hours = coalesce((p->>'lead_contact_hours')::int, lead_contact_hours),
    pilot_note = left(coalesce(p->>'pilot_note', pilot_note), 600),
    directory_public = coalesce((p->>'directory_public')::boolean, directory_public),
    franchise_open = coalesce((p->>'franchise_open')::boolean, franchise_open),
    intro_note = left(coalesce(p->>'intro_note', intro_note), 1200),
    updated_at = now()
  where id;
  perform public.audit('pn_save_settings', 'pn_settings', '', '', p);
end $$;

create or replace function public.pn_save_rate(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_before jsonb;
begin
  if not public.has_perm('partners') then raise exception 'Admins only.'; end if;
  if (p->>'id') is not null and (p->>'id') <> '' then
    select to_jsonb(r) into v_before from public.pn_rates r where r.id = (p->>'id')::uuid;
    update public.pn_rates set
      partner_pct = coalesce((p->>'partner_pct')::numeric, partner_pct),
      note = left(coalesce(p->>'note', note), 300),
      active = coalesce((p->>'active')::boolean, active)
    where id = (p->>'id')::uuid returning id into v_id;
  else
    insert into public.pn_rates (category, service, lead_source, partner_pct, note, effective_from)
    values (p->>'category', coalesce(nullif(p->>'service', ''), 'any'), coalesce(nullif(p->>'lead_source', ''), 'any'),
            (p->>'partner_pct')::numeric, left(coalesce(p->>'note', ''), 300),
            coalesce(nullif(p->>'effective_from', '')::date, current_date))
    on conflict (category, service, lead_source, effective_from) do update
      set partner_pct = excluded.partner_pct, note = excluded.note, active = true
    returning id into v_id;
  end if;
  insert into public.pn_rate_history (rate_id, changed_by, before_val, after_val)
    values (v_id, auth.uid(), v_before, (select to_jsonb(r) from public.pn_rates r where r.id = v_id));
  perform public.audit('pn_save_rate', 'pn_rate', coalesce(p->>'category', ''), coalesce(p->>'partner_pct', ''), null);
  return v_id;
end $$;

-- ---------- Document expiry reminders ----------
create or replace function public.pn_doc_remind()
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  for r in select d.id, d.title, d.kind, d.expires_on, p.user_id, p.display_name, p.partner_id
             from public.pn_documents d join public.pn_partners p on p.id = d.partner_id
            where d.expires_on is not null and d.expires_on <= current_date + 30
              and (d.reminded_at is null or d.reminded_at < now() - interval '14 days')
  loop
    perform public.notify(r.user_id, 'partner', 'A document on your RAQBO partner file expires soon',
      coalesce(nullif(r.title, ''), r.kind) || ' expires on ' || r.expires_on || '. Please send an up-to-date copy.', '#my-raqbo');
    update public.pn_documents set reminded_at = now() where id = r.id;
    n := n + 1;
  end loop;
  if n > 0 then perform public.notify_admins('partner', n || ' partner document(s) expiring', 'See Property partners → Documents.', '#admin'); end if;
  return n;
end $$;

-- ---------- Partner-submitted listings ----------
-- A listing from a partner is never verified merely because a partner sent it.
create or replace function public.pn_claim_listing(p_listing uuid, p_authorised boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := public.pn_me();
begin
  if me is null or not public.pn_is_partner() then raise exception 'Only an active RAQBO partner can do this.'; end if;
  if not coalesce(p_authorised, false) then
    raise exception 'Confirm that the owner has authorised this advertisement before sending it.';
  end if;
  if exists (select 1 from public.listings where id = p_listing and partner_id is not null and partner_id <> me) then
    raise exception 'Another partner has already submitted this property.';
  end if;
  update public.listings set partner_id = me, owner_authorised = true,
         owner_auth_note = left(coalesce(p_note, ''), 300),
         advert_expires_on = coalesce(advert_expires_on, current_date + 90)
   where id = p_listing;
  perform public.pn_log(me, 'listing_claim', 'listing', p_listing::text, left(coalesce(p_note, ''), 400));
end $$;

-- Duplicate check before a partner sends a property
create or replace function public.pn_duplicate_check(p_city text, p_area text, p_size numeric, p_price bigint)
returns table (ref text, title text, status text, city text, area text, price bigint)
language sql stable security definer set search_path = public as $$
  select l.ref, l.title, l.status, l.city, l.area, l.price
    from public.listings l
   where l.status in ('published','pending')
     and lower(l.city) = lower(coalesce(p_city, ''))
     and (p_area = '' or lower(l.area) = lower(p_area))
     and (p_size is null or l.size between p_size * 0.95 and p_size * 1.05)
     and (p_price is null or l.price between p_price * 0.9 and p_price * 1.1)
   limit 10
$$;

-- Adverts that have run their course
create or replace function public.pn_expire_adverts()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.listings set status = 'expired'
   where partner_id is not null and status = 'published'
     and advert_expires_on is not null and advert_expires_on < current_date;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- The jobs the website nudges along ----------
create or replace function public.pn_run()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return jsonb_build_object(
    'leads_returned', public.pn_lead_sweep(),
    'documents_reminded', public.pn_doc_remind());
end $$;

grant execute on function public.pn_public(), public.pn_territories_open(text, text), public.pn_directory(text, text, text, text, text),
  public.pn_verify_qr(text) to anon, authenticated;

do $$ begin raise notice 'Update 29 applied. RAQBO Partner Network is installed.'; end $$;
