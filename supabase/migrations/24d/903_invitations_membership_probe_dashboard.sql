-- Phase 24D-D1 Supabase Dashboard SQL Editor invitation/membership probe.
-- Pure PostgreSQL/PLpgSQL. Run as Role postgres after 001 through 005.
-- SCRATCH/DISPOSABLE PROJECT ONLY. NEVER RUN IN PRODUCTION.
-- All bearer-code literals below are synthetic probe fixtures, never real
-- invitation secrets. The transaction rolls back every fixture on success;
-- any assertion failure aborts the transaction.

begin;

-- Fake scratch Auth UUID configuration. These four disposable users must
-- exist in auth.users. Never replace them with production/customer users.
create temporary table invitation_probe_config (
  persona text primary key,
  user_id uuid not null unique
) on commit drop;

insert into invitation_probe_config (persona, user_id) values
  ('user_a', 'ce6132fb-58ef-458a-977e-f802abf672c8'::uuid),
  ('user_b', 'f33e1515-1310-44ac-a53f-39b8a009a86f'::uuid),
  ('user_c', 'dc944eb9-3f1c-4838-8a25-969878a8e36c'::uuid),
  ('user_d', '699931e3-1059-4e09-bb5f-1eba0f23a673'::uuid);

create temporary table invitation_probe_state (
  state_key text primary key,
  state_value jsonb not null
) on commit drop;

grant select on table invitation_probe_config to authenticated;
grant select, insert, update on table invitation_probe_state to authenticated;

create function pg_temp.d1_user(p_persona text)
returns uuid
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select c.user_id from invitation_probe_config c where c.persona = p_persona
$$;

create function pg_temp.d1_put(p_key text, p_value jsonb)
returns jsonb
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_value is null then
    raise exception 'INVITATION PROBE FAILED: state value % is NULL', p_key;
  end if;
  insert into invitation_probe_state (state_key, state_value)
  values (p_key, p_value)
  on conflict (state_key) do update set state_value = excluded.state_value;
  return p_value;
end;
$$;

create function pg_temp.d1_put_uuid(p_key text, p_value uuid)
returns uuid
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
begin
  perform pg_temp.d1_put(p_key, to_jsonb(p_value));
  return p_value;
end;
$$;

create function pg_temp.d1_put_bigint(p_key text, p_value bigint)
returns bigint
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
begin
  perform pg_temp.d1_put(p_key, to_jsonb(p_value));
  return p_value;
end;
$$;

create function pg_temp.d1_json(p_key text)
returns jsonb
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select s.state_value from invitation_probe_state s where s.state_key = p_key
$$;

create function pg_temp.d1_uuid(p_key text)
returns uuid
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select (s.state_value #>> '{}')::uuid
  from invitation_probe_state s where s.state_key = p_key
$$;

create function pg_temp.d1_bigint(p_key text)
returns bigint
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select (s.state_value #>> '{}')::bigint
  from invitation_probe_state s where s.state_key = p_key
$$;

create function pg_temp.d1_assert(p_ok boolean, p_label text)
returns void
language plpgsql
as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'INVITATION PROBE FAILED: %', p_label;
  end if;
end;
$$;

create function pg_temp.d1_protected_snapshot()
returns jsonb
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $$
  select jsonb_build_object(
    'private_postings', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id,
        'sha256', encode(extensions.digest(convert_to(to_jsonb(p)::text, 'UTF8'), 'sha256'), 'hex')
      ) order by p.id), '[]'::jsonb) from public.private_postings p
    ),
    'shared_entries', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id,
        'sha256', encode(extensions.digest(convert_to(to_jsonb(e)::text, 'UTF8'), 'sha256'), 'hex')
      ) order by e.id), '[]'::jsonb) from public.shared_entries e
    ),
    'shared_entry_lines', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', line.id,
        'sha256', encode(extensions.digest(convert_to(to_jsonb(line)::text, 'UTF8'), 'sha256'), 'hex')
      ) order by line.id), '[]'::jsonb) from public.shared_entry_lines line
    ),
    'shared_entry_events', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', ev.id,
        'sha256', encode(extensions.digest(convert_to(to_jsonb(ev)::text, 'UTF8'), 'sha256'), 'hex')
      ) order by ev.id), '[]'::jsonb) from public.shared_entry_events ev
    ),
    'shared_settlements', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id,
        'sha256', encode(extensions.digest(convert_to(to_jsonb(s)::text, 'UTF8'), 'sha256'), 'hex')
      ) order by s.id), '[]'::jsonb) from public.shared_settlements s
    )
  )
$$;

create function pg_temp.d1_reject_snapshot()
returns jsonb
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $$
  select jsonb_build_object(
    'invitation_id', invitation.id,
    'member_id', invitation.member_id,
    'ledger_id', invitation.ledger_id,
    'rejected_at', invitation.rejected_at,
    'rejected_by_identity_id', invitation.rejected_by_identity_id,
    'consumed_at', invitation.consumed_at,
    'consumed_by_identity_id', invitation.consumed_by_identity_id,
    'revoked_at', invitation.revoked_at,
    'use_count', invitation.use_count,
    'member_status', member.status,
    'member_identity_id', member.identity_id,
    'member_deleted_at', member.deleted_at,
    'ledger_revision', ledger.revision,
    'invitation_count', (
      select count(*) from public.invitations counted_invitation
      where counted_invitation.ledger_id = invitation.ledger_id
    ),
    'member_count', (
      select count(*) from public.shared_ledger_members counted_member
      where counted_member.ledger_id = invitation.ledger_id
    ),
    'event_count', (
      select count(*)
      from public.shared_entry_events counted_event
      join public.shared_entries counted_entry
        on counted_entry.id = counted_event.entry_id
      where counted_entry.ledger_id = invitation.ledger_id
    ),
    'invitation_sha256', encode(extensions.digest(
      convert_to(to_jsonb(invitation)::text, 'UTF8'), 'sha256'
    ), 'hex'),
    'member_sha256', encode(extensions.digest(
      convert_to(to_jsonb(member)::text, 'UTF8'), 'sha256'
    ), 'hex'),
    'ledger_sha256', encode(extensions.digest(
      convert_to(to_jsonb(ledger)::text, 'UTF8'), 'sha256'
    ), 'hex')
  )
  from public.invitations invitation
  join public.shared_ledger_members member
    on member.id = invitation.member_id
   and member.ledger_id = invitation.ledger_id
  join public.shared_ledgers ledger on ledger.id = invitation.ledger_id
  where invitation.id = pg_temp.d1_uuid('reject_invitation_id')
$$;

create function pg_temp.d1_replay_guard_snapshot(p_invitation_id uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $$
  select jsonb_build_object(
    'invitation_id', invitation.id,
    'member_id', member.id,
    'identity_id', identity.id,
    'ledger_id', ledger.id,
    'rejected_at', invitation.rejected_at,
    'rejected_by_identity_id', invitation.rejected_by_identity_id,
    'consumed_at', invitation.consumed_at,
    'consumed_by_identity_id', invitation.consumed_by_identity_id,
    'revoked_at', invitation.revoked_at,
    'use_count', invitation.use_count,
    'member_role', member.role,
    'member_status', member.status,
    'member_joined_at', member.joined_at,
    'member_left_at', member.left_at,
    'member_removed_at', member.removed_at,
    'member_deleted_at', member.deleted_at,
    'identity_kind', identity.kind,
    'identity_auth_user_id', identity.auth_user_id,
    'identity_telegram_user_id', identity.telegram_user_id,
    'identity_merged_into_identity_id', identity.merged_into_identity_id,
    'identity_claimed_at', identity.claimed_at,
    'identity_deleted_at', identity.deleted_at,
    'ledger_revision', ledger.revision,
    'invitation_count', (
      select count(*) from public.invitations counted_invitation
      where counted_invitation.ledger_id = ledger.id
    ),
    'member_count', (
      select count(*) from public.shared_ledger_members counted_member
      where counted_member.ledger_id = ledger.id
    ),
    'event_count', (
      select count(*)
      from public.shared_entry_events counted_event
      join public.shared_entries counted_entry
        on counted_entry.id = counted_event.entry_id
      where counted_entry.ledger_id = ledger.id
    ),
    'seat_history_reference_count',
      (select count(*) from public.shared_entries entry
       where entry.payer_member_id = member.id
          or entry.created_by_member_id = member.id)
      + (select count(*) from public.shared_entry_lines line
         where line.member_id = member.id)
      + (select count(*) from public.shared_entry_events ev
         where ev.actor_member_id = member.id)
      + (select count(*) from public.shared_settlements settlement
         where member.id in (
           settlement.from_member_id,
           settlement.to_member_id,
           settlement.recorded_by_member_id
         ))
      + (select count(*) from public.invitations history_invitation
         where (
             history_invitation.member_id = member.id
             and (
               history_invitation.consumed_at is not null
               or history_invitation.consumed_by_identity_id is not null
             )
           )
           or history_invitation.consumed_by_identity_id = identity.id),
    'ledger_history', jsonb_build_object(
      'entries', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', entry.id,
          'sha256', encode(extensions.digest(
            convert_to(to_jsonb(entry)::text, 'UTF8'), 'sha256'
          ), 'hex')
        ) order by entry.id), '[]'::jsonb)
        from public.shared_entries entry
        where entry.ledger_id = ledger.id
      ),
      'lines', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', line.id,
          'sha256', encode(extensions.digest(
            convert_to(to_jsonb(line)::text, 'UTF8'), 'sha256'
          ), 'hex')
        ) order by line.id), '[]'::jsonb)
        from public.shared_entry_lines line
        join public.shared_entries entry on entry.id = line.entry_id
        where entry.ledger_id = ledger.id
      ),
      'events', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', ev.id,
          'sha256', encode(extensions.digest(
            convert_to(to_jsonb(ev)::text, 'UTF8'), 'sha256'
          ), 'hex')
        ) order by ev.id), '[]'::jsonb)
        from public.shared_entry_events ev
        join public.shared_entries entry on entry.id = ev.entry_id
        where entry.ledger_id = ledger.id
      ),
      'settlements', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', settlement.id,
          'sha256', encode(extensions.digest(
            convert_to(to_jsonb(settlement)::text, 'UTF8'), 'sha256'
          ), 'hex')
        ) order by settlement.id), '[]'::jsonb)
        from public.shared_settlements settlement
        where settlement.ledger_id = ledger.id
      )
    ),
    'invitation_sha256', encode(extensions.digest(
      convert_to(to_jsonb(invitation)::text, 'UTF8'), 'sha256'
    ), 'hex'),
    'member_sha256', encode(extensions.digest(
      convert_to(to_jsonb(member)::text, 'UTF8'), 'sha256'
    ), 'hex'),
    'identity_sha256', encode(extensions.digest(
      convert_to(to_jsonb(identity)::text, 'UTF8'), 'sha256'
    ), 'hex'),
    'ledger_sha256', encode(extensions.digest(
      convert_to(to_jsonb(ledger)::text, 'UTF8'), 'sha256'
    ), 'hex')
  )
  from public.invitations invitation
  join public.shared_ledger_members member
    on member.id = invitation.member_id
   and member.ledger_id = invitation.ledger_id
  join public.identities identity on identity.id = member.identity_id
  join public.shared_ledgers ledger on ledger.id = invitation.ledger_id
  where invitation.id = p_invitation_id
$$;

create function pg_temp.d1_inspect_outcome(p_raw_code text)
returns jsonb
language plpgsql
volatile
set search_path = pg_catalog, public, pg_temp
as $$
begin
  return jsonb_build_object('returned', public.inspect_invitation(p_raw_code));
exception when others then
  return jsonb_build_object('sqlstate', sqlstate, 'message', sqlerrm);
end;
$$;

select pg_temp.d1_assert(
  (select count(*) = 4
   from auth.users u join invitation_probe_config c on c.user_id = u.id),
  '[probe preflight] all four configured disposable Auth users must exist'
);
select pg_temp.d1_assert(
  to_regprocedure('public.inspect_invitation(text)') is not null
  and to_regprocedure('public.accept_invitation(text)') is not null
  and to_regprocedure('public.reject_invitation(text)') is not null
  and to_regprocedure('public.revoke_invitation(uuid,bigint)') is not null
  and to_regprocedure('public.create_member_invitation(uuid,uuid,text,text,timestamp with time zone,uuid,bigint)') is not null
  and to_regprocedure('public.remove_unclaimed_member(uuid,uuid,bigint)') is not null,
  '[probe preflight] all 005 RPC signatures must exist'
);
select pg_temp.d1_assert(
  pg_get_function_arguments('public.accept_invitation(text)'::regprocedure)
    = 'p_code_hash text'
  and position(
    'v_raw_code := btrim(p_code_hash)'
    in pg_get_functiondef('public.accept_invitation(text)'::regprocedure)
  ) > 0,
  '[B1 contract] accept_invitation must retain legacy p_code_hash name while treating it as raw input'
);
select pg_temp.d1_assert(
  not exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid in (
      'public.inspect_invitation(text)'::regprocedure,
      'public.accept_invitation(text)'::regprocedure,
      'public.reject_invitation(text)'::regprocedure,
      'public.revoke_invitation(uuid,bigint)'::regprocedure,
      'public.create_member_invitation(uuid,uuid,text,text,timestamp with time zone,uuid,bigint)'::regprocedure,
      'public.remove_unclaimed_member(uuid,uuid,bigint)'::regprocedure
    )
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  '[grant denial] PUBLIC must have no EXECUTE on any D1 RPC'
);
select pg_temp.d1_assert(
  (
    select count(*) = 6
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid in (
      'public.inspect_invitation(text)'::regprocedure,
      'public.accept_invitation(text)'::regprocedure,
      'public.reject_invitation(text)'::regprocedure,
      'public.revoke_invitation(uuid,bigint)'::regprocedure,
      'public.create_member_invitation(uuid,uuid,text,text,timestamp with time zone,uuid,bigint)'::regprocedure,
      'public.remove_unclaimed_member(uuid,uuid,bigint)'::regprocedure
    )
      and acl.grantee = 'authenticated'::regrole
      and acl.privilege_type = 'EXECUTE'
      and not acl.is_grantable
  ),
  '[grant assertion] authenticated must have exact EXECUTE on every D1 RPC'
);
select pg_temp.d1_assert(
  not has_table_privilege('authenticated', 'public.shared_ledgers', 'insert')
  and not has_table_privilege('authenticated', 'public.shared_ledgers', 'update')
  and not has_table_privilege('authenticated', 'public.shared_ledgers', 'delete')
  and not has_table_privilege('authenticated', 'public.shared_ledger_members', 'insert')
  and not has_table_privilege('authenticated', 'public.shared_ledger_members', 'update')
  and not has_table_privilege('authenticated', 'public.shared_ledger_members', 'delete')
  and not has_table_privilege('authenticated', 'public.invitations', 'insert')
  and not has_table_privilege('authenticated', 'public.invitations', 'update')
  and not has_table_privilege('authenticated', 'public.invitations', 'delete')
  and not has_table_privilege('authenticated', 'public.shared_entries', 'insert')
  and not has_table_privilege('authenticated', 'public.shared_entries', 'update')
  and not has_table_privilege('authenticated', 'public.shared_entries', 'delete')
  and not has_table_privilege('authenticated', 'public.shared_entry_lines', 'insert')
  and not has_table_privilege('authenticated', 'public.shared_entry_lines', 'update')
  and not has_table_privilege('authenticated', 'public.shared_entry_lines', 'delete')
  and not has_table_privilege('authenticated', 'public.shared_entry_events', 'insert')
  and not has_table_privilege('authenticated', 'public.shared_entry_events', 'update')
  and not has_table_privilege('authenticated', 'public.shared_entry_events', 'delete')
  and not has_table_privilege('authenticated', 'public.shared_settlements', 'insert')
  and not has_table_privilege('authenticated', 'public.shared_settlements', 'update')
  and not has_table_privilege('authenticated', 'public.shared_settlements', 'delete'),
  '[grant denial] authenticated must have no broad direct shared mutation grants'
);
select pg_temp.d1_put('protected_snapshot_before', pg_temp.d1_protected_snapshot());

-- A creates a pair ledger and one B-bound invited seat.
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.d1_user('user_a')::text, true);
select pg_temp.d1_put_uuid(
  'pair_ledger_id',
  public.create_shared_ledger(
    'pair', 'D1 Pair Probe',
    'd1000000-0000-4000-8000-000000000001'::uuid,
    'd1000000-0000-4000-8000-000000000002'::uuid
  )
);
select pg_temp.d1_put_uuid(
  'pair_invitation_id',
  public.invite_member(
    pg_temp.d1_uuid('pair_ledger_id'), 'Scratch User B', 'code',
    encode(extensions.digest(convert_to('D1-PAIR-B-ONLY-20260711', 'UTF8'), 'sha256'), 'hex'),
    now() + interval '2 hours',
    'd1000000-0000-4000-8000-000000000003'::uuid
  )
);
select pg_temp.d1_put_uuid(
  'pair_owner_member_id',
  (select m.id from public.shared_ledger_members m
   where m.ledger_id = pg_temp.d1_uuid('pair_ledger_id') and m.role = 'owner')
);
select pg_temp.d1_put_uuid(
  'pair_b_member_id',
  (select i.member_id from public.invitations i
   where i.id = pg_temp.d1_uuid('pair_invitation_id'))
);

select pg_temp.d1_assert(
  exists (
    select 1 from public.shared_ledger_members m
    where m.id = pg_temp.d1_uuid('pair_owner_member_id')
      and m.role = 'owner' and m.status = 'active'
  ),
  '[state assertion] A must be the active pair-ledger owner'
);
select pg_temp.d1_assert(
  exists (
    select 1
    from public.shared_ledger_members m
    join public.identities identity on identity.id = m.identity_id
    where m.id = pg_temp.d1_uuid('pair_b_member_id')
      and m.status = 'invited'
      and identity.kind = 'placeholder'
      and identity.auth_user_id is null
  ),
  '[state assertion] B assigned seat must start invited with placeholder identity'
);
select pg_temp.d1_assert(
  (select count(*) = 2 from public.shared_ledger_members m
   where m.ledger_id = pg_temp.d1_uuid('pair_ledger_id')
     and m.status in ('placeholder', 'invited', 'active')
     and m.deleted_at is null),
  '[state assertion] pair ledger must retain exactly two live seats'
);

reset role;
select pg_temp.d1_assert(
  (select i.code_hash = encode(extensions.digest(convert_to('D1-PAIR-B-ONLY-20260711', 'UTF8'), 'sha256'), 'hex')
          and i.code_hash <> 'D1-PAIR-B-ONLY-20260711'
          and i.code_hash ~ '^[0-9a-f]{64}$'
   from public.invitations i where i.id = pg_temp.d1_uuid('pair_invitation_id')),
  '[privacy assertion] only the lowercase SHA-256 code hash may be stored'
);
select pg_temp.d1_assert(
  not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'invitations'
      and c.column_name in ('raw_code', 'invitation_code', 'code')
  ),
  '[privacy assertion] invitations schema must contain no raw-code column'
);
select pg_temp.d1_assert(
  not has_column_privilege('authenticated', 'public.invitations', 'code_hash', 'select'),
  '[grant denial] authenticated clients must not receive code_hash SELECT privilege'
);

-- A knows the bearer code but is already an active member, so A cannot claim B.
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.d1_user('user_a')::text, true);
do $$
declare v_denied boolean := false;
begin
  begin
    perform public.accept_invitation('D1-PAIR-B-ONLY-20260711');
  exception when unique_violation then v_denied := true;
  end;
  perform pg_temp.d1_assert(v_denied, '[state-machine denial] A cannot accept B assigned seat on B behalf');
end;
$$;

-- B previews the whitelisted payload, then accepts exactly the assigned seat.
select set_config('request.jwt.claim.sub', pg_temp.d1_user('user_b')::text, true);
select pg_temp.d1_put(
  'pair_inspection',
  public.inspect_invitation('D1-PAIR-B-ONLY-20260711')
);
select pg_temp.d1_assert(
  pg_temp.d1_json('pair_inspection') ->> 'ledger_kind' = 'pair'
  and pg_temp.d1_json('pair_inspection') ->> 'ledger_title' = 'D1 Pair Probe'
  and pg_temp.d1_json('pair_inspection') ->> 'assigned_member_display_name' = 'Scratch User B'
  and (pg_temp.d1_json('pair_inspection') ->> 'can_accept')::boolean,
  '[state assertion] B valid bearer inspection must return minimal acceptable metadata'
);
select pg_temp.d1_assert(
  (select array_agg(k order by k) = array[
     'assigned_member_display_name', 'can_accept', 'expires_at',
     'inviter_display_name', 'ledger_kind', 'ledger_title'
   ]::text[]
   from jsonb_object_keys(pg_temp.d1_json('pair_inspection')) k),
  '[privacy assertion] open inspect payload must contain exactly the six approved fields'
);
select pg_temp.d1_put_uuid(
  'pair_b_accepted_member_id',
  public.accept_invitation('D1-PAIR-B-ONLY-20260711')
);
select pg_temp.d1_assert(
  pg_temp.d1_uuid('pair_b_accepted_member_id') = pg_temp.d1_uuid('pair_b_member_id')
  and exists (
    select 1
    from public.shared_ledger_members m
    join public.identities identity on identity.id = m.identity_id
    where m.id = pg_temp.d1_uuid('pair_b_member_id')
      and m.status = 'active'
      and identity.auth_user_id = pg_temp.d1_user('user_b')
      and identity.kind = 'app_user'
  ),
  '[state assertion] B acceptance must activate only B assigned seat with B app_user identity'
);
select pg_temp.d1_assert(
  public.accept_invitation('D1-PAIR-B-ONLY-20260711') = pg_temp.d1_uuid('pair_b_member_id'),
  '[replay assertion] same-user double acceptance must return the same member seat'
);

-- C loses the acceptance race/replay and remains unable to read the ledger.
select set_config('request.jwt.claim.sub', pg_temp.d1_user('user_c')::text, true);
do $$
declare v_denied boolean := false;
begin
  begin
    perform public.accept_invitation('D1-PAIR-B-ONLY-20260711');
  exception when check_violation then v_denied := true;
  end;
  perform pg_temp.d1_assert(v_denied, '[state-machine denial] C cannot consume B already-consumed invitation');
end;
$$;
select pg_temp.d1_assert(
  (select count(*) = 0 from public.shared_ledgers l
   where l.id = pg_temp.d1_uuid('pair_ledger_id')),
  '[RLS denial] C cannot list or read the pair ledger after failed claim'
);

-- An invitation UUID rendered as text is not the bearer capability.
select pg_temp.d1_assert(
  pg_temp.d1_inspect_outcome(pg_temp.d1_uuid('pair_invitation_id')::text)
    = jsonb_build_object('sqlstate', 'P0002', 'message', 'invitation unavailable'),
  '[bearer denial] invitation UUID guessing alone cannot inspect an invitation'
);
do $$
declare v_denied boolean := false;
begin
  begin
    perform public.accept_invitation(pg_temp.d1_uuid('pair_invitation_id')::text);
  exception when no_data_found then v_denied := true;
  end;
  perform pg_temp.d1_assert(v_denied, '[bearer denial] invitation UUID guessing alone cannot claim a seat');
end;
$$;

-- Owner cannot revoke a consumed invitation or remove an active member seat.
select set_config('request.jwt.claim.sub', pg_temp.d1_user('user_a')::text, true);
do $$
declare v_revoke_denied boolean := false; v_remove_denied boolean := false;
begin
  begin
    perform public.revoke_invitation(pg_temp.d1_uuid('pair_invitation_id'), 1);
  exception when check_violation then v_revoke_denied := true;
  end;
  begin
    perform public.remove_unclaimed_member(
      pg_temp.d1_uuid('pair_ledger_id'), pg_temp.d1_uuid('pair_b_member_id'), 1
    );
  exception when check_violation then v_remove_denied := true;
  end;
  perform pg_temp.d1_assert(v_revoke_denied, '[state-machine denial] consumed invitation cannot be revoked');
  perform pg_temp.d1_assert(v_remove_denied, '[state-machine denial] active member cannot be removed');
end;
$$;

-- Create a group ledger for revoke, re-invite, reject, expiry and removal.
select pg_temp.d1_put_uuid(
  'group_ledger_id',
  public.create_shared_ledger(
    'group', 'D1 Lifecycle Probe',
    'd1000000-0000-4000-8000-000000000010'::uuid,
    'd1000000-0000-4000-8000-000000000011'::uuid
  )
);
select pg_temp.d1_put_uuid(
  'group_owner_member_id',
  (select m.id from public.shared_ledger_members m
   where m.ledger_id = pg_temp.d1_uuid('group_ledger_id') and m.role = 'owner')
);
select pg_temp.d1_put_uuid(
  'revoke_invitation_id',
  public.invite_member(
    pg_temp.d1_uuid('group_ledger_id'), 'Revoked Seat', 'link',
    encode(extensions.digest(convert_to('D1-REVOKE-SEAT-20260711', 'UTF8'), 'sha256'), 'hex'),
    now() + interval '2 hours',
    'd1000000-0000-4000-8000-000000000012'::uuid
  )
);
select pg_temp.d1_put_uuid(
  'reusable_member_id',
  (select i.member_id from public.invitations i
   where i.id = pg_temp.d1_uuid('revoke_invitation_id'))
);

-- C has the invitation UUID but no owner authority.
select set_config('request.jwt.claim.sub', pg_temp.d1_user('user_c')::text, true);
do $$
declare
  v_denied boolean := false;
  v_existing_message text;
  v_missing_message text;
  v_reinvite_denied boolean := false;
  v_remove_denied boolean := false;
begin
  begin
    perform public.revoke_invitation(
      pg_temp.d1_uuid('revoke_invitation_id'), 1
    );
  exception when insufficient_privilege then
    v_denied := true;
    v_existing_message := sqlerrm;
  end;
  begin
    perform public.revoke_invitation(
      'd1000000-0000-4000-8000-00000000ffff'::uuid, 1
    );
  exception when insufficient_privilege then v_missing_message := sqlerrm;
  end;
  begin
    perform public.create_member_invitation(
      pg_temp.d1_uuid('group_ledger_id'), pg_temp.d1_uuid('reusable_member_id'),
      encode(extensions.digest(convert_to('D1-NONOWNER-REINVITE-20260711', 'UTF8'), 'sha256'), 'hex'),
      'code', '2099-01-01T00:00:00Z'::timestamptz,
      'd1000000-0000-4000-8000-000000000013'::uuid, 1
    );
  exception when insufficient_privilege then v_reinvite_denied := true;
  end;
  begin
    perform public.remove_unclaimed_member(
      pg_temp.d1_uuid('group_ledger_id'), pg_temp.d1_uuid('reusable_member_id'), 1
    );
  exception when insufficient_privilege then v_remove_denied := true;
  end;
  perform pg_temp.d1_assert(v_denied, '[RPC authorization denial] non-owner C cannot revoke by guessed invitation UUID');
  perform pg_temp.d1_assert(
    v_existing_message = v_missing_message,
    '[oracle denial] missing and unauthorized invitation UUID revocation must be indistinguishable'
  );
  perform pg_temp.d1_assert(v_reinvite_denied, '[RPC authorization denial] non-owner C cannot re-invite a seat');
  perform pg_temp.d1_assert(v_remove_denied, '[RPC authorization denial] non-owner C cannot remove a seat');
end;
$$;

-- A revokes once; retry is terminal-state idempotent and increments once.
select set_config('request.jwt.claim.sub', pg_temp.d1_user('user_a')::text, true);
do $$
declare v_null_denied boolean := false; v_stale_denied boolean := false;
begin
  begin
    perform public.revoke_invitation(
      pg_temp.d1_uuid('revoke_invitation_id'), null
    );
  exception when invalid_parameter_value then v_null_denied := true;
  end;
  begin
    perform public.revoke_invitation(
      pg_temp.d1_uuid('revoke_invitation_id'), 0
    );
  exception when serialization_failure then v_stale_denied := true;
  end;
  perform pg_temp.d1_assert(v_null_denied, '[RPC input denial] NULL expected ledger revision must fail');
  perform pg_temp.d1_assert(v_stale_denied, '[state-machine denial] stale expected ledger revision must fail');
end;
$$;
select pg_temp.d1_put(
  'revoke_result',
  public.revoke_invitation(
    pg_temp.d1_uuid('revoke_invitation_id'), 1
  )
);
select pg_temp.d1_assert(
  pg_temp.d1_json('revoke_result') ->> 'invitation_status' = 'revoked'
  and (pg_temp.d1_json('revoke_result') ->> 'ledger_revision')::bigint = 2
  and exists (
    select 1 from public.shared_ledger_members m
    where m.id = pg_temp.d1_uuid('reusable_member_id') and m.status = 'placeholder'
  ),
  '[state assertion] owner revoke must return seat to placeholder and increment revision once'
);
select pg_temp.d1_assert(
  (public.revoke_invitation(
    pg_temp.d1_uuid('revoke_invitation_id'), 1
  ) ->> 'ledger_revision')::bigint = 2,
  '[replay assertion] owner revoke retry must not increment revision twice'
);

-- Re-invite rejects NULL/stale revisions, raw-looking non-hashes, and removal
-- of the owner seat before any valid mutation is attempted.
do $$
declare
  v_null_denied boolean := false;
  v_stale_denied boolean := false;
  v_raw_denied boolean := false;
  v_owner_invite_denied boolean := false;
  v_owner_remove_denied boolean := false;
begin
  begin
    perform public.create_member_invitation(
      pg_temp.d1_uuid('group_ledger_id'), pg_temp.d1_uuid('reusable_member_id'),
      encode(extensions.digest(convert_to('D1-NULL-REINVITE-20260711', 'UTF8'), 'sha256'), 'hex'),
      'code', '2099-01-01T00:00:00Z'::timestamptz,
      'd1000000-0000-4000-8000-000000000014'::uuid, null
    );
  exception when invalid_parameter_value then v_null_denied := true;
  end;
  begin
    perform public.create_member_invitation(
      pg_temp.d1_uuid('group_ledger_id'), pg_temp.d1_uuid('reusable_member_id'),
      encode(extensions.digest(convert_to('D1-STALE-REINVITE-20260711', 'UTF8'), 'sha256'), 'hex'),
      'code', '2099-01-01T00:00:00Z'::timestamptz,
      'd1000000-0000-4000-8000-000000000014'::uuid, 1
    );
  exception when serialization_failure then v_stale_denied := true;
  end;
  begin
    perform public.create_member_invitation(
      pg_temp.d1_uuid('group_ledger_id'), pg_temp.d1_uuid('reusable_member_id'),
      'D1-RAW-LOOKING-NOT-A-HASH',
      'code', '2099-01-01T00:00:00Z'::timestamptz,
      'd1000000-0000-4000-8000-000000000014'::uuid, 2
    );
  exception when invalid_parameter_value then v_raw_denied := true;
  end;
  begin
    perform public.create_member_invitation(
      pg_temp.d1_uuid('group_ledger_id'), pg_temp.d1_uuid('group_owner_member_id'),
      encode(extensions.digest(convert_to('D1-OWNER-SEAT-REINVITE-20260711', 'UTF8'), 'sha256'), 'hex'),
      'code', '2099-01-01T00:00:00Z'::timestamptz,
      'd1000000-0000-4000-8000-000000000014'::uuid, 2
    );
  exception when check_violation then v_owner_invite_denied := true;
  end;
  begin
    perform public.remove_unclaimed_member(
      pg_temp.d1_uuid('group_ledger_id'), pg_temp.d1_uuid('group_owner_member_id'), 2
    );
  exception when check_violation then v_owner_remove_denied := true;
  end;
  perform pg_temp.d1_assert(v_null_denied, '[RPC input denial] create_member_invitation NULL revision must fail');
  perform pg_temp.d1_assert(v_stale_denied, '[state-machine denial] create_member_invitation stale revision must fail');
  perform pg_temp.d1_assert(v_raw_denied, '[RPC input denial] create_member_invitation rejects raw-looking non-hash input');
  perform pg_temp.d1_assert(v_owner_invite_denied, '[state-machine denial] owner seat cannot be re-invited');
  perform pg_temp.d1_assert(v_owner_remove_denied, '[state-machine denial] owner seat removal must fail');
end;
$$;

select pg_temp.d1_put(
  'reinvite_result',
  public.create_member_invitation(
    pg_temp.d1_uuid('group_ledger_id'),
    pg_temp.d1_uuid('reusable_member_id'),
    encode(extensions.digest(convert_to('D1-REINVITE-SEAT-20260711', 'UTF8'), 'sha256'), 'hex'),
    'link', '2099-01-01T00:00:00Z'::timestamptz,
    'd1000000-0000-4000-8000-000000000015'::uuid, 2
  )
);
select pg_temp.d1_assert(
  pg_temp.d1_json('reinvite_result') ->> 'invitation_status' = 'open'
  and (pg_temp.d1_json('reinvite_result') ->> 'ledger_revision')::bigint = 3
  and (pg_temp.d1_json('reinvite_result') ->> 'member_id')::uuid
      = pg_temp.d1_uuid('reusable_member_id')
  and exists (
    select 1 from public.shared_ledger_members m
    where m.id = pg_temp.d1_uuid('reusable_member_id') and m.status = 'invited'
  )
  and exists (
    select 1 from public.invitations old_invitation
    where old_invitation.id = pg_temp.d1_uuid('revoke_invitation_id')
      and old_invitation.member_id = pg_temp.d1_uuid('reusable_member_id')
      and old_invitation.revoked_at is not null
  ),
  '[state assertion] re-invite must reuse the exact seat, preserve revoked history, and increment revision once'
);
select pg_temp.d1_assert(
  (public.create_member_invitation(
    pg_temp.d1_uuid('group_ledger_id'),
    pg_temp.d1_uuid('reusable_member_id'),
    encode(extensions.digest(convert_to('D1-REINVITE-SEAT-20260711', 'UTF8'), 'sha256'), 'hex'),
    'link', '2099-01-01T00:00:00Z'::timestamptz,
    'd1000000-0000-4000-8000-000000000015'::uuid, 2
  ) ->> 'ledger_revision')::bigint = 3,
  '[replay assertion] client invitation UUID retry must not create a duplicate or increment twice'
);

do $$
declare v_mismatch_denied boolean := false;
begin
  begin
    perform public.create_member_invitation(
      pg_temp.d1_uuid('group_ledger_id'), pg_temp.d1_uuid('reusable_member_id'),
      encode(extensions.digest(convert_to('D1-MISMATCHED-PAYLOAD-20260711', 'UTF8'), 'sha256'), 'hex'),
      'link', '2099-01-01T00:00:00Z'::timestamptz,
      'd1000000-0000-4000-8000-000000000015'::uuid, 3
    );
  exception when unique_violation then v_mismatch_denied := true;
  end;
  perform pg_temp.d1_assert(v_mismatch_denied, '[idempotency denial] reused client invitation UUID with mismatched payload must fail');
end;
$$;

-- Disposable inconsistent-state fixture: leave the active invitation open but
-- temporarily expose its seat as placeholder so the duplicate-invitation guard
-- itself, rather than the ordinary invited-seat guard, must deny the call.
reset role;
update public.shared_ledger_members
set status = 'placeholder'
where id = pg_temp.d1_uuid('reusable_member_id');
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.d1_user('user_a')::text, true);
do $$
declare v_duplicate_denied boolean := false;
begin
  begin
    perform public.create_member_invitation(
      pg_temp.d1_uuid('group_ledger_id'), pg_temp.d1_uuid('reusable_member_id'),
      encode(extensions.digest(convert_to('D1-DUPLICATE-OPEN-SEAT-20260711', 'UTF8'), 'sha256'), 'hex'),
      'code', '2099-01-01T00:00:00Z'::timestamptz,
      'd1000000-0000-4000-8000-000000000016'::uuid, 3
    );
  exception when check_violation then
    v_duplicate_denied := sqlerrm = 'revoke the existing invitation before re-inviting this seat';
  end;
  perform pg_temp.d1_assert(v_duplicate_denied, '[state-machine denial] duplicate active invitation for one seat must reach and fail the duplicate guard');
end;
$$;
reset role;
update public.shared_ledger_members
set status = 'invited'
where id = pg_temp.d1_uuid('reusable_member_id');
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.d1_user('user_a')::text, true);

-- Active B pair seat can never be replaced with another invitation.
do $$
declare v_denied boolean := false;
begin
  begin
    perform public.create_member_invitation(
      pg_temp.d1_uuid('pair_ledger_id'), pg_temp.d1_uuid('pair_b_member_id'),
      encode(extensions.digest(convert_to('D1-ACTIVE-REPLACE-20260711', 'UTF8'), 'sha256'), 'hex'),
      'code', '2099-01-01T00:00:00Z'::timestamptz,
      'd1000000-0000-4000-8000-000000000016'::uuid, 1
    );
  exception when check_violation then v_denied := true;
  end;
  perform pg_temp.d1_assert(v_denied, '[state-machine denial] active B member seat cannot be replaced or re-invited');
end;
$$;

-- Remove the re-invited, still-unclaimed seat; replay remains idempotent.
do $$
declare v_null_denied boolean := false; v_stale_denied boolean := false;
begin
  begin
    perform public.remove_unclaimed_member(
      pg_temp.d1_uuid('group_ledger_id'), pg_temp.d1_uuid('reusable_member_id'), null
    );
  exception when invalid_parameter_value then v_null_denied := true;
  end;
  begin
    perform public.remove_unclaimed_member(
      pg_temp.d1_uuid('group_ledger_id'), pg_temp.d1_uuid('reusable_member_id'), 2
    );
  exception when serialization_failure then v_stale_denied := true;
  end;
  perform pg_temp.d1_assert(v_null_denied, '[RPC input denial] remove_unclaimed_member NULL revision must fail');
  perform pg_temp.d1_assert(v_stale_denied, '[state-machine denial] remove_unclaimed_member stale revision must fail');
end;
$$;
select pg_temp.d1_put(
  'remove_result',
  public.remove_unclaimed_member(
    pg_temp.d1_uuid('group_ledger_id'), pg_temp.d1_uuid('reusable_member_id'), 3
  )
);
select pg_temp.d1_assert(
  pg_temp.d1_json('remove_result') ->> 'member_status' = 'removed'
  and (pg_temp.d1_json('remove_result') ->> 'ledger_revision')::bigint = 4
  and exists (
    select 1 from public.shared_ledger_members m
    where m.id = pg_temp.d1_uuid('reusable_member_id')
      and m.status = 'removed' and m.deleted_at is not null
  ),
  '[state assertion] unclaimed member removal must tombstone the seat and increment once'
);
select pg_temp.d1_assert(
  (public.remove_unclaimed_member(
    pg_temp.d1_uuid('group_ledger_id'), pg_temp.d1_uuid('reusable_member_id'), 3
  ) ->> 'ledger_revision')::bigint = 4,
  '[replay assertion] unclaimed member removal retry must not increment twice'
);
do $$
declare v_denied boolean := false;
begin
  begin
    perform public.create_member_invitation(
      pg_temp.d1_uuid('group_ledger_id'), pg_temp.d1_uuid('reusable_member_id'),
      encode(extensions.digest(convert_to('D1-REMOVED-SEAT-REINVITE-20260711', 'UTF8'), 'sha256'), 'hex'),
      'code', '2099-01-01T00:00:00Z'::timestamptz,
      'd1000000-0000-4000-8000-000000000018'::uuid, 4
    );
  exception when check_violation then v_denied := true;
  end;
  perform pg_temp.d1_assert(v_denied, '[state-machine denial] removed seat cannot be re-invited');
end;
$$;

-- Rejected invitation: B rejects, same-user retry is stable, acceptance fails.
select pg_temp.d1_put_uuid(
  'reject_invitation_id',
  public.invite_member(
    pg_temp.d1_uuid('group_ledger_id'), 'Rejected Seat', 'code',
    encode(extensions.digest(convert_to('D1-REJECT-SEAT-20260711', 'UTF8'), 'sha256'), 'hex'),
    now() + interval '2 hours',
    'd1000000-0000-4000-8000-000000000020'::uuid
  )
);
select pg_temp.d1_put_uuid(
  'reject_member_id',
  (select i.member_id from public.invitations i
   where i.id = pg_temp.d1_uuid('reject_invitation_id'))
);

-- The owner is already an active group member and cannot use another seat's
-- bearer code to reject it.
do $$
declare v_denied boolean := false;
begin
  begin
    perform public.reject_invitation('D1-REJECT-SEAT-20260711');
  exception when insufficient_privilege then v_denied := true;
  end;
  perform pg_temp.d1_assert(v_denied, '[rejection rule] active ledger member cannot reject another seat invitation');
end;
$$;

-- Adversarial fixture: an Auth-linked identity of the wrong kind must not be
-- accepted as the rejecting actor. D is not bootstrapped anywhere else.
reset role;
insert into public.identities (
  id, kind, auth_user_id, display_name, created_by
) values (
  'd1000000-0000-4000-8000-000000000019'::uuid,
  'placeholder', pg_temp.d1_user('user_d'), 'Conflicting Identity',
  pg_temp.d1_user('user_d')
);
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.d1_user('user_d')::text, true);
do $$
declare v_denied boolean := false;
begin
  begin
    perform public.reject_invitation('D1-REJECT-SEAT-20260711');
  exception when check_violation then v_denied := true;
  end;
  perform pg_temp.d1_assert(v_denied, '[identity denial] Auth-linked non-app_user identity cannot reject');
end;
$$;

-- B is authenticated and active elsewhere, but is not a member of this
-- ledger. Possession of the raw bearer code therefore permits rejection.
reset role;
select pg_temp.d1_put_uuid(
  'reject_actor_identity_id',
  (select identity.id
   from public.identities identity
   where identity.kind = 'app_user'
     and identity.auth_user_id = pg_temp.d1_user('user_b')
     and identity.merged_into_identity_id is null
     and identity.deleted_at is null)
);
select pg_temp.d1_put('reject_before_first', pg_temp.d1_reject_snapshot());
select pg_temp.d1_assert(
  pg_temp.d1_json('reject_before_first') ->> 'invitation_id'
    = pg_temp.d1_uuid('reject_invitation_id')::text
  and pg_temp.d1_json('reject_before_first') ->> 'member_id'
    = pg_temp.d1_uuid('reject_member_id')::text,
  '[rejection fixture] snapshot must target the exact rejection invitation and assigned seat'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('reject_before_first') ->> 'rejected_at' is null
  and pg_temp.d1_json('reject_before_first') ->> 'rejected_by_identity_id' is null
  and pg_temp.d1_json('reject_before_first') ->> 'consumed_at' is null
  and pg_temp.d1_json('reject_before_first') ->> 'consumed_by_identity_id' is null
  and pg_temp.d1_json('reject_before_first') ->> 'revoked_at' is null
  and (pg_temp.d1_json('reject_before_first') ->> 'use_count')::integer = 0,
  '[rejection fixture] invitation must be open before first rejection'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('reject_before_first') ->> 'member_status' = 'invited'
  and pg_temp.d1_json('reject_before_first') ->> 'member_deleted_at' is null,
  '[rejection fixture] assigned seat must be live and invited before first rejection'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.d1_user('user_b')::text, true);
select pg_temp.d1_assert(
  public.current_member_id(pg_temp.d1_uuid('group_ledger_id')) is null,
  '[rejection rule] B must be a non-member of the target ledger before bearer rejection'
);
select pg_temp.d1_put(
  'reject_first_result',
  public.reject_invitation('D1-REJECT-SEAT-20260711')
);
reset role;
select pg_temp.d1_put('reject_after_first', pg_temp.d1_reject_snapshot());
select pg_temp.d1_assert(
  pg_temp.d1_json('reject_first_result')
    = jsonb_build_object('ok', true, 'invitation_status', 'rejected'),
  '[state assertion] first bearer rejection must return the exact safe rejected result'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('reject_after_first') ->> 'rejected_at' is not null,
  '[state assertion] first bearer rejection must set rejected_at'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('reject_after_first') ->> 'rejected_by_identity_id'
    = pg_temp.d1_uuid('reject_actor_identity_id')::text,
  '[state assertion] first bearer rejection must record B app_user identity'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('reject_after_first') ->> 'consumed_at' is null
  and pg_temp.d1_json('reject_after_first') ->> 'consumed_by_identity_id' is null,
  '[state assertion] first bearer rejection must leave consumption fields null'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('reject_after_first') ->> 'revoked_at' is null,
  '[state assertion] first bearer rejection must leave revoked_at null'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('reject_after_first') ->> 'member_status' = 'placeholder',
  '[state assertion] first bearer rejection must return the assigned seat to placeholder'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('reject_after_first') -> 'ledger_revision'
    = pg_temp.d1_json('reject_before_first') -> 'ledger_revision',
  '[state assertion] first bearer rejection must not change ledger revision'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('reject_after_first') -> 'invitation_count'
    = pg_temp.d1_json('reject_before_first') -> 'invitation_count'
  and pg_temp.d1_json('reject_after_first') -> 'member_count'
    = pg_temp.d1_json('reject_before_first') -> 'member_count'
  and pg_temp.d1_json('reject_after_first') -> 'event_count'
    = pg_temp.d1_json('reject_before_first') -> 'event_count',
  '[state assertion] first bearer rejection must not create invitation, member, or event rows'
);

-- B remains a non-member, so authenticated RLS intentionally hides the
-- placeholder seat. The replay call runs as B; state verification runs only
-- after RESET ROLE so RLS invisibility cannot become a false assertion.
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.d1_user('user_b')::text, true);
select pg_temp.d1_assert(
  (select count(*) = 0
   from public.shared_ledger_members member
   where member.id = pg_temp.d1_uuid('reject_member_id')),
  '[RLS denial] rejecting non-member B must not directly read the placeholder seat'
);
select pg_temp.d1_put(
  'reject_retry_result',
  public.reject_invitation('D1-REJECT-SEAT-20260711')
);
reset role;
select pg_temp.d1_put('reject_after_retry', pg_temp.d1_reject_snapshot());
select pg_temp.d1_assert(
  pg_temp.d1_json('reject_after_retry') ->> 'rejected_at' is not null,
  '[replay assertion] invitation must remain rejected'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('reject_after_retry') -> 'rejected_by_identity_id'
    = pg_temp.d1_json('reject_after_first') -> 'rejected_by_identity_id',
  '[replay assertion] rejected_by_identity_id must remain unchanged'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('reject_after_retry') -> 'rejected_at'
    = pg_temp.d1_json('reject_after_first') -> 'rejected_at',
  '[replay assertion] rejected_at must remain unchanged'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('reject_after_retry') ->> 'consumed_at' is null
  and pg_temp.d1_json('reject_after_retry') ->> 'consumed_by_identity_id' is null,
  '[replay assertion] consumption fields must remain null'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('reject_after_retry') ->> 'revoked_at' is null,
  '[replay assertion] revoked_at must remain null'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('reject_after_retry') ->> 'member_status' = 'placeholder',
  '[replay assertion] assigned seat must remain placeholder'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('reject_after_retry') -> 'ledger_revision'
    = pg_temp.d1_json('reject_after_first') -> 'ledger_revision',
  '[replay assertion] ledger revision must remain unchanged'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('reject_after_retry') -> 'invitation_count'
    = pg_temp.d1_json('reject_after_first') -> 'invitation_count',
  '[replay assertion] retry must not create another invitation row'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('reject_after_retry') -> 'member_count'
    = pg_temp.d1_json('reject_after_first') -> 'member_count',
  '[replay assertion] retry must not create another member row'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('reject_after_retry') -> 'event_count'
    = pg_temp.d1_json('reject_after_first') -> 'event_count',
  '[replay assertion] retry must not create an event row'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('reject_after_retry') -> 'invitation_sha256'
    = pg_temp.d1_json('reject_after_first') -> 'invitation_sha256',
  '[replay assertion] retry must leave the exact invitation row unchanged'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('reject_after_retry') -> 'member_sha256'
    = pg_temp.d1_json('reject_after_first') -> 'member_sha256',
  '[replay assertion] retry must leave the exact member row unchanged'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('reject_after_retry') -> 'ledger_sha256'
    = pg_temp.d1_json('reject_after_first') -> 'ledger_sha256',
  '[replay assertion] retry must leave the exact ledger row unchanged'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('reject_retry_result')
    = jsonb_build_object('ok', true, 'invitation_status', 'rejected'),
  '[replay assertion] same-actor retry must return the exact safe rejected result'
);

-- A different active app_user with the same bearer receives one generic
-- unavailable outcome and cannot learn the rejecting identity or mutate state.
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.d1_user('user_c')::text, true);
do $$
declare
  v_sqlstate text;
  v_message text;
begin
  begin
    perform public.reject_invitation('D1-REJECT-SEAT-20260711');
  exception when others then
    v_sqlstate := sqlstate;
    v_message := sqlerrm;
  end;
  perform pg_temp.d1_assert(
    v_sqlstate = 'P0002' and v_message = 'invitation unavailable',
    '[privacy assertion] different-actor rejected-code retry must be generically unavailable'
  );
end;
$$;
reset role;
select pg_temp.d1_put('reject_after_other_actor', pg_temp.d1_reject_snapshot());
select pg_temp.d1_assert(
  pg_temp.d1_json('reject_after_other_actor') = pg_temp.d1_json('reject_after_retry'),
  '[mutation assertion] different-actor rejected-code retry must not mutate invitation, seat, ledger, counts, or events'
);
select pg_temp.d1_assert(
  exists (
    select 1
    from public.invitations invitation
    join public.identities identity
      on identity.id = invitation.rejected_by_identity_id
    where invitation.id = pg_temp.d1_uuid('reject_invitation_id')
      and identity.kind = 'app_user'
      and identity.auth_user_id = pg_temp.d1_user('user_b')
      and identity.merged_into_identity_id is null
      and identity.deleted_at is null
  ),
  '[identity assertion] rejecting actor must be server-derived B active app_user identity'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.d1_user('user_b')::text, true);
do $$
declare v_denied boolean := false;
begin
  begin perform public.accept_invitation('D1-REJECT-SEAT-20260711');
  exception when check_violation then v_denied := true;
  end;
  perform pg_temp.d1_assert(v_denied, '[state-machine denial] rejected invitation can never be accepted');
end;
$$;

-- Expired and revoked codes fail at the invitation state machine.
select set_config('request.jwt.claim.sub', pg_temp.d1_user('user_a')::text, true);
select pg_temp.d1_put_uuid(
  'expired_invitation_id',
  public.invite_member(
    pg_temp.d1_uuid('group_ledger_id'), 'Expired Seat', 'code',
    encode(extensions.digest(convert_to('D1-EXPIRED-SEAT-20260711', 'UTF8'), 'sha256'), 'hex'),
    now() + interval '2 hours',
    'd1000000-0000-4000-8000-000000000022'::uuid
  )
);
reset role;
update public.invitations
set created_at = now() - interval '2 hours',
    expires_at = now() - interval '1 hour'
where id = pg_temp.d1_uuid('expired_invitation_id');
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.d1_user('user_c')::text, true);
do $$
declare v_expired boolean := false; v_revoked boolean := false;
begin
  begin perform public.accept_invitation('D1-EXPIRED-SEAT-20260711');
  exception when check_violation then v_expired := true;
  end;
  begin perform public.accept_invitation('D1-REVOKE-SEAT-20260711');
  exception when check_violation then v_revoked := true;
  end;
  perform pg_temp.d1_assert(v_expired, '[state-machine denial] expired invitation must fail acceptance');
  perform pg_temp.d1_assert(v_revoked, '[state-machine denial] revoked invitation must fail acceptance');
end;
$$;

-- Deleted-ledger regression plus the complete fail-closed terminal preview
-- matrix. Every case must expose only one generic unavailable error.
select set_config('request.jwt.claim.sub', pg_temp.d1_user('user_a')::text, true);
select pg_temp.d1_put_uuid(
  'deleted_ledger_id',
  public.create_shared_ledger(
    'group', 'D1 Deleted Ledger Probe',
    'd1000000-0000-4000-8000-000000000030'::uuid,
    'd1000000-0000-4000-8000-000000000031'::uuid
  )
);
select pg_temp.d1_put_uuid(
  'deleted_invitation_id',
  public.invite_member(
    pg_temp.d1_uuid('deleted_ledger_id'), 'Deleted Ledger Seat', 'code',
    encode(extensions.digest(convert_to('D1-DELETED-LEDGER-20260711', 'UTF8'), 'sha256'), 'hex'),
    now() + interval '2 hours',
    'd1000000-0000-4000-8000-000000000032'::uuid
  )
);
reset role;
update public.shared_ledgers
set status = 'deleted', deleted_at = now()
where id = pg_temp.d1_uuid('deleted_ledger_id');

-- Administrator-only inconsistent-state fixtures isolate the two exact member
-- seat predicates enforced by inspect_invitation. Both invitations remain
-- otherwise open, unexpired and nonterminal throughout the preview calls.
insert into public.identities (
  id, kind, display_name, created_by
) values
  (
    'd1000000-0000-4000-8000-000000000033'::uuid,
    'placeholder', 'Active Preview Identity', pg_temp.d1_user('user_a')
  ),
  (
    'd1000000-0000-4000-8000-000000000034'::uuid,
    'placeholder', 'Removed Preview Identity', pg_temp.d1_user('user_a')
  );

insert into public.shared_ledger_members (
  id, ledger_id, identity_id, role, status, display_name, invited_by,
  client_member_id, joined_at, removed_at, deleted_at
) values
  (
    'd1000000-0000-4000-8000-000000000035'::uuid,
    pg_temp.d1_uuid('group_ledger_id'),
    'd1000000-0000-4000-8000-000000000033'::uuid,
    'member', 'active', 'Active Preview Seat',
    pg_temp.d1_uuid('group_owner_member_id'),
    'd1000000-0000-4000-8000-000000000036'::uuid,
    now(), null, null
  ),
  (
    'd1000000-0000-4000-8000-000000000037'::uuid,
    pg_temp.d1_uuid('group_ledger_id'),
    'd1000000-0000-4000-8000-000000000034'::uuid,
    'member', 'removed', 'Removed Preview Seat',
    pg_temp.d1_uuid('group_owner_member_id'),
    'd1000000-0000-4000-8000-000000000038'::uuid,
    null, now(), now()
  );

insert into public.invitations (
  id, ledger_id, member_id, created_by, method, code_hash, expires_at
) values
  (
    'd1000000-0000-4000-8000-000000000039'::uuid,
    pg_temp.d1_uuid('group_ledger_id'),
    'd1000000-0000-4000-8000-000000000035'::uuid,
    pg_temp.d1_uuid('group_owner_member_id'), 'code',
    encode(extensions.digest(convert_to('D1-ACTIVE-PREVIEW-20260711', 'UTF8'), 'sha256'), 'hex'),
    now() + interval '2 hours'
  ),
  (
    'd1000000-0000-4000-8000-00000000003a'::uuid,
    pg_temp.d1_uuid('group_ledger_id'),
    'd1000000-0000-4000-8000-000000000037'::uuid,
    pg_temp.d1_uuid('group_owner_member_id'), 'code',
    encode(extensions.digest(convert_to('D1-REMOVED-PREVIEW-20260711', 'UTF8'), 'sha256'), 'hex'),
    now() + interval '2 hours'
  );

select pg_temp.d1_put(
  'active_preview_before',
  jsonb_build_object(
    'invitation', (select to_jsonb(i) from public.invitations i
                   where i.id = 'd1000000-0000-4000-8000-000000000039'::uuid),
    'member', (select to_jsonb(m) from public.shared_ledger_members m
               where m.id = 'd1000000-0000-4000-8000-000000000035'::uuid)
  )
);
select pg_temp.d1_assert(
  exists (
    select 1
    from public.invitations i
    join public.shared_ledgers l on l.id = i.ledger_id
    join public.shared_ledger_members m on m.id = i.member_id
    where i.id = 'd1000000-0000-4000-8000-000000000039'::uuid
      and i.consumed_at is null and i.consumed_by_identity_id is null
      and i.rejected_at is null and i.rejected_by_identity_id is null
      and i.revoked_at is null and i.expires_at > now()
      and i.use_count = 0 and i.max_uses = 1
      and l.status = 'active' and l.deleted_at is null
      and m.role = 'member' and m.status = 'active'
      and m.joined_at is not null and m.removed_at is null
      and m.deleted_at is null
  ),
  '[fixture isolation] active-seat preview invitation must be otherwise open and fail only the invited-seat predicate'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.d1_user('user_c')::text, true);
select pg_temp.d1_assert(
  pg_temp.d1_inspect_outcome('D1-ACTIVE-PREVIEW-20260711')
    = jsonb_build_object('sqlstate', 'P0002', 'message', 'invitation unavailable'),
  '[privacy assertion] active-seat preview must return only generic unavailable with no title, display name, or UUID metadata'
);
reset role;
select pg_temp.d1_assert(
  pg_temp.d1_json('active_preview_before') = jsonb_build_object(
    'invitation', (select to_jsonb(i) from public.invitations i
                   where i.id = 'd1000000-0000-4000-8000-000000000039'::uuid),
    'member', (select to_jsonb(m) from public.shared_ledger_members m
               where m.id = 'd1000000-0000-4000-8000-000000000035'::uuid)
  ),
  '[non-mutation assertion] active-seat preview must leave invitation and member rows unchanged'
);

select pg_temp.d1_put(
  'removed_preview_before',
  jsonb_build_object(
    'invitation', (select to_jsonb(i) from public.invitations i
                   where i.id = 'd1000000-0000-4000-8000-00000000003a'::uuid),
    'member', (select to_jsonb(m) from public.shared_ledger_members m
               where m.id = 'd1000000-0000-4000-8000-000000000037'::uuid)
  )
);
select pg_temp.d1_assert(
  exists (
    select 1
    from public.invitations i
    join public.shared_ledgers l on l.id = i.ledger_id
    join public.shared_ledger_members m on m.id = i.member_id
    where i.id = 'd1000000-0000-4000-8000-00000000003a'::uuid
      and i.consumed_at is null and i.consumed_by_identity_id is null
      and i.rejected_at is null and i.rejected_by_identity_id is null
      and i.revoked_at is null and i.expires_at > now()
      and i.use_count = 0 and i.max_uses = 1
      and l.status = 'active' and l.deleted_at is null
      and m.role = 'member' and m.status = 'removed'
      and m.removed_at is not null and m.deleted_at is not null
  ),
  '[fixture isolation] removed-seat preview invitation must be otherwise open and fail only the seat status/deleted predicates'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.d1_user('user_c')::text, true);
select pg_temp.d1_assert(
  pg_temp.d1_inspect_outcome('D1-REMOVED-PREVIEW-20260711')
    = jsonb_build_object('sqlstate', 'P0002', 'message', 'invitation unavailable'),
  '[privacy assertion] removed-seat preview must return only generic unavailable with no title, display name, or UUID metadata'
);
reset role;
select pg_temp.d1_assert(
  pg_temp.d1_json('removed_preview_before') = jsonb_build_object(
    'invitation', (select to_jsonb(i) from public.invitations i
                   where i.id = 'd1000000-0000-4000-8000-00000000003a'::uuid),
    'member', (select to_jsonb(m) from public.shared_ledger_members m
               where m.id = 'd1000000-0000-4000-8000-000000000037'::uuid)
  ),
  '[non-mutation assertion] removed-seat preview must leave invitation and member rows unchanged'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.d1_user('user_c')::text, true);
select pg_temp.d1_assert(
  (
    select count(*) = 7
      and count(distinct outcome) = 1
      and min(outcome::text) = jsonb_build_object(
        'sqlstate', 'P0002', 'message', 'invitation unavailable'
      )::text
    from (values
      (pg_temp.d1_inspect_outcome('D1-EXPIRED-SEAT-20260711')),
      (pg_temp.d1_inspect_outcome('D1-REJECT-SEAT-20260711')),
      (pg_temp.d1_inspect_outcome('D1-REVOKE-SEAT-20260711')),
      (pg_temp.d1_inspect_outcome('D1-PAIR-B-ONLY-20260711')),
      (pg_temp.d1_inspect_outcome('D1-DELETED-LEDGER-20260711')),
      (pg_temp.d1_inspect_outcome('D1-ACTIVE-PREVIEW-20260711')),
      (pg_temp.d1_inspect_outcome('D1-REMOVED-PREVIEW-20260711'))
    ) terminal(outcome)
  ),
  '[privacy assertion] expired/rejected/revoked/consumed/deleted-ledger/active-seat/removed-seat previews must share one metadata-free unavailable error'
);
do $$
declare v_denied boolean := false;
begin
  begin perform public.accept_invitation('D1-DELETED-LEDGER-20260711');
  exception when check_violation then v_denied := true;
  end;
  perform pg_temp.d1_assert(v_denied, '[state-machine denial] deleted-ledger invitation must fail acceptance');
end;
$$;
select pg_temp.d1_assert(
  (select count(*) = 0 from public.shared_ledgers l
   where l.id = pg_temp.d1_uuid('deleted_ledger_id')),
  '[RLS denial] non-member C cannot read deleted ledger after failed claim'
);

-- Disposable security fixture: one synthetic shared entry/line establishes
-- retained history. Exact hashed protected-row snapshots prove D1 RPCs do not
-- modify or delete it. The fixture is removed before the final global snapshot.
select set_config('request.jwt.claim.sub', pg_temp.d1_user('user_a')::text, true);
select pg_temp.d1_put_uuid(
  'history_invitation_id',
  public.invite_member(
    pg_temp.d1_uuid('group_ledger_id'), 'History Seat', 'code',
    encode(extensions.digest(convert_to('D1-HISTORY-SEAT-20260711', 'UTF8'), 'sha256'), 'hex'),
    now() + interval '2 hours',
    'd1000000-0000-4000-8000-000000000040'::uuid
  )
);
select pg_temp.d1_put_uuid(
  'history_member_id',
  (select i.member_id from public.invitations i
   where i.id = pg_temp.d1_uuid('history_invitation_id'))
);
select pg_temp.d1_assert(
  (public.revoke_invitation(
    pg_temp.d1_uuid('history_invitation_id'), 4
  ) ->> 'ledger_revision')::bigint = 5,
  '[state assertion] history test seat must first return to placeholder'
);
reset role;
insert into public.shared_entries (
  id, ledger_id, payer_member_id, created_by_member_id, entry_type,
  title, total_amount_sen, client_entry_id, entry_date
) values (
  'd1000000-0000-4000-8000-000000000042'::uuid,
  pg_temp.d1_uuid('group_ledger_id'), pg_temp.d1_uuid('group_owner_member_id'),
  pg_temp.d1_uuid('group_owner_member_id'), 'expense', 'Synthetic history guard',
  100, 'd1000000-0000-4000-8000-000000000043'::uuid, current_date
);
insert into public.shared_entry_lines (
  id, entry_id, member_id, amount_sen, client_line_id
) values (
  'd1000000-0000-4000-8000-000000000044'::uuid,
  'd1000000-0000-4000-8000-000000000042'::uuid,
  pg_temp.d1_uuid('history_member_id'), 100,
  'd1000000-0000-4000-8000-000000000045'::uuid
);
select pg_temp.d1_put('history_snapshot_before', pg_temp.d1_protected_snapshot());
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.d1_user('user_a')::text, true);
do $$
declare v_reinvite_denied boolean := false; v_remove_denied boolean := false;
begin
  begin
    perform public.create_member_invitation(
      pg_temp.d1_uuid('group_ledger_id'), pg_temp.d1_uuid('history_member_id'),
      encode(extensions.digest(convert_to('D1-HISTORY-REINVITE-20260711', 'UTF8'), 'sha256'), 'hex'),
      'code', '2099-01-01T00:00:00Z'::timestamptz,
      'd1000000-0000-4000-8000-000000000046'::uuid, 5
    );
  exception when check_violation then v_reinvite_denied := true;
  end;
  begin
    perform public.remove_unclaimed_member(
      pg_temp.d1_uuid('group_ledger_id'), pg_temp.d1_uuid('history_member_id'), 5
    );
  exception when check_violation then v_remove_denied := true;
  end;
  perform pg_temp.d1_assert(v_reinvite_denied, '[state-machine denial] member seat with shared line history cannot be re-invited');
  perform pg_temp.d1_assert(v_remove_denied, '[state-machine denial] member seat with shared line history cannot be removed');
end;
$$;
reset role;
select pg_temp.d1_assert(
  pg_temp.d1_protected_snapshot() = pg_temp.d1_json('history_snapshot_before'),
  '[mutation assertion] failed D1 history guards must not modify or delete disposable protected fixtures'
);
delete from public.shared_entry_lines
where id = 'd1000000-0000-4000-8000-000000000044'::uuid;
delete from public.shared_entries
where id = 'd1000000-0000-4000-8000-000000000042'::uuid;

-- Isolated reject-replay regression: the exact rejected placeholder seat is
-- structurally clean until a disposable entry line gives it retained shared
-- history. That single history condition must make same-actor replay generic,
-- mutation-free, and ineligible for the safe rejected JSON result.
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.d1_user('user_a')::text, true);
select pg_temp.d1_put_uuid(
  'history_replay_ledger_id',
  public.create_shared_ledger(
    'group', 'D1 History Replay Probe',
    'd1000000-0000-4000-8000-000000000050'::uuid,
    'd1000000-0000-4000-8000-000000000051'::uuid
  )
);
select pg_temp.d1_put_uuid(
  'history_replay_owner_member_id',
  (select member.id
   from public.shared_ledger_members member
   where member.ledger_id = pg_temp.d1_uuid('history_replay_ledger_id')
     and member.role = 'owner')
);
select pg_temp.d1_put_uuid(
  'history_replay_invitation_id',
  public.invite_member(
    pg_temp.d1_uuid('history_replay_ledger_id'),
    'History Replay Seat', 'code',
    encode(extensions.digest(
      convert_to('D1-HISTORY-REPLAY-20260711', 'UTF8'), 'sha256'
    ), 'hex'),
    now() + interval '2 hours',
    'd1000000-0000-4000-8000-000000000052'::uuid
  )
);
select pg_temp.d1_put_uuid(
  'history_replay_member_id',
  (select invitation.member_id
   from public.invitations invitation
   where invitation.id = pg_temp.d1_uuid('history_replay_invitation_id'))
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.d1_user('user_b')::text, true);
select pg_temp.d1_assert(
  public.current_member_id(pg_temp.d1_uuid('history_replay_ledger_id')) is null,
  '[history-bearing replay fixture] B must be a non-member before rejecting the isolated invitation'
);
select pg_temp.d1_put(
  'history_replay_first_result',
  public.reject_invitation('D1-HISTORY-REPLAY-20260711')
);
reset role;
select pg_temp.d1_put(
  'history_replay_clean',
  pg_temp.d1_replay_guard_snapshot(
    pg_temp.d1_uuid('history_replay_invitation_id')
  )
);
select pg_temp.d1_assert(
  pg_temp.d1_json('history_replay_first_result')
    = jsonb_build_object('ok', true, 'invitation_status', 'rejected'),
  '[history-bearing replay fixture] first rejection must succeed before history is added'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('history_replay_clean') ->> 'invitation_id'
    = pg_temp.d1_uuid('history_replay_invitation_id')::text
  and pg_temp.d1_json('history_replay_clean') ->> 'member_id'
    = pg_temp.d1_uuid('history_replay_member_id')::text
  and pg_temp.d1_json('history_replay_clean') ->> 'ledger_id'
    = pg_temp.d1_uuid('history_replay_ledger_id')::text
  and pg_temp.d1_json('history_replay_clean') ->> 'rejected_at' is not null
  and pg_temp.d1_json('history_replay_clean') ->> 'rejected_by_identity_id'
    = pg_temp.d1_uuid('reject_actor_identity_id')::text
  and pg_temp.d1_json('history_replay_clean') ->> 'consumed_at' is null
  and pg_temp.d1_json('history_replay_clean') ->> 'consumed_by_identity_id' is null
  and pg_temp.d1_json('history_replay_clean') ->> 'revoked_at' is null
  and (pg_temp.d1_json('history_replay_clean') ->> 'use_count')::integer = 0,
  '[history-bearing replay fixture] invitation must be consistently rejected only by B'
);
select pg_temp.d1_assert(
  (pg_temp.d1_json('history_replay_clean') ->> 'invitation_count')::bigint = 1
  and (pg_temp.d1_json('history_replay_clean') ->> 'member_count')::bigint = 2
  and (pg_temp.d1_json('history_replay_clean') ->> 'event_count')::bigint = 0,
  '[history-bearing replay fixture] isolated ledger must contain only its owner, invited seat, and rejected invitation'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('history_replay_clean') ->> 'member_role' = 'member'
  and pg_temp.d1_json('history_replay_clean') ->> 'member_status' = 'placeholder'
  and pg_temp.d1_json('history_replay_clean') ->> 'member_joined_at' is null
  and pg_temp.d1_json('history_replay_clean') ->> 'member_left_at' is null
  and pg_temp.d1_json('history_replay_clean') ->> 'member_removed_at' is null
  and pg_temp.d1_json('history_replay_clean') ->> 'member_deleted_at' is null,
  '[history-bearing replay fixture] assigned seat must be a live, never-joined placeholder'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('history_replay_clean') ->> 'identity_kind' = 'placeholder'
  and pg_temp.d1_json('history_replay_clean') ->> 'identity_auth_user_id' is null
  and pg_temp.d1_json('history_replay_clean') ->> 'identity_telegram_user_id' is null
  and pg_temp.d1_json('history_replay_clean') ->> 'identity_merged_into_identity_id' is null
  and pg_temp.d1_json('history_replay_clean') ->> 'identity_claimed_at' is null
  and pg_temp.d1_json('history_replay_clean') ->> 'identity_deleted_at' is null,
  '[history-bearing replay fixture] placeholder identity must otherwise be completely unclaimed'
);
select pg_temp.d1_assert(
  (pg_temp.d1_json('history_replay_clean') ->> 'seat_history_reference_count')::bigint = 0
  and jsonb_array_length(
    pg_temp.d1_json('history_replay_clean') #> '{ledger_history,entries}'
  ) = 0
  and jsonb_array_length(
    pg_temp.d1_json('history_replay_clean') #> '{ledger_history,lines}'
  ) = 0
  and jsonb_array_length(
    pg_temp.d1_json('history_replay_clean') #> '{ledger_history,events}'
  ) = 0
  and jsonb_array_length(
    pg_temp.d1_json('history_replay_clean') #> '{ledger_history,settlements}'
  ) = 0,
  '[history-bearing replay fixture] isolated rejected seat must be history-free before the disposable reference'
);

insert into public.shared_entries (
  id, ledger_id, payer_member_id, created_by_member_id, entry_type,
  title, total_amount_sen, client_entry_id, entry_date
) values (
  'd1000000-0000-4000-8000-000000000053'::uuid,
  pg_temp.d1_uuid('history_replay_ledger_id'),
  pg_temp.d1_uuid('history_replay_owner_member_id'),
  pg_temp.d1_uuid('history_replay_owner_member_id'),
  'expense', 'Synthetic rejected-seat history', 100,
  'd1000000-0000-4000-8000-000000000054'::uuid, current_date
);
insert into public.shared_entry_lines (
  id, entry_id, member_id, amount_sen, client_line_id
) values (
  'd1000000-0000-4000-8000-000000000055'::uuid,
  'd1000000-0000-4000-8000-000000000053'::uuid,
  pg_temp.d1_uuid('history_replay_member_id'), 100,
  'd1000000-0000-4000-8000-000000000056'::uuid
);
select pg_temp.d1_put(
  'history_replay_before',
  pg_temp.d1_replay_guard_snapshot(
    pg_temp.d1_uuid('history_replay_invitation_id')
  )
);
select pg_temp.d1_assert(
  (pg_temp.d1_json('history_replay_before') ->> 'seat_history_reference_count')::bigint = 1
  and jsonb_array_length(
    pg_temp.d1_json('history_replay_before') #> '{ledger_history,entries}'
  ) = 1
  and jsonb_array_length(
    pg_temp.d1_json('history_replay_before') #> '{ledger_history,lines}'
  ) = 1
  and exists (
    select 1
    from public.shared_entry_lines line
    where line.id = 'd1000000-0000-4000-8000-000000000055'::uuid
      and line.entry_id = 'd1000000-0000-4000-8000-000000000053'::uuid
      and line.member_id = pg_temp.d1_uuid('history_replay_member_id')
  ),
  '[history-bearing replay fixture] exact disposable entry and line must now be the sole failing history condition'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('history_replay_before') -> 'invitation_sha256'
    = pg_temp.d1_json('history_replay_clean') -> 'invitation_sha256'
  and pg_temp.d1_json('history_replay_before') -> 'member_sha256'
    = pg_temp.d1_json('history_replay_clean') -> 'member_sha256'
  and pg_temp.d1_json('history_replay_before') -> 'identity_sha256'
    = pg_temp.d1_json('history_replay_clean') -> 'identity_sha256'
  and pg_temp.d1_json('history_replay_before') -> 'ledger_sha256'
    = pg_temp.d1_json('history_replay_clean') -> 'ledger_sha256'
  and pg_temp.d1_json('history_replay_before') -> 'invitation_count'
    = pg_temp.d1_json('history_replay_clean') -> 'invitation_count'
  and pg_temp.d1_json('history_replay_before') -> 'member_count'
    = pg_temp.d1_json('history_replay_clean') -> 'member_count'
  and pg_temp.d1_json('history_replay_before') -> 'event_count'
    = pg_temp.d1_json('history_replay_clean') -> 'event_count',
  '[history-bearing replay fixture] adding history must leave every other replay precondition unchanged'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.d1_user('user_b')::text, true);
do $$
declare
  v_returned boolean := false;
  v_sqlstate text;
  v_message text;
begin
  begin
    perform public.reject_invitation('D1-HISTORY-REPLAY-20260711');
    v_returned := true;
  exception when others then
    v_sqlstate := sqlstate;
    v_message := sqlerrm;
  end;
  perform pg_temp.d1_assert(
    not v_returned
      and v_sqlstate = 'P0002'
      and v_message = 'invitation unavailable',
    '[history-bearing replay denial] same rejecting actor must receive only generic unavailable and no safe JSON result'
  );
end;
$$;
reset role;
select pg_temp.d1_put(
  'history_replay_after',
  pg_temp.d1_replay_guard_snapshot(
    pg_temp.d1_uuid('history_replay_invitation_id')
  )
);
select pg_temp.d1_assert(
  pg_temp.d1_json('history_replay_after') -> 'invitation_sha256'
    = pg_temp.d1_json('history_replay_before') -> 'invitation_sha256'
  and pg_temp.d1_json('history_replay_after') -> 'rejected_at'
    = pg_temp.d1_json('history_replay_before') -> 'rejected_at'
  and pg_temp.d1_json('history_replay_after') -> 'rejected_by_identity_id'
    = pg_temp.d1_json('history_replay_before') -> 'rejected_by_identity_id',
  '[history-bearing replay mutation] invitation and original rejection actor/timestamp must remain unchanged'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('history_replay_after') -> 'member_sha256'
    = pg_temp.d1_json('history_replay_before') -> 'member_sha256'
  and pg_temp.d1_json('history_replay_after') ->> 'member_status' = 'placeholder',
  '[history-bearing replay mutation] member seat must remain the exact unchanged placeholder'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('history_replay_after') -> 'identity_sha256'
    = pg_temp.d1_json('history_replay_before') -> 'identity_sha256',
  '[history-bearing replay mutation] placeholder identity must remain unchanged and unnormalized'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('history_replay_after') -> 'ledger_revision'
    = pg_temp.d1_json('history_replay_before') -> 'ledger_revision'
  and pg_temp.d1_json('history_replay_after') -> 'ledger_sha256'
    = pg_temp.d1_json('history_replay_before') -> 'ledger_sha256',
  '[history-bearing replay mutation] ledger revision and row must remain unchanged'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('history_replay_after') -> 'ledger_history'
    = pg_temp.d1_json('history_replay_before') -> 'ledger_history'
  and pg_temp.d1_json('history_replay_after') -> 'seat_history_reference_count'
    = pg_temp.d1_json('history_replay_before') -> 'seat_history_reference_count',
  '[history-bearing replay mutation] exact disposable history rows must remain unchanged'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('history_replay_after') -> 'invitation_count'
    = pg_temp.d1_json('history_replay_before') -> 'invitation_count'
  and pg_temp.d1_json('history_replay_after') -> 'member_count'
    = pg_temp.d1_json('history_replay_before') -> 'member_count'
  and pg_temp.d1_json('history_replay_after') -> 'event_count'
    = pg_temp.d1_json('history_replay_before') -> 'event_count'
  and (pg_temp.d1_json('history_replay_after') ->> 'event_count')::bigint = 0,
  '[history-bearing replay mutation] no invitation, member, or event row may be added or deleted'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('history_replay_after') = pg_temp.d1_json('history_replay_before'),
  '[history-bearing replay mutation] complete privileged before/after snapshots must match'
);
delete from public.shared_entry_lines
where id = 'd1000000-0000-4000-8000-000000000055'::uuid;
delete from public.shared_entries
where id = 'd1000000-0000-4000-8000-000000000053'::uuid;

-- Isolated reject-replay regression: a clearly fake Telegram linkage is the
-- only inconsistent placeholder-identity field. Replay must fail closed and
-- must not unlink, merge, claim, delete, or otherwise normalize the identity.
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.d1_user('user_a')::text, true);
select pg_temp.d1_put_uuid(
  'telegram_replay_ledger_id',
  public.create_shared_ledger(
    'group', 'D1 Telegram Replay Probe',
    'd1000000-0000-4000-8000-000000000060'::uuid,
    'd1000000-0000-4000-8000-000000000061'::uuid
  )
);
select pg_temp.d1_put_uuid(
  'telegram_replay_invitation_id',
  public.invite_member(
    pg_temp.d1_uuid('telegram_replay_ledger_id'),
    'Telegram Replay Seat', 'code',
    encode(extensions.digest(
      convert_to('D1-TELEGRAM-REPLAY-20260711', 'UTF8'), 'sha256'
    ), 'hex'),
    now() + interval '2 hours',
    'd1000000-0000-4000-8000-000000000062'::uuid
  )
);
select pg_temp.d1_put_uuid(
  'telegram_replay_member_id',
  (select invitation.member_id
   from public.invitations invitation
   where invitation.id = pg_temp.d1_uuid('telegram_replay_invitation_id'))
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.d1_user('user_b')::text, true);
select pg_temp.d1_assert(
  public.current_member_id(pg_temp.d1_uuid('telegram_replay_ledger_id')) is null,
  '[Telegram-linked replay fixture] B must be a non-member before rejecting the isolated invitation'
);
select pg_temp.d1_put(
  'telegram_replay_first_result',
  public.reject_invitation('D1-TELEGRAM-REPLAY-20260711')
);
reset role;
select pg_temp.d1_put(
  'telegram_replay_clean',
  pg_temp.d1_replay_guard_snapshot(
    pg_temp.d1_uuid('telegram_replay_invitation_id')
  )
);
select pg_temp.d1_assert(
  pg_temp.d1_json('telegram_replay_first_result')
    = jsonb_build_object('ok', true, 'invitation_status', 'rejected')
  and pg_temp.d1_json('telegram_replay_clean') ->> 'invitation_id'
    = pg_temp.d1_uuid('telegram_replay_invitation_id')::text
  and pg_temp.d1_json('telegram_replay_clean') ->> 'member_id'
    = pg_temp.d1_uuid('telegram_replay_member_id')::text
  and pg_temp.d1_json('telegram_replay_clean') ->> 'ledger_id'
    = pg_temp.d1_uuid('telegram_replay_ledger_id')::text
  and pg_temp.d1_json('telegram_replay_clean') ->> 'rejected_at' is not null
  and pg_temp.d1_json('telegram_replay_clean') ->> 'rejected_by_identity_id'
    = pg_temp.d1_uuid('reject_actor_identity_id')::text
  and pg_temp.d1_json('telegram_replay_clean') ->> 'consumed_at' is null
  and pg_temp.d1_json('telegram_replay_clean') ->> 'consumed_by_identity_id' is null
  and pg_temp.d1_json('telegram_replay_clean') ->> 'revoked_at' is null
  and (pg_temp.d1_json('telegram_replay_clean') ->> 'use_count')::integer = 0,
  '[Telegram-linked replay fixture] invitation must first be consistently rejected only by B'
);
select pg_temp.d1_assert(
  (pg_temp.d1_json('telegram_replay_clean') ->> 'invitation_count')::bigint = 1
  and (pg_temp.d1_json('telegram_replay_clean') ->> 'member_count')::bigint = 2
  and (pg_temp.d1_json('telegram_replay_clean') ->> 'event_count')::bigint = 0,
  '[Telegram-linked replay fixture] isolated ledger must contain only its owner, invited seat, and rejected invitation'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('telegram_replay_clean') ->> 'member_role' = 'member'
  and pg_temp.d1_json('telegram_replay_clean') ->> 'member_status' = 'placeholder'
  and pg_temp.d1_json('telegram_replay_clean') ->> 'member_joined_at' is null
  and pg_temp.d1_json('telegram_replay_clean') ->> 'member_left_at' is null
  and pg_temp.d1_json('telegram_replay_clean') ->> 'member_removed_at' is null
  and pg_temp.d1_json('telegram_replay_clean') ->> 'member_deleted_at' is null
  and pg_temp.d1_json('telegram_replay_clean') ->> 'identity_kind' = 'placeholder'
  and pg_temp.d1_json('telegram_replay_clean') ->> 'identity_auth_user_id' is null
  and pg_temp.d1_json('telegram_replay_clean') ->> 'identity_telegram_user_id' is null
  and pg_temp.d1_json('telegram_replay_clean') ->> 'identity_merged_into_identity_id' is null
  and pg_temp.d1_json('telegram_replay_clean') ->> 'identity_claimed_at' is null
  and pg_temp.d1_json('telegram_replay_clean') ->> 'identity_deleted_at' is null,
  '[Telegram-linked replay fixture] seat and identity must be completely unclaimed before fake linkage'
);
select pg_temp.d1_assert(
  (pg_temp.d1_json('telegram_replay_clean') ->> 'seat_history_reference_count')::bigint = 0
  and jsonb_array_length(
    pg_temp.d1_json('telegram_replay_clean') #> '{ledger_history,entries}'
  ) = 0
  and jsonb_array_length(
    pg_temp.d1_json('telegram_replay_clean') #> '{ledger_history,lines}'
  ) = 0
  and jsonb_array_length(
    pg_temp.d1_json('telegram_replay_clean') #> '{ledger_history,events}'
  ) = 0
  and jsonb_array_length(
    pg_temp.d1_json('telegram_replay_clean') #> '{ledger_history,settlements}'
  ) = 0,
  '[Telegram-linked replay fixture] isolated seat must have no shared, debt, event, settlement, or consumed-invitation history'
);

update public.identities identity
set telegram_user_id = (-900000000000000001)::bigint
where identity.id = (
  select member.identity_id
  from public.shared_ledger_members member
  where member.id = pg_temp.d1_uuid('telegram_replay_member_id')
);
select pg_temp.d1_put(
  'telegram_replay_before',
  pg_temp.d1_replay_guard_snapshot(
    pg_temp.d1_uuid('telegram_replay_invitation_id')
  )
);
select pg_temp.d1_assert(
  pg_temp.d1_json('telegram_replay_before') ->> 'identity_telegram_user_id'
    = '-900000000000000001'
  and pg_temp.d1_json('telegram_replay_before') ->> 'rejected_at' is not null
  and pg_temp.d1_json('telegram_replay_before') ->> 'rejected_by_identity_id'
    = pg_temp.d1_uuid('reject_actor_identity_id')::text
  and pg_temp.d1_json('telegram_replay_before') ->> 'consumed_at' is null
  and pg_temp.d1_json('telegram_replay_before') ->> 'consumed_by_identity_id' is null
  and pg_temp.d1_json('telegram_replay_before') ->> 'revoked_at' is null
  and (pg_temp.d1_json('telegram_replay_before') ->> 'use_count')::integer = 0
  and pg_temp.d1_json('telegram_replay_before') ->> 'member_role' = 'member'
  and pg_temp.d1_json('telegram_replay_before') ->> 'member_status' = 'placeholder'
  and pg_temp.d1_json('telegram_replay_before') ->> 'member_joined_at' is null
  and pg_temp.d1_json('telegram_replay_before') ->> 'member_left_at' is null
  and pg_temp.d1_json('telegram_replay_before') ->> 'member_removed_at' is null
  and pg_temp.d1_json('telegram_replay_before') ->> 'member_deleted_at' is null
  and pg_temp.d1_json('telegram_replay_before') ->> 'identity_kind' = 'placeholder'
  and pg_temp.d1_json('telegram_replay_before') ->> 'identity_auth_user_id' is null
  and pg_temp.d1_json('telegram_replay_before') ->> 'identity_merged_into_identity_id' is null
  and pg_temp.d1_json('telegram_replay_before') ->> 'identity_claimed_at' is null
  and pg_temp.d1_json('telegram_replay_before') ->> 'identity_deleted_at' is null
  and (pg_temp.d1_json('telegram_replay_before') ->> 'seat_history_reference_count')::bigint = 0
  and pg_temp.d1_json('telegram_replay_before') -> 'invitation_sha256'
    = pg_temp.d1_json('telegram_replay_clean') -> 'invitation_sha256'
  and pg_temp.d1_json('telegram_replay_before') -> 'member_sha256'
    = pg_temp.d1_json('telegram_replay_clean') -> 'member_sha256'
  and pg_temp.d1_json('telegram_replay_before') -> 'ledger_sha256'
    = pg_temp.d1_json('telegram_replay_clean') -> 'ledger_sha256'
  and pg_temp.d1_json('telegram_replay_before') -> 'ledger_history'
    = pg_temp.d1_json('telegram_replay_clean') -> 'ledger_history',
  '[Telegram-linked replay fixture] fake Telegram ID must be the only failed replay invariant'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.d1_user('user_b')::text, true);
do $$
declare
  v_returned boolean := false;
  v_sqlstate text;
  v_message text;
begin
  begin
    perform public.reject_invitation('D1-TELEGRAM-REPLAY-20260711');
    v_returned := true;
  exception when others then
    v_sqlstate := sqlstate;
    v_message := sqlerrm;
  end;
  perform pg_temp.d1_assert(
    not v_returned
      and v_sqlstate = 'P0002'
      and v_message = 'invitation unavailable',
    '[Telegram-linked replay denial] same rejecting actor must receive only generic unavailable and zero result'
  );
end;
$$;
reset role;
select pg_temp.d1_put(
  'telegram_replay_after',
  pg_temp.d1_replay_guard_snapshot(
    pg_temp.d1_uuid('telegram_replay_invitation_id')
  )
);
select pg_temp.d1_assert(
  pg_temp.d1_json('telegram_replay_after') -> 'invitation_sha256'
    = pg_temp.d1_json('telegram_replay_before') -> 'invitation_sha256'
  and pg_temp.d1_json('telegram_replay_after') -> 'rejected_at'
    = pg_temp.d1_json('telegram_replay_before') -> 'rejected_at'
  and pg_temp.d1_json('telegram_replay_after') -> 'rejected_by_identity_id'
    = pg_temp.d1_json('telegram_replay_before') -> 'rejected_by_identity_id',
  '[Telegram-linked replay mutation] invitation and original rejection actor/timestamp must remain unchanged'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('telegram_replay_after') -> 'member_sha256'
    = pg_temp.d1_json('telegram_replay_before') -> 'member_sha256'
  and pg_temp.d1_json('telegram_replay_after') ->> 'member_status' = 'placeholder',
  '[Telegram-linked replay mutation] member seat must remain unchanged'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('telegram_replay_after') -> 'identity_sha256'
    = pg_temp.d1_json('telegram_replay_before') -> 'identity_sha256'
  and pg_temp.d1_json('telegram_replay_after') ->> 'identity_telegram_user_id'
    = '-900000000000000001',
  '[Telegram-linked replay mutation] fake Telegram ID and exact identity row must remain unchanged'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('telegram_replay_after') -> 'ledger_revision'
    = pg_temp.d1_json('telegram_replay_before') -> 'ledger_revision'
  and pg_temp.d1_json('telegram_replay_after') -> 'ledger_sha256'
    = pg_temp.d1_json('telegram_replay_before') -> 'ledger_sha256',
  '[Telegram-linked replay mutation] ledger revision and row must remain unchanged'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('telegram_replay_after') -> 'invitation_count'
    = pg_temp.d1_json('telegram_replay_before') -> 'invitation_count'
  and pg_temp.d1_json('telegram_replay_after') -> 'member_count'
    = pg_temp.d1_json('telegram_replay_before') -> 'member_count'
  and pg_temp.d1_json('telegram_replay_after') -> 'event_count'
    = pg_temp.d1_json('telegram_replay_before') -> 'event_count'
  and (pg_temp.d1_json('telegram_replay_after') ->> 'event_count')::bigint = 0
  and pg_temp.d1_json('telegram_replay_after') -> 'ledger_history'
    = pg_temp.d1_json('telegram_replay_before') -> 'ledger_history',
  '[Telegram-linked replay mutation] no rows, events, history, deletion, or normalization may occur'
);
select pg_temp.d1_assert(
  pg_temp.d1_json('telegram_replay_after') = pg_temp.d1_json('telegram_replay_before'),
  '[Telegram-linked replay mutation] complete privileged before/after snapshots must match'
);

-- Terminal combinations are rejected at the table constraint boundary.
do $$
declare v_denied boolean := false;
begin
  begin
    update public.invitations
    set revoked_at = now()
    where id = pg_temp.d1_uuid('reject_invitation_id');
  exception when check_violation then v_denied := true;
  end;
  perform pg_temp.d1_assert(v_denied, '[check-constraint denial] rejected and revoked terminal states cannot coexist');
end;
$$;

select pg_temp.d1_assert(
  not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name in ('shared_ledgers', 'shared_ledger_members', 'invitations')
      and lower(replace(c.column_name, '_', '')) in (
        'accountsnapshot', 'accountid', 'accountname', 'cardid', 'cardname',
        'walletid', 'walletname', 'balance', 'payid', 'payname'
      )
  ),
  '[privacy assertion] shared invitation/member schema contains no private account snapshot metadata'
);
select pg_temp.d1_assert(
  not exists (
    select 1
    from (values
      (pg_temp.d1_json('pair_inspection')),
      (pg_temp.d1_json('revoke_result')),
      (pg_temp.d1_json('reinvite_result')),
      (pg_temp.d1_json('remove_result'))
    ) payloads(payload)
    cross join lateral jsonb_object_keys(payloads.payload) as keys(key_name)
    where lower(replace(key_name, '_', '')) in (
      'accountsnapshot', 'accountid', 'accountname', 'cardid', 'cardname',
      'walletid', 'walletname', 'bankaccount', 'iban', 'balance',
      'payid', 'payname', 'last4', 'paymentmethod'
    )
  ),
  '[privacy assertion] D1 shared RPC payloads expose no App account/payment fields'
);
select pg_temp.d1_assert(
  pg_temp.d1_protected_snapshot() = pg_temp.d1_json('protected_snapshot_before'),
  '[mutation assertion] D1 RPCs leave protected private/financial rows byte-content-equivalent after disposable fixture cleanup'
);
select pg_temp.d1_assert(
  (select count(*) = 1 from public.shared_ledger_members m
   where m.ledger_id = pg_temp.d1_uuid('pair_ledger_id')
     and m.id = pg_temp.d1_uuid('pair_b_member_id')
     and m.status = 'active'),
  '[concurrency assertion] replay/race checks leave exactly one winning active B seat'
);
select pg_temp.d1_assert(
  position('for update' in lower(pg_get_functiondef(
    'public.accept_invitation(text)'::regprocedure
  ))) > 0
  and position('for update' in lower(pg_get_functiondef(
    'public.reject_invitation(text)'::regprocedure
  ))) > 0
  and position('for update' in lower(pg_get_functiondef(
    'public.revoke_invitation(uuid,bigint)'::regprocedure
  ))) > 0
  and position('for update' in lower(pg_get_functiondef(
    'public.create_member_invitation(uuid,uuid,text,text,timestamptz,uuid,bigint)'::regprocedure
  ))) > 0
  and position('for update' in lower(pg_get_functiondef(
    'public.remove_unclaimed_member(uuid,uuid,bigint)'::regprocedure
  ))) > 0,
  '[concurrency assertion] every mutation RPC must retain explicit row locks'
);

do $$
begin
  raise notice 'Phase 24D-D1 Dashboard invitation/membership probe passed; all fixture writes rolled back.';
end;
$$;

rollback;
