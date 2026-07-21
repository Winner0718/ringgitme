import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bankAccountLastFour, formatBankAccountNumber, formatCardLastFour,
  normalizeAsset, normalizeBankAccountNumber, validateOptionalBankAccountNumber,
  validateOptionalLastFour,
} from '../src/domain/assetFinancialModel.js';
import { ringgitMeCardComposerHTML } from '../src/components/RinggitMeCardComposer.js';
import { createAssetIdentityDraft, assetIdentityFieldsHTML } from '../src/features/assets/AssetIdentitySelector.js';
import { resolveInstitutionCardPalette } from '../src/domain/accountCardSystem.js';
import { getBrand } from '../src/domain/brandRegistry.js';
import { archiveCustomInstitution, createCustomInstitution, customInstitutionDirectoryTestHooks, getCustomInstitution, listCustomInstitutions, restoreCustomInstitution } from '../src/domain/customInstitutionDirectory.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const formSource = read('src/features/assets/AssetManagementSheets.js');
const detailSource = read('src/features/assets/detail.js');
const pickerSource = read('src/components/PickerSheet.js');
const pickerCss = read('src/styles/design-system.css');
const cardCss = read('src/styles/design-system.css');
let number = 0;
const add = (title, fn) => test(`2D1B4-${String(++number).padStart(3, '0')} ${title}`, fn);

const bank = { type: 'saving', name: 'UOB Debit Card', displayName: 'UOB Debit Card', brandId: 'uob', bank: 'UOB', bankAccountNumber: '1234 5678-9', debitCardLast4: '0000', balance: 100000 };
const credit = { type: 'cc', name: 'Maybank Visa', displayName: 'Maybank Visa', brandId: 'maybank', bank: 'Maybank', creditCardLast4: '9910', networkId: 'visa', limit: 100000 };

add('bank account preserves leading zeros as text', () => assert.equal(normalizeBankAccountNumber(' 0012 0034-0000 '), '0012 0034-0000'));
add('bank account never parses into a number', () => assert.equal(normalizeBankAccountNumber('0000000001'), '0000000001'));
add('bank account allows spaces and hyphens', () => assert.equal(validateOptionalBankAccountNumber('1234 5678-90'), '1234 5678-90'));
add('bank account rejects alphabetic input', () => assert.throws(() => validateOptionalBankAccountNumber('AB-123'), /数字、空格或连字符/));
add('bank account last four ignores visual grouping', () => assert.equal(bankAccountLastFour('1234 5678-0000'), '0000'));
add('open privacy state shows full stored bank account', () => assert.equal(formatBankAccountNumber('1234 5678-0000'), '1234 5678-0000'));
add('closed privacy state masks bank account to last four', () => assert.equal(formatBankAccountNumber('1234 5678-0000', { privacy: true }), '•••• 0000'));
add('missing bank account creates no fake mask', () => assert.equal(formatBankAccountNumber('', { privacy: true }), ''));
add('debit last four accepts exactly four digits', () => assert.equal(validateOptionalLastFour('0000', '银行卡末四位'), '0000'));
add('debit full-card input is rejected', () => assert.throws(() => validateOptionalLastFour('1234567890123456', '银行卡末四位'), /4 位数字/));
add('credit full-card input is rejected', () => assert.throws(() => validateOptionalLastFour('4111111111111111', '信用卡末四位'), /4 位数字/));
add('open privacy state shows debit last four', () => assert.equal(formatCardLastFour('0000'), '0000'));
add('closed privacy state masks debit last four completely', () => assert.equal(formatCardLastFour('0000', { privacy: true }), '••••'));
add('closed privacy state masks credit last four completely', () => assert.equal(formatCardLastFour('9910', { privacy: true }), '••••'));
add('legacy normalizer keeps full bank number separate from debit digits', () => { const value = normalizeAsset({ ...bank, id: 'bank:privacy' }); assert.equal(value.bankAccountNumber, '1234 5678-9'); assert.equal(value.debitCardLast4, '0000'); });
add('credit normalizer has no bank account number', () => assert.equal(normalizeAsset({ ...credit, id: 'cc:privacy' }).bankAccountNumber, ''));
add('bank editor uses textual bank account field', () => assert.match(formSource, /name="bankAccountNumber" inputmode="text"/));
add('bank editor labels the two independent identifiers', () => { assert.match(formSource, /银行账号（可不填）/); assert.match(formSource, /银行卡末四位（ATM／Debit Card，可不填）/); });
add('credit editor exposes only credit-card last four', () => assert.match(formSource, /信用卡末四位（可不填）/));
add('credit editor has no bank-account form branch', () => assert.match(formSource, /credit\s*\?[^]*信用卡末四位/));
add('asset form validates both card fields strictly before save', () => { assert.match(formSource, /validateOptionalLastFour\(values\.debitCardLast4/); assert.match(formSource, /validateOptionalLastFour\(values\.creditCardLast4/); });
add('details separately render bank account and debit last four', () => { assert.match(detailSource, /'银行账号'/); assert.match(detailSource, /'银行卡末四位'/); });
add('credit details render issuer and card last four without a bank account row', () => { assert.match(detailSource, /'发卡机构'/); assert.match(detailSource, /'信用卡末四位'/); });
add('card layout declares named regions', () => ['identity', 'accountType', 'identifier'].forEach((region) => assert.match(ringgitMeCardComposerHTML(bank), new RegExp(`data-card-region="${region}"`))));
add('bank account occupies lower-left card identifier region', () => assert.match(ringgitMeCardComposerHTML(bank), /data-card-region="identifier">1234 5678-9/));
add('bank card digits are upper-right metadata not lower-left bank account', () => assert.match(ringgitMeCardComposerHTML(bank), /data-card-region="cardLastFour">0000/));
add('privacy card masks the bank account and debit digits immediately', () => { const html = ringgitMeCardComposerHTML(bank, { privacy: true }); assert.match(html, /data-card-region="identifier">•••• 6789/); assert.match(html, /data-card-region="cardLastFour">••••/); });
add('credit card has upper-right card last four and no lower-left account number', () => { const html = ringgitMeCardComposerHTML(credit); assert.match(html, /data-card-region="cardLastFour">9910/); assert.match(html, /data-card-region="identifier"><\/span>/); });
add('eWallet has no account/card/network decoration', () => { const html = ringgitMeCardComposerHTML({ type: 'ew', name: 'TNG', brandId: 'tng' }); assert.doesNotMatch(html, /data-card-region="cardLastFour"/); assert.doesNotMatch(html, /data-card-region="network"/); });
add('card grid uses bounded upper-right track', () => assert.match(cardCss, /grid-template-columns:minmax\(0,1fr\) minmax\(60px,auto\)/));
add('card metadata uses ellipsis to prevent long-name collision', () => assert.match(cardCss, /ringgit-card-account-type b[^}]*text-overflow:ellipsis/));
add('picker keeps custom institution add action in its fixed footer API', () => { assert.match(pickerSource, /footerOptions/); assert.match(pickerSource, /picker-footer-action/); assert.match(pickerCss, /\.picker-footer[^}]*position:sticky/); });
add('desktop picker remains horizontally centred while anchored to the viewport bottom', () => { assert.match(pickerCss, /\.picker-layer\.open > \.picker-sheet[^}]*bottom:0!important/); assert.match(pickerCss, /\.picker-layer\.open > \.picker-sheet[^}]*transform:translateX\(-50%\)!important/); });
add('identity picker passes custom creation through footer actions', () => { const html = assetIdentityFieldsHTML(createAssetIdentityDraft({ type: 'saving', name: 'A' }, 'saving')); assert.match(html, /选择银行/); assert.match(read('src/features/assets/AssetIdentitySelector.js'), /footerOptions:/); });
add('custom institutions are reusable by stable id during the session', () => { customInstitutionDirectoryTestHooks.reset(); const custom = createCustomInstitution({ entityType: 'bank', displayName: 'Test Custom Bank' }); assert.match(custom.id, /^custom-bank-/); assert.equal(createAssetIdentityDraft({ type: 'saving', name: 'A', brandId: custom.id }, 'saving').brandId, custom.id); });
add('an in-use custom institution can be archived without breaking its account identity', () => { customInstitutionDirectoryTestHooks.reset(); const custom = createCustomInstitution({ entityType: 'bank', displayName: 'Archive Bank' }); archiveCustomInstitution(custom.id, { accounts: [{ brandId: custom.id }] }); assert.equal(getCustomInstitution(custom.id).status, 'archived'); assert.equal(listCustomInstitutions({ entityTypes: 'bank' }).length, 0); assert.equal(listCustomInstitutions({ entityTypes: 'bank', includeArchived: true })[0].id, custom.id); });
add('archived custom institutions can be restored to future picker choices', () => { customInstitutionDirectoryTestHooks.reset(); const custom = createCustomInstitution({ entityType: 'bank', displayName: 'Restore Bank' }); archiveCustomInstitution(custom.id); restoreCustomInstitution(custom.id); assert.equal(getCustomInstitution(custom.id).status, 'custom'); assert.equal(listCustomInstitutions({ entityTypes: 'bank' })[0].id, custom.id); });
add('custom-institution management exposes archive and restore for in-use records', () => { const source = read('src/features/assets/AssetIdentitySelector.js'); assert.match(source, /data-custom-archive/); assert.match(source, /data-custom-restore/); });
add('custom institution editor retains optional secondary name and notes', () => { const source = read('src/features/assets/AssetIdentitySelector.js'); assert.match(source, /公司／品牌名称（可不填）/); assert.match(source, /简称（可不填）/); assert.match(source, /name="notes"/); });
add('GXBank palette is black/deep rather than orange', () => { assert.equal(getBrand('gxbank').fallback, '#141118'); assert.notEqual(resolveInstitutionCardPalette({ brandId: 'gxbank' }).primary, '#f15a29'); });
add('source remains free of runtime persistence and network client additions', () => assert.doesNotMatch(`${formSource}\n${detailSource}\n${pickerSource}`, /(?:localStorage|indexedDB)\s*[.(]|fetch\(|new\s+XMLHttpRequest|supabase\./i));

assert.equal(number, 41);
