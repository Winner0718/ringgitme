-- Phase 24D-D1: shared-ledger invitation and unclaimed-member lifecycle.
-- Additive to 001-004. Raw invitation bearer codes are accepted only by the
-- inspect/accept/reject boundary and hashed immediately. These functions do
-- not store, return, or explicitly log raw codes or write them to events.
-- Operational request/bind/client logging still requires separate review.
--
-- VERSIONED ONE-SHOT MIGRATION: this file is intentionally not rerunnable.
-- After an uncertain partial failure, inspect migration history and object
-- state; use the reviewed rollback or a separately reviewed repair migration.

alter table public.invitations
  add column rejected_at timestamptz,
  add column rejected_by_identity_id uuid
    references public.identities(id) on delete restrict;

-- 001 allowed a legacy row to have both consumed_at and revoked_at. Do not
-- rewrite that history silently. Production deployment requires zero rows
-- with multiple terminal timestamps before the stronger CHECK is installed.
do $preflight$
declare
  v_conflict_count bigint;
  v_conflict_ids text;
begin
  select count(*)
  into v_conflict_count
  from public.invitations i
  where num_nonnulls(i.consumed_at, i.rejected_at, i.revoked_at) > 1;

  if v_conflict_count > 0 then
    select string_agg(c.id::text, ', ' order by c.id)
    into v_conflict_ids
    from (
      select i.id
      from public.invitations i
      where num_nonnulls(i.consumed_at, i.rejected_at, i.revoked_at) > 1
      order by i.id
      limit 20
    ) c;

    raise exception using
      errcode = '23514',
      message = format(
        'Phase 24D-D1 terminal-state preflight failed: %s conflicting invitation row(s); safe invitation IDs (up to 20): %s. Stop deployment, review each row, and apply an approved history-preserving remediation before retrying this versioned migration.',
        v_conflict_count,
        coalesce(v_conflict_ids, '(none)')
      );
  end if;
end;
$preflight$;

alter table public.invitations
  add constraint invitations_rejection_actor_ck
    check ((rejected_at is null) = (rejected_by_identity_id is null)),
  add constraint invitations_rejected_time_ck
    check (rejected_at is null or rejected_at >= created_at),
  add constraint invitations_terminal_state_ck
    check (num_nonnulls(consumed_at, rejected_at, revoked_at) <= 1);

drop index public.invitations_open_code_hash_uidx;
create unique index invitations_open_code_hash_uidx
  on public.invitations(code_hash)
  where consumed_at is null
    and revoked_at is null
    and rejected_at is null;

create index invitations_active_member_lookup_idx
  on public.invitations(ledger_id, member_id, expires_at desc, created_at desc)
  where consumed_at is null
    and revoked_at is null
    and rejected_at is null;

create index invitations_rejected_by_idx
  on public.invitations(rejected_by_identity_id, rejected_at desc)
  where rejected_by_identity_id is not null;

-- Owners may see that an invitation was rejected through the existing
-- creator/owner RLS policy. The rejecting identity remains RPC-private.
grant select (rejected_at) on table public.invitations to authenticated;

create or replace function public.inspect_invitation(p_raw_code text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_raw_code text;
  v_code_hash text;
  v_identity_id uuid;
  v_ledger_kind text;
  v_ledger_title text;
  v_inviter_name text;
  v_assigned_member_name text;
  v_expires_at timestamptz;
  v_member_id uuid;
  v_ledger_id uuid;
  v_can_accept boolean;
begin
  perform public.require_authenticated_user();
  v_raw_code := btrim(p_raw_code);
  if v_raw_code is null or length(v_raw_code) not between 16 and 512 then
    raise exception using errcode = 'P0002', message = 'invitation unavailable';
  end if;
  v_code_hash := encode(
    extensions.digest(convert_to(v_raw_code, 'UTF8'), 'sha256'),
    'hex'
  );
  v_identity_id := public.current_identity_id();

  -- Only an invitation that is open and claimable may cross the preview
  -- boundary. Every missing, terminal, expired, deleted-ledger, removed-seat,
  -- claimed-seat, or otherwise inconsistent case follows the same response.
  select
    l.id,
    m.id,
    l.kind,
    l.title,
    inviter.display_name,
    m.display_name,
    i.expires_at
  into
    v_ledger_id,
    v_member_id,
    v_ledger_kind,
    v_ledger_title,
    v_inviter_name,
    v_assigned_member_name,
    v_expires_at
  from public.invitations i
  join public.shared_ledgers l
    on l.id = i.ledger_id
  join public.shared_ledger_members m
    on m.id = i.member_id and m.ledger_id = i.ledger_id
  join public.shared_ledger_members inviter
    on inviter.id = i.created_by and inviter.ledger_id = i.ledger_id
  where i.code_hash = v_code_hash
    and i.consumed_at is null
    and i.rejected_at is null
    and i.revoked_at is null
    and i.expires_at > now()
    and i.use_count < i.max_uses
    and l.status = 'active'
    and l.deleted_at is null
    and m.role = 'member'
    and m.status = 'invited'
    and m.deleted_at is null
    and inviter.role = 'owner'
    and inviter.status = 'active'
    and inviter.deleted_at is null
  order by i.created_at desc, i.id desc
  limit 1
  for share of l, i, m, inviter;

  if v_member_id is null then
    raise exception using errcode = 'P0002', message = 'invitation unavailable';
  end if;

  v_can_accept := (
    v_identity_id is null
    or exists (
      select 1
      from public.identities identity
      where identity.id = v_identity_id
        and identity.kind = 'app_user'
        and identity.auth_user_id = auth.uid()
        and identity.merged_into_identity_id is null
        and identity.deleted_at is null
    )
  )
    and not exists (
      select 1
      from public.shared_ledger_members mine
      where mine.ledger_id = v_ledger_id
        and mine.identity_id = v_identity_id
        and mine.status = 'active'
        and mine.deleted_at is null
    );

  return jsonb_build_object(
    'ledger_kind', v_ledger_kind,
    'ledger_title', v_ledger_title,
    'inviter_display_name', v_inviter_name,
    'assigned_member_display_name', v_assigned_member_name,
    'expires_at', v_expires_at,
    'can_accept', v_can_accept
  );
end;
$$;

revoke all on function public.inspect_invitation(text) from public;
grant execute on function public.inspect_invitation(text) to authenticated;

-- Compatibility contract: 003 created accept_invitation(p_code_hash text).
-- PostgreSQL cannot rename that input through CREATE OR REPLACE. In 005 the
-- legacy-named p_code_hash parameter carries the RAW bearer code; callers must
-- never pre-hash it. This function normalizes and hashes it server-side.
create or replace function public.accept_invitation(p_code_hash text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_raw_code text;
  v_code_hash text;
  v_invitation_id uuid;
  v_ledger_id uuid;
  v_identity_id uuid;
  v_invitation public.invitations%rowtype;
  v_ledger public.shared_ledgers%rowtype;
  v_member public.shared_ledger_members%rowtype;
  v_placeholder_kind text;
begin
  perform public.require_authenticated_user();

  -- Bearer-mutation common order: resolve and validate the caller identity
  -- first, then resolve without locks, then lock ledger -> invitation -> exact
  -- member seat. Acceptance locks the placeholder identity only if needed.
  v_identity_id := public.ensure_current_identity();
  if not exists (
    select 1
    from public.identities identity
    where identity.id = v_identity_id
      and identity.kind = 'app_user'
      and identity.auth_user_id = auth.uid()
      and identity.merged_into_identity_id is null
      and identity.deleted_at is null
  ) then
    raise exception using errcode = '23514', message = 'active app_user identity required';
  end if;

  v_raw_code := btrim(p_code_hash);
  if v_raw_code is null or length(v_raw_code) not between 16 and 512 then
    raise exception using errcode = '22023', message = 'valid invitation code required';
  end if;
  v_code_hash := encode(
    extensions.digest(convert_to(v_raw_code, 'UTF8'), 'sha256'),
    'hex'
  );

  -- Initial non-locking lookup resolves identifiers only. Every condition is
  -- revalidated from locked rows below.
  select i.id, i.ledger_id into v_invitation_id, v_ledger_id
  from public.invitations i
  where i.code_hash = v_code_hash
  order by (
    i.consumed_at is null and i.revoked_at is null and i.rejected_at is null
  ) desc, i.created_at desc, i.id desc
  limit 1;
  if v_invitation_id is null then
    raise exception using errcode = 'P0002', message = 'invitation unavailable';
  end if;

  select l.* into strict v_ledger
  from public.shared_ledgers l
  where l.id = v_ledger_id
  for update;
  select i.* into strict v_invitation
  from public.invitations i
  where i.id = v_invitation_id
    and i.ledger_id = v_ledger.id
  for update;
  select m.* into strict v_member
  from public.shared_ledger_members m
  where m.id = v_invitation.member_id
    and m.ledger_id = v_invitation.ledger_id
  for update;

  if v_ledger.status <> 'active' or v_ledger.deleted_at is not null then
    raise exception using errcode = '23514', message = 'ledger is no longer available';
  end if;

  -- Revalidate the actor after acquiring the common canonical row locks.
  if not exists (
    select 1
    from public.identities identity
    where identity.id = v_identity_id
      and identity.kind = 'app_user'
      and identity.auth_user_id = auth.uid()
      and identity.merged_into_identity_id is null
      and identity.deleted_at is null
  ) then
    raise exception using errcode = '23514', message = 'active app_user identity required';
  end if;

  if v_invitation.consumed_at is not null then
    if v_invitation.consumed_by_identity_id = v_identity_id
       and v_member.status = 'active'
       and v_member.identity_id = v_identity_id
       and v_member.deleted_at is null then
      return v_member.id;
    end if;
    raise exception using errcode = '23514', message = 'invitation already consumed';
  end if;
  if v_invitation.rejected_at is not null then
    raise exception using errcode = '23514', message = 'invitation rejected';
  end if;
  if v_invitation.revoked_at is not null then
    raise exception using errcode = '23514', message = 'invitation revoked';
  end if;
  if v_invitation.expires_at <= now() then
    raise exception using errcode = '23514', message = 'invitation expired';
  end if;
  if v_invitation.use_count >= v_invitation.max_uses then
    raise exception using errcode = '23514', message = 'invitation use limit reached';
  end if;
  if v_member.role <> 'member' or v_member.status <> 'invited'
     or v_member.deleted_at is not null then
    raise exception using errcode = '23514', message = 'invited member seat is unavailable';
  end if;
  if exists (
    select 1
    from public.shared_ledger_members mine
    where mine.ledger_id = v_invitation.ledger_id
      and mine.identity_id = v_identity_id
      and mine.status in ('placeholder', 'invited', 'active')
      and mine.deleted_at is null
      and mine.id <> v_member.id
  ) then
    raise exception using errcode = '23505', message = 'identity is already a member of this ledger';
  end if;

  select i.kind into strict v_placeholder_kind
  from public.identities i
  where i.id = v_member.identity_id
    and i.merged_into_identity_id is null
    and i.deleted_at is null
  for update;
  if v_placeholder_kind <> 'placeholder' then
    raise exception using errcode = '23514', message = 'invited member seat ownership is unavailable';
  end if;

  update public.shared_ledger_members m
  set identity_id = v_identity_id,
      status = 'active',
      joined_at = now(),
      left_at = null,
      removed_at = null
  where m.id = v_member.id
    and m.ledger_id = v_invitation.ledger_id
    and m.status = 'invited'
    and m.deleted_at is null;
  if not found then
    raise exception using errcode = '23514', message = 'invited member seat is unavailable';
  end if;

  update public.identities i
  set merged_into_identity_id = v_identity_id,
      claimed_at = now()
  where i.id = v_member.identity_id
    and i.kind = 'placeholder'
    and i.merged_into_identity_id is null
    and i.deleted_at is null;
  if not found then
    raise exception using errcode = '23514', message = 'placeholder identity is unavailable';
  end if;

  update public.invitations i
  set use_count = i.use_count + 1,
      consumed_by_identity_id = v_identity_id,
      consumed_at = now()
  where i.id = v_invitation.id
    and i.consumed_at is null
    and i.rejected_at is null
    and i.revoked_at is null;
  if not found then
    raise exception using errcode = '23514', message = 'invitation is no longer available';
  end if;

  return v_member.id;
end;
$$;

revoke all on function public.accept_invitation(text) from public;
grant execute on function public.accept_invitation(text) to authenticated;

create or replace function public.reject_invitation(
  p_raw_code text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_raw_code text;
  v_code_hash text;
  v_invitation_id uuid;
  v_ledger_id uuid;
  v_identity_id uuid;
  v_invitation public.invitations%rowtype;
  v_ledger public.shared_ledgers%rowtype;
  v_member public.shared_ledger_members%rowtype;
  v_placeholder_identity public.identities%rowtype;
begin
  perform public.require_authenticated_user();

  -- Same bearer-mutation order as acceptance: resolve and validate the active
  -- app_user first, then lock ledger -> invitation -> member -> placeholder
  -- identity.
  v_identity_id := public.ensure_current_identity();
  if not exists (
    select 1
    from public.identities identity
    where identity.id = v_identity_id
      and identity.kind = 'app_user'
      and identity.auth_user_id = auth.uid()
      and identity.merged_into_identity_id is null
      and identity.deleted_at is null
  ) then
    raise exception using errcode = '23514', message = 'active app_user identity required';
  end if;

  v_raw_code := btrim(p_raw_code);
  if v_raw_code is null or length(v_raw_code) not between 16 and 512 then
    raise exception using errcode = '22023', message = 'valid invitation code required';
  end if;
  v_code_hash := encode(
    extensions.digest(convert_to(v_raw_code, 'UTF8'), 'sha256'),
    'hex'
  );

  select i.id, i.ledger_id into v_invitation_id, v_ledger_id
  from public.invitations i
  where i.code_hash = v_code_hash
  order by (
    i.consumed_at is null and i.revoked_at is null and i.rejected_at is null
  ) desc, i.created_at desc, i.id desc
  limit 1;
  if v_invitation_id is null then
    raise exception using errcode = 'P0002', message = 'invitation unavailable';
  end if;

  select l.* into strict v_ledger
  from public.shared_ledgers l
  where l.id = v_ledger_id
  for update;
  select i.* into strict v_invitation
  from public.invitations i
  where i.id = v_invitation_id
    and i.ledger_id = v_ledger.id
  for update;
  select m.* into strict v_member
  from public.shared_ledger_members m
  where m.id = v_invitation.member_id
    and m.ledger_id = v_invitation.ledger_id
  for update;
  select identity.* into strict v_placeholder_identity
  from public.identities identity
  where identity.id = v_member.identity_id
  for update;

  if v_ledger.status <> 'active' or v_ledger.deleted_at is not null then
    raise exception using errcode = '23514', message = 'ledger is no longer available';
  end if;

  if not exists (
    select 1
    from public.identities identity
    where identity.id = v_identity_id
      and identity.kind = 'app_user'
      and identity.auth_user_id = auth.uid()
      and identity.merged_into_identity_id is null
      and identity.deleted_at is null
  ) then
    raise exception using errcode = '23514', message = 'active app_user identity required';
  end if;
  if v_invitation.rejected_at is not null then
    -- Same-actor replay is allowed only for a history-free, unclaimed placeholder seat.
    if v_invitation.consumed_at is null
       and v_invitation.consumed_by_identity_id is null
       and v_invitation.revoked_at is null
       and v_invitation.use_count = 0
       and v_invitation.rejected_by_identity_id = v_identity_id
       and v_member.role = 'member'
       and v_member.status = 'placeholder'
       and v_member.deleted_at is null
       and v_member.joined_at is null
       and v_member.left_at is null
       and v_member.removed_at is null
       and v_placeholder_identity.id = v_member.identity_id
       and v_placeholder_identity.kind = 'placeholder'
       and v_placeholder_identity.auth_user_id is null
       and v_placeholder_identity.telegram_user_id is null
       and v_placeholder_identity.merged_into_identity_id is null
       and v_placeholder_identity.claimed_at is null
       and v_placeholder_identity.deleted_at is null
       and not exists (
         select 1
         from public.shared_entries entry
         where entry.payer_member_id = v_member.id
            or entry.created_by_member_id = v_member.id
       )
       and not exists (
         select 1
         from public.shared_entry_lines line
         where line.member_id = v_member.id
       )
       and not exists (
         select 1
         from public.shared_entry_events ev
         where ev.actor_member_id = v_member.id
       )
       and not exists (
         select 1
         from public.shared_settlements settlement
         where v_member.id in (
           settlement.from_member_id,
           settlement.to_member_id,
           settlement.recorded_by_member_id
         )
       )
       and not exists (
         select 1
         from public.invitations history_invitation
         where (
             history_invitation.member_id = v_member.id
             and (
               history_invitation.consumed_at is not null
               or history_invitation.consumed_by_identity_id is not null
             )
           )
           or history_invitation.consumed_by_identity_id = v_member.identity_id
       ) then
      return jsonb_build_object(
        'ok', true,
        'invitation_status', 'rejected'
      );
    end if;
    -- Only the original rejecting identity receives the idempotent result.
    -- Every other or inconsistent rejected state is deliberately generic.
    -- An unexpectedly still-invited seat is not repaired here: replay stays
    -- mutation-free and fails closed pending explicit state review.
    raise exception using errcode = 'P0002', message = 'invitation unavailable';
  end if;
  if exists (
    select 1
    from public.shared_ledger_members mine
    where mine.ledger_id = v_ledger.id
      and mine.identity_id = v_identity_id
      and mine.status = 'active'
      and mine.deleted_at is null
  ) then
    raise exception using errcode = '42501', message = 'active members must use owner revocation';
  end if;
  if v_invitation.consumed_at is not null then
    raise exception using errcode = '23514', message = 'invitation already consumed';
  end if;
  if v_invitation.revoked_at is not null then
    raise exception using errcode = '23514', message = 'invitation revoked';
  end if;
  if v_invitation.expires_at <= now() then
    raise exception using errcode = '23514', message = 'invitation expired';
  end if;
  if v_member.role <> 'member' or v_member.status <> 'invited'
     or v_member.deleted_at is not null then
    raise exception using errcode = '23514', message = 'invited member seat is unavailable';
  end if;

  update public.invitations i
  set rejected_at = now(),
      rejected_by_identity_id = v_identity_id
  where i.id = v_invitation.id
    and i.consumed_at is null
    and i.rejected_at is null
    and i.revoked_at is null;
  if not found then
    raise exception using errcode = '23514', message = 'invitation is no longer available';
  end if;

  update public.shared_ledger_members m
  set status = 'placeholder'
  where m.id = v_member.id
    and m.status = 'invited'
    and m.deleted_at is null;
  if not found then
    raise exception using errcode = '23514', message = 'invited member seat is unavailable';
  end if;

  return jsonb_build_object(
    'ok', true,
    'invitation_status', 'rejected'
  );
end;
$$;

revoke all on function public.reject_invitation(text) from public;
grant execute on function public.reject_invitation(text) to authenticated;

create or replace function public.revoke_invitation(
  p_invitation_id uuid,
  p_expected_ledger_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_invitation_ledger_id uuid;
  v_actor public.shared_ledger_members%rowtype;
  v_invitation public.invitations%rowtype;
  v_ledger public.shared_ledgers%rowtype;
  v_member public.shared_ledger_members%rowtype;
  v_new_revision integer;
begin
  perform public.require_authenticated_user();
  if p_invitation_id is null then
    raise exception using errcode = '22023', message = 'invitation id is required';
  end if;
  if p_expected_ledger_revision is null then
    raise exception using errcode = '22023', message = 'expected ledger revision is required';
  end if;

  -- Resolve the ledger only through the caller's active owner seat. Missing
  -- and unauthorized guessed UUIDs deliberately produce the same response.
  select i.ledger_id into v_invitation_ledger_id
  from public.invitations i
  join public.shared_ledger_members owner
    on owner.ledger_id = i.ledger_id
   and owner.identity_id = public.current_identity_id()
   and owner.role = 'owner'
   and owner.status = 'active'
   and owner.deleted_at is null
  where i.id = p_invitation_id;
  if v_invitation_ledger_id is null then
    raise exception using
      errcode = '42501',
      message = 'invitation unavailable or caller is not authorized';
  end if;

  select l.* into strict v_ledger
  from public.shared_ledgers l
  where l.id = v_invitation_ledger_id
  for update;
  if v_ledger.status <> 'active' or v_ledger.deleted_at is not null then
    raise exception using errcode = '23514', message = 'ledger is no longer available';
  end if;
  select m.* into v_actor
  from public.shared_ledger_members m
  where m.id = public.current_member_id(v_ledger.id)
  for update;
  if not found or v_actor.role <> 'owner' then
    raise exception using
      errcode = '42501',
      message = 'invitation unavailable or caller is not authorized';
  end if;
  select i.* into strict v_invitation
  from public.invitations i
  where i.id = p_invitation_id
    and i.ledger_id = v_ledger.id
  for update;
  select m.* into strict v_member
  from public.shared_ledger_members m
  where m.id = v_invitation.member_id
    and m.ledger_id = v_ledger.id
  for update;

  if v_invitation.revoked_at is not null then
    if v_member.status = 'active' or v_member.deleted_at is not null then
      raise exception using errcode = '23514', message = 'revoked invitation seat is inconsistent';
    end if;
    return jsonb_build_object(
      'invitation_id', v_invitation.id,
      'member_id', v_member.id,
      'invitation_status', 'revoked',
      'ledger_revision', v_ledger.revision
    );
  end if;
  if v_ledger.revision is distinct from p_expected_ledger_revision then
    raise exception using errcode = '40001', message = 'stale ledger revision';
  end if;
  if v_invitation.consumed_at is not null then
    raise exception using errcode = '23514', message = 'consumed invitation cannot be revoked';
  end if;
  if v_invitation.rejected_at is not null then
    raise exception using errcode = '23514', message = 'rejected invitation cannot be revoked';
  end if;
  if v_member.role <> 'member' or v_member.status = 'active'
     or v_member.deleted_at is not null then
    raise exception using errcode = '23514', message = 'active or unavailable member seat cannot be revoked';
  end if;

  update public.invitations i
  set revoked_at = now()
  where i.id = v_invitation.id
    and i.consumed_at is null
    and i.rejected_at is null
    and i.revoked_at is null;
  if not found then
    raise exception using errcode = '23514', message = 'invitation is no longer available';
  end if;
  update public.shared_ledger_members m
  set status = 'placeholder'
  where m.id = v_member.id
    and m.status in ('placeholder', 'invited')
    and m.deleted_at is null;
  if not found then
    raise exception using errcode = '23514', message = 'unclaimed member seat is unavailable';
  end if;
  update public.shared_ledgers l
  set revision = l.revision + 1
  where l.id = v_ledger.id
  returning l.revision into v_new_revision;

  return jsonb_build_object(
    'invitation_id', v_invitation.id,
    'member_id', v_member.id,
    'invitation_status', 'revoked',
    'ledger_revision', v_new_revision
  );
end;
$$;

revoke all on function public.revoke_invitation(uuid, bigint) from public;
grant execute on function public.revoke_invitation(uuid, bigint) to authenticated;

create or replace function public.create_member_invitation(
  p_ledger_id uuid,
  p_member_id uuid,
  p_code_hash text,
  p_method text,
  p_expires_at timestamptz,
  p_client_invitation_id uuid,
  p_expected_ledger_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := public.require_authenticated_user();
  v_actor public.shared_ledger_members%rowtype;
  v_existing public.invitations%rowtype;
  v_existing_found boolean := false;
  v_ledger public.shared_ledgers%rowtype;
  v_member public.shared_ledger_members%rowtype;
  v_identity public.identities%rowtype;
  v_new_revision integer;
begin
  if p_ledger_id is null or p_member_id is null or p_client_invitation_id is null then
    raise exception using errcode = '22023', message = 'ledger, member and client invitation ids are required';
  end if;
  if p_expected_ledger_revision is null then
    raise exception using errcode = '22023', message = 'expected ledger revision is required';
  end if;
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'code_hash must be a lowercase SHA-256 hex digest';
  end if;
  if p_method is null or p_method not in ('code', 'link', 'qr', 'telegram', 'contact') then
    raise exception using errcode = '22023', message = 'invalid invitation method';
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    raise exception using errcode = '22023', message = 'invitation expiry must be in the future';
  end if;

  select l.* into strict v_ledger
  from public.shared_ledgers l
  where l.id = p_ledger_id
  for update;
  if v_ledger.status <> 'active' or v_ledger.deleted_at is not null then
    raise exception using errcode = '23514', message = 'active ledger required';
  end if;
  select m.* into v_actor
  from public.shared_ledger_members m
  where m.id = public.current_member_id(v_ledger.id)
  for update;
  if not found or v_actor.role <> 'owner' then
    raise exception using errcode = '42501', message = 'active ledger owner required';
  end if;
  select i.* into v_existing
  from public.invitations i
  where i.id = p_client_invitation_id
  for update;
  v_existing_found := found;
  select m.* into strict v_member
  from public.shared_ledger_members m
  where m.id = p_member_id
    and m.ledger_id = p_ledger_id
  for update;
  if v_existing_found then
    if v_existing.ledger_id is distinct from p_ledger_id
       or v_existing.member_id is distinct from p_member_id
       or v_existing.created_by is distinct from v_actor.id
       or v_existing.code_hash is distinct from p_code_hash
       or v_existing.method is distinct from p_method
       or v_existing.expires_at is distinct from p_expires_at then
      raise exception using errcode = '23505', message = 'client invitation id is already bound to different invitation data';
    end if;
    return jsonb_build_object(
      'invitation_id', v_existing.id,
      'ledger_id', v_existing.ledger_id,
      'member_id', v_existing.member_id,
      'method', v_existing.method,
      'expires_at', v_existing.expires_at,
      'invitation_status', case
        when v_existing.consumed_at is not null then 'consumed'
        when v_existing.rejected_at is not null then 'rejected'
        when v_existing.revoked_at is not null then 'revoked'
        when v_existing.expires_at <= now() then 'expired'
        else 'open'
      end,
      'ledger_revision', v_ledger.revision
    );
  end if;
  if v_ledger.revision is distinct from p_expected_ledger_revision then
    raise exception using errcode = '40001', message = 'stale ledger revision';
  end if;
  if v_member.role <> 'member' or v_member.status <> 'placeholder'
     or v_member.deleted_at is not null then
    raise exception using errcode = '23514', message = 'only an available placeholder seat can be invited';
  end if;
  select i.* into strict v_identity
  from public.identities i
  where i.id = v_member.identity_id
  for update;
  if v_identity.kind <> 'placeholder'
     or v_identity.auth_user_id is not null
     or v_identity.telegram_user_id is not null
     or v_identity.merged_into_identity_id is not null
     or v_identity.deleted_at is not null then
    raise exception using errcode = '23514', message = 'member seat has accepted ownership and cannot be replaced';
  end if;
  if exists (
    select 1 from public.invitations i
    where i.member_id = v_member.id
      and i.consumed_at is null
      and i.rejected_at is null
      and i.revoked_at is null
  ) then
    raise exception using errcode = '23514', message = 'revoke the existing invitation before re-inviting this seat';
  end if;
  if exists (
    select 1 from public.invitations i where i.code_hash = p_code_hash
  ) then
    raise exception using errcode = '23505', message = 'invitation code is unavailable';
  end if;
  if exists (
    select 1 from public.shared_entries e
    where e.payer_member_id = v_member.id or e.created_by_member_id = v_member.id
  ) or exists (
    select 1 from public.shared_entry_lines line
    where line.member_id = v_member.id
  ) or exists (
    select 1 from public.shared_entry_events ev
    where ev.actor_member_id = v_member.id
  ) or exists (
    select 1 from public.shared_settlements s
    where v_member.id in (s.from_member_id, s.to_member_id, s.recorded_by_member_id)
  ) or exists (
    select 1 from public.invitations i
    where i.member_id = v_member.id and i.consumed_at is not null
  ) then
    raise exception using errcode = '23514', message = 'member seat has shared history and cannot be re-invited';
  end if;

  insert into public.invitations (
    id, ledger_id, member_id, created_by, method, code_hash, expires_at
  ) values (
    p_client_invitation_id, p_ledger_id, p_member_id, v_actor.id,
    p_method, p_code_hash, p_expires_at
  );
  update public.shared_ledger_members m
  set status = 'invited',
      invited_by = v_actor.id
  where m.id = v_member.id
    and m.status = 'placeholder'
    and m.deleted_at is null;
  if not found then
    raise exception using errcode = '23514', message = 'placeholder member seat is unavailable';
  end if;
  update public.shared_ledgers l
  set revision = l.revision + 1
  where l.id = v_ledger.id
  returning l.revision into v_new_revision;

  return jsonb_build_object(
    'invitation_id', p_client_invitation_id,
    'ledger_id', p_ledger_id,
    'member_id', p_member_id,
    'method', p_method,
    'expires_at', p_expires_at,
    'invitation_status', 'open',
    'ledger_revision', v_new_revision
  );
end;
$$;

revoke all on function public.create_member_invitation(uuid, uuid, text, text, timestamptz, uuid, bigint) from public;
grant execute on function public.create_member_invitation(uuid, uuid, text, text, timestamptz, uuid, bigint) to authenticated;

create or replace function public.remove_unclaimed_member(
  p_ledger_id uuid,
  p_member_id uuid,
  p_expected_ledger_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor public.shared_ledger_members%rowtype;
  v_ledger public.shared_ledgers%rowtype;
  v_member public.shared_ledger_members%rowtype;
  v_changed_at timestamptz := now();
  v_new_revision integer;
begin
  perform public.require_authenticated_user();
  if p_ledger_id is null or p_member_id is null then
    raise exception using errcode = '22023', message = 'ledger and member ids are required';
  end if;
  if p_expected_ledger_revision is null then
    raise exception using errcode = '22023', message = 'expected ledger revision is required';
  end if;

  select l.* into strict v_ledger
  from public.shared_ledgers l
  where l.id = p_ledger_id
  for update;
  if v_ledger.status <> 'active' or v_ledger.deleted_at is not null then
    raise exception using errcode = '23514', message = 'active ledger required';
  end if;
  select m.* into v_actor
  from public.shared_ledger_members m
  where m.id = public.current_member_id(v_ledger.id)
  for update;
  if not found or v_actor.role <> 'owner' then
    raise exception using errcode = '42501', message = 'active ledger owner required';
  end if;
  perform 1
  from public.invitations i
  where i.ledger_id = p_ledger_id and i.member_id = p_member_id
  order by i.created_at, i.id
  for update;
  select m.* into strict v_member
  from public.shared_ledger_members m
  where m.id = p_member_id
    and m.ledger_id = p_ledger_id
  for update;

  if v_member.status = 'removed' then
    return jsonb_build_object(
      'ledger_id', v_ledger.id,
      'member_id', v_member.id,
      'member_status', 'removed',
      'ledger_revision', v_ledger.revision
    );
  end if;
  if v_ledger.revision is distinct from p_expected_ledger_revision then
    raise exception using errcode = '40001', message = 'stale ledger revision';
  end if;
  if v_member.role = 'owner' or v_member.id = v_actor.id then
    raise exception using errcode = '23514', message = 'owner seat cannot be removed';
  end if;
  if v_member.status not in ('placeholder', 'invited')
     or v_member.deleted_at is not null then
    raise exception using errcode = '23514', message = 'only an unclaimed member seat can be removed';
  end if;
  if exists (
    select 1 from public.shared_entries e
    where e.payer_member_id = v_member.id or e.created_by_member_id = v_member.id
  ) or exists (
    select 1 from public.shared_entry_lines line
    where line.member_id = v_member.id
  ) or exists (
    select 1 from public.shared_entry_events ev
    where ev.actor_member_id = v_member.id
  ) or exists (
    select 1 from public.shared_settlements s
    where v_member.id in (s.from_member_id, s.to_member_id, s.recorded_by_member_id)
  ) or exists (
    select 1 from public.invitations i
    where i.member_id = v_member.id and i.consumed_at is not null
  ) then
    raise exception using errcode = '23514', message = 'member seat has shared history and cannot be removed';
  end if;

  update public.invitations i
  set revoked_at = v_changed_at
  where i.ledger_id = p_ledger_id
    and i.member_id = p_member_id
    and i.consumed_at is null
    and i.rejected_at is null
    and i.revoked_at is null;
  update public.shared_ledger_members m
  set status = 'removed',
      removed_at = v_changed_at,
      deleted_at = v_changed_at
  where m.id = v_member.id
    and m.status in ('placeholder', 'invited')
    and m.deleted_at is null;
  if not found then
    raise exception using errcode = '23514', message = 'unclaimed member seat is unavailable';
  end if;
  update public.shared_ledgers l
  set revision = l.revision + 1
  where l.id = v_ledger.id
  returning l.revision into v_new_revision;

  return jsonb_build_object(
    'ledger_id', v_ledger.id,
    'member_id', v_member.id,
    'member_status', 'removed',
    'ledger_revision', v_new_revision
  );
end;
$$;

revoke all on function public.remove_unclaimed_member(uuid, uuid, bigint) from public;
grant execute on function public.remove_unclaimed_member(uuid, uuid, bigint) to authenticated;

comment on function public.inspect_invitation(text) is
  'Authenticated bearer-code preview. Open invitations return exactly six product fields; every unavailable state raises the same generic error. The raw code is hashed immediately and is not stored, returned, or explicitly logged by this function.';
comment on function public.accept_invitation(text) is
  'Claims exactly the invitation-assigned unclaimed seat for the current app_user identity. The legacy p_code_hash argument name carries a raw code, never a caller-computed hash; hashing occurs server-side. Deleted ledgers and all terminal states fail closed.';
comment on function public.reject_invitation(text) is
  'A raw-code-bearing authenticated active app_user who is not already an active ledger member may reject an open invitation. A safe same-actor rejected-state retry is mutation-free; every other rejected-state caller receives generic unavailable behavior. The function does not explicitly log the raw code or create entry/debt events.';
comment on function public.revoke_invitation(uuid, bigint) is
  'Owner-only revocation with ledger revision protection and state-based retry behavior. Missing and unauthorized invitation UUIDs share one generic response.';
comment on function public.create_member_invitation(uuid, uuid, text, text, timestamptz, uuid, bigint) is
  'Owner-only re-invitation of an existing history-free placeholder seat. The client invitation UUID is the row idempotency key; only a SHA-256 digest is accepted.';
comment on function public.remove_unclaimed_member(uuid, uuid, bigint) is
  'Owner-only tombstoning of a history-free placeholder/invited seat. State supplies retry idempotency; active members and financial-history seats are never affected.';
