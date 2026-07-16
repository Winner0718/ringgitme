// Browser automation can verify the attachment implementation and the visible
// picker trigger, but a driver that cannot operate the native file chooser is
// a device-verification limitation rather than an application failure.
export const ATTACHMENT_NATIVE_FILE_PICKER_VERDICT = Object.freeze({
  unsupportedAutomation: 'ATTACHMENT NATIVE FILE PICKER: USER DEVICE VERIFICATION REQUIRED',
  unsupportedAutomationBlocksRelease: false,
  implementationFailureBlocksRelease: true,
});

export function classifyAttachmentPickerVerification({ automationSupported, implementationPassed }) {
  if (!implementationPassed) return 'release_blocking_implementation_failure';
  if (!automationSupported) return 'user_device_verification_required';
  return 'verified';
}
