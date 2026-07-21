import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ASSET_VISUAL_SLOT_TYPES, ASSET_VISUAL_STATUSES, assetVisualRegistry,
  assetVisualRegistryTestHooks, resolveApprovedCardVisual, resolveAssetVisual,
  validateAssetVisualRegistry,
} from '../src/domain/assetVisualRegistry.js';
import { assetBrandVisualHTML, accountBrandVisualHTML, approvedAccountCardVisual } from '../src/components/AssetBrandVisual.js';
import { createAssetIdentityDraft, assetIdentityFieldsHTML, assetIdentitySelectorTestHooks } from '../src/features/assets/AssetIdentitySelector.js';
import { productNetworkOptions, resolveProductPreview } from '../src/domain/productCatalogue.js';
import { createDemoDataSource } from '../src/fixtures/demoData.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const root = path.resolve(appRoot, '..');
const read = (relative) => fs.readFileSync(path.join(appRoot, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(appRoot, 'public', relative));
const contractSource = read('src/domain/assetVisualRegistry.js');
const rendererSource = read('src/components/AssetBrandVisual.js');
const selectorSource = read('src/features/assets/AssetIdentitySelector.js');
const managerSource = read('src/features/assets/AssetManagementSheets.js');
const assetsSource = read('src/features/assets/index.js');
const categorySource = read('src/features/assets/category.js');
const detailSource = read('src/features/assets/detail.js');
const stackSource = read('src/components/WalletStackCategoryDeck.js');
const accountVisualSource = read('src/components/AccountVisualCard.js');
const labSource = read('src/design-system/DesignSystemLab.js');
const css = `${read('src/styles/design-system.css')}\n${read('src/styles/phase2d1a.css')}`;
const manifestPath = path.join(root, 'work/reports/phase2d1b1-required-external-asset-pack.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
let number = 0;
const add = (title, fn) => test(`2D1B1-${String(++number).padStart(3, '0')} ${title}`, fn);

add('all seven canonical visual slots exist', () => assert.deepEqual(ASSET_VISUAL_SLOT_TYPES, ['brand_compact_mark','brand_wordmark','brand_app_icon','network_mark','bank_account_visual','credit_card_face','ewallet_card_visual']));
add('all five review statuses exist', () => assert.deepEqual(ASSET_VISUAL_STATUSES, ['approved','pending_review','missing','neutral_system_fallback','legacy_pending_review']));
add('every visual record carries the required metadata contract', () => assetVisualRegistry().forEach((asset) => ['assetId','brandId','productId','networkId','physicalVariantId','slotType','filePath','lightFilePath','darkFilePath','mediaType','aspectRatio','fitMode','safePadding','backgroundTreatment','status','provenanceStatus'].forEach((key) => assert.ok(Object.hasOwn(asset, key), `${asset.assetId}:${key}`))));
add('asset visual IDs are unique', () => assert.equal(new Set(assetVisualRegistry().map((asset) => asset.assetId)).size, assetVisualRegistry().length));
add('visual registry passes real file validation', () => assert.deepEqual(validateAssetVisualRegistry({ assetExists: exists }).errors, []));
add('registry records are immutable internally', () => assert.ok(Object.isFrozen(assetVisualRegistryTestHooks.records)));
add('Phase 2D1B.2 user-reviewed brand and network media are explicitly approved', () => assetVisualRegistry().filter((asset) => asset.provenanceStatus === 'user_reviewed_phase2d1b2_source_pack').forEach((asset) => assert.equal(asset.status, 'approved')));
add('production resolution uses the approved source pack', () => assert.equal(resolveAssetVisual({ brandId:'cimb', slotType:'brand_compact_mark', entityType:'bank' }).status, 'approved'));
add('QA and production resolve the same reviewed file', () => { const visual = resolveAssetVisual({ brandId:'cimb', slotType:'brand_compact_mark', entityType:'bank', qa:true }); assert.equal(visual.status, 'approved'); assert.equal(visual.filePath, 'assets/brands/user-reviewed/banks/cimb.png'); });
add('production renderer contains the reviewed local image', () => { const html = assetBrandVisualHTML({ brandId:'cimb', slotType:'brand_compact_mark', entityType:'bank' }); assert.match(html, /data-asset-visual-status="approved"/); assert.match(html, /<img/); assert.match(html, /user-reviewed\/banks\/cimb\.png/); });
add('production renderer never uses letter initials', () => assert.doesNotMatch(`${rendererSource}\n${assetsSource}\n${categorySource}\n${stackSource}\n${accountVisualSource}\n${managerSource}`, /slice\(0,\s*[12]\)|account\.name\[0\]|asset-product-preview-fallback/));
add('all slot images use canonical contain geometry', () => assert.match(css, /\.asset-visual-slot img[^}]*object-fit:contain!important/));
add('compact marks and network marks use distinct slot geometry', () => { assert.match(css, /asset-visual-slot-network-mark/); assert.match(contractSource, /brand_compact_mark/); assert.match(contractSource, /network_mark/); });
add('same account identity renderer is shared by overview and manager', () => { assert.match(assetsSource, /accountBrandVisualHTML/); assert.match(managerSource, /accountBrandVisualHTML/); });
add('same canonical live card model is shared by stack, detail card and eWallet category', () => { assert.match(stackSource, /resolveAccountCardViewModel/); assert.match(accountVisualSource, /resolveAccountCardViewModel/); assert.match(categorySource, /walletStackCategoryDeckHTML/); });
add('pending-review art cannot become an exact preview', () => { const preview = resolveProductPreview({ brandId:'rhb', productId:'rhb-cash-back-credit-card', networkId:'mastercard' }); assert.notEqual(preview.kind, 'verified-product-art'); assert.equal(preview.imagePath, null); });
add('exact preview requires an explicitly approved visual', () => { const preview = resolveProductPreview({ brandId:'maybank', productId:'maybank-visa-platinum', networkId:'visa' }); assert.equal(preview.kind, 'verified-product-art'); assert.equal(resolveApprovedCardVisual({ productId:'maybank-visa-platinum' })?.status, 'approved'); });
add('approved pre-Phase2D1B account art remains available', () => { const account = createDemoDataSource().getAccounts().find((item) => item.id === 'cc-mbb-visa'); assert.equal(approvedAccountCardVisual(account)?.filePath, 'assets/cards/maybank-visa-platinum.png'); });
add('ordinary preview is the canonical automatic RinggitMe card composer', () => { const html = assetIdentityFieldsHTML(createAssetIdentityDraft({ type:'cc', bank:'RHB', name:'RHB Cashback Card', network:'Mastercard', cardThemeId:'obsidian-flow' }, 'cc')); assert.match(html, /ringgitme-auto-card/); assert.match(html, /institution-palette/); assert.doesNotMatch(html,/theme-obsidian-flow/); });
add('new selection state has no question-mark preview box', () => { const html = assetIdentityFieldsHTML(createAssetIdentityDraft(null, 'saving')); assert.match(html, /asset-card-composer-preview/); assert.doesNotMatch(html, /asset-product-preview-fallback|>\?<\/span>/); });
add('ordinary UI removes official verified badge copy', () => assert.doesNotMatch(`${selectorSource}\n${managerSource}`, /官方资料已核对/));
add('QA lab retains temporary system-logo status visibility', () => { assert.match(labSource, /pending\?\.filePath/); assert.match(labSource, /data-qa-asset-status/); assert.match(labSource, /临时系统素材/); });
add('eWallet brand selection never derives a product or network', () => { const draft = createAssetIdentityDraft(null, 'ew'); assetIdentitySelectorTestHooks.applyBrandSelection(draft, 'tng'); assert.equal(draft.productId, null); assert.equal(draft.networkId, ''); assert.doesNotMatch(assetIdentityFieldsHTML(draft), /data-picker-field="asset-product"|data-picker-field="asset-network"/); });
add('legacy product compatibility remains outside the consumer form', () => { assert.match(selectorSource, /legacyProductId/); assert.doesNotMatch(assetIdentityFieldsHTML(createAssetIdentityDraft(null,'cc')), /asset-product/); });
add('bank flow uses institution name and optional network without product or theme gates', () => { const html = assetIdentityFieldsHTML(createAssetIdentityDraft(null, 'saving')); assert.match(html, /银行/); assert.match(html, /name="name"/); assert.match(html, /卡组织（可选）/); assert.doesNotMatch(html, /产品|卡面风格|asset-theme/); });
add('custom credit-card brand remains independent from legacy theme and network', () => { const draft = createAssetIdentityDraft(null, 'cc'); draft.brandId='custom-bank'; draft.customBrandName='Example Bank'; draft.cardThemeId='violet-prism'; draft.networkId='mastercard'; const html=assetIdentityFieldsHTML(draft); assert.match(html,/Example Bank/); assert.match(html,/Mastercard/); assert.doesNotMatch(html,/Violet|紫晶|theme-violet-prism|精确卡面/); });
add('verified product network choices remain restricted', () => assert.deepEqual(productNetworkOptions('maybank-visa-platinum').map((item) => item.id), ['visa']));
add('long picker names support two readable lines', () => assert.match(css, /picker-option-label[^}]*-webkit-line-clamp:2/));
add('legacy product status is hidden from ordinary account forms', () => { const html=assetIdentityFieldsHTML(createAssetIdentityDraft({type:'saving',bank:'CIMB',name:'CIMB OctoSavers'},'saving')); assert.doesNotMatch(html,/旧产品|Legacy|Unknown/); assert.doesNotMatch(html,/has-error|error-border/); });
add('credit-card payment dates are labelled as repayment dates', () => { assert.match(detailSource,/本期还款日/); assert.match(categorySource,/本期还款日/); assert.match(stackSource,/本期还款日/); });
add('no credit-card expiry field was added', () => assert.doesNotMatch(`${selectorSource}\n${managerSource}\n${detailSource}`, /cardExpiry|expiryDate|有效期|卡片到期/));
add('bank and eWallet terminology is canonical', () => { assert.match(managerSource,/银行卡末四位（ATM／Debit Card，可不填）/); assert.match(managerSource,/手机号码／账户标识（可选）/); assert.match(selectorSource,/电子钱包品牌/); });
add('Assets overview and detail structures remain frozen', () => { assert.match(assetsSource,/总览/); assert.match(assetsSource,/asset-card-stack/); assert.match(detailSource,/renderCarousel\(list, index/); });
add('external pack manifest contains all priority-one groups', () => { assert.ok(manifest.assets.length >= 17); ['maybank','cimb','publicbank','rhb','tng','boost','grabpay','bigpay','shopeepay','visa','mastercard','amex'].forEach((id) => assert.ok(manifest.assets.some((asset) => asset.brandId === id || asset.networkId === id), id)); });
add('reviewed pack directory is empty except for its contract manifest', () => { const pack=path.join(appRoot,'public/assets/ringgitme-reviewed/v1'); const files=fs.readdirSync(pack,{recursive:true}).filter((entry) => fs.statSync(path.join(pack,entry)).isFile()); assert.deepEqual(files,['manifest.json']); });
add('financial integrity and runtime boundaries remain unchanged', () => { assert.deepEqual(createDemoDataSource().getAssetFinancialIntegrity(), {ok:true,errors:[]}); assert.doesNotMatch(`${contractSource}\n${rendererSource}\n${selectorSource}\n${managerSource}`, /fetch\(|XMLHttpRequest|localStorage|indexedDB|supabase|WebSocket/i); });

assert.equal(number, 36);
