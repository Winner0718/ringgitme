import { backOr, pushRoute, registerPage, navigate } from '../../app/router.js';
import { data, ui, update, registerAction } from '../../app/state.js';
import { fmtRM, fmtDateMY, fmtTimeAMPM, escapeHTML, daysBetween } from '../../app/format.js';
import { openSheet, closeSheet, toast } from '../../components/AppSheet.js';
import { icon } from '../../components/Icons.js';
import { nativeDateTimeFieldsHTML, bindNativeDateTimeFields, datePickerFieldHTML, bindDatePickerField } from '../../components/NativeDateTimeFields.js';
import { attachmentSummaryHTML, bindAttachmentField, openAttachmentGallery } from '../../components/AttachmentField.js';
import { openPickerSheet, pickerFieldHTML } from '../../components/PickerSheet.js';
import { instanceState, instanceRemaining, monthlyPlanOverview, installmentPlanOverview } from '../../domain/obligationSelectors.js';
import { moneyFieldHTML, bindMoneyField, moneyStringToMinor, formatMoneyMinor } from '../../components/MoneyCalculatorSheet.js';
import { allocationSummary, applyRemainderToLast, equalSplitMinor, rebuildSplitShares, suggestedMissingShare } from '../../domain/smartSplit.js';
import { openMoneyFlowConfirmation } from '../../components/MoneyFlowConfirmation.js';
import { participantAvatarHTML } from '../../domain/avatarResolver.js';
import { openCapacityAlert } from '../../components/CapacityAlertSheet.js';
import { isAccountCapacityError } from '../../domain/accountCapacity.js';

const ME = 'participant-me';
const minorRM = (value) => fmtRM(Number(value || 0) / 100, { privacy: ui.privacy });
const uid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const nowTime = () => { const now = new Date(); return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`; };

function typeLabels(ledger) {
  const group = ledger?.derivedType === 'group';
  return {
    split_expense: 'AA 分账',
    direct_receivable: group ? '成员欠我' : '他欠我',
    direct_payable: group ? '我欠成员' : '我欠他',
    settlement_received: '收到款',
    settlement_paid: '我还款',
  };
}

function participantStatus(participant) {
  if (!participant) return '仅本地记录';
  if (participant.appUserId && participant.telegramUserId) return 'RinggitMe + Telegram';
  if (participant.appUserId) return 'RinggitMe 已连接';
  if (participant.telegramUserId) return 'Telegram 已连接';
  return '仅本地记录';
}

function counterparty(ledger) {
  return data.getParticipant(ledger.participantIds.find((id) => id !== ME));
}

function name(id) {
  return id === ME ? '我' : data.getParticipant(id)?.displayName || '参与者';
}

// ---- Overview ----------------------------------------------

function overviewHTML() {
  const overview = data.getRelationshipOverview();
  const rows = overview.rows.filter((ledger) => ledger.derivedType === ui.ledgerSegment);
  return `<section class="ledger-metrics">
      <div><span class="caption">待收</span><strong class="num amt-pos">${minorRM(overview.totals.receivableMinor)}</strong></div>
      <div><span class="caption">待付</span><strong class="num amt-neg">${minorRM(overview.totals.payableMinor)}</strong></div>
      <div><span class="caption">净额</span><strong class="num">${minorRM(overview.totals.netMinor)}</strong></div>
    </section>
    <div class="segmented" role="radiogroup" aria-label="关系账筛选">
      <button class="seg-item${ui.ledgerSegment === 'personal' ? ' active' : ''}" data-action="ledger-segment" data-seg="personal" role="radio" aria-checked="${ui.ledgerSegment === 'personal'}">个人</button>
      <button class="seg-item${ui.ledgerSegment === 'group' ? ' active' : ''}" data-action="ledger-segment" data-seg="group" role="radio" aria-checked="${ui.ledgerSegment === 'group'}">群组</button>
    </div>
    <section class="section surface"><ul>${rows.map((ledger) => {
      const person = ledger.derivedType === 'personal' ? counterparty(ledger) : null;
      return `<li class="row ledger-row" data-action="open-ledger" data-ledger="${ledger.ledgerId}" role="button" tabindex="0">
        <span class="avatar">${escapeHTML((person?.displayName || ledger.title).slice(0, 1))}</span>
        <div class="row-main"><div class="row-title">${escapeHTML(ledger.title)}</div><div class="caption">${person ? participantStatus(person) : `${ledger.participantIds.length} 位成员`}</div></div>
        <span class="num row-amt ${ledger.netMinor >= 0 ? 'amt-pos' : 'amt-neg'}">${minorRM(Math.abs(ledger.netMinor))}</span>${icon('chevronRight', 15)}
      </li>`;
    }).join('') || '<li class="row row-static caption">暂无关系账。</li>'}</ul></section>
    <button class="sheet-secondary ledger-add-person" data-action="ledger-add-person">添加对象</button>`;
}

// ---- Group participants ------------------------------------
// Replaces the old avatar-stack with a true 2–5 member strip.

function avatarStackHTML(ledger) {
  const members = ledger.participantIds.map((id) => data.getParticipant(id));
  const names = members.map((member) => member?.displayName || '参与者');
  const shown = members.slice(0, members.length <= 5 ? 5 : 4);
  const extra = names.length > 5 ? members.length - shown.length : 0;
  return `<div class="ledger-participants participant-strip-wrap"><button class="participant-strip-label" data-action="ledger-participants">成员 ${ledger.participantIds.length} ${icon('chevronRight', 14)}</button><div class="participant-strip" aria-label="账本成员">
    ${shown.map((member) => `<button type="button" class="participant-strip-item${member?.participantId === ME ? ' current-user' : ''}" data-action="ledger-participant-detail" data-participant="${member?.participantId || ''}">${participantAvatarHTML(member, 'participant-strip-avatar')}<span>${escapeHTML(member?.displayName || '参与者')}</span></button>`).join('')}
    ${extra > 0 ? `<button type="button" class="participant-strip-item" data-action="ledger-participants"><span class="participant-strip-avatar">+${extra}</span><span>更多</span></button>` : ''}
  </div></div>`;
}

function personalLedgerFor(participantId) {
  return data.getRelationshipLedgers('personal').find((ledger) => ledger.participantIds.length === 2 && ledger.participantIds.includes(ME) && ledger.participantIds.includes(participantId)) || null;
}

function participantDetailSheet(participantId) {
  const participant = data.getParticipant(participantId);
  if (!participant) return toast('找不到该成员');
  const personal = participantId === ME ? null : personalLedgerFor(participantId);
  const summary = personal ? data.getRelationshipSummary(personal.ledgerId) : null;
  const net = summary?.netMinor || 0;
  const netCopy = !personal ? '尚未建立个人账本' : net > 0 ? `对方欠你 ${minorRM(net)}` : net < 0 ? `你欠对方 ${minorRM(-net)}` : '已结清';
  openSheet({ title: participant.displayName, className: 'participant-detail-sheet', contentHTML: `<div class="participant-detail-hero">${participantAvatarHTML(participant, 'participant-strip-avatar')}<strong>${escapeHTML(participant.displayName)}${participantId === ME ? '（我）' : ''}</strong><span class="caption">${participantStatus(participant)}</span></div>
    ${participantId !== ME ? `<div class="sheet-group participant-connection"><div class="detail-row"><span>个人关系账</span><strong>${personal ? '已连接' : '未建立'}</strong></div><div class="detail-row"><span>净额</span><strong class="num ${net > 0 ? 'amt-pos' : net < 0 ? 'amt-neg' : ''}">${netCopy}</strong></div></div>
      ${personal ? `<button class="sheet-primary" data-action="ledger-open-personal" data-ledger="${escapeHTML(personal.ledgerId)}">前往${escapeHTML(participant.displayName)}账本 〉</button>` : `<button class="sheet-primary" data-action="ledger-create-personal" data-participant="${escapeHTML(participantId)}">建立与${escapeHTML(participant.displayName)}的个人账本 〉</button>`}` : ''}
    <button class="sheet-secondary" data-action="ledger-return">完成</button>` });
}

function memberBalancesHTML(ledger) {
  const balances = data.getRelationshipMemberBalances(ledger.ledgerId);
  if (!balances.length) return '';
  return `<section class="section surface member-balances"><div class="pad-h caption member-balances-title">成员结余</div><ul>
    ${balances.map((row) => `<li class="row row-static">
      <span class="avatar">${escapeHTML(name(row.participantId).slice(0, 1))}</span>
      <div class="row-main"><div class="row-title">${escapeHTML(name(row.participantId))}</div><div class="caption">${row.netMinor > 0 ? '欠你' : '你欠'} ${minorRM(Math.abs(row.netMinor))}</div></div>
      <span class="num row-amt ${row.netMinor > 0 ? 'amt-pos' : 'amt-neg'}">${row.netMinor > 0 ? '+' : '−'}${minorRM(Math.abs(row.netMinor))}</span>
    </li>`).join('')}
  </ul></section>`;
}

function participantSheet() {
  const ledger = data.getRelationshipLedger(ui.ledgerId);
  const balances = Object.fromEntries(data.getRelationshipMemberBalances(ledger.ledgerId).map((row) => [row.participantId, row.netMinor]));
  openSheet({ title: `成员 · ${ledger.participantIds.length}`, className: 'participant-sheet', contentHTML: `<ul class="participant-sheet-list">
    ${ledger.participantIds.map((id) => {
      const participant = data.getParticipant(id);
      const net = balances[id] || 0;
      const role = id === ME ? '管理员' : '成员';
      const position = id === ME ? '' : net > 0 ? `欠你 ${minorRM(net)}` : net < 0 ? `你欠${escapeHTML(participant?.displayName || '')} ${minorRM(-net)}` : '已结清';
      return `<li class="row row-static participant-row">
        <span class="avatar">${escapeHTML((participant?.displayName || '?').slice(0, 1))}</span>
        <div class="row-main"><div class="row-title">${escapeHTML(participant?.displayName || '参与者')}${id === ME ? '（我）' : ''}</div>
        <div class="caption">${participantStatus(participant)} · ${role}</div></div>
        ${position ? `<span class="caption participant-net ${net > 0 ? 'amt-pos' : net < 0 ? 'amt-neg' : ''}">${position}</span>` : ''}
      </li>`;
    }).join('')}
  </ul><button class="sheet-primary" data-action="ledger-return">完成</button>` });
}

// ---- Obligation sections -----------------------------------

const PLAN_STATE_LABEL = { paid: '本期已付', partial: '部分已付', due: '本月到期', overdue: '已逾期', upcoming: '未到期' };
const PLAN_STATUS_LABEL = { active: '进行中', paused: '已暂停', stopped: '已结束', completed: '已完成' };

function monthlySectionHTML(ledger) {
  const plans = data.getObligationPlans({ ledgerId: ledger.ledgerId, planType: 'recurring_monthly' });
  return `<section class="section obligation-section"><div class="row-between sec-head"><h2 class="sec-title">每月账</h2><button class="obligation-new" data-action="obligation-new-monthly">新建每月账</button></div>
    ${plans.length ? plans.map((plan) => {
      const overview = monthlyPlanOverview(plan, data.getObligationInstances(plan.planId), data.today);
      const current = overview.current;
      const state = current ? PLAN_STATE_LABEL[overview.currentState] : '本月未生成';
      const clips = plan.attachmentIds?.length || 0;
      return `<div class="surface obligation-card" data-plan="${plan.planId}">
        <div class="row-between"><div class="row-title">${escapeHTML(plan.title)}</div><span class="channel-badge${overview.currentState === 'overdue' ? ' badge-warn' : ''}">${plan.status === 'active' ? state : PLAN_STATUS_LABEL[plan.status]}</span></div>
        <div class="caption obligation-line">${plan.direction === 'payable' ? `每月付给 ${escapeHTML(name(plan.creditorParticipantId))}` : `每月向 ${escapeHTML(name(plan.debtorParticipantId))} 收取`} · 每月 ${plan.dueDay} 号 · ${minorRM(plan.amountMinor)}</div>
        ${current ? `<div class="caption obligation-line num">本月 ${current.periodKey} · 应${plan.direction === 'payable' ? '付' : '收'} ${minorRM(current.amountDueMinor)} · 已${plan.direction === 'payable' ? '付' : '收'} ${minorRM(current.amountPaidMinor)} · 剩 ${minorRM(instanceRemaining(current))} · 到期 ${fmtDateMY(current.dueDate)}</div>` : ''}
        ${overview.nextPreview ? `<div class="caption obligation-line">下月预告 ${overview.nextPreview.periodKey} · ${fmtDateMY(overview.nextPreview.dueDate)} · ${minorRM(overview.nextPreview.amountMinor)}</div>` : ''}
        ${clips ? `<button class="attachment-open" data-action="obligation-attachments" data-attachment-ids="${escapeHTML(plan.attachmentIds.join(','))}">${icon('paperclip', 13)} ${clips} 个附件</button>` : ''}
        <div class="obligation-actions">
          ${plan.status === 'active' && !current ? `<button data-action="obligation-generate" data-plan="${plan.planId}">生成本月</button>` : ''}
          ${plan.status !== 'stopped' && plan.status !== 'completed' && overview.openRemainingMinor > 0 ? `<button class="primary" data-action="obligation-pay" data-plan="${plan.planId}">${plan.direction === 'payable' ? '本月付款' : '本月收款'}</button>` : ''}
          ${plan.status === 'active' ? `<button data-action="obligation-pause" data-plan="${plan.planId}">暂停</button>` : ''}
          ${plan.status === 'paused' ? `<button data-action="obligation-resume" data-plan="${plan.planId}">恢复</button>` : ''}
          <button data-action="obligation-history" data-plan="${plan.planId}">历史</button>
          ${plan.status !== 'stopped' ? `<button class="danger" data-action="obligation-stop" data-plan="${plan.planId}">结束</button>` : ''}
        </div>
      </div>`;
    }).join('') : '<div class="surface obligation-card caption obligation-empty">还没有每月账。适合固定的房租、家用等每月往来。</div>'}
  </section>`;
}

function installmentSectionHTML(ledger) {
  const plans = data.getObligationPlans({ ledgerId: ledger.ledgerId, planType: 'installment' });
  return `<section class="section obligation-section"><div class="row-between sec-head"><h2 class="sec-title">分期</h2><button class="obligation-new" data-action="obligation-new-installment">新建分期</button></div>
    ${plans.length ? plans.map((plan) => {
      const overview = installmentPlanOverview(plan, data.getObligationInstances(plan.planId), data.today);
      const clips = plan.attachmentIds?.length || 0;
      return `<div class="surface obligation-card" data-plan="${plan.planId}">
        <div class="row-between"><div class="row-title">${escapeHTML(plan.title)}</div><span class="channel-badge${plan.status === 'completed' ? ' badge-pos' : ''}">${plan.status === 'completed' ? '已结清' : `第 ${overview.currentTerm}/${overview.termCount} 期`}</span></div>
        <div class="caption obligation-line">${escapeHTML(plan.merchant || '')}${plan.merchant ? ' · ' : ''}${plan.direction === 'payable' ? `还给 ${escapeHTML(name(plan.creditorParticipantId))}` : `${escapeHTML(name(plan.debtorParticipantId))} 还我`}</div>
        <div class="caption obligation-line num">总额 ${minorRM(plan.totalRepayableMinor)} · 已还 ${minorRM(overview.paidMinor)} · 剩余 ${minorRM(overview.remainingMinor)}</div>
        ${plan.status !== 'completed' ? `<div class="caption obligation-line num">本月应还 ${minorRM(overview.dueThisMonthMinor)}${overview.nextDueDate ? ` · 下期 ${fmtDateMY(overview.nextDueDate)} ${minorRM(overview.nextDueAmountMinor)}` : ''}</div>` : ''}
        ${clips ? `<button class="attachment-open" data-action="obligation-attachments" data-attachment-ids="${escapeHTML(plan.attachmentIds.join(','))}">${icon('paperclip', 13)} ${clips} 个附件</button>` : ''}
        <div class="obligation-actions">
          ${plan.status !== 'completed' && plan.status !== 'stopped' ? `<button class="primary" data-action="obligation-pay" data-plan="${plan.planId}">记录还款</button><button data-action="installment-early" data-plan="${plan.planId}">提前结清</button>` : ''}
          <button data-action="installment-schedule" data-plan="${plan.planId}">计划</button>
          <button data-action="obligation-history" data-plan="${plan.planId}">历史</button>
        </div>
      </div>`;
    }).join('') : '<div class="surface obligation-card caption obligation-empty">还没有分期。适合用别人额度购物后按期还款的往来。</div>'}
  </section>`;
}

function plansPaymentsSectionHTML(ledger) {
  const plans = data.getObligationPlans({ ledgerId: ledger.ledgerId });
  const monthlyCount = plans.filter((plan) => plan.planType === 'recurring_monthly').length;
  const installmentCount = plans.length - monthlyCount;
  return `<section class="section plans-payments-section"><div class="row-between sec-head"><div><h2 class="sec-title">计划与还款</h2>${plans.length ? `<div class="caption">每月账 ${monthlyCount} · 分期 ${installmentCount}</div>` : ''}</div><button class="obligation-new" data-action="obligation-new-actions">新建</button></div>
    ${plans.length ? `<div class="plans-compact-list">${plans.map((plan) => {
      if (plan.planType === 'recurring_monthly') {
        const overview = monthlyPlanOverview(plan, data.getObligationInstances(plan.planId), data.today);
        const current = overview.current;
        const dueMinor = current ? instanceRemaining(current) : 0;
        const state = plan.status === 'active' ? (current ? PLAN_STATE_LABEL[overview.currentState] : '本月未生成') : PLAN_STATUS_LABEL[plan.status];
        return `<article class="surface plan-compact-card" data-action="obligation-plan-detail" data-plan="${plan.planId}" role="button" tabindex="0">
          <div class="row-between"><div><strong>${escapeHTML(plan.title)}</strong><small>${plan.direction === 'payable' ? `给 ${escapeHTML(name(plan.creditorParticipantId))}` : `向 ${escapeHTML(name(plan.debtorParticipantId))} 收取`} · 每月 ${plan.dueDay} 号</small></div><span class="channel-badge${overview.currentState === 'overdue' ? ' badge-warn' : ''}">${state}</span></div>
          <div class="plan-due"><span class="caption">本月待${plan.direction === 'payable' ? '付' : '收'}</span><strong class="num">${minorRM(dueMinor)}</strong></div>
          <div class="row-between caption"><span>${current ? `本期到期 ${fmtDateMY(current.dueDate)}` : overview.nextPreview ? `下次 ${fmtDateMY(overview.nextPreview.dueDate)}` : '等待生成账期'}</span>${dueMinor > 0 ? `<button class="plan-inline-primary" data-action="obligation-pay" data-plan="${plan.planId}">${plan.direction === 'payable' ? '立即付款' : '记录收款'}</button>` : ''}<button class="plan-more" data-action="obligation-plan-menu" data-plan="${plan.planId}" aria-label="更多计划操作">•••</button></div>
        </article>`;
      }
      const overview = installmentPlanOverview(plan, data.getObligationInstances(plan.planId), data.today);
      const progress = plan.totalRepayableMinor ? Math.min(100, Math.round((overview.paidMinor / plan.totalRepayableMinor) * 100)) : 0;
      return `<article class="surface plan-compact-card" data-action="obligation-plan-detail" data-plan="${plan.planId}" role="button" tabindex="0">
        <div class="row-between"><div><strong>${escapeHTML(plan.title)}</strong><small>还给 ${escapeHTML(name(plan.creditorParticipantId))}${plan.merchant ? ` · ${escapeHTML(plan.merchant)}` : ''}</small></div><span class="channel-badge">${plan.status === 'completed' ? '已结清' : `第 ${overview.currentTerm}/${overview.termCount} 期`}</span></div>
        <div class="plan-installment-summary"><span>本期应还 <b class="num">${minorRM(overview.dueThisMonthMinor)}</b></span><span>剩余 <b class="num">${minorRM(overview.remainingMinor)}</b></span></div>
        <div class="plan-progress"><i style="width:${progress}%"></i></div><div class="row-between caption"><span>已完成 ${progress}%${overview.nextDueDate ? ` · 下期 ${fmtDateMY(overview.nextDueDate)}` : ''}</span>${overview.remainingMinor > 0 ? `<button class="plan-inline-primary" data-action="obligation-pay" data-plan="${plan.planId}">记录还款</button>` : ''}<button class="plan-more" data-action="obligation-plan-menu" data-plan="${plan.planId}" aria-label="更多计划操作">•••</button></div>
      </article>`;
    }).join('')}</div>` : `<button class="surface plans-empty-row" data-action="obligation-new-actions"><span>${icon('calendar', 19)}<span><strong>计划</strong><small>建立每月账或分期</small></span></span>${icon('chevronRight', 15)}</button>`}
  </section>`;
}

// ---- Ledger detail -----------------------------------------

function timelineRows(ledger) {
  const entries = data.getRelationshipEntries(ledger.ledgerId, { includeReversed: true }).map((entry) => ({ ...entry, rowKind: 'entry' }));
  const settlements = data.getRelationshipSettlements(ledger.ledgerId).map((settlement) => ({ ...settlement, rowKind: 'settlement', occurredAt: settlement.occurredAt, description: settlement.direction === 'received' ? '收到款' : '我还款' }));
  return [...entries, ...settlements].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

function entryRow(item, labels) {
  const settlement = item.rowKind === 'settlement';
  const amountMinor = item.amountMinor;
  const direction = settlement ? (item.direction === 'received' ? 1 : -1) : item.creditorParticipantId === ME ? 1 : -1;
  const action = settlement ? `data-action="ledger-settlement-detail" data-settlement="${item.settlementId}"` : item.transactionId ? `data-action="open-activity-detail" data-txn="${item.transactionId}"` : '';
  const stateLabel = item.status === 'reversed' ? ' · 已撤销' : !settlement && item.remainingMinor === 0 ? ' · 已结清' : !settlement && item.remainingMinor < item.amountMinor ? ` · 未结 ${minorRM(item.remainingMinor)}` : '';
  const clips = (item.attachmentIds?.length || 0) || (item.attachment ? 1 : 0);
  return `<li class="row ledger-history-row${item.status === 'reversed' ? ' reversed' : ''}${ui.ledgerFocusEntryId === item.entryId ? ' focused' : ''}" ${item.entryId ? `data-entry-id="${escapeHTML(item.entryId)}"` : ''} ${action}${action ? ' role="button" tabindex="0"' : ''}>
    <span class="row-icon">${icon(settlement ? 'check' : direction > 0 ? 'arrowDown' : 'arrowUp', 15)}</span>
    <div class="row-main"><div class="row-title">${escapeHTML(item.description || labels[item.entryType] || '关系账')}${clips ? `<button class="row-clip attachment-open" data-action="ledger-item-attachments" data-attachment-ids="${escapeHTML((item.attachmentIds || []).join(','))}" aria-label="查看 ${clips} 个附件">${icon('paperclip', 12)} ${clips > 1 ? clips : ''}</button>` : ''}</div><div class="caption">${fmtDateMY(item.occurredAt.slice(0, 10))} · ${fmtTimeAMPM(item.occurredAt.slice(11, 16))}${stateLabel}</div></div>
    <span class="num row-amt ${direction > 0 ? 'amt-pos' : 'amt-neg'}">${direction > 0 ? '+' : '−'}${minorRM(amountMinor)}</span>
  </li>`;
}

function detailHTML(ledger) {
  const summary = data.getRelationshipSummary(ledger.ledgerId);
  const person = ledger.derivedType === 'personal' ? counterparty(ledger) : null;
  const group = ledger.derivedType === 'group';
  const labels = typeLabels(ledger);
  const rows = timelineRows(ledger);
  const relevantRows = ui.ledgerView === 'history' ? rows : rows.filter((item) => item.rowKind === 'entry' && item.status !== 'reversed' && item.remainingMinor > 0);
  const shown = relevantRows.slice(0, ui.ledgerHistoryLimit);
  return `<div class="detail-nav"><button class="back-btn" data-action="ledger-back">${icon('chevronLeft', 18)} 账本</button></div>
    <section class="ledger-detail-head"><span class="avatar avatar-lg">${escapeHTML((person?.displayName || ledger.title).slice(0, 1))}</span><div><h2>${escapeHTML(ledger.title)}</h2><span class="channel-badge">${person ? participantStatus(person) : `${ledger.participantIds.length} 位成员`}</span></div></section>
    ${group ? avatarStackHTML(ledger) : ''}
    <section class="ledger-metrics detail"><div><span class="caption">${group ? '成员欠我' : '他欠我'}</span><strong class="num amt-pos">${minorRM(summary.receivableMinor)}</strong></div><div><span class="caption">${group ? '我欠成员' : '我欠他'}</span><strong class="num amt-neg">${minorRM(summary.payableMinor)}</strong></div><div><span class="caption">最终净额</span><strong class="num">${minorRM(summary.netMinor)}</strong></div></section>
    ${group ? memberBalancesHTML(ledger) : ''}
    <div class="ledger-action-grid ledger-primary-actions">
      <button data-action="ledger-entry-actions">记一笔</button>
      ${summary.receivableMinor ? '<button data-action="ledger-open-settle" data-direction="received">收到款</button>' : ''}${summary.payableMinor ? '<button data-action="ledger-open-settle" data-direction="paid">我还款</button>' : ''}
    </div>
    ${plansPaymentsSectionHTML(ledger)}
    <section class="section"><div class="row-between sec-head"><h2 class="sec-title">${ui.ledgerView === 'current' ? '当前未结' : '结算历史'}</h2><div class="segmented ledger-view-switch"><button class="seg-item${ui.ledgerView === 'current' ? ' active' : ''}" data-action="ledger-view" data-view="current">未结</button><button class="seg-item${ui.ledgerView === 'history' ? ' active' : ''}" data-action="ledger-view" data-view="history">历史</button></div></div>
      <div class="surface"><ul>${shown.map((item) => entryRow(item, labels)).join('') || '<li class="row row-static caption">没有记录。</li>'}</ul></div>
      <div class="caption load-note">已显示 ${shown.length} / ${relevantRows.length} 条</div>${relevantRows.length > shown.length ? '<button class="load-more surface" data-action="ledger-load-more">加载更多</button>' : ''}
    </section>`;
}

function renderLedger(container) {
  const ledger = ui.ledgerId ? data.getRelationshipLedger(ui.ledgerId) : null;
  container.innerHTML = ledger ? detailHTML(ledger) : overviewHTML();
  if (ui.ledgerFocusEntryId) queueMicrotask(() => container.querySelector(`[data-entry-id="${CSS.escape(ui.ledgerFocusEntryId)}"]`)?.scrollIntoView({ block: 'center' }));
  if (ui.planDetailId && !document.querySelector('.plan-detail-sheet')) queueMicrotask(() => planDetailSheet(ui.planDetailId));
}

// ---- Shared form helpers -----------------------------------

function cashAccounts() {
  return data.getAccounts().filter((account) => account.type !== 'cc');
}

function accountLabel(id) {
  return data.getAccount(id)?.name || '选择账户';
}

function bindAccountPicker(sheet, key, getSelected, setSelected, { beforeOpen } = {}) {
  sheet.querySelector(`[data-picker-field="${key}"]`)?.addEventListener('click', () => {
    beforeOpen?.();
    openPickerSheet({
      title: '选择账户',
      selectedValue: getSelected(),
      options: cashAccounts().map((account) => ({ value: account.id, label: account.name, caption: `余额 ${fmtRM(account.balance)}` })),
      onSelect: (value) => { setSelected(value); const label = sheet.querySelector(`[data-picker-field-label="${key}"]`); if (label) label.textContent = accountLabel(value); },
    });
  });
}

function handleLedgerCapacity(error, { context = 'repayment', draft, retry, reopen }) {
  if (!isAccountCapacityError(error)) return toast(error.message || '无法保存');
  return openCapacityAlert({
    capacity: error.capacity,
    context,
    onApprove: retry,
    onChangeAccount: () => openPickerSheet({
      title: context === 'transfer' ? '更换转出账户' : '更换付款账户',
      selectedValue: draft.accountId,
      options: cashAccounts().map((account) => ({ value: account.id, label: account.name, caption: `余额 ${fmtRM(account.balance)}` })),
      onSelect: (value) => { draft.accountId = value; reopen?.(); },
    }),
  });
}

// ---- Relationship entry sheet ------------------------------

let entryDraft = null;

function syncEntryDraft(form) {
  if (!form) return;
  entryDraft.desc = form.querySelector('[data-rel-desc]')?.value ?? entryDraft.desc;
  entryDraft.recordOnly = Boolean(form.querySelector('[data-rel-record]')?.checked);
}

function entrySheetHTML(ledger) {
  const labels = typeLabels(ledger);
  const type = entryDraft.type;
  const group = ledger.derivedType === 'group';
  let amountMinor = 0;
  try { amountMinor = moneyStringToMinor(entryDraft.amount || '0'); } catch { /* validation appears on save */ }
  let splitValid = true;
  let body = `${moneyFieldHTML({ label: '金额', key: 'rel-amount', value: entryDraft.amount })}
    <label class="cap-field"><span class="caption">备注</span><input type="text" maxlength="40" data-rel-desc value="${escapeHTML(entryDraft.desc)}" placeholder="点击输入备注" /></label>`;
  if (type === 'split_expense') {
    body += pickerFieldHTML({ label: '谁付款', key: 'payer', valueLabel: entryDraft.payerParticipantId === ME ? '我付款' : `${name(entryDraft.payerParticipantId)} 付款` });
    body += `<div class="caption cap-account-label">参与分摊</div><div class="split-members" role="group" aria-label="参与分摊">${ledger.participantIds.map((id) => `<button type="button" class="split-member${entryDraft.splitParticipantIds.includes(id) ? ' active' : ''}" data-action="ledger-split-member" data-participant="${id}" aria-pressed="${entryDraft.splitParticipantIds.includes(id)}">${escapeHTML(name(id))}</button>`).join('')}</div>`;
    body += `<div class="segmented"><button class="seg-item${entryDraft.splitMode !== 'custom' ? ' active' : ''}" data-action="ledger-split-mode" data-mode="equal">平均</button><button class="seg-item${entryDraft.splitMode === 'custom' ? ' active' : ''}" data-action="ledger-split-mode" data-mode="custom">自定义</button></div>`;
    if (entryDraft.splitMode === 'custom') {
      entryDraft.customShares = rebuildSplitShares({ totalMinor: amountMinor, participantIds: entryDraft.splitParticipantIds, previous: entryDraft.customShares });
      const summary = allocationSummary(amountMinor, entryDraft.customShares, entryDraft.splitParticipantIds);
      const suggestion = suggestedMissingShare(amountMinor, entryDraft.splitParticipantIds, entryDraft.customShares);
      splitValid = summary.exact;
      body += `<div class="custom-shares smart-split-fields">${entryDraft.splitParticipantIds.map((id) => moneyFieldHTML({ label: name(id), key: `rel-share-${id}`, value: (Number(entryDraft.customShares[id] || 0) / 100).toFixed(2) })).join('')}</div>
        <div class="smart-split-summary${summary.overMinor ? ' over' : summary.exact ? ' exact' : ''}${entryDraft.error ? ' error-emphasis error-shake' : ''}" data-ledger-split-summary><span>总额 <strong class="num">${formatMoneyMinor(amountMinor)}</strong></span><span>已分 <strong class="num">${formatMoneyMinor(summary.allocatedMinor)}</strong></span><span>${summary.overMinor ? '超出' : summary.exact ? '差额' : '剩余'} <strong class="num">${formatMoneyMinor(summary.overMinor || summary.remainingMinor)}</strong></span></div>
        ${entryDraft.error ? `<div class="form-error">${escapeHTML(entryDraft.error)} · 自定义分摊必须与总额一致</div>` : ''}
        ${suggestion ? `<div class="smart-split-suggestion caption">${escapeHTML(name(suggestion.participantId))} 可补 ${formatMoneyMinor(suggestion.amountMinor)}</div>` : ''}
        <div class="smart-split-actions"><button data-action="ledger-split-even">平均分配</button><button data-action="ledger-split-remainder" ${summary.remainingMinor ? '' : 'disabled'}>补给最后一人</button><button data-action="ledger-split-clear">清空</button></div>`;
    } else {
      const shares = equalSplitMinor(amountMinor, entryDraft.splitParticipantIds);
      body += `<div class="equal-split-preview">${entryDraft.splitParticipantIds.map((id) => `<span><small>${escapeHTML(name(id))}</small><strong class="num">${formatMoneyMinor(shares[id])}</strong></span>`).join('')}</div><div class="relationship-preview caption">最后一位自动吸收分币差额</div>`;
    }
    if (entryDraft.payerParticipantId === ME) body += pickerFieldHTML({ label: '付款账户', key: 'account', valueLabel: accountLabel(entryDraft.accountId) });
    else body += `<div class="relationship-preview caption">由 ${escapeHTML(name(entryDraft.payerParticipantId))} 付款，不会扣除你的账户余额。</div>`;
  } else if (type === 'direct_receivable') {
    body += pickerFieldHTML({ label: group ? '哪位成员欠我' : '谁欠我', key: 'counterparty', valueLabel: name(entryDraft.participantId) });
    body += pickerFieldHTML({ label: '付款账户（我垫付时）', key: 'account', valueLabel: accountLabel(entryDraft.accountId) });
  } else {
    body += pickerFieldHTML({ label: group ? '我欠哪位成员' : '我欠谁', key: 'counterparty', valueLabel: name(entryDraft.participantId) });
    body += '<div class="relationship-preview caption">只增加应付，不会立刻扣除你的账户。</div>';
  }
  body += nativeDateTimeFieldsHTML({ prefix: 'rel', date: entryDraft.date, time: entryDraft.time });
  body += attachmentSummaryHTML('draft', entryDraft.draftKey);
  const supportsRecordOnly = type === 'direct_receivable' || (type === 'split_expense' && entryDraft.payerParticipantId === ME);
  body += supportsRecordOnly
    ? `<label class="transaction-check"><input type="checkbox" data-rel-record ${entryDraft.recordOnly ? 'checked' : ''} /><span><strong>只记录</strong><small>不影响账户余额</small></span></label>`
    : '<div class="relationship-effect-note">关系账动作 · 你的账户余额不变</div>';
  return `<div data-ledger-entry-form data-type="${type}">${body}</div><button class="sheet-primary${splitValid ? '' : ' visually-disabled'}" data-action="ledger-entry-confirm" data-disabled-visual="${!splitValid}" aria-disabled="${!splitValid}">保存</button><button class="sheet-secondary" data-action="ledger-return">取消</button>`;
}

function openEntrySheet() {
  const ledger = data.getRelationshipLedger(ui.ledgerId);
  const labels = typeLabels(ledger);
  const sheet = openSheet({ title: labels[entryDraft.type], className: 'relationship-command-sheet', contentHTML: entrySheetHTML(ledger) });
  const form = sheet.querySelector('[data-ledger-entry-form]');
  bindMoneyField(sheet, 'rel-amount', { getValue: () => entryDraft.amount, setValue: (value) => { entryDraft.amount = value; openEntrySheet(); } });
  entryDraft.splitParticipantIds.forEach((id) => bindMoneyField(sheet, `rel-share-${id}`, {
    getValue: () => (Number(entryDraft.customShares?.[id] || 0) / 100).toFixed(2),
    setValue: (_value, result) => { entryDraft.customShares[id] = result.minor; openEntrySheet(); },
    allowZero: true,
  }));
  bindNativeDateTimeFields(sheet, { onDateChange: (value) => { entryDraft.date = value; }, onTimeChange: (value) => { entryDraft.time = value; } });
  bindAttachmentField(sheet);
  bindAccountPicker(sheet, 'account', () => entryDraft.accountId, (value) => { entryDraft.accountId = value; }, { beforeOpen: () => syncEntryDraft(form) });
  sheet.querySelector('[data-picker-field="payer"]')?.addEventListener('click', () => {
    syncEntryDraft(form);
    openPickerSheet({
      title: '谁付款', selectedValue: entryDraft.payerParticipantId,
      options: ledger.participantIds.map((id) => ({ value: id, label: id === ME ? '我付款' : `${name(id)} 付款`, avatar: name(id).slice(0, 1) })),
      onSelect: (value) => { entryDraft.payerParticipantId = value; openEntrySheet(); },
    });
  });
  sheet.querySelector('[data-picker-field="counterparty"]')?.addEventListener('click', () => {
    syncEntryDraft(form);
    openPickerSheet({
      title: entryDraft.type === 'direct_receivable' ? '谁欠我' : '我欠谁', selectedValue: entryDraft.participantId,
      options: ledger.participantIds.filter((id) => id !== ME).map((id) => ({ value: id, label: name(id), avatar: name(id).slice(0, 1) })),
      onSelect: (value) => { entryDraft.participantId = value; openEntrySheet(); },
    });
  });
}

function entrySheet(type) {
  const ledger = data.getRelationshipLedger(ui.ledgerId);
  entryDraft = {
    type, amount: '100.00', desc: '', payerParticipantId: ME,
    participantId: ledger.participantIds.find((id) => id !== ME),
    splitMode: 'equal', splitParticipantIds: [...ledger.participantIds], customShares: {},
    accountId: cashAccounts()[0]?.id, recordOnly: false,
    date: data.today, time: nowTime(), draftKey: uid('ledger-entry'), commandKey: uid('ledger-entry-cmd'),
    error: '',
  };
  openEntrySheet();
}

// ---- Settlement sheet --------------------------------------

let settleDraft = null;

function settlementSheet(direction) {
  const summary = data.getRelationshipSummary(ui.ledgerId);
  const maximum = direction === 'received' ? summary.receivableMinor : summary.payableMinor;
  settleDraft = { direction, amount: (maximum / 100).toFixed(2), accountId: cashAccounts()[0]?.id, recordOnly: false, date: data.today, time: nowTime(), draftKey: uid('settle'), commandKey: uid('settlement') };
  openSettlementSheet(maximum);
}

function openSettlementSheet(maximum) {
  const direction = settleDraft.direction;
  const sheet = openSheet({ title: direction === 'received' ? '收到款' : '我还款', className: 'settlement-sheet', contentHTML: `<div data-settlement-form data-direction="${direction}">
    <div class="detail-hero"><div class="caption">当前可结算</div><div class="num detail-amt">${minorRM(maximum)}</div></div>
    ${moneyFieldHTML({ label: '本次金额', key: 'settle-amount', value: settleDraft.amount })}
    ${pickerFieldHTML({ label: direction === 'received' ? '入账账户' : '付款账户', key: 'settle-account', valueLabel: accountLabel(settleDraft.accountId) })}
    ${nativeDateTimeFieldsHTML({ prefix: 'settle', date: settleDraft.date, time: settleDraft.time })}
    ${attachmentSummaryHTML('draft', settleDraft.draftKey)}
    <label class="transaction-check"><input type="checkbox" data-settle-record ${settleDraft.recordOnly ? 'checked' : ''} /><span><strong>只记录</strong><small>不影响账户余额</small></span></label>
  </div><button class="sheet-primary" data-action="ledger-settle-confirm">确认结算</button><button class="sheet-secondary" data-action="ledger-return">取消</button>` });
  bindMoneyField(sheet, 'settle-amount', { getValue: () => settleDraft.amount, setValue: (value) => { settleDraft.amount = value; }, maxMinor: maximum });
  bindNativeDateTimeFields(sheet, { onDateChange: (value) => { settleDraft.date = value; }, onTimeChange: (value) => { settleDraft.time = value; } });
  bindAttachmentField(sheet);
  bindAccountPicker(sheet, 'settle-account', () => settleDraft.accountId, (value) => { settleDraft.accountId = value; });
}

function settlementDetail(id) {
  const settlement = data.getRelationshipSettlements(ui.ledgerId).find((item) => item.settlementId === id); if (!settlement) return;
  const clips = settlement.attachmentIds?.length || 0;
  openSheet({ title: '结算详情', contentHTML: `<div class="detail-hero"><div class="num detail-amt">${minorRM(settlement.amountMinor)}</div><div class="caption">${settlement.direction === 'received' ? '收到款' : '我还款'} · ${fmtDateMY(settlement.occurredAt.slice(0, 10))}</div>${clips ? `<button class="attachment-open" data-action="ledger-item-attachments" data-attachment-ids="${escapeHTML(settlement.attachmentIds.join(','))}">${icon('paperclip', 12)} ${clips} 个附件</button>` : ''}</div>${settlement.status === 'active' ? `<button class="sheet-danger" data-action="ledger-settlement-reverse" data-settlement="${id}">撤销这次结算</button>` : '<div class="mutation-lock-note caption">这次结算已经撤销。</div>'}<button class="sheet-secondary" data-action="ledger-return">完成</button>` });
}

function addPersonSheet() {
  openSheet({ title: '添加对象', contentHTML: `<label class="cap-field"><span class="caption">名称</span><input data-new-participant maxlength="30" placeholder="例如 Alex" /></label><button class="sheet-primary" data-action="ledger-add-person-confirm">添加</button><button class="sheet-secondary" data-action="sheet-close">取消</button>` });
}

// ---- Obligation sheets -------------------------------------

let planDraft = null;
let payDraft = null;
let earlyDraft = null;

function syncPlanDraft(form) {
  if (!form) return;
  ['title', 'amount', 'terms', 'dueDay', 'merchant', 'principal', 'fee'].forEach((key) => {
    const input = form.querySelector(`[data-plan-${key}]`);
    if (input) planDraft[key] = input.value;
  });
  planDraft.reminderEnabled = Boolean(form.querySelector('[data-plan-reminder]')?.checked);
}

function planSheetHTML(ledger) {
  const monthly = planDraft.planType === 'recurring_monthly';
  const terms = Math.max(1, Number(planDraft.terms) || 1);
  const principal = Number(planDraft.principal) || 0;
  const fee = Number(planDraft.fee) || 0;
  const totalRepayable = principal + fee;
  const perTerm = totalRepayable > 0 && !monthly ? Math.floor((totalRepayable * 100) / terms) / 100 : 0;
  return `<div data-plan-form>
    <label class="cap-field"><span class="caption">名称</span><input type="text" maxlength="30" data-plan-title value="${escapeHTML(planDraft.title)}" placeholder="${monthly ? '例如 Kampung 房租' : '例如 Shopee 手机分期'}" /></label>
    <div class="segmented"><button class="seg-item${planDraft.direction === 'payable' ? ' active' : ''}" data-action="plan-direction" data-direction="payable">我付对方</button><button class="seg-item${planDraft.direction === 'receivable' ? ' active' : ''}" data-action="plan-direction" data-direction="receivable">对方付我</button></div>
    ${pickerFieldHTML({ label: '对方', key: 'plan-counterparty', valueLabel: name(planDraft.counterpartyId) })}
    ${monthly ? moneyFieldHTML({ label: '每月金额', key: 'plan-amount', value: planDraft.amount }) : `
      <label class="cap-field"><span class="caption">商家／提供方（可选）</span><input type="text" maxlength="30" data-plan-merchant value="${escapeHTML(planDraft.merchant)}" placeholder="例如 Shopee LatePay" /></label>
      ${moneyFieldHTML({ label: '本金', key: 'plan-principal', value: planDraft.principal })}
      ${moneyFieldHTML({ label: '费用（可为 0）', key: 'plan-fee', value: planDraft.fee })}
      <div class="relationship-preview caption num">总应还 ${fmtRM(totalRepayable)}</div>
      <label class="cap-field"><span class="caption">期数</span><input type="number" min="1" max="60" step="1" data-plan-terms value="${escapeHTML(String(planDraft.terms))}" /></label>
      ${totalRepayable > 0 ? `<div class="relationship-preview caption num">每期约 ${fmtRM(perTerm)} · 共 ${terms} 期 · 最后一期吸收尾差</div>` : ''}`}
    <label class="cap-field"><span class="caption">每月到期日（1–31）</span><input type="number" min="1" max="31" step="1" data-plan-dueDay value="${escapeHTML(String(planDraft.dueDay))}" /></label>
    ${nativeDateTimeFieldsHTML({ prefix: 'plan', date: planDraft.startDate, time: planDraft.time, dateLabel: '开始日期', timeLabel: '记录时间' })}
    ${monthly ? `${datePickerFieldHTML({ label: '结束日期（可选）', key: 'plan-end', value: planDraft.endDate, emptyLabel: '不设结束日期' })}
      <label class="transaction-check"><input type="checkbox" data-plan-reminder ${planDraft.reminderEnabled ? 'checked' : ''} /><span><strong>到期提醒</strong><small>到期前 1 天提醒（仅本地元数据）</small></span></label>` : ''}
    ${pickerFieldHTML({ label: '默认账户', key: 'plan-account', valueLabel: accountLabel(planDraft.accountId) })}
    ${attachmentSummaryHTML('draft', planDraft.draftKey)}
  </div><button class="sheet-primary" data-action="plan-create-confirm">创建</button><button class="sheet-secondary" data-action="ledger-return">取消</button>`;
}

function openPlanSheet() {
  const ledger = data.getRelationshipLedger(ui.ledgerId);
  const monthly = planDraft.planType === 'recurring_monthly';
  const sheet = openSheet({ title: monthly ? '新建每月账' : '新建分期', className: 'relationship-command-sheet', contentHTML: planSheetHTML(ledger) });
  const form = sheet.querySelector('[data-plan-form]');
  bindNativeDateTimeFields(sheet, { onDateChange: (value) => { planDraft.startDate = value; }, onTimeChange: (value) => { planDraft.time = value; } });
  if (monthly) bindDatePickerField(sheet, 'plan-end', { onDateChange: (value) => { planDraft.endDate = value; } });
  ['amount', 'principal', 'fee'].forEach((key) => bindMoneyField(sheet, `plan-${key}`, {
    getValue: () => planDraft[key],
    setValue: (value) => { planDraft[key] = value; openPlanSheet(); },
    allowZero: key === 'fee',
  }));
  bindAttachmentField(sheet);
  bindAccountPicker(sheet, 'plan-account', () => planDraft.accountId, (value) => { planDraft.accountId = value; }, { beforeOpen: () => syncPlanDraft(form) });
  sheet.querySelector('[data-picker-field="plan-counterparty"]')?.addEventListener('click', () => {
    syncPlanDraft(form);
    openPickerSheet({
      title: '对方', selectedValue: planDraft.counterpartyId,
      options: ledger.participantIds.filter((id) => id !== ME).map((id) => ({ value: id, label: name(id), avatar: name(id).slice(0, 1) })),
      onSelect: (value) => { planDraft.counterpartyId = value; openPlanSheet(); },
    });
  });
  ['terms'].forEach((key) => form.querySelector(`[data-plan-${key}]`)?.addEventListener('change', () => { syncPlanDraft(form); openPlanSheet(); }));
}

function newPlanSheet(planType) {
  const ledger = data.getRelationshipLedger(ui.ledgerId);
  planDraft = {
    planType, direction: 'payable', counterpartyId: ledger.participantIds.find((id) => id !== ME),
    title: '', amount: '', merchant: '', principal: '', fee: '0', terms: '6', dueDay: '7', startDate: data.today, endDate: '', time: nowTime(), reminderEnabled: false,
    accountId: cashAccounts()[0]?.id, draftKey: uid('plan'),
  };
  openPlanSheet();
}

function payableRemaining(plan) {
  return data.getObligationInstances(plan.planId).filter((instance) => instanceRemaining(instance) > 0).reduce((sum, instance) => sum + instanceRemaining(instance), 0);
}

function paymentSheet(planId, { preserve = false } = {}) {
  const plan = data.getObligationPlan(planId);
  const open = data.getObligationInstances(planId).filter((instance) => instanceRemaining(instance) > 0);
  const target = open[0];
  const suggested = plan.planType === 'installment' ? (target ? instanceRemaining(target) : 0) : (open.find((instance) => instance.periodKey === data.today.slice(0, 7)) ? instanceRemaining(open.find((instance) => instance.periodKey === data.today.slice(0, 7))) : payableRemaining(plan));
  if (!preserve) payDraft = { planId, amount: (suggested / 100).toFixed(2), accountId: plan.defaultAccountId || cashAccounts()[0]?.id, recordOnly: false, date: data.today, time: nowTime(), draftKey: uid('oblpay'), commandKey: uid('oblpay-cmd') };
  const payable = plan.direction === 'payable';
  const sheet = openSheet({ title: payable ? `${plan.title} · 付款` : `${plan.title} · 收款`, className: 'settlement-sheet', contentHTML: `<div data-obligation-pay-form>
    <div class="detail-hero"><div class="caption">未结余额</div><div class="num detail-amt">${minorRM(payableRemaining(plan))}</div>${target ? `<div class="caption">最近一期 ${target.periodKey} · 到期 ${fmtDateMY(target.dueDate)} · 剩 ${minorRM(instanceRemaining(target))}</div>` : ''}</div>
    ${moneyFieldHTML({ label: `本次金额（可部分${payable ? '付款' : '收款'}）`, key: 'pay-amount', value: payDraft.amount })}
    ${pickerFieldHTML({ label: payable ? '付款账户' : '入账账户', key: 'pay-account', valueLabel: accountLabel(payDraft.accountId) })}
    ${nativeDateTimeFieldsHTML({ prefix: 'pay', date: payDraft.date, time: payDraft.time })}
    ${attachmentSummaryHTML('draft', payDraft.draftKey)}
    <label class="transaction-check"><input type="checkbox" data-pay-record /><span><strong>只记录</strong><small>不影响账户余额</small></span></label>
  </div><button class="sheet-primary" data-action="obligation-pay-confirm" data-plan="${planId}">确认</button><button class="sheet-secondary" data-action="ledger-return">取消</button>` });
  bindMoneyField(sheet, 'pay-amount', { getValue: () => payDraft.amount, setValue: (value) => { payDraft.amount = value; }, maxMinor: payableRemaining(plan) });
  bindNativeDateTimeFields(sheet, { onDateChange: (value) => { payDraft.date = value; }, onTimeChange: (value) => { payDraft.time = value; } });
  bindAttachmentField(sheet);
  bindAccountPicker(sheet, 'pay-account', () => payDraft.accountId, (value) => { payDraft.accountId = value; });
}

function historySheet(planId) {
  const plan = data.getObligationPlan(planId);
  const instances = data.getObligationInstances(planId);
  const payments = data.getObligationPayments(planId);
  openSheet({ title: `${plan.title} · 历史`, className: 'obligation-history-sheet', contentHTML: `
    <div class="sheet-group"><div class="caption sheet-group-label">${plan.planType === 'installment' ? '期数' : '月份'}</div><ul class="obligation-instance-list">
      ${instances.map((instance) => `<li class="row row-static"><div class="row-main"><div class="row-title">${instance.termNumber ? `第 ${instance.termNumber} 期 · ` : ''}${instance.periodKey}</div><div class="caption">到期 ${fmtDateMY(instance.dueDate)} · ${PLAN_STATE_LABEL[instanceState(instance, data.today)]}</div></div><span class="num row-amt">${minorRM(instance.amountPaidMinor)} / ${minorRM(instance.amountDueMinor)}</span></li>`).join('')}
    </ul></div>
    <div class="sheet-group"><div class="caption sheet-group-label">付款记录</div><ul class="obligation-instance-list">
      ${payments.map((payment) => { const clips = payment.attachmentIds?.length || 0; return `<li class="row row-static${payment.status === 'reversed' ? ' reversed' : ''}"><div class="row-main"><div class="row-title num">${minorRM(payment.amountMinor)}</div><div class="caption">${fmtDateMY(payment.occurredAt.slice(0, 10))}${payment.status === 'reversed' ? ' · 已撤销' : ''}</div>${clips ? `<button class="attachment-open" data-action="obligation-attachments" data-attachment-ids="${escapeHTML(payment.attachmentIds.join(','))}">${icon('paperclip', 12)} ${clips} 个附件</button>` : ''}</div>${payment.status === 'active' ? `<button class="obligation-reverse" data-action="obligation-payment-reverse-request" data-plan="${planId}" data-payment="${payment.paymentId}">撤销</button>` : ''}</li>`; }).join('') || '<li class="row row-static caption">还没有付款。</li>'}
    </ul></div>
    <button class="sheet-primary" data-action="ledger-return">完成</button>` });
}

function scheduleSheet(planId) {
  const plan = data.getObligationPlan(planId);
  const instances = data.getObligationInstances(planId);
  openSheet({ title: `${plan.title} · 计划`, contentHTML: `
    <div class="detail-hero"><div class="num detail-amt">${minorRM(plan.totalRepayableMinor)}</div><div class="caption">${plan.termCount} 期 · 每月 ${plan.dueDay} 号 · ${escapeHTML(plan.merchant || '')}</div></div>
    <ul class="obligation-instance-list">${instances.map((instance) => `<li class="row row-static"><div class="row-main"><div class="row-title">第 ${instance.termNumber} 期 · ${instance.periodKey}</div><div class="caption">到期 ${fmtDateMY(instance.dueDate)} · ${PLAN_STATE_LABEL[instanceState(instance, data.today)]}</div></div><span class="num row-amt">${minorRM(instance.amountDueMinor)}</span></li>`).join('')}</ul>
    <button class="sheet-primary" data-action="ledger-return">完成</button>` });
}

function confirmSheet({ title, note, action, planId, danger = true }) {
  openSheet({ title, contentHTML: `<div class="detail-hero"><div class="caption">${escapeHTML(note)}</div></div><button class="${danger ? 'sheet-danger' : 'sheet-primary'}" data-action="${action}" data-plan="${planId}" data-confirmed="1">确认${title}</button><button class="sheet-secondary" data-action="ledger-return">取消</button>` });
}

function ledgerEntryActionsSheet() {
  const ledger = data.getRelationshipLedger(ui.ledgerId);
  const labels = typeLabels(ledger);
  openSheet({ title: '记一笔', className: 'compact-action-sheet', contentHTML: `<div class="compact-action-list">
    <button data-action="ledger-new-entry" data-type="split_expense">${icon('aa', 20)}<span><strong>AA 分账</strong><small>记录多人分摊</small></span>${icon('chevronRight', 14)}</button>
    <button data-action="ledger-new-entry" data-type="direct_receivable">${icon('arrowDown', 20)}<span><strong>${labels.direct_receivable}</strong><small>建立待收关系账</small></span>${icon('chevronRight', 14)}</button>
    <button data-action="ledger-new-entry" data-type="direct_payable">${icon('arrowUp', 20)}<span><strong>${labels.direct_payable}</strong><small>建立待付关系账</small></span>${icon('chevronRight', 14)}</button>
  </div><button class="sheet-secondary" data-action="ledger-return">取消</button>` });
}

function newPlanActionsSheet() {
  openSheet({ title: '新建计划', className: 'compact-action-sheet', contentHTML: `<div class="compact-action-list">
    <button data-action="obligation-new-monthly">${icon('calendar', 20)}<span><strong>每月账</strong><small>房租、家用等固定往来</small></span>${icon('chevronRight', 14)}</button>
    <button data-action="obligation-new-installment">${icon('repayment', 20)}<span><strong>分期</strong><small>按期追踪本金、费用与还款</small></span>${icon('chevronRight', 14)}</button>
  </div><button class="sheet-secondary" data-action="ledger-return">取消</button>` });
}

function planDetailSheet(planId) {
  const plan = data.getObligationPlan(planId);
  if (!plan) return toast('计划不存在');
  const instances = data.getObligationInstances(planId);
  const payments = data.getObligationPayments(planId);
  const monthly = plan.planType === 'recurring_monthly';
  const overview = monthly ? monthlyPlanOverview(plan, instances, data.today) : installmentPlanOverview(plan, instances, data.today);
  const remainingMinor = monthly
    ? instances.reduce((sum, instance) => sum + instanceRemaining(instance), 0)
    : overview.remainingMinor;
  const dueMinor = monthly ? (overview.current ? instanceRemaining(overview.current) : 0) : overview.dueThisMonthMinor;
  const current = monthly ? overview.current : instances.find((instance) => instanceRemaining(instance) > 0);
  const currentState = current ? instanceState(current, data.today) : null;
  const overdueDays = currentState === 'overdue' ? Math.max(0, daysBetween(current.dueDate, data.today)) : 0;
  const planStatus = plan.status === 'active' ? '进行中' : PLAN_STATUS_LABEL[plan.status];
  const periodStatus = currentState ? PLAN_STATE_LABEL[currentState] : '暂无本期';
  data.recordPlanDetailOpened?.(planId);
  openSheet({ title: plan.title, className: 'plan-detail-sheet', contentHTML: `<div class="plan-detail-hero" data-plan-detail-id="${escapeHTML(planId)}">
      <div class="row-between"><span class="channel-badge">计划 ${planStatus}</span><span class="channel-badge${currentState === 'overdue' ? ' badge-warn' : ''}">本期 ${periodStatus}</span></div>
      <small>本期应${plan.direction === 'payable' ? '付' : '收'}</small><strong class="num">${minorRM(dueMinor)}</strong>
      ${current ? `<div><span>本期到期 ${fmtDateMY(current.dueDate)}</span>${overdueDays ? `<strong class="amt-neg">已逾期 ${overdueDays} 天</strong>` : ''}</div>` : ''}
      ${overview.nextPreview ? `<div class="plan-next-period"><span>下一期</span><span>${fmtDateMY(overview.nextPreview.dueDate)}</span></div>` : ''}
    </div>
    <div class="sheet-group plan-info"><div class="caption sheet-group-label">计划信息</div><ul>
      <li class="detail-row"><span>类型</span><strong>${monthly ? '每月账' : '分期'}</strong></li>
      <li class="detail-row"><span>对象</span><strong>${escapeHTML(name(plan.direction === 'payable' ? plan.creditorParticipantId : plan.debtorParticipantId))}</strong></li>
      <li class="detail-row"><span>开始日期</span><strong>${fmtDateMY(plan.startDate)}</strong></li>
      <li class="detail-row"><span>每月到期</span><strong>${plan.dueDay}号</strong></li>
      <li class="detail-row"><span>计划状态</span><strong>${planStatus}</strong></li>
      <li class="detail-row"><span>本期状态</span><strong class="${currentState === 'overdue' ? 'amt-neg' : ''}">${periodStatus}</strong></li>
      ${!monthly ? `<li class="detail-row"><span>进度</span><strong>${minorRM(overview.paidMinor)} / ${minorRM(plan.totalRepayableMinor)}</strong></li>` : ''}
    </ul></div>
    <div class="sheet-group"><div class="caption sheet-group-label">最近账期</div><div class="plan-period-list">${instances.slice(-4).reverse().map((instance) => `<article class="plan-period-row"><div><strong>${instance.termNumber ? `第 ${instance.termNumber} 期` : `${Number(instance.periodKey.slice(0,4))}年${Number(instance.periodKey.slice(5))}月`}</strong><span class="caption">到期 ${fmtDateMY(instance.dueDate)}</span><span class="caption num">已付 ${minorRM(instance.amountPaidMinor)} / ${minorRM(instance.amountDueMinor)}</span></div><span class="channel-badge${instanceState(instance, data.today) === 'overdue' ? ' badge-warn' : ''}">${PLAN_STATE_LABEL[instanceState(instance, data.today)]}</span></article>`).join('') || '<div class="caption">暂无账期</div>'}</div></div>
    <div class="sheet-group"><div class="caption sheet-group-label">付款历史</div><div class="plan-payment-list">${payments.slice(-4).reverse().map((payment) => { const transaction = payment.transactionId ? data.getTransaction(payment.transactionId) : null; const account = transaction ? data.getAccount(transaction.sourceAccountId || transaction.destinationAccountId) : null; const attachments = data.getAttachmentsByIds(payment.attachmentIds || []); return `<article class="plan-payment-row"><div class="row-between"><strong class="num">${minorRM(payment.amountMinor)}</strong><span class="caption">${fmtDateMY(payment.occurredAt.slice(0, 10))}</span></div><div class="caption">${account ? `账户 ${escapeHTML(account.name)}` : '迁移记录'}${transaction?.desc ? ` · ${escapeHTML(transaction.desc)}` : ''}</div>${attachments.length ? `<button class="payment-receipt" data-action="obligation-attachments" data-attachment-ids="${escapeHTML(attachments.map((item) => item.attachmentId).join(','))}">${attachments[0].kind === 'photo' && attachments[0].localObjectUrl ? `<img src="${escapeHTML(attachments[0].localObjectUrl)}" alt="收据缩略图" />` : icon('paperclip', 14)}<span>附件 ${attachments.length} 个</span>${icon('chevronRight', 13)}</button>` : ''}</article>`; }).join('') || '<div class="caption">暂无付款</div>'}</div></div>
    ${plan.attachmentIds?.length ? `<button class="attachment-open plan-detail-attachments" data-action="obligation-attachments" data-attachment-ids="${escapeHTML(plan.attachmentIds.join(','))}">${icon('paperclip', 14)} 附件 ${plan.attachmentIds.length} 个 ${icon('chevronRight', 13)}</button>` : ''}
    ${remainingMinor > 0 ? `<button class="sheet-primary" data-action="obligation-pay" data-plan="${planId}">${plan.direction === 'payable' ? '立即付款' : '记录收款'}</button>` : ''}
    <button class="sheet-secondary" data-action="obligation-plan-menu" data-plan="${planId}">更多操作</button>
    <button class="sheet-secondary" data-action="ledger-return">完成</button>` });
}

function planMenuSheet(planId) {
  const plan = data.getObligationPlan(planId);
  if (!plan) return toast('计划不存在');
  const monthly = plan.planType === 'recurring_monthly';
  openSheet({ title: '计划操作', className: 'compact-action-sheet', contentHTML: `<div class="compact-action-list">
    <button data-action="obligation-history" data-plan="${planId}">${icon('clock', 20)}<span><strong>付款历史</strong><small>查看账期与撤销入口</small></span>${icon('chevronRight', 14)}</button>
    ${!monthly ? `<button data-action="installment-schedule" data-plan="${planId}">${icon('calendar', 20)}<span><strong>完整计划</strong><small>查看所有分期</small></span>${icon('chevronRight', 14)}</button>${plan.status === 'active' ? `<button data-action="installment-early" data-plan="${planId}">${icon('check', 20)}<span><strong>提前结清</strong><small>一次付清当前剩余</small></span>${icon('chevronRight', 14)}</button>` : ''}` : `${plan.status === 'active' ? `<button data-action="obligation-pause" data-plan="${planId}">${icon('clock', 20)}<span><strong>暂停</strong><small>停止生成后续账期</small></span>${icon('chevronRight', 14)}</button>` : ''}${plan.status === 'paused' ? `<button data-action="obligation-resume" data-plan="${planId}">${icon('check', 20)}<span><strong>恢复</strong><small>从当前月份继续</small></span>${icon('chevronRight', 14)}</button>` : ''}`}
    ${plan.status !== 'stopped' && plan.status !== 'completed' ? `<button class="danger" data-action="obligation-stop" data-plan="${planId}">${icon('x', 20)}<span><strong>结束计划</strong><small>保留已有历史</small></span>${icon('chevronRight', 14)}</button>` : ''}
  </div><button class="sheet-secondary" data-action="ledger-return">取消</button>` });
}

function showTransactionMotion(transaction, fallbackMessage) {
  closeSheet();
  update({});
  openMoneyFlowConfirmation({
    transaction,
    onPresented: () => data.recordTransactionConfirmationPresented(transaction),
    onViewRecord: () => {
      update({ highlightActivityId: transaction.id, activityMonth: transaction.date.slice(0, 7), activityFilter: 'all', activityQuery: '' });
      navigate('activity');
    },
    onDone: () => toast(fallbackMessage),
  });
}

// ---- Actions -----------------------------------------------

export function registerLedgerFeature() {
  registerPage('ledger', renderLedger);
  registerAction('ledger-segment', (el) => update({ ledgerSegment: el.dataset.seg, ledgerId: null, ledgerHistoryLimit: 30 }));
  registerAction('open-ledger', (el) => pushRoute({ tab: 'ledger', ledgerId: el.dataset.ledger, ledgerView: 'current', ledgerHistoryLimit: 30 }, { direction: 'forward' }));
  registerAction('ledger-back', () => {
    const fallback = ui.ledgerReturnTransactionId
      ? { tab: 'activity', activityDetailId: ui.ledgerReturnTransactionId, ledgerId: null, ledgerFocusEntryId: null, ledgerReturnTransactionId: null }
      : { tab: 'ledger', ledgerId: null, ledgerFocusEntryId: null, ledgerHistoryLimit: 30 };
    backOr(fallback);
  });
  registerAction('ledger-view', (el) => update({ ledgerView: el.dataset.view, ledgerHistoryLimit: 30 }));
  registerAction('ledger-load-more', () => update({ ledgerHistoryLimit: ui.ledgerHistoryLimit + 30 }));
  registerAction('ledger-participants', participantSheet);
  registerAction('ledger-participant-detail', (el) => participantDetailSheet(el.dataset.participant));
  registerAction('ledger-open-personal', (el) => { closeSheet(); pushRoute({ tab: 'ledger', ledgerId: el.dataset.ledger, ledgerSegment: 'personal', ledgerHistoryLimit: 30 }, { direction: 'forward' }); });
  registerAction('ledger-create-personal', (el) => {
    const participant = data.getParticipant(el.dataset.participant);
    if (!participant || participant.participantId === ME) return;
    if (!window.confirm(`建立与 ${participant.displayName} 的个人账本？`)) return;
    const ledger = data.createRelationshipLedger({ title: participant.displayName, participantIds: [ME, participant.participantId], ownerUserId: 'user-winner' });
    closeSheet();
    pushRoute({ tab: 'ledger', ledgerId: ledger.ledgerId, ledgerSegment: 'personal', ledgerHistoryLimit: 30 }, { direction: 'forward' });
  });
  registerAction('ledger-entry-actions', ledgerEntryActionsSheet);
  registerAction('ledger-new-entry', (el) => entrySheet(el.dataset.type));
  registerAction('ledger-return', (el) => {
    const returningFromPlan = Boolean(el.closest('.plan-detail-sheet') && ui.planDetailId);
    closeSheet();
    if (returningFromPlan) backOr({ tab: 'ledger', planDetailId: null });
    else update({});
  });
  registerAction('ledger-split-member', (el) => {
    const form = document.querySelector('[data-ledger-entry-form]');
    syncEntryDraft(form);
    const id = el.dataset.participant;
    const set = new Set(entryDraft.splitParticipantIds);
    if (set.has(id)) { if (set.size <= 1) return toast('至少保留一位分摊参与者'); set.delete(id); } else set.add(id);
    entryDraft.splitParticipantIds = data.getRelationshipLedger(ui.ledgerId).participantIds.filter((memberId) => set.has(memberId));
    entryDraft.customShares = rebuildSplitShares({ totalMinor: moneyStringToMinor(entryDraft.amount || '0'), participantIds: entryDraft.splitParticipantIds, previous: entryDraft.customShares });
    openEntrySheet();
  });
  registerAction('ledger-split-mode', (el) => {
    syncEntryDraft(document.querySelector('[data-ledger-entry-form]'));
    entryDraft.splitMode = el.dataset.mode;
    if (entryDraft.splitMode === 'custom' && !Object.keys(entryDraft.customShares || {}).length) entryDraft.customShares = equalSplitMinor(moneyStringToMinor(entryDraft.amount || '0'), entryDraft.splitParticipantIds);
    openEntrySheet();
  });
  registerAction('ledger-split-even', () => { entryDraft.customShares = equalSplitMinor(moneyStringToMinor(entryDraft.amount || '0'), entryDraft.splitParticipantIds); openEntrySheet(); });
  registerAction('ledger-split-remainder', () => { try { entryDraft.customShares = applyRemainderToLast(moneyStringToMinor(entryDraft.amount || '0'), entryDraft.splitParticipantIds, entryDraft.customShares); openEntrySheet(); } catch (error) { toast(error.message); } });
  registerAction('ledger-split-clear', () => { entryDraft.customShares = Object.fromEntries(entryDraft.splitParticipantIds.map((id) => [id, 0])); openEntrySheet(); });
  registerAction('ledger-entry-confirm', () => {
    const form = document.querySelector('[data-ledger-entry-form]');
    syncEntryDraft(form);
    const ledger = data.getRelationshipLedger(ui.ledgerId);
    const type = entryDraft.type;
    let amountMinor;
    try { amountMinor = moneyStringToMinor(entryDraft.amount); } catch (error) { return toast(error.message); }
    const amount = amountMinor / 100;
    const selected = entryDraft.splitParticipantIds;
    const shares = type === 'split_expense'
      ? (entryDraft.splitMode === 'custom'
        ? selected.map((participantId) => ({ participantId, amountMinor: Number(entryDraft.customShares?.[participantId] || 0) }))
        : selected.map((participantId) => ({ participantId, amountMinor: equalSplitMinor(amountMinor, selected)[participantId] })))
      : undefined;
    if (type === 'split_expense' && entryDraft.splitMode === 'custom') {
      const summary = allocationSummary(amountMinor, entryDraft.customShares, selected);
      if (!summary.exact) {
        entryDraft.error = summary.overMinor ? `已超出 ${formatMoneyMinor(summary.overMinor)}` : `还需分配 ${formatMoneyMinor(summary.remainingMinor)}`;
        openEntrySheet();
        requestAnimationFrame(() => document.querySelector('[data-ledger-split-summary]')?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }));
        return;
      }
    }
    const attachmentIds = data.getAttachments('draft', entryDraft.draftKey).map((attachment) => attachment.attachmentId);
    const commit = (capacityAuthorization = null) => { try {
      const result = data.recordRelationshipEntry({
        ledgerId: ledger.ledgerId, entryType: type, participantId: entryDraft.participantId,
        payerParticipantId: type === 'split_expense' ? entryDraft.payerParticipantId : type === 'direct_payable' ? entryDraft.participantId : ME,
        amount, shares, description: entryDraft.desc.trim() || typeLabels(ledger)[type],
        sourceAccountId: entryDraft.accountId, recordOnly: entryDraft.recordOnly,
        attachmentIds, date: entryDraft.date, time: entryDraft.time,
        sourceChannel: 'app', clientEventId: entryDraft.commandKey, capacityAuthorization,
      });
      if (attachmentIds.length && result.transaction) data.assignAttachmentOwner('draft', entryDraft.draftKey, 'transaction', result.transaction.id);
      showTransactionMotion(result.transaction, `${typeLabels(ledger)[type]}已记录`);
    } catch (error) { handleLedgerCapacity(error, { draft: entryDraft, retry: commit, reopen: openEntrySheet }); } };
    commit();
  });
  registerAction('ledger-open-settle', (el) => settlementSheet(el.dataset.direction));
  registerAction('ledger-settle-confirm', () => {
    const form = document.querySelector('[data-settlement-form]');
    const direction = form.dataset.direction;
    const attachmentIds = data.getAttachments('draft', settleDraft.draftKey).map((attachment) => attachment.attachmentId);
    const commit = (capacityAuthorization = null) => { try {
      const result = data.settleRelationship({ ledgerId: ui.ledgerId, direction, amount: moneyStringToMinor(settleDraft.amount) / 100, sourceAccountId: direction === 'paid' ? settleDraft.accountId : null, destinationAccountId: direction === 'received' ? settleDraft.accountId : null, recordOnly: Boolean(form.querySelector('[data-settle-record]').checked), attachmentIds, date: settleDraft.date, time: settleDraft.time, sourceChannel: 'app', clientEventId: settleDraft.commandKey, capacityAuthorization });
      if (attachmentIds.length && result.transaction) data.assignAttachmentOwner('draft', settleDraft.draftKey, 'transaction', result.transaction.id);
      showTransactionMotion(result.transaction, '结算已记录');
    } catch (error) { handleLedgerCapacity(error, { context: 'settlement', draft: settleDraft, retry: commit, reopen: () => openSettlementSheet(direction === 'received' ? data.getRelationshipSummary(ui.ledgerId).receivableMinor : data.getRelationshipSummary(ui.ledgerId).payableMinor) }); } };
    commit();
  });
  registerAction('ledger-settlement-detail', (el) => settlementDetail(el.dataset.settlement));
  registerAction('ledger-item-attachments', (el) => {
    const attachments = data.getAttachmentsByIds((el.dataset.attachmentIds || '').split(',').filter(Boolean));
    if (attachments.length) openAttachmentGallery(attachments, 0);
    else toast('附件不可用');
  });
  registerAction('ledger-settlement-reverse', (el) => { try { data.reverseRelationshipSettlement(el.dataset.settlement, { ledgerId: ui.ledgerId, clientEventId: `settlement-reverse-${el.dataset.settlement}`, sourceChannel: 'app' }); closeSheet(); update({}); toast('结算已撤销'); } catch (error) { toast(error.message); } });
  registerAction('ledger-add-person', addPersonSheet);
  registerAction('ledger-add-person-confirm', () => { try { const person = data.createManualParticipant({ displayName: document.querySelector('[data-new-participant]').value }); data.createRelationshipLedger({ title: person.displayName, participantIds: [ME, person.participantId], ownerUserId: 'user-winner' }); closeSheet(); update({ ledgerSegment: 'personal' }); toast('对象已添加'); } catch (error) { toast(error.message); } });

  // ---- Obligation actions ----------------------------------
  registerAction('obligation-new-actions', newPlanActionsSheet);
  registerAction('obligation-new-monthly', () => newPlanSheet('recurring_monthly'));
  registerAction('obligation-new-installment', () => newPlanSheet('installment'));
  registerAction('obligation-plan-detail', (el) => pushRoute({ tab: 'ledger', planDetailId: el.dataset.plan }, { direction: 'forward' }));
  registerAction('obligation-plan-menu', (el) => planMenuSheet(el.dataset.plan));
  registerAction('plan-direction', (el) => { syncPlanDraft(document.querySelector('[data-plan-form]')); planDraft.direction = el.dataset.direction; openPlanSheet(); });
  registerAction('plan-create-confirm', () => {
    const form = document.querySelector('[data-plan-form]');
    syncPlanDraft(form);
    const monthly = planDraft.planType === 'recurring_monthly';
    const attachmentIds = data.getAttachments('draft', planDraft.draftKey).map((attachment) => attachment.attachmentId);
    const creditor = planDraft.direction === 'payable' ? planDraft.counterpartyId : ME;
    const debtor = planDraft.direction === 'payable' ? ME : planDraft.counterpartyId;
    try {
      const plan = data.createObligationPlan({
        planType: planDraft.planType, ledgerId: ui.ledgerId,
        creditorParticipantId: creditor, debtorParticipantId: debtor,
        title: planDraft.title, dueDay: Number(planDraft.dueDay), startDate: planDraft.startDate,
        endDate: monthly ? planDraft.endDate || null : null,
        defaultAccountId: planDraft.accountId, attachmentIds,
        reminder: monthly && planDraft.reminderEnabled ? { enabled: true, offsetDays: 1, channel: 'local' } : null,
        ...(monthly ? { amount: Number(planDraft.amount) } : {
          merchant: planDraft.merchant.trim() || null,
          principal: Number(planDraft.principal), fee: Number(planDraft.fee),
          totalRepayable: Number(planDraft.principal) + Number(planDraft.fee),
          termCount: Number(planDraft.terms),
        }),
        occurredAt: `${planDraft.startDate}T${planDraft.time}:00+08:00`,
        sourceChannel: 'app', clientEventId: uid('plan-create'),
      });
      if (attachmentIds.length) data.assignAttachmentOwner('draft', planDraft.draftKey, 'plan', plan.planId);
      if (monthly) data.generateObligationInstance(plan.planId, {});
      closeSheet(); update({});
      openMoneyFlowConfirmation({ confirmation: {
        confirmationId: `plan:${plan.planId}`,
        kind: 'plan', accountEffect: 'planned', transactionId: null,
        amountMinor: monthly ? plan.amountMinor : plan.totalRepayableMinor,
        description: plan.title, accountChanges: [], recentRecords: [],
      }, onDone: () => toast(monthly ? '每月账已创建' : '分期已创建') });
    } catch (error) { toast(error.message); }
  });
  registerAction('obligation-generate', (el) => { try { data.generateObligationInstance(el.dataset.plan, {}); update({}); toast('本月账期已生成'); } catch (error) { toast(error.message); } });
  registerAction('obligation-pay', (el) => paymentSheet(el.dataset.plan));
  registerAction('obligation-pay-confirm', (el) => {
    const form = document.querySelector('[data-obligation-pay-form]');
    const attachmentIds = data.getAttachments('draft', payDraft.draftKey).map((attachment) => attachment.attachmentId);
    const plan = data.getObligationPlan(el.dataset.plan);
    const commit = (capacityAuthorization = null) => { try {
      const result = data.recordObligationPayment({
        planId: el.dataset.plan, amount: moneyStringToMinor(payDraft.amount) / 100,
        sourceAccountId: plan.direction === 'payable' ? payDraft.accountId : null,
        destinationAccountId: plan.direction === 'receivable' ? payDraft.accountId : null,
        recordOnly: Boolean(form.querySelector('[data-pay-record]').checked),
        attachmentIds, date: payDraft.date, time: payDraft.time,
        sourceChannel: 'app', clientEventId: payDraft.commandKey, capacityAuthorization,
      });
      if (attachmentIds.length && result.transaction) data.assignAttachmentOwner('draft', payDraft.draftKey, 'transaction', result.transaction.id);
      showTransactionMotion(result.transaction, plan.direction === 'payable' ? '付款已记录' : '收款已记录');
    } catch (error) { handleLedgerCapacity(error, { draft: payDraft, retry: commit, reopen: () => paymentSheet(el.dataset.plan, { preserve: true }) }); } };
    commit();
  });
  registerAction('installment-early', (el) => {
    const plan = data.getObligationPlan(el.dataset.plan);
    earlyDraft = { planId: plan.planId, accountId: plan.defaultAccountId || cashAccounts()[0]?.id, commandKey: uid('early-settle') };
    confirmSheet({ title: '提前结清', note: `将一次付清剩余 ${minorRM(plan.remainingBalanceMinor)}，从默认账户扣款。`, action: 'installment-early-confirm', planId: el.dataset.plan, danger: false });
  });
  registerAction('installment-early-confirm', (el) => {
    const commit = (capacityAuthorization = null) => { try { const result = data.earlySettleInstallment({ planId: el.dataset.plan, sourceAccountId: earlyDraft?.accountId, date: data.today, time: nowTime(), sourceChannel: 'app', clientEventId: earlyDraft?.commandKey || uid('early-settle'), capacityAuthorization }); showTransactionMotion(result.transaction, '已提前结清'); } catch (error) { handleLedgerCapacity(error, { draft: earlyDraft, retry: commit }); } };
    commit();
  });
  registerAction('obligation-pause', (el) => { try { data.pauseObligationPlan(el.dataset.plan, { clientEventId: uid('pause'), sourceChannel: 'app' }); update({}); toast('计划已暂停'); } catch (error) { toast(error.message); } });
  registerAction('obligation-resume', (el) => { try { data.resumeObligationPlan(el.dataset.plan, { clientEventId: uid('resume'), sourceChannel: 'app', date: data.today }); update({}); toast('计划已恢复'); } catch (error) { toast(error.message); } });
  registerAction('obligation-stop', (el) => confirmSheet({ title: '结束计划', note: '结束后不会再生成新账期；历史记录保留。', action: 'obligation-stop-confirm', planId: el.dataset.plan }));
  registerAction('obligation-stop-confirm', (el) => { try { data.stopObligationPlan(el.dataset.plan, { clientEventId: uid('stop'), sourceChannel: 'app' }); closeSheet(); update({}); toast('计划已结束'); } catch (error) { toast(error.message); } });
  registerAction('obligation-history', (el) => historySheet(el.dataset.plan));
  registerAction('obligation-attachments', (el) => {
    const attachments = data.getAttachmentsByIds((el.dataset.attachmentIds || '').split(',').filter(Boolean));
    if (attachments.length) openAttachmentGallery(attachments, 0);
    else toast('附件不可用');
  });
  registerAction('installment-schedule', (el) => scheduleSheet(el.dataset.plan));
  registerAction('obligation-payment-reverse-request', (el) => openSheet({ title: '撤销付款', contentHTML: `<div class="detail-hero"><div class="caption">撤销后会准确恢复账户和计划余额。确定继续？</div></div><button class="sheet-danger" data-action="obligation-payment-reverse" data-plan="${el.dataset.plan}" data-payment="${el.dataset.payment}">确认撤销</button><button class="sheet-secondary" data-action="ledger-return">取消</button>` }));
  registerAction('obligation-payment-reverse', (el) => {
    try { data.reverseObligationPayment(el.dataset.payment, { clientEventId: `oblpay-reverse-${el.dataset.payment}`, sourceChannel: 'app' }); historySheet(el.dataset.plan); update({}); toast('付款已撤销'); } catch (error) { toast(error.message); }
  });
}
