# Phase 24D-B shared-ledger SQL foundation

Status: implementation files with a recorded successful disposable scratch validation below. No production database deployment has occurred.

## Architecture

This is an additive shared canonical layer. It does not alter the existing owner-local RinggitMe tables. Shared ledgers, members, entries, lines, events, settlements, invitations, and media links contain collaboration facts. Personal account/card/wallet projections remain owner-private in `private_postings`; `account_snapshot` exists only there.

Amounts are integer sen. Financial and audit foreign keys use restrictive deletion. Shared mutations are RPC-only. RLS reads are active-membership based, event rows are append-only, invitation raw codes are never stored, and normal authenticated clients cannot forge Telegram verification facts.

## Files and review order

1. `001_shared_core.sql` — 13 additive tables, constraints, indexes, and the shared-JSON privacy check.
2. `002_shared_rls.sql` — helper functions, timestamp triggers, explicit grants, and enabled RLS policies.
3. `003_shared_rpcs.sql` — authenticated `SECURITY DEFINER` mutations and fail-closed media URL signature.
4. `900_persona_probe.sql` — psql-oriented, transactional scratch-project probe only; never a production migration.
5. `999_rollback.sql` — destructive rollback for the new 24D objects only.

Production migration tooling must include only 001–003, after independent SQL/security review. Do not put 900 or 999 into an automatic production migration sequence.

## Scratch-project dry run (examples only)

These commands are documentation, not commands executed during this task. Use a disposable Supabase project or isolated local Supabase stack with no customer data. Inspect the target connection before every command.

```sh
# Example local-only order; supply a scratch connection explicitly.
psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/24d/001_shared_core.sql
psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/24d/002_shared_rls.sql
psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/24d/003_shared_rpcs.sql
```

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
