# RinggitMe 2.0 Phase 2A Baseline Record Mutability Fix Report

## 1. Scope and repository state

- Worktree: `/Users/winnertang/Projects/ringgitme-2.0`
- Branch: `wip/ringgitme-2.0-core`
- HEAD: `88dae0ace8d78cc6534ffa0e6488e9af3423d4ed`
- Preview: `http://localhost:5173/`, Vite PID `71751`
- Commit/push/deploy: not performed
- Phase 2A and this fix remain uncommitted and unstaged for user review.

## 2. Exact root cause

Baseline fixture transactions were already cloned into the authoritative `moneyEngine` state during session initialization. They had stable IDs, active status, revision, history arrays, normalized money amounts, and were accepted by the same `editTransaction` / `deleteTransaction` operations as session-created records.

The mutability loss was caused by one UI-only provenance gate in `src/features/activity/index.js`:

`t.origin === 'user'`

Only transactions created during the current session have `origin: 'user'`; normalized baseline rows have `origin: 'fixture'`. The detail sheet therefore rendered Edit/Delete only for session-created rows and silently substituted a `完成` button for every baseline row. There was no repository-membership, missing-ID, missing-revision, or engine-operation barrier.

Root-cause inspection also found a secondary legacy metadata gap: old generated fixture transfers lacked `destinationAccountId`, and some generated incomes/transfers referenced unsupported credit accounts. Those rows could display but would fail modern edit validation. Repository initialization now deterministically normalizes these old records to valid account IDs before exposing them.

## 3. Files changed by this fix

- `app-2.0/src/domain/moneyEngine.js`
  - origin-agnostic mutation policy
  - engine-enforced explicit locks
  - baseline source/destination normalization
  - stable transfer category normalization
- `app-2.0/src/fixtures/demoData.js`
  - mutation-policy adapter operation
  - clean baseline revision/history snapshot
- `app-2.0/src/features/activity/index.js`
  - policy-based detail footer
  - identical Activity/Account Detail mutation actions
  - protected-record reason display
  - fixed transfer edit category
- `app-2.0/src/styles/money-engine.css`
  - protected-record reason and transfer-category presentation
- `app-2.0/tests/baselineMutability.test.mjs`
  - seven focused baseline mutation scenarios (I–O)
- `work/reports/ringgitme-2.0-phase2a-baseline-mutability-screenshots/`
  - 14 true 390 × 844 screenshots
- `work/reports/RINGGITME_2_0_PHASE2A_BASELINE_RECORD_MUTABILITY_FIX_REPORT_20260713.md`
  - this report

No Carousel R2 source file was changed.

## 4. Ordinary editable-record contract

Mutation eligibility no longer depends on fixture/session provenance. Any active ordinary transaction is editable and deletable, including baseline:

- savings/eWallet expenses
- credit-card expenses
- incomes
- transfers
- record-only transactions
- AA-tagged ordinary expenses
- receipt/photo fixture rows

The `origin` field remains provenance metadata only. It has no authority over Edit/Delete visibility or engine operations.

Every editable detail sheet exposes the approved side-by-side actions:

- `编辑`
- `删除记录`

The engine performs the same clone → reverse old effect → validate → apply new effect → publish sequence for baseline and session-created rows.

## 5. Explicit locked-record contract

There is no broad fixture/system-origin lock. A record is protected only when its domain data contains a non-empty, user-facing `lockedReason`, for example a finalized settlement that requires a dedicated reversal workflow.

For an explicit lock:

- `getTransactionMutationPolicy` returns `canEdit: false` and `canDelete: false`.
- The detail sheet shows the user-facing reason and `完成`.
- The engine independently rejects direct edit/delete attempts with the same reason.
- Developer terminology and silent button removal are avoided.

Reversed rows are also non-mutable and report that they were already deleted. No current ordinary demo fixture is locked.

## 6. Activity entry result

PASS at 390 × 844. Opening the baseline `TNB 电费` RM112 row from Activity showed the complete transaction detail and exactly one `编辑` and one `删除记录` action. The same result was verified for baseline Grab card expense, AA income, and transfer rows.

Search continued to find edited descriptions immediately. Deleted rows disappeared from normal Activity, while reset restored their original descriptions, amounts, active states, revision 1, and empty histories.

## 7. Account Detail entry result

PASS at 390 × 844.

- The edited TNB row was opened from Touch 'n Go Account Detail recent records and showed the same actions and history as the Activity entry.
- The edited Grab row was opened from Maybank Visa Account Detail recent purchases and showed the same actions.
- Both entry points dispatch the same transaction ID into the same detail function and mutation policy; neither path is read-only.

## 8. Edit rollback results

### Baseline eWallet expense

- Original: TNB RM112 from Touch 'n Go, balance `RM 342.60`
- Edit: RM112 → RM120
- Result: Touch 'n Go `RM 334.60`, exactly RM8 additional reduction
- Current Cash: `RM 15,145.09` → `RM 15,137.09`
- History: revision 2, amount and description arrows visible

### Baseline credit-card expense

- Original: Grab RM59.90 on Maybank Visa
- Edit: RM59.90 → RM79.90
- Outstanding: `RM 3,247.80` → `RM 3,267.80`
- Available credit: `RM 8,752.20` → `RM 8,732.20`
- Total debt changed by exactly RM20

### Baseline income

- Original: AA income RM120 into Maybank
- Edit: RM120 → RM150
- Destination balance and Current Cash increased by exactly RM30
- History showed the original and updated amount/description

### Baseline transfer

- Original: RHB → Touch 'n Go, RM101.90
- Edit: RM101.90 → RM111.90
- RHB changed `RM 1,905.20` → `RM 1,895.20`
- Touch 'n Go changed `RM 454.60` → `RM 464.60` in the exercised combined state
- Current Cash remained unchanged
- Source, destination, type, and category remained `转账`

Invalid candidates are validated against a cloned account snapshot. A failure never publishes the reversal or partial new effect, preserving the original transaction and balances.

## 9. Delete/reversal results

PASS. Deleting each edited baseline record applied the inverse exactly once:

- Edited TNB RM120 deletion restored the full edited effect; relative to the original balance, Touch 'n Go became `RM 454.60` (`RM 342.60 + RM 112.00`).
- Edited Grab deletion reduced Visa outstanding to `RM 3,187.90` and restored available credit to `RM 8,812.10`, removing the original RM59.90 fixture effect.
- Edited income deletion removed the full credited amount; relative to the original state, Maybank and Current Cash decreased by the original RM120.
- Edited transfer deletion restored the source and removed the destination credit: RHB `RM 2,007.10`, Touch 'n Go `RM 352.70` in the exercised combined state, with total Current Cash unchanged.
- Record-only fixture-seed tests confirmed edit/delete never changes money.

Repeated deletion is rejected before a second inverse can run. Reversed rows are hidden from normal Activity.

## 10. Reset result

PASS. Multiple baseline records were edited in the live browser, after which `重置示例数据` required confirmation and restored:

- Current Cash `RM 15,145.09`
- Touch 'n Go `RM 342.60`
- RHB `RM 1,905.20`
- Visa outstanding `RM 3,247.80`
- original TNB RM112 and transfer RM101.90 rows
- original descriptions and account contexts
- all transactions active
- revision 1
- empty edit histories
- no reversed/deleted state

The restored ordinary rows remained editable. Reload also resets to the same initial in-memory snapshot. No financial browser persistence was added.

## 11. Automated tests

Final result: **15/15 PASS**.

Existing Phase 2A scenarios A–H remain passing. Focused baseline scenarios added:

| Scenario | Result |
| --- | --- |
| I — all ordinary fixture rows have origin-agnostic mutation policy | PASS |
| J — TNB baseline expense delta/history/delete/idempotency | PASS |
| K — baseline card outstanding/available/debt edit + delete | PASS |
| L — baseline income delta + full delete | PASS |
| M — baseline transfer two-sided edit/delete and cash neutrality | PASS |
| N — baseline record-only + explicit locked reason contract | PASS |
| O — reset exact accounts/transactions/revisions/histories/states | PASS |

The final Node test run completed with zero failures, skips, cancellations, or todos.

## 12. Build, static, console, and overflow

PASS:

- all source/test JavaScript passed `node --check`
- `git diff --check`
- Vite 6.4.3 production build; 36 modules transformed
- no inline event handlers in `app-2.0`
- no `fetch`, XMLHttpRequest, WebSocket, EventSource, Supabase, Worker, or port-8788 integration in `app-2.0`
- no `localStorage`, `sessionStorage`, or IndexedDB usage in `app-2.0`
- no source file over 500 lines; largest remains `assets.css` at 487 lines
- clean final browser tab: no console event and no page error
- exercised interaction flow: no unhandled-promise failure
- every checked mobile state had `scrollWidth = clientWidth = 390`
- all 14 screenshots are exactly 390 × 844
- no duplicate records or duplicate money effects

## 13. Screenshot evidence

Directory:

`work/reports/ringgitme-2.0-phase2a-baseline-mutability-screenshots/`

1. `01-activity-baseline-tnb-actions.png`
2. `02-baseline-tnb-edit-form.png`
3. `03-baseline-tnb-edit-history.png`
4. `04-account-detail-tnb-actions.png`
5. `05-baseline-tnb-deleted-account-restored.png`
6. `06-baseline-credit-edit-history.png`
7. `07-baseline-credit-account-edited.png`
8. `08-baseline-credit-deleted-restored.png`
9. `09-baseline-income-edit-history.png`
10. `10-baseline-transfer-edit-history.png`
11. `11-baseline-transfer-accounts-edited.png`
12. `12-baseline-transfer-deleted-restored.png`
13. `13-reset-baseline-mutations-confirmation.png`
14. `14-reset-original-baseline-restored.png`

## 14. Safety boundary

- No write, edit, build, reset, stash, or clean targeted `/Users/winnertang/Projects/ringgitme`, its legacy `index.html`, Supabase, SQL, migrations, iOS, D3C files, or recovery evidence; checks of that repository were read-only.
- The legacy repository remains on `wip/phase24d-d3-invite-deep-links` with its pre-existing untracked reports.
- No command stopped, started, or contacted port 8788. Its final read-only check showed no listener.
- Carousel R2 commit `88dae0a` remains unchanged.
- No commit, stage, push, deploy, branch, worktree, reset, stash, or clean was performed.

## 15. Final verdict

**RINGGITME 2.0 PHASE 2A BASELINE RECORD MUTABILITY FIX READY FOR USER REVIEW**
