// Deterministic Phase 2C1 review fixtures. They never create transactions,
// relationship entries, settlements, or account effects.

const createdAt = '2026-01-01T09:00:00+08:00';

export const RECURRING_PLAN_FIXTURES = [
  {
    id: 'fixed-rent-shared', planKind: 'fixed_expense', title: '房租', categoryId: 'home', currency: 'MYR',
    totalAmountMinor: 131200, schedule: { recurrence: 'monthly', dueDay: 7, timezone: 'Asia/Kuala_Lumpur' },
    startDate: '2024-08-31', moveInDate: '2024-08-31', status: 'active', paymentSourceAccountId: 'sv-mbb',
    recipientId: 'recipient-external-landlord', recipientDisplayName: '房东',
    recipientPaymentProfileId: 'recipient-profile-rent-landlord',
    relationship: {
      ledgerId: 'ledger-abi', participantIds: ['participant-me', 'participant-abi'], authenticatedParticipantId: 'participant-me',
      payerParticipantId: 'participant-me', splitMode: 'custom',
      shares: [{ participantId: 'participant-me', amountMinor: 65600 }, { participantId: 'participant-abi', amountMinor: 65600 }],
      relationshipLabel: '与 Abi 分摊',
    },
    recordOnlyDefault: false, note: '两人平分，我先支付完整账单', createdAt, updatedAt: createdAt,
  },
  {
    id: 'subscription-netflix', planKind: 'subscription', title: 'Netflix', categoryId: 'fun', currency: 'MYR',
    totalAmountMinor: 5490, schedule: { recurrence: 'monthly', dueDay: 20, timezone: 'Asia/Kuala_Lumpur' },
    startDate: '2025-11-10', moveInDate: '2025-11-10', status: 'active', paymentSourceAccountId: 'cc-mbb-visa',
    provider: { name: 'Netflix', kind: 'streaming' }, logoRef: 'netflix', recordOnlyDefault: false, note: null, createdAt, updatedAt: createdAt,
  },
  {
    id: 'subscription-icloud', planKind: 'subscription', title: 'iCloud+', categoryId: 'bill', currency: 'MYR',
    totalAmountMinor: 1290, schedule: { recurrence: 'monthly', dueDay: 5, timezone: 'Asia/Kuala_Lumpur' },
    startDate: '2026-01-05', moveInDate: '2026-01-05', status: 'active', paymentSourceAccountId: 'cc-mbb-visa',
    provider: { name: 'iCloud', kind: 'cloud' }, logoRef: 'icloud', recordOnlyDefault: false, note: '200GB', createdAt, updatedAt: createdAt,
  },
  {
    id: 'fixed-insurance-yearly', planKind: 'fixed_expense', title: '年度医疗保险', categoryId: 'health', currency: 'MYR',
    totalAmountMinor: 180000, schedule: { recurrence: 'yearly', dueMonth: 8, dueDay: 18, timezone: 'Asia/Kuala_Lumpur' },
    startDate: '2025-08-18', status: 'active', paymentSourceAccountId: 'sv-mbb', provider: { name: '保险', kind: 'insurance' },
    logoRef: 'insurance', recordOnlyDefault: false, note: '年度保费', createdAt, updatedAt: createdAt,
  },
  {
    id: 'subscription-spotify-paused', planKind: 'subscription', title: 'Spotify', categoryId: 'fun', currency: 'MYR',
    totalAmountMinor: 2390, schedule: { recurrence: 'monthly', dueDay: 28, timezone: 'Asia/Kuala_Lumpur' },
    startDate: '2026-02-28', moveInDate: '2026-02-28', status: 'paused', paymentSourceAccountId: 'ew-tng',
    provider: { name: 'Spotify', kind: 'music' }, logoRef: 'spotify', recordOnlyDefault: false, note: '暂时停用', createdAt, updatedAt: createdAt,
  },
  {
    id: 'fixed-month-end-utilities', planKind: 'fixed_expense', title: '月末水电预算', categoryId: 'bill', currency: 'MYR',
    amountMode: 'variable', estimateAmountMinor: 24000, totalAmountMinor: 24000, schedule: { recurrence: 'monthly', dueDay: 31, timezone: 'Asia/Kuala_Lumpur' },
    startDate: '2026-01-31', status: 'active', paymentSourceAccountId: 'sv-cimb',
    recipientPaymentProfileId: 'recipient-profile-rent-landlord', recordOnlyDefault: false,
    note: '每月最后一天到期', createdAt, updatedAt: createdAt,
  },
  {
    id: 'fixed-stopped-demo', planKind: 'fixed_expense', title: '旧健身房会籍', categoryId: 'health', currency: 'MYR',
    totalAmountMinor: 9900, schedule: { recurrence: 'monthly', dueDay: 12, timezone: 'Asia/Kuala_Lumpur' },
    startDate: '2025-01-12', endDate: '2026-06-12', status: 'stopped', paymentSourceAccountId: 'cc-rhb',
    recordOnlyDefault: false, note: '已结束并保留历史', createdAt, updatedAt: createdAt,
  },
];

// Scenario fixtures are exported for FIX1D selector and journey tests. They
// are intentionally not preloaded into the original Fixed Center snapshot;
// browser journeys create them through the canonical editor so all Phase 2C1
// baseline totals remain byte-for-byte stable.
export const LEDGER_RECURRING_SCENARIO_FIXTURES = [
  {
    id: 'fixed-family-rent', planKind: 'recurring_relationship', title: '老家房租', categoryId: 'home', currency: 'MYR',
    totalAmountMinor: 25000, schedule: { recurrence: 'monthly', dueDay: 16, timezone: 'Asia/Kuala_Lumpur' },
    startDate: '2026-01-16', status: 'active', paymentSourceAccountId: 'sv-mbb', relationshipMode: 'central_collection',
    relationship: {
      relationshipMode: 'central_collection', ledgerId: 'ledger-family', participantIds: ['participant-me', 'participant-sis', 'participant-peng'], authenticatedParticipantId: 'participant-me',
      collectorParticipantId: 'participant-sis', externalPayerParticipantId: 'participant-sis', splitMode: 'equal', shares: [], relationshipLabel: '家人',
    }, recipientId: 'participant-sis', recipientDisplayName: '姐姐', recipientPaymentProfileId: 'recipient-profile-sister-default', recordOnlyDefault: false, note: '姐姐统一收款后支付房东', logoRef: 'home', createdAt, updatedAt: createdAt,
  },
  {
    id: 'fixed-sister-bed-installment', planKind: 'recurring_relationship', title: '床架分期', categoryId: 'home', currency: 'MYR',
    totalAmountMinor: 8333, schedule: { recurrence: 'monthly', dueDay: 18, timezone: 'Asia/Kuala_Lumpur' },
    startDate: '2026-01-18', status: 'active', paymentSourceAccountId: 'sv-mbb', relationshipMode: 'installment_repayment',
    relationship: {
      relationshipMode: 'installment_repayment', ledgerId: 'ledger-sis', participantIds: ['participant-me', 'participant-sis'], authenticatedParticipantId: 'participant-me',
      creditorParticipantId: 'participant-sis', debtorParticipantId: 'participant-me', originalPrincipalMinor: 100000, remainingPrincipalMinor: 50000,
      installmentAmountMinor: 8333, completedInstallments: 6, plannedInstallmentCount: 12, repaymentMethod: 'fixed_monthly', repaymentMonths: 12, finalInstallmentMinor: 8335,
      relationshipLabel: '姐姐',
    }, recipientId: 'participant-sis', recipientDisplayName: '姐姐', recipientPaymentProfileId: 'recipient-profile-sister-default', recordOnlyDefault: false, note: '已还一半，剩余六期', logoRef: 'receipt', createdAt, updatedAt: createdAt,
  },
];

export const RECURRING_OCCURRENCE_FIXTURES = [
  {
    id: 'occurrence:fixed_plan:subscription-icloud:subscription-icloud:2026-07',
    planId: 'subscription-icloud', canonicalSource: { sourceType: 'fixed_plan', sourceId: 'subscription-icloud' },
    periodKey: '2026-07', monthKey: '2026-07', dueDate: '2026-07-05', totalAmountMinor: 1290,
    ownShareMinor: 1290, cashOutflowMinor: 1290, receivableMinor: 0, payableMinor: 0,
    paymentSourceAccountId: 'cc-mbb-visa', relationship: null, recordedStatus: 'paid', postedTransactionId: null,
    relationshipEntryId: null, generatedAt: '2026-07-01T09:00:00+08:00', planRevision: 1, revision: 1,
  },
];
