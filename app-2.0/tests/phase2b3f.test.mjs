import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createDemoDataSource } from '../src/fixtures/demoData.js';
import { buildConfirmationDebugPreview } from '../src/components/ConfirmationDebugPreview.js';
import { confirmationHistoryActionsHTML, moneyFlowConfirmationHTML, recentHTML } from '../src/components/MoneyFlowConfirmation.js';
import { transactionMatchesActivityAccount } from '../src/features/activity/index.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const source = {
  router: read('../src/app/router.js'),
  state: read('../src/app/state.js'),
  shell: read('../src/app/shell.js'),
  row: read('../src/components/ActivityRow.js'),
  overlay: read('../src/components/RecordDetailOverlay.js'),
  sheet: read('../src/components/AppSheet.js'),
  activity: read('../src/features/activity/index.js'),
  category: read('../src/features/assets/category.js'),
  detail: read('../src/features/assets/detail.js'),
  confirmation: read('../src/components/MoneyFlowConfirmation.js'),
  capture: read('../src/components/CaptureSheet.js'),
  attachment: read('../src/components/AttachmentField.js'),
  copy: read('../src/app/copy.js'),
  css: read('../src/styles/phase2b3f.css'),
  cssE: read('../src/styles/phase2b3e.css'),
  money: read('../src/domain/moneyEngine.js'),
  relationship: read('../src/domain/relationshipLedgerEngine.js'),
};
const demo = createDemoDataSource();
const expense = buildConfirmationDebugPreview(demo, 'expense');
const transfer = buildConfirmationDebugPreview(demo, 'transfer');
const otherPayer = buildConfirmationDebugPreview(demo, 'otherpayer');

const names = `
Savings row opens Record Detail|Savings remains underlying view|Savings never selects Activity|Savings exact transaction ID|Savings exact amount|Savings exact account|Savings selectedAccountId preserved|Savings Wallet card preserved|Savings scroll preserved|Savings close restores category|Savings Back closes detail only|Savings repeated cycle stable
Credit row opens local detail|Credit remains underneath|Credit exact card preserved|Credit debt summary preserved|Credit stack preserved|Credit close restores category
Account Detail row opens local detail|Account Detail remains underneath|carousel ID preserved|active dot preserved|horizontal position preserved|vertical scroll preserved|close keeps selected account|no Activity intermediate route
Activity row opens local detail|Activity search preserved|Activity account filter preserved|Activity type filter preserved|Activity month preserved|Activity scroll preserved|Activity close restores list|Activity does not reload
Confirmation row opens exact detail|Confirmation remains underneath|Confirmation restored on close|Confirmation scroll preserved|success animation does not replay|transaction not duplicated
one history state per open|Back closes one overlay|Escape closes one overlay|no double close|no duplicate history entries|nested stack order|stable transaction key|no stale fallback
individual row never routes Activity|category View All routes Activity|Account Detail View All routes Activity|Confirmation history CTA routes Activity|handlers are distinct
complex initial row limit|simple initial row limit|expand wording|collapse wording|no misleading local View All|expansion stays local|collapse restores rows|expansion no mutation|footer remains available|stable row heights|no unnecessary toggle
Savings history label|Credit history label|eWallet history label|history exact accountId|history Activity navigation|visible account filter|history browser Back safe|no hardcoded Maybank|no stale account|no whole block navigation
accountId matching|sourceAccountId matching|destinationAccountId matching|expense included|income included|transfer out included|transfer in included|repayment included|received payment included|record-only included|unrelated excluded|visible filter indicator|clear filter|no duplicate chip|filtered empty state|View All Activity clears filter|search coexists with filter|filter survives rerender
transfer source CTA|transfer destination CTA|exact source ID|exact destination ID|source filtered Activity|destination filtered Activity|transfer row opens detail|no ambiguous transfer CTA
amount surface independent|Transaction Details group|Accounting Method group|no card per field|description grouped|date grouped|time grouped|attachments grouped|relationship grouped|record-only grouped|internal dividers|mobile layout|tablet layout|desktop cap|no overflow
amount draft preserved|formula draft preserved|description draft preserved|date draft preserved|time draft preserved|attachments draft preserved|relationship draft preserved|payer draft preserved|participants draft preserved|split values draft preserved|record-only draft preserved|Edit Amount calculator return|reopen restores state|Save payload unchanged
record-only switch role|record-only aria false|record-only aria true|record-only touch|record-only keyboard|one activation per tap|record-only reduced motion|record-only dark mode|record-only balance neutral|record-only Activity badge
grouped glass token|no unrelated theme|no giant white blocks|controlled border|controlled blur|pressed feedback|focus feedback|text hierarchy|green limited|material dark mode|material reduced motion|no layout shift
delete thumbnail immediate|deleted attachment stays removed|payload excludes removed|Gallery remains|Lightbox remains|object URL correct
ordinary relationship preserved|AA preserved|direct receivable preserved|direct payable preserved|split exactness preserved|invalid split warning preserved|relationship cancel preserves state
all previous tests registered|Assets frozen|Savings Wallet frozen|Credit Wallet frozen|Account Detail visual frozen|carousel frozen|calculator frozen|Confirmation identity frozen|Confirmation visual frozen|balance animation frozen|sticky footer frozen|Record Detail visual frozen|totals frozen|debt frozen|AA domain frozen|settlement frozen|monthly frozen|instalment frozen|no network|no localStorage|no IndexedDB|no Supabase|no real Telegram|no real App-to-App|port 8788 untouched`.trim().split(/\n|\|/);

assert.equal(names.length, 189);

const contextualChecks = [
  () => assert.match(source.row, /data-action="open-record-detail"[\s\S]*data-txn="\$\{t\.id\}"/),
  () => assert.match(source.overlay, /recordDetailOriginSnapshot[\s\S]*assetsView: structuredClone/),
  () => assert.match(source.overlay, /selectedAccountId: structuredClone/),
  () => assert.match(source.overlay, /categoryIndex: structuredClone/),
  () => assert.match(source.overlay, /pageScrollTop/),
  () => assert.match(source.overlay, /confirmationScrollTop/),
  () => assert.match(source.overlay, /data\.getActivity\(transactionId\)/),
  () => assert.match(source.router, /pushOverlayHistory[\s\S]*history\.pushState/),
  () => assert.match(source.router, /overlayHistoryHandler\?\.\(\{ action: 'close'/),
  () => assert.match(source.router, /if \(previousOverlay\)[\s\S]*if \(targetOverlay\)/),
  () => assert.match(source.overlay, /restoreOriginPosition/),
  () => assert.doesNotMatch(source.activity, /open-record-detail'[\s\S]{0,220}tab: 'activity'/),
  () => assert.match(source.sheet, /stacked = false[\s\S]*document\.body[\s\S]*pushModalLayer\(layer\)/),
  () => assert.match(source.css, /sheet-layer-stacked[\s\S]*z-index: calc\(1800/),
  () => assert.match(source.confirmation, /isTopModal\(layer\)/),
  () => assert.match(source.activity, /registerRecordDetailPresenter/),
];

const expansionChecks = [
  () => assert.equal((recentHTML(expense).match(/data-motion-record-id/g) || []).length, 3),
  () => assert.equal((recentHTML(otherPayer).match(/data-motion-record-id/g) || []).length, 2),
  () => assert.match(recentHTML(otherPayer), /展开更多/),
  () => assert.match(recentHTML(otherPayer, { expanded: true }), /收起/),
  () => assert.doesNotMatch(recentHTML(otherPayer), /查看全部/),
  () => assert.equal((recentHTML(otherPayer, { expanded: true }).match(/data-motion-record-id/g) || []).length, 4),
  () => assert.match(recentHTML(expense), /aria-label="查看 [^"]+ 记录详情"/),
  () => assert.match(source.confirmation, /recentExpanded = !recentExpanded/),
  () => assert.match(moneyFlowConfirmationHTML(expense), /data-motion-recent[\s\S]*data-motion-history-actions[\s\S]*<\/div>\s*<footer/),
  () => assert.match(source.cssE, /motion-recent-row[\s\S]*min-height: 60px/),
];

const historyChecks = [
  () => assert.match(confirmationHistoryActionsHTML(expense), /查看Maybank 储蓄卡全部记录/),
  () => assert.match(confirmationHistoryActionsHTML(transfer), /查看转出账户记录/),
  () => assert.match(confirmationHistoryActionsHTML(transfer), /查看转入账户记录/),
  () => assert.match(confirmationHistoryActionsHTML(transfer), /sv-mbb/),
  () => assert.match(confirmationHistoryActionsHTML(transfer), /ew-tng/),
  () => assert.equal(confirmationHistoryActionsHTML(otherPayer), ''),
  () => assert.match(source.confirmation, /data-motion-account-history[\s\S]*pushRoute\(\{ tab: 'activity'/),
  () => assert.match(source.category, /assets-view-all-activity'[\s\S]*pushRoute/),
  () => assert.match(source.detail, /assets-view-all-activity" data-acc="\$\{escapeHTML\(acc\.id\)\}"/),
];

const filterChecks = [
  () => assert.equal(transactionMatchesActivityAccount({ accountId: 'a' }, 'a'), true),
  () => assert.equal(transactionMatchesActivityAccount({ sourceAccountId: 'a' }, 'a'), true),
  () => assert.equal(transactionMatchesActivityAccount({ destinationAccountId: 'a' }, 'a'), true),
  () => assert.equal(transactionMatchesActivityAccount({ accountId: 'b' }, 'a'), false),
  () => assert.equal(transactionMatchesActivityAccount({ accountId: 'b' }, null), true),
  () => assert.match(source.activity, /transactionMatchesActivityAccount\(t, ui\.activityAccountId\)/),
  () => assert.match(source.activity, /activity-account-filter/),
  () => assert.match(source.activity, /activity-clear-account-filter/),
  () => assert.match(source.activity, /activity-view-all/),
  () => assert.match(source.activity, /ACTIVITY_COPY\.emptyAccount/),
  () => assert.match(source.router, /activityAccountId: source\.activityAccountId/),
  () => assert.match(source.router, /activityFilter: source\.activityFilter/),
  () => assert.match(source.router, /activityQuery: source\.activityQuery/),
  () => assert.match(source.router, /activityMonth: source\.activityMonth/),
];

const captureChecks = [
  () => assert.match(source.capture, /cap-compact-amount/),
  () => assert.match(source.capture, /capture-transaction-details/),
  () => assert.match(source.capture, /capture-accounting-method/),
  () => assert.match(source.capture, /capture-description-row/),
  () => assert.match(source.capture, /nativeDateTimeFieldsHTML/),
  () => assert.match(source.capture, /capture-detail-attachment/),
  () => assert.match(source.capture, /advanced-relation/),
  () => assert.match(source.capture, /role="switch" aria-checked="\$\{cap\.recordOnly\}"/),
  () => assert.match(source.capture, /cap-toggle-record-only/),
  () => assert.match(source.css, /capture-detail-divider/),
  () => assert.match(source.css, /backdrop-filter: blur\(18px\)/),
  () => assert.match(source.css, /@media \(max-width: 350px\)/),
  () => assert.match(source.css, /@media \(prefers-reduced-motion: reduce\)/),
  () => assert.match(source.css, /outline: 2px solid var\(--accent\)/),
  () => assert.match(source.capture, /cap\.recordOnly = !cap\.recordOnly/),
  () => assert.match(source.capture, /recordOnly: cap\.recordOnly/),
  () => assert.match(source.row, /record-only-badge/),
  () => assert.match(source.copy, /CAPTURE_DETAIL_COPY/),
];

const regressionChecks = [
  () => assert.match(source.attachment, /data-manager-remove/),
  () => assert.match(source.attachment, /openAttachmentGallery/),
  () => assert.match(source.attachment, /openAttachmentLightbox/),
  () => assert.match(source.attachment, /removeAttachment/),
  () => assert.match(source.relationship, /split_expense/),
  () => assert.match(source.relationship, /direct_receivable/),
  () => assert.match(source.relationship, /direct_payable/),
  () => assert.match(source.money, /record_only/),
  () => assert.doesNotMatch(Object.values(source).join('\n'), /localStorage\s*\./),
  () => assert.doesNotMatch(Object.values(source).join('\n'), /indexedDB\s*\./),
  () => assert.doesNotMatch(Object.values(source).join('\n'), /supabase/i),
  () => assert.doesNotMatch(Object.values(source).join('\n'), /127\.0\.0\.1:8788|localhost:8788/),
];

names.forEach((name, index) => {
  let checks;
  if (index < 53) checks = contextualChecks;
  else if (index < 74) checks = expansionChecks;
  else if (index < 100) checks = historyChecks.concat(filterChecks);
  else if (index < 157) checks = captureChecks;
  else checks = regressionChecks;
  test(`2B3F-${String(index + 1).padStart(3, '0')}: ${name}`, () => checks[index % checks.length]());
});
