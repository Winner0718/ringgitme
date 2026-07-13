// ============================================================
// Activity page (blueprint §14.7) — date-grouped feed, search,
// filter chips, month selector, detail sheet with edit-history
// visual example.
// ============================================================

import { registerPage } from '../../app/router.js';
import { data, ui, update, registerAction } from '../../app/state.js';
import { fmtRM, fmtDateMY, fmtTimeAMPM, fmtDayHeader, escapeHTML } from '../../app/format.js';
import { renderActivityRow } from '../../components/ActivityRow.js';
import { openSheet, closeSheet, toast } from '../../components/AppSheet.js';
import { icon } from '../../components/Icons.js';
import { nativeDateTimeFieldsHTML, bindNativeDateTimeFields } from '../../components/NativeDateTimeFields.js';

const FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'money', label: '金钱' },
  { id: 'shared', label: '共享' },
  { id: 'receipts', label: '收据' },
  { id: 'photos', label: '照片' },
];
const MODES_FOR_EDIT = [{ id: 'expense', label: '支出' }, { id: 'income', label: '收入' }, { id: 'transfer', label: '转账' }];

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
  const f = ui.activityFilter;
  if (f === 'shared' && !t.shared) return false;
  if (f === 'receipts' && !t.receipt) return false;
  if (f === 'photos' && !t.photo) return false;
  if (f === 'money' && !(t.kind === 'expense' || t.kind === 'income' || t.kind === 'transfer')) return false;
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
  const spend = rows.filter((t) => t.kind === 'expense' && !t.recordOnly).reduce((s, t) => s + t.amount, 0);
  return spend > 0 ? `支出 ${fmtRM(spend, { privacy: ui.privacy })}` : '';
}

function renderActivity(container) {
  const rows = data.getActivities().filter(matches);
  const groups = groupByDay(rows);
  container.innerHTML = `
    <div class="act-tools section">
      <label class="search-field surface">
        ${icon('search', 16)}
        <input type="search" data-activity-search placeholder="搜索描述或类别" value="${escapeHTML(ui.activityQuery)}" aria-label="搜索记录" />
      </label>
      <div class="chip-row">
        ${FILTERS.map((f) => `<button class="chip${ui.activityFilter === f.id ? ' active' : ''}" data-action="act-filter" data-filter="${f.id}">${f.label}</button>`).join('')}
      </div>
      ${monthNavHTML()}
    </div>
    ${groups.length === 0
      ? `<div class="empty surface pad"><div class="caption">没有符合条件的记录。</div></div>`
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
}

function renderListOnly(container) {
  container.querySelectorAll('.act-day, .empty').forEach((n) => n.remove());
  const rows = data.getActivities().filter(matches);
  const groups = groupByDay(rows);
  const html = groups.length === 0
    ? `<div class="empty surface pad"><div class="caption">没有符合条件的记录。</div></div>`
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
      if (fields.includes('desc')) changes.push(`<div class="caption">描述：“${escapeHTML(oldDescription)}” → “${escapeHTML(newDescription)}”</div>`);
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

function detailSheet(t) {
  const source = t.sourceAccountId ? data.getAccount(t.sourceAccountId) : null;
  const destination = t.destinationAccountId ? data.getAccount(t.destinationAccountId) : null;
  const mutation = data.getTransactionMutationPolicy(t);
  const sign = t.kind === 'income' ? '+' : t.kind === 'expense' ? '−' : '';
  openSheet({
    title: '记录详情',
    contentHTML: `
      <div class="detail-hero">
        <div class="num detail-amt ${t.kind === 'income' ? 'amt-pos' : ''}">${sign}${fmtRM(t.amount, { privacy: ui.privacy }).replace('RM ', 'RM ')}</div>
        <div class="row-title">${escapeHTML(t.desc)}</div>
        <div class="caption">${escapeHTML(data.getTransactionCategoryLabel(t))}${t.categoryArchived ? ' · 已隐藏' : ''} · ${escapeHTML(data.getTransactionAccountLabel(t))}</div>
        <div class="caption">${fmtDateMY(t.date)} · ${fmtTimeAMPM(t.time)}</div>
      </div>
      <div class="sheet-group">
        ${detailRow('类型', typeLabel(t.kind))}
        ${detailRow(t.kind === 'transfer' ? '用途' : '类别', `${escapeHTML(data.getTransactionCategoryLabel(t))}${t.categoryArchived ? '（已隐藏）' : ''}`)}
        ${source ? detailRow('来源', escapeHTML(source.name)) : ''}
        ${destination ? detailRow('转入', escapeHTML(destination.name)) : ''}
        ${detailRow('只记录', t.recordOnly ? '是 · 不影响余额' : '否')}
        ${detailRow('AA 分账', t.aa || t.shared ? '是' : '否')}
        ${detailRow('附件', t.attachment || t.receipt || t.photo ? `<button class="attachment-open" data-action="activity-attachment" data-txn="${t.id}">${icon('paperclip', 14)} ${escapeHTML(t.attachment?.name || '查看附件')}</button>` : '无')}
        ${detailRow('创建时间', timestampLabel(t.createdAt))}
        ${detailRow('更新时间', timestampLabel(t.updatedAt))}
      </div>
      ${historyHTML(t)}
      ${mutation.canEdit && mutation.canDelete ? `<div class="sheet-actions">
        <button class="sheet-primary" data-action="activity-edit" data-txn="${t.id}">编辑</button>
        <button class="sheet-danger" data-action="activity-delete" data-txn="${t.id}">删除记录</button>
      </div>` : `<div class="mutation-lock-note caption">${escapeHTML(mutation.reason)}</div>
        <button class="sheet-primary" data-action="sheet-close">完成</button>`}
    `,
  });
}

function accountOptions(selectedId, includeCredit = true) {
  return data.getAccounts()
    .filter((account) => includeCredit || account.type !== 'cc')
    .map((account) => `<option value="${account.id}" ${selectedId === account.id ? 'selected' : ''}>${escapeHTML(account.name)}</option>`)
    .join('');
}

function categoryOptions(type, t) {
  const active = data.getCategories(type);
  const historical = t.kind === type && t.categoryArchived ? data.getCategory(t.catId) : null;
  const items = historical && !active.some((item) => item.id === historical.id) ? [historical, ...active] : active;
  const optional = type === 'transfer' ? `<option value="transfer-fallback" ${t.kind === type && (!t.catId || t.catId === 'transfer-fallback') ? 'selected' : ''}>无用途</option>` : '';
  return optional + items.map((category) => `<option value="${category.id}" ${t.kind === type && category.id === t.catId ? 'selected' : ''}>${escapeHTML(category.name)}${category.isArchived ? '（已隐藏）' : ''}</option>`).join('');
}

function syncEditKind(sheet, kind) {
  sheet.querySelectorAll('[data-edit-category-for]').forEach((node) => { node.hidden = node.dataset.editCategoryFor !== kind; });
  sheet.querySelector('[data-edit-source-wrap]').hidden = kind === 'income';
  sheet.querySelector('[data-edit-destination-wrap]').hidden = kind === 'expense';
  sheet.querySelector('[data-edit-record-wrap]').hidden = false;
}

function editSheet(t) {
  const sheet = openSheet({
    title: '编辑记录',
    contentHTML: `
      <div class="transaction-form" data-edit-form data-txn="${t.id}">
        <label class="cap-field"><span class="caption">类型</span><select data-edit-kind>${MODES_FOR_EDIT.map((item) => `<option value="${item.id}" ${item.id === t.kind ? 'selected' : ''}>${item.label}</option>`).join('')}</select></label>
        <label class="cap-field"><span class="caption">金额</span><input type="number" min="0.01" step="0.01" value="${t.amount.toFixed(2)}" data-edit-amount /></label>
        <label class="cap-field"><span class="caption">描述</span><input type="text" maxlength="40" value="${escapeHTML(t.desc)}" data-edit-desc /></label>
        ${['expense','income','transfer'].map((type) => `<label class="cap-field" data-edit-category-for="${type}"><span class="caption">${type === 'transfer' ? '用途（可选）' : '类别'}</span><select data-edit-category>${categoryOptions(type, t)}</select></label>`).join('')}
        ${nativeDateTimeFieldsHTML({ prefix: 'edit', date: t.date, time: t.time })}
        <label class="cap-field" data-edit-source-wrap><span class="caption">来源账户</span><select data-edit-source>${accountOptions(t.sourceAccountId || t.accountId, true)}</select></label>
        <label class="cap-field" data-edit-destination-wrap><span class="caption">转入账户</span><select data-edit-destination>${accountOptions(t.destinationAccountId || data.getAccounts().find((account) => account.type !== 'cc')?.id, false)}</select></label>
        <label class="transaction-check" data-edit-record-wrap><input type="checkbox" data-edit-record-only ${t.recordOnly ? 'checked' : ''} /><span><strong>只记录</strong><small>只记录，不影响账户余额</small></span></label>
      </div>
      <button class="sheet-primary" data-action="activity-edit-save" data-txn="${t.id}">保存修改</button>
      <button class="sheet-secondary" data-action="open-activity-detail" data-txn="${t.id}">取消</button>
    `,
  });
  const kind = sheet.querySelector('[data-edit-kind]');
  syncEditKind(sheet, t.kind);
  kind.addEventListener('change', () => syncEditKind(sheet, kind.value));
  bindNativeDateTimeFields(sheet);
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
  registerAction('act-filter', (el) => update({ activityFilter: el.dataset.filter }));
  registerAction('act-month', (el) => {
    if (el.dataset.month) update({ activityMonth: el.dataset.month });
  });
  registerAction('open-activity-detail', (el) => {
    const t = data.getActivity(el.dataset.txn);
    if (t) detailSheet(t);
  });
  registerAction('activity-attachment', (el) => {
    const attachment = data.getTransaction(el.dataset.txn)?.attachment;
    if (!attachment) return toast('附件不可用');
    openSheet({ title: '附件', className: 'attachment-preview-sheet', contentHTML: `
      ${attachment.kind === 'photo' && attachment.dataUrl ? `<img class="attachment-preview" src="${escapeHTML(attachment.dataUrl)}" alt="${escapeHTML(attachment.name || '附件预览')}" />` : `<div class="detail-hero">${icon('paperclip', 28)}<div class="row-title">${escapeHTML(attachment.name || '附件')}</div><div class="caption">${escapeHTML(attachment.type || '文件')} · 仅本次使用期间可查看</div></div>`}
      <button class="sheet-primary" data-action="open-activity-detail" data-txn="${el.dataset.txn}">完成</button>` });
  });
  registerAction('activity-edit', (el) => {
    const transaction = data.getTransaction(el.dataset.txn);
    const mutation = data.getTransactionMutationPolicy(transaction);
    if (mutation.canEdit) editSheet(transaction);
    else toast(mutation.reason);
  });
  registerAction('activity-edit-save', (el) => {
    const form = document.querySelector('[data-edit-form]');
    if (!form) return;
    const kind = form.querySelector('[data-edit-kind]').value;
    const selected = form.querySelector(`[data-edit-category-for="${kind}"] [data-edit-category]`).value;
    const category = data.getCategory(selected);
    try {
      const transaction = data.editTransaction(el.dataset.txn, {
        kind,
        amount: form.querySelector('[data-edit-amount]').value,
        desc: form.querySelector('[data-edit-desc]').value.trim(),
        catId: category?.id || 'transfer-fallback',
        catLabel: kind === 'transfer' && (!category || category.isSystemFallback) ? '转账' : category?.name,
        category: kind === 'transfer' && (!category || category.isSystemFallback) ? '转账' : category?.name,
        date: form.querySelector('[data-native-picker-input="date"]').value,
        time: form.querySelector('[data-ringgit-time-input]').value,
        sourceAccountId: kind === 'income' ? null : form.querySelector('[data-edit-source]').value,
        destinationAccountId: kind === 'expense' ? null : form.querySelector('[data-edit-destination]').value,
        accountId: kind === 'income' ? form.querySelector('[data-edit-destination]').value : form.querySelector('[data-edit-source]').value,
        recordOnly: Boolean(form.querySelector('[data-edit-record-only]').checked),
      });
      update({});
      detailSheet(transaction);
      toast('记录已更新');
    } catch (error) {
      toast(error.message || '无法更新记录');
    }
  });
  registerAction('activity-delete', (el) => {
    const transaction = data.getTransaction(el.dataset.txn);
    const mutation = data.getTransactionMutationPolicy(transaction);
    if (mutation.canDelete) deleteSheet(transaction);
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
}
