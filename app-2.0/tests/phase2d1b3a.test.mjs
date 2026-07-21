import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ringgitMeCardComposerHTML } from '../src/components/RinggitMeCardComposer.js';
import { accountVisualCardHTML } from '../src/components/AccountVisualCard.js';
import { assetBrandVisualHTML } from '../src/components/AssetBrandVisual.js';
import { resolveInstitutionCardPalette } from '../src/domain/accountCardSystem.js';
import { normalizeAsset } from '../src/domain/assetFinancialModel.js';
import { brandRegistry, getBrand, resolveBrandId } from '../src/domain/brandRegistry.js';
import {
  countCustomInstitutionUsage, createCustomInstitution, customInstitutionDirectoryTestHooks,
  deleteCustomInstitution, getCustomInstitution, listCustomInstitutions, updateCustomInstitution,
} from '../src/domain/customInstitutionDirectory.js';
import { assetIdentityFieldsHTML, assetIdentitySelectorTestHooks, createAssetIdentityDraft } from '../src/features/assets/AssetIdentitySelector.js';
import { createDemoDataSource } from '../src/fixtures/demoData.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const composerSource = read('src/components/RinggitMeCardComposer.js');
const visualSource = read('src/components/AccountVisualCard.js');
const selectorSource = read('src/features/assets/AssetIdentitySelector.js');
const directorySource = read('src/domain/customInstitutionDirectory.js');
const css = read('src/styles/design-system.css');
const docs = read('docs/RINGGITME_ACCOUNT_CARD_SYSTEM.md');
let number = 0;
const add = (title, fn) => test(`2D1B3A-${String(++number).padStart(3, '0')} ${title}`, fn);

function generated(overrides = {}, options = {}) {
  return ringgitMeCardComposerHTML({ type:'cc', brandId:'cimb', name:'日常信用卡', creditCardLast4:'8899', networkId:'mastercard', ...overrides }, options);
}

add('generated card declares canonical region layout', () => assert.match(generated(), /data-card-layout="canonical-regions"/));
for (const region of ['identity','accountType','identifier','network']) add(`${region} region is explicitly named`, () => assert.match(generated(), new RegExp(`data-card-region="${region}"`)));
add('financialValue region is emitted when amount exists', () => assert.match(generated({}, { amountHTML:'<strong>RM 999.00</strong>', amountLabel:'当前欠款' }), /data-card-region="financialValue"/));
add('preview without amount keeps financialValue absent', () => assert.doesNotMatch(generated(), /data-card-region="financialValue"/));
add('account name is inside identity', () => assert.match(generated(), /data-card-region="identity"[^]*<strong>日常信用卡<\/strong>/));
add('institution is secondary identity copy', () => assert.match(generated(), /ringgit-card-meta[^]*CIMB/));
add('account type is upper-right region owner', () => assert.match(generated(), /ringgit-card-account-type[^]*信用卡/));
add('card last four is a dedicated upper-right region owner', () => assert.match(generated(), /data-card-region="cardLastFour">8899/));
add('network and financial value share one lower-right cluster', () => assert.match(css, /ringgit-card-financial[^}]*grid-area:financialValue/));
add('network is above amount by markup order', () => { const html=generated({}, { amountHTML:'<strong>RM 1.00</strong>' }); assert.ok(html.indexOf('data-card-region="network"') < html.indexOf('data-card-region="financialValue"')); });
add('outer account visual has no second type badge', () => assert.doesNotMatch(visualSource, /account-visual-badge/));
add('outer account visual has no second amount overlay', () => assert.doesNotMatch(visualSource, /account-visual-overlay/));
add('canonical system card uses CSS Grid', () => assert.match(css, /ringgit-card-composer\.is-system-card[^}]*grid-template-areas/));
add('identity track is minmax zero beside bounded account metadata', () => assert.match(css, /grid-template-columns:minmax\(0,1fr\) minmax\(60px,auto\)/));
add('identity copy owns min-width zero', () => assert.match(css, /ringgit-card-identity-copy[^}]*min-width:0/));
add('long identity uses one-line ellipsis', () => assert.match(css, /ringgit-card-identity-copy strong[^}]*text-overflow:ellipsis[^}]*white-space:nowrap/));
add('amount is no-wrap', () => assert.match(css, /ringgit-card-amount strong[^}]*white-space:nowrap/));
add('competing columns keep a deterministic gap', () => assert.match(css, /column-gap:12px/));
add('maximum long name remains escaped and present', () => assert.match(generated({name:'这是一个非常非常长的测试账户名称用于几何验证'}), /这是一个非常非常长的测试账户名称用于几何验证/));
add('large amount remains a single financial value', () => assert.match(generated({}, {amountHTML:'<strong>RM 999,999,999.99</strong>'}), /RM 999,999,999\.99/));
add('American Express retains two-line network typography', () => assert.match(generated({networkId:'amex'}), />AMERICAN<\/b><b>EXPRESS</));
add('Visa remains unframed text', () => assert.match(generated({networkId:'visa'}), /data-card-network-text="visa"[^]*VISA/));
add('no network produces no network region', () => assert.doesNotMatch(generated({networkId:null}), /data-card-region="network"/));
add('eWallet produces no network region', () => assert.doesNotMatch(generated({type:'ew',brandId:'tng',networkId:'visa'}), /data-card-region="network"/));
add('detail card passes amount into canonical composer', () => assert.match(accountVisualCardHTML(normalizeAsset({id:'a',type:'saving',name:'Main',brandId:'cimb',balance:123})), /data-card-region="financialValue"/));

add('built-in Logo metadata resolves icon full bleed', () => assert.equal(getBrand('tng').logo.presentation,'icon_full_bleed'));
add('built-in wide Logo metadata resolves wordmark contained', () => assert.equal(getBrand('hsbc').logo.presentation,'wordmark_contained'));
add('ordinary bank symbol resolves contained', () => assert.equal(getBrand('cimb').logo.presentation,'symbol_contained'));
add('full-bleed visual exposes metadata', () => assert.match(assetBrandVisualHTML({brandId:'tng'}), /data-logo-presentation="icon_full_bleed"/));
add('wordmark visual exposes metadata', () => assert.match(assetBrandVisualHTML({brandId:'hsbc'}), /data-logo-presentation="wordmark_contained"/));
add('fill mode uses cover', () => assert.match(css, /data-logo-fit="fill"[^}]*object-fit:cover/));
add('contain mode uses contain', () => assert.match(css, /data-logo-fit="contain"[^}]*object-fit:contain/));
add('full bleed has no forced tile shadow', () => assert.match(css, /data-logo-presentation="icon_full_bleed"[^}]*box-shadow:none!important/));
add('wide geometry deterministically resolves wordmark', () => assert.equal(assetIdentitySelectorTestHooks.resolveAutomaticLogoPresentation({width:400,height:100}), 'wordmark_contained'));
add('opaque square geometry deterministically resolves full bleed', () => assert.equal(assetIdentitySelectorTestHooks.resolveAutomaticLogoPresentation({width:100,height:100,edgeTransparency:.1,opaqueCoverage:.9}), 'icon_full_bleed'));
add('transparent square geometry deterministically resolves contained symbol', () => assert.equal(assetIdentitySelectorTestHooks.resolveAutomaticLogoPresentation({width:100,height:100,edgeTransparency:.8,opaqueCoverage:.3}), 'symbol_contained'));

add('custom directory creates stable id', () => { customInstitutionDirectoryTestHooks.reset(); const row=createCustomInstitution({entityType:'bank',displayName:'Test Bank'}); assert.match(row.id,/^custom-bank-test-bank-1$/); assert.equal(getCustomInstitution(row.id).id,row.id); });
add('custom bank appears in registry', () => { customInstitutionDirectoryTestHooks.reset(); const row=createCustomInstitution({entityType:'bank',displayName:'Reuse Bank'}); assert.ok(brandRegistry({entityTypes:'bank'}).some((brand)=>brand.id===row.id)); });
add('custom eWallet stays in eWallet directory', () => { customInstitutionDirectoryTestHooks.reset(); createCustomInstitution({entityType:'ewallet',displayName:'Pocket'}); assert.equal(listCustomInstitutions({entityTypes:'ewallet'}).length,1); assert.equal(listCustomInstitutions({entityTypes:'bank'}).length,0); });
add('custom identity resolves by stable id', () => { customInstitutionDirectoryTestHooks.reset(); const row=createCustomInstitution({entityType:'bank',displayName:'Stable'}); assert.equal(resolveBrandId(row.id,{entityTypes:'bank'}),row.id); });
add('rename keeps custom id stable', () => { customInstitutionDirectoryTestHooks.reset(); const row=createCustomInstitution({entityType:'bank',displayName:'Before'}); const next=updateCustomInstitution(row.id,{displayName:'After'}); assert.equal(next.id,row.id); assert.equal(next.displayName,'After'); });
add('custom fit mode persists', () => { customInstitutionDirectoryTestHooks.reset(); const row=createCustomInstitution({entityType:'bank',displayName:'Fit',logoPresentationMode:'fill',resolvedLogoPresentation:'icon_full_bleed'}); assert.equal(getCustomInstitution(row.id).logoPresentationMode,'fill'); });
add('custom palette persists', () => { customInstitutionDirectoryTestHooks.reset(); const row=createCustomInstitution({entityType:'bank',displayName:'Palette',palette:{primary:'#123456',supporting:'#654321'}}); assert.equal(getBrand(row.id).palette.primary,'#123456'); });
add('saved institution palette outranks registry fallback', () => { customInstitutionDirectoryTestHooks.reset(); const row=createCustomInstitution({entityType:'bank',displayName:'Palette',palette:{primary:'#123456',supporting:'#654321'}}); assert.equal(resolveInstitutionCardPalette(row.id).primary,'#123456'); });
add('account palette outranks saved institution palette', () => { customInstitutionDirectoryTestHooks.reset(); const row=createCustomInstitution({entityType:'bank',displayName:'Palette',palette:{primary:'#123456',supporting:'#654321'}}); assert.equal(resolveInstitutionCardPalette({brandId:row.id,cardPalette:{primary:'#abcdef',supporting:'#fedcba'}}).primary,'#abcdef'); });
add('usage count is stable by institution id', () => { customInstitutionDirectoryTestHooks.reset(); const row=createCustomInstitution({entityType:'bank',displayName:'Used'}); assert.equal(countCustomInstitutionUsage(row.id,[{brandId:row.id},{catalogInstitutionId:row.id}]),2); });
add('referenced custom institution cannot be deleted', () => { customInstitutionDirectoryTestHooks.reset(); const row=createCustomInstitution({entityType:'bank',displayName:'Used'}); assert.throws(()=>deleteCustomInstitution(row.id,{accounts:[{brandId:row.id}]}),/仍有 1 个账户/); });
add('unused custom institution can be deleted', () => { customInstitutionDirectoryTestHooks.reset(); const row=createCustomInstitution({entityType:'bank',displayName:'Unused'}); assert.equal(deleteCustomInstitution(row.id,{accounts:[]}),true); });
add('built-in institution is outside deletable directory', () => { customInstitutionDirectoryTestHooks.reset(); assert.equal(getCustomInstitution('maybank'),null); });
add('picker footer includes add custom bank action', () => assert.match(selectorSource,/添加自定义银行/));
add('picker footer includes add custom eWallet action', () => assert.match(selectorSource,/添加自定义电子钱包/));
add('picker includes custom management entry', () => assert.match(selectorSource,/管理自定义机构/));
add('custom picker grouping is explicit', () => assert.match(selectorSource,/group:[^\n]*我的自定义/));
add('account records retain stable catalogue institution id', () => assert.match(selectorSource,/catalogInstitutionId: draft\.brandId/));
add('directory is explicitly session-only', () => assert.match(directorySource,/Session-only/));
add('directory introduces no persistence or network API', () => assert.doesNotMatch(directorySource,/(?:localStorage|indexedDB)\s*[.(]|fetch\(|new\s+XMLHttpRequest|supabase\.|new\s+WebSocket/i));

const customCard={dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',fileName:'card.png',mimeType:'image/png',sizeBytes:68,width:1,height:1};
add('complete custom card still contains image only', () => { const html=generated({customCardImage:customCard}); assert.match(html,/user-custom-card/); assert.doesNotMatch(html,/data-card-region/); });
add('custom full-card remains image-only in account visual contexts', () => { const html=accountVisualCardHTML(normalizeAsset({id:'c',type:'cc',name:'Custom',limit:1000,customCardImage:customCard})); assert.match(html,/user-custom-card/); assert.doesNotMatch(html,/account-visual-custom-financial|data-card-region|ringgit-card-amount|ringgit-card-network-text/); });
add('identity metadata changes preserve bank balance', () => { const before=normalizeAsset({id:'b',type:'saving',name:'A',balance:100}); const after=normalizeAsset({...before,brandId:'cimb',logoPresentationMode:'fill',cardPalette:{primary:'#123456',supporting:'#654321'}}); assert.equal(after.balanceMinor,before.balanceMinor); });
add('identity metadata changes preserve card debt', () => { const before=normalizeAsset({id:'c',type:'cc',name:'A',limit:1000,outstanding:200}); const after=normalizeAsset({...before,brandId:'cimb',networkId:'amex'}); assert.equal(after.outstandingMinor,before.outstandingMinor); });
add('fixture financial integrity remains exact', () => assert.deepEqual(createDemoDataSource().getAssetFinancialIntegrity(),{ok:true,errors:[]}));
add('focused source adds no auth persistence or network behavior', () => assert.doesNotMatch(`${composerSource}\n${visualSource}\n${selectorSource}\n${directorySource}`,/(?:localStorage|indexedDB)\s*[.(]|fetch\(|new\s+XMLHttpRequest|supabase\.|authenticate\(|new\s+WebSocket/i));
add('documentation names every canonical region', () => ['identity','accountType','identifier','network','financialValue'].forEach((name)=>assert.match(docs,new RegExp(`\`${name}\``))));
add('documentation records no reload persistence claim', () => assert.match(docs,/reload\/device persistence is not claimed/));
add('editor exposes all three Logo fit controls', () => { const html=assetIdentityFieldsHTML(createAssetIdentityDraft({type:'saving',name:'A',customLogo:{...customCard,fileName:'logo.png'}},'saving')); ['自动','填满','完整显示'].forEach((label)=>assert.match(html,new RegExp(label))); });

assert.equal(number, 68);
