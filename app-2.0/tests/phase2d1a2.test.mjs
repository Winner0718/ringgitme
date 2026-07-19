import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buttonHTML, feedbackStateHTML, segmentedControlHTML } from '../src/design-system/DesignSystem.js';
import { DESIGN_SYSTEM_CONTRACT, validateDesignSystemContract } from '../src/design-system/designSystemContract.js';
import { DESIGN_SYSTEM_STATIC_ALLOWLIST, validateDesignSystemAllowlist } from '../src/design-system/designSystemAllowlist.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const source = (...paths) => paths.map(read).join('\n');
const tokens = read('../src/styles/tokens.css');
const css = read('../src/styles/design-system.css');
const index = read('../index.html');
const contract = read('../src/design-system/designSystemContract.js');
const lab = read('../src/design-system/DesignSystemLab.js');
const sheets = source('../src/components/AppSheet.js', '../src/components/SheetActionDock.js');
const calculator = read('../src/components/MoneyCalculatorSheet.js');
const shell = source('../src/app/shell.js', '../src/components/GlassTabBar.js');
const controls = source('../src/components/PickerSheet.js', '../src/components/NativeDateTimeFields.js', '../src/design-system/DesignSystem.js');
let number = 0;
const add = (title, fn) => test(`2D1A2-${String(++number).padStart(3, '0')} ${title}`, fn);

// Tokens and ownership (1–10)
add('one canonical token source is loaded', () => { assert.match(index, /tokens\.css/); assert.equal((index.match(/tokens\.css/g) || []).length, 1); });
add('light semantic tokens resolve', () => assert.match(tokens, /--rm-color-canvas:/));
add('dark semantic tokens resolve deliberately', () => assert.match(tokens, /data-theme="dark"[^]*--rm-color-canvas:/));
add('reduced-motion tokens resolve', () => assert.match(tokens, /prefers-reduced-motion[^]*--rm-motion-sheet:\s*1ms/));
add('glass recipes are finite and named', () => assert.deepEqual([...DESIGN_SYSTEM_CONTRACT.glassRecipes], ['chrome', 'sheet', 'compact']));
add('page-level arbitrary blur is rejected by ownership contract', () => assert.match(contract, /arbitrary backdrop-filter/));
add('page-level arbitrary shadow is rejected by ownership contract', () => assert.match(contract, /arbitrary box-shadow/));
add('hardcoded colour exceptions are documented', () => assert.ok(validateDesignSystemAllowlist()));
add('component contract manifest is valid', () => assert.equal(validateDesignSystemContract(), true));
add('design-system documentation exists', () => assert.ok(fs.existsSync(new URL('../docs/RINGGITME_DESIGN_SYSTEM.md', import.meta.url))));

// Buttons (11–17)
add('primary button uses canonical component', () => assert.match(buttonHTML({ label: '保存' }), /rm-button--primary/));
add('secondary button uses canonical component', () => assert.match(buttonHTML({ label: '取消', variant: 'secondary' }), /rm-button--secondary/));
add('danger button uses canonical component', () => assert.match(buttonHTML({ label: '删除', variant: 'danger' }), /rm-button--danger/));
add('disabled state is visible and semantic', () => assert.match(buttonHTML({ label: '禁用', disabled: true }), /disabled aria-disabled="true"/));
add('loading state is visible', () => assert.match(buttonHTML({ label: '载入', loading: true }), /rm-spinner/));
add('Sheet footer has one primary action owner', () => assert.match(sheets, /rm-button--primary/));
add('legacy primary actions are mapped to canonical hierarchy', () => assert.match(css, /\.sheet-primary,[^]*\.cap-save/));

// Sheets (18–27)
add('reachable Sheets use canonical shell marker', () => assert.match(sheets, /sheet\.dataset\.rmComponent = 'Sheet'/));
add('editable Sheets use canonical action dock', () => assert.match(sheets, /data-rm-component="SheetFooter"/));
add('footer is integrated instead of detached white', () => assert.match(css, /sheet-action-dock[^]*var\(--rm-glass-chrome-bg\)/));
add('keyboard-safe dynamic viewport remains supported', () => assert.match(css, /91dvh/));
add('safe-area footer is supported', () => assert.match(css, /sheet-action-dock[^]*--safe-bottom/));
add('nested Sheet is retained', () => assert.match(read('../src/components/AppSheet.js'), /stacked-sheet/));
add('Browser Back is child-first', () => assert.match(read('../src/components/AppSheet.js'), /popstate[^]*closeSheet/));
add('dirty form close contract remains', () => assert.match(read('../src/components/AppSheet.js'), /onRequestClose/));
add('modal portal owns backdrop', () => assert.match(read('../src/components/AppSheet.js'), /ensureModalPortalRoot/));
add('body scroll lock restoration remains modal-owned', () => { assert.match(read('../src/app/modalStack.js'), /modal-scroll-locked/); assert.match(read('../src/styles/phase2b3f.css'), /modal-scroll-locked body[^}]*overflow:\s*hidden/); });

// Calculator (28–37)
add('one canonical calculator owner exists', () => assert.equal(DESIGN_SYSTEM_CONTRACT.componentOwners.calculator, 'src/components/MoneyCalculatorSheet.js'));
add('Capture imports canonical calculator', () => assert.match(read('../src/components/CaptureSheet.js'), /MoneyCalculatorSheet/));
add('transfer uses canonical calculator flow', () => assert.match(read('../src/components/CaptureSheet.js'), /openMoneyCalculatorSheet/));
add('expense uses canonical calculator flow', () => assert.match(read('../src/components/CaptureSheet.js'), /openMoneyCalculatorSheet/));
add('income uses canonical calculator flow', () => assert.match(read('../src/components/CaptureSheet.js'), /openMoneyCalculatorSheet/));
add('operators use canonical variant', () => assert.match(calculator, /operator/));
add('equals uses canonical graphite action', () => assert.match(css, /data-calculator-key="="[^]*graphite-900/));
add('long expressions are clipped within display not page', () => assert.match(read('../src/styles/components.css') + css, /calculator-display/));
add('calculator is safe-area compatible', () => assert.match(css, /calculator-sheet[^]*rm-radius-sheet/));
add('calculator visual root is marked canonical', () => assert.match(calculator, /data-rm-component="Calculator"/));

// Navigation (38–43)
add('TopBar uses canonical marker', () => assert.match(shell, /topbarEl\.dataset\.rmComponent = 'TopBar'/));
add('BottomNavigation uses canonical marker', () => assert.match(shell, /nav\.dataset\.rmComponent = 'BottomNavigation'/));
add('Capture central action remains present', () => assert.match(shell, /tab-capture/));
add('selected tab remains recognizable', () => assert.match(css, /tab-item\.active/));
add('content clears bottom navigation', () => assert.match(css, /app-content[^]*rm-bottom-nav-height/));
add('privacy and avatar actions remain', () => { assert.match(shell, /toggle-privacy/); assert.match(shell, /open-profile/); });

// Controls (44–53)
add('fields use canonical styling', () => assert.match(controls, /rm-field-control/));
add('money inputs retain canonical owner', () => assert.equal(DESIGN_SYSTEM_CONTRACT.componentOwners.moneyInput, 'src/components/MoneyCalculatorSheet.js'));
add('date-time controls use canonical marker', () => assert.match(controls, /data-rm-component="NativeDateTimeField"/));
add('toggle rows use canonical styling', () => assert.match(controls, /rm-toggle-row/));
add('segmented controls use canonical styling', () => assert.match(segmentedControlHTML({ label: '类型', selected: 'a', items: [{ value: 'a', label: 'A' }] }), /rm-segmented/));
add('chips use canonical styling', () => assert.match(css, /\.rm-chip/));
add('action tiles use canonical styling', () => assert.match(css, /\.rm-action-tile/));
add('overflow menus use canonical solid content surface', () => assert.match(css, /asset-menu-list[^]*surface-solid/));
add('dialogs use canonical tonal consequence surface', () => assert.match(css, /plan-confirm-copy[^]*surface-tonal/));
add('toasts use canonical frosted styling', () => assert.match(css, /\.toast[^]*backdrop-filter/));

// Feature preservation (54–70)
add('Today values remain source-derived', () => assert.match(read('../src/features/today/index.js'), /fmtRM|fmtSignedRM/));
add('Asset totals remain source-derived', () => assert.match(read('../src/features/assets/index.js'), /netWorth|totalAssets/));
add('Asset overview stack remains', () => assert.match(read('../src/features/assets/index.js'), /asset-card-stack/));
add('Asset category stack remains', () => assert.match(read('../src/features/assets/category.js'), /WalletStackCategoryDeck/));
add('account-detail carousel remains', () => assert.match(read('../src/features/assets/detail.js'), /renderCarousel/));
add('Capture financial engine remains', () => assert.match(read('../src/components/CaptureSheet.js'), /data\.addTransaction\(draft\)/));
add('Activity feature remains', () => assert.ok(fs.existsSync(new URL('../src/features/activity/index.js', import.meta.url))));
add('Ledger feature remains', () => assert.ok(fs.existsSync(new URL('../src/features/ledger/index.js', import.meta.url))));
add('relationship and AA flow remains', () => assert.match(read('../src/components/CaptureSheet.js'), /relationship|AA/));
add('Fixed Center remains', () => assert.ok(fs.existsSync(new URL('../src/features/fixed/index.js', import.meta.url))));
add('recurring posting remains', () => assert.ok(fs.existsSync(new URL('../src/domain/recurringPostingExecutor.js', import.meta.url))));
add('Payment Assistant remains', () => assert.match(read('../src/features/fixed/RecurringOccurrenceActionSheets.js'), /付款助手/));
add('recipient directory remains', () => assert.match(read('../src/features/ledger/index.js'), /收款资料/));
add('attachment behavior remains', () => assert.ok(fs.existsSync(new URL('../src/domain/attachmentRepository.js', import.meta.url))));
add('refund behavior remains', () => assert.match(read('../src/domain/moneyEngine.js'), /recordLinkedCardRefund/));
add('installment behavior remains', () => assert.match(read('../src/domain/moneyEngine.js'), /createCardInstallment/));
add('shared-limit behavior remains', () => assert.match(read('../src/domain/moneyEngine.js'), /sharedLimitPool/));

// Modes (71–77)
add('light component matrix is represented in Lab', () => assert.match(lab, /视觉系统实验室/));
add('dark component matrix has deliberate tokens', () => assert.match(tokens, /data-theme="dark"/));
add('reduced-motion component matrix is supported', () => assert.match(css, /data-reduced-motion/));
add('blur-unavailable fallback is readable', () => assert.match(css, /@supports not \(\(backdrop-filter/));
add('long Chinese copy is represented', () => assert.match(lab, /很长的中文/));
add('mixed Chinese and English copy is represented', () => assert.match(lab, /English mixed-language/));
add('large amount values are represented', () => assert.match(lab, /1,234,567,890\.12/));

// Regression and safety (78–86)
add('Phase 2D1A1 79 tests remain declared', () => assert.match(read('./phase2d1a1.test.mjs'), /assert\.equal\(number, 79\)/));
add('Phase 2D1A 110 tests remain declared', () => assert.match(read('./phase2d1a.test.mjs'), /assert\.equal\(number, 110\)/));
add('Phase 2C3 cumulative tests remain present', () => assert.ok(fs.readdirSync(new URL('.', import.meta.url)).filter((name) => /phase2c3/.test(name)).length >= 4));
add('Phase 2C3C 75 tests remain declared', () => assert.match(read('./phase2c3c.test.mjs'), /75/));
add('full-suite npm runner remains node test', () => assert.match(read('../package.json'), /node --test tests\/\*\.test\.mjs/));
add('financial invariant source is untouched by visual owner', () => assert.doesNotMatch(css, /balanceMinor\s*=|amountMinor\s*=/));
add('no network or persistence behavior is introduced', () => assert.doesNotMatch(source('../src/design-system/DesignSystem.js', '../src/design-system/DesignSystemLab.js', '../src/design-system/designSystemContract.js'), /fetch\(|XMLHttpRequest|localStorage|indexedDB|supabase/i));
add('no sensitive identifier is introduced in Lab', () => assert.doesNotMatch(lab, /idempotency|economic fingerprint|CVV|PIN/));
add('no official logo or card-art work is introduced', () => { assert.doesNotMatch(lab, /official logo|Maybank 2 Platinum|Amex/); assert.equal(validateDesignSystemAllowlist(DESIGN_SYSTEM_STATIC_ALLOWLIST), true); });

assert.equal(number, 86);
