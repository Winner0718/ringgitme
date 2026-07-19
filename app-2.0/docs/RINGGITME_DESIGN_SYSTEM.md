# RinggitMe Design System

> Phase 2D1A.3 supersedes the former jade visual identity. The authoritative
> contract is now `RINGGITME_LIQUID_CHROME_IOS_DESIGN_CONTRACT.md`. This file
> remains as the accepted Phase 2D1A.2 compatibility record.

## Visual philosophy

RinggitMe is a calm, premium, mobile-first financial product. It uses a mature jade for the primary decision, soft frosted glass for floating controls, and solid or near-solid tonal surfaces wherever money or long-form data must remain crisp. Glass creates hierarchy; it never competes with balances, transaction rows or schedules.

## Ownership

- `src/styles/tokens.css` is the only design-token source.
- `src/styles/design-system.css` owns canonical component presentation and compatibility migration selectors.
- `src/design-system/DesignSystem.js` owns reusable markup roles.
- `src/design-system/designSystemContract.js` is the machine-readable ownership manifest.
- `?designSystem=1` renders the real internal QA component matrix.
- App overlays continue to use `AppSheet`, `PickerSheet`, `DatePickerSheet`, `TimePickerSheet`, `MoneyCalculatorSheet` and the one document-level modal stack.

## Glass and solid content

Use the named `chrome`, `sheet` and `compact` glass recipes only. Top/bottom navigation, sheets, dialogs, menus, segmented controls and sticky action docks may use them. Balances, financial summaries, forms, transaction lists, schedules, AA amounts, debt breakdowns and history use solid or tonal surfaces. Nested content inside a blurred overlay stays solid/tonal to avoid expensive nested blur.

## Buttons

One mature-jade primary action dominates a local decision. Secondary actions use a neutral tonal or glass surface. Tertiary actions are quiet inline controls. Danger is red only at the destructive decision boundary. Every state includes pressed, focus-visible, disabled and loading treatment, with practical 44–48 px touch targets.

## Sheets, dialogs and footers

All Sheets use one portal, scrim, handle, header, scroll body and safe-area-aware action dock. Browser Back and Escape close the top child first. Dirty forms ask before discard. Dialogs use clear consequences and a neutral cancel. Do not paste an opaque white footer beneath a Sheet.

## Calculator and fields

`MoneyCalculatorSheet` is the only reusable calculator engine and visual root. Numeric keys are solid, operators are restrained jade-tonal, equals/apply is primary. Fields use the canonical field body and focus ring. Date/time use the RinggitMe picker system and retain `DD/MM/YYYY` plus 12-hour `AM/PM` display.

## Accessibility and motion

Use semantic buttons/labels, focus-visible, readable contrast, minimum practical touch targets, icon labels and state cues beyond colour. Long Chinese, English and mixed copy wraps. Drag reorder retains its keyboard session. Motion uses token durations and transform/opacity; reduced motion removes non-essential animation.

## Light and dark modes

Light mode uses a calm green-neutral canvas and slightly tonal surfaces instead of pure white everywhere. Dark mode uses deep charcoal-green surfaces, not automatic inversion or a pure-black void. Semantic income, expense, warning and information colours retain meaning in both modes.

## Performance

Avoid nested full-screen `backdrop-filter`, continuously animated blur and large animated shadows. One active blur plane per overlay stack is the target. `@supports` and reduced-transparency fallbacks provide opaque tonal surfaces when blur is unavailable.

## UI IMPLEMENTATION CONTRACT

- Use only canonical RinggitMe Design System components and tokens.
- Do not create page-specific button systems.
- Do not create duplicate Sheet footers.
- Do not create duplicate calculators.
- Do not create local modal/backdrop frameworks.
- Do not introduce arbitrary colors, radii, shadows or blur values.
- Do not hardcode a replacement when a canonical component can be extended.
- When a new feature needs an unsupported visual state:
  1. extend the canonical component;
  2. update the Design System Lab;
  3. update component tests;
  4. migrate all affected callers;
  5. do not create a one-page substitute.

Documented compatibility exceptions are limited to approved asset/card artwork colours, category semantic colours and the pre-existing phased CSS files recorded by the Phase 2D1A.2 static allowlist. New feature work must not add to that allowlist without a reason and a full migration plan.
