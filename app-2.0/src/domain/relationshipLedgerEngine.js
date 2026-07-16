import { toMinor, fromMinor } from './moneyEngine.js';
import { ledgerSummary, relationshipOverview } from './relationshipSelectors.js';
import { immutableConfirmationSnapshot } from './confirmationSnapshot.js';

const ENTRY_TYPES = new Set(['split_expense', 'direct_receivable', 'direct_payable']);

export function createRelationshipLedgerEngine({ participants, repository, outbox, financial, meId = 'participant-me', actorUserId = 'user-winner' }) {
  const commands = new Map();
  const now = (input) => input || new Date().toISOString();
  const counterparty = (ledger, exclude = meId) => ledger.participantIds.find((id) => id !== exclude);
  const emit = (eventType, command, entityId, payload = {}) => outbox.emit({ clientEventId: `${command.clientEventId}:${eventType}`, eventType, sourceChannel: command.sourceChannel || 'app', actorUserId, participantId: command.participantId || null, ledgerId: command.ledgerId, entityId, revision: payload.revision || 1, occurredAt: command.occurredAt, payload });
  const idempotent = (command, run) => {
    if (!command.clientEventId) throw new Error('缺少客户端事件 ID');
    if (commands.has(command.clientEventId)) return structuredClone(commands.get(command.clientEventId));
    const result = run(); commands.set(command.clientEventId, result); return structuredClone(result);
  };
  // The user-selected category must survive relationship saves: only fall
  // back to the system fallback when no category was chosen at all.
  const transactionDraft = (command, kind, recordOnly, accountEffect = recordOnly ? 'record_only' : 'posted') => ({
    kind, amount: command.transactionAmount ?? command.amount, desc: command.description,
    catId: command.catId || (kind === 'income' ? 'income-aa' : 'expense-fallback'),
    catLabel: command.catLabel || (kind === 'income' ? 'AA 回款' : '未分类支出'),
    sourceAccountId: kind === 'expense' ? command.sourceAccountId || financial.defaultAccountId() : null,
    destinationAccountId: kind === 'income' ? command.destinationAccountId : null,
    date: command.date, time: command.time, recordOnly, accountEffect,
    attachment: command.attachment || null, attachmentIds: command.attachmentIds || [],
    lockedReason: command.lockedReason || null,
    submissionKey: `relationship:${command.clientEventId}`,
    relationshipMode: command.entryType || command.relationshipMode || null,
    capacityAuthorization: command.capacityAuthorization || null,
  });

  function record(command) {
    return idempotent(command, () => {
      if (!ENTRY_TYPES.has(command.entryType)) throw new Error('关系账类型无效');
      const ledger = repository.getLedger(command.ledgerId); if (!ledger) throw new Error('关系账本不存在');
      const amountMinor = toMinor(command.amount); if (amountMinor <= 0) throw new Error('金额必须大于零');
      let creditorParticipantId; let debtorParticipantId; let relationshipMinor = amountMinor; let transaction = null;
      let memberBreakdown = [];
      if (command.entryType === 'split_expense') {
        // Payer and every split participant must come from the selected
        // ledger's own participantIds — never a stale or hardcoded person.
        const payerId = command.payerParticipantId;
        if (!ledger.participantIds.includes(payerId)) throw new Error('付款人必须是这个账本的参与者');
        const shares = command.shares || ledger.participantIds.map((participantId, index) => ({ participantId, amountMinor: Math.floor(amountMinor / ledger.participantIds.length) + (index === ledger.participantIds.length - 1 ? amountMinor % ledger.participantIds.length : 0) }));
        if (!shares.length) throw new Error('至少需要一位分摊参与者');
        const shareIds = shares.map((share) => share.participantId);
        if (new Set(shareIds).size !== shareIds.length) throw new Error('分摊参与者不能重复');
        if (!shareIds.every((id) => ledger.participantIds.includes(id))) throw new Error('分摊参与者必须属于这个账本');
        const totalShares = shares.reduce((sum, share) => sum + Number(share.amountMinor), 0);
        if (totalShares !== amountMinor) throw new Error('分账金额总和必须等于总额');
        const myShare = shares.find((share) => share.participantId === meId)?.amountMinor || 0;
        if (payerId === meId) {
          const owedByOthers = shares.filter((share) => share.participantId !== meId && share.amountMinor > 0);
          if (!owedByOthers.length) throw new Error('请至少让一位其他参与者分摊');
          creditorParticipantId = meId; debtorParticipantId = owedByOthers[0].participantId; relationshipMinor = amountMinor - myShare;
          memberBreakdown = owedByOthers.map((share) => ({ participantId: share.participantId, amountMinor: share.amountMinor }));
          transaction = financial.addTransaction(transactionDraft({ ...command, transactionAmount: fromMinor(amountMinor) }, 'expense', Boolean(command.recordOnly)));
        } else {
          if (myShare <= 0) throw new Error('对方付款时你必须在分摊名单内');
          creditorParticipantId = payerId; debtorParticipantId = meId; relationshipMinor = myShare;
          memberBreakdown = [{ participantId: payerId, amountMinor: myShare }];
          transaction = financial.addTransaction(transactionDraft({ ...command, transactionAmount: fromMinor(myShare) }, 'expense', false, 'relationship_only'));
        }
      } else if (command.entryType === 'direct_receivable') {
        const debtor = command.participantId || counterparty(ledger);
        if (!ledger.participantIds.includes(debtor) || debtor === meId) throw new Error('请选择欠款的参与者');
        creditorParticipantId = meId; debtorParticipantId = debtor;
        memberBreakdown = [{ participantId: debtor, amountMinor }];
        transaction = financial.addTransaction(transactionDraft(command, 'expense', Boolean(command.recordOnly)));
      } else {
        const creditor = command.participantId || counterparty(ledger);
        if (!ledger.participantIds.includes(creditor) || creditor === meId) throw new Error('请选择债权的参与者');
        creditorParticipantId = creditor; debtorParticipantId = meId;
        memberBreakdown = [{ participantId: creditor, amountMinor }];
        transaction = financial.addTransaction(transactionDraft(command, 'expense', false, 'relationship_only'));
      }
      const occurredAt = command.occurredAt || `${command.date}T${command.time}:00+08:00`;
      const entry = repository.addEntry({ ledgerId: ledger.ledgerId, entryType: command.entryType, transactionId: transaction?.id || null, actorParticipantId: meId, payerParticipantId: command.payerParticipantId || (command.entryType === 'direct_payable' ? creditorParticipantId : meId), creditorParticipantId, debtorParticipantId, participants: ledger.participantIds, splitParticipantIds: command.shares ? command.shares.map((share) => share.participantId) : [], shares: command.shares || [], memberBreakdown, amountMinor: relationshipMinor, remainingMinor: relationshipMinor, relationshipRatio: relationshipMinor / amountMinor, totalAmountMinor: amountMinor, sourceChannel: command.sourceChannel || 'app', clientEventId: command.clientEventId, occurredAt, updatedAt: occurredAt, description: command.description, catId: command.catId || null, attachment: command.attachment || null, attachmentIds: command.attachmentIds || [], recordOnly: Boolean(command.recordOnly) });
      if (transaction?.confirmation) transaction.confirmation = immutableConfirmationSnapshot({ ...transaction.confirmation, relationship: {
        ledgerId: ledger.ledgerId,
        ledgerTitle: ledger.title,
        entryId: entry.entryId,
        entryType: entry.entryType,
        payerParticipantId: entry.payerParticipantId,
        payerName: entry.payerParticipantId === meId ? '我' : participants.get(entry.payerParticipantId)?.displayName || '对方',
        currentUserShareMinor: entry.shares?.find((share) => share.participantId === meId)?.amountMinor || (entry.debtorParticipantId === meId ? relationshipMinor : 0),
        beforeMinor: 0,
        afterMinor: relationshipMinor,
        memberBreakdown: structuredClone(memberBreakdown),
      } });
      financial.linkTransaction?.(transaction?.id, entry.entryId);
      emit('ledger.entry.created', { ...command, occurredAt }, entry.entryId, { transactionId: transaction?.id, amountMinor: relationshipMinor });
      emit('transaction.created', { ...command, occurredAt }, transaction?.id, { relationshipEntryId: entry.entryId });
      return { entry, transaction };
    });
  }

  function settle(command) {
    return idempotent(command, () => {
      const direction = command.direction;
      if (!['received', 'paid'].includes(direction)) throw new Error('结算方向无效');
      const amountMinor = toMinor(command.amount); let remaining = amountMinor; const allocations = [];
      const open = repository.getEntries(command.ledgerId).filter((entry) => direction === 'received' ? entry.creditorParticipantId === meId : entry.debtorParticipantId === meId).filter((entry) => entry.remainingMinor > 0);
      const targets = command.entryIds?.length ? open.filter((entry) => command.entryIds.includes(entry.entryId)) : open;
      const available = targets.reduce((sum, entry) => sum + entry.remainingMinor, 0);
      if (amountMinor <= 0 || amountMinor > available) throw new Error('结算金额超过当前未结余额');
      const kind = direction === 'received' ? 'income' : 'expense';
      const financialDraft = transactionDraft({ ...command, transactionAmount: fromMinor(amountMinor), description: command.description || (direction === 'received' ? '收到款' : '我还款'), lockedReason: '请从关系账结算详情修改或撤销这次结算。' }, kind, Boolean(command.recordOnly));
      financial.assertTransactionCapacity?.(financialDraft);
      targets.forEach((entry) => {
        if (!remaining) return;
        const appliedMinor = Math.min(remaining, entry.remainingMinor); remaining -= appliedMinor;
        repository.updateEntry(entry.entryId, { remainingMinor: entry.remainingMinor - appliedMinor, status: entry.remainingMinor === appliedMinor ? 'settled' : 'partial' });
        allocations.push({ entryId: entry.entryId, appliedMinor });
      });
      const transaction = financial.addTransaction(financialDraft);
      const occurredAt = command.occurredAt || `${command.date}T${command.time}:00+08:00`;
      const settlement = repository.addSettlement({ ledgerId: command.ledgerId, direction, amountMinor, remainingMinor: 0, allocations, transactionId: transaction.id, sourceChannel: command.sourceChannel || 'app', clientEventId: command.clientEventId, occurredAt, attachment: command.attachment || null, attachmentIds: command.attachmentIds || [] });
      if (transaction.confirmation) transaction.confirmation = immutableConfirmationSnapshot({ ...transaction.confirmation, relationship: {
        ledgerId: command.ledgerId,
        ledgerTitle: repository.getLedger(command.ledgerId)?.title || '关系账',
        settlementId: settlement.settlementId,
        entryType: `settlement_${direction}`,
        beforeMinor: available,
        afterMinor: available - amountMinor,
        memberBreakdown: [],
      } });
      financial.linkTransaction?.(transaction.id, settlement.settlementId);
      emit('settlement.recorded', { ...command, occurredAt }, settlement.settlementId, { transactionId: transaction.id, allocations });
      return { settlement, transaction };
    });
  }

  function reverseSettlement(settlementId, command) {
    return idempotent(command, () => {
      const settlement = repository.getSettlement(settlementId); if (!settlement || settlement.status === 'reversed') return settlement;
      settlement.allocations.forEach((allocation) => { const entry = repository.getEntry(allocation.entryId); repository.updateEntry(entry.entryId, { remainingMinor: entry.remainingMinor + allocation.appliedMinor, status: 'open' }); });
      financial.reverseTransaction(settlement.transactionId);
      const reversed = repository.updateSettlement(settlementId, { status: 'reversed', reversedAt: now(command.occurredAt), reversalOf: settlementId });
      emit('settlement.reversed', command, settlementId, { originalSettlementId: settlementId, transactionId: settlement.transactionId });
      emit('transaction.reversed', command, settlement.transactionId, { settlementId, originalEntityId: settlementId });
      return reversed;
    });
  }

  function reverseEntry(entryId, command) {
    return idempotent(command, () => {
      const entry = repository.getEntry(entryId); if (!entry || entry.status === 'reversed') return entry;
      if (entry.remainingMinor !== entry.amountMinor) throw new Error('已有结算的记录请先撤销结算');
      if (entry.transactionId) financial.reverseTransaction(entry.transactionId);
      const reversed = repository.updateEntry(entryId, { status: 'reversed', remainingMinor: 0, reversedAt: now(command.occurredAt), reversalOf: entryId });
      emit('ledger.entry.reversed', command, entryId, { originalEntryId: entryId, transactionId: entry.transactionId });
      if (entry.transactionId) emit('transaction.reversed', command, entry.transactionId, { relationshipEntryId: entryId, originalEntityId: entryId });
      return reversed;
    });
  }

  function updateFromTransaction(transaction, command) {
    const entry = repository.getEntries(command.ledgerId, { includeReversed: true }).find((item) => item.transactionId === transaction.id);
    if (!entry || entry.status === 'reversed') return null;
    const settledMinor = entry.amountMinor - entry.remainingMinor; const nextMinor = Math.round(transaction.amountMinor * (entry.relationshipRatio || 1));
    if (nextMinor < settledMinor) throw new Error('金额不能低于已结算部分');
    const updated = repository.updateEntry(entry.entryId, { amountMinor: nextMinor, remainingMinor: nextMinor - settledMinor, description: transaction.desc, occurredAt: transaction.occurredAt });
    emit('ledger.entry.updated', command, entry.entryId, { revision: updated.revision, transactionId: transaction.id });
    emit('transaction.updated', command, transaction.id, { revision: transaction.revision, relationshipEntryId: entry.entryId });
    return updated;
  }

  return {
    record, settle, reverseSettlement, reverseEntry, updateFromTransaction,
    getLedgers: (filter) => repository.getLedgers(filter), getLedger: (id) => repository.getLedger(id), getEntry: (id) => repository.getEntry(id), getEntries: (id, options) => repository.getEntries(id, options), getSettlements: (id) => repository.getSettlements(id),
    getSummary: (id) => ledgerSummary(repository.getEntries(id), meId), getOverview: () => relationshipOverview(repository, meId),
    createManualParticipant: (input) => participants.createManual(input), createLedger: (input) => repository.createLedger(input), getParticipants: () => participants.getAll(), getParticipant: (id) => participants.get(id),
    prepareClaim(participantId, appUserId, clientEventId, sourceChannel = 'app') { const claim = participants.prepareClaim(participantId, appUserId, clientEventId); emit('participant.claim_prepared', { clientEventId, sourceChannel, participantId, ledgerId: null }, claim.claimId, claim); return claim; },
    completeClaim(claimId, clientEventId) { const participant = participants.completeClaim(claimId); emit('participant.claim_completed', { clientEventId, sourceChannel: 'app', participantId: participant.participantId, ledgerId: null }, participant.participantId, {}); emit('participant.channel_linked', { clientEventId: `${clientEventId}:linked`, sourceChannel: 'app', participantId: participant.participantId, ledgerId: null }, participant.participantId, { channel: 'app' }); return participant; },
    cancelClaim: (id) => participants.cancelClaim(id), getOutbox: () => outbox.getEvents(),
    reset() { participants.reset(); repository.reset(); outbox.reset(); commands.clear(); },
  };
}
