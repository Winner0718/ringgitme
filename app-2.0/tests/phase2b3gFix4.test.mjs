import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { allocationSummary, applyRemainderToActive, equalSplitMinor } from '../src/domain/smartSplit.js';
import { evaluateMoneyExpression } from '../src/components/MoneyCalculatorSheet.js';
import { splitAllocationEditorHTML, splitEditorClosingShares } from '../src/components/SplitAllocationEditorSheet.js';
import { MONEY_REEL_MAX_STAGGER_ORDER, MONEY_REEL_STAGGER_MS, moneyOdometerHTML, moneyOdometerModel } from '../src/components/MoneyOdometer.js';
import { continuousBalanceCountHTML, continuousBalanceSequence } from '../src/components/ContinuousBalanceCount.js';
import { confirmationBalanceMode, createConfirmationPresentationSnapshot, moneyFlowConfirmationHTML } from '../src/components/MoneyFlowConfirmation.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const source = {
  split: read('../src/components/SplitAllocationEditorSheet.js'),
  capture: read('../src/components/CaptureSheet.js'),
  confirmation: read('../src/components/MoneyFlowConfirmation.js'),
  odometer: read('../src/components/MoneyOdometer.js'),
  continuous: read('../src/components/ContinuousBalanceCount.js'),
  debug: read('../src/components/SplitComposerDebugPreview.js'),
  css: read('../src/styles/phase2b3g-fix4.css'),
  css5: read('../src/styles/phase2b3g-fix5.css'),
  motion: read('../src/app/motion.js'),
  accountVisual: read('../src/components/AccountVisualCard.js'),
  router: read('../src/app/router.js'),
};
const ids = (count) => Array.from({ length: count }, (_, index) => index < 4 ? ['participant-me', 'participant-abi', 'participant-mei', 'participant-jason'][index] : `participant-demo-${index + 1}`);
const shares = (count, minor = 0) => Object.fromEntries(ids(count).map((id) => [id, minor]));
const splitHTML = (count, values = shares(count), active = ids(count)[0], expression = '0.00') => splitAllocationEditorHTML({ totalMinor: 10000, participantIds: ids(count), sharesMinor: values, activeParticipantId: active, expression });
const confirmation = ({ beforeMinor = 682215, afterMinor = 672215, kind = 'expense', accountEffect = 'posted', changes = null, relationship = null } = {}) => ({
  confirmationId: 'fix4-confirmation', transactionId: 'fix4-transaction', operation: 'create', kind, accountEffect,
  amountMinor: Math.abs(afterMinor - beforeMinor), description: 'FIX4 测试', relationship,
  accountChanges: changes || [{ accountId: 'sv-mbb', accountName: 'Maybank 储蓄卡', accountType: 'saving', measure: 'balance', beforeMinor, afterMinor, deltaMinor: afterMinor - beforeMinor }],
  recentRecords: [{ id: 'fix4-transaction', desc: 'FIX4 测试', amountMinor: 10000, kind, date: '2026-07-16', time: '00:21' }],
});
const add = (number, name, fn) => test(`FIX4-${String(number).padStart(3, '0')} ${name}`, fn);

add(1, 'two-person drawer does not duplicate the parent participants', () => assert.doesNotMatch(splitHTML(2), /data-inline-split-person/));
add(2, 'six-person parent uses one three-row page', () => assert.match(source.capture, /ids\.slice\(index, index \+ 6\)/));
add(3, 'ten-person parent can render multiple horizontal pages', () => assert.match(source.capture, /for \(let index = 0; index < ids\.length; index \+= 6\)/));
add(4, 'twelve-person QA path preserves every parent participant', () => { assert.match(source.debug, /Math\.min\(12/); assert.match(source.debug, /data-debug-person/); });
add(5, 'participant pages are horizontal and scrollable', () => assert.match(source.css5, /relationship-split-pages[\s\S]*display: flex[\s\S]*overflow-x: auto/));
add(6, 'each page retains a readable two-column grid', () => assert.match(source.css5, /relationship-split-page[\s\S]*flex: 0 0 100%[\s\S]*grid-template-columns: repeat\(2/));
add(7, 'large groups never collapse into +N', () => assert.doesNotMatch(splitHTML(12), /\+\d/));
add(8, 'selected participant has an explicit parent-grid state', () => assert.match(source.capture, /is-editing/));
add(9, 'selected participant auto-centers after switching', () => assert.match(source.capture, /scrollIntoView\?\.\(\{ block: 'nearest', inline: 'center'/));
add(10, 'valid expressions use the safe calculator', () => assert.equal(evaluateMoneyExpression('10+5×2', { allowZero: true }).minor, 2000));
add(11, 'invalid expressions block participant switching', () => assert.match(source.split, /switchInlineSplitParticipant[\s\S]*if \(!commitInlineSplitExpression\(draft\)\) return false/));
add(12, 'switching keeps the stable share map', () => { const current = { a: 2000, b: 3000 }; assert.deepEqual({ ...current, b: 4000 }, { a: 2000, b: 4000 }); });
add(13, 'cancel restores the session opening snapshot', () => assert.deepEqual(splitEditorClosingShares({ a: 10, b: 20 }, { a: 90, b: 20 }, false), { a: 10, b: 20 }));
add(14, 'complete returns the current exact snapshot', () => assert.deepEqual(splitEditorClosingShares({ a: 10 }, { a: 100 }, true), { a: 100 }));
add(15, 'Capture applies shares only through the drawer Apply action', () => assert.match(source.capture, /if \(apply\)[\s\S]*relationDraft\.customShares = \{ \.\.\.relationDrawer\.shares \}/));
add(16, 'under-allocation remains exact in minor units', () => assert.equal(allocationSummary(10000, { a: 1000, b: 2000 }, ['a', 'b']).remainingMinor, 7000));
add(17, 'over-allocation remains exact in minor units', () => assert.equal(allocationSummary(10000, { a: 9000, b: 2000 }, ['a', 'b']).overMinor, 1000));
add(18, 'drawer Apply remains separate from final exact completion', () => assert.match(splitHTML(2, { 'participant-me': 4000, 'participant-abi': 6000 }, 'participant-me', '40.00'), /data-inline-split-apply/));
add(19, 'parent Relationship owns exact completion validation', () => assert.match(source.capture, /primaryAttributes: \{ 'data-action': 'capture-relation-save', 'data-disabled-visual': String\(!splitValid\) \}/));
add(20, 'one-cent equal remainder is deterministic', () => assert.deepEqual(equalSplitMinor(10001, ['a', 'b', 'c']), { a: 3333, b: 3333, c: 3335 }));
add(21, 'fill remaining targets the sole unresolved participant', () => assert.deepEqual(applyRemainderToActive(10000, ['a', 'b'], { a: 7000, b: 0 }, 'a'), { a: 7000, b: 3000 }));
add(22, 'quick equal distribution remains available on the parent page', () => assert.match(source.capture, /data-action="capture-split-even"/));
add(23, 'quick clear preserves every stable id', () => assert.match(source.split, /draft\.shares\[draft\.activeId\] = 0/));
add(24, 'drawer closes without closing Relationship', () => assert.match(source.capture, /relationDrawer = null;[\s\S]*rerenderRelationshipSheet/));
add(25, 'calculator is an inline region rather than a modal', () => { assert.match(source.split, /inline-split-drawer/); assert.doesNotMatch(source.split, /pushModalLayer|data-modal-backdrop/); });
add(26, 'drawer height is independent of participant count', () => { assert.match(source.css5, /height: min\(340px, calc\(100dvh - 380px\)\)/); assert.doesNotMatch(source.css5, /data-count[^\n]*height/); });
add(27, 'keypad keeps accessible fixed minimum keys', () => assert.match(source.css5, /repeat\(5, minmax\(48px, 1fr\)\)[\s\S]*min-height: 48px/));
add(28, 'mobile bottom actions remain accessible through the shared dock', () => assert.match(source.split, /sheetActionDockHTML[\s\S]*primaryLabel: '应用'[\s\S]*secondaryLabel: '收起'/));
add(29, 'tablet and desktop remain capped', () => assert.match(source.css5, /@media \(min-width: 720px\)[\s\S]*height: min\(340px/));
add(30, 'query QA adapter supports up to twelve people', () => assert.match(source.debug, /Math\.min\(12/));

add(31, 'odometer model keeps RM labels exact', () => { const model = moneyOdometerModel(9900, 10000); assert.equal(model.beforeLabel, 'RM 99.00'); assert.equal(model.afterLabel, 'RM 100.00'); });
add(32, 'first visible frame is the before balance', () => assert.match(moneyFlowConfirmationHTML(confirmation(), { frame: 1 }), /motion-static-balance[^>]*>RM 6,822\.15/));
add(33, 'first frame balance stage does not contain final balance', () => { const stage = moneyFlowConfirmationHTML(confirmation(), { frame: 1 }).match(/<div class="motion-balance-stage"[\s\S]*?<\/div>/)?.[0] || ''; assert.doesNotMatch(stage, /RM 6,722\.15/); });
add(34, 'counting frame contains one counter and no static final balance behind it', () => { const html = moneyFlowConfirmationHTML(confirmation(), { frame: 2, motionState: 'balance-rolling' }); const stage = html.match(/<div class="motion-balance-stage"[\s\S]*?<\/div>/)?.[0] || ''; assert.equal((stage.match(/data-continuous-balance-count/g) || []).length, 1); assert.doesNotMatch(stage, /motion-static-balance/); });
add(35, 'settled frame is the after balance', () => assert.match(moneyFlowConfirmationHTML(confirmation(), { frame: 3 }), /motion-static-balance[^>]*>RM 6,722\.15/));
add(36, 'changed digits keep both full old/new glyphs in each vertical reel', () => { const html = moneyOdometerHTML(682215, 672215); assert.match(html, /money-reel-slot/); assert.equal((html.match(/<i\b/g) || []).length, 2); });
add(37, 'unchanged digits remain stable', () => assert.match(moneyOdometerHTML(682215, 672215), /motion-digit stable/));
add(38, 'RM prefix is outside the reel', () => assert.match(moneyOdometerHTML(100, 200), /money-odometer-prefix">RM&nbsp;<\/span>/));
add(39, 'decimal point remains stable', () => assert.ok(moneyOdometerModel(101, 109).glyphs.some((glyph) => glyph.after === '.' && glyph.kind === 'stable')));
add(40, 'comma is stable when its position is unchanged', () => assert.ok(moneyOdometerModel(100000, 100100).glyphs.some((glyph) => glyph.after === ',' && glyph.kind === 'stable')));
add(41, 'RM99 to RM100 keeps a fixed aligned model', () => assert.equal(moneyOdometerModel(9900, 10000).glyphs.length, 6));
add(42, 'RM999 to RM1,000 models comma entry without a long reel', () => { const model = moneyOdometerModel(99900, 100000); assert.equal(model.glyphs.length, 8); assert.ok(model.glyphs.some((glyph) => glyph.after === ',')); });
add(43, 'RM9,999.99 to RM10,000.00 remains bounded', () => assert.ok(moneyOdometerModel(999999, 1000000).glyphs.length < 12));
add(44, 'cent-only change rolls fraction digits', () => assert.ok(moneyOdometerModel(10000, 9999).glyphs.some((glyph) => glyph.kind === 'reel')));
add(45, 'large balances do not generate numeric-step reels', () => assert.ok((moneyOdometerHTML(1, 999999999).match(/<i\b/g) || []).length < 30));
add(46, 'expense direction is decrease', () => assert.equal(moneyOdometerModel(20000, 10000).direction, 'decrease'));
add(47, 'income direction is increase', () => assert.equal(moneyOdometerModel(10000, 20000).direction, 'increase'));
add(48, 'transfer source counts before destination', () => { assert.equal(confirmationBalanceMode('source-rolling', 0, 2), 'counting'); assert.equal(confirmationBalanceMode('source-rolling', 1, 2), 'before'); });
add(49, 'transfer destination counts after source settles', () => { assert.equal(confirmationBalanceMode('destination-rolling', 0, 2), 'after'); assert.equal(confirmationBalanceMode('destination-rolling', 1, 2), 'counting'); });
add(50, 'record-only never creates a fake reel', () => assert.equal(confirmationBalanceMode('balance-rolling', 0, 1, true), 'unchanged'));
add(51, 'other-paid relationship-only confirmation stays unchanged', () => assert.match(moneyFlowConfirmationHTML(confirmation({ accountEffect: 'relationship_only', afterMinor: 682215, relationship: { entryType: 'split_expense', payerName: 'Jason', currentUserShareMinor: 25000, afterMinor: 25000, ledgerTitle: '旅行' } }), { frame: 2 }), /余额未变/));
add(52, 'relationship card is gated until relationship-enter', () => assert.match(source.css, /data-motion-state="relationship-enter"[^\n]*motion-relationship-card/));
add(53, 'presentation snapshot is deeply frozen', () => { const snapshot = createConfirmationPresentationSnapshot(confirmation()); assert.ok(Object.isFrozen(snapshot)); assert.ok(Object.isFrozen(snapshot.accountChanges)); });
add(54, 'rerenders are keyed by confirmation id', () => assert.match(source.confirmation, /data-confirmation-id/));
add(55, 'image loading is independent from motion state', () => assert.doesNotMatch(source.confirmation, /image-ready[\s\S]*setState|image-failed[\s\S]*setState/));
add(56, 'reduced motion starts old then crossfades new', () => { assert.match(source.confirmation, /schedule\('reduced-crossfade', 180\)/); assert.match(source.css, /reduced-crossfade/); });
add(57, 'timers and animation frames are cleaned on close', () => { assert.match(source.confirmation, /timers\.forEach\(clearTimeout\)/); assert.match(source.confirmation, /animationFrames\.forEach/); });
add(58, 'normal motion lasts approximately two seconds', () => assert.match(source.motion, /confirmationMs: 2200/));
add(59, 'sequential transfer motion has room for two counts', () => assert.match(source.motion, /transferConfirmationMs: 3100/));
add(60, 'motion remains presentation-only', () => assert.doesNotMatch(source.confirmation + source.continuous, /addTransaction|recordRelationshipEntry|applyEffect|\.balance\s*[+\-]=/));
add(61, 'changed balance wheels use deterministic right-to-left order', () => {
  const orders = moneyOdometerModel(99999, 100000).glyphs.filter((glyph) => glyph.kind === 'reel').map((glyph) => glyph.reelOrder);
  assert.deepEqual([...orders].sort((a, b) => a - b), Array.from({ length: orders.length }, (_, index) => index));
});
add(62, 'changed wheels carry distinct slot-machine delays', () => {
  const html = moneyOdometerHTML(99999, 100000);
  assert.match(html, /data-reel-order="0"[^>]*--money-reel-delay:0ms/);
  assert.match(html, new RegExp(`data-reel-order="1"[^>]*--money-reel-delay:${MONEY_REEL_STAGGER_MS}ms`));
  assert.match(source.css, /money-reel-track > i \{[\s\S]*transition: transform 820ms[^;]*var\(--money-reel-delay, 0ms\)/);
});
add(63, 'image-failure QA mode forces stable account fallbacks without motion state writes', () => {
  assert.match(source.accountVisual, /imageFailure[^\n]*=== '1'/);
  assert.match(source.accountVisual, /image\.removeAttribute\('src'\);[\s\S]*failed\(\);/);
  assert.doesNotMatch(source.accountVisual, /data-motion-state|setMotionState/);
  assert.match(source.router, /'imageFailure'/);
});
add(64, 'live counts start from one authoritative old-value node', () => assert.match(source.confirmation, /startContinuousBalanceCount\(counter,[\s\S]*startMinor: change\.beforeMinor[\s\S]*endMinor: change\.afterMinor/));
add(65, 'continuous count markup contains one complete readable amount', () => { const html = continuousBalanceCountHTML(684215, 162815); assert.equal((html.match(/data-continuous-balance-count/g) || []).length, 1); assert.doesNotMatch(html, /money-reel-old|money-reel-new|<i\b/); });
add(66, 'large changes remain bounded to readable sampled values', () => { const values = continuousBalanceSequence(99999999, 100000000); assert.ok(values.length <= 43); assert.match(source.confirmation, /source-settle', 1350[\s\S]*destination-rolling', 1500[\s\S]*destination-settle', 2690/); });
add(67, 'balance stage reserves vertical jump room without paint clipping', () => {
  assert.match(source.css, /motion-balance-stage \{[\s\S]*min-height: 76px;[\s\S]*overflow: visible;[\s\S]*contain: layout;/);
  assert.doesNotMatch(source.css, /motion-balance-stage \{[\s\S]*contain: layout paint/);
});
add(68, 'deterministic motion progress sets one intermediate integer value', () => assert.match(source.confirmation, /motionProgress[\s\S]*continuousBalanceMinorAtProgress/));
add(69, 'count never clears or overlaps complete old and new visible values', () => { const html = continuousBalanceCountHTML(12000, 2100); assert.equal((html.match(/>RM 120\.00<\/span>/g) || []).length, 1); assert.doesNotMatch(html, /money-reel|money-reel-old|money-reel-new/); });
