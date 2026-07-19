import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buttonHTML, actionTileHTML } from '../src/design-system/DesignSystem.js';
import { DESIGN_SYSTEM_CONTRACT, DESIGN_SYSTEM_VERSION } from '../src/design-system/designSystemContract.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const source = (...paths) => paths.map(read).join('\n');
const tokens = read('../src/styles/tokens.css');
const css = read('../src/styles/design-system.css');
const index = read('../index.html');
const lab = read('../src/design-system/DesignSystemLab.js');
const shell = source('../src/app/shell.js', '../src/components/GlassTabBar.js');
const sheets = source('../src/components/AppSheet.js', '../src/components/SheetActionDock.js');
const capture = read('../src/components/CaptureSheet.js');
const contractDoc = read('../docs/RINGGITME_LIQUID_CHROME_IOS_DESIGN_CONTRACT.md');
let number = 0;
const add = (title, fn) => test(`2D1A3-${String(++number).padStart(3, '0')} ${title}`, fn);

// Identity, token ownership and decorative-teal removal (1–18)
add('Liquid Chrome version is canonical', () => assert.equal(DESIGN_SYSTEM_VERSION, '2D1A.3-liquid-chrome-ios'));
add('one token source remains loaded', () => assert.equal((index.match(/tokens\.css/g) || []).length, 1));
add('one authoritative component stylesheet remains last', () => assert.match(index, /phase2d1a\.css[^]*design-system\.css/));
add('interaction token is graphite', () => assert.match(tokens, /--rm-color-interactive:\s*var\(--graphite-900\)/));
add('legacy jade primary resolves to neutral interaction', () => assert.match(tokens, /--rm-color-jade-primary:\s*var\(--rm-color-interactive\)/));
add('compatibility accent resolves to neutral interaction', () => assert.match(tokens, /--accent:\s*var\(--rm-color-interactive\)/));
add('financial success remains a distinct semantic token', () => assert.match(tokens, /--rm-color-success:\s*var\(--sem-green\)/));
add('light canvas is pearl ice and not mint', () => assert.match(tokens, /--rm-color-canvas:\s*#f1f4f7/i));
add('dark canvas is smoked charcoal', () => assert.match(tokens, /data-theme="dark"[^]*--rm-color-canvas:\s*#101216/i));
add('app atmosphere contains no decorative jade radial', () => assert.doesNotMatch(css.match(/body\s*\{[^}]+\}/)?.[0] || '', /jade|green|emerald/i));
add('primary action is graphite not green', () => { const block = css.match(/\.rm-button--primary,[^}]+/)?.[0] || ''; assert.match(block, /#171a1f|graphite/); assert.doesNotMatch(block, /sem-green/); });
add('selected tab uses primary text not green', () => assert.match(css, /\.tab-item\.active\s*\{\s*color:var\(--rm-color-text-primary\)/));
add('Capture control is neutral liquid glass', () => { const block = css.match(/\.tab-capture,\.rm-lab-capture\s*\{[^}]+/)?.[0] || ''; assert.match(block, /radial-gradient/); assert.doesNotMatch(block, /sem-green|jade-6|#0a8a54/); });
add('calculator equals is graphite', () => assert.match(css, /capture-calculator-key\.equals[^}]*graphite-950/));
add('calculator operators are silver neutral', () => assert.match(css, /capture-calculator-key\.operator[^}]*151,160,172/));
add('toggle active track is graphite', () => assert.match(css, /input:checked \+ \.rm-switch[^}]*#4b525c/));
add('new favicon is graphite chrome', () => { assert.match(index, /%23474d56/); assert.doesNotMatch(index, /%230a8a54/); });
add('action tiles default to neutral tone', () => assert.match(actionTileHTML({ title: '处理' }), /rm-action-tile--neutral/));

// Material, chrome edge, motion and Safari fallback (19–34)
add('three finite glass recipes remain', () => assert.deepEqual([...DESIGN_SYSTEM_CONTRACT.glassRecipes], ['chrome', 'sheet', 'compact']));
add('chrome blur is named and finite', () => assert.match(tokens, /--rm-glass-chrome-blur:\s*24px/));
add('sheet blur is named and finite', () => assert.match(tokens, /--rm-glass-sheet-blur:\s*20px/));
add('compact blur is named and finite', () => assert.match(tokens, /--rm-glass-compact-blur:\s*14px/));
add('chrome perimeter token exists', () => assert.match(tokens, /--rm-chrome-border:/));
add('inner highlight token exists', () => assert.match(tokens, /--rm-chrome-highlight:/));
add('lower bevel token exists', () => assert.match(tokens, /--rm-chrome-lowlight:/));
add('chrome owner has luminous inner edge', () => assert.match(css, /rm-glass-chrome[^]*inset 0 1px 0 var\(--rm-chrome-highlight\)/));
add('priority edge keeps the canonical chrome perimeter token', () => assert.match(css, /rm-chrome-priority::before[^]*background:var\(--rm-chrome-perimeter\)/));
add('iOS Safari edge uses webkit mask', () => assert.match(css, /-webkit-mask-composite:xor/));
add('mask unsupported fallback is static', () => assert.match(css, /@supports not \(\(-webkit-mask-composite:xor\)[^]*animation:none/));
add('ambient orbit is visible and tokenized', () => assert.match(tokens, /--rm-motion-edge-orbit:\s*6\.4s/));
add('interaction sweep is tokenized', () => assert.match(tokens, /--rm-motion-edge-sweep:\s*720ms/));
add('reduced motion stops chrome orbit', () => assert.match(css, /prefers-reduced-motion:reduce[^]*rm-chrome-priority::before[^]*animation:none/));
add('explicit reduced-motion state stops chrome orbit', () => assert.match(css, /data-reduced-motion="true"[^]*rm-chrome-priority::before[^]*animation:none/));
add('blur unavailable fallback stays readable', () => assert.match(css, /@supports not \(\(backdrop-filter:blur\(1px\)\)[^]*surface-frosted-strong/));
add('explicit reduced-transparency fallback stays readable', () => assert.match(css, /data-blur-fallback="true"[^]*surface-frosted-strong/));

// Typography, icons, controls and component contract (35–48)
add('native system font starts with apple system', () => assert.match(tokens, /--font-ui:\s*-apple-system/));
add('SF Pro names are fallback-only', () => assert.match(tokens, /BlinkMacSystemFont, "SF Pro Display", "SF Pro Text"/));
add('PingFang SC remains present', () => assert.match(tokens, /PingFang SC/));
add('tabular numerals apply globally', () => assert.match(css, /body \{[^}]*font-variant-numeric:\s*tabular-nums/));
add('primary helper carries chrome priority class', () => assert.match(buttonHTML({ label: '保存' }), /rm-chrome-priority/));
add('secondary helper does not become primary', () => assert.doesNotMatch(buttonHTML({ label: '取消', variant: 'secondary' }), /rm-chrome-priority/));
add('Sheet dock primary carries chrome priority', () => assert.match(sheets, /sheet-primary[^\"]*rm-chrome-priority/));
add('top controls have minimum 44px targets', () => assert.match(css, /topbar-btn[^}]*min-width:44px;min-height:44px/));
add('primary action has white text', () => assert.match(css, /rm-button--primary[^}]*color:#fff/));
add('secondary action uses bright glass', () => assert.match(css, /rm-button--secondary[^]*rm-glass-compact-bg/));
add('danger defaults to red text on neutral material', () => assert.match(css, /rm-button--danger[^}]*color:var\(--rm-color-danger\)/));
add('input focus uses neutral interactive token', () => assert.match(css, /rm-field-control:focus-visible[^}]*rm-color-interactive/));
add('selected chips use neutral luminous glass', () => assert.match(css, /rm-chip\.is-selected[^}]*215,221,228/));
add('icon wells use neutral text', () => assert.match(css, /rm-action-tile-icon[^}]*rm-color-text-primary/));

// Full-app ownership and accepted behavior (49–62)
add('TopBar remains canonical', () => assert.match(shell, /dataset\.rmComponent = 'TopBar'/));
add('BottomNavigation remains canonical', () => assert.match(shell, /dataset\.rmComponent = 'BottomNavigation'/));
add('Capture still uses one calculator engine', () => assert.match(capture, /openMoneyCalculatorSheet/));
add('Capture inline calculator uses neutral canonical style', () => assert.match(css, /capture-calculator-key\.equals/));
add('Sheet remains one modal owner', () => assert.match(read('../src/components/AppSheet.js'), /dataset\.rmComponent = 'Sheet'/));
add('Sheet retains child-first Back behavior', () => assert.match(read('../src/components/AppSheet.js'), /popstate[^]*closeSheet/));
add('asset overview stack remains', () => assert.match(read('../src/features/assets/index.js'), /asset-card-stack/));
add('asset category stack remains', () => assert.match(read('../src/features/assets/category.js'), /WalletStackCategoryDeck/));
add('account detail carousel remains', () => assert.match(read('../src/features/assets/detail.js'), /renderCarousel/));
add('branded card art remains referenced', () => assert.match(read('../src/fixtures/demoData.js'), /assets\/cards\/maybank/));
add('recurring posting executor remains', () => assert.ok(fs.existsSync(new URL('../src/domain/recurringPostingExecutor.js', import.meta.url))));
add('payment routing remains source-owned', () => assert.match(read('../src/domain/paymentHandoff.js'), /resolveSourceAccountAppCapability/));
add('attachments remain canonical', () => assert.ok(fs.existsSync(new URL('../src/domain/attachmentRepository.js', import.meta.url))));
add('financial engine contains no design-system dependency', () => assert.doesNotMatch(read('../src/domain/moneyEngine.js'), /design-system|Liquid Chrome/i));

// Lab, documentation and static guardrail (63–70)
add('Design System Lab renders the Liquid Chrome identity', () => assert.match(lab, /RINGGITME LIQUID CHROME iOS/));
add('Lab uses real canonical components', () => assert.match(lab, /buttonHTML|segmentedControlHTML|surfaceHTML/));
add('new permanent contract exists', () => assert.ok(fs.existsSync(new URL('../docs/RINGGITME_LIQUID_CHROME_IOS_DESIGN_CONTRACT.md', import.meta.url))));
add('contract prohibits decorative teal', () => assert.match(contractDoc, /Decorative teal\/green is not part/));
add('contract preserves semantic green', () => assert.match(contractDoc, /Green is allowed only for financial or status meaning/));
add('contract prohibits one-off button systems', () => assert.match(contractDoc, /Do not create page-specific button systems/));
add('contract documents Safari mask fallback', () => assert.match(contractDoc, /iOS Safari/));
add('visual owner introduces no networking or persistence', () => assert.doesNotMatch(source('../src/design-system/DesignSystem.js','../src/design-system/DesignSystemLab.js','../src/design-system/designSystemContract.js'), /fetch\(|XMLHttpRequest|localStorage|indexedDB|supabase/i));

assert.equal(number, 71);
