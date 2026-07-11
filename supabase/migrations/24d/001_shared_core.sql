-- Phase 24D-B: additive multi-user shared-ledger core.
-- This migration deliberately does not alter any pre-24D table.

create extension if not exists pgcrypto;

create or replace function public.shared_json_is_account_free(p_document jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_key text;
  v_value jsonb;
  v_type text;
  v_normalized_key text;
begin
  -- SQL NULL and JSON scalar values contain no keys and are safe to inspect.
  if p_document is null then
    return true;
  end if;

  v_type := jsonb_typeof(p_document);
  if v_type is null then
    return false;
  end if;

  if v_type = 'object' then
    for v_key, v_value in select key, value from jsonb_each(p_document)
    loop
      v_normalized_key := regexp_replace(lower(v_key), '[^a-z0-9]', '', 'g');
      if v_normalized_key = ''
         or v_normalized_key ~ '(account|card|wallet|bank|iban)'
         or v_normalized_key = any (array['payname', 'payid', 'last4']) then
        return false;
      end if;
      if not public.shared_json_is_account_free(v_value) then
        return false;
      end if;
    end loop;
  elsif v_type = 'array' then
    for v_value in select value from jsonb_array_elements(p_document)
    loop
      if not public.shared_json_is_account_free(v_value) then
        return false;
      end if;
    end loop;
  elsif v_type not in ('string', 'number', 'boolean', 'null') then
    -- jsonb currently has no other types; fail closed if PostgreSQL adds one.
    return false;
  end if;
  return true;
end;
$$;

comment on function public.shared_json_is_account_free(jsonb) is
  'Recursively rejects normalized account/card/wallet/bank/IBAN identity keys from canonical shared JSON. Shared JSON must never contain private payment-account metadata; private snapshots belong only in private_postings.';

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  avatar_url text,
  locale text not null default 'zh-MY' check (length(locale) between 2 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (deleted_at is null or deleted_at >= created_at)
);

create table public.identities (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('app_user', 'telegram', 'placeholder')),
  auth_user_id uuid references auth.users(id) on delete restrict,
  telegram_user_id bigint,
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  created_by uuid not null references auth.users(id) on delete restrict,
  merged_into_identity_id uuid references public.identities(id) on delete restrict,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (merged_into_identity_id is null or merged_into_identity_id <> id),
  check (kind <> 'app_user' or auth_user_id is not null),
  check (kind <> 'telegram' or telegram_user_id is not null),
  check (deleted_at is null or deleted_at >= created_at)
);

create unique index identities_active_auth_user_uidx
  on public.identities(auth_user_id)
  where auth_user_id is not null
    and merged_into_identity_id is null
    and deleted_at is null;

create unique index identities_active_telegram_user_uidx
  on public.identities(telegram_user_id)
  where telegram_user_id is not null
    and merged_into_identity_id is null
    and deleted_at is null;

create table public.telegram_identities (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references public.identities(id) on delete restrict,
  telegram_user_id bigint not null,
  chat_id bigint,
  username text,
  first_name text,
  last_name text,
  linked_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (telegram_user_id),
  unique (identity_id),
  check (revoked_at is null or revoked_at >= linked_at)
);

comment on table public.telegram_identities is
  'Worker-owned verified Telegram identity facts. Authenticated clients receive no mutation grant.';

create table public.shared_ledgers (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('pair', 'group')),
  status text not null default 'active' check (status in ('active', 'deleted')),
  title text not null check (length(btrim(title)) between 1 and 160),
  currency char(3) not null default 'MYR' check (currency = upper(currency)),
  created_by uuid not null references auth.users(id) on delete restrict,
  client_ledger_id uuid not null,
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (created_by, client_ledger_id),
  check ((status = 'deleted') = (deleted_at is not null)),
  check (deleted_at is null or deleted_at >= created_at)
);

create table public.shared_ledger_members (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.shared_ledgers(id) on delete restrict,
  identity_id uuid not null references public.identities(id) on delete restrict,
  role text not null check (role in ('owner', 'member')),
  status text not null default 'placeholder' check (status in ('placeholder', 'invited', 'active', 'left', 'removed')),
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  invited_by uuid references public.shared_ledger_members(id) on delete restrict,
  client_member_id uuid not null,
  joined_at timestamptz,
  left_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (ledger_id, id),
  unique (ledger_id, client_member_id),
  foreign key (ledger_id, invited_by)
    references public.shared_ledger_members(ledger_id, id) on delete restrict,
  check (status <> 'active' or joined_at is not null),
  check (status <> 'left' or left_at is not null),
  check (status <> 'removed' or removed_at is not null),
  check (deleted_at is null or deleted_at >= created_at)
);

create unique index shared_ledger_members_active_identity_uidx
  on public.shared_ledger_members(ledger_id, identity_id)
  where status in ('placeholder', 'invited', 'active') and deleted_at is null;

create index shared_ledger_members_identity_idx
  on public.shared_ledger_members(identity_id, ledger_id)
  where status = 'active' and deleted_at is null;

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.shared_ledgers(id) on delete restrict,
  member_id uuid not null references public.shared_ledger_members(id) on delete restrict,
  created_by uuid not null references public.shared_ledger_members(id) on delete restrict,
  method text not null check (method in ('code', 'link', 'qr', 'telegram', 'contact')),
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  max_uses integer not null default 1 check (max_uses = 1),
  use_count integer not null default 0 check (use_count between 0 and max_uses),
  consumed_by_identity_id uuid references public.identities(id) on delete restrict,
  consumed_at timestamptz,
  revoked_at timestamptz,
  promo jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (ledger_id, member_id)
    references public.shared_ledger_members(ledger_id, id) on delete restrict,
  foreign key (ledger_id, created_by)
    references public.shared_ledger_members(ledger_id, id) on delete restrict,
  check ((consumed_at is null) = (consumed_by_identity_id is null)),
  check (jsonb_typeof(promo) = 'object'),
  check (public.shared_json_is_account_free(promo)),
  check (expires_at > created_at),
  check (revoked_at is null or revoked_at >= created_at)
);

create unique index invitations_open_code_hash_uidx
  on public.invitations(code_hash)
  where revoked_at is null and consumed_at is null;

create index invitations_ledger_idx on public.invitations(ledger_id, created_at desc);

create table public.shared_entries (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.shared_ledgers(id) on delete restrict,
  payer_member_id uuid not null references public.shared_ledger_members(id) on delete restrict,
  created_by_member_id uuid not null references public.shared_ledger_members(id) on delete restrict,
  entry_type text not null default 'expense' check (entry_type in ('expense', 'income', 'adjustment')),
  entry_status text not null default 'pending' check (entry_status in ('pending', 'active', 'settled', 'voided')),
  title text not null check (length(btrim(title)) between 1 and 200),
  description text,
  category text,
  currency char(3) not null default 'MYR' check (currency = upper(currency)),
  total_amount_sen bigint not null check (total_amount_sen > 0),
  total_visible boolean not null default true,
  revision integer not null default 1 check (revision >= 1),
  client_entry_id uuid not null,
  entry_date date not null,
  settled_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (ledger_id, id),
  unique (ledger_id, client_entry_id),
  foreign key (ledger_id, payer_member_id)
    references public.shared_ledger_members(ledger_id, id) on delete restrict,
  foreign key (ledger_id, created_by_member_id)
    references public.shared_ledger_members(ledger_id, id) on delete restrict,
  check ((entry_status = 'voided') = (voided_at is not null)),
  check (deleted_at is null or deleted_at >= created_at)
);

create index shared_entries_ledger_status_idx
  on public.shared_entries(ledger_id, entry_status, entry_date desc)
  where deleted_at is null;

create table public.shared_entry_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.shared_entries(id) on delete restrict,
  member_id uuid not null references public.shared_ledger_members(id) on delete restrict,
  amount_sen bigint not null check (amount_sen > 0),
  response_status text not null default 'pending'
    check (response_status in ('pending', 'accepted', 'rejected', 'change_requested', 'auto_accepted')),
  settlement_status text not null default 'unpaid'
    check (settlement_status in ('unpaid', 'paid_pending_confirmation', 'confirmed', 'waived', 'reversed')),
  accepted_revision integer check (accepted_revision is null or accepted_revision >= 1),
  response_note text,
  responded_at timestamptz,
  paid_marked_at timestamptz,
  confirmed_at timestamptz,
  waived_at timestamptz,
  reversed_at timestamptz,
  client_line_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (entry_id, id),
  unique (entry_id, member_id),
  unique (entry_id, client_line_id),
  check ((response_status in ('accepted', 'auto_accepted')) = (accepted_revision is not null)),
  check (deleted_at is null or deleted_at >= created_at)
);

create index shared_entry_lines_member_idx
  on public.shared_entry_lines(member_id, settlement_status)
  where deleted_at is null;

create table public.shared_entry_events (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.shared_entries(id) on delete restrict,
  line_id uuid references public.shared_entry_lines(id) on delete restrict,
  actor_member_id uuid not null references public.shared_ledger_members(id) on delete restrict,
  kind text not null check (kind in (
    'created', 'revised', 'accepted', 'rejected', 'change_requested',
    'marked_paid', 'confirmed_received', 'proof_attached', 'waived',
    'reopened', 'voided', 'comment', 'reminder', 'settlement_recorded'
  )),
  entry_revision integer not null check (entry_revision >= 1),
  client_event_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (entry_id, client_event_id),
  foreign key (entry_id, line_id)
    references public.shared_entry_lines(entry_id, id) on delete restrict,
  check (jsonb_typeof(payload) = 'object'),
  check (public.shared_json_is_account_free(payload))
);

create index shared_entry_events_entry_idx
  on public.shared_entry_events(entry_id, created_at, id);

comment on table public.shared_entry_events is
  'Append-only canonical audit events. Direct authenticated inserts, updates, and deletes are not granted.';

create table public.shared_settlements (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.shared_ledgers(id) on delete restrict,
  from_member_id uuid not null references public.shared_ledger_members(id) on delete restrict,
  to_member_id uuid not null references public.shared_ledger_members(id) on delete restrict,
  entry_id uuid references public.shared_entries(id) on delete restrict,
  line_id uuid references public.shared_entry_lines(id) on delete restrict,
  amount_sen bigint not null check (amount_sen > 0),
  currency char(3) not null default 'MYR' check (currency = upper(currency)),
  status text not null default 'recorded' check (status in ('recorded', 'confirmed', 'reversed')),
  recorded_by_member_id uuid not null references public.shared_ledger_members(id) on delete restrict,
  client_settlement_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  confirmed_at timestamptz,
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (ledger_id, client_settlement_id),
  foreign key (ledger_id, from_member_id)
    references public.shared_ledger_members(ledger_id, id) on delete restrict,
  foreign key (ledger_id, to_member_id)
    references public.shared_ledger_members(ledger_id, id) on delete restrict,
  foreign key (ledger_id, recorded_by_member_id)
    references public.shared_ledger_members(ledger_id, id) on delete restrict,
  foreign key (ledger_id, entry_id)
    references public.shared_entries(ledger_id, id) on delete restrict,
  foreign key (entry_id, line_id)
    references public.shared_entry_lines(entry_id, id) on delete restrict,
  check (from_member_id <> to_member_id),
  check (line_id is null or entry_id is not null),
  check (jsonb_typeof(metadata) = 'object'),
  check (public.shared_json_is_account_free(metadata)),
  check (deleted_at is null or deleted_at >= created_at)
);

create index shared_settlements_ledger_idx
  on public.shared_settlements(ledger_id, occurred_at desc)
  where deleted_at is null;

comment on table public.shared_settlements is
  'Canonical shared settlement fact only. It intentionally contains no bank, card, wallet, or local account identity.';

create table public.private_postings (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  ledger_id uuid references public.shared_ledgers(id) on delete restrict,
  entry_id uuid references public.shared_entries(id) on delete restrict,
  line_id uuid references public.shared_entry_lines(id) on delete restrict,
  settlement_id uuid references public.shared_settlements(id) on delete restrict,
  posting_kind text not null check (posting_kind in ('payer_payment', 'debtor_payment', 'creditor_receipt')),
  amount_sen bigint not null check (amount_sen <> 0),
  currency char(3) not null default 'MYR' check (currency = upper(currency)),
  local_txn_id text,
  account_snapshot jsonb not null check (jsonb_typeof(account_snapshot) = 'object'),
  client_posting_id uuid not null,
  occurred_at timestamptz not null,
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (owner_user_id, client_posting_id),
  check (num_nonnulls(entry_id, line_id, settlement_id) >= 1),
  check (num_nonnulls(line_id, settlement_id) <= 1),
  check (deleted_at is null or deleted_at >= created_at)
);

create unique index private_postings_active_line_uidx
  on public.private_postings(owner_user_id, line_id, posting_kind)
  where line_id is not null and reversed_at is null and deleted_at is null;

create unique index private_postings_active_settlement_uidx
  on public.private_postings(owner_user_id, settlement_id, posting_kind)
  where settlement_id is not null and reversed_at is null and deleted_at is null;

comment on column public.private_postings.account_snapshot is
  'The sole 24D canonical location for an owner-private local account/card/wallet identity snapshot.';

create table public.shared_media (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  storage_path text not null check (length(btrim(storage_path)) between 1 and 1024),
  mime text not null check (length(btrim(mime)) between 1 and 200),
  byte_size bigint not null check (byte_size >= 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  client_media_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (owner_user_id, client_media_id),
  unique (owner_user_id, sha256),
  unique (storage_path),
  check (jsonb_typeof(metadata) = 'object'),
  check (public.shared_json_is_account_free(metadata)),
  check (deleted_at is null or deleted_at >= created_at)
);

create table public.shared_media_links (
  id uuid primary key default gen_random_uuid(),
  media_id uuid not null references public.shared_media(id) on delete restrict,
  entry_id uuid references public.shared_entries(id) on delete restrict,
  line_id uuid references public.shared_entry_lines(id) on delete restrict,
  settlement_id uuid references public.shared_settlements(id) on delete restrict,
  visibility text not null check (visibility in ('entry_participants', 'line_parties', 'owner_only')),
  created_by_member_id uuid not null references public.shared_ledger_members(id) on delete restrict,
  client_link_id uuid not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (media_id, client_link_id),
  check (num_nonnulls(entry_id, line_id, settlement_id) = 1),
  check (deleted_at is null or deleted_at >= created_at)
);

create index shared_media_links_media_idx
  on public.shared_media_links(media_id)
  where deleted_at is null;

comment on table public.shared_media_links is
  'A media object links to exactly one canonical shared target; access is resolved from target membership and visibility.';
