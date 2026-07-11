-- Phase 24D-B: authenticated mutation boundary.
-- Every exposed mutation is SECURITY DEFINER, validates auth and membership,
-- uses client ids for idempotency, and writes canonical shared state only.

create or replace function public.require_authenticated_user()
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  return v_user_id;
end;
$$;

create or replace function public.shared_event_is_idempotent(
  p_entry_id uuid,
  p_line_id uuid,
  p_actor_member_id uuid,
  p_kind text,
  p_client_event_id uuid
)
returns boolean
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_event public.shared_entry_events%rowtype;
begin
  if p_client_event_id is null then return false; end if;
  select ev.* into v_event
  from public.shared_entry_events ev
  where ev.entry_id = p_entry_id and ev.client_event_id = p_client_event_id;
  if not found then return false; end if;
  if v_event.line_id is distinct from p_line_id
     or v_event.actor_member_id <> p_actor_member_id
     or v_event.kind <> p_kind then
    raise exception using errcode = '23505', message = 'client_event_id collision with a different mutation';
  end if;
  return true;
end;
$$;

create or replace function public.void_entry(
  p_entry_id uuid,
  p_expected_revision integer,
  p_client_event_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_entry public.shared_entries%rowtype;
  v_actor_id uuid;
  v_new_revision integer;
begin
  perform public.require_authenticated_user();
  select e.* into v_entry from public.shared_entries e where e.id = p_entry_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'entry not found'; end if;
  v_actor_id := public.current_member_id(v_entry.ledger_id);
  if v_actor_id is null or (
    v_actor_id <> v_entry.created_by_member_id and not public.is_ledger_owner(v_entry.ledger_id)
  ) then
    raise exception using errcode = '42501', message = 'entry creator or ledger owner required';
  end if;
  if p_expected_revision is null then
    raise exception using errcode = '22023', message = 'expected revision is required';
  end if;
  if public.shared_event_is_idempotent(v_entry.id, null, v_actor_id, 'voided', p_client_event_id) then
    return v_entry.revision;
  end if;
  if p_client_event_id is null or v_entry.revision is distinct from p_expected_revision then
    raise exception using errcode = '40001', message = 'stale entry revision';
  end if;
  if v_entry.entry_status = 'voided' then return v_entry.revision; end if;
  if v_entry.entry_status = 'settled' then
    raise exception using errcode = '23514', message = 'reverse confirmed settlements before voiding';
  end if;
  if exists (
    select 1
    from public.shared_entry_lines l
    where l.entry_id = v_entry.id
      and not (
        l.member_id = v_entry.payer_member_id
        and v_entry.payer_member_id = v_entry.created_by_member_id
      )
      and l.deleted_at is null
      and l.settlement_status in ('paid_pending_confirmation', 'confirmed')
  ) or exists (
    select 1
    from public.shared_settlements s
    where s.entry_id = v_entry.id
      and s.deleted_at is null
      and s.status <> 'reversed'
  ) then
    raise exception using
      errcode = '23514',
      message = 'reopen or reverse active payment and settlement facts before voiding';
  end if;

  v_new_revision := v_entry.revision + 1;
  update public.shared_entries e set entry_status = 'voided', voided_at = now(), revision = v_new_revision
  where e.id = v_entry.id;
  insert into public.shared_entry_events (
    entry_id, line_id, actor_member_id, kind, entry_revision, client_event_id, payload
  ) values (v_entry.id, null, v_actor_id, 'voided', v_new_revision, p_client_event_id, '{}'::jsonb);
  return v_new_revision;
end;
$$;

create or replace function public.mark_line_paid(
  p_line_id uuid,
  p_expected_revision integer,
  p_client_event_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_line public.shared_entry_lines%rowtype;
  v_entry public.shared_entries%rowtype;
  v_actor_id uuid;
begin
  perform public.require_authenticated_user();
  select l.* into v_line from public.shared_entry_lines l
  where l.id = p_line_id and l.deleted_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'line not found'; end if;
  select e.* into strict v_entry from public.shared_entries e where e.id = v_line.entry_id for update;
  v_actor_id := public.current_member_id(v_entry.ledger_id);
  if v_actor_id is null or v_actor_id <> v_line.member_id then
    raise exception using errcode = '42501', message = 'only the owing member may mark paid';
  end if;
  if p_expected_revision is null then
    raise exception using errcode = '22023', message = 'expected revision is required';
  end if;
  if public.shared_event_is_idempotent(v_entry.id, v_line.id, v_actor_id, 'marked_paid', p_client_event_id) then
    return v_line.id;
  end if;
  if p_client_event_id is null or v_entry.revision is distinct from p_expected_revision or v_entry.entry_status not in ('active', 'pending') then
    raise exception using errcode = '40001', message = 'stale revision or entry is not payable';
  end if;
  if v_line.response_status not in ('accepted', 'auto_accepted')
     or v_line.settlement_status not in ('unpaid', 'reversed') then
    raise exception using errcode = '23514', message = 'line must be accepted and unpaid or reversed';
  end if;

  update public.shared_entry_lines l set
    settlement_status = 'paid_pending_confirmation', paid_marked_at = now(),
    confirmed_at = null, waived_at = null, reversed_at = null
  where l.id = v_line.id;
  insert into public.shared_entry_events (
    entry_id, line_id, actor_member_id, kind, entry_revision, client_event_id, payload
  ) values (
    v_entry.id, v_line.id, v_actor_id, 'marked_paid', v_entry.revision, p_client_event_id,
    jsonb_build_object('line_id', v_line.id)
  );
  return v_line.id;
end;
$$;

create or replace function public.confirm_line_received(
  p_line_id uuid,
  p_expected_revision integer,
  p_client_event_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_line public.shared_entry_lines%rowtype;
  v_entry public.shared_entries%rowtype;
  v_actor_id uuid;
begin
  perform public.require_authenticated_user();
  select l.* into v_line from public.shared_entry_lines l
  where l.id = p_line_id and l.deleted_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'line not found'; end if;
  select e.* into strict v_entry from public.shared_entries e where e.id = v_line.entry_id for update;
  v_actor_id := public.current_member_id(v_entry.ledger_id);
  if v_actor_id is null or v_actor_id <> v_entry.payer_member_id then
    raise exception using errcode = '42501', message = 'only the payer may confirm receipt';
  end if;
  if p_expected_revision is null then
    raise exception using errcode = '22023', message = 'expected revision is required';
  end if;
  if public.shared_event_is_idempotent(v_entry.id, v_line.id, v_actor_id, 'confirmed_received', p_client_event_id) then
    return v_line.id;
  end if;
  if p_client_event_id is null or v_entry.revision is distinct from p_expected_revision or v_entry.entry_status not in ('active', 'pending') then
    raise exception using errcode = '40001', message = 'stale revision or entry is not confirmable';
  end if;
  if v_line.settlement_status <> 'paid_pending_confirmation' then
    raise exception using errcode = '23514', message = 'line must be paid_pending_confirmation';
  end if;

  update public.shared_entry_lines l set settlement_status = 'confirmed', confirmed_at = now()
  where l.id = v_line.id;
  if not exists (
    select 1 from public.shared_entry_lines l
    where l.entry_id = v_entry.id and l.id <> v_line.id and l.deleted_at is null
      and l.settlement_status not in ('confirmed', 'waived')
  ) then
    update public.shared_entries e set entry_status = 'settled', settled_at = now() where e.id = v_entry.id;
  end if;
  insert into public.shared_entry_events (
    entry_id, line_id, actor_member_id, kind, entry_revision, client_event_id, payload
  ) values (
    v_entry.id, v_line.id, v_actor_id, 'confirmed_received', v_entry.revision, p_client_event_id,
    jsonb_build_object('line_id', v_line.id)
  );
  return v_line.id;
end;
$$;

create or replace function public.waive_line(
  p_line_id uuid,
  p_expected_revision integer,
  p_client_event_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_line public.shared_entry_lines%rowtype;
  v_entry public.shared_entries%rowtype;
  v_actor_id uuid;
begin
  perform public.require_authenticated_user();
  select l.* into v_line from public.shared_entry_lines l
  where l.id = p_line_id and l.deleted_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'line not found'; end if;
  select e.* into strict v_entry from public.shared_entries e where e.id = v_line.entry_id for update;
  v_actor_id := public.current_member_id(v_entry.ledger_id);
  if v_actor_id is null or v_actor_id <> v_entry.payer_member_id then
    raise exception using errcode = '42501', message = 'only the payer may waive a line';
  end if;
  if p_expected_revision is null then
    raise exception using errcode = '22023', message = 'expected revision is required';
  end if;
  if public.shared_event_is_idempotent(v_entry.id, v_line.id, v_actor_id, 'waived', p_client_event_id) then
    return v_line.id;
  end if;
  if p_client_event_id is null or v_entry.revision is distinct from p_expected_revision or v_entry.entry_status not in ('active', 'pending') then
    raise exception using errcode = '40001', message = 'stale revision or entry is not mutable';
  end if;
  if v_line.settlement_status <> 'unpaid' then
    raise exception using errcode = '23514', message = 'only an unpaid line may be waived';
  end if;

  update public.shared_entry_lines l set settlement_status = 'waived', waived_at = now()
  where l.id = v_line.id;
  if not exists (
    select 1 from public.shared_entry_lines l
    where l.entry_id = v_entry.id and l.id <> v_line.id and l.deleted_at is null
      and l.settlement_status not in ('confirmed', 'waived')
  ) then
    update public.shared_entries e set entry_status = 'settled', settled_at = now() where e.id = v_entry.id;
  end if;
  insert into public.shared_entry_events (
    entry_id, line_id, actor_member_id, kind, entry_revision, client_event_id, payload
  ) values (
    v_entry.id, v_line.id, v_actor_id, 'waived', v_entry.revision, p_client_event_id,
    jsonb_build_object('line_id', v_line.id)
  );
  return v_line.id;
end;
$$;

create or replace function public.reopen_line(
  p_line_id uuid,
  p_expected_revision integer,
  p_client_event_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_line public.shared_entry_lines%rowtype;
  v_entry public.shared_entries%rowtype;
  v_actor_id uuid;
  v_next_status text;
begin
  perform public.require_authenticated_user();
  select l.* into v_line from public.shared_entry_lines l
  where l.id = p_line_id and l.deleted_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'line not found'; end if;
  select e.* into strict v_entry from public.shared_entries e where e.id = v_line.entry_id for update;
  v_actor_id := public.current_member_id(v_entry.ledger_id);
  if v_actor_id is null or v_actor_id not in (v_line.member_id, v_entry.payer_member_id) then
    raise exception using errcode = '42501', message = 'payer or assigned member required';
  end if;
  if p_expected_revision is null then
    raise exception using errcode = '22023', message = 'expected revision is required';
  end if;
  if public.shared_event_is_idempotent(v_entry.id, v_line.id, v_actor_id, 'reopened', p_client_event_id) then
    return v_line.id;
  end if;
  if p_client_event_id is null or v_entry.revision is distinct from p_expected_revision or v_entry.entry_status = 'voided' then
    raise exception using errcode = '40001', message = 'stale revision or voided entry';
  end if;
  if v_line.settlement_status not in ('paid_pending_confirmation', 'confirmed', 'waived') then
    raise exception using errcode = '23514', message = 'line is not reopenable';
  end if;
  if v_line.settlement_status in ('confirmed', 'waived')
     and v_actor_id <> v_entry.payer_member_id then
    raise exception using errcode = '42501', message = 'only the payer may reverse a confirmed or waived line';
  end if;
  v_next_status := case when v_line.settlement_status = 'confirmed' then 'reversed' else 'unpaid' end;

  update public.shared_entry_lines l set
    settlement_status = v_next_status,
    paid_marked_at = case when v_next_status = 'unpaid' then null else l.paid_marked_at end,
    confirmed_at = null, waived_at = null,
    reversed_at = case when v_next_status = 'reversed' then now() else null end
  where l.id = v_line.id;
  if v_line.settlement_status in ('paid_pending_confirmation', 'confirmed') then
    update public.shared_settlements s
    set status = 'reversed', reversed_at = now()
    where s.line_id = v_line.id
      and s.deleted_at is null
      and s.status <> 'reversed';
  end if;
  if v_entry.entry_status = 'settled' then
    update public.shared_entries e set entry_status = 'active', settled_at = null where e.id = v_entry.id;
  end if;
  insert into public.shared_entry_events (
    entry_id, line_id, actor_member_id, kind, entry_revision, client_event_id, payload
  ) values (
    v_entry.id, v_line.id, v_actor_id, 'reopened', v_entry.revision, p_client_event_id,
    jsonb_build_object('line_id', v_line.id, 'settlement_status', v_next_status)
  );
  return v_line.id;
end;
$$;

create or replace function public.record_settlement(
  p_ledger_id uuid,
  p_from_member_id uuid,
  p_to_member_id uuid,
  p_entry_id uuid,
  p_line_id uuid,
  p_amount_sen bigint,
  p_occurred_at timestamptz,
  p_client_settlement_id uuid,
  p_client_event_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor_id uuid;
  v_settlement_id uuid;
  v_existing_settlement public.shared_settlements%rowtype;
  v_entry_revision integer;
begin
  perform public.require_authenticated_user();
  perform 1 from public.shared_ledgers l
  where l.id = p_ledger_id and l.deleted_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'ledger not found'; end if;
  v_actor_id := public.current_member_id(p_ledger_id);
  if v_actor_id is null or v_actor_id not in (p_from_member_id, p_to_member_id) then
    raise exception using errcode = '42501', message = 'settlement participant membership required';
  end if;

  select s.* into v_existing_settlement from public.shared_settlements s
  where s.ledger_id = p_ledger_id and s.client_settlement_id = p_client_settlement_id;
  if found then
    if v_actor_id not in (v_existing_settlement.from_member_id, v_existing_settlement.to_member_id)
       or v_existing_settlement.from_member_id is distinct from p_from_member_id
       or v_existing_settlement.to_member_id is distinct from p_to_member_id
       or v_existing_settlement.entry_id is distinct from p_entry_id
       or v_existing_settlement.line_id is distinct from p_line_id
       or v_existing_settlement.amount_sen is distinct from p_amount_sen then
      raise exception using errcode = '23505', message = 'client_settlement_id collision with different settlement data';
    end if;
    return v_existing_settlement.id;
  end if;

  if p_client_settlement_id is null or p_amount_sen is null or p_amount_sen <= 0
     or p_occurred_at is null or p_from_member_id = p_to_member_id then
    raise exception using errcode = '22023', message = 'valid participants, amount, occurrence, and client id required';
  end if;
  if exists (
    select 1 from (values (p_from_member_id), (p_to_member_id)) v(member_id)
    left join public.shared_ledger_members m
      on m.id = v.member_id and m.ledger_id = p_ledger_id
      and m.status = 'active' and m.deleted_at is null
    where m.id is null
  ) then
    raise exception using errcode = '23514', message = 'settlement participants must be active members';
  end if;
  if p_entry_id is not null then
    select e.revision into v_entry_revision from public.shared_entries e
    where e.id = p_entry_id and e.ledger_id = p_ledger_id and e.entry_status <> 'voided' and e.deleted_at is null
    for update;
    if not found then raise exception using errcode = '23514', message = 'entry is outside ledger or voided'; end if;
    if p_client_event_id is null then
      raise exception using errcode = '22023', message = 'entry-linked settlement requires event client id';
    end if;
  elsif p_client_event_id is not null then
    raise exception using errcode = '22023', message = 'ledger-level settlement must not supply an entry event id';
  end if;
  if p_line_id is not null and not exists (
    select 1 from public.shared_entry_lines l
    join public.shared_entries e on e.id = l.entry_id
    where l.id = p_line_id and l.deleted_at is null
      and e.ledger_id = p_ledger_id and (p_entry_id is null or e.id = p_entry_id)
  ) then
    raise exception using errcode = '23514', message = 'line is outside the settlement ledger or entry';
  end if;

  insert into public.shared_settlements (
    ledger_id, from_member_id, to_member_id, entry_id, line_id,
    amount_sen, status, recorded_by_member_id, client_settlement_id, occurred_at
  ) values (
    p_ledger_id, p_from_member_id, p_to_member_id, p_entry_id, p_line_id,
    p_amount_sen, 'recorded', v_actor_id, p_client_settlement_id, p_occurred_at
  ) returning id into v_settlement_id;

  if p_entry_id is not null then
    insert into public.shared_entry_events (
      entry_id, line_id, actor_member_id, kind, entry_revision, client_event_id, payload
    ) values (
      p_entry_id, p_line_id, v_actor_id, 'settlement_recorded', v_entry_revision, p_client_event_id,
      jsonb_build_object('settlement_id', v_settlement_id, 'amount_sen', p_amount_sen)
    );
  end if;
  return v_settlement_id;
end;
$$;

create or replace function public.issue_media_url(
  p_media_id uuid,
  p_operation text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_owner_user_id uuid;
begin
  perform public.require_authenticated_user();
  if p_operation is null or p_operation not in ('upload', 'download') then
    raise exception using errcode = '22023', message = 'operation must be upload or download';
  end if;
  select sm.owner_user_id into v_owner_user_id
  from public.shared_media sm where sm.id = p_media_id and sm.deleted_at is null;
  if not found then raise exception using errcode = 'P0002', message = 'media not found'; end if;
  if p_operation = 'upload' and v_owner_user_id <> auth.uid() then
    raise exception using errcode = '42501', message = 'only the media owner may upload';
  end if;
  if p_operation = 'download' and not public.can_read_shared_media(p_media_id) then
    raise exception using errcode = '42501', message = 'media access denied';
  end if;

  raise exception using
    errcode = '0A000',
    message = 'issue_media_url is intentionally disabled until the approved storage-signing phase';
end;
$$;

create or replace function public.ensure_current_identity()
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := public.require_authenticated_user();
  v_identity_id uuid;
begin
  select i.id into v_identity_id
  from public.identities i
  where i.auth_user_id = v_user_id
    and i.merged_into_identity_id is null
    and i.deleted_at is null
  order by i.created_at, i.id
  limit 1;

  if v_identity_id is null then
    insert into public.identities (kind, auth_user_id, display_name, created_by, claimed_at)
    values ('app_user', v_user_id, 'Member', v_user_id, now())
    on conflict (auth_user_id)
      where auth_user_id is not null
        and merged_into_identity_id is null
        and deleted_at is null
      do nothing
    returning id into v_identity_id;

    if v_identity_id is null then
      select i.id into strict v_identity_id
      from public.identities i
      where i.auth_user_id = v_user_id
        and i.merged_into_identity_id is null
        and i.deleted_at is null;
    end if;
  end if;

  return v_identity_id;
end;
$$;

create or replace function public.create_shared_ledger(
  p_kind text,
  p_title text,
  p_client_ledger_id uuid,
  p_client_owner_member_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := public.require_authenticated_user();
  v_identity_id uuid;
  v_ledger_id uuid;
  v_existing_kind text;
  v_existing_title text;
begin
  if p_kind is null or p_kind not in ('pair', 'group') then
    raise exception using errcode = '22023', message = 'invalid ledger kind';
  end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 160 then
    raise exception using errcode = '22023', message = 'ledger title is required';
  end if;
  if p_client_ledger_id is null or p_client_owner_member_id is null then
    raise exception using errcode = '22023', message = 'client ids are required';
  end if;

  select l.id, l.kind, l.title into v_ledger_id, v_existing_kind, v_existing_title
  from public.shared_ledgers l
  where l.created_by = v_user_id and l.client_ledger_id = p_client_ledger_id;
  if v_ledger_id is not null then
    if v_existing_kind is distinct from p_kind
       or v_existing_title is distinct from btrim(p_title)
       or not exists (
         select 1 from public.shared_ledger_members m
         where m.ledger_id = v_ledger_id
           and m.role = 'owner'
           and m.client_member_id = p_client_owner_member_id
           and m.deleted_at is null
       ) then
      raise exception using errcode = '23505', message = 'client ledger id is already bound to different ledger data';
    end if;
    return v_ledger_id;
  end if;

  v_identity_id := public.ensure_current_identity();

  insert into public.shared_ledgers (kind, title, created_by, client_ledger_id)
  values (p_kind, btrim(p_title), v_user_id, p_client_ledger_id)
  on conflict (created_by, client_ledger_id) do nothing
  returning id into v_ledger_id;

  if v_ledger_id is null then
    select l.id, l.kind, l.title into strict v_ledger_id, v_existing_kind, v_existing_title
    from public.shared_ledgers l
    where l.created_by = v_user_id and l.client_ledger_id = p_client_ledger_id;
    if v_existing_kind is distinct from p_kind
       or v_existing_title is distinct from btrim(p_title)
       or not exists (
         select 1 from public.shared_ledger_members m
         where m.ledger_id = v_ledger_id
           and m.role = 'owner'
           and m.client_member_id = p_client_owner_member_id
           and m.deleted_at is null
       ) then
      raise exception using errcode = '23505', message = 'client ledger id is already bound to different ledger data';
    end if;
    return v_ledger_id;
  end if;

  insert into public.shared_ledger_members (
    ledger_id, identity_id, role, status, display_name,
    client_member_id, joined_at
  ) values (
    v_ledger_id, v_identity_id, 'owner', 'active',
    coalesce((select p.display_name from public.profiles p where p.id = v_user_id), 'Member'),
    p_client_owner_member_id, now()
  );

  return v_ledger_id;
end;
$$;

create or replace function public.invite_member(
  p_ledger_id uuid,
  p_display_name text,
  p_method text,
  p_code_hash text,
  p_expires_at timestamptz,
  p_client_member_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := public.require_authenticated_user();
  v_actor public.shared_ledger_members%rowtype;
  v_identity_id uuid;
  v_member_id uuid;
  v_invitation_id uuid;
  v_ledger_kind text;
begin
  select l.kind into v_ledger_kind from public.shared_ledgers l
  where l.id = p_ledger_id and l.deleted_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'ledger not found';
  end if;

  select m.* into v_actor
  from public.shared_ledger_members m
  where m.id = public.current_member_id(p_ledger_id)
  for update;
  if not found or v_actor.role <> 'owner' then
    raise exception using errcode = '42501', message = 'owner membership required';
  end if;
  if p_display_name is null or length(btrim(p_display_name)) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'invitee display name is required';
  end if;
  if p_method is null or p_method not in ('code', 'link', 'qr', 'telegram', 'contact') then
    raise exception using errcode = '22023', message = 'invalid invitation method';
  end if;
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'code_hash must be a lowercase SHA-256 hex digest';
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    raise exception using errcode = '22023', message = 'invitation expiry must be in the future';
  end if;
  if p_client_member_id is null then
    raise exception using errcode = '22023', message = 'client member id is required';
  end if;
  if v_ledger_kind = 'pair' and (
    select count(*) from public.shared_ledger_members m
    where m.ledger_id = p_ledger_id
      and m.status in ('placeholder', 'invited', 'active')
      and m.deleted_at is null
  ) >= 2 then
    raise exception using errcode = '23514', message = 'pair ledgers support exactly two active or invited seats';
  end if;

  select i.id into v_invitation_id
  from public.invitations i
  where i.code_hash = p_code_hash
    and i.revoked_at is null
    and i.consumed_at is null;
  if v_invitation_id is not null then
    if not exists (
      select 1 from public.invitations i
      where i.id = v_invitation_id and i.ledger_id = p_ledger_id
    ) then
      raise exception using errcode = '23505', message = 'invitation code is unavailable';
    end if;
    return v_invitation_id;
  end if;

  insert into public.identities (kind, display_name, created_by)
  values ('placeholder', btrim(p_display_name), v_user_id)
  returning id into v_identity_id;

  insert into public.shared_ledger_members (
    ledger_id, identity_id, role, status, display_name,
    invited_by, client_member_id
  ) values (
    p_ledger_id, v_identity_id, 'member', 'invited', btrim(p_display_name),
    v_actor.id, p_client_member_id
  )
  returning id into v_member_id;

  insert into public.invitations (
    ledger_id, member_id, created_by, method, code_hash, expires_at
  ) values (
    p_ledger_id, v_member_id, v_actor.id, p_method, p_code_hash, p_expires_at
  )
  returning id into v_invitation_id;

  return v_invitation_id;
end;
$$;

create or replace function public.accept_invitation(p_code_hash text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_identity_id uuid;
  v_invitation public.invitations%rowtype;
  v_member_id uuid;
  v_placeholder_identity_id uuid;
begin
  perform public.require_authenticated_user();
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'valid code hash required';
  end if;

  select i.* into v_invitation
  from public.invitations i
  where i.code_hash = p_code_hash
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'invitation not found';
  end if;

  v_identity_id := public.ensure_current_identity();

  if v_invitation.consumed_at is not null then
    if v_invitation.consumed_by_identity_id = v_identity_id then
      return v_invitation.member_id;
    end if;
    raise exception using errcode = '23514', message = 'invitation already consumed';
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

  select m.identity_id into strict v_placeholder_identity_id
  from public.shared_ledger_members m
  where m.id = v_invitation.member_id
  for update;
  if exists (
    select 1 from public.shared_ledger_members m
    where m.ledger_id = v_invitation.ledger_id
      and m.identity_id = v_identity_id
      and m.status in ('invited', 'active')
      and m.deleted_at is null
      and m.id <> v_invitation.member_id
  ) then
    raise exception using errcode = '23505', message = 'identity is already a member of this ledger';
  end if;

  update public.shared_ledger_members m
  set identity_id = v_identity_id,
      status = 'active',
      joined_at = now(),
      left_at = null,
      removed_at = null
  where m.id = v_invitation.member_id
    and m.status = 'invited'
    and m.deleted_at is null
  returning m.id into v_member_id;
  if v_member_id is null then
    raise exception using errcode = '23514', message = 'invited member seat is unavailable';
  end if;

  if v_placeholder_identity_id <> v_identity_id then
    update public.identities i
    set merged_into_identity_id = v_identity_id, claimed_at = now()
    where i.id = v_placeholder_identity_id
      and i.kind = 'placeholder'
      and i.merged_into_identity_id is null;
  end if;

  update public.invitations i
  set use_count = i.use_count + 1,
      consumed_by_identity_id = v_identity_id,
      consumed_at = now()
  where i.id = v_invitation.id;

  return v_member_id;
end;
$$;

create or replace function public.create_shared_entry(
  p_ledger_id uuid,
  p_payer_member_id uuid,
  p_entry_type text,
  p_title text,
  p_description text,
  p_category text,
  p_total_amount_sen bigint,
  p_entry_date date,
  p_lines jsonb,
  p_client_entry_id uuid,
  p_client_event_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor_id uuid;
  v_entry_id uuid;
  v_existing_creator_id uuid;
  v_revision integer := 1;
begin
  perform public.require_authenticated_user();
  perform 1 from public.shared_ledgers l
  where l.id = p_ledger_id and l.deleted_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'ledger not found';
  end if;
  v_actor_id := public.current_member_id(p_ledger_id);
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'active membership required';
  end if;

  select e.id, e.created_by_member_id into v_entry_id, v_existing_creator_id
  from public.shared_entries e
  where e.ledger_id = p_ledger_id and e.client_entry_id = p_client_entry_id;
  if v_entry_id is not null then
    if v_existing_creator_id <> v_actor_id then
      raise exception using errcode = '42501', message = 'entry idempotency key belongs to another creator';
    end if;
    return v_entry_id;
  end if;

  if p_client_entry_id is null or p_client_event_id is null then
    raise exception using errcode = '22023', message = 'entry and event client ids are required';
  end if;
  if p_entry_type is null or p_entry_type not in ('expense', 'income', 'adjustment') then
    raise exception using errcode = '22023', message = 'invalid entry type';
  end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'entry title is required';
  end if;
  if p_total_amount_sen is null or p_total_amount_sen <= 0 or p_entry_date is null then
    raise exception using errcode = '22023', message = 'positive total and entry_date are required';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception using errcode = '22023', message = 'non-empty lines array required';
  end if;
  if not exists (
    select 1 from public.shared_ledger_members m
    where m.id = p_payer_member_id and m.ledger_id = p_ledger_id
      and m.status = 'active' and m.deleted_at is null
  ) then
    raise exception using errcode = '23514', message = 'payer must be an active ledger member';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lines) j
    left join public.shared_ledger_members m
      on m.id = (j->>'member_id')::uuid
      and m.ledger_id = p_ledger_id
      and m.status = 'active'
      and m.deleted_at is null
    where m.id is null
      or (j->>'amount_sen') is null
      or (j->>'amount_sen')::bigint <= 0
      or (j->>'client_line_id') is null
  ) then
    raise exception using errcode = '23514', message = 'every line needs an active member, positive amount, and client id';
  end if;
  if (select count(*) from jsonb_array_elements(p_lines)) <>
     (select count(distinct j->>'member_id') from jsonb_array_elements(p_lines) j)
     or (select count(*) from jsonb_array_elements(p_lines)) <>
        (select count(distinct j->>'client_line_id') from jsonb_array_elements(p_lines) j) then
    raise exception using errcode = '23514', message = 'line members and client ids must be unique';
  end if;
  if (select coalesce(sum((j->>'amount_sen')::bigint), 0) from jsonb_array_elements(p_lines) j)
      <> p_total_amount_sen then
    raise exception using errcode = '23514', message = 'line amounts must equal entry total';
  end if;
  if (select count(*) from jsonb_array_elements(p_lines) j where (j->>'member_id')::uuid = p_payer_member_id) <> 1 then
    raise exception using errcode = '23514', message = 'payer must have exactly one line';
  end if;

  insert into public.shared_entries (
    ledger_id, payer_member_id, created_by_member_id, entry_type, entry_status,
    title, description, category, total_amount_sen, client_entry_id, entry_date
  ) values (
    p_ledger_id, p_payer_member_id, v_actor_id, p_entry_type, 'pending',
    btrim(p_title), p_description, p_category, p_total_amount_sen, p_client_entry_id, p_entry_date
  ) returning id into v_entry_id;

  insert into public.shared_entry_lines (
    entry_id, member_id, amount_sen, response_status, settlement_status,
    accepted_revision, responded_at, confirmed_at, client_line_id
  )
  select
    v_entry_id,
    (j->>'member_id')::uuid,
    (j->>'amount_sen')::bigint,
    case when (j->>'member_id')::uuid = p_payer_member_id and p_payer_member_id = v_actor_id then 'auto_accepted' else 'pending' end,
    case when (j->>'member_id')::uuid = p_payer_member_id and p_payer_member_id = v_actor_id then 'confirmed' else 'unpaid' end,
    case when (j->>'member_id')::uuid = p_payer_member_id and p_payer_member_id = v_actor_id then v_revision else null end,
    case when (j->>'member_id')::uuid = p_payer_member_id and p_payer_member_id = v_actor_id then now() else null end,
    case when (j->>'member_id')::uuid = p_payer_member_id and p_payer_member_id = v_actor_id then now() else null end,
    (j->>'client_line_id')::uuid
  from jsonb_array_elements(p_lines) j;

  insert into public.shared_entry_events (
    entry_id, line_id, actor_member_id, kind, entry_revision, client_event_id, payload
  ) values (
    v_entry_id, null, v_actor_id, 'created', v_revision, p_client_event_id,
    jsonb_build_object('line_count', jsonb_array_length(p_lines), 'total_amount_sen', p_total_amount_sen)
  );

  return v_entry_id;
exception
  when invalid_text_representation then
    raise exception using errcode = '22023', message = 'line ids and amounts must use valid UUID/integer values';
end;
$$;

create or replace function public.respond_to_line(
  p_line_id uuid,
  p_response_status text,
  p_response_note text,
  p_expected_revision integer,
  p_client_event_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_line public.shared_entry_lines%rowtype;
  v_entry public.shared_entries%rowtype;
  v_actor_id uuid;
begin
  perform public.require_authenticated_user();
  select l.* into v_line from public.shared_entry_lines l
  where l.id = p_line_id and l.deleted_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'line not found'; end if;
  select e.* into strict v_entry from public.shared_entries e where e.id = v_line.entry_id for update;
  v_actor_id := public.current_member_id(v_entry.ledger_id);
  if v_actor_id is null or v_actor_id <> v_line.member_id then
    raise exception using errcode = '42501', message = 'only the assigned member may respond';
  end if;
  if p_client_event_id is null or p_response_status is null
     or p_response_status not in ('accepted', 'rejected', 'change_requested') then
    raise exception using errcode = '22023', message = 'valid response and event client id required';
  end if;
  if p_expected_revision is null then
    raise exception using errcode = '22023', message = 'expected revision is required';
  end if;
  if public.shared_event_is_idempotent(v_entry.id, v_line.id, v_actor_id, p_response_status, p_client_event_id) then
    return v_line.id;
  end if;
  if v_entry.entry_status not in ('pending', 'active') or v_entry.revision is distinct from p_expected_revision then
    raise exception using errcode = '40001', message = 'stale revision or entry is not respondable';
  end if;
  if v_line.response_status not in ('pending', 'change_requested') then
    raise exception using errcode = '23514', message = 'line has already been answered';
  end if;

  update public.shared_entry_lines l set
    response_status = p_response_status,
    settlement_status = case
      when v_line.member_id = v_entry.payer_member_id and p_response_status = 'accepted' then 'confirmed'
      else l.settlement_status
    end,
    response_note = nullif(btrim(p_response_note), ''),
    responded_at = now(),
    accepted_revision = case when p_response_status = 'accepted' then v_entry.revision else null end,
    confirmed_at = case
      when v_line.member_id = v_entry.payer_member_id and p_response_status = 'accepted' then now()
      else l.confirmed_at
    end
  where l.id = v_line.id;

  if p_response_status = 'accepted' and not exists (
    select 1 from public.shared_entry_lines l
    where l.entry_id = v_entry.id and l.id <> v_line.id and l.deleted_at is null
      and l.response_status not in ('accepted', 'auto_accepted')
  ) then
    update public.shared_entries e set entry_status = 'active' where e.id = v_entry.id;
  end if;

  insert into public.shared_entry_events (
    entry_id, line_id, actor_member_id, kind, entry_revision, client_event_id, payload
  ) values (
    v_entry.id, v_line.id, v_actor_id, p_response_status, v_entry.revision, p_client_event_id,
    jsonb_build_object('line_id', v_line.id, 'response_status', p_response_status)
  );
  return v_line.id;
end;
$$;

create or replace function public.revise_entry(
  p_entry_id uuid,
  p_title text,
  p_description text,
  p_category text,
  p_total_amount_sen bigint,
  p_lines jsonb,
  p_expected_revision integer,
  p_client_event_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_entry public.shared_entries%rowtype;
  v_actor_id uuid;
  v_new_revision integer;
begin
  perform public.require_authenticated_user();
  select e.* into v_entry from public.shared_entries e where e.id = p_entry_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'entry not found'; end if;
  v_actor_id := public.current_member_id(v_entry.ledger_id);
  if v_actor_id is null or v_actor_id <> v_entry.created_by_member_id then
    raise exception using errcode = '42501', message = 'only the entry creator may revise it';
  end if;
  if p_expected_revision is null then
    raise exception using errcode = '22023', message = 'expected revision is required';
  end if;
  if public.shared_event_is_idempotent(v_entry.id, null, v_actor_id, 'revised', p_client_event_id) then
    return v_entry.revision;
  end if;
  if p_client_event_id is null or v_entry.revision is distinct from p_expected_revision
     or v_entry.entry_status not in ('pending', 'active') then
    raise exception using errcode = '40001', message = 'stale revision or entry is not revisable';
  end if;
  if exists (
    select 1 from public.shared_entry_lines l
    where l.entry_id = v_entry.id
      and not (
        l.member_id = v_entry.payer_member_id
        and v_entry.payer_member_id = v_entry.created_by_member_id
      )
      and l.deleted_at is null
      and l.settlement_status not in ('unpaid', 'reversed')
  ) then
    raise exception using errcode = '23514', message = 'reverse or reopen settlements before revision';
  end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 200
     or p_total_amount_sen is null or p_total_amount_sen <= 0
     or p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception using errcode = '22023', message = 'valid title, total, and complete lines are required';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) j
    left join public.shared_ledger_members m
      on m.id = (j->>'member_id')::uuid and m.ledger_id = v_entry.ledger_id
      and m.status = 'active' and m.deleted_at is null
    where m.id is null or (j->>'amount_sen')::bigint <= 0 or (j->>'client_line_id') is null
  ) then
    raise exception using errcode = '23514', message = 'revised lines must reference active members with positive amounts';
  end if;
  if (select count(*) from jsonb_array_elements(p_lines)) <>
     (select count(distinct j->>'member_id') from jsonb_array_elements(p_lines) j)
     or (select count(*) from jsonb_array_elements(p_lines)) <>
        (select count(distinct j->>'client_line_id') from jsonb_array_elements(p_lines) j)
     or (select sum((j->>'amount_sen')::bigint) from jsonb_array_elements(p_lines) j) <> p_total_amount_sen
     or (select count(*) from jsonb_array_elements(p_lines) j where (j->>'member_id')::uuid = v_entry.payer_member_id) <> 1 then
    raise exception using errcode = '23514', message = 'revised lines must be unique, include payer, and sum to total';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lines) j
    join public.shared_entry_lines existing_line
      on existing_line.entry_id = v_entry.id
     and existing_line.client_line_id = (j->>'client_line_id')::uuid
    where existing_line.member_id <> (j->>'member_id')::uuid
  ) then
    raise exception using
      errcode = '23514',
      message = 'client line id is already bound to a different entry member';
  end if;

  v_new_revision := v_entry.revision + 1;
  update public.shared_entry_lines l set deleted_at = now()
  where l.entry_id = v_entry.id and l.deleted_at is null;

  insert into public.shared_entry_lines (
    entry_id, member_id, amount_sen, response_status, settlement_status,
    accepted_revision, responded_at, confirmed_at, client_line_id, deleted_at
  )
  select
    v_entry.id, (j->>'member_id')::uuid, (j->>'amount_sen')::bigint,
    case when (j->>'member_id')::uuid = v_entry.payer_member_id and v_entry.payer_member_id = v_actor_id then 'auto_accepted' else 'pending' end,
    case when (j->>'member_id')::uuid = v_entry.payer_member_id and v_entry.payer_member_id = v_actor_id then 'confirmed' else 'unpaid' end,
    case when (j->>'member_id')::uuid = v_entry.payer_member_id and v_entry.payer_member_id = v_actor_id then v_new_revision else null end,
    case when (j->>'member_id')::uuid = v_entry.payer_member_id and v_entry.payer_member_id = v_actor_id then now() else null end,
    case when (j->>'member_id')::uuid = v_entry.payer_member_id and v_entry.payer_member_id = v_actor_id then now() else null end,
    (j->>'client_line_id')::uuid, null
  from jsonb_array_elements(p_lines) j
  on conflict (entry_id, member_id) do update set
    amount_sen = excluded.amount_sen,
    response_status = excluded.response_status,
    settlement_status = excluded.settlement_status,
    accepted_revision = excluded.accepted_revision,
    response_note = null,
    responded_at = excluded.responded_at,
    paid_marked_at = null,
    confirmed_at = excluded.confirmed_at,
    waived_at = null,
    reversed_at = null,
    client_line_id = excluded.client_line_id,
    deleted_at = null;

  update public.shared_entries e set
    title = btrim(p_title), description = p_description, category = p_category,
    total_amount_sen = p_total_amount_sen, revision = v_new_revision,
    entry_status = 'pending', settled_at = null
  where e.id = v_entry.id;

  insert into public.shared_entry_events (
    entry_id, line_id, actor_member_id, kind, entry_revision, client_event_id, payload
  ) values (
    v_entry.id, null, v_actor_id, 'revised', v_new_revision, p_client_event_id,
    jsonb_build_object('line_count', jsonb_array_length(p_lines), 'total_amount_sen', p_total_amount_sen)
  );
  return v_new_revision;
exception
  when invalid_text_representation then
    raise exception using errcode = '22023', message = 'revised line ids and amounts must be valid';
end;
$$;

revoke all on function public.require_authenticated_user() from public;
revoke all on function public.shared_event_is_idempotent(uuid, uuid, uuid, text, uuid) from public;
revoke all on function public.ensure_current_identity() from public;
revoke all on function public.create_shared_ledger(text, text, uuid, uuid) from public;
revoke all on function public.invite_member(uuid, text, text, text, timestamptz, uuid) from public;
revoke all on function public.accept_invitation(text) from public;
revoke all on function public.create_shared_entry(uuid, uuid, text, text, text, text, bigint, date, jsonb, uuid, uuid) from public;
revoke all on function public.respond_to_line(uuid, text, text, integer, uuid) from public;
revoke all on function public.revise_entry(uuid, text, text, text, bigint, jsonb, integer, uuid) from public;
revoke all on function public.void_entry(uuid, integer, uuid) from public;
revoke all on function public.mark_line_paid(uuid, integer, uuid) from public;
revoke all on function public.confirm_line_received(uuid, integer, uuid) from public;
revoke all on function public.waive_line(uuid, integer, uuid) from public;
revoke all on function public.reopen_line(uuid, integer, uuid) from public;
revoke all on function public.record_settlement(uuid, uuid, uuid, uuid, uuid, bigint, timestamptz, uuid, uuid) from public;
revoke all on function public.issue_media_url(uuid, text) from public;

grant execute on function public.create_shared_ledger(text, text, uuid, uuid) to authenticated;
grant execute on function public.invite_member(uuid, text, text, text, timestamptz, uuid) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.create_shared_entry(uuid, uuid, text, text, text, text, bigint, date, jsonb, uuid, uuid) to authenticated;
grant execute on function public.respond_to_line(uuid, text, text, integer, uuid) to authenticated;
grant execute on function public.revise_entry(uuid, text, text, text, bigint, jsonb, integer, uuid) to authenticated;
grant execute on function public.void_entry(uuid, integer, uuid) to authenticated;
grant execute on function public.mark_line_paid(uuid, integer, uuid) to authenticated;
grant execute on function public.confirm_line_received(uuid, integer, uuid) to authenticated;
grant execute on function public.waive_line(uuid, integer, uuid) to authenticated;
grant execute on function public.reopen_line(uuid, integer, uuid) to authenticated;
grant execute on function public.record_settlement(uuid, uuid, uuid, uuid, uuid, bigint, timestamptz, uuid, uuid) to authenticated;
grant execute on function public.issue_media_url(uuid, text) to authenticated;

comment on function public.issue_media_url(uuid, text) is
  'Validated fail-closed signature. URL signing is deliberately deferred; this function never returns a permissive placeholder URL.';
