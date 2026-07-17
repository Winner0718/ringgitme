export function derivedLedgerType(ledger) {
  return ledger.participantIds.length === 2 ? 'personal' : 'group';
}

export function createRelationshipLedgerRepository({ ledgers = [], entries = [], settlements = [] } = {}) {
  const seed = structuredClone({ ledgers, entries, settlements });
  let state = structuredClone(seed);
  let entrySequence = state.entries.length;
  let settlementSequence = state.settlements.length;
  let ledgerSequence = state.ledgers.length;

  const ledger = (id) => state.ledgers.find((item) => item.ledgerId === id);
  const entry = (id) => state.entries.find((item) => item.entryId === id);
  return {
    getLedgers: (filter) => structuredClone(state.ledgers.filter((item) => !filter || derivedLedgerType(item) === filter).map((item) => ({ ...item, derivedType: derivedLedgerType(item) }))),
    getLedger: (id) => { const found = ledger(id); return found ? structuredClone({ ...found, derivedType: derivedLedgerType(found) }) : null; },
    createLedger(input) {
      if (new Set(input.participantIds).size < 2) throw new Error('账本至少需要两位参与者');
      const participantIds = [...new Set(input.participantIds)];
      if (input.ledgerId && state.ledgers.some((item) => item.ledgerId === input.ledgerId)) throw new Error('账本 ID 已存在');
      const now = new Date().toISOString();
      const created = { ledgerId: input.ledgerId || `ledger-local-${++ledgerSequence}`, title: String(input.title || '').trim(), participantIds, ownerUserId: input.ownerUserId, status: 'active', icon: input.icon || null, note: String(input.note || '').trim() || null, permissions: input.permissions || {}, createdAt: now, updatedAt: now };
      if (!created.title) throw new Error('请输入账本名称');
      state.ledgers.push(created); return structuredClone(created);
    },
    getEntries: (ledgerId, { includeReversed = false } = {}) => structuredClone(state.entries.filter((item) => item.ledgerId === ledgerId && (includeReversed || item.status !== 'reversed')).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))),
    getEntry: (id) => structuredClone(entry(id) || null),
    addEntry(input) {
      const created = { ...structuredClone(input), entryId: input.entryId || `rel-entry-${String(++entrySequence).padStart(4, '0')}`, revision: 1, history: [], status: 'open' };
      state.entries.push(created); return structuredClone(created);
    },
    updateEntry(id, updater) {
      const index = state.entries.findIndex((item) => item.entryId === id); if (index < 0) throw new Error('关系账记录不存在');
      const previous = state.entries[index]; const changes = typeof updater === 'function' ? updater(structuredClone(previous)) : updater;
      state.entries[index] = { ...previous, ...structuredClone(changes), revision: previous.revision + 1, updatedAt: new Date().toISOString() };
      return structuredClone(state.entries[index]);
    },
    addSettlement(input) { const settlement = { ...structuredClone(input), settlementId: input.settlementId || `settlement-${String(++settlementSequence).padStart(4, '0')}`, revision: 1, status: 'active' }; state.settlements.push(settlement); return structuredClone(settlement); },
    getSettlements: (ledgerId) => structuredClone(state.settlements.filter((item) => item.ledgerId === ledgerId).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))),
    getSettlement: (id) => structuredClone(state.settlements.find((item) => item.settlementId === id) || null),
    updateSettlement(id, changes) { const index = state.settlements.findIndex((item) => item.settlementId === id); state.settlements[index] = { ...state.settlements[index], ...structuredClone(changes) }; return structuredClone(state.settlements[index]); },
    getSnapshot: () => structuredClone(state),
    reset() { state = structuredClone(seed); entrySequence = state.entries.length; settlementSequence = state.settlements.length; ledgerSequence = state.ledgers.length; },
  };
}
