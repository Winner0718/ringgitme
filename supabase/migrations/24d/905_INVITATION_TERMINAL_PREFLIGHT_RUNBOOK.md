# Phase 24D-D1 legacy terminal-state preflight runbook

Disposable pre-migration scratch project only. This deliberately creates a row
that was valid under `001` but is rejected by `005`. Never run it in production.
Start from a fresh scratch project with `001` through `004` applied, `005` not
applied, and fake Auth user A
`ce6132fb-58ef-458a-977e-f802abf672c8` present.

The test has two goals:

1. a legacy `consumed_at + revoked_at` row stops `005` at its fail-loud
   preflight before the stronger terminal CHECK is installed; and
2. the failed migration does not rewrite either timestamp.

All code values and UUIDs below are synthetic scratch fixtures.

## 1. Create one legacy-conflict fixture (Role postgres)

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'ce6132fb-58ef-458a-977e-f802abf672c8', true);
select public.create_shared_ledger(
  'group', 'D1 preflight conflict fixture',
  'd1cc0000-0000-4000-8000-000000000001',
  'd1cc0000-0000-4000-8000-000000000002'
);
select public.invite_member(
  (select l.id from public.shared_ledgers l
   where l.created_by = auth.uid()
     and l.client_ledger_id = 'd1cc0000-0000-4000-8000-000000000001'),
  'Legacy conflict seat', 'code',
  encode(extensions.digest(convert_to('D1-SYNTHETIC-PREFLIGHT-CONFLICT-20260711', 'UTF8'), 'sha256'), 'hex'),
  now() + interval '2 hours',
  'd1cc0000-0000-4000-8000-000000000003'
);
commit;

create table public.d1_preflight_snapshot (
  invitation_id uuid primary key,
  consumed_at timestamptz not null,
  revoked_at timestamptz not null
);

update public.invitations i
set consumed_by_identity_id = (
      select identity.id from public.identities identity
      where identity.auth_user_id = 'ce6132fb-58ef-458a-977e-f802abf672c8'
        and identity.kind = 'app_user'
        and identity.merged_into_identity_id is null
        and identity.deleted_at is null
    ),
    consumed_at = now(),
    revoked_at = now(),
    use_count = 1
where i.ledger_id = (
  select l.id from public.shared_ledgers l
  where l.created_by = 'ce6132fb-58ef-458a-977e-f802abf672c8'
    and l.client_ledger_id = 'd1cc0000-0000-4000-8000-000000000001'
);

insert into public.d1_preflight_snapshot (
  invitation_id, consumed_at, revoked_at
)
select i.id, i.consumed_at, i.revoked_at
from public.invitations i
where i.ledger_id = (
  select l.id from public.shared_ledgers l
  where l.created_by = 'ce6132fb-58ef-458a-977e-f802abf672c8'
    and l.client_ledger_id = 'd1cc0000-0000-4000-8000-000000000001'
);

do $$
begin
  if (select count(*) from public.d1_preflight_snapshot) <> 1 then
    raise exception 'PREFLIGHT FIXTURE FAILED: expected exactly one conflict row';
  end if;
end;
$$;
```

The snapshot stores only a safe invitation UUID and its two terminal
timestamps. It never stores or displays the invitation digest or raw code.

## 2. Prove 005 stops and reports the safe ID

In one Dashboard submission, paste `begin;`, then the complete current contents
of `005_shared_invitations_membership.sql`, then `commit;`. Use Role `postgres`.
Do not omit the outer transaction for this negative test.

Expected result: SQLSTATE `23514` and a message beginning:

```text
Phase 24D-D1 terminal-state preflight failed: 1 conflicting invitation row(s)
```

The message must include only the safe invitation UUID (up to 20 IDs), the
count, and the remediation instruction. It must not contain `code_hash` or any
raw bearer value. The statement that adds
`invitations_terminal_state_ck` must not run.

Because the transaction is now aborted, run:

```sql
rollback;
```

Then verify the attempted migration made no schema or history change:

```sql
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'invitations'
      and column_name in ('rejected_at', 'rejected_by_identity_id')
  ) then
    raise exception 'PREFLIGHT VERIFY FAILED: failed 005 left additive columns behind';
  end if;

  if exists (
    select 1
    from public.d1_preflight_snapshot s
    join public.invitations i on i.id = s.invitation_id
    where i.consumed_at is distinct from s.consumed_at
       or i.revoked_at is distinct from s.revoked_at
  ) then
    raise exception 'PREFLIGHT VERIFY FAILED: legacy history was rewritten';
  end if;

  raise notice 'Conflict path passed: 005 stopped before the CHECK and rewrote no history.';
end;
$$;
```

Constraints are catalog objects rather than relations, so verify the missing
CHECK through `pg_constraint`:

```sql
do $$
begin
  if exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.invitations'::regclass
      and c.conname = 'invitations_terminal_state_ck'
  ) then
    raise exception 'PREFLIGHT VERIFY FAILED: terminal constraint unexpectedly exists';
  end if;
end;
$$;
```

## 3. Prove clean data allows the constraint

This next update is an explicit test-fixture cleanup, not an approved production
history-remediation policy. It is intentionally separate from `005`, proving
that the migration itself performs no rewrite.

```sql
update public.invitations i
set revoked_at = null
from public.d1_preflight_snapshot s
where i.id = s.invitation_id;

do $$
begin
  if exists (
    select 1 from public.invitations i
    where num_nonnulls(i.consumed_at, i.revoked_at) > 1
  ) then
    raise exception 'CLEAN PREFLIGHT FAILED: conflict remains';
  end if;
end;
$$;
```

Now submit `begin;`, the complete current `005` file, and `commit;` as Role
`postgres`. It should complete. Verify:

```sql
do $$
begin
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.invitations'::regclass
      and c.conname = 'invitations_terminal_state_ck'
      and c.convalidated
  ) then
    raise exception 'CLEAN PREFLIGHT FAILED: validated terminal CHECK missing';
  end if;

  if exists (
    select 1
    from public.d1_preflight_snapshot s
    join public.invitations i on i.id = s.invitation_id
    where i.consumed_at is distinct from s.consumed_at
  ) then
    raise exception 'CLEAN PREFLIGHT FAILED: consumed history changed';
  end if;

  raise notice 'Clean path passed: terminal CHECK installed and retained consumed history.';
end;
$$;
```

## Cleanup

Discard the disposable project. Alternatively, only if it contains no retained
data, review and run `999_rollback.sql`; then drop the scratch-only snapshot
table if it remains:

```sql
drop table if exists public.d1_preflight_snapshot;
```

Production deployment requires a clean preflight with zero conflicts. Any real
conflict requires a separately reviewed, history-preserving remediation; do not
reuse this scratch-only timestamp-clearing step.
