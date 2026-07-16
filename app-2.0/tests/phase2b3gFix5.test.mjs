import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  clearInlineSplitCurrent,
  commitInlineSplitExpression,
  createInlineSplitDraft,
  equalizeInlineSplitDraft,
  fillInlineSplitRemainder,
  inlineSplitDrawerHTML,
  pressInlineSplitKey,
  splitEditorClosingShares,
  switchInlineSplitParticipant,
} from '../src/components/SplitAllocationEditorSheet.js';
import {
  CONTINUOUS_BALANCE_SAMPLE_COUNT,
  continuousBalanceCountHTML,
  continuousBalanceMinorAtProgress,
  continuousBalanceSequence,
  startContinuousBalanceCount,
} from '../src/components/ContinuousBalanceCount.js';
import { confirmationBalanceMode, createConfirmationPresentationSnapshot, moneyFlowConfirmationHTML } from '../src/components/MoneyFlowConfirmation.js';
import { allocationSummary, equalSplitMinor } from '../src/domain/smartSplit.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const source = {
  split: read('../src/components/SplitAllocationEditorSheet.js'),
  capture: read('../src/components/CaptureSheet.js'),
  confirmation: read('../src/components/MoneyFlowConfirmation.js'),
  continuous: read('../src/components/ContinuousBalanceCount.js'),
  css: read('../src/styles/phase2b3g-fix5.css'),
  debug: read('../src/components/SplitComposerDebugPreview.js'),
  visual: read('../src/components/AccountVisualCard.js'),
  router: read('../src/app/router.js'),
};
const realIds = ['participant-me', 'participant-abi', 'participant-mei', 'participant-jason'];
const ids = (count) => Array.from({ length: count }, (_, index) => realIds[index] || `participant-demo-${index + 1}`);
const shares = (count, minor = 0) => Object.fromEntries(ids(count).map((id) => [id, minor]));
const drawerHTML = (count, values = shares(count), active = ids(count)[0], expression = '0.00') => inlineSplitDrawerHTML({ totalMinor: 10000, participantIds: ids(count), sharesMinor: values, activeParticipantId: active, expression });
const confirmation = ({ beforeMinor = 12000, afterMinor = 2100, accountEffect = 'posted', changes = null, relationship = null } = {}) => ({
  confirmationId: 'fix5-confirmation', transactionId: 'fix5-transaction', operation: 'create', kind: afterMinor >= beforeMinor ? 'income' : 'expense', accountEffect,
  amountMinor: Math.abs(afterMinor - beforeMinor), description: 'FIX5 测试', relationship,
  accountChanges: changes || [{ accountId: 'sv-mbb', accountName: 'Maybank 储蓄卡', accountType: 'saving', measure: 'balance', beforeMinor, afterMinor, deltaMinor: afterMinor - beforeMinor }],
  recentRecords: [],
});
const add = (number, name, fn) => test(`FIX5-${String(number).padStart(3, '0')} ${name}`, fn);

add(1, 'custom split production source contains no second modal mount', () => assert.doesNotMatch(source.split, /pushModalLayer|mountModalLayer|data-modal-backdrop|modal-layer/));
add(2, 'drawer markup is an aside inside Relationship content', () => { assert.match(drawerHTML(4), /<aside class="inline-split-drawer/); assert.match(source.capture, /sheetActionDockHTML[\s\S]*\$\{drawer\}/); });
add(3, 'Capture no longer imports the old modal opener', () => assert.doesNotMatch(source.capture, /openSplitAllocationEditorSheet/));
add(4, 'Relationship remains the only production sheet owner', () => assert.match(source.capture, /openSheet\(\{ id: 'capture-relationship'/));
add(5, 'inline drawer introduces no blur class on parent', () => { const parentRule = source.css.match(/\.capture-relationship-sheet\.has-inline-split-drawer[^\{]*\{[^}]*\}/)?.[0] || ''; assert.doesNotMatch(parentRule, /filter|blur\(/); });
add(6, 'drawer does not duplicate two parent participants', () => assert.doesNotMatch(drawerHTML(2), /data-inline-split-person/));
add(7, 'parent participant is a real amount button', () => assert.match(source.capture, /button type="button" class="relationship-amount-row[\s\S]*data-split-allocation/));
add(8, 'parent pages hold up to six participants each', () => assert.match(source.capture, /ids\.slice\(index, index \+ 6\)/));
add(9, 'twelve-participant QA path keeps real parent buttons', () => assert.match(source.debug, /data-debug-person/));
add(10, 'active participant stays highlighted in the parent grid', () => assert.match(source.capture, /relationDrawer\?\.activeId === id[\s\S]*is-editing/));
add(11, 'participant IDs are deduplicated authoritatively', () => assert.deepEqual(createInlineSplitDraft({ participantIds: ['a', 'a', 'b'], sharesMinor: {} }).ids, ['a', 'b']));
add(12, 'stable IDs own every initial share', () => assert.deepEqual(Object.keys(createInlineSplitDraft({ participantIds: ['a', 'b'], sharesMinor: { a: 1, b: 2 } }).shares), ['a', 'b']));
add(13, 'four-person continuous 10/20/30/40 entry is exact', () => {
  const draft = createInlineSplitDraft({ participantIds: realIds, sharesMinor: shares(4), activeParticipantId: realIds[0] });
  draft.expression = '10'; assert.equal(switchInlineSplitParticipant(draft, realIds[1]), true);
  draft.expression = '20'; assert.equal(switchInlineSplitParticipant(draft, realIds[2]), true);
  draft.expression = '30'; assert.equal(switchInlineSplitParticipant(draft, realIds[3]), true);
  draft.expression = '40'; assert.equal(commitInlineSplitExpression(draft), true);
  assert.deepEqual(draft.shares, { 'participant-me': 1000, 'participant-abi': 2000, 'participant-mei': 3000, 'participant-jason': 4000 });
  assert.equal(allocationSummary(10000, draft.shares, realIds).exact, true);
});
add(14, 'switching preserves committed prior values', () => { const draft = createInlineSplitDraft({ participantIds: ['a', 'b'], sharesMinor: { a: 0, b: 0 }, activeParticipantId: 'a' }); draft.expression = '10'; switchInlineSplitParticipant(draft, 'b'); assert.equal(draft.shares.a, 1000); });
add(15, 'invalid expression blocks participant switching', () => { const draft = createInlineSplitDraft({ participantIds: ['a', 'b'], sharesMinor: {}, activeParticipantId: 'a' }); draft.expression = '10+'; assert.equal(switchInlineSplitParticipant(draft, 'b'), false); assert.equal(draft.activeId, 'a'); });
add(16, 'invalid expression preserves committed value', () => { const draft = createInlineSplitDraft({ participantIds: ['a', 'b'], sharesMinor: { a: 500, b: 0 }, activeParticipantId: 'a' }); draft.expression = '5+'; switchInlineSplitParticipant(draft, 'b'); assert.equal(draft.shares.a, 500); });
add(17, 'safe keypad arithmetic commits integer minor units', () => { const draft = createInlineSplitDraft({ participantIds: ['a'], sharesMinor: {}, activeParticipantId: 'a' }); draft.expression = '10+5×2'; assert.equal(commitInlineSplitExpression(draft), true); assert.equal(draft.shares.a, 2000); });
add(18, 'key input does not use eval', () => assert.doesNotMatch(source.split, /\beval\s*\(|new Function|Function\s*\(/));
add(19, 'clear current does not remove another participant', () => { const draft = createInlineSplitDraft({ participantIds: ['a', 'b'], sharesMinor: { a: 100, b: 200 }, activeParticipantId: 'a' }); clearInlineSplitCurrent(draft); assert.deepEqual(draft.shares, { a: 0, b: 200 }); });
add(20, 'even split is exact in integer minor units', () => { const draft = createInlineSplitDraft({ participantIds: ['a', 'b', 'c'], sharesMinor: {} }); equalizeInlineSplitDraft(draft, 10001); assert.deepEqual(draft.shares, { a: 3333, b: 3333, c: 3335 }); });
add(21, 'fill remaining is deterministic', () => { const draft = createInlineSplitDraft({ participantIds: ['a', 'b'], sharesMinor: { a: 7000, b: 0 }, activeParticipantId: 'b' }); fillInlineSplitRemainder(draft, 10000); assert.deepEqual(draft.shares, { a: 7000, b: 3000 }); });
add(22, 'under-allocation preserves entered values', () => assert.equal(allocationSummary(10000, { a: 1200, b: 2300 }, ['a', 'b']).remainingMinor, 6500));
add(23, 'over-allocation preserves entered values', () => assert.equal(allocationSummary(10000, { a: 9000, b: 2500 }, ['a', 'b']).overMinor, 1500));
add(24, 'collapse contract can restore the opening snapshot', () => assert.deepEqual(splitEditorClosingShares({ a: 100 }, { a: 900 }, false), { a: 100 }));
add(25, 'Apply contract can return the current draft', () => assert.deepEqual(splitEditorClosingShares({ a: 100 }, { a: 900 }, true), { a: 900 }));
add(26, 'Apply closes only relationDrawer', () => assert.match(source.capture, /relationDrawer = null;[\s\S]*rerenderRelationshipSheet/));
add(27, 'final Relationship completion remains separate', () => assert.match(source.capture, /'data-action': 'capture-relation-save'/));
add(28, 'Escape closes drawer with propagation stopped', () => assert.match(source.capture, /event\.key === 'Escape'[\s\S]*stopImmediatePropagation\(\)[\s\S]*closeDrawer/));
add(29, 'focus returns to opening participant row', () => assert.match(source.capture, /triggerParticipantId[\s\S]*data-split-allocation/));
add(30, 'active parent participant auto-scrolls into view', () => assert.match(source.capture, /data-split-allocation[\s\S]*inline: 'center'/));
add(31, 'parent pages scroll horizontally', () => assert.match(source.css, /relationship-split-pages[\s\S]*overflow-x: auto/));
add(32, 'each participant page stays a two-column grid', () => assert.match(source.css, /relationship-split-page[\s\S]*grid-template-columns: repeat\(2/));
add(33, '390px keypad keys remain at least 48px', () => assert.match(source.css, /repeat\(5, minmax\(48px, 1fr\)\)[\s\S]*min-height: 48px/));
add(34, 'drawer owns safe-area bottom spacing', () => assert.match(source.css, /env\(safe-area-inset-bottom\)/));
add(35, 'drawer uses one same-sheet sticky region', () => assert.match(source.css, /inline-split-drawer[\s\S]*position: sticky[\s\S]*bottom: 0/));

add(36, 'RM120 to RM21 sequence starts exactly at RM120', () => assert.equal(continuousBalanceSequence(12000, 2100)[0], 12000));
add(37, 'RM120 to RM21 sequence ends exactly at RM21', () => assert.equal(continuousBalanceSequence(12000, 2100).at(-1), 2100));
add(38, 'count includes real intermediate values', () => { const values = continuousBalanceSequence(12000, 2100); assert.ok(values.slice(1, -1).some((value) => value !== 12000 && value !== 2100)); });
add(39, 'decrease never rises', () => { const values = continuousBalanceSequence(12000, 2100); assert.ok(values.every((value, index) => !index || value <= values[index - 1])); });
add(40, 'increase never falls', () => { const values = continuousBalanceSequence(2100, 12000); assert.ok(values.every((value, index) => !index || value >= values[index - 1])); });
add(41, 'decimal sen are preserved exactly', () => assert.equal(continuousBalanceSequence(12001, 2199).at(-1), 2199));
add(42, 'large changes remain bounded to sampled values', () => assert.ok(continuousBalanceSequence(1, 999999999).length <= CONTINUOUS_BALANCE_SAMPLE_COUNT + 1));
add(43, 'default count exposes many readable samples', () => assert.ok(continuousBalanceSequence(12000, 2100).length >= 30));
add(44, 'mid progress is neither endpoint', () => assert.ok(![12000, 2100].includes(continuousBalanceMinorAtProgress(12000, 2100, .5))));
add(45, 'exact zero progress clamps to start', () => assert.equal(continuousBalanceMinorAtProgress(12000, 2100, 0), 12000));
add(46, 'exact one progress clamps to end', () => assert.equal(continuousBalanceMinorAtProgress(12000, 2100, 1), 2100));
add(47, 'count markup has one authoritative visible amount', () => assert.equal((continuousBalanceCountHTML(12000, 2100).match(/data-continuous-balance-count/g) || []).length, 1));
add(48, 'count markup has no complete old/new overlap', () => assert.doesNotMatch(continuousBalanceCountHTML(12000, 2100), /money-reel-old|money-reel-new|<i\b/));
add(49, 'count markup starts non-blank', () => assert.match(continuousBalanceCountHTML(12000, 2100), />RM 120\.00<\/span>/));
add(50, 'count is aria-live off while moving', () => assert.match(continuousBalanceCountHTML(12000, 2100), /aria-live="off"/));
add(51, 'runtime count emits monotonic sampled values and exact final', () => {
  const queue = [];
  const updates = [];
  const element = { dataset: {}, textContent: '', attributes: {}, setAttribute(name, value) { this.attributes[name] = String(value); } };
  startContinuousBalanceCount(element, { startMinor: 12000, endMinor: 2100, durationMs: 100, sampleCount: 10, requestFrame: (callback) => { queue.push(callback); return queue.length; }, cancelFrame: () => {}, onUpdate: (value) => updates.push(value) });
  for (const time of [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) queue.shift()?.(time);
  assert.equal(Number(element.dataset.currentMinor), 2100);
  assert.ok(updates.every((value, index) => !index || value <= updates[index - 1]));
});
add(52, 'runtime close returns a cancellable RAF cleanup', () => { const queue = []; const element = { dataset: {}, textContent: '', setAttribute() {} }; const cancel = startContinuousBalanceCount(element, { startMinor: 1, endMinor: 2, requestFrame: (callback) => { queue.push(callback); return 1; }, cancelFrame: () => {} }); assert.equal(cancel(), true); assert.equal(cancel(), false); });
add(53, 'normal confirmation uses continuous counter not odometer', () => { const html = moneyFlowConfirmationHTML(confirmation(), { frame: 2, motionState: 'balance-rolling' }); assert.match(html, /data-continuous-balance-count/); assert.doesNotMatch(html, /data-money-odometer/); });
add(54, 'record-only unchanged balance has no count', () => assert.equal(confirmationBalanceMode('balance-rolling', 0, 1, true), 'unchanged'));
add(55, 'transfer source counts before destination', () => { assert.equal(confirmationBalanceMode('source-rolling', 0, 2), 'counting'); assert.equal(confirmationBalanceMode('source-rolling', 1, 2), 'before'); });
add(56, 'transfer destination counts only after source settle', () => { assert.equal(confirmationBalanceMode('destination-rolling', 0, 2), 'after'); assert.equal(confirmationBalanceMode('destination-rolling', 1, 2), 'counting'); });
add(57, 'reduced motion uses no continuous counter', () => assert.doesNotMatch(moneyFlowConfirmationHTML(confirmation(), { frame: 2, motionState: 'reduced-crossfade' }), /data-continuous-balance-count/));
add(58, 'presentation snapshot remains deeply frozen', () => { const snapshot = createConfirmationPresentationSnapshot(confirmation()); assert.ok(Object.isFrozen(snapshot)); assert.ok(Object.isFrozen(snapshot.accountChanges)); });
add(59, 'image failure cannot write count motion state', () => assert.doesNotMatch(source.visual, /startContinuousBalanceCount|continuousBalanceMinorAtProgress/));
add(60, 'FIX5 adds no financial mutation, network or persistence client', () => {
  assert.doesNotMatch(source.confirmation + source.continuous, /addTransaction|recordRelationshipEntry|applyEffect|\.balance\s*[+\-]=/);
  Object.values(source).forEach((value) => assert.doesNotMatch(value, /\bfetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|createClient\s*\(/));
});
add(61, 'deterministic QA progress survives presentation-route normalization', () => assert.match(source.router, /PRESENTATION_QUERY_KEYS[^\n]*'motionProgress'/));
add(62, 'transfer safety settle uses the transfer-aware duration without an early normal settle', () => {
  assert.match(source.confirmation, /setTimeout\(\(\) => setState\('settled'\), settleDelay \+ 420\)/);
  assert.doesNotMatch(source.confirmation, /setState\('settled'\), MOTION\.confirmationMs \+ 420/);
});
add(63, 'open calculator locks the Relationship body vertically', () => assert.match(source.css, /has-inline-split-drawer \.sheet-body[\s\S]*overflow-y: hidden/));
add(64, 'only the first calculator mount receives the entrance animation', () => {
  assert.match(source.split, /opening \? ' is-opening'/);
  assert.match(source.css, /inline-split-drawer\.is-opening[\s\S]*animation:/);
  assert.doesNotMatch(source.css.match(/\.inline-split-drawer \{[\s\S]*?\n\}/)?.[0] || '', /animation:/);
});
add(65, 'key rerenders preserve the locked split-method position', () => assert.match(source.capture, /relationDrawer\?\.lockedScrollTop \?\? scrollTop/));
add(66, 'calculator uses an opaque same-sheet surface so parent content cannot bleed through', () => assert.match(source.css, /inline-split-drawer \{[\s\S]*background: var\(--s0\)/));
add(67, 'calculator does not duplicate the selected participant amount header', () => assert.doesNotMatch(drawerHTML(4), /data-inline-split-active|正在编辑/));
add(68, 'equal split reuses the same six-person paged two-column layout', () => {
  assert.match(source.capture, /function equalSplitPagesHTML[\s\S]*index \+= 6[\s\S]*relationship-split-page/);
  assert.match(source.capture, /equalSplitPagesHTML\(selected, shares\)/);
});
add(69, 'active participant card renders the unfinished arithmetic expression', () => assert.match(source.capture, /customParticipantPresentation\([\s\S]*relationDrawer\?\.expression[\s\S]*presentation\.editingExpression[\s\S]*is-expression/));
add(70, 'trailing operator receives an explicit selected state', () => {
  const html = inlineSplitDrawerHTML({ totalMinor: 1000, participantIds: ['a'], sharesMinor: { a: 500 }, activeParticipantId: 'a', expression: '5+' });
  assert.match(html, /split-editor-key operator is-selected[^>]*data-inline-split-key="\+"[^>]*aria-pressed="true"/);
});
add(71, 'post-render scroll lock cannot write after the drawer has closed', () => assert.match(source.capture, /if \(relationDrawer && relationDrawer\.lockedScrollTop == null\)/));
add(72, 'six people fit before the seventh continues into the horizontal rail', () => {
  assert.match(source.capture, /index \+= 6[\s\S]*ids\.slice\(index, index \+ 6\)/);
  assert.match(source.css, /has-inline-split-drawer[\s\S]*relationship-split-page \.split-participant-row[\s\S]*min-height: 44px/);
});
add(73, 'participant rail is freely draggable rather than mandatory page snapping', () => {
  assert.match(source.css, /relationship-split-pages[\s\S]*scroll-snap-type: none[\s\S]*-webkit-overflow-scrolling: touch/);
  assert.match(source.css, /relationship-split-page[\s\S]*scroll-snap-align: none/);
});
