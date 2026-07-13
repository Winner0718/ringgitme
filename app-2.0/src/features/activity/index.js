// ============================================================
// Activity page (blueprint §14.7) — date-grouped feed, search,
// filter chips, month selector, detail sheet with edit-history
// visual example.
// ============================================================

import { registerPage } from '../../app/router.js';
import { data, ui, update, registerAction } from '../../app/state.js';
import { fmtRM, fmtDateMY, fmtTimeAMPM, fmtDayHeader, escapeHTML } from '../../app/format.js';
import { renderActivityRow } from '../../components/ActivityRow.js';
import { openSheet } from '../../components/AppSheet.js';
import { icon } from '../../components/Icons.js';

const FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'money', label: '金钱' },
  { id: 'shared', label: '共享' },
  { id: 'receipts', label: '收据' },
  { id: 'photos', label: '照片' },
];

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
  if (f === 'money' && !(t.kind === 'expense' || t.kind === 'income')) return false;
  const q = ui.activityQuery.trim().toLowerCase();
  if (q && !`${t.desc} ${t.catLabel}`.toLowerCase().includes(q)) return false;
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
  const spend = rows.filter((t) => t.kind === 'expense').reduce((s, t) => s + t.amount, 0);
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

function detailSheet(t) {
  const acc = data.getAccount(t.accountId);
  const sign = t.kind === 'income' ? '+' : t.kind === 'expense' ? '−' : '';
  openSheet({
    title: '记录详情',
    contentHTML: `
      <div class="detail-hero">
        <div class="num detail-amt ${t.kind === 'income' ? 'amt-pos' : ''}">${sign}${fmtRM(t.amount, { privacy: ui.privacy }).replace('RM ', 'RM ')}</div>
        <div class="row-title">${escapeHTML(t.desc)}</div>
        <div class="caption">${t.catLabel} · ${acc ? escapeHTML(acc.name) : '—'}</div>
        <div class="caption">${fmtDateMY(t.date)} · ${fmtTimeAMPM(t.time)}</div>
      </div>
      <div class="sheet-group">
        ${t.shared ? `<div class="row-static caption">AA 共享 · 已在账本生成应收</div>` : ''}
        ${t.receipt ? `<div class="row-static caption">${icon('paperclip', 14)} 有收据附件</div>` : ''}
      </div>
      ${t.editHistory.length ? `
        <div class="sheet-group">
          <div class="caption sheet-group-label">编辑历史</div>
          ${t.editHistory.map((h) => `
            <div class="edit-entry">
              <div class="caption">编辑于 ${h.at.split(' ')[0].split('-').reverse().join('/')} ${fmtTimeAMPM(h.at.split(' ')[1])}</div>
              <div class="num">${fmtRM(h.from.amount)} → ${fmtRM(h.to.amount)}</div>
              <div class="caption">“${escapeHTML(h.from.desc)}” → “${escapeHTML(h.to.desc)}”</div>
            </div>`).join('')}
        </div>` : ''}
      <button class="sheet-primary" data-action="sheet-close">完成</button>
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
}
