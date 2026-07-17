// Presentation-only payment handoff. It can copy instructions and ask a
// bank-launch adapter to open, but it never confirms payment or mutates money.

function clone(value) {
  return value == null ? value : structuredClone(value);
}

export const PAYMENT_PATHS = Object.freeze({
  HANDOFF: 'payment_assistant',
  ALREADY_PAID: 'already_paid',
});

export const BANK_APP_LAUNCH_REGISTRY = Object.freeze({
  'tng-ewallet': Object.freeze({ capabilityId: 'tng-ewallet', displayName: 'TNG eWallet', actionLabel: '打开 TNG eWallet', launchTarget: null }),
  'maybank-mae': Object.freeze({ capabilityId: 'maybank-mae', displayName: 'Maybank App', actionLabel: '打开 Maybank App', launchTarget: null }),
  'cimb-octo': Object.freeze({ capabilityId: 'cimb-octo', displayName: 'CIMB OCTO App', actionLabel: '打开 CIMB OCTO App', launchTarget: null }),
  'public-bank': Object.freeze({ capabilityId: 'public-bank', displayName: 'Public Bank App', actionLabel: '打开 Public Bank App', launchTarget: null }),
  'rhb-mobile': Object.freeze({ capabilityId: 'rhb-mobile', displayName: 'RHB Mobile Banking App', actionLabel: '打开 RHB Mobile Banking App', launchTarget: null }),
});

const NO_SOURCE_APP = Object.freeze({ capabilityId: null, displayName: null, actionLabel: null, launchTarget: null, available: false });

export function resolveSourceAccountAppCapability(account) {
  if (!account || account.type === 'cash') return NO_SOURCE_APP;
  const name = `${account?.bank || ''} ${account?.name || ''}`.toLowerCase();
  if (account.type === 'ew' && (name.includes('touch') || name.includes('tng'))) return Object.freeze({ ...BANK_APP_LAUNCH_REGISTRY['tng-ewallet'], available: true });
  if (name.includes('maybank')) return Object.freeze({ ...BANK_APP_LAUNCH_REGISTRY['maybank-mae'], available: true });
  if (name.includes('cimb')) return Object.freeze({ ...BANK_APP_LAUNCH_REGISTRY['cimb-octo'], available: true });
  if (name.includes('public bank')) return Object.freeze({ ...BANK_APP_LAUNCH_REGISTRY['public-bank'], available: true });
  if (name.includes('rhb')) return Object.freeze({ ...BANK_APP_LAUNCH_REGISTRY['rhb-mobile'], available: true });
  return NO_SOURCE_APP;
}

// Compatibility alias for existing tests and non-recurring consumers. App
// routing is owned exclusively by the payer account, never the recipient.
export const bankCapabilityForAccount = resolveSourceAccountAppCapability;

export function bankCapabilityForPaymentMethod(method) {
  const explicit = method?.bankAppTarget || method?.launchCapabilityId || null;
  if (explicit && BANK_APP_LAUNCH_REGISTRY[explicit]) return BANK_APP_LAUNCH_REGISTRY[explicit];
  const name = `${method?.bankDisplayName || ''} ${method?.customBankName || ''}`.toLowerCase();
  if (name.includes('maybank')) return BANK_APP_LAUNCH_REGISTRY['maybank-mae'];
  if (name.includes('cimb')) return BANK_APP_LAUNCH_REGISTRY['cimb-octo'];
  if (name.includes('public bank')) return BANK_APP_LAUNCH_REGISTRY['public-bank'];
  if (name.includes('rhb')) return BANK_APP_LAUNCH_REGISTRY['rhb-mobile'];
  return Object.freeze({ capabilityId: null, displayName: '银行 App', launchTarget: null });
}

export function createBrowserBankAppLauncher({
  registry = BANK_APP_LAUNCH_REGISTRY,
  openTarget = (target) => window.open(target, '_self'),
} = {}) {
  return Object.freeze({
    launch(capabilityId) {
      const capability = capabilityId ? registry[capabilityId] : null;
      if (!capability?.launchTarget) {
        return Object.freeze({ attempted: false, opened: false, reason: 'launch_target_unavailable', capabilityId: capabilityId || null });
      }
      try {
        openTarget(capability.launchTarget);
        return Object.freeze({ attempted: true, opened: true, reason: null, capabilityId });
      } catch {
        return Object.freeze({ attempted: true, opened: false, reason: 'launch_failed', capabilityId });
      }
    },
  });
}

export function createClipboardAdapter({
  navigatorRef = typeof navigator === 'undefined' ? null : navigator,
  documentRef = typeof document === 'undefined' ? null : document,
} = {}) {
  async function writeText(text) {
    const payload = String(text ?? '');
    try {
      if (navigatorRef?.clipboard?.writeText) {
        await navigatorRef.clipboard.writeText(payload);
        return Object.freeze({ ok: true, method: 'clipboard' });
      }
    } catch {
      // Fall through to the non-persistent, user-gesture fallback.
    }
    if (!documentRef?.body || typeof documentRef.execCommand !== 'function') {
      return Object.freeze({ ok: false, method: 'unavailable' });
    }
    const field = documentRef.createElement('textarea');
    field.value = payload;
    field.readOnly = true;
    field.setAttribute('aria-hidden', 'true');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    documentRef.body.appendChild(field);
    field.select();
    let copied = false;
    try { copied = Boolean(documentRef.execCommand('copy')); } catch { copied = false; }
    field.remove();
    return Object.freeze({ ok: copied, method: copied ? 'execCommand' : 'unavailable' });
  }
  return Object.freeze({ writeText });
}

export function paymentReferenceFor(profile, { planTitle = '', monthKey = '' } = {}) {
  const template = profile?.defaultReferenceTemplate || planTitle || 'RinggitMe payment';
  return String(template)
    .replaceAll('{{month}}', monthKey ? `${monthKey.slice(5, 7)}/${monthKey.slice(0, 4)}` : '')
    .replaceAll('{{plan}}', planTitle)
    .trim();
}

export function formatPaymentClipboard({ profile, amountText, reference }) {
  return [
    `收款人：${profile.displayName}`,
    `银行：${profile.bankDisplayName}`,
    profile.accountNumber ? `账号：${profile.accountNumber}` : null,
    profile.duitNowValue ? `DuitNow：${profile.duitNowType || ''} ${profile.duitNowValue}`.trim() : null,
    `金额：${amountText}`,
    `参考：${reference}`,
  ].filter(Boolean).join('\n');
}

export function cleanPaymentAmountClipboard(amountMinor) {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) throw new Error('PAYMENT_AMOUNT_MINOR_INVALID');
  return `${Math.floor(amountMinor / 100)}.${String(amountMinor % 100).padStart(2, '0')}`;
}

export function createPaymentHandoffSession({
  sessionId,
  paymentPath = PAYMENT_PATHS.HANDOFF,
  actionType,
  occurrenceId,
  profileId,
  sourceAccountId,
  recipientPaymentMethodId = profileId,
  payerAccountId = sourceAccountId,
  startedAt = null,
} = {}) {
  const state = {
    sessionId: String(sessionId || ''),
    paymentPath,
    actionType: String(actionType || ''),
    occurrenceId: String(occurrenceId || ''),
    recipientPaymentMethodId: recipientPaymentMethodId || null,
    payerAccountId: payerAccountId || null,
    // Deprecated aliases retained for Phase 2C3A/FIX1 snapshot compatibility.
    profileId: recipientPaymentMethodId || null,
    sourceAccountId: payerAccountId || null,
    handoffStartedAt: startedAt,
    launchAttempted: false,
    openedBankApp: false,
    copiedFields: [],
    returnPromptSeen: false,
    completedByUser: false,
  };
  return {
    snapshot: () => Object.freeze(clone(state)),
    setRouting({ payerAccountId, recipientPaymentMethodId } = {}) {
      state.payerAccountId = payerAccountId || null;
      state.sourceAccountId = state.payerAccountId;
      state.recipientPaymentMethodId = recipientPaymentMethodId || null;
      state.profileId = state.recipientPaymentMethodId;
      return this.snapshot();
    },
    markCopied(field) {
      if (!state.copiedFields.includes(field)) state.copiedFields.push(field);
      return this.snapshot();
    },
    markLaunch(result, occurredAt) {
      state.launchAttempted = true;
      state.openedBankApp = Boolean(result?.opened);
      state.handoffStartedAt = occurredAt || state.handoffStartedAt;
      return this.snapshot();
    },
    markReturnPrompt() {
      if (state.returnPromptSeen) return false;
      state.returnPromptSeen = true;
      return true;
    },
    markCompletedByUser() {
      state.completedByUser = true;
      return this.snapshot();
    },
  };
}

export function presentationMetadataForPath(path, handoff = null) {
  return Object.freeze({
    paymentPath: path,
    handoffStartedAt: handoff?.handoffStartedAt || null,
    launchAttempted: Boolean(handoff?.launchAttempted),
    copiedFields: Object.freeze([...(handoff?.copiedFields || [])]),
    returnPromptSeen: Boolean(handoff?.returnPromptSeen),
  });
}

export function createReturnFromBankWatcher({ onReturn, documentRef = document, windowRef = window } = {}) {
  let armed = false;
  let backgroundSeen = false;
  let delivered = false;
  const maybeReturn = () => {
    if (!armed || delivered || !backgroundSeen) return;
    if (documentRef.visibilityState && documentRef.visibilityState !== 'visible') return;
    delivered = true;
    onReturn?.();
  };
  const visibility = () => {
    if (!armed) return;
    if (documentRef.visibilityState === 'hidden') backgroundSeen = true;
    else maybeReturn();
  };
  documentRef.addEventListener('visibilitychange', visibility);
  windowRef.addEventListener('pageshow', maybeReturn);
  windowRef.addEventListener('focus', maybeReturn);
  return Object.freeze({
    arm({ assumeBackground = false } = {}) {
      armed = true;
      backgroundSeen = Boolean(assumeBackground);
    },
    simulateReturnForTest() {
      backgroundSeen = true;
      maybeReturn();
    },
    dispose() {
      documentRef.removeEventListener('visibilitychange', visibility);
      windowRef.removeEventListener('pageshow', maybeReturn);
      windowRef.removeEventListener('focus', maybeReturn);
      armed = false;
    },
    snapshot: () => Object.freeze({ armed, backgroundSeen, delivered }),
  });
}
