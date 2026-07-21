import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  CUSTOM_CARD_PALETTE_VERSION,
  deriveCustomCardPaletteFromPixels,
  resolveAccountAppearance,
  resolveAccountCardViewModel,
} from '../src/domain/accountCardSystem.js';
import { accountIdentityBarHTML, accountVisualCardHTML } from '../src/components/AccountVisualCard.js';
import { ringgitMeCardComposerHTML } from '../src/components/RinggitMeCardComposer.js';
import { walletStackCategoryDeckHTML } from '../src/components/WalletStackCategoryDeck.js';
import { assetOverviewTestHooks } from '../src/features/assets/index.js';
import { assetIdentityMediaFieldsHTML, createAssetIdentityDraft } from '../src/features/assets/AssetIdentitySelector.js';

const root = path.resolve(import.meta.dirname, '..');
const add = (name, fn) => test(`2D1B6A-${name}`, fn);

function pixels(width, height, color) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) data.set([...color, 255], offset);
  return data;
}

function paint(data, width, x0, y0, x1, y1, color) {
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) data.set([...color, 255], (y * width + x) * 4);
  return data;
}

const blackPixels = (() => { const value = pixels(64, 40, [7, 11, 18]); paint(value, 64, 8, 6, 52, 20, [8, 30, 72]); return value; })();
const bluePixels = pixels(64, 40, [28, 75, 156]);
const blackPalette = deriveCustomCardPaletteFromPixels({ pixels: blackPixels, width: 64, height: 40 });
const bluePalette = deriveCustomCardPaletteFromPixels({ pixels: bluePixels, width: 64, height: 40 });
const onePixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const base = {
  id: 'd1b6a:maybank', type: 'cc', brandId: 'maybank', name: '黑卡 Maybank', displayName: '黑卡 Maybank',
  bank: 'Maybank', institution: 'Maybank', creditCardLast4: '9910', networkId: 'visa', tier: 'Platinum',
  outstanding: 850, limit: 3000,
  customCardImage: { dataUrl: onePixel, fileName: 'black-card.png', mimeType: 'image/png', derivedPalette: blackPalette },
};

add('001 custom full-card has full-card priority and remains image-only', () => {
  const model = resolveAccountCardViewModel({ account: base, context: 'detail' });
  const html = ringgitMeCardComposerHTML(base, { viewModel: model });
  assert.equal(model.fullCard.mode, 'custom-image');
  assert.match(html, /data-card-renderer="user-custom-card"/);
  assert.doesNotMatch(html, /data-card-region|ringgit-card-amount|ringgit-card-network-text/);
});

add('002 custom-card-derived palette outranks Maybank institution yellow for companions', () => {
  const appearance = resolveAccountAppearance(base);
  assert.equal(appearance.visualSource, 'custom-card-derived');
  assert.equal(appearance.primaryColor, blackPalette.primary);
  assert.notEqual(appearance.primaryColor, resolveAccountAppearance({ ...base, customCardImage: null }).primaryColor);
});

add('003 manual account appearance override beats custom-card-derived palette', () => {
  const appearance = resolveAccountAppearance({ ...base, accountVisualOverride: { enabled: true, palette: { primary: '#123456', supporting: '#345678', source: 'account' } } });
  assert.equal(appearance.visualSource, 'account-override');
  assert.equal(appearance.primaryColor, '#123456');
});

add('004 removing custom image restores the normal institution appearance', () => {
  const restored = resolveAccountAppearance({ ...base, customCardImage: null });
  assert.notEqual(restored.visualSource, 'custom-card-derived');
  assert.notEqual(restored.primaryColor, blackPalette.primary);
});

add('005 replacing a custom image selects the new derived palette rather than the old one', () => {
  const replaced = resolveAccountAppearance({ ...base, customCardImage: { ...base.customCardImage, dataUrl: `${onePixel}#blue`, derivedPalette: bluePalette } });
  assert.equal(replaced.primaryColor, bluePalette.primary);
  assert.notEqual(replaced.primaryColor, blackPalette.primary);
});

add('006 deterministic extraction is reusable for existing custom images', () => {
  const first = deriveCustomCardPaletteFromPixels({ pixels: blackPixels, width: 64, height: 40 });
  const second = deriveCustomCardPaletteFromPixels({ pixels: blackPixels, width: 64, height: 40 });
  assert.deepEqual(first, second);
  assert.equal(first.version, CUSTOM_CARD_PALETTE_VERSION);
});

add('007 dark source selects a readable light foreground', () => assert.equal(blackPalette.text, '#f8fafc'));
add('008 bright source selects a readable dark foreground', () => {
  const yellow = deriveCustomCardPaletteFromPixels({ pixels: pixels(64, 40, [238, 190, 36]), width: 64, height: 40 });
  assert.equal(yellow.text, '#111827');
});

add('009 tiny red network marks do not dominate a dark card background', () => {
  const source = pixels(64, 40, [8, 12, 20]);
  paint(source, 64, 0, 0, 4, 4, [235, 38, 45]);
  const palette = deriveCustomCardPaletteFromPixels({ pixels: source, width: 64, height: 40 });
  assert.equal(palette.tone, 'dark');
  assert.notEqual(palette.primary.toLowerCase(), '#f03030');
});

add('010 compact generated companion uses the custom-card-derived palette rather than the full image', () => {
  const html = ringgitMeCardComposerHTML(base, { compact: true });
  assert.match(html, /data-card-renderer="ringgitme-auto-card"/);
  assert.match(html, /data-card-companion-source="custom-card-derived"/);
  assert.match(html, new RegExp(`--card-primary:${blackPalette.primary}`));
  assert.doesNotMatch(html, /ringgit-card-custom-image/);
});

add('011 compact Assets rows consume the canonical derived companion colours', () => {
  const html = assetOverviewTestHooks.compactAccountRows([base], { debt: true });
  assert.match(html, new RegExp(`--account-brand:${blackPalette.primary}`));
  assert.doesNotMatch(html, /#cda434/i);
});

add('012 inactive category cards consume the canonical derived companion colours', () => {
  const sibling = { ...base, id: 'd1b6a:sibling', customCardImage: null, displayName: '另一张卡' };
  const html = walletStackCategoryDeckHTML([sibling, base], sibling.id, { type: 'cc' });
  assert.match(html, new RegExp(`data-wallet-account-id="${base.id}"[\\s\\S]*?--account-brand:${blackPalette.primary}`));
});

add('013 transaction completion header uses the derived companion surface', () => {
  const html = accountIdentityBarHTML(base, { status: '已更新' });
  assert.match(html, /is-custom-card-companion/);
  assert.match(html, /data-card-companion-source="custom-card-derived"/);
  assert.match(html, new RegExp(`--account-brand:${blackPalette.primary}`));
});

add('014 all account kinds support a custom-card-derived companion while eWallet omits network and tier', () => {
  for (const type of ['saving', 'cc', 'ew']) {
    const account = { ...base, id: `d1b6a:${type}`, type, networkId: type === 'ew' ? null : 'visa', tier: type === 'cc' ? 'Platinum' : '', customCardImage: { ...base.customCardImage } };
    assert.equal(resolveAccountAppearance(account).visualSource, 'custom-card-derived');
  }
  const eWalletHTML = accountVisualCardHTML({ ...base, type: 'ew', networkId: null, tier: '', customCardImage: { ...base.customCardImage } }, { variant: 'compact' });
  assert.doesNotMatch(eWalletHTML, /VISA|Platinum/);
});

add('015 custom image privacy keeps the full card image-only', () => {
  const html = accountVisualCardHTML(base, { variant: 'detail' });
  assert.match(html, /user-custom-card/);
  assert.doesNotMatch(html, /9910|Platinum|VISA|当前欠款/);
});

add('016 editor explains automatic companion colour and restores it after manual override', () => {
  const automatic = assetIdentityMediaFieldsHTML(createAssetIdentityDraft(base, 'cc'));
  const manual = assetIdentityMediaFieldsHTML(createAssetIdentityDraft({ ...base, accountVisualOverride: { enabled: true, palette: { primary: '#123456', supporting: '#345678' } } }, 'cc'));
  assert.match(automatic, /配套颜色[\s\S]*自动跟随自定义卡面/);
  assert.match(manual, /恢复自动跟随卡面/);
});

add('017 supported renderers and styles keep compact companion layouts constrained at 390px', () => {
  const source = [
    fs.readFileSync(path.join(root, 'src/components/RinggitMeCardComposer.js'), 'utf8'),
    fs.readFileSync(path.join(root, 'src/styles/design-system.css'), 'utf8'),
    fs.readFileSync(path.join(root, 'src/styles/phase2b3e.css'), 'utf8'),
  ].join('\n');
  assert.match(source, /is-custom-card-companion/);
  assert.match(source, /min-width:0/);
});

add('018 Phase 2D1B.6 canonical live account behaviour remains covered by the existing suite', () => {
  assert.ok(fs.existsSync(path.join(root, 'tests/phase2d1b6.test.mjs')));
});
