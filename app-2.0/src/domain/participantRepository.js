const PRIVATE_CAPABILITIES = ['private_capture', 'private_accounts', 'credit_cards', 'assets', 'investments', 'fixed_expenses'];
const LEDGER_CAPABILITIES = ['ledger_balance', 'ledger_history', 'ledger_confirm', 'ledger_repay', 'ledger_reminders', 'ledger_attachment'];

export function capabilitiesForBindings(bindings) {
  const kinds = new Set(bindings.map((binding) => binding.channel));
  if (kinds.has('app')) return [...LEDGER_CAPABILITIES, ...PRIVATE_CAPABILITIES];
  if (kinds.has('telegram')) return [...LEDGER_CAPABILITIES];
  return ['ledger_balance', 'ledger_history'];
}

export function createParticipantRepository(initialParticipants = []) {
  const seed = structuredClone(initialParticipants);
  let participants = structuredClone(seed);
  let sequence = participants.length;
  const pendingClaims = new Map();

  const find = (id) => participants.find((participant) => participant.participantId === id);
  const sync = (participant) => {
    participant.appUserId = participant.channelBindings.find((item) => item.channel === 'app')?.externalId || null;
    participant.telegramUserId = participant.channelBindings.find((item) => item.channel === 'telegram')?.externalId || null;
    participant.permissions = capabilitiesForBindings(participant.channelBindings);
    participant.updatedAt = new Date().toISOString();
    return participant;
  };
  participants.forEach(sync);

  return {
    getAll: () => structuredClone(participants),
    get: (id) => structuredClone(find(id) || null),
    createManual({ displayName, manualContactRef = null }) {
      const name = String(displayName || '').trim();
      if (!name) throw new Error('请输入参与者名称');
      const now = new Date().toISOString();
      const participant = sync({ participantId: `participant-local-${++sequence}`, displayName: name, avatar: { initials: name.slice(0, 1) }, manualContactRef, channelBindings: [], claimState: 'unclaimed', notificationPreferences: {}, createdAt: now, updatedAt: now });
      participants.push(participant); return structuredClone(participant);
    },
    prepareClaim(participantId, appUserId, clientEventId) {
      const participant = find(participantId);
      if (!participant) throw new Error('参与者不存在');
      if (!participant.telegramUserId) throw new Error('只有 Telegram 参与者可以认领');
      const conflict = participants.find((item) => item.participantId !== participantId && item.appUserId === appUserId);
      if (conflict || participant.appUserId) throw new Error('该 App 身份已被绑定');
      const claim = { claimId: `claim-${clientEventId}`, participantId, appUserId, consentState: 'verified', status: 'prepared' };
      pendingClaims.set(claim.claimId, claim); participant.claimState = 'prepared'; return structuredClone(claim);
    },
    completeClaim(claimId) {
      const claim = pendingClaims.get(claimId);
      if (!claim || claim.status !== 'prepared' || claim.consentState !== 'verified') throw new Error('认领尚未通过验证');
      const participant = find(claim.participantId);
      if (participants.some((item) => item.participantId !== participant.participantId && item.appUserId === claim.appUserId)) throw new Error('App 身份冲突');
      participant.channelBindings.push({ channel: 'app', externalId: claim.appUserId, linkedAt: new Date().toISOString() });
      participant.claimState = 'claimed'; claim.status = 'completed'; sync(participant); return structuredClone(participant);
    },
    cancelClaim(claimId) {
      const claim = pendingClaims.get(claimId);
      if (!claim || claim.status !== 'prepared') return false;
      claim.status = 'cancelled'; const participant = find(claim.participantId); participant.claimState = 'unclaimed'; return true;
    },
    reset() { participants = structuredClone(seed); participants.forEach(sync); sequence = participants.length; pendingClaims.clear(); },
  };
}

export const TELEGRAM_UPGRADE_PROMPTS = [
  '在 RinggitMe App 查看完整月份趋势与账本历史',
  '安装 RinggitMe 后，这些关系账会自动同步到你的账户',
  '想开始管理自己的资产与日常账目？体验 RinggitMe App',
];
