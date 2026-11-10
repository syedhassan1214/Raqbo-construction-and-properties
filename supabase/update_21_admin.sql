-- =====================================================================
-- 29. Business control: complaints & disputes centre, refunds register,
--     revenue & expense reporting, new dashboard KPIs, WhatsApp click
--     tracking, construction-cost rates, and optional admin two-factor
--     sign-in (Supabase TOTP; switched OFF until an admin turns it on).
-- Run after update_20_services.sql. Safe to run more than once.
-- =====================================================================

-- ---------- Admin two-factor sign-in (optional) ----------
alter table public.platform_settings add column if not exists admin_mfa_required boolean not null default false;
create or replace function public.mfa_ok()
returns boolean language sql stable security definer set search_path = public as $$
  select not coalesce((select admin_mfa_required from public.platform_settings where id = 1), false) or coalesce(auth.jwt() ->> 'aal', '') = 'aal2' $$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') and public.mfa_ok() $$;
create or replace function public.has_perm(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and (admin_perms is null or p = any(admin_perms))) and public.mfa_ok() $$;
create or replace function public.is_full_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and admin_perms is null) and public.mfa_ok() $$;
create or replace function public.admin_set_mfa_required(p_on boolean, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_full_admin() then raise exception 'Only a full admin can change two-factor sign-in.'; end if;
  if p_on and coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then raise exception 'Set up two-factor sign-in on your own account and sign in with it first — otherwise you would lock yourself out.'; end if;
  update public.platform_settings set admin_mfa_required = p_on, updated_at = now() where id = 1;
  perform public.audit(case when p_on then 'security.mfa_on' else 'security.mfa_off' end, 'settings', 'admin_mfa', p_reason, null);
end $$;
grant execute on function public.admin_set_mfa_required(boolean, text) to authenticated;

-- ---------- Complaints & disputes ----------
create table if not exists public.complaints (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique default ('RQ-CMP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  user_id          uuid references public.profiles (id) on delete set null,
  name             text not null default '',
  kind             text not null check (kind in ('listing','order','service','auction','quicksell','payment','advertiser','other')),
  subject_ref      text not null default '' check (char_length(subject_ref) <= 80),
  details          text not null check (char_length(btrim(details)) between 10 and 3000),
  refund_requested bigint check (refund_requested is null or refund_requested > 0),
  status           text not null default 'open' check (status in ('open','investigating','resolved','rejected')),
  resolution       text not null default '' check (char_length(resolution) <= 2000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists complaints_status_idx on public.complaints (status, created_at desc);
alter table public.complaints enable row level security;
drop policy if exists "complaints: own or admin" on public.complaints;
create policy "complaints: own or admin" on public.complaints for select using (user_id = auth.uid() or public.is_admin());
revoke insert, update, delete on public.complaints from anon, authenticated;
grant select on public.complaints to authenticated;

create or replace function public.submit_complaint(p_kind text, p_subject_ref text, p_details text, p_refund bigint)
returns text language plpgsql security definer set search_path = public as $$
declare r text; nm text;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if (select count(*) from public.complaints where user_id = auth.uid() and created_at > now() - interval '1 day') >= 5 then raise exception 'You have sent several complaints today. RAQBO will reply to those first.'; end if;
  select coalesce(nullif(full_name, ''), 'Member') into nm from public.profiles where id = auth.uid();
  insert into public.complaints (user_id, name, kind, subject_ref, details, refund_requested) values (auth.uid(), nm, p_kind, left(btrim(coalesce(p_subject_ref, '')), 80), btrim(p_details), nullif(p_refund, 0)) returning ref into r;
  perform public.notify_admins('system', 'New complaint ' || r, left(btrim(p_details), 140), 'tab:complaints');
  return r;
end $$;
grant execute on function public.submit_complaint(text, text, text, bigint) to authenticated;

create or replace function public.admin_update_complaint(p_id uuid, p_status text, p_resolution text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.complaints;
begin
  if not (public.has_perm('services') or public.has_perm('finance')) then raise exception 'You do not have permission to handle complaints.'; end if;
  if p_status not in ('open','investigating','resolved','rejected') then raise exception 'Unknown status.'; end if;
  if p_status in ('resolved','rejected') and char_length(btrim(coalesce(p_resolution, ''))) < 5 then raise exception 'Write the outcome for the member (at least 5 characters).'; end if;
  update public.complaints set status = p_status, resolution = left(btrim(coalesce(p_resolution, '')), 2000), updated_at = now() where id = p_id returning * into c;
  if c.id is null then raise exception 'Complaint not found.'; end if;
  if c.user_id is not null then perform public.notify(c.user_id, 'service', 'Your complaint ' || c.ref || ' — ' || case p_status when 'investigating' then 'being investigated' when 'resolved' then 'resolved' when 'rejected' then 'closed' else 'updated' end, coalesce(nullif(btrim(p_resolution), ''), 'See My RAQBO → Complaints.'), '#my/complaints'); end if;
  perform public.audit('complaint.' || p_status, 'complaint', c.ref, p_resolution, null);
end $$;
grant execute on function public.admin_update_complaint(uuid, text, text) to authenticated;

-- ---------- Refunds register ----------
create table if not exists public.refunds (
  id            uuid primary key default gen_random_uuid(),
  ref           text not null unique default ('RQ-RFD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  complaint_id  uuid references public.complaints (id) on delete set null,
  kind          text not null default 'other' check (kind in ('verification','service','order','auction_deposit','quicksell','featured','other')),
  related_ref   text not null default '' check (char_length(related_ref) <= 80),
  payee         text not null check (char_length(btrim(payee)) between 2 and 120),
  amount        bigint not null check (amount > 0),
  method        text not null default '' check (char_length(method) <= 40),
  reason        text not null check (char_length(btrim(reason)) between 3 and 600),
  status        text not null default 'requested' check (status in ('requested','approved','paid','rejected')),
  txn_id        text not null default '' check (char_length(txn_id) <= 80),
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  paid_at       timestamptz
);
create index if not exists refunds_status_idx on public.refunds (status, created_at desc);
alter table public.refunds enable row level security;
drop policy if exists "refunds: finance" on public.refunds;
create policy "refunds: finance" on public.refunds for select using (public.has_perm('finance'));
revoke insert, update, delete on public.refunds from anon, authenticated;
grant select on public.refunds to authenticated;

create or replace function public.admin_add_refund(p_kind text, p_related_ref text, p_payee text, p_amount bigint, p_method text, p_reason text, p_complaint uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare r text;
begin
  if not public.has_perm('finance') then raise exception 'You do not have permission to manage refunds.'; end if;
  insert into public.refunds (kind, related_ref, payee, amount, method, reason, complaint_id, created_by)
  values (p_kind, left(btrim(coalesce(p_related_ref, '')), 80), btrim(p_payee), p_amount, left(btrim(coalesce(p_method, '')), 40), btrim(p_reason), p_complaint, auth.uid()) returning ref into r;
  perform public.audit('refund.request', 'refund', r, p_reason, jsonb_build_object('amount', p_amount, 'payee', p_payee));
  return r;
end $$;
grant execute on function public.admin_add_refund(text, text, text, bigint, text, text, uuid) to authenticated;

create or replace function public.admin_set_refund(p_id uuid, p_status text, p_txn text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare f public.refunds;
begin
  if not public.has_perm('finance') then raise exception 'You do not have permission to manage refunds.'; end if;
  select * into f from public.refunds where id = p_id; if f.id is null then raise exception 'Refund not found.'; end if;
  if p_status not in ('approved','paid','rejected') then raise exception 'Unknown status.'; end if;
  if f.status in ('paid','rejected') then raise exception 'This refund is already closed.'; end if;
  if p_status = 'paid' and char_length(btrim(coalesce(p_txn, ''))) < 3 then raise exception 'Enter the bank transaction ID of the refund payment.'; end if;
  if f.created_by = auth.uid() and p_status in ('approved','paid') and exists (select 1 from public.profiles where role = 'admin' and id <> auth.uid() and admin_perms is null or (role = 'admin' and id <> auth.uid() and 'finance' = any(admin_perms))) and char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Another finance admin should approve a refund you created — or give a reason (kept in the audit log).';
  end if;
  update public.refunds set status = p_status, txn_id = case when p_status = 'paid' then btrim(p_txn) else txn_id end, decided_at = coalesce(decided_at, now()), paid_at = case when p_status = 'paid' then now() else paid_at end where id = p_id;
  perform public.audit('refund.' || p_status, 'refund', f.ref, p_reason, jsonb_build_object('amount', f.amount, 'txn', p_txn));
end $$;
grant execute on function public.admin_set_refund(uuid, text, text, text) to authenticated;

-- ---------- Revenue & expenses ----------
create table if not exists public.finance_entries (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('income','expense')),
  category    text not null check (char_length(btrim(category)) between 2 and 60),
  amount      bigint not null check (amount > 0),
  entry_date  date not null default (now() at time zone 'Asia/Karachi')::date,
  note        text not null default '' check (char_length(note) <= 300),
  ref         text not null default '' check (char_length(ref) <= 80),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists finance_entries_date_idx on public.finance_entries (entry_date desc);
alter table public.finance_entries enable row level security;
drop policy if exists "finance_entries: finance" on public.finance_entries;
create policy "finance_entries: finance" on public.finance_entries for select using (public.has_perm('finance'));
revoke insert, update, delete on public.finance_entries from anon, authenticated;
grant select on public.finance_entries to authenticated;
create or replace function public.admin_add_finance(p_kind text, p_category text, p_amount bigint, p_date date, p_note text, p_ref text)
returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  if not public.has_perm('finance') then raise exception 'You do not have permission to record finances.'; end if;
  insert into public.finance_entries (kind, category, amount, entry_date, note, ref, created_by) values (p_kind, btrim(p_category), p_amount, coalesce(p_date, (now() at time zone 'Asia/Karachi')::date), left(btrim(coalesce(p_note, '')), 300), left(btrim(coalesce(p_ref, '')), 80), auth.uid()) returning id into nid;
  perform public.audit('finance.' || p_kind, 'finance', coalesce(nullif(p_ref, ''), p_category), p_note, jsonb_build_object('amount', p_amount, 'category', p_category));
  return nid;
end $$;
grant execute on function public.admin_add_finance(text, text, bigint, date, text, text) to authenticated;
create or replace function public.admin_delete_finance(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare f public.finance_entries;
begin
  if not public.has_perm('finance') then raise exception 'You do not have permission to record finances.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Give a reason for deleting this entry.'; end if;
  delete from public.finance_entries where id = p_id returning * into f;
  if f.id is not null then perform public.audit('finance.delete', 'finance', coalesce(nullif(f.ref, ''), f.category), p_reason, to_jsonb(f)); end if;
end $$;
grant execute on function public.admin_delete_finance(uuid, text) to authenticated;

-- Monthly report: recorded income and expenses plus refunds paid
create or replace function public.admin_finance_report(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm('finance') then raise exception 'You do not have permission to see finances.'; end if;
  return jsonb_build_object(
    'entries', coalesce((select jsonb_agg(to_jsonb(e) order by e.entry_date desc, e.created_at desc) from public.finance_entries e where e.entry_date between p_from and p_to), '[]'::jsonb),
    'refunds_paid', coalesce((select jsonb_agg(jsonb_build_object('ref', r.ref, 'amount', r.amount, 'paid_at', r.paid_at, 'payee', r.payee, 'kind', r.kind) order by r.paid_at desc) from public.refunds r where r.status = 'paid' and (r.paid_at at time zone 'Asia/Karachi')::date between p_from and p_to), '[]'::jsonb));
end $$;
grant execute on function public.admin_finance_report(date, date) to authenticated;

-- ---------- WhatsApp click tracking (anonymous counts only) ----------
create table if not exists public.wa_clicks (
  id          bigint generated always as identity primary key,
  listing_id  uuid references public.listings (id) on delete cascade,
  source      text not null default '' check (char_length(source) <= 40),
  at          timestamptz not null default now()
);
create index if not exists wa_clicks_at_idx on public.wa_clicks (at desc);
alter table public.wa_clicks enable row level security;
revoke all on public.wa_clicks from anon, authenticated;
create or replace function public.track_whatsapp(p_listing uuid, p_source text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.wa_clicks where at > now() - interval '1 minute') > 600 then return; end if;   -- simple flood guard
  insert into public.wa_clicks (listing_id, source) values ((select id from public.listings where id = p_listing), left(coalesce(p_source, ''), 40));
end $$;
grant execute on function public.track_whatsapp(uuid, text) to anon, authenticated;

-- ---------- Construction cost calculator rates (admin-editable, per sq ft) ----------
alter table public.platform_settings add column if not exists cost_rates jsonb not null default '{"grey":3150,"economy":5200,"standard":6800,"premium":10000}'::jsonb;
alter table public.platform_settings add column if not exists refund_rules text not null default '';
alter table public.platform_settings add column if not exists analytics_id text not null default '';
do $$ begin alter table public.platform_settings add constraint platform_analytics_id_check check (analytics_id = '' or analytics_id ~ '^G-[A-Z0-9]{4,14}$'); exception when duplicate_object then null; end $$;
create or replace function public.admin_save_analytics(p_id text, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('settings') then raise exception 'You do not have permission to change business settings.'; end if;
  update public.platform_settings set analytics_id = upper(btrim(coalesce(p_id, ''))), updated_at = now() where id = 1;
  perform public.audit('settings.analytics', 'settings', 'platform', p_reason, jsonb_build_object('id', p_id));
end $$;
grant execute on function public.admin_save_analytics(text, text) to authenticated;
create or replace function public.admin_save_misc(p_cost_rates jsonb, p_refund_rules text, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('settings') then raise exception 'You do not have permission to change business settings.'; end if;
  if jsonb_typeof(p_cost_rates) <> 'object' then raise exception 'Invalid rates.'; end if;
  update public.platform_settings set cost_rates = p_cost_rates, refund_rules = left(coalesce(p_refund_rules, ''), 4000), updated_at = now() where id = 1;
  perform public.audit('settings.misc', 'settings', 'platform', p_reason, jsonb_build_object('cost_rates', p_cost_rates));
end $$;
grant execute on function public.admin_save_misc(jsonb, text, text) to authenticated;

-- ---------- Extra dashboard numbers ----------
create or replace function public.admin_kpis_v3()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m0 date := date_trunc('month', now() at time zone 'Asia/Karachi')::date;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return jsonb_build_object(
    'complaints_open', (select count(*) from public.complaints where status in ('open','investigating')),
    'refunds_pending', (select coalesce(sum(amount), 0) from public.refunds where status in ('requested','approved')),
    'refunds_pending_n', (select count(*) from public.refunds where status in ('requested','approved')),
    'income_month', (select coalesce(sum(amount), 0) from public.finance_entries where kind = 'income' and entry_date >= m0),
    'expense_month', (select coalesce(sum(amount), 0) from public.finance_entries where kind = 'expense' and entry_date >= m0) + (select coalesce(sum(amount), 0) from public.refunds where status = 'paid' and paid_at >= m0),
    'wa_clicks_7d', (select count(*) from public.wa_clicks where at > now() - interval '7 days'),
    'wa_top', coalesce((select jsonb_agg(x) from (select l.ref, l.title, count(*) n from public.wa_clicks w join public.listings l on l.id = w.listing_id where w.at > now() - interval '30 days' group by l.ref, l.title order by n desc limit 5) x), '[]'::jsonb),
    'services_open', (select count(*) from public.enquiries where status in ('new','in_progress','awaiting_client')),
    'wanted_active', (select count(*) from public.wanted_posts where status = 'published'),
    'verified_live', (select count(*) from public.listing_verifications v join public.listings l on l.id = v.listing_id where v.status = 'verified' and l.status = 'published'),
    'published', (select count(*) from public.listings where status = 'published' and not is_sample),
    'visits_open', (select count(*) from public.inspections where status = 'requested'));
end $$;
grant execute on function public.admin_kpis_v3() to authenticated;
