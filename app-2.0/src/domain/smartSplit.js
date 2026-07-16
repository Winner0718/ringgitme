export function equalSplitMinor(totalMinor, participantIds) {
  const ids = [...participantIds];
  if (!ids.length) return {};
  const base = Math.floor(Number(totalMinor) / ids.length);
  const remainder = Number(totalMinor) - base * ids.length;
  return Object.fromEntries(ids.map((id, index) => [id, base + (index === ids.length - 1 ? remainder : 0)]));
}

export function allocationSummary(totalMinor, sharesMinor, participantIds) {
  const allocatedMinor = participantIds.reduce((sum, id) => sum + Math.max(0, Number(sharesMinor?.[id] || 0)), 0);
  const differenceMinor = Number(totalMinor) - allocatedMinor;
  return {
    totalMinor: Number(totalMinor),
    allocatedMinor,
    differenceMinor,
    remainingMinor: Math.max(0, differenceMinor),
    overMinor: Math.max(0, -differenceMinor),
    exact: differenceMinor === 0,
  };
}

export function rebuildSplitShares({ totalMinor, participantIds, previous = {}, initializeEqual = false }) {
  if (initializeEqual) return equalSplitMinor(totalMinor, participantIds);
  return Object.fromEntries(participantIds.map((id) => [id, Math.max(0, Number(previous[id] || 0))]));
}

export function applyRemainderToLast(totalMinor, participantIds, sharesMinor) {
  const summary = allocationSummary(totalMinor, sharesMinor, participantIds);
  if (summary.overMinor > 0) throw new Error('当前已超出总金额，无法补给最后一人');
  const last = participantIds.at(-1);
  if (!last) throw new Error('请先选择参与者');
  return { ...sharesMinor, [last]: Number(sharesMinor?.[last] || 0) + summary.remainingMinor };
}

export function applyRemainderToActive(totalMinor, participantIds, sharesMinor, activeParticipantId) {
  const summary = allocationSummary(totalMinor, sharesMinor, participantIds);
  if (summary.overMinor > 0) throw new Error('当前已超出总金额，无法补上剩余');
  const unresolved = participantIds.filter((id) => !Number(sharesMinor?.[id] || 0));
  const target = unresolved.length === 1 ? unresolved[0] : activeParticipantId;
  if (!target || !participantIds.includes(target)) throw new Error('请先选择正在编辑的参与者');
  const nextMinor = Number(sharesMinor?.[target] || 0) + summary.remainingMinor;
  if (nextMinor < 0) throw new Error('分摊金额不能为负数');
  return { ...sharesMinor, [target]: nextMinor };
}

export function suggestedMissingShare(totalMinor, participantIds, sharesMinor) {
  const missing = participantIds.filter((id) => !Number(sharesMinor?.[id] || 0));
  if (missing.length !== 1) return null;
  const allocated = participantIds.filter((id) => id !== missing[0]).reduce((sum, id) => sum + Number(sharesMinor?.[id] || 0), 0);
  const remainder = Number(totalMinor) - allocated;
  return remainder >= 0 ? { participantId: missing[0], amountMinor: remainder } : null;
}
