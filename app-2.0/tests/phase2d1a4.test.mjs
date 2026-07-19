import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DESIGN_SYSTEM_CONTRACT, LIQUID_CHROME_MATERIAL_VERSION } from '../src/design-system/designSystemContract.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const source = (...paths) => paths.map(read).join('\n');
const tokens = read('../src/styles/tokens.css');
const css = read('../src/styles/design-system.css');
const glass = read('../src/styles/glass.css');
const assetCss = read('../src/styles/phase2d1a.css');
const lab = read('../src/design-system/DesignSystemLab.js');
const interaction = read('../src/design-system/DesignSystem.js');
const shell = read('../src/app/shell.js');
const sheet = read('../src/components/AppSheet.js');
const contract = read('../docs/RINGGITME_LIQUID_CHROME_IOS_DESIGN_CONTRACT.md');
let number = 0;
const add = (title, fn) => test(`2D1A4-${String(++number).padStart(3, '0')} ${title}`, fn);

// Material ownership and fidelity.
add('material version is Phase 2D1A.4', () => assert.equal(LIQUID_CHROME_MATERIAL_VERSION, '2D1A.4-liquid-chrome-glass'));
add('five finite material roles are declared', () => assert.deepEqual([...DESIGN_SYSTEM_CONTRACT.liquidChromeRecipes], ['canvas', 'floating', 'content', 'control', 'overlay']));
add('canonical material owner is design-system.css', () => assert.equal(DESIGN_SYSTEM_CONTRACT.componentStyleSource, 'src/styles/design-system.css'));
add('canvas uses multiple static spatial gradients', () => assert.ok((css.match(/radial-gradient/g) || []).length >= 4));
add('canvas contains no green atmosphere', () => assert.doesNotMatch(css.match(/body\s*\{[^}]+\}/)?.[0] || '', /green|jade|mint/i));
add('floating glass uses translucent canonical fill', () => assert.match(css, /rm-glass-chrome[^}]*rm-glass-chrome-bg/));
add('content glass uses named translucent fill', () => assert.match(css, /surface[^}]*rm-glass-content-bg/));
add('overlay glass uses named sheet fill', () => assert.match(css, /glass-sheet[^}]*rm-glass-sheet-bg/));
add('content blur is canonical and finite', () => assert.match(tokens, /--rm-glass-content-blur:\s*20px/));
add('floating blur remains finite', () => assert.match(tokens, /--rm-glass-chrome-blur:\s*24px/));
add('sheet blur remains finite', () => assert.match(tokens, /--rm-glass-sheet-blur:\s*20px/));
add('compact blur remains finite', () => assert.match(tokens, /--rm-glass-compact-blur:\s*14px/));
add('main material avoids opaque 0.84 to 0.98 white fills', () => assert.doesNotMatch(tokens.match(/--rm-glass-(?:chrome|sheet|content)-bg:[^;]+;/g)?.join('\n') || '', /rgba\(255,255,255,\.(?:8[4-9]|9\d)\)/));
add('legacy glass maps to canonical recipes', () => assert.match(glass, /Liquid Chrome compatibility aliases/));
add('legacy surface maps to content glass', () => assert.match(glass, /\.surface\s*\{[^}]*rm-glass-content-bg/));

// Mirror chrome construction and motion.
add('perimeter is a continuous silver gradient token', () => assert.match(tokens, /--rm-chrome-perimeter:\s*linear-gradient\(180deg/));
add('hero perimeter has a separate continuous recipe', () => assert.match(tokens, /--rm-chrome-perimeter-hero:\s*linear-gradient\(180deg/));
add('moving layer is a complete multi-reflection chrome perimeter', () => {
  assert.match(tokens, /--rm-chrome-flowing-stops:/);
  assert.match(css, /background:conic-gradient\(from var\(--rm-chrome-flow-angle\),var\(--rm-chrome-flowing-stops\)\)/);
  assert.ok((tokens.match(/rgba\(/g) || []).length > 10);
  assert.doesNotMatch(css, /width:var\(--rm-edge-glint-length/);
});
add('static edge is masked to the border area', () => assert.match(css, /Static mirror perimeter[^]*-webkit-mask-composite:xor/));
add('static chrome rim never rotates', () => assert.match(css, /Static mirror perimeter[^]*animation:none;[^]*transform:none;/));
add('static chrome perimeter stays continuous without black bald gaps', () => {
  const lightPerimeter = tokens.match(/--rm-chrome-perimeter:\s*linear-gradient\([^;]+/)?.[0] || '';
  const darkPerimeter = [...tokens.matchAll(/--rm-chrome-perimeter:\s*linear-gradient\([^;]+/g)].at(-1)?.[0] || '';
  assert.doesNotMatch(lightPerimeter, /rgba\((?:0|2\d|3\d|4\d|5\d),/);
  assert.doesNotMatch(darkPerimeter, /rgba\(0,0,0/);
});
add('complete reflection field advances linearly through a full orbit', () => {
  assert.match(css, /@keyframes rm-chrome-orbit\s*\{\s*from\s*\{\s*--rm-chrome-flow-angle:0deg;\s*\}\s*to\s*\{\s*--rm-chrome-flow-angle:360deg;/);
  assert.doesNotMatch(css, /@keyframes rm-chrome-orbit[^}]*(?:transform:rotate|offset-distance)/);
});
add('optical layers do not intercept input', () => assert.match(css, /Static mirror perimeter[^]*pointer-events:none/));
add('chrome border is transparent instead of grey', () => assert.match(tokens, /--rm-chrome-border:\s*transparent/));
add('capture uses the hero perimeter', () => assert.match(css, /tab-capture::before[^}]*rm-chrome-perimeter-hero/));
add('ambient full-ring orbit is readable at a constant 6.4 seconds', () => assert.match(tokens, /--rm-motion-edge-orbit:\s*6\.4s/));
add('visible chrome surfaces use deterministic stagger', () => { assert.match(css, /animation-delay:var\(--rm-edge-delay/); assert.match(css, /nth-child\(7n\+6\)/); });
add('interaction sweep is single-shot', () => assert.match(css, /rm-edge-sweep::after[^}]*\s1 both/));
add('sheet entrance sweep is single-shot', () => assert.match(css, /sheet\.open::after[^}]*\s1 both/));
add('interaction helper does not run a frame loop', () => { assert.match(interaction, /requestAnimationFrame/); assert.doesNotMatch(interaction, /while\s*\(|setInterval/); });
add('reduced motion removes the travelling layer', () => assert.match(css, /prefers-reduced-motion:reduce[^]*rm-edge-sweep::after[^]*content:none/));
add('explicit reduced motion removes ambient capture motion', () => assert.match(css, /data-reduced-motion="true"[^]*tab-capture::after[^]*content:none/));
add('mask fallback is a static highlight', () => assert.match(css, /@supports not \(\(-webkit-mask-composite:xor\)[^]*border:1px solid var\(--rm-chrome-highlight\)/));

// Canonical control migration.
add('primary actions are graphite', () => assert.match(css, /rm-button--primary[^}]*#171a1f/));
add('primary actions do not use semantic green', () => assert.doesNotMatch(css.match(/rm-button--primary[^}]+/)?.[0] || '', /green|jade|success/));
add('calculator equals is fully graphite', () => { const block = css.match(/calculator-key\[data-calculator-key="="\][^}]+/)?.[0] || ''; assert.match(block, /graphite-900/); assert.doesNotMatch(block, /jade|green/); });
add('Capture apply key is graphite', () => assert.match(css, /capture-calculator-key\.apply[^}]*graphite-900/));
add('selected chips are neutral glass', () => assert.match(css, /rm-chip\.is-selected[^}]*rm-glass-chrome-bg/));
add('selected legacy controls are neutralized centrally', () => assert.match(css, /plan-kind-segment button\.active[^}]*rm-glass-chrome-bg/));
add('asset manager uses canonical content glass', () => assert.match(assetCss, /asset-manage-row[^}]*rm-glass-content-bg/));
add('asset manager footer uses canonical floating glass', () => assert.match(assetCss, /asset-sheet-footer[^}]*rm-glass-chrome-bg/));
add('Ledger surfaces are migrated centrally', () => assert.match(css, /ledger-metrics > div[^}]*rm-glass-content-bg/));
add('Fixed Center surfaces are migrated centrally', () => assert.match(css, /fixed-overview-hero[^}]*rm-glass-content-bg/));
add('payment surfaces are migrated centrally', () => assert.match(css, /payment-assistant-card[^}]*rm-glass-content-bg/));
add('recurring forms use canonical dense frost', () => assert.match(css, /plan-field input[^}]*rm-glass-dense-bg/));
add('toggle active state is graphite', () => assert.match(css, /asset-switch-row input:checked \+ \.ringgit-switch[^}]*#4b525c/));

// Safari, Lab, safety and behavioral freeze.
add('Safari backdrop-filter prefix remains', () => assert.match(css, /-webkit-backdrop-filter:blur/));
add('no-backdrop fallback remains readable', () => assert.match(css, /@supports not \(\(backdrop-filter:blur\(1px\)\)[^]*surface-frosted-strong/));
add('Lab includes the correction pilot', () => assert.match(lab, /Liquid Chrome Material Pilot/));
add('Lab renders production components', () => assert.match(lab, /surfaceHTML[^]*buttonHTML/));
add('contract rejects uniform grey outlines', () => assert.match(contract, /uniform one-pixel grey CSS border is not an acceptable substitute/));
add('contract records the complete constant-speed 6.4 second ring', () => assert.match(contract, /full masked perimeter[^]*linearly[^]*6\.4 seconds/));
add('shell routes interaction sweeps through shared helper', () => assert.match(shell, /triggerLiquidChromeInteraction/));
add('Sheet routes interaction sweeps through shared helper', () => assert.match(sheet, /triggerLiquidChromeInteraction/));
add('visual owners contain no network or persistence API', () => assert.doesNotMatch(source('../src/design-system/DesignSystem.js','../src/design-system/DesignSystemLab.js','../src/styles/design-system.css'), /fetch\(|XMLHttpRequest|localStorage|indexedDB|supabase/i));
add('financial engine does not import visual owners', () => assert.doesNotMatch(read('../src/domain/moneyEngine.js'), /design-system|Liquid Chrome/i));
add('recurring executor does not import visual owners', () => assert.doesNotMatch(read('../src/domain/recurringPostingExecutor.js'), /design-system|Liquid Chrome/i));
add('branded account art remains unchanged in the fixture layer', () => assert.match(read('../src/fixtures/demoData.js'), /assets\/cards\/maybank/));

assert.equal(number, 58);
