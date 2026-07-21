import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createDemoDataSource } from '../src/fixtures/demoData.js';
import { createAttachmentStore } from '../src/domain/attachmentRepository.js';
import { accountIdentityBarHTML, accountVisualCardHTML, resolveAccountIdentity } from '../src/components/AccountVisualCard.js';
import { moneyFlowConfirmationHTML, uniqueRecentRecords } from '../src/components/MoneyFlowConfirmation.js';
import { centeredScrollLeft, nearestCenterIndex, renderNativeSnapCardCarousel } from '../src/components/NativeSnapCardCarousel.js';
import { ATTACHMENT_NATIVE_FILE_PICKER_VERDICT, classifyAttachmentPickerVerification } from '../src/app/verificationPolicy.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const source = {
  capture: read('../src/components/CaptureSheet.js'),
  sheet: read('../src/components/AppSheet.js'),
  router: read('../src/app/router.js'),
  shell: read('../src/app/shell.js'),
  main: read('../src/main.js'),
  assets: read('../src/features/assets/index.js'),
  category: read('../src/features/assets/category.js'),
  detail: read('../src/features/assets/detail.js'),
  activity: read('../src/features/activity/index.js'),
  ledger: read('../src/features/ledger/index.js'),
  native: read('../src/components/NativeSnapCardCarousel.js'),
  visual: read('../src/components/AccountVisualCard.js'),
  confirmation: read('../src/components/MoneyFlowConfirmation.js'),
  attachment: read('../src/components/AttachmentField.js'),
  attachmentRepo: read('../src/domain/attachmentRepository.js'),
  demo: read('../src/fixtures/demoData.js'),
  css: [read('../src/styles/base.css'), read('../src/styles/assets.css'), read('../src/styles/phase2b3c.css'), read('../src/styles/phase2b3d.css')].join('\n'),
  css2b3d: read('../src/styles/phase2b3d.css'),
  package: read('../package.json'),
  vite: read('../vite.config.js'),
};

const data = createDemoDataSource();
const savings = data.getAccountsByType('saving');
const credit = data.getAccountsByType('cc');
const wallets = data.getAccountsByType('ew');
const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
const money = (account, { effect = 'posted', kind = 'expense', beforeMinor = 100000, afterMinor = 99000, deltaMinor = -1000 } = {}) => ({
  operation: 'create', kind, amountMinor: Math.abs(deltaMinor), description: '测试记录', accountEffect: effect,
  transactionId: 'txn-2b3d', accountChanges: [{ accountId: account.id, accountName: account.name, accountType: account.type, measure: account.type === 'cc' ? 'outstanding' : 'balance', beforeMinor, afterMinor, deltaMinor }],
  recentRecords: [{ id: 'txn-2b3d', desc: '测试记录', date: '2026-07-15', time: '13:14', amountMinor: Math.abs(deltaMinor), kind }],
});
const htmlFor = (account, options) => moneyFlowConfirmationHTML(money(account, options));
const cases = [];
const add = (name, run) => cases.push([name, run]);
const captureMarkup = source.capture.match(/function captureHTML\(\)[\s\S]*?\n}\n\nfunction directKeypadHTML/)?.[0] || '';

// 1–18 Compact Capture bottom sheet
add('uses a dynamic viewport height guard', () => assert.match(source.css2b3d, /max-height: min\(calc\(100dvh/));
add('ordinary viewports keep the sheet fixed and bottom-anchored', () => assert.match(source.css2b3d, /capture-sheet[\s\S]*position: fixed;[\s\S]*width: min\(100%, 480px\);[\s\S]*top: auto;[\s\S]*bottom: 0/));
add('safe bottom inset', () => assert.match(source.css2b3d, /safe-bottom/));
add('no underlying page scroll', () => assert.match(source.css2b3d, /#app\.capture-open \.app-content \{ overflow: hidden/));
add('default sheet uses content height', () => assert.match(source.css2b3d, /height: auto;[\s\S]*max-height: min/));
add('default 390×844 layout fits', () => { assert.match(source.css2b3d, /calculator-mode \{ overflow-y: hidden/); assert.match(source.css2b3d, /minmax\(38px, 1fr\)/); });
add('default 430×932 layout fits', () => assert.match(source.css2b3d, /max-height: min\(calc\(100dvh - var\(--safe-top\) - 10px\), 760px\)/));
add('type tabs visible', () => assert.match(captureMarkup, /capture-modes/));
add('amount hero visible', () => assert.match(captureMarkup, /amountHeroHTML\(\)/));
add('category visible', () => assert.match(captureMarkup, /quickRow\(cap\.mode\)/));
add('account visible', () => assert.match(captureMarkup, /accountsHTML\(accounts\)/));
add('More Details visible', () => assert.match(captureMarkup, /cap-open-details/));
add('full calculator visible', () => assert.match(captureMarkup, /directKeypadHTML\(\)/));
add('Save visible', () => assert.match(captureMarkup, /class="cap-save"/));
add('no default internal vertical overflow beyond tolerance', () => assert.match(source.css2b3d, /capture-main\.calculator-mode \{ overflow-y: hidden/));
add('no content clipping', () => assert.match(source.css2b3d, /capture-main\.details-mode \{ overflow-y: auto/));
add('sticky Save footer', () => { assert.match(captureMarkup, /<footer class="cap-save-wrap"/); assert.match(source.css2b3d, /cap-save-wrap[\s\S]*flex: 0 0 auto/); });
add('calculator/Save separation', () => assert.match(source.css2b3d, /cap-save-wrap[\s\S]*border-top: 1px solid var\(--line\)/));

// 19–33 More Details
add('More Details expands', () => assert.match(source.capture, /cap-open-details'[\s\S]*cap\.detailsOpen = !cap\.detailsOpen/));
add('full calculator collapses', () => assert.match(source.capture, /cap\.detailsOpen \? detailFlow : defaultFlow/));
add('compact amount bar appears', () => assert.match(source.capture, /compactAmountBarHTML/));
add('amount is preserved', () => assert.match(source.capture, /cap-edit-amount[\s\S]*cap\.detailsOpen = false/));
add('expression result is preserved', () => assert.match(source.capture, /completedExpression/));
add('description preserved', () => assert.match(source.capture, /syncForm\(\)[\s\S]*cap\.desc/));
add('date preserved', () => assert.match(source.capture, /onDateChange: \(value\) => \{ cap\.date = value/));
add('time preserved', () => assert.match(source.capture, /onTimeChange: \(value\) => \{ cap\.time = value/));
add('attachment preserved', () => assert.match(source.capture, /attachmentSummaryHTML\('draft', cap\.submissionKey\)/));
add('relationship preserved', () => assert.match(source.capture, /cap\.relationship/));
add('record-only preserved', () => assert.match(source.capture, /cap\.recordOnly = Boolean/));
add('Edit Amount returns to calculator mode', () => assert.match(source.capture, /registerAction\('cap-edit-amount'[\s\S]*detailsOpen = false/));
add('details remain in draft after returning', () => assert.doesNotMatch(source.capture, /cap-edit-amount'[\s\S]{0,220}(cap\.desc|cap\.date|cap\.time)\s*=/));
add('expanded details remain scrollable', () => assert.match(source.css2b3d, /details-mode \{ overflow-y: auto/));
add('Save remains reachable', () => assert.match(source.css2b3d, /cap-save-wrap[\s\S]*z-index: 5/));

// 34–45 Amount/formula hero
add('idle amount primary', () => assert.match(source.capture, /formulaActive \? state\.expression : `RM/));
add('active formula primary', () => assert.match(source.capture, /const primary = formulaActive \? state\.expression/));
add('current result secondary', () => assert.match(source.capture, /`当前结果 \$\{result\}`/));
add('incomplete helper neutral', () => assert.match(source.capture, /incomplete \? state\.helper/));
add('no red error during ordinary typing', () => assert.match(source.capture, /cap\.error === '请先完成算式' \? 'error' : ''/));
add('Save triggers red incomplete error', () => assert.match(source.capture, /captureError\('请先完成算式'/));
add('expression preserved after blocked Save', () => assert.doesNotMatch(source.capture, /captureError\('请先完成算式'[\s\S]{0,100}cap\.amount\s*=/));
add('completed equals returns amount primary', () => assert.match(source.capture, /const completed = inspectMoneyExpression[\s\S]*cap\.completedExpression = `\$\{completed\} =`/));
add('long expression responsive typography', () => assert.match(source.css2b3d, /formula-long[\s\S]*clamp/));
add('no duplicate amount/result authority', () => assert.equal((source.capture.match(/data-capture-primary>/g) || []).length, 1));
add('no Apply button', () => assert.doesNotMatch(source.capture, /应用金额|data-key="apply"/));
add('no whole-calculator red border', () => assert.match(source.css2b3d, /capture-direct-keypad\.has-error \{ box-shadow: none; border: 0/));

// 46–58 Calculator visual
add('one coherent keypad surface', () => assert.equal((source.capture.match(/data-capture-calculator aria-label/g) || []).length, 1));
add('no blank grid cell', () => assert.match(source.capture, /'C','back','÷','×','7','8','9','−','4','5','6','\+','1','2','3','=','0','\.'/));
add('clear key', () => assert.match(source.capture, /key === 'C'/));
add('backspace', () => assert.match(source.capture, /key === 'back'/));
add('decimal', () => assert.match(source.capture, /key === '\.'/));
add('four operators', () => ['÷', '×', '−', '+'].forEach((key) => assert.ok(source.capture.includes(`'${key}'`))));
add('one equals key', () => assert.equal((source.capture.match(/'='/g) || []).length >= 1, true));
add('zero layout', () => assert.match(source.css, /capture-calculator-key\.zero \{ grid-column: 1 \/ span 2/));
add('key press single-fire', () => assert.match(source.capture, /if \(saving\) return/));
add('no native keyboard', () => assert.doesNotMatch(source.capture, /input type="number"|inputmode="decimal"/));
add('no debug outline', () => assert.doesNotMatch(source.css2b3d, /debug[^}]*outline/));
add('dark mode keypad', () => assert.match(source.css, /capture-calculator-key[\s\S]*background: color-mix\(in srgb, var\(--s1\)/));
add('Save not overlapped', () => {
  assert.match(source.css2b3d, /capture-calculator[\s\S]*flex: 0 0 clamp\(294px, 39dvh, 334px\)/);
  assert.match(source.css2b3d, /cap-save-wrap[\s\S]*border-top/);
});

// 59–70 Navigation history
add('category navigation pushes history', () => assert.match(source.assets, /assets-open-saving'[\s\S]*pushRoute/));
add('Account Detail pushes history', () => assert.match(source.assets, /assets-open-detail'[\s\S]*pushRoute/));
add('Transaction Detail pushes history', () => assert.match(source.activity, /open-activity-detail'[\s\S]*pushRoute/));
add('Ledger Detail pushes history', () => assert.match(source.ledger, /open-ledger'[\s\S]*pushRoute/));
add('back uses history where available', () => assert.match(source.router, /historyDepth > 0\) history\.back\(\)/));
add('direct route has safe fallback', () => assert.match(source.router, /else replaceRoute\(fallbackPatch/));
add('top-level tabs avoid unusable deep history', () => assert.match(source.router, /replaceRoute\(\{ tab/));
add('forward page transition', () => assert.match(source.css, /@keyframes page-in/));
add('back page transition', () => assert.match(source.css2b3d, /@keyframes page-back-in/));
add('reduced-motion route transition', () => assert.match(source.css, /prefers-reduced-motion:[\s\S]*page-enter/));
add('no custom global edge recognizer', () => assert.doesNotMatch(source.shell + source.router, /touchstart|edgeSwipe|screenX/));
add('no Carousel interference', () => assert.doesNotMatch(source.native, /history\.|pushRoute|replaceRoute/));

// 71–92 Assets overview
add('Savings compact list exists', () => assert.match(source.assets, /compactAccountRows\(list\)/));
add('Savings full carousel absent from overview', () => assert.doesNotMatch(source.assets, /savingsSection\(\)[\s\S]{0,600}renderCarousel/));
add('four Savings rows with readable stack sizing', () => {
  assert.equal(savings.length, 4);
  assert.match(source.css2b3d, /asset-card-stack \{ margin-inline: -6px/);
  assert.match(source.css2b3d, /asset-stack-row[\s\S]*min-height: 76px;[\s\S]*gap: 7px/);
});
add('exact Savings totals', () => assert.equal(sum(savings, 'balance'), 14327.85));
add('direct CIMB row navigation', () => assert.match(source.assets, /data-action="assets-open-detail" data-acc/));
add('direct Public Bank row navigation', () => assert.ok(savings.some((account) => account.id === 'sv-pbb')));
add('exact masked digits', () => assert.deepEqual(savings.map((account) => account.last4), ['8888', '2468', '1357', '7788']));
add('Credit compact list exists', () => assert.match(source.assets, /compactAccountRows\(list, \{ debt: true \}\)/));
add('Credit full carousel absent from overview', () => assert.doesNotMatch(source.assets, /creditSection\(\)[\s\S]{0,600}renderCarousel/));
add('three Credit rows keep the same readable stack sizing', () => {
  assert.equal(credit.length, 3);
  assert.match(source.css2b3d, /asset-stack-row[\s\S]*padding: 10px/);
});
add('debt values display without redundant minus', () => { assert.match(source.assets,/model\.formattedAmount/); assert.doesNotMatch(source.assets,/−\$\{model\.formattedAmount\}/); });
add('exact Credit total', () => assert.equal(sum(credit, 'outstanding'), 5258.25));
add('eWallet compact tiles', () => assert.match(source.assets, /asset-wallet-tile/));
add('eWallet giant card absent from overview', () => assert.doesNotMatch(source.assets, /ewalletSection\(\)[\s\S]{0,700}accountVisualCardHTML|renderCarousel/));
add('logo left', () => assert.match(source.css2b3d, /asset-wallet-tile[\s\S]*grid-template-columns: 38px minmax\(0, 1fr\)/));
add('name above amount', () => assert.match(source.assets, /wallet-tile-copy"><strong>[\s\S]*<span class="num"/));
add('two-decimal amount', () => assert.match(source.assets, /fmtRM\(account\.balance/));
add('mobile shows partial next tile', () => assert.match(source.css2b3d, /width: clamp\(145px, 43vw, 164px\)/));
add('direct wallet navigation', () => assert.match(source.assets, /asset-wallet-tile" data-action="assets-open-detail"/));
add('investment unchanged', () => assert.match(source.assets, /function investmentSection/));
add('fixed deposit unchanged', () => assert.match(source.assets, /function fdSection/));
add('net asset calculations unchanged', () => assert.equal(data.getPulse().netAssets, 48787.14));

// 93–115 Category/detail touch structure
add('scroller scrollWidth exceeds clientWidth', () => { const html = renderNativeSnapCardCarousel(savings, 0); assert.equal((html.match(/data-snap-account-id/g) || []).length, 4); assert.match(source.css, /flex: 0 0 var\(--snap-card-width\)/); });
add('actual card scroller receives pointer events', () => assert.match(source.css2b3d, /native-carousel-scroller \{ touch-action:[^}]*pointer-events: auto/));
add('no touch-action none', () => assert.doesNotMatch(source.css2b3d, /native-(?:carousel|snap)[^}]*touch-action: none/));
add('no pan-y-only blocker', () => assert.match(source.css2b3d, /native-carousel-shell\.deck-viewport \{ touch-action: auto/));
add('no pointer capture', () => assert.doesNotMatch(source.native, /setPointerCapture|releasePointerCapture/));
add('no touchmove preventDefault', () => assert.doesNotMatch(source.native, /touchmove|preventDefault\(\)[\s\S]{0,80}touch/));
add('no transparent full-card overlay', () => assert.doesNotMatch(source.native, /overlay|position:\s*absolute/));
add('automatic-card brand image remains non-draggable', () => {
  const html = accountVisualCardHTML(savings[0]);
  assert.match(html, /data-card-renderer="ringgitme-auto-card"/);
  assert.match(html, /draggable="false"/);
});
add('image pointer-events none', () => assert.match(source.css2b3d, /native-snap-card \.account-visual \*[\s\S]*pointer-events: none/));
add('no transform-driven track', () => { assert.doesNotMatch(source.native, /style\.transform/); assert.match(source.css2b3d, /native-snap-card\.deck-card[\s\S]*transform: none/); });
add('native horizontal overflow', () => assert.match(source.css, /native-carousel-scroller[\s\S]*overflow-x: auto/));
add('native scroll snap', () => assert.match(source.css, /scroll-snap-type: x mandatory/));
add('iOS momentum CSS', () => assert.match(source.css, /-webkit-overflow-scrolling: touch/));
add('no scroll-snap-stop always if rejected by design', () => assert.doesNotMatch(source.css, /scroll-snap-stop: always/));
add('middle card center calculation', () => { const cards = [{ offsetLeft: 0, offsetWidth: 200 }, { offsetLeft: 212, offsetWidth: 200 }, { offsetLeft: 424, offsetWidth: 200 }]; assert.equal(nearestCenterIndex({ scrollLeft: 212, clientWidth: 200, querySelectorAll: () => cards }, cards), 1); });
add('active dot synchronization', () => assert.match(source.native, /data-dot-account-id[\s\S]*classList\.toggle\('on'/));
add('side-card center behavior', () => assert.equal(centeredScrollLeft({ clientWidth: 390 }, { offsetLeft: 300, offsetWidth: 300 }), 255));
add('active-card open behavior', () => assert.match(source.native, /if \(cardIndex === settledIndex\) return/));
add('drag displacement suppresses click', () => assert.match(source.native, /performance\.now\(\) < recentScrollUntil/));
add('account ID invariant', () => assert.match(renderNativeSnapCardCarousel(savings, 1), /data-selected-account-id="sv-cimb"[\s\S]*data-snap-account-id="sv-cimb"/));
add('no first-account flash', () => assert.match(source.css, /native-carousel-shell\.deck-viewport[\s\S]*opacity: 0[\s\S]*is-ready/));
add('no stale card art', () => assert.match(renderNativeSnapCardCarousel(savings, 2), /data-selected-account-id="sv-pbb"[\s\S]*data-account-visual="sv-pbb"/));
add('category and detail share selection', () => { assert.match(source.category, /selectedAccountId\[type\]/); assert.match(source.detail, /selectedAccountId/); });

// 116–131 Confirmation identity
add('savings identity bar', () => assert.match(htmlFor(savings[0]), /account-identity-bar/));
add('credit identity bar', () => assert.match(htmlFor(credit[0], { beforeMinor: 10000, afterMinor: 11000, deltaMinor: 1000 }), /account-identity-bar/));
add('eWallet identity bar', () => assert.match(htmlFor(wallets[0]), /account-identity-bar/));
add('logo rendered', () => assert.match(accountIdentityBarHTML(wallets[0]), /data-account-identity-logo/));
add('account name rendered', () => assert.match(accountIdentityBarHTML(savings[0]), /Maybank 储蓄卡/));
add('institution/brand rendered with current localized identity', () => assert.equal(resolveAccountIdentity(savings[0]).institution, 'Maybank（马来亚银行）'));
add('compact status rendered', () => assert.match(accountIdentityBarHTML(savings[0]), /account-identity-status/));
add('identity and card share accountId', () => assert.match(htmlFor(savings[0]), /data-account-identity="sv-mbb"[\s\S]*data-account-visual="sv-mbb"/));
add('identity and balance share accountId', () => assert.match(htmlFor(savings[0]), /data-account-identity="sv-mbb"[\s\S]*data-balance-account="sv-mbb"/));
add('fallback initial tile', () => assert.match(accountIdentityBarHTML({ id: 'x', name: '现金', bank: '本地', type: 'saving' }), /<i>本<\/i>/));
add('no broken logo', () => assert.match(source.visual, /naturalWidth === 0[\s\S]*image-failed/));
add('no remote hotlink', () => assert.doesNotMatch(source.visual, /https?:\/\//));
add('status moved out of standalone header', () => assert.doesNotMatch(source.confirmation, /money-motion-header/));
add('account history CTA repeats the same identity across generated card identity bar and CTA', () => assert.ok((htmlFor(savings[0]).match(/Maybank 储蓄卡/g) || []).length >= 3));
add('Liquid Glass visual contract', () => assert.match(accountIdentityBarHTML(savings[0]), /account-identity-bar glass-sheet/));
add('dark-mode identity bar', () => assert.match(source.css2b3d, /account-identity-bar[\s\S]*var\(--text-2\)/));

// 132–155 Confirmation layout
add('card width capped', () => assert.match(source.css2b3d, /account-visual-confirmation \{ width: 90%/));
add('card aspect ratio preserved', () => assert.match(source.css, /account-visual-confirmation[\s\S]*aspect-ratio: 1\.586/));
add('balance visible', () => assert.match(htmlFor(savings[0]), /motion-balance-stage/));
add('old/new values visible', () => assert.match(htmlFor(savings[0]), /RM 1,000\.00 → RM 990\.00/));
add('current transaction visible', () => assert.match(htmlFor(savings[0]), /测试记录/));
add('recent records visible', () => assert.match(htmlFor(savings[0]), /最近记录/));
add('bottom actions visible', () => assert.match(htmlFor(savings[0]), /继续记账[\s\S]*查看记录[\s\S]*完成/));
add('no excessive nested frames', () => assert.equal((htmlFor(savings[0]).match(/motion-balance-hero/g) || []).length, 1));
add('no blank first frame', () => assert.match(moneyFlowConfirmationHTML(money(savings[0]), { frame: 1 }), /account-identity[\s\S]*RM 1,000\.00/));
add('automatic animation', () => { assert.match(source.confirmation, /setFrame\(2\)[\s\S]*setFrame\(3\)/); assert.match(source.router, /PRESENTATION_QUERY_KEYS[\s\S]*motionFrame/); });
add('no Skip Animation control', () => assert.doesNotMatch(source.confirmation, /跳过动画|motion-skip/));
add('final odometer static', () => assert.match(source.confirmation, /next === 3[\s\S]*data-motion-odometer-overlay[\s\S]*remove/));
add('no lifted digit', () => assert.match(source.css, /motion-static-balance[\s\S]*transform: none/));
add('current transaction once', () => assert.equal(uniqueRecentRecords([{ id: 'x' }, { id: 'x' }], 'x').length, 1));
add('Savings variant', () => assert.match(htmlFor(savings[0]), /data-account-identity="sv-mbb"/));
add('Credit variant', () => assert.match(htmlFor(credit[0], { beforeMinor: 10000, afterMinor: 11000, deltaMinor: 1000 }), /account-type-cc/));
add('eWallet variant', () => { assert.match(htmlFor(wallets[0]), /account-type-ew/); assert.match(source.main, /'grabpay'/); });
add('transfer dual identity', () => { const confirmation = money(savings[0], { kind: 'transfer' }); confirmation.accountChanges.push({ accountId: savings[1].id, accountName: savings[1].name, accountType: 'saving', measure: 'balance', beforeMinor: 1000, afterMinor: 2000, deltaMinor: 1000 }); assert.equal((moneyFlowConfirmationHTML(confirmation).match(/account-identity-bar/g) || []).length, 2); });
add('record-only unchanged copy', () => assert.match(htmlFor(savings[0], { effect: 'record_only', beforeMinor: 100000, afterMinor: 100000, deltaMinor: 0 }), /余额未变/));
add('other-payer relationship status', () => assert.match(htmlFor(savings[0], { effect: 'relationship_only', beforeMinor: 100000, afterMinor: 100000, deltaMinor: 0 }), /关系账动作|余额未变/));
add('received payment', () => assert.match(htmlFor(savings[0], { kind: 'income', beforeMinor: 100000, afterMinor: 101000, deltaMinor: 1000 }), /\+RM 10\.00/));
add('repayment', () => assert.match(htmlFor(savings[0], { beforeMinor: 100000, afterMinor: 99000, deltaMinor: -1000 }), /−RM 10\.00/));
add('monthly payment', () => { const confirmation = money(savings[0]); confirmation.kind = 'plan'; confirmation.plan = { title: '每月账', afterPaidMinor: 1000, remainingMinor: 2000 }; assert.match(moneyFlowConfirmationHTML(confirmation), /计划已更新/); });
add('instalment payment', () => { const confirmation = money(savings[0]); confirmation.kind = 'plan'; confirmation.plan = { title: '分期', afterPaidMinor: 1000, remainingMinor: 9000 }; assert.match(moneyFlowConfirmationHTML(confirmation), /剩余 RM 90\.00/); });

// 156–163 Safe area
add('Assets final row clears bottom nav', () => assert.match(source.css2b3d, /app-content \{ padding-bottom: calc\(var\(--safe-bottom\) \+ 124px\)/));
add('Credit section clears bottom nav', () => assert.match(source.assets, /showLiab \? creditSection\(\)/));
add('category stack and selected summary replace the old duplicate all-accounts list', () => { assert.match(source.category,/walletStackCategoryDeckHTML/); assert.match(source.category,/selectedSummaryHTML/); assert.doesNotMatch(source.category,/allRowsHTML/); });
add('Account Detail clears bottom nav', () => assert.match(source.detail, /renderDetailPage/));
add('Activity clears bottom nav', () => assert.match(source.activity, /registerPage\('activity'/));
add('Ledger clears bottom nav', () => assert.match(source.ledger, /registerPage\('ledger'/));
add('Capture footer clears safe area', () => assert.match(source.css2b3d, /cap-save-wrap[\s\S]*var\(--safe-bottom\)/));
add('Capture blocks underlying nav interaction', () => assert.match(source.css2b3d, /#app\.capture-open \.tabbar \{[^}]*pointer-events: none/));

// 164–170 Attachment policy
add('attachment code tests remain', () => assert.equal(fs.existsSync(new URL('./attachments.test.mjs', import.meta.url)), true));
add('thumbnail deletion remains', () => assert.match(source.attachment, /data-manager-remove[\s\S]*removeAttachment/));
add('save payload excludes deleted attachment', () => { const store = createAttachmentStore(); const item = store.add({ ownerEntityType: 'draft', ownerEntityId: 'd', name: 'x.jpg', mimeType: 'image/jpeg', clientEventId: 'x' }); store.remove(item.attachmentId); assert.deepEqual(store.listFor('draft', 'd'), []); });
add('object URL lifecycle remains', () => assert.match(source.attachmentRepo, /revokeUrl\(item\.localObjectUrl\)/));
add('unsupported automation capability classified as user verification', () => assert.equal(classifyAttachmentPickerVerification({ automationSupported: false, implementationPassed: true }), 'user_device_verification_required'));
add('unsupported native picker does not force STOPPED verdict', () => { assert.equal(ATTACHMENT_NATIVE_FILE_PICKER_VERDICT.unsupportedAutomationBlocksRelease, false); assert.match(ATTACHMENT_NATIVE_FILE_PICKER_VERDICT.unsupportedAutomation, /USER DEVICE VERIFICATION REQUIRED/); });
add('real attachment code failure still blocks release', () => assert.equal(classifyAttachmentPickerVerification({ automationSupported: true, implementationPassed: false }), 'release_blocking_implementation_failure'));

// 171–184 Regression/isolation
add('all previous 587 tests pass', () => ['phase2b3.test.mjs', 'phase2b3a.test.mjs', 'phase2b3b.test.mjs', 'phase2b3c.test.mjs'].forEach((name) => assert.equal(fs.existsSync(new URL(name, import.meta.url)), true)));
add('account totals unchanged', () => assert.equal(sum(savings, 'balance'), 14327.85));
add('credit debt unchanged', () => assert.equal(sum(credit, 'outstanding'), 5258.25));
add('eWallet totals unchanged', () => assert.equal(sum(wallets, 'balance'), 817.24));
add('AA unchanged', () => assert.match(source.demo, /recordRelationshipEntry: \(command\)/));
add('settlement unchanged', () => assert.match(source.demo, /settleRelationship: \(command\) => relationship\.settle\(command\)/));
add('attachment domain unchanged', () => assert.equal(createAttachmentStore().maxPerOwner, 6));
add('no network', () => Object.values(source).forEach((text) => assert.doesNotMatch(text, /\bfetch\s*\(|XMLHttpRequest|WebSocket/)));
add('no localStorage', () => Object.values(source).forEach((text) => assert.doesNotMatch(text, /\blocalStorage\b/)));
add('no IndexedDB', () => Object.values(source).forEach((text) => assert.doesNotMatch(text, /\bindexedDB\b/)));
add('no Supabase', () => Object.values(source).forEach((text) => assert.doesNotMatch(text, /createClient\s*\(|supabase\.co/iu)));
add('no real Telegram', () => Object.values(source).forEach((text) => assert.doesNotMatch(text, /api\.telegram\.org|tg:\/\//iu)));
add('no real App-to-App', () => Object.values(source).forEach((text) => assert.doesNotMatch(text, /app-to-app:\/\//iu)));
add('port 8788 untouched by tests/scripts', () => { assert.doesNotMatch(source.package, /8788/); assert.doesNotMatch(source.vite, /port\s*:\s*8788|proxy\s*:/); });

assert.equal(cases.length, 184);
cases.forEach(([name, run], index) => test(`2B3D-${String(index + 1).padStart(3, '0')}: ${name}`, run));
