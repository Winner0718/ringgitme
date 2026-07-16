import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createDemoDataSource } from '../src/fixtures/demoData.js';
import { allocationSummary, applyRemainderToActive, equalSplitMinor } from '../src/domain/smartSplit.js';
import { evaluateMoneyExpression } from '../src/components/MoneyCalculatorSheet.js';
import { splitAllocationEditorHTML, splitCompletionMessage } from '../src/components/SplitAllocationEditorSheet.js';
import { CONFIRMATION_STATES, confirmationStateFrame, createConfirmationPresentationSnapshot, moneyFlowConfirmationHTML } from '../src/components/MoneyFlowConfirmation.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const source = {
  split: read('../src/components/SplitAllocationEditorSheet.js'),
  capture: read('../src/components/CaptureSheet.js'),
  confirmation: read('../src/components/MoneyFlowConfirmation.js'),
  visual: read('../src/components/AccountVisualCard.js'),
  appSheet: read('../src/components/AppSheet.js'),
  modal: read('../src/app/modalStack.js'),
  money: read('../src/domain/moneyEngine.js'),
  snapshot: read('../src/domain/confirmationSnapshot.js'),
  relationship: read('../src/domain/relationshipLedgerEngine.js'),
  css: read('../src/styles/phase2b3g-fix3.css'),
  css5: read('../src/styles/phase2b3g-fix5.css'),
};

const ids = ['participant-me', 'participant-abi', 'participant-mei', 'participant-jason'];
const splitHTML = (shares = { 'participant-me': 10000, 'participant-abi': 10000, 'participant-mei': 10000, 'participant-jason': 10000 }, activeParticipantId = 'participant-me') => splitAllocationEditorHTML({ totalMinor: 40000, participantIds: ids, sharesMinor: shares, activeParticipantId, expression: '100.00' });
const addExpense = (data, key, amount = 1) => data.addTransaction({ kind: 'expense', amount, catId: 'expense-food', sourceAccountId: 'sv-mbb', desc: key, date: '2026-07-15', time: '13:14', submissionKey: key });

test('FIX3-001 split editor now renders inline inside Relationship', () => assert.match(source.capture, /sheetActionDockHTML[\s\S]*\$\{drawer\}/));
test('FIX3-002 split editor creates no modal stack entry', () => assert.doesNotMatch(source.split, /pushModalLayer|mountModalLayer|modal-layer/));
test('FIX3-003 inline split interaction remains owned by Relationship', () => assert.match(source.capture, /function bindRelationshipSheet\(sheet\)[\s\S]*data-split-allocation/));
test('FIX3-004 up to six participants stay on the parent custom page', () => assert.match(source.capture, /customSplitPagesHTML[\s\S]*ids\.slice\(index, index \+ 6\)[\s\S]*customSplitRowHTML/));
test('FIX3-005 no +N hides four-person allocation', () => {
  assert.doesNotMatch(splitHTML(), /\+\d/);
  assert.match(source.css5, /relationship-split-pages[\s\S]*display: flex[\s\S]*overflow-x: auto/);
});
test('FIX3-006 active participant is highlighted on the parent grid', () => assert.match(source.capture, /relationDrawer\?\.activeId === id[\s\S]*is-editing/));
test('FIX3-007 continuous participant switching does not close the drawer', () => assert.match(source.split, /export function switchInlineSplitParticipant[\s\S]*draft\.activeId = participantId/));
test('FIX3-008 switching commits the current valid expression', () => assert.match(source.split, /switchInlineSplitParticipant[\s\S]*commitInlineSplitExpression\(draft\)/));
test('FIX3-009 switching resets only the active expression', () => assert.match(source.split, /draft\.expression = expressionForMinor\(draft\.shares\[participantId\]\)/));
test('FIX3-010 existing participant values remain in the shared map', () => assert.match(source.split, /const shares = Object\.fromEntries\(ids\.map/));
test('FIX3-011 allocated total uses integer minor units', () => assert.equal(allocationSummary(40000, Object.fromEntries(ids.map((id) => [id, 10000])), ids).allocatedMinor, 40000));
test('FIX3-012 exact allocation is recognized', () => assert.equal(allocationSummary(10000, { a: 6000, b: 2000, c: 1000, d: 1000 }, ['a', 'b', 'c', 'd']).exact, true));
test('FIX3-013 remaining allocation is exact', () => assert.equal(allocationSummary(10000, { a: 6000, b: 2000, c: 1000, d: 0 }, ['a', 'b', 'c', 'd']).remainingMinor, 1000));
test('FIX3-014 excess allocation is exact', () => assert.equal(allocationSummary(10000, { a: 6000, b: 3000, c: 2000 }, ['a', 'b', 'c']).overMinor, 1000));
test('FIX3-015 invalid remaining copy is exact', () => assert.equal(splitCompletionMessage(allocationSummary(10000, { a: 9000 }, ['a'])), '还差 RM 10.00，请完成分配'));
test('FIX3-016 invalid excess copy is exact', () => assert.equal(splitCompletionMessage(allocationSummary(10000, { a: 11000 }, ['a'])), '已超出 RM 10.00，请调整金额'));
test('FIX3-017 equal redistribution totals exactly', () => assert.equal(Object.values(equalSplitMinor(10001, ids)).reduce((a, b) => a + b, 0), 10001));
test('FIX3-018 last participant absorbs one-cent remainder', () => assert.equal(equalSplitMinor(10001, ids)[ids.at(-1)], 2501));
test('FIX3-019 fill remaining targets the only unresolved participant', () => assert.equal(applyRemainderToActive(10000, ['a', 'b'], { a: 6000, b: 0 }, 'a').b, 4000));
test('FIX3-020 fill remaining otherwise targets active participant', () => assert.equal(applyRemainderToActive(10000, ['a', 'b'], { a: 5000, b: 3000 }, 'b').b, 5000));
test('FIX3-021 fill remaining refuses an excess', () => assert.throws(() => applyRemainderToActive(10000, ['a'], { a: 10001 }, 'a'), /超出/));
test('FIX3-022 clear current retains the stable participant map', () => assert.match(source.split, /draft\.shares\[draft\.activeId\] = 0/));
test('FIX3-023 safe calculator addition is reused', () => assert.equal(evaluateMoneyExpression('60+20', { allowZero: true }).minor, 8000));
test('FIX3-024 safe calculator precedence is reused', () => assert.equal(evaluateMoneyExpression('10+5×2', { allowZero: true }).minor, 2000));
test('FIX3-025 divide by zero is blocked', () => assert.throws(() => evaluateMoneyExpression('10÷0', { allowZero: true }), /除以零/));
test('FIX3-026 negative share is blocked', () => assert.throws(() => evaluateMoneyExpression('10−20', { allowZero: true }), /负数/));
test('FIX3-027 entry is capped at two decimal places', () => assert.match(source.split, /tail\.split\('\.'\)\[1\]\.length >= 2/));
test('FIX3-028 no unsafe dynamic evaluator is used', () => assert.doesNotMatch(source.split, /\beval\s*\(|new Function|Function\s*\(/));
test('FIX3-029 invalid expression focuses visible inline feedback', () => assert.match(source.capture, /data-inline-split-feedback[\s\S]*focusSelector/));
test('FIX3-030 invalid participant switch does not close the drawer', () => assert.match(source.capture, /!switchInlineSplitParticipant[\s\S]*return/));
test('FIX3-031 Apply closes only the inline drawer', () => assert.match(source.capture, /data-inline-split-apply[\s\S]*closeDrawer\(\{ apply: true \}\)/));
test('FIX3-032 collapse does not leak the drawer draft', () => assert.match(source.capture, /if \(apply\)[\s\S]*relationDraft\.customShares = [^{]*\{ \.\.\.relationDrawer\.shares \}/));
test('FIX3-033 trigger focus can be restored', () => assert.match(source.capture, /triggerParticipantId[\s\S]*focusSelector/));
test('FIX3-034 only one inline drawer draft exists', () => assert.match(source.capture, /let relationDrawer = null/));
test('FIX3-035 Escape closes the drawer before Relationship', () => assert.match(source.capture, /event\.key === 'Escape'[\s\S]*stopImmediatePropagation\(\)[\s\S]*closeDrawer\(\)/));
test('FIX3-036 keyboard arrows switch participants', () => assert.match(source.capture, /ArrowLeft[\s\S]*ArrowRight[\s\S]*switchInlineSplitParticipant/));
test('FIX3-037 mobile editor remains bottom docked', () => assert.match(source.css5, /inline-split-drawer[\s\S]*position: sticky[\s\S]*bottom: 0/));
test('FIX3-038 mobile editor retains a compact calculator height', () => assert.match(source.css5, /height: min\(340px, calc\(100dvh - 380px\)\)/));
test('FIX3-039 tablet and desktop drawer remains capped', () => assert.match(source.css5, /@media \(min-width: 720px\)[\s\S]*height: min\(340px/));
test('FIX3-040 split editor has dark-mode material', () => assert.match(source.css5, /data-theme="dark"[\s\S]*inline-split-drawer/));
test('FIX3-041 split editor has reduced-motion fallback', () => assert.match(source.css5, /prefers-reduced-motion: reduce[\s\S]*inline-split-drawer/));

test('FIX3-042 Capture closes every sheet before Confirmation', () => assert.match(source.capture, /closeAllSheets\(\{ instant: true \}\);[\s\S]*openMoneyFlowConfirmation/));
test('FIX3-043 closeAllSheets drains the AppSheet branch', () => assert.match(source.appSheet, /while \(sheets\.length\) closeSheet\(instant\)/));
test('FIX3-044 Confirmation is an independent root', () => assert.match(source.confirmation, /parentId: null, kind: 'confirmation'/));
test('FIX3-045 Confirmation uses explicit backdrop and surface', () => { assert.match(source.confirmation, /money-motion-backdrop[\s\S]*data-modal-backdrop/); assert.match(source.confirmation, /data-modal-surface/); });
test('FIX3-046 Confirmation has one internal scroll body', () => assert.match(source.css, /money-motion-body[\s\S]*overflow-y: auto/));
test('FIX3-047 Confirmation hides horizontal overflow', () => assert.match(source.css, /money-motion-body[\s\S]*overflow-x: hidden/));
test('FIX3-048 Confirmation explicitly supports touch pan', () => assert.match(source.css, /money-motion-body[\s\S]*touch-action: pan-y/));
test('FIX3-049 iOS momentum scrolling remains enabled', () => assert.match(source.css, /money-motion-body[\s\S]*-webkit-overflow-scrolling: touch/));
test('FIX3-050 scroll padding clears the footer', () => assert.match(source.css, /money-motion-body[\s\S]*scroll-padding-bottom: 92px/));
test('FIX3-051 expand is a full accessible button', () => assert.match(source.confirmation, /button type="button" data-motion-recent-toggle aria-expanded/));
test('FIX3-052 expand replacement uses the immutable presentation', () => assert.match(source.confirmation, /recentHTML\(presentation, \{ expanded: recentExpanded \}\)/));
test('FIX3-053 only top Confirmation handles clicks', () => assert.match(source.confirmation, /layer\.addEventListener\('click'[\s\S]*if \(!isTopModal\(layer\)\) return/));
test('FIX3-054 repeated Confirmation open closes the prior root cleanly', () => assert.match(source.confirmation, /activeConfirmationClose\(\{ silent: true, instant: true \}\)/));
test('FIX3-055 Continue closes before opening a new Capture', () => assert.match(source.capture, /onContinue: \(\) => openCaptureSheet\(\)/));
test('FIX3-056 modal stack exposes balanced lock depth', () => assert.match(source.modal, /bodyScrollLockCount\(\)[\s\S]*return stack\.length/));

test('FIX3-057 explicit Confirmation states are complete', () => assert.deepEqual(CONFIRMATION_STATES, ['preparing', 'first-frame', 'balance-motion', 'record-motion', 'settled']));
test('FIX3-058 first-frame maps to frame one', () => assert.equal(confirmationStateFrame('first-frame'), 1));
test('FIX3-059 balance motion maps to frame two', () => assert.equal(confirmationStateFrame('balance-motion'), 2));
test('FIX3-060 settled maps to frame three', () => assert.equal(confirmationStateFrame('settled'), 3));
test('FIX3-061 presentation snapshots are deeply immutable', () => { const value = createConfirmationPresentationSnapshot({ accountChanges: [{ beforeMinor: 1 }] }); assert.ok(Object.isFrozen(value)); assert.ok(Object.isFrozen(value.accountChanges)); assert.ok(Object.isFrozen(value.accountChanges[0])); });
test('FIX3-062 fallback presentation IDs are unique', () => assert.notEqual(createConfirmationPresentationSnapshot({}).confirmationId, createConfirmationPresentationSnapshot({}).confirmationId));
test('FIX3-063 successful saves receive unique confirmation IDs', () => { const data = createDemoDataSource(); const a = addExpense(data, 'fix3-a'); const b = addExpense(data, 'fix3-b'); assert.notEqual(a.confirmation.confirmationId, b.confirmation.confirmationId); });
test('FIX3-064 committed confirmation includes account identity snapshot', () => { const data = createDemoDataSource(); const item = addExpense(data, 'fix3-snapshot'); assert.equal(item.confirmation.accountChanges[0].accountSnapshot.id, 'sv-mbb'); assert.equal(item.confirmation.accountChanges[0].accountSnapshot.name, 'Maybank 储蓄卡'); });
test('FIX3-065 committed confirmation is frozen', () => { const data = createDemoDataSource(); assert.ok(Object.isFrozen(addExpense(data, 'fix3-frozen').confirmation)); });
test('FIX3-066 first frame contains identity and old balance', () => { const data = createDemoDataSource(); const item = addExpense(data, 'fix3-first'); const html = moneyFlowConfirmationHTML(item.confirmation, { frame: 1 }); assert.match(html, /data-account-identity="sv-mbb"/); assert.match(html, new RegExp(`RM ${(item.confirmation.accountChanges[0].beforeMinor / 100).toLocaleString('en-MY', { minimumFractionDigits: 2 })}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))); });
test('FIX3-067 first-frame card is never transparent', () => assert.match(source.css, /money-motion-layer\.frame-1 \.money-motion-card[\s\S]*opacity: 1/));
test('FIX3-068 artwork fallback is visible until decode completes', () => { assert.match(source.visual, /image-pending/); assert.match(source.css, /image-pending:not\(\.image-ready\)/); });
test('FIX3-069 artwork failure keeps deterministic fallback', () => assert.match(source.visual, /image-failed/));
test('FIX3-070 motion starts after two paint boundaries', () => assert.match(source.confirmation, /nextFrame\(\(\) => nextFrame\(\(\) =>/));
test('FIX3-071 timeout fallback always settles', () => assert.match(source.confirmation, /settleDelay \+ 420/));
test('FIX3-072 reduced motion mounts settled immediately', () => assert.match(source.confirmation, /reducedMotion \? 'settled' : 'first-frame'/));
test('FIX3-073 normal expense snapshot has exact delta', () => { const data = createDemoDataSource(); assert.equal(addExpense(data, 'fix3-delta', 2).confirmation.accountChanges[0].deltaMinor, -200); });
test('FIX3-074 record-only snapshot is explicitly unchanged', () => { const data = createDemoDataSource(); const item = data.addTransaction({ kind: 'expense', amount: 2, catId: 'expense-food', sourceAccountId: 'sv-mbb', desc: 'record', date: '2026-07-15', time: '13:14', submissionKey: 'fix3-record', recordOnly: true }); assert.equal(item.confirmation.accountChanges[0].deltaMinor, 0); assert.match(moneyFlowConfirmationHTML(item.confirmation), /余额未变/); });
test('FIX3-075 transfer snapshot includes source and destination', () => { const data = createDemoDataSource(); const item = data.addTransaction({ kind: 'transfer', amount: 1, catId: 'transfer-fallback', sourceAccountId: 'sv-mbb', destinationAccountId: 'ew-tng', desc: 'transfer', date: '2026-07-15', time: '13:14', submissionKey: 'fix3-transfer' }); assert.equal(item.confirmation.accountChanges.length, 2); });
test('FIX3-076 repeated submission still writes once', () => { const data = createDemoDataSource(); const a = addExpense(data, 'fix3-idempotent'); const b = addExpense(data, 'fix3-idempotent'); assert.equal(a.id, b.id); });
test('FIX3-077 recent records are captured beyond the collapsed limit', () => assert.match(source.money, /slice\(0, 8\)/));
test('FIX3-078 animation code performs no financial write', () => assert.doesNotMatch(source.confirmation, /addTransaction|recordRelationshipEntry|applyEffect|balanceMinor\s*[+\-]=/));
test('FIX3-079 no Skip control returns', () => assert.doesNotMatch(source.confirmation, /跳过动画|data-motion-skip/));
test('FIX3-080 FIX3 adds no network, persistence or Supabase client', () => Object.values(source).forEach((value) => assert.doesNotMatch(value, /\bfetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|createClient\s*\(/)));
