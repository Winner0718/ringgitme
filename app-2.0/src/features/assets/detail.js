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
import { maskAssetIdentifier } from '../../domain/assetFinancialModel.js';
import { openSheet, closeSheet, toast } from '../../components/AppSheet.js';

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
  const identifier = a.type === 'ew' ? maskAssetIdentifier(a.walletIdentifier) : maskAssetIdentifier(a.bankAccountNumber || a.debitCardNumber);
  return fieldRows([
    ['余额', fmtRM(a.balance, { privacy: ui.privacy }), ''],
    ['账户类型', TYPE_LABEL[a.type], 'detail-plain'],
    [a.type === 'ew' ? '品牌' : '银行', escapeHTML(a.bank), 'detail-plain'],
    ...(identifier ? [[a.type === 'ew' ? '钱包标识' : '账户标识', escapeHTML(identifier), 'detail-plain']] : []),
    ['最近变动', lastChange(a), 'detail-plain'],
    ['备注', a.note ? escapeHTML(a.note) : '—', 'detail-plain'],
  ]);
}

function ccFields(a) {
  const inst = data.getInstalments(a.id);
  const pool = a.sharedLimitPoolId ? data.getSharedLimitPool(a.sharedLimitPoolId) : null;
  const rows = [
    ['信用卡总欠款', fmtRM(a.totalCardDebt, { privacy: ui.privacy }), 'amt-neg'],
    ['普通消费欠款', fmtRM((a.ordinaryPrincipalOutstandingMinor || 0) / 100, { privacy: ui.privacy }), 'detail-plain'],
    ['分期剩余本金', fmtRM((a.installmentPrincipalOutstandingMinor || 0) / 100, { privacy: ui.privacy }), 'detail-plain'],
    ['费用与利息', fmtRM((a.feeInterestOutstandingMinor || 0) / 100, { privacy: ui.privacy }), 'detail-plain'],
    ...(a.cardCreditBalanceMinor ? [['卡片溢缴余额', fmtRM(a.cardCreditBalanceMinor / 100, { privacy: ui.privacy }), 'amt-pos']] : []),
    ...(!pool ? [['可用额度', fmtRM((a.availableCreditMinor || 0) / 100, { privacy: ui.privacy }), a.availableCreditMinor < 0 ? 'amt-neg' : '']] : []),
    ['信用额度', fmtRM(a.limit, { privacy: ui.privacy }), ''],
    ['本月应还', fmtRM((a.monthStatementDueMinor || 0) / 100, { privacy: ui.privacy }), 'amt-warn'],
    ['本月已还', fmtRM((a.monthPaidMinor || 0) / 100, { privacy: ui.privacy }), 'amt-pos'],
    ['本月剩余', fmtRM((a.monthRemainingMinor || 0) / 100, { privacy: ui.privacy }), 'amt-warn'],
    ['到期日', a.dueDate ? fmtDateMY(a.dueDate) : '暂无到期日', 'detail-plain'],
  ];
  return `
    ${fieldRows(rows)}
    ${pool ? `<section class="section surface asset-shared-pool"><div class="pad-h caption">共享额度池 · ${escapeHTML(pool.name)}</div><ul>${[
      ['总额度', fmtRM(pool.limitMinor / 100, { privacy: ui.privacy }), ''],
      ['已使用', fmtRM(pool.usedMinor / 100, { privacy: ui.privacy }), 'amt-neg'],
      ['共享可用', fmtRM(pool.availableMinor / 100, { privacy: ui.privacy }), pool.availableMinor < 0 ? 'amt-neg' : ''],
      ['成员卡片', `${pool.memberIds.length} 张`, 'detail-plain'],
    ].map(([label, value, cls]) => `<li class="row row-static detail-field"><div class="row-main caption">${label}</div><span class="num detail-val ${cls}">${value}</span></li>`).join('')}</ul></section>` : ''}
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

function operationAmount(operation) {
  const value = operation.metadata?.amountMinor ?? operation.metadata?.deltaMinor
    ?? operation.result?.amountMinor ?? operation.result?.deltaMinor ?? 0;
  return Number(value) / 100;
}

function operationHistory(account) {
  const labels = {
    asset_adjustment: '余额调整', card_opening_debt: '导入已有欠款', card_fee: '费用与利息',
    card_installment_purchase: '新分期消费', card_installment_conversion: '转换已有消费', card_installment_import: '导入已有分期', card_payment: '信用卡还款', card_refund: '信用卡退款', card_linked_refund: '原消费退款', card_general_credit: '一般卡片退款',
  };
  const operations = data.getAssetOperations().filter((operation) => [operation.metadata?.accountId, operation.metadata?.cardId, operation.metadata?.sourceAccountId].includes(account.id));
  if (!operations.length) return '';
  return `<section class="section surface asset-operation-history"><div class="pad-h caption">账户操作</div><ul>${operations.slice(0, 8).map((operation) => `<li class="row row-static"><div class="row-main"><div class="row-title">${escapeHTML(labels[operation.type] || '账户操作')}</div><div class="caption">${operation.status === 'reversed' ? '已撤销' : '已记录'}</div></div><div class="asset-operation-history-result"><span class="num row-amt${['card_refund', 'card_linked_refund', 'card_general_credit', 'card_payment'].includes(operation.type) ? ' amt-pos' : ''}">${fmtRM(operationAmount(operation), { privacy: ui.privacy })}</span>${operation.status === 'active' ? `<button type="button" class="asset-operation-reverse" data-action="asset-operation-reverse-request" data-operation-id="${escapeHTML(operation.id)}" aria-label="撤销${escapeHTML(labels[operation.type] || '账户操作')}">撤销</button>` : ''}</div></li>`).join('')}</ul></section>`;
}

function detailActions(account) {
  const buttons = account.type === 'cc'
    ? [
      ['payment', 'repayment', '还款'], ['refund', 'refund', '记录退款'], ['installment', 'calendar', '新增分期'],
    ]
    : [['transfer-in', 'arrowDown', '转入'], ['transfer-out', 'arrowUp', '转出'], ['adjustment', 'transfer', '调整余额']];
  return `<section class="section surface asset-detail-actions"><div class="asset-action-grid">${buttons.map(([operation, iconName, label]) => `<button type="button" data-action="${operation === 'transfer-in' ? 'asset-transfer-in' : operation === 'transfer-out' ? 'asset-transfer-out' : 'asset-detail-operation'}" data-id="${escapeHTML(account.id)}" ${operation.startsWith('transfer-') ? '' : `data-operation="${operation}"`}><span>${icon(iconName, 18)}</span><strong>${label}</strong></button>`).join('')}</div></section>`;
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
    ${detailActions(acc)}
    ${operationHistory(acc)}
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
  registerAction('asset-operation-reverse-request', (el) => {
    const operation = data.getAssetOperation(el.dataset.operationId);
    if (!operation || operation.status !== 'active') return;
    openSheet({
      title: '安全撤销这次操作？',
      stacked: true,
      contentHTML: `<div class="asset-confirm-copy"><p>确认后会完整还原这次账户变化；操作记录会保留并标记为已撤销。</p><button type="button" class="sheet-danger" data-action="asset-operation-reverse-confirm" data-operation-id="${escapeHTML(operation.id)}">确认撤销</button><button type="button" class="sheet-secondary" data-action="sheet-close">取消</button></div>`,
    });
  });
  registerAction('asset-operation-reverse-confirm', (el) => {
    try {
      data.reverseAssetOperation(el.dataset.operationId, { reason: '用户从资产详情撤销' });
      closeSheet(true);
      update({});
      toast('账户金额已完整还原');
    } catch (error) {
      toast(error.message || '当前状态无法安全撤销。');
    }
  });
}
