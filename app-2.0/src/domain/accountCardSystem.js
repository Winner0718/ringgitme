import { formatBankAccountNumber, formatCardLastFour } from './assetFinancialModel.js';
import { getBrand } from './brandRegistry.js';

export const ACCOUNT_CARD_SYSTEM_VERSION = 'phase2d1b3-custom-card-companion-v2';
export const CUSTOM_CARD_PALETTE_VERSION = 'phase2d1b6a-v1';
export const SUPPORTED_CARD_NETWORK_IDS = Object.freeze(['visa', 'mastercard', 'amex']);

const NETWORK_ALIASES = Object.freeze({
  visa: 'visa',
  mastercard: 'mastercard',
  'master-card': 'mastercard',
  amex: 'amex',
  'american-express': 'amex',
  americanexpress: 'amex',
});

const TYPE_LABELS = Object.freeze({ saving: '储蓄', ew: '电子钱包', cc: '信用卡' });

function clamp(value) { return Math.max(0, Math.min(255, Math.round(value))); }
function hexChannels(value) {
  const source = String(value || '').trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(source)) return [71, 85, 105];
  return [0, 2, 4].map((offset) => Number.parseInt(source.slice(offset, offset + 2), 16));
}
function hexColor(channels) { return `#${channels.map((value) => clamp(value).toString(16).padStart(2, '0')).join('')}`; }
function mix(source, target, amount) {
  const a = hexChannels(source);
  const b = hexChannels(target);
  return hexColor(a.map((value, index) => value + (b[index] - value) * amount));
}
function luminance(color) {
  const channels = hexChannels(color).map((value) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function rgbLuminance(red, green, blue) {
  return luminance(hexColor([red, green, blue]));
}

function colorDistance(a, b) {
  const first = hexChannels(a);
  const second = hexChannels(b);
  return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);
}

function saturation(red, green, blue) {
  const high = Math.max(red, green, blue);
  const low = Math.min(red, green, blue);
  return high ? (high - low) / high : 0;
}

function quantizeChannel(value) { return Math.max(0, Math.min(255, Math.round(value / 24) * 24)); }

function paletteRecord(primary, supporting, {
  source = 'neutral',
  extractionStatus = 'unavailable',
  derivedAt = null,
  version = null,
} = {}) {
  const safePrimary = validHex(primary) ? primary : '#475569';
  const bright = luminance(safePrimary) >= 0.46;
  const safeSupporting = validHex(supporting)
    ? supporting
    : mix(safePrimary, bright ? '#111827' : '#ffffff', bright ? 0.34 : 0.24);
  const text = bright ? '#111827' : '#f8fafc';
  return Object.freeze({
    primary: safePrimary,
    supporting: safeSupporting,
    highlight: mix(safePrimary, '#ffffff', bright ? 0.58 : 0.42),
    lowlight: mix(safePrimary, '#020617', bright ? 0.32 : 0.2),
    tone: bright ? 'light' : 'dark',
    text,
    muted: bright ? 'rgba(17,24,39,.68)' : 'rgba(248,250,252,.72)',
    source,
    extractionStatus,
    derivedAt,
    version,
  });
}

// Pure, deterministic reducer used by both the browser canvas adapter and
// Node tests. It deliberately weights broad colour coverage over a tiny Logo,
// network mark or specular highlight.
export function deriveCustomCardPaletteFromPixels({ pixels, width, height } = {}) {
  const values = pixels instanceof Uint8ClampedArray || pixels instanceof Uint8Array ? pixels : null;
  if (!values || !Number.isFinite(width) || !Number.isFinite(height) || values.length < width * height * 4) {
    return paletteRecord('#475569', '#334155', { source: 'custom-card-derived', extractionStatus: 'invalid-pixels', version: CUSTOM_CARD_PALETTE_VERSION });
  }
  const buckets = new Map();
  let totalWeight = 0;
  for (let offset = 0; offset < width * height * 4; offset += 4) {
    const alpha = values[offset + 3] / 255;
    if (alpha < 0.22) continue;
    const red = values[offset]; const green = values[offset + 1]; const blue = values[offset + 2];
    const lightness = rgbLuminance(red, green, blue);
    const chroma = saturation(red, green, blue);
    // Transparent/card-padding whites and tiny chrome reflections should not
    // turn a dark authored card into a white companion surface.
    if (lightness > 0.93 && chroma < 0.16) continue;
    const key = hexColor([quantizeChannel(red), quantizeChannel(green), quantizeChannel(blue)]);
    const weight = alpha * (1 + (1 - lightness) * 0.18 + chroma * 0.12);
    const current = buckets.get(key) || { color: key, weight: 0 };
    current.weight += weight;
    buckets.set(key, current);
    totalWeight += weight;
  }
  if (!buckets.size || totalWeight <= 0) {
    return paletteRecord('#475569', '#334155', { source: 'custom-card-derived', extractionStatus: 'no-usable-pixels', version: CUSTOM_CARD_PALETTE_VERSION });
  }
  const candidates = [...buckets.values()].sort((left, right) => right.weight - left.weight);
  const primary = candidates[0].color;
  const secondaryCandidate = candidates.find((candidate, index) => index > 0
    && candidate.weight / totalWeight >= 0.055
    && colorDistance(primary, candidate.color) >= 46);
  const supporting = secondaryCandidate?.color || mix(primary, luminance(primary) >= 0.46 ? '#111827' : '#ffffff', luminance(primary) >= 0.46 ? 0.31 : 0.22);
  return paletteRecord(primary, supporting, {
    source: 'custom-card-derived',
    extractionStatus: 'derived',
    derivedAt: null,
    version: CUSTOM_CARD_PALETTE_VERSION,
  });
}

// Browser-only adapter: uploaded PNG/JPEG/WebP data stays local, is sampled
// at a tiny bounded size and never leaves the app. Callers store its result on
// `customCardImage.derivedPalette` so render paths remain synchronous.
export async function deriveCustomCardPalette(imageSource) {
  const source = typeof imageSource === 'string' ? imageSource : imageSource?.dataUrl;
  if (!source || typeof document === 'undefined' || typeof Image === 'undefined') {
    return paletteRecord('#475569', '#334155', { source: 'custom-card-derived', extractionStatus: 'unavailable', version: CUSTOM_CARD_PALETTE_VERSION });
  }
  const image = new Image();
  image.src = source;
  try {
    if (image.decode) await image.decode();
    else await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 40;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('canvas-unavailable');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = deriveCustomCardPaletteFromPixels({ pixels: imageData.data, width: imageData.width, height: imageData.height });
    return Object.freeze({ ...result, derivedAt: new Date().toISOString(), version: CUSTOM_CARD_PALETTE_VERSION });
  } catch {
    return paletteRecord('#475569', '#334155', { source: 'custom-card-derived', extractionStatus: 'decode-failed', version: CUSTOM_CARD_PALETTE_VERSION });
  }
}

export function normalizeCardNetworkId(value) {
  const compact = String(value || '').trim().toLowerCase().replace(/\s+/g, '-');
  const normalized = NETWORK_ALIASES[compact] || null;
  return SUPPORTED_CARD_NETWORK_IDS.includes(normalized) ? normalized : null;
}

export function cardNetworkLabel(value) {
  return { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express' }[normalizeCardNetworkId(value)] || '未指定';
}

export function cardNetworkTypography(value) {
  const id = normalizeCardNetworkId(value);
  if (id === 'visa') return Object.freeze({ id, label: 'VISA', lines: ['VISA'] });
  if (id === 'mastercard') return Object.freeze({ id, label: 'Mastercard', lines: ['Mastercard'] });
  if (id === 'amex') return Object.freeze({ id, label: 'AMERICAN EXPRESS', lines: ['AMERICAN', 'EXPRESS'] });
  return null;
}

export function accountTypeLabel(type) { return TYPE_LABELS[type] || '账户'; }

export function creditCardTierLabel(account = {}) {
  const tier = String(account.tier || '').trim();
  if (!tier) return '';
  return tier === 'Other' ? String(account.customTierLabel || '').trim().slice(0, 32) : tier;
}

function validHex(value) { return /^#[0-9a-f]{6}$/i.test(String(value || '')); }

// Priority: manual account override → current custom-card companion palette
// → saved custom-institution palette → locally derived Logo palette → system
// institution palette → neutral. No runtime network lookup participates in
// visual rendering.
export function resolveInstitutionCardPalette(input) {
  const account = typeof input === 'object' && input ? input : { brandId: input };
  const brandId = account.brandId || account.catalogInstitutionId || null;
  const brand = getBrand(brandId);
  const explicitOverride = account.accountVisualOverride?.enabled === true;
  const candidateAccountPalette = explicitOverride
    ? account.accountVisualOverride?.palette || account.cardPalette || account.customPalette || null
    : account.cardPalette || account.customPalette || null;
  const accountPalette = candidateAccountPalette?.source === 'logo-derived' ? null : candidateAccountPalette;
  const customCardPalette = account.customCardImage?.derivedPalette?.extractionStatus === 'derived'
    ? account.customCardImage.derivedPalette
    : null;
  const savedPalette = brand?.palette || null;
  const derivedPalette = account.customLogo?.derivedPalette || brand?.customLogo?.derivedPalette || null;
  const selected = accountPalette || customCardPalette || savedPalette || derivedPalette || {};
  const source = accountPalette
    ? 'account-override'
    : customCardPalette
      ? 'custom-card-derived'
      : savedPalette
        ? (brand?.provenance?.sourceType === 'user-custom' ? 'custom-institution' : 'system-institution')
        : derivedPalette
          ? 'logo-derived'
          : brand?.fallback
            ? 'system-institution'
            : 'neutral';
  const generated = paletteRecord(
    validHex(selected.primary) ? selected.primary : validHex(brand?.fallback) ? brand.fallback : '#475569',
    selected.supporting,
    {
      source,
      extractionStatus: customCardPalette?.extractionStatus || (source === 'custom-card-derived' ? 'derived' : 'not-required'),
      derivedAt: customCardPalette?.derivedAt || null,
      version: customCardPalette?.version || null,
    },
  );
  return Object.freeze({
    brandId: brand?.id || brandId || null,
    ...generated,
  });
}

// The account is the single owner of its visual identity.  Full cards,
// compact rows, editor previews and management thumbnails must consume this
// result instead of independently reaching for the legacy `brandColor`.
// Existing `cardPalette` is treated as a backwards-compatible account-level
// override; new callers may make that intent explicit with
// `accountVisualOverride`.
export function resolveAccountAppearance(input) {
  const account = typeof input === 'object' && input ? input : { brandId: input };
  const brandId = account.brandId || account.catalogInstitutionId || null;
  const brand = getBrand(brandId);
  const explicitOverride = account.accountVisualOverride?.enabled === true;
  const legacyOverride = Boolean((account.cardPalette || account.customPalette) && (account.cardPalette || account.customPalette)?.source !== 'logo-derived');
  const palette = resolveInstitutionCardPalette({
    ...account,
    cardPalette: explicitOverride ? account.accountVisualOverride?.palette || account.cardPalette : account.cardPalette,
  });
  const logo = account.customLogo || brand?.customLogo || brand?.logo || null;
  const logoSrc = logo?.dataUrl || logo?.primary || logo?.compact || null;
  const logoFitMode = explicitOverride
    ? account.accountVisualOverride?.logoPresentationMode || account.logoPresentationMode || 'auto'
    : account.logoPresentationMode || brand?.logoPresentationMode || 'auto';
  return Object.freeze({
    institutionId: palette.brandId,
    visualSource: palette.source,
    logoSrc,
    logoFitMode,
    primaryColor: palette.primary,
    secondaryColor: palette.supporting,
    gradient: `linear-gradient(118deg, ${palette.primary} 0%, ${palette.supporting} 100%)`,
    foregroundColor: palette.text,
    mutedForegroundColor: palette.muted,
    customFullCardMedia: account.customCardImage || null,
    accountLevelOverride: explicitOverride || legacyOverride,
    palette,
    fullCard: Object.freeze({
      mode: account.customCardImage?.dataUrl ? 'custom-image' : 'generated',
      imageSource: account.customCardImage?.dataUrl || null,
      imageFit: 'cover',
    }),
    companionAppearance: Object.freeze({
      primaryColor: palette.primary,
      secondaryColor: palette.supporting,
      gradient: `linear-gradient(118deg, ${palette.primary} 0%, ${palette.supporting} 100%)`,
      foregroundColor: palette.text,
      mutedForegroundColor: palette.muted,
      source: palette.source,
    }),
  });
}

function canonicalInstitutionName(account, brand) {
  return String(account.customBrandName || account.institution || account.bank || brand?.displayName || '').trim();
}

function formattedMoneyMinor(valueMinor, hidden) {
  if (hidden) return 'RM ••••';
  return `RM ${new Intl.NumberFormat('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(Number(valueMinor || 0)) / 100)}`;
}

// One complete, read-only account-card contract. Every renderer receives the
// same current account identity, private identifier presentation, appearance
// precedence and live financial value instead of rebuilding partial cards.
export function resolveAccountCardViewModel({
  account,
  privacyState = false,
  context = 'default',
  liveFinancialState = null,
} = {}) {
  if (!account) return null;
  const type = account.type || 'saving';
  const appearance = resolveAccountAppearance(account);
  const brand = getBrand(account.brandId || account.catalogInstitutionId);
  const institutionName = canonicalInstitutionName(account, brand);
  const title = String(account.displayName || account.name || '账户').trim();
  const bankIdentifier = type === 'saving' ? String(account.bankAccountNumber || '') : '';
  const walletIdentifier = type === 'ew' ? String(account.walletIdentifier || '') : '';
  const lastFour = type === 'cc'
    ? String(account.creditCardLast4 || account.last4 || '').replace(/\D/g, '').slice(-4)
    : type === 'saving'
      ? String(account.debitCardLast4 || account.last4 || '').replace(/\D/g, '').slice(-4)
      : '';
  const fullIdentifier = type === 'saving' ? bankIdentifier : type === 'ew' ? walletIdentifier : lastFour;
  const maskedIdentifier = type === 'cc'
    ? formatCardLastFour(lastFour, { privacy: true })
    : formatBankAccountNumber(fullIdentifier, { privacy: true });
  const visibleIdentifier = privacyState
    ? maskedIdentifier
    : type === 'cc'
      ? formatCardLastFour(lastFour)
      : formatBankAccountNumber(fullIdentifier);
  const visibleLastFour = formatCardLastFour(lastFour, { privacy: privacyState });
  const fallbackMinor = type === 'cc'
    ? Number(account.currentOutstandingMinor ?? account.totalCardDebtMinor ?? Math.round(Number(account.totalCardDebt ?? account.outstanding ?? 0) * 100))
    : Number(account.balanceMinor ?? Math.round(Number(account.balance || 0) * 100));
  const liveAmountMinor = Number.isInteger(liveFinancialState?.amountMinor)
    ? liveFinancialState.amountMinor
    : fallbackMinor;
  const amountLabel = type === 'cc' ? '当前欠款' : '账户余额';
  const networkId = type === 'ew' ? null : normalizeCardNetworkId(account.networkId || account.network);
  const networkLabel = networkId ? cardNetworkLabel(networkId) : '';
  const tierLabel = type === 'cc' ? creditCardTierLabel(account) : '';
  const customFullCardSource = account.customCardImage?.dataUrl || '';
  const accountType = accountTypeLabel(type);
  // Compact overview rows deliberately omit account identifiers, even from
  // accessible copy. Full cards still expose the same privacy-resolved value
  // that is visible on screen.
  const compactIdentity = ['assets-compact', 'category-stack-inactive'].includes(context);
  const accessibilityLabel = [
    title,
    institutionName,
    accountType,
    compactIdentity ? '' : (visibleLastFour || visibleIdentifier),
    tierLabel,
    networkLabel,
    amountLabel,
    formattedMoneyMinor(liveAmountMinor, privacyState),
  ].filter(Boolean).join('，');
  return Object.freeze({
    accountId: account.id || '',
    accountKind: account.accountKind || (type === 'saving' ? 'bank_account' : type === 'cc' ? 'credit_card' : 'ewallet'),
    accountType: type,
    accountTypeLabel: accountType,
    title,
    institutionName,
    institutionLocalizedName: String(account.institutionLocalizedName || account.bank || '').trim(),
    logoSource: appearance.logoSrc,
    logoFit: appearance.logoFitMode,
    gradient: appearance.gradient,
    primaryColor: appearance.primaryColor,
    secondaryColor: appearance.secondaryColor,
    foregroundColor: appearance.foregroundColor,
    mutedForegroundColor: appearance.mutedForegroundColor,
    visualSource: appearance.visualSource,
    appearance,
    fullCard: appearance.fullCard,
    companionAppearance: appearance.companionAppearance,
    customFullCardSource,
    hasCustomFullCard: Boolean(customFullCardSource),
    identifierType: type === 'saving' ? 'bank-account' : type === 'cc' ? 'credit-card-last-four' : 'wallet-identifier',
    fullIdentifier,
    lastFour,
    maskedIdentifier,
    visibleIdentifier,
    visibleLastFour,
    networkId,
    networkLabel,
    tierLabel,
    amountLabel,
    liveAmountMinor,
    liveAmount: liveAmountMinor / 100,
    formattedAmount: formattedMoneyMinor(liveAmountMinor, privacyState),
    privacyVisible: !privacyState,
    context,
    accessibilityLabel,
  });
}

export const accountCardSystemTestHooks = Object.freeze({ hexChannels, mix, luminance, validHex, rgbLuminance, colorDistance, saturation, quantizeChannel, paletteRecord, NETWORK_ALIASES });
