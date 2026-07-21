import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACCOUNT_CARD_SYSTEM_VERSION, SUPPORTED_CARD_NETWORK_IDS, accountTypeLabel,
  cardNetworkLabel, cardNetworkTypography, normalizeCardNetworkId,
  resolveInstitutionCardPalette,
} from '../src/domain/accountCardSystem.js';
import { ringgitMeCardComposerHTML } from '../src/components/RinggitMeCardComposer.js';
import { accountVisualCardHTML } from '../src/components/AccountVisualCard.js';
import { customCardGuideHTML, copyCustomCardGuidePrompt } from '../src/components/CustomCardGuideSheet.js';
import { CUSTOM_CARD_CHATGPT_PROMPT, CUSTOM_CARD_GUIDE_SAFETY, CUSTOM_CARD_GUIDE_STEPS } from '../src/domain/customCardGuide.js';
import { normalizeAsset } from '../src/domain/assetFinancialModel.js';
import {
  assetIdentityFieldsHTML, assetIdentityMediaFieldsHTML, assetIdentityPrimaryFieldsHTML,
  assetIdentitySelectorTestHooks, createAssetIdentityDraft,
} from '../src/features/assets/AssetIdentitySelector.js';
import { createDemoDataSource } from '../src/fixtures/demoData.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const read = (relative) => fs.readFileSync(path.join(appRoot, relative), 'utf8');
const selectorSource = read('src/features/assets/AssetIdentitySelector.js');
const composerSource = read('src/components/RinggitMeCardComposer.js');
const editorSource = read('src/features/assets/AssetManagementSheets.js');
const accountVisualSource = read('src/components/AccountVisualCard.js');
const labSource = read('src/design-system/DesignSystemLab.js');
const guideSource = `${read('src/components/CustomCardGuideSheet.js')}\n${read('src/domain/customCardGuide.js')}`;
const css = `${read('src/styles/design-system.css')}\n${read('src/styles/phase2d1a.css')}`;
const documentation = `${read('docs/RINGGITME_ACCOUNT_CARD_SYSTEM.md')}\n${read('docs/RINGGITME_LIQUID_CHROME_IOS_DESIGN_CONTRACT.md')}`;
const onePixelPng = { dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', fileName:'custom.png', mimeType:'image/png', sizeBytes:68, width:1, height:1 };
let number = 0;
const add = (title, fn) => test(`2D1B3-${String(++number).padStart(3, '0')} ${title}`, fn);

add('automatic card system has a stable version', () => assert.match(ACCOUNT_CARD_SYSTEM_VERSION,/phase2d1b3/));
add('exact supported network set is Visa Mastercard and Amex', () => assert.deepEqual(SUPPORTED_CARD_NETWORK_IDS,['visa','mastercard','amex']));
add('American Express aliases normalize safely', () => { assert.equal(normalizeCardNetworkId('american-express'),'amex'); assert.equal(normalizeCardNetworkId('AMEX'),'amex'); });
add('unsupported old network becomes unspecified', () => assert.equal(normalizeCardNetworkId('unionpay'),null));
add('closed Visa label is only Visa', () => assert.equal(cardNetworkLabel('visa'),'Visa'));
add('closed Mastercard label is only Mastercard', () => assert.equal(cardNetworkLabel('mastercard'),'Mastercard'));
add('closed Amex label is only American Express', () => assert.equal(cardNetworkLabel('amex'),'American Express'));
add('unspecified network label is explicit', () => assert.equal(cardNetworkLabel(null),'未指定'));
add('Visa typography is text', () => assert.deepEqual(cardNetworkTypography('visa').lines,['VISA']));
add('Mastercard typography is text', () => assert.deepEqual(cardNetworkTypography('mastercard').lines,['Mastercard']));
add('American Express typography uses two lines', () => assert.deepEqual(cardNetworkTypography('amex').lines,['AMERICAN','EXPRESS']));
add('account type labels remain canonical', () => assert.deepEqual(['saving','ew','cc'].map(accountTypeLabel),['储蓄','电子钱包','信用卡']));

add('same institution always resolves the same palette', () => assert.deepEqual(resolveInstitutionCardPalette('maybank'),resolveInstitutionCardPalette('maybank')));
add('different institutions resolve independently', () => assert.notEqual(resolveInstitutionCardPalette('maybank').primary,resolveInstitutionCardPalette('cimb').primary));
add('unknown institution has deterministic fallback', () => assert.deepEqual(resolveInstitutionCardPalette('unknown'),resolveInstitutionCardPalette('unknown')));
add('automatic palette provides primary supporting highlight and lowlight', () => ['primary','supporting','highlight','lowlight','text','muted'].forEach((key)=>assert.ok(resolveInstitutionCardPalette('rhb')[key],key)));
add('automatic card carries institution-palette renderer identity', () => assert.match(ringgitMeCardComposerHTML({type:'saving',brandId:'maybank',name:'工资账户'}),/data-card-system="institution-palette"/));
add('user display name is the primary card copy', () => assert.match(ringgitMeCardComposerHTML({type:'saving',brandId:'maybank',name:'工资账户'}),/<strong>工资账户<\/strong>/));
add('institution remains secondary card copy', () => assert.match(ringgitMeCardComposerHTML({type:'saving',brandId:'maybank',name:'工资账户'}),/ringgit-card-meta[^]*Maybank/));
add('open bank last four occupies the upper-right metadata region', () => assert.match(ringgitMeCardComposerHTML({type:'saving',brandId:'maybank',name:'工资账户',debitCardLast4:'0012'}),/data-card-region="cardLastFour">0012/));
add('closed credit-card last four is fully hidden in the upper-right metadata region', () => assert.match(ringgitMeCardComposerHTML({type:'cc',brandId:'cimb',name:'旅行信用卡',creditCardLast4:'2211'},{privacy:true}),/data-card-region="cardLastFour">••••/));
add('legacy theme ID never changes automatic output', () => { const base={type:'cc',brandId:'cimb',name:'旅行信用卡',networkId:'mastercard'}; assert.equal(ringgitMeCardComposerHTML({...base,cardThemeId:'pearl-chrome'}),ringgitMeCardComposerHTML({...base,cardThemeId:'obsidian-flow'})); });

add('Visa renders as unframed text on system card', () => { const html=ringgitMeCardComposerHTML({type:'cc',brandId:'maybank',name:'主卡',networkId:'visa'}); assert.match(html,/data-card-network-text="visa"[^]*>VISA</); assert.doesNotMatch(html,/network_mark|<img[^>]+visa/i); });
add('Mastercard renders as unframed text on system card', () => { const html=ringgitMeCardComposerHTML({type:'cc',brandId:'maybank',name:'主卡',networkId:'mastercard'}); assert.match(html,/data-card-network-text="mastercard"[^]*>Mastercard</); assert.doesNotMatch(html,/network_mark|<img[^>]+mastercard/i); });
add('American Express renders as two text lines', () => { const html=ringgitMeCardComposerHTML({type:'cc',brandId:'maybank',name:'主卡',networkId:'amex'}); assert.match(html,/>AMERICAN<\/b><b>EXPRESS</); assert.doesNotMatch(html,/network_mark|<img[^>]+amex/i); });
add('unspecified network renders no network copy', () => assert.doesNotMatch(ringgitMeCardComposerHTML({type:'cc',brandId:'maybank',name:'主卡'}),/data-card-network-text/));
add('eWallet ignores even a legacy network value', () => assert.doesNotMatch(ringgitMeCardComposerHTML({type:'ew',brandId:'tng',name:'日常钱包',networkId:'visa'}),/data-card-network-text|VISA/));
add('network typography CSS has no frame background border or shadow', () => assert.match(css,/\.ringgit-card-network-text[^}]*background:none[^}]*border:0[^}]*box-shadow:none/));
add('composer source does not request a network image', () => assert.doesNotMatch(composerSource,/network_mark|networkRegistry|AssetVisual.*network/i));

add('new bank draft starts without institution or network', () => { const draft=createAssetIdentityDraft(null,'saving'); assert.equal(draft.brandId,''); assert.equal(draft.networkId,''); });
add('bank flow exposes optional network and no product or theme picker', () => { const html=assetIdentityFieldsHTML(createAssetIdentityDraft(null,'saving')); assert.match(html,/asset-network/); assert.doesNotMatch(html,/asset-product|asset-theme|卡面风格/); });
add('credit-card flow exposes optional network and no product or theme picker', () => { const html=assetIdentityFieldsHTML(createAssetIdentityDraft(null,'cc')); assert.match(html,/asset-network/); assert.doesNotMatch(html,/asset-product|asset-theme|卡面风格/); });
add('eWallet flow exposes no network picker', () => assert.doesNotMatch(assetIdentityFieldsHTML(createAssetIdentityDraft(null,'ew')),/asset-network|卡组织/));
add('all three flows expose a user-defined name', () => ['saving','cc','ew'].forEach((type)=>assert.match(assetIdentityPrimaryFieldsHTML(createAssetIdentityDraft(null,type)),/name="name"/)));
add('bank flow supports all three requested networks', () => assert.deepEqual(assetIdentitySelectorTestHooks.supportedNetworkIds('saving'),['visa','mastercard','amex']));
add('credit-card flow supports all three requested networks', () => assert.deepEqual(assetIdentitySelectorTestHooks.supportedNetworkIds('cc'),['visa','mastercard','amex']));
add('eWallet flow supports no networks', () => assert.deepEqual(assetIdentitySelectorTestHooks.supportedNetworkIds('ew'),[]));
add('legacy unsupported network is preserved but hidden', () => { const draft=createAssetIdentityDraft({type:'cc',name:'Old',networkId:'unionpay'},'cc'); assert.equal(draft.networkId,''); assert.equal(draft.legacyNetworkId,'unionpay'); });
add('legacy Amex maps into simplified selector', () => assert.equal(createAssetIdentityDraft({type:'cc',name:'Old',networkId:'american-express'},'cc').networkId,'amex'));

add('form hierarchy begins with identity and ends media after financial fields', () => { const primary=editorSource.indexOf('${assetIdentityPrimaryFieldsHTML(identityDraft)}'); const fields=editorSource.indexOf('${identifierFields}${financial}'); const media=editorSource.indexOf('${assetIdentityMediaFieldsHTML(identityDraft)}'); assert.ok(primary>=0 && primary<fields && fields<media); });
add('form renders exactly one card preview owner', () => assert.equal((assetIdentityFieldsHTML(createAssetIdentityDraft(null,'cc')).match(/data-asset-card-preview/g)||[]).length,1));
add('preview container has no nested tonal frame', () => assert.match(css,/\.asset-card-composer-preview[^}]*padding:0[^}]*background:transparent[^}]*box-shadow:none/));
add('media controls identify system sources without filenames', () => { const html=assetIdentityMediaFieldsHTML(createAssetIdentityDraft(null,'saving')); assert.match(html,/使用系统 Logo/); assert.match(html,/使用系统卡面/); assert.doesNotMatch(html,/fileName|\.png|\.jpg|\.webp/); });
add('custom Logo status is user-facing without filename', () => { const draft=createAssetIdentityDraft({type:'saving',name:'A',customLogo:onePixelPng},'saving'); const html=assetIdentityMediaFieldsHTML(draft); assert.match(html,/使用自定义 Logo/); assert.doesNotMatch(html,/custom\.png/); });
add('custom card status is user-facing without filename', () => { const draft=createAssetIdentityDraft({type:'saving',name:'A',customCardImage:onePixelPng},'saving'); const html=assetIdentityMediaFieldsHTML(draft); assert.match(html,/使用自定义卡面/); assert.doesNotMatch(html,/custom\.png/); });
add('restore-system actions are available for both custom sources', () => { const draft=createAssetIdentityDraft({type:'saving',name:'A',customLogo:onePixelPng,customCardImage:onePixelPng},'saving'); const html=assetIdentityMediaFieldsHTML(draft); assert.match(html,/恢复系统 Logo/); assert.match(html,/恢复系统卡面/); });

add('complete custom card takes renderer priority', () => assert.match(ringgitMeCardComposerHTML({type:'cc',brandId:'maybank',name:'Private',networkId:'visa',customCardImage:onePixelPng}),/data-card-renderer="user-custom-card"/));
add('complete custom card has only supplied visual markup', () => { const html=ringgitMeCardComposerHTML({type:'cc',brandId:'maybank',name:'Private',networkId:'visa',customCardImage:onePixelPng}); assert.match(html,/ringgit-card-custom-image/); assert.doesNotMatch(html,/ringgit-card-brand|ringgit-card-copy|ringgit-card-network|ringgit-card-material|>VISA<|>Maybank<|>Private</); });
add('custom card preserves contain geometry and natural aspect', () => assert.match(css,/\.ringgit-card-custom-image[^}]*object-fit:contain/));
add('account visual uses automatic composer for every ordinary account', () => assert.match(accountVisualCardHTML(normalizeAsset({id:'b',type:'saving',name:'Daily',brandId:'cimb',balance:10})),/ringgitme-auto-card/));
add('account visual keeps complete custom card priority', () => assert.match(accountVisualCardHTML(normalizeAsset({id:'c',type:'cc',name:'Custom',limit:1000,customCardImage:onePixelPng})),/user-custom-card/));

add('help entry is available from all three media flows', () => ['saving','cc','ew'].forEach((type)=>assert.match(assetIdentityMediaFieldsHTML(createAssetIdentityDraft(null,type)),/如何制作自定义卡面/)));
add('one shared guide component owns all flows', () => { assert.match(selectorSource,/openCustomCardGuide/); assert.equal((selectorSource.match(/openCustomCardGuide/g)||[]).length,2); });
add('guide includes exactly eight user steps', () => assert.equal(CUSTOM_CARD_GUIDE_STEPS.length,8));
add('guide markup renders every exact step', () => CUSTOM_CARD_GUIDE_STEPS.forEach((step)=>assert.match(customCardGuideHTML(),new RegExp(step.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')))));
add('guide renders physical-card safety warning', () => { assert.match(customCardGuideHTML(),/不要拍摄或上传自己的实体银行卡/); assert.match(customCardGuideHTML(),/真实卡号、姓名、有效期或 CVV/); assert.equal(CUSTOM_CARD_GUIDE_SAFETY.includes('实体银行卡'),true); });
add('copy button has the exact required label', () => assert.match(customCardGuideHTML(),/>复制 ChatGPT 提示词<\/button>/));
add('canonical copied prompt contains all eleven rules', () => { for(let i=1;i<=11;i+=1) assert.match(CUSTOM_CARD_CHATGPT_PROMPT,new RegExp(`\\n${i}\\.`)); });
add('copy action copies the full prompt and emits exact toast', async () => { let copied=''; let feedback=''; const result=await copyCustomCardGuidePrompt({clipboard:{writeText:async(text)=>{copied=text;return {ok:true,method:'test'};}},notify:(message)=>{feedback=message;}}); assert.equal(result.ok,true); assert.equal(copied,CUSTOM_CARD_CHATGPT_PROMPT); assert.equal(feedback,'已复制，可前往 ChatGPT 使用'); });
add('guide source has no runtime network or external upload', () => assert.doesNotMatch(guideSource,/fetch\(|XMLHttpRequest|WebSocket|FormData\([^)]*upload|supabase/i));

add('normalization preserves legacy theme metadata', () => assert.equal(normalizeAsset({type:'saving',name:'Old',balance:1,cardThemeId:'graphite-grid'}).cardThemeId,'graphite-grid'));
add('normalization preserves legacy product metadata', () => assert.equal(normalizeAsset({type:'cc',name:'Old',limit:1000,productId:'maybank-visa-platinum'}).legacyProductId,'maybank-visa-platinum'));
add('normalization preserves legacy network separately', () => assert.equal(normalizeAsset({type:'cc',name:'Old',limit:1000,network:'UnionPay'}).legacyNetworkId,'UnionPay'));
add('normalization preserves custom Logo media', () => assert.equal(normalizeAsset({type:'saving',name:'A',balance:1,customLogo:onePixelPng}).customLogo.dataUrl,onePixelPng.dataUrl));
add('normalization preserves custom complete-card media', () => assert.equal(normalizeAsset({type:'saving',name:'A',balance:1,customCardImage:onePixelPng}).customCardImage.dataUrl,onePixelPng.dataUrl));
add('editing identity metadata does not change bank balance', () => { const before=normalizeAsset({id:'b',type:'saving',name:'A',balance:123.45}); const after=normalizeAsset({...before,brandId:'maybank',networkId:'visa',customLogo:onePixelPng}); assert.equal(after.balanceMinor,before.balanceMinor); });
add('editing identity metadata does not change card debt or limit', () => { const before=normalizeAsset({id:'c',type:'cc',name:'A',limit:5000,outstanding:125}); const after=normalizeAsset({...before,brandId:'cimb',networkId:'amex',customCardImage:onePixelPng}); assert.equal(after.creditLimitMinor,before.creditLimitMinor); assert.equal(after.outstandingMinor,before.outstandingMinor); });
add('full fixture financial integrity remains valid', () => assert.deepEqual(createDemoDataSource().getAssetFinancialIntegrity(),{ok:true,errors:[]}));

add('active form has no CVV PIN expiry cardholder or full-card field', () => assert.doesNotMatch(`${selectorSource}\n${editorSource}`,/name="(?:cvv|pin|expiry|cardholder|cardNumber|creditCardNumber|pan)"/i));
add('old theme names are absent from active selector Lab and composer', () => assert.doesNotMatch(`${selectorSource}\n${labSource}\n${composerSource}`,/珍珠镀铬|黑曜流光|午夜蓝|绯红弧线|Pearl Chrome|Obsidian Flow/));
add('network images are absent from active selector and composer', () => assert.doesNotMatch(`${selectorSource}\n${composerSource}`,/asset-visual-slot-network-mark|slotType:\s*['"]network_mark/));
add('form code adds no network persistence or authentication API', () => assert.doesNotMatch(`${selectorSource}\n${composerSource}\n${accountVisualSource}\n${guideSource}`,/fetch\(|XMLHttpRequest|localStorage|indexedDB|supabase|WebSocket|authenticate/i));
add('390px media controls stack without horizontal overflow', () => assert.match(css,/@media \(max-width:390px\)[^{]*\{[^}]*asset-custom-media-row/));
add('documentation records all nine locked product rules', () => ['catalogues','user-defined','deterministically','retired','typography','custom card','temporary system assets','official website','physical bank cards'].forEach((phrase)=>assert.match(documentation,new RegExp(phrase,'i'))));

assert.equal(number, 74);
