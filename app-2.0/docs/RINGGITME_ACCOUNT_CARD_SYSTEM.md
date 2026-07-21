# RinggitMe Account Card System

## Product contract

1. Official product catalogues are compatibility metadata, not a required user flow. Adding or editing an account never requires an official product selection.
2. Account names are user-defined. The name entered by the user is the main identity everywhere; the institution remains secondary.
3. A single automatic system card is generated deterministically from the selected institution ID and maintained institution palette. It never uses randomness or runtime network access.
4. The eight former user-selectable RinggitMe themes are retired from the active experience. Existing `cardThemeId` values remain readable for rollback compatibility but never control current rendering.
5. Visa, Mastercard and American Express are rendered as application typography with no network image, badge, pill or frame. eWallets have no network selector by default.
6. A complete custom card image has visual priority and suppresses generated Logo, account name, network typography and decorative layers inside the card. A custom Logo replaces only the institution mark on the automatic card.
7. Current institution Logos are temporary system assets referenced through stable institution IDs. Each Logo file can be independently replaced later without changing account records, balances or business logic.
8. The shared “如何制作自定义卡面” guide uses public images from official institution websites as references and provides one canonical ChatGPT prompt.
9. Users must not photograph or upload their own physical bank cards, or any image containing a real card number, name, expiry date or CVV. RinggitMe never collects CVV, PIN, expiry date, cardholder name or a full card number.

## Rendering ownership

- `accountCardSystem.js` owns network normalization, labels, typography and deterministic institution palettes.
- `RinggitMeCardComposer.js` owns automatic and full-custom card markup.
- `AssetIdentitySelector.js` owns institution/network/media selection and compatibility adaptation.
- `CustomCardGuideSheet.js` and `customCardGuide.js` own the shared guide and copied prompt.
- `AccountVisualCard.js` uses the same composer for Assets, category/detail cards and confirmation contexts.

Legacy product, physical-variant, exact-art and theme metadata may remain on records but must not be required, displayed as technical status, or used to override the current automatic/custom card choice.

## Canonical geometry (Phase 2D1B.3A)

Every generated card has one owner and five explicit named regions:

- `identity`: upper-left Logo, user account name, then institution name.
- `accountType`: one compact upper-right label.
- `identifier`: lower-left masked identifier only.
- `network`: unframed network typography immediately above the amount.
- `financialValue`: lower-right network and financial amount cluster.

`RinggitMeCardComposer` owns all five regions through one CSS Grid. Outer
wrappers must not add a second badge, amount overlay, or absolute-positioned
network. Long names truncate inside `min-width: 0` tracks; financial values
never wrap into the identity region.

## Logo presentation

Logo metadata resolves exactly one presentation role:

- `icon_full_bleed` for app-icon-like square artwork.
- `symbol_contained` for a transparent symbol.
- `wordmark_contained` for a wide wordmark.

Custom Logo mode is `auto`, `fill`, or `contain`. Automatic selection is
deterministic from dimensions, alpha coverage, and transparent edges. The
active Logo palette is resolved locally in this order: account override,
saved custom-institution palette, one-time Logo-derived palette, reviewed
registry fallback, neutral fallback. No runtime network lookup is involved.

## Custom institution directory

Custom banks and eWallets receive stable session IDs and are reusable by all
three account editors. They are explicitly user-created and never presented
as verified brands. Directory records are session-only in the current
in-memory architecture; reload/device persistence is not claimed. A referenced
custom institution cannot be deleted until its accounts are reassigned.
