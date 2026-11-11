-- =====================================================================
-- RAQBO — undo update_26_payments.sql (remove online payments)
-- Puts the database back exactly as it was before online payments.
--
-- SAFETY: this refuses to run if any payment was ever actually paid or
-- refunded, so it can never destroy a record of real money. If it stops
-- with that message, do not force it — tell your developer instead.
--
-- Safe to run more than once. Nothing else on RAQBO is affected.
-- =====================================================================
do $$
declare n int;
begin
  if to_regclass('public.payments') is null then
    raise notice 'Online payments were not installed. Nothing to undo.';
    return;
  end if;
  select count(*) into n from public.payments where status in ('paid','refunded');
  if n > 0 then
    raise exception 'Stopped: % real payment(s) are recorded. Removing this would destroy the record of money received. Keep the payments module, or ask your developer.', n;
  end if;
end $$;

-- Put the dashboard figure back
drop function if exists public.admin_kpis_v5();

-- Member and admin functions
drop function if exists public.pay_quote(text, text);
drop function if exists public.pay_start(text, text);
drop function if exists public.pay_request(uuid, text, text, bigint, text);
drop function if exists public.pay_cancel(text);
drop function if exists public.pay_mine();
drop function if exists public.pay_due();
drop function if exists public.pay_admin_list(text, int);
drop function if exists public.pay_admin_stats();
drop function if exists public.pay_admin_reapply(text);
drop function if exists public.pay_admin_refund(text, text);
drop function if exists public.pay_expire();

-- Server-only functions
drop function if exists public.pay_settle(text, text, boolean, text, text, jsonb, text);
drop function if exists public.pay_set_tracker(text, text);
drop function if exists public.pay_apply(uuid);

-- Settings
drop function if exists public.admin_save_payments(boolean, text, bigint, text);

-- The payments table (empty of real payments — checked above)
drop table if exists public.payments;

-- Settings columns added by update 26
alter table public.platform_settings drop constraint if exists platform_settings_pay_mode_check;
alter table public.platform_settings drop constraint if exists platform_settings_featured_price_check;
alter table public.platform_settings drop column if exists online_payments_enabled;
alter table public.platform_settings drop column if exists payments_mode;
alter table public.platform_settings drop column if exists payments_gateway;
alter table public.platform_settings drop column if exists featured_price;
alter table public.platform_settings drop column if exists payments_note;

-- The paid_at column stays on listing_verifications: it is harmless, is used
-- by the ordinary verification screens, and dropping it would lose the date a
-- verification fee was received.

do $$ begin raise notice 'Online payments removed. Everything else is unchanged.'; end $$;
