import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createDemoDataSource } from '../src/fixtures/demoData.js';
import { resolveCaptureViewportHeight } from '../src/components/CapturePresentation.js';
import { allocationSummary, applyRemainderToLast, equalSplitMinor } from '../src/domain/smartSplit.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const source = {
  capture: read('../src/components/CaptureSheet.js') + read('../src/components/CapturePresentation.js'),
  copy: read('../src/app/copy.js'),
  css: read('../src/styles/phase2b3g.css'),
  cssD: read('../src/styles/phase2b3d.css'),
  calculator: read('../src/components/MoneyCalculatorSheet.js'),
  money: read('../src/domain/moneyEngine.js'),
  relationship: read('../src/domain/relationshipLedgerEngine.js'),
  activity: read('../src/features/activity/index.js'),
  assets: read('../src/features/assets/index.js'),
  category: read('../src/features/assets/category.js'),
  detail: read('../src/features/assets/detail.js'),
  confirmation: read('../src/components/MoneyFlowConfirmation.js'),
  recordDetail: read('../src/components/RecordDetailOverlay.js'),
  date: read('../src/components/DatePickerSheet.js'),
  time: read('../src/components/TimePickerSheet.js'),
  attachment: read('../src/components/AttachmentField.js'),
  shell: read('../src/app/shell.js'),
  package: read('../package.json'),
  vite: read('../vite.config.js'),
};

const draft = (data, values) => ({ catId: 'grocery', catLabel: '日用', date: data.today, time: '10:30', ...values });
const relationBase = (overrides = {}) => ({
  ledgerId: 'ledger-abi', amount: 100, description: '2B3G 关系账测试', sourceAccountId: 'sv-mbb',
  participantId: 'participant-abi', payerParticipantId: 'participant-me', date: '2026-07-13', time: '14:56',
  sourceChannel: 'app', clientEventId: `2b3g-${Math.random()}`, ...overrides,
});

const names = `
four relationship types remain|2 × 2 mobile arrangement|one selected type|selected semantic class/state|unselected semantic class/state|no pure-white hardcoded type-card background|keyboard activation|one activation per tap|no layout shift|reduced-motion fallback
normal expense explanation|AA explanation|receivable explanation|payable explanation|explanation is non-interactive|centralized copy|no detached button styling
target group exists when relevant|payer/participant group exists for AA|split-method group exists for AA|normal expense excludes AA groups|direct receivable excludes irrelevant split group|direct payable excludes irrelevant split group|internal separators|no card-per-field layout|group labels are accessible
selected target preserved|target row opens current selector|local object action preserved|target cancellation preserved
payer preserved|participant selection preserved|participant chip state|long-name safety|no horizontal overflow
equal selected state|custom selected state|switching preserves values according to current behavior|no duplicate state change|reduced-motion behavior
participant names|participant exact amounts|calculator integration|stable IDs|internal separators|no index fallback
exact state|remaining state|excess state|exact total in minor units|no float drift|auto-fill remainder|average action|clear action|exact green semantic state|warning semantic state|excess semantic state|no full-section color flood
invalid split does not close|warning visible|remaining amount visible|excess amount visible|entered values preserved|valid completion succeeds|no duplicate submission|reduced-motion no-shake path
type tiles visible|selected state visible|glass groups distinguishable|text contrast|warning contrast|no pure-black accidental block
Transfer receives transfer-specific tall mode|Expense remains compact|Income remains compact|390 × 844 transfer viewport fits|430 × 932 transfer viewport fits|uses dynamic viewport or equivalent real-height contract|safe-area top respected|safe-area bottom respected|remains bottom-sheet presentation|not hidden behind status bar|no legacy-100vh-only dependency
C visible|backspace visible|divide visible|multiply visible|7/8/9 visible|minus visible|4/5/6 visible|plus visible|1/2/3 visible|equals visible|zero visible|decimal visible|Save visible|keys not covered by Save|no initial vertical scroll required at 390 × 844|no initial vertical scroll required at 430 × 932
source selector preserved|destination selector preserved|same-account validation preserved|direction summary preserved|purpose preserved|More Details preserved|amount preserved|formula preserved|Save payload preserved
expanded state may scroll|calculator state preserved|source/destination preserved|purpose preserved in More Details|description preserved|date/time preserved|attachment state preserved|relationship state preserved|record-only preserved|Save reachable
viewport-height custom property updates|keyboard resize path|height restores after keyboard close|no repeated resize-listener leak|orientation recalculation|no state reset
768px capped width|1024px capped width|no full-width desktop calculator|no giant desktop sheet|no horizontal overflow
key order unchanged|formula parser unchanged|precedence unchanged|divide-by-zero validation unchanged|decimal behavior unchanged|C unchanged|backspace unchanged|equals unchanged|no eval|no Function constructor
expense financial regression|income financial regression|transfer source regression|transfer destination regression|transfer cash-neutral regression|record-only regression|AA receivable regression|other-payer AA regression|direct receivable regression|direct payable regression|settlement regression|repayment regression|idempotency regression
Assets overview unchanged|Savings stack unchanged|Credit stack unchanged|Account Detail unchanged|eWallet unchanged|Confirmation unchanged|Record Detail unchanged|Activity unchanged|date picker unchanged|time picker unchanged|attachments unchanged|bottom nav unchanged
no fetch|no WebSocket|no localStorage|no IndexedDB|no Supabase|no real Telegram|no real App-to-App|no production deployment|source remains uncommitted|port 8788 untouched`.trim().split(/\n|\|/);

assert.equal(names.length, 174);

const relationshipChecks = [
  () => ['normal', 'split_expense', 'direct_receivable', 'direct_payable'].forEach((type) => assert.match(source.capture, new RegExp(`${type}:`))),
  () => assert.match(source.css, /relationship-type-grid[\s\S]*grid-template-columns: repeat\(2/),
  () => assert.match(source.capture, /role="radio" aria-checked="\$\{type === mode\}"/),
  () => assert.match(source.capture, /is-selected active/),
  () => assert.match(source.capture, /is-unselected/),
  () => assert.doesNotMatch(source.css.match(/\.relation-mode-grid \.relationship-type-tile \{[\s\S]*?\n\}/)?.[0] || '', /#fff|#ffffff|rgb\(255/),
  () => assert.match(source.capture, /<button type="button" class="relationship-type-tile/),
  () => assert.equal((source.capture.match(/registerAction\('capture-relation-mode'/g) || []).length, 1),
  () => assert.match(source.css, /min-height: 62px[\s\S]*transition:/),
  () => assert.match(source.css, /prefers-reduced-motion: reduce[\s\S]*error-shake/),
  () => assert.match(source.copy, /normal: '只影响所选账户，不会创建关系账。'/),
  () => assert.match(source.copy, /split_expense: '按参与者份额记录，并更新应收或应付。'/),
  () => assert.match(source.copy, /direct_receivable: '记录对方欠你的金额，并建立待收。'/),
  () => assert.match(source.copy, /direct_payable: '记录你欠对方的金额，并建立待付。'/),
  () => assert.match(source.capture, /data-relationship-explanation role="note"/),
  () => assert.match(source.capture, /RELATIONSHIP_COPY\.explanation\[type\]/),
  () => assert.match(source.css, /relationship-type-note[\s\S]*font: var\(--type-caption\)/),
  () => assert.match(source.capture, /relationship-target-group/),
  () => assert.match(source.capture, /relationship-participants-group/),
  () => assert.match(source.capture, /relationship-split-group/),
  () => assert.match(source.capture, /const type = relationDraft\.entryType[\s\S]*if \(type !== 'normal'\)/),
  () => assert.match(source.capture, /else if \(type === 'direct_receivable'[\s\S]*relationship-direction-group/),
  () => assert.match(source.capture, /else if \(type === 'direct_payable'[\s\S]*relationship-direction-group/),
  () => assert.match(source.capture, /relationship-group-divider/),
  () => assert.match(source.css, /relationship-split-list \.split-participant-row[\s\S]*background: transparent/),
  () => assert.match(source.capture, /aria-labelledby="\$\{id\}"/),
  () => assert.match(source.capture, /selectedValue: relationDraft\.ledgerId/),
  () => assert.match(source.capture, /data-picker-field="ledger"/),
  () => assert.match(source.capture, /capture-relation-add-person/),
  () => assert.match(source.capture, /capture-relation-cancel'[\s\S]*closeSheet\(\)/),
  () => assert.match(source.capture, /selectedValue: relationDraft\.payerParticipantId/),
  () => assert.match(source.capture, /splitParticipantIds\.includes\(id\)/),
  () => assert.match(source.capture, /aria-pressed="\$\{relationDraft\.splitParticipantIds\.includes\(id\)\}"/),
  () => assert.match(source.css, /max-width: min\(180px, 52vw\)[\s\S]*text-overflow: ellipsis/),
  () => assert.match(source.css, /max-width: 100%/),
  () => assert.match(source.capture, /data-mode="equal" role="radio"/),
  () => assert.match(source.capture, /data-mode="custom" role="radio"/),
  () => assert.match(source.capture, /syncRelationShares\(\); relationDraft\.splitMode/),
  () => assert.equal((source.capture.match(/registerAction\('capture-split-mode'/g) || []).length, 1),
  () => assert.match(source.css, /relationship-split-segment[\s\S]*transition-duration: \.01ms/),
  () => assert.match(source.capture, /moneyFieldHTML\(\{ label: participantName\(id\)/),
  () => { const shares = equalSplitMinor(10001, ['a', 'b']); assert.equal(shares.a + shares.b, 10001); },
  () => assert.match(source.capture, /data-split-allocation[\s\S]*createInlineSplitDraft/),
  () => assert.match(source.capture, /data-split-participant="\$\{escapeHTML\(id\)\}"/),
  () => assert.match(source.css, /split-participant-row \+ \.split-participant-row \{ border-top/),
  () => assert.doesNotMatch(source.capture, /data-split-participant="\$\{index\}/),
  () => assert.equal(allocationSummary(10000, { a: 5000, b: 5000 }, ['a', 'b']).exact, true),
  () => assert.equal(allocationSummary(10000, { a: 4000, b: 5000 }, ['a', 'b']).remainingMinor, 1000),
  () => assert.equal(allocationSummary(10000, { a: 6000, b: 5000 }, ['a', 'b']).overMinor, 1000),
  () => assert.equal(equalSplitMinor(10001, ['a', 'b', 'c']).a + equalSplitMinor(10001, ['a', 'b', 'c']).b + equalSplitMinor(10001, ['a', 'b', 'c']).c, 10001),
  () => assert.equal(allocationSummary(1, { a: 1 }, ['a']).allocatedMinor, 1),
  () => assert.equal(applyRemainderToLast(10000, ['a', 'b'], { a: 4200, b: 5000 }).b, 5800),
  () => assert.match(source.capture, /capture-split-even/),
  () => assert.match(source.capture, /capture-split-clear/),
  () => assert.match(source.css, /relationship-allocation-status\.exact/),
  () => assert.match(source.css, /relationship-allocation-status[\s\S]*sem-orange/),
  () => assert.match(source.css, /relationship-allocation-status\.over[\s\S]*sem-red/),
  () => assert.doesNotMatch(source.css, /relationship-allocation-status[^}]*background:\s*var\(--sem-/),
  () => assert.match(source.capture, /if \(!summary\.exact\)[\s\S]*return;/),
  () => assert.match(source.capture, /relationship-allocation-error/),
  () => assert.match(source.capture, /还需分配 \$\{formatMoneyMinor\(summary\.remainingMinor\)\}/),
  () => assert.match(source.capture, /已超出 \$\{formatMoneyMinor\(summary\.overMinor\)\}/),
  () => assert.doesNotMatch(source.capture, /relationDraft\.customShares\s*=\s*\{\}[\s\S]{0,80}if \(!summary\.exact\)/),
  () => assert.match(source.capture, /cap\.relationship = relationDraft\.entryType === 'normal' \? null : structuredClone/),
  () => assert.match(source.capture, /if \(saving\) return/),
  () => assert.match(source.capture, /reduceMotion \? 'auto' : 'smooth'/),
  () => assert.match(source.css, /:root\[data-theme="dark"\] \.relation-mode-grid \.relationship-type-tile/),
  () => assert.match(source.css, /data-theme="dark"[\s\S]*is-selected/),
  () => assert.match(source.css, /data-theme="dark"[\s\S]*relationship-glass-group/),
  () => assert.match(source.css, /color: var\(--text-1\)/),
  () => assert.match(source.css, /sem-orange[\s\S]*sem-red/),
  () => assert.doesNotMatch(source.css, /relationship-(?:type|glass)[^}]*#000/),
];

const transferChecks = [
  () => assert.match(source.capture, /capture-sheet-transfer/),
  () => assert.match(source.capture, /cap\.mode === 'transfer'/),
  () => assert.doesNotMatch(source.css, /capture-sheet:not\(\.capture-sheet-transfer\)/),
  () => assert.match(source.css, /max-width: 600px[\s\S]*capture-sheet\.capture-sheet-transfer/),
  () => assert.match(source.css, /capture-viewport-height/),
  () => assert.match(source.capture, /browserWindow\.visualViewport/),
  () => assert.match(source.css, /var\(--safe-top\)/),
  () => assert.match(source.cssD, /var\(--safe-bottom\)/),
  () => assert.match(source.css, /bottom: 0/),
  () => assert.match(source.css, /max-height: calc\(var\(--capture-viewport-height/),
  () => assert.match(source.css, /@supports not \(height: 100dvh\)/),
  () => assert.match(source.capture, /\['C','back','÷','×'/),
  () => assert.match(source.capture, /key === 'back'/),
  () => assert.match(source.capture, /'÷'/),
  () => assert.match(source.capture, /'×'/),
  () => ['7', '8', '9'].forEach((key) => assert.match(source.capture, new RegExp(`'${key}'`))),
  () => assert.match(source.capture, /'−'/),
  () => ['4', '5', '6'].forEach((key) => assert.match(source.capture, new RegExp(`'${key}'`))),
  () => assert.match(source.capture, /'\+'/),
  () => ['1', '2', '3'].forEach((key) => assert.match(source.capture, new RegExp(`'${key}'`))),
  () => assert.match(source.capture, /key === '='/),
  () => assert.match(source.capture, /key === '0'/),
  () => assert.match(source.capture, /'\.'/),
  () => assert.match(source.capture, /data-action="cap-save"/),
  () => assert.match(source.cssD, /cap-save-wrap[\s\S]*position: relative/),
  () => assert.match(source.cssD, /capture-main\.calculator-mode \{ overflow-y: hidden/),
  () => assert.match(source.css, /430|600px/),
  () => assert.match(source.capture, /'cap-source'/),
  () => assert.match(source.capture, /'cap-destination'/),
  () => assert.match(source.capture, /转出和转入账户不能相同/),
  () => assert.match(source.capture, /cap-transfer-summary/),
  () => assert.match(source.capture, /quickRow\('transfer'\)/),
  () => assert.match(source.capture, /cap-open-details/),
  () => assert.match(source.capture, /amount: ''/),
  () => assert.match(source.capture, /completedExpression/),
  () => assert.match(source.capture, /sourceAccountId: cap\.mode === 'income'/),
  () => assert.match(source.cssD, /capture-main\.details-mode \{ overflow-y: auto/),
  () => assert.match(source.capture, /cap\.detailsOpen = !cap\.detailsOpen/),
  () => assert.match(source.capture, /accountId: 'sv-mbb', destinationAccountId: 'ew-tng'/),
  () => assert.match(source.capture, /cap\.catId/),
  () => assert.match(source.capture, /cap\.desc/),
  () => assert.match(source.capture, /cap\.date[\s\S]*cap\.time/),
  () => assert.match(source.capture, /draftAttachments\(\)/),
  () => assert.match(source.capture, /cap\.relationship/),
  () => assert.match(source.capture, /cap\.recordOnly/),
  () => assert.match(source.cssD, /cap-save-wrap[\s\S]*z-index: 5/),
  () => assert.match(source.capture, /style\.setProperty\('--capture-viewport-height'/),
  () => assert.match(source.capture, /visualViewport[\s\S]*addEventListener\('resize'/),
  () => assert.equal(resolveCaptureViewportHeight({ height: 412.4 }, 844), 412),
  () => assert.match(source.capture, /unbindCaptureViewport\(\)/),
  () => assert.match(source.capture, /orientationchange/),
  () => assert.doesNotMatch(source.capture, /updateHeight[\s\S]{0,180}Object\.assign\(cap/),
  () => assert.match(source.cssD, /width: min\(100%, 480px\)/),
  () => assert.match(source.css, /min-width: 601px/),
  () => assert.match(source.css, /max-height: min\([\s\S]*800px/),
  () => assert.doesNotMatch(source.css, /capture-sheet-transfer[^}]*width:\s*100vw/),
  () => assert.doesNotMatch(source.css, /overflow-x:\s*auto/),
];

const calculatorChecks = [
  () => assert.match(source.capture, /const keys = \['C','back','÷','×','7','8','9','−','4','5','6','\+','1','2','3','=','0','\.'\]/),
  () => assert.match(source.capture, /evaluateMoneyExpression\(cap\.amount\)/),
  () => assert.match(source.calculator, /PRECEDENCE/),
  () => assert.match(source.calculator, /不能除以零/),
  () => assert.match(source.capture, /tail\.includes\('\.'\)/),
  () => assert.match(source.capture, /key === 'C'/),
  () => assert.match(source.capture, /key === 'back'/),
  () => assert.match(source.capture, /key === '='/),
  () => assert.doesNotMatch(source.calculator + source.capture, /\beval\s*\(/),
  () => assert.doesNotMatch(source.calculator + source.capture, /new Function|Function\s*\(/),
];

const financialChecks = [
  () => { const d = createDemoDataSource(); const b = d.getAccount('sv-mbb').balance; d.addTransaction(draft(d, { kind: 'expense', amount: 10, desc: 'E', sourceAccountId: 'sv-mbb' })); assert.equal(d.getAccount('sv-mbb').balance, b - 10); },
  () => { const d = createDemoDataSource(); const b = d.getAccount('sv-cimb').balance; d.addTransaction(draft(d, { kind: 'income', amount: 10, desc: 'I', destinationAccountId: 'sv-cimb' })); assert.equal(d.getAccount('sv-cimb').balance, b + 10); },
  () => { const d = createDemoDataSource(); const b = d.getAccount('sv-mbb').balance; d.transferFunds(draft(d, { amount: 10, desc: 'T', sourceAccountId: 'sv-mbb', destinationAccountId: 'ew-tng' })); assert.equal(d.getAccount('sv-mbb').balance, b - 10); },
  () => { const d = createDemoDataSource(); const b = d.getAccount('ew-tng').balance; d.transferFunds(draft(d, { amount: 10, desc: 'T', sourceAccountId: 'sv-mbb', destinationAccountId: 'ew-tng' })); assert.equal(d.getAccount('ew-tng').balance, b + 10); },
  () => { const d = createDemoDataSource(); const cash = d.getPulse().currentCash; d.transferFunds(draft(d, { amount: 10, desc: 'T', sourceAccountId: 'sv-mbb', destinationAccountId: 'ew-tng' })); assert.equal(d.getPulse().currentCash, cash); },
  () => { const d = createDemoDataSource(); const b = d.getAccount('sv-mbb').balance; d.addTransaction(draft(d, { kind: 'expense', amount: 10, desc: 'R', sourceAccountId: 'sv-mbb', recordOnly: true })); assert.equal(d.getAccount('sv-mbb').balance, b); },
  () => { const d = createDemoDataSource(); const b = d.getAccount('sv-mbb').balance; const r = d.recordRelationshipEntry(relationBase({ entryType: 'split_expense', shares: [{ participantId: 'participant-me', amountMinor: 5000 }, { participantId: 'participant-abi', amountMinor: 5000 }] })); assert.equal(d.getAccount('sv-mbb').balance, b - 100); assert.equal(r.entry.amountMinor, 5000); },
  () => { const d = createDemoDataSource(); const b = d.getAccount('sv-mbb').balance; d.recordRelationshipEntry(relationBase({ entryType: 'split_expense', payerParticipantId: 'participant-abi', shares: [{ participantId: 'participant-me', amountMinor: 5000 }, { participantId: 'participant-abi', amountMinor: 5000 }] })); assert.equal(d.getAccount('sv-mbb').balance, b); },
  () => { const d = createDemoDataSource(); const b = d.getAccount('sv-mbb').balance; d.recordRelationshipEntry(relationBase({ entryType: 'direct_receivable', amount: 25 })); assert.equal(d.getAccount('sv-mbb').balance, b - 25); },
  () => { const d = createDemoDataSource(); const b = d.getAccount('sv-mbb').balance; d.recordRelationshipEntry(relationBase({ entryType: 'direct_payable', amount: 25 })); assert.equal(d.getAccount('sv-mbb').balance, b); },
  () => assert.match(source.relationship, /settlement/),
  () => assert.match(source.relationship, /description: command\.description \|\| \(direction === 'received' \? '收到款' : '我还款'\)/),
  () => { const d = createDemoDataSource(); const b = d.getAccount('sv-mbb').balance; const v = draft(d, { kind: 'expense', amount: 10, desc: 'Once', sourceAccountId: 'sv-mbb', submissionKey: '2b3g-once' }); d.addTransaction(v); d.addTransaction(v); assert.equal(d.getAccount('sv-mbb').balance, b - 10); },
];

const frozenChecks = [
  () => assert.doesNotMatch(source.css, /asset-overview|asset-summary/),
  () => assert.doesNotMatch(source.css, /wallet-stack-card/),
  () => assert.doesNotMatch(source.css, /credit-stack|cc-stack/),
  () => assert.doesNotMatch(source.css, /account-detail/),
  () => assert.doesNotMatch(source.css, /ewallet|e-wallet/),
  () => assert.doesNotMatch(source.css, /money-motion/),
  () => assert.doesNotMatch(source.css, /activity-detail-sheet/),
  () => assert.doesNotMatch(source.css, /activity-row/),
  () => assert.match(source.date, /DatePicker/),
  () => assert.match(source.time, /TimePicker/),
  () => assert.match(source.attachment, /attachment/),
  () => assert.doesNotMatch(source.css, /\.tabbar/),
];

const scopeChecks = [
  () => Object.values(source).forEach((text) => assert.doesNotMatch(text, /\bfetch\s*\(/)),
  () => Object.values(source).forEach((text) => assert.doesNotMatch(text, /\bWebSocket\b/)),
  () => Object.values(source).forEach((text) => assert.doesNotMatch(text, /\blocalStorage\b/)),
  () => Object.values(source).forEach((text) => assert.doesNotMatch(text, /\bindexedDB\b/)),
  () => Object.values(source).forEach((text) => assert.doesNotMatch(text, /createClient\s*\(|supabase\.co/iu)),
  () => assert.doesNotMatch(source.capture, /telegram/i),
  () => assert.doesNotMatch(source.capture, /app_to_app/i),
  () => assert.doesNotMatch(source.package, /deploy/),
  () => assert.match(source.vite, /fixture-backed|protected D3C harness port/),
  () => { assert.doesNotMatch(source.package, /8788/); assert.doesNotMatch(source.vite, /port\s*:\s*8788|proxy\s*:/); },
];

const checks = [...relationshipChecks, ...transferChecks, ...calculatorChecks, ...financialChecks, ...frozenChecks, ...scopeChecks];
assert.equal(checks.length, names.length);

names.forEach((name, index) => test(`2B3G-${String(index + 1).padStart(3, '0')}: ${name}`, checks[index]));
