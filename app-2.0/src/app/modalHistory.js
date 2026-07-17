let modalHistorySequence = 0;

// A child modal owns exactly one browser-history entry. Direct UI dismissal
// consumes that entry while the child is still the top layer, so the parent
// Sheet never receives the resulting popstate as its own Back action.
export function registerOwnedModalHistory({ layerId, isTop, onPop, stateKey = 'ringgitmeModalLayer' }) {
  const token = `modal-history:${++modalHistorySequence}:${layerId}`;
  const marker = { token, layerId };
  history.pushState({ ...(history.state || {}), ringgitmeModalLayer: marker, [stateKey]: marker }, '', location.href);
  let active = true;
  let closeRequested = false;

  const popHandler = (event) => {
    if (!active || !isTop()) return;
    event.stopImmediatePropagation();
    active = false;
    window.removeEventListener('popstate', popHandler, true);
    onPop?.();
  };
  window.addEventListener('popstate', popHandler, true);

  return Object.freeze({
    token,
    requestClose() {
      if (!active || closeRequested) return false;
      if (!isTop()) throw new Error(`modal_history_layer_mismatch: expected ${layerId}`);
      closeRequested = true;
      history.back();
      return true;
    },
  });
}
