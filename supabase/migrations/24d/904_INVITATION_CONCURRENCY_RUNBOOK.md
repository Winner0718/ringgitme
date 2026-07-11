# Phase 24D-D1 invitation concurrency runbook

Disposable scratch project only. Do not run this against production or any
project containing data that must be retained. Apply `001` through `005`
first, and create the four fake Auth users used by probe 903:

- A: `ce6132fb-58ef-458a-977e-f802abf672c8`
- B: `f33e1515-1310-44ac-a53f-39b8a009a86f`
- C: `dc944eb9-3f1c-4838-8a25-969878a8e36c`
- D: `aff71c66-0d14-49d8-845d-2ec0bb0c3ad9`

All code strings are synthetic scratch fixtures, not real invitation secrets.
Open two Dashboard SQL Editor session tabs. Run setup once as Role `postgres`,
then run each race independently. Start Session B while Session A is inside its
ten-second hold. `pg_sleep` only holds Session A's canonical row locks so the
second call waits behind them.

## Transaction and error protocol

Each session script deliberately shows `BEGIN`, `SET LOCAL role`, local claims,
the RPC call, and the successful `COMMIT`. Execute only through the RPC call
first. If it succeeds, continue to `COMMIT`. If it raises an expected loser
error, do **not** execute `COMMIT`; immediately execute the shown `ROLLBACK` in
that same tab. PostgreSQL marks the transaction aborted after any uncaught SQL
error, so `ROLLBACK` is mandatory before that SQL Editor tab can be reused.

Classify every losing result before continuing:

- an expected state-machine loser has the exact SQLSTATE and message documented
  for that race, followed by a successful `ROLLBACK`;
- SQLSTATE `40P01` is a deadlock and fails the test;
- any other SQLSTATE/message is an unexpected SQL failure and fails the test.

After a deadlock or unexpected error, still run `ROLLBACK` in the affected tab.
Never treat a deadlock as an acceptable loser outcome.

## One-time setup (Role postgres)

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f33e1515-1310-44ac-a53f-39b8a009a86f', true);
select public.bootstrap_current_user_identity('Race B', null, 'en-MY');
select set_config('request.jwt.claim.sub', 'dc944eb9-3f1c-4838-8a25-969878a8e36c', true);
select public.bootstrap_current_user_identity('Race C', null, 'en-MY');
select set_config('request.jwt.claim.sub', 'ce6132fb-58ef-458a-977e-f802abf672c8', true);

select public.create_shared_ledger(
  'group', 'Race accept accept',
  'd1aa0000-0000-4000-8000-000000000100',
  'd1aa0000-0000-4000-8000-000000000101'
);
select public.invite_member(
  (select id from public.shared_ledgers
   where created_by = auth.uid()
     and client_ledger_id = 'd1aa0000-0000-4000-8000-000000000100'),
  'Race seat AA', 'code',
  encode(extensions.digest(convert_to('D1-RACE-ACCEPT-ACCEPT-20260711', 'UTF8'), 'sha256'), 'hex'),
  now() + interval '2 hours',
  'd1aa0000-0000-4000-8000-000000000102'
);

select public.create_shared_ledger(
  'group', 'Race first identity accept reject',
  'd1aa0000-0000-4000-8000-000000000200',
  'd1aa0000-0000-4000-8000-000000000201'
);
select public.invite_member(
  (select id from public.shared_ledgers
   where created_by = auth.uid()
     and client_ledger_id = 'd1aa0000-0000-4000-8000-000000000200'),
  'Race seat first identity', 'code',
  encode(extensions.digest(convert_to('D1-RACE-FIRST-IDENTITY-20260711', 'UTF8'), 'sha256'), 'hex'),
  now() + interval '2 hours',
  'd1aa0000-0000-4000-8000-000000000202'
);

select public.create_shared_ledger(
  'group', 'Race accept revoke',
  'd1aa0000-0000-4000-8000-000000000300',
  'd1aa0000-0000-4000-8000-000000000301'
);
select public.invite_member(
  (select id from public.shared_ledgers
   where created_by = auth.uid()
     and client_ledger_id = 'd1aa0000-0000-4000-8000-000000000300'),
  'Race seat revoke', 'code',
  encode(extensions.digest(convert_to('D1-RACE-ACCEPT-REVOKE-20260711', 'UTF8'), 'sha256'), 'hex'),
  now() + interval '2 hours',
  'd1aa0000-0000-4000-8000-000000000302'
);

select public.create_shared_ledger(
  'group', 'Race accept remove',
  'd1aa0000-0000-4000-8000-000000000400',
  'd1aa0000-0000-4000-8000-000000000401'
);
select public.invite_member(
  (select id from public.shared_ledgers
   where created_by = auth.uid()
     and client_ledger_id = 'd1aa0000-0000-4000-8000-000000000400'),
  'Race seat remove', 'code',
  encode(extensions.digest(convert_to('D1-RACE-ACCEPT-REMOVE-20260711', 'UTF8'), 'sha256'), 'hex'),
  now() + interval '2 hours',
  'd1aa0000-0000-4000-8000-000000000402'
);
commit;

do $$
declare v_bad integer;
begin
  if exists (
    select 1 from public.identities
    where auth_user_id = 'aff71c66-0d14-49d8-845d-2ec0bb0c3ad9'
      and merged_into_identity_id is null and deleted_at is null
  ) then
    raise exception 'RACE SETUP FAILED: D must have no active identity';
  end if;

  select count(*) into v_bad
  from public.invitations i
  join public.shared_ledgers l on l.id = i.ledger_id
  join public.shared_ledger_members m on m.id = i.member_id
  where l.client_ledger_id in (
    'd1aa0000-0000-4000-8000-000000000100',
    'd1aa0000-0000-4000-8000-000000000200',
    'd1aa0000-0000-4000-8000-000000000300',
    'd1aa0000-0000-4000-8000-000000000400'
  )
    and i.consumed_at is null and i.rejected_at is null
    and i.revoked_at is null and i.expires_at > now()
    and i.use_count = 0 and l.status = 'active' and l.deleted_at is null
    and m.role = 'member' and m.status = 'invited' and m.deleted_at is null;
  if v_bad <> 4 then
    raise exception 'RACE SETUP FAILED: found % initially open race invitations, expected four', v_bad;
  end if;
end;
$$;
```

If setup errors, run `ROLLBACK;` before reusing the setup tab.

## Race 1: B and C accept the same invitation

Session A (B, intended winner):

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f33e1515-1310-44ac-a53f-39b8a009a86f', true);
select public.accept_invitation('D1-RACE-ACCEPT-ACCEPT-20260711');
select pg_sleep(10);
commit; -- run only after the RPC succeeds
-- If any statement errors, run instead: rollback;
```

Session B (C, start during the sleep):

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'dc944eb9-3f1c-4838-8a25-969878a8e36c', true);
select public.accept_invitation('D1-RACE-ACCEPT-ACCEPT-20260711');
commit; -- run only if the RPC succeeds
-- Expected loser or any other error: run instead, immediately: rollback;
```

Expected accept-first loser: SQLSTATE `23514`, message
`invitation already consumed`. Session B must then run `ROLLBACK`. A `40P01`
or any different error fails the test.

## Race 2: first-time D accepts versus rejects

At setup, D is authenticated but has no identity and is not a member of the
target ledger. Both RPC calls use D's same authenticated, initially non-member
actor; concurrent `ensure_current_identity()` calls must converge on one active
`app_user` identity.

Session A (accept candidate):

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aff71c66-0d14-49d8-845d-2ec0bb0c3ad9', true);
select public.accept_invitation('D1-RACE-FIRST-IDENTITY-20260711');
select pg_sleep(10);
commit; -- run only after the RPC succeeds
-- If the RPC loses/errors, run instead, immediately: rollback;
```

Session B (reject candidate, start during the sleep):

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aff71c66-0d14-49d8-845d-2ec0bb0c3ad9', true);
select public.reject_invitation('D1-RACE-FIRST-IDENTITY-20260711');
commit; -- run only if the RPC succeeds
-- If the RPC loses/errors, run instead, immediately: rollback;
```

Exactly two terminal outcomes are valid:

1. Accept wins (the schedule above): the invitation is consumed, the assigned
   member is active, and reject loses with SQLSTATE `42501`, message
   `active members must use owner revocation`. This is the actual guard order
   in 005; do not expect `invitation already consumed`. Roll back Session B.
2. Reject wins (reverse the launch order on a freshly rebuilt Race 2 fixture):
   the invitation is rejected, the assigned member returns/remains
   `placeholder`, and accept loses with SQLSTATE `23514`, message
   `invitation rejected`. Roll back the losing accept transaction.

Consumed plus rejected is never valid. `40P01` or any other SQL failure fails
the test. Do not try both launch orders against the same terminal fixture;
rebuild the disposable scratch fixture between schedules.

## Race 3: B accepts versus owner A revokes

Session A (B, intended winner):

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f33e1515-1310-44ac-a53f-39b8a009a86f', true);
select public.accept_invitation('D1-RACE-ACCEPT-REVOKE-20260711');
select pg_sleep(10);
commit; -- run only after the RPC succeeds
-- If any statement errors, run instead: rollback;
```

Session B (owner A, start during the sleep):

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'ce6132fb-58ef-458a-977e-f802abf672c8', true);
select public.revoke_invitation(
  (select i.id
   from public.invitations i
   join public.shared_ledgers l on l.id = i.ledger_id
   where l.created_by = auth.uid()
     and l.client_ledger_id = 'd1aa0000-0000-4000-8000-000000000300'),
  1
);
commit; -- run only if the RPC succeeds
-- Expected loser or any other error: run instead, immediately: rollback;
```

Expected accept-first loser: SQLSTATE `23514`, message
`consumed invitation cannot be revoked`. Session B must then run `ROLLBACK`.
A `40P01` or any different error fails the test.

## Race 4: B accepts versus owner A removes the unclaimed seat

Session A (B, intended winner):

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f33e1515-1310-44ac-a53f-39b8a009a86f', true);
select public.accept_invitation('D1-RACE-ACCEPT-REMOVE-20260711');
select pg_sleep(10);
commit; -- run only after the RPC succeeds
-- If any statement errors, run instead: rollback;
```

Session B (owner A, start during the sleep):

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'ce6132fb-58ef-458a-977e-f802abf672c8', true);
select public.remove_unclaimed_member(
  (select l.id from public.shared_ledgers l
   where l.created_by = auth.uid()
     and l.client_ledger_id = 'd1aa0000-0000-4000-8000-000000000400'),
  (select m.id
   from public.shared_ledger_members m
   where m.client_member_id = 'd1aa0000-0000-4000-8000-000000000402'),
  1
);
commit; -- run only if the RPC succeeds
-- Expected loser or any other error: run instead, immediately: rollback;
```

Expected accept-first loser: SQLSTATE `23514`, message
`only an unclaimed member seat can be removed`. Session B must then run
`ROLLBACK`. A `40P01` or any different error fails the test.

## Fresh-tab verification (Role postgres)

First run `ROLLBACK;` in both race tabs. It is safe if a tab has no open
transaction and guarantees an expected-error tab is no longer aborted. Then
open a fresh Dashboard query/tab with Role `postgres` and run verification.
Do not verify from either race session.

The query accepts either valid Race 2 winner while requiring the accept-first
result for Races 1, 3 and 4. It asserts one terminal state per invitation, no
consumed+rejected combination, at most one active member for each tested seat,
and one converged active identity/no double claim for D.

```sql
do $$
declare
  v_bad integer;
  v_d_identity_id uuid;
begin
  select count(*) into v_bad
  from public.invitations i
  join public.shared_ledgers l on l.id = i.ledger_id
  where l.client_ledger_id in (
    'd1aa0000-0000-4000-8000-000000000100',
    'd1aa0000-0000-4000-8000-000000000200',
    'd1aa0000-0000-4000-8000-000000000300',
    'd1aa0000-0000-4000-8000-000000000400'
  );
  if v_bad <> 4 then
    raise exception 'RACE VERIFY FAILED: found % tested invitations, expected exactly four', v_bad;
  end if;

  select count(*) into v_bad
  from public.invitations i
  join public.shared_ledgers l on l.id = i.ledger_id
  where l.client_ledger_id in (
    'd1aa0000-0000-4000-8000-000000000100',
    'd1aa0000-0000-4000-8000-000000000200',
    'd1aa0000-0000-4000-8000-000000000300',
    'd1aa0000-0000-4000-8000-000000000400'
  )
    and (
      num_nonnulls(i.consumed_at, i.rejected_at, i.revoked_at) <> 1
      or (i.consumed_at is not null and i.rejected_at is not null)
      or (i.consumed_at is not null and (i.use_count <> 1 or i.consumed_by_identity_id is null))
      or (i.rejected_at is not null and (i.use_count <> 0 or i.rejected_by_identity_id is null))
    );
  if v_bad <> 0 then
    raise exception 'RACE VERIFY FAILED: % invitation(s) have invalid terminal state', v_bad;
  end if;

  select count(*) into v_bad
  from public.shared_ledgers l
  where l.client_ledger_id in (
    'd1aa0000-0000-4000-8000-000000000100',
    'd1aa0000-0000-4000-8000-000000000200',
    'd1aa0000-0000-4000-8000-000000000300',
    'd1aa0000-0000-4000-8000-000000000400'
  )
    and (select count(*) from public.shared_ledger_members m
         where m.ledger_id = l.id and m.role = 'member'
           and m.status = 'active' and m.deleted_at is null) > 1;
  if v_bad <> 0 then
    raise exception 'RACE VERIFY FAILED: % ledger(s) have multiple active members for the tested seat', v_bad;
  end if;

  -- Races 1, 3 and 4 use the documented accept-first schedule.
  select count(*) into v_bad
  from public.shared_ledgers l
  where l.client_ledger_id in (
    'd1aa0000-0000-4000-8000-000000000100',
    'd1aa0000-0000-4000-8000-000000000300',
    'd1aa0000-0000-4000-8000-000000000400'
  )
    and not exists (
      select 1 from public.invitations i
      join public.shared_ledger_members m on m.id = i.member_id
      where i.ledger_id = l.id and i.consumed_at is not null
        and i.rejected_at is null and i.revoked_at is null
        and i.use_count = 1 and m.status = 'active' and m.deleted_at is null
    );
  if v_bad <> 0 then
    raise exception 'RACE VERIFY FAILED: % accept-first race(s) lack the accepted terminal outcome', v_bad;
  end if;

  -- Race 2 permits exactly one of the approved accept/reject outcomes.
  select count(*) into v_bad
  from public.invitations i
  join public.shared_ledgers l on l.id = i.ledger_id
  join public.shared_ledger_members m on m.id = i.member_id
  where l.client_ledger_id = 'd1aa0000-0000-4000-8000-000000000200'
    and not (
      (i.consumed_at is not null and i.rejected_at is null
       and i.revoked_at is null and i.use_count = 1
       and m.status = 'active' and m.deleted_at is null)
      or
      (i.consumed_at is null and i.rejected_at is not null
       and i.revoked_at is null and i.use_count = 0
       and m.status = 'placeholder' and m.deleted_at is null)
    );
  if v_bad <> 0 then
    raise exception 'RACE VERIFY FAILED: Race 2 is not in one approved terminal outcome';
  end if;

  select count(*) into v_bad
  from public.identities
  where auth_user_id = 'aff71c66-0d14-49d8-845d-2ec0bb0c3ad9'
    and kind = 'app_user' and merged_into_identity_id is null
    and deleted_at is null;
  if v_bad <> 1 then
    raise exception 'RACE VERIFY FAILED: D has % active app_user identities, expected exactly one', v_bad;
  end if;
  select id into strict v_d_identity_id
  from public.identities
  where auth_user_id = 'aff71c66-0d14-49d8-845d-2ec0bb0c3ad9'
    and kind = 'app_user' and merged_into_identity_id is null
    and deleted_at is null;

  select count(*) into v_bad
  from public.shared_ledger_members m
  join public.shared_ledgers l on l.id = m.ledger_id
  where l.client_ledger_id = 'd1aa0000-0000-4000-8000-000000000200'
    and m.identity_id = v_d_identity_id
    and m.status in ('invited', 'active') and m.deleted_at is null;
  if v_bad > 1 then
    raise exception 'RACE VERIFY FAILED: D identity was claimed by % live seats', v_bad;
  end if;

  raise notice 'Phase 24D-D1 race state verification passed. Confirm both race tabs show no 40P01 or unexpected SQL error and every losing tab completed ROLLBACK.';
end;
$$;
```

The database query cannot retrospectively prove a client received no deadlock
or that an operator issued `ROLLBACK`; verify both facts in the two session
tabs. A loser tab still showing an aborted transaction means the test cleanup
is incomplete.

## Cleanup

These commands are valid regardless of which session won:

```sql
-- Run once in each race tab before closing or reusing it.
rollback;
reset role;
```

Do not attempt ad-hoc row deletion because restrictive history foreign keys are
intentional. Discard the disposable scratch project. Alternatively, only in a
dedicated scratch project containing no retained data, open a fresh Role
`postgres` tab, review and run the complete `999_rollback.sql`, then rebuild
from `001`. No race SQL is a production migration.
