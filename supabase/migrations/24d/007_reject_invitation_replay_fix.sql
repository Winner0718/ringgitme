-- Phase 24D-D1 disposable-scratch repair for reject replay behavior after
-- 005_shared_invitations_membership.sql and 006_pgcrypto_digest_qualification_fix.sql.
-- Clean/new deployments use the corrected 005 and do not require this file.
-- Do not rerun 005 or 006. Do not run 007 in production unless it receives a
-- separate, production-specific review.

do $preflight$
declare
  v_pgcrypto_schema text;
begin
  if to_regprocedure('public.reject_invitation(text)') is null then
    raise exception using
      errcode = '0A000',
      message = 'Phase 24D-D1 reject replay repair preflight failed: public.reject_invitation(text) is not installed';
  end if;

  select n.nspname
  into v_pgcrypto_schema
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto';

  if v_pgcrypto_schema is null then
    raise exception using
      errcode = '0A000',
      message = 'Phase 24D-D1 reject replay repair preflight failed: pgcrypto is not installed';
  end if;

  if v_pgcrypto_schema <> 'extensions' then
    raise exception using
      errcode = '0A000',
      message = format(
        'Phase 24D-D1 reject replay repair preflight failed: expected pgcrypto in schema extensions, found schema %I',
        v_pgcrypto_schema
      );
  end if;
end;
$preflight$;

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
