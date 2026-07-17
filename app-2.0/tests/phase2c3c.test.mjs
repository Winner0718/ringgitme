import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  cleanPaymentAmountClipboard,
  createPaymentHandoffSession,
  resolveSourceAccountAppCapability,
} from '../src/domain/paymentHandoff.js';
import {
  createRecipientPaymentProfileRepository,
  normalizeRecipientPaymentProfile,
  paymentMethodSnapshot,
} from '../src/domain/recipientPaymentProfiles.js';
import {
  buildRecipientDirectory,
  deterministicExternalRecipientId,
  recipientIdentityForPlan,
} from '../src/domain/recipientDirectory.js';
import {
  MAX_ATTACHMENT_BYTES,
  MAX_POSTING_EVIDENCE_ATTACHMENTS,
  createPostingEvidenceDraftStore,
  validatePostingEvidenceFile,
} from '../src/domain/attachmentRepository.js';
import { createDemoDataSource } from '../src/fixtures/demoData.js';
import { LEDGER_RECURRING_SCENARIO_FIXTURES } from '../src/fixtures/recurringPlanFixtures.js';
import { createRecurringActionDraft } from '../src/domain/recurringActionIdentity.js';
import { deriveRecurringOccurrenceActions } from '../src/domain/recurringOccurrenceActions.js';

const source = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const assistant = source('../src/features/fixed/RecurringOccurrenceActionSheets.js');
const profileSheets = source('../src/features/fixed/RecipientPaymentProfileSheets.js');
const planSheets = source('../src/features/fixed/RecurringPlanSheets.js');
const ledger = source('../src/features/ledger/index.js');
const activity = source('../src/features/activity/index.js');
const attachmentField = source('../src/components/AttachmentField.js');
const icons = source('../src/components/Icons.js');
const appSheet = source('../src/components/AppSheet.js');
const css = source('../src/styles/phase2c3b.css');
const attachmentCss = source('../src/styles/phase2b3a.css');
const postingSource = source('../src/domain/recurringPostingExecutor.js');
const actionIdentitySource = source('../src/domain/recurringActionIdentity.js');
const phase2c3b = source('./phase2c3b.test.mjs');

const now = '2026-07-17T10:00:00+08:00';
const tng = { id: 'ew-tng', type: 'ew', name: "Touch 'n Go eWallet" };
const cimb = { id: 'sv-cimb', type: 'saving', name: 'CIMB OctoSavers', bank: 'CIMB' };
const maybank = { id: 'sv-mbb', type: 'saving', name: 'Maybank 储蓄卡', bank: 'Maybank' };

function bankMethod(overrides = {}) {
  return {
    recipientId: 'recipient-test', displayName: '测试收款人', paymentMethodType: 'bank_account',
    bankCode: 'CIMB', bankDisplayName: 'CIMB', accountHolderName: 'TEST OWNER',
    accountNumber: '0011228899', createdAt: now, updatedAt: now, ...overrides,
  };
}

function variablePosting({ accountId = 'ew-tng', attachment = false, skip = false } = {}) {
  const data = createDemoDataSource();
  const key = skip ? 'fixed_plan:fixed-rent-shared' : 'fixed_plan:fixed-month-end-utilities';
  const plan = data.getCanonicalRecurringPlan(key).plan;
  const occurrence = data.getCanonicalRecurringPlanOccurrences(key, data.today).find((row) => row.monthKey === '2026-07');
  const localOccurrence = skip ? occurrence : { ...occurrence, actualAmountMinor: 21745, amountPending: false, amountState: 'actual', totalAmountMinor: 21745 };
  const actionType = skip ? 'preview_skip_occurrence' : 'prepare_owned_payment';
  const action = deriveRecurringOccurrenceActions({ plan, occurrence: localOccurrence, actorId: 'participant-me' }).find((row) => row.actionType === actionType && row.enabled);
  const account = skip ? null : data.getAccount(accountId);
  const draft = createRecurringActionDraft({
    action, plan, occurrence, actorId: 'participant-me',
    amountMinor: skip ? null : 21745,
    sourceAccountId: account?.id || null,
    sourceAccountKind: account?.type || null,
    occurredAt: now,
    clientEventId: `2c3c-${accountId}-${skip ? 'skip' : 'post'}`,
  });
  const profile = data.getRecipientPaymentProfile('recipient-profile-rent-landlord');
  let attachmentDraftId = 'none';
  let attachmentIds = [];
  if (attachment) {
    attachmentDraftId = '2c3c-draft';
    const item = data.addAttachment({ ownerEntityType: 'recurring_draft', ownerEntityId: attachmentDraftId, name: 'proof.png', mimeType: 'image/png', sizeBytes: 1200, localObjectUrl: 'data:image/png;base64,AA==', category: 'transfer-proof', clientEventId: '2c3c-proof' });
    attachmentIds = [item.attachmentId];
  }
  const command = {
    planId: plan.id,
    occurrenceId: occurrence.id,
    actionDraft: draft,
    expectedPlanRevision: plan.revision,
    expectedOccurrenceRevision: occurrence.revision,
    confirmedAt: now,
    payerAccountId: account?.id || null,
    recipientPaymentMethodId: skip ? null : profile.profileId,
    paymentMethodSnapshot: skip ? null : paymentMethodSnapshot(profile, { recipientId: profile.recipientId, reference: 'Utilities 07/2026' }),
    attachmentDraftId,
    attachmentIds,
  };
  const before = account ? data.getAccount(account.id).balanceMinor : null;
  const result = data.executeRecurringOccurrencePosting(command);
  return { data, plan, occurrence, account, draft, command, before, result, attachmentIds };
}

const cases = [];
const add = (name, fn) => cases.push([name, fn]);

add('2C3C-001 payer and recipient method identities are independent', () => { const h = createPaymentHandoffSession({ sessionId: 'x', payerAccountId: 'ew-tng', recipientPaymentMethodId: 'method-mbb' }).snapshot(); assert.equal(h.payerAccountId, 'ew-tng'); assert.equal(h.recipientPaymentMethodId, 'method-mbb'); });
add('2C3C-002 TNG source with Maybank destination resolves TNG', () => assert.equal(resolveSourceAccountAppCapability(tng).capabilityId, 'tng-ewallet'));
add('2C3C-003 CIMB source with Maybank destination resolves CIMB', () => assert.equal(resolveSourceAccountAppCapability(cimb).capabilityId, 'cimb-octo'));
add('2C3C-004 Maybank source with CIMB destination resolves Maybank', () => assert.equal(resolveSourceAccountAppCapability(maybank).capabilityId, 'maybank-mae'));
add('2C3C-005 cash source has no app action', () => assert.equal(resolveSourceAccountAppCapability({ id: 'cash', type: 'cash', name: '现金' }).available, false));
add('2C3C-006 unsupported source invents no app', () => assert.equal(resolveSourceAccountAppCapability({ id: 'x', type: 'saving', name: 'Unknown Cooperative' }).capabilityId, null));
add('2C3C-007 recipient bank never controls payer app', () => assert.doesNotMatch(assistant, /bankCapabilityForPaymentMethod\(/));
add('2C3C-008 changing source recalculates app label', () => assert.notEqual(resolveSourceAccountAppCapability(tng).actionLabel, resolveSourceAccountAppCapability(cimb).actionLabel));
add('2C3C-009 changing destination leaves payer app unchanged', () => { const before = resolveSourceAccountAppCapability(cimb); const after = resolveSourceAccountAppCapability(cimb); assert.equal(before.capabilityId, after.capabilityId); });
add('2C3C-010 source survives nested sheet state', () => assert.match(assistant, /payerAccountId:\s*session\.sourceAccountId/));
add('2C3C-011 source survives bank-app return session', () => { const h = createPaymentHandoffSession({ sessionId: 'x', payerAccountId: 'sv-cimb' }); h.markLaunch({ opened: true }, now); h.markReturnPrompt(); assert.equal(h.snapshot().payerAccountId, 'sv-cimb'); });
add('2C3C-012 preview command carries selected source', () => assert.match(assistant, /payerAccountId:\s*session\.sourceAccountId/));
add('2C3C-013 execution deducts selected source', () => { const x = variablePosting(); assert.equal(x.data.getAccount('ew-tng').balanceMinor, x.before - 21745); });
add('2C3C-014 success result retains selected source', () => { const x = variablePosting(); assert.equal(x.result.payerAccountId, 'ew-tng'); assert.equal(x.result.payerAccountSnapshot.payerAccountName, "Touch 'n Go eWallet"); });
add('2C3C-015 reversal restores selected source', () => { const x = variablePosting(); x.data.reverseRecurringOccurrencePosting(x.result.postingId); assert.equal(x.data.getAccount('ew-tng').balanceMinor, x.before); });
add('2C3C-016 no hardcoded Maybank fallback remains in assistant', () => assert.doesNotMatch(assistant, /capability\s*=\s*['"]maybank|打开 Maybank App['"]\s*:/));

add('2C3C-017 房东 resolves to a stable external recipient', () => { const d = createDemoDataSource(); const a = d.getRecipientIdentityForPlan('fixed-rent-shared'); const b = d.getRecipientIdentityForPlan('fixed-rent-shared'); assert.equal(a.recipientId, 'recipient-external-landlord'); assert.deepEqual(a, b); });
add('2C3C-018 姐姐 remains a stable relationship recipient', () => { const identity = recipientIdentityForPlan({ id: 'p', recipientId: 'participant-sis', recipientDisplayName: '姐姐' }, { getParticipant: (id) => id === 'participant-sis' ? { participantId: id, displayName: '姐姐' } : null }); assert.equal(identity.kind, 'relationship_person'); });
add('2C3C-019 房东 and 姐姐 never share methods', () => { const d = createDemoDataSource(); assert.notDeepEqual(d.getRecipientPaymentProfiles({ recipientId: 'recipient-external-landlord' }).map((x) => x.profileId), d.getRecipientPaymentProfiles({ recipientId: 'participant-sis' }).map((x) => x.profileId)); });
add('2C3C-020 legacy external adaptation is deterministic', () => assert.equal(deterministicExternalRecipientId({ planId: 'rent', displayName: '房东' }), deterministicExternalRecipientId({ planId: 'rent', displayName: '房东' })));
add('2C3C-021 房租 plan exposes 房东 收款资料', () => assert.match(planSheets, /plan-recipient-profile/));
add('2C3C-022 Kampung plan resolves 姐姐 recipient', () => { const plan = LEDGER_RECURRING_SCENARIO_FIXTURES.find((x) => x.id === 'fixed-family-rent'); assert.equal(recipientIdentityForPlan(plan, { getParticipant: (id) => id === 'participant-sis' ? { participantId: id, displayName: '姐姐' } : null }).recipientId, 'participant-sis'); });
add('2C3C-023 subscription has no irrelevant recipient', () => { const d = createDemoDataSource(); assert.equal(d.getRecipientIdentityForPlan('subscription-netflix'), null); });
add('2C3C-024 recipient with no methods is valid', () => assert.deepEqual(createRecipientPaymentProfileRepository().list({ recipientId: 'empty' }), []));
add('2C3C-025 adding from plan updates directory source', () => { const d = createDemoDataSource(); const id = 'recipient-new-payee'; d.createRecipientPaymentProfile(bankMethod({ recipientId: id, displayName: '新收款人' })); assert.ok(d.getRecipientDirectory().some((x) => x.recipientId === id && x.paymentMethodCount === 1)); });
add('2C3C-026 adding from directory updates profile selection', () => { const d = createDemoDataSource(); const created = d.createRecipientPaymentProfile(bankMethod({ recipientId: 'recipient-route', displayName: 'Route' })); assert.equal(d.getDefaultRecipientPaymentProfile('recipient-route').profileId, created.profileId); });
add('2C3C-027 external payee appears in Ledger directory data', () => { const d = createDemoDataSource(); assert.ok(d.getRecipientDirectory().some((x) => x.recipientId === 'recipient-external-landlord')); });
add('2C3C-028 relationship person page exposes 收款资料', () => assert.match(ledger, /ledger-recipient-payment-profiles/));

add('2C3C-029 new bank editor does not default Maybank', () => assert.match(profileSheets, /bankCode:\s*''/));
add('2C3C-030 bank selection starts at 选择银行', () => assert.match(profileSheets, /选择银行/));
add('2C3C-031 DuitNow optional bank starts 未指定', () => assert.match(profileSheets, /未指定/));
add('2C3C-032 leading zeroes remain strings', () => assert.equal(normalizeRecipientPaymentProfile({ profileId: 'x', ...bankMethod() }).accountNumber, '0011228899'));
add('2C3C-033 bank validation requires selected bank', () => assert.throws(() => normalizeRecipientPaymentProfile({ profileId: 'x', ...bankMethod({ bankCode: '', bankDisplayName: '' }) }), /BANK_DISPLAY_NAME_REQUIRED/));
add('2C3C-034 DuitNow validation requires type and value', () => assert.throws(() => normalizeRecipientPaymentProfile({ profileId: 'x', ...bankMethod({ paymentMethodType: 'duitnow', accountNumber: '', duitNowType: '', duitNowValue: '' }) }), /RECIPIENT_PAYMENT_DESTINATION_REQUIRED/));
add('2C3C-035 custom bank is supported', () => assert.equal(normalizeRecipientPaymentProfile({ profileId: 'x', ...bankMethod({ bankCode: 'OTHER', bankDisplayName: 'Winner Bank', customBankName: 'Winner Bank' }) }).bankDisplayName, 'Winner Bank'));
add('2C3C-036 dirty cancel cannot mutate repository', () => { const r = createRecipientPaymentProfileRepository(); const before = r.getSnapshot(); assert.throws(() => r.create(bankMethod({ bankCode: '', bankDisplayName: '' }))); assert.deepEqual(r.getSnapshot(), before); });
add('2C3C-037 child picker closes before parent editor', () => assert.match(profileSheets, /parentId:\s*editor\.id/));
add('2C3C-038 sticky save footer is reachable', () => assert.match(css, /recipient-profile-editor-footer[\s\S]*position:\s*sticky/));

add('2C3C-039 account copy uses raw destination value', () => assert.match(assistant, /profile\.accountNumber/));
add('2C3C-040 DuitNow copy uses raw destination value', () => assert.match(assistant, /profile\.duitNowValue/));
add('2C3C-041 amount copy is clean decimal', () => assert.equal(cleanPaymentAmountClipboard(85000), '850.00'));
add('2C3C-042 reference has no standard copy action', () => assert.doesNotMatch(assistant, /data-copy-field="reference"/));
add('2C3C-043 recognizable copy icon exists', () => assert.match(icons, /copy:\s*P\(/));
add('2C3C-044 toast is a document-level layer above sheets', () => assert.match(appSheet, /document\.body\.appendChild\(root\)/));
add('2C3C-045 repeated copy reuses one toast timer', () => assert.match(appSheet, /clearTimeout\(toastTimer\)/));

add('2C3C-046 zero evidence attachments is valid', () => assert.equal(createPostingEvidenceDraftStore().listFor('recurring_draft', 'x').length, 0));
add('2C3C-047 PNG evidence can be added', () => { const s = createPostingEvidenceDraftStore(); assert.equal(s.add({ ownerEntityType: 'recurring_draft', ownerEntityId: 'x', name: 'proof.png', mimeType: 'image/png', sizeBytes: 1, clientEventId: 'a' }).kind, 'photo'); });
add('2C3C-048 PDF evidence can be added', () => { const s = createPostingEvidenceDraftStore(); assert.equal(s.add({ ownerEntityType: 'recurring_draft', ownerEntityId: 'x', name: 'proof.pdf', mimeType: 'application/pdf', sizeBytes: 1, clientEventId: 'a' }).kind, 'pdf'); });
add('2C3C-049 unsupported evidence type is rejected', () => assert.throws(() => validatePostingEvidenceFile({ type: 'text/plain', size: 1 }), /只支持/));
add('2C3C-050 oversized evidence is rejected', () => assert.throws(() => validatePostingEvidenceFile({ type: 'image/png', size: MAX_ATTACHMENT_BYTES + 1 }), /10 MB/));
add('2C3C-051 evidence maximum count is five', () => { const s = createPostingEvidenceDraftStore(); for (let i = 0; i < MAX_POSTING_EVIDENCE_ATTACHMENTS; i += 1) s.add({ ownerEntityType: 'recurring_draft', ownerEntityId: 'x', name: `${i}.png`, mimeType: 'image/png', sizeBytes: 1, clientEventId: `a${i}` }); assert.throws(() => s.add({ ownerEntityType: 'recurring_draft', ownerEntityId: 'x', name: 'overflow.png', mimeType: 'image/png', sizeBytes: 1, clientEventId: 'overflow' }), /最多/); });
add('2C3C-052 evidence receives a stable ID', () => { const s = createPostingEvidenceDraftStore(); const x = s.add({ ownerEntityType: 'recurring_draft', ownerEntityId: 'x', name: 'a.png', mimeType: 'image/png', sizeBytes: 1, clientEventId: 'a' }); assert.equal(s.get(x.attachmentId).attachmentId, x.attachmentId); });
add('2C3C-053 draft evidence can be removed and the same file reselected', () => { const s = createPostingEvidenceDraftStore(); const x = s.add({ ownerEntityType: 'recurring_draft', ownerEntityId: 'x', name: 'a.png', mimeType: 'image/png', sizeBytes: 1, clientEventId: 'a' }); s.remove(x.attachmentId); assert.equal(s.countFor('recurring_draft', 'x'), 0); assert.match(attachmentField, /const liveField = root\.querySelector/); assert.match(attachmentField, /liveInput\.value = ''/); });
add('2C3C-054 cancelling draft clears evidence', () => { const s = createPostingEvidenceDraftStore(); s.add({ ownerEntityType: 'recurring_draft', ownerEntityId: 'x', name: 'a.png', mimeType: 'image/png', sizeBytes: 1, clientEventId: 'a' }); s.removeFor('recurring_draft', 'x'); assert.equal(s.countFor('recurring_draft', 'x'), 0); });
add('2C3C-055 discard revokes temporary object URL', () => { const revoked = []; const s = createPostingEvidenceDraftStore({ revokeUrl: (url) => revoked.push(url) }); const x = s.add({ ownerEntityType: 'recurring_draft', ownerEntityId: 'x', name: 'a.png', mimeType: 'image/png', sizeBytes: 1, localObjectUrl: 'blob:test', clientEventId: 'a' }); s.remove(x.attachmentId); assert.deepEqual(revoked, ['blob:test']); });
add('2C3C-056 confirmed posting transfers evidence ownership', () => { const x = variablePosting({ attachment: true }); assert.deepEqual(x.data.getTransactionAttachments(x.result.transactionId).map((a) => a.attachmentId), x.attachmentIds); });
add('2C3C-057 success count uses actual attachment count', () => assert.match(assistant, /attachmentCount:\s*attachmentIds\.length|attachmentCount\}/));
add('2C3C-058 transaction detail exposes evidence section', () => assert.match(activity, /posting-evidence-detail/));
add('2C3C-059 reversed posting retains evidence', () => { const x = variablePosting({ attachment: true }); x.data.reverseRecurringOccurrencePosting(x.result.postingId); assert.equal(x.data.getTransactionAttachments(x.result.transactionId).length, 1); });
add('2C3C-060 replay does not duplicate financial posting', () => { const x = variablePosting({ attachment: true }); const balance = x.data.getAccount('ew-tng').balanceMinor; const replay = x.data.executeRecurringOccurrencePosting(x.command); assert.equal(replay.replayed, true); assert.equal(x.data.getAccount('ew-tng').balanceMinor, balance); });
add('2C3C-061 evidence is absent from economic fingerprint', () => assert.doesNotMatch(actionIdentitySource, /attachmentIds|attachmentDraftId/));
add('2C3C-062 skipped occurrence creates no financial evidence record', () => { const x = variablePosting({ skip: true }); assert.equal(x.result.transactionId, null); assert.deepEqual(x.data.getRecurringOccurrencePosting(x.result.postingId).attachmentIds, []); });
add('2C3C-063 after-post evidence update leaves balance unchanged', () => { const x = variablePosting(); const before = x.data.getAccount('ew-tng').balanceMinor; const a = x.data.addAttachment({ ownerEntityType: 'transaction', ownerEntityId: x.result.transactionId, name: 'later.pdf', mimeType: 'application/pdf', sizeBytes: 1, clientEventId: 'later' }); x.data.setTransactionAttachments(x.result.transactionId, [a.attachmentId]); assert.equal(x.data.getAccount('ew-tng').balanceMinor, before); assert.equal(x.data.getTransaction(x.result.transactionId).attachmentAudit.at(-1).nextCount, 1); });

add('2C3C-064 shared-rent exact posting regression remains', () => assert.match(phase2c3b, /shared rent debits exactly 131200 minor/));
add('2C3C-065 sister repayment exact regression remains', () => assert.match(phase2c3b, /sister repayment debits exact canonical obligation amount/));
add('2C3C-066 subscription exact regression remains', () => assert.match(phase2c3b, /Netflix card outstanding increases 5490/));
add('2C3C-067 variable-bill exact regression remains', () => assert.match(phase2c3b, /variable amount posts 21745/));
add('2C3C-068 Recently Deleted remains wired', () => assert.match(planSheets, /recently-deleted|Deleted/i));
add('2C3C-069 plan detail remains wired', () => assert.match(planSheets, /openPlanDetail/));
add('2C3C-070 direct completion remains available', () => assert.match(assistant, /我已经付好了/));
add('2C3C-071 incomplete bank return creates no posting', () => assert.match(assistant, /payment-return-incomplete[\s\S]*closeSheet/));
add('2C3C-072 focused suite contains all required cases', () => assert.equal(cases.length, 75));
add('2C3C-073 mobile CSS prevents page overflow', () => assert.match(css, /max-width:\s*100%|overflow-x:\s*hidden/));
add('2C3C-074 phase introduces no console warning/error calls', () => [assistant, profileSheets, ledger, attachmentField].forEach((text) => assert.doesNotMatch(text, /console\.(error|warn)\(/)));
add('2C3C-075 controls reserve safe-area/footer space and attachment preview remains interactive', () => {
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(attachmentCss, /attachment-lightbox\.open\s*\{[^}]*pointer-events:\s*auto/s);
});

for (const [name, fn] of cases) test(name, fn);
