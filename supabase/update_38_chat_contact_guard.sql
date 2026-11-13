-- Apply after update 37. Check member-to-member chat messages in the database.
-- This is a best-effort filter, not a guarantee against off-platform contact.
create or replace function public.contains_offplatform_contact(p_text text)
returns boolean language plpgsql immutable set search_path = public
as $$
declare
  t text;
  compact text;
begin
  t := lower(translate(coalesce(p_text, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'));
  compact := regexp_replace(t, '[[:space:].,_()|*•·-]+', '', 'g');
  return compact ~ '(^|[^0-9])(0|92|0092)3[0-9]{9}([^0-9]|$)'
     or compact ~ '(^|[^0-9])[0-9]{13}([^0-9]|$)'
     or t ~ '(^|[^0-9])\+[0-9][0-9 .()/-]{8,}[0-9]([^0-9]|$)'
     or t ~ '[a-z0-9._%+-]+[[:space:]]*(@|\(at\)|\[at\]|[[:space:]]at[[:space:]])[[:space:]]*[a-z0-9.-]+[[:space:]]*(\.|[[:space:]]dot[[:space:]])[[:space:]]*[a-z]{2,}'
     or t ~ '(https?://|www\.)[^[:space:]]+'
     or t ~ '(^|[^a-z0-9-])[a-z0-9-]+\.(com|net|org|pk|co|io|me)([^a-z0-9]|$)'
     or t ~ '(^|[^a-z])(whats[[:space:]]*app|wa\.me|telegram|t\.me|viber|signal[[:space:]]*app|snapchat|instagram|facebook|fb\.com|messenger|skype|botim)([^a-z]|$)'
     or t ~ '(^|[[:space:]])@[a-z0-9._]{3,}';
end $$;
revoke all on function public.contains_offplatform_contact(text) from public, anon, authenticated;

create or replace function public.messages_guard_contact()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  -- Support conversations and staff messages may contain contact information
  -- needed by RAQBO to assist a customer.
  if public.is_admin() or exists (
    select 1 from public.conversations c
    where c.id = new.conversation_id and c.other_id is null
  ) then
    return new;
  end if;
  if public.contains_offplatform_contact(new.body) then
    raise exception 'Please remove contact details or external messaging links and keep this conversation on RAQBO.';
  end if;
  return new;
end $$;

revoke all on function public.messages_guard_contact() from public, anon, authenticated;
drop trigger if exists messages_guard_contact on public.messages;
create trigger messages_guard_contact before insert on public.messages
for each row execute function public.messages_guard_contact();
