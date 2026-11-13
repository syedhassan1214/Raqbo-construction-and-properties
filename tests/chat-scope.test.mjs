import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
const owner = '00000000-0000-0000-0000-000000000001';
const buyer = '00000000-0000-0000-0000-000000000002';
const stranger = '00000000-0000-0000-0000-000000000003';
const admin = '00000000-0000-0000-0000-000000000004';
const listing = '00000000-0000-0000-0000-000000000010';
const vendor = '00000000-0000-0000-0000-000000000011';
const order = '00000000-0000-0000-0000-000000000012';
await db.exec(`
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
create table public.profiles(id uuid primary key, full_name text);
create table public.listings(id uuid primary key, owner_id uuid, title text, ref text, status text, channel text, description text);
create table public.reviews(comment text);
create table public.wanted_posts(details text);
create table public.vendors(id uuid primary key, owner_id uuid, status text, shop_name text);
create table public.orders(id uuid primary key, vendor_id uuid, buyer_id uuid, ref text);
create table public.conversations(id uuid primary key default gen_random_uuid(), starter_id uuid not null, other_id uuid, listing_id uuid, vendor_id uuid, order_id uuid, subject text, starter_name text, other_name text);
create table public.user_blocks(blocker_id uuid, blocked_id uuid);
create table public.messages(conversation_id uuid, sender_id uuid, body text);
create function public.is_verified_user() returns boolean language sql as $$ select auth.uid() is not null $$;
create function public.is_admin() returns boolean language sql as $$ select auth.uid() = '${admin}'::uuid $$;
create function public.is_participant(p_conv uuid) returns boolean language sql stable security definer set search_path = public
  as $$ select exists(select 1 from public.conversations where id = p_conv and (starter_id = auth.uid() or other_id = auth.uid())) $$;
grant usage on schema auth to authenticated;
grant insert on public.messages to authenticated;
grant select,insert,update on public.listings, public.reviews, public.wanted_posts to authenticated;
alter table public.messages enable row level security;
insert into public.profiles values ('${owner}','Owner'),('${buyer}','Buyer'),('${stranger}','Stranger');
insert into public.listings values ('${listing}','${owner}','House','L1','published','public','Legacy 0300-1234567');
insert into public.vendors values ('${vendor}','${owner}','approved','Shop');
insert into public.orders values ('${order}','${vendor}','${buyer}','O1');
insert into public.user_blocks values ('${owner}','${buyer}');
`);
const migration = await readFile(new URL('../supabase/update_37_chat_scope.sql', import.meta.url), 'utf8');
await db.exec(migration);
await db.exec(migration);
const contactMigration = await readFile(new URL('../supabase/update_38_chat_contact_guard.sql', import.meta.url), 'utf8');
await db.exec(contactMigration);
await db.exec(contactMigration);
const publicGuard = await readFile(new URL('../supabase/update_40_public_contact_guard.sql', import.meta.url), 'utf8');
await db.exec(publicGuard);
await db.exec(publicGuard);
await db.exec(`create policy "messages: participants send" on public.messages for insert
  with check (sender_id = auth.uid() and public.is_participant(conversation_id) and public.is_verified_user()
              and not public.chat_blocked(conversation_id));`);
const as = id => db.query("select set_config('test.uid', $1, false)", [id]);
const call = (sql, params = []) => db.query(sql, params);
await as(buyer);
await db.exec('set role authenticated');
for (const args of [[listing,vendor,null], [listing,null,order], [null,vendor,order], [listing,vendor,order]]) {
  await assert.rejects(() => call('select public.start_conversation($1,$2,$3)', args), /only one conversation topic/);
}
const listingChat = (await call('select public.start_conversation($1) as id', [listing])).rows[0].id;
assert.equal((await call('select public.chat_blocked($1) as blocked', [listingChat])).rows[0].blocked, true);
await assert.rejects(() => call('insert into public.messages values ($1,$2,$3)', [listingChat,buyer,'Hello']), /row-level security/);
assert((await call('select public.start_conversation(null,$1) as id', [vendor])).rows[0].id);
assert((await call('select public.start_conversation(null,null,$1) as id', [order])).rows[0].id);
const support = (await call('select public.start_conversation() as id')).rows[0].id;
assert.equal((await call('select public.chat_blocked($1) as blocked', [support])).rows[0].blocked, false);
await call('insert into public.messages values ($1,$2,$3)', [support,buyer,'Hello']);
await call('insert into public.messages values ($1,$2,$3)', [support,buyer,'My number is 0300 1234567']);
await db.exec('reset role; delete from public.user_blocks; set role authenticated');
for (const body of [
  'Call me 0300-1234567',
  'Call +92 300 1234567',
  'نمبر ۰۳۰۰ ۱۲۳۴۵۶۷',
  'CNIC 12345-1234567-1',
  'Email abc@example.com',
  'Visit https://example.com',
  'Reach me on WhatsApp',
  'message @contact_name'
]) {
  await assert.rejects(() => call('insert into public.messages values ($1,$2,$3)', [listingChat,buyer,body]), /remove contact details/);
}
for (const body of ['Please confirm the price is PKR 1000000000.', 'Can I visit on 12/11/2026?', 'The size is 10 marla.']) {
  await call('insert into public.messages values ($1,$2,$3)', [listingChat,buyer,body]);
}
await call("update public.listings set status='pending' where id=$1", [listing]);
await assert.rejects(() => call("update public.listings set description='Call 0300 1234567' where id=$1", [listing]), /remove contact details/);
await call("update public.listings set description='Comfortable 10 marla home' where id=$1", [listing]);
await assert.rejects(() => call("insert into public.reviews values ('Email me abc@example.com')"), /remove contact details/);
await call("insert into public.reviews values ('Good property with 3 bedrooms')");
await assert.rejects(() => call("insert into public.wanted_posts values ('WhatsApp me')"), /remove contact details/);
await call("insert into public.wanted_posts values ('Need a house in Lahore')");
await as(stranger);
assert.equal((await call('select public.chat_blocked($1) as blocked', [listingChat])).rows[0].blocked, false);
await assert.rejects(() => call('insert into public.messages values ($1,$2,$3)', [listingChat,stranger,'Hello']), /row-level security/);
await as(admin);
await db.exec('reset role');
await db.exec(`insert into public.user_blocks values ('${owner}','${buyer}')`);
await db.exec('set role authenticated');
assert.equal((await call('select public.chat_blocked($1) as blocked', [listingChat])).rows[0].blocked, true);
await db.exec('reset role; set role anon');
await assert.rejects(() => call('select public.chat_blocked($1)', [listingChat]), /permission denied/);
await db.close();
console.log('PASS: single-topic listing/vendor/order/support chats, multiple-topic rejection, participant block status and anonymous denial');
