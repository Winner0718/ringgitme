import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAccountCardViewModel } from '../src/domain/accountCardSystem.js';
import { normalizeAsset } from '../src/domain/assetFinancialModel.js';
import { ringgitMeCardComposerHTML } from '../src/components/RinggitMeCardComposer.js';
import { walletStackCategoryDeckHTML } from '../src/components/WalletStackCategoryDeck.js';
import { createDemoDataSource } from '../src/fixtures/demoData.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const detailSource = read('src/features/assets/detail.js');
const categorySource = read('src/features/assets/category.js');
const overviewSource = read('src/features/assets/index.js');
const confirmationSource = read('src/components/MoneyFlowConfirmation.js');
const operationsSource = read('src/features/assets/AssetOperationSheets.js');
let number = 0;
const add = (title, fn) => test(`2D1B6-${String(++number).padStart(3, '0')} ${title}`, fn);
const projection = (account, context, extra = {}) => resolveAccountCardViewModel({ account, context, ...extra });
const sharedFields = (model) => ({ title:model.title, institutionName:model.institutionName, accountTypeLabel:model.accountTypeLabel, visibleIdentifier:model.visibleIdentifier, gradient:model.gradient, amountLabel:model.amountLabel, liveAmountMinor:model.liveAmountMinor });
const transaction = (kind, amount, accountId, submissionKey) => ({
  kind, amount, desc:`2D1B6 ${kind}`, catId:kind === 'income' ? 'income-salary' : 'food',
  sourceAccountId:kind === 'expense' ? accountId : null,
  destinationAccountId:kind === 'income' ? accountId : null,
  accountEffect:'posted', date:'2026-07-13', time:'10:00', submissionKey,
});

add('savings card resolves identical complete content across detail and completion', () => { const a=createDemoDataSource().getAccount('sv-mbb'); assert.deepEqual(sharedFields(projection(a,'detail')),sharedFields(projection(a,'confirmation'))); });
add('credit card resolves identical content and appearance across category detail completion', () => { const a={...createDemoDataSource().getAccount('cc-rhb'),networkId:'mastercard',tier:'Platinum'}; const values=['category','detail','completion'].map((context)=>projection(a,context)); for (const model of values.slice(1)) assert.deepEqual(sharedFields(model),sharedFields(values[0])); assert.equal(values[0].networkLabel,'Mastercard'); assert.equal(values[0].tierLabel,'Platinum'); assert.equal(values[0].visibleLastFour,'7712'); });
add('eWallet resolves identical complete content across category detail completion', () => { const a=createDemoDataSource().getAccount('ew-tng'); const values=['category','detail','completion'].map((context)=>projection(a,context)); assert.deepEqual(sharedFields(values[0]),sharedFields(values[1])); assert.deepEqual(sharedFields(values[1]),sharedFields(values[2])); });
add('custom full-card is image-only in every card context', () => { const a=normalizeAsset({id:'custom',type:'cc',name:'Custom',limit:1000,customCardImage:{dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',fileName:'card.png',mimeType:'image/png',sizeBytes:68,width:1,height:1}}); for (const context of ['category','detail','confirmation']) { const html=ringgitMeCardComposerHTML(a,{viewModel:projection(a,context)}); assert.match(html,/user-custom-card/); assert.doesNotMatch(html,/data-card-region|ringgit-card-amount|ringgit-card-network-text/); } });
add('account-level visual override beats institution defaults in every context', () => { const a={id:'one',type:'saving',name:'One',brandId:'maybank',balance:1,accountVisualOverride:{enabled:true,palette:{primary:'#123456',supporting:'#654321'}}}; ['category','detail','completion'].forEach((context)=>assert.equal(projection(a,context).primaryColor,'#123456')); });

add('savings expense updates canonical account rendering', () => { const d=createDemoDataSource(); const before=d.getAccount('sv-mbb').balanceMinor; d.addTransaction(transaction('expense',12.34,'sv-mbb','b6-expense')); const a=d.getAccount('sv-mbb'); assert.equal(a.balanceMinor,before-1234); assert.equal(projection(a,'completion').liveAmountMinor,before-1234); });
add('savings income updates canonical account rendering', () => { const d=createDemoDataSource(); const before=d.getAccount('sv-mbb').balanceMinor; d.addTransaction(transaction('income',25,'sv-mbb','b6-income')); assert.equal(projection(d.getAccount('sv-mbb'),'assets').liveAmountMinor,before+2500); });
add('eWallet expense and income update the same canonical rendering', () => { const d=createDemoDataSource(); const before=d.getAccount('ew-tng').balanceMinor; d.addTransaction(transaction('expense',5,'ew-tng','b6-ew-exp')); d.addTransaction(transaction('income',8,'ew-tng','b6-ew-inc')); assert.equal(projection(d.getAccount('ew-tng'),'detail').liveAmountMinor,before+300); });
add('transfer updates both source and destination canonical cards', () => { const d=createDemoDataSource(); const source=d.getAccount('sv-cimb').balanceMinor; const target=d.getAccount('ew-tng').balanceMinor; d.addTransaction({kind:'transfer',amount:20,desc:'move',catId:'transfer-fallback',sourceAccountId:'sv-cimb',destinationAccountId:'ew-tng',accountEffect:'posted',date:d.today,time:'10:00',submissionKey:'b6-transfer'}); assert.equal(projection(d.getAccount('sv-cimb'),'completion').liveAmountMinor,source-2000); assert.equal(projection(d.getAccount('ew-tng'),'completion').liveAmountMinor,target+2000); });
add('balance adjustment updates canonical account state', () => { const d=createDemoDataSource(); d.recordAssetTargetBalance({accountId:'sv-cimb',targetBalance:2222.22,idempotencyKey:'b6-adjust'}); assert.equal(projection(d.getAccount('sv-cimb'),'detail').liveAmountMinor,222222); });
add('credit-card expense updates debt everywhere', () => { const d=createDemoDataSource(); const before=d.getAccount('cc-rhb').totalCardDebtMinor; d.addTransaction(transaction('expense',10,'cc-rhb','b6-card-expense')); assert.equal(projection(d.getAccount('cc-rhb'),'category').liveAmountMinor,before+1000); });
add('credit-card repayment updates debt everywhere', () => { const d=createDemoDataSource(); const before=d.getAccount('cc-rhb').totalCardDebtMinor; d.recordCardPayment({cardId:'cc-rhb',sourceAccountId:'sv-mbb',amount:20,idempotencyKey:'b6-payment'}); assert.equal(projection(d.getAccount('cc-rhb'),'completion').liveAmountMinor,before-2000); });
add('completion explicitly resolves current account before a historical snapshot', () => { assert.match(confirmationSource,/data\.getAccount\(change\.accountId\) \|\| change\.accountSnapshot/); assert.doesNotMatch(confirmationSource,/change\.accountSnapshot \|\| data\.getAccount/); });
add('closing completion refreshes the page from canonical live account state', () => { assert.match(confirmationSource,/import \{ data, update \} from '\.\.\/app\/state\.js'/); assert.match(confirmationSource,/layer\.remove\(\);[^]*update\(\{\}\);[^]*callback\?\.\(\)/); });

add('Cashback is exposed only from credit-card detail actions', () => { assert.match(detailSource,/account\.type === 'cc'[^]*\['cashback'/); assert.doesNotMatch(detailSource,/\[\['transfer-in'[^]*cashback/); });
add('Cashback reduces current credit-card debt', () => { const d=createDemoDataSource(); const before=d.getAccount('cc-rhb').totalCardDebtMinor; d.recordCardCashback({cardId:'cc-rhb',amount:20,date:d.today,idempotencyKey:'b6-cashback'}); assert.equal(d.getAccount('cc-rhb').totalCardDebtMinor,before-2000); });
add('Cashback creates a distinct auditable activity record', () => { const d=createDemoDataSource(); const operation=d.recordCardCashback({cardId:'cc-rhb',amount:20,source:'Weekend',idempotencyKey:'b6-cashback-record'}); const record=d.getActivity(operation.id); assert.equal(record.kind,'cashback'); assert.equal(record.assetOperationType,'card_cashback'); assert.equal(record.desc,'Weekend'); });
add('Cashback updates summary and current card amount', () => { const d=createDemoDataSource(); d.recordCardCashback({cardId:'cc-rhb',amount:20,date:d.today,idempotencyKey:'b6-cashback-summary'}); assert.deepEqual(d.getCardCashbackSummary('cc-rhb','2026-07'),{cardId:'cc-rhb',monthKey:'2026-07',monthlyMinor:2000,totalMinor:2000,count:1}); assert.equal(projection(d.getAccount('cc-rhb'),'completion').liveAmountMinor,87000); });
add('Cashback does not affect savings or eWallet cash', () => { const d=createDemoDataSource(); const cash=d.getAccounts().filter((a)=>a.type!=='cc').map((a)=>[a.id,a.balanceMinor]); d.recordCardCashback({cardId:'cc-rhb',amount:20,idempotencyKey:'b6-cashback-cash'}); assert.deepEqual(d.getAccounts().filter((a)=>a.type!=='cc').map((a)=>[a.id,a.balanceMinor]),cash); });
add('Cashback does not inflate normal income', () => { const d=createDemoDataSource(); const before=d.getActivities().filter((a)=>a.kind==='income').length; d.recordCardCashback({cardId:'cc-rhb',amount:20,idempotencyKey:'b6-cashback-income'}); assert.equal(d.getActivities().filter((a)=>a.kind==='income').length,before); });
add('Cashback blocks a negative debt result', () => { const d=createDemoDataSource(); assert.throws(()=>d.recordCardCashback({cardId:'cc-rhb',amount:900,idempotencyKey:'b6-too-much'}),/不能超过当前信用卡欠款/); });
add('monthly Cashback total filters by operation date', () => { const d=createDemoDataSource(); d.recordCardCashback({cardId:'cc-rhb',amount:10,date:'2026-07-10',idempotencyKey:'b6-jul'}); d.recordCardCashback({cardId:'cc-rhb',amount:5,date:'2026-06-10',idempotencyKey:'b6-jun'}); assert.equal(d.getCardCashbackSummary('cc-rhb','2026-07').monthlyMinor,1000); assert.equal(d.getCardCashbackSummary('cc-rhb','2026-07').totalMinor,1500); });
add('Cashback record is visible in recent and full activity history', () => { const d=createDemoDataSource(); const operation=d.recordCardCashback({cardId:'cc-rhb',amount:20,idempotencyKey:'b6-history'}); assert.ok(d.getActivities().some((a)=>a.id===operation.id&&a.kind==='cashback')); assert.equal(d.getActivity(operation.id).amountMinor,2000); });

add('savings detail has overview information and quick-action groups', () => ['账户概览','账户资料','快捷操作'].forEach((label)=>assert.match(detailSource,new RegExp(label))));
add('eWallet detail has wallet overview information and quick-action groups', () => ['钱包概览','钱包资料','快捷操作'].forEach((label)=>assert.match(detailSource,new RegExp(label))));
add('credit detail has debt monthly card rewards and quick-action groups', () => ['欠款概览','本月账务','卡片资料','回馈与抵扣','快捷操作'].forEach((label)=>assert.match(detailSource,new RegExp(label))));
add('credit-only Cashback control is absent from bank and eWallet branch', () => { const cashBranch=detailSource.slice(detailSource.indexOf(": [['transfer-in'"),detailSource.indexOf("const actionName")); assert.doesNotMatch(cashBranch,/cashback/i); });

add('eWallet category uses the same canonical large card stack navigation', () => { assert.match(categorySource,/renderCategoryPage\(container, type\)[^]*renderWalletCategory\(container, type, list\)/); assert.match(categorySource,/walletStackCategoryDeckHTML\(list/); });
add('selected eWallet controls recent-record filtering', () => { assert.match(categorySource,/selectedAccountRecords\(activities, selected\.id\)/); assert.match(categorySource,/data-recent-account-id/); });
add('eWallet card never renders network or tier', () => { const html=ringgitMeCardComposerHTML({id:'ew',type:'ew',name:'Wallet',bank:'Provider',networkId:'visa',tier:'Infinite',balance:10}); assert.doesNotMatch(html,/data-card-region="network"|data-card-region="tier"/); });
add('eWallet custom appearance persists across category detail completion', () => { const a={id:'ew',type:'ew',name:'Wallet',balance:10,accountVisualOverride:{enabled:true,palette:{primary:'#123456',supporting:'#345678'}}}; for (const context of ['category','detail','completion']) assert.equal(projection(a,context).gradient,'linear-gradient(118deg, #123456 0%, #345678 100%)'); });

add('privacy-open bank identifier follows current full-data rule and preserves leading zeroes', () => { const a={id:'bank',type:'saving',name:'Bank',bank:'Bank',bankAccountNumber:'0012345678',balance:1}; assert.equal(projection(a,'detail',{privacyState:false}).visibleIdentifier,'0012345678'); });
add('privacy-closed masks identifiers in canonical card model', () => { const a={id:'bank',type:'saving',name:'Bank',bank:'Bank',bankAccountNumber:'0012345678',balance:1}; const model=projection(a,'detail',{privacyState:true}); assert.doesNotMatch(model.visibleIdentifier,/0012345678|0012 3456 78/); assert.match(model.visibleIdentifier,/••••/); });
add('credit-card last four masks everywhere when privacy closes', () => { const a={id:'card',type:'cc',name:'Card',bank:'Bank',creditCardLast4:'9910',limit:1000,outstanding:10}; for (const context of ['category','detail','completion']) assert.equal(projection(a,context,{privacyState:true}).visibleLastFour,'••••'); });
add('completion view uses canonical privacy-aware model without snapshot-first leakage', () => { assert.match(confirmationSource,/accountVisualCardHTML\(account/); assert.match(confirmationSource,/data\.getAccount\(change\.accountId\)/); assert.doesNotMatch(overviewSource,/model\.fullIdentifier/); assert.match(operationsSource,/cashbackConfirmation/); });

assert.equal(number, 35);
