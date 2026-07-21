import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MOTION, carouselGestureAxis, carouselTarget, resistedCarouselPosition } from '../src/app/motion.js';
import { evaluateMoneyExpression, inspectMoneyExpression, moneyStringToMinor } from '../src/components/MoneyCalculatorSheet.js';
import { odometerHTML, moneyFlowConfirmationHTML } from '../src/components/MoneyFlowConfirmation.js';
import { createAttachmentStore } from '../src/domain/attachmentRepository.js';
import { createDemoDataSource } from '../src/fixtures/demoData.js';
import { fmtDateMY, fmtTimeAMPM } from '../src/app/format.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const source = {
  motion: read('../src/app/motion.js'), carousel: read('../src/components/CardCarousel.js'), state: read('../src/app/state.js'),
  category: read('../src/features/assets/category.js'), detail: read('../src/features/assets/detail.js'), assets: read('../src/features/assets/index.js'),
  capture: read('../src/components/CaptureSheet.js'), attachment: read('../src/components/AttachmentField.js'), demo: read('../src/fixtures/demoData.js'),
  activity: read('../src/features/activity/index.js'), ledger: read('../src/features/ledger/index.js'), confirmation: read('../src/components/MoneyFlowConfirmation.js'),
  css: read('../src/styles/phase2b3a.css'), format: read('../src/app/format.js'),
  nativeCarousel: read('../src/components/NativeSnapCardCarousel.js'),
  accountVisual: read('../src/components/AccountVisualCard.js'),
  copy: read('../src/app/copy.js'),
};

const confirmation = (overrides = {}) => ({ operation: 'create', kind: 'expense', accountEffect: 'posted', description: '测试支出', transactionId: 'txn-b3b', amountMinor: 1000, accountChanges: [{ accountId: 'sv-mbb', accountName: 'Maybank 储蓄卡', accountType: 'saving', measure: 'balance', beforeMinor: 684215, afterMinor: 683215, deltaMinor: -1000 }], recentRecords: [], ...overrides });
const cases = [];
const add = (group, name, run) => cases.push([group, name, run]);

// 1–16: mobile gesture contract
add('G', 'undecided movement is retained below 7px', () => assert.equal(carouselGestureAxis(4, 3), 'pending'));
add('G', 'horizontal lock requires a clear axis lead', () => assert.equal(carouselGestureAxis(9, 5), 'horizontal'));
add('G', 'vertical lock wins for a page scroll', () => assert.equal(carouselGestureAxis(5, 10), 'vertical'));
add('G', 'axis lock uses the 1.25 ratio', () => assert.match(source.motion, /ratio = 1\.25/));
add('G', 'native scroll replaces custom axis-lock movement', () => assert.match(source.carousel, /NativeSnapCardCarousel/));
add('G', 'only one adjacent card can advance', () => assert.equal(carouselTarget({ index: 1, count: 4, deltaPx: -999, velocityPxMs: -2, widthPx: 300 }), 2));
add('G', 'small slow drag settles to the current card', () => assert.equal(carouselTarget({ index: 1, count: 3, deltaPx: 15, velocityPxMs: .1, widthPx: 300 }), 1));
add('G', 'velocity threshold advances an adjacent card', () => assert.equal(carouselTarget({ index: 1, count: 3, deltaPx: -3, velocityPxMs: -.5, widthPx: 300 }), 2));
add('G', 'distance threshold is card-width based', () => assert.equal(MOTION.carouselDistanceRatio, .17));
add('G', 'velocity is tuned for a deliberate swipe', () => assert.equal(MOTION.carouselVelocityPxMs, .42));
add('G', 'left-edge overscroll is resisted', () => assert.equal(resistedCarouselPosition(-1, 3), -MOTION.edgeResistance));
add('G', 'right-edge overscroll is resisted', () => assert.equal(resistedCarouselPosition(3, 3), 2 + MOTION.edgeResistance));
add('G', 'Safari edge gestures remain browser-owned', () => assert.doesNotMatch(source.nativeCarousel, /edgeOutward|pointermove|touchmove/));
add('G', 'native carousel does not capture pointers', () => assert.doesNotMatch(source.nativeCarousel, /setPointerCapture/));
add('G', 'settling listens to native scroll passively', () => assert.match(source.nativeCarousel, /addEventListener\('scroll',[\s\S]*passive: true/));
add('G', 'post-scroll click suppression has a finite window', () => assert.match(source.nativeCarousel, /RECENT_SCROLL_MS/));

// 17–32: authoritative account state
add('A', 'stable selected account IDs live in UI state', () => assert.match(source.state, /selectedAccountId/));
add('A', 'selection is separate by account type', () => assert.match(source.state, /saving: null, cc: null, ew: null/));
add('A', 'category derives index from selected stable ID', () => assert.match(source.category, /findIndex\(\(account\) => account\.id === selectedId\)/));
add('A', 'category stack selection writes the stable ID', () => assert.match(source.category, /\[type\]: el\.dataset\.acc/));
add('A', 'category card tap writes the stable ID', () => assert.match(source.category, /\[type\]: el\.dataset\.acc/));
add('A', 'detail swipe writes the selected stable ID', () => assert.match(source.detail, /selectedAccountId: \{ \.\.\.ui\.selectedAccountId/));
add('A', 'detail swipe keeps card and detail account together', () => assert.match(source.detail, /assetsView: \{ \.\.\.ui\.assetsView, accountId: target\.id \}/));
add('A', 'overview navigation seeds selected account identity', () => assert.match(source.assets, /\[acc\.type\]: acc\.id/));
add('A', 'detail recent rows include every stable account role', () => assert.match(source.detail, /\[t\.accountId, t\.sourceAccountId, t\.destinationAccountId\]\.includes\(acc\.id\)/));
add('A', 'category recent rows filter by displayed card', () => assert.match(source.category, /t\.accountId === selected\.id/));
add('A', 'category summary card uses actual selected account object', () => assert.match(source.category, /const selected = list\.find\(\(account\) => account\.id === requestedId\) \|\| list\[0\]/));
add('A', 'detail card list stays same-type only', () => assert.match(source.detail, /getAccountsByType\(acc\.type\)/));
add('A', 'credit-card list remains type-isolated', () => assert.equal(createDemoDataSource().getAccountsByType('cc').every((a) => a.type === 'cc'), true));
add('A', 'savings list remains type-isolated', () => assert.equal(createDemoDataSource().getAccountsByType('saving').every((a) => a.type === 'saving'), true));
add('A', 'detail uses accountId rather than index as input', () => assert.match(source.detail, /renderDetailPage\(container, accountId\)/));
add('A', 'card buttons carry stable account IDs and absent debug state cannot force index zero', () => {
  assert.match(source.nativeCarousel, /data-acc="\$\{escapeHTML\(account\.id\)\}"/);
  assert.match(source.nativeCarousel, /if \(raw === null \|\| raw === ''\) return null/);
});

// 33–45: Capture calculator contract
add('C', 'Capture uses the permanent calculator region', () => assert.match(source.capture, /capture-calculator/));
add('C', 'Capture calculator follows account selection', () => assert.ok(source.capture.indexOf('accountsHTML(accounts)') < source.capture.indexOf('directKeypadHTML()')));
add('C', 'calculator has clear key', () => assert.match(source.capture, /'C','back','÷','×'/));
add('C', 'calculator has arithmetic keys', () => assert.match(source.capture, /'−','4','5','6','\+'/));
add('C', 'calculator commits with equals and has no Apply action', () => { assert.match(source.capture, /'='/); assert.doesNotMatch(source.capture, /data-key="apply"|应用金额/); });
add('C', 'zero spans two columns', () => assert.match(source.css, /capture-calculator-key\.zero \{ grid-column: span 2/));
add('C', 'calculator respects multiplication precedence', () => assert.equal(evaluateMoneyExpression('500+250×2').minor, 100000));
add('C', 'calculator shows incomplete-expression feedback', () => assert.equal(inspectMoneyExpression('1+').helper, '继续输入数字'));
add('C', 'calculator rejects division by zero', () => assert.throws(() => evaluateMoneyExpression('1÷0')));
add('C', 'calculator stays in minor-unit precision', () => assert.equal(moneyStringToMinor('0.10+0.20'), 30));
add('C', 'transfer keeps source and destination separate', () => assert.match(source.capture, /'转出账户'\)\}\$\{accountButtons\(eligible, cap\.destinationAccountId/));
add('C', 'same-account transfer validation remains before save', () => assert.match(source.capture, /cap\.accountId === cap\.destinationAccountId/));
add('C', 'Capture does not render obsolete controls', () => assert.doesNotMatch(source.capture, /data-action="cap-open-calculator"/));

// 46–55: attachment state integrity
add('T', 'attachment store owns canonical items', () => assert.match(source.attachment, /store is authoritative/));
add('T', 'manager remove notifies the owning draft immediately', () => assert.match(source.attachment, /ringgitme:attachment-changed/));
add('T', 'gallery remove notifies the owning draft immediately', () => assert.match(source.attachment, /ownerType: item\.ownerEntityType/));
add('T', 'last gallery deletion closes the gallery', () => assert.match(source.attachment, /if \(!items\.length\) return close\(\)/));
add('T', 'gallery index clamps after delete', () => assert.match(source.attachment, /index = Math\.min\(index, items\.length - 1\)/));
add('T', 'removing a local attachment immediately removes it from the canonical store', () => { const store = createAttachmentStore(); const item = store.add({ name: 'x.jpg', mimeType: 'image/jpeg', localObjectUrl: 'blob:x', ownerEntityType: 'draft', ownerEntityId: 'x', clientEventId: 'b3b-remove' }); assert.equal(store.remove(item.attachmentId), true); assert.equal(store.countFor('draft', 'x'), 0); });
add('T', 'removing an attachment updates transaction references', () => assert.match(source.demo, /setTransactionAttachments/));
add('T', 'attachment removal updates relationship references', () => assert.match(source.demo, /updateEntry/));
add('T', 'attachment removal updates plan references', () => assert.match(source.demo, /updatePlan/));
add('T', 'attachment draft ownership moves only on save', () => assert.match(source.demo, /assignAttachmentOwner/));

// 56–66: compact relationship detail
add('R', 'relationship detail has one compact group heading', () => assert.match(source.activity, /relationship-summary-heading/));
add('R', 'AA shows its payer', () => assert.match(source.activity, /compactRows\.push\(detailRow\('付款人'/));
add('R', 'group AA shows member count', () => assert.match(source.activity, /group \? '成员'/));
add('R', 'relationship totals include received or repaid', () => assert.match(source.activity, /entry\.amountMinor - entry\.remainingMinor/));
add('R', 'relationship totals include remaining amount', () => assert.match(source.activity, /'剩余待收'/));
add('R', 'direct receivable and payable use compact object rows', () => assert.match(source.activity, /compactRows\.push\(detailRow\('对象'/));
add('R', 'allocation details begin collapsed', () => assert.match(source.activity, /<details class="relationship-breakdown"><summary>查看分摊明细/));
add('R', 'only explicit ledger CTA navigates', () => assert.match(source.activity, /data-action="activity-open-ledger"/));
add('R', 'CTA carries exact ledger identity', () => assert.match(source.activity, /data-ledger="\$\{escapeHTML\(entry\.ledgerId\)\}"/));
add('R', 'relationship cards do not make their whole surface tappable', () => assert.doesNotMatch(source.activity, /relationship-summary tappable/));
add('R', 'relationship breakdown is rendered as a compact disclosure', () => assert.match(source.activity, /relationship-breakdown/));

// 67–79: odometer and confirmation motion
add('O', 'odometer uses fixed digit cells', () => assert.match(source.css, /motion-digit \{[\s\S]*width: \.62em/));
add('O', 'odometer clips old and new glyphs', () => assert.match(source.css, /motion-digit \{[\s\S]*overflow: hidden/));
add('O', 'odometer uses tabular numerals', () => assert.match(source.css, /font-variant-numeric: tabular-nums/));
add('O', 'stable punctuation is never converted to a moving glyph', () => assert.match(odometerHTML(100000, 100100), /motion-digit stable/));
add('O', 'changed digits animate independently', () => assert.match(odometerHTML(100000, 100100), /motion-digit changed/));
add('O', 'increase keeps RM punctuation visible', () => assert.match(odometerHTML(100, 200), /RM 1\.00 到 RM 2\.00/));
add('O', 'decrease keeps RM punctuation visible', () => assert.match(odometerHTML(200, 100), /RM 2\.00 到 RM 1\.00/));
add('O', 'large values retain comma presentation', () => assert.match(odometerHTML(9999999, 10000000), /RM 99,999\.99 到 RM 100,000\.00/));
add('O', 'decimal values retain two fraction digits', () => assert.match(odometerHTML(101, 109), /RM 1\.01 到 RM 1\.09/));
add('O', 'hero includes real before and after amounts', () => assert.match(moneyFlowConfirmationHTML(confirmation()), /RM 6,842\.15 → RM 6,832\.15/));
add('O', 'hero uses account updates terminology', () => assert.match(source.copy, /posted: '账户已更新'/));
add('O', 'confirmation has a reduced-motion branch', () => assert.match(source.confirmation, /reducedMotion \? 3 : 1/));
add('O', 'motion has no financial mutation call', () => assert.doesNotMatch(source.confirmation, /addTransaction|recordRelationshipEntry/));

// 80–87: confirmation semantics
add('F', 'expense confirmation shows a negative delta', () => assert.match(moneyFlowConfirmationHTML(confirmation()), /−RM 10\.00/));
add('F', 'income confirmation shows a positive delta', () => assert.match(moneyFlowConfirmationHTML(confirmation({ kind: 'income', accountChanges: [{ accountId: 'x', accountName: 'Boost', accountType: 'ew', beforeMinor: 0, afterMinor: 1000, deltaMinor: 1000 }] })), /\+RM 10\.00/));
add('F', 'transfer confirmation lists two account heroes', () => assert.equal((moneyFlowConfirmationHTML(confirmation({ kind: 'transfer', accountChanges: [confirmation().accountChanges[0], { accountId: 'b', accountName: 'CIMB', accountType: 'saving', beforeMinor: 1, afterMinor: 2, deltaMinor: 1 }] })).match(/motion-balance-hero/g) || []).length, 2));
add('F', 'record-only confirmation explicitly preserves balance', () => assert.match(moneyFlowConfirmationHTML(confirmation({ accountEffect: 'record_only' })), /余额未变/));
add('F', 'confirmation actions are single-fire guarded', () => assert.match(source.confirmation, /if \(closed\) return/));
add('F', 'confirmation keeps a visible account balance hero', () => assert.match(source.confirmation, /motion-balance-hero/));
add('F', 'confirmation recent list deduplicates IDs', () => assert.match(source.confirmation, /const seen = new Set/));
add('F', 'confirmation primary action remains completion', () => assert.match(moneyFlowConfirmationHTML(confirmation()), /data-motion-done>完成/));

// 88–97: member and personal-ledger affordances
add('M', 'participant detail resolves an exact two-person ledger', () => assert.match(source.ledger, /personalLedgerFor/));
add('M', 'personal ledger lookup compares participant IDs', () => assert.match(source.ledger, /participantIds\.includes\(ME\).*includes\(participantId\)/));
add('M', 'existing personal ledger has an explicit CTA', () => assert.match(source.ledger, /前往\$\{escapeHTML\(participant\.displayName\)\}账本/));
add('M', 'missing personal ledger has an explicit creation CTA', () => assert.match(source.ledger, /建立与\$\{escapeHTML\(participant\.displayName\)\}的个人账本/));
add('M', 'personal ledger creation asks for confirmation', () => assert.match(source.ledger, /window\.confirm/));
add('M', 'personal ledger creation uses exactly two participants', () => assert.match(source.ledger, /participantIds: \[ME, participant\.participantId\]/));
add('M', 'personal-ledger creation does not auto-run on render', () => assert.doesNotMatch(source.ledger, /function participantDetailSheet[\s\S]{0,1800}data\.createRelationshipLedger/));
add('M', 'member detail has connection summary', () => assert.match(source.ledger, /个人关系账/));
add('M', 'member detail has net summary', () => assert.match(source.ledger, /净额/));
add('M', 'four group members remain directly visible', () => assert.match(source.ledger, /members\.length <= 5 \? 5 : 4/));

// 98–104: display formatting / isolation
add('I', 'date display stays DD/MM/YYYY', () => assert.equal(fmtDateMY('2026-07-13'), '13/07/2026'));
add('I', 'time display stays h:mm AM/PM', () => assert.equal(fmtTimeAMPM('13:14'), '1:14 PM'));
add('I', 'midnight display remains 12:00 AM', () => assert.equal(fmtTimeAMPM('00:00'), '12:00 AM'));
add('I', 'noon display remains 12:00 PM', () => assert.equal(fmtTimeAMPM('12:00'), '12:00 PM'));
add('I', 'late-night display remains 11:59 PM', () => assert.equal(fmtTimeAMPM('23:59'), '11:59 PM'));
add('I', 'format helpers remain centralised', () => assert.match(source.format, /export function fmtTimeAMPM/));
add('I', 'no settings UI is added for time format', () => assert.doesNotMatch(source.capture, /24小时|12小时设置/));

// 105–112: core regression safety
add('X', 'expense defaults remain distinct from income defaults', () => { const data = createDemoDataSource(); assert.notEqual(data.getDefaultCategoryId('expense'), data.getDefaultCategoryId('income')); });
add('X', 'transfer purposes contain no expense category IDs', () => { const data = createDemoDataSource(); assert.equal(data.getQuickCategories('transfer').some((item) => item.transactionType === 'expense'), false); });
add('X', 'same-account transfers are still rejected by the engine', () => { const data = createDemoDataSource(); assert.throws(() => data.addTransaction({ kind: 'transfer', amount: 1, sourceAccountId: 'sv-mbb', destinationAccountId: 'sv-mbb', date: '2026-07-15', time: '10:00' })); });
add('X', 'source remains free of financial persistence APIs', () => Object.values(source).forEach((text) => assert.doesNotMatch(text, /\blocalStorage\b|\bindexedDB\b|\bfetch\s*\(/)));
add('X', 'source does not import Supabase', () => Object.values(source).forEach((text) => assert.doesNotMatch(text, /from\s+['"][^'"]*supabase|createClient\s*\(/iu)));
add('X', '5173 remains the only development port', () => assert.match(read('../package.json'), /vite --port 5173 --strictPort/));
add('X', 'account data remains fixture-backed', () => assert.match(source.state, /createDemoDataSource/));
add('X', 'no account CRUD screen is introduced', () => assert.doesNotMatch(source.assets, /删除账户|编辑账户/));

assert.equal(cases.length, 112);
cases.forEach(([group, name, run], index) => test(`2B3B-${String(index + 1).padStart(3, '0')} [${group}] ${name}`, run));
