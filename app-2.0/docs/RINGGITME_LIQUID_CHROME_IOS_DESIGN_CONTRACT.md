# RinggitMe Liquid Chrome iOS Design Contract

Version: Phase 2D1A.5
Canonical token owner: `src/styles/tokens.css`
Canonical component presentation owner: `src/styles/design-system.css`
Canonical markup owner: `src/design-system/DesignSystem.js`

## Approved direction

RinggitMe uses a premium iPhone-native visual language made from visibly translucent pearl-white and smoked-neutral glass, polished mirror-silver perimeters, crisp graphite typography and restrained optical depth. Decorative teal/green is not part of the brand or interaction palette. Ordinary opaque white cards with a continuous grey outline are specifically rejected.

The interaction palette is graphite, black, silver, pearl and translucent ice. Green is allowed only for financial or status meaning: income, receivable, positive return, completed/success, available/sufficient, or authentic brand artwork. Red remains semantic for expense, debt, payable, overdue and destructive actions.

## Material hierarchy

Use no more than three obvious depth layers on one screen:

1. Pearl/ice app atmosphere.
2. Readable frosted financial content.
3. Floating Liquid Chrome controls and overlays.

The compatibility component recipes remain `chrome`, `sheet` and `compact`.
Phase 2D1A.4 defines five canonical material roles on top of those owners:

- `canvas`: static pearl/ice spatial light; no animated wallpaper.
- `floating`: top/bottom navigation and high-level control groups; visible alpha layering, 24px blur and 1.18 saturation.
- `content`: finance cards and grouped rows; approximately 0.33–0.62 white alpha, 20px blur and 1.18 saturation.
- `control`: buttons, segmented controls, chips and icon wells; 14px blur and 1.16 saturation.
- `overlay`: Sheets/dialogs; approximately 0.40–0.66 white alpha, 20px blur and 1.12 saturation.

Every recipe has a static near-solid fallback. Nested overlays yield the parent blur plane so mobile Safari never composites redundant full-screen blur layers.

Dense transaction lists, ledger rows, long forms, schedules and payment summaries use the stronger readable frost recipe. They remain translucent enough to belong to the same material family while keeping values sharper than decoration.

## Polished chrome edge

Chrome uses a masked conic perimeter with localized white catches, quiet silver spans and darker metallic lowlights, plus a luminous upper inner edge, subtle lower bevel and shallow contact shadow. A uniform one-pixel grey CSS border is not an acceptable substitute. No texture image, rainbow border, thick black outline or full neon glow is allowed.

The three named edge states are:

- `static`: normal chrome perimeter.
- `priority-orbit`: a continuous silver base rim remains under a complete animated chrome texture. The overlay is a full masked perimeter containing several broad bright, cool and dark reflections—not a single travelling dot. Its angle advances linearly through 360 degrees over 6.4 seconds, so the complete metal reflection field changes on every frame without easing pauses or catch-up jumps. Every component receives a deterministic negative delay so its reflection pattern begins at a different phase.
- `interaction-sweep`: a restrained 720ms edge sweep on press.

Implementation uses a pseudo-element, conic gradient, `-webkit-mask` and `-webkit-mask-composite: xor` for iOS Safari. Unsupported masking retains the static perimeter. Reduced Motion removes the orbit and renders a static highlight.

Only border-only pseudo layers move; blur strength, shadows, layout and ordinary transaction rows remain static. Visible chrome cards and controls may carry staggered edge light, while offscreen content is excluded from painting by the browser. Never use synchronized edge phases.

## Typography

Use the native stack beginning with `-apple-system` and `BlinkMacSystemFont`, followed by SF Pro family names as fallbacks, PingFang SC and common cross-platform system fonts. Never distribute Apple font files.

Money and counters use tabular numerals. Chinese text has no artificial letter spacing. Titles are confident rather than excessively heavy; secondary text must remain legible on glass.

## Components

- Primary actions: near-black/graphite glass, white text, polished edge. Never green.
- Secondary actions: bright frosted neutral glass, graphite text.
- Danger: red text on neutral glass; red fill only for final irreversible confirmation.
- Selected segment/chip/tab: luminous neutral glass or graphite in dark mode; never teal.
- Capture: circular neutral Liquid Chrome with dark/light plus symbol; never green.
- Calculator: neutral glass numbers, silver operators, graphite equals.
- Inputs: neutral translucent bodies with chrome focus ring and crisp placeholders.
- Toggles: graphite active track with bright thumb.
- Sheets/dialogs: one strong glass plane, chrome handle/top edge, readable content and integrated safe-area footer.
- Official bank/wallet/merchant artwork is preserved and may use authentic brand colours.

## iOS bottom Sheet contract

`AppSheet` is the single owner of ordinary application Sheets. It exposes four explicit detents: `compact`, `medium`, `large` and `content`. Every detent is anchored to the bottom edge; a short viewport or keyboard may increase usable height but must never turn a Sheet into a top-attached panel. The active `VisualViewport` sizes the modal layer, `.sheet-body` owns internal scrolling, and `SheetActionDock` owns sticky actions plus `safe-area-inset-bottom`.

Browser Back, Escape and backdrop dismissal always target the top layer. Each Sheet may disable Escape, backdrop or drag dismissal explicitly. Nested children freeze the parent, restore the parent scroll position on close, and restore focus to the exact trigger. Feature CSS may style content but must not invent another Sheet height, scrim, footer, scroll lock or modal stack.

The profile/settings Sheet uses the `medium` detent. Confirmation Sheets use `compact`; Capture and long editors use `large`; short content may use `content`.

## Chrome motion preference

The session-only `ui.chromeMotion` preference defaults to enabled and is reflected by the canonical root attribute `data-chrome-motion="on|off"`. The setting is labelled “镀铬动效” with the explanation “控制边框反射与流动高光”. Turning it off removes ambient full-ring reflection animation, press sweeps and Sheet entrance sweeps immediately while retaining the complete static chrome perimeter, glass fill and inner highlights. No hidden edge animation may continue.

`prefers-reduced-motion: reduce` overrides effective rendering but never overwrites the user preference. The switch remains operable, and the stored in-memory preference resumes when reduced motion is no longer active. This preference is intentionally not persisted to localStorage, IndexedDB or a network service.

## Icons

Generic icons are neutral outline icons from the existing shared owner with rounded caps/joins and consistent 18/20/22/24 sizes. Emoji, downloaded SF Symbols and decorative green icon wells are prohibited. Official logos remain unchanged.

## Light and dark

Light uses pearl white, ice grey and cool silver, with near-black text. It must not contain a mint wash. Dark uses charcoal and smoked glass with soft silver borders; it must not look neon, purple, RGB or pure-black everywhere.

## Accessibility and mobile rules

- Interactive targets are at least 44×44 where practical.
- Use semantic controls, accessible names and `:focus-visible`.
- State is never communicated only by colour.
- Keep safe-area and Visual Viewport keyboard handling.
- Keep long Chinese/mixed text wrapping and 390px layout.
- `prefers-reduced-motion` removes edge orbit and non-essential motion.
- Reduced transparency and no-backdrop-filter states remain readable.

## Correct and incorrect examples

Correct: a Save button uses `rm-button--primary`, whose canonical owner renders graphite with a chrome perimeter. A positive balance uses `--rm-color-success`. A Maybank card preserves its authentic artwork.

Incorrect: a page creates a `.my-green-save` class, uses a raw emerald hex for selection, adds a local blur value, animates every card border, or makes a transaction list transparent.

## Mandatory future-feature contract

- Use only canonical RinggitMe Liquid Chrome components and tokens.
- Do not create page-specific button systems, Sheet footers, calculators or modal/backdrop frameworks.
- Do not introduce arbitrary colours, radii, shadows, blur values or decorative teal/green.
- Do not hardcode a replacement when a canonical component can be extended.
- When a new feature needs an unsupported state: extend the canonical component, update the Design System Lab and tests, migrate all affected callers, and never create a one-page substitute.
