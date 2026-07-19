import { ui } from '../app/state.js';
import { escapeHTML, fmtRM } from '../app/format.js';
import { assetURL, resolveAccountBrand } from '../domain/brandRegistry.js';

const TYPE_BADGE = { cc: '信用卡', saving: '储蓄', ew: 'eWallet' };

export function resolveAccountIdentity(account) {
  const brand = resolveAccountBrand(account);
  const institution = /^Maybank/i.test(account?.bank || '') ? 'Maybank' : account?.bank || brand?.name || 'RinggitMe';
  return {
    accountId: account?.id || '',
    name: account?.name || '账户',
    institution,
    logoURL: brand?.logoURL || '',
    initial: (brand?.name || institution || account?.name || '?').slice(0, 1),
    brandColor: account?.brandColor || brand?.fallback || 'var(--emerald-800)',
  };
}

export function accountIdentityBarHTML(account, { status = '已更新', roleLabel = '' } = {}) {
  const identity = resolveAccountIdentity(account);
  return `<div class="account-identity-bar glass-sheet" data-account-identity="${escapeHTML(identity.accountId)}">
    <span class="account-identity-logo" style="--brand:${identity.brandColor}"><i>${escapeHTML(identity.initial)}</i>${identity.logoURL ? `<img src="${identity.logoURL}" alt="" draggable="false" data-account-identity-logo />` : ''}</span>
    <span class="account-identity-copy">${roleLabel ? `<small>${escapeHTML(roleLabel)}</small>` : ''}<strong>${escapeHTML(identity.name)}</strong><small>${escapeHTML(identity.institution)}</small></span>
    <span class="account-identity-status">${status === '已更新' ? '✓ ' : ''}${escapeHTML(status)}</span>
  </div>`;
}

function accountAmount(account, amountMinor) {
  if (Number.isFinite(amountMinor)) return Number(amountMinor) / 100;
  return account.type === 'cc' ? Number(account.totalCardDebt ?? account.outstanding ?? 0) : account.balance;
}

function fallbackVisual(account, { minimal = false } = {}) {
  return `<div class="account-visual-fallback deck-image-fallback" style="--brand:${account.brandColor || 'var(--emerald-800)'}">
    ${minimal ? `<span class="account-visual-monogram">${escapeHTML((account.bank || account.name || '?').slice(0, 1))}</span>` : `<span class="account-visual-name">${escapeHTML(account.name)}</span><span class="account-visual-bank">${escapeHTML(account.bank)}</span>`}
  </div>`;
}

function walletVisual(account, { minimal = false } = {}) {
  const brand = resolveAccountBrand(account);
  return `<div class="account-wallet-brand" style="--brand:${account.brandColor || brand?.fallback || 'var(--emerald-800)'}">
    <span class="account-wallet-logo"><i>${escapeHTML(account.name.slice(0, 1))}</i>${brand?.logoURL ? `<img src="${brand.logoURL}" alt="" draggable="false" data-brand-image />` : ''}</span>
    ${minimal ? '' : `<span><strong>${escapeHTML(account.short || account.name)}</strong><small>${escapeHTML(account.bank)}</small></span>`}
  </div>`;
}

// One account-identity renderer is shared by Assets, category/detail carousels,
// and Money Flow confirmation. Financial values remain inputs; this component
// never mutates account state.
export function accountVisualCardHTML(account, {
  variant = 'full',
  showAmount = true,
  amountMinor = null,
  amountLabel = '',
} = {}) {
  if (!account) return '<div class="account-visual account-visual-missing">账户资料不可用</div>';
  const amount = accountAmount(account, amountMinor);
  const debt = account.type === 'cc';
  const label = amountLabel || (debt ? '当前欠款' : '账户余额');
  const minimalIdentity = variant === 'confirmation';
  const identity = account.type === 'ew'
    ? walletVisual(account, { minimal: minimalIdentity })
    : account.art
      ? `<img class="account-visual-art" src="${assetURL(account.art)}" alt="" draggable="false" data-card-art />${fallbackVisual(account, { minimal: minimalIdentity })}`
      : fallbackVisual(account, { minimal: minimalIdentity });
  return `<div class="account-visual account-visual-${variant} account-type-${account.type}" data-account-visual="${escapeHTML(account.id)}">
    ${identity}
    <span class="account-visual-badge">${TYPE_BADGE[account.type]}</span>
    <div class="account-visual-overlay">
      <span class="account-visual-digits num">${account.creditCardLast4 || account.last4 ? `•••• ${escapeHTML(account.creditCardLast4 || account.last4)}` : escapeHTML(account.short || account.name)}</span>
      ${showAmount ? `<span class="account-visual-amount"><small>${label}</small><strong class="num${debt ? ' debt-value' : ''}" aria-label="${escapeHTML(label)} ${fmtRM(Math.abs(amount))}">${fmtRM(Math.abs(amount), { privacy: ui.privacy })}</strong></span>` : ''}
    </div>
  </div>`;
}

export function bindAccountVisualFallbacks(root) {
  // Query-only QA adapter for verifying that missing art never blocks or
  // restarts confirmation motion. Normal product rendering is unchanged.
  const forceFailure = new URLSearchParams(globalThis.location?.search || '').get('imageFailure') === '1';
  root?.querySelectorAll?.('[data-card-art]').forEach((image) => {
    const visual = image.closest('[data-account-visual]');
    visual?.classList.add('image-pending');
    const ready = () => visual?.classList.add('image-ready');
    const failed = () => visual?.classList.add('image-failed');
    image.addEventListener('error', failed, { once: true });
    image.addEventListener('load', ready, { once: true });
    if (forceFailure) {
      image.removeAttribute('src');
      failed();
      return;
    }
    if (image.complete && image.naturalWidth === 0) failed();
    else if (image.complete) ready();
    else image.decode?.().then(ready).catch(() => { if (image.complete && image.naturalWidth === 0) failed(); });
  });
  root?.querySelectorAll?.('[data-account-identity-logo], [data-brand-image]').forEach((image) => {
    const holder = image.closest('.account-identity-logo, .account-wallet-logo');
    holder?.classList.add('image-pending');
    const ready = () => holder?.classList.add('image-ready');
    const failed = () => holder?.classList.add('image-failed');
    image.addEventListener('error', failed, { once: true });
    image.addEventListener('load', ready, { once: true });
    if (forceFailure) {
      image.removeAttribute('src');
      failed();
      return;
    }
    if (image.complete && image.naturalWidth === 0) failed();
    else if (image.complete) ready();
    else image.decode?.().then(ready).catch(() => { if (image.complete && image.naturalWidth === 0) failed(); });
  });
}
