import { assetURL, getBrand, resolveBrandId } from './brandRegistry.js';

const VERIFIED_AT = '2026-07-19';
const freeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.values(value).forEach(freeze); return Object.freeze(value); };
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const normalize = (value) => String(value || '').normalize('NFKD').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

function provenance(sourceUrl, sourceTitle, sourceType = 'official-product-page', notes = '') {
  return { sourceUrl, sourceTitle, sourceType, verifiedAt: VERIFIED_AT, notes };
}

function product({ id, assetType, brandId, displayName, shortName = displayName, aliases = [], status = 'active', networkIds = [], defaultNetworkId = null, physicalVariants = [], bundle = null, visual = null, sourceUrl, sourceTitle, sourceType, notes }) {
  return { id, assetType, brandId, displayName, shortName, aliases, status, networkIds, defaultNetworkId, physicalVariants, bundle, visual, provenance: provenance(sourceUrl, sourceTitle, sourceType, notes) };
}

const PRODUCTS = freeze([
  product({ id: 'cimb-octosavers-account-i', assetType: 'bank_account', brandId: 'cimb', displayName: 'CIMB OctoSavers Savings Account-i', shortName: 'OctoSavers Account-i', aliases: ['CIMB OctoSavers', 'OctoSavers'], status: 'legacy', networkIds: ['mastercard'], defaultNetworkId: 'mastercard', sourceUrl: 'https://www.cimb.com.my/en/personal/help-support/rates-charges/profit-rates-charges/fees-and-charges/saving-accounts-i.html', sourceTitle: 'CIMB Savings Accounts-i Fees and Charges', notes: 'CIMB states new account opening ended 2 July 2024; existing accounts remain usable.' }),
  product({ id: 'rhb-smart-account', assetType: 'bank_account', brandId: 'rhb', displayName: 'RHB Smart Account', aliases: ['RHB Smart Account/-i'], status: 'active', networkIds: ['visa'], defaultNetworkId: 'visa', sourceUrl: 'https://www.rhbgroup.com/personal/deposits/current-account/smart-account/index.html', sourceTitle: 'RHB Smart Current Account', notes: 'Conventional Smart Account record; Islamic variant is not inferred automatically.' }),
  product({ id: 'public-bank-basic-savings-account', assetType: 'bank_account', brandId: 'publicbank', displayName: 'Public Bank Basic Savings Account', shortName: 'Basic Savings Account', aliases: ['Public Bank Savings', 'PB Basic Savings'], status: 'active', sourceUrl: 'https://www.pbebank.com/en/banking/savings-account/basic-savings-account/', sourceTitle: 'Basic Savings Account — Public Bank' }),

  product({ id: 'maybank-visa-platinum', assetType: 'credit_card', brandId: 'maybank', displayName: 'Maybank Visa Platinum', aliases: ['Maybank Visa Platinum Card'], networkIds: ['visa'], defaultNetworkId: 'visa', visual: { visualAssetId: 'card-maybank-visa-platinum', assetPath: 'assets/cards/maybank-visa-platinum.png', fidelity: 'exact-accepted-card-art', status: 'approved' }, sourceUrl: 'https://www.maybank2u.com.my/maybank2u/malaysia/en/personal/cards/credit/maybank_visa_platinum.page', sourceTitle: 'Maybank Visa Platinum' }),
  product({ id: 'maybank-mastercard-platinum', assetType: 'credit_card', brandId: 'maybank', displayName: 'Maybank Mastercard Platinum', aliases: ['Maybank MasterCard Platinum'], networkIds: ['mastercard'], defaultNetworkId: 'mastercard', sourceUrl: 'https://www.maybank2u.com.my/maybank2u/malaysia/en/personal/cards/credit_cards_listing.page', sourceTitle: 'Maybank Credit Cards Listing' }),
  product({ id: 'maybank-2-platinum-cards', assetType: 'credit_card', brandId: 'maybank', displayName: 'Maybank 2 Platinum Cards', aliases: ['Maybank 2 Platinum', 'Maybank 2 Cards Platinum'], networkIds: ['amex', 'mastercard', 'visa'], defaultNetworkId: null, physicalVariants: [
    { id: 'maybank-2-platinum-amex', displayName: 'Maybank 2 Platinum American Express', networkId: 'amex', status: 'active', visualAssetId: null },
    { id: 'maybank-2-platinum-mastercard', displayName: 'Maybank 2 Platinum Mastercard', networkId: 'mastercard', status: 'active', visualAssetId: null },
    { id: 'maybank-2-platinum-visa', displayName: 'Maybank 2 Platinum Visa', networkId: 'visa', status: 'active', visualAssetId: null },
  ], bundle: { bundleId: 'maybank-2-platinum-bundle', bundleType: 'companion-card-choice', createsMultipleRecords: false, sharesFinancialLimitAutomatically: false }, sourceUrl: 'https://www.maybank2u.com.my/maybank2u/malaysia/en/personal/cards/credit/maybank_2_platinum_card.page', sourceTitle: 'Maybank 2 Platinum Cards', notes: 'Official page describes American Express plus Mastercard / Visa companion options. RinggitMe records one selected physical variant and never creates multiple records automatically.' }),
  product({ id: 'maybank-islamic-petronas-ikhwan-visa-platinum', assetType: 'credit_card', brandId: 'maybank', displayName: 'Maybank Islamic PETRONAS Ikhwan Visa Platinum Credit Card-i', shortName: 'PETRONAS Ikhwan Visa Platinum Card-i', aliases: ['Maybank Islamic Ikhwan', 'Maybank Islamic Ikhwan Visa Platinum', 'PETRONAS Ikhwan Visa Platinum'], networkIds: ['visa'], defaultNetworkId: 'visa', visual: { visualAssetId: 'card-maybank-petronas-ikhwan-visa-platinum', assetPath: 'assets/cards/maybank-islamic-petronas-ikhwan-visa-platinum.png', fidelity: 'exact-accepted-card-art', status: 'approved' }, sourceUrl: 'https://www.maybank2u.com.my/maybank2u/malaysia/en/personal/cards/credit/islamic_petronas_ikhwan_visa_platinum_card_i.page', sourceTitle: 'PETRONAS Ikhwan Visa Platinum Card-i' }),
  product({ id: 'maybank-american-express-platinum-credit-card', assetType: 'credit_card', brandId: 'maybank', displayName: 'American Express Platinum Credit Card', aliases: ['Maybank Amex Platinum', 'Maybank American Express Platinum'], networkIds: ['amex'], defaultNetworkId: 'amex', visual: { visualAssetId: 'card-maybank-amex-platinum', assetPath: 'assets/cards/maybank-amex-platinum.png', fidelity: 'exact-accepted-card-art', status: 'approved' }, sourceUrl: 'https://www.maybank2u.com.my/maybank2u/malaysia/en/personal/cards/credit/american_express_platinum_credit_card.page', sourceTitle: 'American Express Platinum Credit Card — Maybank' }),
  product({ id: 'maybank-fc-barcelona-visa-signature', assetType: 'credit_card', brandId: 'maybank', displayName: 'Maybank FC Barcelona Visa Signature', aliases: ['Maybank FC Barcelona', 'FC Barcelona Visa Signature'], networkIds: ['visa'], defaultNetworkId: 'visa', visual: { visualAssetId: 'card-maybank-fc-barcelona-visa-signature', assetPath: 'assets/cards/maybank-fc-barcelona-visa-signature.png', fidelity: 'exact-accepted-card-art', status: 'approved' }, sourceUrl: 'https://www.maybank2u.com.my/maybank2u/malaysia/en/personal/cards/credit/maybank_fc_barcelona_visa_signature.page', sourceTitle: 'Maybank FC Barcelona Visa Signature' }),
  product({ id: 'rhb-cash-back-credit-card', assetType: 'credit_card', brandId: 'rhb', displayName: 'RHB Cash Back Credit Card', aliases: ['RHB Cashback Card', 'RHB CashBack Card', 'RHB Smart Value Credit Card'], networkIds: ['visa', 'mastercard'], defaultNetworkId: null, sourceUrl: 'https://www.rhbgroup.com/personal/cards/credit-cards/rhb-cash-back-credit-card/index.html', sourceTitle: 'RHB Cash Back Credit Card', notes: 'Current official product name verified. Official card agreement covers Visa/Mastercard; the existing fixture network is preserved instead of inventing a default. No unofficial card face is manufactured.' }),

  product({ id: 'tng-ewallet', assetType: 'ewallet', brandId: 'tng', displayName: "Touch 'n Go eWallet", aliases: ['TNG eWallet', "Touch 'n Go"], sourceUrl: 'https://www.touchngo.com.my/ewallet/about-us/our-story/', sourceTitle: "Touch 'n Go eWallet — Our Story" }),
  product({ id: 'grabpay-wallet', assetType: 'ewallet', brandId: 'grabpay', displayName: 'GrabPay Wallet', aliases: ['GrabPay', 'Grab Wallet'], sourceUrl: 'https://www.grab.com/my/pay/', sourceTitle: 'GrabPay Malaysia' }),
  product({ id: 'boost-ewallet', assetType: 'ewallet', brandId: 'boost', displayName: 'Boost eWallet', aliases: ['Boost'], sourceUrl: 'https://myboost.co/', sourceTitle: 'Boost Malaysia' }),
  product({ id: 'shopeepay-wallet', assetType: 'ewallet', brandId: 'shopeepay', displayName: 'ShopeePay', aliases: ['Shopee Pay'], sourceUrl: 'https://shopeepay.com.my/', sourceTitle: 'ShopeePay Malaysia' }),
  product({ id: 'setel-wallet', assetType: 'ewallet', brandId: 'setel', displayName: 'Setel', aliases: ['Setel Wallet'], sourceUrl: 'https://www.setel.com/', sourceTitle: 'Setel Malaysia' }),
  product({ id: 'bigpay-account', assetType: 'ewallet', brandId: 'bigpay', displayName: 'BigPay', aliases: ['BigPay Account'], sourceUrl: 'https://bigpayme.com/', sourceTitle: 'BigPay Malaysia' }),
  product({ id: 'mae-wallet', assetType: 'ewallet', brandId: 'mae', displayName: 'MAE Wallet', aliases: ['MAE', 'MAE e-wallet'], sourceUrl: 'https://www.maybank2u.com.my/maybank2u/malaysia/en/personal/services/digital_banking/MAE.page', sourceTitle: 'MAE — Maybank Malaysia' }),
]);

const BY_ID = new Map(PRODUCTS.map((item) => [item.id, item]));
const ACCOUNT_TYPE = freeze({ saving: 'bank_account', cc: 'credit_card', ew: 'ewallet' });
const aliasEntries = PRODUCTS.flatMap((item) => [item.id, item.displayName, item.shortName, ...item.aliases].filter(Boolean).map((alias) => [normalize(alias), item.id])).sort((a, b) => b[0].length - a[0].length);
const aliasMatches = (text, alias) => text === alias || (alias.length >= 4 && ` ${text} `.includes(` ${alias} `));

export function getProduct(id) { return clone(BY_ID.get(id) || null); }

export function productCatalogue({ assetType = null, brandId = null, includeLegacy = true } = {}) {
  return PRODUCTS.filter((item) => (!assetType || item.assetType === assetType) && (!brandId || item.brandId === brandId) && (includeLegacy || item.status === 'active')).map(clone);
}

export function resolveProductId(value, { assetType = null, brandId = null } = {}) {
  if (BY_ID.has(value) && (!assetType || BY_ID.get(value).assetType === assetType) && (!brandId || BY_ID.get(value).brandId === brandId)) return value;
  const text = normalize(value);
  if (!text) return null;
  return aliasEntries.find(([alias, id]) => alias && aliasMatches(text, alias) && (!assetType || BY_ID.get(id).assetType === assetType) && (!brandId || BY_ID.get(id).brandId === brandId))?.[1] || null;
}

export function resolveNetworkId(value) {
  return resolveBrandId(value, { entityTypes: 'card_network' });
}

export function resolveLegacyAssetIdentity(asset) {
  const assetType = ACCOUNT_TYPE[asset?.type] || null;
  const allowedBrands = asset?.type === 'ew' ? 'ewallet' : ['bank', 'digital_bank'];
  const brandId = resolveBrandId(asset?.brandId || asset?.catalogInstitutionId, { entityTypes: allowedBrands })
    || resolveBrandId(asset?.bank || asset?.institution, { entityTypes: allowedBrands })
    || resolveBrandId(asset?.name, { entityTypes: allowedBrands })
    || resolveBrandId(`${asset?.bank || ''} ${asset?.name || ''}`, { entityTypes: allowedBrands });
  const productId = resolveProductId(asset?.productId || asset?.catalogProductId, { assetType, brandId }) || resolveProductId(asset?.name, { assetType, brandId });
  const productRecord = getProduct(productId);
  const networkId = asset?.type === 'cc' ? (resolveNetworkId(asset?.networkId || asset?.network) || productRecord?.defaultNetworkId || null) : (resolveNetworkId(asset?.networkId) || null);
  const physicalVariantId = productRecord?.physicalVariants.some((item) => item.id === asset?.physicalVariantId) ? asset.physicalVariantId : null;
  const visualAssetId = asset?.visualAssetId || asset?.artworkAssetId || productRecord?.visual?.visualAssetId || null;
  return { brandId, productId, networkId, physicalVariantId, visualAssetId, resolution: productId ? 'product' : brandId ? 'brand-only' : 'custom-unresolved' };
}

export function productNetworkOptions(productId) {
  const item = BY_ID.get(productId);
  return (item?.networkIds || []).map((networkId) => getBrand(networkId)).filter(Boolean);
}

export function productPhysicalVariants(productId) {
  return clone(BY_ID.get(productId)?.physicalVariants || []);
}

export function resolveProductPreview({ brandId, productId, networkId = null, physicalVariantId = null } = {}) {
  const brand = getBrand(brandId);
  const item = BY_ID.get(productId);
  const variant = item?.physicalVariants.find((entry) => entry.id === physicalVariantId) || null;
  const resolvedNetworkId = variant?.networkId || networkId || item?.defaultNetworkId || null;
  const network = getBrand(resolvedNetworkId);
  const exact = item?.visual?.status === 'approved' && item.visual.assetPath && (!item.networkIds.length || !resolvedNetworkId || item.networkIds.includes(resolvedNetworkId));
  return {
    kind: exact ? 'verified-product-art' : brand?.logo?.primary ? 'verified-brand-neutral-card' : 'neutral-fallback',
    verified: false,
    label: variant?.displayName || item?.displayName || brand?.displayName || '自定义产品',
    brandLabel: brand?.displayName || '自定义机构', networkLabel: network?.displayName || '',
    imagePath: exact ? item.visual.assetPath : null,
    imageURL: assetURL(exact ? item.visual.assetPath : null),
    visualAssetId: exact ? item.visual.visualAssetId : null,
    fidelity: exact ? item.visual.fidelity : 'neutral-identity-preview',
    statusLabel: exact ? '精确卡面' : item?.status === 'legacy' ? '旧产品' : productId === '__custom-product__' ? '自定义资料' : '中性预览',
    sourceUrl: item?.provenance?.sourceUrl || brand?.provenance?.sourceUrl || null,
  };
}

export function validateProductCatalogue({ assetExists = () => true } = {}) {
  const errors = [];
  const seen = new Set();
  for (const item of PRODUCTS) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id)) errors.push(`invalid-id:${item.id}`);
    if (seen.has(item.id)) errors.push(`duplicate-id:${item.id}`);
    seen.add(item.id);
    if (!getBrand(item.brandId)) errors.push(`unknown-brand:${item.id}`);
    if (!['bank_account', 'credit_card', 'ewallet'].includes(item.assetType)) errors.push(`invalid-asset-type:${item.id}`);
    if (!['active', 'legacy', 'discontinued', 'unknown'].includes(item.status)) errors.push(`invalid-status:${item.id}`);
    if (!/^https:\/\//.test(item.provenance?.sourceUrl || '')) errors.push(`missing-provenance:${item.id}`);
    if (item.status === 'active' && !/^\d{4}-\d{2}-\d{2}$/.test(item.provenance?.verifiedAt || '')) errors.push(`missing-verification-date:${item.id}`);
    if (['annualFee', 'interestRate', 'cashbackRate', 'rewardsRate', 'welcomeOffer'].some((key) => Object.hasOwn(item, key))) errors.push(`unsupported-marketing-data:${item.id}`);
    item.networkIds.forEach((id) => { if (getBrand(id)?.entityType !== 'card_network') errors.push(`unknown-network:${item.id}:${id}`); });
    item.physicalVariants.forEach((variant) => { if (!item.networkIds.includes(variant.networkId)) errors.push(`variant-network-mismatch:${item.id}:${variant.id}`); });
    if (item.visual?.assetPath && (/^(?:https?:|data:)/.test(item.visual.assetPath) || !assetExists(item.visual.assetPath))) errors.push(`missing-or-remote-visual:${item.id}`);
  }
  return { valid: errors.length === 0, errors, totals: { products: PRODUCTS.length, bankAccounts: PRODUCTS.filter((item) => item.assetType === 'bank_account').length, creditCards: PRODUCTS.filter((item) => item.assetType === 'credit_card').length, eWallets: PRODUCTS.filter((item) => item.assetType === 'ewallet').length, exactVisuals: PRODUCTS.filter((item) => item.visual?.assetPath).length, bundles: PRODUCTS.filter((item) => item.bundle).length } };
}

export const productCatalogueTestHooks = freeze({ normalize, records: clone(PRODUCTS), accountTypeMap: clone(ACCOUNT_TYPE), aliasEntries: clone(aliasEntries) });
