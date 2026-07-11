-- Phase 24D-B rollback (REVIEW BEFORE USE; DO NOT RUN IN PRODUCTION).
-- This destroys only data in the new 24D shared-layer objects. It must never
-- alter or drop any pre-24D RinggitMe table. RPCs are removed first.

drop function if exists public.issue_media_url(uuid, text);
drop function if exists public.record_settlement(uuid, uuid, uuid, uuid, uuid, bigint, timestamptz, uuid, uuid);
drop function if exists public.reopen_line(uuid, integer, uuid);
drop function if exists public.waive_line(uuid, integer, uuid);
drop function if exists public.confirm_line_received(uuid, integer, uuid);
drop function if exists public.mark_line_paid(uuid, integer, uuid);
drop function if exists public.void_entry(uuid, integer, uuid);
drop function if exists public.revise_entry(uuid, text, text, text, bigint, jsonb, integer, uuid);
drop function if exists public.respond_to_line(uuid, text, text, integer, uuid);
drop function if exists public.create_shared_entry(uuid, uuid, text, text, text, text, bigint, date, jsonb, uuid, uuid);
drop function if exists public.accept_invitation(text);
drop function if exists public.invite_member(uuid, text, text, text, timestamptz, uuid);
drop function if exists public.create_shared_ledger(text, text, uuid, uuid);
drop function if exists public.ensure_current_identity();
drop function if exists public.shared_event_is_idempotent(uuid, uuid, uuid, text, uuid);
drop function if exists public.require_authenticated_user();

drop policy if exists shared_media_links_read_authorized on public.shared_media_links;
drop policy if exists shared_media_update_owner on public.shared_media;
drop policy if exists shared_media_insert_owner on public.shared_media;
drop policy if exists shared_media_read_authorized on public.shared_media;
drop policy if exists private_postings_update_owner on public.private_postings;
drop policy if exists private_postings_insert_owner on public.private_postings;
drop policy if exists private_postings_read_owner on public.private_postings;
drop policy if exists shared_settlements_read_member on public.shared_settlements;
drop policy if exists shared_entry_events_read_member on public.shared_entry_events;
drop policy if exists shared_entry_lines_read_member on public.shared_entry_lines;
drop policy if exists shared_entries_read_member on public.shared_entries;
drop policy if exists invitations_read_creator_or_owner on public.invitations;
drop policy if exists shared_ledger_members_read_member on public.shared_ledger_members;
drop policy if exists shared_ledgers_read_member on public.shared_ledgers;
drop policy if exists telegram_identities_read_visible on public.telegram_identities;
drop policy if exists identities_read_visible on public.identities;
drop policy if exists profiles_update_self on public.profiles;
drop policy if exists profiles_insert_self on public.profiles;
drop policy if exists profiles_read_visible on public.profiles;

drop trigger if exists shared_media_touch_updated_at on public.shared_media;
drop trigger if exists private_postings_touch_updated_at on public.private_postings;
drop trigger if exists shared_settlements_touch_updated_at on public.shared_settlements;
drop trigger if exists shared_entry_lines_touch_updated_at on public.shared_entry_lines;
drop trigger if exists shared_entries_touch_updated_at on public.shared_entries;
drop trigger if exists invitations_touch_updated_at on public.invitations;
drop trigger if exists shared_ledger_members_touch_updated_at on public.shared_ledger_members;
drop trigger if exists shared_ledgers_touch_updated_at on public.shared_ledgers;
drop trigger if exists telegram_identities_touch_updated_at on public.telegram_identities;
drop trigger if exists identities_touch_updated_at on public.identities;
drop trigger if exists profiles_touch_updated_at on public.profiles;

drop function if exists public.private_posting_reference_allowed(uuid, uuid, uuid, uuid);
drop function if exists public.can_read_shared_media(uuid);
drop function if exists public.can_read_profile(uuid);
drop function if exists public.can_read_identity(uuid);
drop function if exists public.member_can_read_entry(uuid);
drop function if exists public.is_ledger_owner(uuid);
drop function if exists public.current_member_id(uuid);
drop function if exists public.is_ledger_member(uuid);
drop function if exists public.is_active_ledger_member(uuid);
drop function if exists public.current_identity_id();
drop function if exists public.touch_updated_at();

drop table if exists public.shared_media_links;
drop table if exists public.shared_media;
drop table if exists public.private_postings;
drop table if exists public.shared_settlements;
drop table if exists public.shared_entry_events;
drop table if exists public.shared_entry_lines;
drop table if exists public.shared_entries;
drop table if exists public.invitations;
drop table if exists public.shared_ledger_members;
drop table if exists public.shared_ledgers;
drop table if exists public.telegram_identities;
drop table if exists public.identities;
drop table if exists public.profiles;

drop function if exists public.shared_json_is_account_free(jsonb);

-- pgcrypto is intentionally not dropped: it may predate 24D or serve other code.
