import { escapeHTML } from '../app/format.js';
import { assetURL, getBrand, resolveAccountBrand } from '../domain/brandRegistry.js';
import { resolveLegacyAssetIdentity } from '../domain/productCatalogue.js';
import { resolveApprovedCardVisual, resolveAssetVisual } from '../domain/assetVisualRegistry.js';
import { icon } from './Icons.js';

function slotClass(slotType) { return `asset-visual-slot asset-visual-slot-${slotType.replaceAll('_', '-')}`; }

export function assetBrandVisualHTML({
  brandId = null,
  productId = null,
  networkId = null,
  physicalVariantId = null,
  assetId = null,
  slotType = 'brand_compact_mark',
  entityType = null,
  label = '品牌资料',
  qa = false,
  className = '',
  customMedia = null,
  logoPresentationMode = null,
  resolvedLogoPresentation = null,
} = {}) {
  const brand = getBrand(brandId || networkId);
  const activeCustomMedia = customMedia || brand?.customLogo || null;
  const visual = activeCustomMedia?.dataUrl
    ? { assetId: 'account-custom-logo', filePath: activeCustomMedia.dataUrl, status: 'user_custom', iconName: null, aspectRatio: 'source' }
    : resolveAssetVisual({ assetId, brandId, productId, networkId, physicalVariantId, slotType, qa, entityType: entityType || brand?.entityType });
  const content = visual.filePath
    ? `<img src="${escapeHTML(assetURL(visual.filePath))}" alt="" draggable="false" data-asset-visual-image />`
    : icon(visual.iconName || (entityType === 'ewallet' ? 'wallet' : 'bank'), 20);
  const requestedMode = logoPresentationMode || activeCustomMedia?.presentationMode || brand?.logoPresentationMode || 'auto';
  const presentation = resolvedLogoPresentation || activeCustomMedia?.resolvedPresentation || brand?.resolvedLogoPresentation || brand?.logo?.presentation || (visual.aspectRatio === 'wide' ? 'wordmark_contained' : 'symbol_contained');
  return `<span class="${slotClass(slotType)}${className ? ` ${escapeHTML(className)}` : ''}" data-asset-visual-slot="${escapeHTML(slotType)}" data-asset-visual-shape="${escapeHTML(visual.aspectRatio || brand?.logo?.shape || 'source')}" data-logo-fit="${escapeHTML(requestedMode)}" data-logo-presentation="${escapeHTML(presentation)}" data-asset-visual-status="${escapeHTML(visual.status)}" data-asset-visual-id="${escapeHTML(visual.assetId)}" data-brand-image-contract="canonical-asset-slot" role="img" aria-label="${escapeHTML(label)}">${content}</span>`;
}

export function accountBrandVisualHTML(account, { slotType = 'brand_compact_mark', qa = false, className = '' } = {}) {
  const identity = resolveLegacyAssetIdentity(account || {});
  const brand = resolveAccountBrand(account);
  const resolvedSlot = account?.type === 'ew' && slotType === 'brand_compact_mark' ? 'brand_app_icon' : slotType;
  return assetBrandVisualHTML({
    brandId: identity.brandId || brand?.id || null,
    // A brand mark belongs to the institution, not to one legacy product or
    // physical card variant. Product/network metadata is intentionally kept
    // out of this lookup so old catalogue records still resolve the same
    // canonical bank/eWallet logo.
    productId: null,
    networkId: null,
    physicalVariantId: null,
    slotType: resolvedSlot,
    entityType: account?.type === 'ew' ? 'ewallet' : account?.type === 'cc' ? 'bank' : brand?.entityType || 'bank',
    label: `${brand?.displayName || account?.bank || account?.name || '账户'}标识`,
    qa,
    className,
    customMedia: account?.customLogo || brand?.customLogo || null,
    logoPresentationMode: account?.accountVisualOverride?.enabled
      ? account.accountVisualOverride.logoPresentationMode
      : account?.customLogo ? account?.logoPresentationMode : brand?.logoPresentationMode || null,
    resolvedLogoPresentation: account?.customLogo ? account?.resolvedLogoPresentation : brand?.resolvedLogoPresentation || null,
  });
}

export function approvedAccountCardVisual(account) {
  const identity = resolveLegacyAssetIdentity(account || {});
  const mapped = resolveApprovedCardVisual({
    assetId: account?.visualAssetId || account?.artworkAssetId || identity.visualAssetId,
    productId: identity.productId,
    networkId: identity.networkId,
    physicalVariantId: identity.physicalVariantId,
  });
  return mapped || (account?.art ? resolveApprovedCardVisual({ filePath: account.art }) : null);
}
