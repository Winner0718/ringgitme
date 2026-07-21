import { brandRegistryTestHooks } from './brandRegistry.js';
import { productCatalogueTestHooks } from './productCatalogue.js';

export const ASSET_VISUAL_SLOT_TYPES = Object.freeze([
  'brand_compact_mark',
  'brand_wordmark',
  'brand_app_icon',
  'network_mark',
  'bank_account_visual',
  'credit_card_face',
  'ewallet_card_visual',
]);

export const ASSET_VISUAL_STATUSES = Object.freeze([
  'approved',
  'pending_review',
  'missing',
  'neutral_system_fallback',
  'legacy_pending_review',
]);

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
};

function mediaType(filePath) {
  if (!filePath) return null;
  if (/\.svg$/i.test(filePath)) return 'image/svg+xml';
  if (/\.webp$/i.test(filePath)) return 'image/webp';
  if (/\.jpe?g$/i.test(filePath)) return 'image/jpeg';
  return 'image/png';
}

function brandSlotType(entityType) {
  if (entityType === 'card_network') return 'network_mark';
  if (entityType === 'ewallet') return 'brand_app_icon';
  return 'brand_compact_mark';
}

const BRAND_VISUALS = brandRegistryTestHooks.records
  .filter((brand) => brand.logo?.primary)
  .map((brand) => ({
    assetId: `${brand.logo.sourcePack === 'phase2d1b2-user-reviewed' ? 'reviewed' : 'pending'}-${brandSlotType(brand.entityType)}-${brand.id}`,
    brandId: brand.id,
    productId: null,
    networkId: brand.entityType === 'card_network' ? brand.id : null,
    physicalVariantId: null,
    slotType: brandSlotType(brand.entityType),
    filePath: brand.logo.primary,
    lightFilePath: brand.logo.primary,
    darkFilePath: null,
    mediaType: mediaType(brand.logo.primary),
    aspectRatio: brand.logo.shape || 'source',
    fitMode: 'contain',
    safePadding: brand.logo.safePadding || '12%',
    backgroundTreatment: 'neutral-brand-tile',
    status: brand.logo.sourcePack === 'phase2d1b2-user-reviewed' ? 'approved' : 'pending_review',
    provenanceStatus: brand.logo.sourcePack === 'phase2d1b2-user-reviewed' ? 'user_reviewed_phase2d1b2_source_pack' : 'official_source_pending_user_review',
  }));

const PRODUCT_VISUALS = productCatalogueTestHooks.records
  .filter((product) => product.visual?.assetPath)
  .map((product) => ({
    assetId: product.visual.visualAssetId,
    brandId: product.brandId,
    productId: product.id,
    networkId: product.defaultNetworkId || (product.networkIds.length === 1 ? product.networkIds[0] : null),
    physicalVariantId: null,
    slotType: 'credit_card_face',
    filePath: product.visual.assetPath,
    lightFilePath: product.visual.assetPath,
    darkFilePath: product.visual.assetPath,
    mediaType: mediaType(product.visual.assetPath),
    aspectRatio: '1.586/1',
    fitMode: 'contain',
    safePadding: '0%',
    backgroundTreatment: 'authored-full-frame-card',
    status: product.visual.status || 'legacy_pending_review',
    provenanceStatus: product.visual.status === 'approved' ? 'accepted_before_phase2d1b' : 'pending_user_review',
  }));

// This existing fixture card was explicitly retained before Phase 2D1B and
// has no product-catalogue record yet. It remains exact by file identity only.
const LEGACY_ACCEPTED_VISUALS = [{
  assetId: 'card-maybank-global-access-mastercard-world',
  brandId: 'maybank',
  productId: null,
  networkId: 'mastercard',
  physicalVariantId: null,
  slotType: 'credit_card_face',
  filePath: 'assets/cards/maybank-global-access-mastercard-world.png',
  lightFilePath: 'assets/cards/maybank-global-access-mastercard-world.png',
  darkFilePath: 'assets/cards/maybank-global-access-mastercard-world.png',
  mediaType: 'image/png',
  aspectRatio: '1.586/1',
  fitMode: 'contain',
  safePadding: '0%',
  backgroundTreatment: 'authored-full-frame-card',
  status: 'approved',
  provenanceStatus: 'accepted_before_phase2d1b',
}];

const VISUALS = freeze([...BRAND_VISUALS, ...PRODUCT_VISUALS, ...LEGACY_ACCEPTED_VISUALS]);

export function assetVisualRegistry({ status = null, slotType = null } = {}) {
  return VISUALS.filter((asset) => (!status || asset.status === status) && (!slotType || asset.slotType === slotType)).map(clone);
}

export function getAssetVisual(assetId) {
  return clone(VISUALS.find((asset) => asset.assetId === assetId) || null);
}

export function neutralAssetVisual(slotType, entityType = null) {
  const iconName = slotType === 'network_mark' || entityType === 'card_network'
    ? 'creditCard'
    : slotType === 'credit_card_face'
      ? 'creditCard'
      : entityType === 'ewallet' || slotType === 'brand_app_icon' || slotType === 'ewallet_card_visual'
        ? 'wallet'
        : 'bank';
  return {
    assetId: `neutral-${slotType}-${entityType || 'entity'}`,
    brandId: null,
    productId: null,
    networkId: null,
    physicalVariantId: null,
    slotType,
    filePath: null,
    lightFilePath: null,
    darkFilePath: null,
    mediaType: null,
    aspectRatio: slotType === 'credit_card_face' ? '1.586/1' : '1/1',
    fitMode: 'contain',
    safePadding: '18%',
    backgroundTreatment: 'neutral-system-icon',
    status: 'neutral_system_fallback',
    provenanceStatus: 'ringgitme_system_fallback',
    iconName,
  };
}

export function resolveAssetVisual({ assetId = null, brandId = null, productId = null, networkId = null, physicalVariantId = null, slotType, qa = false, entityType = null } = {}) {
  if (!assetId && !brandId && !productId && !networkId && !qa) return clone(neutralAssetVisual(slotType, entityType));
  const candidates = VISUALS.filter((asset) => asset.slotType === slotType)
    .filter((asset) => !assetId || asset.assetId === assetId)
    .filter((asset) => !brandId || asset.brandId === brandId)
    .filter((asset) => !productId || asset.productId === productId)
    .filter((asset) => !networkId || !asset.networkId || asset.networkId === networkId)
    .filter((asset) => !physicalVariantId || asset.physicalVariantId === physicalVariantId);
  const exact = candidates.find((asset) => asset.status === 'approved') || (qa ? candidates[0] : null);
  return clone(exact || neutralAssetVisual(slotType, entityType));
}

export function resolveApprovedCardVisual({ assetId = null, productId = null, networkId = null, physicalVariantId = null, filePath = null } = {}) {
  if (!assetId && !productId && !filePath) return null;
  return clone(VISUALS.find((asset) => asset.slotType === 'credit_card_face'
    && asset.status === 'approved'
    && (!assetId || asset.assetId === assetId)
    && (!productId || asset.productId === productId)
    && (!networkId || !asset.networkId || asset.networkId === networkId)
    && (!physicalVariantId || asset.physicalVariantId === physicalVariantId)
    && (!filePath || asset.filePath === filePath)) || null);
}

export function validateAssetVisualRegistry({ assetExists = () => true } = {}) {
  const errors = [];
  const ids = new Set();
  VISUALS.forEach((asset) => {
    if (ids.has(asset.assetId)) errors.push(`duplicate-asset-id:${asset.assetId}`);
    ids.add(asset.assetId);
    if (!ASSET_VISUAL_SLOT_TYPES.includes(asset.slotType)) errors.push(`invalid-slot:${asset.assetId}`);
    if (!ASSET_VISUAL_STATUSES.includes(asset.status)) errors.push(`invalid-status:${asset.assetId}`);
    if (asset.fitMode !== 'contain') errors.push(`invalid-fit:${asset.assetId}`);
    if (asset.filePath && (/^(?:https?:|data:)/.test(asset.filePath) || !assetExists(asset.filePath))) errors.push(`missing-or-remote:${asset.assetId}`);
    if (asset.status === 'approved' && !['accepted_before_phase2d1b', 'user_reviewed_phase2d1b2_source_pack'].includes(asset.provenanceStatus)) errors.push(`unapproved-provenance:${asset.assetId}`);
  });
  return { valid: errors.length === 0, errors, totals: { assets: VISUALS.length, approved: VISUALS.filter((asset) => asset.status === 'approved').length, pendingReview: VISUALS.filter((asset) => asset.status === 'pending_review').length } };
}

export const assetVisualRegistryTestHooks = freeze({ records: clone(VISUALS) });
