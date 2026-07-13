// Capture feature — wires the central ＋ button to the sheet.
// The Capture zone never navigates; it always opens a sheet
// over the current page (blueprint §10).

import { registerCaptureActions } from '../../components/CaptureSheet.js';

export function registerCaptureFeature() {
  registerCaptureActions();
}
