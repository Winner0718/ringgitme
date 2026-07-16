// ============================================================
// 账户详情 — same-category card carousel on top (swiping only
// moves within the account's own type), solid field list below,
// then recent records for the selected account.
// ============================================================

import { data, ui, update, registerAction } from '../../app/state.js';
import { fmtRM, fmtDateMY, fmtTimeAMPM, escapeHTML } from '../../app/format.js';
import { renderCarousel, activateCarousel } from '../../components/CardCarousel.js';
import { renderActivityRow } from '../../components/ActivityRow.js';
import { icon } from '../../components/Icons.js';
import { replaceRoute } from '../../app/router.js';

const TYPE_LABEL = { cc: '信用卡', saving: '储蓄账户', ew: '电子钱包' };

function lastChange(acc) {
  const t = data.getActivities().find((x) => x.accountId === acc.id);
  if (!t) return '—';
  const day = t.date === data.today ? '今天' : fmtDateMY(t.date);
  return `${day} ${fmtTimeAMPM(t.time)}`;
}

function fieldRows(rows) {
  return `<div class="surface section"><ul>
    ${rows.map(([k, v, cls]) => `
      <li class="row row-static detail-field">
        <div class="row-main caption">${k}</div>
        <span class="num detail-val ${cls || ''}">${v}</span>
      </li>`).join('')}
  </ul></div>`;
}

function savingsFields(a) {
  return fieldRows([
    ['余额', fmtRM(a.balance, { privacy: ui.privacy }), ''],
    ['账户类型', TYPE_LABEL[a.type], 'detail-plain'],
    [a.type === 'ew' ? '品牌' : '银行', escapeHTML(a.bank), 'detail-plain'],
    ['最近变动', lastChange(a), 'detail-plain'],
    ['备注', a.note ? escapeHTML(a.note) : '—', 'detail-plain'],
  ]);
}

function ccFields(a) {
  const inst = data.getInstalments(a.id);
  const instMonthly = inst.reduce((s, i) => s + i.monthly, 0);
  const rows = [
    ['当前欠额', fmtRM(a.outstanding, { privacy: ui.privacy }), 'amt-neg'],
    ['可用额度', fmtRM(a.limit - a.outstanding, { privacy: ui.privacy }), ''],
    ['信用额度', fmtRM(a.limit, { privacy: ui.privacy }), ''],
    ['本月应还', fmtRM((a.duePaid ? 0 : a.monthlyDue) + instMonthly, { privacy: ui.privacy }), 'amt-warn'],
    ['还款日', fmtDateMY(a.dueDate), 'detail-plain'],
    ['本月已还', a.duePaid ? '已还' : '未还', a.duePaid ? 'amt-pos' : 'detail-plain'],
  ];
  if (a.sharedPool) rows.push([escapeHTML(a.sharedPool), fmtRM(a.sharedPoolTotal, { privacy: ui.privacy }), '']);
  return `
    ${fieldRows(rows)}
    ${inst.length ? `
      <section class="section surface">
        <div class="pad-h caption" style="padding-top:10px">分期</div>
        <ul>
          ${inst.map((i) => `
            <li class="row row-static">
              <div class="row-main">
                <div class="row-title">${escapeHTML(i.name)}</div>
                <div class="caption">剩 ${i.totalTerms - i.paidTerms}/${i.totalTerms} 期 · 剩余 ${fmtRM(i.remaining, { privacy: ui.privacy })}</div>
              </div>
              <span class="num row-amt">${fmtRM(i.monthly, { privacy: ui.privacy })}/月</span>
            </li>`).join('')}
        </ul>
      </section>` : ''}
  `;
}

export function renderDetailPage(container, accountId) {
  const acc = data.getAccount(accountId);
  if (!acc) return;
  const list = data.getAccountsByType(acc.type);
  const index = list.indexOf(acc);
  const recent = data.getActivities().filter((t) => [t.accountId, t.sourceAccountId, t.destinationAccountId].includes(acc.id)).slice(0, 5);
  container.innerHTML = `
    ${renderCarousel(list, index, { selectAction: 'detail-card-tap', variant: 'detail' })}
    ${acc.type === 'cc' ? ccFields(acc) : savingsFields(acc)}
    <section class="section">
      <div class="row-between sec-head">
        <h2 class="sec-title">${acc.type === 'cc' ? '最近消费' : '最近记录'}</h2>
        <button class="link-btn" data-action="assets-view-all-activity" data-acc="${escapeHTML(acc.id)}">查看全部 ${icon('chevronRight', 13)}</button>
      </div>
      <div class="surface"><ul>
        ${recent.length ? recent.map(renderActivityRow).join('') : '<li class="row row-static caption">这个账户还没有记录。</li>'}
      </ul></div>
    </section>
  `;
}

export function activateDetailPage(container, accountId) {
  const acc = data.getAccount(accountId);
  if (!acc) return;
  const list = data.getAccountsByType(acc.type);
  const index = list.indexOf(acc);
  activateCarousel(container, index, (next) => {
    const target = list[next];
    ui.categoryIndex[acc.type] = next;
    replaceRoute({ selectedAccountId: { ...ui.selectedAccountId, [acc.type]: target.id }, assetsView: { ...ui.assetsView, accountId: target.id } });
  });
}

export function registerDetailActions() {
  // Tapping a side card in detail switches to that account
  registerAction('detail-card-tap', (el) => {
    if (ui.assetsView.name !== 'detail') return;
    const target = data.getAccount(el.dataset.acc);
    if (!target || target.id === ui.assetsView.accountId) return;
    ui.categoryIndex[target.type] = Number(el.dataset.index);
    replaceRoute({ selectedAccountId: { ...ui.selectedAccountId, [target.type]: target.id }, assetsView: { ...ui.assetsView, accountId: target.id } });
  });
}
