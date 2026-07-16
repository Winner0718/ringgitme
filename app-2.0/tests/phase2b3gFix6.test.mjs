import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sheetActionDockHTML } from '../src/components/SheetActionDock.js';
import {
  commitInlineSplitExpression,
  createInlineSplitDraft,
  customAllocationProgress,
  customParticipantPresentation,
  inlineSplitDrawerHTML,
  switchInlineSplitParticipant,
} from '../src/components/SplitAllocationEditorSheet.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const source = {
  capture: read('../src/components/CaptureSheet.js'),
  split: read('../src/components/SplitAllocationEditorSheet.js'),
  dock: read('../src/components/SheetActionDock.js'),
  css: read('../src/styles/phase2b3g-fix6.css'),
  css5: read('../src/styles/phase2b3g-fix5.css'),
  confirmation: read('../src/components/MoneyFlowConfirmation.js'),
  continuous: read('../src/components/ContinuousBalanceCount.js'),
  capacity: read('../src/domain/accountCapacity.js'),
  attachments: read('./attachments.test.mjs'),
  activity: read('../src/features/activity/index.js'),
  copy: read('../src/app/copy.js'),
};
const ids4 = ['participant-me', 'participant-abi', 'participant-mei', 'participant-jason'];
const add = (number, name, fn) => test(`FIX6-${String(number).padStart(3, '0')} ${name}`, fn);
const relationshipDock = () => sheetActionDockHTML({ context: 'relationship', className: 'relationship-action-dock', primaryLabel: '完成', secondaryLabel: '取消', primaryAttributes: { 'data-action': 'capture-relation-save' }, secondaryAttributes: { 'data-action': 'capture-relation-cancel' } });

add(1, 'Relationship uses the shared floating action dock', () => assert.match(source.capture, /sheetActionDockHTML\(\{ context: 'relationship'/));
add(2, 'Relationship no longer renders the old full-width footer class', () => assert.doesNotMatch(source.capture, /class="relationship-footer"/));
add(3, 'Relationship completion callback remains authoritative', () => assert.match(source.capture, /registerAction\('capture-relation-save'[\s\S]*cap\.relationship[\s\S]*closeSheet\(\)/));
add(4, 'Relationship cancellation callback still closes only the active Sheet', () => assert.match(source.capture, /registerAction\('capture-relation-cancel', \(\) => closeSheet\(\)\)/));
add(5, 'calculator uses the same shared dock component', () => assert.match(source.split, /sheetActionDockHTML\(\{ context: 'inline-split'/));
add(6, 'calculator primary action is 应用', () => assert.match(inlineSplitDrawerHTML({ totalMinor: 1000, participantIds: ['a'], sharesMinor: { a: 0 }, activeParticipantId: 'a' }), /data-inline-split-apply="">应用<\/button>/));
add(7, 'calculator secondary action is 收起', () => assert.match(inlineSplitDrawerHTML({ totalMinor: 1000, participantIds: ['a'], sharesMinor: { a: 0 }, activeParticipantId: 'a' }), /data-inline-split-collapse="">收起<\/button>/));
add(8, 'Apply commits only the drawer share draft', () => assert.match(source.capture, /relationDraft\.customShares = \{ \.\.\.relationDrawer\.shares \}[\s\S]*relationDrawer = null/));
add(9, 'Collapse leaves the Relationship Sheet open', () => { const collapse = source.capture.match(/const closeDrawer = \([\s\S]*?return true;\n  \};/)?.[0] || ''; assert.doesNotMatch(collapse, /closeSheet\(/); });
add(10, 'focus restores to the originating participant', () => assert.match(source.capture, /triggerParticipantId[\s\S]*focusSelector: `\[data-split-allocation/));

add(11, 'Custom helper text is rendered in custom mode', () => assert.match(source.capture, /custom-split-helper">点击成员输入金额/));
add(12, 'Average renderer contains no custom helper text', () => { const equalBlock = source.capture.match(/function equalSplitPagesHTML[\s\S]*?\n\}/)?.[0] || ''; assert.doesNotMatch(equalBlock, /点击成员输入金额|正在输入/); });
add(13, 'untouched custom participant exposes 点击输入', () => assert.deepEqual(customParticipantPresentation({ amountMinor: 0 }), { state: 'untouched', hint: '点击输入', amountLabel: 'RM 0.00', editingExpression: false }));
add(14, 'active participant exposes 正在输入', () => assert.equal(customParticipantPresentation({ amountMinor: 0, active: true }).hint, '正在输入'));
add(15, 'committed participant keeps its exact amount', () => { const state = customParticipantPresentation({ amountMinor: 1234 }); assert.equal(state.state, 'committed'); assert.equal(state.amountLabel, 'RM 12.34'); assert.equal(state.hint, ''); });
add(16, 'unfinished active expression stays visible', () => assert.equal(customParticipantPresentation({ amountMinor: 500, active: true, expression: '5+5', fresh: false }).amountLabel, 'RM 5+5'));
add(17, 'committed participant can be selected for editing again', () => { const draft = createInlineSplitDraft({ participantIds: ['a', 'b'], sharesMinor: { a: 500, b: 200 }, activeParticipantId: 'b' }); assert.equal(switchInlineSplitParticipant(draft, 'a'), true); assert.equal(draft.activeId, 'a'); assert.equal(draft.expression, '5.00'); });
add(18, 'progress counts participants with committed non-zero amounts', () => { const progress = customAllocationProgress(10000, { a: 2500, b: 4000, c: 0, d: 0 }, ['a', 'b', 'c', 'd']); assert.equal(progress.committedCount, 2); assert.equal(progress.label, '已填写 2/4 人 · 剩余 RM 35.00'); });
add(19, 'remaining amount is exact integer minor units', () => assert.equal(customAllocationProgress(10001, { a: 3333, b: 3333 }, ['a', 'b', 'c']).remainingMinor, 3335));
add(20, 'exact allocation reports completion', () => { const progress = customAllocationProgress(10000, { a: 2500, b: 7500 }, ['a', 'b']); assert.equal(progress.state, 'exact'); assert.equal(progress.label, '分配完成 ✓'); });
add(21, 'excess allocation never reports completion', () => { const progress = customAllocationProgress(10000, { a: 8000, b: 3000 }, ['a', 'b']); assert.equal(progress.state, 'over'); assert.doesNotMatch(progress.label, /分配完成/); });
add(22, 'zero total is neutral rather than falsely complete', () => { const progress = customAllocationProgress(0, { a: 0, b: 0 }, ['a', 'b']); assert.equal(progress.state, 'neutral'); assert.equal(progress.label, '已填写 0/2 人'); assert.doesNotMatch(progress.label, /分配完成/); });
add(23, 'four-person custom allocation remains exact', () => { const progress = customAllocationProgress(10000, { [ids4[0]]: 1000, [ids4[1]]: 2000, [ids4[2]]: 3000, [ids4[3]]: 4000 }, ids4); assert.equal(progress.state, 'exact'); assert.equal(progress.committedCount, 4); });
add(24, 'ten-person custom allocation keeps ten stable IDs', () => { const ids = Array.from({ length: 10 }, (_, index) => `p-${index}`); const draft = createInlineSplitDraft({ participantIds: ids, sharesMinor: Object.fromEntries(ids.map((id, index) => [id, index * 100])) }); assert.deepEqual(draft.ids, ids); assert.equal(Object.keys(draft.shares).length, 10); });

add(25, 'participant rail remains free-scrolling', () => assert.match(source.css5, /relationship-split-pages[\s\S]*overflow-x: auto/));
add(26, 'FIX6 introduces no mandatory rail snap', () => { assert.match(source.css5, /scroll-snap-type: none/); assert.doesNotMatch(source.css, /scroll-snap-type:\s*x|scroll-snap-align:\s*(?:start|center|end)/); });
add(27, 'calculator rerenders preserve locked scrollTop', () => assert.match(source.capture, /relationDrawer\?\.lockedScrollTop \?\? scrollTop/));
add(28, 'closed drawer cannot receive a stale callback write', () => assert.match(source.capture, /if \(relationDrawer && relationDrawer\.lockedScrollTop == null\)/));
add(29, 'Relationship completion action is not duplicated', () => assert.equal((source.capture.match(/registerAction\('capture-relation-save'/g) || []).length, 1));
add(30, 'dock and split presentation cannot create a transaction', () => assert.doesNotMatch(source.dock + source.split, /addTransaction|recordRelationshipEntry|applyEffect/));
add(31, 'continuous balance implementation remains referenced and intact', () => { assert.match(source.confirmation, /startContinuousBalanceCount/); assert.match(source.continuous, /continuousBalanceMinorAtProgress/); });
add(32, 'account-capacity guard remains available', () => { assert.match(source.capture, /isAccountCapacityError/); assert.match(source.capacity, /inspectAccountCapacity[\s\S]*AccountCapacityError/); });
add(33, 'attachment regression suite remains present', () => assert.match(source.attachments, /attachment/i));
add(34, 'record-detail routing remains present', () => assert.match(source.activity, /activityDetailId|openRecordDetail/));
add(35, 'accepted note wording remains unchanged', () => { assert.match(source.copy, /note: '备注'/); assert.match(source.copy, /notePlaceholder: '点击输入备注'/); });

add(36, 'Light and Dark dock material tokens are available', () => { assert.match(source.css, /var\(--glass-sheet-bg\)/); assert.match(source.css, /:root\[data-theme="dark"\] \.sheet-action-dock-surface/); });
add(37, 'shared dock respects the bottom safe area', () => assert.match(source.css, /var\(--safe-bottom\)/));
add(38, 'Relationship scroll content reserves room above the dock', () => assert.match(source.css, /capture-relationship-sheet \.sheet-body[\s\S]*scroll-padding-bottom: calc\(148px \+ var\(--safe-bottom\)\)/));
add(39, 'FIX6 adds no page-level horizontal overflow construct', () => assert.doesNotMatch(source.css, /100vw|overflow-x:\s*visible|margin-inline:\s*-|left:\s*-/));
add(40, 'reduced motion disables dock transitions', () => { assert.match(source.css, /prefers-reduced-motion: reduce[\s\S]*sheet-action-dock button[\s\S]*transition: none/); assert.match(source.css, /data-reduced-motion="true"/); });
add(41, 'dock touch targets are at least 48px', () => assert.match(source.css, /sheet-action-dock \.sheet-primary,[\s\S]*min-height: 48px[\s\S]*height: 48px/));
add(42, 'secondary action remains visually lighter than the primary', () => { const html = relationshipDock(); assert.match(html, /sheet-action-dock-primary/); assert.match(html, /sheet-action-dock-secondary/); assert.match(source.css, /sheet-action-dock \.sheet-secondary[\s\S]*glass-accent-bg/); });
add(43, 'dock keeps rounded geometry on all sides', () => assert.match(source.css, /sheet-action-dock-surface[\s\S]*border-radius: calc\(var\(--r-card\) \+ 2px\)/));
add(44, 'dock material is translucent rather than a pure-white footer', () => { assert.match(source.css, /background: color-mix\(in srgb, var\(--glass-sheet-bg\) 82%, transparent\)/); assert.doesNotMatch(source.css, /background:\s*(?:#fff|#ffffff|white);/i); });
add(45, 'dock focus and pressed states are explicit', () => { assert.match(source.css, /button:active[\s\S]*scale/); assert.match(source.css, /button:focus-visible[\s\S]*outline/); });
add(46, 'invalid arithmetic preserves the committed allocation', () => { const draft = createInlineSplitDraft({ participantIds: ['a', 'b'], sharesMinor: { a: 500, b: 0 }, activeParticipantId: 'a' }); draft.expression = '5+'; assert.equal(switchInlineSplitParticipant(draft, 'b'), false); assert.equal(draft.shares.a, 500); });
add(47, 'safe arithmetic continues to commit integer minor units', () => { const draft = createInlineSplitDraft({ participantIds: ['a'], sharesMinor: { a: 0 }, activeParticipantId: 'a' }); draft.expression = '5+5'; assert.equal(commitInlineSplitExpression(draft), true); assert.equal(draft.shares.a, 1000); });
add(48, 'inline drawer feedback reuses the progress contract', () => assert.match(inlineSplitDrawerHTML({ totalMinor: 10000, participantIds: ['a', 'b'], sharesMinor: { a: 2500, b: 0 }, activeParticipantId: 'b' }), /已填写 1\/2 人 · 剩余 RM 75\.00/));
add(49, 'custom layout keeps six people in one two-column three-row group', () => { assert.match(source.capture, /function customSplitPagesHTML[\s\S]*index \+= 6[\s\S]*ids\.slice\(index, index \+ 6\)/); assert.match(source.css5, /relationship-split-page[\s\S]*grid-template-columns: repeat\(2/); });
add(50, 'average layout uses the same six-person grouping', () => assert.match(source.capture, /function equalSplitPagesHTML[\s\S]*index \+= 6[\s\S]*ids\.slice\(index, index \+ 6\)/));
add(51, 'groups beyond six stay on a free bidirectional rail without pager controls', () => { assert.match(source.css5, /relationship-split-pages[\s\S]*overflow-x: auto[\s\S]*scroll-snap-type: none/); assert.doesNotMatch(source.capture, /上一页|下一页|data-split-page-(?:next|previous)/); });
add(52, 'participant name is isolated from the hint so full names retain priority', () => assert.match(source.capture, /relationship-amount-name-line[\s\S]*relationship-amount-name[\s\S]*relationship-amount-value-line[\s\S]*custom-card-affordance/));
add(53, 'amount and affordance share a compact second line', () => assert.match(source.css, /relationship-amount-value-line[\s\S]*display: flex[\s\S]*justify-content: space-between/));
add(54, 'inline mode removes only the duplicate heading status while retaining live drawer feedback', () => { assert.match(source.css, /has-inline-split-drawer \.smart-split-heading > \.split-state \{ display: none; \}/); assert.match(source.split, /aria-live="polite"/); });
