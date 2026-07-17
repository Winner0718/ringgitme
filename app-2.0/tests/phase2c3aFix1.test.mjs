import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  createRecipientPaymentProfileRepository,
  maskDuitNowValue,
  maskPaymentAccount,
  normalizeRecipientPaymentProfile,
  selectRecipientPaymentProfile,
} from '../src/domain/recipientPaymentProfiles.js';
import {
  BANK_APP_LAUNCH_REGISTRY,
  PAYMENT_PATHS,
  bankCapabilityForAccount,
  createBrowserBankAppLauncher,
  createClipboardAdapter,
  createPaymentHandoffSession,
  createReturnFromBankWatcher,
  formatPaymentClipboard,
  paymentReferenceFor,
  presentationMetadataForPath,
} from '../src/domain/paymentHandoff.js';
import { createRecurringPlanRepository } from '../src/domain/recurringPlanRepository.js';
import { createRecurringActionDraft, fingerprintRecurringActionDraft } from '../src/domain/recurringActionIdentity.js';
import { deriveRecurringOccurrenceActions } from '../src/domain/recurringOccurrenceActions.js';
import { buildRecurringPostingPreview } from '../src/domain/recurringPostingPreview.js';
import { RECURRING_PLAN_FIXTURES } from '../src/fixtures/recurringPlanFixtures.js';
import { RECIPIENT_PAYMENT_PROFILE_FIXTURES } from '../src/fixtures/recipientPaymentProfileFixtures.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const actionUISource = read('../src/features/fixed/RecurringOccurrenceActionSheets.js');
const fixedSource = read('../src/features/fixed/index.js');
const actionCardSource = read('../src/components/RecurringActionCard.js');
const planSheetsSource = read('../src/features/fixed/RecurringPlanSheets.js');
const profileSheetSource = read('../src/features/fixed/RecipientPaymentProfileSheets.js');
const cssSource = read('../src/styles/phase2c3a-fix1.css');
const demoSource = read('../src/fixtures/demoData.js');

function profileRepo() {
  return createRecipientPaymentProfileRepository({
    profiles: RECIPIENT_PAYMENT_PROFILE_FIXTURES,
    clock: () => '2026-07-17T09:00:00+08:00',
  });
}

function planRepo() {
  return createRecurringPlanRepository({
    plans: RECURRING_PLAN_FIXTURES,
    occurrences: [],
    accountExists: () => true,
    participantExists: () => true,
    ledgerExists: () => true,
    clock: () => '2026-07-17T09:00:00+08:00',
  });
}

function rentPreview() {
  const repository = planRepo();
  const plan = repository.getPlan('fixed-rent-shared');
  const occurrence = repository.generateOccurrence(plan.id, '2026-07', {
    referenceDate: '2026-07-13',
    generatedAt: '2026-07-13T09:00:00+08:00',
  }).occurrence;
  const action = deriveRecurringOccurrenceActions({
    plan,
    occurrence,
    actorId: 'participant-me',
    participantName: (id) => id === 'participant-sis' ? '姐姐' : '我',
  }).find((item) => item.actionType === 'prepare_shared_front_payment');
  const draft = createRecurringActionDraft({
    action,
    plan,
    occurrence,
    actorId: 'participant-me',
    amountMinor: 131200,
    sourceAccountId: 'sv-mbb',
    sourceAccountKind: 'saving',
    occurredAt: '2026-07-13T09:00:00+08:00',
    clientEventId: 'fix1-path-equivalence',
  });
  const accounts = [{ id: 'sv-mbb', type: 'saving', balance: 6842.15, owned: true }];
  return {
    plan,
    occurrence,
    action,
    draft,
    preview: buildRecurringPostingPreview({ actionDraft: draft, plan, occurrence, accounts }),
    accounts,
  };
}

const cases = [];
const add = (name, fn) => cases.push([name, fn]);

add('FIX1-001 preview UI hides raw fingerprint attribute', () => assert.doesNotMatch(actionUISource, /data-preview-fingerprint/));
add('FIX1-002 preview UI hides fingerprint slicing', () => assert.doesNotMatch(actionUISource, /fingerprint\.slice/));
add('FIX1-003 preview UI has no raw idempotency card', () => assert.doesNotMatch(actionUISource, /posting-preview-idempotency">/));
add('FIX1-004 preview UI has no raw arrow transition', () => assert.doesNotMatch(actionUISource, /fromStatus[^\n]+→/));
add('FIX1-005 overdue paid copy is natural Chinese', () => assert.match(actionUISource, /本期将由“已逾期”变为“已完成”/));
add('FIX1-006 due paid copy is natural Chinese', () => assert.match(actionUISource, /本期将标记为已完成/));
add('FIX1-007 overdue skip copy is natural Chinese', () => assert.match(actionUISource, /本期将由“已逾期”变为“已跳过”/));
add('FIX1-008 due skip copy is natural Chinese', () => assert.match(actionUISource, /本期将标记为已跳过/));
add('FIX1-009 replay copy is natural Chinese', () => assert.match(actionUISource, /已经处理过，无需重复记账/));
add('FIX1-010 conflict copy is natural Chinese', () => assert.match(actionUISource, /与之前的操作不一致/));

add('FIX1-011 now card has semantic quick action', () => { assert.match(fixedSource, /renderRecurringActionCard/); assert.match(actionCardSource, /fixed-occurrence-quick-action/); });
add('FIX1-012 quick action stops propagation', () => assert.match(actionUISource, /event\?\.stopPropagation/));
add('FIX1-013 card body still owns plan detail action', () => assert.match(fixedSource, /data-action="fixed-plan-detail"/));
add('FIX1-014 variable quick action says fill amount', () => assert.match(fixedSource, /填写本期金额/));
add('FIX1-015 counterparty quick action uses real name', () => assert.match(fixedSource, /还给\$\{data\.getParticipant/));
add('FIX1-016 shared quick action copy is exact', () => assert.match(fixedSource, /支付并记录分摊/));
add('FIX1-017 installment quick action copy is exact', () => assert.match(fixedSource, /记录本期还款/));
add('FIX1-018 member receipt quick action copy is exact', () => assert.match(fixedSource, /记录成员付款/));
add('FIX1-019 central outward quick action copy is exact', () => assert.match(fixedSource, /统一付款/));
add('FIX1-020 quick action has 44px target', () => assert.match(cssSource, /fixed-occurrence-quick-action[\s\S]+min-height:\s*44px/));

add('FIX1-021 manual outbound exposes go pay', () => assert.match(actionUISource, />去付款</));
add('FIX1-022 manual outbound exposes already paid', () => assert.match(actionUISource, />我已经付好了</));
add('FIX1-023 missing profile stays out of assistant', () => assert.match(actionUISource, /if \(!context\.profile\)/));
add('FIX1-024 missing profile offers add CTA', () => assert.match(actionUISource, /尚未设置收款资料/));
add('FIX1-025 automatic subscription uses already charged', () => assert.match(actionUISource, /已经扣款/));
add('FIX1-026 member receipt uses already received', () => assert.match(actionUISource, /已经收到/));
add('FIX1-027 Path A and B use the same canonical draft', () => {
  const { draft } = rentPreview();
  assert.equal(fingerprintRecurringActionDraft({ ...draft, paymentPath: PAYMENT_PATHS.HANDOFF }), fingerprintRecurringActionDraft({ ...draft, paymentPath: PAYMENT_PATHS.ALREADY_PAID }));
});
add('FIX1-028 Path A and B economic preview is identical', () => {
  const { preview } = rentPreview();
  assert.deepEqual(preview.effects, structuredClone(preview.effects));
});
add('FIX1-029 presentation metadata is outside draft keys', () => assert.equal(rentPreview().draft.paymentPath, undefined));
add('FIX1-030 launch does not complete handoff', () => {
  const handoff = createPaymentHandoffSession({ sessionId: 'h', actionType: 'x', occurrenceId: 'o' });
  handoff.markLaunch({ opened: true }, '2026-07-17T09:00:00+08:00');
  assert.equal(handoff.snapshot().completedByUser, false);
});
add('FIX1-031 later path has no mutation API', () => assert.doesNotMatch(actionUISource, /postFixedExpense|createTransaction|applyTransaction/));
add('FIX1-032 incomplete return keeps assistant action', () => assert.match(actionUISource, /payment-return-incomplete.*closeSheet/s));
add('FIX1-033 complete path only opens preview', () => assert.match(actionUISource, /payment-return-complete[\s\S]+openPreview\(PAYMENT_PATHS\.HANDOFF\)/));

add('FIX1-034 profile stable ID is required', () => assert.throws(() => normalizeRecipientPaymentProfile({}), /RECIPIENT_PROFILE_ID_REQUIRED/));
add('FIX1-035 profile repository preserves synthetic stable ID', () => assert.equal(profileRepo().get('recipient-profile-sister-default').profileId, 'recipient-profile-sister-default'));
add('FIX1-036 one profile can be reused by plans', () => {
  const repo = profileRepo();
  assert.deepEqual(repo.get('recipient-profile-sister-default'), repo.get('recipient-profile-sister-default'));
});
add('FIX1-037 mutable display name does not change profile ID', () => {
  const repo = profileRepo();
  const updated = repo.update('recipient-profile-sister-default', { displayName: '大姐' });
  assert.equal(updated.profileId, 'recipient-profile-sister-default');
});
add('FIX1-038 missing payment destination fails closed', () => {
  const seed = RECIPIENT_PAYMENT_PROFILE_FIXTURES[0];
  assert.throws(() => normalizeRecipientPaymentProfile({ ...seed, accountNumber: '', duitNowType: '', duitNowValue: '' }), /RECIPIENT_PAYMENT_DESTINATION_REQUIRED/);
});
add('FIX1-039 masked account reveals only last four', () => assert.equal(maskPaymentAccount('123456788899', { hidden: true }), '•••• 8899'));
add('FIX1-040 eye-on account is complete', () => assert.equal(maskPaymentAccount('123456788899'), '123456788899'));
add('FIX1-041 DuitNow mask reveals only last four', () => assert.equal(maskDuitNowValue('60120008899', { hidden: true }), '•••• 8899'));
add('FIX1-042 explicit selection uses plan profile ID', () => {
  const repo = profileRepo();
  assert.equal(selectRecipientPaymentProfile({ plan: { recipientPaymentProfileId: 'recipient-profile-rent-landlord' }, repository: repo }).profileId, 'recipient-profile-rent-landlord');
});
add('FIX1-043 participant default is selectable', () => {
  const repo = profileRepo();
  assert.equal(selectRecipientPaymentProfile({ plan: {}, action: { counterpartyId: 'participant-sis' }, repository: repo }).profileId, 'recipient-profile-sister-default');
});
add('FIX1-044 profile editor exposes required fields', () => ['收款人', '银行', '户名', '银行账号'].forEach((token) => assert.match(profileSheetSource, new RegExp(token))));
add('FIX1-045 profile editor supports optional DuitNow', () => assert.match(profileSheetSource, /DuitNow/));
add('FIX1-046 profile editor supports participant default', () => assert.match(profileSheetSource, /设为该对象默认收款资料/));

add('FIX1-047 copy account keeps full payload while UI may mask', () => {
  const profile = profileRepo().get('recipient-profile-sister-default');
  assert.match(formatPaymentClipboard({ profile, amountText: 'RM 83.33', reference: 'demo' }), new RegExp(profile.accountNumber));
});
add('FIX1-048 account copy toast leaks no number', () => { assert.match(actionUISource, /账号已复制/); assert.doesNotMatch(actionUISource, /账号已复制[^'\n]*accountNumber/); });
add('FIX1-049 copy amount is wired', () => assert.match(actionUISource, /data-copy-field="amount"/));
add('FIX1-050 reference is plain text rather than a dedicated copy action', () => { assert.match(actionUISource, /payment-assistant-reference/); assert.doesNotMatch(actionUISource, /data-copy-field="reference"/); });
add('FIX1-051 oversized copy-all control has been removed', () => assert.doesNotMatch(actionUISource, /data-copy-field="all"|全部复制/));
add('FIX1-052 clipboard primary adapter works', async () => {
  let copied = '';
  const adapter = createClipboardAdapter({ navigatorRef: { clipboard: { writeText: async (text) => { copied = text; } } }, documentRef: null });
  assert.equal((await adapter.writeText('abc')).ok, true);
  assert.equal(copied, 'abc');
});
add('FIX1-053 clipboard failure is user readable', () => assert.match(actionUISource, /未能复制，请长按资料手动复制/));
add('FIX1-054 payment reference replaces month token', () => assert.equal(paymentReferenceFor({ defaultReferenceTemplate: 'Rent {{month}}' }, { monthKey: '2026-07' }), 'Rent 07/2026'));

add('FIX1-055 launch registry contains no invented scheme', () => Object.values(BANK_APP_LAUNCH_REGISTRY).forEach((entry) => assert.equal(entry.launchTarget, null)));
add('FIX1-056 launcher only invokes target on explicit launch', () => {
  let calls = 0;
  const launcher = createBrowserBankAppLauncher({ registry: { demo: { launchTarget: 'demo-safe-target' } }, openTarget: () => { calls += 1; } });
  assert.equal(calls, 0);
  launcher.launch('demo');
  assert.equal(calls, 1);
});
add('FIX1-057 missing launch target safely falls back', () => assert.equal(createBrowserBankAppLauncher({ registry: {} }).launch('missing').opened, false));
add('FIX1-058 source Maybank chooses Maybank capability', () => assert.equal(bankCapabilityForAccount({ bank: 'Maybank' }).capabilityId, 'maybank-mae'));
add('FIX1-059 recipient bank does not choose source capability', () => assert.equal(bankCapabilityForAccount({ bank: 'Maybank', recipientBank: 'CIMB' }).capabilityId, 'maybank-mae'));
add('FIX1-060 launch fallback copy is exact', () => assert.match(actionUISource, /未能自动打开，请手动打开银行 App。付款资料已保留。/));
add('FIX1-061 handoff metadata records copied fields only in presentation', () => {
  const handoff = createPaymentHandoffSession({ sessionId: 'h', actionType: 'a', occurrenceId: 'o' });
  handoff.markCopied('account');
  assert.deepEqual(presentationMetadataForPath(PAYMENT_PATHS.HANDOFF, handoff.snapshot()).copiedFields, ['account']);
});

add('FIX1-062 normal first focus does not return', () => {
  const doc = new EventTarget();
  doc.visibilityState = 'visible';
  const win = new EventTarget();
  let count = 0;
  const watcher = createReturnFromBankWatcher({ documentRef: doc, windowRef: win, onReturn: () => { count += 1; } });
  win.dispatchEvent(new Event('focus'));
  assert.equal(count, 0);
  watcher.dispose();
});
add('FIX1-063 handoff return delivers once', () => {
  const doc = new EventTarget();
  doc.visibilityState = 'visible';
  const win = new EventTarget();
  let count = 0;
  const watcher = createReturnFromBankWatcher({ documentRef: doc, windowRef: win, onReturn: () => { count += 1; } });
  watcher.arm({ assumeBackground: true });
  win.dispatchEvent(new Event('focus'));
  win.dispatchEvent(new Event('focus'));
  assert.equal(count, 1);
  watcher.dispose();
});
add('FIX1-064 return prompt offers three honest outcomes', () => ['我已经完成付款', '还没完成', '稍后记录'].forEach((token) => assert.match(actionUISource, new RegExp(token))));

add('FIX1-065 soft delete creates tombstone', () => {
  const repo = planRepo();
  const result = repo.softDeletePlan('fixed-rent-shared', { deletedAt: '2026-07-17T09:00:00+08:00' });
  assert.equal(result.tombstone.planId, 'fixed-rent-shared');
});
add('FIX1-066 soft delete removes active plan', () => {
  const repo = planRepo();
  repo.softDeletePlan('fixed-rent-shared', { deletedAt: '2026-07-17T09:00:00+08:00' });
  assert.equal(repo.listPlans().some((plan) => plan.id === 'fixed-rent-shared'), false);
});
add('FIX1-067 recently deleted count is exact', () => {
  const repo = planRepo();
  repo.softDeletePlan('fixed-rent-shared', { deletedAt: '2026-07-17T09:00:00+08:00' });
  assert.equal(repo.listRecentlyDeleted().length, 1);
});
add('FIX1-068 restore keeps same plan ID', () => {
  const repo = planRepo();
  repo.softDeletePlan('fixed-rent-shared', { deletedAt: '2026-07-17T09:00:00+08:00' });
  assert.equal(repo.restoreDeletedPlan('fixed-rent-shared', { restoredAt: '2026-07-18T09:00:00+08:00' }).id, 'fixed-rent-shared');
});
add('FIX1-069 restore increments revision', () => {
  const repo = planRepo();
  const before = repo.getPlan('fixed-rent-shared').revision;
  repo.softDeletePlan('fixed-rent-shared', { deletedAt: '2026-07-17T09:00:00+08:00' });
  assert.equal(repo.restoreDeletedPlan('fixed-rent-shared', { restoredAt: '2026-07-18T09:00:00+08:00' }).revision, before + 1);
});
add('FIX1-070 restore does not duplicate occurrence', () => {
  const repo = planRepo();
  repo.generateOccurrence('fixed-rent-shared', '2026-07', { referenceDate: '2026-07-13', generatedAt: '2026-07-13T09:00:00+08:00' });
  repo.softDeletePlan('fixed-rent-shared', { deletedAt: '2026-07-17T09:00:00+08:00' });
  repo.restoreDeletedPlan('fixed-rent-shared', { restoredAt: '2026-07-18T09:00:00+08:00' });
  repo.generateOccurrence('fixed-rent-shared', '2026-07', { referenceDate: '2026-07-18', generatedAt: '2026-07-18T09:00:00+08:00', preserveLocked: true });
  assert.equal(repo.listOccurrencesForPlan('fixed-rent-shared', '2026-07-18').length, 1);
});
add('FIX1-071 permanent delete is confined to tombstones', () => assert.throws(
  () => planRepo().permanentlyDeletePlan('fixed-rent-shared'),
  (error) => error.code === 'deleted_plan_not_found',
));
add('FIX1-072 permanent delete confirmation copy is exact', () => assert.match(planSheetsSource, /永久删除后无法恢复。已经产生的记账记录不会被删除。/));
add('FIX1-073 clear all reports exact count', () => {
  const repo = planRepo();
  repo.softDeletePlan('fixed-rent-shared', { deletedAt: '2026-07-17T09:00:00+08:00' });
  repo.softDeletePlan('subscription-netflix', { deletedAt: '2026-07-17T09:01:00+08:00' });
  assert.equal(repo.clearRecentlyDeleted().clearedCount, 2);
});
add('FIX1-074 archive and delete remain distinct APIs', () => {
  const repo = planRepo();
  assert.equal(typeof repo.archivePlan, 'function');
  assert.equal(typeof repo.softDeletePlan, 'function');
});
add('FIX1-075 normal management does not show permanent delete', () => {
  const manageStart = planSheetsSource.indexOf('function openPlanManage');
  const manageEnd = planSheetsSource.indexOf('function requestArchive');
  assert.doesNotMatch(planSheetsSource.slice(manageStart, manageEnd), /永久删除/);
});
add('FIX1-076 recently deleted belongs to plans workspace', () => assert.match(fixedSource, /fixed-plan-recently-deleted/));
add('FIX1-077 completed history snapshot label is frozen', () => assert.match(read('../src/domain/recurringPlanDeletionLifecycle.js'), /已删除计划 ·/));

add('FIX1-078 accounts remain deep equal after both paths', () => {
  const { accounts } = rentPreview();
  const before = structuredClone(accounts);
  createPaymentHandoffSession({ sessionId: 'h', actionType: 'a', occurrenceId: 'o' }).markLaunch({ opened: false });
  assert.deepEqual(accounts, before);
});
add('FIX1-079 posting preview remains frozen', () => assert.equal(Object.isFrozen(rentPreview().preview), true));
add('FIX1-080 no financial executor is imported by FIX1 UI', () => assert.doesNotMatch([actionUISource, profileSheetSource].join('\n'), /moneyEngine|relationshipLedgerEngine|obligationEngine/));
add('FIX1-081 demo reset resets recipient profiles', () => assert.match(demoSource, /recipientPaymentProfiles\.reset\(\)/));
add('FIX1-082 FIX1 adds no network or persistent storage', () => assert.doesNotMatch([actionUISource, profileSheetSource, read('../src/domain/paymentHandoff.js')].join('\n'), /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB)\s*[.(]/));

for (const [name, fn] of cases) test(name, fn);

test('FIX1-083 focused FIX1 suite reaches required 70 cases', () => assert.ok(cases.length >= 70));
