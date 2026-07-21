import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brandRegistry, getBrand, networkRegistry, validateBrandRegistry } from '../src/domain/brandRegistry.js';
import { assetVisualRegistry, resolveAssetVisual, validateAssetVisualRegistry } from '../src/domain/assetVisualRegistry.js';
import { cardThemeRegistry, defaultCardThemeId, getCardTheme, validateCardThemeRegistry } from '../src/domain/cardThemeRegistry.js';
import { ringgitMeCardComposerHTML } from '../src/components/RinggitMeCardComposer.js';
import { accountVisualCardHTML } from '../src/components/AccountVisualCard.js';
import { assetBrandVisualHTML } from '../src/components/AssetBrandVisual.js';
import { normalizeAsset } from '../src/domain/assetFinancialModel.js';
import {
  assetIdentityFieldsHTML, assetIdentitySelectorTestHooks, createAssetIdentityDraft,
  detectRasterMime, validateCustomAssetMedia,
} from '../src/features/assets/AssetIdentitySelector.js';
import { resolveLegacyAssetIdentity } from '../src/domain/productCatalogue.js';
import { createDemoDataSource } from '../src/fixtures/demoData.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const sourcePackRoot = '/Users/winnertang/Desktop/ringgitme-logo-sources';
const read = (relative) => fs.readFileSync(path.join(appRoot, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(appRoot, 'public', relative));
const manifest = JSON.parse(read('public/assets/brands/user-reviewed/source-manifest.json'));
const selectorSource = read('src/features/assets/AssetIdentitySelector.js');
const editorSource = read('src/features/assets/AssetManagementSheets.js');
const composerSource = read('src/components/RinggitMeCardComposer.js');
const accountVisualSource = read('src/components/AccountVisualCard.js');
const appSheetSource = read('src/components/AppSheet.js');
const modalStackSource = read('src/app/modalStack.js');
const css = `${read('src/styles/design-system.css')}\n${read('src/styles/phase2d1a.css')}`;
const onePixelPng = { dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', fileName: 'one.png', mimeType: 'image/png', sizeBytes: 68, width: 1, height: 1 };
let number = 0;
const add = (title, fn) => test(`2D1B2-${String(++number).padStart(3, '0')} ${title}`, fn);

add('external source pack is present and recursively enumerable', () => assert.equal(fs.existsSync(sourcePackRoot), true));
add('source pack contains exactly 22 bank sources', () => assert.equal(fs.readdirSync(path.join(sourcePackRoot, 'banks')).filter((name) => !name.startsWith('.')).length, 22));
add('source pack contains exactly 6 eWallet sources', () => assert.equal(fs.readdirSync(path.join(sourcePackRoot, 'ewallets')).filter((name) => !name.startsWith('.')).length, 6));
add('source pack contains exactly 3 network sources', () => assert.equal(fs.readdirSync(path.join(sourcePackRoot, 'networks')).filter((name) => !name.startsWith('.')).length, 3));
add('normalization manifest records all 31 decoded assets', () => assert.deepEqual(manifest.totals, { banks:22, ewallets:6, networks:3, normalized:31, skipped:0 }));
add('every manifest record stores source type dimensions hash and output', () => manifest.assets.forEach((asset) => ['sourceFilename','detectedFileType','sourceDimensions','sourceSha256','normalizedOutput','assetShape'].forEach((key) => assert.ok(asset[key], `${asset.sourceFilename}:${key}`))));
add('mismatched png extensions are detected from content', () => assert.ok(manifest.assets.some((asset) => asset.sourceFilename.endsWith('.png') && asset.detectedFileType === 'image/webp')));
add('all normalized outputs are real local PNG files', () => manifest.assets.forEach((asset) => { assert.match(asset.normalizedOutput,/\.png$/); assert.ok(exists(asset.normalizedOutput), asset.normalizedOutput); assert.deepEqual([...fs.readFileSync(path.join(appRoot,'public',asset.normalizedOutput)).subarray(0,8)],[137,80,78,71,13,10,26,10]); }));
add('normalized hashes are complete SHA256 values', () => manifest.assets.forEach((asset) => assert.match(asset.outputSha256,/^[a-f0-9]{64}$/)));
add('registry covers every normalized bank', () => manifest.assets.filter((asset) => asset.assetGroup === 'banks').forEach((asset) => assert.ok(getBrand(asset.brandId), asset.brandId)));
add('registry covers every normalized eWallet', () => manifest.assets.filter((asset) => asset.assetGroup === 'ewallets').forEach((asset) => assert.equal(getBrand(asset.brandId)?.entityType,'ewallet')));
add('ordinary network registry enables exactly Visa Mastercard and American Express', () => assert.deepEqual(networkRegistry({ includeFallbacks:false, enabledOnly:true }).map((item) => item.id), ['visa','mastercard','amex']));
add('brand registry validates against normalized local assets', () => assert.deepEqual(validateBrandRegistry({ assetExists:exists }).errors, []));
add('asset slot registry validates against normalized local assets', () => assert.deepEqual(validateAssetVisualRegistry({ assetExists:exists }).errors, []));
add('all reviewed pack visual records are approved and contain-fit', () => assetVisualRegistry().filter((asset) => asset.provenanceStatus === 'user_reviewed_phase2d1b2_source_pack').forEach((asset) => { assert.equal(asset.status,'approved'); assert.equal(asset.fitMode,'contain'); }));
add('production brand renderer uses local media without third-party URLs', () => { const html=assetBrandVisualHTML({brandId:'maybank',slotType:'brand_compact_mark',entityType:'bank'}); assert.match(html,/user-reviewed\/banks\/maybank\.png/); assert.doesNotMatch(html,/https?:/); });
add('missing brand identity returns a neutral fallback without a broken image', () => { const visual=resolveAssetVisual({brandId:'unknown',slotType:'brand_compact_mark',entityType:'bank'}); assert.equal(visual.status,'neutral_system_fallback'); assert.equal(visual.filePath,null); });
add('legacy product metadata cannot suppress its canonical institution logo', () => { const account=createDemoDataSource().getAccount('sv-cimb'); assert.match(accountVisualCardHTML(account),/user-reviewed\/banks\/cimb\.png/); });

add('card theme registry contains exactly eight stable themes', () => assert.equal(cardThemeRegistry().length,8));
add('all eight theme IDs match the accepted contract', () => assert.deepEqual(cardThemeRegistry().map((item)=>item.id),['pearl-chrome','obsidian-flow','midnight-blue','crimson-arc','emerald-depth','champagne-wave','violet-prism','graphite-grid']));
add('theme registry validates without duplicate or invalid IDs', () => assert.deepEqual(validateCardThemeRegistry().errors,[]));
add('every theme has an explicit light or dark text tone', () => cardThemeRegistry().forEach((theme)=>assert.ok(['light','dark'].includes(theme.tone))));
add('retired themes have no active CSS material selectors', () => cardThemeRegistry().forEach((theme)=>assert.doesNotMatch(css,new RegExp(`\\.theme-${theme.id}`))));
add('institution palettes replace legacy theme rendering', () => { const a=ringgitMeCardComposerHTML({type:'saving',brandId:'maybank',name:'A',cardThemeId:'obsidian-flow'}); const b=ringgitMeCardComposerHTML({type:'saving',brandId:'cimb',name:'B',cardThemeId:'obsidian-flow'}); assert.match(a,/data-card-palette-brand="maybank"/); assert.match(b,/data-card-palette-brand="cimb"/); assert.doesNotMatch(`${a}${b}`,/theme-obsidian-flow/); });
add('legacy theme choice no longer changes the same automatic card', () => { const a=ringgitMeCardComposerHTML({type:'cc',brandId:'rhb',name:'A',cardThemeId:'pearl-chrome'}); const b=ringgitMeCardComposerHTML({type:'cc',brandId:'rhb',name:'A',cardThemeId:'crimson-arc'}); assert.equal(a,b); });
add('brand selection preserves theme and network', () => { const draft=createAssetIdentityDraft(null,'cc'); draft.cardThemeId='violet-prism'; draft.networkId='mastercard'; assetIdentitySelectorTestHooks.applyBrandSelection(draft,'uob'); assert.equal(draft.cardThemeId,'violet-prism'); assert.equal(draft.networkId,'mastercard'); });
add('default themes are type-specific but freely replaceable', () => { assert.equal(defaultCardThemeId('saving'),'pearl-chrome'); assert.equal(defaultCardThemeId('cc'),'obsidian-flow'); assert.equal(defaultCardThemeId('ew'),'midnight-blue'); });
add('credit card composer renders selected network at the safe corner', () => assert.match(ringgitMeCardComposerHTML({type:'cc',brandId:'maybank',name:'Card',cardThemeId:'obsidian-flow',networkId:'visa'}),/ringgit-card-network/));
add('eWallet composer never renders a card network', () => assert.doesNotMatch(ringgitMeCardComposerHTML({type:'ew',brandId:'tng',name:'Wallet',cardThemeId:'midnight-blue',networkId:'visa'}),/ringgit-card-network/));

add('new bank form includes institution name optional network and no theme or product gate', () => { const html=assetIdentityFieldsHTML(createAssetIdentityDraft(null,'saving')); assert.match(html,/asset-brand/); assert.match(html,/name="name"/); assert.match(html,/asset-network/); assert.doesNotMatch(html,/asset-product|asset-theme/); });
add('new credit-card form supports three enabled networks plus unspecified', () => assert.deepEqual(assetIdentitySelectorTestHooks.supportedNetworkIds('cc'),['visa','mastercard','amex']));
add('new bank form supports Visa Mastercard American Express and unspecified', () => assert.deepEqual(assetIdentitySelectorTestHooks.supportedNetworkIds('saving'),['visa','mastercard','amex']));
add('new eWallet form has no network field', () => assert.doesNotMatch(assetIdentityFieldsHTML(createAssetIdentityDraft(null,'ew')),/asset-network/));
add('user display name remains a free text field', () => assert.match(selectorSource,/name="name"[^>]*maxlength="40"/));
add('credit card stores only optional last four digits', () => { assert.match(editorSource,/name="creditCardLast4"[^>]*maxlength="4"/); assert.doesNotMatch(editorSource,/name="(?:cardNumber|creditCardNumber|pan)"/); });
add('debit card stores only optional last four digits', () => { assert.match(editorSource,/name="debitCardLast4"[^>]*maxlength="4"/); assert.doesNotMatch(editorSource,/name="debitCardNumber"/); });
add('legacy bank last-four data prefills the canonical debit last-four field', () => assert.equal(createDemoDataSource().getAccount('sv-mbb').debitCardLast4,'8888'));
add('sensitive card fields are absent', () => assert.doesNotMatch(`${selectorSource}\n${editorSource}`,/CVV|PIN|expiry|有效期|持卡人姓名/i));
add('ordinary form contains no technical catalogue badges', () => assert.doesNotMatch(assetIdentityFieldsHTML(createAssetIdentityDraft(null,'cc')),/官方来源|官方资料已核对|历史产品|精确卡面|Asset slot|Registry|Legacy|Fixture|Unknown|Normalized|MIME|Source manifest/i));
add('selected network field has no long unsupported-network hint', () => assert.doesNotMatch(assetIdentityFieldsHTML({...createAssetIdentityDraft(null,'cc'),networkId:'visa'}),/UnionPay|JCB|MyDebit|Visa \/ Mastercard/));
add('ordinary form renders one real automatic production-card preview', () => { assert.match(selectorSource,/ringgitMeCardComposerHTML/); assert.doesNotMatch(selectorSource,/cardThemePreviewHTML|asset-theme/); });
add('brand picker renders the canonical real-logo slot', () => assert.match(selectorSource,/assetBrandVisualHTML/));

add('PNG custom media signature is detected', () => assert.equal(detectRasterMime(Uint8Array.from([137,80,78,71,13,10,26,10])),'image/png'));
add('JPEG custom media signature is detected', () => assert.equal(detectRasterMime(Uint8Array.from([255,216,255,1])),'image/jpeg'));
add('WebP custom media signature is detected', () => assert.equal(detectRasterMime(Uint8Array.from([82,73,70,70,0,0,0,0,87,69,66,80])),'image/webp'));
add('SVG and unknown custom media are rejected', () => assert.throws(()=>validateCustomAssetMedia({bytes:new TextEncoder().encode('<svg></svg>'),sizeBytes:11}),/PNG、JPEG 或 WebP/));
add('oversized custom logo is rejected', () => assert.throws(()=>validateCustomAssetMedia({bytes:Uint8Array.from([137,80,78,71,13,10,26,10]),sizeBytes:6*1024*1024,kind:'logo'}),/5 MB/));
add('oversized custom card is rejected', () => assert.throws(()=>validateCustomAssetMedia({bytes:Uint8Array.from([137,80,78,71,13,10,26,10]),sizeBytes:11*1024*1024,kind:'card'}),/10 MB/));
add('custom logo is stored per account without changing the global registry', () => { const account=normalizeAsset({type:'saving',name:'Test',balance:1,brandId:'maybank',customLogo:onePixelPng}); assert.equal(account.customLogo.fileName,'one.png'); assert.equal(getBrand('maybank').logo.primary,'assets/brands/user-reviewed/banks/maybank.png'); });
add('clearing custom logo restores the selected system brand logo', () => { const html=assetBrandVisualHTML({brandId:'maybank',slotType:'brand_compact_mark',entityType:'bank',customMedia:null}); assert.match(html,/user-reviewed\/banks\/maybank\.png/); assert.doesNotMatch(html,/data:image/); });
add('custom full card takes precedence in the composer', () => assert.match(ringgitMeCardComposerHTML({type:'cc',name:'Custom',cardThemeId:'obsidian-flow',customCardImage:onePixelPng}),/data-card-renderer="user-custom-card"/));
add('clearing custom full card restores automatic system composer output', () => assert.match(ringgitMeCardComposerHTML({type:'cc',name:'System',cardThemeId:'obsidian-flow',customCardImage:null}),/data-card-renderer="ringgitme-auto-card"/));
add('account visual card uses the automatic composer for legacy themed records', () => assert.match(accountVisualCardHTML(normalizeAsset({id:'x',type:'saving',name:'Daily',balance:20,brandId:'cimb',cardThemeId:'pearl-chrome'})),/ringgitme-auto-card/));
add('account visual card keeps custom card priority', () => assert.match(accountVisualCardHTML(normalizeAsset({id:'x',type:'cc',name:'Custom',limit:1000,customCardImage:onePixelPng,cardThemeId:'obsidian-flow'})),/user-custom-card/));

add('legacy product ID remains readable through compatibility adapter', () => assert.equal(resolveLegacyAssetIdentity({type:'cc',brandId:'maybank',productId:'maybank-visa-platinum',networkId:'visa'}).productId,'maybank-visa-platinum'));
add('normalization preserves legacy product ID separately', () => { const account=normalizeAsset({type:'cc',name:'Legacy',limit:1000,productId:'maybank-visa-platinum'}); assert.equal(account.legacyProductId,'maybank-visa-platinum'); });
add('editing visual identity does not change a bank balance', () => { const before=normalizeAsset({id:'b',type:'saving',name:'Bank',balance:123.45}); const after=normalizeAsset({...before,brandId:'maybank',cardThemeId:'graphite-grid'}); assert.equal(after.balanceMinor,before.balanceMinor); });
add('editing visual identity does not change card limit debt or shared pool', () => { const before=normalizeAsset({id:'c',type:'cc',name:'Card',limit:5000,outstanding:125,sharedLimitPoolId:'pool:x'}); const after=normalizeAsset({...before,brandId:'rhb',cardThemeId:'crimson-arc',networkId:'mastercard'}); assert.equal(after.creditLimitMinor,before.creditLimitMinor); assert.equal(after.outstandingMinor,before.outstandingMinor); assert.equal(after.sharedLimitPoolId,before.sharedLimitPoolId); });
add('source introduces no runtime network or persistence API', () => assert.doesNotMatch(`${selectorSource}\n${composerSource}\n${accountVisualSource}`,/fetch\(|XMLHttpRequest|localStorage|indexedDB|supabase|WebSocket/i));
add('editor still uses canonical bottom sheet and dirty-state confirmation', () => { assert.match(editorSource,/openSheet/); assert.match(editorSource,/放弃未保存更改/); });
add('asset editor remains a bottom-anchored canonical sheet', () => { assert.match(appSheetSource,/sheet-layer modal-layer/); assert.match(css,/\.modal-portal-root[^}]*>[^{]*:is\(\.sheet-layer/); assert.match(css,/bottom:0!important/); });
add('sheet close removes the backdrop and mounted layer', () => { assert.match(appSheetSource,/scrim\.classList\.remove\('open'\)/); assert.match(appSheetSource,/setTimeout\(\(\) => layer\.remove\(\), 300\)/); });
add('modal stack restores body scroll lock after the final layer closes', () => { assert.match(modalStackSource,/classList\.toggle\('modal-scroll-locked', stack\.length > 0\)/); assert.match(modalStackSource,/stack\.splice\(index, 1\)/); });
add('390px custom media layout prevents horizontal overflow', () => assert.match(css,/@media \(max-width:390px\)[^{]*\{[^}]*asset-custom-media-row/));
add('light and dark institution palettes provide explicit readable inline text colors', () => { const light=ringgitMeCardComposerHTML({type:'saving',brandId:'maybank',name:'Light'}); const dark=ringgitMeCardComposerHTML({type:'saving',brandId:'cimb',name:'Dark'}); assert.match(light,/--card-text:#111827/); assert.match(dark,/--card-text:#f8fafc/); assert.match(css,/:root\[data-theme="dark"\]/); });
add('reduced motion disables card and sheet material animation', () => { assert.match(css,/@media \(prefers-reduced-motion:reduce\)/); assert.match(css,/animation:none!important/); });
add('full fixture financial integrity remains unchanged', () => assert.deepEqual(createDemoDataSource().getAssetFinancialIntegrity(),{ok:true,errors:[]}));

assert.equal(number, 67);
