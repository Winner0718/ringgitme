# RinggitMe AppSheet Contract

Version: Phase 2D1A.5

## Canonical owner

All ordinary bottom Sheets use `src/components/AppSheet.js`, the document-level modal portal and the existing modal stack. Picker, date, time and money-calculator surfaces retain their specialized interaction owners but adopt the same bottom anchoring, VisualViewport variables and detent metadata.

## Detents

- `compact`: short confirmations and alerts; content height capped at 48% / 420px.
- `medium`: profile settings, menus and pickers; 64% / 620px.
- `large`: Capture, editors, details and payment flows; 92% / 840px.
- `content`: short variable content; natural height capped at 78% / 720px.

All detents use `bottom: 0`. Keyboard appearance expands the active surface inside the current VisualViewport; it never changes the bottom anchor.

## Ownership

- Modal layer: VisualViewport top and height variables.
- Sheet: detent geometry and entrance/exit transform.
- Sheet body: the only vertical content scroll owner.
- Action dock: sticky primary/secondary actions and bottom safe area.
- Modal stack: focus trap, body scroll lock, nested suspension and trigger restoration.
- AppSheet entry: backdrop, Escape and drag dismissal policy.

Feature code may select a detent and dismissal policy. It may not introduce a new fixed top, hardcoded `dvh` height, local body lock, duplicate backdrop or pasted-on footer.

## Interaction rules

Browser Back closes the top child first. Escape and backdrop obey the top entry policy. Dirty-state guards run before unmount. Drag dismissal begins only from the canonical grabber. Closing restores the parent Sheet without changing its scroll position and returns focus to the opening control.

Reduced Motion shortens or removes non-essential Sheet motion. `ui.chromeMotion` controls only Liquid Chrome edge animation and does not change Sheet geometry or financial behavior.
