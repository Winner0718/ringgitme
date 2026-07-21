import { escapeHTML } from '../../app/format.js';
import { data } from '../../app/state.js';
import { assetBrandVisualHTML } from '../../components/AssetBrandVisual.js';
import { closeSheet, openSheet, toast } from '../../components/AppSheet.js';
import { openCustomCardGuide } from '../../components/CustomCardGuideSheet.js';
import { ringgitMeCardComposerHTML } from '../../components/RinggitMeCardComposer.js';
import { openPickerSheet, pickerFieldHTML } from '../../components/PickerSheet.js';
import { cardNetworkLabel, deriveCustomCardPalette, normalizeCardNetworkId, resolveAccountAppearance, SUPPORTED_CARD_NETWORK_IDS } from '../../domain/accountCardSystem.js';
import { brandRegistry, getBrand, networkRegistry } from '../../domain/brandRegistry.js';
import { archiveCustomInstitution, countCustomInstitutionUsage, createCustomInstitution, deleteCustomInstitution, getCustomInstitution, listCustomInstitutions, restoreCustomInstitution, updateCustomInstitution } from '../../domain/customInstitutionDirectory.js';
import { resolveLegacyAssetIdentity } from '../../domain/productCatalogue.js';

const CUSTOM_BRAND = { saving: 'custom-bank', cc: 'custom-bank', ew: 'custom-ewallet' };
const NO_NETWORK = '__no-network__';
const ADD_CUSTOM = '__add-custom-institution__';
const MANAGE_CUSTOM = '__manage-custom-institutions__';
const LOGO_MAX_BYTES = 5 * 1024 * 1024;
const CARD_MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED_MEDIA = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
function brandTypes(type) { return type === 'ew' ? ['ewallet'] : ['bank', 'digital_bank']; }
function brandFallbackId(type) { return CUSTOM_BRAND[type]; }
function supportedNetworkIds(type) { return type === 'ew' ? [] : [...SUPPORTED_CARD_NETWORK_IDS]; }

export function detectRasterMime(bytes) {
  const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (value.length >= 8 && value[0] === 0x89 && value[1] === 0x50 && value[2] === 0x4e && value[3] === 0x47 && value[4] === 0x0d && value[5] === 0x0a && value[6] === 0x1a && value[7] === 0x0a) return 'image/png';
  if (value.length >= 3 && value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff) return 'image/jpeg';
  if (value.length >= 12 && String.fromCharCode(...value.slice(0, 4)) === 'RIFF' && String.fromCharCode(...value.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

export function validateCustomAssetMedia({ bytes, sizeBytes = bytes?.byteLength || 0, kind = 'logo' } = {}) {
  const mimeType = detectRasterMime(bytes);
  const limit = kind === 'card' ? CARD_MAX_BYTES : LOGO_MAX_BYTES;
  if (!mimeType || !ACCEPTED_MEDIA.includes(mimeType)) throw new Error('只支持 PNG、JPEG 或 WebP 图片');
  if (!sizeBytes || sizeBytes > limit) throw new Error(kind === 'card' ? '自定义卡面不可超过 10 MB' : '自定义 Logo 不可超过 5 MB');
  return { mimeType, sizeBytes, maxBytes: limit };
}

export function createAssetIdentityDraft(account, type) {
  const resolved = resolveLegacyAssetIdentity(account || { type });
  const unresolvedExistingBrand = Boolean(account && !resolved.brandId && (account.bank || account.institution));
  const brandId = resolved.brandId || (unresolvedExistingBrand ? brandFallbackId(type) : '');
  const rawNetworkId = resolved.networkId || account?.networkId || account?.network || '';
  const normalizedNetworkId = normalizeCardNetworkId(rawNetworkId);
  return {
    type,
    brandId,
    networkId: type === 'ew' || !supportedNetworkIds(type).includes(normalizedNetworkId) ? '' : normalizedNetworkId,
    legacyNetworkId: rawNetworkId || null,
    // Retained for rollback compatibility only. It never controls current UI.
    cardThemeId: account?.cardThemeId || null,
    displayName: account?.displayName || account?.name || '',
    debitCardLast4: account?.debitCardLast4 || account?.last4 || '',
    creditCardLast4: account?.creditCardLast4 || account?.last4 || '',
    customBrandName: account?.customBrandName || (!resolved.brandId && account?.bank ? account.bank : ''),
    customLogo: clone(account?.customLogo),
    logoPresentationMode: account?.logoPresentationMode || getBrand(brandId)?.logoPresentationMode || 'auto',
    resolvedLogoPresentation: account?.resolvedLogoPresentation || getBrand(brandId)?.resolvedLogoPresentation || null,
    cardPalette: clone(account?.cardPalette),
    accountVisualOverride: clone(account?.accountVisualOverride),
    customCardImage: clone(account?.customCardImage),
    tier: account?.tier || '',
    customTierLabel: account?.customTierLabel || '',
    legacyProductId: account?.legacyProductId || account?.productId || resolved.productId || null,
    productId: account?.productId || resolved.productId || null,
    physicalVariantId: account?.physicalVariantId || resolved.physicalVariantId || null,
    visualAssetId: account?.visualAssetId || resolved.visualAssetId || null,
    legacyArt: account?.art || null,
  };
}

function applyBrandSelection(draft, value) {
  draft.brandId = value;
  if (value !== brandFallbackId(draft.type)) draft.customBrandName = '';
  const custom = getCustomInstitution(value);
  if (custom) {
    draft.customBrandName = '';
    // Accounts retain only the stable directory reference unless the user
    // explicitly adds an account-specific override later.
    draft.customLogo = null;
    draft.logoPresentationMode = 'auto';
    draft.resolvedLogoPresentation = null;
    draft.cardPalette = null;
    draft.accountVisualOverride = null;
  }
  return draft;
}

function labelForBrand(draft) {
  if (!draft.brandId) return draft.type === 'ew' ? '选择电子钱包' : '选择银行';
  if (draft.brandId === brandFallbackId(draft.type)) return draft.customBrandName || '其他／自定义';
  return getBrand(draft.brandId)?.displayName || '选择品牌';
}

function composerAccount(draft) {
  const brand = getBrand(draft.brandId);
  return {
    type: draft.type,
    brandId: draft.brandId,
    bank: draft.customBrandName || brand?.displayName || '',
    customBrandName: draft.customBrandName,
    name: draft.displayName || (draft.type === 'cc' ? '我的信用卡' : draft.type === 'ew' ? '我的电子钱包' : '我的银行账户'),
    displayName: draft.displayName,
    networkId: draft.type === 'ew' ? null : draft.networkId,
    debitCardLast4: draft.debitCardLast4,
    creditCardLast4: draft.creditCardLast4,
    customLogo: draft.customLogo,
    logoPresentationMode: draft.logoPresentationMode,
    resolvedLogoPresentation: draft.resolvedLogoPresentation,
    cardPalette: draft.cardPalette,
    accountVisualOverride: draft.accountVisualOverride,
    customCardImage: draft.customCardImage,
    tier: draft.tier,
    customTierLabel: draft.customTierLabel,
  };
}

function previewHTML(draft) {
  return `<section class="asset-card-composer-preview" data-asset-card-preview data-preview-kind="ringgitme-auto-card">${ringgitMeCardComposerHTML(composerAccount(draft), { preview: true })}</section>`;
}

function appearanceControlsHTML(draft) {
  const overridden = draft.accountVisualOverride?.enabled === true;
  const inheritedPalette = resolveAccountAppearance(composerAccount({ ...draft, accountVisualOverride: null, cardPalette: null })).palette;
  const palette = draft.accountVisualOverride?.palette || draft.cardPalette || draft.customLogo?.derivedPalette || inheritedPalette;
  const mode = draft.accountVisualOverride?.logoPresentationMode || draft.logoPresentationMode || 'auto';
  const followsCard = Boolean(draft.customCardImage?.dataUrl && !overridden);
  return `<details class="asset-account-appearance" data-asset-account-appearance ${overridden || followsCard ? 'open' : ''}>
    <summary>卡面外观 <small>${overridden ? '已自定义' : followsCard ? '自动跟随自定义卡面' : '使用机构默认'}</small></summary>
    <div class="asset-account-appearance-body">
      <label class="asset-switch-row"><span><strong>自定义这个账户</strong><small>只影响当前账户，不会改变同机构其他账户</small></span><input type="checkbox" data-asset-appearance-toggle ${overridden ? 'checked' : ''} /><i class="ringgit-switch" aria-hidden="true"><b></b></i></label>
      ${followsCard ? '<p class="asset-companion-palette-status"><strong>配套颜色</strong><small>自动跟随自定义卡面</small></p>' : ''}
      ${overridden ? `<fieldset class="custom-institution-fit"><legend>Logo 呈现</legend>${[['auto','自动'],['fill','填满'],['contain','完整显示']].map(([value,label]) => `<button type="button" class="rm-chip${mode === value ? ' is-selected' : ''}" data-asset-appearance-logo-mode="${value}">${label}</button>`).join('')}</fieldset><div class="custom-institution-palette"><label><span>卡片主色</span><input type="color" name="accountAppearancePrimary" value="${escapeHTML(palette.primary)}" /></label><label><span>辅助色</span><input type="color" name="accountAppearanceSupporting" value="${escapeHTML(palette.supporting)}" /></label></div><button type="button" class="sheet-tertiary" data-asset-appearance-reset>${draft.customCardImage?.dataUrl ? '恢复自动跟随卡面' : '恢复机构默认'}</button>` : ''}
    </div>
  </details>`;
}

function mediaControlsHTML(draft) {
  const logo = draft.customLogo;
  const card = draft.customCardImage;
  return `<section class="asset-custom-media" data-asset-custom-media>
    <div class="asset-custom-media-row"><span><strong>Logo</strong><small>${logo ? '使用自定义 Logo' : '使用系统 Logo'}</small></span><div><button type="button" class="sheet-secondary compact" data-asset-media-action="upload-logo">${logo ? '替换自定义 Logo' : '上传自定义 Logo'}</button>${logo ? '<button type="button" class="sheet-tertiary" data-asset-media-action="clear-logo">恢复系统 Logo</button>' : ''}</div></div>
    ${logo ? `<fieldset class="custom-institution-fit"><legend>自定义 Logo 呈现</legend>${[['auto','自动'],['fill','填满'],['contain','完整显示']].map(([value,label]) => `<button type="button" class="rm-chip${draft.logoPresentationMode === value ? ' is-selected' : ''}" data-asset-logo-mode="${value}">${label}</button>`).join('')}</fieldset>` : ''}
    ${appearanceControlsHTML(draft)}
    <div class="asset-custom-media-row"><span><strong>卡面</strong><small>${card ? '使用自定义卡面' : '使用系统卡面'}</small></span><div><button type="button" class="sheet-secondary compact" data-asset-media-action="upload-card">${card ? '替换自定义卡面' : '上传自定义卡面'}</button>${card ? '<button type="button" class="sheet-tertiary" data-asset-media-action="clear-card">恢复系统卡面</button>' : ''}</div></div>
    <button type="button" class="asset-custom-card-guide-link" data-asset-media-action="guide">如何制作自定义卡面</button>
    <input type="file" hidden data-asset-media-input="logo" accept="image/png,image/jpeg,image/webp" />
    <input type="file" hidden data-asset-media-input="card" accept="image/png,image/jpeg,image/webp" />
    <p class="asset-media-error" data-asset-media-error role="alert"></p>
  </section>`;
}

export function assetIdentityPrimaryFieldsHTML(draft) {
  const brandLabel = draft.type === 'ew' ? '电子钱包品牌' : draft.type === 'cc' ? '发卡机构' : '银行';
  return `<section class="asset-identity-primary" data-asset-identity-primary>
    ${pickerFieldHTML({ label: brandLabel, key: 'asset-brand', valueLabel: labelForBrand(draft) })}
    <input type="hidden" name="brandId" value="${escapeHTML(draft.brandId)}" />
    <label class="asset-form-field asset-custom-brand${draft.brandId === brandFallbackId(draft.type) ? '' : ' is-hidden'}"><span>自定义${draft.type === 'ew' ? '电子钱包' : '银行'}名称</span><input name="customBrandName" maxlength="60" value="${escapeHTML(draft.customBrandName)}" placeholder="请输入名称" /></label>
    <label class="asset-form-field"><span>名称</span><input name="name" maxlength="40" value="${escapeHTML(draft.displayName)}" placeholder="例如 日常账户" required /></label>
  </section>`;
}

export function assetIdentityMediaFieldsHTML(draft) {
  const network = draft.type === 'ew' ? '' : `${pickerFieldHTML({ label: '卡组织（可选）', key: 'asset-network', valueLabel: cardNetworkLabel(draft.networkId) })}<input type="hidden" name="networkId" value="${escapeHTML(draft.networkId)}" />`;
  return `<section class="asset-identity-media" data-asset-identity-media>${network}${previewHTML(draft)}${mediaControlsHTML(draft)}</section>`;
}

export function assetIdentityFieldsHTML(draft) {
  return `<div class="asset-identity-fields" data-asset-identity-fields>${assetIdentityPrimaryFieldsHTML(draft)}${assetIdentityMediaFieldsHTML(draft)}</div>`;
}

function optionFromBrand(brand) {
  return {
    value: brand.id,
    label: brand.displayName,
    caption: brand.provenance.sourceType === 'app-neutral-fallback' ? '其他／自定义' : brand.entityType === 'ewallet' ? '电子钱包' : brand.entityType === 'digital_bank' ? '数码银行' : '银行',
    group: brand.provenance.sourceType === 'user-custom' ? '我的自定义' : '机构',
    leadingHTML: assetBrandVisualHTML({ brandId: brand.id, slotType: brand.entityType === 'ewallet' ? 'brand_app_icon' : 'brand_compact_mark', entityType: brand.entityType, label: `${brand.displayName} Logo`, className: 'picker-asset-visual' }),
  };
}

function syncForm(form, draft) {
  const primary = form.querySelector('[data-asset-identity-primary]');
  const media = form.querySelector('[data-asset-identity-media]');
  if (primary) primary.outerHTML = assetIdentityPrimaryFieldsHTML(draft);
  if (media) media.outerHTML = assetIdentityMediaFieldsHTML(draft);
}

function refreshPreview(form, draft) {
  const preview = form.querySelector('[data-asset-card-preview]');
  if (preview) preview.outerHTML = previewHTML(draft);
}

function bytesToDataURL(bytes, mimeType) {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  return `data:${mimeType};base64,${btoa(binary)}`;
}

async function decodeMediaFile(file, kind) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const facts = validateCustomAssetMedia({ bytes, sizeBytes: file.size, kind });
  const dataUrl = bytesToDataURL(bytes, facts.mimeType);
  const image = new Image();
  image.src = dataUrl;
  if (image.decode) await image.decode();
  else await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('图片无法读取')); });
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('图片无法读取');
  const analysis = kind === 'logo' ? analyzeLogoImage(image) : { derivedPalette: await deriveCustomCardPalette(dataUrl) };
  return { dataUrl, fileName: String(file.name || (kind === 'card' ? 'custom-card' : 'custom-logo')).slice(0, 120), mimeType: facts.mimeType, sizeBytes: file.size, width: image.naturalWidth, height: image.naturalHeight, ...analysis };
}

function channelHex(value) { return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0'); }
function mixHex(color, target, amount) {
  const parse = (value) => [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  const a = parse(color); const b = parse(target);
  return `#${a.map((value, index) => channelHex(value + (b[index] - value) * amount)).join('')}`;
}

export function resolveAutomaticLogoPresentation({ width = 1, height = 1, edgeTransparency = 0, opaqueCoverage = 1 } = {}) {
  const ratio = width / Math.max(1, height);
  if (ratio >= 1.65) return 'wordmark_contained';
  if (ratio >= 0.82 && ratio <= 1.22 && edgeTransparency < 0.24 && opaqueCoverage > 0.72) return 'icon_full_bleed';
  return 'symbol_contained';
}

function analyzeLogoImage(image) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, size, size);
  const pixels = context.getImageData(0, 0, size, size).data;
  let count = 0; let opaque = 0; let edge = 0; let edgeTransparent = 0; let red = 0; let green = 0; let blue = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const pixel = index / 4; const x = pixel % size; const y = Math.floor(pixel / size); const alpha = pixels[index + 3] / 255;
    const isEdge = x < 4 || y < 4 || x >= size - 4 || y >= size - 4;
    if (isEdge) { edge += 1; if (alpha < .2) edgeTransparent += 1; }
    if (alpha < .2) continue;
    opaque += 1;
    const max = Math.max(pixels[index], pixels[index + 1], pixels[index + 2]);
    const min = Math.min(pixels[index], pixels[index + 1], pixels[index + 2]);
    if (max > 246 && min > 238) continue;
    red += pixels[index] * alpha; green += pixels[index + 1] * alpha; blue += pixels[index + 2] * alpha; count += alpha;
  }
  const primary = count ? `#${channelHex(red / count)}${channelHex(green / count)}${channelHex(blue / count)}` : '#64748b';
  const facts = { width: image.naturalWidth, height: image.naturalHeight, edgeTransparency: edge ? edgeTransparent / edge : 0, opaqueCoverage: opaque / (size * size) };
  return { ...facts, resolvedPresentation: resolveAutomaticLogoPresentation(facts), derivedPalette: { primary, supporting: mixHex(primary, '#111827', .28), source: 'logo-derived' } };
}

function resolvedPresentation(media, mode) {
  if (mode === 'fill') return 'icon_full_bleed';
  if (mode === 'contain') return media?.width > media?.height * 1.65 ? 'wordmark_contained' : 'symbol_contained';
  return media?.resolvedPresentation || resolveAutomaticLogoPresentation(media || {});
}

function customInstitutionEditorHTML(draft, usageCount = 0) {
  const logo = draft.customLogo;
  const presentation = resolvedPresentation(logo, draft.logoPresentationMode);
  const secondaryLabel = draft.entityType === 'ewallet' ? '公司／品牌名称（可不填）' : '简称（可不填）';
  return `<form class="custom-institution-editor" data-custom-institution-editor>
    <label class="asset-form-field"><span>机构名称</span><input name="displayName" maxlength="60" value="${escapeHTML(draft.displayName || '')}" placeholder="例如 我的社区银行" required /></label>
    <label class="asset-form-field"><span>${secondaryLabel}</span><input name="shortName" maxlength="40" value="${escapeHTML(draft.shortName || '')}" placeholder="可选" /></label>
    <div class="custom-institution-logo-preview" data-custom-institution-preview>${assetBrandVisualHTML({ customMedia: logo, entityType: draft.entityType, label: draft.displayName || '自定义机构 Logo', logoPresentationMode: draft.logoPresentationMode, resolvedLogoPresentation: presentation })}<span><strong>${escapeHTML(draft.displayName || '自定义机构')}</strong><small>${logo ? '本机选择的 Logo' : '中性机构图标'}</small></span></div>
    <div class="asset-custom-media-row"><span><strong>机构 Logo（可选）</strong><small>${logo?.fileName ? escapeHTML(logo.fileName) : '未选择图片'}</small></span><div><button type="button" class="sheet-secondary compact" data-custom-logo-action="upload">${logo ? '替换 Logo' : '选择 Logo'}</button>${logo ? '<button type="button" class="sheet-tertiary" data-custom-logo-action="remove">移除</button>' : ''}</div></div>
    <input type="file" hidden data-custom-logo-input accept="image/png,image/jpeg,image/webp" />
    <fieldset class="custom-institution-fit"><legend>Logo 呈现</legend>${[['auto','自动'],['fill','填满'],['contain','完整显示']].map(([value,label]) => `<button type="button" class="rm-chip${draft.logoPresentationMode === value ? ' is-selected' : ''}" data-custom-logo-mode="${value}">${label}</button>`).join('')}</fieldset>
    <div class="custom-institution-palette"><label><span>主色</span><input type="color" name="primary" value="${escapeHTML(draft.palette?.primary || logo?.derivedPalette?.primary || '#64748b')}" /></label><label><span>辅助色</span><input type="color" name="supporting" value="${escapeHTML(draft.palette?.supporting || logo?.derivedPalette?.supporting || '#334155')}" /></label></div>
    <label class="asset-form-field"><span>备注（可不填）</span><textarea name="notes" maxlength="240" placeholder="可选">${escapeHTML(draft.notes || '')}</textarea></label>
    ${usageCount ? `<p class="custom-institution-usage">已有 ${usageCount} 个账户使用此机构</p>` : ''}
    <p class="asset-media-error" data-custom-institution-error role="alert"></p>
    <footer class="custom-institution-footer"><button type="button" class="sheet-secondary" data-custom-institution-cancel>取消</button><button type="submit" class="sheet-primary">保存</button></footer>
  </form>`;
}

export function openCustomInstitutionEditor({ entityType = 'bank', institutionId = null, stacked = true, onSaved = () => {} } = {}) {
  const existing = institutionId ? getCustomInstitution(institutionId) : null;
  const draft = clone(existing) || { entityType, displayName: '', customLogo: null, logoPresentationMode: 'auto', resolvedLogoPresentation: 'symbol_contained', palette: null };
  const usageCount = existing ? countCustomInstitutionUsage(existing.id, data.getAccounts()) : 0;
  openSheet({ title: existing ? '编辑自定义机构' : entityType === 'ewallet' ? '添加自定义电子钱包' : '添加自定义银行', className: 'custom-institution-editor-sheet', stacked, contentHTML: customInstitutionEditorHTML(draft, usageCount), onOpen(sheet) {
    let form = sheet.querySelector('[data-custom-institution-editor]');
    const rerender = () => {
      form.outerHTML = customInstitutionEditorHTML(draft, usageCount);
      form = sheet.querySelector('[data-custom-institution-editor]');
      bind(form);
    };
    const bind = (activeForm) => {
      activeForm.addEventListener('click', (event) => {
        if (event.target.closest('[data-custom-institution-cancel]')) closeSheet();
        if (event.target.closest('[data-custom-logo-action="upload"]')) activeForm.querySelector('[data-custom-logo-input]')?.click();
        if (event.target.closest('[data-custom-logo-action="remove"]')) { draft.customLogo = null; draft.resolvedLogoPresentation = 'symbol_contained'; rerender(); }
        const mode = event.target.closest('[data-custom-logo-mode]')?.dataset.customLogoMode;
        if (mode) { draft.logoPresentationMode = mode; draft.resolvedLogoPresentation = resolvedPresentation(draft.customLogo, mode); rerender(); }
      });
      activeForm.addEventListener('input', (event) => {
        if (event.target.name === 'displayName') draft.displayName = event.target.value;
        if (event.target.name === 'primary' || event.target.name === 'supporting') draft.palette = { ...(draft.palette || {}), [event.target.name]: event.target.value, source: 'user' };
      });
      activeForm.addEventListener('change', async (event) => {
        if (!event.target.matches('[data-custom-logo-input]') || !event.target.files?.[0]) return;
        try {
          draft.customLogo = await decodeMediaFile(event.target.files[0], 'logo');
          draft.resolvedLogoPresentation = resolvedPresentation(draft.customLogo, draft.logoPresentationMode);
          if (!draft.palette) draft.palette = clone(draft.customLogo.derivedPalette);
          rerender();
        } catch (error) { activeForm.querySelector('[data-custom-institution-error]').textContent = error.message; }
      });
      activeForm.addEventListener('submit', (event) => {
        event.preventDefault();
        try {
          draft.displayName = activeForm.elements.displayName.value.trim();
          draft.shortName = activeForm.elements.shortName.value.trim();
          draft.notes = activeForm.elements.notes.value.trim();
          draft.palette = { primary: activeForm.elements.primary.value, supporting: activeForm.elements.supporting.value, source: draft.palette?.source || 'user' };
          draft.resolvedLogoPresentation = resolvedPresentation(draft.customLogo, draft.logoPresentationMode);
          const saved = existing ? updateCustomInstitution(existing.id, draft) : createCustomInstitution(draft);
          closeSheet(true); onSaved(saved); toast('自定义机构已保存');
        } catch (error) { activeForm.querySelector('[data-custom-institution-error]').textContent = error.message; }
      });
    };
    bind(form);
  } });
}

function customDirectoryHTML(entityType) {
  const list = listCustomInstitutions({ entityTypes: entityType, includeArchived: true });
  return `<section class="custom-institution-directory">${list.map((record) => { const usage = countCustomInstitutionUsage(record.id, data.getAccounts()); const archived = record.status === 'archived'; const action = archived
    ? `<button type="button" class="sheet-tertiary" data-custom-restore="${escapeHTML(record.id)}">恢复</button>`
    : usage ? `<button type="button" class="sheet-tertiary" data-custom-archive="${escapeHTML(record.id)}">归档</button>`
      : `<button type="button" class="sheet-tertiary danger" data-custom-delete="${escapeHTML(record.id)}">删除</button>`;
    return `<div class="custom-institution-row" data-custom-status="${archived ? 'archived' : 'active'}">${assetBrandVisualHTML({ brandId: record.id, entityType: record.entityType, label: record.displayName })}<span><strong>${escapeHTML(record.displayName)}</strong><small>${archived ? '已归档，不会显示在新增选择器' : `${usage} 个账户使用 · ${record.logoPresentationMode === 'fill' ? '填满' : record.logoPresentationMode === 'contain' ? '完整显示' : '自动'}`}</small></span><button type="button" class="sheet-tertiary" data-custom-edit="${escapeHTML(record.id)}">编辑</button>${action}</div>`; }).join('') || '<div class="asset-empty-state">尚未添加自定义机构</div>'}<button type="button" class="sheet-primary" data-custom-add>添加自定义机构</button></section>`;
}

export function openCustomInstitutionDirectory({ entityType = 'bank', stacked = true } = {}) {
  const render = () => openSheet({ title: '管理自定义机构', className: 'custom-institution-directory-sheet', stacked, contentHTML: customDirectoryHTML(entityType), onOpen(sheet) {
    sheet.addEventListener('click', (event) => {
      const editId = event.target.closest('[data-custom-edit]')?.dataset.customEdit;
      if (editId) openCustomInstitutionEditor({ institutionId: editId, entityType, stacked: true, onSaved() { closeSheet(true); render(); } });
      if (event.target.closest('[data-custom-add]')) openCustomInstitutionEditor({ entityType, stacked: true, onSaved() { closeSheet(true); render(); } });
      const archiveId = event.target.closest('[data-custom-archive]')?.dataset.customArchive;
      if (archiveId) { archiveCustomInstitution(archiveId, { accounts: data.getAccounts() }); closeSheet(true); render(); toast('自定义机构已归档'); }
      const restoreId = event.target.closest('[data-custom-restore]')?.dataset.customRestore;
      if (restoreId) { restoreCustomInstitution(restoreId); closeSheet(true); render(); toast('自定义机构已恢复'); }
      const deleteId = event.target.closest('[data-custom-delete]')?.dataset.customDelete;
      if (deleteId) { try { deleteCustomInstitution(deleteId, { accounts: data.getAccounts() }); closeSheet(true); render(); toast('自定义机构已删除'); } catch (error) { toast(error.message); } }
    });
  } });
  render();
}

export function bindAssetIdentityFields(form, draft, { onDirty = () => {} } = {}) {
  form.addEventListener('click', (event) => {
    const field = event.target.closest('[data-picker-field]')?.dataset.pickerField;
    if (field) event.preventDefault();
    if (field === 'asset-brand') {
      const records = brandRegistry({ entityTypes: brandTypes(draft.type), includeFallbacks: false });
      const builtIn = records.filter((brand) => brand.provenance.sourceType !== 'user-custom').map(optionFromBrand);
      const custom = records.filter((brand) => brand.provenance.sourceType === 'user-custom').map(optionFromBrand);
      const options = [...builtIn, ...custom];
      openPickerSheet({ title: draft.type === 'ew' ? '选择电子钱包' : '选择银行', options, footerOptions: [
        { value: ADD_CUSTOM, label: draft.type === 'ew' ? '添加自定义电子钱包' : '添加自定义银行', className: 'sheet-primary' },
        { value: MANAGE_CUSTOM, label: '管理', className: 'picker-footer-manage', priority: 'tertiary' },
      ], searchable: true, selectedValue: draft.brandId, trigger: event.target.closest('[data-picker-field]'), onSelect(value) {
        if (value === ADD_CUSTOM) {
          setTimeout(() => openCustomInstitutionEditor({ entityType: draft.type === 'ew' ? 'ewallet' : 'bank', stacked: true, onSaved(saved) { applyBrandSelection(draft, saved.id); syncForm(form, draft); onDirty(); } }), 240);
          return;
        }
        if (value === MANAGE_CUSTOM) { setTimeout(() => openCustomInstitutionDirectory({ entityType: draft.type === 'ew' ? 'ewallet' : 'bank', stacked: true }), 240); return; }
        applyBrandSelection(draft, value); syncForm(form, draft); onDirty();
      } });
    }
    if (field === 'asset-network') {
      const ids = supportedNetworkIds(draft.type);
      const networks = networkRegistry({ includeFallbacks: false, enabledOnly: true }).filter((item) => ids.includes(item.id));
      const options = [{ value: NO_NETWORK, label: '未指定' }, ...networks.map((item) => ({ value: item.id, label: item.displayName }))];
      openPickerSheet({ title: '选择卡组织', options, searchable: false, selectedValue: draft.networkId || NO_NETWORK, trigger: event.target.closest('[data-picker-field]'), onSelect(value) { draft.networkId = value === NO_NETWORK ? '' : value; syncForm(form, draft); onDirty(); } });
    }
    const mediaAction = event.target.closest('[data-asset-media-action]')?.dataset.assetMediaAction;
    if (mediaAction === 'upload-logo') form.querySelector('[data-asset-media-input="logo"]')?.click();
    if (mediaAction === 'upload-card') form.querySelector('[data-asset-media-input="card"]')?.click();
    if (mediaAction === 'clear-logo') { draft.customLogo = null; draft.logoPresentationMode = 'auto'; draft.resolvedLogoPresentation = null; draft.cardPalette = null; syncForm(form, draft); onDirty(); }
    if (mediaAction === 'clear-card') { draft.customCardImage = null; syncForm(form, draft); onDirty(); }
    if (mediaAction === 'guide') openCustomCardGuide({ stacked: true });
    const logoMode = event.target.closest('[data-asset-logo-mode]')?.dataset.assetLogoMode;
    if (logoMode) { draft.logoPresentationMode = logoMode; draft.resolvedLogoPresentation = resolvedPresentation(draft.customLogo, logoMode); syncForm(form, draft); onDirty(); }
    if (event.target.closest('[data-asset-appearance-reset]')) { draft.accountVisualOverride = null; syncForm(form, draft); onDirty(); }
    const appearanceMode = event.target.closest('[data-asset-appearance-logo-mode]')?.dataset.assetAppearanceLogoMode;
    if (appearanceMode) {
      const inheritedPalette = resolveAccountAppearance(composerAccount({ ...draft, accountVisualOverride: null, cardPalette: null })).palette;
      draft.accountVisualOverride = { enabled: true, logoPresentationMode: appearanceMode, palette: clone(draft.accountVisualOverride?.palette || inheritedPalette) };
      syncForm(form, draft); onDirty();
    }
  });
  form.addEventListener('input', (event) => {
    if (event.target.name === 'customBrandName') draft.customBrandName = event.target.value;
    if (event.target.name === 'name') draft.displayName = event.target.value;
    if (event.target.name === 'debitCardLast4') draft.debitCardLast4 = event.target.value.replace(/\D/g, '').slice(-4);
    if (event.target.name === 'creditCardLast4') draft.creditCardLast4 = event.target.value.replace(/\D/g, '').slice(-4);
    if (event.target.name === 'accountAppearancePrimary' || event.target.name === 'accountAppearanceSupporting') {
      draft.accountVisualOverride = { enabled: true, logoPresentationMode: draft.accountVisualOverride?.logoPresentationMode || draft.logoPresentationMode || 'auto', palette: { ...(draft.accountVisualOverride?.palette || draft.cardPalette || {}), [event.target.name === 'accountAppearancePrimary' ? 'primary' : 'supporting']: event.target.value, source: 'account' } };
    }
    if (['customBrandName', 'name', 'debitCardLast4', 'creditCardLast4', 'accountAppearancePrimary', 'accountAppearanceSupporting'].includes(event.target.name)) { refreshPreview(form, draft); onDirty(); }
  });
  form.addEventListener('change', async (event) => {
    if (event.target.matches('[data-asset-appearance-toggle]')) {
      const inheritedPalette = resolveAccountAppearance(composerAccount({ ...draft, accountVisualOverride: null, cardPalette: null })).palette;
      draft.accountVisualOverride = event.target.checked ? { enabled: true, logoPresentationMode: draft.logoPresentationMode || 'auto', palette: clone({ primary: inheritedPalette.primary, supporting: inheritedPalette.supporting, source: 'account' }) } : null;
      syncForm(form, draft); onDirty(); return;
    }
    const kind = event.target.dataset.assetMediaInput;
    if (!kind || !event.target.files?.[0]) return;
    const error = form.querySelector('[data-asset-media-error]');
    try {
      const media = await decodeMediaFile(event.target.files[0], kind);
      if (kind === 'logo') {
        draft.customLogo = media;
        draft.logoPresentationMode = draft.logoPresentationMode || 'auto';
        draft.resolvedLogoPresentation = resolvedPresentation(media, draft.logoPresentationMode);
        if (!draft.cardPalette) draft.cardPalette = clone(media.derivedPalette);
      }
      else draft.customCardImage = media;
      syncForm(form, draft);
      onDirty();
    } catch (failure) {
      if (error) error.textContent = failure.message;
    } finally { event.target.value = ''; }
  });
}

export function readAssetIdentity(form, draft) {
  const brand = getBrand(draft.brandId);
  const customBrand = draft.brandId === brandFallbackId(draft.type);
  if (!draft.brandId) throw new Error(draft.type === 'ew' ? '请选择电子钱包品牌' : '请选择银行');
  const customName = form.elements.customBrandName?.value.trim() || draft.customBrandName.trim();
  if (customBrand && !customName) throw new Error('请输入自定义品牌名称');
  if (draft.networkId && !supportedNetworkIds(draft.type).includes(draft.networkId)) throw new Error('当前账户类型不支持所选卡组织');
  return {
    brandId: draft.brandId,
    catalogInstitutionId: draft.brandId,
    displayName: form.elements.name?.value.trim() || draft.displayName,
    // Legacy values remain readable for rollback but no longer drive rendering.
    cardThemeId: draft.cardThemeId || null,
    networkId: draft.type === 'ew' ? null : draft.networkId || null,
    legacyNetworkId: draft.legacyNetworkId,
    customLogo: clone(draft.customLogo),
    logoPresentationMode: draft.logoPresentationMode || 'auto',
    resolvedLogoPresentation: draft.resolvedLogoPresentation || null,
    cardPalette: clone(draft.cardPalette),
    accountVisualOverride: clone(draft.accountVisualOverride),
    customCardImage: clone(draft.customCardImage),
    legacyProductId: draft.legacyProductId,
    productId: draft.legacyProductId,
    catalogProductId: draft.legacyProductId,
    physicalVariantId: draft.physicalVariantId,
    visualAssetId: draft.visualAssetId,
    artworkAssetId: draft.visualAssetId,
    customBrandName: customBrand ? customName : '',
    customProductName: '',
    bank: customBrand ? customName : brand?.displayName || '',
    institution: customBrand ? customName : brand?.displayName || '',
    network: draft.type === 'ew' ? '' : cardNetworkLabel(draft.networkId) === '未指定' ? '' : cardNetworkLabel(draft.networkId),
    productName: '',
    art: draft.legacyArt,
  };
}

export const assetIdentitySelectorTestHooks = Object.freeze({
  NO_NETWORK, ADD_CUSTOM, MANAGE_CUSTOM, CUSTOM_BRAND, LOGO_MAX_BYTES, CARD_MAX_BYTES, ACCEPTED_MEDIA,
  supportedNetworkIds, applyBrandSelection, detectRasterMime, validateCustomAssetMedia, resolveAutomaticLogoPresentation, resolvedPresentation,
});
