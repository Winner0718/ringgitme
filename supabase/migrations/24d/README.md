# Phase 24D-B shared-ledger SQL foundation

Status: implementation files with a recorded successful disposable scratch validation below. No production database deployment has occurred.

## Architecture

This is an additive shared canonical layer. It does not alter the existing owner-local RinggitMe tables. Shared ledgers, members, entries, lines, events, settlements, invitations, and media links contain collaboration facts. Personal account/card/wallet projections remain owner-private in `private_postings`; `account_snapshot` exists only there.

Amounts are integer sen. Financial and audit foreign keys use restrictive deletion. Shared mutations are RPC-only. RLS reads are active-membership based, event rows are append-only, invitation raw codes are never stored, and normal authenticated clients cannot forge Telegram verification facts.

## Files and review order

1. `001_shared_core.sql` — 13 additive tables, constraints, indexes, and the shared-JSON privacy check.
2. `002_shared_rls.sql` — helper functions, timestamp triggers, explicit grants, and enabled RLS policies.
3. `003_shared_rpcs.sql` — authenticated `SECURITY DEFINER` mutations and fail-closed media URL signature.
4. `004_app_identity_bootstrap.sql` — idempotent current-user profile and `app_user` identity bootstrap; no shared financial writes.
5. `005_shared_invitations_membership.sql` — invitation rejection state, deleted-ledger acceptance fix, and preview/accept/reject/revoke/re-invite/remove lifecycle RPCs.
6. `006_pgcrypto_digest_qualification_fix.sql` — disposable-scratch repair only for a database that already installed the pre-fix 005; never part of the clean deployment path.
7. `007_reject_invitation_replay_fix.sql` — disposable-scratch repair only for the already-installed 005+006 reject RPC; never part of the clean deployment path.
8. `900_persona_probe.sql` — psql-oriented, transactional 001–003 scratch-project probe only; never a production migration.
9. `901_persona_probe_dashboard.sql` — pure-SQL Dashboard version of the 001–003 persona probe; scratch only.
10. `902_app_identity_bootstrap_probe_dashboard.sql` — pure-SQL Dashboard probe for 004; scratch only.
11. `903_invitations_membership_probe_dashboard.sql` — pure-SQL Dashboard probe for 005; scratch only.
12. `904_INVITATION_CONCURRENCY_RUNBOOK.md` — exact two-session scratch races for accept/accept, first-identity accept/reject, accept/revoke, and accept/remove.
13. `905_INVITATION_TERMINAL_PREFLIGHT_RUNBOOK.md` — pre-005 legacy conflict and clean-data preflight verification; scratch only.
14. `999_rollback.sql` — destructive rollback for the new 24D objects only.

Production migration tooling must include only corrected 001–005, after independent SQL/security review. Do not put 006, 007, 900–905, or 999 into an automatic production migration sequence. In particular, do not run 006 or 007 on production unless it receives a separate, production-specific review.

## Phase 24D-C app identity bootstrap

`004_app_identity_bootstrap.sql` adds one authenticated RPC that ensures the current Auth user has one profile and one active `app_user` identity. Suggested display name, avatar, and locale values apply only when the profile is missing. Existing profile fields are never overwritten, so user-edited profile data remains authoritative. Repeated and concurrent calls converge on the existing active-auth-user unique index and return the same identity.

The RPC derives ownership exclusively from `auth.uid()` and rejects a conflicting active identity kind. It does not accept another user's UUID and does not write ledgers, memberships, entries, lines, events, settlements, private postings, accounts, balances, Worker data, or Telegram data.

The app foundation may ship before 004 is deployed. In that order, the client classifies a genuinely missing RPC as `not_deployed`, keeps existing private sync and app startup non-blocking, and retries only transient failures within a bounded session budget. Apply 004 only through a separately approved database deployment; this repository task does not execute it.

## Scratch-project dry run (examples only)

These commands are documentation, not commands executed during this task. Use a disposable Supabase project or isolated local Supabase stack with no customer data. Inspect the target connection before every command.

```sh
# Example local-only order; supply a scratch connection explicitly.
psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/24d/001_shared_core.sql
psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/24d/002_shared_rls.sql
psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/24d/003_shared_rpcs.sql
psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/24d/004_app_identity_bootstrap.sql
psql "$SCRATCH_DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  --single-transaction \
  -f supabase/migrations/24d/005_shared_invitations_membership.sql
```

Run versioned probes at their matching boundary: 900/901 immediately after 003, 902 after 004, the 905 legacy preflight runbook before 005 on its own disposable fixture, and 903 plus the 904 race runbook after 005. The 005 accept RPC retains the exact legacy input name `p_code_hash` because PostgreSQL cannot rename an existing input through `CREATE OR REPLACE FUNCTION`. Despite that legacy name, the value supplied after 005 is the **raw invitation code**, never a caller-computed digest. The function trims and hashes it server-side. Older 900/901 acceptance fixtures belong to the 001–003 boundary and must not be used as post-005 examples.

Alternative Supabase CLI commands, again examples only:

```sh
supabase start
supabase db reset --local
```

Do not use `supabase db push`, `supabase migration up`, or a production SQL editor for this review phase.

## Scratch validation — 11/07/2026

Result: **PASS**

The following files were manually executed in order in a disposable Supabase scratch project only:

1. `001_shared_core.sql`
2. `002_shared_rls.sql`
3. `003_shared_rpcs.sql`
4. `901_persona_probe_dashboard.sql` in Supabase Dashboard SQL Editor using Role `postgres`

All 13 required tables were verified present. The RLS and RPC files completed successfully. The Dashboard persona probe completed all assertions with no `PERSONA PROBE FAILED` error, then executed its final transaction rollback; no probe fixture data was retained. The scratch project used three fake Auth users only.

`900_persona_probe.sql` remains the canonical psql probe. `901_persona_probe_dashboard.sql` is the Dashboard-compatible probe used for this validation.

This is evidence of a disposable scratch validation only. It is not production deployment approval, and the production RinggitMe Supabase project was never contacted or modified.

The recorded 11/07/2026 validation above predates 004 and therefore covers only 001–003 plus 901. Phase 24D-C validation is recorded separately below.

## Phase 24D-C scratch validation — 11/07/2026

Result: **PASS**

The existing disposable scratch project already had 001, 002, and 003 applied. `004_app_identity_bootstrap.sql` then executed successfully using Role `postgres`, followed by `902_app_identity_bootstrap_probe_dashboard.sql` in Supabase Dashboard SQL Editor using Role `postgres`.

All `identity_probe_assert` checks completed with no `PERSONA PROBE FAILED` or other SQL error. The probe's final `ROLLBACK` executed and retained no probe fixtures. This validation used a disposable scratch project only; production RinggitMe Supabase was never contacted or modified, and the App Supabase URL/key were not changed.

This is not production deployment approval. Production deployment of 001–004 remains a separate, explicitly approved decision.

## Phase 24D-D1 invitation and membership lifecycle

`005_shared_invitations_membership.sql` is a versioned one-shot migration. It is intentionally not safely rerunnable and must execute atomically: it must succeed completely or roll back completely. The direct `psql` example therefore requires both `ON_ERROR_STOP=1` and `--single-transaction`. Never paste or execute only part of 005, and never continue after an error. If execution status or transaction guarantees are uncertain, do not rerun blindly: inspect migration history and object state first, then use the reviewed rollback or a separately reviewed repair migration.

Supabase installs pgcrypto in the `extensions` schema. Every Phase 24D digest call therefore uses `extensions.digest(convert_to(text_value, 'UTF8'), 'sha256')` inside `encode(..., 'hex')`; no function or probe depends on `search_path` containing `extensions`. This is especially important for the D1 `SECURITY DEFINER` functions, whose hardened search paths remain `pg_catalog, public, pg_temp`.

For Supabase Dashboard SQL Editor, paste one batch containing `BEGIN;`, the complete unmodified contents of 005, and `COMMIT;` in that order. Do not select or run only part of the batch. Stop immediately on any error, run `ROLLBACK;` in that tab before reusing it, and confirm from a fresh administrator tab that the transaction rolled back before considering a reviewed repair or rollback. Dashboard execution without that explicit wrapper is not an approved installation method for 005.

Before installing the stronger mutually-exclusive terminal-state CHECK, 005 performs a fail-loud preflight for legacy rows with more than one of `consumed_at`, `rejected_at`, and `revoked_at`. This matters because 001 allowed `consumed_at + revoked_at`. The preflight reports the conflict count and at most 20 safe invitation UUIDs, never a digest or raw code, then stops with a remediation instruction. It never rewrites history. Production deployment requires zero conflicts. The 905 scratch runbook proves both the conflict and clean-data paths.

005 adds rejection timestamps/actor linkage plus mutually exclusive consumed, rejected, and revoked terminal states. It replaces `accept_invitation(text)` while retaining the exact 003 input name `p_code_hash`; after 005 that legacy-named parameter carries the raw bearer code and is normalized and SHA-256 hashed inside the function. Acceptance now verifies the current active, unmerged, non-deleted `app_user`, then uses the common ledger → invitation → exact member seat → placeholder identity lock order and verifies the ledger is active and non-deleted before binding the assigned seat.

The D1 RPC boundary supports:

- `inspect_invitation(text)` — authenticated raw-bearer preview; an open invitation returns exactly `ledger_kind`, `ledger_title`, `inviter_display_name`, `assigned_member_display_name`, `expires_at`, and `can_accept`. Missing, expired, rejected, revoked, consumed, deleted-ledger, removed-seat, active-seat, and otherwise unavailable cases all raise the same generic `invitation unavailable` response with no metadata or terminal-state distinction;
- `accept_invitation` — exact-seat claim by the caller's stable `app_user` identity;
- `reject_invitation(text)` — terminal rejection and `invited → placeholder` by an authenticated, active/unmerged/non-deleted `app_user` who possesses the raw code and is **not already an active member of that ledger**;
- `revoke_invitation(uuid, bigint)` — active-owner revocation with ledger-revision protection and one generic unauthorized/not-found response for guessed invitation UUIDs;
- `create_member_invitation` — active-owner re-invite of the same history-free placeholder seat using the client invitation UUID as the idempotency key;
- `remove_unclaimed_member(uuid, uuid, bigint)` — active-owner tombstoning of a history-free placeholder/invited seat.

`reject_invitation`, `revoke_invitation`, and `remove_unclaimed_member` have no unused client-event parameter. Their safe retries are state-based: a consistent terminal retry returns the current result without another ledger-revision increment or event row. For rejection specifically, only the same rejecting identity receives the safe result, and only while the invitation remains exclusively rejected and its exact assigned member seat remains a live, never-joined, history-free placeholder backed by an unclaimed placeholder identity with no Auth or Telegram linkage. The history guard preserves all entry payer/creator, entry-line member, entry-event actor, settlement-party/recorder, and consumed-invitation references, including soft-deleted, voided, or reversed rows. A different identity, a history-bearing seat, a Telegram-linked placeholder, or any other inconsistent rejected state receives the generic `invitation unavailable` outcome with no mutation or metadata. An unexpectedly still-`invited` seat is not normalized by replay; the RPC remains mutation-free and fails closed for explicit state review. `create_member_invitation` instead uses `p_client_invitation_id` as its row/payload idempotency key.

Rejection treats possession of the raw code as a bearer capability. A leaked code can therefore let a different authenticated non-member invalidate the invitation, although it cannot claim a different seat or alter an active member. The owner can recover by re-inviting the same seat. High-entropy client generation is mandatory, and production still needs rate limiting and abuse monitoring. Do not describe the rule as “any authenticated user”: existing active members of that ledger are excluded.

Active seats are never replaceable or removable in D1. Rejected/revoked history is retained, no shared bill/debt/entry event is created, and no private posting/account data is read or written. Owner-side creation accepts only a lowercase SHA-256 hash. Raw-code generation remains client-side for D2; the database stores only `code_hash`, and these SQL functions do not store, return, insert into events/notices/errors, or explicitly log the raw bearer value.

That source-level guarantee is not an end-to-end logging guarantee. Production approval still requires verification that API request-body logging is redacted or disabled for these RPCs, database statement/bind-parameter logging is safe, and client telemetry, crash reports, and exception logs never record RPC arguments.

`903_invitations_membership_probe_dashboard.sql` is the Role `postgres`, Dashboard-compatible, disposable-scratch probe for D1. It uses fake UUIDs only, verifies exact PUBLIC denials/authenticated grants and absence of broad mutation grants, open-preview field whitelisting, one generic metadata-free outcome across seven unavailable states, independently isolated otherwise-open active-seat and removed/deleted-seat preview denials with exact before/after row snapshots, NULL/stale revisions, owner/non-owner scope, owner/active/history-seat guards, mismatched idempotency payloads, active-invitation duplication, raw-looking hash rejection, adversarial non-`app_user` identity rejection, the active-member rejection exclusion, non-member bearer rejection, same-actor rejection replay, generic different-actor rejection denial, rejected-code acceptance denial, exact-seat re-invite, UUID-only denial, and protected-row/payload privacy. Rejection replay state is snapshotted before first reject, after first reject, after same-actor retry, and after different-actor denial; invitation fields, seat state, ledger revision, row/event counts, exact row hashes, and safe result shape fail independently. Two additional isolated same-actor regressions add either an exact entry-line history reference or a clearly fake Telegram ID only after a successful rejection, require exact generic `P0002 / invitation unavailable`, and compare privileged invitation/member/identity/ledger/history snapshots and counts to prove zero mutation or normalization. Privileged snapshot checks run after `RESET ROLE`, because the rejecting non-member is intentionally unable to read the placeholder seat through RLS. Its explicitly labelled disposable entry/line history fixtures are covered by exact hashed before/after snapshots, cleaned up, and everything ends with `ROLLBACK`.

Dashboard SQL cannot create genuinely concurrent sessions inside 903. `904_INVITATION_CONCURRENCY_RUNBOOK.md` provides exact two-tab scheduling and verification for all four required races. It must not be executed until independent re-audit and a disposable scratch target are approved.

The current disposable scratch database already has 001–005 plus the pgcrypto-only 006 repair installed. Its corrected 903 attempt reached the rejection replay section and rolled back after the old combined assertion checked the placeholder seat as rejecting non-member B; the retry RPC could see the locked seat through `SECURITY DEFINER`, but authenticated RLS correctly hid that seat from the assertion. The installed reject RPC also still returned a state-specific error to a different rejector. Do not rerun 005 or 006. For this specific scratch database only, the next sequence is: independently review and run 007 as the scratch administrator; rerun the complete corrected 903 and confirm its success notice and final `ROLLBACK`; then run 904 only after 903 passes. The pre-005 905 runbook is not applicable to this already-migrated scratch state.

Clean/new deployments use the corrected 005 directly and do not need 006 or 007. The 006 repair performs a fail-loud pgcrypto schema preflight and then uses `CREATE OR REPLACE FUNCTION` only for `inspect_invitation(text)`, `accept_invitation(text)`, and `reject_invitation(text)`. The 007 repair preflights the installed reject signature and pgcrypto schema, then replaces only `reject_invitation(text)`. Both immediately restore the exact PUBLIC revoke and authenticated grant for every replaced signature. Neither changes tables, data, status rules, legacy RinggitMe objects, or production order. No production database has been touched and there is no production approval.

## Phase 24D-D1 disposable scratch validation — 11/07/2026

**Result: PASS.** On the disposable scratch project, `005_shared_invitations_membership.sql` completed successfully. `006_pgcrypto_digest_qualification_fix.sql` and `007_reject_invitation_replay_fix.sql` then completed only because that scratch target already contained the pre-fix 005 state; clean/new deployment uses corrected 005 directly and does not require either repair. The corrected 903 Dashboard probe passed and rolled back all fixture writes.

All four 904 concurrency races passed with no deadlocks: B/C accept produced one successful accept and the expected consumed loser; accept/reject produced the expected active-member rejection loser; accept/owner-revoke produced the expected consumed-invitation revoke loser; and accept/owner-remove produced the expected unclaimed-seat removal loser. Final race verification confirmed only valid terminal outcomes, no double consumption, no double identity claim, and no duplicate active-seat ownership; cleanup completed successfully.

The Race 2 operator temporarily replaced the runbook's fake D UUID only in disposable `/tmp` session, verification, and cleanup files with the actual disposable user-D UUID. No real scratch UUID belongs in committed source: the runbook retains fake placeholders, and operators must replace every D reference consistently before execution. The 905 preflight runbook was not executed because it intentionally requires a separate conflicting legacy fixture.

Production RinggitMe Supabase was never contacted or modified; App URL/key configuration was unchanged; only disposable Auth users were used. This successful scratch validation is **not** production deployment approval.

## Phase 24D-D2C manual App validation — 12/07/2026

**Result: PASS.** A two-account browser validation passed using the local, loopback-only scratch harness, disposable scratch Supabase, isolated browser profiles, and disposable email/password accounts. Pair acceptance, rejection, re-invitation, revocation, and removal of an eligible unclaimed member all passed. Invitation single-use was verified, including generic terminal-state privacy for unusable codes.

Shared-member privacy was verified: members could see only the shared ledger title, member display names, and membership status; another user's private finance data remained isolated. User-switch/sign-out cleanup also passed: invitation results, raw codes, selected detail state, and prior shared-ledger visibility did not persist across users.

Harness cleanup and repository-leakage verification passed, ending with `D2C HARNESS CLEAN — SAFE TO RETURN TO NORMAL DEVELOPMENT`. The production RinggitMe Supabase project was untouched. iOS Simulator and hosted/native deep-link testing are deferred to Phase 24D-D3. This is **not** production deployment approval.

## Security fixes before scratch dry-run

The post-implementation security audit produced six required corrections, all reflected in these files:

1. **H1 — shared JSON privacy:** recursive normalized-key inspection rejects nested account/card/wallet/bank/IBAN keys and RinggitMe's `payName`/`payId`/`last4` variants while allowing ordinary shared fields.
2. **H2 — payer consent:** another member named as payer starts pending/unpaid. Only a creator who is also the payer receives the creation-time `auto_accepted`/`confirmed` convention; a different payer must act personally.
3. **H3 — deployment-safe RLS:** all 13 tables use `ENABLE ROW LEVEL SECURITY` without `FORCE ROW LEVEL SECURITY`.
4. **M1 — revision null safety:** every revision-sensitive RPC rejects a NULL expected revision and compares revisions with `IS DISTINCT FROM`.
5. **M2 — protected void:** paid-pending/confirmed participant lines and non-reversed shared settlements block entry voiding until explicitly reopened/reversed.
6. **M3 — reopen authority:** debtor or payer may withdraw paid-pending; confirmed and waived lines may be reopened only by the server-resolved payer/creditor.

Additional audit hardening verifies idempotent ledger retries against existing data, constrains invitations to their implemented single-use behavior, returns a clean client-line collision error on revision, uses explicit `pg_temp`-last search paths, and avoids exposing whether a conflicting invitation digest belongs to another ledger.

## RLS and SECURITY DEFINER deployment model

RLS is enabled on every new table and applies to normal `authenticated` and `anon` clients. Canonical tables have no broad client INSERT/UPDATE/DELETE grants; normal clients cannot bypass policies and must use the authenticated RPC boundary.

RLS is intentionally not forced. The trusted migration/table-owner role owns the tables and `SECURITY DEFINER` functions, allowing those functions to perform validated internal reads and writes without requiring that deployment role to possess `BYPASSRLS`. This is the standard table-owner definer model: do not transfer these functions or tables to `authenticated`, `anon`, or any user-controlled role. Every definer function fixes its search path to `pg_catalog, public, pg_temp` with `pg_temp` last, validates authentication and actor scope where exposed, and has broad PUBLIC execution revoked.

## Persona probe setup

1. Create three throwaway Auth users in a disposable project: `user_a`, `user_b`, and non-member `user_c`.
2. Copy their scratch UUIDs into the three `\set` placeholders at the top of `900_persona_probe.sql`. Never use customer UUIDs, emails, tokens, or passwords.
3. Connect as a scratch database administrator that may `SET ROLE authenticated`.
4. Run the probe with psql so `\gset` and variable substitution work:

```sh
psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/24d/900_persona_probe.sql
```

The probe wraps fixtures in a transaction and ends with `ROLLBACK`. Expected output ends with `Phase 24D-B persona probe passed; all fixture writes rolled back.` It covers:

- A/B shared-ledger and shared-entry visibility;
- C/non-member and removed-member denial;
- A/B private-posting isolation;
- forged-owner and unrelated-line private-posting RLS rejection;
- grant-level denial of direct shared-entry/line writes and event deletion;
- own-line versus other-member response scope;
- consumed-invitation replay rejection;
- event idempotency plus NULL/stale/correct revision behavior;
- payer-not-creator consent protection and current-user-payer compatibility;
- paid-pending/confirmed/active-settlement void guards;
- debtor, creditor, unrelated-member, and removed-member RPC authority;
- linked-settlement reversal through the reopen transition;
- all current RinggitMe account-key variants in flat and nested JSON;
- invitation hash-only storage and column privilege;
- schema-level absence of shared payment-account snapshots;
- anon having no direct shared table privilege.

## Manual RLS verification

In a scratch project, repeat key reads using real authenticated JWTs through the Supabase client, not a service-role client:

1. A and B can select their common ledger, entry, lines, and events.
2. C receives empty results for all four.
3. A and B each see only their own `private_postings` rows.
4. Direct insert/update/delete attempts on canonical shared financial tables fail at the grant boundary; use RPCs. This is distinct from an RLS row-filter result.
5. A member cannot call `respond_to_line` for another member's line.
6. After an administrator marks a scratch member `removed`, that user receives empty shared reads and mutation RPC authorization fails.
7. Authenticated clients cannot select `invitations.code_hash` or mutate `telegram_identities`.
8. Authenticated clients cannot update or delete `shared_entry_events`.

Use the anon key for an additional negative read test. Do not use the service-role key for RLS verification because it bypasses the client security boundary.

## RPC/state notes

Entry states are `pending`, `active`, `settled`, and `voided`. Line response and settlement are independent axes. A payer line starts `auto_accepted`/`confirmed` only when the entry creator is that payer. If the creator names another member as payer, that payer line starts `pending`/`unpaid`; the actual payer's accepted response establishes their payer consent and confirmation. Other participant lines start `pending`/`unpaid`.

Accepted lines can move to `paid_pending_confirmation`, then the payer confirms receipt. A debtor may withdraw their own paid-pending marker. Only the payer/creditor may reverse a confirmed line or reopen a waived line. Reopening a paid/confirmed line also reverses any active linked shared settlement. Voiding is blocked by paid-pending/confirmed non-structural lines and active non-reversed settlement rows. The creator-payer's own creation-time confirmed line is the structural payer convention, not an external settlement, so an otherwise pending/unpaid entry remains voidable.

All revision-sensitive RPCs require a non-NULL expected revision and use NULL-safe equality. Creator revision currently resets every non-creator-payer line to pending/unpaid, not only changed lines; this is a conservative re-consent deviation from the minimal-reset architecture. Re-adding a client line ID already bound to a different member now produces a deliberate constraint error rather than an incidental unique-index failure.

All exposed mutations validate `auth.uid()`, active membership and actor scope, lock canonical rows where state changes, use client-generated IDs, and append an event when an entry mutation occurs. `record_settlement` also supports ledger-level net settlements; because the approved event table is entry-scoped, ledger-level settlements have no fabricated entry event.

`issue_media_url` validates authentication, ownership/membership, and operation, then deliberately raises `0A000`. Storage-provider signing is not approved in this phase, so the function never returns a permissive or fake URL.

Media-link creation is also deliberately deferred: clients have no link INSERT grant and there is no link-creation RPC yet. Settlements can be recorded and reversed through the current reopen lifecycle, but a standalone confirm/reverse settlement RPC remains future work. Historical `left`/`removed` member identities remain co-member-readable for audit display, and invitation owners may retain safe consumed-invitation metadata.

## Rollback

`999_rollback.sql` is destructive to new 24D shared-layer data. Review it before scratch use. It drops RPCs first, then policies, triggers, helpers, and the 13 new tables in reverse dependency order. It does not drop pgcrypto and does not reference any pre-24D RinggitMe table.

Example for a disposable scratch target only:

```sh
psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/24d/999_rollback.sql
```

No production execution has occurred. The successful scratch validation above does not replace independent security review or a separate production deployment decision.
