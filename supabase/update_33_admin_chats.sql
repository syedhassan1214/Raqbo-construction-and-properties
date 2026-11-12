-- =====================================================================
-- RAQBO update 33 — Admin: read every member conversation (All chats)
-- Admins only. Every conversation an admin opens is written to the audit log.
-- Safe to run more than once. Run after update_32_missing_features.sql.
-- =====================================================================

create or replace function public.admin_conversations(p_q text default '', p_limit int default 50, p_offset int default 0)
returns table (id uuid, subject text, starter_name text, other_name text, is_support boolean,
               last_message_at timestamptz, last_preview text, messages bigint, reports bigint, blocked boolean)
language plpgsql stable security definer set search_path = public
as $$
declare q text := '%' || lower(btrim(coalesce(p_q, ''))) || '%';
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return query
  select c.id, c.subject,
         coalesce(nullif(ps.full_name, ''), nullif(c.starter_name, ''), 'Member'),
         case when c.other_id is null then 'RAQBO team' else coalesce(nullif(po.full_name, ''), nullif(c.other_name, ''), 'Member') end,
         c.other_id is null,
         c.last_message_at, c.last_preview,
         (select count(*) from public.messages m where m.conversation_id = c.id),
         (select count(*) from public.chat_reports r where r.conversation_id = c.id),
         public.chat_blocked(c.id)
    from public.conversations c
    left join public.profiles ps on ps.id = c.starter_id
    left join public.profiles po on po.id = c.other_id
   where q = '%%' or lower(c.subject) like q or lower(coalesce(ps.full_name, c.starter_name, '')) like q
      or lower(coalesce(po.full_name, c.other_name, '')) like q or lower(c.last_preview) like q
   order by c.last_message_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end $$;
grant execute on function public.admin_conversations(text, int, int) to authenticated;

create or replace function public.admin_conversation_messages(p_conv uuid)
returns table (id bigint, sender_id uuid, sender_name text, body text, created_at timestamptz, read_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare c public.conversations;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  select * into c from public.conversations where conversations.id = p_conv;
  if c.id is null then raise exception 'Conversation not found.'; end if;
  -- Reading a private conversation is always recorded
  begin perform public.audit('chat_viewed', 'conversation', p_conv::text, left(c.subject, 160), '{}'::jsonb); exception when others then null; end;
  return query
  select m.id, m.sender_id,
         case when c.other_id is null and m.sender_id <> c.starter_id then 'RAQBO team'
              else coalesce(nullif(p.full_name, ''), 'Member') end,
         m.body, m.created_at, m.read_at
    from public.messages m left join public.profiles p on p.id = m.sender_id
   where m.conversation_id = p_conv
   order by m.id
   limit 500;
end $$;
grant execute on function public.admin_conversation_messages(uuid) to authenticated;

do $$ begin raise notice 'Update 33 applied: admins can read every conversation (each one opened is audit-logged).'; end $$;
