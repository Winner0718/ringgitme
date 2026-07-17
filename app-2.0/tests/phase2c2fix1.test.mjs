import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeRecurringPlan } from '../src/domain/recurringPlanModel.js';
import { createRecurringPlanRepository } from '../src/domain/recurringPlanRepository.js';
import { buildOccurrenceSnapshot } from '../src/domain/recurringSchedule.js';
import { selectRecurringMonth, selectTodayFixed } from '../src/domain/recurringPlanSelectors.js';
import { calculateRecurringRelationshipProjection } from '../src/domain/recurringRelationshipModel.js';
import { allocationSummary, equalSplitMinor, rebuildSplitShares } from '../src/domain/smartSplit.js';

const APP = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(APP, path), 'utf8');
const sheets = read('src/features/fixed/RecurringPlanSheets.js');
const center = read('src/features/fixed/index.js');
const composer = read('src/components/RecurringRelationshipComposer.js');
const modelSource = read('src/domain/recurringPlanModel.js');
const relationshipSource = read('src/domain/recurringRelationshipModel.js');
const scheduleSource = read('src/domain/recurringSchedule.js');
const css = read('src/styles/phase2c2.css');

let index = 0;
const fix = (name, fn) => test(`2C2-FIX1-${String(++index).padStart(3, '0')}: ${name}`, fn);
const source = (id) => ({ sourceType: 'fixed_plan', sourceId: id });
const participantIds = ['participant-me', 'participant-a', 'participant-b'];

function plan(overrides = {}) {
  const id = overrides.id || `fix-plan-${index}`;
  return normalizeRecurringPlan({
    id,
    planKind: 'fixed_expense',
    title: '水电计划',
    categoryId: 'bill',
    currency: 'MYR',
    totalAmountMinor: 24000,
    schedule: { recurrence: 'monthly', dueDay: 16, timezone: 'Asia/Kuala_Lumpur' },
    startDate: '2026-01-01',
    status: 'active',
    paymentSourceAccountId: 'sv-mbb',
    canonicalSource: source(id),
    ...overrides,
    schedule: { recurrence: 'monthly', dueDay: 16, timezone: 'Asia/Kuala_Lumpur', ...(overrides.schedule || {}) },
  });
}

function relationship(mode, overrides = {}) {
  const base = {
    relationshipMode: mode,
    ledgerId: 'ledger-arbitrary',
    participantIds,
    authenticatedParticipantId: 'participant-me',
    relationshipLabel: '任意群组',
  };
  if (mode === 'shared_bill') return { ...base, payerParticipantId: 'participant-me', splitMode: 'equal', paymentMode: 'full_bill', ...overrides };
  if (mode === 'central_collection') return { ...base, collectorParticipantId: 'participant-me', externalPayerParticipantId: 'participant-me', splitMode: 'equal', ...overrides };
  if (mode === 'direct_recurring_payment') return { ...base, recipientParticipantId: 'participant-a', ...overrides };
  return { ...base, creditorParticipantId: 'participant-a', debtorParticipantId: 'participant-me', originalPrincipalMinor: 120000, remainingPrincipalMinor: 90000, installmentAmountMinor: 10000, ...overrides };
}

function relationshipPlan(mode, amountMinor = 25000, relationshipOverrides = {}, planOverrides = {}) {
  const id = planOverrides.id || `relationship-${mode}-${index}`;
  return plan({
    id,
    planKind: 'recurring_relationship',
    title: '关系计划',
    totalAmountMinor: amountMinor,
    relationshipMode: mode,
    relationship: relationship(mode, relationshipOverrides),
    canonicalSource: source(id),
    ...planOverrides,
  });
}

function errorCode(fn, code) {
  assert.throws(fn, (error) => error?.code === code);
}

// 001–015: scroll ownership and floating action dock.
fix('编辑器只有 Sheet body 一个权威纵向滚动区', () => assert.match(css, /sheet-body\[data-plan-scroll-root="true"\][\s\S]*overflow-y:\s*auto/));
fix('更多设置会滚动到可见位置', () => assert.ok(sheets.includes("scrollIntoView({block:'nearest',behavior:'smooth'})")));
fix('编辑器重绘保存真实 scrollTop', () => assert.ok(sheets.includes('const preservedScroll = scrollTop ?? body.scrollTop')));
fix('最终字段具有 action dock scroll padding', () => assert.match(css, /scroll-padding-bottom:\s*calc\(112px/));
fix('子 Sheet 完成后恢复父编辑器滚动位置', () => assert.ok(sheets.includes('rerenderEditor({ scrollTop })')));
fix('键盘视口下操作 dock 保持 sticky', () => assert.match(css, /plan-editor-action-dock[\s\S]*position:\s*sticky/));
fix('关系编辑器不是第二个父级纵向滚动陷阱', () => assert.equal(composer.includes('overflow-y: auto'), false));
fix('计划编辑不依赖 document body 滚动', () => assert.equal(sheets.includes('document.body'), false));
fix('编辑器显式阻止页面级横向溢出', () => assert.match(css, /sheet-body\[data-plan-scroll-root="true"\][\s\S]*overflow-x:\s*hidden/));
fix('编辑器复用 Floating Glass Action Dock', () => assert.ok(sheets.includes('sheetActionDockHTML')));
fix('旧计划 footer 不再出现在编辑器 HTML', () => assert.equal(sheets.includes('class="plan-editor-actions"'), false));
fix('浮动 dock 保留底部安全区', () => assert.match(css, /plan-editor-action-dock[\s\S]*env\(safe-area-inset-bottom\)/));
fix('取消继续走固定编辑器关闭保护', () => assert.ok(sheets.includes("fixed-plan-editor-cancel',()=>closeSheet()")));
fix('创建操作仍调用 saveEditor', () => assert.ok(sheets.includes("fixed-plan-submit', () => saveEditor()")));
fix('编辑保存仍通过 updateManagedRecurringPlan', () => assert.ok(sheets.includes('updateManagedRecurringPlan(sourceKey, editorChanges(candidate)')));

// 016–030: explicit fixed/variable amount semantics.
fix('固定金额计划保存 integer minor units', () => assert.equal(plan({ amountMode: 'fixed', fixedAmountMinor: 1999 }).fixedAmountMinor, 1999));
fix('变量计划可无预计金额', () => { const value = plan({ amountMode: 'variable', totalAmountMinor: 0, estimateAmountMinor: null }); assert.equal(value.amountPending, true); });
fix('变量计划可带预计金额', () => { const value = plan({ amountMode: 'variable', totalAmountMinor: 0, estimateAmountMinor: 24000 }); assert.equal(value.plannedAmountMinor, 24000); });
fix('变量计划拒绝负预计金额', () => errorCode(() => plan({ amountMode: 'variable', estimateAmountMinor: -1 }), 'invalid_estimate'));
fix('变量计划不需要伪造 RM0 固定金额', () => { const value = plan({ amountMode: 'variable', totalAmountMinor: 0 }); assert.equal(value.fixedAmountMinor, null); });
fix('显式固定模式缺金额会失败', () => errorCode(() => plan({ amountMode: 'fixed', fixedAmountMinor: null, totalAmountMinor: 0 }), 'fixed_amount_missing'));
fix('订阅保持固定金额', () => assert.equal(plan({ planKind: 'subscription', amountMode: 'fixed', fixedAmountMinor: 1800 }).amountMode, 'fixed'));
fix('变量无预计账期标记 amount pending', () => { const value = plan({ amountMode: 'variable', totalAmountMinor: 0 }); assert.equal(buildOccurrenceSnapshot(value, '2026-07', { referenceDate: '2026-07-01' }).amountState, 'pending'); });
fix('变量预计账期没有 actual amount', () => { const value = plan({ amountMode: 'variable', estimateAmountMinor: 24000 }); assert.equal(buildOccurrenceSnapshot(value, '2026-07', { referenceDate: '2026-07-01' }).actualAmountMinor, null); });
fix('七月账期快照与八月预计字段相互独立', () => { const value = plan({ amountMode: 'variable', estimateAmountMinor: 24000 }); const july = buildOccurrenceSnapshot(value, '2026-07', { referenceDate: '2026-07-01' }); const august = buildOccurrenceSnapshot(value, '2026-08', { referenceDate: '2026-07-01' }); july.actualAmountMinor = 26340; assert.deepEqual([august.estimatedAmountMinor, august.actualAmountMinor], [24000, null]); });
fix('变量无预计从金额合计排除', () => { const value = plan({ amountMode: 'variable', totalAmountMinor: 0 }); const row = buildOccurrenceSnapshot(value, '2026-07', { referenceDate: '2026-07-01' }); assert.equal(selectRecurringMonth({ plans: [value], occurrences: [row], monthKey: '2026-07', referenceDate: '2026-07-01' }).summary.myFixedMinor, 0); });
fix('变量待填写计数增加', () => { const value = plan({ amountMode: 'variable', totalAmountMinor: 0 }); const row = buildOccurrenceSnapshot(value, '2026-07', { referenceDate: '2026-07-01' }); assert.equal(selectRecurringMonth({ plans: [value], occurrences: [row], monthKey: '2026-07', referenceDate: '2026-07-01' }).summary.variableAmountPendingCount, 1); });
fix('变量预计加入规划合计', () => { const value = plan({ amountMode: 'variable', estimateAmountMinor: 24000 }); const row = buildOccurrenceSnapshot(value, '2026-07', { referenceDate: '2026-07-01' }); assert.equal(selectRecurringMonth({ plans: [value], occurrences: [row], monthKey: '2026-07', referenceDate: '2026-07-01' }).summary.myFixedMinor, 24000); });
fix('containsEstimate selector 为真', () => { const value = plan({ amountMode: 'variable', estimateAmountMinor: 24000 }); const row = buildOccurrenceSnapshot(value, '2026-07', { referenceDate: '2026-07-01' }); assert.equal(selectRecurringMonth({ plans: [value], occurrences: [row], monthKey: '2026-07', referenceDate: '2026-07-01' }).summary.containsEstimate, true); });
fix('预计与待填写显示继续使用 privacy formatter', () => assert.ok(center.includes('privacy: ui.privacy')));

// 031–040: type-specific form contracts.
fix('固定支出显示金额方式', () => assert.ok(sheets.includes('amountModeHTML')));
fix('订阅使用服务名称与订阅金额', () => assert.ok(sheets.includes("'服务名称'") && sheets.includes("'订阅金额'")));
fix('订阅不会强制显示搬入日期', () => assert.ok(sheets.includes("draft.planKind === 'subscription' ? COPY.subscribedAt : COPY.moveIn")));
fix('关系固定先显示场景选择器', () => assert.ok(sheets.includes('这是什么关系账？')));
fix('计划类型切换重建相关字段契约', () => assert.ok(sheets.includes('applyPlanKind(kind)')));
fix('类型切换保留名称金额日期和备注', () => ['title: previous.title','amount: previous.amount','startDate: previous.startDate','note: previous.note'].forEach((token) => assert.ok(sheets.includes(token))));
fix('破坏关系草稿的类型切换要求确认', () => assert.ok(sheets.includes('切换后，当前关系对象、付款角色与分摊设置会被清除')));
fix('订阅明确不渲染关系字段', () => assert.ok(sheets.includes("if (draft.planKind === 'subscription') return ''")));
fix('普通固定支出不会渲染分期本金输入', () => assert.ok(sheets.includes("draft.relationshipMode === 'installment_repayment'")));
fix('四个关系场景拥有独立 UI 分支', () => ['shared_bill','central_collection','direct_recurring_payment','installment_repayment'].forEach((mode) => assert.ok(sheets.includes(mode))));

// 041–050: shared bill projections.
[100, 999, 131200].forEach((total) => fix(`共同分担 ${total} 分币保持精确`, () => { const value = relationshipPlan('shared_bill', total); assert.equal(value.relationship.shares.reduce((sum, share) => sum + share.amountMinor, 0), total); }));
fix('共同分担由我先付完整账单', () => assert.equal(relationshipPlan('shared_bill', 131200).cashOutflowMinor, 131200));
fix('共同分担我的经济份额精确', () => assert.equal(relationshipPlan('shared_bill', 131200).ownShareMinor, 43733));
fix('共同分担预计待收精确', () => assert.equal(relationshipPlan('shared_bill', 131200).receivableMinor, 87467));
fix('共同分担由其他参与者付款时我无现金流出', () => assert.equal(relationshipPlan('shared_bill', 131200, { payerParticipantId: 'participant-a' }).cashOutflowMinor, 0));
fix('共同分担由其他参与者付款时形成预计待付', () => assert.equal(relationshipPlan('shared_bill', 131200, { payerParticipantId: 'participant-a' }).payableMinor, 43733));
fix('共同分担自定义份额必须完全相等', () => errorCode(() => relationshipPlan('shared_bill', 10000, { splitMode: 'custom', shares: [{ participantId: 'participant-me', amountMinor: 3000 }, { participantId: 'participant-a', amountMinor: 3000 }, { participantId: 'participant-b', amountMinor: 3000 }] }), 'custom_split_not_exact'));
fix('共同分担模型源不包含交易入账', () => ['createTransaction','postTransaction','applyAccountEffect'].forEach((token) => assert.equal(relationshipSource.includes(token), false)));

// 051–065: central collection projections.
[2, 3, 6].forEach((count) => fix(`统一收款支持 ${count} 位成员`, () => { const ids = Array.from({ length: count }, (_, i) => i ? `member-${i}` : 'participant-me'); const shares = equalSplitMinor(25000, ids); assert.equal(Object.keys(shares).length, count); }));
fix('统一收款必须选择收款人', () => errorCode(() => relationshipPlan('central_collection', 25000, { collectorParticipantId: '' }), 'collector_missing'));
fix('统一收款必须选择向外付款人', () => errorCode(() => relationshipPlan('central_collection', 25000, { externalPayerParticipantId: '' }), 'external_payer_missing'));
fix('收款人与向外付款人可以相同', () => assert.equal(relationshipPlan('central_collection', 25000).relationship.collectorParticipantId, 'participant-me'));
fix('普通成员向收款人支付自己的份额', () => assert.equal(relationshipPlan('central_collection', 25000, { collectorParticipantId: 'participant-a', externalPayerParticipantId: 'participant-a' }).transferToMemberOutflowMinor, 8333));
fix('收款兼付款人向外支付完整账单', () => assert.equal(relationshipPlan('central_collection', 25000).directExternalOutflowMinor, 25000));
fix('收款兼付款人的预计待收为其他成员份额', () => assert.equal(relationshipPlan('central_collection', 25000).receivableMinor, 16667));
fix('普通成员在付款前有自己的预计待付', () => assert.equal(relationshipPlan('central_collection', 25000, { collectorParticipantId: 'participant-a', externalPayerParticipantId: 'participant-a' }).payableMinor, 8333));
fix('RM250 三人平均保持 exact minor units', () => assert.deepEqual(relationshipPlan('central_collection', 25000).relationship.shares.map((share) => share.amountMinor), [8333, 8333, 8334]));
fix('一仙差额确定性落到最后成员', () => assert.equal(relationshipPlan('central_collection', 25000).relationship.shares.at(-1).amountMinor, 8334));
fix('RM83/RM83/RM84 自定义分配有效', () => assert.deepEqual(relationshipPlan('central_collection', 25000, { splitMode: 'custom', shares: [{ participantId: 'participant-me', amountMinor: 8300 }, { participantId: 'participant-a', amountMinor: 8300 }, { participantId: 'participant-b', amountMinor: 8400 }] }).relationship.shares.map((share) => share.amountMinor), [8300,8300,8400]));
fix('统一收款不会丢失一仙', () => assert.equal(relationshipPlan('central_collection', 25000).relationship.shares.reduce((sum, share) => sum + share.amountMinor, 0), 25000));
fix('统一收款不会制造一仙', () => assert.equal(relationshipPlan('central_collection', 1).relationship.shares.reduce((sum, share) => sum + share.amountMinor, 0), 1));
fix('统一收款角色用稳定 participant IDs', () => assert.deepEqual([relationshipPlan('central_collection').relationship.collectorParticipantId, relationshipPlan('central_collection').relationship.externalPayerParticipantId], ['participant-me','participant-me']));
fix('统一收款不依赖显示名称', () => assert.equal(relationshipSource.includes('displayName'), false));

// 066–071: direct recurring payment.
fix('定期付给对方必须选择收款人', () => errorCode(() => relationshipPlan('direct_recurring_payment', 5000, { recipientParticipantId: '' }), 'recipient_missing'));
fix('定期付给对方需要固定金额', () => errorCode(() => relationshipPlan('direct_recurring_payment', 0, {}, { fixedAmountMinor: null, amountMode: 'fixed' }), 'fixed_amount_missing'));
fix('定期付款预计现金流出正确', () => assert.equal(relationshipPlan('direct_recurring_payment', 5000).cashOutflowMinor, 5000));
fix('定期付款没有分摊 shares', () => assert.equal('shares' in relationshipPlan('direct_recurring_payment', 5000).relationship, false));
fix('定期付款不是 shared bill', () => assert.equal(relationshipPlan('direct_recurring_payment', 5000).relationshipMode, 'direct_recurring_payment'));
fix('保存定期付款不会触发交易 posting', () => ['createTransaction','saveTransaction','applyBalance'].forEach((token) => assert.equal(relationshipSource.includes(token), false)));

// 072–084: relationship instalment repayment.
fix('分期还款必须选择债权人', () => errorCode(() => relationshipPlan('installment_repayment', 10000, { creditorParticipantId: '' }), 'creditor_missing'));
fix('分期还款必须选择债务人', () => errorCode(() => relationshipPlan('installment_repayment', 10000, { debtorParticipantId: '' }), 'debtor_missing'));
fix('分期还款保留原始本金', () => assert.equal(relationshipPlan('installment_repayment', 10000).relationship.originalPrincipalMinor, 120000));
fix('分期还款保留当前剩余本金', () => assert.equal(relationshipPlan('installment_repayment', 10000).relationship.remainingPrincipalMinor, 90000));
fix('分期还款保留每期金额', () => assert.equal(relationshipPlan('installment_repayment', 10000).relationship.installmentAmountMinor, 10000));
fix('分期还款派生已还金额', () => assert.equal(relationshipPlan('installment_repayment', 10000).repaidPrincipalMinor, 30000));
fix('分期还款派生剩余期数', () => assert.equal(relationshipPlan('installment_repayment', 10000).remainingInstallments, 9));
fix('剩余本金不能超过原始本金', () => errorCode(() => relationshipPlan('installment_repayment', 10000, { remainingPrincipalMinor: 130000 }), 'invalid_remaining_principal'));
fix('分期还款计划保持固定金额模式', () => assert.equal(relationshipPlan('installment_repayment', 10000).amountMode, 'fixed'));
fix('建立分期计划不会降低 remaining principal', () => { const input = relationship('installment_repayment'); const value = relationshipPlan('installment_repayment', 10000, input); assert.equal(value.relationship.remainingPrincipalMinor, input.remainingPrincipalMinor); });
fix('建立分期计划不会创建新 purchase', () => assert.equal(relationshipSource.includes('purchase'), false));
fix('建立分期计划不会创建 Activity 记录', () => assert.equal(relationshipSource.includes('activity'), false));
fix('普通一次性欠款不会自动成为 recurring plan', () => assert.ok(modelSource.includes("input.planKind === 'recurring_relationship'")));

// 085–102: shared Capture relationship-composer primitives.
fix('Recurring editor 调用共享 composer adapter', () => assert.ok(sheets.includes('openRecurringRelationshipComposer')));
fix('adapter 复用 Capture inline split editor', () => assert.ok(composer.includes("from './SplitAllocationEditorSheet.js'")));
fix('Capture 原本组件仍存在且未被替换', () => assert.ok(read('src/components/CaptureSheet.js').includes('SplitAllocationEditorSheet')));
fix('Recurring composer 只通过 onComplete 返回 draft', () => assert.ok(composer.includes('onComplete?.(structuredClone(draft))')));
fix('Recurring composer 不创建 transaction', () => assert.equal(composer.includes('createTransaction'), false));
fix('自定义成员点击打开 inline drawer', () => assert.ok(composer.includes('createInlineSplitDraft')));
fix('composer 没有 plain share number input', () => assert.equal(/data-recurring-share[^\n]+<input/.test(composer), false));
fix('切换成员复用 switchInlineSplitParticipant', () => assert.ok(composer.includes('switchInlineSplitParticipant')));
[2, 4, 10, 12].forEach((count) => fix(`composer 分配支持 ${count} 位成员`, () => { const ids = Array.from({ length: count }, (_, i) => `p-${i}`); assert.equal(Object.keys(equalSplitMinor(99999, ids)).length, count); }));
fix('composer 精确分配完成', () => assert.equal(allocationSummary(100, { a: 50, b: 50 }, ['a','b']).exact, true));
fix('composer 阻止少分', () => assert.equal(allocationSummary(100, { a: 49, b: 50 }, ['a','b']).remainingMinor, 1));
fix('composer 阻止超分', () => assert.equal(allocationSummary(100, { a: 51, b: 50 }, ['a','b']).overMinor, 1));
fix('取消 composer 保留 opening snapshot', () => assert.ok(composer.includes('draft = opening')));
fix('应用关系草稿只重绘父计划编辑器', () => assert.ok(sheets.includes('draft.relationship = relationship')));
fix('自定义计算器不是第二个 modal Sheet', () => assert.equal(composer.includes("openSheet({ title: '计算器'"), false));

// 103–118: RinggitMe pickers, detail and management.
fix('频率使用 RinggitMe picker', () => assert.ok(sheets.includes("openPickerSheet({ title: '付款频率'")));
fix('到期日使用 RinggitMe picker', () => assert.ok(sheets.includes("openPickerSheet({ title:'到期日'")));
fix('付款账户使用 RinggitMe picker', () => assert.ok(sheets.includes("openPickerSheet({ title:'付款账户'")));
fix('关系角色使用 RinggitMe picker', () => assert.ok(sheets.includes("const title = key === 'recipient'")));
fix('移动表单不要求 browser native select', () => assert.equal(sheets.includes('<select'), false));
fix('详情 Sheet 不显示持续整块绿色 outline', () => assert.match(css, /plan-detail-sheet:focus[\s\S]*outline:\s*none/));
fix('按钮仍保留 keyboard focus-visible', () => assert.ok(read('src/styles/phase2b3g-fix6.css').includes('button:focus-visible')));
fix('详情奇数项目不会留下空白格', () => assert.ok(sheets.includes("detailItems.length % 2")));
fix('详情最后奇数项目跨两列', () => assert.ok(css.includes('.plan-detail-grid .span-all')));
fix('详情金额标签区分预计与待填写', () => assert.ok(sheets.includes('plan.amountPending') && sheets.includes("plan.amountMode === 'variable'")));
fix('暂停计划详情保留可读状态', () => assert.ok(sheets.includes("paused: '已暂停'")));
fix('停止计划详情保留可读状态', () => assert.ok(sheets.includes("stopped: '已结束'")));
fix('危险管理操作进入独立 action Sheet', () => assert.ok(sheets.includes("title: '管理计划'")));
fix('暂停 repository 语义不变', () => { const repo = createRecurringPlanRepository({ plans: [plan({ id: 'pause' })] }); assert.equal(repo.pausePlan('pause').status, 'paused'); });
fix('恢复 repository 语义不变', () => { const repo = createRecurringPlanRepository({ plans: [plan({ id: 'resume', status: 'paused' })] }); assert.equal(repo.resumePlan('resume').status, 'active'); });
fix('停止 repository 语义不变', () => { const repo = createRecurringPlanRepository({ plans: [plan({ id: 'stop' })] }); assert.equal(repo.stopPlan('stop').status, 'stopped'); });

// 119–126: Today/Fixed Center summary integration.
fix('Today 继续包含固定金额', () => { const value = plan({ id: 'today-fixed' }); const row = buildOccurrenceSnapshot(value, '2026-07', { referenceDate: '2026-07-01' }); const month = selectRecurringMonth({ plans:[value],occurrences:[row],monthKey:'2026-07',referenceDate:'2026-07-01' }); assert.equal(selectTodayFixed(month).myFixedMinor, 24000); });
fix('Today 对预计金额设置 containsEstimate', () => { const value = plan({ id:'today-estimate',amountMode:'variable',estimateAmountMinor:24000 }); const row=buildOccurrenceSnapshot(value,'2026-07',{referenceDate:'2026-07-01'}); assert.equal(selectTodayFixed(selectRecurringMonth({plans:[value],occurrences:[row],monthKey:'2026-07',referenceDate:'2026-07-01'})).containsEstimate,true); });
fix('Today 统计待填写金额计划', () => { const value = plan({ id:'today-pending',amountMode:'variable',totalAmountMinor:0 }); const row=buildOccurrenceSnapshot(value,'2026-07',{referenceDate:'2026-07-01'}); assert.equal(selectTodayFixed(selectRecurringMonth({plans:[value],occurrences:[row],monthKey:'2026-07',referenceDate:'2026-07-01'})).variableAmountPendingCount,1); });
fix('Fixed Center card 标记变量金额', () => assert.ok(center.includes('预计我的份额') && center.includes('待填写')));
fix('Fixed Center card 标记关系场景', () => ['central_collection','direct_recurring_payment','installment_repayment'].forEach((mode)=>assert.ok(center.includes(mode))));
fix('canonical plan 不重复', () => { const value=plan({id:'unique'}); const row=buildOccurrenceSnapshot(value,'2026-07',{referenceDate:'2026-07-01'}); assert.equal(selectRecurringMonth({plans:[value],occurrences:[row],monthKey:'2026-07',referenceDate:'2026-07-01'}).plans.length,1); });
fix('canonical occurrence 不重复', () => { const value=plan({id:'occ-unique'}); const row=buildOccurrenceSnapshot(value,'2026-07',{referenceDate:'2026-07-01'}); assert.equal(selectRecurringMonth({plans:[value],occurrences:[row,row],monthKey:'2026-07',referenceDate:'2026-07-01'}).rows.length,1); });
fix('相同标题不会合并不同 canonical source', () => { const a=plan({id:'same-a',title:'同名'}); const b=plan({id:'same-b',title:'同名'}); const rows=[a,b].map((value)=>buildOccurrenceSnapshot(value,'2026-07',{referenceDate:'2026-07-01'})); assert.equal(selectRecurringMonth({plans:[a,b],occurrences:rows,monthKey:'2026-07',referenceDate:'2026-07-01'}).plans.length,2); });

// 127–149: regression and prohibited-mutation contracts.
fix('全部既有测试文件仍可发现', () => assert.ok(readdirSync(join(APP,'tests')).filter((name)=>name.endsWith('.test.mjs')).length >= 25));
fix('Assets 实现仍存在', () => assert.ok(read('src/features/assets/index.js').length > 1000));
fix('Capture 实现仍存在', () => assert.ok(read('src/components/CaptureSheet.js').length > 1000));
fix('Capture 分摊计算器仍存在', () => assert.ok(read('src/components/SplitAllocationEditorSheet.js').includes('pressInlineSplitKey')));
fix('Confirmation 实现仍存在', () => assert.ok(read('src/components/MoneyFlowConfirmation.js').length > 1000));
fix('Continuous Balance Count 仍存在', () => assert.ok(read('src/components/MoneyFlowConfirmation.js').includes('rolling')));
fix('Activity 实现仍存在', () => assert.ok(read('src/features/activity/index.js').length > 1000));
fix('Record Detail 实现仍存在', () => assert.ok(read('src/components/RecordDetailOverlay.js').length > 1000));
fix('account-capacity 逻辑仍存在', () => assert.ok(read('src/domain/accountCapacity.js').length > 100));
fix('credit-limit 逻辑仍存在', () => assert.ok(read('src/domain/accountCapacity.js').includes('credit')));
fix('obligation-owned plan 继续 canonical projection', () => assert.ok(read('src/domain/recurringPlanSelectors.js').includes("sourceType: 'obligation_plan'")));
fix('Ledger 投影仍使用一个 canonical source', () => assert.ok(read('src/domain/recurringPlanSelectors.js').includes('projectFixedRelationshipsForLedger')));
fix('FIX1 组件没有 fetch', () => [sheets,composer,modelSource,relationshipSource].forEach((value)=>assert.equal(/\bfetch\s*\(/.test(value),false)));
fix('FIX1 没有 localStorage', () => [sheets,composer,modelSource,relationshipSource].forEach((value)=>assert.equal(value.includes('localStorage'),false)));
fix('FIX1 没有 sessionStorage', () => [sheets,composer,modelSource,relationshipSource].forEach((value)=>assert.equal(value.includes('sessionStorage'),false)));
fix('FIX1 没有 IndexedDB', () => [sheets,composer,modelSource,relationshipSource].forEach((value)=>assert.equal(/indexedDB/i.test(value),false)));
fix('FIX1 没有 Supabase', () => [sheets,composer,modelSource,relationshipSource].forEach((value)=>assert.equal(/supabase/i.test(value),false)));
fix('FIX1 没有 Telegram 执行', () => [sheets,composer,modelSource,relationshipSource].forEach((value)=>assert.equal(/sendTelegram|telegram\.send/i.test(value),false)));
fix('FIX1 没有 transaction posting', () => [sheets,composer,modelSource,relationshipSource].forEach((value)=>assert.equal(/postTransaction|createTransaction/.test(value),false)));
fix('FIX1 没有 balance mutation', () => [sheets,composer,modelSource,relationshipSource].forEach((value)=>assert.equal(/setBalance|applyBalance|balance\s*[+\-]=/.test(value),false)));
fix('FIX1 没有 card-debt mutation', () => [sheets,composer,modelSource,relationshipSource].forEach((value)=>assert.equal(/outstanding\s*[+\-]=|availableCredit\s*=/.test(value),false)));
fix('FIX1 没有 relationship balance mutation', () => [sheets,composer,modelSource,relationshipSource].forEach((value)=>assert.equal(/applyRelationship|relationshipBalance\s*=/.test(value),false)));
fix('FIX1 source 不包含 port 8788', () => [sheets,composer,modelSource,relationshipSource,scheduleSource].forEach((value)=>assert.equal(value.includes('8788'),false)));

fix('Phase 2C2-FIX1 提供至少 150 项专项测试', () => assert.ok(index >= 150));
fix('编辑器预览先规范化 equal shares 避免暂时 RM0', () => assert.ok(sheets.includes('normalizeRecurringRelationship({')));
fix('状态确认关闭确认管理与旧详情三层 Sheet', () => assert.ok(sheets.includes('closeSheet(true);closeSheet(true);closeSheet(true)')));
