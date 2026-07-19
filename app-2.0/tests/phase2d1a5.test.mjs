import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { APP_SHEET_CONTRACT_VERSION, DESIGN_SYSTEM_CONTRACT } from '../src/design-system/designSystemContract.js';
import { SHEET_DETENTS, resolveSheetDetent } from '../src/components/AppSheet.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const appSheet = read('../src/components/AppSheet.js');
const css = read('../src/styles/design-system.css');
const legacyCaptureCss = read('../src/styles/phase2b3d.css');
const state = read('../src/app/state.js');
const shell = read('../src/app/shell.js');
const main = read('../src/main.js');
const interaction = read('../src/design-system/DesignSystem.js');
const capture = read('../src/components/CaptureSheet.js');
const picker = read('../src/components/PickerSheet.js');
const calculator = read('../src/components/MoneyCalculatorSheet.js');
const datePicker = read('../src/components/DatePickerSheet.js');
const timePicker = read('../src/components/TimePickerSheet.js');
const attachmentField = read('../src/components/AttachmentField.js');
const modalStack = read('../src/app/modalStack.js');
const contractDoc = read('../docs/RINGGITME_APP_SHEET_CONTRACT.md');
const liquidContract = read('../docs/RINGGITME_LIQUID_CHROME_IOS_DESIGN_CONTRACT.md');
let number = 0;
const add = (title, fn) => test(`2D1A5-${String(++number).padStart(3, '0')} ${title}`, fn);

// Canonical detent ownership.
add('AppSheet contract version is Phase 2D1A.5', () => assert.equal(APP_SHEET_CONTRACT_VERSION, '2D1A.5-ios-bottom-sheet-detents'));
add('four canonical detents exist', () => assert.deepEqual([...SHEET_DETENTS], ['compact', 'medium', 'large', 'content']));
add('machine contract publishes the same detents', () => assert.deepEqual([...DESIGN_SYSTEM_CONTRACT.sheetDetents], [...SHEET_DETENTS]));
add('explicit compact detent resolves', () => assert.equal(resolveSheetDetent({ detent: 'compact' }), 'compact'));
add('explicit medium detent resolves', () => assert.equal(resolveSheetDetent({ detent: 'medium' }), 'medium'));
add('explicit large detent resolves', () => assert.equal(resolveSheetDetent({ detent: 'large' }), 'large'));
add('explicit content detent resolves', () => assert.equal(resolveSheetDetent({ detent: 'content' }), 'content'));
add('unsupported detent fails loudly', () => assert.throws(() => resolveSheetDetent({ detent: 'fullscreen' }), /Unsupported sheet detent/));
add('confirmation classes infer compact', () => assert.equal(resolveSheetDetent({ className: 'plan-confirm-sheet' }), 'compact'));
add('Chinese confirmation titles infer compact', () => assert.equal(resolveSheetDetent({ title: '归档账户' }), 'compact'));
add('profile classes infer medium', () => assert.equal(resolveSheetDetent({ className: 'profile-settings-sheet' }), 'medium'));
add('editor classes infer large', () => assert.equal(resolveSheetDetent({ className: 'plan-editor-sheet' }), 'large'));
add('unclassified short content uses content detent', () => assert.equal(resolveSheetDetent({ className: 'plain-sheet' }), 'content'));
add('surface and layer both receive detent metadata', () => assert.match(appSheet, /sheet\.dataset\.sheetDetent = resolvedDetent;[^]*layer\.dataset\.sheetDetent = resolvedDetent/));
add('stack snapshot exposes detent and dismissal policy', () => assert.match(appSheet, /detent,\s*dismissOnBackdrop,\s*dismissOnEscape,\s*dismissOnDrag/));

// iOS geometry, safe area and scrolling.
add('modal layer is sized by VisualViewport variables', () => assert.match(css, /--rm-sheet-viewport-top[^]*--rm-sheet-viewport-height/));
add('VisualViewport resize and scroll are observed', () => { assert.match(appSheet, /viewport\?\.addEventListener\('resize'/); assert.match(appSheet, /viewport\?\.addEventListener\('scroll'/); });
add('VisualViewport listeners are removed on close', () => { assert.match(appSheet, /removeEventListener\('resize', sync\)/); assert.match(appSheet, /removeEventListener\('scroll', sync\)/); });
add('canonical surfaces are bottom anchored', () => assert.match(css, /top:auto!important;\s*bottom:0!important/));
add('compact detent is bounded', () => assert.match(css, /sheet\[data-sheet-detent="compact"\][^}]*48%[^}]*420px/));
add('medium detent is bounded', () => assert.match(css, /sheet\[data-sheet-detent="medium"\][^}]*64%[^}]*620px/));
add('large detent is bounded', () => assert.match(css, /sheet\[data-sheet-detent="large"\][^}]*92%[^}]*840px/));
add('content detent retains natural height', () => assert.match(css, /sheet\[data-sheet-detent="content"\][^}]*height:auto/));
add('keyboard-open geometry remains bottom anchored and usable', () => assert.match(css, /data-keyboard-open="true"[^}]*height:calc\(100% - 6px\)/));
add('Sheet body remains the internal scroll owner', () => assert.match(css, /\.sheet-body \{[^}]*overflow:auto[^}]*overscroll-behavior:contain/));
add('action dock remains sticky', () => assert.match(css, /\.sheet-action-dock,[^]*position:sticky/));
add('action dock retains bottom safe area', () => assert.match(css, /sheet-action-dock[^]*var\(--safe-bottom\)/));
add('short-screen Capture no longer attaches to the top', () => assert.doesNotMatch(legacyCaptureCss, /\.capture-sheet\s*\{\s*top:\s*4px/));
add('Capture explicitly requests the large detent', () => assert.match(capture, /className: 'capture-sheet',[^]*detent: 'large'/));
add('Capture action footer stays inside the viewport', () => assert.match(css, /\.capture-sheet \.cap-save-wrap \{[^}]*bottom:0[^}]*margin:12px -18px 0/));

// Dismissal, nesting and focus.
add('backdrop dismissal has an explicit policy', () => assert.match(appSheet, /dismissOnBackdrop = true/));
add('Escape dismissal has an explicit policy', () => assert.match(appSheet, /dismissOnEscape = true/));
add('drag dismissal has an explicit policy', () => assert.match(appSheet, /dismissOnDrag = true/));
add('backdrop obeys the top entry policy', () => assert.match(appSheet, /entry\.dismissOnBackdrop && sheets\.at\(-1\) === entry/));
add('Escape obeys the top entry policy', () => assert.match(appSheet, /!entry\.dismissOnEscape \|\| !isTopModal/));
add('drag begins only when policy permits', () => assert.match(appSheet, /!entry\.dismissOnDrag \|\| sheets\.at\(-1\) !== entry/));
add('Browser Back closes only the top Sheet', () => assert.match(appSheet, /sheetPopstateHandler[^]*closeSheet\(false, \{ fromHistory: true \}\)/));
add('dirty close guard runs before stack mutation', () => assert.match(appSheet, /onRequestClose\?\.\(\) === false[^]*sheets\.pop\(\)/));
add('modal stack restores the trigger focus', () => assert.match(modalStack, /trigger[^]*focus\?\.\(\{ preventScroll: true \}\)/));
add('modal stack preserves one body lock owner', () => assert.match(modalStack, /modal-scroll-locked/));

// Specialized sheet adoption.
add('generic picker declares the medium detent', () => assert.match(picker, /data-sheet-detent="medium"/));
add('money calculator declares the medium detent', () => assert.match(calculator, /data-sheet-detent="medium"/));
add('date picker declares the medium detent', () => assert.match(datePicker, /data-sheet-detent="medium"/));
add('time picker declares the medium detent', () => assert.match(timePicker, /data-sheet-detent="medium"/));
add('all specialized Sheets share VisualViewport synchronization', () => [picker, calculator, datePicker, timePicker].forEach((text) => assert.match(text, /attachSheetVisualViewport/)));
add('attachment manager and gallery adopt canonical detents and VisualViewport synchronization', () => {
  assert.match(attachmentField, /attachment-manager-layer[^]*sheetDetent = 'content'/);
  assert.match(attachmentField, /attachment-gallery-layer modal-layer[^]*sheetDetent = 'large'/);
  assert.match(attachmentField, /attachSheetVisualViewport/);
});

// Profile and chrome motion preference.
add('profile is explicitly a medium Sheet', () => assert.match(shell, /className: 'profile-settings-sheet',[^]*detent: 'medium'/));
add('profile exposes the exact chrome motion label', () => assert.match(shell, />镀铬动效</));
add('profile exposes the exact chrome motion caption', () => assert.match(shell, /控制边框反射与流动高光/));
add('chrome motion defaults enabled in session UI state', () => assert.match(state, /chromeMotion:\s*true/));
add('canonical preference root attribute is applied', () => assert.match(state, /root\.dataset\.chromeMotion = effective/));
add('preference and effective state remain separate', () => assert.match(state, /chromeMotionPreference = preference[^]*chromeMotion = effective/));
add('reduced motion affects effective state without overwriting preference', () => {
  assert.match(state, /ui\.chromeMotion = enabled !== false/);
  assert.match(state, /const effective = ui\.chromeMotion && !reducedMotionIsActive\(\)/);
  assert.match(state, /const sync = \(\) => applyChromeMotion\(ui\.chromeMotion\)/);
});
add('main initializes the preference at boot', () => assert.match(main, /applyChromeMotion\([^]*watchSystemMotion\(\)/));
add('theme changes keep the profile Sheet open', () => { const block = shell.match(/registerAction\('set-theme'[^]*?\n  \}\);/)?.[0] || ''; assert.doesNotMatch(block, /closeSheet/); });
add('motion changes keep the profile Sheet open', () => { const block = shell.match(/registerAction\('toggle-chrome-motion'[^]*?\n  \}\);/)?.[0] || ''; assert.doesNotMatch(block, /closeSheet/); });
add('reset confirmation is a nested compact Sheet', () => assert.match(shell, /profile-reset-confirm-sheet[^]*detent: 'compact'[^]*stacked: true/));
add('motion off removes ambient and interaction layers', () => assert.match(css, /data-chrome-motion="off"[^]*rm-edge-sweep::after[^]*sheet\.open::after[^]*content:none!important/));
add('motion off does not remove the static chrome perimeter', () => { const offBlock = css.match(/:root\[data-chrome-motion="off"\][^]*?content:none!important;\s*\}/)?.[0] || ''; assert.doesNotMatch(offBlock, /::before/); });
add('interaction helper exits when effective motion is off', () => assert.match(interaction, /dataset\.chromeMotion !== 'on'/));
add('motion preference uses no persistence or network API', () => assert.doesNotMatch(`${state}\n${shell}\n${main}`, /localStorage|indexedDB|fetch\(|XMLHttpRequest|supabase/i));
add('AppSheet contract documents all detents', () => ['compact', 'medium', 'large', 'content'].forEach((detent) => assert.match(contractDoc, new RegExp(`\\b${detent}\\b`))));
add('Liquid Chrome contract documents the exact setting copy', () => assert.match(liquidContract, /镀铬动效[^]*控制边框反射与流动高光/));
add('visual changes do not import the financial engine', () => assert.doesNotMatch(`${appSheet}\n${shell}\n${css}`, /moneyEngine|recurringPostingExecutor|accountRepository/));

assert.equal(number, 64);
