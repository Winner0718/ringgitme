-- Phase 24D-C Supabase Dashboard SQL Editor app-identity probe.
-- 900_persona_probe.sql remains the canonical Phase 24D-B psql probe.
-- 902 is pure PostgreSQL for Supabase Dashboard SQL Editor, Role postgres.
-- SCRATCH/DISPOSABLE PROJECT ONLY. NEVER RUN IN PRODUCTION.
-- Apply 001, 002, 003, and 004 first. This transaction rolls back every
-- fixture on success; any assertion failure aborts the transaction.

begin;

-- Scratch Auth UUID configuration. These fake users must exist in the
-- disposable project's auth.users table. Never substitute production users.
create temporary table identity_probe_config (
  persona text primary key,
  user_id uuid not null unique
) on commit drop;

insert into identity_probe_config (persona, user_id) values
  ('user_a', 'ce6132fb-58ef-458a-977e-f802abf672c8'::uuid),
  ('user_b', 'f33e1515-1310-44ac-a53f-39b8a009a86f'::uuid);

create temporary table identity_probe_state (
  state_key text primary key,
  state_value jsonb not null
) on commit drop;

grant select on table identity_probe_config to authenticated;
grant select, insert, update on table identity_probe_state to authenticated;

create function pg_temp.identity_probe_user(p_persona text)
returns uuid
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select c.user_id
  from identity_probe_config c
  where c.persona = p_persona
$$;

create function pg_temp.identity_probe_put(p_key text, p_value jsonb)
returns jsonb
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_value is null then
    raise exception 'APP IDENTITY PROBE FAILED: state value % is NULL', p_key;
  end if;
  insert into identity_probe_state (state_key, state_value)
  values (p_key, p_value)
  on conflict (state_key) do update set state_value = excluded.state_value;
  return p_value;
end;
$$;

create function pg_temp.identity_probe_get(p_key text)
returns jsonb
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select s.state_value
  from identity_probe_state s
  where s.state_key = p_key
$$;

create function pg_temp.identity_probe_assert(p_ok boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'APP IDENTITY PROBE FAILED: %', p_message;
  end if;
end;
$$;

create function pg_temp.identity_probe_shared_counts()
returns jsonb
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $$
  select jsonb_build_object(
    'shared_ledgers', (select count(*) from public.shared_ledgers),
    'shared_ledger_members', (select count(*) from public.shared_ledger_members),
    'invitations', (select count(*) from public.invitations),
    'shared_entries', (select count(*) from public.shared_entries),
    'shared_entry_lines', (select count(*) from public.shared_entry_lines),
    'shared_entry_events', (select count(*) from public.shared_entry_events),
    'shared_settlements', (select count(*) from public.shared_settlements),
    'private_postings', (select count(*) from public.private_postings),
    'shared_media', (select count(*) from public.shared_media),
    'shared_media_links', (select count(*) from public.shared_media_links),
    'telegram_identities', (select count(*) from public.telegram_identities)
  )
$$;

select pg_temp.identity_probe_assert(
  (select count(*) = 2
   from auth.users u
   join identity_probe_config c on c.user_id = u.id),
  'both configured disposable Auth users must exist'
);

select pg_temp.identity_probe_assert(
  to_regprocedure('public.bootstrap_current_user_identity(text,text,text)') is not null,
  '004 bootstrap RPC must exist'
);

select pg_temp.identity_probe_assert(
  to_regclass('public.identities_active_auth_user_uidx') is not null,
  'active-auth-user uniqueness index must exist'
);

select pg_temp.identity_probe_put(
  'shared_counts_before',
  pg_temp.identity_probe_shared_counts()
);

-- Remove only these disposable users' prior probe identity/profile fixtures.
-- This is safe only in a scratch project and everything remains transactional.
delete from public.identities i
where i.auth_user_id in (select user_id from identity_probe_config);
delete from public.profiles p
where p.id in (select user_id from identity_probe_config);

-- A: missing profile and identity are created from current auth context.
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.identity_probe_user('user_a')::text, true);
select pg_temp.identity_probe_put(
  'a_first',
  public.bootstrap_current_user_identity('Scratch User A', 'https://scratch.invalid/a.png', 'zh-MY')
);

select pg_temp.identity_probe_assert(
  (pg_temp.identity_probe_get('a_first') ->> 'auth_user_id')::uuid = pg_temp.identity_probe_user('user_a'),
  'A bootstrap must derive the current authenticated user'
);
select pg_temp.identity_probe_assert(
  (pg_temp.identity_probe_get('a_first') ->> 'profile_created')::boolean
  and (pg_temp.identity_probe_get('a_first') ->> 'identity_created')::boolean,
  'A first bootstrap must create profile and identity'
);
select pg_temp.identity_probe_assert(
  pg_temp.identity_probe_get('a_first') ->> 'display_name' = 'Scratch User A',
  'A creation must use the supplied display-name suggestion'
);

-- Repeated calls model the serial outcomes of concurrent callers. The audited
-- partial unique index plus ON CONFLICT makes both callers converge.
select pg_temp.identity_probe_put(
  'a_second',
  public.bootstrap_current_user_identity('Ignored A', 'https://scratch.invalid/ignored.png', 'en-MY')
);
select pg_temp.identity_probe_assert(
  pg_temp.identity_probe_get('a_second') ->> 'identity_id'
    = pg_temp.identity_probe_get('a_first') ->> 'identity_id',
  'repeated A bootstrap must return the same identity'
);
select pg_temp.identity_probe_assert(
  not (pg_temp.identity_probe_get('a_second') ->> 'profile_created')::boolean
  and not (pg_temp.identity_probe_get('a_second') ->> 'identity_created')::boolean,
  'repeated A bootstrap must be idempotent'
);
select pg_temp.identity_probe_assert(
  pg_temp.identity_probe_get('a_second') ->> 'display_name' = 'Scratch User A',
  'bootstrap must not overwrite an existing profile'
);

-- Existing edits remain authoritative.
update public.profiles
set display_name = 'Edited Scratch A', avatar_url = 'https://scratch.invalid/edited-a.png'
where id = pg_temp.identity_probe_user('user_a');
select pg_temp.identity_probe_put(
  'a_edited',
  public.bootstrap_current_user_identity('Overwrite Attempt', null, 'ms-MY')
);
select pg_temp.identity_probe_assert(
  pg_temp.identity_probe_get('a_edited') ->> 'display_name' = 'Edited Scratch A'
  and pg_temp.identity_probe_get('a_edited') ->> 'avatar_url' = 'https://scratch.invalid/edited-a.png'
  and pg_temp.identity_probe_get('a_edited') ->> 'locale' = 'zh-MY',
  'existing edited profile fields must be preserved'
);

-- Existing profile with a missing identity recovers without replacing profile.
reset role;
delete from public.identities
where auth_user_id = pg_temp.identity_probe_user('user_a');
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.identity_probe_user('user_a')::text, true);
select pg_temp.identity_probe_put(
  'a_identity_recovery',
  public.bootstrap_current_user_identity('Ignored Recovery Name', null, null)
);
select pg_temp.identity_probe_assert(
  not (pg_temp.identity_probe_get('a_identity_recovery') ->> 'profile_created')::boolean
  and (pg_temp.identity_probe_get('a_identity_recovery') ->> 'identity_created')::boolean
  and pg_temp.identity_probe_get('a_identity_recovery') ->> 'display_name' = 'Edited Scratch A',
  'missing A identity must recover while preserving the profile'
);

-- B: create a distinct profile and identity.
select set_config('request.jwt.claim.sub', pg_temp.identity_probe_user('user_b')::text, true);
select pg_temp.identity_probe_put(
  'b_first',
  public.bootstrap_current_user_identity('Scratch User B', null, 'en-MY')
);
select pg_temp.identity_probe_assert(
  (pg_temp.identity_probe_get('b_first') ->> 'auth_user_id')::uuid = pg_temp.identity_probe_user('user_b')
  and pg_temp.identity_probe_get('b_first') ->> 'identity_id'
    <> pg_temp.identity_probe_get('a_identity_recovery') ->> 'identity_id',
  'different authenticated users must receive different identities'
);

-- Existing identity with a missing profile recovers without replacing identity.
reset role;
delete from public.profiles
where id = pg_temp.identity_probe_user('user_b');
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.identity_probe_user('user_b')::text, true);
select pg_temp.identity_probe_put(
  'b_profile_recovery',
  public.bootstrap_current_user_identity('Recovered Scratch B', null, 'ms-MY')
);
select pg_temp.identity_probe_assert(
  (pg_temp.identity_probe_get('b_profile_recovery') ->> 'profile_created')::boolean
  and not (pg_temp.identity_probe_get('b_profile_recovery') ->> 'identity_created')::boolean
  and pg_temp.identity_probe_get('b_profile_recovery') ->> 'identity_id'
    = pg_temp.identity_probe_get('b_first') ->> 'identity_id',
  'missing B profile must recover without replacing the identity'
);

-- RLS: users without a shared-ledger relationship cannot read one another.
select set_config('request.jwt.claim.sub', pg_temp.identity_probe_user('user_a')::text, true);
select pg_temp.identity_probe_assert(
  (select count(*) = 0 from public.profiles p
   where p.id = pg_temp.identity_probe_user('user_b')),
  'A must not read unrelated B profile'
);
select pg_temp.identity_probe_assert(
  (select count(*) = 0 from public.identities i
   where i.auth_user_id = pg_temp.identity_probe_user('user_b')),
  'A must not read unrelated B identity'
);

-- Signed-out/empty claims must fail loudly at the authentication boundary.
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  begin
    perform public.bootstrap_current_user_identity('Signed Out', null, null);
    raise exception 'APP IDENTITY PROBE FAILED: signed-out bootstrap unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

-- Administrative assertions after persona checks.
reset role;
select pg_temp.identity_probe_assert(
  (select count(*) = 1 from public.identities i
   where i.auth_user_id = pg_temp.identity_probe_user('user_a')
     and i.kind = 'app_user'
     and i.merged_into_identity_id is null
     and i.deleted_at is null),
  'A must have exactly one active app_user identity'
);
select pg_temp.identity_probe_assert(
  (select count(*) = 1 from public.identities i
   where i.auth_user_id = pg_temp.identity_probe_user('user_b')
     and i.kind = 'app_user'
     and i.merged_into_identity_id is null
     and i.deleted_at is null),
  'B must have exactly one active app_user identity'
);
select pg_temp.identity_probe_assert(
  pg_temp.identity_probe_shared_counts()
    = pg_temp.identity_probe_get('shared_counts_before'),
  'bootstrap must not mutate shared ledger, posting, media, or Telegram tables'
);

do $$
begin
  raise notice 'Phase 24D-C Dashboard app identity probe passed; all fixture writes rolled back.';
end;
$$;

rollback;
