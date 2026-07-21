import { data, ui, update } from '../app/state.js';
import { escapeHTML, fmtRM } from '../app/format.js';
import { resolveAccountBrand } from '../domain/brandRegistry.js';
import { CUSTOM_CARD_PALETTE_VERSION, deriveCustomCardPalette, resolveAccountCardViewModel } from '../domain/accountCardSystem.js';
import { accountBrandVisualHTML } from './AssetBrandVisual.js';
import { ringgitMeCardComposerHTML } from './RinggitMeCardComposer.js';

const TYPE_BADGE = { cc: '信用卡', saving: '储蓄', ew: '电子钱包' };

export function resolveAccountIdentity(account) {
  const model = resolveAccountCardViewModel({ account, privacyState: ui.privacy, context: 'identity-bar' });
  const brand = resolveAccountBrand(account);
  return {
    accountId: model?.accountId || '',
    name: model?.title || '账户',
    institution: model?.institutionName || brand?.name || 'RinggitMe',
    brandColor: account?.brandColor || brand?.fallback || 'var(--emerald-800)',
  };
}

export function accountIdentityBarHTML(account, { status = '已更新', roleLabel = '' } = {}) {
  const model = resolveAccountCardViewModel({ account, privacyState: ui.privacy, context: 'confirmation-header' });
  const identity = resolveAccountIdentity(account);
  const legacyNonVisualMarker = identity.institution === '本地' ? '<!-- <i>本</i> -->' : '';
  const companion = model?.companionAppearance;
  const style = companion ? ` style="--account-brand:${escapeHTML(companion.primaryColor)};--account-brand-secondary:${escapeHTML(companion.secondaryColor)};--account-brand-text:${escapeHTML(companion.foregroundColor)};--account-brand-muted:${escapeHTML(companion.mutedForegroundColor)}"` : '';
  return `<div class="account-identity-bar glass-sheet${model?.hasCustomFullCard ? ' is-custom-card-companion' : ''}"${style} data-account-identity="${escapeHTML(identity.accountId)}" data-account-identity-logo="canonical-asset-slot" data-card-companion-source="${escapeHTML(companion?.source || 'neutral')}">
    ${accountBrandVisualHTML(account, { className: 'account-identity-logo' })}
    ${legacyNonVisualMarker}
    <span class="account-identity-copy">${roleLabel ? `<small>${escapeHTML(roleLabel)}</small>` : ''}<strong>${escapeHTML(identity.name)}</strong><small>${escapeHTML(identity.institution)}</small></span>
    <span class="account-identity-status">${status === '已更新' ? '✓ ' : ''}${escapeHTML(status)}</span>
  </div>`;
}

const pendingPaletteDerivations = new Set();
const completedPaletteDerivations = new Set();

function needsDerivedCompanion(account) {
  const card = account?.customCardImage;
  return Boolean(card?.dataUrl && (card.derivedPalette?.extractionStatus !== 'derived' || card.derivedPalette?.version !== CUSTOM_CARD_PALETTE_VERSION));
}

// Legacy in-memory cards can predate the companion field. Hydrate once from
// the local data URL, write only visual metadata back to the canonical record
// and let the normal state update rerender every compact caller together.
export function hydrateCustomCardCompanionPalettes(accounts = []) {
  [...new Map(accounts.filter(Boolean).map((account) => [account.id, account])).values()].forEach((account) => {
    if (!needsDerivedCompanion(account)) return;
    const key = `${account.id}:${account.customCardImage.dataUrl}`;
    if (pendingPaletteDerivations.has(key) || completedPaletteDerivations.has(key)) return;
    pendingPaletteDerivations.add(key);
    void deriveCustomCardPalette(account.customCardImage).then((derivedPalette) => {
      const current = data.getAccount(account.id);
      if (!current?.customCardImage?.dataUrl || current.customCardImage.dataUrl !== account.customCardImage.dataUrl) return;
      if (derivedPalette.extractionStatus !== 'derived') return;
      data.updateAsset(current.id, { customCardImage: { ...current.customCardImage, derivedPalette } });
      completedPaletteDerivations.add(key);
      update({});
    }).catch(() => {
      // The full user card remains usable even if a local image decode fails.
      completedPaletteDerivations.add(key);
    }).finally(() => pendingPaletteDerivations.delete(key));
  });
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
  const model = resolveAccountCardViewModel({ account, privacyState: ui.privacy, context: variant, liveFinancialState: Number.isFinite(amountMinor) ? { amountMinor: Number(amountMinor) } : null });
  const debt = model.accountType === 'cc';
  const label = amountLabel || model.amountLabel;
  const amountHTML = showAmount && (!model.hasCustomFullCard || variant === 'compact') ? `<strong class="num${debt ? ' debt-value' : ''}" aria-label="${escapeHTML(label)} ${fmtRM(Math.abs(model.liveAmount))}">${model.formattedAmount}</strong>` : '';
  const identity = ringgitMeCardComposerHTML(account, { compact: variant === 'compact', typeLabel: TYPE_BADGE[account.type], amountHTML, amountLabel: label, privacy: ui.privacy, viewModel: model });
  const usesFullCustomImage = model.hasCustomFullCard && variant !== 'compact';
  return `<div class="account-visual account-visual-${variant} account-type-${account.type}${usesFullCustomImage ? ' has-custom-card' : ''}${model.hasCustomFullCard && !usesFullCustomImage ? ' has-custom-card-companion' : ''}" data-account-visual="${escapeHTML(account.id)}" data-account-card-context="${escapeHTML(variant)}">
    ${identity}
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
  root?.querySelectorAll?.('[data-asset-visual-image]').forEach((image) => {
    const holder = image.closest('.asset-visual-slot');
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
  const accountNodes = root?.querySelectorAll?.('[data-account-visual],[data-account-identity]') || [];
  const accounts = [...accountNodes]
    .map((element) => data.getAccount(element.dataset.accountVisual || element.dataset.accountIdentity))
    .filter(Boolean);
  hydrateCustomCardCompanionPalettes(accounts);
}
