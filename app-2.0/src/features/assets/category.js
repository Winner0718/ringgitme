// ============================================================
// Category pages — 储蓄卡页面 / 信用卡页面 / eWallet 页面.
// Summary header → same-type card carousel → (credit summary
// strip) → 最近记录/最近消费 → 全部账户 rows.
// ============================================================

import { data, ui, update, registerAction, dispatchAction } from '../../app/state.js';
import { fmtRM, fmtDateMY, escapeHTML } from '../../app/format.js';
import { renderCarousel, activateCarousel } from '../../components/CardCarousel.js';
import { renderActivityRow } from '../../components/ActivityRow.js';
import { icon } from '../../components/Icons.js';

const COPY = {
  saving: { totalLabel: '储蓄卡总额', listTitle: '全部账户', recentTitle: '最近记录' },
  cc: { totalLabel: '信用卡总欠款', listTitle: '全部信用卡', recentTitle: '最近消费' },
  ew: { totalLabel: 'eWallet 总余额', listTitle: '全部钱包', recentTitle: '最近记录' },
};

function statsHTML(type, list) {
  if (type === 'cc') {
    const due = list.filter((a) => !a.duePaid).reduce((s, a) => s + a.monthlyDue, 0)
      + list.reduce((s, a) => s + data.getInstalments(a.id).reduce((x, i) => x + i.monthly, 0), 0);
    const avail = list.reduce((s, a) => s + (a.limit - a.outstanding), 0);
    return [
      ['卡片数量', String(list.length), ''],
      ['本月应还', fmtRM(due, { privacy: ui.privacy }), 'amt-neg'],
      ['总可用额度', fmtRM(avail, { privacy: ui.privacy }), ''],
    ];
  }
  const flow = data.getSavingsFlow();
  if (type === 'saving') {
    return [
      ['账户数量', String(list.length), ''],
      ['本月流入', `+${fmtRM(flow.inflow, { privacy: ui.privacy }).replace('RM ', 'RM ')}`, 'amt-pos'],
      ['本月流出', `−${fmtRM(flow.outflow, { privacy: ui.privacy }).replace('RM ', 'RM ')}`, 'amt-neg'],
    ];
  }
  return [['钱包数量', String(list.length), '']];
}

function ccStripHTML(selected) {
  const inst = data.getInstalments(selected.id);
  const due = (selected.duePaid ? 0 : selected.monthlyDue) + inst.reduce((s, i) => s + i.monthly, 0);
  return `
    <section class="section surface cc-strip">
      <div class="cc-strip-cell">
        <span class="caption">本月应还</span>
        <span class="num amt-neg">${fmtRM(due, { privacy: ui.privacy })}</span>
      </div>
      <div class="cc-strip-cell">
        <span class="caption">下个到期日</span>
        <span class="num">${fmtDateMY(selected.dueDate)}</span>
      </div>
      <div class="cc-strip-cell">
        <span class="caption">共享额度池</span>
        <span class="num">${selected.sharedPool ? fmtRM(selected.sharedPoolTotal, { privacy: ui.privacy }) : '—'}</span>
      </div>
    </section>
  `;
}

function recentHTML(type, selected, copy) {
  const ids = new Set(data.getAccountsByType(type).map((a) => a.id));
  const rows = data.getActivities().filter((t) => (selected ? t.accountId === selected.id : ids.has(t.accountId))).slice(0, 3);
  return `
    <section class="section">
      <div class="row-between sec-head">
        <h2 class="sec-title">${copy.recentTitle}</h2>
        <button class="link-btn" data-action="assets-view-all-activity">查看全部 ${icon('chevronRight', 13)}</button>
      </div>
      <div class="surface"><ul>
        ${rows.length ? rows.map(renderActivityRow).join('') : '<li class="row row-static caption">还没有记录。</li>'}
      </ul></div>
    </section>
  `;
}

function allRowsHTML(type, list, copy) {
  return `
    <section class="section">
      <h2 class="sec-title">${copy.listTitle} (${list.length})</h2>
      <div class="surface"><ul>
        ${list.map((a) => `
          <li class="row" data-action="assets-open-detail" data-acc="${a.id}">
            <span class="acc-chip" style="--brand:${a.brandColor}">${escapeHTML(a.name[0])}</span>
            <div class="row-main">
              <div class="row-title">${escapeHTML(a.name)}</div>
              <div class="caption num">${a.last4 ? `•••• ${a.last4}` : escapeHTML(a.bank)}</div>
            </div>
            <span class="num row-amt ${a.type === 'cc' ? 'amt-neg' : ''}">${fmtRM(a.type === 'cc' ? a.outstanding : a.balance, { privacy: ui.privacy })}</span>
            ${icon('chevronRight', 15)}
          </li>`).join('')}
      </ul></div>
    </section>
  `;
}

export function renderCategoryPage(container, type) {
  const list = data.getAccountsByType(type);
  const copy = COPY[type];
  const index = Math.min(ui.categoryIndex[type] || 0, list.length - 1);
  const selected = list[index];
  const total = type === 'cc'
    ? list.reduce((s, a) => s + a.outstanding, 0)
    : list.reduce((s, a) => s + a.balance, 0);
  container.innerHTML = `
    <section class="section cat-summary">
      <div class="caption">${copy.totalLabel}</div>
      <div class="num cat-total ${type === 'cc' ? 'amt-neg' : 'assets-net-primary'}">${fmtRM(total, { privacy: ui.privacy })}</div>
      <div class="cat-stats">
        ${statsHTML(type, list).map(([k, v, cls]) => `<div class="cat-stat"><span class="caption">${k}</span><span class="num ${cls}">${v}</span></div>`).join('')}
      </div>
    </section>
    ${renderCarousel(list, index, { selectAction: 'category-card-tap' })}
    ${type === 'cc' && selected ? ccStripHTML(selected) : ''}
    ${recentHTML(type, selected, copy)}
    ${allRowsHTML(type, list, copy)}
  `;
}

export function activateCategoryPage(container, type) {
  const list = data.getAccountsByType(type);
  const index = Math.min(ui.categoryIndex[type] || 0, list.length - 1);
  activateCarousel(container, index, (next) => {
    ui.categoryIndex[type] = next;
    update({});
  });
}

export function registerCategoryActions() {
  // Tap on the front card opens its detail; tapping a side card selects it.
  registerAction('category-card-tap', (el, e) => {
    const i = Number(el.dataset.index);
    const type = ui.assetsView.type;
    if (ui.assetsView.name === 'category' && i !== (ui.categoryIndex[type] || 0)) {
      ui.categoryIndex[type] = i;
      update({});
      return;
    }
    dispatchAction('assets-open-detail', el, e);
  });

  registerAction('assets-view-all-activity', () => {
    update({ tab: 'activity', navDirection: 'forward' });
  });
}
