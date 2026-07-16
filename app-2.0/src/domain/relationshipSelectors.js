export function entryDirection(entry, meId = 'participant-me') {
  if (entry.status === 'reversed') return 0;
  if (entry.creditorParticipantId === meId) return 1;
  if (entry.debtorParticipantId === meId) return -1;
  return 0;
}

export function ledgerSummary(entries, meId = 'participant-me') {
  return entries.reduce((summary, entry) => {
    const remaining = Number(entry.remainingMinor || 0);
    const direction = entryDirection(entry, meId);
    if (direction > 0) summary.receivableMinor += remaining;
    if (direction < 0) summary.payableMinor += remaining;
    summary.netMinor = summary.receivableMinor - summary.payableMinor;
    return summary;
  }, { receivableMinor: 0, payableMinor: 0, netMinor: 0 });
}

// Per-member net positions derived from authoritative entries. Remaining
// amounts are distributed over each entry's memberBreakdown proportionally,
// with the final member absorbing rounding so sums stay exact.
export function memberBalances(entries, meId = 'participant-me') {
  const totals = new Map();
  entries.forEach((entry) => {
    if (entry.status === 'reversed') return;
    const remaining = Number(entry.remainingMinor || 0);
    if (!remaining) return;
    const direction = entryDirection(entry, meId);
    if (!direction) return;
    const breakdown = entry.memberBreakdown?.length
      ? entry.memberBreakdown
      : [{ participantId: direction > 0 ? entry.debtorParticipantId : entry.creditorParticipantId, amountMinor: entry.amountMinor }];
    const total = breakdown.reduce((sum, item) => sum + Number(item.amountMinor), 0) || 1;
    let allocated = 0;
    breakdown.forEach((item, index) => {
      const share = index === breakdown.length - 1 ? remaining - allocated : Math.floor((remaining * Number(item.amountMinor)) / total);
      allocated += share;
      totals.set(item.participantId, (totals.get(item.participantId) || 0) + direction * share);
    });
  });
  return [...totals.entries()].map(([participantId, netMinor]) => ({ participantId, netMinor })).filter((row) => row.netMinor !== 0);
}

export function relationshipOverview(repository, meId = 'participant-me') {
  const rows = repository.getLedgers().map((ledger) => ({ ...ledger, ...ledgerSummary(repository.getEntries(ledger.ledgerId), meId) }));
  return {
    rows,
    totals: rows.reduce((totals, row) => ({ receivableMinor: totals.receivableMinor + row.receivableMinor, payableMinor: totals.payableMinor + row.payableMinor, netMinor: totals.netMinor + row.netMinor }), { receivableMinor: 0, payableMinor: 0, netMinor: 0 }),
  };
}
