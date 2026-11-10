-- =====================================================================
-- 24. Member location (city + area) asked on the sign-up screen
-- Run after update_15_auctions.sql. Safe to run more than once.
-- =====================================================================
alter table public.profiles add column if not exists city text;
alter table public.profiles add column if not exists area text;
alter table public.profiles drop constraint if exists profiles_area_len;
alter table public.profiles add constraint profiles_area_len check (area is null or char_length(area) <= 80);

create or replace function public.set_my_location(p_city text, p_area text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  update public.profiles
     set city = nullif(left(btrim(coalesce(p_city, '')), 60), ''),
         area = nullif(left(btrim(coalesce(p_area, '')), 80), '')
   where id = auth.uid();
end $$;
grant execute on function public.set_my_location(text, text) to authenticated;
