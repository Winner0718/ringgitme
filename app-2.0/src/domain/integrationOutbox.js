const SOURCE_CHANNELS = new Set(['app', 'telegram', 'app_to_app', 'migration', 'system']);

export function createIntegrationOutbox(initialEvents = []) {
  const seed = structuredClone(initialEvents);
  let events = structuredClone(seed);
  let sequence = events.length;
  const byClient = new Map(events.map((event) => [event.clientEventId, event]));

  return {
    emit(input) {
      if (!input.clientEventId) throw new Error('缺少客户端事件 ID');
      if (byClient.has(input.clientEventId)) return byClient.get(input.clientEventId);
      if (!SOURCE_CHANNELS.has(input.sourceChannel)) throw new Error('来源渠道无效');
      const event = {
        eventId: `evt-${String(++sequence).padStart(5, '0')}`,
        clientEventId: input.clientEventId,
        eventType: input.eventType,
        sourceChannel: input.sourceChannel,
        actorUserId: input.actorUserId || null,
        participantId: input.participantId || null,
        ledgerId: input.ledgerId || null,
        entityId: input.entityId || null,
        revision: Number(input.revision || 1),
        occurredAt: input.occurredAt || new Date().toISOString(),
        payload: structuredClone(input.payload || {}),
        deliveryState: 'pending_local',
      };
      events.push(event); byClient.set(event.clientEventId, event);
      return structuredClone(event);
    },
    getEvents: () => structuredClone(events),
    getByClientEventId: (id) => structuredClone(byClient.get(id) || null),
    reset() { events = structuredClone(seed); sequence = events.length; byClient.clear(); events.forEach((event) => byClient.set(event.clientEventId, event)); },
  };
}
