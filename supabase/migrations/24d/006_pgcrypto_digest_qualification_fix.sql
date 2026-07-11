-- Phase 24D-D1 disposable-scratch repair for a pre-fix 005 installation.
-- Clean/new deployments use the corrected 005_shared_invitations_membership.sql
-- and do not require this file. Do not run this repair in production unless it
-- has received a separate, production-specific review.
--
-- This migration replaces only the three installed D1 bearer-code functions
-- that previously called digest(text, unknown) without schema qualification.
-- It changes no schema objects other than those function definitions, rewrites
-- no data, and deliberately leaves each SECURITY DEFINER search_path unchanged.

do $preflight$
declare
  v_pgcrypto_schema text;
begin
  select n.nspname
  into v_pgcrypto_schema
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n
    on n.oid = e.extnamespace
  where e.extname = 'pgcrypto';

  if v_pgcrypto_schema is null then
    raise exception using
      errcode = '0A000',
      message = 'Phase 24D-D1 pgcrypto repair preflight failed: pgcrypto is not installed';
  end if;

  if v_pgcrypto_schema <> 'extensions' then
    raise exception using
      errcode = '0A000',
      message = format(
        'Phase 24D-D1 pgcrypto repair preflight failed: expected pgcrypto in schema extensions, found schema %I',
        v_pgcrypto_schema
      );
  end if;
end;
$preflight$;

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
begin
  perform public.require_authenticated_user();

  -- Same bearer-mutation order as acceptance: resolve and validate the active
  -- app_user first, then lock ledger -> invitation -> exact member seat.
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
    if v_invitation.rejected_by_identity_id = v_identity_id
       and v_member.status = 'placeholder'
       and v_member.deleted_at is null then
      return jsonb_build_object(
        'ok', true,
        'invitation_status', 'rejected'
      );
    end if;
    raise exception using errcode = '23514', message = 'invitation already rejected';
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
