import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createDemoDataSource } from '../src/fixtures/demoData.js';
import {
  walletStackCategoryDeckHTML, walletStackPresentationOrder,
} from '../src/components/WalletStackCategoryDeck.js';
import {
  availableCreditForAccount, creditMonthStats, selectedAccountRecords,
  selectedSavingsFlow, transactionTouchesAccount,
} from '../src/features/assets/category.js';
import {
  isComplexConfirmation, moneyFlowConfirmationHTML, recentHTML,
  recentRecordLimit, uniqueRecentRecords,
} from '../src/components/MoneyFlowConfirmation.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const source = {
  index: read('../index.html'),
  assets: read('../src/features/assets/index.js'),
  category: read('../src/features/assets/category.js'),
  detail: read('../src/features/assets/detail.js'),
  wallet: read('../src/components/WalletStackCategoryDeck.js'),
  native: read('../src/components/NativeSnapCardCarousel.js'),
  visual: read('../src/components/AccountVisualCard.js'),
  confirmation: read('../src/components/MoneyFlowConfirmation.js'),
  capture: read('../src/components/CaptureSheet.js'),
  activity: read('../src/features/activity/index.js'),
  state: read('../src/app/state.js'),
  demo: read('../src/fixtures/demoData.js'),
  ledger: read('../src/features/ledger/index.js'),
  attachment: read('../src/components/AttachmentField.js'),
  copy: read('../src/app/copy.js'),
  css: read('../src/styles/phase2b3e.css'),
  cssCarousel: read('../src/styles/phase2b3c.css'),
  cssFrozen: read('../src/styles/phase2b3d.css'),
  package: read('../package.json'),
  vite: read('../vite.config.js'),
};

const data = createDemoDataSource();
const savings = data.getAccountsByType('saving');
const credit = data.getAccountsByType('cc');
const wallets = data.getAccountsByType('ew');
const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
const records = [
  { id: 'new', desc: '很长但必须安全截断的交易标题测试', kind: 'expense', amountMinor: 1000, date: '2026-07-15', time: '13:14' },
  { id: 'old-1', desc: 'Steam', kind: 'expense', amountMinor: 7800, date: '2026-07-14', time: '09:44' },
  { id: 'old-2', desc: 'Guardian', kind: 'expense', amountMinor: 8200, date: '2026-07-13', time: '09:12' },
  { id: 'old-3', desc: 'Air Selangor', kind: 'expense', amountMinor: 8600, date: '2026-07-12', time: '09:40' },
];
const baseConfirmation = (overrides = {}) => ({
  operation: 'create', kind: 'expense', accountEffect: 'posted', transactionId: 'new',
  amountMinor: 1000, description: '餐饮',
  accountChanges: [{ accountId: 'sv-mbb', accountName: 'Maybank 储蓄卡', accountType: 'saving', measure: 'balance', beforeMinor: 684215, afterMinor: 683215, deltaMinor: -1000 }],
  recentRecords: records.map((record) => ({ ...record })), ...overrides,
});
const relationship = { entryType: 'split_expense', payerName: '我', currentUserShareMinor: 5000, afterMinor: 5000, ledgerTitle: '女朋友' };
const cases = [];
const add = (name, run) => cases.push([name, run]);

// 1–7 Category responsibility
add('Assets overview remains compact', () => assert.match(source.assets, /compactAccountRows/));
add('Assets overview has no large Savings Wallet deck', () => assert.doesNotMatch(source.assets, /WalletStackCategoryDeck|walletStackCategoryDeckHTML/));
add('Assets overview has no large Credit Wallet deck', () => assert.doesNotMatch(source.assets, /wallet-stack-category-deck/));
add('Account Detail remains horizontal carousel', () => assert.match(source.detail, /renderCarousel|activateCarousel/));
add('Savings category uses WalletStackCategoryDeck', () => assert.match(source.category, /walletStackCategoryDeckHTML\(list, selected\.id/));
add('Credit category uses the shared WalletStackCategoryDeck', () => assert.match(source.category, /type === 'saving' \|\| type === 'cc'/));
add('category and Account Detail structures differ', () => { assert.match(source.category, /wallet-stack-section/); assert.doesNotMatch(source.detail, /wallet-stack-section/); });

// 8–19 Wallet stack structure
add('stable account-ID keys', () => assert.match(walletStackCategoryDeckHTML(savings, 'sv-cimb'), /data-wallet-account-id="sv-cimb"/));
add('one selected card', () => assert.equal((walletStackCategoryDeckHTML(savings, 'sv-cimb').match(/class="wallet-stack-card is-selected"/g) || []).length, 1));
add('inactive exposed layers', () => assert.equal((walletStackCategoryDeckHTML(savings, 'sv-cimb').match(/is-inactive/g) || []).length, 3));
add('inactive Savings information', () => assert.match(walletStackCategoryDeckHTML(savings, 'sv-cimb'), /Public Bank Savings[\s\S]*•••• 1357[\s\S]*RM 3,180\.50/));
add('inactive Credit information', () => assert.match(walletStackCategoryDeckHTML(credit, 'cc-mbb-visa', { type: 'cc' }), /Maybank Islamic Ikhwan[\s\S]*4421[\s\S]*到期 02\/08\/2026[\s\S]*RM 1,120\.45/));
add('selected card full visual', () => assert.match(walletStackCategoryDeckHTML(savings, 'sv-mbb'), /account-visual-wallet-stack/));
add('no anonymous color-only layer', () => { const html = walletStackCategoryDeckHTML(savings, 'sv-mbb'); assert.equal((html.match(/wallet-stack-layer-copy/g) || []).length, 3); });
add('card width capped', () => assert.match(source.css, /width: min\(100%, 440px\)/));
add('no horizontal page overflow', () => assert.match(source.css, /width: 100%;[\s\S]*min-width: 0/));
add('mobile readable exposed layers', () => assert.match(source.css, /min-height: 68px/));
add('tablet capped layout', () => assert.match(source.css, /@media \(min-width: 720px\)[\s\S]*440px/));
add('desktop capped layout', () => assert.doesNotMatch(source.css, /wallet-stack-category-deck[^}]*width: 100vw/));

// 20–32 Wallet selection
add('tap inactive Savings promotes exact ID', () => assert.match(source.category, /wallet-stack-account'[\s\S]*\[type\]: el\.dataset\.acc/));
add('tap inactive Credit promotes exact ID', () => assert.match(source.category, /\['saving', 'cc'\]\.includes\(type\)/));
add('previous card returns to stack', () => assert.deepEqual(walletStackPresentationOrder(savings, 'sv-cimb').map((account) => account.id), ['sv-cimb', 'sv-mbb', 'sv-pbb', 'sv-rhb']));
add('selected card visual updates', () => assert.match(walletStackCategoryDeckHTML(savings, 'sv-pbb'), /data-selected-account-id="sv-pbb"[\s\S]*data-account-visual="sv-pbb"/));
add('selected account summary updates', () => assert.match(source.category, /data-summary-account-id="\$\{escapeHTML\(selected\.id\)\}"/));
add('Recent Records update', () => assert.match(source.category, /data-recent-account-id="\$\{escapeHTML\(selected\?\.id/));
add('active full card opens Account Detail', () => assert.match(source.category, /dispatchAction\('assets-open-detail', el, event\)/));
add('inactive tap does not open Account Detail', () => assert.match(source.category, /if \(accountId !== ui\.selectedAccountId\[type\]\)[\s\S]*return;/));
add('no duplicate navigation', () => assert.equal((source.category.match(/dispatchAction\('assets-open-detail', el, event\)/g) || []).length, 1));
add('no pointer-down navigation', () => assert.doesNotMatch(source.wallet + source.category, /pointerdown|mousedown|touchstart/));
add('reduced-motion selection', () => assert.match(source.css, /prefers-reduced-motion: reduce[\s\S]*wallet-stack-card\.is-selected[\s\S]*animation: none/));
add('keyboard selection', () => assert.match(walletStackCategoryDeckHTML(savings, 'sv-mbb'), /<button type="button"[\s\S]*role="option"/));
add('focus visibility', () => assert.match(source.css, /wallet-stack-card:focus-visible/));

// 33–41 Account-ID integrity
add('selectedAccountId equals active card ID', () => assert.match(walletStackCategoryDeckHTML(savings, 'sv-rhb'), /data-selected-account-id="sv-rhb"[\s\S]*aria-selected="true"/));
add('selectedAccountId equals summary account ID', () => assert.match(source.category, /ui\.selectedAccountId\[type\] = selected\.id/));
add('selectedAccountId equals Recent Records account ID', () => assert.match(source.category, /recentHTML\(type, selected/));
add('selected card art correct', () => assert.match(walletStackCategoryDeckHTML(savings, 'sv-mbb'), /maybank-global-access-mastercard-world\.png/));
add('selected balance correct', () => assert.match(walletStackCategoryDeckHTML(savings, 'sv-cimb'), /RM 2,400\.00/));
add('selected masked digits correct', () => assert.match(walletStackCategoryDeckHTML(savings, 'sv-pbb'), /•••• 1357/));
add('no stale prior-account records', () => { const rows = selectedAccountRecords(data.getActivities(), 'sv-cimb'); assert.ok(rows.every((row) => transactionTouchesAccount(row, 'sv-cimb'))); });
add('no first-account fallback when valid selection exists', () => assert.equal(walletStackPresentationOrder(savings, 'sv-pbb')[0].id, 'sv-pbb'));
add('back preserves selected category account', () => assert.match(source.state, /selectedAccountId: \{ saving: null, cc: null, ew: null \}/));

// 42–50 Savings category
add('Savings category total unchanged', () => assert.equal(sum(savings, 'balance'), 14327.85));
add('Savings account count unchanged', () => assert.equal(savings.length, 4));
add('monthly inflow remains canonical', () => assert.equal(data.getSavingsFlow().inflow, 4150));
add('monthly outflow remains canonical', () => assert.equal(data.getSavingsFlow().outflow, 2318.4));
add('selected Savings balance correct', () => assert.equal(data.getAccount('sv-mbb').balance, 6842.15));
add('recent change uses selected first record', () => { const rows = selectedAccountRecords(data.getActivities(), 'sv-mbb'); assert.equal(rows[0]?.id, data.getActivities().find((row) => transactionTouchesAccount(row, 'sv-mbb'))?.id); });
add('three selected-account records', () => assert.equal(selectedAccountRecords(data.getActivities(), 'sv-mbb').length, 3));
add('View All uses exact stable account filter', () => { assert.match(source.category, /activityAccountId: element\.dataset\.acc/); assert.match(source.activity, /ui\.activityAccountId/); });
add('exact Account Detail CTA', () => assert.match(source.category, /wallet-detail-cta[\s\S]*data-acc="\$\{escapeHTML\(selected\.id\)\}"/));

// 51–60 Credit category
add('Credit total debt unchanged', () => assert.equal(sum(credit, 'outstanding'), 5258.25));
add('debt displayed without redundant minus', () => assert.match(walletStackCategoryDeckHTML(credit, credit[0].id, { type: 'cc' }), /RM 3,247\.80/));
add('Credit card count unchanged', () => assert.equal(credit.length, 3));
add('selected current debt correct', () => assert.equal(data.getAccount('cc-mbb-visa').outstanding, 3247.8));
add('selected monthly due includes instalment', () => assert.equal(data.getAccount('cc-mbb-visa').monthlyDue + data.getInstalments('cc-mbb-visa').reduce((s, item) => s + item.monthly, 0), 1250));
add('selected due date correct', () => assert.equal(data.getAccount('cc-mbb-visa').dueDate, '2026-07-26'));
add('standalone available limit correct', () => assert.equal(availableCreditForAccount(data.getAccount('cc-rhb'), credit), 5110));
add('shared-limit semantics preserved', () => assert.equal(availableCreditForAccount(data.getAccount('cc-mbb-visa'), credit), 15631.75));
add('three selected-card records', () => assert.equal(selectedAccountRecords(data.getActivities(), 'cc-mbb-visa').length, 3));
add('Credit exact Account Detail CTA', () => assert.match(source.category, /copy\.detailPrefix[\s\S]*selected\.name[\s\S]*copy\.detailSuffix/));

// 61–68 Horizontal carousel freeze
add('Account Detail still uses native horizontal carousel', () => assert.match(source.detail, /activateCarousel/));
add('no mouse drag-to-scroll added', () => assert.doesNotMatch(source.native + source.wallet, /mousedown|mousemove|drag-to-scroll/));
add('no pointer capture added', () => assert.doesNotMatch(source.native + source.wallet, /setPointerCapture|releasePointerCapture/));
add('no touchmove preventDefault added', () => assert.doesNotMatch(source.native + source.wallet, /touchmove/));
add('existing scroll snap preserved', () => assert.match(source.cssCarousel, /scroll-snap-type: x mandatory/));
add('active dot preserved', () => assert.match(source.native, /data-dot-account-id/));
add('side-card tap preserved', () => assert.match(source.native, /cardIndex === settledIndex/));
add('carousel account-ID invariant preserved', () => assert.match(source.native, /data-selected-account-id/));

// 69–78 Confirmation shell
add('scrollable Confirmation body exists', () => assert.match(moneyFlowConfirmationHTML(baseConfirmation()), /data-money-motion-body/));
add('Confirmation body min-height zero', () => assert.match(source.css, /money-motion-body[\s\S]*min-height: 0/));
add('Confirmation vertical overflow auto', () => assert.match(source.css, /money-motion-body[\s\S]*overflow-y: auto/));
add('Confirmation overscroll contained', () => assert.match(source.css, /overscroll-behavior: contain/));
add('sticky footer exists', () => { assert.match(moneyFlowConfirmationHTML(baseConfirmation()), /data-money-motion-footer/); assert.match(source.css, /money-motion-actions[\s\S]*position: sticky/); });
add('footer safe-area padding', () => assert.match(source.css, /money-motion-actions[\s\S]*env\(safe-area-inset-bottom\)/));
add('content does not render under footer', () => assert.match(moneyFlowConfirmationHTML(baseConfirmation()), /<div class="money-motion-body"[\s\S]*<footer class="money-motion-actions"/));
add('simple confirmation has no forced fixed body height', () => assert.doesNotMatch(source.css, /money-motion-body[^}]*height:\s*100%/));
add('complex confirmation can scroll', () => assert.match(moneyFlowConfirmationHTML(baseConfirmation({ relationship })), /data-complex="true"/));
add('whole-shell content compression removed', () => assert.match(source.css, /money-motion-card[\s\S]*overflow: hidden[\s\S]*flex-direction: column/));

// 79–88 No-shrink contract
add('identity bar does not shrink', () => assert.match(source.css, /account-identity-bar,[\s\S]*flex: 0 0 auto/));
add('account visual does not shrink', () => assert.match(source.css, /account-visual-confirmation,[\s\S]*flex: 0 0 auto/));
add('balance panel does not shrink', () => assert.match(source.css, /motion-balance-copy,[\s\S]*flex: 0 0 auto/));
add('transaction panel does not shrink', () => assert.match(source.css, /motion-transaction-effect,[\s\S]*flex: 0 0 auto/));
add('relationship result does not shrink', () => assert.match(source.css, /motion-relationship-card,[\s\S]*flex: 0 0 auto/));
add('recent header does not shrink', () => assert.match(source.css, /motion-recent-head,[\s\S]*flex: 0 0 auto/));
add('recent rows do not shrink', () => assert.match(source.css, /motion-recent-row,[\s\S]*flex: 0 0 auto/));
add('transfer identities do not shrink', () => assert.match(source.css, /motion-account-list,[\s\S]*flex: 0 0 auto/));
add('monthly result does not shrink', () => assert.match(source.css, /motion-plan-card,[\s\S]*flex: 0 0 auto/));
add('instalment result does not shrink', () => assert.match(source.css, /motion-plan-card,[\s\S]*flex: 0 0 auto/));

// 89–100 Recent Records
add('simple confirmation shows three rows', () => assert.equal((recentHTML(baseConfirmation()).match(/data-motion-record-id/g) || []).length, 3));
add('complex confirmation initially shows two rows', () => assert.equal((recentHTML(baseConfirmation({ relationship })).match(/data-motion-record-id/g) || []).length, 2));
add('local expansion has unambiguous wording', () => assert.match(recentHTML(baseConfirmation({ relationship })), /data-motion-recent-toggle[\s\S]*展开更多/));
add('View All expands remaining rows', () => assert.equal((recentHTML(baseConfirmation({ relationship }), { expanded: true }).match(/data-motion-record-id/g) || []).length, 4));
add('footer remains outside expanded body', () => assert.match(moneyFlowConfirmationHTML(baseConfirmation({ relationship }), { recentExpanded: true }), /data-motion-recent[\s\S]*<\/div>\s*<footer/));
add('new record appears once', () => assert.equal((recentHTML(baseConfirmation(), { expanded: true }).match(/data-motion-record-id="new"/g) || []).length, 1));
add('stable transaction-ID keys', () => assert.match(recentHTML(baseConfirmation()), /data-motion-record-id="old-1"/));
add('normal row minimum height', () => assert.match(source.css, /motion-recent-row[\s\S]*min-height: 60px/));
add('title date and amount use separate nodes', () => assert.match(recentHTML(baseConfirmation()), /<b>很长[\s\S]*<small>15\/07\/2026 · 1:14 PM<\/small>[\s\S]*<strong class="num">/));
add('long title ellipsis', () => assert.match(source.css, /motion-recent-row > span > b[\s\S]*text-overflow: ellipsis/));
add('new-row highlight settles without height collapse', () => { assert.match(source.css, /frame-1 \.motion-recent-row\.newest[\s\S]*min-height: 60px/); assert.doesNotMatch(source.css, /frame-1 \.motion-recent-row\.newest[^}]*max-height: 0/); });
add('Recent expansion does not mutate transaction data', () => { const confirmation = baseConfirmation({ relationship }); const before = structuredClone(confirmation); recentHTML(confirmation, { expanded: true }); assert.deepEqual(confirmation, before); });

// 101–112 Complex variants
add('user-paid AA is complex', () => assert.equal(isComplexConfirmation(baseConfirmation({ relationship })), true));
add('other-payer AA is complex', () => assert.equal(isComplexConfirmation(baseConfirmation({ accountEffect: 'relationship_only', relationship: { ...relationship, payerName: 'Abi' } })), true));
add('relationship receivable card', () => assert.match(moneyFlowConfirmationHTML(baseConfirmation({ relationship })), /新增待收/));
add('relationship payable card', () => assert.match(moneyFlowConfirmationHTML(baseConfirmation({ accountEffect: 'relationship_only', relationship: { ...relationship, payerName: 'Abi' } })), /你应付/));
add('received payment confirmation', () => assert.match(moneyFlowConfirmationHTML(baseConfirmation({ kind: 'settlement', relationship: { entryType: 'settlement_received', afterMinor: 2400, ledgerTitle: 'Abi' } })), /结算后剩余/));
add('repayment confirmation', () => assert.match(moneyFlowConfirmationHTML(baseConfirmation({ kind: 'settlement', relationship: { entryType: 'settlement_paid', afterMinor: 2200, ledgerTitle: 'Abi' } })), /结算后剩余/));
add('direct debt confirmation', () => assert.match(moneyFlowConfirmationHTML(baseConfirmation({ relationship: { entryType: 'direct_payable', afterMinor: 5000, ledgerTitle: 'Abi' } })), /新增待付/));
add('transfer confirmation', () => { const value = baseConfirmation({ kind: 'transfer', accountChanges: [baseConfirmation().accountChanges[0], { accountId: 'ew-tng', accountName: "Touch 'n Go", accountType: 'ew', measure: 'balance', beforeMinor: 34260, afterMinor: 35260, deltaMinor: 1000 }] }); assert.equal((moneyFlowConfirmationHTML(value).match(/account-identity-bar/g) || []).length, 2); });
add('monthly payment confirmation', () => assert.match(moneyFlowConfirmationHTML(baseConfirmation({ kind: 'plan', plan: { title: '每月账', afterPaidMinor: 1000, remainingMinor: 2000 } })), /计划已更新/));
add('instalment payment confirmation', () => assert.match(moneyFlowConfirmationHTML(baseConfirmation({ kind: 'plan', plan: { title: '分期', afterPaidMinor: 1000, remainingMinor: 9000 } })), /剩余 RM 90\.00/));
add('record-only confirmation truthful', () => assert.match(moneyFlowConfirmationHTML(baseConfirmation({ accountEffect: 'record_only', accountChanges: [{ ...baseConfirmation().accountChanges[0], afterMinor: 684215, deltaMinor: 0 }] })), /余额未变/));
add('relationship-only update truthful', () => assert.match(moneyFlowConfirmationHTML(baseConfirmation({ accountEffect: 'relationship_only', relationship })), /余额未变/));

// 113–120 Transfer flow
const transfer = baseConfirmation({ kind: 'transfer', accountChanges: [baseConfirmation().accountChanges[0], { accountId: 'ew-tng', accountName: "Touch 'n Go", accountType: 'ew', measure: 'balance', beforeMinor: 34260, afterMinor: 35260, deltaMinor: 1000 }] });
add('transfer source identity fixed height', () => assert.match(moneyFlowConfirmationHTML(transfer), /转出[\s\S]*sv-mbb/));
add('transfer source card fixed height', () => assert.match(source.css, /account-visual-confirmation,[\s\S]*flex: 0 0 auto/));
add('transfer destination identity fixed height', () => assert.match(moneyFlowConfirmationHTML(transfer), /转入[\s\S]*ew-tng/));
add('transfer destination card fixed height', () => assert.equal((moneyFlowConfirmationHTML(transfer).match(/account-visual-confirmation/g) || []).length, 2));
add('transfer content scrollable', () => assert.match(moneyFlowConfirmationHTML(transfer), /data-money-motion-body/));
add('transfer footer fixed', () => assert.match(moneyFlowConfirmationHTML(transfer), /data-money-motion-footer/));
add('both transfer balances correct', () => assert.match(moneyFlowConfirmationHTML(transfer), /RM 6,842\.15[\s\S]*RM 342\.60/));
add('transfer has no recent-row compression', () => assert.equal(recentRecordLimit(transfer), 2));

// 121–130 Visual regressions
add('Confirmation identity bar unchanged', () => assert.match(moneyFlowConfirmationHTML(baseConfirmation()), /account-identity-bar glass-sheet/));
add('real bank card remains', () => assert.match(moneyFlowConfirmationHTML(baseConfirmation()), /account-visual-art/));
add('eWallet visual remains', () => assert.match(source.visual, /account-wallet-brand/));
add('Odometer final frame static', () => assert.match(source.confirmation, /next === 3[\s\S]*remove\(\)/));
add('no lifted digit', () => assert.match(source.cssCarousel + source.cssFrozen, /motion-static-balance[\s\S]*transform: none/));
add('no blank first frame', () => assert.match(moneyFlowConfirmationHTML(baseConfirmation(), { frame: 1 }), /RM 6,842\.15/));
add('no Skip Animation control', () => assert.doesNotMatch(source.confirmation, /跳过动画|motion-skip/));
add('action buttons unchanged', () => assert.match(moneyFlowConfirmationHTML(baseConfirmation()), /继续记账[\s\S]*查看记录[\s\S]*完成/));
add('dark mode uses shared semantic tokens', () => assert.match(source.css, /var\(--glass-sheet-bg\)/));
add('reduced motion covers Wallet and Recent rows', () => assert.match(source.css, /prefers-reduced-motion: reduce[\s\S]*motion-recent-row/));

// 131–149 Regression/isolation
add('all previous 771 tests remain registered', () => ['phase2b3.test.mjs', 'phase2b3a.test.mjs', 'phase2b3b.test.mjs', 'phase2b3c.test.mjs', 'phase2b3d.test.mjs'].forEach((name) => assert.equal(fs.existsSync(new URL(name, import.meta.url)), true)));
add('calculator unchanged', () => assert.match(source.capture, /capture-calculator/));
add('Assets overview unchanged', () => assert.match(source.assets, /asset-card-stack/));
add('eWallet overview unchanged', () => assert.match(source.assets, /asset-wallet-tile/));
add('Account Detail unchanged', () => assert.match(source.detail, /renderDetailPage/));
add('account totals unchanged', () => assert.equal(sum(savings, 'balance'), 14327.85));
add('Credit debt unchanged', () => assert.equal(sum(credit, 'outstanding'), 5258.25));
add('AA unchanged', () => assert.match(source.demo, /recordRelationshipEntry/));
add('settlement unchanged', () => assert.match(source.demo, /settleRelationship/));
add('monthly plan unchanged', () => assert.match(source.demo, /getObligationPlans/));
add('instalment unchanged', () => assert.match(source.demo, /getInstalments/));
add('attachment behavior unchanged', () => assert.match(source.attachment, /openAttachmentGallery/));
add('no network', () => Object.values(source).forEach((text) => assert.doesNotMatch(text, /\bfetch\s*\(|XMLHttpRequest|WebSocket/)));
add('no localStorage', () => Object.values(source).forEach((text) => assert.doesNotMatch(text, /\blocalStorage\b/)));
add('no IndexedDB', () => Object.values(source).forEach((text) => assert.doesNotMatch(text, /\bindexedDB\b/)));
add('no Supabase', () => Object.values(source).forEach((text) => assert.doesNotMatch(text, /createClient\s*\(|supabase\.co/iu)));
add('no real Telegram', () => Object.values(source).forEach((text) => assert.doesNotMatch(text, /api\.telegram\.org|tg:\/\//iu)));
add('no real App-to-App', () => Object.values(source).forEach((text) => assert.doesNotMatch(text, /app-to-app:\/\//iu)));
add('port 8788 untouched by scripts/tests', () => { assert.doesNotMatch(source.package, /8788/); assert.doesNotMatch(source.vite, /port\s*:\s*8788|proxy\s*:/); });

assert.equal(cases.length, 149);
cases.forEach(([name, run], index) => test(`2B3E-${String(index + 1).padStart(3, '0')}: ${name}`, run));
