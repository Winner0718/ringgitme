export function moveId(order, id, targetIndex) {
  const next = [...order];
  const from = next.indexOf(id);
  if (from < 0) return next;
  next.splice(from, 1);
  next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, id);
  return next;
}

export function createReorderSession(ids) {
  const original = [...ids];
  let current = [...ids];
  return {
    getCurrent: () => [...current],
    move(id, targetIndex) {
      current = moveId(current, id, targetIndex);
      return this.getCurrent();
    },
    cancel: () => [...original],
    commit: () => [...current],
  };
}
