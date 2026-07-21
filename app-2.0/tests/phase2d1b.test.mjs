import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  brandRegistry, brandRegistryTestHooks, getBrand, networkRegistry,
  resolveAccountBrand, resolveBrandId, validateBrandRegistry,
} from '../src/domain/brandRegistry.js';
import {
  getProduct, productCatalogue, productCatalogueTestHooks, productNetworkOptions,
  productPhysicalVariants, resolveLegacyAssetIdentity, resolveProductId,
  resolveProductPreview, validateProductCatalogue,
} from '../src/domain/productCatalogue.js';
import { normalizeAsset } from '../src/domain/assetFinancialModel.js';
import { createAssetIdentityDraft, assetIdentityFieldsHTML, assetIdentitySelectorTestHooks } from '../src/features/assets/AssetIdentitySelector.js';
import { createDemoDataSource } from '../src/fixtures/demoData.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const read = (relative) => fs.readFileSync(path.join(appRoot, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(appRoot, 'public', relative));
const registrySource = read('src/domain/brandRegistry.js');
const catalogueSource = read('src/domain/productCatalogue.js');
const selectorSource = read('src/features/assets/AssetIdentitySelector.js');
const editorSource = read('src/features/assets/AssetManagementSheets.js');
const pickerSource = read('src/components/PickerSheet.js');
const assetsSource = read('src/features/assets/index.js');
const detailSource = read('src/features/assets/detail.js');
const labSource = read('src/design-system/DesignSystemLab.js');
const css = `${read('src/styles/design-system.css')}\n${read('src/styles/phase2d1a.css')}`;
const brands = brandRegistry();
const products = productCatalogue();
const officialBrands = brands.filter((item) => !['app-neutral-fallback', 'user-reviewed-source-pack'].includes(item.provenance.sourceType));
let number = 0;
const add = (title, fn) => test(`2D1B-${String(++number).padStart(3, '0')} ${title}`, fn);

// Brand registry and local asset contract.
add('brand IDs are unique', () => assert.equal(new Set(brands.map((item) => item.id)).size, brands.length));
add('brand IDs are stable lowercase ASCII slugs', () => brands.forEach((item) => assert.match(item.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)));
add('entity types are canonical', () => brands.forEach((item) => assert.ok(['bank', 'digital_bank', 'ewallet', 'card_network'].includes(item.entityType))));
add('official records use HTTPS provenance', () => officialBrands.forEach((item) => assert.match(item.provenance.sourceUrl, /^https:\/\//)));
add('active brands carry a verification date', () => brands.filter((item) => item.status === 'active').forEach((item) => assert.match(item.provenance.verifiedAt, /^\d{4}-\d{2}-\d{2}$/)));
add('all configured logo paths are local', () => brands.filter((item) => item.logo.primary).forEach((item) => assert.doesNotMatch(item.logo.primary, /^(?:https?:|data:)/)));
add('all configured local logo files exist', () => brands.filter((item) => item.logo.primary).forEach((item) => assert.ok(exists(item.logo.primary), item.logo.primary)));
add('required Malaysia bank coverage exists', () => ['maybank','cimb','publicbank','rhb','hong-leong-bank','ambank','alliance-bank','uob','ocbc','hsbc','standard-chartered','bank-islam','bank-rakyat','bsn','gxbank','aeon-bank','boost-bank'].forEach((id) => assert.ok(getBrand(id), id)));
add('required eWallet coverage exists', () => ['tng','grabpay','boost','shopeepay','setel','bigpay','mae'].forEach((id) => assert.equal(getBrand(id)?.entityType, 'ewallet')));
add('required card-network coverage exists', () => ['visa','mastercard','amex','unionpay','jcb'].forEach((id) => assert.equal(getBrand(id)?.entityType, 'card_network')));
add('custom fallbacks are explicit neutral records', () => ['custom-bank','custom-ewallet','custom-network'].forEach((id) => assert.equal(getBrand(id)?.provenance.sourceType, 'app-neutral-fallback')));
add('aliases resolve deterministically', () => { assert.equal(resolveBrandId('American Express'), 'amex'); assert.equal(resolveBrandId('TNG Digital', { entityTypes: 'ewallet' }), 'tng'); });
add('short ambiguous aliases do not match surrounding prose', () => assert.equal(resolveBrandId('monthly pb reminder account', { entityTypes: 'bank' }), null));
add('unknown brand returns null without throwing', () => assert.equal(resolveBrandId('Unlisted Example Institution'), null));
add('registry returns defensive clones', () => { const item = getBrand('maybank'); item.displayName = 'changed'; assert.equal(getBrand('maybank').displayName, 'Maybank'); });
add('light/dark logo resolution is deterministic', () => { const item = getBrand('mastercard'); assert.equal(item.logo.darkMode, null); assert.equal(item.logo.primary, 'assets/networks/user-reviewed/mastercard.png'); });
add('registry validator passes against the real asset tree', () => assert.deepEqual(validateBrandRegistry({ assetExists: exists }).errors, []));
add('SVG assets reject executable or foreign content', () => {
  const svgFiles = fs.readdirSync(path.join(appRoot, 'public/assets/brands/official')).filter((name) => name.endsWith('.svg')).map((name) => path.join(appRoot, 'public/assets/brands/official', name))
    .concat(fs.readdirSync(path.join(appRoot, 'public/assets/networks/official')).filter((name) => name.endsWith('.svg')).map((name) => path.join(appRoot, 'public/assets/networks/official', name)));
  svgFiles.forEach((file) => assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /<script|foreignObject|on[a-z]+\s*=|xlink:href|<image[^>]+href=/i));
});

// Product catalogue and preview fidelity.
add('product IDs are unique', () => assert.equal(new Set(products.map((item) => item.id)).size, products.length));
add('product IDs are stable lowercase ASCII slugs', () => products.forEach((item) => assert.match(item.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)));
add('every product references a valid brand', () => products.forEach((item) => assert.ok(getBrand(item.brandId), item.id)));
add('product asset types are canonical', () => products.forEach((item) => assert.ok(['bank_account','credit_card','ewallet'].includes(item.assetType))));
add('product statuses are canonical', () => products.forEach((item) => assert.ok(['active','legacy','discontinued','unknown'].includes(item.status))));
add('active products have official provenance', () => products.filter((item) => item.status === 'active').forEach((item) => assert.match(item.provenance.sourceUrl, /^https:\/\//)));
add('network references resolve to card-network brands', () => products.flatMap((item) => item.networkIds).forEach((id) => assert.equal(getBrand(id)?.entityType, 'card_network')));
add('unsupported marketing claims are absent', () => products.forEach((item) => ['annualFee','interestRate','cashbackRate','rewardsRate','welcomeOffer'].forEach((key) => assert.equal(Object.hasOwn(item, key), false))));
add('legacy OctoSavers product remains resolvable', () => assert.equal(getProduct('cimb-octosavers-account-i')?.status, 'legacy'));
add('Maybank exact preview uses accepted local artwork', () => { const preview = resolveProductPreview({ brandId: 'maybank', productId: 'maybank-visa-platinum', networkId: 'visa' }); assert.equal(preview.kind, 'verified-product-art'); assert.ok(exists(preview.imagePath)); });
add('unknown product uses a neutral brand preview', () => assert.equal(resolveProductPreview({ brandId: 'rhb' }).kind, 'verified-brand-neutral-card'));
add('neutral preview never claims an exact visual asset', () => assert.equal(resolveProductPreview({ brandId: 'rhb', productId: 'rhb-cash-back-credit-card', networkId: 'mastercard' }).visualAssetId, null));
add('Maybank 2 bundle does not auto-create records or limits', () => { const bundle = getProduct('maybank-2-platinum-cards').bundle; assert.equal(bundle.createsMultipleRecords, false); assert.equal(bundle.sharesFinancialLimitAutomatically, false); });
add('Maybank 2 exposes three verified physical choices', () => assert.deepEqual(productPhysicalVariants('maybank-2-platinum-cards').map((item) => item.networkId), ['amex','mastercard','visa']));
add('product network options are filtered by product', () => assert.deepEqual(productNetworkOptions('maybank-visa-platinum').map((item) => item.id), ['visa']));
add('product catalogue validator passes against real assets', () => assert.deepEqual(validateProductCatalogue({ assetExists: exists }).errors, []));

// Deterministic legacy adaptation and identity-only metadata.
add('fixture Maybank card resolves exactly', () => assert.deepEqual(resolveLegacyAssetIdentity({ type:'cc', name:'Maybank Visa Platinum', bank:'Maybank', network:'Visa' }), { brandId:'maybank', productId:'maybank-visa-platinum', networkId:'visa', physicalVariantId:null, visualAssetId:'card-maybank-visa-platinum', resolution:'product' }));
add('fixture RHB card preserves its existing Mastercard network', () => assert.equal(resolveLegacyAssetIdentity({ type:'cc', name:'RHB Cashback Card', bank:'RHB', network:'Mastercard' }).networkId, 'mastercard'));
add('fixture eWallet provider resolves deterministically', () => assert.equal(resolveLegacyAssetIdentity({ type:'ew', name:"Touch 'n Go eWallet", bank:'TNG Digital' }).brandId, 'tng'));
add('ambiguous free text is not auto-mapped', () => assert.equal(resolveLegacyAssetIdentity({ type:'saving', name:'Holiday money', bank:'PB reminder' }).brandId, null));
add('unknown stable IDs fall back safely', () => assert.equal(resolveLegacyAssetIdentity({ type:'saving', brandId:'not-in-catalogue', bank:'Unknown' }).resolution, 'custom-unresolved'));
add('unresolved existing brand becomes editable custom identity', () => { const draft = createAssetIdentityDraft({ type:'saving', bank:'Example Community Bank', name:'Daily' }, 'saving'); assert.equal(draft.brandId, 'custom-bank'); assert.equal(draft.customBrandName, 'Example Community Bank'); });
add('new records start with no silently selected bank', () => assert.equal(createAssetIdentityDraft(null, 'cc').brandId, ''));
add('normalizing identity metadata preserves balance', () => { const before = normalizeAsset({ id:'x', type:'saving', name:'Test', balance:123.45 }); const after = normalizeAsset({ ...before, brandId:'maybank', productId:null }); assert.equal(after.balanceMinor, before.balanceMinor); });
add('normalizing identity metadata preserves credit limit and debt', () => { const before = normalizeAsset({ id:'c', type:'cc', name:'Test', limit:5000, outstanding:125 }); const after = normalizeAsset({ ...before, brandId:'rhb', productId:'rhb-cash-back-credit-card' }); assert.equal(after.limitMinor, before.limitMinor); assert.equal(after.outstandingMinor, before.outstandingMinor); });

// Form and canonical picker integration.
add('credit-card editor renders institution and user name before optional network', () => { const html = assetIdentityFieldsHTML(createAssetIdentityDraft(null, 'cc')); assert.ok(html.indexOf('data-picker-field="asset-brand"') < html.indexOf('name="name"')); assert.ok(html.indexOf('name="name"') < html.indexOf('data-picker-field="asset-network"')); assert.doesNotMatch(html,/asset-theme/); });
add('bank account editor uses the canonical brand picker', () => assert.match(assetIdentityFieldsHTML(createAssetIdentityDraft(null, 'saving')), /data-picker-field="asset-brand"/));
add('eWallet editor uses the canonical provider picker', () => assert.match(assetIdentityFieldsHTML(createAssetIdentityDraft(null, 'ew')), /电子钱包品牌/));
add('legacy product catalogue is not a normal form requirement', () => assert.doesNotMatch(assetIdentityFieldsHTML(createAssetIdentityDraft(null, 'cc')), /asset-product|信用卡产品/));
add('network selection is optional', () => assert.match(selectorSource, /NO_NETWORK[^]*未指定/));
add('changing brand preserves independent theme and network choices', () => { const draft=createAssetIdentityDraft(null,'cc'); draft.networkId='visa'; draft.cardThemeId='obsidian-flow'; assetIdentitySelectorTestHooks.applyBrandSelection(draft,'cimb'); assert.equal(draft.networkId,'visa'); assert.equal(draft.cardThemeId,'obsidian-flow'); });
add('automatic card and network are no longer derived from a product or selected theme', () => { const html=assetIdentityFieldsHTML(createAssetIdentityDraft(null,'cc')); assert.match(html,/ringgitme-auto-card/); assert.match(html,/asset-network/); assert.doesNotMatch(html,/asset-product|asset-theme/); });
add('custom bank and custom eWallet remain available', () => { assert.match(selectorSource, /custom-bank/); assert.match(selectorSource, /custom-ewallet/); });
add('last four remains optional and numeric-keyboard friendly', () => assert.match(editorSource, /信用卡末四位（可不填）[^]*inputmode="numeric"[^]*maxlength="4"/));
add('invalid non-four-digit last four is rejected', () => assert.match(editorSource, /validateOptionalLastFour\(values\.creditCardLast4/));
add('full credit-card number field is not introduced', () => assert.doesNotMatch(editorSource, /name="(?:cardNumber|creditCardNumber|pan)"/));
add('selectors use canonical AppSheet picker', () => { assert.match(selectorSource, /openPickerSheet/); assert.match(pickerSource, /picker-layer modal-layer/); });
add('picker options render local official logo images', () => assert.match(pickerSource, /option\.image[^]*<img src=/));
add('canonical picker keeps child-first modal ownership', () => assert.match(pickerSource, /pushModalLayer[^]*registerOwnedModalHistory/));
add('form save stores identity metadata alongside existing fields', () => assert.match(editorSource, /readAssetIdentity\(form, editorIdentityDraft\)/));
add('exact artwork remains catalogue compatibility rather than ordinary form UI', () => { assert.match(catalogueSource, /verified-product-art/); assert.doesNotMatch(selectorSource, /精确卡面|verified-product-art/); });

// UI freeze, QA visibility, and prohibited behavior.
add('Assets overview keeps its three canonical segments', () => ['总览','资产','负债'].forEach((label) => assert.match(assetsSource, new RegExp(label))));
add('Assets overview keeps stacked account structures', () => { assert.match(assetsSource, /asset-card-stack/); assert.match(assetsSource, /asset-stack-row/); });
add('account detail keeps its accepted carousel and recent-record sections', () => { assert.match(detailSource, /renderCarousel\(list, index/); assert.match(detailSource, /最近记录/); });
add('Design System Lab exposes the production brand registry', () => { assert.match(labSource, /brandRegistry/); assert.match(labSource, /品牌与临时系统 Logo/); });
add('brand matrix is responsive at compact width', () => assert.match(css, /rm-lab-brand-matrix[^]*@media \(max-width:640px\)[^]*grid-template-columns:repeat\(2/));
add('runtime UI contains no remote image source construction', () => assert.doesNotMatch(`${selectorSource}\n${pickerSource}\n${assetsSource}`, /<img[^>]+src="https?:/i));
add('phase code adds no network or persistence API', () => assert.doesNotMatch(`${registrySource}\n${catalogueSource}\n${selectorSource}\n${editorSource}`, /fetch\(|XMLHttpRequest|localStorage|indexedDB|supabase|WebSocket/i));
add('registry and catalogue do not expose secret-like fields', () => assert.doesNotMatch(`${registrySource}\n${catalogueSource}`, /apiKey|accessToken|clientSecret|password\s*:/i));
add('fixture financial integrity remains valid', () => assert.deepEqual(createDemoDataSource().getAssetFinancialIntegrity(), { ok: true, errors: [] }));
add('catalogue implementation does not import financial mutation engines', () => assert.doesNotMatch(`${registrySource}\n${catalogueSource}\n${selectorSource}`, /moneyEngine|recurringPostingExecutor|relationshipLedgerEngine/));
add('registry contract records remain immutable internally', () => assert.ok(Object.isFrozen(brandRegistryTestHooks.records)));
add('catalogue contract records remain immutable internally', () => assert.ok(Object.isFrozen(productCatalogueTestHooks.records)));

assert.equal(number, 71);
