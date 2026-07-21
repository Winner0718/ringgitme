import { getCustomInstitution, listCustomInstitutions } from './customInstitutionDirectory.js';

const BASE = typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL ? import.meta.env.BASE_URL : '/';
const VERIFIED_AT = '2026-07-19';

export function assetURL(path, base = BASE) {
  if (!path) return '';
  if (/^(?:data:|blob:|https?:)/.test(path)) return path;
  const cleanBase = `/${String(base || '/').replace(/^\/+|\/+$/g, '')}`.replace('//', '/');
  const prefix = cleanBase === '/' ? '/' : `${cleanBase}/`;
  return `${prefix}${String(path).replace(/^\/+/, '')}`;
}

const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
};
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

function logo(primary, originalAssetUrl = null, official = true, { shape = 'square', safePadding = '8%', sourcePack = null, presentation = 'symbol_contained' } = {}) {
  return { primary, compact: primary, monochrome: null, darkMode: null, originalAssetUrl, official, shape, safePadding, sourcePack, presentation };
}

function reviewedLogo(group, id, shape = 'square') {
  const root = group === 'networks' ? 'assets/networks/user-reviewed' : `assets/brands/user-reviewed/${group}`;
  const appIcons = new Set(['tng', 'grabpay', 'boost', 'shopeepay', 'setel', 'bigpay', 'gxbank', 'aeon-bank', 'boost-bank']);
  const presentation = appIcons.has(id) ? 'icon_full_bleed' : shape === 'wide' ? 'wordmark_contained' : 'symbol_contained';
  return logo(`${root}/${id}.png`, null, true, { shape, safePadding: '8%', sourcePack: 'phase2d1b2-user-reviewed', presentation });
}

function record({ id, entityType, legalName, displayName, shortName = displayName, aliases = [], website, logoData = null, sourceUrl = website, sourceTitle, sourceType = 'official-website', status = 'active', fallback = '#64748b', notes = '' }) {
  return {
    id, entityType, legalName, displayName, shortName, aliases, country: entityType === 'card_network' ? null : 'MY', market: entityType === 'card_network' ? 'Global' : 'Malaysia',
    officialWebsite: website, status, logo: logoData || logo(null, null, false), fallback,
    provenance: { sourceUrl, sourceTitle, verifiedAt: VERIFIED_AT, sourceType, notes },
  };
}

// Every rendered mark is local. A null logo is an explicit app-created neutral
// fallback, never an unofficial reconstruction presented as an official mark.
const RECORDS = freeze([
  record({ id: 'maybank', entityType: 'bank', legalName: 'Malayan Banking Berhad', displayName: 'Maybank', aliases: ['MBB', 'Malayan Banking'], website: 'https://www.maybank2u.com.my/', logoData: reviewedLogo('banks', 'maybank'), sourceTitle: 'Maybank Malaysia', fallback: '#ffc400' }),
  record({ id: 'cimb', entityType: 'bank', legalName: 'CIMB Bank Berhad', displayName: 'CIMB', aliases: ['CIMB Bank'], website: 'https://www.cimb.com.my/', logoData: reviewedLogo('banks', 'cimb'), sourceTitle: 'CIMB Malaysia', fallback: '#c8102e' }),
  record({ id: 'publicbank', entityType: 'bank', legalName: 'Public Bank Berhad', displayName: 'Public Bank', aliases: ['PBB', 'PB'], website: 'https://www.pbebank.com/', logoData: reviewedLogo('banks', 'publicbank'), sourceTitle: 'Public Bank Malaysia', fallback: '#d10f1c' }),
  record({ id: 'rhb', entityType: 'bank', legalName: 'RHB Bank Berhad', displayName: 'RHB', aliases: ['RHB Bank'], website: 'https://www.rhbgroup.com/', logoData: reviewedLogo('banks', 'rhb'), sourceTitle: 'RHB Malaysia', fallback: '#005baa' }),
  record({ id: 'hong-leong-bank', entityType: 'bank', legalName: 'Hong Leong Bank Berhad', displayName: 'Hong Leong Bank', shortName: 'HLB', aliases: ['HLB', 'Hong Leong'], website: 'https://www.hlb.com.my/', logoData: reviewedLogo('banks', 'hong-leong-bank'), sourceTitle: 'Hong Leong Bank Malaysia', fallback: '#004b8d' }),
  record({ id: 'ambank', entityType: 'bank', legalName: 'AmBank (M) Berhad', displayName: 'AmBank', aliases: ['Am Bank'], website: 'https://www.ambank.com.my/', logoData: reviewedLogo('banks', 'ambank', 'compact'), sourceTitle: 'AmBank Malaysia', fallback: '#e31b23' }),
  record({ id: 'alliance-bank', entityType: 'bank', legalName: 'Alliance Bank Malaysia Berhad', displayName: 'Alliance Bank', aliases: ['Alliance'], website: 'https://www.alliancebank.com.my/', logoData: reviewedLogo('banks', 'alliance-bank'), sourceTitle: 'Alliance Bank Malaysia', fallback: '#ed1c24' }),
  record({ id: 'uob', entityType: 'bank', legalName: 'United Overseas Bank (Malaysia) Bhd', displayName: 'UOB Malaysia', shortName: 'UOB', aliases: ['UOB', 'United Overseas Bank'], website: 'https://www.uob.com.my/', logoData: reviewedLogo('banks', 'uob'), sourceUrl: 'https://www.uob.com.my/about/story/our-logo.page', sourceTitle: 'Our Logo — UOB Malaysia', fallback: '#005eb8' }),
  record({ id: 'ocbc', entityType: 'bank', legalName: 'OCBC Bank (Malaysia) Berhad', displayName: 'OCBC Malaysia', shortName: 'OCBC', aliases: ['OCBC', 'Oversea-Chinese Banking Corporation'], website: 'https://www.ocbc.com.my/', logoData: reviewedLogo('banks', 'ocbc'), sourceTitle: 'OCBC Malaysia', fallback: '#e2231a' }),
  record({ id: 'hsbc', entityType: 'bank', legalName: 'HSBC Bank Malaysia Berhad', displayName: 'HSBC Malaysia', shortName: 'HSBC', aliases: ['HSBC'], website: 'https://www.hsbc.com.my/', logoData: reviewedLogo('banks', 'hsbc', 'wide'), sourceTitle: 'HSBC Malaysia', fallback: '#db0011' }),
  record({ id: 'standard-chartered', entityType: 'bank', legalName: 'Standard Chartered Bank Malaysia Berhad', displayName: 'Standard Chartered Malaysia', shortName: 'Standard Chartered', aliases: ['SCB', 'Standard Chartered'], website: 'https://www.sc.com/my/', logoData: reviewedLogo('banks', 'standard-chartered'), sourceTitle: 'Standard Chartered Malaysia', fallback: '#0072aa' }),
  record({ id: 'bank-islam', entityType: 'bank', legalName: 'Bank Islam Malaysia Berhad', displayName: 'Bank Islam', aliases: ['BIMB'], website: 'https://www.bankislam.com/', logoData: reviewedLogo('banks', 'bank-islam'), sourceTitle: 'Bank Islam Malaysia', fallback: '#62269e' }),
  record({ id: 'bank-rakyat', entityType: 'bank', legalName: 'Bank Kerjasama Rakyat Malaysia Berhad', displayName: 'Bank Rakyat', aliases: ['BKR'], website: 'https://www.bankrakyat.com.my/', logoData: reviewedLogo('banks', 'bank-rakyat'), sourceTitle: 'Bank Rakyat', fallback: '#005596' }),
  record({ id: 'bsn', entityType: 'bank', legalName: 'Bank Simpanan Nasional', displayName: 'BSN', aliases: ['Bank Simpanan Nasional'], website: 'https://www.bsn.com.my/', logoData: reviewedLogo('banks', 'bsn', 'wide'), sourceTitle: 'BSN Malaysia', fallback: '#0056a6' }),
  record({ id: 'gxbank', entityType: 'digital_bank', legalName: 'GX Bank Berhad', displayName: 'GXBank', aliases: ['GX Bank'], website: 'https://gxbank.my/', logoData: reviewedLogo('banks', 'gxbank'), sourceTitle: 'GXBank Malaysia', fallback: '#141118' }),
  record({ id: 'aeon-bank', entityType: 'digital_bank', legalName: 'AEON Bank (M) Berhad', displayName: 'AEON Bank', aliases: ['AEONBank'], website: 'https://www.aeonbank.com.my/', logoData: reviewedLogo('banks', 'aeon-bank'), sourceTitle: 'AEON Bank Malaysia', fallback: '#8c1d82' }),
  record({ id: 'boost-bank', entityType: 'digital_bank', legalName: 'Boost Bank Berhad', displayName: 'Boost Bank', aliases: ['BoostBank'], website: 'https://myboostbank.co/', logoData: reviewedLogo('banks', 'boost-bank'), sourceTitle: 'Boost Bank Malaysia', fallback: '#ed1c24' }),
  record({ id: 'affin-bank', entityType: 'bank', legalName: 'Affin Bank Berhad', displayName: 'Affin Bank', aliases: ['AFFIN'], website: null, logoData: reviewedLogo('banks', 'affin-bank'), sourceUrl: null, sourceTitle: 'User-reviewed Phase 2D1B.2 source pack', sourceType: 'user-reviewed-source-pack', fallback: '#174a8b' }),
  record({ id: 'agrobank', entityType: 'bank', legalName: 'Bank Pertanian Malaysia Berhad', displayName: 'Agrobank', aliases: ['Agro Bank'], website: null, logoData: reviewedLogo('banks', 'agrobank'), sourceUrl: null, sourceTitle: 'User-reviewed Phase 2D1B.2 source pack', sourceType: 'user-reviewed-source-pack', fallback: '#24744a' }),
  record({ id: 'bank-muamalat', entityType: 'bank', legalName: 'Bank Muamalat Malaysia Berhad', displayName: 'Bank Muamalat', aliases: ['Muamalat'], website: null, logoData: reviewedLogo('banks', 'bank-muamalat'), sourceUrl: null, sourceTitle: 'User-reviewed Phase 2D1B.2 source pack', sourceType: 'user-reviewed-source-pack', fallback: '#7c2c86' }),
  record({ id: 'mbsb-bank', entityType: 'bank', legalName: 'MBSB Bank Berhad', displayName: 'MBSB Bank', aliases: ['MBSB'], website: null, logoData: reviewedLogo('banks', 'mbsb-bank'), sourceUrl: null, sourceTitle: 'User-reviewed Phase 2D1B.2 source pack', sourceType: 'user-reviewed-source-pack', fallback: '#185d77' }),
  record({ id: 'ryt-bank', entityType: 'digital_bank', legalName: 'Ryt Bank', displayName: 'Ryt Bank', aliases: ['Ryt'], website: null, logoData: reviewedLogo('banks', 'ryt-bank'), sourceUrl: null, sourceTitle: 'User-reviewed Phase 2D1B.2 source pack', sourceType: 'user-reviewed-source-pack', fallback: '#252d3a' }),

  record({ id: 'tng', entityType: 'ewallet', legalName: 'TNG Digital Sdn. Bhd.', displayName: "Touch 'n Go eWallet", shortName: 'TNG eWallet', aliases: ['TNG', 'TNG Digital', 'Touch n Go', "Touch 'n Go"], website: 'https://www.touchngo.com.my/', logoData: reviewedLogo('ewallets', 'tng'), sourceUrl: 'https://www.touchngo.com.my/ewallet/about-us/media-kit', sourceTitle: "Touch 'n Go eWallet Media Kit", fallback: '#1261a0' }),
  record({ id: 'grabpay', entityType: 'ewallet', legalName: 'GrabPay Malaysia', displayName: 'GrabPay', aliases: ['Grab', 'Grab Wallet'], website: 'https://www.grab.com/my/pay/', logoData: reviewedLogo('ewallets', 'grabpay'), sourceTitle: 'GrabPay Malaysia', fallback: '#00b14f' }),
  record({ id: 'boost', entityType: 'ewallet', legalName: 'Axiata Digital Ecode Sdn. Bhd.', displayName: 'Boost eWallet', shortName: 'Boost', aliases: ['Boost'], website: 'https://myboost.co/', logoData: reviewedLogo('ewallets', 'boost'), sourceTitle: 'Boost Malaysia', fallback: '#ed1c24' }),
  record({ id: 'shopeepay', entityType: 'ewallet', legalName: 'Shopee Mobile Malaysia Sdn. Bhd.', displayName: 'ShopeePay', aliases: ['Shopee Pay'], website: 'https://shopeepay.com.my/', logoData: reviewedLogo('ewallets', 'shopeepay'), sourceTitle: 'ShopeePay Malaysia', fallback: '#ee4d2d' }),
  record({ id: 'setel', entityType: 'ewallet', legalName: 'Setel Ventures Sdn. Bhd.', displayName: 'Setel', aliases: [], website: 'https://www.setel.com/', logoData: reviewedLogo('ewallets', 'setel'), sourceTitle: 'Setel Malaysia', fallback: '#11a2a0' }),
  record({ id: 'bigpay', entityType: 'ewallet', legalName: 'BigPay Malaysia Sdn. Bhd.', displayName: 'BigPay', aliases: ['Big Pay'], website: 'https://bigpayme.com/', logoData: reviewedLogo('ewallets', 'bigpay'), sourceTitle: 'BigPay Malaysia', fallback: '#00a7b5' }),
  record({ id: 'mae', entityType: 'ewallet', legalName: 'Malayan Banking Berhad', displayName: 'MAE', aliases: ['MAE by Maybank2u', 'MAE Wallet'], website: 'https://www.maybank2u.com.my/maybank2u/malaysia/en/personal/services/digital_banking/MAE.page', sourceTitle: 'MAE — Maybank Malaysia', sourceType: 'official-product-page', fallback: '#ffc400', notes: 'Official product identity verified; local neutral fallback used because the official logo endpoint was not reproducibly downloadable during this phase.' }),

  record({ id: 'visa', entityType: 'card_network', legalName: 'Visa Inc.', displayName: 'Visa', aliases: ['VISA'], website: 'https://www.visa.com.my/', logoData: reviewedLogo('networks', 'visa'), sourceTitle: 'Visa Malaysia', fallback: '#1434cb' }),
  record({ id: 'mastercard', entityType: 'card_network', legalName: 'Mastercard International Incorporated', displayName: 'Mastercard', aliases: ['MasterCard', 'Master Card'], website: 'https://www.mastercard.com/', logoData: reviewedLogo('networks', 'mastercard'), sourceUrl: 'https://www.mastercard.com/news/press/media-resources/', sourceTitle: 'Mastercard Media Resources', fallback: '#eb001b' }),
  record({ id: 'amex', entityType: 'card_network', legalName: 'American Express Company', displayName: 'American Express', shortName: 'Amex', aliases: ['AMEX', 'American Express®'], website: 'https://www.americanexpress.com/', logoData: reviewedLogo('networks', 'amex'), sourceUrl: 'https://www.americanexpress.com/content/dam/amex/common/merchant/pdf/Trademarks.pdf', sourceTitle: 'American Express Trademarks', sourceType: 'official-brand-resource', fallback: '#006fcf' }),
  record({ id: 'unionpay', entityType: 'card_network', legalName: 'UnionPay International Co., Ltd.', displayName: 'UnionPay', aliases: ['Union Pay', '银联'], website: 'https://www.unionpayintl.com/my/', logoData: logo('assets/networks/official/unionpay.png', 'https://www.unionpayintl.com/imp_file/MYS/my/static/images/logo.png'), sourceTitle: 'UnionPay International Malaysia', fallback: '#007b84' }),
  record({ id: 'jcb', entityType: 'card_network', legalName: 'JCB Co., Ltd.', displayName: 'JCB', aliases: [], website: 'https://www.global.jcb/en/', logoData: logo('assets/networks/official/jcb.svg', 'https://www.global.jcb/en/common/images/svg/jcb_emblem.svg'), sourceTitle: 'JCB Global', fallback: '#0b57a3' }),

  record({ id: 'custom-bank', entityType: 'bank', legalName: 'Custom institution', displayName: '其他银行 / 自定义', shortName: '自定义银行', website: null, sourceUrl: null, sourceTitle: 'RinggitMe neutral fallback', sourceType: 'app-neutral-fallback', status: 'unknown', notes: 'User-entered institution; never presented as verified.' }),
  record({ id: 'custom-ewallet', entityType: 'ewallet', legalName: 'Custom eWallet', displayName: '其他 eWallet / 自定义', shortName: '自定义 eWallet', website: null, sourceUrl: null, sourceTitle: 'RinggitMe neutral fallback', sourceType: 'app-neutral-fallback', status: 'unknown', notes: 'User-entered provider; never presented as verified.' }),
  record({ id: 'custom-network', entityType: 'card_network', legalName: 'Custom card network', displayName: '其他卡组织 / 自定义', shortName: '其他', website: null, sourceUrl: null, sourceTitle: 'RinggitMe neutral fallback', sourceType: 'app-neutral-fallback', status: 'unknown', notes: 'User-entered network; never presented as verified.' }),
]);

const BY_ID = new Map(RECORDS.map((item) => [item.id, item]));
const LEGACY_ID = freeze({ 'public-bank': 'publicbank', 'touch-n-go': 'tng', 'touch-n-go-ewallet': 'tng', 'american-express': 'amex', amex: 'amex' });
const normalize = (value) => String(value || '').normalize('NFKD').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const aliasEntries = RECORDS.flatMap((item) => [item.id, item.displayName, item.shortName, item.legalName, ...item.aliases].filter(Boolean).map((alias) => [normalize(alias), item.id])).sort((a, b) => b[0].length - a[0].length);
const aliasMatches = (text, alias) => text === alias || (alias.length >= 4 && ` ${text} `.includes(` ${alias} `));

export function getBrand(id) {
  const key = LEGACY_ID[id] || id;
  const custom = getCustomInstitution(key);
  if (custom) {
    const result = clone(custom);
    result.name = result.displayName;
    result.type = result.entityType;
    result.fallback = result.palette?.primary || '#64748b';
    result.logo = {
      primary: result.customLogo?.dataUrl || null,
      compact: result.customLogo?.dataUrl || null,
      official: false,
      shape: result.customLogo?.width > result.customLogo?.height * 1.65 ? 'wide' : 'square',
      presentation: result.resolvedLogoPresentation,
    };
    result.logoURL = result.logo.primary || '';
    return result;
  }
  const item = BY_ID.get(key);
  if (!item) return null;
  const result = clone(item);
  result.name = result.displayName;
  result.type = result.entityType;
  result.logoURL = assetURL(result.logo.primary);
  return result;
}

export function brandRegistry({ entityTypes = null, includeFallbacks = true } = {}) {
  const allowed = entityTypes ? new Set(Array.isArray(entityTypes) ? entityTypes : [entityTypes]) : null;
  const builtIn = RECORDS.filter((item) => (!allowed || allowed.has(item.entityType)) && (includeFallbacks || item.provenance.sourceType !== 'app-neutral-fallback')).map((item) => getBrand(item.id));
  return [...builtIn, ...listCustomInstitutions({ entityTypes }).map((item) => getBrand(item.id))];
}

export function resolveBrandId(value, { entityTypes = null } = {}) {
  const direct = LEGACY_ID[value] || value;
  const custom = getCustomInstitution(direct);
  if (custom && (!entityTypes || (Array.isArray(entityTypes) ? entityTypes : [entityTypes]).includes(custom.entityType))) return direct;
  if (BY_ID.has(direct) && (!entityTypes || (Array.isArray(entityTypes) ? entityTypes : [entityTypes]).includes(BY_ID.get(direct).entityType))) return direct;
  const text = normalize(value);
  if (!text) return null;
  const allowed = entityTypes ? new Set(Array.isArray(entityTypes) ? entityTypes : [entityTypes]) : null;
  return aliasEntries.find(([alias, id]) => alias && aliasMatches(text, alias) && (!allowed || allowed.has(BY_ID.get(id).entityType)))?.[1] || null;
}

export function resolveAccountBrand(account) {
  const allowed = account?.type === 'ew' ? ['ewallet'] : account?.type === 'cc' ? ['bank', 'digital_bank'] : ['bank', 'digital_bank', 'ewallet'];
  const stable = resolveBrandId(account?.brandId || account?.catalogInstitutionId, { entityTypes: allowed });
  const legacy = stable
    || resolveBrandId(account?.bank || account?.institution, { entityTypes: allowed })
    || resolveBrandId(account?.name, { entityTypes: allowed })
    || resolveBrandId(`${account?.id || ''} ${account?.name || ''} ${account?.bank || account?.institution || ''}`, { entityTypes: allowed });
  return legacy ? getBrand(legacy) : null;
}

export function networkRegistry({ includeFallbacks = true, enabledOnly = false } = {}) {
  const records = brandRegistry({ entityTypes: 'card_network', includeFallbacks });
  return enabledOnly ? records.filter((item) => ['visa', 'mastercard', 'amex'].includes(item.id)) : records;
}

export function validateBrandRegistry({ assetExists = () => true } = {}) {
  const errors = [];
  const seen = new Set();
  for (const item of RECORDS) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id)) errors.push(`invalid-id:${item.id}`);
    if (seen.has(item.id)) errors.push(`duplicate-id:${item.id}`);
    seen.add(item.id);
    if (!['bank', 'digital_bank', 'ewallet', 'card_network'].includes(item.entityType)) errors.push(`invalid-entity:${item.id}`);
    if (!['active', 'legacy', 'discontinued', 'unknown'].includes(item.status)) errors.push(`invalid-status:${item.id}`);
    if (item.logo.primary && (/^(?:https?:|data:)/.test(item.logo.primary) || !assetExists(item.logo.primary))) errors.push(`missing-or-remote-logo:${item.id}`);
    if (!['app-neutral-fallback', 'user-reviewed-source-pack'].includes(item.provenance.sourceType) && !/^https:\/\//.test(item.provenance.sourceUrl || '')) errors.push(`missing-provenance:${item.id}`);
    if (item.status === 'active' && !/^\d{4}-\d{2}-\d{2}$/.test(item.provenance.verifiedAt || '')) errors.push(`missing-verification-date:${item.id}`);
    if (item.provenance.sourceType !== 'app-neutral-fallback' && !item.provenance.sourceTitle) errors.push(`missing-source-title:${item.id}`);
  }
  return { valid: errors.length === 0, errors, totals: { brands: RECORDS.filter((item) => item.entityType !== 'card_network').length, networks: RECORDS.filter((item) => item.entityType === 'card_network').length, localOfficialAssets: RECORDS.filter((item) => item.logo.primary && item.logo.official).length, neutralFallbacks: RECORDS.filter((item) => !item.logo.primary).length } };
}

export const brandRegistryTestHooks = freeze({ normalize, aliasEntries: clone(aliasEntries), records: clone(RECORDS) });
