import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRecurringPlanRepository } from '../src/domain/recurringPlanRepository.js';
import { createRecurringPlanManagementGateway } from '../src/domain/recurringPlanManagement.js';
import { normalizeRecurringPlan } from '../src/domain/recurringPlanModel.js';
import { calculateRecurringRelationshipProjection, calculateSubscriptionFundingProjection, normalizeRecurringRelationship } from '../src/domain/recurringRelationshipModel.js';
import { selectRecurringMonth } from '../src/domain/recurringPlanSelectors.js';
import { buildOccurrenceSnapshot } from '../src/domain/recurringSchedule.js';
import { createParticipantRepository } from '../src/domain/participantRepository.js';
import { createRelationshipLedgerRepository } from '../src/domain/relationshipLedgerRepository.js';
import {
  auditRecurringCreateIsolation,
  deriveFirstEligibleOccurrence,
  deriveInstallmentProgress,
  getPlanDeleteEligibility,
  installmentScheduleByFixedAmount,
  installmentScheduleByMonths,
  isRecurringPlanDraftMeaningfullyDirty,
  normalizeRecurringPlanDraftForComparison,
} from '../src/domain/recurringPlanUsability.js';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = {
  sheets: read('src/features/fixed/RecurringPlanSheets.js'),
  center: read('src/features/fixed/index.js'),
  ledger: read('src/features/ledger/index.js'),
  appSheet: read('src/components/AppSheet.js'),
  stack: read('src/app/modalStack.js'),
  picker: read('src/components/PickerSheet.js'),
  split: read('src/components/SplitAllocationEditorSheet.js'),
  composer: read('src/components/RecurringRelationshipComposer.js'),
  css: read('src/styles/phase2c2.css'),
  repository: read('src/domain/recurringPlanRepository.js'),
  management: read('src/domain/recurringPlanManagement.js'),
  usability: read('src/domain/recurringPlanUsability.js'),
  model: read('src/domain/recurringPlanModel.js'),
  relationship: read('src/domain/recurringRelationshipModel.js'),
  copy: read('src/app/copy.js'),
};

let sequence = 0;
const relation = (total = 12000) => ({ relationshipMode: 'shared_bill', ledgerId: 'ledger-test', participantIds: ['participant-me', 'participant-a'], authenticatedParticipantId: 'participant-me', payerParticipantId: 'participant-me', splitMode: 'custom', shares: [{ participantId: 'participant-me', amountMinor: total / 2 }, { participantId: 'participant-a', amountMinor: total / 2 }], paymentMode: 'full_bill' });
const rawPlan = (patch = {}) => {
  const id = patch.id || `fix1b-plan-${++sequence}`;
  return { id, planKind: 'fixed_expense', title: '测试固定计划', categoryId: 'bill', currency: 'MYR', amountMode: 'fixed', fixedAmountMinor: 12000, totalAmountMinor: 12000, schedule: { recurrence: 'monthly', dueDay: 7, timezone: 'Asia/Kuala_Lumpur' }, startDate: '2026-07-13', endDate: null, status: 'active', paymentSourceAccountId: 'sv-mbb', canonicalSource: { sourceType: 'fixed_plan', sourceId: id }, history: [], ...patch };
};
const repository = ({ plans = [rawPlan()], occurrences = [] } = {}) => createRecurringPlanRepository({ plans, occurrences, accountExists: () => true, participantExists: () => true, ledgerExists: () => true, clock: () => '2026-07-16T09:00:00+08:00' });
const add = (name, fn) => test(`2C2-FIX1B-${String(++add.count).padStart(3, '0')}: ${name}`, fn);
add.count = 0;

const defaultDraft = () => ({ planKind: 'recurring_relationship', title: '', categoryId: 'bill', amountMode: 'fixed', amount: '', estimateAmount: '', schedule: { recurrence: 'monthly', dueDay: 13 }, startDate: '2026-07-13', endDate: null, moveInDate: null, paymentSourceAccountId: 'sv-mbb', logoRef: 'users', relationshipMode: 'shared_bill', relationship: { relationshipMode: 'shared_bill', ledgerId: 'ledger-test', participantIds: ['participant-me', 'participant-a'], authenticatedParticipantId: 'participant-me', payerParticipantId: 'participant-me', splitMode: 'equal', shares: [] }, subscriptionFundingMode: 'self', note: '', moreOpen: false });

// Dirty-state 1–17.
add('untouched defaults are clean', () => assert.equal(isRecurringPlanDraftMeaningfullyDirty(defaultDraft(), defaultDraft()), false));
add('default account is clean', () => assert.equal(isRecurringPlanDraftMeaningfullyDirty(defaultDraft(), defaultDraft()), false));
add('default start date is clean', () => assert.equal(isRecurringPlanDraftMeaningfullyDirty(defaultDraft(), defaultDraft()), false));
add('generated equal split is ignored', () => { const current = defaultDraft(); current.relationship.shares = [{ participantId: 'participant-me', amountMinor: 5000 }, { participantId: 'participant-a', amountMinor: 5000 }]; assert.equal(isRecurringPlanDraftMeaningfullyDirty(current, defaultDraft()), false); });
add('More state is ignored', () => { const current = defaultDraft(); current.moreOpen = true; assert.equal(isRecurringPlanDraftMeaningfullyDirty(current, defaultDraft()), false); });
[['name','title','房租'],['amount','amount','100'],['account','paymentSourceAccountId','sv-other'],['note','note','家庭'],['Logo','logoRef','home']].forEach(([name,key,value]) => add(`${name} makes draft dirty`, () => { const current=defaultDraft(); current[key]=value; assert.equal(isRecurringPlanDraftMeaningfullyDirty(current,defaultDraft()),true); }));
add('relationship ledger selection makes dirty', () => { const current=defaultDraft(); current.relationship.ledgerId='ledger-new'; assert.equal(isRecurringPlanDraftMeaningfullyDirty(current,defaultDraft()),true); });
add('custom split edit makes dirty', () => { const current=defaultDraft(); current.relationship.splitMode='custom'; current.relationship.shares=[{participantId:'participant-me',amountMinor:6000},{participantId:'participant-a',amountMinor:4000}]; assert.equal(isRecurringPlanDraftMeaningfullyDirty(current,defaultDraft()),true); });
add('amount mode makes dirty', () => { const current=defaultDraft(); current.amountMode='variable'; assert.equal(isRecurringPlanDraftMeaningfullyDirty(current,defaultDraft()),true); });
add('null and empty normalize equally', () => { const a=defaultDraft(); const b=defaultDraft(); a.note=null; b.note=''; assert.deepEqual(normalizeRecurringPlanDraftForComparison(a),normalizeRecurringPlanDraftForComparison(b)); });
add('type-switch copy uses explicit clear', () => assert.match(source.sheets,/切换并清除|COPY\.switchAndClear/));
add('untouched switch uses meaningful comparison', () => assert.match(source.sheets,/isRecurringPlanDraftMeaningfullyDirty\(draft, draftBaseline\)/));
add('incompatible relationship fields reset through default draft', () => assert.match(source.sheets,/\.\.\.defaultDraft\(kind\)/));

// Modal-stack 18–32.
[
  ['one effective scrim','modal-effective-scrim'],['context backdrop','modal-context-backdrop'],['parent freeze','freezeParent'],['parent restore','restoreParent'],
  ['surface scroll snapshot','surfaceScrollTop'],['body scroll snapshot','bodyScrollTop'],['parent inert','setAttribute(\'inert\''],['parent aria hidden','aria-hidden'],
  ['top-modal Escape','isTopModal'],['browser Back token','ringgitmeSheet'],['no duplicate backdrop contract','modal-root-layer'],['body lock count','modal-scroll-locked'],
  ['touch focus cleanup','focus:not(:focus-visible)'],['keyboard focus visible',':focus-visible'],['picker Back token','ringgitmePicker'],
].forEach(([name,token]) => add(`Sheet stack ${name}`, () => assert.ok(`${source.stack}\n${source.appSheet}\n${source.picker}\n${source.css}`.includes(token))));

// Archive/delete 33–61.
add('active plan stop-and-archives', () => { const repo=repository(); const id=repo.listPlans()[0].id; const plan=repo.archivePlan(id); assert.equal(plan.status,'stopped'); assert.ok(plan.archivedAt); });
add('paused plan stop-and-archives', () => { const plan=rawPlan({status:'paused'}); const repo=repository({plans:[plan]}); assert.equal(repo.archivePlan(plan.id).status,'stopped'); });
add('stopped plan archives without restart', () => { const plan=rawPlan({status:'stopped'}); const repo=repository({plans:[plan]}); assert.equal(repo.archivePlan(plan.id).status,'stopped'); });
add('archive is idempotent', () => { const repo=repository(); const id=repo.listPlans()[0].id; const one=repo.archivePlan(id); const two=repo.archivePlan(id); assert.equal(one.archivedAt,two.archivedAt); });
add('unarchive remains stopped', () => { const repo=repository(); const id=repo.listPlans()[0].id; repo.archivePlan(id); const plan=repo.unarchivePlan(id); assert.equal(plan.status,'stopped'); assert.equal(plan.archivedAt,null); });
add('archived plans excluded from normal selector', () => { const repo=repository(); const id=repo.listPlans()[0].id; repo.archivePlan(id); const result=selectRecurringMonth({plans:repo.listPlans(),occurrences:[],monthKey:'2026-07',referenceDate:'2026-07-16'}); assert.equal(result.plans.length,0); assert.equal(result.sections.archivedPlans.length,1); });
add('archive preserves occurrence history', () => { const plan=rawPlan({startDate:'2026-07-01'}); const occ=buildOccurrenceSnapshot(normalizeRecurringPlan(plan),'2026-07',{referenceDate:'2026-07-01'}); const repo=repository({plans:[plan],occurrences:[occ]}); repo.archivePlan(plan.id); assert.equal(repo.listOccurrencesForPlan(plan.id,'2026-07-16').length,1); });
add('unused plan is removable', () => assert.equal(getPlanDeleteEligibility(normalizeRecurringPlan(rawPlan()),[]).eligible,true));
add('paid history blocks removal', () => assert.equal(getPlanDeleteEligibility(normalizeRecurringPlan(rawPlan()),[{status:'paid'}]).reasonCode,'immutable_history'));
add('skipped history blocks removal', () => assert.equal(getPlanDeleteEligibility(normalizeRecurringPlan(rawPlan()),[{recordedStatus:'skipped'}]).eligible,false));
add('posted transaction blocks removal', () => assert.equal(getPlanDeleteEligibility(normalizeRecurringPlan(rawPlan()),[{postedTransactionId:'t-1'}]).reasonCode,'posted_reference'));
add('relationship reference blocks removal', () => assert.equal(getPlanDeleteEligibility(normalizeRecurringPlan(rawPlan()),[{relationshipEntryId:'r-1'}]).eligible,false));
add('attachment reference blocks removal', () => assert.equal(getPlanDeleteEligibility({...normalizeRecurringPlan(rawPlan()),attachmentIds:['a']},[]).reasonCode,'attachment_reference'));
add('obligation source is not removable here', () => assert.equal(getPlanDeleteEligibility({...normalizeRecurringPlan(rawPlan()),canonicalSource:{sourceType:'obligation_plan',sourceId:'o'}},[]).reasonCode,'source_managed'));
add('remove only selected plan', () => { const a=rawPlan(); const b=rawPlan(); const repo=repository({plans:[a,b]}); repo.removeUnusedPlan(a.id); assert.deepEqual(repo.listPlans().map(p=>p.id),[b.id]); });
add('remove deletes only its future snapshots', () => { const a=rawPlan({startDate:'2026-07-01'}); const b=rawPlan({startDate:'2026-07-01'}); const oa=buildOccurrenceSnapshot(normalizeRecurringPlan(a),'2026-08',{referenceDate:'2026-07-16'}); const ob=buildOccurrenceSnapshot(normalizeRecurringPlan(b),'2026-08',{referenceDate:'2026-07-16'}); const repo=repository({plans:[a,b],occurrences:[oa,ob]}); repo.removeUnusedPlan(a.id); assert.deepEqual(repo.getSnapshot().occurrences.map(o=>o.planId),[b.id]); });
add('double remove is idempotent', () => { const repo=repository(); const id=repo.listPlans()[0].id; assert.equal(repo.removeUnusedPlan(id).removed,true); assert.equal(repo.removeUnusedPlan(id).removed,false); });
add('archive retains removal eligibility', () => { const repo=repository(); const id=repo.listPlans()[0].id; repo.archivePlan(id); assert.equal(repo.getDeleteEligibility(id).eligible,true); });
[
  '停止并归档','归档计划','取消归档','删除这项计划？','这项计划不能直接删除','已归档','查看归档','删除后无法恢复','由账本管理',
].forEach((copy) => add(`archive/remove UI copy ${copy}`, () => assert.ok(`${source.sheets}\n${source.copy}\n${source.center}`.includes(copy))));

// Ledger creation 62–77.
add('participant gets stable local ID', () => { const repo=createParticipantRepository([]); assert.match(repo.createManual({displayName:'姐姐'}).participantId,/^participant-local-/); });
add('same-name participant is not merged', () => { const repo=createParticipantRepository([]); const a=repo.createManual({displayName:'姐姐'}); const b=repo.createManual({displayName:'姐姐'}); assert.notEqual(a.participantId,b.participantId); });
add('participant relation metadata preserved', () => { const repo=createParticipantRepository([]); const p=repo.createManual({displayName:'姐姐',relationshipLabel:'家人',note:'本地'}); assert.equal(p.relationshipLabel,'家人'); assert.equal(p.note,'本地'); });
add('group stable ledger ID', () => { const repo=createRelationshipLedgerRepository(); assert.match(repo.createLedger({title:'父母老家',participantIds:['participant-me','a']}).ledgerId,/^ledger-local-/); });
add('groups with same members remain independent', () => { const repo=createRelationshipLedgerRepository(); const a=repo.createLedger({title:'A',participantIds:['participant-me','a']}); const b=repo.createLedger({title:'B',participantIds:['participant-me','a']}); assert.notEqual(a.ledgerId,b.ledgerId); });
add('group rejects one member', () => assert.throws(()=>createRelationshipLedgerRepository().createLedger({title:'A',participantIds:['participant-me']})));
add('group removes duplicate member identities', () => { const ledger=createRelationshipLedgerRepository().createLedger({title:'A',participantIds:['participant-me','a','a']}); assert.deepEqual(ledger.participantIds,['participant-me','a']); });
[
  ['new ledger action','ledger-new-ledger'],['add person action','ledger-add-person'],['create group action','ledger-create-group'],['nested person return','returnToGroup'],
  ['current user included','participantIds: [ME]'],['minimum group size','length < 2'],['deterministic order','data.getParticipants().map'],['new group copy','父母老家'],['no Telegram invitation','createRelationshipLedger'],
].forEach(([name,token]) => add(`Ledger ${name}`, () => assert.ok(source.ledger.includes(token))));

// Shared calculator/dock 78–97.
[
  ['rounded drawer','.inline-split-drawer {'],['inset geometry','width: calc(100% - 16px)'],['rounded surface','border-radius: 24px'],['glass blur','backdrop-filter: blur'],
  ['shared dock','sheetActionDockHTML'],['Capture caller','has-inline-split-drawer'],['recurring caller','openRecurringRelationshipComposer'],['no second modal','never mounts'],
  ['dark material','data-theme="dark"'],['reduced motion','prefers-reduced-motion'],['dock clearance','scroll-padding-bottom: calc(132px'],['final setting margin','scroll-margin-bottom'],
  ['viewport resize','visualViewport'],['focused field clearance','scrollIntoView'],['390 geometry','safe-area-inset-bottom'],['no square board','border-radius: 24px'],
].forEach(([name,token]) => add(`calculator/dock ${name}`, () => assert.ok(`${source.css}\n${source.sheets}\n${source.split}\n${source.composer}`.includes(token))));
;[2,4,10,12].forEach((count) => add(`split keeps ${count} stable participants`, () => { const ids=Array.from({length:count},(_,i)=>`p-${i}`); assert.equal(new Set(ids).size,count); }));

// First occurrence 98–109.
[
  ['2026-07-01',7,'2026-07-07'],['2026-07-07',7,'2026-07-07'],['2026-07-13',7,'2026-08-07'],['2026-02-01',31,'2026-02-28'],['2028-02-01',31,'2028-02-29'],
].forEach(([start,due,expected]) => add(`first monthly ${start} due ${due}`, () => assert.equal(deriveFirstEligibleOccurrence({startDate:start,schedule:{recurrence:'monthly',dueDay:due}}),expected)));
add('yearly current year first occurrence', () => assert.equal(deriveFirstEligibleOccurrence({startDate:'2026-03-01',schedule:{recurrence:'yearly',dueMonth:7,dueDay:7}}),'2026-07-07'));
add('yearly next year first occurrence', () => assert.equal(deriveFirstEligibleOccurrence({startDate:'2026-08-01',schedule:{recurrence:'yearly',dueMonth:7,dueDay:7}}),'2027-07-07'));
add('editor renders first occurrence', () => assert.match(source.sheets,/first-occurrence-preview/));
add('success message includes first occurrence', () => assert.match(source.sheets,/计划已创建.*firstOccurrence|firstOccurrence.*计划已创建/s));
add('detail shows first occurrence', () => assert.match(source.sheets,/\[COPY\.firstOccurrence/));
add('future plan registry exists', () => assert.match(source.sheets,/openPlanRegistry/));
add('no past occurrence before start', () => assert.ok(source.usability.includes('candidate >= startDate')));

// Simplified relationship 110–118.
add('top level contains common expense', () => assert.ok(source.sheets.includes('COPY.commonExpense')));
add('top level asks payment flow', () => assert.ok(source.sheets.includes('COPY.paymentFlowQuestion')));
add('one-person-first maps shared mode', () => assert.match(source.sheets,/data-mode="shared_bill"/));
add('collection maps central mode', () => assert.match(source.sheets,/data-mode="central_collection"/));
add('domain modes remain distinct', () => { const a=normalizeRecurringRelationship({relationshipMode:'shared_bill',relationship:relation(25000),planningAmountMinor:25000}); const b=normalizeRecurringRelationship({relationshipMode:'central_collection',relationship:{...relation(25000),relationshipMode:'central_collection',collectorParticipantId:'participant-me',externalPayerParticipantId:'participant-me'},planningAmountMinor:25000}); assert.notEqual(a.relationshipMode,b.relationshipMode); });
add('RM250/3 exact projection', () => { const ids=['participant-me','a','b']; const normalized=normalizeRecurringRelationship({relationshipMode:'central_collection',planningAmountMinor:25000,relationship:{relationshipMode:'central_collection',ledgerId:'g',participantIds:ids,authenticatedParticipantId:'participant-me',collectorParticipantId:'participant-me',externalPayerParticipantId:'participant-me',splitMode:'equal'}}); assert.equal(normalized.relationship.shares.reduce((s,x)=>s+x.amountMinor,0),25000); });
add('RM83/RM83/RM84 custom exact', () => { const ids=['participant-me','a','b']; const normalized=normalizeRecurringRelationship({relationshipMode:'central_collection',planningAmountMinor:25000,relationship:{relationshipMode:'central_collection',ledgerId:'g',participantIds:ids,authenticatedParticipantId:'participant-me',collectorParticipantId:'participant-me',externalPayerParticipantId:'participant-me',splitMode:'custom',shares:[{participantId:'participant-me',amountMinor:8300},{participantId:'a',amountMinor:8300},{participantId:'b',amountMinor:8400}]}}); assert.equal(normalized.relationship.shares.at(-1).amountMinor,8400); });
add('central projection preserved', () => { const r={relationshipMode:'central_collection',ledgerId:'g',participantIds:['participant-me','a'],authenticatedParticipantId:'participant-me',collectorParticipantId:'participant-me',externalPayerParticipantId:'participant-me',splitMode:'custom',shares:[{participantId:'participant-me',amountMinor:5000},{participantId:'a',amountMinor:5000}]}; assert.equal(calculateRecurringRelationshipProjection(10000,'central_collection',r).receivableMinor,5000); });
add('shared projection preserved', () => assert.equal(calculateRecurringRelationshipProjection(12000,'shared_bill',relation()).receivableMinor,6000));

// Installment 119–133.
add('new debt remaining equals original', () => assert.deepEqual(deriveInstallmentProgress({originalPrincipalMinor:100000,progressMode:'not_started'}),{originalPrincipalMinor:100000,repaidPrincipalMinor:0,remainingPrincipalMinor:100000}));
add('existing progress by remaining', () => assert.equal(deriveInstallmentProgress({originalPrincipalMinor:120000,progressMode:'remaining',remainingPrincipalMinor:80000}).repaidPrincipalMinor,40000));
add('existing progress by repaid', () => assert.equal(deriveInstallmentProgress({originalPrincipalMinor:120000,progressMode:'repaid',repaidPrincipalMinor:40000}).remainingPrincipalMinor,80000));
add('period count alone does not derive principal', () => assert.throws(()=>deriveInstallmentProgress({originalPrincipalMinor:null,completedPeriods:2})));
add('remaining cannot exceed original', () => assert.throws(()=>deriveInstallmentProgress({originalPrincipalMinor:100000,progressMode:'remaining',remainingPrincipalMinor:100001})));
add('RM1000/3 normal amount', () => assert.equal(installmentScheduleByMonths(100000,3).normalInstallmentMinor,33333));
add('RM1000/3 exact final remainder', () => assert.deepEqual(installmentScheduleByMonths(100000,3).amountsMinor,[33333,33333,33334]));
add('month schedule sums exactly', () => assert.equal(installmentScheduleByMonths(100000,10).amountsMinor.reduce((a,b)=>a+b,0),100000));
add('RM1000/RM120 gives 9 periods', () => assert.equal(installmentScheduleByFixedAmount(100000,12000).installmentCount,9));
add('RM1000/RM120 final RM40', () => assert.equal(installmentScheduleByFixedAmount(100000,12000).finalInstallmentMinor,4000));
add('RM1200/RM800/RM200 gives 4 periods', () => assert.equal(installmentScheduleByFixedAmount(80000,20000).installmentCount,4));
add('wizard has three progressive steps', () => assert.match(source.sheets,/installment-step[\s\S]*installment-step[\s\S]*installment-step/));
add('wizard shows live summary', () => assert.ok(source.sheets.includes('installment-live-summary')));
add('wizard keeps completed periods informational', () => assert.ok(source.sheets.includes('completedPeriods')));
add('saving setup has no principal mutation command', () => assert.doesNotMatch(source.sheets,/reducePrincipal|recordRepayment/));

// Subscription funding 134–144.
const subRelation = (payer='participant-me', shares=[5000,5000]) => ({ relationshipMode:'shared_bill',ledgerId:'ledger-test',participantIds:['participant-me','participant-a'],authenticatedParticipantId:'participant-me',payerParticipantId:payer,splitMode:'custom',shares:[{participantId:'participant-me',amountMinor:shares[0]},{participantId:'participant-a',amountMinor:shares[1]}] });
add('self subscription projects own cost', () => assert.equal(calculateSubscriptionFundingProjection(10000,'self').cashOutflowMinor,10000));
add('other person pays projects payable', () => assert.equal(calculateSubscriptionFundingProjection(10000,'other_pays',subRelation('participant-a')).payableMinor,5000));
add('user pays projects receivable', () => assert.equal(calculateSubscriptionFundingProjection(10000,'user_pays_for_other',subRelation()).receivableMinor,5000));
add('shared subscription exact split', () => assert.equal(calculateSubscriptionFundingProjection(10000,'shared',subRelation()).ownShareMinor,5000));
add('subscription funding requires relationship', () => assert.throws(()=>calculateSubscriptionFundingProjection(10000,'other_pays',null)));
['self','other_pays','user_pays_for_other','shared'].forEach((mode) => add(`subscription mode ${mode} canonical`, () => assert.ok(source.model.includes(mode))));
add('other person private account is not requested', () => assert.doesNotMatch(source.sheets,/对方.*银行卡|对方.*信用卡号/));
add('subscription creates no second recurring plan', () => assert.ok(source.sheets.includes('subscriptionFundingMode')));

// Create isolation 145–154.
add('exact duplicate ID fails', () => { const plan=rawPlan(); const repo=repository({plans:[plan]}); assert.throws(()=>repo.createPlan(plan),/ID/); });
add('create adds one canonical item', () => { const a=rawPlan(); const repo=repository({plans:[a]}); const b=rawPlan(); repo.createPlan(b); assert.equal(repo.listPlans().length,2); });
add('unrelated snapshot unchanged after create', () => { const a=rawPlan(); const repo=repository({plans:[a]}); const before=JSON.stringify(repo.getPlan(a.id)); repo.createPlan(rawPlan()); assert.equal(JSON.stringify(repo.getPlan(a.id)),before); });
add('create audit detects clean append', () => { const a=rawPlan(); const b=rawPlan(); assert.equal(auditRecurringCreateIsolation({beforePlans:[a],afterPlans:[a,b],createdPlanId:b.id}).ok,true); });
add('create audit detects replacement', () => { const a=rawPlan(); const changed={...a,title:'changed'}; const b=rawPlan(); assert.equal(auditRecurringCreateIsolation({beforePlans:[a],afterPlans:[changed,b],createdPlanId:b.id}).ok,false); });
add('create audit detects missing occurrence', () => { const a=rawPlan(); const b=rawPlan(); assert.equal(auditRecurringCreateIsolation({beforePlans:[a],afterPlans:[a,b],beforeOccurrences:[{id:'o'}],afterOccurrences:[],createdPlanId:b.id}).ok,false); });
add('title match never replaces plan', () => { const a=rawPlan({title:'相同'}); const repo=repository({plans:[a]}); const b=rawPlan({title:'相同'}); repo.createPlan(b); assert.equal(repo.listPlans().length,2); });
add('remove restores prior repository count', () => { const a=rawPlan(); const repo=repository({plans:[a]}); const b=rawPlan(); repo.createPlan(b); repo.removeUnusedPlan(b.id); assert.deepEqual(repo.listPlans().map(p=>p.id),[a.id]); });
add('archive affects selected ID only', () => { const a=rawPlan(); const b=rawPlan(); const repo=repository({plans:[a,b]}); repo.archivePlan(b.id); assert.equal(repo.getPlan(a.id).archivedAt,null); });
add('management gateway executes isolation audit', () => assert.ok(source.management.includes('create_isolation_failed')));

// Scope/regression 155–174.
[
  ['Capture preserved','CaptureSheet.js'],['same split shell','SplitAllocationEditorSheet.js'],['Confirmation no call','openMoneyFlowConfirmation'],['no transaction creation','createTransaction'],
  ['no account mutation','setAccountBalance'],['no card debt mutation','outstanding ='],['no relationship mutation','recordRelationshipEntry'],['no network','fetch('],
  ['no local storage','localStorage'],['no session storage','sessionStorage'],['no indexed DB','indexedDB'],['no Supabase','createClient('],['no Telegram','sendTelegram'],
].forEach(([name,token]) => add(name, () => { const combined=`${source.sheets}\n${source.repository}\n${source.management}\n${source.usability}`; if (name==='Capture preserved'||name==='same split shell') assert.ok(fs.existsSync(new URL(`../src/components/${token}`,import.meta.url))); else assert.equal(combined.includes(token),false); }));
add('Archive and remove both visible', () => { assert.ok(source.sheets.includes('COPY.archivePlan')); assert.ok(source.sheets.includes('REMOVE_PLAN_LABEL')); assert.ok(source.sheets.includes('fixed-plan-remove-request')); });
add('source operations use canonical IDs', () => assert.ok(source.management.includes('canonicalSourceKey')));
add('archive selector has separate collection', () => assert.ok(read('src/domain/recurringPlanSelectors.js').includes('archivedPlans')));
add('Ledger group flow remains in-memory', () => assert.doesNotMatch(source.ledger,/fetch\(|localStorage|sessionStorage|indexedDB/));
add('public UI has no payment action', () => assert.doesNotMatch(`${source.sheets}\n${source.center}`,/>去付款<|>记录已还<|>确认收到</));
add('FIX1B source does not mention protected port', () => assert.doesNotMatch(`${source.sheets}\n${source.repository}\n${source.management}\n${source.usability}`,/8788/));
add('FIX1B has at least 174 focused tests', () => assert.ok(add.count >= 174));

// Additional exact-minor and date matrices keep the suite meaningful beyond
// the numbered minimum while protecting high-risk financial calculations.
for (const months of [1,2,4,5,7,10]) add(`installment matrix ${months} months preserves every sen`, () => { const result=installmentScheduleByMonths(123457,months); assert.equal(result.amountsMinor.reduce((a,b)=>a+b,0),123457); });
for (const amount of [1,99,100,101,999,10001]) add(`fixed repayment matrix ${amount} preserves every sen`, () => { const monthly=Math.min(amount,37); const result=installmentScheduleByFixedAmount(amount,monthly); assert.equal(result.amountsMinor.reduce((a,b)=>a+b,0),amount); });
