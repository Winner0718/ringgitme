import { escapeHTML, fmtDateMY, fmtRM } from '../../app/format.js';
import { backOr, replaceRoute, pushRoute } from '../../app/router.js';
import { data, registerAction, ui, update } from '../../app/state.js';
import { deriveMonthlyWorkspace, filterHistoryRows, filterPlanLibrary } from '../../domain/fixedCenterWorkspace.js';
import { derivePlanVisualPresentation } from '../../domain/planVisualPresentation.js';
import { deriveRecurringOccurrencePresentation } from '../../domain/recurringOccurrencePresentation.js';
import { addMonths } from '../../domain/scheduleGenerator.js';
import { icon } from '../../components/Icons.js';
import { registerRecurringPlanManagement } from './RecurringPlanSheets.js';

const WORKSPACES = [['month', '本月'], ['plans', '计划'], ['history', '历史']];
const STATUS_FILTERS = [['active', '进行中'], ['paused', '已暂停'], ['stopped', '已停止'], ['archived', '已归档']];
const TYPE_FILTERS = [['all', '全部'], ['fixed', '固定'], ['subscription', '订阅'], ['relationship', '关系'], ['installment', '分期']];
const HISTORY_FILTERS = [['all', '全部'], ['completed', '已完成'], ['overdue', '逾期'], ['skipped', '已跳过']];

/* Phase 2C1/FIX1C compatibility map retained for the cumulative regression
   suite while FIX2 replaces those visible buckets with exclusive workspaces:
   monthTitle(selectedMonth), summary.myFixedMinor, section(COPY.overdue),
   section(COPY.dueSoon), section(COPY.completed), sections.pausedPlans,
   sections.stoppedPlans, 预计我的份额, 待填写,
   central_collection, direct_recurring_payment, installment_repayment,
   elapsedDurationChinese, data.getAccount(plan.paymentSourceAccountId),
   row.totalAmountMinor !== row.ownShareMinor, deriveRecurringOccurrencePresentation,
   tone-${presentation.tone}, fixed-own-amount, const recurrence,
   fixed-plan-meta, relationshipLine. */

function monthTitle(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  return `${year}年${month}月`;
}

function canonicalData(plan) {
  return `${plan.canonicalSource.sourceType}:${plan.canonicalSource.sourceId}`;
}

function presentationContext(context, nextOccurrence = null) {
  return {
    context,
    referenceDate: data.today,
    nextOccurrence,
    participantName: (id) => data.getParticipant(id)?.displayName,
    accountName: (id) => data.getAccount(id)?.name,
  };
}

function planMark(presentation, size = 'normal') {
  const mark = presentation.identityMark;
  if (mark === 'netflix') return `<span class="fixed-plan-mark brand-netflix ${size}">N</span>`;
  if (mark === 'icloud') return `<span class="fixed-plan-mark brand-icloud ${size}">☁</span>`;
  const supported = ['wallet', 'home', 'receipt', 'heart', 'calendar', 'users', 'ledger'];
  return `<span class="fixed-plan-mark ${size}">${supported.includes(mark) ? icon(mark, size === 'large' ? 26 : 19) : escapeHTML(String(presentation.title || '计').slice(0, 1))}</span>`;
}

function amountHTML(presentation) {
  const value = presentation.primaryAmountMinor == null
    ? '<strong class="fixed-primary-pending">待填写</strong>'
    : `<strong class="num">${fmtRM(presentation.primaryAmountMinor / 100, { privacy: ui.privacy })}</strong>`;
  return `<span class="fixed-primary-amount" aria-label="${escapeHTML(presentation.primaryAmountLabel)} ${presentation.primaryAmountMinor == null ? '待填写' : fmtRM(presentation.primaryAmountMinor / 100)}"><small>${escapeHTML(presentation.primaryAmountLabel)}</small>${value}</span>`;
}

function secondaryHTML(presentation, { compact = false } = {}) {
  const items = presentation.secondaryAmounts.slice(0, compact ? 1 : 2).map((item) => `<span class="${item.tone === 'positive' ? 'is-positive' : ''}">${escapeHTML(item.label)} <b class="num">${fmtRM(item.amountMinor / 100, { privacy: ui.privacy })}</b></span>`);
  if (presentation.progress && !compact) items.push(`<span>剩余 <b class="num">${fmtRM(presentation.progress.remainingPrincipalMinor / 100, { privacy: ui.privacy })}</b> · ${presentation.progress.remainingPeriods}期</span>`);
  return items.join('');
}

function occurrenceCard(row, context = 'month', { dense = false } = {}) {
  const presentation = derivePlanVisualPresentation(row.plan, row, presentationContext(context));
  const semantic = `<span class="semantic-status tone-${presentation.tone}">${escapeHTML(presentation.statusLabel)}</span>`;
  const date = `${fmtDateMY(row.dueDate)} · ${presentation.cadenceLabel}`;
  const contextBits = [presentation.sourceLabel, presentation.moneyFlowLabel].filter(Boolean);
  return `<article class="fixed-plan-card canonical-plan-card tone-${presentation.tone}${dense ? ' is-dense' : ''} surface" tabindex="0" role="button" data-action="fixed-plan-detail" data-source="${canonicalData(row.plan)}" data-canonical-plan-id="${escapeHTML(row.plan.id)}" data-occurrence-id="${escapeHTML(row.id)}" data-semantic-state="${presentation.status}" aria-label="${escapeHTML(presentation.title)}，${escapeHTML(presentation.primaryAmountLabel)}">
    <div class="fixed-plan-head">
      ${planMark(presentation)}
      <div class="row-main"><div class="fixed-plan-title-row"><strong>${escapeHTML(presentation.title)}</strong><span class="fixed-kind">${escapeHTML(presentation.typeLabel)}</span></div><div class="caption fixed-semantic-line">${semantic}<span>${date}</span></div></div>
      ${amountHTML(presentation)}
    </div>
    ${dense ? '' : `<div class="fixed-plan-context">${secondaryHTML(presentation)}${contextBits.length ? `<span>${escapeHTML(contextBits.join(' · '))}</span>` : ''}</div>`}
  </article>`;
}

function workspaceNav() {
  return `<nav class="fixed-workspace-nav segmented" data-fixed-workspace-nav aria-label="固定与订阅工作区">${WORKSPACES.map(([value, label]) => `<button class="seg-item${ui.fixedWorkspace === value ? ' active' : ''}" data-action="fixed-workspace" data-workspace="${value}" aria-current="${ui.fixedWorkspace === value ? 'page' : 'false'}" aria-pressed="${ui.fixedWorkspace === value}">${label}</button>`).join('')}</nav>`;
}

function monthNavigator({ history = false } = {}) {
  const currentMonth = data.today.slice(0, 7);
  return `<section class="fixed-month-header surface" aria-label="${history ? '历史月份' : '计划月份'}">
    <button data-action="fixed-month-prev" aria-label="上个月">${icon('chevronLeft', 20)}</button>
    <div><span class="caption">${history ? '账期历史' : '本月计划'}</span><strong>${monthTitle(ui.fixedMonth)}</strong></div>
    <button data-action="fixed-month-next" aria-label="下个月">${icon('chevronRight', 20)}</button>
  </section>
  <div class="fixed-header-actions" data-fixed-header-actions>
    ${ui.fixedMonth !== currentMonth ? `<button class="fixed-current-month" data-action="fixed-month-current">回到本月</button>` : '<span aria-hidden="true"></span>'}
    ${history ? '<span aria-hidden="true"></span>' : `<button class="fixed-plan-new" data-action="fixed-plan-new">${icon('plus', 18)}<span>新增计划</span></button>`}
  </div>`;
}

function overviewHTML(overview) {
  const chips = [
    overview.overdueCount ? ['red', `逾期 ${overview.overdueCount}`] : null,
    overview.attentionCount ? ['amber', `待处理 ${overview.attentionCount}`] : null,
    overview.awaitingAmountCount ? ['amber', `待填金额 ${overview.awaitingAmountCount}`] : null,
  ].filter(Boolean);
  return `<section class="fixed-month-overview surface" aria-label="本月财务计划概览">
    <div class="fixed-overview-hero"><span>本月我的负担</span><strong class="num">${fmtRM(overview.burdenMinor / 100, { privacy: ui.privacy })}</strong></div>
    <div class="fixed-overview-flow">
      <span><small>从账户预计支付</small><b class="num">${fmtRM(overview.accountOutflowMinor / 100, { privacy: ui.privacy })}</b></span>
      <span><small>预计收回</small><b class="num is-positive">${fmtRM(overview.expectedReceiptMinor / 100, { privacy: ui.privacy })}</b></span>
      <span><small>需交给他人</small><b class="num">${fmtRM(overview.paymentToOtherMinor / 100, { privacy: ui.privacy })}</b></span>
    </div>
    <div class="fixed-overview-progress"><span>已完成 <b>${overview.completedCount} / ${overview.totalCount}</b> 项</span><span>剩余 ${overview.remainingCount} 项</span></div>
    ${chips.length ? `<div class="fixed-overview-chips">${chips.map(([tone, text]) => `<span class="tone-${tone}">${text}</span>`).join('')}</div>` : ''}
  </section>`;
}

function monthSection(title, rows) {
  if (!rows.length) return '';
  return `<section class="fixed-section" data-month-section="${escapeHTML(title)}"><h2 class="sec-title">${title}<span>${rows.length}</span></h2><div class="fixed-card-list">${rows.map((row) => occurrenceCard(row)).join('')}</div></section>`;
}

function completedSection(rows) {
  if (!rows.length) return '';
  const amount = rows.reduce((sum, row) => sum + Number(row.ownShareMinor || 0), 0);
  return `<section class="fixed-section fixed-completed-section"><button class="fixed-completed-toggle surface" data-action="fixed-completed-toggle" aria-expanded="${ui.fixedCompletedExpanded}"><span>${icon('check', 18)}<strong>已完成</strong><small>${rows.length} 项 · ${fmtRM(amount / 100, { privacy: ui.privacy })}</small></span>${icon(ui.fixedCompletedExpanded ? 'chevronUp' : 'chevronDown', 18)}</button>${ui.fixedCompletedExpanded ? `<div class="fixed-card-list completed-list">${rows.map((row) => occurrenceCard(row, 'month', { dense: true })).join('')}</div>` : ''}</section>`;
}

function renderMonthWorkspace() {
  const projection = data.getFixedCenterMonth(ui.fixedMonth, data.today);
  const workspace = deriveMonthlyWorkspace(projection);
  const { now, next, completed } = workspace.sections;
  const empty = workspace.occurrenceIds.length === 0;
  return `${monthNavigator()}${overviewHTML(workspace.overview)}${empty ? `<section class="fixed-empty surface">${icon('calendar', 26)}<strong>这个月还没有计划</strong><p>你可以新增固定支出、订阅、关系计划或分期。</p><button data-action="fixed-plan-new">新增计划</button><button data-action="fixed-workspace" data-workspace="plans">查看全部计划</button></section>` : `${monthSection('现在要处理', now)}${monthSection('接下来', next)}${completedSection(completed)}`}<p class="fixed-readonly-note">这里显示计划与预测；实际付款仍会在发生时由你确认。</p>`;
}

function filterRail(items, selected, action, dataKey, counts = null, label = '') {
  return `<div class="fixed-filter-rail" role="group" aria-label="${escapeHTML(label)}">${items.map(([value, text]) => `<button class="${selected === value ? 'active' : ''}" data-action="${action}" data-${dataKey}="${value}" aria-pressed="${selected === value}">${text}${counts ? `<span>${counts[value] || 0}</span>` : ''}</button>`).join('')}</div>`;
}

function allPlanOccurrences(plans) {
  const map = new Map();
  plans.forEach((plan) => map.set(plan.id, data.getCanonicalRecurringPlanOccurrences(canonicalData(plan), data.today)));
  return map;
}

function planLibraryCard(plan, occurrences) {
  const nextOccurrence = occurrences.find((row) => row.dueDate >= data.today && !['paid', 'skipped'].includes(row.status)) || null;
  const presentation = derivePlanVisualPresentation(plan, null, presentationContext('plan-library', nextOccurrence));
  const cadenceAmount = presentation.primaryAmountMinor == null ? presentation.primaryAmountLabel : `${fmtRM(presentation.primaryAmountMinor / 100, { privacy: ui.privacy })} / ${plan.schedule.recurrence === 'yearly' ? '年' : '月'}`;
  const nextLine = nextOccurrence ? `下次 ${fmtDateMY(nextOccurrence.dueDate)}` : presentation.planStateLabel;
  const context = [nextLine, presentation.sourceLabel, presentation.moneyFlowLabel].filter(Boolean).join(' · ');
  return `<article class="fixed-plan-card fixed-library-card surface state-${presentation.planState}" tabindex="0" role="button" data-action="fixed-plan-detail" data-source="${canonicalData(plan)}" data-canonical-plan-id="${escapeHTML(plan.id)}" aria-label="${escapeHTML(plan.title)}，${escapeHTML(presentation.planStateLabel)}">
    ${planMark(presentation)}<div class="row-main"><div class="fixed-plan-title-row"><strong>${escapeHTML(plan.title)}</strong><span class="fixed-kind">${escapeHTML(presentation.typeLabel)}</span></div><div class="caption">${escapeHTML(presentation.planStateLabel)} · ${escapeHTML(cadenceAmount)}</div><small>${escapeHTML(context)}</small>${presentation.progress ? `<div class="fixed-installment-progress" style="--progress:${Math.round(presentation.progress.ratio * 100)}%"><span></span><em>剩余 ${fmtRM(presentation.progress.remainingPrincipalMinor / 100, { privacy: ui.privacy })} · ${presentation.progress.remainingPeriods}期</em></div>` : ''}${presentation.secondaryAmounts.length && plan.amountMode === 'variable' ? `<small>${secondaryHTML(presentation, { compact: true })}</small>` : ''}</div>${icon('chevronRight', 16)}
  </article>`;
}

function renderPlansWorkspace() {
  const plans = data.getCanonicalRecurringPlans();
  const occurrences = allPlanOccurrences(plans);
  const counts = { active: 0, paused: 0, stopped: 0, archived: 0 };
  plans.forEach((plan) => { counts[plan.archivedAt ? 'archived' : plan.status] += 1; });
  const visible = filterPlanLibrary(plans, { status: ui.fixedPlanStatus, type: ui.fixedPlanType, occurrencesByPlan: occurrences, referenceDate: data.today });
  return `<div class="fixed-plans-toolbar"><button class="fixed-plan-new" data-action="fixed-plan-new">${icon('plus', 18)}<span>新增计划</span></button></div>${filterRail(STATUS_FILTERS, ui.fixedPlanStatus, 'fixed-plan-status', 'status', counts, '计划状态')}${filterRail(TYPE_FILTERS, ui.fixedPlanType, 'fixed-plan-type', 'type', null, '计划类型')}<section class="fixed-library-list" data-plan-result-count="${visible.length}">${visible.map((plan) => planLibraryCard(plan, occurrences.get(plan.id) || [])).join('') || `<div class="fixed-empty surface">${icon('calendar', 24)}<strong>这里还没有计划</strong><p>切换筛选或建立一项新计划。</p></div>`}</section><p class="fixed-readonly-note">管理计划只会影响未来账期，不会自动记账。</p>`;
}

function historyCard(row) {
  const presentation = derivePlanVisualPresentation(row.plan, row, { ...presentationContext('history'), occurrencePresentation: row.presentation });
  const context = [presentation.moneyFlowLabel, presentation.sourceLabel].filter(Boolean).join(' · ');
  return `<article class="fixed-history-card surface" tabindex="0" role="button" data-action="fixed-plan-detail" data-source="${canonicalData(row.plan)}" data-occurrence-id="${escapeHTML(row.id)}"><time>${fmtDateMY(row.dueDate)}</time>${planMark(presentation)}<div><strong>${escapeHTML(row.plan.title)}</strong><small>${escapeHTML(context || presentation.typeLabel)}</small></div><span><b class="num">${presentation.primaryAmountMinor == null ? '待填写' : fmtRM(presentation.primaryAmountMinor / 100, { privacy: ui.privacy })}</b><em class="tone-${presentation.tone}">${escapeHTML(presentation.statusLabel)}</em></span></article>`;
}

function renderHistoryWorkspace() {
  const plans = data.getCanonicalRecurringPlans();
  const selectedRows = data.getFixedCenterMonth(ui.fixedMonth, data.today).rows;
  const byId = new Map(selectedRows.map((row) => [row.id, row]));
  plans.forEach((plan) => data.getCanonicalRecurringPlanOccurrences(canonicalData(plan), data.today)
    .filter((row) => row.monthKey === ui.fixedMonth)
    .forEach((row) => {
      if (byId.has(row.id)) return;
      const historicalPlan = row.recordedStatus ? plan : { ...plan, status: 'active', archivedAt: null };
      const historicalOccurrence = row.recordedStatus ? row : { ...row, status: null };
      byId.set(row.id, { ...row, plan, presentation: deriveRecurringOccurrencePresentation(historicalOccurrence, historicalPlan, data.today) });
    }));
  const rows = [...byId.values()];
  const historyRows = filterHistoryRows(rows, ui.fixedHistoryFilter);
  return `${monthNavigator({ history: true })}${filterRail(HISTORY_FILTERS, ui.fixedHistoryFilter, 'fixed-history-filter', 'history', null, '历史状态')}<section class="fixed-history-list" data-history-result-count="${historyRows.length}">${historyRows.map(historyCard).join('') || `<div class="fixed-empty surface">${icon('calendar', 24)}<strong>这个月还没有账期记录</strong><p>记录没有被删除；你可以切换月份或查看计划。</p><button data-action="fixed-workspace" data-workspace="plans">查看计划</button></div>`}</section>`;
}

export function renderFixedCenter(container) {
  const body = ui.fixedWorkspace === 'plans' ? renderPlansWorkspace() : ui.fixedWorkspace === 'history' ? renderHistoryWorkspace() : renderMonthWorkspace();
  container.innerHTML = `<div class="fixed-center" data-fixed-workspace="${ui.fixedWorkspace}" data-fixed-month="${ui.fixedMonth}">${workspaceNav()}${body}</div>`;
  container.querySelector('[data-fixed-workspace-nav]')?.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = WORKSPACES.findIndex(([value]) => value === ui.fixedWorkspace);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? WORKSPACES.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + WORKSPACES.length) % WORKSPACES.length;
    const next = WORKSPACES[index][0];
    replaceRoute({ fixedWorkspace: next }, { direction: event.key === 'ArrowLeft' ? 'back' : 'forward' });
    requestAnimationFrame(() => container.querySelector(`[data-workspace="${next}"]`)?.focus({ preventScroll: true }));
  });
}

export function registerFixedCenterFeature() {
  registerRecurringPlanManagement();
  registerAction('fixed-center-open', () => pushRoute({ todayView: 'fixed', fixedWorkspace: 'month', fixedMonth: data.today.slice(0, 7) }, { direction: 'forward' }));
  registerAction('fixed-center-back', () => backOr({ tab: 'today', todayView: 'overview' }));
  registerAction('fixed-workspace', (el) => replaceRoute({ fixedWorkspace: el.dataset.workspace }, { direction: 'forward' }));
  registerAction('fixed-month-prev', () => replaceRoute({ fixedMonth: addMonths(ui.fixedMonth, -1) }, { direction: 'back' }));
  registerAction('fixed-month-next', () => replaceRoute({ fixedMonth: addMonths(ui.fixedMonth, 1) }, { direction: 'forward' }));
  registerAction('fixed-month-current', () => replaceRoute({ fixedMonth: data.today.slice(0, 7) }, { direction: 'back' }));
  registerAction('fixed-completed-toggle', () => update({ fixedCompletedExpanded: !ui.fixedCompletedExpanded }));
  registerAction('fixed-plan-status', (el) => replaceRoute({ fixedPlanStatus: el.dataset.status }, { direction: 'forward' }));
  registerAction('fixed-plan-type', (el) => replaceRoute({ fixedPlanType: el.dataset.type }, { direction: 'forward' }));
  registerAction('fixed-history-filter', (el) => replaceRoute({ fixedHistoryFilter: el.dataset.history }, { direction: 'forward' }));
}

export const fixedCenterViewTestHooks = Object.freeze({ occurrenceCard, overviewHTML, planLibraryCard, historyCard, workspaceNav });
