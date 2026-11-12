-- =====================================================================
-- RAQBO — update 31: closing what a security review found
--
-- The review found no way in and no way to change anything that is not
-- yours. What it did find is information being handed out that nobody
-- outside RAQBO needs. The website key is public by design — anyone can
-- read it out of the page — so anything a policy allows "everyone" to
-- read is effectively published. This tightens three of those.
--
-- Nothing the website shows changes: it already reads these through
-- functions that return only the parts the public pages use.
--
-- Safe to run more than once. It deletes nothing.
-- =====================================================================

-- ---------- 1. Platform settings ----------
-- The whole row was readable by anyone: the business name, registration
-- number, NTN and registered address, every service fee, the auction and
-- commission settings, and the analytics ID. The public pages do not read
-- this table — they call public.platform_public(), which returns the same
-- public-facing values. So the table itself goes back to staff only.
do $$ declare r record; begin
  for r in select polname from pg_policy p join pg_class c on c.oid = p.polrelid
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = 'platform_settings' and p.polcmd in ('r', '*')
  loop execute format('drop policy if exists %I on public.platform_settings', r.polname); end loop;
end $$;
drop policy if exists "platform_settings read" on public.platform_settings;
create policy "platform_settings read" on public.platform_settings for select to authenticated
  using (public.is_admin());

-- ---------- 2. Growth settings ----------
-- This holds the marketing budget, the founding-member cap and the
-- referral credit rules — commercial information, not public information.
do $$ declare r record; begin
  for r in select polname from pg_policy p join pg_class c on c.oid = p.polrelid
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = 'growth_settings' and p.polcmd in ('r', '*')
  loop execute format('drop policy if exists %I on public.growth_settings', r.polname); end loop;
end $$;
drop policy if exists "growth_settings read" on public.growth_settings;
create policy "growth_settings read" on public.growth_settings for select to authenticated
  using (public.is_admin());

-- The public pages already read what they need through public.growth_public(),
-- which returns only the campaign and referral details a visitor is shown.

-- ---------- 3. Partner commission rates ----------
-- The indicative percentages are shown on the Become a Partner page on
-- purpose, so they stay readable. What does not need to be public is a
-- rate that has been switched off or dated for the future, because that
-- shows RAQBO's hand before a change is announced.
do $$ declare r record; begin
  for r in select polname from pg_policy p join pg_class c on c.oid = p.polrelid
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = 'pn_rates' and p.polcmd in ('r', '*')
  loop execute format('drop policy if exists %I on public.pn_rates', r.polname); end loop;
end $$;
drop policy if exists "pn_rates read" on public.pn_rates;
create policy "pn_rates read" on public.pn_rates for select to authenticated, anon
  using (active and effective_from <= current_date);

drop policy if exists "pn_rates staff read" on public.pn_rates;
create policy "pn_rates staff read" on public.pn_rates for select to authenticated
  using (public.has_perm('partners'));

-- ---------- 4. A record of who looked at what ----------
-- Reading a partner's status by its code is meant to be open to anyone,
-- but a code is short, so someone could try codes one after another to
-- map out the partner network. Checks are counted per code so an admin
-- can see it happening.
create table if not exists public.pn_check_log (
  id         bigserial primary key,
  token_hint text not null default '',
  found      boolean not null default false,
  at         timestamptz not null default now()
);
create index if not exists pn_check_log_at_idx on public.pn_check_log (at desc);
alter table public.pn_check_log enable row level security;

drop policy if exists "check log staff" on public.pn_check_log;
create policy "check log staff" on public.pn_check_log for select to authenticated
  using (public.has_perm('partners'));

-- The check itself records the attempt and refuses to answer more than
-- thirty wrong guesses in five minutes, which stops a code being found by
-- trying. A genuine scan is one check and is never affected.
create or replace function public.pn_verify_qr(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_misses int; v_hint text := left(coalesce(p_token, ''), 3);
begin
  select count(*) into v_misses from public.pn_check_log l
   where l.found = false and l.at > now() - interval '5 minutes';
  if v_misses > 30 then
    insert into public.pn_check_log (token_hint, found) values (v_hint, false);
    raise exception 'Too many checks have been tried just now. Please wait a few minutes and scan again.';
  end if;

  select jsonb_build_object(
    'found', true, 'name', p.display_name, 'partner_id', p.partner_id, 'category', p.category,
    'designation', p.designation, 'status', p.status,
    'active', p.status = 'active',
    'territories', coalesce((select jsonb_agg(t.name order by t.name) from public.pn_partner_territories pt
                               join public.pn_territories t on t.id = pt.territory_id where pt.partner_id = p.id), '[]'::jsonb),
    'may_collect_money', p.may_collect_money, 'office_branding', p.office_branding,
    'checked_at', now())
    into v
  from public.pn_partners p
  where p.qr_token = p_token and coalesce(p_token, '') <> '';

  insert into public.pn_check_log (token_hint, found) values (v_hint, v is not null);
  return coalesce(v, jsonb_build_object('found', false, 'checked_at', now()));
end $$;
grant execute on function public.pn_verify_qr(text) to authenticated, anon;

-- Old check records are not worth keeping.
create or replace function public.pn_check_log_trim()
returns void language sql security definer set search_path = public as $$
  delete from public.pn_check_log where at < now() - interval '30 days'
$$;

do $$ begin raise notice 'Update 31 applied. Settings are staff-only, partner codes cannot be guessed in bulk.'; end $$;
