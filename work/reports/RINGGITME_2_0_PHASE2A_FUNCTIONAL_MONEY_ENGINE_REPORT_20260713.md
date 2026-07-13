# RinggitMe 2.0 Phase 2A Functional Money Engine Report

## 1. Carousel R2 freeze commit SHA

The verified Carousel R2 result was frozen in the only commit authorized by this task:

- SHA: `88dae0ace8d78cc6534ffa0e6488e9af3423d4ed`
- Commit: `fix: finalize RinggitMe 2.0 carousel interactions`
- Scope: exactly the two Carousel R2 source files, the R2 report, and eight R2 screenshots (11 files; 240 insertions, 11 deletions)
- Push/deploy: not performed

Phase 2A work remains uncommitted.

## 2. Branch and worktree

- Worktree: `/Users/winnertang/Projects/ringgitme-2.0`
- Branch: `wip/ringgitme-2.0-core`
- Current HEAD: `88dae0ace8d78cc6534ffa0e6488e9af3423d4ed`
- No branch or worktree was created or switched.

## 3. Initial Phase 2A state

After the Carousel R2 freeze, the application still used a mutable fixture adapter whose Capture operation only prepended an Activity row. It had no authoritative money repository, minor-unit ledger effects, transfer operation, balance-aware edit/reversal, credit-card propagation, edit UI, delete confirmation, or full demo reset. Today, Assets, Account Detail, and Activity could therefore show conflicting or stale values after Capture.

The approved visual shell, router, shared UI state, formatting utilities, fixture data, Capture Sheet, Today, Assets, Account Detail, Activity, AA fixtures, fixed-expense fixtures, and Carousel R2 behavior were inspected before implementation and retained.

## 4. Architecture

Phase 2A uses one directional boundary:

`UI components → fixture data-source adapter → in-memory money engine → authoritative accounts and transactions`

- `moneyEngine.js` owns the authoritative in-memory account/transaction snapshot and all balance effects.
- `demoData.js` is the fixture adapter and shared selector boundary.
- `state.js` remains the UI-state/action boundary and exports the single adapter instance.
- Today, Assets, Account Detail, Activity, and Capture consume the same adapter; page components do not maintain separate balance copies.
- The engine notifies subscribers and every mutation synchronously produces a consistent snapshot without a page reload.

## 5. Files changed

Phase 2A source and tests (uncommitted):

- `app-2.0/src/domain/moneyEngine.js` — new authoritative engine
- `app-2.0/src/fixtures/demoData.js` — refined fixture adapter and shared selectors
- `app-2.0/src/components/CaptureSheet.js` — real expense/income/transfer operations
- `app-2.0/src/components/ActivityRow.js` — account context, record-only badge, keyboard semantics
- `app-2.0/src/features/activity/index.js` — detail, edit, history, delete/reversal UI
- `app-2.0/src/app/shell.js` — accessible delegated keyboard actions and confirmed demo reset
- `app-2.0/src/styles/money-engine.css` — focused Phase 2A form/detail/history styling
- `app-2.0/index.html` — stylesheet registration
- `app-2.0/tests/moneyEngine.test.mjs` — scenarios A–H
- `app-2.0/package.json` — deterministic test command
- `work/reports/ringgitme-2.0-phase2a-screenshots/` — 14 mobile screenshots
- `work/reports/RINGGITME_2_0_PHASE2A_FUNCTIONAL_MONEY_ENGINE_REPORT_20260713.md` — this report

Private Carousel R2 backups remain untracked and untouched under `work/backups/`.

## 6. Data-source boundary

The adapter exposes stable operations and selectors:

- `addTransaction`, `editTransaction`, `reverseTransaction`, `deleteTransaction`, `transferFunds`
- `getAccount`, `getAccounts`, `getTransactions`, `getTransaction`, `getAccountBalance`
- `getDerivedMetrics` / `getPulse`, `getSavingsFlow`, `getBudget`
- `subscribe`, `resetDemoData`
- reserved AA/fixed interfaces: `projectAAReceivable`, `settleAAReceivable`, `reverseAAProjection`, `postFixedExpense`, `reverseFixedExpense`

The UI supplies account IDs, never account names, and does not directly mutate fixture account or transaction arrays.

## 7. Domain models

Accounts are normalized with the existing UI fields plus domain aliases: `domainType` (`savings`, `ewallet`, `credit`), `institution`, `maskedDigits`, integer `balanceMinor` or `creditLimitMinor` / `currentOutstandingMinor`, calculated `availableCredit`, and preserved artwork/fixture metadata.

Transactions contain stable ID, kind/type, integer amount, description/category, ISO occurrence time, source/destination account IDs, record-only/AA/attachment metadata, created/updated ISO timestamps, revision, edit history, status, and optional reversal metadata. User-facing dates use `DD/MM/YYYY` and 12-hour uppercase `AM/PM`.

Edit entries record timestamp, old/new amount, old/new description, changed fields, and revision.

## 8. Money movement rules

- Savings/eWallet expense: subtract source balance.
- Savings/eWallet income: add destination balance.
- Transfer: subtract source and add destination while creating one logical record; total Current Cash is unchanged.
- Credit expense: increase outstanding and reduce available credit; reject an over-limit result.
- Record-only: add the record but do not change cash balances, card outstanding, or balance-derived spend totals.
- Delete/reversal: apply the exact inverse once and mark the transaction reversed; reversed records are hidden from normal Activity.
- Invalid amount, empty description, bad account, same-account transfer, credit-card transfer, and credit income are rejected before authoritative state changes.
- All monetary effects use integer minor units internally.

## 9. Capture operations

The existing Capture visual design now performs real in-memory operations for expense, income, and transfer. It supports category, source/destination account, description, date/time, AA metadata, fixture attachment, and record-only where valid. Saving validates, writes one domain transaction, applies money once, closes with success motion/toast, and routes to the live Activity record.

Double submission is prevented at both layers: the UI disables/guards Save and the engine deduplicates the per-sheet submission key. The browser test triggered Save twice rapidly and produced one row and one balance effect.

## 10. Derived metrics

The adapter delegates the confirmed Money Pulse set to one shared engine selector:

- Current Cash: savings plus eWallet balances
- My Fixed: existing own-share commitment amounts
- Total Card Debt: card outstanding plus represented remaining instalment debt, matching the existing blueprint contract
- This-Month Card + Instalment Due: existing due values plus instalment monthly amounts
- Cash After Card Payment
- AA Receivable and Cash After Receive from existing fixtures
- Total Assets, Total Debt, Net Debt, and Net Assets

Investments and fixed deposits remain in total assets but not Current Cash. Credit limits/available credit and record-only records are excluded from cash.

## 11. Live UI synchronization

Browser verification confirmed immediate, refresh-free propagation to:

- Today Current Cash, budget spend, card debt, due, and after-payment/receive metrics
- Assets net assets, total assets/liabilities, category totals, and individual account/card values
- Account Detail balance/outstanding, available credit, recent-change timestamp, and recent records
- Activity date group, source/destination context, amount, time, search, and filter

Example expense proof: RM25.90 from Maybank changed Current Cash to `RM 15,119.19`, Maybank to `RM 6,816.25`, and Net Assets to `RM 48,761.24` exactly once.

## 12. Transaction detail

Activity and account recent rows open a compact user-facing detail sheet showing description, amount, type, category, source/destination, date/time, record-only state, AA state, attachment indicator, created/updated timestamps, edit history, and Edit/Delete actions for user-created records. Internal IDs and developer terminology are not exposed.

## 13. Edit behavior

Edit supports amount, description, category, date/time, valid account changes, and record-only where supported. The engine validates a candidate, applies the previous inverse and the new effect to a cloned account snapshot, and only publishes it if every step succeeds. Invalid edits therefore preserve the original transaction and balances.

The verified income edit changed `RM 1,000.00` / `Salary` to `RM 1,200.00` / `Salary - July`; the destination balance changed only by the RM200 delta.

## 14. Edit-history behavior

Every successful edit increments revision and appends a visible entry containing the Kuala Lumpur timestamp, revision, old amount → new amount, and old description → new description. History is retained on the transaction and shown in both light and dark transaction details.

## 15. Delete/reversal behavior

Delete requires an explicit confirmation sheet. Confirming applies the exact inverse once, records reversal metadata, hides the record from normal Activity, updates all selectors, and reports that account amounts were restored. A repeated reversal is rejected. Browser verification deleted the edited income and removed its RM1,200 destination effect; deterministic tests cover savings, transfer, card, and record-only reversal.

## 16. Credit-card consistency

Credit cards retain integer credit limit/outstanding values and derive:

`availableCredit = creditLimit - currentOutstanding`

A verified RM50 Visa expense changed outstanding from `RM 3,247.80` to `RM 3,297.80`, available credit from `RM 8,752.20` to `RM 8,702.20`, and total debt by RM50. Deletion restores all three. Existing shared-pool display metadata and instalments are preserved; no full shared-limit, payment, or due-date lifecycle was added.

## 17. Reset Demo Data

Profile/settings now contains the user-facing `重置示例数据` action with confirmation. Reset restores the initial account, transaction, commitment, Activity, and metric snapshot; clears transaction sequence/idempotency state; returns to Today; and resets transient Activity/Assets navigation state. No financial data is persisted to browser storage.

Browser reset returned Current Cash to `RM 15,145.09`, total debt to `RM 12,398.25`, and all baseline accounts/records exactly.

## 18. Test scenarios and results

`npm test` passed 8/8 deterministic scenarios:

| Scenario | Result |
| --- | --- |
| A — savings expense + delete restore | PASS |
| B — income, RM1000→RM1200 edit/history + delete | PASS |
| C — one logical transfer, cash-neutral + reverse | PASS |
| D — credit expense, debt/available consistency + delete | PASS |
| E — RM300 record-only, zero money effect + delete | PASS |
| F — repeated submission key, one transaction/effect | PASS |
| G — same-account transfer rejected, zero state change | PASS |
| H — several changes then complete baseline reset | PASS |

Final Node test duration was approximately 63 ms with zero failures, skips, or cancellations.

## 19. Build and static checks

PASS:

- `node --check` on every source/test JavaScript module
- `npm test` (8/8)
- `npm run build` with Vite 6.4.3; 36 modules transformed
- `git diff --check`
- inline event-handler scan: none
- real network/API/WebSocket/EventSource/Supabase/Worker/port-8788 integration scan: none
- `localStorage`, `sessionStorage`, and IndexedDB scan: none
- source line-count scan: no source file over 500 lines; largest is `src/styles/assets.css` at 487 lines
- all 14 evidence files verified as exactly 390 × 844 pixels

## 20. Console and overflow results

A fresh final-code browser tab loaded `http://localhost:5173/` with no console event and no page error during the clean-load scan. The exercised mobile flow completed without an unhandled-promise failure.

At 390 × 844, Today, Assets, savings detail, credit detail, Activity, light transaction sheets, dark transaction detail, reset, and post-reset Carousel checks all returned document horizontal overflow `0` (`scrollWidth = clientWidth = 390`). New rows and transaction controls remained above or scrollable clear of the fixed bottom navigation.

Carousel R2 was reconfirmed after reset: the centered Maybank savings and Visa credit pointer taps opened the correct details, Back remained correct, and the existing R2 source files were not modified by Phase 2A. The committed R2 gesture suite already contains the category/detail swipe and tap-versus-drag evidence.

## 21. Screenshot paths

All captures are true 390 × 844 browser viewport screenshots without a fake device frame:

1. `work/reports/ringgitme-2.0-phase2a-screenshots/01-today-after-expense.png`
2. `work/reports/ringgitme-2.0-phase2a-screenshots/02-assets-after-expense.png`
3. `work/reports/ringgitme-2.0-phase2a-screenshots/03-capture-expense.png`
4. `work/reports/ringgitme-2.0-phase2a-screenshots/04-capture-income.png`
5. `work/reports/ringgitme-2.0-phase2a-screenshots/05-capture-transfer.png`
6. `work/reports/ringgitme-2.0-phase2a-screenshots/06-activity-new-records.png`
7. `work/reports/ringgitme-2.0-phase2a-screenshots/07-transaction-detail.png`
8. `work/reports/ringgitme-2.0-phase2a-screenshots/08-edit-transaction.png`
9. `work/reports/ringgitme-2.0-phase2a-screenshots/09-edit-history-timeline.png`
10. `work/reports/ringgitme-2.0-phase2a-screenshots/10-delete-confirmation.png`
11. `work/reports/ringgitme-2.0-phase2a-screenshots/11-savings-account-detail-updated.png`
12. `work/reports/ringgitme-2.0-phase2a-screenshots/12-credit-account-detail-updated.png`
13. `work/reports/ringgitme-2.0-phase2a-screenshots/13-dark-mode-transaction-detail.png`
14. `work/reports/ringgitme-2.0-phase2a-screenshots/14-reset-demo-data-confirmation.png`

## 22. Proof no Supabase/network connection

No Phase 2A code imports or calls Supabase, `fetch`, XMLHttpRequest, WebSocket, EventSource, Worker, SQL, RPC, Telegram, or port 8788. Static scans of `src`, `index.html`, and tests returned no integration hits. The engine is wholly in-memory, and the production build requires no backend.

## 23. Proof legacy RinggitMe untouched

No write/build/reset/stash/clean command targeted `/Users/winnertang/Projects/ringgitme`. Its legacy `index.html` modification time remains `2026-07-12 19:21:49 +0800`, predating this task. A final read-only check showed the same `wip/phase24d-d3-invite-deep-links` branch and existing Phase 24D untracked report evidence; this task did not edit or remove any of it. All application mutations are inside `/Users/winnertang/Projects/ringgitme-2.0`.

## 24. Proof D3C and port 8788 untouched

No command, file edit, network call, or source reference in this task targeted the D3C harness, D3C reports, Simulator, Scratch App, invitation state, recovery evidence, or TCP port 8788. The Carousel R2 freeze verification observed the pre-existing D3C listener as PID 69344. At the final read-only environment check, PID 69344 was no longer present and port 8788 had no listener; the task did not stop, restart, or otherwise alter that external process. It remains intentionally outside Phase 2A scope.

## 25. Current preview URL and PID

- URL: `http://localhost:5173/`
- Vite PID: `71751`
- Listener: `127.0.0.1:5173`
- Command: `node /Users/winnertang/Projects/ringgitme-2.0/app-2.0/node_modules/.bin/vite --port 5173 --strictPort`

## 26. Remaining Phase 2B work

Phase 2B was not started. Reserved work includes a persistent repository/backend boundary, complete credit-card payment/shared-limit/due-date lifecycle, the exact dedicated due-date rule, AA receivable projection/settlement/reversal, fixed-expense posting/reversal, real attachment storage, and any authorized server synchronization. The Phase 2A no-op operation interfaces provide explicit extension points for AA/fixed workflows.

## 27. Final verdict

**RINGGITME 2.0 PHASE 2A FUNCTIONAL MONEY ENGINE READY FOR USER REVIEW**
