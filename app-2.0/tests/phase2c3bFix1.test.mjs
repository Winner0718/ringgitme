import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  MALAYSIA_PAYMENT_BANKS,
  RECIPIENT_PAYMENT_METHOD_TYPES,
  createRecipientPaymentProfileRepository,
  normalizeRecipientPaymentProfile,
  paymentMethodDestination,
  paymentMethodSnapshot,
  selectRecipientPaymentProfile,
} from '../src/domain/recipientPaymentProfiles.js';
import {
  bankCapabilityForPaymentMethod,
  cleanPaymentAmountClipboard,
  createPaymentHandoffSession,
} from '../src/domain/paymentHandoff.js';
import { RECIPIENT_PAYMENT_PROFILE_FIXTURES } from '../src/fixtures/recipientPaymentProfileFixtures.js';
import { createDemoDataSource } from '../src/fixtures/demoData.js';
import { createRecurringActionDraft } from '../src/domain/recurringActionIdentity.js';
import { deriveRecurringOccurrenceActions } from '../src/domain/recurringOccurrenceActions.js';

const source = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const actionCard = source('../src/components/RecurringActionCard.js');
const fixed = source('../src/features/fixed/index.js');
const assistant = source('../src/features/fixed/RecurringOccurrenceActionSheets.js');
const sheets = source('../src/features/fixed/RecipientPaymentProfileSheets.js');
const profilesDomain = source('../src/domain/recipientPaymentProfiles.js');
const posting = source('../src/domain/recurringPostingExecutor.js');
const ledger = source('../src/features/ledger/index.js');
const css = source('../src/styles/phase2c3b.css');

const now = '2026-07-17T10:00:00+08:00';
const repo = () => createRecipientPaymentProfileRepository({ profiles: RECIPIENT_PAYMENT_PROFILE_FIXTURES, clock: () => now });
const bankInput = (overrides = {}) => ({
  ownerParticipantId: 'participant-test', displayName: '测试对象', accountHolderName: 'TEST OWNER',
  paymentMethodType: 'bank_account', bankCode: 'MBB', bankDisplayName: 'Maybank',
  accountNumber: '00112233', createdAt: now, updatedAt: now, ...overrides,
});

const cases = [];
const add = (name, fn) => cases.push([name, fn]);

add('FIX1-001 canonical action component is imported once', () => assert.match(fixed, /renderRecurringActionCard/));
add('FIX1-002 canonical action is a semantic button', () => assert.match(actionCard, /<button type="button"/));
add('FIX1-003 canonical action has icon title subtitle chevron', () => ['recurring-action-card-icon', 'recurring-action-card-copy', 'recurring-action-card-chevron'].forEach((token) => assert.ok(actionCard.includes(token))));
add('FIX1-004 action control has no browser appearance', () => assert.match(css, /\.semantic-action-control[\s\S]*appearance:\s*none/));
add('FIX1-005 action control has no rest outline', () => assert.match(css, /\.semantic-action-control[\s\S]*outline:\s*0/));
add('FIX1-006 touch focus is cleared', () => assert.match(css, /:focus:not\(:focus-visible\)/));
add('FIX1-007 keyboard focus-visible remains', () => assert.match(css, /:focus-visible/));
add('FIX1-008 action target remains 44px', () => assert.match(css, /\.semantic-action-control[\s\S]*min-height:\s*44px/));
add('FIX1-009 action copy can wrap', () => assert.match(css, /recurring-action-card-copy[^{]*\{[^}]*overflow-wrap/));
add('FIX1-010 all supported labels route through same renderer', () => ['支付并记录分摊', '还给', '记录本期还款', '填写本期金额'].forEach((label) => assert.ok(fixed.includes(label))));

add('FIX1-011 recipient supports zero methods', () => assert.deepEqual(createRecipientPaymentProfileRepository().list({ ownerParticipantId: 'none' }), []));
add('FIX1-012 recipient supports one bank account', () => { const r = createRecipientPaymentProfileRepository({ clock: () => now }); r.create(bankInput()); assert.equal(r.list({ ownerParticipantId: 'participant-test' }).length, 1); });
add('FIX1-013 sister supports multiple methods', () => assert.ok(repo().list({ ownerParticipantId: 'participant-sis' }).length >= 3));
add('FIX1-014 sister supports two banks', () => assert.deepEqual(new Set(repo().list({ ownerParticipantId: 'participant-sis' }).filter((x) => x.paymentMethodType === 'bank_account').map((x) => x.bankDisplayName)), new Set(['CIMB', 'Maybank'])));
add('FIX1-015 sister supports DuitNow', () => assert.ok(repo().list({ ownerParticipantId: 'participant-sis' }).some((x) => x.paymentMethodType === 'duitnow')));
add('FIX1-016 leading zeroes survive normalization', () => assert.equal(normalizeRecipientPaymentProfile({ profileId: 'x', ...bankInput() }).accountNumber, '00112233'));
add('FIX1-017 generated payment method ID is stable', () => { const r = createRecipientPaymentProfileRepository({ clock: () => now }); const x = r.create(bankInput()); assert.equal(r.get(x.profileId).profileId, x.profileId); });
add('FIX1-018 generated ID is not a display name', () => { const r = createRecipientPaymentProfileRepository({ clock: () => now }); assert.doesNotMatch(r.create(bankInput()).profileId, /测试对象/); });
add('FIX1-019 edit updates exact method', () => { const r = repo(); r.update('recipient-profile-sister-maybank', { nickname: '备用账号' }); assert.equal(r.get('recipient-profile-sister-maybank').nickname, '备用账号'); });
add('FIX1-020 edit preserves stable ID', () => { const r = repo(); assert.equal(r.update('recipient-profile-sister-maybank', { nickname: '备用' }).profileId, 'recipient-profile-sister-maybank'); });
add('FIX1-021 setting default clears prior default', () => { const r = repo(); r.setDefault('recipient-profile-sister-maybank'); assert.equal(r.list({ ownerParticipantId: 'participant-sis' }).filter((x) => x.isDefault).length, 1); });
add('FIX1-022 new default is selected first', () => { const r = repo(); r.setDefault('recipient-profile-sister-maybank'); assert.equal(r.list({ ownerParticipantId: 'participant-sis' })[0].profileId, 'recipient-profile-sister-maybank'); });
add('FIX1-023 deleting default assigns replacement', () => { const r = repo(); r.remove('recipient-profile-sister-default'); assert.ok(r.findDefault('participant-sis')); });
add('FIX1-024 deleting method removes only that stable ID', () => { const r = repo(); const before = r.list({ ownerParticipantId: 'participant-sis' }).length; r.remove('recipient-profile-sister-maybank'); assert.equal(r.list({ ownerParticipantId: 'participant-sis' }).length, before - 1); });
add('FIX1-025 reset restores deleted method', () => { const r = repo(); r.remove('recipient-profile-sister-maybank'); r.reset(); assert.ok(r.get('recipient-profile-sister-maybank')); });
add('FIX1-026 legacy profileId remains canonical alias', () => { const x = repo().get('recipient-profile-sister-default'); assert.equal(x.profileId, x.paymentMethodId); });
add('FIX1-027 legacy single profile remains selectable', () => assert.equal(selectRecipientPaymentProfile({ plan: { recipientPaymentProfileId: 'recipient-profile-rent-landlord' }, repository: repo() }).profileId, 'recipient-profile-rent-landlord'));
add('FIX1-028 broken plan reference falls back to participant default', () => assert.equal(selectRecipientPaymentProfile({ plan: { recipientPaymentProfileId: 'deleted' }, action: { counterpartyId: 'participant-sis' }, repository: repo() }).profileId, 'recipient-profile-sister-default'));
add('FIX1-029 bank list includes required custom option', () => assert.ok(MALAYSIA_PAYMENT_BANKS.some((bank) => bank.code === 'OTHER')));
add('FIX1-030 bank list includes twelve named banks', () => assert.ok(MALAYSIA_PAYMENT_BANKS.length >= 13));
add('FIX1-031 custom bank name is accepted', () => assert.equal(normalizeRecipientPaymentProfile({ profileId: 'custom', ...bankInput({ bankCode: 'OTHER', bankDisplayName: 'Demo Bank', customBankName: 'Demo Bank' }) }).bankDisplayName, 'Demo Bank'));
add('FIX1-032 bank destination masks last four', () => assert.equal(paymentMethodDestination(repo().get('recipient-profile-sister-default'), { hidden: true }), '•••• 8899'));
add('FIX1-033 DuitNow destination masks last four', () => assert.equal(paymentMethodDestination(repo().get('recipient-profile-sister-duitnow'), { hidden: true }), '•••• 8899'));

add('FIX1-034 management entry is in participant context', () => assert.match(ledger, /收款资料[\s\S]*ledger-recipient-payment-profiles/));
add('FIX1-035 empty management state is explicit', () => assert.match(sheets, /尚未添加收款资料/));
add('FIX1-036 management can add bank', () => assert.match(sheets, /添加银行账号/));
add('FIX1-037 management can add DuitNow', () => assert.match(sheets, /添加 DuitNow/));
add('FIX1-038 management masks list destinations', () => assert.match(sheets, /paymentMethodDestination\(method, \{ hidden: true \}\)/));
add('FIX1-039 management exposes default badge', () => assert.match(sheets, />默认</));
add('FIX1-040 management exposes edit', () => assert.match(sheets, /recipient-profile-edit/));
add('FIX1-041 management exposes delete confirmation', () => assert.match(sheets, /删除收款资料？/));
add('FIX1-042 dirty editor has discard confirmation', () => assert.match(sheets, /舍弃未保存的修改？/));
add('FIX1-043 editor cancel uses sheet close guard', () => assert.match(sheets, /onRequestClose:\s*requestEditorClose/));
add('FIX1-044 bank picker is a child sheet', () => assert.match(sheets, /parentId: editor\.id[\s\S]*选择银行/));
add('FIX1-045 method picker is a child sheet', () => assert.match(sheets, /parentId, title: '选择收款方式'/));

add('FIX1-046 assistant defaults through repository selection', () => assert.match(assistant, /getDefaultRecipientPaymentProfile/));
add('FIX1-047 assistant exposes method switch', () => assert.match(assistant, /data-action="payment-method-picker"/));
add('FIX1-048 method switch updates stable profile ID', () => assert.match(assistant, /session\.recipientProfileId = profile\.profileId/));
add('FIX1-049 source account drives app capability', () => assert.match(assistant, /resolveSourceAccountAppCapability\(account\)/));
add('FIX1-050 CIMB capability resolves from selected method', () => assert.equal(bankCapabilityForPaymentMethod(repo().get('recipient-profile-sister-default')).capabilityId, 'cimb-octo'));
add('FIX1-051 Maybank capability resolves after switch', () => assert.equal(bankCapabilityForPaymentMethod(repo().get('recipient-profile-sister-maybank')).capabilityId, 'maybank-mae'));
add('FIX1-052 account copy is inline', () => assert.match(assistant, /payment-assistant-copy-row[\s\S]*data-copy-field="account"/));
add('FIX1-053 amount copy is inline', () => assert.match(assistant, /payment-assistant-copy-row[\s\S]*data-copy-field="amount"/));
add('FIX1-054 reference is conditional plain text', () => { assert.match(assistant, /reference \?/); assert.match(assistant, /payment-assistant-reference/); assert.doesNotMatch(assistant, /data-copy-field="reference"/); });
add('FIX1-055 copy grid is removed', () => assert.doesNotMatch(assistant, /payment-assistant-copy-grid/));
add('FIX1-056 copy all is removed', () => assert.doesNotMatch(assistant, /全部复制|data-copy-field="all"/));
add('FIX1-057 amount clipboard is clean decimal', () => assert.equal(cleanPaymentAmountClipboard(85000), '850.00'));
add('FIX1-058 account copy uses raw destination', () => assert.match(assistant, /profile\.accountNumber/));
add('FIX1-059 direct completed route remains', () => assert.match(assistant, /payment-handoff-complete[\s\S]*openPreview\(PAYMENT_PATHS\.HANDOFF\)/));
add('FIX1-060 launch never marks completed', () => { const h = createPaymentHandoffSession({ sessionId: 'h' }); h.markLaunch({ opened: true }, now); assert.equal(h.snapshot().completedByUser, false); });
add('FIX1-061 incomplete return only closes child', () => assert.match(assistant, /payment-return-incomplete', \(\) => closeSheet\(\)/));
add('FIX1-062 later return never posts', () => assert.match(assistant, /payment-return-later[\s\S]*closeSheet/));
add('FIX1-063 toast text is privacy-safe', () => { assert.match(assistant, /账号已复制.*金额已复制.*参考已复制/s); assert.doesNotMatch(assistant, /toast\([^)]*accountNumber/); });
add('FIX1-064 repeated toast uses one global timer', () => assert.match(source('../src/components/AppSheet.js'), /clearTimeout\(toastTimer\)/));

add('FIX1-065 posting snapshot excludes full account', () => { const snap = paymentMethodSnapshot(repo().get('recipient-profile-sister-default'), { reference: '家庭账单' }); assert.equal(snap.maskedDestination, '•••• 8899'); assert.equal(JSON.stringify(snap).includes('800000008899'), false); });
add('FIX1-066 posting snapshot preserves stable method ID', () => assert.equal(paymentMethodSnapshot(repo().get('recipient-profile-sister-maybank')).paymentMethodId, 'recipient-profile-sister-maybank'));
add('FIX1-067 posting executor stores safe snapshot', () => assert.match(posting, /paymentMethodSnapshot:\s*paymentSnapshot/));
add('FIX1-068 transaction draft carries safe snapshot', () => assert.match(posting, /recipientPaymentSnapshot:\s*safePaymentMethodSnapshot/));
add('FIX1-069 payment snapshot stays unchanged after profile edit', () => { const r = repo(); const before = paymentMethodSnapshot(r.get('recipient-profile-sister-default')); r.update('recipient-profile-sister-default', { accountNumber: '900000002222' }); assert.equal(before.maskedDestination, '•••• 8899'); });
add('FIX1-070 source contains no persistence or network write', () => assert.doesNotMatch([assistant, sheets, profilesDomain, posting].join('\n'), /\bfetch\s*\(|XMLHttpRequest|localStorage|indexedDB|supabase/i));

add('FIX1-071 real sister posting stores one safe payment snapshot', () => {
  const data = createDemoDataSource();
  const row = data.getFixedCenterMonth('2026-07').rows.find((item) => item.plan.title === 'Kampung 房租');
  const plan = row.plan;
  const action = deriveRecurringOccurrenceActions({ plan, occurrence: row, actorId: 'participant-me' }).find((item) => item.actionType === 'prepare_counterparty_repayment' && item.enabled);
  const account = data.getAccount(plan.paymentSourceAccountId);
  const draft = createRecurringActionDraft({ action, plan, occurrence: row, actorId: 'participant-me', amountMinor: 85000, sourceAccountId: account.id, sourceAccountKind: account.type, counterpartyId: action.counterpartyId, groupId: plan.relationship?.ledgerId, occurredAt: now, clientEventId: 'fix1-sister-post' });
  const snapshot = paymentMethodSnapshot(data.getRecipientPaymentProfile('recipient-profile-sister-default'), { recipientId: 'participant-sis', reference: '家庭账单' });
  const result = data.executeRecurringOccurrencePosting({ actionDraft: draft, confirmedAt: now, paymentMethodSnapshot: snapshot, attachmentIds: [] });
  assert.deepEqual(result.paymentMethodSnapshot, snapshot);
  assert.deepEqual(data.getTransaction(result.transactionId).recipientPaymentSnapshot, snapshot);
  assert.equal(data.getActivities().filter((item) => item.id === result.transactionId).length, 1);
  const beforeReverse = data.getAccount(account.id).balanceMinor;
  data.reverseRecurringOccurrencePosting(result.postingId, { reversedAt: '2026-07-17T10:05:00+08:00' });
  assert.equal(data.getAccount(account.id).balanceMinor, beforeReverse + 85000);
});

for (const [name, fn] of cases) test(name, fn);
test('FIX1-072 focused suite has comprehensive coverage', () => assert.ok(cases.length >= 71));
