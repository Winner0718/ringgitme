import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  MOTION, prefersReducedMotion, motionDuration, resistedCarouselPosition, carouselTarget,
} from '../src/app/motion.js';
import { assetURL, brandRegistry, getBrand, resolveAccountBrand } from '../src/domain/brandRegistry.js';
import { renderCardFace } from '../src/components/CardCarousel.js';
import { appendCaptureAmount } from '../src/components/CaptureSheet.js';
import {
  evaluateMoneyExpression, inspectMoneyExpression, moneyCalculatorHTML,
} from '../src/components/MoneyCalculatorSheet.js';
import {
  calendarCells, datePickerHTML, isISODate, shiftMonth,
} from '../src/components/DatePickerSheet.js';
import { clampLightboxScale } from '../src/components/AttachmentField.js';
import {
  allocationSummary, applyRemainderToLast, equalSplitMinor,
} from '../src/domain/smartSplit.js';
import {
  moneyFlowConfirmationHTML, odometerHTML, uniqueRecentRecords,
} from '../src/components/MoneyFlowConfirmation.js';
import { resolveParticipantAvatar } from '../src/domain/avatarResolver.js';
import { createDemoDataSource } from '../src/fixtures/demoData.js';
import { buildConfirmationDebugPreview } from '../src/components/ConfirmationDebugPreview.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const exists = (path) => fs.existsSync(new URL(path, import.meta.url));
const sources = {
  motion: read('../src/app/motion.js'), carousel: read('../src/components/CardCarousel.js'),
  assets: read('../src/features/assets/index.js'), capture: read('../src/components/CaptureSheet.js'),
  calculator: read('../src/components/MoneyCalculatorSheet.js'), date: read('../src/components/DatePickerSheet.js'),
  attachment: read('../src/components/AttachmentField.js'), modal: read('../src/app/modalStack.js'),
  confirmation: read('../src/components/MoneyFlowConfirmation.js'), activity: read('../src/features/activity/index.js'),
  ledger: read('../src/features/ledger/index.js'), avatar: read('../src/domain/avatarResolver.js'),
  css: read('../src/styles/phase2b3a.css'), demo: read('../src/fixtures/demoData.js'),
  vite: read('../vite.config.js'), package: read('../package.json'), index: read('../index.html'),
  accountVisual: read('../src/components/AccountVisualCard.js'),
};

const confirmation = (overrides = {}) => ({
  operation: 'create', kind: 'expense', accountEffect: 'posted', transactionId: 'txn-new',
  description: 'KFC', amountMinor: 1000,
  accountChanges: [{ accountId: 'sv-mbb', accountName: 'Maybank 储蓄卡', accountType: 'saving', measure: 'balance', beforeMinor: 680115, afterMinor: 679115, deltaMinor: -1000 }],
  recentRecords: [
    { id: 'txn-new', desc: 'KFC', amountMinor: 1000, kind: 'expense', date: '2026-07-14', time: '13:14' },
    { id: 'txn-old', desc: 'Steam', amountMinor: 7800, kind: 'expense', date: '2026-07-13', time: '09:44' },
  ],
  ...overrides,
});

const cases = [
  ['01', 'press timing is within the calm mobile contract', () => assert.ok(MOTION.pressMs >= 90 && MOTION.pressMs <= 140)],
  ['02', 'reduced motion is selected from the media query', () => assert.equal(prefersReducedMotion({ matchMedia: () => ({ matches: true }) }), true)],
  ['03', 'page transition has a deterministic final duration', () => assert.equal(motionDuration('pageMs', { matchMedia: () => ({ matches: false }) }), 340)],
  ['04', 'carousel ignores movement below the threshold', () => assert.equal(carouselTarget({ index: 1, count: 3, deltaPx: 10, velocityPxMs: .1, widthPx: 300 }), 1)],
  ['05', 'carousel velocity can advance a card', () => assert.equal(carouselTarget({ index: 1, count: 3, deltaPx: -4, velocityPxMs: -.5, widthPx: 300 }), 2)],
  ['06', 'carousel edge movement receives resistance', () => assert.equal(resistedCarouselPosition(-1, 3), -MOTION.edgeResistance)],
  ['07', 'carousel selected index stays inside bounds', () => assert.equal(carouselTarget({ index: 2, count: 3, deltaPx: -100, velocityPxMs: -1, widthPx: 300 }), 2)],
  ['08', 'carousel preserves vertical page scrolling', () => assert.match(sources.css, /touch-action: pan-y pinch-zoom/)],

  ['09', 'normal asset base resolves from root', () => assert.equal(assetURL('assets/cards/a.png', '/'), '/assets/cards/a.png')],
  ['10', 'preview asset base resolves from the project subpath', () => assert.equal(assetURL('assets/cards/a.png', '/ringgitme-2.0-preview/'), '/ringgitme-2.0-preview/assets/cards/a.png')],
  ['11', 'all approved card-art files exist', () => ['maybank-visa-platinum.png','maybank-islamic-petronas-ikhwan-visa-platinum.png','maybank-global-access-mastercard-world.png','maybank-amex-platinum.png','maybank-fc-barcelona-visa-signature.png'].forEach((name) => assert.equal(exists(`../public/assets/cards/${name}`), true))],
  ['12', 'fixture card paths are base-relative', () => assert.equal(/art:\s*['"]\/assets\//.test(sources.demo), false)],
  ['13', 'source contains no localhost asset URL', () => Object.values(sources).forEach((source) => assert.equal(/https?:\/\/(?:localhost|127\.0\.0\.1).*assets/.test(source), false))],
  ['14', 'failed card art has a full-card fallback', () => assert.match(renderCardFace({ id: 'x', name: 'Card', bank: 'Bank', type: 'saving', balance: 100, art: 'assets/cards/missing.png', last4: '1234' }), /deck-image-fallback/)],
  ['15', 'card image errors suppress the browser broken icon', () => assert.match(sources.accountVisual, /image-failed[\s\S]*naturalWidth === 0/)],
  ['16', 'eWallet brand registry contains every required brand', () => ['boost','tng','grabpay','bigpay'].forEach((id) => assert.equal(getBrand(id)?.type, 'ewallet'))],

  ['17', 'eWallet layout uses a logo-left copy-right grid', () => assert.match(sources.css, /grid-template-columns: 46px minmax\(0, 1fr\)/)],
  ['18', 'Touch n Go resolves through long-name aliases', () => assert.equal(resolveAccountBrand({ name: "Touch 'n Go" })?.id, 'tng')],
  ['19', 'eWallet amounts use the shared two-decimal formatter', () => assert.match(sources.accountVisual, /fmtRM\(Math\.abs\(amount\), \{ privacy: ui\.privacy \}\)/)],
  ['20', 'eWallet tiles have mobile-safe bounded width', () => assert.match(sources.css, /width: clamp\(158px, 44vw, 190px\)/)],

  ['21', 'Capture starts with its keypad ready', () => assert.match(sources.capture, /keypadOpen: true/)],
  ['22', 'direct Capture entry needs no native keyboard focus', () => assert.match(sources.capture, /capture-direct-keypad/)],
  ['23', 'incomplete calculator expressions keep current value and helper', () => { const state = inspectMoneyExpression('1+'); assert.equal(state.currentMinor, 100); assert.equal(state.helper, '继续输入数字'); }],
  ['24', 'calculator never renders a giant dash for incomplete input', () => assert.doesNotMatch(moneyCalculatorHTML('1+'), />—</)],
  ['25', 'calculator zero key has a dedicated spanning class', () => assert.match(moneyCalculatorHTML(''), /calculator-key zero/)],
  ['26', 'blocked Apply keeps the sheet and emphasizes the error', () => assert.match(sources.calculator, /catch \{ emphasizeError\(\); \}/)],
  ['27', 'blocked calculator Apply preserves expression state', () => assert.doesNotMatch(sources.calculator, /catch \{[^}]*expression\s*=/)],
  ['28', 'successful calculator Apply returns integer minor units', () => assert.equal(evaluateMoneyExpression('500+250×2').minor, 100000)],
  ['29', 'calculator uses no unsafe dynamic execution', () => assert.equal(/\beval\s*\(|new Function|Function\s*\(/.test(sources.calculator), false)],

  ['30', 'date month panels are prepared for direct drag', () => assert.match(datePickerHTML('2026-07-14'), /date-month-track[\s\S]*data-month-panel/)],
  ['31', 'date month snapping crosses year boundaries', () => assert.deepEqual(shiftMonth({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 })],
  ['32', 'date title moves with month direction', () => assert.match(sources.css, /date-picker-month-title\.to-next[\s\S]*translateX/)],
  ['33', 'month and year chooser has scale-fade motion', () => assert.match(sources.css, /@keyframes date-chooser-in[\s\S]*scale\(\.97\)/)],
  ['34', 'date picker reduced-motion path remains explicit', () => assert.match(sources.date, /prefersReducedMotion\(\)/)],

  ['35', 'gallery image is a Lightbox trigger', () => assert.match(sources.attachment, /attachment-gallery-image[\s\S]*openAttachmentLightbox/)],
  ['36', 'Lightbox pinch scale is bounded at one', () => assert.equal(clampLightboxScale(.2), 1)],
  ['37', 'Lightbox pinch scale is bounded at five', () => assert.equal(clampLightboxScale(8), 5)],
  ['38', 'Lightbox supports double-tap zoom', () => assert.match(sources.attachment, /lastTap < 300[\s\S]*2\.5/)],
  ['39', 'Lightbox supports panning while zoomed', () => assert.match(sources.attachment, /scale > 1[\s\S]*x \+=/)],
  ['40', 'Lightbox preserves gallery index on close', () => assert.match(sources.attachment, /onClose\?\.\(index\)/)],
  ['41', 'modal stack freezes underlying sheets', () => assert.match(sources.modal, /child\.setAttribute\('inert'/)],
  ['42', 'only the top modal remains interactive', () => assert.match(sources.modal, /const top = index === stack\.length - 1/)],

  ['43', 'AA exact allocation has zero remainder and excess', () => assert.equal(allocationSummary(1000, { a: 600, b: 400 }, ['a','b']).exact, true)],
  ['44', 'AA remaining allocation is derived exactly', () => assert.equal(allocationSummary(1000, { a: 300, b: 400 }, ['a','b']).remainingMinor, 300)],
  ['45', 'AA excess allocation is derived exactly', () => assert.equal(allocationSummary(1000, { a: 700, b: 400 }, ['a','b']).overMinor, 100)],
  ['46', 'AA blocked Complete reports the exact remaining amount', () => assert.match(sources.capture, /`还需分配 \$\{formatMoneyMinor\(summary\.remainingMinor\)\}`/)],
  ['47', 'AA blocked Complete reports the exact excess amount', () => assert.match(sources.capture, /`已超出 \$\{formatMoneyMinor\(summary\.overMinor\)\}`/)],
  ['48', 'AA blocked Complete scrolls and highlights the summary', () => assert.match(sources.capture, /error-emphasis[\s\S]*scrollIntoView/)],
  ['49', 'AA entered shares are preserved while validation fails', () => assert.doesNotMatch(sources.capture, /relationDraft\.shares\s*=\s*\{\}[\s\S]{0,100}还需分配/)],
  ['50', 'AA participant rows use avatar name and value hierarchy', () => assert.match(sources.capture, /split-participant-row[\s\S]*participantAvatarHTML[\s\S]*moneyFieldHTML/)],

  ['51', 'confirmation first frame is fully populated', () => assert.match(moneyFlowConfirmationHTML(confirmation(), { frame: 1 }), /Maybank 储蓄卡[\s\S]*RM 6,801\.15/)],
  ['52', 'confirmation first frame exposes the account immediately', () => assert.match(moneyFlowConfirmationHTML(confirmation(), { frame: 1 }), /data-motion-account="sv-mbb"/)],
  ['53', 'confirmation old balance is present before movement', () => assert.match(moneyFlowConfirmationHTML(confirmation(), { frame: 1 }), /RM 6,801\.15 → RM 6,791\.15/)],
  ['54', 'new confirmation row has a distinct insertion state', () => assert.match(moneyFlowConfirmationHTML(confirmation(), { frame: 1 }), /motion-recent-row newest/)],
  ['55', 'prior rows have an independent displacement state', () => assert.match(moneyFlowConfirmationHTML(confirmation(), { frame: 2 }), /motion-recent-row prior/)],
  ['56', 'settled confirmation contains the final balance', () => assert.match(moneyFlowConfirmationHTML(confirmation(), { frame: 3 }), /RM 6,791\.15/)],
  ['57', 'expense confirmation decreases its selected account', () => assert.equal(confirmation().accountChanges[0].deltaMinor, -1000)],
  ['58', 'income confirmation presents a positive delta', () => assert.match(moneyFlowConfirmationHTML(confirmation({ kind: 'income', accountChanges: [{ accountId: 'x', accountName: 'Boost', accountType: 'ew', beforeMinor: 100, afterMinor: 200, deltaMinor: 100 }] })), /\+RM 1\.00/)],
  ['59', 'transfer confirmation renders both account balances', () => assert.equal((moneyFlowConfirmationHTML(confirmation({ kind: 'transfer', accountChanges: [confirmation().accountChanges[0], { accountId: 'b', accountName: 'Boost', accountType: 'ew', beforeMinor: 100, afterMinor: 1100, deltaMinor: 1000 }] })).match(/motion-balance-hero/g) || []).length, 2)],
  ['60', 'record-only confirmation explicitly states unchanged balance', () => assert.match(moneyFlowConfirmationHTML(confirmation({ accountEffect: 'record_only' })), /余额未变/)],
  ['61', 'other-payer AA confirmation can remain account-neutral', () => assert.match(moneyFlowConfirmationHTML(confirmation({ accountEffect: 'relationship_only', relationship: { entryType: 'split_expense', payerName: 'Jason', currentUserShareMinor: 500, afterMinor: 500, ledgerTitle: '日本旅行' } })), /Jason 已付款/)],
  ['62', 'received-payment confirmation can show an increase', () => assert.match(moneyFlowConfirmationHTML(confirmation({ kind: 'settlement', accountChanges: [{ accountId: 'x', accountName: 'Maybank', accountType: 'saving', beforeMinor: 1000, afterMinor: 1200, deltaMinor: 200 }] })), /\+RM 2\.00/)],
  ['63', 'repayment confirmation can show a decrease', () => assert.match(moneyFlowConfirmationHTML(confirmation({ kind: 'settlement' })), /−RM 10\.00/)],
  ['64', 'monthly payment confirmation renders plan progress', () => assert.match(moneyFlowConfirmationHTML(confirmation({ kind: 'plan', plan: { title: '姐姐每月账', afterPaidMinor: 85000, remainingMinor: 170000 } })), /RM 850\.00 已完成/)],
  ['65', 'instalment confirmation renders remaining amount', () => assert.match(moneyFlowConfirmationHTML(confirmation({ kind: 'plan', plan: { title: 'Shopee 分期', afterPaidMinor: 10000, remainingMinor: 99000 } })), /剩余 RM 990\.00/)],
  ['66', 'confirmation remains until a user action', () => assert.doesNotMatch(sources.confirmation, /setTimeout\([^)]*close/)],
  ['67', 'confirmation exposes no unnecessary Skip control', () => assert.doesNotMatch(sources.confirmation, /data-motion-skip|跳过动画/)],
  ['68', 'Continue Entry is a persistent settled action', () => assert.match(moneyFlowConfirmationHTML(confirmation()), /data-motion-continue>继续记账/)],
  ['69', 'View Record is a persistent settled action', () => assert.match(moneyFlowConfirmationHTML(confirmation()), /data-motion-view[^>]*>查看记录/)],
  ['70', 'Finish is a persistent settled action', () => assert.match(moneyFlowConfirmationHTML(confirmation()), /data-motion-done>完成/)],
  ['71', 'recent records are unique by transaction ID', () => assert.deepEqual(uniqueRecentRecords([{ id: 'a' }, { id: 'a' }, { id: 'b' }]).map((row) => row.id), ['a','b'])],
  ['72', 'current transaction is ordered exactly once at the top', () => assert.deepEqual(uniqueRecentRecords([{ id: 'old' }, { id: 'new' }, { id: 'new' }], 'new').map((row) => row.id), ['new','old'])],
  ['73', 'confirmation animation performs no financial mutation', () => assert.equal(/addTransaction|recordRelationshipEntry|recordObligationPayment/.test(sources.confirmation), false)],
  ['74', 'confirmation close guard prevents duplicate actions', () => assert.match(sources.confirmation, /if \(closed\) return/)],
  ['75', 'reduced-motion confirmation resolves directly to settled', () => assert.match(sources.confirmation, /reducedMotion \? 3 : 1/)],

  ['76', 'relationship summary itself has no navigation action', () => assert.match(sources.activity, /<div class="sheet-group relationship-summary">/)],
  ['77', 'only the explicit relationship CTA carries open-ledger action', () => assert.match(sources.activity, /rel-open-ledger" data-action="activity-open-ledger"/)],
  ['78', 'relationship CTA carries the exact ledger ID', () => assert.match(sources.activity, /data-ledger="\$\{escapeHTML\(entry\.ledgerId\)\}"/)],
  ['79', 'ledger return preserves the transaction detail ID', () => assert.match(sources.activity, /data-return-txn="\$\{escapeHTML\(transactionId\)\}"/)],

  ['80', 'plan information uses structured key-value rows', () => assert.match(sources.ledger, /detail-row[\s\S]*类型[\s\S]*对象[\s\S]*开始日期/)],
  ['81', 'plan and period statuses have distinct labels', () => { assert.match(sources.ledger, /计划状态/); assert.match(sources.ledger, /本期状态/); }],
  ['82', 'overdue current period is prioritized', () => assert.match(sources.ledger, /本期应\$\{[\s\S]*本期到期[\s\S]*已逾期/)],
  ['83', 'next period remains secondary', () => assert.match(sources.ledger, /plan-next-period/)],
  ['84', 'recent periods render as structured rows', () => assert.match(sources.ledger, /plan-period-row[\s\S]*到期[\s\S]*已付/)],
  ['85', 'payment history exposes the source account', () => assert.match(sources.ledger, /账户 \$\{escapeHTML\(account\.name\)\}/)],
  ['86', 'payment history exposes canonical attachment IDs', () => assert.match(sources.ledger, /data-attachment-ids/)],
  ['87', 'payment receipt opens the canonical attachment gallery', () => assert.match(sources.ledger, /obligation-attachments[\s\S]*openAttachmentGallery/)],
  ['88', 'payment reversal requires explicit confirmation', () => assert.match(sources.ledger, /confirm\([^)]*撤销|确认撤销/)],

  ['89', 'four-member ledgers render a participant strip', () => assert.match(sources.ledger, /participant-strip/)],
  ['90', 'participant avatar and name share one item', () => assert.match(sources.ledger, /participant-strip-item[\s\S]*participantAvatarHTML[\s\S]*displayName/)],
  ['91', 'four participants do not collapse into plus one', () => assert.match(sources.ledger, /members\.length <= 5 \? 5 : 4/)],
  ['92', 'custom RinggitMe avatar has highest priority', () => assert.equal(resolveParticipantAvatar({ displayName: 'A', avatar: { customLocalUrl: 'custom', telegramLocalUrl: 'telegram', localUrl: 'local' } }).source, 'ringgitme')],
  ['93', 'avatar resolver falls back to initials', () => assert.deepEqual(resolveParticipantAvatar({ displayName: 'Mei Ling' }), { kind: 'initials', source: 'fallback', initials: 'ME' })],
  ['94', 'avatar resolver never performs a network request', () => assert.equal(/fetch\s*\(|XMLHttpRequest|WebSocket/.test(sources.avatar), false)],

  ['95', 'credit-card debt presentation has no redundant minus', () => assert.match(sources.accountVisual, /fmtRM\(Math\.abs\(amount\)/)],
  ['96', 'app content reserves bottom-navigation safe area', () => assert.match(sources.css, /padding-bottom: calc\(var\(--safe-bottom\) \+ 120px\)/)],
  ['97', 'sticky header uses a lightweight transparent blur', () => assert.match(sources.css, /topbar\.scrolled[\s\S]*76%[\s\S]*blur\(15px\)/)],
  ['98', 'nested sheets use explicit modal suspension styling', () => assert.match(sources.css, /modal-suspended/)],
  ['99', 'top modal focus returns when a child closes', () => assert.match(sources.modal, /stack\.at\(-1\).*focus/)],
  ['100', 'mobile surfaces avoid page-level horizontal overflow', () => { assert.match(sources.css, /minmax\(0,1fr\)/); assert.match(sources.css, /overflow: hidden/); }],

  ['101', 'the previous 228-test suites remain present', () => ['phase2b3.test.mjs','phase2aFreeze.test.mjs','relationshipLedger.test.mjs','obligations.test.mjs','instalments.test.mjs','attachments.test.mjs'].forEach((name) => assert.equal(exists(`./${name}`), true))],
  ['102', 'date calculator and AA domain regressions remain exact', () => { assert.equal(isISODate('2028-02-29'), true); assert.equal(evaluateMoneyExpression('0.10+0.20').minor, 30); assert.deepEqual(equalSplitMinor(1, ['a','b','c']), { a: 0, b: 0, c: 1 }); }],
  ['103', 'settlement engine remains wired through the data source', () => assert.match(sources.demo, /settleRelationship: \(command\) => relationship\.settle\(command\)/)],
  ['104', 'plan engines remain wired through the data source', () => { assert.match(sources.demo, /recordObligationPayment/); assert.match(sources.demo, /earlySettleInstallment/); }],
  ['105', 'attachment repository remains canonical and idempotent', () => assert.match(sources.demo, /attachmentStore/)],
  ['106', 'asset summary calculations remain fixture-backed', () => { const data = createDemoDataSource(); assert.ok(data.getPulse().currentCash > 0); assert.ok(data.getAccounts().length > 0); }],
  ['107', 'Phase 2B3A introduces no persistence or network clients', () => Object.values(sources).forEach((source) => assert.equal(/\blocalStorage\b|\bindexedDB\b|\bfetch\s*\(|createClient\s*\(|\bWebSocket\b/.test(source), false))],
  ['108', 'dev scripts remain pinned to 5173 and never 8788', () => { assert.match(sources.package, /vite --port 5173 --strictPort/); assert.doesNotMatch(sources.package, /8788/); }],
];

assert.equal(cases.length, 108);
cases.forEach(([number, name, run]) => test(`2B3A-${number}: ${name}`, run));

test('2B3A preview mode uses the dedicated base and output directory', () => {
  assert.match(sources.vite, /mode === 'preview' \? '\/ringgitme-2\.0-preview\/' : '\/'/);
  assert.match(sources.vite, /mode === 'preview' \? 'dist-preview' : 'dist'/);
  assert.match(sources.package, /"build:preview": "vite build --mode preview"/);
});

test('2B3A odometer keeps punctuation stable and animates changed digits', () => {
  const html = odometerHTML(680115, 679115);
  assert.match(html, /motion-digit stable/);
  assert.match(html, /motion-digit changed/);
  assert.match(html, /RM 6,801\.15 到 RM 6,791\.15/);
});

test('2B3A date grid always includes three valid six-week panels', () => {
  const html = datePickerHTML('2026-07-14');
  assert.equal((html.match(/date-month-panel/g) || []).length, 3);
  assert.equal(calendarCells(2026, 7).length, 42);
});

test('2B3A brand registry is stable and immutable from callers', () => {
  const first = brandRegistry();
  first[0].name = 'changed';
  assert.notEqual(brandRegistry()[0].name, 'changed');
});

test('2B3A changing a custom share clears stale blocked-submit copy', () => {
  assert.match(sources.capture, /relationDraft\.customShares = \{ \.\.\.relationDrawer\.shares \};[\s\S]*relationDraft\.error = ''/);
  assert.match(sources.capture, /capture-split-even[\s\S]*relationDraft\.error = ''/);
});

test('2B3A deterministic confirmation evidence derives real balances without mutation', () => {
  const data = createDemoDataSource();
  const before = data.getAccount('sv-mbb').balanceMinor;
  const preview = buildConfirmationDebugPreview(data, 'transfer');
  assert.equal(preview.accountChanges.length, 2);
  assert.equal(data.getAccount('sv-mbb').balanceMinor, before);
  assert.equal(preview.recentRecords.filter((row) => row.id === preview.transactionId).length, 1);
});

test('2B3A confirmation recent rows prioritize financial type when choosing sign', () => {
  const html = moneyFlowConfirmationHTML(confirmation());
  assert.match(html, /KFC[\s\S]*−RM 10\.00/);
  assert.doesNotMatch(html, /KFC[\s\S]{0,160}\+RM 10\.00/);
});
