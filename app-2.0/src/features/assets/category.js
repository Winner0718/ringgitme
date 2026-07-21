// Category pages have a browsing responsibility distinct from Account Detail.
// Savings, credit cards and eWallets use the same tap-driven vertical Wallet
// stack. Account Detail remains the horizontal carousel.

import { data, ui, update, registerAction, dispatchAction } from '../../app/state.js';
import { ASSET_CATEGORY_COPY } from '../../app/copy.js';
import { fmtRM, fmtDateMY, fmtTimeAMPM, escapeHTML } from '../../app/format.js';
import { walletStackCategoryDeckHTML } from '../../components/WalletStackCategoryDeck.js';
import { renderActivityRow } from '../../components/ActivityRow.js';
import { icon } from '../../components/Icons.js';
import { pushRoute } from '../../app/router.js';

export function transactionTouchesAccount(transaction, accountId) {
  return Boolean(accountId) && [transaction.accountId, transaction.sourceAccountId, transaction.destinationAccountId].includes(accountId);
}

export function selectedAccountRecords(activities, accountId, limit = 3) {
  const seen = new Set();
  return activities.filter((transaction) => transactionTouchesAccount(transaction, accountId) && transaction.id && !seen.has(transaction.id) && seen.add(transaction.id)).slice(0, limit);
}

export function selectedSavingsFlow(activities, accountId) {
  return activities.filter((transaction) => transaction.accountEffect === 'posted').reduce((flow, transaction) => {
    if (transaction.kind === 'income' && transaction.destinationAccountId === accountId) flow.inflow += transaction.amount;
    if (transaction.kind === 'expense' && transaction.sourceAccountId === accountId) flow.outflow += transaction.amount;
    if (transaction.kind === 'transfer' && transaction.destinationAccountId === accountId) flow.inflow += transaction.amount;
    if (transaction.kind === 'transfer' && transaction.sourceAccountId === accountId) flow.outflow += transaction.amount;
    return flow;
  }, { inflow: 0, outflow: 0 });
}

export function selectedCashAccountFlow(activities, accountId) {
  return activities.filter((transaction) => transaction.accountEffect === 'posted').reduce((flow, transaction) => {
    if ((transaction.kind === 'income' || transaction.kind === 'transfer') && transaction.destinationAccountId === accountId) flow.inflow += transaction.amount;
    if ((transaction.kind === 'expense' || transaction.kind === 'transfer') && transaction.sourceAccountId === accountId) flow.outflow += transaction.amount;
    return flow;
  }, { inflow: 0, outflow: 0 });
}

export function creditMonthStats(activities, accountIds, month = '2026-07') {
  const ids = new Set(accountIds);
  return activities.filter((transaction) => transaction.accountEffect === 'posted' && transaction.date?.startsWith(month)).reduce((stats, transaction) => {
    if (transaction.kind === 'expense' && ids.has(transaction.sourceAccountId || transaction.accountId)) stats.spent += transaction.amount;
    if (transaction.kind === 'income' && ids.has(transaction.destinationAccountId || transaction.accountId)) stats.paid += transaction.amount;
    return stats;
  }, { spent: 0, paid: 0 });
}

export function availableCreditForAccount(account, accounts) {
  if (!account) return 0;
  if (!account.sharedPool) return Number(account.limit || 0) - Number(account.outstanding || 0);
  const poolOutstanding = accounts.filter((candidate) => candidate.sharedPool === account.sharedPool).reduce((sum, candidate) => sum + Number(candidate.outstanding || 0), 0);
  return Number(account.sharedPoolTotal || 0) - poolOutstanding;
}

function canonicalAvailableCreditForAccount(account) {
  return Number.isInteger(account?.availableCreditMinor) ? account.availableCreditMinor / 100 : Number(account?.limit || 0) - Number(account?.outstanding || 0);
}

function categoryStatsHTML(type, list, activities) {
  const copy = ASSET_CATEGORY_COPY[type];
  if (type === 'saving' || type === 'ew') {
    const flow = type === 'saving'
      ? data.getSavingsFlow()
      : list.reduce((total, account) => {
        const accountFlow = selectedCashAccountFlow(activities, account.id);
        return { inflow: total.inflow + accountFlow.inflow, outflow: total.outflow + accountFlow.outflow };
      }, { inflow: 0, outflow: 0 });
    return [
      [copy.countLabel, String(list.length), ''],
      [copy.inflowLabel, `+${fmtRM(flow.inflow, { privacy: ui.privacy })}`, 'amt-pos'],
      [copy.outflowLabel, `−${fmtRM(flow.outflow, { privacy: ui.privacy })}`, 'amt-neg'],
    ];
  }
  const monthly = creditMonthStats(activities, list.map((account) => account.id));
  return [
    [copy.countLabel, String(list.length), ''],
    [copy.spendLabel, fmtRM(monthly.spent, { privacy: ui.privacy }), 'amt-neg'],
    [copy.paidLabel, fmtRM(monthly.paid, { privacy: ui.privacy }), 'amt-pos'],
  ];
}

function selectedSummaryHTML(type, selected, list, activities) {
  const copy = ASSET_CATEGORY_COPY[type];
  const records = selectedAccountRecords(activities, selected.id);
  const recent = records[0];
  if (type === 'saving' || type === 'ew') {
    const flow = selectedCashAccountFlow(activities, selected.id);
    const lastChange = recent ? `${fmtDateMY(recent.date)} · ${fmtTimeAMPM(recent.time)}` : '—';
    return `<section class="section surface wallet-selected-summary" data-summary-account-id="${escapeHTML(selected.id)}">
      <div class="wallet-selected-heading"><span class="caption">${copy.currentLabel}</span><strong>${escapeHTML(selected.name)}</strong></div>
      <div class="wallet-selected-grid">
        <span>${copy.balanceLabel}<strong class="num">${fmtRM(selected.balance, { privacy: ui.privacy })}</strong></span>
        <span>${copy.inflowLabel}<strong class="num amt-pos">+${fmtRM(flow.inflow, { privacy: ui.privacy })}</strong></span>
        <span>${copy.outflowLabel}<strong class="num amt-neg">−${fmtRM(flow.outflow, { privacy: ui.privacy })}</strong></span>
        <span>${copy.recentChangeLabel}<strong class="num">${lastChange}</strong></span>
      </div>
      <button type="button" class="wallet-detail-cta" data-action="assets-open-detail" data-acc="${escapeHTML(selected.id)}">${copy.detailPrefix}${escapeHTML(selected.name)}${copy.detailSuffix} ${icon('chevronRight', 14)}</button>
    </section>`;
  }
  // monthlyDue is the canonical cycle total and already includes the current
  // installment occurrence. Adding installments here would double-count it.
  const monthlyDue = selected.duePaid ? 0 : Number(selected.monthCardDue || 0);
  const available = canonicalAvailableCreditForAccount(selected);
  return `<section class="section surface wallet-selected-summary" data-summary-account-id="${escapeHTML(selected.id)}">
    <div class="wallet-selected-heading"><span class="caption">${copy.currentLabel}</span><strong>${escapeHTML(selected.name)}</strong></div>
    <div class="wallet-selected-grid">
      <span>${copy.balanceLabel}<strong class="num amt-neg">${fmtRM(selected.totalCardDebt, { privacy: ui.privacy })}</strong></span>
      <span>${copy.dueLabel}<strong class="num amt-neg">${fmtRM(monthlyDue, { privacy: ui.privacy })}</strong></span>
      <span>本期还款日<strong class="num">${selected.dueDate ? fmtDateMY(selected.dueDate) : '暂无本期还款日'}</strong></span>
      <span>${copy.availableLabel}<strong class="num${available < 0 ? ' amt-neg' : ''}">${fmtRM(available, { privacy: ui.privacy })}</strong></span>
    </div>
    <button type="button" class="wallet-detail-cta" data-action="assets-open-detail" data-acc="${escapeHTML(selected.id)}">${copy.detailPrefix}${escapeHTML(selected.name)}${copy.detailSuffix} ${icon('chevronRight', 14)}</button>
  </section>`;
}

function recentHTML(type, selected, title, activities) {
  const matchingActivities = selected ? activities.filter((t) => t.accountId === selected.id || t.sourceAccountId === selected.id || t.destinationAccountId === selected.id) : [];
  const rows = selectedAccountRecords(matchingActivities, selected?.id);
  return `<section class="section wallet-category-recent" data-recent-account-id="${escapeHTML(selected?.id || '')}">
    <div class="row-between sec-head"><h2 class="sec-title">${title}</h2><button class="link-btn" data-action="assets-view-all-activity" data-acc="${escapeHTML(selected?.id || '')}">${ASSET_CATEGORY_COPY.action.viewAll} ${icon('chevronRight', 13)}</button></div>
    <div class="surface"><ul>${rows.length ? rows.map(renderActivityRow).join('') : '<li class="row row-static caption">还没有记录。</li>'}</ul></div>
  </section>`;
}

function renderWalletCategory(container, type, list) {
  const activities = data.getActivities();
  const requestedId = ui.selectedAccountId[type];
  const selected = list.find((account) => account.id === requestedId) || list[0];
  if (!selected) return;
  const selectedId = selected.id;
  ui.selectedAccountId[type] = selected.id;
  ui.categoryIndex[type] = list.findIndex((account) => account.id === selectedId);
  const copy = ASSET_CATEGORY_COPY[type];
  const total = list.reduce((sum, account) => sum + (type === 'cc' ? Number(account.totalCardDebt ?? account.outstanding ?? 0) : account.balance), 0);
  container.innerHTML = `<section class="section cat-summary wallet-category-summary">
      <div class="caption">${copy.totalLabel}</div>
      <div class="num cat-total ${type === 'cc' ? 'amt-neg' : 'assets-net-primary'}">${fmtRM(total, { privacy: ui.privacy })}</div>
      <div class="cat-stats">${categoryStatsHTML(type, list, activities).map(([label, value, cls]) => `<div class="cat-stat"><span class="caption">${label}</span><span class="num ${cls}">${value}</span></div>`).join('')}</div>
    </section>
    <section class="section wallet-stack-section">${walletStackCategoryDeckHTML(list, selected.id, { type })}</section>
    ${selectedSummaryHTML(type, selected, list, activities)}
    ${recentHTML(type, selected, copy.recentTitle, activities)}`;
}

export function renderCategoryPage(container, type) {
  const list = data.getAccountsByType(type);
  renderWalletCategory(container, type, list);
}

export function activateCategoryPage() {}

export function registerCategoryActions() {
  registerAction('wallet-stack-account', (el, event) => {
    const type = ui.assetsView.type;
    const accountId = el.dataset.acc;
    if (ui.assetsView.name !== 'category' || !['saving', 'cc', 'ew'].includes(type)) return;
    if (accountId !== ui.selectedAccountId[type]) {
      const list = data.getAccountsByType(type);
      ui.categoryIndex[type] = list.findIndex((account) => account.id === accountId);
      update({ selectedAccountId: { ...ui.selectedAccountId, [type]: el.dataset.acc } });
      return;
    }
    dispatchAction('assets-open-detail', el, event);
  });

  registerAction('category-card-tap', (element, event) => {
    const index = Number(element.dataset.index);
    const type = ui.assetsView.type;
    if (ui.assetsView.name === 'category' && element.dataset.acc !== ui.selectedAccountId[type]) {
      ui.categoryIndex[type] = index;
      update({ selectedAccountId: { ...ui.selectedAccountId, [type]: element.dataset.acc } });
      return;
    }
    dispatchAction('assets-open-detail', element, event);
  });

  registerAction('assets-view-all-activity', (element) => {
    pushRoute({
      tab: 'activity',
      activityDetailId: null,
      activityAccountId: element.dataset.acc || null,
      activityQuery: '',
      activityFilter: 'all',
    }, { direction: 'forward' });
  });
}
