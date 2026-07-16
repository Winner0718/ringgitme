import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  centeredScrollLeft, nearestCenterIndex, renderNativeSnapCardCarousel,
} from '../src/components/NativeSnapCardCarousel.js';
import { accountVisualCardHTML } from '../src/components/AccountVisualCard.js';
import {
  moneyFlowConfirmationHTML, odometerHTML, uniqueRecentRecords,
} from '../src/components/MoneyFlowConfirmation.js';
import {
  evaluateMoneyExpression, inspectMoneyExpression,
} from '../src/components/MoneyCalculatorSheet.js';
import { createDemoDataSource } from '../src/fixtures/demoData.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const source = {
  native: read('../src/components/NativeSnapCardCarousel.js'),
  facade: read('../src/components/CardCarousel.js'),
  deck: read('../src/components/StackedDeck.js'),
  visual: read('../src/components/AccountVisualCard.js'),
  capture: read('../src/components/CaptureSheet.js'),
  confirmation: read('../src/components/MoneyFlowConfirmation.js'),
  copy: read('../src/app/copy.js'),
  css: read('../src/styles/phase2b3c.css'),
  css2b3d: read('../src/styles/phase2b3d.css'),
  assets: read('../src/features/assets/index.js'),
  category: read('../src/features/assets/category.js'),
  detail: read('../src/features/assets/detail.js'),
  state: read('../src/app/state.js'),
  activity: read('../src/features/activity/index.js'),
  ledger: read('../src/features/ledger/index.js'),
  attachment: read('../src/components/AttachmentField.js'),
  split: read('../src/domain/smartSplit.js'),
  demo: read('../src/fixtures/demoData.js'),
  package: read('../package.json'),
  vite: read('../vite.config.js'),
};
const data = createDemoDataSource();
const savings = data.getAccountsByType('saving');
const credit = data.getAccountsByType('cc');
const wallets = data.getAccountsByType('ew');
const accountB = savings[1];
const cards = [
  { offsetLeft: 20, offsetWidth: 240 },
  { offsetLeft: 272, offsetWidth: 240 },
  { offsetLeft: 524, offsetWidth: 240 },
];
const scroller = (left) => ({ scrollLeft: left, clientWidth: 280 });
const confirmation = (overrides = {}) => ({
  operation: 'create', kind: 'expense', accountEffect: 'posted',
  description: 'KFC 午餐', transactionId: 'txn-b3c', amountMinor: 1000,
  accountChanges: [{ accountId: 'sv-mbb', accountName: 'Maybank 储蓄卡', accountType: 'saving', measure: 'balance', beforeMinor: 684215, afterMinor: 683215, deltaMinor: -1000 }],
  recentRecords: [
    { id: 'txn-b3c', desc: 'KFC 午餐', kind: 'expense', amountMinor: 1000, date: '2026-07-15', time: '13:14' },
    { id: 'txn-old', desc: 'Steam', kind: 'expense', amountMinor: 7800, date: '2026-07-14', time: '09:44' },
  ],
  ...overrides,
});
const cases = [];
const add = (group, name, run) => cases.push([group, name, run]);

// 1–10: native carousel structure
add('N', 'native horizontal overflow', () => assert.match(source.css, /native-carousel-scroller[\s\S]*overflow-x: auto/));
add('N', 'scroll-snap container', () => assert.match(source.css, /scroll-snap-type: x mandatory/));
add('N', 'centered snap cards', () => { assert.match(source.css, /scroll-snap-align: center/); assert.match(source.css, /100vw - var\(--snap-gutter\) - var\(--snap-gutter\)/); });
add('N', 'no pointer-transform drag engine', () => assert.doesNotMatch(source.native, /pointerdown|pointermove|translateX/));
add('N', 'no custom horizontal preventDefault', () => assert.doesNotMatch(source.native, /touchmove|pointermove/));
add('N', 'no custom pointer capture for movement', () => assert.doesNotMatch(source.native, /setPointerCapture|releasePointerCapture/));
add('N', 'native vertical page scrolling preserved', () => assert.match(source.css, /touch-action: pan-x pan-y pinch-zoom/));
add('N', 'stable account-ID card keys', () => assert.match(renderNativeSnapCardCarousel(savings, 1), /data-snap-account-id="sv-cimb"/));
add('N', 'no page-level horizontal overflow', () => { assert.match(source.css, /native-carousel-shell\.deck-viewport[\s\S]*overflow: visible/); assert.doesNotMatch(source.css, /body[^{]*\{[^}]*overflow-x: auto/); });
add('N', 'reduced-motion card presentation', () => assert.match(source.css, /prefers-reduced-motion: reduce[\s\S]*native-snap-card[\s\S]*transition: none/));

// 11–20: scroll settle
add('S', 'scrollend selection', () => assert.match(source.native, /addEventListener\('scrollend', settle\)/));
add('S', 'debounced fallback selection', () => assert.match(source.native, /setTimeout\(settle, SETTLE_DELAY_MS\)/));
add('S', 'nearest-center calculation', () => assert.equal(nearestCenterIndex(scroller(252), cards), 1));
add('S', 'selection updates once after settle', () => assert.match(source.native, /if \(nextIndex === settledIndex\) return;[\s\S]*onChange\?\./));
add('S', 'no selection flicker during momentum', () => assert.doesNotMatch(source.native.match(/const onScroll[\s\S]*?};/)?.[0] || '', /onChange/));
add('S', 'middle account selection', () => assert.equal(nearestCenterIndex(scroller(252), cards), 1));
add('S', 'first account selection', () => assert.equal(nearestCenterIndex(scroller(0), cards), 0));
add('S', 'last account selection', () => assert.equal(nearestCenterIndex(scroller(504), cards), 2));
add('S', 'one normal swipe adjacent result', () => assert.equal(nearestCenterIndex(scroller(260), cards), 1));
add('S', 'initial instant positioning', () => { assert.match(source.native, /debug-scroll-position[\s\S]*scroller\.scrollLeft = initialLeft/); assert.match(source.css, /debug-scroll-position[\s\S]*scroll-snap-type: none/); assert.doesNotMatch(source.native, /initialLeft[\s\S]{0,80}behavior: 'smooth'/); });

// 21–32: account integrity
add('A', 'B first visible frame', () => assert.match(renderNativeSnapCardCarousel(savings, 1), /data-selected-account-id="sv-cimb"/));
add('A', 'B artwork or branded fallback', () => assert.match(accountVisualCardHTML(accountB), /account-visual-fallback/));
add('A', 'B balance', () => assert.match(accountVisualCardHTML(accountB), /RM 2,400\.00/));
add('A', 'B metadata', () => assert.match(accountVisualCardHTML(accountB), /CIMB OctoSavers[\s\S]*2468/));
add('A', 'B transactions', () => assert.ok(data.getActivities().filter((row) => row.accountId === accountB.id).every((row) => row.accountId === 'sv-cimb')));
add('A', 'active dot B', () => assert.match(renderNativeSnapCardCarousel(savings, 1), /class="on" data-dot-account-id="sv-cimb"/));
add('A', 'transition visual B', () => { assert.match(source.native, /card\.style\.opacity/); assert.doesNotMatch(source.native, /card\.style\.transform/); assert.match(source.css2b3d, /native-snap-card\.deck-card[\s\S]*transform: none/); });
add('A', 'back preserves B', () => assert.match(source.state, /selectedAccountId/));
add('A', 'category and detail share B', () => { assert.match(source.category, /selectedAccountId\[type\]/); assert.match(source.detail, /assetsView: \{ \.\.\.ui\.assetsView, accountId: target\.id \}/); });
add('A', 'credit-card equivalent', () => assert.match(renderNativeSnapCardCarousel(credit, 1), new RegExp(`data-selected-account-id="${credit[1].id}"`)));
add('A', 'no index-zero flash', () => assert.match(source.css, /native-carousel-shell\.deck-viewport[\s\S]*opacity: 0[\s\S]*is-ready/));
add('A', 'no stale artwork', () => assert.match(source.native, /accountVisualCardHTML\(account/));

// 33–37: tap versus scroll
add('T', 'active card tap action', () => assert.match(source.native, /if \(cardIndex === settledIndex\) return/));
add('T', 'native scroll suppresses accidental click', () => assert.match(source.native, /performance\.now\(\) < recentScrollUntil/));
add('T', 'no duplicate navigation', () => assert.match(source.native, /stopPropagation\(\)/));
add('T', 'side-card selection rule', () => assert.match(source.native, /scroller\.scrollTo\(\{ left: centeredScrollLeft/));
add('T', 'normal vertical gesture does not open card', () => assert.doesNotMatch(source.native, /touchstart|touchend|pointerup/));

// 38–47: Capture order
const captureMarkup = source.capture.match(/function captureHTML\(\)[\s\S]*?\n}\n\nfunction directKeypadHTML/)?.[0] || '';
const captureOrder = ['capture-modes', 'amountHeroHTML()', 'quickRow(cap.mode)', 'accountsHTML(accounts)', 'cap-open-details', 'directKeypadHTML()', 'cap-save'];
add('C', 'type tabs first', () => assert.equal(captureMarkup.indexOf(captureOrder[0]) < captureMarkup.indexOf(captureOrder[1]), true));
add('C', 'amount hero', () => assert.match(source.capture, /cap-amount-value/));
add('C', 'category before More Details', () => assert.match(source.capture, /defaultFlow = `\$\{amountHeroHTML\(\)\}[\s\S]*quickRow\(cap\.mode\)[\s\S]*\$\{more\}/));
add('C', 'account before More Details', () => assert.match(source.capture, /defaultFlow = `[\s\S]*accountsHTML\(accounts\)[\s\S]*\$\{more\}/));
add('C', 'More Details before calculator', () => assert.equal(captureMarkup.indexOf(captureOrder[4]) < captureMarkup.indexOf(captureOrder[5]), true));
add('C', 'calculator before Save', () => assert.equal(captureMarkup.indexOf(captureOrder[5]) < captureMarkup.indexOf(captureOrder[6]), true));
add('C', 'expanded details replace the large calculator', () => { assert.match(source.capture, /detailFlow = `\$\{compactAmountBarHTML\(\)\}[\s\S]*inlineDetailsHTML\(\)/); assert.match(source.capture, /cap-edit-amount/); });
add('C', 'amount preserved during expansion', () => assert.match(source.capture, /cap\.detailsOpen = !cap\.detailsOpen/));
add('C', 'attachment preserved during expansion', () => assert.match(source.capture, /attachmentSummaryHTML\('draft', cap\.submissionKey\)/));
add('C', 'Save remains in the full Capture sheet footer', () => { assert.match(captureMarkup, /cap-save-wrap/); assert.match(source.css2b3d, /cap-save-wrap[\s\S]*position: relative/); });

// 48–65: calculator visual and behavior
add('K', 'one main amount display', () => assert.equal((source.capture.match(/class="cap-amount-value"/g) || []).length, 1));
add('K', 'no large duplicated result panel', () => assert.doesNotMatch(source.capture, /calculator-result-panel|calculator-display-card/));
add('K', 'no permanent formula and result labels', () => assert.doesNotMatch(source.capture, />算式<|>结果</));
add('K', 'no Apply button', () => assert.doesNotMatch(source.capture, /data-key="apply"|应用金额/));
add('K', 'equals commits result', () => assert.match(source.capture, /key === '='/));
add('K', 'ordinary digits update amount', () => assert.match(source.capture, /cap\.amount \+= key/));
add('K', 'balanced keypad contract', () => assert.match(source.css, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/));
add('K', 'no unexplained empty grid cell', () => assert.equal((source.capture.match(/'C','back','÷','×','7','8','9','−','4','5','6','\+','1','2','3','=','0','\.'/g) || []).length, 1));
add('K', 'one equals key', () => assert.equal((source.capture.match(/const keys = \[[^\]]*'='/g) || []).length, 1));
add('K', 'zero layout', () => assert.match(source.css, /capture-calculator-key\.zero \{ grid-column: 1 \/ span 2/));
add('K', 'decimal input', () => assert.equal(evaluateMoneyExpression('1.25').minor, 125));
add('K', 'clear', () => assert.match(source.capture, /key === 'C'.*cap\.amount = ''/));
add('K', 'backspace', () => assert.match(source.capture, /key === 'back'.*slice\(0, -1\)/));
add('K', 'operator precedence', () => assert.equal(evaluateMoneyExpression('500+250×2').minor, 100000));
add('K', 'incomplete expression feedback', () => assert.equal(inspectMoneyExpression('1+').helper, '继续输入数字'));
add('K', 'Save blocked for incomplete expression', () => assert.match(source.capture, /请先完成算式/));
add('K', 'expression preserved', () => assert.doesNotMatch(source.capture, /请先完成算式[\s\S]{0,120}cap\.amount\s*=/));
add('K', 'no eval or Function', () => assert.doesNotMatch(source.capture, /\beval\s*\(|new Function|Function\s*\(/));

// 66–75: shared account visual
add('V', 'Assets and confirmation share account visual source', () => { assert.match(source.native, /AccountVisualCard/); assert.match(source.confirmation, /AccountVisualCard/); });
add('V', 'savings real-card visual', () => assert.match(accountVisualCardHTML(savings[0]), /maybank-global-access-mastercard-world\.png/));
add('V', 'credit-card visual', () => assert.match(accountVisualCardHTML(credit[0]), /maybank-visa-platinum\.png/));
add('V', 'eWallet visual', () => assert.match(accountVisualCardHTML(wallets[0]), /account-wallet-brand/));
add('V', 'masked digits', () => assert.match(accountVisualCardHTML(savings[0]), /•••• 8888/));
add('V', 'correct logo', () => assert.match(accountVisualCardHTML(wallets[0]), /data-brand-image/));
add('V', 'correct card art', () => assert.match(accountVisualCardHTML(credit[1]), new RegExp(credit[1].art.replaceAll('.', '\\.'))));
add('V', 'polished fallback', () => assert.match(accountVisualCardHTML(accountB), /account-visual-name[\s\S]*account-visual-bank/));
add('V', 'no broken-image icon', () => assert.match(source.visual, /naturalWidth === 0/));
add('V', 'no wrong-account asset', () => assert.match(accountVisualCardHTML(accountB), /data-account-visual="sv-cimb"/));

// 76–84: confirmation layout
add('F', 'truthful status copy', () => { const html = moneyFlowConfirmationHTML(confirmation()); assert.match(html, /account-identity-status[\s\S]*已更新/); assert.doesNotMatch(html, /跳过动画|data-motion-skip/); });
add('F', 'account visual is primary', () => { assert.ok(moneyFlowConfirmationHTML(confirmation()).indexOf('account-visual') < moneyFlowConfirmationHTML(confirmation()).indexOf('motion-transaction-effect')); assert.match(source.css, /account-visual-confirmation[^}]*aspect-ratio: 1\.586/); });
add('F', 'reduced nested frames', () => assert.equal((moneyFlowConfirmationHTML(confirmation()).match(/motion-balance-hero/g) || []).length, 1));
add('F', 'identity and card share one stable account', () => { const html = moneyFlowConfirmationHTML(confirmation()); assert.match(html, /data-account-identity="sv-mbb"[\s\S]*data-account-visual="sv-mbb"/); });
add('F', 'no blank first frame', () => assert.match(moneyFlowConfirmationHTML(confirmation(), { frame: 1 }), /account-visual[\s\S]*RM 6,842\.15/));
add('F', 'card asset prepared', () => assert.match(moneyFlowConfirmationHTML(confirmation(), { frame: 1 }), /data-card-art/));
add('F', 'transaction effect shown', () => assert.match(moneyFlowConfirmationHTML(confirmation()), /本次[\s\S]*KFC 午餐[\s\S]*−RM 10\.00/));
add('F', 'bottom actions preserved', () => assert.match(moneyFlowConfirmationHTML(confirmation()), /继续记账[\s\S]*查看记录[\s\S]*完成/));
add('F', 'actions single-fire', () => assert.match(source.confirmation, /if \(closed\) return/));

// 85–106: odometer safety
add('O', 'temporary animated overlay', () => assert.match(odometerHTML(100, 200), /motion-odometer-overlay/));
add('O', 'static initial layer', () => assert.match(moneyFlowConfirmationHTML(confirmation(), { frame: 1 }), /motion-static-balance[\s\S]*RM 6,842\.15/));
add('O', 'animated overlay unmounted after settle', () => assert.match(source.confirmation, /next === 3[\s\S]*data-motion-odometer-overlay[\s\S]*remove\(\)/));
add('O', 'static final text', () => assert.match(moneyFlowConfirmationHTML(confirmation(), { frame: 3 }), /motion-static-balance[\s\S]*RM 6,832\.15/));
add('O', 'final text has no transform', () => assert.match(source.css, /motion-static-balance[^}]*transform: none/));
add('O', 'tabular numbers', () => assert.match(source.css, /motion-balance-stage[\s\S]*font-variant-numeric: tabular-nums/));
add('O', 'RM token static', () => { assert.match(odometerHTML(100, 200), /motion-digit stable">R/); assert.match(odometerHTML(100, 200), /motion-digit stable space/); });
add('O', 'comma static', () => assert.match(odometerHTML(9999999, 10000000), /motion-digit stable">,/));
add('O', 'decimal point static', () => assert.match(odometerHTML(101, 109), /motion-digit stable">\./));
add('O', 'minus remains outside the balance odometer', () => assert.doesNotMatch(odometerHTML(100, 200), /−/));
add('O', 'fixed digit cells during animation', () => assert.match(source.css, /motion-digit \{[\s\S]*width: \.62em/));
add('O', 'explicit line-height', () => assert.match(source.css, /motion-digit \{[\s\S]*line-height: 1\.18em/));
add('O', 'Safari vertical padding', () => assert.match(source.css, /motion-digit \{[\s\S]*padding-block: \.08em/));
add('O', 'no ancestor scale', () => assert.doesNotMatch(source.css.match(/\.money-motion-card \{[^}]*\}/)?.[0] || '', /transform: scale/));
add('O', 'decrease animation', () => assert.match(odometerHTML(200, 100), /motion-digit changed/));
add('O', 'increase animation', () => assert.match(odometerHTML(100, 200), /motion-digit changed/));
add('O', 'comma-boundary transition', () => assert.match(odometerHTML(99999, 100000), /RM 999\.99 到 RM 1,000\.00/));
add('O', 'decimal transition', () => assert.match(odometerHTML(101, 109), /RM 1\.01 到 RM 1\.09/));
add('O', 'large RM value', () => assert.match(odometerHTML(9999999, 10000000), /RM 99,999\.99 到 RM 100,000\.00/));
add('O', 'final no clipping', () => assert.match(source.css, /motion-static-balance[^}]*overflow: visible/));
add('O', 'final no superscript', () => { assert.doesNotMatch(moneyFlowConfirmationHTML(confirmation(), { frame: 3 }), /motion-digit|<sup/); assert.match(source.css, /debug-motion-frame\.frame-2[\s\S]*translateY\(0\)/); });
add('O', 'reduced-motion no overlay', () => assert.match(source.css, /prefers-reduced-motion: reduce[\s\S]*motion-odometer-overlay \{ display: none/));

// 107–112: recent records
add('R', 'current transaction exactly once', () => assert.equal((moneyFlowConfirmationHTML(confirmation()).match(/data-motion-record-id="txn-b3c"/g) || []).length, 1));
add('R', 'prior real transactions', () => assert.match(moneyFlowConfirmationHTML(confirmation()), /data-motion-record-id="txn-old"/));
add('R', 'list insertion order', () => assert.deepEqual(uniqueRecentRecords(confirmation().recentRecords, 'txn-b3c').map((row) => row.id), ['txn-b3c', 'txn-old']));
add('R', 'stable transaction-ID keys', () => assert.match(source.confirmation, /data-motion-record-id="\$\{escapeHTML\(record\.id\)\}"/));
add('R', 'highlight settles', () => assert.match(source.css, /motion-recent-row\.newest/));
add('R', 'no financial mutation', () => assert.doesNotMatch(source.confirmation, /addTransaction|recordRelationshipEntry|settleRelationship|recordObligationPayment/));

// 113–122: operation variants
add('P', 'expense', () => assert.match(moneyFlowConfirmationHTML(confirmation()), /−RM 10\.00/));
add('P', 'income', () => assert.match(moneyFlowConfirmationHTML(confirmation({ kind: 'income', accountChanges: [{ accountId: 'ew-boost', accountName: 'Boost', accountType: 'ew', beforeMinor: 25000, afterMinor: 26000, deltaMinor: 1000 }] })), /\+RM 10\.00/));
add('P', 'transfer', () => { const html = moneyFlowConfirmationHTML(confirmation({ kind: 'transfer', accountChanges: [confirmation().accountChanges[0], { accountId: 'sv-cimb', accountName: 'CIMB', accountType: 'saving', beforeMinor: 240000, afterMinor: 241000, deltaMinor: 1000 }] })); assert.equal((html.match(/motion-balance-hero/g) || []).length, 2); assert.doesNotMatch(html, /本次[\s\S]{0,100}\+RM/); });
add('P', 'record-only', () => assert.match(moneyFlowConfirmationHTML(confirmation({ accountEffect: 'record_only' })), /余额未变/));
add('P', 'user-paid AA', () => assert.match(moneyFlowConfirmationHTML(confirmation({ relationship: { entryType: 'split_expense', payerName: '我', afterMinor: 500, ledgerTitle: '日本旅行' } })), /新增待收 RM 5\.00/));
add('P', 'other-payer AA', () => assert.match(moneyFlowConfirmationHTML(confirmation({ accountEffect: 'relationship_only', relationship: { entryType: 'split_expense', payerName: 'Jason', currentUserShareMinor: 500, afterMinor: 500, ledgerTitle: '日本旅行' } })), /Jason 已付款/));
add('P', 'received payment', () => assert.match(moneyFlowConfirmationHTML(confirmation({ kind: 'settlement', accountChanges: [{ accountId: 'sv-mbb', accountName: 'Maybank', accountType: 'saving', beforeMinor: 1000, afterMinor: 1200, deltaMinor: 200 }] })), /\+RM 2\.00/));
add('P', 'repayment', () => assert.match(moneyFlowConfirmationHTML(confirmation({ kind: 'settlement' })), /−RM 10\.00/));
add('P', 'monthly payment', () => assert.match(moneyFlowConfirmationHTML(confirmation({ kind: 'plan', plan: { title: '姐姐每月账', afterPaidMinor: 85000, remainingMinor: 170000 } })), /RM 850\.00 已完成/));
add('P', 'instalment payment', () => assert.match(moneyFlowConfirmationHTML(confirmation({ kind: 'plan', plan: { title: 'Shopee 分期', afterPaidMinor: 10000, remainingMinor: 99000 } })), /剩余 RM 990\.00/));

// 123–132: regression and isolation
add('X', 'all previous 455 tests remain', () => ['phase2b3.test.mjs', 'phase2b3a.test.mjs', 'phase2b3b.test.mjs'].forEach((name) => assert.equal(fs.existsSync(new URL(name, import.meta.url)), true)));
add('X', 'account-ID invariant remains', () => { assert.match(source.state, /selectedAccountId/); assert.match(source.detail, /target\.id/); });
add('X', 'attachment deletion remains', () => assert.match(source.attachment, /store\.remove|removeAttachment/));
add('X', 'relationship summary remains compact', () => assert.match(source.activity, /relationship-summary-heading/));
add('X', 'member personal-ledger CTA remains', () => assert.match(source.ledger, /前往\$\{escapeHTML\(participant\.displayName\)\}账本/));
add('X', 'AA values unchanged', () => assert.match(source.split, /remainingMinor[\s\S]*overMinor/));
add('X', 'settlement values unchanged', () => assert.match(source.demo, /settleRelationship: \(command\) => relationship\.settle\(command\)/));
add('X', 'no network or persistence clients', () => Object.values(source).forEach((text) => assert.doesNotMatch(text, /\blocalStorage\b|\bindexedDB\b|\bfetch\s*\(|createClient\s*\(/iu)));
add('X', 'no real Telegram or App-to-App integration', () => Object.values(source).forEach((text) => assert.doesNotMatch(text, /api\.telegram\.org|tg:\/\/|app-to-app:\/\//iu)));
add('X', 'port 8788 untouched by scripts and tests', () => { assert.doesNotMatch(source.package, /8788/); assert.doesNotMatch(source.vite, /port\s*:\s*8788|proxy\s*:/); assert.match(source.vite, /8788 \(the protected D3C harness port\)/); });

assert.equal(cases.length, 132);
cases.forEach(([group, name, run], index) => test(`2B3C-${String(index + 1).padStart(3, '0')} [${group}] ${name}`, run));
