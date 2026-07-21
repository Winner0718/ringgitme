import { escapeHTML } from '../app/format.js';
import { cardNetworkTypography, creditCardTierLabel, resolveAccountCardViewModel } from '../domain/accountCardSystem.js';
import { accountBrandVisualHTML } from './AssetBrandVisual.js';

function styleVariables(palette) {
  return `--card-primary:${palette.primary};--card-supporting:${palette.supporting};--card-highlight:${palette.highlight};--card-lowlight:${palette.lowlight};--card-text:${palette.text};--card-muted:${palette.muted}`;
}

export { creditCardTierLabel } from '../domain/accountCardSystem.js';

export function ringgitMeCardComposerHTML(account = {}, {
  compact = false,
  preview = false,
  typeLabel = null,
  amountHTML = '',
  amountLabel = '',
  privacy = false,
  viewModel = null,
} = {}) {
  const model = viewModel || resolveAccountCardViewModel({ account, privacyState: privacy, context: preview ? 'editor-preview' : 'card' });
  const type = model.accountType;
  const customCard = model.fullCard?.imageSource || model.customFullCardSource;
  // Uploaded artwork is deliberately image-only when the layout has enough
  // area to show the real card. Compact slots instead consume the same
  // canonical companion appearance, so a black custom card never regresses to
  // an unrelated institution-yellow mini card.
  const useFullCustomImage = Boolean(customCard && !compact);
  if (useFullCustomImage) {
    return `<div class="ringgit-card-composer is-custom-card${compact ? ' is-compact' : ''}" data-card-renderer="user-custom-card" aria-label="${escapeHTML(model.title || '自定义卡面')}"><img class="ringgit-card-custom-image" src="${escapeHTML(customCard)}" alt="${escapeHTML(model.title || '自定义卡面')}" draggable="false" data-card-art /></div>`;
  }

  const palette = model.appearance.palette;
  const accountNumber = type === 'cc' ? '' : model.visibleIdentifier;
  const cardLastFour = type === 'cc' || type === 'saving' ? model.visibleLastFour : '';
  const network = type === 'ew' ? null : cardNetworkTypography(model.networkId);
  const className = `ringgit-card-composer is-system-card palette-${palette.tone}${compact ? ' is-compact' : ''}${customCard ? ' is-custom-card-companion' : ''}`;
  return `<div class="${className}" style="${escapeHTML(styleVariables(palette))}" data-card-renderer="ringgitme-auto-card" data-card-system="institution-palette" data-account-card-model="canonical-live-view-model" data-card-layout="canonical-regions" data-card-palette-brand="${escapeHTML(palette.brandId || 'fallback')}" data-card-companion-source="${escapeHTML(model.companionAppearance?.source || model.visualSource || 'neutral')}" aria-label="${escapeHTML(model.accessibilityLabel)}">
    <span class="ringgit-card-material" aria-hidden="true"></span>
    <span class="ringgit-card-light-field" aria-hidden="true"></span>
    <header class="ringgit-card-identity" data-card-region="identity">${accountBrandVisualHTML(account, { className: 'ringgit-card-brand-logo' })}<span class="ringgit-card-identity-copy ringgit-card-copy"><strong>${escapeHTML(model.title || (preview ? '我的账户' : '账户'))}</strong>${model.institutionName ? `<small class="ringgit-card-meta" title="${escapeHTML(model.institutionName)}">${escapeHTML(model.institutionName)}</small>` : ''}</span></header>
    <span class="ringgit-card-account-type" data-card-region="accountType"><b>${escapeHTML(typeLabel || model.accountTypeLabel)}</b>${cardLastFour ? `<small class="num" data-card-region="cardLastFour">${escapeHTML(cardLastFour)}</small>` : ''}</span>
    <span class="ringgit-card-identifier num" data-card-region="identifier">${escapeHTML(accountNumber)}</span>
    ${model.tierLabel ? `<span class="ringgit-card-tier" data-card-region="tier" title="${escapeHTML(model.tierLabel)}">${escapeHTML(model.tierLabel)}</span>` : ''}
    <span class="ringgit-card-financial">
      ${network ? `<span class="ringgit-card-network-text network-${escapeHTML(network.id)}" data-card-region="network" data-card-network-text="${escapeHTML(network.id)}" aria-label="${escapeHTML(network.label)}">${network.lines.map((line) => `<b>${escapeHTML(line)}</b>`).join('')}</span>` : ''}
      ${amountHTML ? `<span class="ringgit-card-amount" data-card-region="financialValue"><small>${escapeHTML(amountLabel || model.amountLabel)}</small>${amountHTML}</span>` : ''}
    </span>
  </div>`;
}
