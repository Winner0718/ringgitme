// ============================================================
// Activity page (blueprint §14.7) — date-grouped feed, search,
// filter chips, month selector, detail sheet with edit-history
// visual example.
// ============================================================

import { pushRoute, registerPage } from '../../app/router.js';
import { data, ui, update, registerAction } from '../../app/state.js';
import { fmtRM, fmtDateMY, fmtTimeAMPM, fmtDayHeader, escapeHTML } from '../../app/format.js';
import { renderActivityRow } from '../../components/ActivityRow.js';
import { openSheet, closeSheet, toast } from '../../components/AppSheet.js';
import { icon } from '../../components/Icons.js';
import { nativeDateTimeFieldsHTML, bindNativeDateTimeFields } from '../../components/NativeDateTimeFields.js';
import { attachmentSummaryHTML, bindAttachmentField, openAttachmentGallery } from '../../components/AttachmentField.js';
import { openPickerSheet, pickerFieldHTML } from '../../components/PickerSheet.js';
import { moneyFieldHTML, bindMoneyField, moneyStringToMinor } from '../../components/MoneyCalculatorSheet.js';
import { openMoneyFlowConfirmation } from '../../components/MoneyFlowConfirmation.js';
import { openRecordDetailOverlay, registerRecordDetailPresenter, transitionRecordDetailSheet } from '../../components/RecordDetailOverlay.js';
import { ACTIVITY_COPY } from '../../app/copy.js';
import { openCapacityAlert } from '../../components/CapacityAlertSheet.js';
import { isAccountCapacityError } from '../../domain/accountCapacity.js';

const FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'money', label: '金钱' },
  { id: 'record_only', label: '只记录' },
  { id: 'shared', label: '共享' },
  { id: 'receipts', label: '收据' },
  { id: 'photos', label: '照片' },
];
const MODES_FOR_EDIT = [{ id: 'expense', label: '支出' }, { id: 'income', label: '收入' }, { id: 'transfer', label: '转账' }];

export function transactionMatchesActivityAccount(transaction, accountId) {
  return !accountId || [transaction.accountId, transaction.sourceAccountId, transaction.destinationAccountId].includes(accountId);
}

// Months are derived from the data — the selector scales to any range
function availableMonths() {
  const set = new Set(data.getActivities().map((t) => t.date.slice(0, 7)));
  return [...set].sort(); // ascending
}

function monthLabel(id) {
  const [y, m] = id.split('-');
  return `${y} 年 ${Number(m)} 月`;
}

function monthNavHTML() {
  const months = availableMonths();
  const i = months.indexOf(ui.activityMonth);
  const prev = i > 0 ? months[i - 1] : null;
  const next = i >= 0 && i < months.length - 1 ? months[i + 1] : null;
  return `
    <div class="month-nav">
      <button class="topbar-btn" data-action="act-month" data-month="${prev || ''}" ${prev ? '' : 'disabled'} aria-label="上个月">${icon('chevronLeft', 18)}</button>
      <span class="month-nav-label">${monthLabel(ui.activityMonth)}</span>
      <button class="topbar-btn" data-action="act-month" data-month="${next || ''}" ${next ? '' : 'disabled'} aria-label="下个月">${icon('chevronRight', 18)}</button>
    </div>
  `;
}

function matches(t) {
  if (!t.date.startsWith(ui.activityMonth)) return false;
  if (!transactionMatchesActivityAccount(t, ui.activityAccountId)) return false;
  const f = ui.activityFilter;
  if (f === 'shared' && !t.shared) return false;
  if (f === 'receipts' && !t.receipt) return false;
  if (f === 'photos' && !t.photo) return false;
  if (f === 'money' && !(t.kind === 'expense' || t.kind === 'income' || t.kind === 'transfer')) return false;
  if (f === 'record_only' && t.accountEffect !== 'record_only') return false;
  const q = ui.activityQuery.trim().toLowerCase();
  if (q && !`${t.desc} ${data.getTransactionCategoryLabel(t)} ${data.getTransactionAccountLabel(t)}`.toLowerCase().includes(q)) return false;
  return true;
}

function groupByDay(rows) {
  const groups = new Map();
  rows.forEach((t) => {
    if (!groups.has(t.date)) groups.set(t.date, []);
    groups.get(t.date).push(t);
  });
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function dayTotal(rows) {
  const spend = rows.filter((t) => t.kind === 'expense' && t.accountEffect === 'posted' && t.status !== 'reversed').reduce((s, t) => s + t.amount, 0);
  return spend > 0 ? `支出 ${fmtRM(spend, { privacy: ui.privacy })}` : '';
}

function renderActivity(container) {
  const rows = data.getActivities().filter(matches);
  const groups = groupByDay(rows);
  const accountFilter = ui.activityAccountId ? data.getAccount(ui.activityAccountId) : null;
  container.innerHTML = `
    <div class="act-tools section">
      <label class="search-field surface">
        ${icon('search', 16)}
        <input type="search" data-activity-search placeholder="搜索备注、类别或账户" value="${escapeHTML(ui.activityQuery)}" aria-label="搜索记录" />
      </label>
      ${accountFilter ? `<div class="activity-account-filter"><span>${ACTIVITY_COPY.currentAccount}：${escapeHTML(accountFilter.name)}</span><button type="button" data-action="activity-clear-account-filter">${ACTIVITY_COPY.clearFilter}</button></div>` : ''}
      <div class="chip-row">
        ${FILTERS.map((f) => `<button class="chip${ui.activityFilter === f.id ? ' active' : ''}" data-action="act-filter" data-filter="${f.id}">${f.label}</button>`).join('')}
      </div>
      ${monthNavHTML()}
    </div>
    ${groups.length === 0
      ? accountFilter
        ? `<div class="empty surface pad activity-filter-empty"><div class="row-title">${ACTIVITY_COPY.emptyAccount}</div><button type="button" class="link-btn" data-action="activity-view-all">${ACTIVITY_COPY.viewAll}</button></div>`
        : `<div class="empty surface pad"><div class="caption">没有符合条件的记录。</div></div>`
      : groups.map(([date, dayRows]) => `
        <section class="act-day">
          <div class="row-between act-day-head">
            <span class="caption">${fmtDayHeader(date, data.today)}</span>
            <span class="caption num">${dayTotal(dayRows)}</span>
          </div>
          <div class="surface"><ul>${dayRows.map(renderActivityRow).join('')}</ul></div>
        </section>`).join('')}
  `;

  const search = container.querySelector('[data-activity-search]');
  search.addEventListener('input', () => {
    ui.activityQuery = search.value;
    renderListOnly(container); // list only, so the input keeps focus
  });

  if (ui.highlightActivityId) {
    const el = container.querySelector(`#act-${ui.highlightActivityId}`);
    if (el) el.scrollIntoView({ block: 'center' });
    ui.highlightActivityId = null;
  }
  if (ui.pendingActivityDetailId) {
    const transactionId = ui.pendingActivityDetailId;
    ui.pendingActivityDetailId = null;
    queueMicrotask(() => {
      const transaction = data.getActivity(transactionId);
      if (transaction) detailSheet(transaction);
    });
  }
  if (ui.activityDetailId && !document.querySelector('.activity-detail-sheet')) {
    const transaction = data.getActivity(ui.activityDetailId);
    if (transaction) queueMicrotask(() => detailSheet(transaction));
  }
}

function renderListOnly(container) {
  container.querySelectorAll('.act-day, .empty').forEach((n) => n.remove());
  const rows = data.getActivities().filter(matches);
  const groups = groupByDay(rows);
  const html = groups.length === 0
    ? ui.activityAccountId
      ? `<div class="empty surface pad activity-filter-empty"><div class="row-title">${ACTIVITY_COPY.emptyAccount}</div><button type="button" class="link-btn" data-action="activity-view-all">${ACTIVITY_COPY.viewAll}</button></div>`
      : `<div class="empty surface pad"><div class="caption">没有符合条件的记录。</div></div>`
    : groups.map(([date, dayRows]) => `
      <section class="act-day">
        <div class="row-between act-day-head">
          <span class="caption">${fmtDayHeader(date, data.today)}</span>
          <span class="caption num">${dayTotal(dayRows)}</span>
        </div>
        <div class="surface"><ul>${dayRows.map(renderActivityRow).join('')}</ul></div>
    </section>`).join('');
  container.insertAdjacentHTML('beforeend', html);
}

function timestampLabel(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return `${value('day')}/${value('month')}/${value('year')} · ${value('hour')}:${value('minute')} ${value('dayPeriod')?.toUpperCase()}`;
}

function typeLabel(kind) {
  return { expense: '支出', income: '收入', transfer: '转账' }[kind] || kind;
}

function historyHTML(t) {
  if (!t.editHistory?.length) return '';
  return `<div class="sheet-group">
    <div class="caption sheet-group-label">编辑历史</div>
    ${t.editHistory.map((history) => {
      const at = history.editedAt || history.at;
      const oldAmount = history.oldAmount ?? history.from?.amount;
      const newAmount = history.newAmount ?? history.to?.amount;
      const oldDescription = history.oldDescription ?? history.from?.desc;
      const newDescription = history.newDescription ?? history.to?.desc;
      const fields = history.changedFields || [];
      const changes = [];
      if (fields.includes('amountMinor')) changes.push(`<div class="num">${fmtRM(oldAmount)} → ${fmtRM(newAmount)}</div>`);
      if (fields.includes('desc')) changes.push(`<div class="caption">备注：“${escapeHTML(oldDescription)}” → “${escapeHTML(newDescription)}”</div>`);
      if (fields.includes('catId') || fields.includes('catLabel')) changes.push(`<div class="caption">类别：${escapeHTML(history.oldCategory || history.from?.category || '—')} → ${escapeHTML(history.newCategory || history.to?.category || '—')}</div>`);
      if (fields.includes('kind')) changes.push(`<div class="caption">类型：${typeLabel(history.oldType)} → ${typeLabel(history.newType)}</div>`);
      if (fields.includes('sourceAccountId')) changes.push(`<div class="caption">来源账户已更改</div>`);
      if (fields.includes('destinationAccountId')) changes.push(`<div class="caption">转入账户已更改</div>`);
      if (fields.includes('date')) changes.push(`<div class="caption">日期：${fmtDateMY(history.oldDate)} → ${fmtDateMY(history.newDate)}</div>`);
      if (fields.includes('time')) changes.push(`<div class="caption">时间：${fmtTimeAMPM(history.oldTime)} → ${fmtTimeAMPM(history.newTime)}</div>`);
      return `<div class="edit-entry">
        <div class="caption">${timestampLabel(at)} · 第 ${history.revision || ''} 版</div>
        ${changes.join('')}
      </div>`;
    }).join('')}
  </div>`;
}

function detailRow(label, value) {
  return `<div class="transaction-field"><span class="caption">${label}</span><span>${value}</span></div>`;
}

const ME = 'participant-me';

function participantName(id) {
  return id === ME ? '我' : data.getParticipant(id)?.displayName || '参与者';
}

function minorRM(value) {
  return fmtRM(Number(value || 0) / 100, { privacy: ui.privacy });
}

// Distribute an entry's remaining amount over its member breakdown the same
// way the ledger selectors do — floor each share, last member absorbs.
function breakdownRemaining(entry) {
  const breakdown = entry.memberBreakdown?.length ? entry.memberBreakdown : [];
  const total = breakdown.reduce((sum, item) => sum + Number(item.amountMinor), 0) || 1;
  let allocated = 0;
  return breakdown.map((item, index) => {
    const share = index === breakdown.length - 1 ? entry.remainingMinor - allocated : Math.floor((entry.remainingMinor * Number(item.amountMinor)) / total);
    allocated += share;
    return { ...item, remainingMinor: share };
  });
}

// Unified relationship summary — the linked entry is the source of truth;
// no legacy AA boolean is rendered alongside it.
function relationshipSummaryHTML(entry, transactionAttachmentIds = [], transactionId = '') {
  const ledger = data.getRelationshipLedger(entry.ledgerId);
  const group = ledger?.derivedType === 'group';
  const typeText = { split_expense: 'AA 分账', direct_receivable: group ? '成员欠我' : '他欠我', direct_payable: group ? '我欠成员' : '我欠他' }[entry.entryType] || '关系账';
  const receivable = entry.creditorParticipantId === ME;
  const transactionAttachmentSet = new Set(transactionAttachmentIds);
  const distinctRelationshipAttachmentIds = (entry.attachmentIds || []).filter((id) => !transactionAttachmentSet.has(id));
  const attachmentCount = distinctRelationshipAttachmentIds.length || (entry.attachment && !transactionAttachmentIds.length ? 1 : 0);
  const detailRows = [detailRow('类型', typeText)];
  const compactRows = [];
  if (entry.entryType === 'split_expense') {
    const myShare = entry.shares.find((share) => share.participantId === ME)?.amountMinor ?? 0;
    const members = entry.splitParticipantIds?.length ? entry.splitParticipantIds : entry.participants;
    compactRows.push(detailRow('付款人', escapeHTML(participantName(entry.payerParticipantId))));
    compactRows.push(detailRow(group ? '成员' : '我的份额', group ? `${members.length} 人 · 我 ${minorRM(myShare)}` : `<span class="num">${minorRM(myShare)}</span>`));
    detailRows.push(detailRow('参与者', escapeHTML(members.map(participantName).join('、'))));
    if (entry.shares?.length) detailRows.push(detailRow('分摊', entry.shares.map((share) => `<div class="num rel-share-line">${escapeHTML(participantName(share.participantId))} ${minorRM(share.amountMinor)}</div>`).join('')));
    if (receivable) {
      const pending = breakdownRemaining(entry).filter((item) => item.remainingMinor > 0);
      compactRows.push(detailRow('已收', `<span class="num">${minorRM(entry.amountMinor - entry.remainingMinor)}</span>`));
      compactRows.push(detailRow('剩余待收', `<span class="num">${minorRM(entry.remainingMinor)}</span>`));
      if (pending.length) detailRows.push(detailRow('待收成员', pending.map((item) => `<div class="num rel-share-line">${escapeHTML(participantName(item.participantId))} ${minorRM(item.remainingMinor)}</div>`).join('')));
    } else {
      compactRows.push(detailRow('已还', `<span class="num">${minorRM(entry.amountMinor - entry.remainingMinor)}</span>`));
      compactRows.push(detailRow('剩余待付', `<span class="num">${minorRM(entry.remainingMinor)}</span>`));
    }
  } else {
    const other = receivable ? entry.debtorParticipantId : entry.creditorParticipantId;
    compactRows.push(detailRow('对象', escapeHTML(participantName(other))));
    compactRows.push(detailRow('原金额', `<span class="num">${minorRM(entry.amountMinor)}</span>`));
    compactRows.push(detailRow(receivable ? '已收' : '已还', `<span class="num">${minorRM(entry.amountMinor - entry.remainingMinor)}</span>`));
    compactRows.push(detailRow('剩余', `<span class="num">${minorRM(entry.remainingMinor)}</span>`));
  }
  detailRows.push(detailRow('结算状态', entry.status === 'reversed' ? '已撤销' : entry.remainingMinor === 0 ? '已结清' : entry.remainingMinor < entry.amountMinor ? '部分结清' : '未结清'));
  if (attachmentCount) detailRows.push(detailRow('关系账附件', `${icon('paperclip', 13)} ${attachmentCount} 个`));
  const destination = group ? `前往${ledger?.title || '群组'}` : `前往${ledger?.title || '个人'}账本`;
  return `<div class="sheet-group relationship-summary">
    <div class="relationship-summary-heading"><span class="caption">关系账</span><strong>${escapeHTML(ledger?.title || '—')}</strong></div>
    ${compactRows.join('')}
    <details class="relationship-breakdown"><summary>查看分摊明细</summary>${detailRows.join('')}</details>
    <button type="button" class="rel-open-ledger" data-action="activity-open-ledger" data-ledger="${escapeHTML(entry.ledgerId)}" data-entry="${escapeHTML(entry.entryId)}" data-return-txn="${escapeHTML(transactionId)}">${escapeHTML(destination)} ${icon('chevronRight', 14)}</button>
  </div>`;
}

function obligationSummaryHTML(paymentId) {
  const plans = data.getObligationPlans();
  const plan = plans.find((candidate) => data.getObligationPayments(candidate.planId).some((payment) => payment.paymentId === paymentId));
  if (!plan) return '';
  const payment = data.getObligationPayments(plan.planId).find((item) => item.paymentId === paymentId);
  return `<div class="sheet-group relationship-summary">
    <div class="caption sheet-group-label">${plan.planType === 'installment' ? '分期计划' : '每月账'}</div>
    ${detailRow('计划', escapeHTML(plan.title))}
    ${detailRow('本次款项', `<span class="num">${minorRM(payment?.amountMinor || 0)}</span>`)}
    ${detailRow('账期', escapeHTML((payment?.allocations || []).map((allocation) => allocation.periodKey).join('、') || '—'))}
    <button class="attachment-open rel-open-ledger" data-action="activity-open-ledger" data-ledger="${plan.ledgerId}">查看关系账 ${icon('chevronRight', 14)}</button>
  </div>`;
}

function attachmentRowHTML(t) {
  const count = t.attachmentCount || 0;
  if (!count) return detailRow('附件', '无');
  return detailRow('附件', `<button class="attachment-open" data-action="activity-attachment" data-txn="${t.id}">${icon('paperclip', 14)} ${count} 个附件</button>`);
}

export function detailSheet(t, { stacked = false, onClose = null } = {}) {
  const source = t.sourceAccountId ? data.getAccount(t.sourceAccountId) : null;
  const destination = t.destinationAccountId ? data.getAccount(t.destinationAccountId) : null;
  const mutation = data.getTransactionMutationPolicy(t);
  const sign = t.kind === 'income' ? '+' : t.kind === 'expense' ? '−' : '';
  const linkedEntity = data.getRelationshipEntityForTransaction(t.id);
  const linkedEntry = linkedEntity?.startsWith('rel-entry-') ? data.getRelationshipEntry(linkedEntity) : null;
  const linkedSettlement = linkedEntity?.startsWith('settlement-') ? linkedEntity : null;
  const linkedPayment = data.getObligationEntityForTransaction(t.id);
  const recurringPosting = data.getRecurringPostingForTransaction(t.id);
  const sheet = openSheet({
    title: '记录详情',
    className: 'activity-detail-sheet',
    stacked,
    onClose,
    contentHTML: `
      <div class="detail-hero">
        <div class="num detail-amt ${t.kind === 'income' ? 'amt-pos' : ''}">${sign}${fmtRM(t.amount, { privacy: ui.privacy }).replace('RM ', 'RM ')}</div>
        <div class="row-title">${escapeHTML(t.desc)}</div>
        <div class="caption">${escapeHTML(data.getTransactionCategoryLabel(t))}${t.categoryArchived ? ' · 已隐藏' : ''} · ${escapeHTML(data.getTransactionAccountLabel(t))}</div>
        <div class="caption">${fmtDateMY(t.date)} · ${fmtTimeAMPM(t.time)}</div>
        ${recurringPosting ? `<div class="posting-reversal-badge">${recurringPosting.status === 'reversed' ? '已撤销 · 原记录保留' : '固定计划本期记账'}</div>` : ''}
      </div>
      <div class="sheet-group">
        ${detailRow('类型', typeLabel(t.kind))}
        ${detailRow(t.kind === 'transfer' ? '用途' : '类别', `${escapeHTML(data.getTransactionCategoryLabel(t))}${t.categoryArchived ? '（已隐藏）' : ''}`)}
        ${source ? detailRow('来源', escapeHTML(source.name)) : ''}
        ${destination ? detailRow('转入', escapeHTML(destination.name)) : ''}
        ${detailRow('账户影响', t.accountEffect === 'record_only' ? '<span class="record-only-badge">只记录</span> 不影响余额' : t.accountEffect === 'relationship_only' ? '<span class="relationship-only-badge">关系账动作</span> 账户余额不变' : '已计入账户')}
        ${!linkedEntry && !linkedSettlement && !linkedPayment && (t.aa || t.shared) ? detailRow('共享', '是（旧记录）') : ''}
        ${attachmentRowHTML(t)}
        ${detailRow('创建时间', timestampLabel(t.createdAt))}
        ${detailRow('更新时间', timestampLabel(t.updatedAt))}
      </div>
      ${linkedEntry ? relationshipSummaryHTML(linkedEntry, t.attachmentIds || [], t.id) : ''}
      ${linkedPayment ? obligationSummaryHTML(linkedPayment) : ''}
      ${recurringPosting ? `<section class="sheet-group attachment-section posting-evidence-detail"><div class="caption sheet-group-label">附件 / 凭证</div>${attachmentSummaryHTML('transaction', t.id, { label: '付款凭证', evidenceOnly: true })}<small class="caption">可补充付款凭证；不会修改金额、余额或关系账。</small></section>` : ''}
      ${historyHTML(t)}
      ${recurringPosting ? `<div class="sheet-actions recurring-posting-detail-actions">
        ${recurringPosting.status === 'posted' ? `<button class="sheet-danger" data-action="activity-recurring-reverse-request" data-posting-id="${escapeHTML(recurringPosting.postingId)}">撤销这次记账</button>` : ''}
        <button class="sheet-primary" data-action="sheet-close">完成</button>
      </div>` : mutation.canEdit && mutation.canDelete ? `<div class="sheet-actions">
        <button class="sheet-primary" data-action="activity-edit" data-txn="${t.id}">编辑</button>
        <button class="sheet-danger" data-action="activity-delete" data-txn="${t.id}">删除记录</button>
      </div>` : `<div class="mutation-lock-note caption">${escapeHTML(mutation.reason)}</div>
        <button class="sheet-primary" data-action="sheet-close">完成</button>`}
    `,
  });
  if (recurringPosting) bindAttachmentField(sheet, { onChange: () => data.setTransactionAttachments(t.id, data.getAttachments('transaction', t.id).map((attachment) => attachment.attachmentId)) });
}

function accountPickerOptions(includeCredit = true) {
  return data.getAccounts()
    .filter((account) => includeCredit || account.type !== 'cc')
    .map((account) => ({ value: account.id, label: account.name, caption: account.type === 'cc' ? `欠款 ${fmtRM(account.outstanding)}` : `余额 ${fmtRM(account.balance)}` }));
}

function categoryPickerOptions(type, t) {
  const active = data.getCategories(type);
  const historical = t.kind === type && t.categoryArchived ? data.getCategory(t.catId) : null;
  const items = historical && !active.some((item) => item.id === historical.id) ? [historical, ...active] : active;
  const options = items.map((category) => ({ value: category.id, label: category.name, caption: category.isArchived ? '已隐藏 · 可保留历史选择' : '' }));
  return type === 'transfer' ? [{ value: 'transfer-fallback', label: '无用途' }, ...options.filter((option) => option.value !== 'transfer-fallback')] : options;
}

function editCategoryLabel(t) {
  if (editDraft.kind === 'transfer' && editDraft.catId === 'transfer-fallback') return '无用途';
  const category = data.getCategory(editDraft.catId);
  return `${category?.name || data.getDefaultCategory(editDraft.kind)?.name || '选择类别'}${category?.isArchived ? '（已隐藏）' : ''}`;
}

function editAccountLabel(id) {
  return data.getAccount(id)?.name || '选择账户';
}

let editDraft = null;

function syncEditDraft(form) {
  if (!form || !editDraft) return;
  editDraft.desc = form.querySelector('[data-edit-desc]')?.value ?? editDraft.desc;
  editDraft.recordOnly = Boolean(form.querySelector('[data-edit-record-only]')?.checked);
  editDraft.time = form.querySelector('[data-ringgit-time-input]')?.value || editDraft.time;
}

function initializeEditDraft(t) {
  editDraft = {
    transactionId: t.id,
    kind: t.kind,
    amount: t.amount.toFixed(2),
    desc: t.desc,
    catId: t.catId || (t.kind === 'transfer' ? 'transfer-fallback' : data.getDefaultCategoryId(t.kind)),
    sourceAccountId: t.sourceAccountId || t.accountId || data.getAccounts()[0]?.id,
    destinationAccountId: t.destinationAccountId || data.getAccounts().find((account) => account.type !== 'cc' && account.id !== t.sourceAccountId)?.id,
    recordOnly: Boolean(t.recordOnly),
    accountEffect: t.accountEffect || (t.recordOnly ? 'record_only' : 'posted'),
    date: t.date,
    time: t.time,
  };
}

function editSheet(t, { initialize = true } = {}) {
  if (initialize || editDraft?.transactionId !== t.id) initializeEditDraft(t);
  const categoryLabel = editCategoryLabel(t);
  const sourceOptions = accountPickerOptions(true);
  const destinationOptions = accountPickerOptions(false);
  const sheet = openSheet({
    title: '编辑记录',
    contentHTML: `
      <div class="transaction-form" data-edit-form data-txn="${t.id}">
        ${pickerFieldHTML({ label: '类型', key: 'edit-kind', valueLabel: MODES_FOR_EDIT.find((item) => item.id === editDraft.kind)?.label || '支出' })}
        ${moneyFieldHTML({ label: '金额', key: 'edit-amount', value: editDraft.amount })}
        <label class="cap-field"><span class="caption">备注</span><input type="text" maxlength="40" value="${escapeHTML(editDraft.desc)}" placeholder="点击输入备注" data-edit-desc /></label>
        ${pickerFieldHTML({ label: editDraft.kind === 'transfer' ? '用途（可选）' : '类别', key: 'edit-category', valueLabel: categoryLabel })}
        ${nativeDateTimeFieldsHTML({ prefix: 'edit', date: editDraft.date, time: editDraft.time })}
        ${editDraft.kind !== 'income' ? pickerFieldHTML({ label: editDraft.kind === 'transfer' ? '转出账户' : '支出账户', key: 'edit-source', valueLabel: editAccountLabel(editDraft.sourceAccountId) }) : ''}
        ${editDraft.kind !== 'expense' ? pickerFieldHTML({ label: editDraft.kind === 'transfer' ? '转入账户' : '入账账户', key: 'edit-destination', valueLabel: editAccountLabel(editDraft.destinationAccountId) }) : ''}
        <div class="sheet-group attachment-section">${attachmentSummaryHTML('transaction', t.id)}</div>
        ${editDraft.accountEffect === 'relationship_only' ? '<div class="relationship-effect-note">关系账动作 · 你的账户余额不变</div>' : `<label class="transaction-check" data-edit-record-wrap><input type="checkbox" data-edit-record-only ${editDraft.recordOnly ? 'checked' : ''} /><span><strong>只记录</strong><small>只记录，不影响账户余额</small></span></label>`}
      </div>
      <button class="sheet-primary" data-action="activity-edit-save" data-txn="${t.id}">保存修改</button>
      <button class="sheet-secondary" data-action="open-activity-detail" data-txn="${t.id}">取消</button>
    `,
  });
  const form = sheet.querySelector('[data-edit-form]');
  const reopen = () => editSheet(t, { initialize: false });
  bindMoneyField(sheet, 'edit-amount', { getValue: () => editDraft.amount, setValue: (value) => { editDraft.amount = value; } });
  sheet.querySelector('[data-picker-field="edit-kind"]')?.addEventListener('click', () => {
    syncEditDraft(form);
    openPickerSheet({ title: '选择类型', selectedValue: editDraft.kind, options: MODES_FOR_EDIT.map((item) => ({ value: item.id, label: item.label })), onSelect: (kind) => {
      editDraft.kind = kind;
      editDraft.catId = kind === 'transfer' ? 'transfer-fallback' : data.getDefaultCategoryId(kind);
      if (kind === 'income' && data.getAccount(editDraft.destinationAccountId)?.type === 'cc') editDraft.destinationAccountId = destinationOptions[0]?.value;
      if (kind === 'transfer' && editDraft.destinationAccountId === editDraft.sourceAccountId) editDraft.destinationAccountId = destinationOptions.find((option) => option.value !== editDraft.sourceAccountId)?.value;
      reopen();
    } });
  });
  sheet.querySelector('[data-picker-field="edit-category"]')?.addEventListener('click', () => {
    syncEditDraft(form);
    openPickerSheet({ title: editDraft.kind === 'transfer' ? '选择转账用途' : `选择${editDraft.kind === 'income' ? '收入' : '支出'}类别`, selectedValue: editDraft.catId, options: categoryPickerOptions(editDraft.kind, t), onSelect: (catId) => { editDraft.catId = catId; reopen(); } });
  });
  sheet.querySelector('[data-picker-field="edit-source"]')?.addEventListener('click', () => {
    syncEditDraft(form);
    openPickerSheet({ title: editDraft.kind === 'transfer' ? '选择转出账户' : '选择支出账户', selectedValue: editDraft.sourceAccountId, options: sourceOptions, onSelect: (accountId) => {
      editDraft.sourceAccountId = accountId;
      if (editDraft.kind === 'transfer' && editDraft.destinationAccountId === accountId) editDraft.destinationAccountId = destinationOptions.find((option) => option.value !== accountId)?.value;
      reopen();
    } });
  });
  sheet.querySelector('[data-picker-field="edit-destination"]')?.addEventListener('click', () => {
    syncEditDraft(form);
    openPickerSheet({ title: editDraft.kind === 'transfer' ? '选择转入账户' : '选择入账账户', selectedValue: editDraft.destinationAccountId, options: destinationOptions.filter((option) => editDraft.kind !== 'transfer' || option.value !== editDraft.sourceAccountId), onSelect: (accountId) => { editDraft.destinationAccountId = accountId; reopen(); } });
  });
  bindNativeDateTimeFields(sheet, { onDateChange: (value) => { editDraft.date = value; }, onTimeChange: (value) => { editDraft.time = value; } });
  bindAttachmentField(sheet, { onChange: () => data.setTransactionAttachments(t.id, data.getAttachments('transaction', t.id).map((attachment) => attachment.attachmentId)) });
}

function deleteSheet(t) {
  openSheet({
    title: '删除记录',
    contentHTML: `
      <div class="detail-hero">
        <div class="num detail-amt">${fmtRM(t.amount)}</div>
        <div class="row-title">${escapeHTML(t.desc)}</div>
        <div class="caption">删除后会准确还原这笔记录对账户的影响。</div>
      </div>
      <button class="sheet-danger" data-action="activity-delete-confirm" data-txn="${t.id}">确认删除</button>
      <button class="sheet-secondary" data-action="open-activity-detail" data-txn="${t.id}">取消</button>
    `,
  });
}

export function registerActivityFeature() {
  registerPage('activity', renderActivity);
  registerRecordDetailPresenter((transaction, options) => detailSheet(transaction, options));
  registerAction('act-filter', (el) => update({ activityFilter: el.dataset.filter }));
  registerAction('activity-clear-account-filter', () => update({ activityAccountId: null }));
  registerAction('activity-view-all', () => update({ activityAccountId: null, activityFilter: 'all', activityQuery: '' }));
  registerAction('act-month', (el) => {
    if (el.dataset.month) update({ activityMonth: el.dataset.month });
  });
  const openDetail = (el) => {
    const t = data.getActivity(el.dataset.txn);
    if (!t) return;
    openRecordDetailOverlay(t.id);
  };
  registerAction('open-record-detail', openDetail);
  registerAction('open-activity-detail', openDetail);
  registerAction('activity-attachment', (el) => {
    const transaction = data.getTransaction(el.dataset.txn);
    const attachments = data.getTransactionAttachments(el.dataset.txn);
    if (attachments.length) return openAttachmentGallery(attachments, 0);
    // Legacy single-attachment fixtures without a store entry.
    const attachment = transaction?.attachment;
    if (!attachment) return toast('附件不可用');
    openAttachmentGallery([{ attachmentId: 'legacy', name: attachment.name || '附件', mimeType: attachment.type || '文件', sizeBytes: attachment.size || 0, kind: attachment.kind === 'photo' ? 'photo' : 'file', localObjectUrl: attachment.dataUrl || '', thumbnail: { kind: 'tile', label: 'FILE' } }], 0);
  });
  registerAction('activity-open-ledger', (el) => {
    transitionRecordDetailSheet(() => {
      closeSheet();
      pushRoute({ tab: 'ledger', ledgerId: el.dataset.ledger, ledgerFocusEntryId: el.dataset.entry || null, ledgerReturnTransactionId: el.dataset.returnTxn || null, activityDetailId: null, ledgerView: 'current', ledgerHistoryLimit: 30 }, { direction: 'forward' });
    });
  });
  registerAction('activity-edit', (el) => {
    const transaction = data.getTransaction(el.dataset.txn);
    const mutation = data.getTransactionMutationPolicy(transaction);
    if (mutation.canEdit) transitionRecordDetailSheet(() => editSheet(transaction));
    else toast(mutation.reason);
  });
  registerAction('activity-edit-save', (el) => {
    const form = document.querySelector('[data-edit-form]');
    if (!form) return;
    syncEditDraft(form);
    const kind = editDraft.kind;
    const category = data.getCategory(editDraft.catId);
    const commit = (capacityAuthorization = null) => { try {
      const transaction = data.editTransaction(el.dataset.txn, {
        kind,
        amount: moneyStringToMinor(editDraft.amount) / 100,
        desc: editDraft.desc.trim() || (kind === 'transfer' ? '转账' : category?.name),
        catId: category?.id || 'transfer-fallback',
        catLabel: kind === 'transfer' && (!category || category.isSystemFallback) ? '转账' : category?.name,
        category: kind === 'transfer' && (!category || category.isSystemFallback) ? '转账' : category?.name,
        date: editDraft.date,
        time: editDraft.time,
        sourceAccountId: kind === 'income' ? null : editDraft.sourceAccountId,
        destinationAccountId: kind === 'expense' ? null : editDraft.destinationAccountId,
        accountId: kind === 'income' ? editDraft.destinationAccountId : editDraft.sourceAccountId,
        recordOnly: editDraft.recordOnly,
        accountEffect: editDraft.accountEffect === 'relationship_only' ? 'relationship_only' : editDraft.recordOnly ? 'record_only' : 'posted',
        attachmentIds: data.getAttachments('transaction', el.dataset.txn).map((attachment) => attachment.attachmentId),
        capacityAuthorization,
      });
      closeSheet(); update({});
      openMoneyFlowConfirmation({ transaction, onPresented: () => data.recordTransactionConfirmationPresented(transaction), onViewRecord: () => detailSheet(data.getTransaction(transaction.id)), onDone: () => toast('记录已更新') });
    } catch (error) {
      if (isAccountCapacityError(error)) return openCapacityAlert({
        capacity: error.capacity, context: kind === 'transfer' ? 'transfer' : 'expense',
        onApprove: commit,
        onChangeAccount: () => openPickerSheet({ title: kind === 'transfer' ? '更换转出账户' : '更换支出账户', selectedValue: editDraft.sourceAccountId, options: accountPickerOptions(kind === 'expense'), onSelect: (accountId) => { editDraft.sourceAccountId = accountId; if (kind === 'transfer' && editDraft.destinationAccountId === accountId) editDraft.destinationAccountId = accountPickerOptions(false).find((option) => option.value !== accountId)?.value; editSheet(data.getTransaction(el.dataset.txn), { initialize: false }); } }),
      });
      toast(error.message || '无法更新记录');
    } };
    commit();
  });
  registerAction('activity-delete', (el) => {
    const transaction = data.getTransaction(el.dataset.txn);
    const mutation = data.getTransactionMutationPolicy(transaction);
    if (mutation.canDelete) transitionRecordDetailSheet(() => deleteSheet(transaction));
    else toast(mutation.reason);
  });
  registerAction('activity-delete-confirm', (el) => {
    try {
      data.deleteTransaction(el.dataset.txn);
      closeSheet();
      update({});
      toast('记录已删除，账户金额已还原');
    } catch (error) {
      toast(error.message || '无法删除记录');
    }
  });
  registerAction('activity-recurring-reverse-request', (el) => {
    const posting = data.getRecurringOccurrencePosting(el.dataset.postingId);
    if (!posting || posting.status !== 'posted') return;
    openSheet({
      title: '撤销这次记账？', stacked: true, className: 'recurring-posting-reverse-sheet',
      contentHTML: `<div class="recurring-posting-reverse-copy"><p>账户、关系账、分期与本期状态会完整恢复。原记录与附件会保留，并明确标记为已撤销。</p><button class="sheet-danger" data-action="activity-recurring-reverse-confirm" data-posting-id="${escapeHTML(posting.postingId)}">确认撤销</button><button class="sheet-secondary" data-action="sheet-close">取消</button></div>`,
    });
  });
  registerAction('activity-recurring-reverse-confirm', (el) => {
    try {
      data.reverseRecurringOccurrencePosting(el.dataset.postingId, { reason: '用户从记录详情撤销', reversedAt: `${data.today}T09:05:00+08:00` });
      closeSheet(true);
      closeSheet(true);
      update({});
      toast('已安全撤销，原记录与附件继续保留');
    } catch (error) {
      toast(error.message || '当前状态无法安全撤销。');
    }
  });
}
