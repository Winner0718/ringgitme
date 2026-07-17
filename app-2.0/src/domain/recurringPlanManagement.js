import { addMonths } from './scheduleGenerator.js';
import { canonicalSourceKey, normalizeRecurringPlan, recurringError } from './recurringPlanModel.js';
import { buildOccurrenceSnapshot } from './recurringSchedule.js';
import { projectObligationOccurrence, projectObligationPlan } from './recurringPlanSelectors.js';
import { auditRecurringCreateIsolation } from './recurringPlanUsability.js';

function clone(value) {
  return value == null ? value : structuredClone(value);
}

export function parseCanonicalSource(value) {
  if (typeof value === 'object' && value) {
    canonicalSourceKey(value);
    return clone(value);
  }
  const [sourceType, ...rest] = String(value || '').split(':');
  const sourceId = rest.join(':');
  const source = { sourceType, sourceId };
  canonicalSourceKey(source);
  return source;
}

function normalizedTitle(value) {
  return String(value || '').trim().toLocaleLowerCase('zh-Hans').replace(/[\s·._-]+/g, '');
}

function sameSchedule(a, b) {
  return a.schedule?.recurrence === b.schedule?.recurrence
    && Number(a.schedule?.dueDay) === Number(b.schedule?.dueDay)
    && (a.schedule?.recurrence !== 'yearly' || Number(a.schedule?.dueMonth) === Number(b.schedule?.dueMonth));
}

export function semanticPlanMatches(candidate, plans, { excludeSource = null } = {}) {
  const excluded = excludeSource ? canonicalSourceKey(parseCanonicalSource(excludeSource)) : null;
  const title = normalizedTitle(candidate.title);
  return plans.filter((plan) => {
    const sourceKey = canonicalSourceKey(plan.canonicalSource);
    if (sourceKey === excluded) return false;
    if (plan.amountMode !== candidate.amountMode || Number(plan.totalAmountMinor) !== Number(candidate.totalAmountMinor) || !sameSchedule(plan, candidate)) return false;
    const candidateLedger = candidate.relationship?.ledgerId || null;
    const planLedger = plan.relationship?.ledgerId || null;
    const related = candidateLedger && planLedger && candidateLedger === planLedger;
    const otherTitle = normalizedTitle(plan.title);
    const similarTitle = title.length >= 2 && otherTitle.length >= 2 && (title.includes(otherTitle) || otherTitle.includes(title));
    return related || similarTitle;
  }).map((plan) => ({
    source: clone(plan.canonicalSource),
    sourceKey: canonicalSourceKey(plan.canonicalSource),
    planId: plan.id,
    title: plan.title,
    totalAmountMinor: plan.totalAmountMinor,
  }));
}

function fixedOccurrence(repository, plan, monthKey, referenceDate) {
  if (plan.status !== 'active' || plan.archivedAt) return null;
  return repository.generateOccurrence(plan.id, monthKey, {
    referenceDate,
    generatedAt: `${referenceDate}T09:00:00+08:00`,
    preserveLocked: true,
  }).occurrence;
}

function uniqueOccurrences(rows) {
  const byId = new Map();
  rows.filter(Boolean).forEach((row) => byId.set(row.id, row));
  return [...byId.values()].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
}

export function createRecurringPlanManagementGateway({
  recurringRepository,
  obligationEngine,
  today,
} = {}) {
  if (!recurringRepository || !obligationEngine || !today) recurringError('invalid_management_gateway', '计划管理网关配置无效');
  const commands = new Map();

  const obligationPlans = () => obligationEngine.getPlans().map((plan) => projectObligationPlan(plan)).filter(Boolean);
  const allPlans = () => [...recurringRepository.listPlans(), ...obligationPlans()];

  function run(commandId, execute) {
    if (!String(commandId || '').trim()) recurringError('missing_command_id', '缺少计划操作 ID');
    if (commands.has(commandId)) return clone(commands.get(commandId));
    const result = execute();
    commands.set(commandId, result);
    return clone(result);
  }

  function getCanonicalPlan(sourceValue) {
    const source = parseCanonicalSource(sourceValue);
    const plan = source.sourceType === 'fixed_plan'
      ? recurringRepository.getPlan(source.sourceId)
      : projectObligationPlan(obligationEngine.getPlan(source.sourceId));
    if (!plan) recurringError('unknown_plan', '计划不存在', { source });
    return {
      source,
      sourceKey: canonicalSourceKey(source),
      owner: source.sourceType === 'fixed_plan' ? 'fixed' : 'obligation',
      managementLabel: source.sourceType === 'obligation_plan' ? '由账本管理' : null,
      plan,
    };
  }

  function createPlan(input, { commandId, allowSemanticDuplicate = false, monthKey = today().slice(0, 7) } = {}) {
    // Idempotency wins over duplicate detection: retrying the same accepted
    // command must return its original result, not warn about its own plan.
    if (commands.has(commandId)) return clone(commands.get(commandId));
    const normalized = normalizeRecurringPlan(input);
    const matches = semanticPlanMatches(normalized, allPlans());
    if (matches.length && !allowSemanticDuplicate) return { status: 'semantic_duplicate', matches, candidate: clone(normalized) };
    return run(commandId, () => {
      const before = recurringRepository.getSnapshot();
      const created = recurringRepository.createPlan(normalized);
      const occurrence = fixedOccurrence(recurringRepository, created, monthKey, today());
      const after = recurringRepository.getSnapshot();
      const isolationAudit = auditRecurringCreateIsolation({ beforePlans: before.plans, afterPlans: after.plans, beforeOccurrences: before.occurrences, afterOccurrences: after.occurrences, createdPlanId: created.id });
      if (!isolationAudit.ok) recurringError('create_isolation_failed', '建立计划时检测到其他计划被意外改动', isolationAudit);
      return { status: 'created', owner: 'fixed', source: clone(created.canonicalSource), plan: created, occurrence, isolationAudit };
    });
  }

  function updatePlan(sourceValue, changes, { commandId } = {}) {
    const canonical = getCanonicalPlan(sourceValue);
    return run(commandId, () => {
      if (canonical.owner === 'fixed') {
        const updated = recurringRepository.updatePlan(canonical.plan.id, changes, { occurredAt: `${today()}T09:00:00+08:00` });
        return { status: 'updated', owner: 'fixed', source: canonical.source, plan: updated };
      }
      const allowed = {};
      if (changes.title !== undefined) allowed.title = changes.title;
      if (changes.note !== undefined) allowed.description = changes.note;
      if (changes.paymentSourceAccountId !== undefined) allowed.defaultAccountId = changes.paymentSourceAccountId;
      const updatedSource = obligationEngine.updatePlan(canonical.source.sourceId, allowed, {
        clientEventId: commandId,
        sourceChannel: 'app',
        occurredAt: `${today()}T09:00:00+08:00`,
      });
      return { status: 'updated', owner: 'obligation', source: canonical.source, plan: projectObligationPlan(updatedSource) };
    });
  }

  function transition(sourceValue, target, { commandId } = {}) {
    const canonical = getCanonicalPlan(sourceValue);
    return run(commandId, () => {
      let updated;
      if (canonical.owner === 'fixed') {
        const options = { occurredAt: `${today()}T09:00:00+08:00` };
        updated = target === 'paused' ? recurringRepository.pausePlan(canonical.plan.id, options)
          : target === 'active' ? recurringRepository.resumePlan(canonical.plan.id, options)
            : recurringRepository.stopPlan(canonical.plan.id, options);
      } else {
        const command = { clientEventId: commandId, sourceChannel: 'app', date: today(), occurredAt: `${today()}T09:00:00+08:00` };
        const sourcePlan = target === 'paused' ? obligationEngine.pausePlan(canonical.source.sourceId, command)
          : target === 'active' ? obligationEngine.resumePlan(canonical.source.sourceId, command)
            : obligationEngine.stopPlan(canonical.source.sourceId, command);
        updated = projectObligationPlan(sourcePlan);
      }
      return { status: target, owner: canonical.owner, source: canonical.source, plan: updated };
    });
  }

  function occurrencesFor(sourceValue, referenceDate = today()) {
    const canonical = getCanonicalPlan(sourceValue);
    const currentMonth = referenceDate.slice(0, 7);
    if (canonical.owner === 'fixed') {
      const existing = recurringRepository.listOccurrencesForPlan(canonical.plan.id, referenceDate)
        // Stopping preserves actual/history snapshots, but a previously
        // prepared unpaid future occurrence is no longer an eligible bill.
        .filter((row) => canonical.plan.status !== 'stopped' || row.dueDate <= referenceDate || ['paid', 'skipped'].includes(row.status));
      const generated = [-1, 0, 1].map((offset) => fixedOccurrence(recurringRepository, canonical.plan, addMonths(currentMonth, offset), referenceDate));
      return uniqueOccurrences([...existing, ...generated]);
    }
    const sourcePlan = obligationEngine.getPlan(canonical.source.sourceId);
    const authoritative = obligationEngine.getInstances(canonical.source.sourceId).map((instance) => projectObligationOccurrence(sourcePlan, instance, referenceDate));
    const futureMonth = addMonths(currentMonth, 1);
    const preview = canonical.plan.status === 'active'
      ? buildOccurrenceSnapshot(canonical.plan, futureMonth, { referenceDate, generatedAt: `${referenceDate}T09:00:00+08:00` })
      : null;
    return uniqueOccurrences([...authoritative, preview]);
  }

  function archive(sourceValue, { commandId, reason = null } = {}) {
    const canonical = getCanonicalPlan(sourceValue);
    if (canonical.owner !== 'fixed') recurringError('source_managed_archive', '这项计划由账本管理');
    return run(commandId, () => ({ status: 'archived', owner: 'fixed', source: canonical.source, plan: recurringRepository.archivePlan(canonical.plan.id, { occurredAt: `${today()}T09:00:00+08:00`, reason }) }));
  }

  function unarchive(sourceValue, { commandId } = {}) {
    const canonical = getCanonicalPlan(sourceValue);
    if (canonical.owner !== 'fixed') recurringError('source_managed_archive', '这项计划由账本管理');
    return run(commandId, () => ({ status: 'unarchived', owner: 'fixed', source: canonical.source, plan: recurringRepository.unarchivePlan(canonical.plan.id, { occurredAt: `${today()}T09:00:00+08:00` }) }));
  }

  function removalEligibility(sourceValue) {
    const canonical = getCanonicalPlan(sourceValue);
    if (canonical.owner !== 'fixed') return { eligible: false, reasonCode: 'source_managed', occurrenceCount: occurrencesFor(sourceValue).length, immutableHistoryCount: 0, postedReferenceCount: 0, attachmentReferenceCount: 0 };
    return recurringRepository.getDeleteEligibility(canonical.plan.id);
  }

  function remove(sourceValue, { commandId } = {}) {
    if (commands.has(commandId)) return clone(commands.get(commandId));
    const canonical = getCanonicalPlan(sourceValue);
    if (canonical.owner !== 'fixed') recurringError('source_managed_remove', '这项计划由账本管理');
    return run(commandId, () => ({ status: 'removed', owner: 'fixed', source: canonical.source, ...recurringRepository.removeUnusedPlan(canonical.plan.id) }));
  }

  function softDelete(sourceValue, { commandId, actorId = 'participant-me' } = {}) {
    const canonical = getCanonicalPlan(sourceValue);
    if (canonical.owner !== 'fixed') recurringError('source_managed_delete', '这项计划由账本管理');
    return run(commandId, () => ({
      status: 'recently_deleted',
      owner: 'fixed',
      source: canonical.source,
      ...recurringRepository.softDeletePlan(canonical.plan.id, {
        deletedAt: `${today()}T09:00:00+08:00`,
        deletedByActorId: actorId,
      }),
    }));
  }

  function restoreDeleted(planId, { commandId } = {}) {
    return run(commandId, () => {
      const plan = recurringRepository.restoreDeletedPlan(planId, { restoredAt: `${today()}T09:00:00+08:00` });
      const occurrence = fixedOccurrence(recurringRepository, plan, today().slice(0, 7), today());
      return { status: 'restored', owner: 'fixed', source: clone(plan.canonicalSource), plan, occurrence };
    });
  }

  function permanentlyDelete(planId, { commandId } = {}) {
    return run(commandId, () => ({
      status: 'permanently_deleted',
      owner: 'fixed',
      ...recurringRepository.permanentlyDeletePlan(planId),
    }));
  }

  function clearDeleted({ commandId } = {}) {
    return run(commandId, () => ({
      status: 'recently_deleted_cleared',
      owner: 'fixed',
      ...recurringRepository.clearRecentlyDeleted(),
    }));
  }

  return Object.freeze({
    getCanonicalPlan,
    listCanonicalPlans: () => clone(allPlans()),
    semanticDuplicates: (candidate, options) => semanticPlanMatches(normalizeRecurringPlan(candidate), allPlans(), options),
    createPlan,
    updatePlan,
    pausePlan: (source, options) => transition(source, 'paused', options),
    resumePlan: (source, options) => transition(source, 'active', options),
    stopPlan: (source, options) => transition(source, 'stopped', options),
    archivePlan: archive,
    unarchivePlan: unarchive,
    removePlan: remove,
    softDeletePlan: softDelete,
    listRecentlyDeletedPlans: () => recurringRepository.listRecentlyDeleted(),
    restoreDeletedPlan: restoreDeleted,
    permanentlyDeletePlan: permanentlyDelete,
    clearRecentlyDeleted: clearDeleted,
    getPreservedDeletedHistory: () => recurringRepository.getPreservedDeletedHistory(),
    getRemovalEligibility: removalEligibility,
    occurrencesFor,
    resetCommands: () => commands.clear(),
  });
}
