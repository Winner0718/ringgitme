import { escapeHTML, fmtDateMY, fmtRM } from '../app/format.js';
import { ui } from '../app/state.js';
import { resolveAccountIdentity, accountVisualCardHTML } from './AccountVisualCard.js';

export function walletStackPresentationOrder(accounts = [], selectedAccountId = null) {
  const canonical = [...accounts];
  const selected = canonical.find((account) => account.id === selectedAccountId) || canonical[0] || null;
  return selected ? [selected, ...canonical.filter((account) => account.id !== selected.id)] : [];
}

function inactiveLayerHTML(account, type) {
  const identity = resolveAccountIdentity(account);
  const debt = type === 'cc';
  const value = debt ? Number(account.totalCardDebt ?? account.outstanding ?? 0) : account.balance;
  const due = debt && account.dueDate
    ? `<small class="wallet-stack-due">到期 ${fmtDateMY(account.dueDate)}</small>`
    : '';
  return `<span class="wallet-stack-layer-content">
    <span class="wallet-stack-logo" style="--brand:${escapeHTML(identity.brandColor)}"><i>${escapeHTML(identity.initial)}</i>${identity.logoURL ? `<img src="${identity.logoURL}" alt="" draggable="false" />` : ''}</span>
    <span class="wallet-stack-layer-copy"><strong>${escapeHTML(account.name)}</strong><small class="num">${account.last4 ? `•••• ${escapeHTML(account.last4)}` : escapeHTML(identity.institution)}</small>${due}</span>
    <span class="wallet-stack-layer-value num${debt ? ' debt-value' : ''}">${fmtRM(Math.abs(value), { privacy: ui.privacy })}</span>
  </span>`;
}

export function walletStackCategoryDeckHTML(accounts = [], selectedAccountId = null, { type = 'saving' } = {}) {
  const presentation = walletStackPresentationOrder(accounts, selectedAccountId);
  const selected = presentation[0] || null;
  if (!selected) return '<div class="wallet-stack-empty">暂无账户</div>';
  return `<div class="wallet-stack-category-deck wallet-stack-${type}" data-wallet-stack data-selected-account-id="${escapeHTML(selected.id)}" role="listbox" aria-label="${type === 'cc' ? '信用卡' : '储蓄卡'}账户">
    ${presentation.map((account, index) => {
      const active = index === 0;
      const accessibleValue = fmtRM(Math.abs(type === 'cc' ? Number(account.totalCardDebt ?? account.outstanding ?? 0) : account.balance), { privacy: ui.privacy });
      return `<button type="button" class="wallet-stack-card${active ? ' is-selected' : ' is-inactive'}" data-action="wallet-stack-account" data-acc="${escapeHTML(account.id)}" data-wallet-account-id="${escapeHTML(account.id)}" role="option" aria-selected="${active}" aria-label="${active ? '打开' : '选择'}${escapeHTML(account.name)}，${account.last4 ? `尾号 ${escapeHTML(account.last4)}，` : ''}${accessibleValue}" style="--wallet-stack-index:${index};--account-brand:${escapeHTML(account.brandColor || 'var(--accent)')}">
        ${active ? accountVisualCardHTML(account, { variant: 'wallet-stack' }) : inactiveLayerHTML(account, type)}
      </button>`;
    }).join('')}
  </div>`;
}
