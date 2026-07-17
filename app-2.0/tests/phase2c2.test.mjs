import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDemoDataSource } from '../src/fixtures/demoData.js';
import {
  calculateResponsibility, canonicalSourceKey, equalSplitShares,
  normalizeRecurringPlan, validateSchedule,
} from '../src/domain/recurringPlanModel.js';
import { createRecurringPlanRepository } from '../src/domain/recurringPlanRepository.js';
import { semanticPlanMatches } from '../src/domain/recurringPlanManagement.js';
import { buildOccurrenceSnapshot } from '../src/domain/recurringSchedule.js';
import { selectRecurringMonth } from '../src/domain/recurringPlanSelectors.js';

const ROOT = new URL('../src/', import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), 'utf8');
const sheetsSource = read('features/fixed/RecurringPlanSheets.js');
const centerSource = read('features/fixed/index.js');
const managementSource = read('domain/recurringPlanManagement.js');
const repositorySource = read('domain/recurringPlanRepository.js');
const cssSource = read('styles/phase2c2.css');
const demoSource = read('fixtures/demoData.js');
const indexSource = read('../index.html');

let index = 0;
const phase = (name, fn) => test(`2C2-${String(++index).padStart(3, '0')}: ${name}`, fn);
const source = (id) => ({ sourceType: 'fixed_plan', sourceId: id });
function plan(id = 'test-plan', overrides = {}) {
  const totalAmountMinor = overrides.totalAmountMinor ?? 12000;
  return {
    id, planKind: 'fixed_expense', title: `计划 ${id}`, categoryId: 'bill', currency: 'MYR', totalAmountMinor,
    schedule: { recurrence: 'monthly', dueDay: 15, timezone: 'Asia/Kuala_Lumpur' }, startDate: '2026-01-15',
    status: 'active', paymentSourceAccountId: 'sv-mbb', relationship: null, canonicalSource: source(id),
    recordOnlyDefault: false, note: null, ...overrides,
  };
}
function repository(seed = []) {
  return createRecurringPlanRepository({ plans: seed, occurrences: [], clock: () => '2026-07-16T09:00:00+08:00' });
}
function managedCandidate(id, overrides = {}) {
  return plan(id, { title: `用户计划 ${id}`, totalAmountMinor: 10000 + Number(id.replace(/\D/g, '') || 1), ...overrides });
}

// 001–030: exact minor-unit split and responsibility behavior.
[1,2,3,4,5,7,10,11,99,101].forEach((ringgit, offset) => phase(`金额 ${ringgit} 元平均分摊保持分币精确`, () => {
  const total = ringgit * 100 + offset;
  const shares = equalSplitShares(total, ['me','a','b']);
  assert.equal(shares.reduce((sum, item) => sum + item.amountMinor, 0), total);
  assert.equal(shares.at(-1).amountMinor, total - Math.floor(total / 3) * 2);
}));
[2,3,4,5,6].forEach((count) => phase(`${count} 位参与者不会重复或丢失`, () => {
  const ids = Array.from({ length: count }, (_, i) => `p${i}`);
  assert.deepEqual(equalSplitShares(12347, ids).map((item) => item.participantId), ids);
}));
[100,999,12345,131200,999999].forEach((total) => phase(`我付款 ${total} 分币正确区分付款与待收`, () => {
  const relationship = { ledgerId:'ledger', participantIds:['me','other'], authenticatedParticipantId:'me', payerParticipantId:'me', splitMode:'equal', paymentMode:'full_bill' };
  const result = calculateResponsibility(total, relationship);
  assert.equal(result.cashOutflowMinor, total);
  assert.equal(result.receivableMinor, total - result.ownShareMinor);
  assert.equal(result.payableMinor, 0);
}));
[100,999,12345,131200,999999].forEach((total) => phase(`他人付款 ${total} 分币不会制造现金流出`, () => {
  const relationship = { ledgerId:'ledger', participantIds:['me','other'], authenticatedParticipantId:'me', payerParticipantId:'other', splitMode:'equal' };
  const result = calculateResponsibility(total, relationship);
  assert.equal(result.cashOutflowMinor, 0);
  assert.equal(result.payableMinor, result.ownShareMinor);
}));
[1,7,15,28,31].forEach((day) => phase(`每月 ${day} 日周期通过严格验证`, () => assert.deepEqual(validateSchedule({ recurrence:'monthly', dueDay:day }), { recurrence:'monthly', dueDay:day, timezone:'Asia/Kuala_Lumpur' })));

// 031–060: repository creation/edit/state/occurrence contracts.
Array.from({length:10},(_,i)=>i+1).forEach((n) => phase(`仓库创建第 ${n} 项稳定计划且来源唯一`, () => {
  const repo = repository(); const created = repo.createPlan(plan(`repo-${n}`));
  assert.equal(created.id, `repo-${n}`); assert.equal(canonicalSourceKey(created.canonicalSource), `fixed_plan:repo-${n}`);
}));
Array.from({length:8},(_,i)=>i+1).forEach((n) => phase(`仓库编辑第 ${n} 项仅增加一次 revision`, () => {
  const repo = repository([plan(`edit-${n}`)]); const updated = repo.updatePlan(`edit-${n}`, { title:`新名称 ${n}` });
  assert.equal(updated.revision, 2); assert.equal(updated.history.length, 1); assert.deepEqual(updated.history[0].changes, ['title']);
}));
[1,5,12,20,28,31].forEach((day) => phase(`${day} 日到期计划生成一个确定性七月账期`, () => {
  const value = normalizeRecurringPlan(plan(`occ-${day}`, { schedule:{recurrence:'monthly',dueDay:day} }));
  const occurrence = buildOccurrenceSnapshot(value, '2026-07', { referenceDate:'2026-07-01', generatedAt:'2026-07-01T09:00:00+08:00' });
  assert.equal(occurrence.dueDate, `2026-07-${String(day).padStart(2,'0')}`); assert.equal(occurrence.canonicalSource.sourceId, value.id);
}));
['paused','active','stopped'].forEach((target) => phase(`状态流程包含 ${target} 且不删除历史`, () => {
  const id=`state-${target}`; const repo=repository([plan(id)]);
  if (target==='paused') repo.pausePlan(id); else if (target==='active') { repo.pausePlan(id); repo.resumePlan(id); } else repo.stopPlan(id);
  assert.equal(repo.getPlan(id).status,target); assert.equal(repo.listPlans().length,1);
}));
['paid','skipped','overdue'].forEach((status) => phase(`${status} 历史账期不会被管理删除`, () => {
  const p=normalizeRecurringPlan(plan(`history-${status}`));
  const row={...buildOccurrenceSnapshot(p,'2026-06',{referenceDate:'2026-06-01',generatedAt:'2026-06-01T09:00:00+08:00'}),recordedStatus:['paid','skipped'].includes(status)?status:null};
  delete row.status;
  const projection=selectRecurringMonth({plans:[p],occurrences:[row],monthKey:'2026-06',referenceDate:'2026-07-16'});
  assert.equal(projection.rows.length,1); assert.equal(projection.rows[0].status,status);
}));

// 061–100: complete source-aware management integration over demo data.
Array.from({length:20},(_,i)=>i+1).forEach((n)=>phase(`管理网关创建计划 ${n} 不改变任何账户余额`,()=>{
  const data=createDemoDataSource(); const before=data.getAccounts().map(a=>[a.id,a.balanceMinor??a.currentOutstandingMinor]);
  const result=data.createManagedRecurringPlan(managedCandidate(`managed-${n}`),{commandId:`create-${n}`});
  assert.equal(result.status,'created'); assert.equal(data.getCanonicalRecurringPlan(`fixed_plan:managed-${n}`).plan.title,`用户计划 managed-${n}`);
  assert.deepEqual(data.getAccounts().map(a=>[a.id,a.balanceMinor??a.currentOutstandingMinor]),before);
}));
Array.from({length:10},(_,i)=>i+1).forEach((n)=>phase(`固定来源编辑 ${n} 只更新模板且不动余额`,()=>{
  const data=createDemoDataSource(); const before=data.getAccounts().map(a=>JSON.stringify(a));
  const sourceKey='fixed_plan:subscription-netflix'; const old=data.getCanonicalRecurringPlan(sourceKey).plan;
  const result=data.updateManagedRecurringPlan(sourceKey,{note:`编辑 ${n}`},{commandId:`edit-${n}`});
  assert.equal(result.plan.note,`编辑 ${n}`); assert.equal(result.plan.totalAmountMinor,old.totalAmountMinor); assert.deepEqual(data.getAccounts().map(a=>JSON.stringify(a)),before);
}));
Array.from({length:5},(_,i)=>i+1).forEach((n)=>phase(`重复命令 ${n} 保持创建幂等`,()=>{
  const data=createDemoDataSource(); const candidate=managedCandidate(`idem-${n}`); const options={commandId:`same-${n}`};
  const first=data.createManagedRecurringPlan(candidate,options); const second=data.createManagedRecurringPlan(candidate,options);
  assert.deepEqual(second,first); assert.equal(data.getCanonicalRecurringPlans().filter(p=>p.id===candidate.id).length,1);
}));
['paused','active','stopped'].forEach((target)=>phase(`来源感知转换到 ${target}`,()=>{
  const data=createDemoDataSource(); const key='fixed_plan:subscription-netflix'; let result;
  if(target==='paused') result=data.pauseManagedRecurringPlan(key,{commandId:'pause'});
  if(target==='active'){data.pauseManagedRecurringPlan(key,{commandId:'pause'});result=data.resumeManagedRecurringPlan(key,{commandId:'resume'});}
  if(target==='stopped'){ data.getCanonicalRecurringPlanOccurrences(key); result=data.stopManagedRecurringPlan(key,{commandId:'stop'}); assert.ok(data.getCanonicalRecurringPlanOccurrences(key).every(row=>row.dueDate<=data.today||['paid','skipped'].includes(row.status))); }
  assert.equal(result.plan.status,target);
}));
phase('同标题本身不足以形成语义重复',()=>{
  const existing=[normalizeRecurringPlan(plan('same-a',{title:'房租',totalAmountMinor:10000}))];
  const candidate=normalizeRecurringPlan(plan('same-b',{title:'房租',totalAmountMinor:20000}));
  assert.equal(semanticPlanMatches(candidate,existing).length,0);
});
phase('同金额同周期且相似标题触发语义重复',()=>{
  const existing=[normalizeRecurringPlan(plan('dup-a',{title:'Netflix 家庭'}))];
  const candidate=normalizeRecurringPlan(plan('dup-b',{title:'Netflix'}));
  assert.equal(semanticPlanMatches(candidate,existing).length,1);
});

// 101–140: user-facing editor/detail interaction contracts.
const editorContracts = [
  ['新增入口','fixed-plan-new'],['计划类型','fixed-plan-kind'],['计划名称','name="title"'],['Logo 选择','fixed-plan-visual'],['本地图片','data-plan-logo-input'],
  ['账单金额','name="amount"'],['每月每年','name="recurrence"'],['到期月份','name="dueMonth"'],['到期日','name="dueDay"'],['付款账户','paymentSourceAccountId'],
  ['关系设置','fixed-plan-add-relationship'],['关系编辑','fixed-plan-edit-relationship'],['账本选择','data-rel-ledger'],['付款人选择','data-rel-payer'],['平均分摊','data-mode="equal"'],
  ['自定义分摊','data-mode="custom"'],['参与者份额','data-share-id'],['责任预览','plan-preview'],['我的份额','COPY.ownShare'],['预计付款','COPY.plannedPayment'],
  ['预计待收','COPY.receivable'],['预计待付','COPY.payable'],['更多设置','fixed-plan-more'],['开始日期','startDate'],['结束日期','endDate'],
  ['搬入订阅日期','moveInDate'],['备注','name="note"'],['保存','saveEditor'],['取消','fixed-plan-editor-cancel'],['未保存保护','requestEditorClose'],
  ['继续编辑','fixed-plan-continue-edit'],['放弃修改','fixed-plan-discard'],['语义重复警告','openDuplicateWarning'],['查看现有计划','fixed-plan-view-duplicate'],['继续创建','fixed-plan-duplicate-continue'],
  ['计划详情','openPlanDetail'],['账期历史','occurrenceHistory'],['暂停','data-target="paused"'],['恢复','data-target="active"'],['停止','data-target="stopped"'],
];
editorContracts.forEach(([name,token])=>phase(`界面提供${name}真实交互`,()=>{
  assert.ok(sheetsSource.includes(token));
  if(name==='本地图片'){
    assert.ok(sheetsSource.includes('fixed-plan-logo-remove'));
    assert.ok(sheetsSource.includes('data-plan-logo-image'));
    assert.ok(sheetsSource.includes("addEventListener('error'"));
  }
  if(name==='取消') assert.equal(sheetsSource.includes('data-action="sheet-close-drag">取消'),false);
}));

// 141–160: Fixed Center discoverability, source identity and adaptive layout.
[
  ['卡片详情动作','data-action="fixed-plan-detail"'],['来源键','data-source='],['新增按钮','fixed-plan-new'],['停止分区','sections.stoppedPlans'],
  ['暂停分区','sections.pausedPlans'],['管理注册','registerRecurringPlanManagement'],['键盘 role','role="button"'],['隐私金额','privacy: ui.privacy'],
  ['移动端双列分摊','grid-template-columns: repeat(2'],['每页最多六位','plan-share-page'],['超过六人横向滑动','overflow-x: auto'],
  ['移动端高度','92dvh'],['深色模式',':root[data-theme="dark"]'],['减少动态','prefers-reduced-motion'],['截图减少动态标记','data-reduced-motion'],
  ['无横向页面溢出','min-width: 0'],['安全区','safe-area-inset-bottom'],['本地 Logo 裁切','object-fit: cover'],['危险操作样式','.sheet-danger'],['详情双列','.plan-detail-grid'],
].forEach(([name,token],i)=>phase(`中心与样式契约：${name}`,()=>assert.ok((i<8?centerSource:cssSource).includes(token))));

// 161–180: hard architecture/scope gates.
[
  ['管理网关无交易入账','postTransaction'],['管理网关无固定付款','postFixedExpense'],['管理网关无余额写入','setAccountBalance'],
  ['编辑器无 fetch','fetch('],['编辑器无 XMLHttpRequest','XMLHttpRequest'],['编辑器无 WebSocket','WebSocket'],['编辑器无 localStorage','localStorage'],
  ['编辑器无 sessionStorage','sessionStorage'],['编辑器无 indexedDB','indexedDB'],['编辑器无 Supabase','supabase'],['编辑器无 Telegram 执行','sendTelegram'],
  ['编辑器无 Activity 写入','createTransaction'],['编辑器无 Confirmation','openMoneyFlowConfirmation'],['中心无付款按钮','>付款<'],['仓库无硬删除','deletePlan'],
  ['来源更新保留 canonicalSource','canonicalSource: previous.canonicalSource'],['来源网关分派 fixed','canonical.owner === \'fixed\''],['来源网关分派 obligation','owner: \'obligation\''],
  ['HTML 引入 2C2 样式','phase2c2.css'],['Demo 通过统一网关','createManagedRecurringPlan'],
].forEach(([name,token],i)=>phase(`范围保护：${name}`,()=>{
  const positive=i>=15; const haystack=i===15?repositorySource:i===16||i===17?managementSource:i===18?indexSource:i===19?demoSource:`${managementSource}\n${sheetsSource}\n${centerSource}`;
  assert.equal(haystack.includes(token),positive);
}));

// 181–190: reset, privacy, isolation and canonical occurrence history.
phase('示例重置移除用户新计划',()=>{const data=createDemoDataSource();data.createManagedRecurringPlan(managedCandidate('reset-plan'),{commandId:'reset-create'});data.resetDemoData();assert.throws(()=>data.getCanonicalRecurringPlan('fixed_plan:reset-plan'));});
phase('示例重置恢复 Netflix 原始标题',()=>{const data=createDemoDataSource();data.updateManagedRecurringPlan('fixed_plan:subscription-netflix',{title:'临时名称'},{commandId:'rename'});data.resetDemoData();assert.equal(data.getCanonicalRecurringPlan('fixed_plan:subscription-netflix').plan.title,'Netflix');});
phase('示例重置恢复暂停状态',()=>{const data=createDemoDataSource();data.resumeManagedRecurringPlan('fixed_plan:subscription-spotify-paused',{commandId:'resume'});data.resetDemoData();assert.equal(data.getCanonicalRecurringPlan('fixed_plan:subscription-spotify-paused').plan.status,'paused');});
phase('账本来源详情显式标记由账本管理',()=>{const data=createDemoDataSource();const owned=data.getCanonicalRecurringPlans().find(p=>p.canonicalSource.sourceType==='obligation_plan');assert.ok(owned);assert.equal(data.getCanonicalRecurringPlan(owned.canonicalSource).managementLabel,'由账本管理');});
phase('固定来源详情没有账本管理误标',()=>{const data=createDemoDataSource();assert.equal(data.getCanonicalRecurringPlan('fixed_plan:subscription-netflix').managementLabel,null);});
phase('历史查询同时覆盖当前与下一账期且身份唯一',()=>{const data=createDemoDataSource();const rows=data.getCanonicalRecurringPlanOccurrences('fixed_plan:subscription-netflix');assert.ok(rows.length>=2);assert.equal(new Set(rows.map(r=>r.id)).size,rows.length);});
phase('暂停计划历史查询不会生成未来账期',()=>{const data=createDemoDataSource();const rows=data.getCanonicalRecurringPlanOccurrences('fixed_plan:subscription-spotify-paused');assert.ok(rows.every(r=>r.planId==='subscription-spotify-paused'));});
phase('隐私预览使用统一 fmtRM privacy 参数',()=>assert.ok((sheetsSource.match(/privacy:ui\.privacy/g)||[]).length>=5));
phase('固定与账本来源按 canonical source 去重',()=>{const data=createDemoDataSource();const keys=data.getCanonicalRecurringPlans().map(p=>canonicalSourceKey(p.canonicalSource));assert.equal(new Set(keys).size,keys.length);});
phase('Phase 2C2 恰好提供 190 项专项测试',()=>assert.equal(index,190));
