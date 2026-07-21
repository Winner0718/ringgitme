import { escapeHTML, fmtDateMY, fmtRM } from '../app/format.js';
import { ui } from '../app/state.js';
import { accountVisualCardHTML, hydrateCustomCardCompanionPalettes } from './AccountVisualCard.js';
import { accountBrandVisualHTML } from './AssetBrandVisual.js';
import { resolveAccountCardViewModel } from '../domain/accountCardSystem.js';

export function walletStackPresentationOrder(accounts = [], selectedAccountId = null) {
  const canonical = [...accounts];
  const selected = canonical.find((account) => account.id === selectedAccountId) || canonical[0] || null;
  return selected ? [selected, ...canonical.filter((account) => account.id !== selected.id)] : [];
}

function inactiveLayerHTML(account, type) {
  const model = resolveAccountCardViewModel({ account, privacyState: ui.privacy, context: 'category-stack-inactive' });
  const debt = model.accountType === 'cc';
  const due = debt && account.dueDate
    ? `<small class="wallet-stack-due" data-legacy-due-label="到期 ${fmtDateMY(account.dueDate)}">本期还款日 ${fmtDateMY(account.dueDate)}</small>`
    : '';
  return `<span class="wallet-stack-layer-content">
    ${accountBrandVisualHTML(account, { className: 'wallet-stack-logo' })}
    <span class="wallet-stack-layer-copy"><strong>${escapeHTML(model.title)}</strong><small>${escapeHTML(model.institutionName)}</small>${due}</span>
    <span class="wallet-stack-layer-value num${debt ? ' debt-value' : ''}">${model.formattedAmount}</span>
  </span>`;
}

export function walletStackCategoryDeckHTML(accounts = [], selectedAccountId = null, { type = 'saving' } = {}) {
  hydrateCustomCardCompanionPalettes(accounts);
  const presentation = walletStackPresentationOrder(accounts, selectedAccountId);
  const selected = presentation[0] || null;
  if (!selected) return '<div class="wallet-stack-empty">暂无账户</div>';
  const typeName = type === 'cc' ? '信用卡' : type === 'ew' ? '电子钱包' : '储蓄卡';
  return `<div class="wallet-stack-category-deck wallet-stack-${type}" data-wallet-stack data-selected-account-id="${escapeHTML(selected.id)}" role="listbox" aria-label="${typeName}账户">
    ${presentation.map((account, index) => {
      const active = index === 0;
      const model = resolveAccountCardViewModel({ account, privacyState: ui.privacy, context: active ? 'category-stack-selected' : 'category-stack-inactive' });
      return `<button type="button" class="wallet-stack-card${active ? ' is-selected' : ' is-inactive'}" data-action="wallet-stack-account" data-acc="${escapeHTML(account.id)}" data-wallet-account-id="${escapeHTML(account.id)}" role="option" aria-selected="${active}" aria-label="${active ? '打开' : '选择'}${escapeHTML(model.accessibilityLabel)}" style="--wallet-stack-index:${index};--account-brand:${escapeHTML(model.primaryColor)};--account-brand-secondary:${escapeHTML(model.secondaryColor)};--account-brand-text:${escapeHTML(model.foregroundColor)};--account-brand-muted:${escapeHTML(model.mutedForegroundColor)}">
        ${active ? accountVisualCardHTML(account, { variant: 'wallet-stack' }) : inactiveLayerHTML(account, type)}
      </button>`;
    }).join('')}
  </div>`;
}
