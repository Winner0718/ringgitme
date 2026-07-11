-- Phase 24D-B: helper functions, updated_at triggers, grants, and RLS.

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.current_identity_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select i.id
  from public.identities i
  where i.auth_user_id = auth.uid()
    and i.merged_into_identity_id is null
    and i.deleted_at is null
  order by i.created_at, i.id
  limit 1
$$;

create or replace function public.is_active_ledger_member(p_ledger_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
    from public.shared_ledger_members m
    where m.ledger_id = p_ledger_id
      and m.identity_id = public.current_identity_id()
      and m.status = 'active'
      and m.deleted_at is null
  )
$$;

create or replace function public.is_ledger_member(p_ledger_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
    from public.shared_ledger_members m
    where m.ledger_id = p_ledger_id
      and m.identity_id = public.current_identity_id()
      and m.status in ('placeholder', 'invited', 'active')
      and m.deleted_at is null
  )
$$;

create or replace function public.current_member_id(p_ledger_id uuid)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select m.id
  from public.shared_ledger_members m
  where m.ledger_id = p_ledger_id
    and m.identity_id = public.current_identity_id()
    and m.status = 'active'
    and m.deleted_at is null
  order by m.joined_at, m.id
  limit 1
$$;

create or replace function public.is_ledger_owner(p_ledger_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
    from public.shared_ledger_members m
    where m.ledger_id = p_ledger_id
      and m.identity_id = public.current_identity_id()
      and m.role = 'owner'
      and m.status = 'active'
      and m.deleted_at is null
  )
$$;

create or replace function public.member_can_read_entry(p_entry_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
    from public.shared_entries e
    where e.id = p_entry_id
      and e.deleted_at is null
      and public.is_active_ledger_member(e.ledger_id)
      and (
        public.current_member_id(e.ledger_id) in (e.payer_member_id, e.created_by_member_id)
        or exists (
          select 1 from public.shared_entry_lines l
          where l.entry_id = e.id
            and l.member_id = public.current_member_id(e.ledger_id)
            and l.deleted_at is null
        )
      )
  )
$$;

create or replace function public.can_read_identity(p_identity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select p_identity_id = public.current_identity_id()
    or exists (
      select 1
      from public.shared_ledger_members mine
      join public.shared_ledger_members theirs
        on theirs.ledger_id = mine.ledger_id
      where mine.identity_id = public.current_identity_id()
        and mine.status = 'active'
        and mine.deleted_at is null
        and theirs.identity_id = p_identity_id
        and theirs.deleted_at is null
    )
$$;

create or replace function public.can_read_profile(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select p_user_id = auth.uid()
    or exists (
      select 1
      from public.identities i
      where i.auth_user_id = p_user_id
        and i.deleted_at is null
        and i.merged_into_identity_id is null
        and public.can_read_identity(i.id)
    )
$$;

create or replace function public.can_read_shared_media(p_media_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
    from public.shared_media sm
    where sm.id = p_media_id
      and sm.deleted_at is null
      and (
        sm.owner_user_id = auth.uid()
        or exists (
          select 1
          from public.shared_media_links ml
          left join public.shared_entries e on e.id = ml.entry_id
          left join public.shared_entry_lines line_target on line_target.id = ml.line_id
          left join public.shared_entries line_entry on line_entry.id = line_target.entry_id
          left join public.shared_settlements s on s.id = ml.settlement_id
          where ml.media_id = sm.id
            and ml.deleted_at is null
            and public.is_active_ledger_member(coalesce(e.ledger_id, line_entry.ledger_id, s.ledger_id))
            and (
              (
                ml.visibility = 'entry_participants'
                and (
                  e.payer_member_id = public.current_member_id(e.ledger_id)
                  or e.created_by_member_id = public.current_member_id(e.ledger_id)
                  or line_entry.payer_member_id = public.current_member_id(line_entry.ledger_id)
                  or line_entry.created_by_member_id = public.current_member_id(line_entry.ledger_id)
                  or exists (
                    select 1 from public.shared_entry_lines participant_line
                    where participant_line.entry_id = coalesce(e.id, line_entry.id)
                      and participant_line.member_id = public.current_member_id(coalesce(e.ledger_id, line_entry.ledger_id))
                      and participant_line.deleted_at is null
                  )
                )
              )
              or (
                ml.visibility = 'line_parties'
                and (
                  line_target.member_id = public.current_member_id(line_entry.ledger_id)
                  or line_entry.payer_member_id = public.current_member_id(line_entry.ledger_id)
                  or s.from_member_id = public.current_member_id(s.ledger_id)
                  or s.to_member_id = public.current_member_id(s.ledger_id)
                )
              )
            )
        )
      )
  )
$$;

create or replace function public.private_posting_reference_allowed(
  p_ledger_id uuid,
  p_entry_id uuid,
  p_line_id uuid,
  p_settlement_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select
    (
      p_line_id is not null
      and exists (
        select 1
        from public.shared_entry_lines l
        join public.shared_entries e on e.id = l.entry_id
        where l.id = p_line_id
          and l.deleted_at is null
          and e.deleted_at is null
          and (p_entry_id is null or p_entry_id = e.id)
          and (p_ledger_id is null or p_ledger_id = e.ledger_id)
          and public.current_member_id(e.ledger_id) in (l.member_id, e.payer_member_id)
      )
    )
    or (
      p_settlement_id is not null
      and exists (
        select 1
        from public.shared_settlements s
        where s.id = p_settlement_id
          and s.deleted_at is null
          and (p_entry_id is null or p_entry_id = s.entry_id)
          and (p_ledger_id is null or p_ledger_id = s.ledger_id)
          and public.current_member_id(s.ledger_id) in (s.from_member_id, s.to_member_id)
      )
    )
    or (
      p_line_id is null
      and p_settlement_id is null
      and p_entry_id is not null
      and exists (
        select 1
        from public.shared_entries e
        where e.id = p_entry_id
          and e.deleted_at is null
          and (p_ledger_id is null or p_ledger_id = e.ledger_id)
          and (
            public.current_member_id(e.ledger_id) in (e.payer_member_id, e.created_by_member_id)
            or exists (
              select 1 from public.shared_entry_lines l
              where l.entry_id = e.id
                and l.member_id = public.current_member_id(e.ledger_id)
                and l.deleted_at is null
            )
          )
      )
    )
$$;

revoke all on function public.shared_json_is_account_free(jsonb) from public;
revoke all on function public.touch_updated_at() from public;
revoke all on function public.current_identity_id() from public;
revoke all on function public.is_active_ledger_member(uuid) from public;
revoke all on function public.is_ledger_member(uuid) from public;
revoke all on function public.current_member_id(uuid) from public;
revoke all on function public.is_ledger_owner(uuid) from public;
revoke all on function public.member_can_read_entry(uuid) from public;
revoke all on function public.can_read_identity(uuid) from public;
revoke all on function public.can_read_profile(uuid) from public;
revoke all on function public.can_read_shared_media(uuid) from public;
revoke all on function public.private_posting_reference_allowed(uuid, uuid, uuid, uuid) from public;

grant execute on function public.current_identity_id() to authenticated;
grant execute on function public.shared_json_is_account_free(jsonb) to authenticated;
grant execute on function public.is_active_ledger_member(uuid) to authenticated;
grant execute on function public.is_ledger_member(uuid) to authenticated;
grant execute on function public.current_member_id(uuid) to authenticated;
grant execute on function public.is_ledger_owner(uuid) to authenticated;
grant execute on function public.member_can_read_entry(uuid) to authenticated;
grant execute on function public.can_read_identity(uuid) to authenticated;
grant execute on function public.can_read_profile(uuid) to authenticated;
grant execute on function public.can_read_shared_media(uuid) to authenticated;
grant execute on function public.private_posting_reference_allowed(uuid, uuid, uuid, uuid) to authenticated;

create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();
create trigger identities_touch_updated_at before update on public.identities
for each row execute function public.touch_updated_at();
create trigger telegram_identities_touch_updated_at before update on public.telegram_identities
for each row execute function public.touch_updated_at();
create trigger shared_ledgers_touch_updated_at before update on public.shared_ledgers
for each row execute function public.touch_updated_at();
create trigger shared_ledger_members_touch_updated_at before update on public.shared_ledger_members
for each row execute function public.touch_updated_at();
create trigger invitations_touch_updated_at before update on public.invitations
for each row execute function public.touch_updated_at();
create trigger shared_entries_touch_updated_at before update on public.shared_entries
for each row execute function public.touch_updated_at();
create trigger shared_entry_lines_touch_updated_at before update on public.shared_entry_lines
for each row execute function public.touch_updated_at();
create trigger shared_settlements_touch_updated_at before update on public.shared_settlements
for each row execute function public.touch_updated_at();
create trigger private_postings_touch_updated_at before update on public.private_postings
for each row execute function public.touch_updated_at();
create trigger shared_media_touch_updated_at before update on public.shared_media
for each row execute function public.touch_updated_at();

-- ENABLE (without FORCE) keeps every normal authenticated client under RLS
-- while allowing table-owner SECURITY DEFINER RPCs to perform their validated
-- internal mutations without depending on the deployment role having BYPASSRLS.
alter table public.profiles enable row level security;
alter table public.identities enable row level security;
alter table public.telegram_identities enable row level security;
alter table public.shared_ledgers enable row level security;
alter table public.shared_ledger_members enable row level security;
alter table public.invitations enable row level security;
alter table public.shared_entries enable row level security;
alter table public.shared_entry_lines enable row level security;
alter table public.shared_entry_events enable row level security;
alter table public.shared_settlements enable row level security;
alter table public.private_postings enable row level security;
alter table public.shared_media enable row level security;
alter table public.shared_media_links enable row level security;

create policy profiles_read_visible on public.profiles for select to authenticated
using (public.can_read_profile(id));
create policy profiles_insert_self on public.profiles for insert to authenticated
with check (id = auth.uid());
create policy profiles_update_self on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

create policy identities_read_visible on public.identities for select to authenticated
using (public.can_read_identity(id));

create policy telegram_identities_read_visible on public.telegram_identities for select to authenticated
using (public.can_read_identity(identity_id));

create policy shared_ledgers_read_member on public.shared_ledgers for select to authenticated
using (deleted_at is null and public.is_active_ledger_member(id));

create policy shared_ledger_members_read_member on public.shared_ledger_members for select to authenticated
using (public.is_active_ledger_member(ledger_id));

create policy invitations_read_creator_or_owner on public.invitations for select to authenticated
using (
  created_by = public.current_member_id(ledger_id)
  or public.is_ledger_owner(ledger_id)
);

create policy shared_entries_read_member on public.shared_entries for select to authenticated
using (deleted_at is null and public.member_can_read_entry(id));

create policy shared_entry_lines_read_member on public.shared_entry_lines for select to authenticated
using (deleted_at is null and public.member_can_read_entry(entry_id));

create policy shared_entry_events_read_member on public.shared_entry_events for select to authenticated
using (public.member_can_read_entry(entry_id));

create policy shared_settlements_read_member on public.shared_settlements for select to authenticated
using (
  deleted_at is null
  and public.current_member_id(ledger_id) in (from_member_id, to_member_id)
);

create policy private_postings_read_owner on public.private_postings for select to authenticated
using (owner_user_id = auth.uid());
create policy private_postings_insert_owner on public.private_postings for insert to authenticated
with check (
  owner_user_id = auth.uid()
  and public.private_posting_reference_allowed(ledger_id, entry_id, line_id, settlement_id)
);
create policy private_postings_update_owner on public.private_postings for update to authenticated
using (owner_user_id = auth.uid())
with check (
  owner_user_id = auth.uid()
  and public.private_posting_reference_allowed(ledger_id, entry_id, line_id, settlement_id)
);

create policy shared_media_read_authorized on public.shared_media for select to authenticated
using (public.can_read_shared_media(id));
create policy shared_media_insert_owner on public.shared_media for insert to authenticated
with check (owner_user_id = auth.uid());
create policy shared_media_update_owner on public.shared_media for update to authenticated
using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

create policy shared_media_links_read_authorized on public.shared_media_links for select to authenticated
using (deleted_at is null and public.can_read_shared_media(media_id));

revoke all on table public.profiles from public, anon, authenticated;
revoke all on table public.identities from public, anon, authenticated;
revoke all on table public.telegram_identities from public, anon, authenticated;
revoke all on table public.shared_ledgers from public, anon, authenticated;
revoke all on table public.shared_ledger_members from public, anon, authenticated;
revoke all on table public.invitations from public, anon, authenticated;
revoke all on table public.shared_entries from public, anon, authenticated;
revoke all on table public.shared_entry_lines from public, anon, authenticated;
revoke all on table public.shared_entry_events from public, anon, authenticated;
revoke all on table public.shared_settlements from public, anon, authenticated;
revoke all on table public.private_postings from public, anon, authenticated;
revoke all on table public.shared_media from public, anon, authenticated;
revoke all on table public.shared_media_links from public, anon, authenticated;

grant select, insert, update on table public.profiles to authenticated;
grant select on table public.identities to authenticated;
grant select on table public.telegram_identities to authenticated;
grant select on table public.shared_ledgers to authenticated;
grant select on table public.shared_ledger_members to authenticated;
grant select (
  id, ledger_id, member_id, created_by, method, expires_at,
  max_uses, use_count, consumed_at, revoked_at, created_at, updated_at
) on table public.invitations to authenticated;
grant select on table public.shared_entries to authenticated;
grant select on table public.shared_entry_lines to authenticated;
grant select on table public.shared_entry_events to authenticated;
grant select on table public.shared_settlements to authenticated;
grant select, insert, update on table public.private_postings to authenticated;
grant select, insert, update on table public.shared_media to authenticated;
grant select on table public.shared_media_links to authenticated;

comment on policy private_postings_read_owner on public.private_postings is
  'Strict owner-only local posting and account snapshot boundary.';
comment on policy shared_entry_events_read_member on public.shared_entry_events is
  'Events are readable to active members but remain RPC-only append and immutable to authenticated clients.';
