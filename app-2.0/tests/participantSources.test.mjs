import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createDemoDataSource } from '../src/fixtures/demoData.js';
import { memberBalances } from '../src/domain/relationshipSelectors.js';

const cmd = (overrides = {}) => ({ ledgerId: 'ledger-japan', amount: 100, description: '参与者测试', sourceAccountId: 'sv-mbb', payerParticipantId: 'participant-me', date: '2026-07-13', time: '12:00', sourceChannel: 'app', clientEventId: `ps-${Math.random()}`, ...overrides });

test('FA: personal ledger participants are exactly the two ledger members', () => {
  const data = createDemoDataSource();
  assert.deepEqual(data.getRelationshipLedger('ledger-mei').participantIds, ['participant-me', 'participant-mei']);
  assert.deepEqual(data.getRelationshipLedger('ledger-japan').participantIds, ['participant-me', 'participant-abi', 'participant-mei', 'participant-jason']);
});

test('FB: payer outside the selected ledger is rejected — stale Abi cannot leak into Mei Ling', () => {
  const data = createDemoDataSource();
  assert.throws(() => data.recordRelationshipEntry(cmd({
    ledgerId: 'ledger-mei', entryType: 'split_expense', payerParticipantId: 'participant-abi',
    shares: [{ participantId: 'participant-me', amountMinor: 5000 }, { participantId: 'participant-mei', amountMinor: 5000 }],
  })), /付款人/);
});

test('FC: any of the four group members can be the payer', () => {
  const data = createDemoDataSource();
  ['participant-abi', 'participant-mei', 'participant-jason'].forEach((payer, index) => {
    const result = data.recordRelationshipEntry(cmd({ entryType: 'split_expense', payerParticipantId: payer, clientEventId: `fc-${index}`, shares: [
      { participantId: 'participant-me', amountMinor: 2500 }, { participantId: payer, amountMinor: 7500 },
    ] }));
    assert.equal(result.entry.creditorParticipantId, payer);
    assert.equal(result.entry.amountMinor, 2500);
  });
});

test('FD: equal split uses only the selected subset of members', () => {
  const data = createDemoDataSource();
  const result = data.recordRelationshipEntry(cmd({ entryType: 'split_expense', amount: 90, shares: [
    { participantId: 'participant-me', amountMinor: 3000 },
    { participantId: 'participant-abi', amountMinor: 3000 },
    { participantId: 'participant-mei', amountMinor: 3000 },
  ] }));
  assert.deepEqual(result.entry.memberBreakdown, [
    { participantId: 'participant-abi', amountMinor: 3000 },
    { participantId: 'participant-mei', amountMinor: 3000 },
  ]);
  assert.equal(result.entry.amountMinor, 6000);
  assert.equal(result.entry.splitParticipantIds.includes('participant-jason'), false);
});

test('FE: custom split still validates exact totals and duplicate/foreign members are refused', () => {
  const data = createDemoDataSource();
  assert.throws(() => data.recordRelationshipEntry(cmd({ entryType: 'split_expense', shares: [
    { participantId: 'participant-me', amountMinor: 4000 }, { participantId: 'participant-abi', amountMinor: 4000 },
  ] })), /总和/);
  assert.throws(() => data.recordRelationshipEntry(cmd({ entryType: 'split_expense', shares: [
    { participantId: 'participant-me', amountMinor: 5000 }, { participantId: 'participant-me', amountMinor: 5000 },
  ] })), /重复/);
  assert.throws(() => data.recordRelationshipEntry(cmd({ entryType: 'split_expense', shares: [
    { participantId: 'participant-me', amountMinor: 5000 }, { participantId: 'participant-nana', amountMinor: 5000 },
  ] })), /属于/);
});

test('FF: group direct debts demand one exact counterparty from the ledger', () => {
  const data = createDemoDataSource();
  const result = data.recordRelationshipEntry(cmd({ entryType: 'direct_receivable', participantId: 'participant-mei', clientEventId: 'ff-ok' }));
  assert.equal(result.entry.debtorParticipantId, 'participant-mei');
  assert.throws(() => data.recordRelationshipEntry(cmd({ entryType: 'direct_receivable', participantId: 'participant-nana', clientEventId: 'ff-foreign' })), /参与者/);
  assert.throws(() => data.recordRelationshipEntry(cmd({ entryType: 'direct_receivable', participantId: 'participant-me', clientEventId: 'ff-self' })), /参与者/);
});

test('FG: per-member balances derive from entries with deterministic rounding', () => {
  const data = createDemoDataSource();
  const balances = memberBalances(data.getRelationshipEntries('ledger-japan'));
  const byId = Object.fromEntries(balances.map((row) => [row.participantId, row.netMinor]));
  assert.equal(byId['participant-abi'], 25000);
  assert.equal(byId['participant-mei'], 25000);
  assert.equal(byId['participant-jason'], 25000 - 4000);
  const exposed = data.getRelationshipMemberBalances('ledger-japan');
  assert.deepEqual(exposed, balances);
});

test('FH: selected category survives relationship save, activity, detail, and edit', () => {
  const data = createDemoDataSource();
  const result = data.recordRelationshipEntry(cmd({ ledgerId: 'ledger-mei', entryType: 'split_expense', catId: 'food', catLabel: '餐饮', description: '', shares: [
    { participantId: 'participant-me', amountMinor: 5000 }, { participantId: 'participant-mei', amountMinor: 5000 },
  ], clientEventId: 'fh-food', description: '鼎泰丰晚餐' }));
  const transaction = data.getTransaction(result.transaction.id);
  assert.equal(transaction.catId, 'food');
  assert.equal(transaction.catLabel, '餐饮');
  assert.equal(data.getTransactionCategoryLabel(transaction), '餐饮');
  assert.equal(data.getActivities().find((item) => item.id === transaction.id).catLabel, '餐饮');
  const edited = data.editTransaction(transaction.id, { amount: 110 });
  assert.equal(edited.catId, 'food');
  assert.equal(edited.catLabel, '餐饮');
  assert.equal(result.entry.catId, 'food');
});

test('FI: empty description falls back to a readable title while category stays intact', () => {
  const data = createDemoDataSource();
  const transaction = data.addTransaction({ kind: 'expense', amount: 15, catId: 'food', catLabel: '餐饮', sourceAccountId: 'sv-mbb', desc: '餐饮', date: '2026-07-13', time: '09:00' });
  assert.equal(transaction.desc, '餐饮');
  assert.equal(transaction.catId, 'food');
  assert.equal(data.getTransactionCategoryLabel(transaction), '餐饮');
});

test('FJ: no hardcoded Abi participant remains in capture or ledger UI sources', () => {
  const capture = read('../src/components/CaptureSheet.js');
  const ledger = read('../src/features/ledger/index.js');
  [capture, ledger].forEach((source) => {
    assert.equal(source.includes('participant-abi'), false);
    assert.equal(source.includes("'Abi'"), false);
  });
  assert.equal(capture.includes('participantIds'), true);
  assert.equal(ledger.includes('participantIds'), true);
});

test('FK: ledger switch handling resets stale payer and split members in capture', () => {
  const capture = read('../src/components/CaptureSheet.js');
  assert.equal(capture.includes('syncRelationLedger'), true);
  assert.equal(capture.includes('changedLedger'), true);
  assert.equal(capture.includes('relationDraft.splitParticipantIds = [...members]'), true);
  assert.equal(capture.includes('relationDraft.customShares = {}'), true);
});

test('FL: group UI derives avatar stack, participant sheet and channel states from members', () => {
  const ledger = read('../src/features/ledger/index.js');
  assert.equal(ledger.includes('avatar-stack'), true);
  assert.equal(ledger.includes('participant-sheet') || ledger.includes('participantSheet'), true);
  assert.equal(ledger.includes('Telegram 已连接'), true);
  assert.equal(ledger.includes('getRelationshipMemberBalances'), true);
});

function read(relative) {
  return fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
}
