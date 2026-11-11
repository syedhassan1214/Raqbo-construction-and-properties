-- =====================================================================
-- 31. Hardening found during the full acceptance test:
--     - restore the spam limit on service requests (10 per member per
--       hour), which update_13 dropped when it replaced the trigger;
--     - members can no longer pre-fill quotation, status or staff-note
--       fields when they send a request.
-- Run after update_22_complete.sql. Safe to run more than once.
-- =====================================================================
create or replace function public.enquiries_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare recent int;
begin
  new.user_id := auth.uid(); new.status := 'new'; new.created_at := now(); new.updated_at := now(); new.client_note := '';
  new.quote_amount := null; new.quote_note := ''; new.quote_valid_until := null; new.quote_status := '';
  if auth.uid() is not null and not public.is_admin() then
    select count(*) into recent from public.enquiries where user_id = auth.uid() and created_at > now() - interval '1 hour';
    if recent >= 10 then raise exception 'Too many requests. Please try again in an hour.'; end if;
  end if;
  return new;
end $$;
drop trigger if exists enquiries_before_insert on public.enquiries;
create trigger enquiries_before_insert before insert on public.enquiries for each row execute function public.enquiries_before_insert();
