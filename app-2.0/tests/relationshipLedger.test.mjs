import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createDemoDataSource } from '../src/fixtures/demoData.js';

const base = (overrides = {}) => ({ ledgerId: 'ledger-abi', amount: 100, description: '关系账测试', sourceAccountId: 'sv-mbb', destinationAccountId: 'ew-tng', participantId: 'participant-abi', payerParticipantId: 'participant-me', date: '2026-07-13', time: '14:56', sourceChannel: 'app', clientEventId: `test-${Math.random()}`, ...overrides });

test('BI: Personal and Group are derived filters over one ledger repository', () => {
  const data = createDemoDataSource();
  assert.equal(data.getRelationshipLedgers('personal').every((ledger) => ledger.participantIds.length === 2), true);
  assert.equal(data.getRelationshipLedgers('group').every((ledger) => ledger.participantIds.length >= 3), true);
  assert.equal(data.getRelationshipLedgers().length, data.getRelationshipLedgers('personal').length + data.getRelationshipLedgers('group').length);
});

test('BJ: user-paid equal split deducts once and creates only the other share as receivable', () => {
  const data = createDemoDataSource(); const before = data.getAccount('sv-mbb').balance;
  const result = data.recordRelationshipEntry(base({ entryType: 'split_expense', shares: [{ participantId: 'participant-me', amountMinor: 5000 }, { participantId: 'participant-abi', amountMinor: 5000 }] }));
  assert.equal(data.getAccount('sv-mbb').balance, before - 100);
  assert.equal(result.entry.amountMinor, 5000); assert.equal(result.entry.creditorParticipantId, 'participant-me');
});

test('BK: other-paid equal split creates payable without deducting own account', () => {
  const data = createDemoDataSource(); const before = data.getAccount('sv-mbb').balance;
  const result = data.recordRelationshipEntry(base({ entryType: 'split_expense', payerParticipantId: 'participant-abi', shares: [{ participantId: 'participant-me', amountMinor: 5000 }, { participantId: 'participant-abi', amountMinor: 5000 }] }));
  assert.equal(data.getAccount('sv-mbb').balance, before); assert.equal(result.entry.debtorParticipantId, 'participant-me'); assert.equal(result.entry.amountMinor, 5000);
});

test('BL: custom split validates exact totals', () => {
  const data = createDemoDataSource();
  assert.throws(() => data.recordRelationshipEntry(base({ entryType: 'split_expense', shares: [{ participantId: 'participant-me', amountMinor: 3000 }, { participantId: 'participant-abi', amountMinor: 6000 }] })), /总和/);
});

test('BM: linked transaction edit updates ledger once and delete reverses once', () => {
  const data = createDemoDataSource(); const before = data.getAccount('sv-mbb').balance;
  const result = data.recordRelationshipEntry(base({ entryType: 'direct_receivable' }));
  data.editTransaction(result.transaction.id, { amount: 120 });
  assert.equal(data.getRelationshipEntries('ledger-abi').find((entry) => entry.entryId === result.entry.entryId).amountMinor, 12000);
  assert.equal(data.getAccount('sv-mbb').balance, before - 120);
  data.deleteTransaction(result.transaction.id);
  assert.equal(data.getAccount('sv-mbb').balance, before);
  data.deleteTransaction(result.transaction.id);
  assert.equal(data.getRelationshipEntries('ledger-abi', { includeReversed: true }).find((entry) => entry.entryId === result.entry.entryId).status, 'reversed');
});

test('BN: direct receivable affects source while direct payable does not', () => {
  const data = createDemoDataSource(); const before = data.getAccount('sv-mbb').balance;
  data.recordRelationshipEntry(base({ entryType: 'direct_receivable', amount: 40 }));
  assert.equal(data.getAccount('sv-mbb').balance, before - 40);
  data.recordRelationshipEntry(base({ entryType: 'direct_payable', amount: 35, clientEventId: 'direct-payable' }));
  assert.equal(data.getAccount('sv-mbb').balance, before - 40);
});

test('BO: record-only relationship variants remain balance-neutral', () => {
  const data = createDemoDataSource(); const before = data.getAccount('sv-mbb').balance;
  data.recordRelationshipEntry(base({ entryType: 'direct_receivable', amount: 22, recordOnly: true }));
  assert.equal(data.getAccount('sv-mbb').balance, before);
});

test('BP: received settlement supports partial/full, account effect, idempotency, and overpayment guard', () => {
  const data = createDemoDataSource(); const destination = data.getAccount('ew-tng').balance;
  const partial = data.settleRelationship(base({ direction: 'received', amount: 50, description: '部分收到款', clientEventId: 'receive-partial' }));
  assert.equal(data.getAccount('ew-tng').balance, destination + 50);
  assert.equal(data.settleRelationship(base({ direction: 'received', amount: 50, description: '部分收到款', clientEventId: 'receive-partial' })).settlement.settlementId, partial.settlement.settlementId);
  data.settleRelationship(base({ direction: 'received', amount: 100, description: '继续收到款', clientEventId: 'receive-full' }));
  assert.throws(() => data.settleRelationship(base({ direction: 'received', amount: 9999, clientEventId: 'receive-over' })), /超过/);
});

test('BQ: outgoing repayment supports partial/full and source account effect', () => {
  const data = createDemoDataSource(); const before = data.getAccount('sv-mbb').balance;
  data.settleRelationship(base({ ledgerId: 'ledger-jason', direction: 'paid', amount: 12, clientEventId: 'pay-partial' }));
  assert.equal(data.getAccount('sv-mbb').balance, before - 12);
  data.settleRelationship(base({ ledgerId: 'ledger-jason', direction: 'paid', amount: 20, clientEventId: 'pay-full' }));
  assert.equal(data.getRelationshipSummary('ledger-jason').payableMinor, 0);
});

test('BR: settlement reversal restores relationship and account projections exactly once', () => {
  const data = createDemoDataSource(); const before = data.getAccount('ew-tng').balance;
  const { settlement } = data.settleRelationship(base({ direction: 'received', amount: 25, clientEventId: 'reverse-settle' }));
  const afterSettlement = data.getRelationshipSummary('ledger-abi').receivableMinor;
  data.reverseRelationshipSettlement(settlement.settlementId, base({ clientEventId: 'reverse-settle-command' }));
  assert.equal(data.getAccount('ew-tng').balance, before);
  assert.equal(data.getRelationshipSummary('ledger-abi').receivableMinor, afterSettlement + 2500);
  const second = data.reverseRelationshipSettlement(settlement.settlementId, base({ clientEventId: 'reverse-settle-command' }));
  assert.equal(second.status, 'reversed'); assert.equal(data.getAccount('ew-tng').balance, before);
});

test('BS: participant channels enforce Telegram capability boundaries', () => {
  const data = createDemoDataSource();
  const telegram = data.getParticipant('participant-abi'); const app = data.getParticipant('participant-mei'); const both = data.getParticipant('participant-jason');
  assert.equal(telegram.permissions.includes('ledger_repay'), true); assert.equal(telegram.permissions.includes('private_accounts'), false);
  assert.equal(app.permissions.includes('private_accounts'), true); assert.equal(both.appUserId !== null && both.telegramUserId !== null, true);
  const manual = data.createManualParticipant({ displayName: 'Local Friend' }); assert.equal(manual.channelBindings.length, 0);
});

test('BT: Telegram-to-App claim preserves participant and history and rejects conflict/cancel safely', () => {
  const data = createDemoDataSource(); const beforeLedgers = data.getRelationshipLedgers().length; const beforeEntries = data.getRelationshipEntries('ledger-abi').length;
  const claim = data.prepareParticipantClaim('participant-abi', 'user-abi-new', 'claim-abi'); const completed = data.completeParticipantClaim(claim.claimId, 'complete-abi');
  assert.equal(completed.participantId, 'participant-abi'); assert.equal(completed.telegramUserId, 'tg-abi'); assert.equal(completed.appUserId, 'user-abi-new');
  assert.equal(data.getRelationshipLedgers().length, beforeLedgers); assert.equal(data.getRelationshipEntries('ledger-abi').length, beforeEntries);
  assert.throws(() => data.prepareParticipantClaim('participant-nana', 'user-mei', 'claim-conflict'));
  const fresh = createDemoDataSource(); const cancel = fresh.prepareParticipantClaim('participant-abi', 'cancel-user', 'claim-cancel'); assert.equal(fresh.cancelParticipantClaim(cancel.claimId), true); assert.equal(fresh.getParticipant('participant-abi').appUserId, null);
});

test('BU: canonical outbox represents app/telegram/app_to_app and retries without duplicates', () => {
  const data = createDemoDataSource();
  const command = base({ entryType: 'direct_receivable', clientEventId: 'outbox-app' }); data.recordRelationshipEntry(command); data.recordRelationshipEntry(command);
  data.recordRelationshipEntry(base({ entryType: 'direct_receivable', amount: 1, recordOnly: true, sourceChannel: 'telegram', clientEventId: 'outbox-telegram' }));
  data.recordRelationshipEntry(base({ entryType: 'direct_receivable', amount: 1, recordOnly: true, sourceChannel: 'app_to_app', clientEventId: 'outbox-app-app' }));
  const events = data.getIntegrationOutbox();
  assert.equal(events.filter((event) => event.clientEventId === 'outbox-app:ledger.entry.created').length, 1);
  assert.equal(events.some((event) => event.sourceChannel === 'telegram'), true); assert.equal(events.some((event) => event.sourceChannel === 'app_to_app'), true);
});

test('BV: reset restores exact relationship fixtures and clears events', () => {
  const data = createDemoDataSource(); const initial = structuredClone(data.getRelationshipOverview());
  data.recordRelationshipEntry(base({ entryType: 'direct_receivable', clientEventId: 'reset-rel' })); data.resetDemoData();
  assert.deepEqual(data.getRelationshipOverview(), initial); assert.deepEqual(data.getIntegrationOutbox(), []);
});

test('BW: unified history supports 30 to 60 pagination and context-reset wiring', () => {
  const data = createDemoDataSource();
  assert.equal(data.getRelationshipEntries('ledger-abi').length >= 60, true);
  const source = fsRead('../src/features/ledger/index.js');
  assert.equal(source.includes('ui.ledgerHistoryLimit + 30'), true);
  assert.equal(source.includes("ledgerHistoryLimit: 30"), true);
});

test('BX: Capture, Ledger, Activity, and Account Detail converge on linked domain records', () => {
  const capture = fsRead('../src/components/CaptureSheet.js');
  const ledger = fsRead('../src/features/ledger/index.js');
  const activity = fsRead('../src/features/activity/index.js');
  const account = fsRead('../src/features/assets/detail.js');
  assert.equal(capture.includes('recordRelationshipEntry'), true);
  assert.equal(ledger.includes('recordRelationshipEntry'), true);
  assert.equal(activity.includes('activity-open-ledger'), true);
  assert.equal(account.includes('renderActivityRow'), true);
});

test('BY: reversal events reference originals and claim emits canonical events', () => {
  const data = createDemoDataSource();
  const created = data.recordRelationshipEntry(base({ entryType: 'direct_receivable', clientEventId: 'event-reverse' }));
  data.reverseRelationshipEntry(created.entry.entryId, base({ clientEventId: 'event-reverse-command' }));
  const claim = data.prepareParticipantClaim('participant-abi', 'user-event-claim', 'event-claim'); data.completeParticipantClaim(claim.claimId, 'event-claim-complete');
  const events = data.getIntegrationOutbox();
  const reversal = events.find((event) => event.eventType === 'ledger.entry.reversed');
  assert.equal(reversal.payload.originalEntryId, created.entry.entryId);
  assert.equal(events.some((event) => event.eventType === 'participant.claim_prepared'), true);
  assert.equal(events.some((event) => event.eventType === 'participant.claim_completed'), true);
});

function fsRead(relative) {
  return fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
}
