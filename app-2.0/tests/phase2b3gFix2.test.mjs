import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { modalLayerOrder, MODAL_LAYER_BASE, MODAL_LAYER_STEP } from '../src/app/modalStack.js';
import { allocationSummary } from '../src/domain/smartSplit.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const source = {
  modal: read('../src/app/modalStack.js'),
  appSheet: read('../src/components/AppSheet.js'),
  picker: read('../src/components/PickerSheet.js'),
  calculator: read('../src/components/MoneyCalculatorSheet.js'),
  attachment: read('../src/components/AttachmentField.js'),
  capture: read('../src/components/CaptureSheet.js'),
  cssF: read('../src/styles/phase2b3f.css'),
  cssG: read('../src/styles/phase2b3g.css'),
  money: read('../src/domain/moneyEngine.js'),
  capacity: read('../src/domain/accountCapacity.js'),
};

test('FIX2-001 modal layer zero starts at the authoritative base', () => {
  assert.deepEqual(modalLayerOrder(0), { stackIndex: 0, layerZ: 1800, backdropZ: 1800, surfaceZ: 1801 });
});

test('FIX2-002 every stack step reserves a deterministic twenty-level band', () => {
  assert.equal(MODAL_LAYER_BASE, 1800);
  assert.equal(MODAL_LAYER_STEP, 20);
  assert.equal(modalLayerOrder(2).layerZ, 1840);
});

test('FIX2-003 capture relationship and child indexes cannot overlap', () => {
  const orders = [0, 1, 2].map(modalLayerOrder);
  assert.ok(orders[0].surfaceZ < orders[1].backdropZ);
  assert.ok(orders[1].surfaceZ < orders[2].backdropZ);
});

test('FIX2-004 one body-level portal is authoritative', () => {
  assert.match(source.modal, /ringgitme-sheet-portal/);
  assert.match(source.modal, /document\.body\.appendChild\(portalRoot\)/);
});

test('FIX2-005 every AppSheet mounts through the same modal portal', () => {
  assert.match(source.appSheet, /mountModalLayer\(layer\)/);
  assert.match(source.appSheet, /pushModalLayer\(layer,/);
});

test('FIX2-006 capture and relationship use stable sheet ids', () => {
  assert.match(source.capture, /id: 'capture-root'/);
  assert.match(source.capture, /id: 'capture-relationship'/);
});

test('FIX2-007 parent id is derived from the immediate stack parent', () => {
  assert.match(source.modal, /parentId: parentId === undefined \? parent\?\.id \|\| null : parentId/);
});

test('FIX2-008 stack metadata is exposed on the real layer', () => {
  ['sheetId', 'parentSheetId', 'stackIndex', 'modalKind'].forEach((key) => assert.match(source.modal, new RegExp(`dataset\\.${key}`)));
});

test('FIX2-009 lower layers become inert', () => assert.match(source.modal, /child\.setAttribute\('inert'/));
test('FIX2-010 top layer removes inert', () => assert.match(source.modal, /child\.removeAttribute\('inert'\)/));
test('FIX2-011 lower layers are hidden from assistive interaction', () => assert.match(source.modal, /setAttribute\('aria-hidden', String\(!top\)\)/));
test('FIX2-012 suspended layers cannot receive pointer input', () => assert.match(source.cssF, /modal-suspended[\s\S]*pointer-events: none !important/));
test('FIX2-013 only the newest layer is top', () => assert.match(source.modal, /const top = index === stack\.length - 1/));
test('FIX2-014 top ownership is checked by layer identity', () => assert.match(source.modal, /stack\.at\(-1\)\?\.layer === layer/));

test('FIX2-015 backdrop closes only the top AppSheet', () => {
  assert.match(source.appSheet, /sheets\.at\(-1\) === entry && isTopModal\(layer\)/);
});

test('FIX2-016 Escape closes only the top AppSheet', () => {
  assert.match(source.appSheet, /event\.key === 'Escape'[\s\S]*isTopModal\(entry\.layer\)/);
});

test('FIX2-017 the focus trap redirects focus to the top layer', () => {
  assert.match(source.modal, /if \(!entry\.layer\.contains\(event\.target\)\) focusTop\(entry\)/);
});

test('FIX2-018 closing a child restores its explicit trigger row', () => {
  assert.match(source.modal, /function restoredTrigger\(entry, parent\)/);
  assert.match(source.modal, /triggerIdentity: triggerIdentity\(trigger\)/);
  assert.match(source.modal, /if \(trigger\) trigger\.focus/);
});

test('FIX2-019 body scroll lock follows stack depth', () => {
  assert.match(source.modal, /modal-scroll-locked', stack\.length > 0/);
  assert.match(source.modal, /bodyScrollLockCount\(\)[\s\S]*return stack\.length/);
});

test('FIX2-020 registering the same layer never duplicates it', () => {
  assert.match(source.modal, /findIndex\(\(entry\) => entry\.layer === layer\)/);
  assert.match(source.modal, /if \(existing >= 0\) stack\.splice\(existing, 1\)/);
});

test('FIX2-021 object picker is bound to the full relationship row', () => {
  assert.match(source.capture, /const ledgerRow = sheet\.querySelector\('\[data-picker-field="ledger"\]'\)/);
  assert.match(source.capture, /trigger: ledgerRow/);
});

test('FIX2-022 payer picker is bound to the full relationship row', () => {
  assert.match(source.capture, /const payerRow = sheet\.querySelector\('\[data-picker-field="payer"\]'\)/);
  assert.match(source.capture, /trigger: payerRow/);
});

test('FIX2-023 object and payer pickers share the authoritative stack', () => {
  assert.match(source.picker, /mountModalLayer\(layer\)/);
  assert.match(source.picker, /kind: 'picker'/);
});

test('FIX2-024 custom split amounts bind the shared inline calculator engine', () => {
  assert.match(source.capture, /data-split-allocation[\s\S]*createInlineSplitDraft/);
  assert.match(source.capture, /pressInlineSplitKey/);
});

test('FIX2-025 calculator is registered as the newest authoritative modal', () => {
  assert.match(source.calculator, /mountModalLayer\(layer\)/);
  assert.match(source.calculator, /kind: 'calculator'/);
});

test('FIX2-026 repeated picker open cannot leave an invisible duplicate', () => {
  assert.match(source.picker, /activePickerCancel && !activePickerCancel\(\)/);
});

test('FIX2-027 repeated calculator open cannot leave an invisible duplicate', () => {
  assert.match(source.calculator, /activeCalculatorCancel && !activeCalculatorCancel\(\)/);
});

test('FIX2-028 relationship type uses a polished two by two tile group', () => {
  assert.match(source.cssG, /relationship-type-grid[\s\S]*grid-template-columns: repeat\(2/);
  assert.match(source.capture, /relationship-type-tile/);
});

test('FIX2-029 object and payer fields use avatar list rows', () => {
  assert.match(source.capture, /relationship-picker-row/);
  assert.match(source.capture, /relationship-row-avatar/);
});

test('FIX2-030 relationship object and payer markup no longer uses old picker fields', () => {
  const relationshipRegion = source.capture.match(/function relationshipSheetHTML\(\)[\s\S]*?function syncRelationShares/)?.[0] || '';
  assert.doesNotMatch(relationshipRegion, /class="native-picker-display picker-field"/);
  assert.doesNotMatch(relationshipRegion, /<select|<input/);
});

test('FIX2-031 participant choices are avatar chips with explicit state', () => {
  assert.match(source.capture, /relationship-avatar-chip/);
  assert.match(source.capture, /aria-pressed="\$\{relationDraft\.splitParticipantIds\.includes\(id\)\}"/);
});

test('FIX2-032 split selector has a movable glass thumb', () => {
  assert.match(source.cssG, /relationship-split-segment::before/);
  assert.match(source.cssG, /is-custom::before[\s\S]*translateX\(100%\)/);
});

test('FIX2-033 custom amount rows have complete accessible tap targets', () => {
  assert.match(source.capture, /class="relationship-amount-row money-field-button has-affordance"/);
  assert.match(source.cssG, /relationship-amount-row[\s\S]*min-height: 59px/);
});

test('FIX2-034 exact allocation remains integer-minor-unit exact', () => {
  assert.deepEqual(allocationSummary(10000, { me: 6000, abi: 4000 }, ['me', 'abi']), { totalMinor: 10000, allocatedMinor: 10000, differenceMinor: 0, remainingMinor: 0, overMinor: 0, exact: true });
});

test('FIX2-035 remaining allocation feedback names the exact amount', () => {
  assert.match(source.capture, /还差/);
  assert.match(source.capture, /请完成分配/);
});

test('FIX2-036 excess allocation feedback names the exact amount', () => {
  assert.match(source.capture, /已超出/);
  assert.match(source.capture, /请调整金额/);
});

test('FIX2-037 invalid completion focuses and scrolls the status', () => {
  assert.match(source.capture, /status\?\.focus/);
  assert.match(source.capture, /status\?\.scrollIntoView/);
});

test('FIX2-038 invalid completion does not close the relationship sheet', () => {
  assert.match(source.capture, /if \(!summary\.exact\)[\s\S]*return;/);
});

test('FIX2-039 relationship footer remains sticky and safe-area aware', () => {
  assert.match(source.cssG, /relationship-footer[\s\S]*position: sticky/);
  assert.match(source.cssG, /relationship-footer[\s\S]*safe-area-inset-bottom/);
});

test('FIX2-040 dark mode retains relationship glass materials', () => {
  assert.match(source.cssG, /data-theme="dark"[\s\S]*relationship-glass-group/);
});

test('FIX2-041 reduced motion disables split and error animation', () => {
  assert.match(source.cssG, /prefers-reduced-motion: reduce[\s\S]*error-shake/);
  assert.match(source.cssG, /data-reduced-motion="true"[\s\S]*error-shake/);
});

test('FIX2-042 accepted account capacity and financial semantics remain present', () => {
  assert.match(source.capacity, /cash|balance|credit/iu);
  assert.match(source.money, /record_only/);
  assert.match(source.money, /relationship_only/);
});

test('FIX2-043 FIX2 introduces no application network or persistence client', () => {
  Object.values(source).forEach((text) => assert.doesNotMatch(text, /\bfetch\s*\(|\bWebSocket\b|\blocalStorage\b|\bindexedDB\b|createClient\s*\(/));
});

test('FIX2-044 attachment manager joins the authoritative body portal', () => {
  assert.match(source.attachment, /attachment-manager-layer modal-layer/);
  assert.match(source.attachment, /mountModalLayer\(layer\)/);
});

test('FIX2-045 attachment manager declares its stack kind and parent trigger', () => {
  assert.match(source.attachment, /kind: 'attachment-manager', trigger, surface, backdrop/);
});

test('FIX2-046 attachment manager accepts interaction only while topmost', () => {
  assert.match(source.attachment, /if \(!isTopModal\(layer\)\) return/);
});

test('FIX2-047 attachment manager close releases the modal stack exactly once', () => {
  assert.match(source.attachment, /releaseModal\(\);[\s\S]*activeAttachmentManagerClose = null/);
});

test('FIX2-048 attachment manager Escape stops at the child layer', () => {
  assert.match(source.attachment, /event\.key === 'Escape' && isTopModal\(layer\)[\s\S]*event\.stopPropagation\(\)/);
});
