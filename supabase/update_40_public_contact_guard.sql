-- Apply after update 39. Check newly written public listing, review and wanted text.
create or replace function public.public_content_guard_contact()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if public.is_admin() then return new; end if;
  if tg_table_name = 'listings' then
    if (tg_op = 'INSERT' or new.title is distinct from old.title)
      and public.contains_offplatform_contact(new.title)
      or (tg_op = 'INSERT' or new.description is distinct from old.description)
      and public.contains_offplatform_contact(new.description) then
      raise exception 'Please remove contact details or external messaging links from the listing.';
    end if;
  elsif tg_table_name = 'reviews' then
    if (tg_op = 'INSERT' or new.comment is distinct from old.comment)
      and public.contains_offplatform_contact(new.comment) then
      raise exception 'Please remove contact details or external messaging links from the review.';
    end if;
  elsif tg_table_name = 'wanted_posts' then
    if (tg_op = 'INSERT' or new.details is distinct from old.details)
      and public.contains_offplatform_contact(new.details) then
      raise exception 'Please remove contact details or external messaging links from the wanted post.';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.public_content_guard_contact() from public, anon, authenticated;
drop trigger if exists zz_raqbo_contact_guard on public.listings;
create trigger zz_raqbo_contact_guard before insert or update on public.listings
for each row execute function public.public_content_guard_contact();
drop trigger if exists zz_raqbo_contact_guard on public.reviews;
create trigger zz_raqbo_contact_guard before insert or update on public.reviews
for each row execute function public.public_content_guard_contact();
drop trigger if exists zz_raqbo_contact_guard on public.wanted_posts;
create trigger zz_raqbo_contact_guard before insert or update on public.wanted_posts
for each row execute function public.public_content_guard_contact();
