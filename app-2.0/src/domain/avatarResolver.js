export function resolveParticipantAvatar(participant) {
  const avatar = participant?.avatar || {};
  const custom = avatar.customLocalUrl || avatar.customUrl || null;
  if (custom) return { kind: 'image', source: 'ringgitme', url: custom, alt: participant.displayName || '参与者' };
  const telegram = avatar.telegramLocalUrl || null;
  if (telegram) return { kind: 'image', source: 'telegram-local', url: telegram, alt: participant.displayName || '参与者' };
  const local = avatar.localUrl || null;
  if (local) return { kind: 'image', source: 'local', url: local, alt: participant.displayName || '参与者' };
  return { kind: 'initials', source: 'fallback', initials: String(avatar.initials || participant?.displayName || '?').trim().slice(0, 2).toUpperCase() || '?' };
}

export function participantAvatarHTML(participant, className = 'participant-avatar') {
  const resolved = resolveParticipantAvatar(participant);
  return resolved.kind === 'image'
    ? `<span class="${className}"><img src="${resolved.url}" alt="${resolved.alt}" /></span>`
    : `<span class="${className}" aria-hidden="true">${resolved.initials}</span>`;
}
