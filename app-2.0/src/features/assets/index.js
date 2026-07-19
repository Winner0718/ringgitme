// ============================================================
// 资产 overview page (approved design).
// Vertically scrolling: summary → 总览/资产/负债 segmented →
// 储蓄卡 stacked deck → 信用卡 stacked deck → eWallet
// horizontal tiles → 投资 → 定存. Category headers push into
// category pages; cards push into 账户详情.
// ============================================================

import { backOr, pushRoute, registerPage } from '../../app/router.js';
import { data, ui, update, registerAction } from '../../app/state.js';
import { fmtRM, fmtDateMY, daysBetween, escapeHTML } from '../../app/format.js';
import { openSheet } from '../../components/AppSheet.js';
import { icon } from '../../components/Icons.js';
import { resolveAccountBrand } from '../../domain/brandRegistry.js';
import { renderCategoryPage, activateCategoryPage, registerCategoryActions } from './category.js';
import { renderDetailPage, activateDetailPage, registerDetailActions } from './detail.js';
import { runSharedCardTransition } from '../../app/motion.js';
import { registerAssetManagementActions } from './AssetManagementSheets.js';
import { maskAssetIdentifier } from '../../domain/assetFinancialModel.js';

function summaryHTML(pulse) {
  return `
    <section class="assets-head section">
      <div>
        <div class="caption">净资产</div>
        <div class="num assets-net ${pulse.netAssets < 0 ? 'amt-neg' : 'assets-net-primary'}">${fmtRM(pulse.netAssets, { privacy: ui.privacy })}</div>
      </div>
      <div class="assets-sub">
        <div><span class="caption">总资产</span><span class="num">${fmtRM(pulse.totalAssets, { privacy: ui.privacy })}</span></div>
        <div><span class="caption">总负债</span><span class="num amt-neg">${fmtRM(pulse.totalDebt, { privacy: ui.privacy })}</span></div>
      </div>
    </section>
  `;
}

function segmentedHTML() {
  const segs = [
    { id: 'all', label: '总览' },
    { id: 'assets', label: '资产' },
    { id: 'liab', label: '负债' },
  ];
  return `
    <div class="segmented" role="radiogroup" aria-label="资产分类">
      ${segs.map((s) => `<button class="seg-item${ui.assetsSegment === s.id ? ' active' : ''}" data-action="assets-segment" data-seg="${s.id}" role="radio" aria-checked="${ui.assetsSegment === s.id}">${s.label}</button>`).join('')}
    </div>
  `;
}

function sectionHeader({ iconName, title, valueLabel, value, valueCls = '', action, count }) {
  return `
    <button class="asset-sec-head" data-action="${action}">
      <span class="asset-sec-icon">${icon(iconName, 18)}</span>
      <span class="asset-sec-title">${title}${count ? ` <span class="caption">(${count})</span>` : ''}</span>
      <span class="asset-sec-total"><span class="caption">${valueLabel}</span>
        <span class="num ${valueCls}">${value}</span></span>
      ${icon('chevronRight', 15)}
    </button>
  `;
}

function brandTileHTML(account) {
  const brand = resolveAccountBrand(account);
  const fallback = escapeHTML((brand?.name || account.bank || account.name || '?').slice(0, 1));
  return `<span class="asset-brand-tile" style="--brand:${account.brandColor || brand?.fallback || 'var(--accent)'}">${brand?.logoURL ? `<img src="${brand.logoURL}" alt="" draggable="false" />` : fallback}</span>`;
}

function compactAccountRows(list, { debt = false } = {}) {
  return `<ul class="asset-account-list asset-card-stack">${list.map((account, index) => `<li class="asset-account-row asset-stack-row" style="--account-brand:${account.brandColor || 'var(--accent)'};--stack-index:${index}" data-action="assets-open-detail" data-acc="${escapeHTML(account.id)}" role="button" tabindex="0">
    ${brandTileHTML(account)}<span class="asset-account-copy"><strong>${escapeHTML(account.name)}</strong><small class="num">${escapeHTML(account.type === 'cc' ? (account.creditCardLast4 ? `•••• ${account.creditCardLast4}` : account.bank) : maskAssetIdentifier(account.bankAccountNumber || account.debitCardNumber || account.walletIdentifier) || account.bank)}</small></span>
    <span class="asset-account-amount num${debt ? ' debt' : ''}">${accountDisplayAmount(account, debt)}</span>${icon('chevronRight', 15)}
  </li>`).join('')}</ul>`;
}

function accountDisplayAmount(account, debt) {
  if (debt && Number.isFinite(account.totalCardDebt)) return fmtRM(account.totalCardDebt, { privacy: ui.privacy });
  // Compatibility fallback for pre-2D1A records without canonical debt fields.
  return fmtRM(debt ? account.outstanding : account.balance, { privacy: ui.privacy });
}

function savingsSection() {
  const list = data.getAccountsByType('saving');
  const total = list.reduce((s, a) => s + a.balance, 0);
  return `
    <section class="section surface asset-sec">
      ${sectionHeader({ iconName: 'assets', title: '储蓄卡', valueLabel: '总额', value: fmtRM(total, { privacy: ui.privacy }), action: 'assets-open-saving', count: list.length })}
      ${compactAccountRows(list)}
    </section>
  `;
}

function creditSection() {
  const list = data.getAccountsByType('cc');
  const total = list.reduce((s, a) => s + (Number.isFinite(a.totalCardDebt) ? a.totalCardDebt : a.outstanding), 0);
  return `
    <section class="section surface asset-sec">
      ${sectionHeader({ iconName: 'wallet', title: '信用卡', valueLabel: '总欠款', value: fmtRM(total, { privacy: ui.privacy }), valueCls: 'amt-neg', action: 'assets-open-cc', count: list.length })}
      ${compactAccountRows(list, { debt: true })}
    </section>
  `;
}

function ewalletSection() {
  const list = data.getAccountsByType('ew');
  const total = list.reduce((s, a) => s + a.balance, 0);
  return `
    <section class="section surface asset-sec">
      ${sectionHeader({ iconName: 'wallet', title: 'eWallet', valueLabel: '总余额', value: fmtRM(total, { privacy: ui.privacy }), action: 'assets-open-ew' })}
      <div class="wallet-scroll asset-wallet-scroll" aria-label="eWallet 账户">${list.map((account) => `<button type="button" class="wallet-tile asset-wallet-tile" data-action="assets-open-detail" data-acc="${escapeHTML(account.id)}">${brandTileHTML(account)}<span class="wallet-tile-copy"><strong>${escapeHTML(account.name)}</strong><span class="num">${fmtRM(account.balance, { privacy: ui.privacy })}</span></span></button>`).join('')}</div>
    </section>
  `;
}

function sparklineSVG(points) {
  const max = Math.max(...points);
  const min = Math.min(...points);
  const W = 110;
  const H = 36;
  const step = W / (points.length - 1);
  const pts = points.map((v, i) => `${(i * step).toFixed(1)},${(H - 4 - ((v - min) / (max - min)) * (H - 8)).toFixed(1)}`).join(' ');
  return `<svg class="sparkline" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
    <polyline points="${pts}" fill="none" stroke="var(--sem-green)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

function investmentSection() {
  const inv = data.getInvestments();
  return `
    <section class="section surface asset-sec">
      ${sectionHeader({ iconName: 'trend', title: '投资', valueLabel: '总市值', value: fmtRM(inv.total, { privacy: ui.privacy }), action: 'assets-open-inv' })}
      <div class="inv-body">
        <div class="inv-col">
          <div class="row-title">投资组合 (${inv.portfolios})</div>
          <div class="caption">1 日收益</div>
          <div class="num amt-pos inv-gain">+${fmtRM(inv.dayGain, { privacy: ui.privacy }).replace('RM ', 'RM ')} (+${inv.dayPct}%)</div>
        </div>
        ${sparklineSVG(inv.spark)}
        <div class="inv-col inv-col-right">
          <div class="caption">月收益</div>
          <div class="num amt-pos inv-gain">+${fmtRM(inv.monthGain, { privacy: ui.privacy }).replace('RM ', 'RM ')}</div>
          <div class="num amt-pos caption">(+${inv.monthPct}%)</div>
        </div>
      </div>
    </section>
  `;
}

function fdSection() {
  const fd = data.getFixedDeposits();
  const days = daysBetween(data.today, fd.nextMaturity);
  return `
    <section class="section surface asset-sec">
      ${sectionHeader({ iconName: 'lock', title: '定存', valueLabel: '总本金', value: fmtRM(fd.total, { privacy: ui.privacy }), action: 'assets-open-fd' })}
      <div class="inv-body">
        <div class="inv-col">
          <div class="row-title">定期存款 (${fd.count})</div>
          <div class="caption">下次到期</div>
          <div class="fd-date">${fmtDateMY(fd.nextMaturity)}（还有 ${days} 天）</div>
        </div>
        <div class="inv-col inv-col-right">
          <div class="caption">到期本息（预计）</div>
          <div class="num fd-expected">${fmtRM(fd.expectedAtMaturity, { privacy: ui.privacy })}</div>
        </div>
      </div>
    </section>
  `;
}

function renderOverview(container) {
  const pulse = data.getPulse();
  const seg = ui.assetsSegment;
  const showAssets = seg !== 'liab';
  const showLiab = seg !== 'assets';
  container.innerHTML = `
    ${summaryHTML(pulse)}
    ${segmentedHTML()}
    ${showAssets ? savingsSection() : ''}
    ${showLiab ? creditSection() : ''}
    ${showAssets ? ewalletSection() : ''}
    ${showAssets ? investmentSection() : ''}
    ${showAssets ? fdSection() : ''}
  `;
}

function renderAssets(container) {
  const view = ui.assetsView;
  if (view.name === 'category') {
    renderCategoryPage(container, view.type);
    activateCategoryPage(container, view.type);
    return;
  }
  if (view.name === 'detail') {
    renderDetailPage(container, view.accountId);
    activateDetailPage(container, view.accountId);
    return;
  }
  renderOverview(container);
}

function placeholderSheet(title, rows) {
  openSheet({
    title,
    contentHTML: `
      <div class="sheet-group">
        ${rows.map(([k, v]) => `<div class="row row-static"><div class="row-main caption">${k}</div><span class="num">${v}</span></div>`).join('')}
      </div>
      <button class="sheet-primary" data-action="sheet-close">好</button>
    `,
  });
}

export function registerAssetsFeature() {
  registerPage('assets', renderAssets);
  registerCategoryActions();
  registerDetailActions();
  registerAssetManagementActions();

  registerAction('assets-segment', (el) => update({ assetsSegment: el.dataset.seg }));
  registerAction('assets-open-saving', () => pushRoute({ assetsView: { name: 'category', type: 'saving' } }));
  registerAction('assets-open-cc', () => pushRoute({ assetsView: { name: 'category', type: 'cc' } }));
  registerAction('assets-open-ew', () => pushRoute({ assetsView: { name: 'category', type: 'ew' } }));

  registerAction('assets-open-detail', (el) => {
    const acc = data.getAccount(el.dataset.acc);
    if (!acc) return;
    runSharedCardTransition(el.closest('.deck-card, .asset-account-row, .wallet-tile'));
    const from = ui.assetsView.name === 'category' ? 'category' : 'overview';
    const list = data.getAccountsByType(acc.type);
    ui.categoryIndex[acc.type] = list.indexOf(acc);
    pushRoute({ selectedAccountId: { ...ui.selectedAccountId, [acc.type]: acc.id }, assetsView: { name: 'detail', accountId: acc.id, from } });
  });

  registerAction('assets-back', () => {
    const view = ui.assetsView;
    if (view.name === 'detail' && view.from === 'category') {
      const type = data.getAccount(view.accountId)?.type || 'saving';
      backOr({ tab: 'assets', assetsView: { name: 'category', type } });
    } else {
      backOr({ tab: 'assets', assetsView: { name: 'overview' } });
    }
  });

  registerAction('assets-open-inv', () => {
    const inv = data.getInvestments();
    placeholderSheet('投资', [
      ['总市值', fmtRM(inv.total, { privacy: ui.privacy })],
      ['投资组合', `${inv.portfolios} 个`],
      ['1 日收益', `+${fmtRM(inv.dayGain)} (+${inv.dayPct}%)`],
      ['月收益', `+${fmtRM(inv.monthGain)} (+${inv.monthPct}%)`],
    ]);
  });

  registerAction('assets-open-fd', () => {
    const fd = data.getFixedDeposits();
    placeholderSheet('定存', [
      ['总本金', fmtRM(fd.total, { privacy: ui.privacy })],
      ['定期存款', `${fd.count} 笔`],
      ['下次到期', fmtDateMY(fd.nextMaturity)],
      ['到期本息（预计）', fmtRM(fd.expectedAtMaturity)],
    ]);
  });
}
